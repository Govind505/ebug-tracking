/**
 * API Gateway — Unit Tests
 */

import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';

const API_BASE = process.env.API_URL ?? 'http://localhost:8090';

describe('API Gateway', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const resp = await fetch(`${API_BASE}/health`);
      assert.strictEqual(resp.status, 200);
      const data = await resp.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.service, 'api-gateway');
      assert.ok(data.timestamp);
    });
  });

  describe('GET /api/v1/bugs', () => {
    it('should return paginated bug list', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs`, {
        headers: { 'Authorization': 'Bearer dev-token' },
      });
      assert.strictEqual(resp.status, 200);
      const data = await resp.json();
      assert.ok(Array.isArray(data.bugs));
      assert.ok(data.pagination);
      assert.ok(typeof data.pagination.total === 'number');
      assert.ok(typeof data.pagination.page === 'number');
    });

    it('should support status filtering', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs?status=open`, {
        headers: { 'Authorization': 'Bearer dev-token' },
      });
      assert.strictEqual(resp.status, 200);
      const data = await resp.json();
      assert.ok(Array.isArray(data.bugs));
    });

    it('should support severity filtering', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs?severity=critical,high`, {
        headers: { 'Authorization': 'Bearer dev-token' },
      });
      assert.strictEqual(resp.status, 200);
    });

    it('should support pagination', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs?page=1&limit=10`, {
        headers: { 'Authorization': 'Bearer dev-token' },
      });
      assert.strictEqual(resp.status, 200);
      const data = await resp.json();
      assert.ok(data.pagination.limit <= 10);
    });
  });

  describe('POST /api/v1/bugs', () => {
    it('should create a new bug', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer dev-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Bug from unit tests',
          description: 'Automated test bug',
          severity_hint: 'low',
          source_type: 'test',
        }),
      });
      assert.strictEqual(resp.status, 201);
      const data = await resp.json();
      assert.ok(data.id);
      assert.strictEqual(data.status, 'submitted');
    });

    it('should reject bug without title', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer dev-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: 'No title' }),
      });
      assert.strictEqual(resp.status, 400);
    });
  });

  describe('GET /api/v1/stats', () => {
    it('should return dashboard statistics', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/stats`, {
        headers: { 'Authorization': 'Bearer dev-token' },
      });
      assert.strictEqual(resp.status, 200);
      const data = await resp.json();
      assert.ok(typeof data.total_bugs === 'number');
      assert.ok(typeof data.by_status === 'object');
      assert.ok(typeof data.by_severity === 'object');
    });
  });

  describe('Authentication', () => {
    it('should allow dev-token in dev mode', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs`, {
        headers: { 'Authorization': 'Bearer dev-token' },
      });
      assert.strictEqual(resp.status, 200);
    });

    it('should allow requests without auth in dev mode', async () => {
      const resp = await fetch(`${API_BASE}/api/v1/bugs`);
      assert.strictEqual(resp.status, 200);
    });
  });
});
