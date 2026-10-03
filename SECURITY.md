# Security Policy

## Supported versions

Only the latest release on `main` (currently v0.1.x) gets fixes.

## Reporting a vulnerability

Report privately through **[GitHub private vulnerability reporting](https://github.com/ao3575911/agent-session-recorder/security/advisories/new)**. Please don't use a public issue.

**Redaction bugs are security bugs.** If a secret or piece of personal data gets through to the stored JSONL, an export, or the live viewer, report it here. Describe the *shape* of the value (e.g. "AWS session token with a `ASIA` prefix inside a JSON string"). **Never include the real value.** A made-up value that has the same shape is ideal.

Also in scope:

- the viewer exposing data beyond `127.0.0.1`
- `init --write` damaging or leaking config files
- session files created with permissions looser than `0600`

You'll get an acknowledgement as soon as the maintainer can. Fixes are released with credit unless you'd rather stay anonymous.
