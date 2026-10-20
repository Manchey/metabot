import type { Logger } from 'pino';
import type { MemoryStore } from '../memory/memory-store.js';

export interface T5tFolderIds {
  projects: string;
  entries: string;
  feedback: string;
  goals: string;
  evaluators: string;
  bottlenecks: string;
  wip: string;
  topfive: string;
}

const ENV_KEYS = {
  projects: 'T5T_FOLDER_PROJECTS',
  entries: 'T5T_FOLDER_ENTRIES',
  feedback: 'T5T_FOLDER_FEEDBACK',
  goals: 'T5T_FOLDER_GOALS',
  evaluators: 'T5T_FOLDER_EVALUATORS',
  bottlenecks: 'T5T_FOLDER_BOTTLENECKS',
  wip: 'T5T_FOLDER_WIP',
  topfive: 'T5T_FOLDER_TOPFIVE',
} as const;

type T5tFolderKey = keyof T5tFolderIds;
const ALL_KEYS = Object.keys(ENV_KEYS) as T5tFolderKey[];

/**
 * Resolve the seven t5t folder UUIDs. For each key, prefer the env var; when
 * unset (or pointing to a UUID that no longer exists in the DB) auto-create
 * the folder at `/t5t/<name>` and log the assigned UUID. Auto-create uses the
 * MemoryStore's `ensureFolderPath` which bypasses the per-cred ACL check — it
 * is only callable here, at boot, before any request lands.
 */
export function loadT5tFolderIds(
  env: NodeJS.ProcessEnv,
  memoryStore: MemoryStore,
  logger: Logger,
): T5tFolderIds {
  const out: Partial<T5tFolderIds> = {};
  for (const key of ALL_KEYS) {
    const envKey = ENV_KEYS[key];
    const fromEnv = (env[envKey] || '').trim();
    if (fromEnv && memoryStore.findFolderById(fromEnv)) {
      out[key] = fromEnv;
      continue;
    }
    if (fromEnv) {
      logger.warn(
        { envKey, value: fromEnv },
        't5t folder env var points to unknown folder id — falling through to auto-create',
      );
    }
    const folder = memoryStore.ensureFolderPath(`/t5t/${key}`);
    out[key] = folder.id;
    logger.info(
      { envKey, path: folder.path, id: folder.id },
      'auto-created t5t folder',
    );
  }
  return out as T5tFolderIds;
}
