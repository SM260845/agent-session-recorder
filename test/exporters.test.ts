import { describe, it, expect, beforeEach } from 'vitest';
import { tmpHome, fixture } from './helpers.js';
import { importClaudeTranscript } from '../src/adapters/claude.js';
import { readSession } from '../src/store.js';
import { toMarkdown, toHtml, toJsonl } from '../src/exporters.js';
import { Recorder } from '../src/recorder.js';

beforeEach(() => { tmpHome(); });

describe('exporters', () => {
  it('renders markdown with metadata and nested tool results', () => {
    const { sessionId } = importClaudeTranscript(fixture('claude-transcript.jsonl'));
    const md = toMarkdown(readSession(sessionId));
    expect(md).toContain('# agent-blackbox session `claude-fixture-1`');
    expect(md).toContain('| model | claude-sonnet-4-5 |');
    expect(md).toMatch(/#### tool · tool.result/);
    expect(md).toContain('reasoning: summary');
  });
  it('renders self-contained html safe against script injection', () => {
    const rec = new Recorder({ redact: false });
    rec.record({ sessionId: 'x', actor: 'user', type: 'prompt', payload: { text: '</script><script>alert(1)</script>' } });
    const html = toHtml(readSession('x'));
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('BB.set(');
    expect(html).not.toMatch(/src="http/);
  });
  it('jsonl round-trips', () => {
    const rec = new Recorder();
    rec.record({ sessionId: 'y', actor: 'ai', type: 'decision', payload: { text: 'use sqlite' } });
    const out = toJsonl(readSession('y'));
    expect(JSON.parse(out.trim()).payload.text).toBe('use sqlite');
  });
});
