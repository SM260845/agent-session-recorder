import fs from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpHome } from './helpers.js';
import { Recorder } from '../src/recorder.js';
import { readSession, sessionFile } from '../src/store.js';
import { sealSession, verifySession, merkleRoot, canonical, buildTimeStampReq, checkTimeStampResp, readBatches } from '../src/seal.js';

function record(n: number, id = 's1') {
  const rec = new Recorder({ redact: false });
  for (let i = 0; i < n; i++) rec.record({ sessionId: id, actor: 'user', type: 'prompt', payload: { text: `p${i}` } });
  return id;
}
const rewrite = (id: string, f: (lines: string[]) => string[]) => {
  const p = sessionFile(id);
  fs.writeFileSync(p, f(fs.readFileSync(p, 'utf8').trim().split('\n')).join('\n') + '\n');
};

beforeEach(() => { tmpHome(); });

describe('sealed sessions', () => {
  it('chains every event and verifies clean', async () => {
    const id = record(5);
    const ev = readSession(id);
    expect(ev.map((e) => e.seal!.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(ev[1].seal!.prev).toBe(ev[0].seal!.hash);
    await sealSession(id);
    record(2); await sealSession(id);
    const r = verifySession(id);
    expect(r).toMatchObject({ ok: true, sealed: 7, batches: 2, unbatched: 0 });
    expect(readBatches(id)[1].prevRoot).toBe(readBatches(id)[0].root);
  });
  it('detects an edited event', async () => {
    const id = record(4); await sealSession(id);
    rewrite(id, (l) => { l[2] = l[2].replace('p2', 'pX'); return l; });
    const r = verifySession(id);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/modified after sealing/);
  });
  it('detects a deleted event and a reorder', () => {
    const id = record(4);
    rewrite(id, (l) => [l[0], l[2], l[3]]);
    expect(verifySession(id).errors.join()).toMatch(/expected 1/);
    rewrite(id, (l) => [l[1], l[0], l[2]]);
    expect(verifySession(id).ok).toBe(false);
  });
  it('detects a fully re-chained rewrite once batched', async () => {
    const id = record(3); await sealSession(id);
    const batches = readBatches(id);
    // attacker rewrites the log and re-seals from scratch; old batch root no longer matches
    fs.rmSync(sessionFile(id)); fs.rmSync(sessionFile(id).replace('.jsonl', '.seal.json'));
    const rec = new Recorder({ redact: false });
    for (const t of ['a', 'b', 'c']) rec.record({ sessionId: id, actor: 'user', type: 'prompt', payload: { text: t } });
    expect(verifySession(id, readSession(id), batches).errors.join()).toMatch(/Merkle root mismatch/);
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonical({ b: 1, a: { d: 2, c: [1, { z: 0, y: 1 }] } })).toBe(canonical({ a: { c: [1, { y: 1, z: 0 }], d: 2 }, b: 1 }));
  });
  it('merkle root depends on every leaf and order', () => {
    const h = (c: string) => c.repeat(64);
    expect(merkleRoot([h('a'), h('b'), h('c')])).not.toBe(merkleRoot([h('b'), h('a'), h('c')]));
  });
  it('builds a DER TimeStampReq and checks imprint in a response', () => {
    const root = 'ab'.repeat(32);
    const req = buildTimeStampReq(root);
    expect(req[0]).toBe(0x30);
    expect(req.includes(Buffer.from(root, 'hex'))).toBe(true);
    const fakeResp = Buffer.concat([Buffer.from('30820000300302010030', 'hex'), req]);
    expect(checkTimeStampResp(fakeResp, root)).toBeNull();
    expect(checkTimeStampResp(fakeResp, 'cd'.repeat(32))).toMatch(/does not cover/);
  });
});

describe('proof bundle', () => {
  it('links intent and commit inside the sealed chain', async () => {
    const os = await import('node:os'); const path = await import('node:path');
    const { writeBundle } = await import('../src/bundle.js');
    const id = record(2, 'b1');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-'));
    const file = await writeBundle(id, { intent: '20260929-demo', commit: 'a'.repeat(40), cwd: dir });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const b = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(b).toMatchObject({ v: 1, intent: '20260929-demo', commit: 'a'.repeat(40) });
    expect(b.events.at(-1).payload).toMatchObject({ kind: 'proof.link', intent: '20260929-demo', commit: 'a'.repeat(40) });
    expect(verifySession(id, b.events, b.batches).ok).toBe(true);
    await expect(writeBundle(id, { intent: 'bad id', commit: 'x' })).rejects.toThrow(/YYYYMMDD/);
  });
});
