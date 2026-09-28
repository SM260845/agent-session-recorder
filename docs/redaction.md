# Redaction

Redaction is **on by default** and runs inside `Recorder.record()` **before** any event is written or streamed. `--no-redact` turns it off. Please don't.

## Built-in rules (`DEFAULT_RULES` in `src/redact.ts`)

| Placeholder | Catches |
|---|---|
| `PRIVATE_KEY` | PEM private key blocks |
| `SECRET` | values of `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*API_KEY*`, `*ACCESS_KEY*`, `*CREDENTIAL*`-style `NAME=value` / `NAME: value` (the name is kept) |
| `API_KEY` | `sk-ant-`, `sk-`/`sk-proj-`/`sk-svcacct-`, `xai-`, `ghp_`/`gho_`/…, `github_pat_`, AWS `AKIA`/`ASIA`, Google `AIza`, Slack `xox?-`, `npm_` |
| `JWT`, `TOKEN` | JWTs, `Bearer …` tokens |
| `EMAIL`, `PHONE` | emails, phone numbers |
| `CREDIT_CARD` | 13–19 digit numbers that pass Luhn |
| `IP` | IPv4 (localhost kept) |
| `USER` | usernames in `/home/<u>`, `/Users/<u>`, `C:\Users\<u>` |

Values become typed placeholders (`[EMAIL_1]`, `[API_KEY_2]`) that stay consistent across a session. Only a **salted sha256 → placeholder** map is persisted, never the raw values.

## Custom rules

Edit `~/.agent-session-recorder/redact-rules.json` (example: [`examples/redact-rules.example.json`](../examples/redact-rules.example.json)):

- `rules`: extra regexes `{name, pattern, flags?, group?}`. These run first.
- `disable`: names of built-in rules to turn off.
- `allow`: literal values to keep.

Test your rules with `echo 'text' | agent-session-recorder redact`.

## Limits and reporting

This is regex matching, so it's best-effort. Names, addresses, and free-form secrets can slip through. Local NER is planned ([#4](https://github.com/SM260845/agent-session-recorder/issues/4)). Review exports before you share them.

Found a miss? Use the *Redaction miss* issue form **with a fake value of the same shape**. If a real value leaked, report it privately ([SECURITY.md](../SECURITY.md)).
