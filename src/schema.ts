/** Normalized agent-blackbox event schema (v1). See schema/event.schema.json. */
export type Actor = 'user' | 'ai' | 'tool' | 'system';

export type EventType =
  | 'session.start'
  | 'session.end'
  | 'prompt'
  | 'reply'
  | 'reasoning'
  | 'tool.call'
  | 'tool.result'
  | 'plan'
  | 'decision'
  | 'note'
  | 'usage'
  | 'error';

/**
 * Where reasoning text came from. We only ever record what the provider exposes.
 * - full: provider returned raw reasoning text (e.g. some thinking models)
 * - summary: provider returned a reasoning *summary* (Codex/OpenAI, Claude 4 summarized thinking)
 * - none: no reasoning exposed (hidden, encrypted or absent). Never claim hidden CoT.
 */
export type ReasoningSource = 'full' | 'summary' | 'none';

/** OpenTelemetry GenAI semantic-convention aligned attributes (subset). */
export interface GenAiAttributes {
  'gen_ai.system'?: string; // anthropic | openai | xai | ...
  'gen_ai.operation.name'?: string; // chat | execute_tool | invoke_agent
  'gen_ai.request.model'?: string;
  'gen_ai.response.model'?: string;
  'gen_ai.usage.input_tokens'?: number;
  'gen_ai.usage.output_tokens'?: number;
  'gen_ai.tool.name'?: string;
  'gen_ai.tool.call.id'?: string;
  'gen_ai.conversation.id'?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface BlackboxEvent {
  /** Unique event id */
  id: string;
  /** Parent event id (e.g. tool.result -> tool.call) */
  parentId?: string | null;
  /** ISO-8601 timestamp */
  ts: string;
  sessionId: string;
  actor: Actor;
  type: EventType;
  payload: Record<string, unknown>;
  /** claude-code | codex-cli | mcp | anthropic | openai | xai | ... */
  provider?: string;
  reasoningSource?: ReasoningSource;
  attributes?: GenAiAttributes;
}

export type EventInput = Omit<BlackboxEvent, 'id' | 'ts'> & { id?: string; ts?: string };

export const ACTORS: Actor[] = ['user', 'ai', 'tool', 'system'];
export const EVENT_TYPES: EventType[] = [
  'session.start', 'session.end', 'prompt', 'reply', 'reasoning', 'tool.call', 'tool.result',
  'plan', 'decision', 'note', 'usage', 'error',
];

export function validateEvent(e: unknown): string[] {
  const errs: string[] = [];
  const o = e as Record<string, unknown>;
  if (!o || typeof o !== 'object') return ['event must be an object'];
  for (const k of ['id', 'ts', 'sessionId']) if (typeof o[k] !== 'string' || !o[k]) errs.push(`${k} must be a non-empty string`);
  if (!ACTORS.includes(o.actor as Actor)) errs.push(`actor must be one of ${ACTORS.join('|')}`);
  if (!EVENT_TYPES.includes(o.type as EventType)) errs.push(`type must be one of ${EVENT_TYPES.join('|')}`);
  if (!o.payload || typeof o.payload !== 'object') errs.push('payload must be an object');
  if (o.reasoningSource !== undefined && !['full', 'summary', 'none'].includes(o.reasoningSource as string)) errs.push('reasoningSource must be full|summary|none');
  return errs;
}
