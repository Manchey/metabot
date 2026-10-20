# Agent Teams

MetaBot Agent Teams let a lead agent coordinate persistent specialist teammates through the local bridge. The coordination model is engine-neutral: teams can declare Claude, Codex, or Kimi teammates, and all coordination is stored in the bridge database instead of being hidden inside one model session. Execution still runs through the current bridge and session-engine path, so each configured engine must be supported by that bridge runtime.

## What It Does

Agent Teams is the runtime team experience for larger work:

- A **team** groups agents, mailbox messages, shared tasks, and background runs.
- A **lead** creates or reuses the team, spawns teammates, assigns tasks, and integrates results.
- **Teammates** run in independent chat sessions named `team:<team>:<agent>` on the bridge that executes the team.
- Agents coordinate with `metabot teams`, so progress is visible to the lead, other teammates, Feishu cards, and future supervisor automation.

This is the runtime counterpart to [MetaSkill](metaskill.md): MetaSkill generates portable team prompts and skills; Agent Teams runs a live team.

## CLI Workflow

Use `metabot teams` for all coordination:

```bash
metabot teams create metabot-dev --description "MetaBot implementation team"
metabot teams agents spawn metabot-dev cli-engineer --role implementation --engine codex --prompt "Own CLI UX, tests, and docs."
metabot teams tasks create metabot-dev "Add runs CLI" --description "Expose runs create/update in bash and TS CLIs." --owner cli-engineer
metabot teams send metabot-dev cli-engineer "Start task 4." --from lead --summary "assign task 4"
```

Teammates normally start each turn by reading their mailbox and task:

```bash
metabot teams inbox metabot-dev cli-engineer --unread --read
metabot teams tasks get metabot-dev 4
metabot teams tasks update metabot-dev 4 --status in_progress --owner cli-engineer
```

They finish by recording the result and reporting to the lead:

```bash
metabot teams tasks update metabot-dev 4 --status completed --result "Added runs create/update to bash and TS CLI; production smoke passed."
metabot teams send metabot-dev lead "Completed task 4: runs create/update is live." --from cli-engineer --summary "task 4 complete"
```

## Runs

Runs represent background execution records for a teammate. They are used by the supervisor and by Feishu card snapshots to show active or completed background work.

```bash
metabot teams runs list metabot-dev
metabot teams runs create metabot-dev --agent cli-engineer --task-id 4 --status running --output "Starting smoke test"
metabot teams runs update metabot-dev <runId> --status completed --output "Smoke passed"
metabot teams runs output metabot-dev <runId>
metabot teams runs stop metabot-dev <runId>
```

Valid run statuses are `running`, `completed`, `failed`, and `stopped`. `metabot teams runs stop` now routes through the supervisor when available: it marks the run `stopped`, asks the bridge to stop the teammate chat task, requeues any assigned in-progress tasks to `pending` with a stop note, and suppresses late executor output so a delayed success cannot overwrite the stopped run.

Failed-run handling:

- Manual CLI users should set `--status failed --error "<reason>"` when a run fails.
- The Background activity panel shows failed runs with the run error when present.
- `metabot teams runs output <team> <runId>` returns both `output` and `error`, so the lead can inspect the failure without raw database access.
- The supervisor marks crashed or unsuccessful executions as `failed`, stores the error string, requeues assigned in-progress tasks to `pending` with failure context in `result`, returns the agent to idle, and sends a failure message to `lead` for non-lead teammates. The next supervisor tick can pick the task up again; the lead is responsible for deciding whether to let it retry, reassign it, or stop the team.

## Card Display

The bridge builds a team snapshot from the Agent Teams store:

- The **Team** panel shows active agents, their working or idle state, and visible tasks.
- The **Background activity** panel shows runs with status and the latest output or error.
- Task statuses shown on cards are `pending`, `in_progress`, and `completed`; deleted tasks are hidden.

This card state is derived from `/api/agent-teams/<team>` data, so CLI updates immediately affect what the bridge can render.

Cards are scoped by chat binding. A team is shown only in chats listed in the team's `displayChatIds` or `chatIds`; active teams are not shown globally. Teammate execution chats such as `team:metabot-dev:cli-engineer` can be listed in `chatIds`, while user-facing Feishu chats should be listed in `displayChatIds`.

## Supervisor Phase

The Agent Team supervisor is a bridge-side loop. When enabled, it scans active teams, finds agents with unread messages or assigned pending tasks, creates a run, marks the agent working, and executes that agent in its own chat session. When the run finishes, it records output or error and messages the lead.

Operational details:

- Disable the loop with `METABOT_AGENT_TEAM_SUPERVISOR=0`.
- Tune the polling interval with `METABOT_AGENT_TEAM_SUPERVISOR_INTERVAL_MS`.
- The supervisor selects the local `metabot` bridge bot when available, otherwise the first registered bot.
- Assigned pending tasks are moved to `in_progress` when the supervisor starts the run.
- The supervisor sets the configured session engine for the teammate chat, but it does not yet validate per-engine capabilities before dispatching work. Keep resident teams on engines known to work in the local bridge until runtime capability checks or per-engine adapters are added.

