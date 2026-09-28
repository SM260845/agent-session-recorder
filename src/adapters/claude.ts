/**
 * Claude Code adapter.
 * - Hook handler: `agent-blackbox hook` reads the hook JSON Claude Code writes to stdin
 *   (fields: session_id, transcript_path, cwd, hook_event_name, prompt, tool_name, tool_input,
 *   tool_response, tool_use_id). Supported: SessionStart, UserPromptSubmit, PreToolUse,
 *   PostToolUse, Stop, SessionEnd.
 * - Transcript importer: ~/.claude/projects/<project>/<session>.jsonl, one JSON object per line
 *   with {type:"user"|"assistant", message:{role, content, model, usage}, timestamp, sessionId, uuid}.
 * Built against documented formats + synthetic fixtures (no real sessions were available).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { EventInput, ReasoningSource } from '../schema.js';
import { Recorder, newId, type SessionState } from '../recorder.js';
import { parseJsonl } from '../store.js';
import { exportSession } from '../exporters.js';

const PROVIDER = 'claude-code';
const SYSTEM = { 'gen_ai.system': 'anthropic' };

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

/** Claude 3.7 returned full thinking; Claude 4+ return summarized thinking. */
export function claudeReasoningSource(model?: string): ReasoningSource {
  return model && /claude-3-7/.test(model) ? 'full' : 'summary';
}

function callKey(input: Record<string, unknown>): string {
  if (typeof input.tool_use_id === 'string') return input.tool_use_id;
  return 'h:' + crypto.createHash('sha256').update(String(input.tool_name) + JSON.stringify(input.tool_input ?? {})).digest('hex').slice(0, 16);
}

function startEvent(sessionId: string, h: Record<string, unknown>): EventInput {
  return { sessionId, actor: 'system', type: 'session.start', provider: PROVIDER, payload: { cwd: h.cwd, source: h.source ?? 'hook', transcriptPath: h.transcript_path }, attributes: { ...SYSTEM, 'gen_ai.conversation.id': sessionId } };
}

export interface HookResult { events: number; exported?: string[] }

