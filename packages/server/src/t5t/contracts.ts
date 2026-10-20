import type { TopFiveStatus, WipStatus } from './types.js';

/**
 * Pure request-body validators for the `/api/t5t/cli/*` write surface.
 * Each returns either a typed, normalized body or a `ValidationError`
 * (`{ status: 400, error }`) the route maps straight into the response.
 *
 * Validation only — no store access, no auth. Owner-auth happens in the
 * route layer via `requireOwner`; identity (`cred.botName`) is never read
 * from the body (anti-spoof, mirrors MR2 `postFeedback`).
 */

export interface ValidationError {
  status: 400;
  error: string;
}

export function isValidationError(v: unknown): v is ValidationError {
  return (
    typeof v === 'object'
    && v !== null
    && (v as { status?: number }).status === 400
    && typeof (v as { error?: unknown }).error === 'string'
  );
}

function reqStr(
  body: Record<string, unknown>,
  key: string,
): string | ValidationError {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) {
    return { status: 400, error: `${key}_required` };
  }
  return v.trim();
}

function optStr(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function strArray(body: Record<string, unknown>, key: string): string[] {
  const v = body[key];
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface CliPushBody {
  project: string;
  items: string[];
  date?: string;
  retracts?: string | null;
}

export function parseCliPush(
  body: Record<string, unknown>,
): CliPushBody | ValidationError {
  const project = reqStr(body, 'project');
  if (isValidationError(project)) return project;
  const items = strArray(body, 'items');
  if (items.length === 0) return { status: 400, error: 'items_required' };
  return {
    project,
    items,
    date: optStr(body, 'date'),
    retracts: optStr(body, 'retracts') ?? null,
  };
}

export interface CliGoalBody {
  project: string;
  text: string;
}

export function parseCliGoal(
  body: Record<string, unknown>,
): CliGoalBody | ValidationError {
  const project = reqStr(body, 'project');
  if (isValidationError(project)) return project;
  const text = reqStr(body, 'text');
  if (isValidationError(text)) return text;
  return { project, text };
}

export interface CliEvaluatorBody {
  project: string;
  evaluatorId: string;
  description?: string;
  met?: boolean;
}

export function parseCliEvaluator(
  body: Record<string, unknown>,
): CliEvaluatorBody | ValidationError {
  const project = reqStr(body, 'project');
  if (isValidationError(project)) return project;
  const evaluatorId = reqStr(body, 'evaluatorId');
  if (isValidationError(evaluatorId)) return evaluatorId;
  return {
    project,
    evaluatorId,
    description: optStr(body, 'description'),
    met: body.met === true,
  };
}

export interface CliBottleneckBody {
  project: string;
  text?: string | null;
  clear?: boolean;
}

export function parseCliBottleneck(
  body: Record<string, unknown>,
): CliBottleneckBody | ValidationError {
  const project = reqStr(body, 'project');
  if (isValidationError(project)) return project;
  const clear = body.clear === true;
  const text = optStr(body, 'text') ?? null;
  if (!clear && !text) {
    return { status: 400, error: 'text_required_when_not_clearing' };
  }
  return { project, text, clear };
}

export interface CliWipBody {
  project: string;
  evaluatorId: string;
  description: string;
  status?: WipStatus;
  wipId?: string;
}

const WIP_STATUSES: readonly WipStatus[] = ['queued', 'doing', 'done'];

export function parseCliWip(
  body: Record<string, unknown>,
): CliWipBody | ValidationError {
  const project = reqStr(body, 'project');
  if (isValidationError(project)) return project;
  const evaluatorId = reqStr(body, 'evaluatorId');
  if (isValidationError(evaluatorId)) return evaluatorId;
  const description = reqStr(body, 'description');
  if (isValidationError(description)) return description;
  let status: WipStatus | undefined;
  if (body.status !== undefined) {
    if (
      typeof body.status !== 'string'
      || !WIP_STATUSES.includes(body.status as WipStatus)
    ) {
      return { status: 400, error: 'invalid_wip_status' };
    }
    status = body.status as WipStatus;
  }
  return {
    project,
    evaluatorId,
    description,
    status,
    wipId: optStr(body, 'wipId'),
  };
}

export interface CliTopFiveBody {
  project: string;
  text?: string;
  itemId?: string;
  status?: TopFiveStatus;
}

const TOPFIVE_STATUSES: readonly TopFiveStatus[] = ['open', 'done', 'removed'];

export function parseCliTopFive(
  body: Record<string, unknown>,
): CliTopFiveBody | ValidationError {
  const project = reqStr(body, 'project');
  if (isValidationError(project)) return project;
  const itemId = optStr(body, 'itemId');
  const text = optStr(body, 'text');
  if (!itemId && !text) {
    return { status: 400, error: 'text_required' };
  }
  let status: TopFiveStatus | undefined;
  if (body.status !== undefined) {
    if (
      typeof body.status !== 'string'
      || !TOPFIVE_STATUSES.includes(body.status as TopFiveStatus)
    ) {
      return { status: 400, error: 'invalid_topfive_status' };
    }
    status = body.status as TopFiveStatus;
  }
  return { project, text, itemId, status };
}

export interface CliFeedbackBody {
  onEntry: string;
  comment: string;
  mentions: string[];
}

export function parseCliFeedback(
  body: Record<string, unknown>,
): CliFeedbackBody | ValidationError {
  const onEntry = reqStr(body, 'onEntry');
  if (isValidationError(onEntry)) return onEntry;
  const comment = reqStr(body, 'comment');
  if (isValidationError(comment)) return comment;
  return { onEntry, comment, mentions: strArray(body, 'mentions') };
}
