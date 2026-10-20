# Agent 团队

MetaBot Agent 团队让主导 Agent 通过本地 bridge 协调一组持久化专家队友。协调模型是引擎中立的：团队可以声明 Claude、Codex 或 Kimi 队友，所有协调状态都落在 bridge 数据库里，而不是藏在单个模型会话中。实际执行仍走当前 bridge 和 session-engine 路径，因此每个配置的引擎都必须被该 bridge 运行时支持。

## 功能

Agent 团队用于更大的运行时协作：

- **团队**包含 agents、邮箱消息、共享任务和后台 runs。
- **主导 Agent**创建或复用团队，派遣队友，分配任务，并整合结果。
- **队友**运行在执行该团队的 bridge 上的独立会话里，会话名为 `team:<team>:<agent>`。
- Agents 通过 `metabot teams` 协调，因此进展对主导 Agent、其他队友、飞书卡片和后续 supervisor 自动化都是可见的。

这是 [MetaSkill](metaskill.md) 的运行时对应：MetaSkill 生成可移植的团队 prompts 和 skills；Agent 团队负责运行一个真实团队。

## CLI 工作流

所有协调都使用 `metabot teams`：

```bash
metabot teams create metabot-dev --description "MetaBot implementation team"
metabot teams agents spawn metabot-dev cli-engineer --role implementation --engine codex --prompt "Own CLI UX, tests, and docs."
metabot teams tasks create metabot-dev "Add runs CLI" --description "Expose runs create/update in bash and TS CLIs." --owner cli-engineer
metabot teams send metabot-dev cli-engineer "Start task 4." --from lead --summary "assign task 4"
```

队友每一轮通常先读取邮箱和任务：

```bash
metabot teams inbox metabot-dev cli-engineer --unread --read
metabot teams tasks get metabot-dev 4
metabot teams tasks update metabot-dev 4 --status in_progress --owner cli-engineer
```

完成后写入结果并通知 lead：

```bash
metabot teams tasks update metabot-dev 4 --status completed --result "Added runs create/update to bash and TS CLI; production smoke passed."
metabot teams send metabot-dev lead "Completed task 4: runs create/update is live." --from cli-engineer --summary "task 4 complete"
```

## Runs

Runs 表示队友的后台执行记录。Supervisor 和飞书卡片快照都会用它展示进行中或已完成的后台工作。

```bash
metabot teams runs list metabot-dev
metabot teams runs create metabot-dev --agent cli-engineer --task-id 4 --status running --output "Starting smoke test"
metabot teams runs update metabot-dev <runId> --status completed --output "Smoke passed"
metabot teams runs output metabot-dev <runId>
metabot teams runs stop metabot-dev <runId>
```

合法 run 状态包括 `running`、`completed`、`failed` 和 `stopped`。`metabot teams runs stop` 现在会在可用时走 supervisor：把 run 标记为 `stopped`，请求 bridge 停止该队友 chat task，把已分配且 in-progress 的任务重新排回 `pending` 并写入 stop 说明，同时抑制迟到的 executor output，避免延迟返回的成功结果覆盖 stopped run。

失败 run 的处理：

- 手动 CLI 使用者应在失败时设置 `--status failed --error "<reason>"`。
- Background activity 面板会展示 failed run，并在有 error 时展示错误内容。
- `metabot teams runs output <team> <runId>` 会返回 `output` 和 `error`，lead 不需要直接查数据库即可查看失败原因。
- Supervisor 会把崩溃或执行不成功的 run 标记为 `failed`，保存 error 字符串，把已分配且 in-progress 的任务重新排回 `pending` 并在 `result` 写入失败上下文，把 agent 恢复为 idle，并由非 lead 队友给 `lead` 发失败消息。下一次 supervisor tick 可以再次拾取该任务；lead 负责决定是否允许重试、转派或停止团队。

## 卡片展示

Bridge 会从 Agent Teams store 构建团队快照：

- **Team** 面板展示 active agents、working/idle 状态和可见任务。
- **Background activity** 面板展示 runs、状态以及最新 output 或 error。
- 卡片展示的任务状态包括 `pending`、`in_progress` 和 `completed`；`deleted` 任务会隐藏。

这些卡片状态来自 `/api/agent-teams/<team>` 数据，因此 CLI 更新会立即影响 bridge 可渲染的内容。

