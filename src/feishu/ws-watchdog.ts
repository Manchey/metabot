import { WebSocket } from 'ws';
import type { Logger } from '../utils/logger.js';

/**
 * Liveness watchdog for the Feishu long-connection (WebSocket) clients.
 *
 * Background: the Lark SDK's WSClient sends an application-level ping every
 * ~120s but never checks whether the pong comes back. When the connection
 * goes half-dead (socket stays ESTABLISHED, data stops being consumed or
 * frames stop arriving), the SDK happily keeps the zombie connection and the
 * bot silently stops receiving messages. This watchdog observes every
 * inbound WebSocket frame at the `ws` library level (by hooking
 * `WebSocket.prototype.emit`) and:
 *
 *   1. terminates a stale outbound connection so the SDK's own `close`
 *      handler reconnects it (self-heal, no restart);
 *   2. exits the process when NO connection has been healthy within a grace
 *      period, letting systemd (`Restart=always`) bring the whole service
 *      back (last resort).
 *
 * Only outbound clients (sockets with a `url`, i.e. created via
 * `new WebSocket(url)`) are tracked; server-side sockets for inbound
 * upgrades (the Web UI `/ws`) are ignored — their idleness is normal.
 */

const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Events proving the connection still receives data from the gateway. */
const LIVENESS_EVENTS = new Set(['open', 'message', 'ping', 'pong']);

/** Minimal shape of a `ws.WebSocket` the watchdog needs (fake-able in tests). */
export interface WatchedSocket {
  readonly readyState: number;
  readonly url?: string;
  terminate(): void;
}

export type WatchdogAction =
  | { type: 'terminate'; ws: WatchedSocket; silentMs: number }
  | { type: 'fatal'; reason: string };

interface SocketState {
  lastInboundAt: number;
  terminatedAt?: number;
}

/**
 * Pure state machine: records inbound-frame timestamps per outbound socket
 * and decides on heal actions. All time-dependent methods take an explicit
 * `now` so tests can drive the clock.
 */
export class WsHealthTracker {
  private readonly sockets = new Map<WatchedSocket, SocketState>();
  private lastHealthyAt?: number;

  /** Feed a WS event (captured by the emit hook). */
  note(ws: WatchedSocket, event: string, now: number): void {
    // Ignore server-side sockets (inbound upgrades, no url) and non-liveness
    // events: a never-connected client is retried by the SDK itself and must
    // not make us restart-loop the process.
    if (!ws.url) return;
    if (event === 'close') {
      this.sockets.delete(ws);
      return;
    }
    if (!LIVENESS_EVENTS.has(event)) return;

    const st = this.sockets.get(ws);
    if (st) {
      st.lastInboundAt = now;
      return;
    }
    this.sockets.set(ws, { lastInboundAt: now });
    if (this.lastHealthyAt === undefined) this.lastHealthyAt = now;
  }

  /** Evaluate all tracked sockets. Returns actions for the caller to execute. */
  sweep(now: number, staleMs: number, restartGraceMs: number): WatchdogAction[] {
    const actions: WatchdogAction[] = [];
    let healthy = false;
    let staleOpen = 0;

    for (const [ws, st] of this.sockets) {
      if (ws.readyState !== WS_OPEN) {
        if (ws.readyState === WS_CLOSED) this.sockets.delete(ws);
        continue;
      }
      const silentMs = now - st.lastInboundAt;
      if (silentMs <= staleMs) {
        healthy = true;
        continue;
      }
      staleOpen += 1;
      // Already terminated and waiting for the SDK to reconnect — don't hammer.
      if (st.terminatedAt !== undefined && now - st.terminatedAt < staleMs) continue;
      st.terminatedAt = now;
      actions.push({ type: 'terminate', ws, silentMs });
    }

    if (healthy) {
      this.lastHealthyAt = now;
      return actions;
    }

    if (this.lastHealthyAt !== undefined && now - this.lastHealthyAt >= restartGraceMs) {
      actions.push({
        type: 'fatal',
        reason:
          `no healthy Feishu WS connection for ${Math.round((now - this.lastHealthyAt) / 1000)}s ` +
          `(tracked=${this.sockets.size}, staleOpen=${staleOpen})`,
      });
    }
    return actions;
  }

  get connectionCount(): number {
    return this.sockets.size;
  }
}

type EmitLike = (event: string | symbol, ...args: any[]) => boolean;

/**
 * Shadow `emit` on the given target (normally `WebSocket.prototype`) so every
 * event on every instance is observed. `ws@8` funnels all client lifecycle
 * and data events through EventEmitter.emit, and the Lark SDK and our app
 * share the same hoisted `ws` copy, so this captures SDK connections without
 * touching SDK internals. Returns a restore function.
 */
