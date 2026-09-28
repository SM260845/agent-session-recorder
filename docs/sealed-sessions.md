# Sealed sessions

Tamper evidence for recorded sessions. Three layers, all local, no new dependencies.

1. **Hash chain (automatic).** Every event written gets `seal: { seq, prev, hash }`, where
   `hash = sha256(prev + canonicalJSON(event without seal))`. The first `prev` is 64 zeros.
   Editing, deleting, inserting or reordering an event breaks the chain from that point on.
2. **Merkle batches (`seal <id>`).** Builds an RFC 6962-style Merkle root over every event
   not yet batched and appends it to `<id>.batches.jsonl`, linked to the previous batch root.
3. **RFC 3161 timestamp (`seal <id> --timestamp`, or `--tsa <url>`).** Sends the batch root to a Time Stamping
   Authority (default `https://freetsa.org/tsr`) and stores the signed response. This anchors
   the root outside your machine, so rewriting and re-chaining the whole log is detectable.

```bash
agent-session-recorder seal <id> --timestamp  # batch + timestamp new events
agent-session-recorder verify <id>            # OK, or TAMPERED with the exact lines (exit 2)
agent-session-recorder verify <id> --json
```

## What verify proves, and what it doesn't

- Proves the log hasn't changed since each event was written (chain) and since each batch was
  sealed (Merkle root). With a timestamp, it proves the batch existed at the TSA's time.
- `verify` checks the TSA response status and that its message imprint equals the batch root.
  It does **not** validate the TSA's certificate chain. For that, extract the token and run
  `openssl ts -verify -digest <root> -in <resp.tsr> -CAfile <tsa-ca.pem> -untrusted <tsa.crt>`.
- It can't prove the recorder was told the truth. A compromised host can log lies from the start.
  Capturing at a proxy or gateway reduces that risk; sealing doesn't remove it.
- Events not yet batched are protected only by the local chain. An attacker with write access can
  re-chain them. Seal often (for example, on `session.end`).
- Concurrent writers to one session (parallel hook processes) can race on `seq`. `verify` will
  report that as a sequence error rather than hide it.

Sessions recorded before this feature have unsealed events, and `verify` reports them as unsealed.
