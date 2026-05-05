/**
 * eBug API Gateway — JWT Authentication Middleware
 *
 * Supports two modes:
 * 1. OIDC JWT validation (production) — verifies tokens against JWKS endpoint
 * 2. Development mode — accepts 'dev-token' when EBUG_DEV_MODE=true
 *
 * Extracts user info (userId, orgId, role) from token claims
 * and attaches to request for downstream use.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ── Configuration ──

const DEV_MODE = process.env.EBUG_DEV_MODE === 'true' || process.env.NODE_ENV !== 'production';
const OIDC_ISSUER = process.env.OIDC_ISSUER ?? 'https://auth.ebug.dev';
const OIDC_AUDIENCE = process.env.OIDC_AUDIENCE ?? 'ebug-api';
const JWKS_URL = process.env.JWKS_URL ?? `${OIDC_ISSUER}/.well-known/jwks.json`;

// ── Types ──

export interface AuthUser {
  userId: string;
  orgId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ── JWKS Cache ──

interface JWKSCache {
  keys: Record<string, crypto.KeyObject>;
  fetchedAt: number;
}

let jwksCache: JWKSCache | null = null;
const JWKS_CACHE_TTL = 3600_000; // 1 hour

async function getJWKS(): Promise<Record<string, crypto.KeyObject>> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL) {
    return jwksCache.keys;
  }

  try {
    const resp = await fetch(JWKS_URL);
    if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
    const data = await resp.json() as { keys: Array<{ kid: string; kty: string; n: string; e: string }> };

    const keys: Record<string, crypto.KeyObject> = {};
    for (const jwk of data.keys) {
      if (jwk.kty === 'RSA') {
        keys[jwk.kid] = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      }
    }

    jwksCache = { keys, fetchedAt: Date.now() };
    logger.info({ keyCount: Object.keys(keys).length }, 'JWKS refreshed');
    return keys;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch JWKS');
    if (jwksCache) return jwksCache.keys; // Use stale cache
    throw err;
  }
}

// ── JWT Helpers ──

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function decodeJWT(token: string): { header: any; payload: any; signature: Buffer; signedPart: string } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  return {
    header: JSON.parse(base64UrlDecode(parts[0]).toString()),
    payload: JSON.parse(base64UrlDecode(parts[1]).toString()),
    signature: base64UrlDecode(parts[2]),
    signedPart: `${parts[0]}.${parts[1]}`,
  };
}

async function verifyJWT(token: string): Promise<AuthUser> {
  const { header, payload, signature, signedPart } = decodeJWT(token);

  // Validate issuer and audience
  if (payload.iss !== OIDC_ISSUER) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(OIDC_AUDIENCE)) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }

  // Check expiry
  if (payload.exp && payload.exp < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  // Verify signature using JWKS
  const keys = await getJWKS();
  const kid = header.kid;
  const publicKey = keys[kid];

  if (!publicKey) {
    // Refresh JWKS in case of key rotation
    jwksCache = null;
    const refreshedKeys = await getJWKS();
    const refreshedKey = refreshedKeys[kid];
    if (!refreshedKey) throw new Error(`Unknown key ID: ${kid}`);
  }

  const key = keys[kid] || (await getJWKS())[kid];
  const isValid = crypto.verify(
    header.alg === 'RS256' ? 'sha256' : 'sha384',
    Buffer.from(signedPart),
    key,
    signature,
  );

  if (!isValid) {
    throw new Error('Invalid token signature');
  }

  return {
    userId: payload.sub ?? '',
    orgId: payload.org_id ?? payload['https://ebug.dev/org_id'] ?? 'a0000000-0000-0000-0000-000000000001',
    email: payload.email ?? '',
    role: payload.role ?? payload['https://ebug.dev/role'] ?? 'developer',
  };
}

// ── Dev Mode User ──

const DEV_USER: AuthUser = {
  userId: 'b0000000-0000-0000-0000-000000000001',
  orgId: 'a0000000-0000-0000-0000-000000000001',
  email: 'admin@ebug.dev',
  role: 'admin',
};

// ── Middleware ──

/**
 * JWT authentication middleware.
 * - In dev mode: accepts 'dev-token' or no token (attaches default dev user)
 * - In production: validates JWT against OIDC JWKS endpoint
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Dev mode: relax auth requirements
  if (DEV_MODE) {
    if (!authHeader || authHeader === 'Bearer dev-token') {
      req.user = DEV_USER;
      return next();
    }
  }

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  // Dev mode: accept any token
  if (DEV_MODE && token === 'dev-token') {
    req.user = DEV_USER;
    return next();
  }

  // Production: verify JWT
  verifyJWT(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      logger.warn({ err: err.message }, 'Authentication failed');
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}

/**
 * Role-based authorization middleware.
 * Must be used AFTER authMiddleware.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
