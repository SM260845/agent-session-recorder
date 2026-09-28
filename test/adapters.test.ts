import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome, fixture } from './helpers.js';
import { handleHook, transcriptToEvents, importClaudeTranscript } from '../src/adapters/claude.js';
import { importCodexSession, tailCodexSession, CodexParser } from '../src/adapters/codex.js';
import { Recorder } from '../src/recorder.js';
import { readSession } from '../src/store.js';
import { validateEvent } from '../src/schema.js';

beforeEach(() => { tmpHome(); });

describe('claude code hooks', () => {
  it('records prompt, nested tool call/result with timing, replies on Stop, and auto-exports', () => {
    const home = process.env.AGENT_SESSION_RECORDER_HOME!;
    const sid = 'hook-s1';
    const base = { session_id: sid, cwd: '/home/alice/p', transcript_path: fixture('claude-transcript.jsonl') };
    handleHook({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'deploy with key xai-ABCDEFGHIJKLMNOPQRSTUVWX' });
    handleHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' });
    handleHook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1', tool_response: { stdout: 'a\nb' } });
    const r = handleHook({ ...base, hook_event_name: 'Stop', stop_hook_active: false });
    const evs = readSession(sid);
    expect(evs.map((e) => e.type)).toEqual(['session.start', 'prompt', 'tool.call', 'tool.result', 'reasoning', 'reply', 'usage', 'reply', 'usage']);
    for (const e of evs) expect(validateEvent(e)).toEqual([]);
    expect(JSON.stringify(evs)).not.toContain('xai-ABCD');
    expect(JSON.stringify(evs)).not.toContain('alice');
    const call = evs[2], res = evs[3];
    expect(res.parentId).toBe(call.id);
    expect(typeof res.payload.durationMs).toBe('number');
    expect(evs[4].reasoningSource).toBe('summary');
    expect(r.exported?.length).toBe(3);
    expect(fs.existsSync(path.join(home, 'exports', `${sid}.html`))).toBe(true);
    // second Stop does not re-import old transcript lines
    handleHook({ ...base, hook_event_name: 'Stop' });
    expect(readSession(sid).length).toBe(evs.length);
  });
  it('--no-redact keeps raw values', () => {
    handleHook({ session_id: 's2', hook_event_name: 'UserPromptSubmit', prompt: 'me@x.com' }, new Recorder({ redact: false }));
    expect(readSession('s2')[1].payload.text).toBe('me@x.com');
  });
});

describe('claude transcript import', () => {
  it('maps blocks to events and links tool results', () => {
    const evs = transcriptToEvents(fs.readFileSync(fixture('claude-transcript.jsonl'), 'utf8'));
    const types = evs.map((e) => e.type);
    expect(types).toEqual(['prompt', 'reasoning', 'reply', 'tool.call', 'usage', 'tool.result', 'reply', 'usage']);
    expect(evs[5].parentId).toBe(evs[3].id);
    expect(evs[5].payload.durationMs).toBe(1500);
  });
  it('imports into a redacted session file', () => {
    const r = importClaudeTranscript(fixture('claude-transcript.jsonl'));
    expect(r.sessionId).toBe('claude-fixture-1');
    const text = JSON.stringify(readSession(r.sessionId));
    expect(text).toContain('[EMAIL_1]');
    expect(text).not.toContain('alice@example.com');
  });
});

describe('codex import/tail', () => {
  it('imports rollout with summary reasoning, tool linkage, usage', () => {
    const r = importCodexSession(fixture('codex-rollout.jsonl'));
    expect(r.sessionId).toBe('codex-fixture-1');
    const evs = readSession(r.sessionId);
    const types = evs.map((e) => e.type);
    expect(types).toEqual(['session.start', 'note', 'note', 'prompt', 'reasoning', 'tool.call', 'tool.result', 'reply', 'usage', 'session.end']);
    expect(evs[4].reasoningSource).toBe('summary');
    expect(evs[6].parentId).toBe(evs[5].id);
    expect(evs[6].payload.durationMs).toBe(500);
    expect(evs[8].attributes?.['gen_ai.usage.input_tokens']).toBe(500);
    expect(JSON.stringify(evs)).not.toContain('sk-proj-abc');
    expect(JSON.stringify(evs)).not.toContain('/Users/bob');
  });
  it('marks encrypted-only reasoning as none', () => {
    const [e] = new CodexParser().feed(JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [], encrypted_content: 'x' } }));
    expect(e.reasoningSource).toBe('none');
  });
  it('tails appended lines', async () => {
    const f = path.join(process.env.AGENT_SESSION_RECORDER_HOME!, 'rollout.jsonl');
    const lines = fs.readFileSync(fixture('codex-rollout.jsonl'), 'utf8').split('\n');
    fs.writeFileSync(f, lines.slice(0, 4).join('\n') + '\n');
    const stop = tailCodexSession(f, new Recorder(), undefined, 20);
    fs.appendFileSync(f, lines.slice(4).join('\n'));
    await new Promise((r) => setTimeout(r, 120));
    stop();
    expect(readSession('codex-fixture-1').length).toBeGreaterThanOrEqual(8);
  });
});
