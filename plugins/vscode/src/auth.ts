/**
 * eBug Authentication — OIDC PKCE Flow
 *
 * Implements the Authorization Code flow with PKCE for
 * VS Code extension authentication. Supports token refresh
 * and secure storage via VS Code's SecretStorage API.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';

// ── Configuration ──

interface AuthConfig {
  authority: string;         // OIDC provider URL (e.g., auth0, keycloak)
  clientId: string;
  redirectUri: string;       // localhost callback
  scopes: string[];
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;         // Unix timestamp
}

const AUTH_SECRET_KEY = 'ebug-auth-tokens';

// ─────────────────────────────────────────────
// Auth Manager
// ─────────────────────────────────────────────

export class AuthManager {
  private config: AuthConfig;
  private secrets: vscode.SecretStorage;
  private tokenSet: TokenSet | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(context: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('ebug');

    this.config = {
      authority: cfg.get<string>('auth.authority', 'https://auth.ebug.dev'),
      clientId: cfg.get<string>('auth.clientId', 'ebug-vscode'),
      redirectUri: 'http://localhost:38471/callback',
      scopes: ['openid', 'profile', 'email', 'ebug:read', 'ebug:write'],
    };

    this.secrets = context.secrets;
  }

  /**
   * Get a valid access token, refreshing if needed.
   * Falls back to dev-token in development mode.
   */
  async getToken(): Promise<string> {
    // Check for dev-mode override
    const devToken = vscode.workspace.getConfiguration('ebug').get<string>('auth.devToken');
    if (devToken) {
      return devToken;
    }

    // Try to load from storage
    if (!this.tokenSet) {
      await this.loadTokens();
    }

    // Check if token is still valid (with 60s buffer)
    if (this.tokenSet && this.tokenSet.expiresAt > Date.now() / 1000 + 60) {
      return this.tokenSet.accessToken;
    }

    // Try refresh
    if (this.tokenSet?.refreshToken) {
      try {
        await this.refreshTokens();
        return this.tokenSet!.accessToken;
      } catch {
        // Refresh failed — need full re-auth
      }
    }

    // Full OIDC PKCE login flow
    await this.login();
    return this.tokenSet!.accessToken;
  }

  /**
   * Initiate OIDC PKCE login flow.
   * Opens browser for auth, starts local callback server.
   */
  async login(): Promise<void> {
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    const state = crypto.randomUUID();

    const authUrl = new URL(`${this.config.authority}/authorize`);
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authUrl.searchParams.set('scope', this.config.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Start local callback server
    const code = await this.waitForCallback(state);

    // Exchange code for tokens
    await this.exchangeCode(code, codeVerifier);

    // Open browser
    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    vscode.window.showInformationMessage('eBug: Successfully authenticated');
  }

  /**
   * Logout — clear tokens and stop refresh timer.
   */
  async logout(): Promise<void> {
    this.tokenSet = null;
    await this.secrets.delete(AUTH_SECRET_KEY);
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    vscode.window.showInformationMessage('eBug: Logged out');
  }

  /**
   * Whether the user is currently authenticated.
   */
  isAuthenticated(): boolean {
    return this.tokenSet !== null && this.tokenSet.expiresAt > Date.now() / 1000;
  }

  // ── Private Methods ──

  private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  private async waitForCallback(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (state !== expectedState) {
          res.writeHead(400);
          res.end('Invalid state parameter');
          reject(new Error('OIDC state mismatch'));
          server.close();
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end('No authorization code received');
          reject(new Error('No authorization code'));
          server.close();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0b0f;color:#f1f5f9;">
            <div style="text-align:center">
              <h1 style="font-size:24px;margin:0 0 8px">✅ Authentication Successful</h1>
              <p style="color:#94a3b8;font-size:14px">You can close this tab and return to VS Code.</p>
            </div>
          </body></html>
        `);

        resolve(code);
        server.close();
      });

      server.listen(38471);

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out'));
      }, 5 * 60 * 1000);
    });
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<void> {
    const tokenUrl = `${this.config.authority}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      throw new Error(`Token exchange failed: ${resp.status}`);
    }

    const data = await resp.json() as any;
    this.tokenSet = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresAt: Date.now() / 1000 + (data.expires_in ?? 3600),
    };

    await this.saveTokens();
    this.scheduleRefresh();
  }

  private async refreshTokens(): Promise<void> {
    if (!this.tokenSet?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const tokenUrl = `${this.config.authority}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      refresh_token: this.tokenSet.refreshToken,
    });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      throw new Error(`Token refresh failed: ${resp.status}`);
    }

    const data = await resp.json() as any;
    this.tokenSet = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? this.tokenSet.refreshToken,
      idToken: data.id_token,
      expiresAt: Date.now() / 1000 + (data.expires_in ?? 3600),
    };

    await this.saveTokens();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!this.tokenSet) return;

    // Refresh 5 minutes before expiry
    const refreshIn = Math.max(0, (this.tokenSet.expiresAt - Date.now() / 1000 - 300)) * 1000;
    this.refreshTimer = setTimeout(() => {
      this.refreshTokens().catch(() => {
        vscode.window.showWarningMessage('eBug: Session expired. Please re-authenticate.');
      });
    }, refreshIn);
  }

  private async saveTokens(): Promise<void> {
    if (this.tokenSet) {
      await this.secrets.store(AUTH_SECRET_KEY, JSON.stringify(this.tokenSet));
    }
  }

  private async loadTokens(): Promise<void> {
    const stored = await this.secrets.get(AUTH_SECRET_KEY);
    if (stored) {
      try {
        this.tokenSet = JSON.parse(stored);
        if (this.tokenSet && this.tokenSet.expiresAt > Date.now() / 1000) {
          this.scheduleRefresh();
        }
      } catch {
        this.tokenSet = null;
      }
    }
  }
}
