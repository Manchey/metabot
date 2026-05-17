import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ActivityStore } from '../src/api/activity-store.js';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: () => createLogger() } as any;
}

describe('ActivityStore.getSummary', () => {
  let store: ActivityStore;
  let originalDir: string;
  let tmpDir: string;

  beforeEach(() => {
    // Use a temp directory for the test database
    originalDir = process.env.SESSION_STORE_DIR;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-test-'));
    process.env.SESSION_STORE_DIR = tmpDir;
    store = new ActivityStore(createLogger());
  });

  afterEach(() => {
    store?.close();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    if (originalDir) {
      process.env.SESSION_STORE_DIR = originalDir;
    } else {
      delete process.env.SESSION_STORE_DIR;
    }
  });

  it('returns empty summary when no events exist', () => {
    const summary = store.getSummary({ since: Date.now() - 24 * 60 * 60 * 1000 });
    expect(summary.totalTasks).toBe(0);
    expect(summary.completedTasks).toBe(0);
    expect(summary.failedTasks).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.users).toHaveLength(0);
  });

  it('aggregates activity by user', () => {
    const now = Date.now();

    // User A: 2 completed tasks
    store.record({ type: 'task_started', botName: 'test', chatId: 'c1', userId: 'user_a', prompt: 'Hello', timestamp: now - 1000 });
    store.record({ type: 'task_completed', botName: 'test', chatId: 'c1', userId: 'user_a', costUsd: 0.05, durationMs: 5000, timestamp: now - 500 });
    store.record({ type: 'task_started', botName: 'test', chatId: 'c2', userId: 'user_a', prompt: 'Second prompt', timestamp: now - 300 });
    store.record({ type: 'task_completed', botName: 'test', chatId: 'c2', userId: 'user_a', costUsd: 0.03, durationMs: 3000, timestamp: now - 100 });

    // User B: 1 failed task
    store.record({ type: 'task_started', botName: 'test', chatId: 'c3', userId: 'user_b', prompt: 'Bad query', timestamp: now - 200 });
    store.record({ type: 'task_failed', botName: 'test', chatId: 'c3', userId: 'user_b', errorMessage: 'Error', timestamp: now - 50 });

    const summary = store.getSummary({ since: now - 2000 });

    expect(summary.totalTasks).toBe(6); // all events
    expect(summary.completedTasks).toBe(2);
    expect(summary.failedTasks).toBe(1);
    expect(summary.totalCostUsd).toBeCloseTo(0.08, 2);
    expect(summary.users).toHaveLength(2);

    // Most recent user first (user_b has the latest timestamp)
    const userB = summary.users.find(u => u.userId === 'user_b');
    expect(userB).toBeDefined();
    expect(userB!.taskCount).toBe(2); // started + failed
    expect(userB!.completedCount).toBe(0);
    expect(userB!.failedCount).toBe(1);
    expect(userB!.lastPrompt).toBe('Bad query');

    const userA = summary.users.find(u => u.userId === 'user_a');
    expect(userA).toBeDefined();
    expect(userA!.taskCount).toBe(4); // 2 started + 2 completed
    expect(userA!.completedCount).toBe(2);
    expect(userA!.totalCostUsd).toBeCloseTo(0.08, 2);
    expect(userA!.lastPrompt).toBe('Second prompt');
  });

  it('filters by bot name', () => {
    const now = Date.now();

    store.record({ type: 'task_started', botName: 'bot_a', chatId: 'c1', userId: 'user1', prompt: 'Hello', timestamp: now });
    store.record({ type: 'task_completed', botName: 'bot_a', chatId: 'c1', userId: 'user1', costUsd: 0.01, timestamp: now + 100 });
    store.record({ type: 'task_started', botName: 'bot_b', chatId: 'c2', userId: 'user2', prompt: 'Other', timestamp: now + 200 });
    store.record({ type: 'task_completed', botName: 'bot_b', chatId: 'c2', userId: 'user2', costUsd: 0.02, timestamp: now + 300 });

    const summaryA = store.getSummary({ botName: 'bot_a', since: now - 1000 });
    expect(summaryA.totalTasks).toBe(2);
    expect(summaryA.totalCostUsd).toBeCloseTo(0.01, 2);
    expect(summaryA.users).toHaveLength(1);

    const summaryB = store.getSummary({ botName: 'bot_b', since: now - 1000 });
    expect(summaryB.totalTasks).toBe(2);
    expect(summaryB.totalCostUsd).toBeCloseTo(0.02, 2);
  });

  it('filters by time range', () => {
    const now = Date.now();

    // Old event (outside 1-hour window)
    store.record({ type: 'task_started', botName: 'test', chatId: 'c1', userId: 'user1', prompt: 'Old', timestamp: now - 2 * 60 * 60 * 1000 });
    store.record({ type: 'task_completed', botName: 'test', chatId: 'c1', userId: 'user1', costUsd: 0.01, timestamp: now - 2 * 60 * 60 * 1000 + 100 });

    // Recent event (within 1-hour window)
    store.record({ type: 'task_started', botName: 'test', chatId: 'c2', userId: 'user2', prompt: 'Recent', timestamp: now - 30 * 60 * 1000 });
    store.record({ type: 'task_completed', botName: 'test', chatId: 'c2', userId: 'user2', costUsd: 0.02, timestamp: now - 30 * 60 * 1000 + 100 });

    const summary1h = store.getSummary({ since: now - 60 * 60 * 1000 });
    expect(summary1h.totalTasks).toBe(2); // only recent events
    expect(summary1h.totalCostUsd).toBeCloseTo(0.02, 2);
    expect(summary1h.users).toHaveLength(1);
    expect(summary1h.users[0].userId).toBe('user2');

    const summary3h = store.getSummary({ since: now - 3 * 60 * 60 * 1000 });
    expect(summary3h.totalTasks).toBe(4); // all events
    expect(summary3h.totalCostUsd).toBeCloseTo(0.03, 2);
  });
});