卡片按 chat 绑定展示。只有当前 chat 命中团队的 `displayChatIds` 或 `chatIds` 时，该团队才会显示；active teams 不会全局出现在所有飞书会话里。`team:metabot-dev:cli-engineer` 这类队友执行会话可放在 `chatIds`，面向用户的飞书会话应放在 `displayChatIds`。

## Supervisor 阶段

Agent Team supervisor 是 bridge 侧循环。启用后，它扫描 active teams，找到有未读消息或已分配 pending 任务的 agents，创建 run，标记 agent 为 working，并在该 agent 的独立会话中执行。Run 结束后，它记录 output 或 error，并给 lead 发消息。

运行细节：

- 用 `METABOT_AGENT_TEAM_SUPERVISOR=0` 关闭循环。
- 用 `METABOT_AGENT_TEAM_SUPERVISOR_INTERVAL_MS` 调整轮询间隔。
- Supervisor 优先选择本地 `metabot` bridge bot；没有时使用第一个已注册 bot。
- Supervisor 启动 run 时，会把已分配的 pending 任务改为 `in_progress`。
- Supervisor 会为队友 chat 设置配置的 session engine，但目前还不会在派发前校验每个引擎的能力。在 runtime capability checks 或 per-engine adapters 落地前，常驻团队应使用本地 bridge 已知可工作的引擎。

## `bots.json` 中的常驻团队

CLI-only 设置适合临时团队。常驻团队在 `bots.json` 的 `agentTeams` 下声明，bridge 启动时会把它们 reconcile 到团队 store。启用热加载时，修改 `bots.json` 会自动 reconcile；设置 `METABOT_AGENT_TEAMS_HOT_RELOAD=0` 可关闭 watcher。

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

`lead` 不是全局保留名。对于 `metabot-dev` 这样的顶层团队，当前面向用户的 bot
就是 leader，因此不需要额外创建一个顶层 `lead` member。没有 active `lead`
member 时，发给 `lead` 的消息会被当成 leader activity，并通过面向用户的 Agent
Activity card 推出来。嵌套 team 或子项目仍然可以定义独立的 `lead` member；这种情况下
`team:<team>:lead` 会像其他 member session 一样运行。

Reconcile 行为：

- 已配置团队按 name 创建或更新。
- 已配置 agents 和 tasks 会 upsert。
- 如果某个已配置团队移除了 agents，且仍至少列出一个期望 agent，缺失的既有 agents 会标记为 `stopped`。
- 曾经出现在 `agentTeams` 中的团队会标记为 `managedByConfig`；后续如果从配置中移除，reconcile 会把它标记为 `stopped`。
- 手动 CLI 创建的团队会保留，除非它和已配置团队同名。

既有数据库的 rollout 注意事项：`managed_by_config` 列添加到既有 Agent Teams DB 时默认是 false。之前已经存在的 resident/config-created teams 只有在 bridge 从 `bots.json` reconcile 过一次后，才会被视为配置托管。部署这个变更后，请在保留期望 `bots.json` `agentTeams` 的情况下重启 bridge，或触发一次热加载。只有完成这次 reconcile 后，才应依赖“从 `agentTeams` 移除团队”作为 rollback 机制来停止旧 resident team。

## 命令参考

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

## 当前限制

- Agent Teams 是本地 bridge 状态，不是 metabot-core 状态。请在 bridge 主机上使用，或配置 `METABOT_URL` 和 `API_SECRET` 后远程访问。
- 引擎中立指协调模型中立，不代表所有引擎都天然支持所有执行能力。队友引擎选择仍走当前 bridge/session-engine 边界。
- Supervisor 可以执行队友，但 lead 仍然负责整合质量和最终用户汇报。
- `runs stop` 会通过 bridge supervisor 请求取消并重新排队已分配任务，但实际取消仍取决于当前引擎任务是否响应 bridge stop signal。
- Runs 存储文本 output 和 error；大型产物仍应走常规输出文件路径。

## 相关

- [metabot CLI](../reference/cli-metabot.zh.md) — 完整 CLI 参考
- [MetaSkill](metaskill.md) — 先生成团队 prompts 和 skills，再运行
- [聊天命令](../usage/chat-commands.md) — 使用 `/goal` 与 `/background`
- [Peers 联邦](peers.md) — 跨 MetaBot 实例路由工作
