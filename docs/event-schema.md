# Event schema (v1)

Source of truth: [`src/schema.ts`](../src/schema.ts). JSON Schema: [`schema/event.schema.json`](../schema/event.schema.json). One event per JSONL line.

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID |
| `parentId` | string \| null | e.g. `tool.result` → its `tool.call` |
| `ts` | string | ISO-8601 |
| `sessionId` | string | |
| `actor` | `user \| ai \| tool \| system` | |
| `type` | see below | |
| `payload` | object | type-specific (`text`, `name`/`input`, `output`/`isError`/`durationMs`, `usage`, …) |
| `provider` | string? | `claude-code`, `codex-cli`, `mcp`, … |
| `reasoningSource` | `full \| summary \| none`? | only for reasoning the provider exposed |
| `attributes` | object? | OpenTelemetry GenAI names: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.conversation.id`, `gen_ai.operation.name` |

`type` is one of `session.start`, `session.end`, `prompt`, `reply`, `reasoning`, `tool.call`, `tool.result`, `plan`, `decision`, `note`, `usage`, `error`.

```json
{"id":"…","parentId":"<tool.call id>","ts":"2026-09-28T10:00:03.500Z","sessionId":"…","actor":"tool",
 "type":"tool.result","provider":"claude-code","payload":{"output":"…","isError":false,"durationMs":1500},
 "attributes":{"gen_ai.system":"anthropic","gen_ai.tool.name":"Read"}}
```

`validateEvent(e)` returns a list of problems (empty means valid). If you change the schema, update the TS types, the JSON Schema, and this page together.
