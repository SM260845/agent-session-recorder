#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Recorder } from './recorder.js';
import { handleHook, importClaudeTranscript } from './adapters/claude.js';
import { importCodexSession, latestCodexSession, tailCodexSession } from './adapters/codex.js';
import { exportSession, type ExportFormat } from './exporters.js';
import { listSessions } from './store.js';
import { Redactor, loadRulesFile } from './redact.js';

const HELP = `agent-session-recorder — local-first flight recorder for AI agent sessions

Usage:
  agent-session-recorder init [--write]                 detect claude/codex, print (or write) hook + MCP config
  agent-session-recorder hook                           Claude Code hook handler (reads hook JSON on stdin)
  agent-session-recorder import-claude <transcript.jsonl>
  agent-session-recorder codex import <rollout.jsonl|--latest>
  agent-session-recorder codex tail [rollout.jsonl|--latest]
  agent-session-recorder mcp                            run the MCP server on stdio
  agent-session-recorder view [--port 4318]             local live viewer (127.0.0.1)
  agent-session-recorder export <sessionId> [--format md|html|jsonl] [--out dir]
  agent-session-recorder seal <sessionId> [--timestamp | --tsa url]   Merkle-batch new events; add an RFC 3161 timestamp (default TSA: freetsa.org)
  agent-session-recorder verify <sessionId> [--json]    check hash chain, batches and timestamps (exit 2 on tamper)
  agent-session-recorder bundle <sessionId> --intent <id> [--timestamp | --tsa url] [--out .proof]   write a proof bundle for a proof-carrying PR
  agent-session-recorder list                           list recorded sessions
  agent-session-recorder redact                         redact stdin -> stdout (test your rules)

Global flags: --no-redact (disable redaction; ON by default), --research (truncate big/repeated tool output)
Data: ~/.agent-session-recorder (override with AGENT_SESSION_RECORDER_HOME)`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true, strict: false,
    options: {
      'no-redact': { type: 'boolean' }, research: { type: 'boolean' }, write: { type: 'boolean' },
      latest: { type: 'boolean' }, port: { type: 'string' }, format: { type: 'string' }, out: { type: 'string' }, tsa: { type: 'string' }, json: { type: 'boolean' }, intent: { type: 'string' }, timestamp: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const rec = new Recorder({ redact: !values['no-redact'], research: !!values.research });
  const [cmd, a1, a2] = positionals;
  switch (cmd) {
    case 'hook': {
      // Never block or fail the host agent.
      try { handleHook(JSON.parse(await readStdin()), rec); } catch (e) { process.stderr.write(`agent-session-recorder hook: ${(e as Error).message}\n`); }
      process.exit(0);
    }
    case 'import-claude': {
      if (!a1) throw new Error('usage: import-claude <transcript.jsonl>');
      const r = importClaudeTranscript(a1, rec);
      console.log(JSON.stringify({ ...r, files: exportSession(r.sessionId) }, null, 2));
      break;
    }
    case 'codex': {
      const file = values.latest || !a2 ? latestCodexSession() : a2;
      if (!file) throw new Error('no Codex session file found (looked in ~/.codex/sessions)');
      if (a1 === 'import') {
        const r = importCodexSession(file, rec);
        console.log(JSON.stringify({ ...r, files: exportSession(r.sessionId) }, null, 2));
      } else if (a1 === 'tail') {
        console.error(`tailing ${file} (Ctrl-C to stop)`);
        const stop = tailCodexSession(file, rec, (n) => console.error(`+${n} events`));
        process.on('SIGINT', () => { stop(); process.exit(0); });
      } else throw new Error('usage: codex import|tail [file|--latest]');
      break;
    }
    case 'mcp': {
      const { runMcpStdio } = await import('./mcp.js');
      await runMcpStdio(rec);
      break;
    }
    case 'view': {
      const { startViewer } = await import('./viewer.js');
      const v = await startViewer({ port: values.port ? Number(values.port) : 4318 });
      console.log(`agent-session-recorder viewer: ${v.url}`);
      break;
    }
    case 'export': {
      if (!a1) throw new Error('usage: export <sessionId>');
      const fmts = (values.format ? String(values.format).split(',') : ['jsonl', 'md', 'html']) as ExportFormat[];
      console.log(exportSession(a1, fmts, values.out ? String(values.out) : undefined).join('\n'));
      break;
    }
    case 'seal': {
      if (!a1) throw new Error('usage: seal <sessionId> [--timestamp | --tsa url]');
      const { sealSession } = await import('./seal.js');
      const tsa = values.tsa ? String(values.tsa) : values.timestamp ? 'https://freetsa.org/tsr' : undefined;
      const b = await sealSession(a1, { tsa });
      console.log(b ? JSON.stringify({ ...b, tsa: b.tsa ? { url: b.tsa.url, bytes: Buffer.from(b.tsa.tsr, 'base64').length } : undefined }, null, 2) : 'nothing new to seal');
      break;
    }
    case 'verify': {
      if (!a1) throw new Error('usage: verify <sessionId>');
      const { verifySession } = await import('./seal.js');
      const r = verifySession(a1);
      if (values.json) console.log(JSON.stringify(r, null, 2));
      else {
        console.log(`${r.ok ? 'OK' : 'TAMPERED'}  ${r.sessionId}: ${r.sealed}/${r.events} events sealed, ${r.batches} batches (${r.timestamped} timestamped), ${r.unbatched} not yet batched`);
        for (const e of r.errors) console.log(`  ✗ ${e}`);
      }
      process.exitCode = r.ok ? 0 : 2;
      break;
    }
    case 'bundle': {
      if (!a1 || !values.intent) throw new Error('usage: bundle <sessionId> --intent <YYYYMMDD-slug> [--timestamp | --tsa url] [--out .proof]');
      const { writeBundle } = await import('./bundle.js');
      const tsa = values.tsa ? String(values.tsa) : values.timestamp ? 'https://freetsa.org/tsr' : undefined;
      console.log(await writeBundle(a1, { intent: String(values.intent), tsa, outDir: values.out ? String(values.out) : undefined }));
      break;
    }
    case 'list':
      for (const s of listSessions()) console.log(`${s.mtime}  ${String(s.size).padStart(8)}  ${s.id}`);
      break;
    case 'redact':
      process.stdout.write(new Redactor({ rulesFile: loadRulesFile() }).redactString(await readStdin()));
      break;
    case 'init': {
      const { runInit } = await import('./init.js');
      runInit({ write: !!values.write });
      break;
    }
    default:
      console.log(HELP);
      if (cmd && cmd !== 'help' && !values.help) process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`agent-session-recorder: ${e.message}`); process.exit(1); });
