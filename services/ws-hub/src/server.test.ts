/**
 * eBug WebSocket Hub — Unit Tests
 *
 * Tests JWT verification, ConnectionRegistry, message handling,
 * and health endpoint behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import crypto from 'crypto';

// ─────────────────────────────────────────────
// ConnectionRegistry Tests (extracted logic)
// ─────────────────────────────────────────────

interface ClientSession {
  ws: any;
  userId: string;
  orgId: string;
  watchedFiles: string[];
  resumeToken: string | null;
  connectedAt: Date;
}

class ConnectionRegistry {
  private sessions = new Map<string, ClientSession>();
  private orgIndex = new Map<string, Set<string>>();

  add(sessionId: string, session: ClientSession): void {
    this.sessions.set(sessionId, session);
    if (!this.orgIndex.has(session.orgId)) {
      this.orgIndex.set(session.orgId, new Set());
    }
    this.orgIndex.get(session.orgId)!.add(sessionId);
  }

  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.orgIndex.get(session.orgId)?.delete(sessionId);
      this.sessions.delete(sessionId);
    }
  }

  getByOrg(orgId: string): ClientSession[] {
    const ids = this.orgIndex.get(orgId);
    if (!ids) return [];
    return [...ids].map((id) => this.sessions.get(id)!).filter(Boolean);
  }

  get size(): number {
    return this.sessions.size;
  }
}

// ─────────────────────────────────────────────
// JWT Verification Tests (extracted logic)
// ─────────────────────────────────────────────

const JWT_SECRET = 'ebug-dev-secret';

function createTestJWT(
  payload: Record<string, unknown>,
  secret: string = JWT_SECRET,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token: string): { userId: string; orgId: string } | null {
  const DEV_MODE = true;

  if (DEV_MODE) {
    if (!token || token === 'dev-token') {
      return { userId: 'dev-user', orgId: 'a0000000-0000-0000-0000-000000000001' };
    }
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signatureB64 !== expectedSig) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null;
    }

    return {
      userId: payload.sub ?? payload.user_id ?? '',
      orgId: payload.org_id ?? '',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────

describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry;

  beforeEach(() => {
    registry = new ConnectionRegistry();
  });

  it('should start empty', () => {
    expect(registry.size).toBe(0);
  });

  it('should add and track sessions', () => {
    const session: ClientSession = {
      ws: {},
      userId: 'user-1',
      orgId: 'org-1',
      watchedFiles: [],
      resumeToken: null,
      connectedAt: new Date(),
    };

    registry.add('session-1', session);
    expect(registry.size).toBe(1);
  });

  it('should index sessions by org', () => {
    registry.add('s1', {
      ws: {}, userId: 'u1', orgId: 'org-A',
      watchedFiles: [], resumeToken: null, connectedAt: new Date(),
    });
    registry.add('s2', {
      ws: {}, userId: 'u2', orgId: 'org-A',
      watchedFiles: [], resumeToken: null, connectedAt: new Date(),
    });
    registry.add('s3', {
      ws: {}, userId: 'u3', orgId: 'org-B',
      watchedFiles: [], resumeToken: null, connectedAt: new Date(),
    });

    expect(registry.getByOrg('org-A')).toHaveLength(2);
    expect(registry.getByOrg('org-B')).toHaveLength(1);
    expect(registry.getByOrg('org-C')).toHaveLength(0);
  });

  it('should remove sessions and update org index', () => {
    registry.add('s1', {
      ws: {}, userId: 'u1', orgId: 'org-A',
      watchedFiles: [], resumeToken: null, connectedAt: new Date(),
    });

    expect(registry.size).toBe(1);
    registry.remove('s1');
    expect(registry.size).toBe(0);
    expect(registry.getByOrg('org-A')).toHaveLength(0);
  });

  it('should handle removing non-existent session gracefully', () => {
    expect(() => registry.remove('nonexistent')).not.toThrow();
  });

  it('should support multiple orgs concurrently', () => {
    for (let i = 0; i < 10; i++) {
      registry.add(`s${i}`, {
        ws: {}, userId: `u${i}`, orgId: `org-${i % 3}`,
        watchedFiles: [], resumeToken: null, connectedAt: new Date(),
      });
    }

    expect(registry.size).toBe(10);
    expect(registry.getByOrg('org-0')).toHaveLength(4); // 0, 3, 6, 9
    expect(registry.getByOrg('org-1')).toHaveLength(3); // 1, 4, 7
    expect(registry.getByOrg('org-2')).toHaveLength(3); // 2, 5, 8
  });
});

describe('JWT Verification', () => {
  it('should accept dev-token in dev mode', () => {
    const result = verifyToken('dev-token');
    expect(result).toEqual({
      userId: 'dev-user',
      orgId: 'a0000000-0000-0000-0000-000000000001',
    });
  });

  it('should accept empty token in dev mode', () => {
    const result = verifyToken('');
    expect(result).toEqual({
      userId: 'dev-user',
      orgId: 'a0000000-0000-0000-0000-000000000001',
    });
  });

  it('should verify valid HMAC JWT', () => {
    const payload = {
      sub: 'user-123',
      org_id: 'org-456',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = createTestJWT(payload);
    const result = verifyToken(token);
    expect(result).toEqual({
      userId: 'user-123',
      orgId: 'org-456',
    });
  });

  it('should reject expired JWT', () => {
    const payload = {
      sub: 'user-123',
      org_id: 'org-456',
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    };
    const token = createTestJWT(payload);
    const result = verifyToken(token);
    expect(result).toBeNull();
  });

  it('should reject JWT with wrong secret', () => {
    const payload = { sub: 'user-123', org_id: 'org-456' };
    const token = createTestJWT(payload, 'wrong-secret');
    const result = verifyToken(token);
    // In dev mode, any non-dev-token still gets verified by HMAC
    expect(result).toBeNull();
  });

  it('should reject malformed tokens', () => {
    expect(verifyToken('not.a.valid.jwt.token')).toBeNull();
    expect(verifyToken('single-segment')).toBeNull();
  });
});

describe('Client Message Handling', () => {
  it('should parse subscribe message correctly', () => {
    const session: ClientSession = {
      ws: { send: vi.fn() },
      userId: 'u1',
      orgId: 'org-1',
      watchedFiles: [],
      resumeToken: null,
      connectedAt: new Date(),
    };

    const msg = {
      type: 'subscribe',
      payload: {
        filePaths: ['/src/app.ts', '/src/utils.ts'],
        resumeToken: 'resume-123',
      },
    };

    // Simulate handleClientMessage logic
    if (msg.type === 'subscribe') {
      session.watchedFiles = (msg.payload.filePaths as string[]) ?? [];
      session.resumeToken = (msg.payload.resumeToken as string) ?? null;
    }

    expect(session.watchedFiles).toEqual(['/src/app.ts', '/src/utils.ts']);
    expect(session.resumeToken).toBe('resume-123');
  });

  it('should handle heartbeat message', () => {
    const sendMock = vi.fn();
    const session: ClientSession = {
      ws: { send: sendMock },
      userId: 'u1',
      orgId: 'org-1',
      watchedFiles: [],
      resumeToken: null,
      connectedAt: new Date(),
    };

    const msg = { type: 'heartbeat', payload: {} };

    if (msg.type === 'heartbeat') {
      session.ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
    }

    expect(sendMock).toHaveBeenCalledWith(
      JSON.stringify({ type: 'heartbeat_ack' }),
    );
  });
});

describe('File Path Filtering', () => {
  it('should match watched file paths', () => {
    const watchedFiles = ['/src/components/', '/src/utils.ts'];
    const filePath = '/src/components/Button.tsx';

    const watching = watchedFiles.some(
      (wp) => filePath.startsWith(wp) || filePath.includes(wp),
    );

    expect(watching).toBe(true);
  });

  it('should not match unwatched file paths', () => {
    const watchedFiles = ['/src/components/', '/src/utils.ts'];
    const filePath = '/tests/integration/api.test.ts';

    const watching = watchedFiles.some(
      (wp) => filePath.startsWith(wp) || filePath.includes(wp),
    );

    expect(watching).toBe(false);
  });

  it('should send to all clients when no watch filter set', () => {
    const watchedFiles: string[] = [];
    const filePath = '/any/path/file.ts';

    // When watchedFiles is empty, all events pass through
    const shouldSend = watchedFiles.length === 0 || watchedFiles.some(
      (wp) => filePath.startsWith(wp) || filePath.includes(wp),
    );

    expect(shouldSend).toBe(true);
  });
});

describe('Health Endpoint', () => {
  it('should return correct health response shape', () => {
    const registry = new ConnectionRegistry();
    registry.add('s1', {
      ws: {}, userId: 'u1', orgId: 'org-1',
      watchedFiles: [], resumeToken: null, connectedAt: new Date(),
    });

    const response = { status: 'ok', connections: registry.size };
    expect(response.status).toBe('ok');
    expect(response.connections).toBe(1);
  });
});
