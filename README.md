# agent-blackbox

**A local-first flight recorder for AI coding and agent sessions.** It records what happened in a
session (prompts, visible replies, reasoning the provider exposed, tool calls with args, results,
timing and errors, decisions, and session metadata) as one normalized JSONL timeline. You can
export it to Markdown or a self-contained HTML file, or watch it live in a small local viewer.

- **Local-first.** Everything goes to `~/.agent-blackbox/`. There is no network, telemetry or cloud.
- **Redaction is always on** unless you pass `--no-redact`. It runs *before* anything is written or streamed.
- **Honest about reasoning.** Only provider-exposed reasoning is stored, and each entry is labelled
  `reasoningSource: full | summary | none`. We never claim to capture hidden chain-of-thought.

> Status: **v0.1 (lean v1)**. The Claude Code and Codex CLI adapters were built against the documented
> file/hook formats and tested with **small synthetic fixtures** (`test/fixtures/`). No real
> Claude Code or Codex sessions were available when this was built. Please open an issue if your
> real transcripts differ.

## Quickstart

Not published to npm yet. Note that the npm name `agent-blackbox` is already taken by an unrelated package.

```bash
git clone https://github.com/SM260845/agent-blackbox && cd agent-blackbox
npm ci && npm run build && npm link      # provides the `agent-blackbox` command
agent-blackbox init                      # dry-run: detects claude/codex and prints the config
agent-blackbox init --write              # merges hooks into ~/.claude/settings.json (+ .bak) and adds MCP to ~/.codex/config.toml
agent-blackbox view                      # http://127.0.0.1:4318 live timeline
```

| Command | What it does |
|---|---|
| `agent-blackbox hook` | Claude Code hook handler (reads hook JSON on stdin; never blocks the agent) |
| `agent-blackbox import-claude <file>` | Import a `~/.claude/projects/*/*.jsonl` transcript |
| `agent-blackbox codex import <file\|--latest>` | Import a Codex rollout from `~/.codex/sessions/**/rollout-*.jsonl` |
| `agent-blackbox codex tail [--latest]` | Follow a live Codex session file |
| `agent-blackbox mcp` | MCP server on stdio (`start_session`, `log_event`, `end_session`, `export`; resource `blackbox://session/current`) |
| `agent-blackbox export <id> [--format md,html,jsonl] [--out dir]` | Export a session |
| `agent-blackbox view [--port N]` | Local HTTP + WebSocket viewer with nested tool calls and actor/type filters |
| `agent-blackbox list` / `redact` | List sessions / redact stdin (to test your rules) |

Flags: `--no-redact` and `--research`. Research mode truncates big tool outputs to `{sha256, size, head}`
and replaces repeated file dumps with `{duplicateOf}`.

## What each provider exposes

| Source | Prompts | Visible replies | Reasoning | Tool calls / results | Timing | Tokens / model |
|---|---|---|---|---|---|---|
| **Claude Code hooks + transcript** | ✅ `UserPromptSubmit` | ✅ from transcript on `Stop` | `summary` for Claude 4+ summarized thinking, `full` for 3.7, `none` for redacted thinking | ✅ `PreToolUse`/`PostToolUse` | ✅ measured Pre→Post | ✅ from transcript `usage` |
| **Codex CLI rollout files** | ✅ | ✅ | `summary` (reasoning summaries); `none` when only `encrypted_content` | ✅ `function_call`/`_output` (exit code → error) | ✅ from timestamps | ✅ `token_count` |
| **MCP (any host, e.g. Grok, Claude Desktop)** | only if the agent logs it | only if the agent logs it | only what the agent sends | only what the agent sends | event timestamps | only if sent |
| Claude / OpenAI / xAI **APIs** directly | _deferred: API proxy_ | | xAI `reasoning_content` via proxy is deferred | | | |

**The MCP server only sees what the host sends it.** It cannot observe the host's own prompts, hidden
reasoning, or tool calls made outside MCP. [`SKILL.md`](SKILL.md) tells agents to log their plan,
decisions and outcome.

## Event schema

TypeScript: [`src/schema.ts`](src/schema.ts). JSON Schema: [`schema/event.schema.json`](schema/event.schema.json).

```json
{"id":"…","parentId":"<tool.call id>","ts":"2026-09-28T10:00:03.500Z","sessionId":"…","actor":"tool",
 "type":"tool.result","provider":"claude-code","payload":{"output":"…","isError":false,"durationMs":1500},
 "attributes":{"gen_ai.system":"anthropic","gen_ai.tool.name":"Read"}}
```

- `actor` is one of `user | ai | tool | system`.
- `type` is one of `session.start | session.end | prompt | reply | reasoning | tool.call | tool.result | plan | decision | note | usage | error`.
- `attributes` follow the OpenTelemetry GenAI conventions (`gen_ai.system`, `gen_ai.request.model`,
  `gen_ai.usage.input_tokens`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, …).
- Storage is one JSONL file per session in `~/.agent-blackbox/sessions/`. Exports go to `~/.agent-blackbox/exports/`,
  and are written automatically on `Stop`/`SessionEnd` hooks and on MCP `end_session`.

## Privacy and redaction

Built-in regex rules produce typed, consistent placeholders (`[EMAIL_1]`, `[API_KEY_2]` and so on). They cover:

- emails and phone numbers
- API keys and tokens: `sk-`/`sk-ant-`/`sk-proj-`, `xai-`, `ghp_`/`github_pat_`, AWS `AKIA…`, Google `AIza…`, Slack `xox…`, npm, JWTs, `Bearer` tokens, PEM private keys
- IPv4 addresses (localhost is kept)
- credit cards (only when the Luhn check passes)
- home-directory usernames (`/home/<user>`, `/Users/<user>`, `C:\Users\<user>`)
- `*_TOKEN=` / `*SECRET*=` / `*PASSWORD=` env-style secrets (the name is kept)

Placeholders stay consistent across hook invocations in a session. Only a **salted hash → placeholder** map is
persisted, never the raw values. Files are created with mode `0600`.

You can edit the rules in `~/.agent-blackbox/redact-rules.json`. See [`examples/redact-rules.example.json`](examples/redact-rules.example.json):
`rules` (custom regexes, which run first), `disable` (built-in rule names) and `allow` (literal values to keep).

Regex redaction is best-effort. Review exports before sharing them. Local NER redaction is on the roadmap.

## Demo session

[`examples/`](examples/) has synthetic, redacted sessions generated from the test fixtures:
`claude-fixture-1.{md,html,jsonl}` and `codex-fixture-1.{md,html,jsonl}`. Open the `.html` file in a browser.

## Roadmap (deferred)

API proxy (OpenAI/Anthropic formats), Grok CLI adapter, xAI `reasoning_content` via proxy, local NER
redaction, session diff view, token/cost charts, anonymized dataset export, OTel ingest, and optional
cloud sync. See the GitHub issues.

## Development

```bash
npm ci && npm run build && npm test   # Node ≥ 22.12, vitest
```

MIT licensed.
