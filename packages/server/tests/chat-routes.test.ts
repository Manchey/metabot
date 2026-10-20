import { afterEach, describe, expect, it } from 'vitest';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

let kit: ServerKit | undefined;

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
});

const ALICE = 'alice@xvirobotics.com';
const BOB = 'bob@xvirobotics.com';

async function issueMember(
  k: ServerKit,
  botName: string,
  ownerName = botName,
): Promise<{
  token: string;
  credentialId: string;
}> {
  const res = await call(k.baseUrl, 'POST', '/admin/credentials/issue', k.adminToken, {
    botName,
    ownerName,
    role: 'member',
  });
  expect(res.status).toBe(201);
  return {
    token: res.body.token as string,
    credentialId: res.body.credential.id as string,
  };
}

const bearerTokens = new WeakMap<ServerKit, Map<string, string>>();

async function webJson(
  k: ServerKit,
  method: string,
  pathname: string,
  email: string,
  body?: unknown,
): Promise<Awaited<ReturnType<typeof rawRequest>>> {
  let tokens = bearerTokens.get(k);
  if (!tokens) {
    tokens = new Map();
    bearerTokens.set(k, tokens);
  }
  let token = tokens.get(email);
  if (!token) {
    token = (await issueMember(k, email, email)).token;
    tokens.set(email, token);
  }
  return rawRequest(
    k.port,
    method,
    pathname,
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body === undefined ? undefined : JSON.stringify(body),
  );
}

