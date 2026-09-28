import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function detect(bin: string): boolean {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
  return r.status === 0;
}

const cliPath = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');

export function claudeHooksConfig(cmd = `node ${JSON.stringify(cliPath())} hook`) {
  const h = [{ type: 'command', command: cmd }];
  return {
    hooks: {
      SessionStart: [{ hooks: h }],
      UserPromptSubmit: [{ hooks: h }],
      PreToolUse: [{ matcher: '*', hooks: h }],
      PostToolUse: [{ matcher: '*', hooks: h }],
      Stop: [{ hooks: h }],
      SessionEnd: [{ hooks: h }],
    },
  };
}

export function mergeHooks(existing: any, add: any): any {
  const out = { ...existing, hooks: { ...(existing?.hooks ?? {}) } };
  for (const [ev, groups] of Object.entries<any[]>(add.hooks)) {
    const cur: any[] = out.hooks[ev] ?? [];
    const cmd = groups[0].hooks[0].command;
    if (!JSON.stringify(cur).includes(' hook"') && !cur.some((g) => g.hooks?.some((x: any) => x.command === cmd))) cur.push(...groups);
    out.hooks[ev] = cur;
  }
  return out;
}

export function codexMcpToml(cmd = 'node', args = [cliPath(), 'mcp']): string {
  return `[mcp_servers.agent-blackbox]\ncommand = ${JSON.stringify(cmd)}\nargs = ${JSON.stringify(args)}\n`;
}

export function runInit(opts: { write?: boolean; home?: string; log?: (s: string) => void } = {}): { claude: boolean; codex: boolean; written: string[] } {
  const log = opts.log ?? console.log;
  const home = opts.home ?? os.homedir();
  const claude = detect('claude');
  const codex = detect('codex');
  const written: string[] = [];
  log(`agent-blackbox init (${opts.write ? 'WRITE' : 'dry-run; pass --write to apply'})`);
  log(`detected: claude=${claude ? 'yes' : 'no'} codex=${codex ? 'yes' : 'no'}\n`);

  const hooks = claudeHooksConfig();
  const claudeSettings = path.join(home, '.claude', 'settings.json');
  log(`# Claude Code hooks -> ${claudeSettings}`);
  log(JSON.stringify(hooks, null, 2));
  log(`\n# Claude Code MCP (optional, run yourself):\nclaude mcp add agent-blackbox -- node ${cliPath()} mcp\n`);
  const codexToml = path.join(home, '.codex', 'config.toml');
  log(`# Codex CLI MCP -> ${codexToml}\n${codexMcpToml()}`);
  log('# Codex CLI has no hooks: record sessions with `agent-blackbox codex tail --latest` or `codex import <rollout.jsonl>`\n');

  if (opts.write) {
    fs.mkdirSync(path.dirname(claudeSettings), { recursive: true });
    let existing: any = {};
    if (fs.existsSync(claudeSettings)) {
      fs.copyFileSync(claudeSettings, claudeSettings + '.bak');
      existing = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
    }
    fs.writeFileSync(claudeSettings, JSON.stringify(mergeHooks(existing, hooks), null, 2) + '\n');
    written.push(claudeSettings);
    const prev = fs.existsSync(codexToml) ? fs.readFileSync(codexToml, 'utf8') : '';
    if (!prev.includes('[mcp_servers.agent-blackbox]')) {
      fs.mkdirSync(path.dirname(codexToml), { recursive: true });
      if (prev) fs.copyFileSync(codexToml, codexToml + '.bak');
      fs.writeFileSync(codexToml, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + '\n' + codexMcpToml());
      written.push(codexToml);
    }
    log(`wrote: ${written.join(', ') || '(nothing new)'}`);
  }
  return { claude, codex, written };
}
