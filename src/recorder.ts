import crypto from 'node:crypto';
import fs from 'node:fs';
import { Redactor, loadRulesFile, shrink, type RedactorState } from './redact.js';
import { appendEvent, loadState, saveState, sessionFile } from './store.js';
import type { BlackboxEvent, EventInput } from './schema.js';

export interface RecorderOptions {
  /** Redaction is ON unless explicitly disabled (CLI: --no-redact) */
  redact?: boolean;
  /** Research mode: truncate big tool outputs & drop repeated dumps */
  research?: boolean;
  maxBytes?: number;
}

export interface SessionState {
  redactor?: RedactorState;
  seen: string[];
  /** adapter bookkeeping: e.g. tool_use_id -> event id / start ts */
  calls: Record<string, { eventId: string; ts: string }>;
  transcriptLines?: number;
  [k: string]: unknown;
}

export const newId = () => crypto.randomUUID();

/** Stateful per-process recorder. State (placeholder map, pending tool calls) is persisted per session. */
export class Recorder {
  constructor(readonly opts: RecorderOptions = {}) {}

  sessionExists(sessionId: string): boolean {
    return fs.existsSync(sessionFile(sessionId));
  }

  state(sessionId: string): SessionState {
    return loadState<SessionState>(sessionId, { seen: [], calls: {} });
  }

  /** Record events for a single session; applies redaction/research, then appends. */
  record(input: EventInput | EventInput[], stateOverride?: SessionState): BlackboxEvent[] {
    const inputs = Array.isArray(input) ? input : [input];
    if (!inputs.length) return [];
    const sessionId = inputs[0].sessionId;
    const st = stateOverride ?? this.state(sessionId);
    const redactor = this.opts.redact === false ? null : new Redactor({ state: st.redactor, rulesFile: loadRulesFile() });
    const seen = new Set(st.seen);
    const out: BlackboxEvent[] = [];
    for (const i of inputs) {
      let e: BlackboxEvent = { ...i, id: i.id ?? newId(), ts: i.ts ?? new Date().toISOString() };
      if (this.opts.research && (e.type === 'tool.result' || e.type === 'tool.call')) {
        e = { ...e, payload: shrink(e.payload, seen, { maxBytes: this.opts.maxBytes }) as Record<string, unknown> };
      }
      if (redactor) e = { ...e, payload: redactor.redact(e.payload), attributes: e.attributes && redactor.redact(e.attributes) };
      if (!e.attributes) delete e.attributes;
      appendEvent(e);
      out.push(e);
    }
    if (redactor) st.redactor = redactor.state;
    st.seen = [...seen];
    saveState(sessionId, st);
    return out;
  }
}
