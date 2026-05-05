-- eBug Tracking — Database Initialization
-- This file runs on first `docker compose up`

-- ─────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- Organizations
-- ─────────────────────────────────────────────
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    oidc_provider TEXT,
    settings    JSONB DEFAULT '{}'::JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_subject    TEXT UNIQUE NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT,
    avatar_url      TEXT,
    org_id          UUID REFERENCES organizations(id),
    role            TEXT DEFAULT 'developer',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Teams
-- ─────────────────────────────────────────────
CREATE TABLE teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    org_id          UUID REFERENCES organizations(id),
    routing_rules   JSONB
);

-- ─────────────────────────────────────────────
-- Bug Reports — Single Source of Truth
-- ─────────────────────────────────────────────
CREATE TABLE bug_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     TEXT UNIQUE NOT NULL,
    
    -- Source metadata
    source_type     TEXT NOT NULL,
    source_ide      TEXT,
    source_plugin_version TEXT,
    
    -- Bug content
    title           TEXT NOT NULL,
    description     TEXT,
    stack_trace     TEXT,
    file_path       TEXT,
    line_number     INTEGER,
    code_snippet    TEXT,
    
    -- Classification (AI-populated)
    severity        TEXT CHECK (severity IN ('critical','high','medium','low','info')),
    severity_score  FLOAT,
    category        TEXT,
    root_cause_suggestion TEXT,
    
    -- Deduplication
    canonical_id    UUID REFERENCES bug_reports(id),
    is_duplicate    BOOLEAN DEFAULT FALSE,
    similarity_score FLOAT,
    embedding_id    TEXT,
    
    -- Assignment & workflow
    status          TEXT DEFAULT 'open'
                    CHECK (status IN ('open','triaged','in_progress','in_review','resolved','closed','wont_fix')),
    assignee_id     UUID REFERENCES users(id),
    team_id         UUID REFERENCES teams(id),
    priority        INTEGER DEFAULT 3,
    
    -- Environment
    runtime_env     JSONB,
    repo_url        TEXT,
    branch          TEXT,
    commit_sha      TEXT,
    
    -- Linked resources
    pr_urls         TEXT[],
    ci_run_ids      TEXT[],
    log_blob_keys   TEXT[],
    screenshot_keys TEXT[],
    
    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    sla_deadline    TIMESTAMPTZ,
    
    -- Audit
    created_by      UUID REFERENCES users(id),
    org_id          UUID REFERENCES organizations(id) NOT NULL
);

-- Performance indexes
CREATE INDEX idx_bug_status ON bug_reports(org_id, status);
CREATE INDEX idx_bug_assignee ON bug_reports(assignee_id, status);
CREATE INDEX idx_bug_severity ON bug_reports(org_id, severity, created_at DESC);
CREATE INDEX idx_bug_canonical ON bug_reports(canonical_id) WHERE is_duplicate = TRUE;
CREATE INDEX idx_bug_created ON bug_reports(org_id, created_at DESC);
CREATE INDEX idx_bug_file ON bug_reports(org_id, file_path);

-- ─────────────────────────────────────────────
-- Activity Log — Immutable Audit Trail
-- ─────────────────────────────────────────────
CREATE TABLE bug_activity (
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

CREATE INDEX idx_activity_bug ON bug_activity(bug_id, created_at DESC);

-- ─────────────────────────────────────────────
-- Sequence Counter for External IDs
-- ─────────────────────────────────────────────
CREATE SEQUENCE bug_external_id_seq START 1;

-- ─────────────────────────────────────────────
-- Seed Data (Development)
-- ─────────────────────────────────────────────
INSERT INTO organizations (id, name, slug) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'eBug Labs', 'ebug-labs');

INSERT INTO users (id, oidc_subject, email, display_name, org_id, role) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'dev|admin', 'admin@ebug.dev', 'Admin User', 'a0000000-0000-0000-0000-000000000001', 'admin'),
    ('b0000000-0000-0000-0000-000000000002', 'dev|dev1', 'dev1@ebug.dev', 'Developer One', 'a0000000-0000-0000-0000-000000000001', 'developer');

INSERT INTO teams (id, name, org_id) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Core Platform', 'a0000000-0000-0000-0000-000000000001'),
    ('c0000000-0000-0000-0000-000000000002', 'Frontend', 'a0000000-0000-0000-0000-000000000001');
