import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionEvent } from './schema.js';

export function homeDir(): string {
  return process.env.AGENT_SESSION_RECORDER_HOME || path.join(os.homedir(), '.agent-session-recorder');
}
export const sessionsDir = () => path.join(homeDir(), 'sessions');
export const exportsDir = () => path.join(homeDir(), 'exports');
export const safeId = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_');
export const sessionFile = (id: string) => path.join(sessionsDir(), `${safeId(id)}.jsonl`);
export const stateFile = (id: string) => path.join(sessionsDir(), `${safeId(id)}.state.json`);
const currentFile = () => path.join(homeDir(), 'current-session');

export function ensureDirs(): void {
  fs.mkdirSync(sessionsDir(), { recursive: true, mode: 0o700 });
  fs.mkdirSync(exportsDir(), { recursive: true, mode: 0o700 });
}

export function appendEvent(e: SessionEvent): void {
  ensureDirs();
  fs.appendFileSync(sessionFile(e.sessionId), JSON.stringify(e) + '\n', { mode: 0o600 });
}

export function readSession(id: string): SessionEvent[] {
  const f = sessionFile(id);
  if (!fs.existsSync(f)) return [];
  return parseJsonl(fs.readFileSync(f, 'utf8')) as SessionEvent[];
}

export function parseJsonl(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip malformed line */ }
  }
  return out;
}

export function listSessions(): { id: string; mtime: string; size: number }[] {
  if (!fs.existsSync(sessionsDir())) return [];
  return fs.readdirSync(sessionsDir())
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const st = fs.statSync(path.join(sessionsDir(), f));
      return { id: f.slice(0, -6), mtime: st.mtime.toISOString(), size: st.size };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function loadState<T>(id: string, fallback: T): T {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(stateFile(id), 'utf8')) }; } catch { return fallback; }
}
export function saveState(id: string, state: unknown): void {
  ensureDirs();
  fs.writeFileSync(stateFile(id), JSON.stringify(state), { mode: 0o600 });
}
export function setCurrentSession(id: string | null): void {
  ensureDirs();
  if (id) fs.writeFileSync(currentFile(), id); else fs.rmSync(currentFile(), { force: true });
}
export function getCurrentSession(): string | null {
  try { return fs.readFileSync(currentFile(), 'utf8').trim() || null; } catch { return null; }
}
