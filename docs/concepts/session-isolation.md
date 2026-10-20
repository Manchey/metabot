# Session Isolation

## How Sessions Work

Sessions are keyed by `chatId` (not `userId`), so each group chat and DM gets its own independent:

- **Working directory** — from bot config
- **Claude session ID** — conversation history
- **Task state** — one task at a time per chat

Sessions expire after **24 hours** of inactivity.

## Group Chat Behavior

- **Multi-member groups** — Default to `mention`; only an exact @mention of the current bot triggers it
- **2-member groups** (1 user + 1 bot) — Default to `all` and behave like DMs
- **DMs** — Bot replies to all messages

The group owner can set `@Bot /group-reply mention` or
`@Bot /group-reply all`. The explicit mode is isolated and persisted per bot
and `chatId`, and overrides both `groupNoMention` and the 2-member-group
default. See [Chat Commands](../usage/chat-commands.md#group-reply-modes).

The member count is cached for 5 minutes to avoid excessive API calls.

## Fork Groups

Users can "fork" a bot by creating multiple small group chats (2-member groups), each with its own session. This enables:

- **Parallel conversations** — Multiple independent Claude sessions with the same bot
- **Isolated contexts** — Each fork has its own conversation history and session state
- **No interference** — Work in one fork doesn't affect another

This is useful when you need to work on multiple tasks simultaneously with the same bot, without conversation contexts mixing.

## Bot Isolation

When running multiple bots (via `bots.json`), sessions and group reply modes are fully isolated between bots. Each bot:

- Has its own Feishu/Telegram app and receives only its own messages
- Maintains its own session store
- Maintains its own persisted reply mode for each group
- Uses its own working directory and configuration
