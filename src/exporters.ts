import fs from 'node:fs';
import path from 'node:path';
import type { BlackboxEvent } from './schema.js';
import { exportsDir, readSession, safeId, ensureDirs } from './store.js';
import { renderPage } from './ui.js';

export type ExportFormat = 'jsonl' | 'md' | 'html';

export function toJsonl(events: BlackboxEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
}

function fence(s: string): string {
  const ticks = s.includes('```') ? '````' : '```';
  return `${ticks}\n${s}\n${ticks}`;
}

function describe(e: BlackboxEvent): string {
  const p = e.payload as Record<string, unknown>;
  if (typeof p.text === 'string') return p.text;
  if (e.type === 'tool.call') return fence(`${p.name ?? ''} ${JSON.stringify(p.input ?? p.args ?? {}, null, 2)}`);
  if (e.type === 'tool.result') {
    const o = p.output ?? p.result;
    const meta = [p.isError ? 'error' : 'ok', p.durationMs != null ? `${p.durationMs} ms` : ''].filter(Boolean).join(', ');
    return `_${meta}_\n\n` + fence(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
  }
  return fence(JSON.stringify(p, null, 2));
}

export function toMarkdown(events: BlackboxEvent[]): string {
  if (!events.length) return '# agent-blackbox session\n\n_No events._\n';
  const start = events.find((e) => e.type === 'session.start');
  const end = events.find((e) => e.type === 'session.end');
  const sp = (start?.payload ?? {}) as Record<string, unknown>;
  const lines = [`# agent-blackbox session \`${events[0].sessionId}\``, ''];
  lines.push('| field | value |', '|---|---|');
  const rows: [string, unknown][] = [
    ['provider', start?.provider ?? events[0].provider], ['model', sp.model], ['cwd', sp.cwd],
    ['start', start?.ts ?? events[0].ts], ['end', end?.ts ?? events[events.length - 1].ts],
    ['outcome', (end?.payload as Record<string, unknown> | undefined)?.outcome], ['events', events.length],
  ];
  for (const [k, v] of rows) if (v !== undefined && v !== null && v !== '') lines.push(`| ${k} | ${String(v).replace(/\|/g, '\\|')} |`);
  lines.push('');
  const children = new Map<string, BlackboxEvent[]>();
  const ids = new Set(events.map((e) => e.id));
  for (const e of events) if (e.parentId && ids.has(e.parentId)) children.set(e.parentId, [...(children.get(e.parentId) ?? []), e]);
  const emit = (e: BlackboxEvent, depth: number) => {
    const h = '#'.repeat(Math.min(3 + depth, 6));
    const rs = e.reasoningSource ? ` · reasoning: ${e.reasoningSource}` : '';
    lines.push(`${h} ${e.actor} · ${e.type} · ${e.ts}${rs}`, '', describe(e), '');
    for (const c of children.get(e.id) ?? []) emit(c, depth + 1);
  };
  for (const e of events) if (!(e.parentId && ids.has(e.parentId))) emit(e, 0);
  return lines.join('\n');
}

export function toHtml(events: BlackboxEvent[]): string {
  return renderPage({ title: `agent-blackbox ${events[0]?.sessionId ?? ''}`, events });
}

export function render(events: BlackboxEvent[], format: ExportFormat): string {
  if (format === 'jsonl') return toJsonl(events);
  if (format === 'md') return toMarkdown(events);
  if (format === 'html') return toHtml(events);
  throw new Error(`unknown format ${format}`);
}

/** Export a stored session; returns written file paths. */
export function exportSession(sessionId: string, formats: ExportFormat[] = ['jsonl', 'md', 'html'], outDir = exportsDir()): string[] {
  ensureDirs();
  fs.mkdirSync(outDir, { recursive: true });
  const events = readSession(sessionId);
  return formats.map((f) => {
    const file = path.join(outDir, `${safeId(sessionId)}.${f}`);
    fs.writeFileSync(file, render(events, f), { mode: 0o600 });
    return file;
  });
}