/** Handle one hook payload. Never throws for unknown events; returns number of events written. */
export function handleHook(h: Record<string, unknown>, rec = new Recorder()): HookResult {
  const sessionId = String(h.session_id ?? 'unknown');
  const name = String(h.hook_event_name ?? '');
  const st = rec.state(sessionId);
  const evs: EventInput[] = [];
  if (!rec.sessionExists(sessionId) && name !== 'SessionStart') evs.push(startEvent(sessionId, h));
  const base = { sessionId, provider: PROVIDER };
  let exported: string[] | undefined;

  switch (name) {
    case 'SessionStart':
      evs.push(startEvent(sessionId, h));
      break;
    case 'UserPromptSubmit':
      evs.push({ ...base, actor: 'user', type: 'prompt', payload: { text: String(h.prompt ?? '') } });
      break;
    case 'PreToolUse': {
      const id = newId();
      const key = callKey(h);
      const ts = new Date().toISOString();
      st.calls[key] = { eventId: id, ts };
      evs.push({ ...base, id, ts, actor: 'ai', type: 'tool.call', payload: { name: h.tool_name, input: h.tool_input ?? {}, toolUseId: h.tool_use_id }, attributes: { ...SYSTEM, 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': String(h.tool_name ?? ''), ...(h.tool_use_id ? { 'gen_ai.tool.call.id': String(h.tool_use_id) } : {}) } });
      break;
    }
    case 'PostToolUse': {
      const key = callKey(h);
      const call = st.calls[key];
      const now = new Date();
      const resp = h.tool_response as Record<string, unknown> | undefined;
      const isError = !!(resp && typeof resp === 'object' && (resp.is_error || resp.error || resp.success === false));
      evs.push({ ...base, parentId: call?.eventId ?? null, ts: now.toISOString(), actor: 'tool', type: 'tool.result', payload: { name: h.tool_name, output: h.tool_response, isError, durationMs: call ? now.getTime() - Date.parse(call.ts) : undefined }, attributes: { ...SYSTEM, 'gen_ai.tool.name': String(h.tool_name ?? '') } });
      delete st.calls[key];
      break;
    }
    case 'Stop':
    case 'SubagentStop':
    case 'SessionEnd': {
      // Pull visible replies / exposed reasoning / usage from the transcript since last sync.
      if (typeof h.transcript_path === 'string' && fs.existsSync(h.transcript_path)) {
        const lines = fs.readFileSync(h.transcript_path, 'utf8').split('\n').filter((l) => l.trim());
        const from = st.transcriptLines ?? 0;
        evs.push(...transcriptToEvents(lines.slice(from).join('\n'), { sessionId, only: ['reply', 'reasoning', 'usage'] }));
        st.transcriptLines = lines.length;
      }
      if (name === 'SessionEnd') evs.push({ ...base, actor: 'system', type: 'session.end', payload: { outcome: h.reason ?? 'ended' } });
      break;
    }
    default:
      evs.push({ ...base, actor: 'system', type: 'note', payload: { hook: name, raw: h } });
  }
  rec.record(evs, st);
  if (['Stop', 'SessionEnd'].includes(name)) {
    try { exported = exportSession(sessionId); } catch { /* best effort */ }
  }
  return { events: evs.length, exported };
}

export interface TranscriptOpts { sessionId?: string; only?: string[] }

/** Convert Claude Code transcript JSONL text into normalized events (not yet recorded). */
export function transcriptToEvents(text: string, opts: TranscriptOpts = {}): EventInput[] {
  const out: EventInput[] = [];
  const callIds = new Map<string, { id: string; ts: string }>();
  const keep = (t: string) => !opts.only || opts.only.includes(t);
  for (const raw of parseJsonl(text) as Record<string, any>[]) {
    if (raw.type !== 'user' && raw.type !== 'assistant') continue;
    const sessionId = opts.sessionId ?? String(raw.sessionId ?? 'claude-import');
    const ts = typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString();
    const msg = raw.message ?? {};
    const model: string | undefined = msg.model;
    const base = { sessionId, provider: PROVIDER, ts };
    const content: Block[] = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      if (b.type === 'text' && b.text) {
        if (raw.type === 'user' && keep('prompt')) out.push({ ...base, actor: 'user', type: 'prompt', payload: { text: b.text } });
        if (raw.type === 'assistant' && keep('reply')) out.push({ ...base, actor: 'ai', type: 'reply', payload: { text: b.text }, attributes: { ...SYSTEM, ...(model ? { 'gen_ai.response.model': model } : {}) } });
      } else if (b.type === 'thinking' && keep('reasoning')) {
        const txt = b.thinking ?? '';
        out.push({ ...base, actor: 'ai', type: 'reasoning', reasoningSource: txt ? claudeReasoningSource(model) : 'none', payload: { text: txt } });
      } else if (b.type === 'redacted_thinking' && keep('reasoning')) {
        out.push({ ...base, actor: 'ai', type: 'reasoning', reasoningSource: 'none', payload: { text: '', note: 'provider returned redacted/encrypted thinking' } });
      } else if (b.type === 'tool_use' && keep('tool.call')) {
        const id = newId();
        if (b.id) callIds.set(b.id, { id, ts });
        out.push({ ...base, id, actor: 'ai', type: 'tool.call', payload: { name: b.name, input: b.input ?? {}, toolUseId: b.id }, attributes: { ...SYSTEM, 'gen_ai.tool.name': String(b.name ?? ''), ...(b.id ? { 'gen_ai.tool.call.id': b.id } : {}) } });
      } else if (b.type === 'tool_result' && keep('tool.result')) {
        const call = b.tool_use_id ? callIds.get(b.tool_use_id) : undefined;
        const output = Array.isArray(b.content) ? (b.content as Block[]).map((c) => c.text ?? JSON.stringify(c)).join('\n') : b.content;
        out.push({ ...base, parentId: call?.id ?? null, actor: 'tool', type: 'tool.result', payload: { output, isError: !!b.is_error, toolUseId: b.tool_use_id, durationMs: call ? Date.parse(ts) - Date.parse(call.ts) : undefined } });
      }
    }
    if (raw.type === 'assistant' && msg.usage && keep('usage')) {
      out.push({ ...base, actor: 'system', type: 'usage', payload: { model, usage: msg.usage }, attributes: { ...SYSTEM, ...(model ? { 'gen_ai.response.model': model } : {}), 'gen_ai.usage.input_tokens': Number(msg.usage.input_tokens ?? 0), 'gen_ai.usage.output_tokens': Number(msg.usage.output_tokens ?? 0) } });
    }
  }
  return out;
}

/** Import a whole transcript file as a session. Returns sessionId and count. */
export function importClaudeTranscript(file: string, rec = new Recorder()): { sessionId: string; events: number } {
  const text = fs.readFileSync(file, 'utf8');
  const evs = transcriptToEvents(text);
  const sessionId = evs[0]?.sessionId ?? 'claude-import';
  const models = evs.map((e) => (e.payload as any).model).filter(Boolean);
  const all: EventInput[] = [
    { sessionId, actor: 'system', type: 'session.start', provider: PROVIDER, ts: evs[0]?.ts, payload: { source: 'transcript', model: models[0] }, attributes: { ...SYSTEM, 'gen_ai.conversation.id': sessionId } },
    ...evs,
    { sessionId, actor: 'system', type: 'session.end', provider: PROVIDER, ts: evs[evs.length - 1]?.ts, payload: { outcome: 'imported' } },
  ];
  rec.record(all, rec.state(sessionId) as SessionState);
  return { sessionId, events: all.length };
}
