/**
 * eBug API Gateway
 * 
 * REST API gateway that connects the web dashboard (and external clients)
 * to the backend microservices via PostgreSQL (reads) and NATS (writes).
 * 
 * Endpoints:
 *   GET    /api/v1/bugs          — List bugs with filtering
 *   GET    /api/v1/bugs/:id      — Get single bug
 *   POST   /api/v1/bugs          — Create bug (publishes to NATS)
 *   PATCH  /api/v1/bugs/:id      — Update bug fields
 *   POST   /api/v1/bugs/:id/transition — Change bug status
 *   GET    /api/v1/bugs/:id/activity   — Get activity log
 *   GET    /api/v1/stats         — Dashboard stats
 *   GET    /api/v1/stats/timeline — Bug timeline data
 *   GET    /health               — Health check
 */

import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { connect, StringCodec, JetStreamClient } from 'nats';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from './auth.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const sc = StringCodec();

// ── Configuration ──

const PORT = parseInt(process.env.PORT ?? '8090', 10);
const NATS_URL = process.env.NATS_URL || '';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ebug:ebug@localhost:5432/ebug';

// ── Database ──

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── NATS ──

let js: JetStreamClient;

async function initNats() {
  if (!NATS_URL) {
    logger.warn('NATS_URL is empty — running without event streaming');
    return;
  }
  try {
    const nc = await connect({ servers: NATS_URL });
    js = nc.jetstream();
    logger.info({ url: NATS_URL }, 'Connected to NATS');
  } catch (err) {
    logger.warn({ err }, 'NATS not available — write operations will fail');
  }
}

// ── Express App ──

const app = express();
app.use(cors());
app.use(express.json());

// Apply auth to all /api routes (health check remains public)
app.use('/api', authMiddleware);

// Health check
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'unhealthy' });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/bugs — List bugs with filtering & pagination
// ─────────────────────────────────────────────

