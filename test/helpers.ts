import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function tmpHome(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'abb-'));
  process.env.AGENT_BLACKBOX_HOME = d;
  return d;
}
export const fixture = (n: string) => path.join(__dirname, 'fixtures', n);
