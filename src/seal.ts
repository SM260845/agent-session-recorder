/**
 * Sealed sessions: tamper evidence for recorded agent sessions.
 *
 * 1. Hash chain: every event carries seal = { seq, prev, hash } where
 *    hash = sha256(prev || canonicalJSON(event without `seal`)).
 *    Editing, inserting, deleting or reordering any event breaks every later hash.
 * 2. Merkle batches: `seal <id>` builds a Merkle root over event hashes not yet
 *    batched and appends it to <id>.batches.jsonl, chained to the previous batch root.
 * 3. RFC 3161: the batch root can be timestamped by an external Time Stamping
 *    Authority, so the operator cannot silently rewrite the whole chain later.
 *
 * `verify <id>` checks all three offline. Full TSA certificate-chain validation
 * is left to `openssl ts -verify` (see docs/sealed-sessions.md).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SessionEvent } from './schema.js';
import { sessionsDir, safeId, readSession } from './store.js';

export const GENESIS = '0'.repeat(64);
export interface Seal { seq: number; prev: string; hash: string }
export interface Batch {
  v: 1; from: number; to: number; root: string; prevRoot: string; ts: string;
  tsa?: { url: string; tsr: string }; // base64 DER TimeStampResp
}

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

/** Deterministic JSON: sorted keys, no whitespace, undefined dropped. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export function eventHash(e: SessionEvent, prev: string): string {
  const { seal: _s, ...body } = e;
  return sha256(prev + canonical(body));
}

const headFile = (id: string) => path.join(sessionsDir(), `${safeId(id)}.seal.json`);
export const batchesFile = (id: string) => path.join(sessionsDir(), `${safeId(id)}.batches.jsonl`);

function loadHead(id: string): { seq: number; head: string } {
  try { return JSON.parse(fs.readFileSync(headFile(id), 'utf8')); } catch { /* rebuild */ }
  let seq = -1, head = GENESIS;
  for (const e of readSession(id)) if (e.seal) { seq = e.seal.seq; head = e.seal.hash; }
  return { seq, head };
}

/** Attach a chain seal to an event just before it is appended. */
export function sealEvent(e: SessionEvent): SessionEvent {
  const { seq, head } = loadHead(e.sessionId);
  const next = { ...e, seal: undefined } as SessionEvent;
  const seal: Seal = { seq: seq + 1, prev: head, hash: eventHash(next, head) };
  fs.writeFileSync(headFile(e.sessionId), JSON.stringify({ seq: seal.seq, head: seal.hash }), { mode: 0o600 });
  return { ...e, seal };
}

/** Merkle root (RFC 6962 style: 0x00 leaf / 0x01 node prefixes, odd node promoted). */
export function merkleRoot(leaves: string[]): string {
  if (!leaves.length) return sha256('');
  let level = leaves.map((h) => sha256(Buffer.concat([Buffer.from([0]), Buffer.from(h, 'hex')])));
  while (level.length > 1) {
    const up: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      up.push(i + 1 < level.length
        ? sha256(Buffer.concat([Buffer.from([1]), Buffer.from(level[i], 'hex'), Buffer.from(level[i + 1], 'hex')]))
        : level[i]);
    }
    level = up;
  }
  return level[0];
}