app.get('/api/v1/bugs', async (req, res) => {
  try {
    const {
      status, severity, category, assignee_id, team_id,
      search, page = '1', limit = '50', sort = 'created_at', order = 'desc',
    } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (status) {
      const statuses = (status as string).split(',');
      conditions.push(`status = ANY($${paramIdx}::text[])`);
      params.push(statuses);
      paramIdx++;
    }

    if (severity) {
      const severities = (severity as string).split(',');
      conditions.push(`severity = ANY($${paramIdx}::text[])`);
      params.push(severities);
      paramIdx++;
    }

    if (category) {
      conditions.push(`category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }

    if (assignee_id) {
      conditions.push(`assignee_id = $${paramIdx}::uuid`);
      params.push(assignee_id);
      paramIdx++;
    }

    if (team_id) {
      conditions.push(`team_id = $${paramIdx}::uuid`);
      params.push(team_id);
      paramIdx++;
    }

    if (search) {
      conditions.push(`(title ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const allowedSorts = ['created_at', 'updated_at', 'severity', 'priority', 'external_id'];
    const sortCol = allowedSorts.includes(sort as string) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * pageSize;

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM bug_reports ${whereClause}`, params
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Fetch page
    const bugsResult = await pool.query(
      `SELECT * FROM bug_reports ${whereClause} 
       ORDER BY ${sortCol} ${sortOrder} 
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pageSize, offset]
    );

    res.json({
      bugs: bugsResult.rows,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list bugs');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/bugs/:id — Get single bug
// ─────────────────────────────────────────────

app.get('/api/v1/bugs/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bug_reports WHERE id = $1 OR external_id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bug not found' });
    }

    // Also fetch recent activity
    const activity = await pool.query(
      `SELECT * FROM bug_activity WHERE bug_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [result.rows[0].id]
    );

    // Fetch duplicates if canonical
    const duplicates = await pool.query(
      `SELECT id, external_id, title, similarity_score, created_at 
       FROM bug_reports WHERE canonical_id = $1`,
      [result.rows[0].id]
    );

    res.json({
      bug: result.rows[0],
      activity: activity.rows,
      duplicates: duplicates.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get bug');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/v1/bugs — Create bug (via NATS pipeline)
// ─────────────────────────────────────────────

app.post('/api/v1/bugs', async (req, res) => {
  try {
    const { title, description, stack_trace, file_path, line_number,
            code_snippet, severity_hint, category_hint, environment,
            source_type, source_ide, org_id } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const bugPayload = {
      id: uuidv4(),
      org_id: org_id ?? 'a0000000-0000-0000-0000-000000000001',
      title,
      description: description ?? '',
      stack_trace: stack_trace ?? '',
      file_path: file_path ?? '',
      line_number: line_number ?? 0,
      code_snippet: code_snippet ?? '',
      severity_hint: severity_hint ?? 'medium',
      category_hint: category_hint ?? '',
      environment: environment ?? {},
      source_type: source_type ?? 'api',
      source_ide: source_ide ?? '',
      source_plugin_version: '',
      log_blob_keys: [],
      screenshot_keys: [],
      created_by: req.body.created_by ?? '',
    };

    if (js) {
      await js.publish('bug.ingest.request', sc.encode(JSON.stringify(bugPayload)));
      logger.info({ id: bugPayload.id, title }, 'Bug submitted to pipeline');
    } else {
      // Fallback: direct DB insert if NATS unavailable
      await pool.query(
        `INSERT INTO bug_reports (id, external_id, org_id, source_type, title, description,
         stack_trace, file_path, line_number, status, severity, category, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11, NOW(), NOW())`,
        [bugPayload.id, `EBUG-${Date.now() % 10000}`, bugPayload.org_id,
         bugPayload.source_type, title, bugPayload.description,
         bugPayload.stack_trace, bugPayload.file_path, bugPayload.line_number,
         bugPayload.severity_hint, bugPayload.category_hint]
      );
    }

    res.status(201).json({ id: bugPayload.id, status: 'submitted' });
  } catch (err) {
    logger.error({ err }, 'Failed to create bug');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/v1/bugs/:id — Update bug fields
// ─────────────────────────────────────────────

app.patch('/api/v1/bugs/:id', async (req, res) => {
  try {
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const allowedFields = ['title', 'description', 'severity', 'category',
                           'assignee_id', 'team_id', 'priority'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx}`);
        params.push(req.body[field]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE bug_reports SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bug not found' });
    }

    // Log activity
    await pool.query(
      `INSERT INTO bug_activity (bug_id, actor_type, action, new_value)
       VALUES ($1, 'user', 'updated', $2::jsonb)`,
      [req.params.id, JSON.stringify(req.body)]
    );

    res.json({ bug: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update bug');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/v1/bugs/:id/transition — Change status
// ─────────────────────────────────────────────

app.post('/api/v1/bugs/:id/transition', async (req, res) => {
  try {
    const { new_status, comment } = req.body;
    const validStatuses = ['open', 'triaged', 'in_progress', 'in_review', 'resolved', 'closed', 'wont_fix'];

    if (!validStatuses.includes(new_status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Get current status
    const current = await pool.query('SELECT status FROM bug_reports WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Bug not found' });
    }

    const oldStatus = current.rows[0].status;

    const updateFields = new_status === 'resolved'
      ? 'status = $1, resolved_at = NOW(), updated_at = NOW()'
      : 'status = $1, updated_at = NOW()';

    const result = await pool.query(
      `UPDATE bug_reports SET ${updateFields} WHERE id = $2 RETURNING *`,
      [new_status, req.params.id]
    );

    // Log activity
    await pool.query(
      `INSERT INTO bug_activity (bug_id, actor_type, action, old_value, new_value, metadata)
       VALUES ($1, 'user', 'status_change', $2::jsonb, $3::jsonb, $4::jsonb)`,
      [req.params.id,
       JSON.stringify({ status: oldStatus }),
       JSON.stringify({ status: new_status }),
       comment ? JSON.stringify({ comment }) : null]
    );

    res.json({ bug: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to transition bug');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/bugs/:id/activity — Activity log
// ─────────────────────────────────────────────

app.get('/api/v1/bugs/:id/activity', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM bug_activity WHERE bug_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ activity: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to get activity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/stats — Dashboard statistics
// ─────────────────────────────────────────────

app.get('/api/v1/stats', async (_req, res) => {
  try {
    const [total, byStatus, bySeverity, byCategory, recentActivity, mttr] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM bug_reports'),
      pool.query(`SELECT status, COUNT(*) as count FROM bug_reports GROUP BY status`),
      pool.query(`SELECT severity, COUNT(*) as count FROM bug_reports GROUP BY severity`),
      pool.query(`SELECT category, COUNT(*) as count FROM bug_reports GROUP BY category`),
      pool.query(`SELECT COUNT(*) as count FROM bug_reports WHERE created_at > NOW() - INTERVAL '24 hours'`),
      pool.query(`SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_hours 
                  FROM bug_reports WHERE resolved_at IS NOT NULL`),
    ]);

    res.json({
      total_bugs: parseInt(total.rows[0].count, 10),
      by_status: Object.fromEntries(byStatus.rows.map(r => [r.status, parseInt(r.count, 10)])),
      by_severity: Object.fromEntries(bySeverity.rows.map(r => [r.severity, parseInt(r.count, 10)])),
      by_category: Object.fromEntries(byCategory.rows.map(r => [r.category, parseInt(r.count, 10)])),
      last_24h: parseInt(recentActivity.rows[0].count, 10),
      avg_resolution_hours: mttr.rows[0].avg_hours ? parseFloat(mttr.rows[0].avg_hours).toFixed(1) : null,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/stats/timeline — Bug creation timeline
// ─────────────────────────────────────────────

app.get('/api/v1/stats/timeline', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string ?? '30', 10);
    const result = await pool.query(
      `SELECT DATE(created_at) as date, 
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE severity = 'critical') as critical,
              COUNT(*) FILTER (WHERE severity = 'high') as high,
              COUNT(*) FILTER (WHERE severity = 'medium') as medium,
              COUNT(*) FILTER (WHERE severity = 'low') as low
       FROM bug_reports 
       WHERE created_at > NOW() - $1 * INTERVAL '1 day'
       GROUP BY DATE(created_at) 
       ORDER BY date`,
      [days]
    );
    res.json({ timeline: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to get timeline');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/teams — List teams
// ─────────────────────────────────────────────

app.get('/api/v1/teams', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, COUNT(br.id) as bug_count 
       FROM teams t 
       LEFT JOIN bug_reports br ON br.team_id = t.id 
       GROUP BY t.id ORDER BY t.name`
    );
    res.json({ teams: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to get teams');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/users — List users
// ─────────────────────────────────────────────

app.get('/api/v1/users', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.role, u.org_id,
              COUNT(br.id) as assigned_bugs
       FROM users u
       LEFT JOIN bug_reports br ON br.assignee_id = u.id AND br.status NOT IN ('resolved', 'closed')
       GROUP BY u.id ORDER BY u.display_name`
    );
    res.json({ users: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to get users');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// Auto-Migration — Creates tables if they don't exist
// ─────────────────────────────────────────────

async function runMigrations() {
  logger.info('Running database migrations...');
  try {
    await pool.query(`

      CREATE TABLE IF NOT EXISTS organizations (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        slug        TEXT UNIQUE NOT NULL,
        oidc_provider TEXT,
        settings    JSONB DEFAULT '{}'::JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        oidc_subject    TEXT UNIQUE NOT NULL,
        email           TEXT UNIQUE NOT NULL,
        display_name    TEXT,
        avatar_url      TEXT,
        org_id          UUID REFERENCES organizations(id),
        role            TEXT DEFAULT 'developer',
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS teams (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name            TEXT NOT NULL,
        org_id          UUID REFERENCES organizations(id),
        routing_rules   JSONB
      );

      CREATE TABLE IF NOT EXISTS bug_reports (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_id     TEXT UNIQUE NOT NULL,
        source_type     TEXT NOT NULL,
        source_ide      TEXT,
        source_plugin_version TEXT,
        title           TEXT NOT NULL,
        description     TEXT,
        stack_trace     TEXT,
        file_path       TEXT,
        line_number     INTEGER,
        code_snippet    TEXT,
        severity        TEXT CHECK (severity IN ('critical','high','medium','low','info')),
        severity_score  FLOAT,
        category        TEXT,
        root_cause_suggestion TEXT,
        canonical_id    UUID REFERENCES bug_reports(id),
        is_duplicate    BOOLEAN DEFAULT FALSE,
        similarity_score FLOAT,
        embedding_id    TEXT,
        status          TEXT DEFAULT 'open'
                        CHECK (status IN ('open','triaged','in_progress','in_review','resolved','closed','wont_fix')),
        assignee_id     UUID REFERENCES users(id),
        team_id         UUID REFERENCES teams(id),
        priority        INTEGER DEFAULT 3,
        runtime_env     JSONB,
        repo_url        TEXT,
        branch          TEXT,
        commit_sha      TEXT,
        pr_urls         TEXT[],
        ci_run_ids      TEXT[],
        log_blob_keys   TEXT[],
        screenshot_keys TEXT[],
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        resolved_at     TIMESTAMPTZ,
        sla_deadline    TIMESTAMPTZ,
        created_by      UUID REFERENCES users(id),
        org_id          UUID REFERENCES organizations(id) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bug_activity (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bug_id      UUID REFERENCES bug_reports(id) ON DELETE CASCADE,
        actor_id    UUID REFERENCES users(id),
        actor_type  TEXT NOT NULL,
        action      TEXT NOT NULL,
        old_value   JSONB,
        new_value   JSONB,
        metadata    JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE SEQUENCE IF NOT EXISTS bug_external_id_seq START 1;
    `);

    // Create indexes (IF NOT EXISTS for safety)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bug_status ON bug_reports(org_id, status);
      CREATE INDEX IF NOT EXISTS idx_bug_assignee ON bug_reports(assignee_id, status);
      CREATE INDEX IF NOT EXISTS idx_bug_severity ON bug_reports(org_id, severity, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bug_canonical ON bug_reports(canonical_id) WHERE is_duplicate = TRUE;
      CREATE INDEX IF NOT EXISTS idx_bug_created ON bug_reports(org_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bug_file ON bug_reports(org_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_activity_bug ON bug_activity(bug_id, created_at DESC);
    `);

    // Seed default org and users if they don't exist
    await pool.query(`
      INSERT INTO organizations (id, name, slug)
      VALUES ('a0000000-0000-0000-0000-000000000001', 'eBug Labs', 'ebug-labs')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO users (id, oidc_subject, email, display_name, org_id, role)
      VALUES
        ('b0000000-0000-0000-0000-000000000001', 'dev|admin', 'admin@ebug.dev', 'Admin User', 'a0000000-0000-0000-0000-000000000001', 'admin'),
        ('b0000000-0000-0000-0000-000000000002', 'dev|dev1', 'dev1@ebug.dev', 'Developer One', 'a0000000-0000-0000-0000-000000000001', 'developer')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO teams (id, name, org_id)
      VALUES
        ('c0000000-0000-0000-0000-000000000001', 'Core Platform', 'a0000000-0000-0000-0000-000000000001'),
        ('c0000000-0000-0000-0000-000000000002', 'Frontend', 'a0000000-0000-0000-0000-000000000001')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Seed sample bugs for initial dashboard demo
    await pool.query(`
      INSERT INTO bug_reports (id, external_id, org_id, source_type, source_ide, title, description,
        stack_trace, file_path, line_number, severity, severity_score, category, status, priority,
        assignee_id, team_id, created_at, updated_at)
      VALUES
        ('d0000000-0000-0000-0000-000000000001', 'EBUG-1001', 'a0000000-0000-0000-0000-000000000001',
         'vscode', 'VS Code', 'NullPointerException in UserService.authenticate',
         'Authentication fails when user session expires during active request',
         'java.lang.NullPointerException\n  at UserService.authenticate(UserService.java:142)\n  at AuthController.login(AuthController.java:58)',
         'src/services/UserService.java', 142, 'critical', 0.95, 'runtime',
         'open', 1, 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
         NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour'),

        ('d0000000-0000-0000-0000-000000000002', 'EBUG-1002', 'a0000000-0000-0000-0000-000000000001',
         'api', 'IntelliJ', 'Memory leak in WebSocket connection pool',
         'Connections not properly closed on client disconnect, causing OOM after 4 hours',
         'OutOfMemoryError: Java heap space\n  at ConnectionPool.acquire(ConnectionPool.java:89)',
         'src/ws/ConnectionPool.java', 89, 'high', 0.82, 'performance',
         'in_progress', 2, 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
         NOW() - INTERVAL '5 hours', NOW() - INTERVAL '3 hours'),

        ('d0000000-0000-0000-0000-000000000003', 'EBUG-1003', 'a0000000-0000-0000-0000-000000000001',
         'vscode', 'VS Code', 'CSS grid layout broken on Safari 17',
         'Dashboard grid items overlap on Safari due to unsupported gap property fallback',
         '', 'src/components/Dashboard.css', 45, 'medium', 0.55, 'ui',
         'triaged', 3, NULL, 'c0000000-0000-0000-0000-000000000002',
         NOW() - INTERVAL '1 day', NOW() - INTERVAL '12 hours'),

        ('d0000000-0000-0000-0000-000000000004', 'EBUG-1004', 'a0000000-0000-0000-0000-000000000001',
         'api', 'VS Code', 'Race condition in database migration runner',
         'Parallel deployments can cause duplicate schema operations',
         'ERROR: relation "users" already exists', 'infra/migrate.ts', 23, 'high', 0.78, 'infrastructure',
         'open', 2, 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
         NOW() - INTERVAL '6 hours', NOW() - INTERVAL '4 hours'),

        ('d0000000-0000-0000-0000-000000000005', 'EBUG-1005', 'a0000000-0000-0000-0000-000000000001',
         'vscode', 'VS Code', 'API rate limiter not resetting after window expires',
         'Rate limit counter persists beyond TTL window causing permanent 429 responses',
         '', 'src/middleware/rateLimiter.ts', 67, 'medium', 0.61, 'api',
         'resolved', 3, 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
         NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day'),

        ('d0000000-0000-0000-0000-000000000006', 'EBUG-1006', 'a0000000-0000-0000-0000-000000000001',
         'api', 'IntelliJ', 'Incorrect timezone conversion in analytics export',
         'CSV exports show UTC instead of user-configured timezone',
         '', 'src/services/AnalyticsExporter.java', 210, 'low', 0.35, 'data',
         'open', 4, NULL, 'c0000000-0000-0000-0000-000000000002',
         NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),

        ('d0000000-0000-0000-0000-000000000007', 'EBUG-1007', 'a0000000-0000-0000-0000-000000000001',
         'vscode', 'VS Code', 'Unhandled promise rejection in event bus',
         'Event listeners throwing errors crash the entire event loop',
         'UnhandledPromiseRejection: TypeError: Cannot read property of undefined\n  at EventBus.emit(EventBus.ts:34)',
         'src/core/EventBus.ts', 34, 'critical', 0.91, 'runtime',
         'open', 1, 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
         NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '15 minutes')
      ON CONFLICT (id) DO NOTHING;
    `);

    logger.info('Database migrations completed successfully');
  } catch (err) {
    logger.error({ err }, 'Database migration failed');
    throw err;
  }
}

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────

async function start() {
  await runMigrations();
  await initNats();

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'eBug API Gateway started');
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start API Gateway');
  process.exit(1);
});
