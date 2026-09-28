---
name: agent-session-recorder
description: Log your plan, key decisions and outcome to the agent-session-recorder flight recorder via its MCP tools so humans can audit the session later.
---

# agent-session-recorder: flight-recorder logging

You can use the `agent-session-recorder` MCP server. It **only records what you send it**. It cannot see your
hidden reasoning, and you should never make up or rebuild hidden chain-of-thought.

## When to log

1. **Start of the task.** Call `start_session` with a short `title` (plus `model`/`provider` if you know them).
2. **Plan.** Call `log_event` with `actor:"ai"`, `type:"plan"` and `text` set to a few numbered steps.
3. **Decisions.** Whenever you pick between options (library, approach, deleting or overwriting
   something, skipping a test), call `log_event` with `type:"decision"`. Put the choice and a
   one-line reason in `text`, and add `payload.alternatives` if it helps.
4. **Errors / retries.** Use `type:"error"` and include what failed and what you will try next.
5. **Reasoning.** Only log reasoning text the provider actually exposed to you. Set `reasoningSource`
   to `full`, `summary` or `none`. If you are unsure, don't log reasoning. Log a `decision` instead.
6. **End.** Call `end_session` with an `outcome` (`success`, `partial`, `failed`, `abandoned`). This
   auto-exports JSONL, Markdown and HTML to `~/.agent-session-recorder/exports/`.

## Rules

- Keep entries short and factual. Don't paste secrets. Redaction is on, but it is a safety net, not a licence.
- Don't paste whole file dumps into `log_event`. Summarize them and give the path.
- If a Claude Code hook or the Codex tailer is also running, tool calls are already captured, so
  focus on plan, decision and outcome.
