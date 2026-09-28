<!-- PR title = Conventional Commit, e.g. "feat(adapter): add grok cli import". It becomes the squash commit. -->

## What & why

Closes #

## Checklist

- [ ] `npm run build && npm test` pass locally
- [ ] Tests added/updated for the behaviour change
- [ ] **Redaction:** no rule weakened or bypassed. New inputs flow through `Recorder.record()`, and tests show planted (fake) secrets are removed
- [ ] No real session data, secrets, or PII in code, fixtures, or screenshots
- [ ] Schema changes are mirrored in `schema/event.schema.json` and `docs/event-schema.md`
- [ ] README/docs updated if user-facing behaviour changed