export function installWsEmitHook(
  target: { emit?: EmitLike },
  onEvent: (ws: WatchedSocket, event: string) => void,
): () => void {
  const original = target.emit;
  if (!original) return () => {};
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'emit');
  let active = true;

  target.emit = function (this: WatchedSocket, event: string | symbol, ...args: any[]): boolean {
    if (active && typeof event === 'string') {
      try {
        onEvent(this, event);
      } catch {
        // The watchdog must never break event delivery.
      }
    }
    return original.call(this as any, event, ...args);
  } as EmitLike;

  return () => {
    active = false;
    if (hadOwn) {
      target.emit = original;
    } else {
      delete (target as { emit?: EmitLike }).emit;
    }
  };
}

export interface WsWatchdogOptions {
  checkIntervalMs: number;
  staleMs: number;
  restartGraceMs: number;
  logger: Logger;
  /**
   * Returns the current negotiated ping interval (ms) from the Lark SDK
   * clients, if readable. The stale threshold is at least 3 missed pings +
   * 30s, so a server-tuned longer interval never false-positives.
   */
  getPingIntervalMs?: () => number | undefined;
  /** Injectable for tests; defaults to process.exit(1) (systemd restarts us). */
  onFatal?: (reason: string) => void;
}

export interface WsWatchdogHandle {
  stop(): void;
}

export function startWsWatchdog(opts: WsWatchdogOptions): WsWatchdogHandle {
  const { logger, checkIntervalMs, restartGraceMs } = opts;
  const tracker = new WsHealthTracker();
  const onFatal =
    opts.onFatal ??
    (() => {
      process.exit(1);
    });

  const restore = installWsEmitHook(WebSocket.prototype as unknown as { emit?: EmitLike }, (ws, event) =>
    tracker.note(ws, event, Date.now()),
  );

  logger.info({ checkIntervalMs, staleMsFloor: opts.staleMs, restartGraceMs }, 'Feishu WS watchdog started');

  const timer = setInterval(() => {
    const now = Date.now();
    const pingMs = opts.getPingIntervalMs?.() ?? 0;
    const staleMs = pingMs > 0 ? Math.max(opts.staleMs, pingMs * 3 + 30_000) : opts.staleMs;

    for (const action of tracker.sweep(now, staleMs, restartGraceMs)) {
      if (action.type === 'terminate') {
        logger.warn(
          { silentMs: action.silentMs, staleMs },
          'WS watchdog: stale Feishu WS connection (no inbound frames) — terminating it so the SDK reconnects',
        );
        try {
          action.ws.terminate();
        } catch (err) {
          logger.warn({ err }, 'WS watchdog: terminate() failed');
        }
      } else {
        logger.error(
          { reason: action.reason, restartGraceMs },
          'WS watchdog: Feishu WS unrecoverable — exiting so systemd restarts the service',
        );
        onFatal(action.reason);
      }
    }
  }, checkIntervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
      restore();
    },
  };
}

export interface WsWatchdogEnvConfig {
  enabled: boolean;
  checkIntervalMs: number;
  staleMs: number;
  restartGraceMs: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Best-effort read of the negotiated ping interval from Lark WSClient
 * instances. Reaches into SDK-private fields (wsConfig.getWS) — degrade to
 * undefined if the internals ever change shape.
 */
export function getSdkPingIntervalMs(wsClients: unknown[]): number | undefined {
  let max = 0;
  for (const client of wsClients) {
    try {
      const wsConfig: any = (client as any)?.wsConfig;
      const cfg = typeof wsConfig?.getWS === 'function' ? wsConfig.getWS() : undefined;
      const ping = cfg?.pingInterval;
      if (typeof ping === 'number' && Number.isFinite(ping) && ping > max) max = ping;
    } catch {
      // Private SDK internals — ignore.
    }
  }
  return max > 0 ? max : undefined;
}

export function loadWsWatchdogConfig(env: NodeJS.ProcessEnv = process.env): WsWatchdogEnvConfig {
  return {
    enabled: env.WS_WATCHDOG_ENABLED !== 'false',
    checkIntervalMs: positiveInt(env.WS_WATCHDOG_CHECK_INTERVAL_MS, 60_000),
    staleMs: positiveInt(env.WS_WATCHDOG_STALE_MS, 300_000),
    restartGraceMs: positiveInt(env.WS_WATCHDOG_RESTART_GRACE_MS, 600_000),
  };
}
