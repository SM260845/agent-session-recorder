# Adapters

## Today

| Adapter | Input | Notes |
|---|---|---|
| Claude Code | hooks (`agent-session-recorder hook`, JSON on stdin) + transcript `~/.claude/projects/*/*.jsonl` | Tool timing measured Pre → Post. Reasoning is `summary` for Claude 4+, `full` for 3.7, `none` for redacted thinking. Never blocks the agent. |
| Codex CLI | rollout `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`codex import`, `codex tail`) | Reasoning summaries → `summary`, `encrypted_content` only → `none`. Non-zero exit code → `isError`. `token_count` → `usage`. |
| MCP | any MCP host calling `log_event` etc. | Only sees what the host sends. |

Both file adapters were built against documented formats and **synthetic** fixtures (`test/fixtures/`). Validation on real sessions is tracked in [#10](https://github.com/SM260845/agent-session-recorder/issues/10).

## Writing a new one

Use `src/adapters/codex.ts` as the template. It's a line-by-line parser, the simplest shape there is.

1. **Parse** native records into `EventInput[]`. Map them to `actor` + `type`, and fill `payload` with the fields the exporters already read (`text`, `name`/`input`, `output`/`isError`/`durationMs`).
2. **Link** each `tool.result` to its `tool.call` with `parentId`. Keep a `callId → {id, ts}` map so you can compute `durationMs`.
3. **Label reasoning honestly**: `full`, `summary`, or `none`.
4. **Record** only through `Recorder.record(events, rec.state(sessionId))`. That's where redaction happens.
5. **Test** with a tiny synthetic fixture: check event order, `validateEvent` returning `[]`, `parentId` linkage, and that a planted fake secret plus a `/home/<user>` path are both absent.
6. **Expose** it: a CLI subcommand in `src/cli.ts`, an export in `src/index.ts`, and a row in the README table and above.

Wanted: Grok CLI ([#2](https://github.com/SM260845/agent-session-recorder/issues/2)), direct APIs via proxy ([#1](https://github.com/SM260845/agent-session-recorder/issues/1)), OTel ingest ([#8](https://github.com/SM260845/agent-session-recorder/issues/8)).