## Resident Teams In `bots.json`

CLI-only setup is useful for ad-hoc teams. Resident teams are declared in `bots.json` under `agentTeams` and reconciled into the bridge store on startup. With hot reload enabled, changes to `bots.json` are reconciled automatically; set `METABOT_AGENT_TEAMS_HOT_RELOAD=0` to disable the watcher.

```json
{
  "feishuBots": [
    { "name": "metabot", "engine": "codex", "feishu": { "appId": "...", "appSecret": "..." } }
  ],
  "agentTeams": [
    {
      "name": "metabot-dev",
      "description": "MetaBot implementation team",
      "status": "active",
      "chatIds": ["team:metabot-dev:cli-engineer", "team:metabot-dev:runtime-engineer"],
      "displayChatIds": ["oc_feishu_chat_id"],
      "agents": [
        { "name": "cli-engineer", "role": "implementation", "engine": "codex", "prompt": "Own teams CLI, command UX, tests, and docs." },
        { "name": "runtime-engineer", "role": "runtime", "engine": "codex", "prompt": "Own bridge runtime, store, supervisor, and cards." }
      ],
      "tasks": [
        { "id": 8, "subject": "Document Agent Teams workflow", "owner": "cli-engineer", "status": "pending" }
      ]
    }
  ]
}
```

`lead` is not reserved globally. In a top-level team such as `metabot-dev`,
the current user-facing bot can act as the leader, so the team does not need a
separate `lead` member. When no active `lead` member exists, messages sent to
`lead` are treated as leader activity and are pushed to the user-facing Agent
Activity card. A nested or sub-project team may still define an independent
`lead` member; in that case `team:<team>:lead` runs like any other member
session.

Reconciliation behavior:

- Existing configured teams are created or updated by name.
- Configured agents and tasks are upserted.
- If a configured team removes agents while still listing at least one desired agent, missing existing agents are marked `stopped`.
- Teams previously seen in `agentTeams` are marked `managedByConfig`; if they later disappear from config, reconcile marks them `stopped`.
- Manual CLI-created teams are left alone unless they share a configured team name.

Rollout caveat for existing databases: the `managed_by_config` column defaults to false when it is added to an existing Agent Teams DB. Pre-existing resident/config-created teams are not treated as config-managed until the bridge reconciles them once from `bots.json`. After deploying this change, restart the bridge or trigger one hot reload with the desired `bots.json` `agentTeams` still present. Only after that first reconcile should you rely on removing a team from `agentTeams` as a rollback mechanism to stop an old resident team.

## Command Reference

```bash
metabot teams list
metabot teams create <team> [--description <text>]
metabot teams delete <team>
metabot teams status <team>
metabot teams start <team>
metabot teams stop <team>

metabot teams agents list <team>
metabot teams agents spawn <team> <name> [--role <role>] [--engine claude|codex|kimi] [--prompt <text>]
metabot teams agents stop <team> <name>
metabot teams agents delete <team> <name>

metabot teams send <team> <to> <message> [--from <name>] [--summary <text>]
metabot teams inbox <team> <name> [--unread] [--read]

metabot teams tasks list <team>
metabot teams tasks create <team> <subject> [--description <text>] [--owner <name>]
metabot teams tasks get <team> <id>
metabot teams tasks update <team> <id> [--status pending|in_progress|completed|deleted] [--owner <name>] [--result <text>]

metabot teams runs list <team>
metabot teams runs create <team> [--agent <name>] [--task-id <id>] [--status running|completed|failed|stopped] [--output <text>] [--error <text>]
metabot teams runs update <team> <runId> [--status running|completed|failed|stopped] [--output <text>] [--error <text>]
metabot teams runs output <team> <runId>
metabot teams runs stop <team> <runId>
```

## Current Limits

- Agent Teams is local-bridge state, not metabot-core state. Use it from the bridge host or configure `METABOT_URL` and `API_SECRET` for remote access.
- Engine-neutral coordination does not mean universal execution support. Teammate engines are selected through the current bridge/session-engine boundary.
- The supervisor can execute teammates, but the lead still owns integration quality and final user reporting.
- `runs stop` requests cancellation through the bridge supervisor and requeues assigned tasks, but cancellation still depends on the active engine task honoring the bridge stop signal.
- Runs store text output and error strings; large artifacts should still go through the normal output-file path.

## See Also

- [metabot CLI](../reference/cli-metabot.md) — full CLI reference
- [MetaSkill](metaskill.md) — generate team prompts and skills before running
- [Chat Commands](../usage/chat-commands.md) — use `/goal` and `/background`
- [Peers](peers.md) — route work across MetaBot instances
