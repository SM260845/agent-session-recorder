/**
 * Proof bundles for proof-carrying PRs.
 *
 * `bundle <sessionId> --intent <id>` records a `note` event of kind `proof.link`
 * carrying the intent id and the current git HEAD into the session, seals the
 * session (optionally with an RFC 3161 timestamp), and writes `.proof/<intent>.json`.
 * Because the link event is inside the hash chain and the Merkle batch, the intent
 * id and commit can't be swapped later without breaking verification.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Recorder } from './recorder.js';
import { readSession } from './store.js';
import { readBatches, sealSession, verifySession } from './seal.js';

export interface ProofBundle {
  v: 1; intent: string; sessionId: string; commit: string; createdAt: string;
  events: unknown[]; batches: unknown[];
}

export async function writeBundle(sessionId: string, opts: { intent: string; outDir?: string; tsa?: string; commit?: string; cwd?: string }): Promise<string> {
  if (!/^\d{8}-[a-z0-9-]+$/.test(opts.intent)) throw new Error(`intent id must look like YYYYMMDD-slug, got "${opts.intent}"`);
  if (!readSession(sessionId).length) throw new Error(`no session "${sessionId}"`);
  const commit = opts.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: opts.cwd, encoding: 'utf8' }).trim();
  const [link] = new Recorder().record({ sessionId, actor: 'system', type: 'note', payload: { kind: 'proof.link', intent: opts.intent, commit } });
  await sealSession(sessionId, { tsa: opts.tsa });
  const v = verifySession(sessionId);
  if (!v.ok) throw new Error(`session does not verify, refusing to bundle:\n  ${v.errors.join('\n  ')}`);
  const bundle: ProofBundle = {
    v: 1,
    intent: opts.intent,
    sessionId,
    commit: String((link.payload as { commit?: string }).commit ?? commit),
    createdAt: new Date().toISOString(),
    events: readSession(sessionId),
    batches: readBatches(sessionId),
  };
  const dir = path.resolve(opts.cwd ?? '.', opts.outDir ?? '.proof');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${opts.intent}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 1) + '\n', { mode: 0o600 });
  return file;
}
