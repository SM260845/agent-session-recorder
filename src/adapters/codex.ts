/**
 * Codex CLI adapter: imports / tails rollout session files under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
 * Each line: {timestamp, type: "session_meta"|"turn_context"|"response_item"|"event_msg", payload}.
 * response_item payload types: message, reasoning (summary + encrypted_content), function_call,
 * function_call_output, custom_tool_call(_output). Built against documented format + synthetic fixtures.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EventInput } from '../schema.js';
import { Recorder, newId } from '../recorder.js';

const PROVIDER = 'codex-cli';
const SYSTEM = { 'gen_ai.system': 'openai' };

export class CodexParser {
  sessionId: string;
  model?: string;
  private calls = new Map<string, { id: string; ts: string }>();
  constructor(fallbackId = 'codex-import') { this.sessionId = fallbackId; }

  feed(line: string): EventInput[] {
    let raw: any;
    try { raw = JSON.parse(line); } catch { return []; }
    const ts: string = raw.timestamp ?? new Date().toISOString();
    const p = raw.payload ?? {};
    const base = () => ({ sessionId: this.sessionId, provider: PROVIDER, ts });
    const text = (content: any) => Array.isArray(content) ? content.map((c: any) => c.text ?? '').join('') : String(content ?? '');
    switch (raw.type) {
      case 'session_meta':
        if (p.id) this.sessionId = String(p.id);
        return [{ ...base(), actor: 'system', type: 'session.start', payload: { cwd: p.cwd, cliVersion: p.cli_version, originator: p.originator, modelProvider: p.model_provider, source: 'codex-rollout' }, attributes: { ...SYSTEM, 'gen_ai.conversation.id': this.sessionId } }];
      case 'turn_context':
        if (p.model && p.model !== this.model) {
          this.model = p.model;
          return [{ ...base(), actor: 'system', type: 'note', payload: { model: p.model, approvalPolicy: p.approval_policy, sandbox: p.sandbox_policy?.mode ?? p.sandbox_policy }, attributes: { ...SYSTEM, 'gen_ai.request.model': p.model } }];
        }
        return [];
      case 'response_item':
        switch (p.type) {
          case 'message': {
            const t = text(p.content);
            if (p.role === 'user') {
              if (/^\s*<(environment_context|user_instructions)/.test(t)) return [{ ...base(), actor: 'system', type: 'note', payload: { text: t } }];
              return [{ ...base(), actor: 'user', type: 'prompt', payload: { text: t } }];
            }
            if (p.role === 'assistant') return [{ ...base(), actor: 'ai', type: 'reply', payload: { text: t }, attributes: { ...SYSTEM, ...(this.model ? { 'gen_ai.response.model': this.model } : {}) } }];
            return [{ ...base(), actor: 'system', type: 'note', payload: { role: p.role, text: t } }];
          }
          case 'reasoning': {
            const summary = Array.isArray(p.summary) ? p.summary.map((s: any) => s.text ?? '').join('\n') : '';
            return [{ ...base(), actor: 'ai', type: 'reasoning', reasoningSource: summary ? 'summary' : 'none', payload: { text: summary, encrypted: !!p.encrypted_content } }];
          }
          case 'function_call':
          case 'custom_tool_call':
          case 'local_shell_call': {
            const id = newId();
            let input: unknown = p.arguments ?? p.input ?? p.action;
            if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* keep string */ } }
            if (p.call_id) this.calls.set(p.call_id, { id, ts });
            return [{ ...base(), id, actor: 'ai', type: 'tool.call', payload: { name: p.name ?? p.type, input, callId: p.call_id }, attributes: { ...SYSTEM, 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': String(p.name ?? p.type), ...(p.call_id ? { 'gen_ai.tool.call.id': p.call_id } : {}) } }];
          }
          case 'function_call_output':
          case 'custom_tool_call_output': {
            const call = this.calls.get(p.call_id);
            let output: any = p.output;
            if (typeof output === 'string') { try { output = JSON.parse(output); } catch { /* keep */ } }
            const exit = output?.metadata?.exit_code;
            return [{ ...base(), parentId: call?.id ?? null, actor: 'tool', type: 'tool.result', payload: { output, callId: p.call_id, isError: typeof exit === 'number' ? exit !== 0 : false, durationMs: call ? Date.parse(ts) - Date.parse(call.ts) : undefined } }];
          }
          default:
            return [];
        }
      case 'event_msg':
        if (p.type === 'token_count' && p.info) {
          const u = p.info.last_token_usage ?? p.info.total_token_usage ?? {};
          return [{ ...base(), actor: 'system', type: 'usage', payload: { usage: p.info }, attributes: { ...SYSTEM, ...(this.model ? { 'gen_ai.response.model': this.model } : {}), 'gen_ai.usage.input_tokens': Number(u.input_tokens ?? 0), 'gen_ai.usage.output_tokens': Number(u.output_tokens ?? 0) } }];
        }
        return []; // user_message/agent_message duplicate response_items
      default:
        return [];
    }
  }
}

export function importCodexSession(file: string, rec = new Recorder()): { sessionId: string; events: number } {
  const parser = new CodexParser(path.basename(file, '.jsonl'));
  const evs = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => parser.feed(l));
  for (const e of evs) e.sessionId = parser.sessionId; // session_meta may arrive first but be safe
  evs.push({ sessionId: parser.sessionId, provider: PROVIDER, actor: 'system', type: 'session.end', ts: evs[evs.length - 1]?.ts, payload: { outcome: 'imported' } });
  rec.record(evs, rec.state(parser.sessionId));
  return { sessionId: parser.sessionId, events: evs.length };
}

export function latestCodexSession(root = path.join(os.homedir(), '.codex', 'sessions')): string | null {
  let best: { f: string; m: number } | null = null;
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.jsonl')) { const m = fs.statSync(f).mtimeMs; if (!best || m > best.m) best = { f, m }; }
    }
  };
  walk(root);
  return (best as { f: string } | null)?.f ?? null;
}

/** Tail a rollout file, recording new events as they are appended. Returns a stop function. */
export function tailCodexSession(file: string, rec = new Recorder(), onEvents?: (n: number) => void, intervalMs = 500): () => void {
  const parser = new CodexParser(path.basename(file, '.jsonl'));
  let offset = 0;
  let buf = '';
  const pump = () => {
    const size = fs.statSync(file).size;
    if (size <= offset) return;
    const fd = fs.openSync(file, 'r');
    const chunk = Buffer.alloc(size - offset);
    fs.readSync(fd, chunk, 0, chunk.length, offset);
    fs.closeSync(fd);
    offset = size;
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    const evs = lines.filter((l) => l.trim()).flatMap((l) => parser.feed(l));
    if (evs.length) { rec.record(evs, rec.state(parser.sessionId)); onEvents?.(evs.length); }
  };
  pump();
  const t = setInterval(pump, intervalMs);
  return () => { clearInterval(t); pump(); };
}
