import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import {
  WsHealthTracker,
  installWsEmitHook,
  startWsWatchdog,
  loadWsWatchdogConfig,
  getSdkPingIntervalMs,
  type WatchedSocket,
} from '../src/feishu/ws-watchdog.js';

class FakeSocket implements WatchedSocket {
  readyState = 1;
  terminateCount = 0;
  constructor(public url: string = 'wss://msg-frontier.feishu.cn/ws/v2') {}
  terminate(): void {
    this.terminateCount += 1;
    this.readyState = 3;
  }
}

const STALE = 300_000;
const GRACE = 600_000;

describe('WsHealthTracker', () => {
  it('ignores server-side sockets (no url)', () => {
    const tracker = new WsHealthTracker();
    const inbound = new FakeSocket('');
    inbound.url = undefined;
    tracker.note(inbound, 'message', 1000);
    expect(tracker.connectionCount).toBe(0);
    expect(tracker.sweep(10_000_000, STALE, GRACE)).toEqual([]);
  });

  it('ignores non-liveness events on unseen sockets', () => {
    const tracker = new WsHealthTracker();
    const ws = new FakeSocket();
    tracker.note(ws, 'error', 1000);
    tracker.note(ws, 'upgrade', 1000);
    expect(tracker.connectionCount).toBe(0);
  });

  it('does not fire on fresh connections', () => {
    const tracker = new WsHealthTracker();
    const ws = new FakeSocket();
    tracker.note(ws, 'open', 0);
    expect(tracker.sweep(200_000, STALE, GRACE)).toEqual([]);
  });

  it('refreshes liveness on inbound frames', () => {
    const tracker = new WsHealthTracker();
    const ws = new FakeSocket();
    tracker.note(ws, 'open', 0);
    tracker.note(ws, 'message', 250_000);
    // 100s since last inbound — still fresh
    expect(tracker.sweep(350_000, STALE, GRACE)).toEqual([]);
  });

  it('terminates a stale OPEN connection once, then waits', () => {
    const tracker = new WsHealthTracker();
    const ws = new FakeSocket();
    tracker.note(ws, 'open', 0);

    const actions = tracker.sweep(400_000, STALE, GRACE);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe('terminate');
    ws.terminate();
    expect(ws.terminateCount).toBe(1);

    // Simulate the SDK not cleaning up: socket still present as OPEN zombie via a
    // second fake socket that is stale — verify repeat-terminate only after staleMs.
    const ws2 = new FakeSocket();
    tracker.note(ws2, 'message', 0);
    const a1 = tracker.sweep(400_000, STALE, GRACE);
    expect(a1.filter((a) => a.type === 'terminate')).toHaveLength(1);
    const a2 = tracker.sweep(500_000, STALE, GRACE);
    expect(a2.filter((a) => a.type === 'terminate')).toHaveLength(0); // within grace window
    const a3 = tracker.sweep(800_000, STALE, GRACE);
    expect(a3.filter((a) => a.type === 'terminate')).toHaveLength(1); // re-attempt allowed
  });

  it('removes sockets on close event and by CLOSED readyState', () => {
    const tracker = new WsHealthTracker();
    const ws = new FakeSocket();
    tracker.note(ws, 'open', 0);
    expect(tracker.connectionCount).toBe(1);
    tracker.note(ws, 'close', 10);
    expect(tracker.connectionCount).toBe(0);

    const ws2 = new FakeSocket();
    tracker.note(ws2, 'open', 0);
    ws2.readyState = 3;
    tracker.sweep(10, STALE, GRACE);
    expect(tracker.connectionCount).toBe(0);
  });

  it('escalates to fatal when nothing becomes healthy within grace', () => {
    const tracker = new WsHealthTracker();
    const ws = new FakeSocket();
    tracker.note(ws, 'open', 0);

    // connection dies for real (close event) — no tracked sockets, no reconnect
    ws.readyState = 3;
    tracker.note(ws, 'close', 1_000);

    // still within grace → no fatal
    expect(tracker.sweep(100_000, STALE, GRACE).find((a) => a.type === 'fatal')).toBeUndefined();
    // past grace since last healthy (t=0) → fatal
    const actions = tracker.sweep(GRACE + 1, STALE, GRACE);
    const fatal = actions.find((a) => a.type === 'fatal');
    expect(fatal).toBeDefined();
    expect((fatal as { reason: string }).reason).toContain('no healthy Feishu WS');
  });

  it('recovers silently when the SDK reconnects before grace', () => {
    const tracker = new WsHealthTracker();
    const ws = new FakeSocket();
    tracker.note(ws, 'open', 0);
    tracker.note(ws, 'close', 1_000);

    const ws2 = new FakeSocket();
    tracker.note(ws2, 'open', 50_000);
    tracker.note(ws2, 'message', 60_000);

    expect(tracker.sweep(70_000, STALE, GRACE).find((a) => a.type === 'fatal')).toBeUndefined();
    // Past stale window ws2 itself gets a terminate — but no fatal: healthy was seen.
    const final = tracker.sweep(GRACE + 1, STALE, GRACE);
    expect(final.find((a) => a.type === 'fatal')).toBeUndefined();
    expect(final.find((a) => a.type === 'terminate')?.type).toBe('terminate');
  });

  it('never declares fatal for bots that never connected', () => {
    const tracker = new WsHealthTracker();
    // Only failed-connection noise — nothing liveness-related tracked.
    expect(tracker.sweep(10 * STALE, STALE, GRACE)).toEqual([]);
  });
});

