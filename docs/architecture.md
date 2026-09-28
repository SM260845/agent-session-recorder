# Architecture

```
sources ──► adapter ──► Recorder.record() ──► store (JSONL) ──► exporters / viewer
                         │ research shrink (opt-in)
                         └ redaction (default on)
```

| Module | Role |
|---|---|
| `src/adapters/claude.ts` | `handleHook()` maps Claude Code hook JSON (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `SessionEnd`) to events. On `Stop` it reads new transcript lines for replies, reasoning, and usage. `importClaudeTranscript()` imports a whole transcript. |
| `src/adapters/codex.ts` | `CodexParser.feed(line)` maps Codex rollout lines. `importCodexSession()` imports a file, `tailCodexSession()` polls a live one. |
| `src/mcp.ts` | MCP server over stdio: `start_session`, `log_event`, `end_session`, `export`, plus resource `session-recorder://session/current`. |
| `src/recorder.ts` | The single write path. Runs research-mode `shrink()` on tool events, then redaction, then appends, and persists per-session state (placeholder map, pending tool calls). |
| `src/redact.ts` | Rules, the `Redactor` (salted-hash → placeholder state), and `shrink()`. |
| `src/store.ts` | `~/.agent-session-recorder/sessions/<id>.jsonl` + `<id>.state.json`, mode `0600`. Override the location with `AGENT_SESSION_RECORDER_HOME`. |
| `src/exporters.ts` | JSONL, Markdown (tool results nested under their calls by `parentId`), and self-contained HTML. |
| `src/viewer.ts`, `src/ui.ts` | HTTP server on `127.0.0.1` (default port 4318): `/api/sessions`, `/api/sessions/:id`, and WebSocket `/ws?session=<id>` for live events. Filters by actor and type. |
| `src/init.ts` | Detects `claude`/`codex`. It prints config by default. With `--write` it merges hooks into `~/.claude/settings.json` (keeping a `.bak`) and adds an MCP entry to `~/.codex/config.toml`. |

Exports are written to `~/.agent-session-recorder/exports/`, automatically on Claude `Stop`/`SessionEnd` and on MCP `end_session`.
