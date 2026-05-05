/**
 * eBug WebSocket Hub
 * 
 * Real-time push server that bridges NATS JetStream events
 * to connected IDE plugins via WebSocket.
 * 
 * Features:
 * - JWT authentication on connection
 * - Per-org/user connection routing
 * - File-path-based subscription filtering
 * - Resume tokens for reconnection
 */

import { WebSocketServer, WebSocket } from 'ws';
import { connect, JetStreamClient, StringCodec } from 'nats';
import { createServer } from 'http';
import crypto from 'crypto';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const sc = StringCodec();

// ── Types ──

interface ClientSession {
  ws: WebSocket;
  userId: string;
  orgId: string;
  watchedFiles: string[];
  resumeToken: string | null;
  connectedAt: Date;
}

// ── Connection Registry ──

class ConnectionRegistry {
  private sessions = new Map<string, ClientSession>();
  private orgIndex = new Map<string, Set<string>>();

  add(sessionId: string, session: ClientSession): void {
    this.sessions.set(sessionId, session);
    if (!this.orgIndex.has(session.orgId)) {
      this.orgIndex.set(session.orgId, new Set());
    }
    this.orgIndex.get(session.orgId)!.add(sessionId);
    logger.info({ sessionId, orgId: session.orgId, userId: session.userId }, 'Client connected');
  }

  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.orgIndex.get(session.orgId)?.delete(sessionId);
      this.sessions.delete(sessionId);
      logger.info({ sessionId }, 'Client disconnected');
    }
  }

  getByOrg(orgId: string): ClientSession[] {
    const ids = this.orgIndex.get(orgId);
    if (!ids) return [];
    return [...ids].map(id => this.sessions.get(id)!).filter(Boolean);
  }

  get size(): number {
    return this.sessions.size;
  }
}

// ── JWT Verification ──

const DEV_MODE = process.env.EBUG_DEV_MODE === 'true' || process.env.NODE_ENV !== 'production';
const JWT_SECRET = process.env.JWT_SECRET ?? 'ebug-dev-secret';

function verifyToken(token: string): { userId: string; orgId: string } | null {
  // Dev mode: accept dev-token or skip verification
  if (DEV_MODE) {
    if (!token || token === 'dev-token') {
      return { userId: 'dev-user', orgId: 'a0000000-0000-0000-0000-000000000001' };
    }
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Verify HMAC signature (for symmetric JWT)
    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signatureB64 !== expectedSig) {
      logger.warn('JWT signature verification failed');
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    // Check expiry
    if (payload.exp && payload.exp < Date.now() / 1000) {
      logger.warn('JWT expired');
      return null;
    }

    return {
      userId: payload.sub ?? payload.user_id ?? '',
      orgId: payload.org_id ?? payload['https://ebug.dev/org_id'] ?? '',
    };
  } catch (err) {
    logger.error({ err }, 'JWT verification error');
    return null;
  }
}

// ── Main Server ──

async function startServer() {
  const PORT = parseInt(process.env.PORT ?? '8082', 10);
  const NATS_URL = process.env.NATS_URL ?? '';

  // HTTP server for health checks
  const registry = new ConnectionRegistry();

  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', connections: registry.size }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/v1/stream' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token') ?? '';
    const orgIdParam = url.searchParams.get('org_id') ?? '';
    const userIdParam = url.searchParams.get('user_id') ?? '';
    const sessionId = crypto.randomUUID();

    // Authenticate: verify JWT token
    const authResult = verifyToken(token);
    if (!authResult && !DEV_MODE) {
      logger.warn({ sessionId }, 'Authentication failed — closing connection');
      ws.close(4001, 'Authentication failed');
      return;
    }

    // Use token claims, fall back to query params
    const orgId = authResult?.orgId || orgIdParam;
    const userId = authResult?.userId || userIdParam;

    if (!orgId || !userId) {
      ws.close(4001, 'Missing org_id or user_id');
      return;
    }

    const session: ClientSession = {
      ws,
      userId,
      orgId,
      watchedFiles: [],
      resumeToken: null,
      connectedAt: new Date(),
    };

    registry.add(sessionId, session);

    // Handle client messages (js may be null if NATS unavailable)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (js) {
          handleClientMessage(sessionId, session, msg, js);
        }
      } catch (err) {
        logger.error({ err, sessionId }, 'Failed to parse client message');
      }
    });

    ws.on('close', () => registry.remove(sessionId));
    ws.on('error', (err) => {
      logger.error({ err, sessionId }, 'WebSocket error');
      registry.remove(sessionId);
    });

    // Send welcome
    ws.send(JSON.stringify({ type: 'connected', sessionId, authenticated: !!authResult }));
  });

  // Connect to NATS (optional)
  let js: JetStreamClient | null = null;

  if (NATS_URL) {
    try {
      const nc = await connect({ servers: NATS_URL });
      js = nc.jetstream();
      logger.info({ url: NATS_URL }, 'Connected to NATS');

      // Subscribe to NATS events and broadcast to relevant clients
      const subjects = ['bug.created', 'bug.deduplicated', 'bug.classified', 'bug.triaged'];

      for (const subject of subjects) {
        const sub = await js.subscribe(subject, { queue: 'ws-hub' });

        (async () => {
          for await (const msg of sub) {
            try {
              const data = JSON.parse(sc.decode(msg.data));
              const orgId = data.org_id ?? '';
              const filePath = data.file_path ?? '';
              const clients = registry.getByOrg(orgId);

              const eventType = subject.split('.').pop() ?? subject;
              const payload = JSON.stringify({
                type: `bug_${eventType === 'created' ? 'created' : 'updated'}`,
                payload: data,
              });

              for (const client of clients) {
                if (client.ws.readyState !== WebSocket.OPEN) continue;

                // File-path filtering: send to all if no filter, or match path
                if (client.watchedFiles.length > 0 && filePath) {
                  const watching = client.watchedFiles.some(
                    (wp) => filePath.startsWith(wp) || filePath.includes(wp)
                  );
                  if (!watching) continue;
                }

                client.ws.send(payload);
              }

              msg.ack();
            } catch (err) {
              logger.error({ err, subject }, 'Error broadcasting event');
              msg.nak();
            }
          }
        })();
      }
    } catch (err) {
      logger.warn({ err }, 'NATS not available — WebSocket hub running without event streaming');
    }
  } else {
    logger.warn('NATS_URL is empty — WebSocket hub running without event streaming');
  }

  httpServer.listen(PORT, () => {
    logger.info({ port: PORT }, 'WebSocket hub started');
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    wss.close();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function handleClientMessage(
  sessionId: string,
  session: ClientSession,
  msg: { type: string; payload: Record<string, unknown> },
  js: JetStreamClient,
) {
  switch (msg.type) {
    case 'subscribe':
      session.watchedFiles = (msg.payload.filePaths as string[]) ?? [];
      session.resumeToken = (msg.payload.resumeToken as string) ?? null;
      logger.info({ sessionId, files: session.watchedFiles.length }, 'Client subscribed');
      break;

    case 'create_bug':
    case 'transition_status':
    case 'telemetry':
      // Forward to NATS for processing
      const subject = `bug.ingest.request`;
      js.publish(subject, sc.encode(JSON.stringify(msg.payload)));
      break;

    case 'heartbeat':
      session.ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
      break;
  }
}

startServer().catch((err) => {
  logger.fatal({ err }, 'Failed to start WebSocket hub');
  process.exit(1);
});