describe('installWsEmitHook', () => {
  it('observes events, passes through args/return, and restores', () => {
    const seen: Array<[string, unknown]> = [];
    const emitter = {
      emit(event: string | symbol, ...args: unknown[]) {
        seen.push([String(event), args[0]]);
        return true;
      },
    };
    const onEvent = (ws: WatchedSocket, event: string) => {
      if (event === 'nope') throw new Error('watchdog bug');
    };
    const restoredEvents: string[] = [];
    const restore = installWsEmitHook(
      emitter as { emit?: (e: string | symbol, ...a: unknown[]) => boolean },
      (ws, event) => {
        restoredEvents.push(event);
        onEvent(ws, event);
      },
    );

    expect(emitter.emit('message', 'hello')).toBe(true);
    expect(seen).toEqual([['message', 'hello']]);
    expect(restoredEvents).toEqual(['message']);
    // onEvent throwing must not break delivery — verified above by 'nope' path below
    expect(emitter.emit('nope')).toBe(true);

    restore();
    restoredEvents.length = 0;
    emitter.emit('after', 1);
    expect(restoredEvents).toEqual([]);
  });

  it('no-op when target has no emit', () => {
    const target: Record<string, unknown> = {};
    const restore = installWsEmitHook(target as { emit?: never }, () => {});
    restore();
    expect(Object.keys(target)).toEqual([]);
  });
});

describe('getSdkPingIntervalMs', () => {
  it('reads pingInterval from SDK-private wsConfig', () => {
    const clients = [
      { wsConfig: { getWS: () => ({ pingInterval: 120_000 }) } },
      { wsConfig: { getWS: () => ({ pingInterval: 90_000 }) } },
    ];
    expect(getSdkPingIntervalMs(clients)).toBe(120_000);
  });

  it('returns undefined for unexpected shapes', () => {
    expect(getSdkPingIntervalMs([{}, null, { wsConfig: {} }])).toBeUndefined();
  });
});

describe('loadWsWatchdogConfig', () => {
  it('applies defaults', () => {
    expect(loadWsWatchdogConfig({})).toEqual({
      enabled: true,
      checkIntervalMs: 60_000,
      staleMs: 300_000,
      restartGraceMs: 600_000,
    });
  });

  it('respects overrides and disable flag, ignores garbage', () => {
    const cfg = loadWsWatchdogConfig({
      WS_WATCHDOG_ENABLED: 'false',
      WS_WATCHDOG_CHECK_INTERVAL_MS: '15000',
      WS_WATCHDOG_STALE_MS: 'abc',
      WS_WATCHDOG_RESTART_GRACE_MS: '-5',
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.checkIntervalMs).toBe(15_000);
    expect(cfg.staleMs).toBe(300_000);
    expect(cfg.restartGraceMs).toBe(600_000);
  });
});

describe('startWsWatchdog (integration with real ws)', () => {
  let server: WebSocketServer | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('terminates a real stale outbound socket and ignores closed ones', async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => server!.once('listening', resolve));
    const port = (server!.address() as AddressInfo).port;

    const tracker = new WsHealthTracker();
    const restore = installWsEmitHook(WebSocket.prototype as unknown as { emit?: never }, (ws, event) =>
      tracker.note(ws, event, Date.now()),
    );

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });

      // The hook captured the real client socket (has url), not the server-side one.
      expect(tracker.connectionCount).toBe(1);

      // Force staleness with a past clock: tracker saw 'open' ~now, so sweep now+stale+1
      const actions = tracker.sweep(Date.now() + STALE + 1, STALE, GRACE);
      expect(actions.filter((a) => a.type === 'terminate')).toHaveLength(1);

      ws.terminate();
      await new Promise((resolve) => ws.once('close', resolve));
      const after = tracker.sweep(Date.now() + STALE + 2, STALE, GRACE);
      // socket gone; fatal not yet (last healthy recent-ish relative to grace if within)
      expect(after.find((a) => a.type === 'terminate')).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('watchdog handle starts and stops cleanly with a stub logger', () => {
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      info: (obj: unknown, msg?: string) => logs.push({ level: 'info', msg: String(msg ?? JSON.stringify(obj)) }),
      warn: (obj: unknown, msg?: string) => logs.push({ level: 'warn', msg: String(msg ?? JSON.stringify(obj)) }),
      error: (obj: unknown, msg?: string) => logs.push({ level: 'error', msg: String(msg ?? JSON.stringify(obj)) }),
      child: () => logger,
    } as never;

    let fatalReason: string | undefined;
    const handle = startWsWatchdog({
      checkIntervalMs: 10,
      staleMs: 50,
      restartGraceMs: 80,
      logger,
      onFatal: (reason) => {
        fatalReason = reason;
      },
    });
    // No connections ever appeared and none were tracked pre-exit: with the hook
    // installed but idle, sweep must be a no-op (never connected → never fatal).
    return new Promise<void>((resolve) => setTimeout(() => resolve(), 120)).then(() => {
      handle.stop();
      expect(fatalReason).toBeUndefined();
      expect(logs.some((l) => l.msg.includes('watchdog started'))).toBe(true);
    });
  });
});
