export const DEFAULT_FEISHU_WS_PING_TIMEOUT_SEC = 20;
export const DEFAULT_FEISHU_WS_HANDSHAKE_TIMEOUT_MS = 15_000;

const MIN_PING_TIMEOUT_SEC = 5;
const MAX_PING_TIMEOUT_SEC = 300;
const MIN_HANDSHAKE_TIMEOUT_MS = 1_000;
const MAX_HANDSHAKE_TIMEOUT_MS = 120_000;

export interface FeishuWsRecoveryOptions {
  autoReconnect: true;
  handshakeTimeoutMs: number;
  wsConfig: { pingTimeout: number };
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

/**
 * Enable the liveness controls provided by the public Feishu/Lark SDK.
 * A pong watchdog terminates half-open sockets after a network switch, while
 * the handshake timeout prevents reconnects waiting forever on a stale path.
 */
export function resolveFeishuWsRecoveryOptions(env: NodeJS.ProcessEnv = process.env): FeishuWsRecoveryOptions {
  return {
    autoReconnect: true,
    handshakeTimeoutMs: boundedInteger(
      env.METABOT_FEISHU_WS_HANDSHAKE_TIMEOUT_MS,
      DEFAULT_FEISHU_WS_HANDSHAKE_TIMEOUT_MS,
      MIN_HANDSHAKE_TIMEOUT_MS,
      MAX_HANDSHAKE_TIMEOUT_MS,
    ),
    wsConfig: {
      pingTimeout: boundedInteger(
        env.METABOT_FEISHU_WS_PING_TIMEOUT_SEC,
        DEFAULT_FEISHU_WS_PING_TIMEOUT_SEC,
        MIN_PING_TIMEOUT_SEC,
        MAX_PING_TIMEOUT_SEC,
      ),
    },
  };
}
