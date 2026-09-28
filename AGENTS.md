# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Grok, Copilot, …) working in this repo. Humans are welcome to read along.

## Commands

```bash
npm ci
npm run build     # tsc -p tsconfig.json -> dist/
npm test          # vitest run. Must pass before you finish
```

Node >= 22.12. ESM only (`"type": "module"`). Use `.js` extensions in relative TypeScript imports.

## Hard rules

1. **Never weaken redaction.** Don't remove or loosen rules in `src/redact.ts`, and don't bypass `Recorder.record()`. Redaction must run before any write or stream, and it stays on by default. If a rule causes false positives, narrow it **and** add tests for both the hit and the miss.
2. **Never commit real session data or real secrets**, even in tests. Fixtures in `test/fixtures/` are synthetic. Planted test secrets should be obviously fake (`xai-ABCDEFGHIJKLMNOPQRSTUVWX`).
3. **Be honest about reasoning.** Only record reasoning the provider actually exposes, and label it `reasoningSource: full | summary | none`. Never claim hidden chain-of-thought.
4. **Local-first.** Add no network calls, telemetry, or new runtime dependencies without an issue that discusses it first.
5. **Keep the schema in sync.** When you change `src/schema.ts`, update `schema/event.schema.json` and `docs/event-schema.md` too.

## Test requirements

- Every behaviour change comes with a vitest test in `test/`.
- Adapter changes: test event order, `validateEvent(e)` returning `[]`, `parentId` linkage, and that planted secrets and home-dir usernames are absent from the output.
- Redaction changes: add cases to `test/redact.test.ts`.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`), with an optional scope (`feat(adapter): …`).
- Small, readable modules. Match the existing style and don't reformat unrelated code.
- Update README/docs when user-facing behaviour changes. Don't invent features or numbers.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/](docs/).
