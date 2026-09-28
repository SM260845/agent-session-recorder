/**
 * MCP server (stdio). NOTE: an MCP server only sees what the host/agent chooses to send via tool
 * calls. It cannot observe hidden prompts, tool calls made outside MCP, or model reasoning.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Recorder, newId } from './recorder.js';
import { getCurrentSession, readSession, setCurrentSession } from './store.js';
import { exportSession, render, type ExportFormat } from './exporters.js';
import { ACTORS, EVENT_TYPES, type Actor, type EventType } from './schema.js';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export function createMcpServer(rec = new Recorder()): McpServer {
  const server = new McpServer({ name: 'agent-blackbox', version: '0.1.0' });
  const resolve = (id?: string) => {
    const s = id || getCurrentSession();
    if (!s) throw new Error('no active session: call start_session first');
    return s;
  };

  server.registerTool('start_session', {
    description: 'Start a flight-recorder session. Returns the sessionId. Call once at the start of a task.',
    inputSchema: { title: z.string().optional(), provider: z.string().optional(), model: z.string().optional(), cwd: z.string().optional() },
  }, async ({ title, provider, model, cwd }) => {
    const sessionId = newId();
    rec.record({ sessionId, actor: 'system', type: 'session.start', provider: provider ?? 'mcp', payload: { title, model, cwd, source: 'mcp' }, attributes: { 'gen_ai.conversation.id': sessionId, ...(model ? { 'gen_ai.request.model': model } : {}) } });
    setCurrentSession(sessionId);
    return text(JSON.stringify({ sessionId }));
  });

  server.registerTool('log_event', {
    description: 'Log an event (prompt, reply, plan, decision, tool.call, tool.result, note, error...). Only log reasoning the provider exposed; set reasoningSource accordingly.',
    inputSchema: {
      sessionId: z.string().optional(),
      actor: z.enum(ACTORS as [Actor, ...Actor[]]),
      type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
      payload: z.record(z.string(), z.unknown()).optional(),
      text: z.string().optional().describe('shorthand for payload.text'),
      parentId: z.string().optional(),
      reasoningSource: z.enum(['full', 'summary', 'none']).optional(),
    },
  }, async (a) => {
    const sessionId = resolve(a.sessionId);
    const payload = { ...(a.payload ?? {}), ...(a.text !== undefined ? { text: a.text } : {}) };
    const [e] = rec.record({ sessionId, actor: a.actor, type: a.type, payload, parentId: a.parentId ?? null, provider: 'mcp', ...(a.reasoningSource ? { reasoningSource: a.reasoningSource } : {}) });
    return text(JSON.stringify({ id: e.id }));
  });

  server.registerTool('end_session', {
    description: 'End the session and auto-export JSONL, Markdown and HTML. Returns export file paths.',
    inputSchema: { sessionId: z.string().optional(), outcome: z.string().optional() },
  }, async ({ sessionId, outcome }) => {
    const id = resolve(sessionId);
    rec.record({ sessionId: id, actor: 'system', type: 'session.end', provider: 'mcp', payload: { outcome: outcome ?? 'completed' } });
    const files = exportSession(id);
    if (getCurrentSession() === id) setCurrentSession(null);
    return text(JSON.stringify({ sessionId: id, files }));
  });

  server.registerTool('export', {
    description: 'Render a session as jsonl, md or html and return it as text.',
    inputSchema: { sessionId: z.string().optional(), format: z.enum(['jsonl', 'md', 'html']).default('md') },
  }, async ({ sessionId, format }) => text(render(readSession(resolve(sessionId)), (format ?? 'md') as ExportFormat)));

  server.registerResource('current-session', 'blackbox://session/current', {
    description: 'Events of the current session as JSONL', mimeType: 'application/x-ndjson',
  }, async (uri) => {
    const id = getCurrentSession();
    return { contents: [{ uri: uri.href, mimeType: 'application/x-ndjson', text: id ? render(readSession(id), 'jsonl') : '' }] };
  });
  return server;
}

export async function runMcpStdio(rec?: Recorder): Promise<void> {
  await createMcpServer(rec).connect(new StdioServerTransport());
}