export function readBatches(id: string): Batch[] {
  try {
    return fs.readFileSync(batchesFile(id), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

/* ---------- RFC 3161 (minimal DER, no deps) ---------- */
function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const b: number[] = []; while (n) { b.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
const SHA256_OID = Buffer.from('0609608648016503040201', 'hex'); // 2.16.840.1.101.3.4.2.1

export function buildTimeStampReq(hashHex: string, nonce = crypto.randomBytes(8)): Buffer {
  const algId = tlv(0x30, Buffer.concat([SHA256_OID, Buffer.from([0x05, 0x00])]));
  const imprint = tlv(0x30, Buffer.concat([algId, tlv(0x04, Buffer.from(hashHex, 'hex'))]));
  const n = nonce[0] & 0x80 ? Buffer.concat([Buffer.from([0]), nonce]) : nonce;
  return tlv(0x30, Buffer.concat([tlv(0x02, Buffer.from([1])), imprint, tlv(0x02, n), Buffer.from([0x01, 0x01, 0xff])]));
}

/** Offline check: PKIStatus granted (0/1) and the token's messageImprint equals the root. */
export function checkTimeStampResp(tsr: Buffer, hashHex: string): string | null {
  // TimeStampResp ::= SEQUENCE { status PKIStatusInfo(SEQUENCE { INTEGER ... }), token }
  const statusIdx = tsr.indexOf(Buffer.from([0x02, 0x01]));
  if (statusIdx < 0 || statusIdx > 12) return 'unparseable TSA response';
  if (tsr[statusIdx + 2] > 1) return `TSA refused (status ${tsr[statusIdx + 2]})`;
  const needle = Buffer.concat([SHA256_OID, Buffer.from([0x05, 0x00, 0x04, 0x20]), Buffer.from(hashHex, 'hex')]);
  const alt = Buffer.concat([SHA256_OID, Buffer.from([0x04, 0x20]), Buffer.from(hashHex, 'hex')]); // NULL params omitted
  return tsr.includes(needle) || tsr.includes(alt) ? null : 'timestamp token does not cover this batch root';
}

export async function requestTimestamp(url: string, hashHex: string): Promise<Buffer> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/timestamp-query' }, body: new Uint8Array(buildTimeStampReq(hashHex)) });
  if (!res.ok) throw new Error(`TSA ${url} returned HTTP ${res.status}`);
  const tsr = Buffer.from(await res.arrayBuffer());
  const err = checkTimeStampResp(tsr, hashHex);
  if (err) throw new Error(err);
  return tsr;
}

/** Batch all sealed events not yet covered; optionally timestamp the root. */
export async function sealSession(id: string, opts: { tsa?: string } = {}): Promise<Batch | null> {
  const events = readSession(id).filter((e) => e.seal);
  const batches = readBatches(id);
  const last = batches.at(-1);
  const from = last ? last.to + 1 : 0;
  const pending = events.filter((e) => e.seal!.seq >= from);
  if (!pending.length) return null;
  const root = merkleRoot(pending.map((e) => e.seal!.hash));
  const batch: Batch = { v: 1, from, to: pending.at(-1)!.seal!.seq, root, prevRoot: last?.root ?? GENESIS, ts: new Date().toISOString() };
  if (opts.tsa) batch.tsa = { url: opts.tsa, tsr: (await requestTimestamp(opts.tsa, root)).toString('base64') };
  fs.appendFileSync(batchesFile(id), JSON.stringify(batch) + '\n', { mode: 0o600 });
  return batch;
}

export interface VerifyResult {
  ok: boolean; sessionId: string; events: number; sealed: number; batches: number;
  timestamped: number; unbatched: number; errors: string[];
}

export function verifySession(id: string, events: SessionEvent[] = readSession(id), batches: Batch[] = readBatches(id)): VerifyResult {
  const errors: string[] = [];
  let prev = GENESIS, expect = 0;
  const hashes: string[] = [];
  events.forEach((e, i) => {
    if (!e.seal) { errors.push(`line ${i + 1}: event ${e.id} is not sealed`); return; }
    if (e.seal.seq !== expect) errors.push(`line ${i + 1}: seq ${e.seal.seq}, expected ${expect} (event missing, inserted or reordered)`);
    if (e.seal.prev !== prev) errors.push(`line ${i + 1}: prev hash does not link to previous event`);
    if (eventHash(e, e.seal.prev) !== e.seal.hash) errors.push(`line ${i + 1}: event ${e.id} content was modified after sealing`);
    hashes[e.seal.seq] = e.seal.hash; prev = e.seal.hash; expect = e.seal.seq + 1;
  });
  let prevRoot = GENESIS, next = 0, timestamped = 0;
  batches.forEach((b, i) => {
    if (b.from !== next) errors.push(`batch ${i}: starts at ${b.from}, expected ${next}`);
    if (b.prevRoot !== prevRoot) errors.push(`batch ${i}: prevRoot does not link to previous batch`);
    const leaves = hashes.slice(b.from, b.to + 1);
    if (leaves.length !== b.to - b.from + 1 || leaves.some((h) => !h)) errors.push(`batch ${i}: covers events that are missing`);
    else if (merkleRoot(leaves) !== b.root) errors.push(`batch ${i}: Merkle root mismatch (events ${b.from}-${b.to} changed after batching)`);
    if (b.tsa) {
      const err = checkTimeStampResp(Buffer.from(b.tsa.tsr, 'base64'), b.root);
      if (err) errors.push(`batch ${i}: ${err}`); else timestamped++;
    }
    prevRoot = b.root; next = b.to + 1;
  });
  const sealed = events.filter((e) => e.seal).length;
  return { ok: errors.length === 0, sessionId: id, events: events.length, sealed, batches: batches.length, timestamped, unbatched: Math.max(0, expect - next), errors };
}
