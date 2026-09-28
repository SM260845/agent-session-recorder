import { describe, it, expect } from 'vitest';
import { Redactor, luhn, shrink } from '../src/redact.js';

describe('redaction', () => {
  const r = () => new Redactor();
  it('redacts emails consistently', () => {
    const red = r();
    expect(red.redactString('a@b.com and c@d.org and a@b.com')).toBe('[EMAIL_1] and [EMAIL_2] and [EMAIL_1]');
  });
  it('redacts provider keys', () => {
    const s = r().redactString('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA xai-BBBBBBBBBBBBBBBBBBBBBBBB ghp_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC AKIAIOSFODNN7EXAMPLE sk-proj-DDDDDDDDDDDDDDDDDDDDDDDD');
    expect(s).not.toMatch(/AAAA|BBBB|CCCC|IOSFODNN|DDDD/);
    expect(s).toContain('[API_KEY_1]');
  });
  it('redacts env secrets but keeps the name', () => {
    expect(r().redactString('export GITHUB_TOKEN=abc123xyz')).toBe('export GITHUB_TOKEN=[SECRET_1]');
  });
  it('redacts IPs but not localhost', () => {
    expect(r().redactString('10.1.2.3 127.0.0.1 999.1.1.1')).toBe('[IP_1] 127.0.0.1 999.1.1.1');
  });
  it('redacts Luhn-valid cards only', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true);
    const s = r().redactString('card 4111 1111 1111 1111 order 1234567890123456');
    expect(s).toContain('[CREDIT_CARD_1]');
    expect(s).toContain('1234567890123456');
  });
  it('redacts phones, not dates or plain ids', () => {
    const s = r().redactString('call +61 412 345 678 on 2026-09-28 id 1727512345678');
    expect(s).toContain('[PHONE_1]');
    expect(s).toContain('2026-09-28');
    expect(s).toContain('1727512345678');
  });
  it('redacts home-dir usernames', () => {
    expect(r().redactString('/home/alice/x and /Users/bob/y')).toBe('/home/[USER_1]/x and /Users/[USER_2]/y');
  });
  it('redacts JWT, bearer and private keys', () => {
    const s = r().redactString('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123 -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----');
    expect(s).toBe('Authorization: Bearer [TOKEN_1] [PRIVATE_KEY_1]');
  });
  it('supports user rules, disable and allow', () => {
    const red = new Redactor({ rulesFile: { rules: [{ name: 'TICKET', pattern: 'JIRA-\\d+' }], disable: ['IP'], allow: ['ok@example.com'] } });
    expect(red.redactString('JIRA-42 10.0.0.1 ok@example.com x@y.io')).toBe('[TICKET_1] 10.0.0.1 ok@example.com [EMAIL_1]');
  });
  it('keeps placeholders consistent across instances via persisted state (no raw values stored)', () => {
    const a = new Redactor();
    a.redactString('a@b.com');
    const b = new Redactor({ state: JSON.parse(JSON.stringify(a.state)) });
    expect(b.redactString('x a@b.com')).toBe('x [EMAIL_1]');
    expect(JSON.stringify(a.state)).not.toContain('a@b.com');
  });
  it('redacts nested objects', () => {
    expect(r().redact({ a: ['me@x.com'], n: 1 })).toEqual({ a: ['[EMAIL_1]'], n: 1 });
  });
});

describe('research mode shrink', () => {
  it('truncates big strings with sha256 + size and dedupes repeats', () => {
    const seen = new Set<string>();
    const big = 'x'.repeat(10000);
    const a = shrink({ out: big }, seen) as any;
    expect(a.out.truncated).toBe(true);
    expect(a.out.size).toBe(10000);
    expect(a.out.sha256).toHaveLength(64);
    const b = shrink({ out: big }, seen) as any;
    expect(b.out.duplicateOf).toMatch(/^sha256:/);
    expect(shrink('small', seen)).toBe('small');
  });
});
