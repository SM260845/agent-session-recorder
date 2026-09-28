import { describe, expect, it } from 'vitest';
import { DEFAULT_TSA_URL, parseCliArgs, resolveTsa } from '../src/cli-flags.js';

describe('CLI TSA flags', () => {
  it('uses the default TSA for --timestamp', () => {
    const { values, tokens } = parseCliArgs(['seal', 's1', '--timestamp']);
    expect(resolveTsa(values, tokens)).toBe(DEFAULT_TSA_URL);
  });

  it('rejects --tsa with a missing value before dispatch', () => {
    const { values, tokens } = parseCliArgs(['bundle', 's1', '--intent', '20260929-demo', '--tsa', '--out', 'x']);
    expect(() => resolveTsa(values, tokens)).toThrow(/--tsa requires a URL value/);
  });
});
