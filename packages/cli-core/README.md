# @xvirobotics/cli-core

Shared building blocks for metabot-core CLIs (`mm`, `mh`, future `metabot`).
Holds the canonical implementations of:

- **config** — `loadConfig()` / `tokenFilePath()` / `DEFAULT_URL`
- **client** — `request<T>()` with Bearer auth + JSON handling
- **args** — `parseArgs(argv)` (`--name value`, `--name=value`, `-n value`, `--` terminator)
- **print** — `print(body)` (string passthrough or pretty JSON)

## Usage

Import a named subpath to avoid pulling everything:

```ts
import { loadConfig } from '@xvirobotics/cli-core/config';
import { request } from '@xvirobotics/cli-core/client';
import { parseArgs } from '@xvirobotics/cli-core/args';
import { print } from '@xvirobotics/cli-core/print';
```

Or grab the whole barrel:

```ts
import { loadConfig, request, parseArgs, print } from '@xvirobotics/cli-core';
```

## Environment contract

- `METABOT_CORE_URL` — server base URL (default `http://localhost:9200`, dedicated front-door domain since P4-MR6)
- `METABOT_CORE_TOKEN` — bearer token; falls back to first line of `~/.metabot-core/token`

`loadConfig()` throws when no token is configured.
