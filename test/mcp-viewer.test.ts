import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import WebSocket from 'ws';
import { tmpHome } from './helpers.js';
import { createMcpServer } from '../src/mcp.js';
import { startViewer } from '../src/viewer.js';
import { Recorder } from '../src/recorder.js';
import { claudeHooksConfig, mergeHooks, runInit } from '../src/init.js';

beforeEach(() => { tmpHome(); });

describe('mcp server', () => {
  it('start_session -> log_event -> resource -> end_session exports', async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await createMcpServer().connect(st);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(ct);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['end_session', 'export', 'log_event', 'start_session']);
    const start = await client.callTool({ name: 'start_session', arguments: { title: 't', model: 'grok-4' } });
    const { sessionId } = JSON.parse((start.content as any)[0].text);
    await client.callTool({ name: 'log_event', arguments: { actor: 'ai', type: 'decision', text: 'email ops@corp.com about it' } });
    const res = await client.readResource({ uri: 'session-recorder://session/current' });
    const txt = (res.contents[0] as any).text as string;
    expect(txt).toContain('[EMAIL_1]');
    expect(txt).toContain(sessionId);
    const md = await client.callTool({ name: 'export', arguments: { format: 'md' } });
    expect((md.content as any)[0].text).toContain('decision');
    const end = await client.callTool({ name: 'end_session', arguments: { outcome: 'success' } });
    const { files } = JSON.parse((end.content as any)[0].text);
    expect(files).toHaveLength(3);
    for (const f of files) expect(fs.existsSync(f)).toBe(true);
    await client.close();
  });
});

describe('viewer', () => {
  it('serves page + api and streams new events over websocket', async () => {
    const rec = new Recorder();
    rec.record({ sessionId: 'live', actor: 'user', type: 'prompt', payload: { text: 'hi' } });
    const v = await startViewer({ port: 0, pollMs: 20 });
    try {
      expect(await (await fetch(v.url + '/')).text()).toContain('agent-session-recorder');
      expect((await (await fetch(v.url + '/api/sessions')).json())[0].id).toBe('live');
      expect(await (await fetch(v.url + '/api/sessions/live')).json()).toHaveLength(1);
      const ws = new WebSocket(v.url.replace('http', 'ws') + '/ws?session=live');
      await new Promise((r) => ws.on('open', r));
      const got = new Promise<any>((r) => ws.on('message', (m) => r(JSON.parse(String(m)))));
      rec.record({ sessionId: 'live', actor: 'ai', type: 'reply', payload: { text: 'hello' } });
      expect((await got).payload.text).toBe('hello');
      ws.close();
    } finally { await v.close(); }
  });
});

describe('init', () => {
  it('dry-run writes nothing; --write merges idempotently', () => {
    const home = process.env.AGENT_SESSION_RECORDER_HOME!;
    const logs: string[] = [];
    expect(runInit({ home, log: (s) => logs.push(s) }).written).toEqual([]);
    expect(logs.join('\n')).toContain('UserPromptSubmit');
    expect(fs.existsSync(home + '/.claude/settings.json')).toBe(false);
    runInit({ home, write: true, log: () => {} });
    runInit({ home, write: true, log: () => {} });
    const s = JSON.parse(fs.readFileSync(home + '/.claude/settings.json', 'utf8'));
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(fs.readFileSync(home + '/.codex/config.toml', 'utf8').match(/mcp_servers.agent-session-recorder/g)).toHaveLength(1);
    const merged = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } }, claudeHooksConfig('x hook'));
    expect(merged.hooks.Stop).toHaveLength(2);
  });
});
