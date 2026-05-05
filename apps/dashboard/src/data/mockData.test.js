import { describe, it, expect } from 'vitest';
import { MOCK_BUGS, MOCK_TEAMS, MOCK_USERS, MOCK_ACTIVITY } from './mockData';

describe('Mock Data', () => {
  it('should have bug reports', () => {
    expect(MOCK_BUGS.length).toBeGreaterThan(0);
  });

  it('each bug should have required fields', () => {
    for (const bug of MOCK_BUGS) {
      expect(bug.id).toBeDefined();
      expect(bug.title).toBeDefined();
      expect(bug.severity).toBeDefined();
      expect(bug.status).toBeDefined();
      expect(['critical', 'high', 'medium', 'low', 'info']).toContain(bug.severity);
    }
  });

  it('should have teams', () => {
    expect(MOCK_TEAMS.length).toBeGreaterThan(0);
  });

  it('should have users', () => {
    expect(MOCK_USERS.length).toBeGreaterThan(0);
  });

  it('should have activity entries', () => {
    expect(MOCK_ACTIVITY.length).toBeGreaterThan(0);
  });
});
