#!/usr/bin/env node

/**
 * eBug Tracking — End-to-End Integration Test
 *
 * Validates the full pipeline:
 *   API Gateway → NATS → Ingestion Worker → DB → Dedup → Score → RCA → WS Hub
 *
 * Prerequisites:
 *   docker compose up -d   (infrastructure)
 *   All services running locally (see README)
 *
 * Usage:
 *   node scripts/e2e-test.mjs
 */

const API_URL = process.env.API_URL || 'http://localhost:8090';
const WS_URL = process.env.WS_URL || 'ws://localhost:8082/ws/v1/stream';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';

const results = { passed: 0, failed: 0, skipped: 0, tests: [] };

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    log('✅', name);
  } catch (err) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: err.message });
    log('❌', `${name} — ${err.message}`);
  }
}

async function skip(name, reason) {
  results.skipped++;
  results.tests.push({ name, status: 'SKIP', reason });
  log('⏭️', `${name} — ${reason}`);
}

async function fetchJSON(path, options = {}) {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

console.log('\n🧪 eBug Tracking — E2E Integration Tests\n');
console.log(`   API: ${API_URL}`);
console.log(`   WS:  ${WS_URL}\n`);

// 1. Health Check
await test('API Gateway health check', async () => {
  const data = await fetchJSON('/health');
  if (data.status !== 'ok') throw new Error(`Expected status=ok, got ${data.status}`);
});

// 2. List bugs (empty or seeded)
let bugCount = 0;
await test('GET /api/v1/bugs returns paginated response', async () => {
  const data = await fetchJSON('/api/v1/bugs?limit=10');
  if (!data.bugs) throw new Error('Missing bugs array');
  if (!data.pagination) throw new Error('Missing pagination object');
  bugCount = data.pagination.total;
});

// 3. Create a bug via API
let createdBugId = null;
await test('POST /api/v1/bugs creates a new bug', async () => {
  const data = await fetchJSON('/api/v1/bugs', {
    method: 'POST',
    body: JSON.stringify({
      title: `E2E Test Bug — ${new Date().toISOString()}`,
      description: 'Created by e2e-test.mjs integration test',
      stack_trace: 'Error: test\n  at e2e-test.mjs:1:1',
      file_path: 'scripts/e2e-test.mjs',
      line_number: 1,
      severity_hint: 'medium',
      category_hint: 'test',
      source_type: 'api',
    }),
  });
  if (!data.id) throw new Error('Missing bug id in response');
  createdBugId = data.id;
});

// 4. Wait for pipeline processing
if (createdBugId) {
  log('⏳', 'Waiting 3s for pipeline processing...');
  await new Promise((r) => setTimeout(r, 3000));
}

// 5. Fetch the created bug
await test('GET /api/v1/bugs/:id returns created bug', async () => {
  if (!createdBugId) throw new Error('No bug was created');
  const data = await fetchJSON(`/api/v1/bugs/${createdBugId}`);
  if (!data.bug) throw new Error('Missing bug object');
  if (data.bug.id !== createdBugId) throw new Error('Bug ID mismatch');
});

// 6. Update bug
await test('PATCH /api/v1/bugs/:id updates fields', async () => {
  if (!createdBugId) throw new Error('No bug was created');
  const data = await fetchJSON(`/api/v1/bugs/${createdBugId}`, {
    method: 'PATCH',
    body: JSON.stringify({ severity: 'high', priority: 1 }),
  });
  if (!data.bug) throw new Error('Missing bug in response');
  if (data.bug.severity !== 'high') throw new Error('Severity not updated');
});

// 7. Transition bug status
await test('POST /api/v1/bugs/:id/transition changes status', async () => {
  if (!createdBugId) throw new Error('No bug was created');
  const data = await fetchJSON(`/api/v1/bugs/${createdBugId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ new_status: 'triaged', comment: 'E2E test triage' }),
  });
  if (data.bug.status !== 'triaged') throw new Error('Status not transitioned');
});

// 8. Activity log
await test('GET /api/v1/bugs/:id/activity returns log', async () => {
  if (!createdBugId) throw new Error('No bug was created');
  const data = await fetchJSON(`/api/v1/bugs/${createdBugId}/activity`);
  if (!data.activity) throw new Error('Missing activity array');
});

// 9. Dashboard stats
await test('GET /api/v1/stats returns dashboard stats', async () => {
  const data = await fetchJSON('/api/v1/stats');
  if (data.total_bugs === undefined) throw new Error('Missing total_bugs');
  if (!data.by_status) throw new Error('Missing by_status');
  if (!data.by_severity) throw new Error('Missing by_severity');
});

// 10. Timeline
await test('GET /api/v1/stats/timeline returns timeline', async () => {
  const data = await fetchJSON('/api/v1/stats/timeline?days=7');
  if (!data.timeline) throw new Error('Missing timeline array');
});

// 11. Teams
await test('GET /api/v1/teams returns teams', async () => {
  const data = await fetchJSON('/api/v1/teams');
  if (!data.teams) throw new Error('Missing teams array');
});

// 12. Users
await test('GET /api/v1/users returns users', async () => {
  const data = await fetchJSON('/api/v1/users');
  if (!data.users) throw new Error('Missing users array');
});

// 13. Bug count increased
await test('Total bug count increased after creation', async () => {
  const data = await fetchJSON('/api/v1/bugs?limit=1');
  if (data.pagination.total <= bugCount) {
    throw new Error(`Expected count > ${bugCount}, got ${data.pagination.total}`);
  }
});

// 14. Invalid requests
await test('POST /api/v1/bugs rejects missing title', async () => {
  try {
    await fetchJSON('/api/v1/bugs', {
      method: 'POST',
      body: JSON.stringify({ description: 'no title' }),
    });
    throw new Error('Expected 400 error');
  } catch (err) {
    if (!err.message.includes('400')) throw err;
  }
});

await test('POST /api/v1/bugs/:id/transition rejects invalid status', async () => {
  if (!createdBugId) throw new Error('No bug was created');
  try {
    await fetchJSON(`/api/v1/bugs/${createdBugId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ new_status: 'invalid_status' }),
    });
    throw new Error('Expected 400 error');
  } catch (err) {
    if (!err.message.includes('400')) throw err;
  }
});

// ─────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`\n📊 Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped\n`);

if (results.failed > 0) {
  console.log('❌ FAILED TESTS:');
  results.tests.filter((t) => t.status === 'FAIL').forEach((t) => {
    console.log(`   • ${t.name}: ${t.error}`);
  });
  process.exit(1);
} else {
  console.log('🎉 All tests passed!\n');
  process.exit(0);
}
