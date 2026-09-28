import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './store.js';

export interface RedactRule {
  /** Placeholder type, e.g. EMAIL -> [EMAIL_1] */
  name: string;
  pattern: string | RegExp;
  flags?: string;
  /** Only replace this capture group (keeps surrounding context like `API_KEY=`) */
  group?: number;
  validate?: (match: string) => boolean;
}

export interface RulesFile {
  rules?: { name: string; pattern: string; flags?: string; group?: number }[];
  disable?: string[];
  allow?: string[];
}

export interface RedactorState {
  salt: string;
  /** salted sha256(value) -> placeholder. Raw secrets are never persisted. */
  map: Record<string, string>;
  counters: Record<string, number>;
}

export function luhn(num: string): boolean {
  const d = num.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

const validIp = (m: string) => {
  const parts = m.split('.').map(Number);
  if (parts.some((p) => p > 255)) return false;
  return !['127.0.0.1', '0.0.0.0', '255.255.255.255'].includes(m);
};
const validPhone = (m: string) => {
  const digits = m.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  return /^\+|^0|^\(|[ .-]/.test(m.trim());
};

/** Built-in rules. Order matters: most specific first. */
export const DEFAULT_RULES: RedactRule[] = [
  { name: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'SECRET', pattern: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]*\s*[=:]\s*["']?([^\s"'`,;]{4,})/g, group: 1 },
  { name: 'API_KEY', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'API_KEY', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'API_KEY', pattern: /\bxai-[A-Za-z0-9_-]{20,}/g },
  { name: 'API_KEY', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'API_KEY', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { name: 'API_KEY', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: 'API_KEY', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'API_KEY', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'TOKEN', pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g, group: 1 },
  { name: 'EMAIL', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'CREDIT_CARD', pattern: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, validate: luhn },
  { name: 'IP', pattern: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, validate: validIp },
  { name: 'PHONE', pattern: /(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}[ .-]?\d{3,4}[ .-]?\d{3,4}(?![\w])/g, validate: validPhone },
  { name: 'USER', pattern: /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)([^/\\\s"'`]+)/g, group: 1 },
];

export const rulesFilePath = () => path.join(homeDir(), 'redact-rules.json');

export function loadRulesFile(file = rulesFilePath()): RulesFile {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

export class Redactor {
  readonly state: RedactorState;
  private rules: RedactRule[];
  private allow: Set<string>;

  constructor(opts: { state?: RedactorState; rulesFile?: RulesFile } = {}) {
    this.state = opts.state ?? { salt: crypto.randomBytes(16).toString('hex'), map: {}, counters: {} };
    const rf = opts.rulesFile ?? {};
    const disabled = new Set(rf.disable ?? []);
    const custom: RedactRule[] = (rf.rules ?? []).map((r) => ({ ...r, pattern: new RegExp(r.pattern, r.flags ?? 'g') }));
    // custom rules run first so users can override built-ins
    this.rules = [...custom, ...DEFAULT_RULES].filter((r) => !disabled.has(r.name));
    this.allow = new Set(rf.allow ?? []);
  }

  private placeholder(type: string, value: string): string {
    const key = crypto.createHash('sha256').update(this.state.salt + '\0' + type + '\0' + value).digest('hex').slice(0, 24);
    const existing = this.state.map[key];
    if (existing) return existing;
    const n = (this.state.counters[type] ?? 0) + 1;
    this.state.counters[type] = n;
    const ph = `[${type}_${n}]`;
    this.state.map[key] = ph;
    return ph;
  }

  redactString(s: string): string {
    let out = s;
    for (const rule of this.rules) {
      const re = typeof rule.pattern === 'string' ? new RegExp(rule.pattern, rule.flags ?? 'g') : new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
      out = out.replace(re, (...args) => {
        const match = args[0] as string;
        const target = rule.group ? (args[rule.group] as string | undefined) : match;
        if (!target || this.allow.has(target) || /^\[[A-Z_]+_\d+\]$/.test(target)) return match;
        if (rule.validate && !rule.validate(target)) return match;
        const ph = this.placeholder(rule.name, target);
        return rule.group ? match.replace(target, ph) : ph;
      });
    }
    return out;
  }

  redact<T>(value: T): T {
    if (typeof value === 'string') return this.redactString(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.redact(v)) as T;
    if (value && typeof value === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) o[k] = this.redact(v);
      return o as T;
    }
    return value;
  }
}

/* ---------------- research mode: shrink big / repeated tool outputs ---------------- */

export interface ResearchOptions { maxBytes?: number; headChars?: number }

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Truncate large string leaves (keeping sha256 + size + a head) and replace
 * outputs already seen in this session with a reference.
 */
export function shrink(value: unknown, seen: Set<string>, opts: ResearchOptions = {}): unknown {
  const maxBytes = opts.maxBytes ?? 4000;
  const headChars = opts.headChars ?? 400;
  if (typeof value === 'string') {
    const size = Buffer.byteLength(value);
    if (size < 256) return value;
    const hash = sha256(value);
    if (seen.has(hash)) return { duplicateOf: `sha256:${hash}`, size };
    seen.add(hash);
    if (size <= maxBytes) return value;
    return { truncated: true, sha256: hash, size, head: value.slice(0, headChars) };
  }
  if (Array.isArray(value)) return value.map((v) => shrink(v, seen, opts));
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = shrink(v, seen, opts);
    return o;
  }
  return value;
}