describe('chat routes', () => {
  it('accepts the personal-edition Bearer token', async () => {
    kit = await startTestServer('chat-web-only', { uiAllowedEmails: ['@xvirobotics.com'] });
    const res = await call(kit.baseUrl, 'POST', '/api/chat/conversations', kit.adminToken, {
      kind: 'group',
      title: 'local room',
    });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('local room');
  });

  it('creates an idempotent agent DM for a visible agent', async () => {
    kit = await startTestServer('chat-agent-dm', { uiAllowedEmails: ['@xvirobotics.com'] });
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: 'owner',
      ownerName: ALICE,
    });

    const first = await webJson(kit, 'POST', '/api/chat/conversations/agent-dm', ALICE, {
      botName: 'metabot',
    });
    expect(first.status).toBe(200);
    const firstBody = JSON.parse(first.body);
    expect(firstBody.kind).toBe('dm');
    expect(firstBody.participants.map((p: { kind: string; ref: string }) => `${p.kind}:${p.ref}`).sort()).toEqual([
      'agent:metabot',
      `user:${ALICE}`,
    ]);

    const second = await webJson(kit, 'POST', '/api/chat/conversations/agent-dm', ALICE, {
      botName: 'metabot',
    });
    expect(second.status).toBe(200);
    expect(JSON.parse(second.body).id).toBe(firstBody.id);
  });

  it('creates an idempotent user DM with lowercase user identity semantics', async () => {
    kit = await startTestServer('chat-user-dm', { uiAllowedEmails: ['@xvirobotics.com'] });

    const first = await webJson(kit, 'POST', '/api/chat/conversations/user-dm', ALICE, {
      email: 'Bob@Xvirobotics.com',
      displayName: 'Bob',
    });
    expect(first.status).toBe(200);
    const firstBody = JSON.parse(first.body);
    expect(firstBody.kind).toBe('dm');
    expect(firstBody.participants.map((p: { kind: string; ref: string }) => `${p.kind}:${p.ref}`).sort()).toEqual([
      `user:${ALICE}`,
      `user:${BOB}`,
    ]);

    const second = await webJson(kit, 'POST', '/api/chat/conversations/user-dm', ALICE, {
      userRef: BOB,
    });
    expect(second.status).toBe(200);
    expect(JSON.parse(second.body).id).toBe(firstBody.id);

    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${firstBody.id}/messages`, ALICE, {
      content: 'hello human',
    });
    expect(msg.status).toBe(201);
    expect(JSON.parse(msg.body).runsCreated).toBe(0);
  });

  it('searches exact-email users, known users, and visible agents without leaking hidden agents', async () => {
    kit = await startTestServer('chat-participant-search', { uiAllowedEmails: ['@xvirobotics.com'] });
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: 'owner',
      ownerName: ALICE,
    });
    kit.handle.agentStore.register({
      botName: 'hiddenbot',
      url: 'http://127.0.0.1:3001',
      visible: false,
      ownerCredentialId: 'hidden-owner',
      ownerName: BOB,
    });
    kit.handle.agentStore.register({
      botName: 'publicbot',
      url: 'http://127.0.0.1:3002',
      visible: true,
      ownerCredentialId: 'public-owner',
      ownerName: BOB,
    });

    const created = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Known users',
      participants: [{ kind: 'user', ref: BOB, displayName: 'Bob' }],
    });
    expect(created.status).toBe(201);

    const exact = await webJson(kit, 'GET', '/api/chat/participants/search?q=Eve%40xvirobotics.com', ALICE);
    expect(exact.status).toBe(200);
    expect(JSON.parse(exact.body).participants).toContainEqual({
      kind: 'user',
      ref: 'eve@xvirobotics.com',
      displayName: 'eve@xvirobotics.com',
      source: 'exact',
    });

    const known = await webJson(kit, 'GET', '/api/chat/participants/search?q=bob', ALICE);
    expect(known.status).toBe(200);
    expect(JSON.parse(known.body).participants).toContainEqual({
      kind: 'user',
      ref: BOB,
      displayName: 'Bob',
      source: 'known',
    });

    const agents = await webJson(kit, 'GET', '/api/chat/participants/search?q=bot', ALICE);
    expect(agents.status).toBe(200);
    const agentRefs = JSON.parse(agents.body).participants.map(
      (p: { kind: string; ref: string }) => `${p.kind}:${p.ref}`,
    );
    expect(agentRefs).toContain('agent:metabot');
    expect(agentRefs).toContain('agent:publicbot');
    expect(agentRefs).not.toContain('agent:hiddenbot');
  });

  it('allows direct chat with a visible agent owned by another user', async () => {
    kit = await startTestServer('chat-visible-agent-bus', { uiAllowedEmails: ['@xvirobotics.com'] });
    kit.handle.agentStore.register({
      botName: 'publicbot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: 'public-owner',
      ownerName: BOB,
    });

    const dm = await webJson(kit, 'POST', '/api/chat/conversations/agent-dm', ALICE, {
      botName: 'publicbot',
    });
    expect(dm.status).toBe(200);
    const conversationId = JSON.parse(dm.body).id as string;

    const group = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Cross-agent room',
      participants: [{ kind: 'agent', ref: 'publicbot' }],
    });
    expect(group.status).toBe(201);

    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: 'hello public agent',
    });
    expect(msg.status).toBe(201);
    expect(JSON.parse(msg.body).runsCreated).toBe(1);
  });

  it('stores group messages without default agent triggers when no mention is present', async () => {
    kit = await startTestServer('chat-no-default-agent', { uiAllowedEmails: ['@xvirobotics.com'] });
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: 'owner',
      ownerName: ALICE,
    });

    const created = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Project room',
      participants: [
        { kind: 'user', ref: BOB, displayName: 'Bob' },
        { kind: 'agent', ref: 'metabot', displayName: 'MetaBot' },
      ],
    });
    expect(created.status).toBe(201);
    const conversationId = JSON.parse(created.body).id as string;

    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: 'status update for humans',
    });
    expect(msg.status).toBe(201);
    const msgBody = JSON.parse(msg.body);
    expect(msgBody.message.mentionedAgentRefs).toEqual([]);
    expect(msgBody.agentTriggers).toEqual([]);
    expect(msgBody.runsCreated).toBe(0);

    const mentioned = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: '@metabot please inspect',
      mentionedAgentRefs: ['metabot'],
    });
    expect(mentioned.status).toBe(201);
    const mentionedBody = JSON.parse(mentioned.body);
    expect(mentionedBody.agentTriggers).toEqual(['metabot']);
    expect(mentionedBody.runsCreated).toBe(1);
    expect(mentionedBody.runs[0]).toMatchObject({
      conversationId,
      targetAgentRef: 'metabot',
      status: 'queued',
    });
  });

  it('enforces participant ACLs on conversation reads', async () => {
    kit = await startTestServer('chat-acl', { uiAllowedEmails: ['@xvirobotics.com'] });
    const created = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Private room',
    });
    expect(created.status).toBe(201);
    const conversationId = JSON.parse(created.body).id as string;

    const bobRead = await webJson(kit, 'GET', `/api/chat/conversations/${conversationId}`, BOB);
    expect(bobRead.status).toBe(403);
    expect(JSON.parse(bobRead.body).error).toBe('chat_participant_required');
  });

  it('does not trust body-only mentions for agents that are not conversation participants', async () => {
    kit = await startTestServer('chat-mention-participant', { uiAllowedEmails: ['@xvirobotics.com'] });
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: 'owner',
      ownerName: ALICE,
    });

    const created = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Humans only',
    });
    expect(created.status).toBe(201);
    const conversationId = JSON.parse(created.body).id as string;

    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: '@metabot not in room',
      mentionedAgentRefs: ['metabot'],
    });
    expect(msg.status).toBe(201);
    const body = JSON.parse(msg.body);
    expect(body.message.mentionedAgentRefs).toEqual([]);
    expect(body.agentTriggers).toEqual([]);
  });

  it('only allows the conversation creator to add participants', async () => {
    kit = await startTestServer('chat-add-owner-only', { uiAllowedEmails: ['@xvirobotics.com'] });
    const created = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Owner room',
      participants: [{ kind: 'user', ref: BOB }],
    });
    expect(created.status).toBe(201);
    const conversationId = JSON.parse(created.body).id as string;

    const denied = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/participants`, BOB, {
      kind: 'user',
      ref: 'eve@xvirobotics.com',
    });
    expect(denied.status).toBe(403);
    expect(JSON.parse(denied.body).error).toBe('chat_owner_required');

    const allowed = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/participants`, ALICE, {
      kind: 'user',
      ref: 'eve@xvirobotics.com',
    });
    expect(allowed.status).toBe(201);
  });

  it('rejects invalid DM membership changes with stable errors', async () => {
    kit = await startTestServer('chat-dm-membership', { uiAllowedEmails: ['@xvirobotics.com'] });

    const invalid = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'dm',
      participants: [
        { kind: 'user', ref: BOB },
        { kind: 'user', ref: 'eve@xvirobotics.com' },
      ],
    });
    expect(invalid.status).toBe(400);
    expect(JSON.parse(invalid.body).error).toBe('dm_participant_count_invalid');

    const dm = await webJson(kit, 'POST', '/api/chat/conversations/user-dm', ALICE, {
      userRef: BOB,
    });
    expect(dm.status).toBe(200);
    const add = await webJson(kit, 'POST', `/api/chat/conversations/${JSON.parse(dm.body).id}/participants`, ALICE, {
      kind: 'user',
      ref: 'eve@xvirobotics.com',
    });
    expect(add.status).toBe(409);
    expect(JSON.parse(add.body).error).toBe('dm_participants_immutable');
  });

  it('normalizes user participants to lowercase email refs', async () => {
    kit = await startTestServer('chat-user-normalize', { uiAllowedEmails: ['@xvirobotics.com'] });
    const created = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Case room',
      participants: [{ kind: 'user', ref: 'Bob@Xvirobotics.com' }],
    });
    expect(created.status).toBe(201);
    const body = JSON.parse(created.body);
    expect(body.participants.map((p: { kind: string; ref: string }) => `${p.kind}:${p.ref}`).sort()).toEqual([
      `user:${ALICE}`,
      `user:${BOB}`,
    ]);

    const bobRead = await webJson(kit, 'GET', `/api/chat/conversations/${body.id}`, BOB);
    expect(bobRead.status).toBe(200);
  });

  it('stamps sender and run fields from the authenticated web identity', async () => {
    kit = await startTestServer('chat-spoof', { uiAllowedEmails: ['@xvirobotics.com'] });
    const created = await webJson(kit, 'POST', '/api/chat/conversations', ALICE, {
      kind: 'group',
      title: 'Spoof room',
    });
    expect(created.status).toBe(201);
    const conversationId = JSON.parse(created.body).id as string;

    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: 'spoof attempt',
      senderKind: 'agent',
      senderRef: 'metabot',
      senderDisplayName: 'MetaBot',
      runId: 'run-forged',
    });
    expect(msg.status).toBe(201);
    const stored = JSON.parse(msg.body).message;
    expect(stored.senderKind).toBe('user');
    expect(stored.senderRef).toBe(ALICE);
    expect(stored.senderDisplayName).toBe(ALICE);
    expect(stored.runId).toBeNull();
  });

  it('creates a queued run for every agent DM message', async () => {
    kit = await startTestServer('chat-dm-run', { uiAllowedEmails: ['@xvirobotics.com'] });
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: 'owner',
      ownerName: ALICE,
    });
    const dm = await webJson(kit, 'POST', '/api/chat/conversations/agent-dm', ALICE, {
      botName: 'metabot',
    });
    expect(dm.status).toBe(200);
    const conversationId = JSON.parse(dm.body).id as string;

    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: 'please run',
      engine: 'codex',
      model: 'gpt-5.5-codex',
    });
    expect(msg.status).toBe(201);
    const body = JSON.parse(msg.body);
    expect(body.agentTriggers).toEqual([]);
    expect(body.runsCreated).toBe(1);
    expect(body.runs[0].targetAgentRef).toBe('metabot');
    expect(body.runs[0]).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.5-codex',
    });
  });

  it('accepts idempotent run callbacks from the owning agent credential and exposes events to participants', async () => {
    kit = await startTestServer('chat-run-callback', { uiAllowedEmails: ['@xvirobotics.com'] });
    const bridge = await issueMember(kit, 'bridge-cred', ALICE);
    const stranger = await issueMember(kit, 'stranger', ALICE);
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: bridge.credentialId,
      ownerName: ALICE,
    });
    const dm = await webJson(kit, 'POST', '/api/chat/conversations/agent-dm', ALICE, {
      botName: 'metabot',
    });
    const conversationId = JSON.parse(dm.body).id as string;
    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: 'please run',
    });
    const runId = JSON.parse(msg.body).runs[0].id as string;

    const forbidden = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, stranger.token, {
      seq: 1,
      kind: 'state',
      payload: { status: 'running' },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe('callback_agent_owner_required');

    const state = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 1,
      kind: 'state',
      payload: { status: 'running', text: 'working' },
    });
    expect(state.status).toBe(200);
    const duplicate = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 1,
      kind: 'state',
      payload: { status: 'running', text: 'working' },
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.id).toBe(state.body.id);
    const conflict = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 1,
      kind: 'state',
      payload: { status: 'running', text: 'conflict' },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('run_event_seq_conflict');

    const complete = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 2,
      kind: 'complete',
      payload: { content: 'done' },
    });
    expect(complete.status).toBe(200);
    const terminalOverwrite = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 3,
      kind: 'state',
      payload: { status: 'running' },
    });
    expect(terminalOverwrite.status).toBe(409);
    expect(terminalOverwrite.body.error).toBe('run_terminal');

    const events = await webJson(kit, 'GET', `/api/chat/runs/${runId}/events`, ALICE);
    expect(events.status).toBe(200);
    expect(JSON.parse(events.body).events.map((e: { seq: number }) => e.seq)).toEqual([1, 2]);

    const messages = await webJson(kit, 'GET', `/api/chat/conversations/${conversationId}/messages`, ALICE);
    expect(
      JSON.parse(messages.body).messages.map((m: { kind: string; content: string; runId: string | null }) => [
        m.kind,
        m.content,
        m.runId,
      ]),
    ).toEqual([
      ['user', 'please run', null],
      ['assistant', 'done', runId],
    ]);

    const bobEvents = await webJson(kit, 'GET', `/api/chat/runs/${runId}/events`, BOB);
    expect(bobEvents.status).toBe(403);
    expect(JSON.parse(bobEvents.body).error).toBe('chat_participant_required');
  });

  it('queues interactive answers and cancellation for the owning Bridge run', async () => {
    kit = await startTestServer('chat-run-controls', { uiAllowedEmails: ['@xvirobotics.com'] });
    const bridge = await issueMember(kit, 'bridge-cred', ALICE);
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: bridge.credentialId,
      ownerName: ALICE,
    });
    const dm = await webJson(kit, 'POST', '/api/chat/conversations/agent-dm', ALICE, { botName: 'metabot' });
    const conversationId = JSON.parse(dm.body).id as string;
    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: 'ask me first',
    });
    const runId = JSON.parse(msg.body).runs[0].id as string;

    const question = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 1,
      kind: 'question',
      payload: { toolUseId: 'tool-1', question: { toolUseId: 'tool-1', questions: [] } },
    });
    expect(question.status).toBe(200);

    const answer = await webJson(kit, 'POST', `/api/chat/runs/${runId}/answer`, ALICE, {
      toolUseId: 'tool-1',
      answer: 'Use the safe option',
    });
    expect(answer.status).toBe(202);
    expect(JSON.parse(answer.body)).toMatchObject({ runId, status: 'answer_queued' });

    const cancel = await webJson(kit, 'POST', `/api/chat/runs/${runId}/cancel`, ALICE, {});
    expect(cancel.status).toBe(202);
    expect(JSON.parse(cancel.body)).toMatchObject({ runId, status: 'cancel_queued', queued: true });

    const controls = kit.handle.inboxStore.peek('metabot', undefined, 10)
      .map((message) => JSON.parse(message.content))
      .filter((message) => message.type === 'core-chat-control');
    expect(controls).toMatchObject([
      { action: 'answer', runId, targetAgentRef: 'metabot', toolUseId: 'tool-1', answer: 'Use the safe option' },
      { action: 'cancel', runId, targetAgentRef: 'metabot' },
    ]);

    const canceled = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 2,
      kind: 'error',
      payload: { status: 'canceled', error: 'Canceled by user' },
    });
    expect(canceled.status).toBe(200);
    const runs = await webJson(kit, 'GET', `/api/chat/conversations/${conversationId}/runs`, ALICE);
    expect(JSON.parse(runs.body).runs[0].status).toBe('canceled');
  });

  it('records run file events and exposes file metadata under participant ACL', async () => {
    kit = await startTestServer('chat-run-files', { uiAllowedEmails: ['@xvirobotics.com'] });
    const bridge = await issueMember(kit, 'bridge-cred', ALICE);
    kit.handle.agentStore.register({
      botName: 'metabot',
      url: 'http://127.0.0.1:3000',
      visible: true,
      ownerCredentialId: bridge.credentialId,
      ownerName: ALICE,
    });
    const dm = await webJson(kit, 'POST', '/api/chat/conversations/agent-dm', ALICE, {
      botName: 'metabot',
    });
    const conversationId = JSON.parse(dm.body).id as string;
    const msg = await webJson(kit, 'POST', `/api/chat/conversations/${conversationId}/messages`, ALICE, {
      content: 'make file',
    });
    const runId = JSON.parse(msg.body).runs[0].id as string;

    const file = await call(kit.baseUrl, 'POST', `/api/chat/runs/${runId}/events`, bridge.token, {
      seq: 1,
      kind: 'file',
      payload: {
        files: [{ name: 'out.txt', mimeType: 'text/plain', sizeBytes: 5, storageKey: 'runs/out.txt' }],
      },
    });
    expect(file.status).toBe(200);

    const files = await webJson(kit, 'GET', `/api/chat/conversations/${conversationId}/files`, ALICE);
    expect(files.status).toBe(200);
    expect(JSON.parse(files.body).files).toMatchObject([
      {
        conversationId,
        runId,
        name: 'out.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        storageKey: 'runs/out.txt',
        createdBy: 'metabot',
      },
    ]);
  });
});
