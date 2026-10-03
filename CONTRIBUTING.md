# Contributing

Thanks for stopping by. This project is small on purpose, so a focused PR can land fast.

## Setup

```bash
git clone https://github.com/ao3575911/agent-session-recorder && cd agent-session-recorder
npm ci          # Node >= 22.12
npm run build   # tsc -> dist/
npm test        # vitest
```

Tests use a throwaway data directory through `AGENT_SESSION_RECORDER_HOME` (see `test/helpers.ts`), so they never touch your real `~/.agent-session-recorder`.

## Where things live

| Path | What |
|---|---|
| `src/schema.ts`, `schema/event.schema.json` | Normalized event schema (keep both in sync) |
| `src/recorder.ts` | Redaction + research-mode pipeline. Every event goes through here |
| `src/redact.ts` | Built-in redaction rules, placeholder state, `shrink()` |
| `src/adapters/` | `claude.ts` (hooks + transcript), `codex.ts` (rollout import/tail) |
| `src/mcp.ts` | MCP server tools/resources |
| `src/exporters.ts`, `src/ui.ts`, `src/viewer.ts` | Markdown/HTML/JSONL export and the live viewer |
| `test/fixtures/` | **Synthetic** transcripts. Never commit real sessions |

More in [docs/](docs/).

## Adding an adapter

1. Create `src/adapters/<tool>.ts`. Parse the tool's native format into `EventInput[]` (see `src/schema.ts`). Set `provider`, `actor`, `type`, and `gen_ai.*` attributes where they're known.
2. Link each result to its call with `parentId`. Set `reasoningSource` to `full | summary | none` **only for what the provider actually exposes**. Never guess.
3. Write through `Recorder.record()`, which is what applies redaction. Don't call `appendEvent()` directly.
4. Add a small **synthetic** fixture under `test/fixtures/` and tests in `test/adapters.test.ts`. The tests should check event types and order, `validateEvent()` returning `[]`, `parentId` linkage, and that a planted secret doesn't show up in the output.
5. Wire a CLI command in `src/cli.ts`, export it from `src/index.ts`, and add a row to the README capture table and [docs/adapters.md](docs/adapters.md).

The full walkthrough is in [docs/adapters.md](docs/adapters.md).

## Pull requests

- Keep PRs small and focused. Open an issue or Discussion first for anything big.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR titles, e.g. `feat(adapter): add grok cli import`, `fix(redact): catch sk-svcacct keys`, `docs: …`, `test: …`, `chore: …`. PRs are squash-merged, so the PR title becomes the commit.
- `npm run build && npm test` must pass. CI runs on Node 22 and 24.
- Any change that touches redaction needs tests showing the secret is removed. PRs that weaken redaction won't be merged.

## Security

Don't open public issues for redaction misses that contain real data. See [SECURITY.md](SECURITY.md).

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
