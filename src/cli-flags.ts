import { parseArgs } from 'node:util';

export const DEFAULT_TSA_URL = 'https://freetsa.org/tsr';

export function parseCliArgs(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    tokens: true,
    options: {
      'no-redact': { type: 'boolean' },
      research: { type: 'boolean' },
      write: { type: 'boolean' },
      latest: { type: 'boolean' },
      port: { type: 'string' },
      format: { type: 'string' },
      out: { type: 'string' },
      tsa: { type: 'string' },
      json: { type: 'boolean' },
      intent: { type: 'string' },
      timestamp: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
}

type CliTokens = ReturnType<typeof parseCliArgs>['tokens'];
type CliToken = CliTokens[number];

function isTsaToken(token: CliToken): token is Extract<CliToken, { kind: 'option' }> {
  return token.kind === 'option' && token.name === 'tsa';
}

export function resolveTsa(values: { tsa?: unknown; timestamp?: unknown }, tokens: CliTokens): string | undefined {
  if (values.tsa === undefined) return values.timestamp === true ? DEFAULT_TSA_URL : undefined;
  if (typeof values.tsa !== 'string') throw new Error('--tsa requires a URL value');
  const token = [...tokens].reverse().find(isTsaToken);
  if (token && !token.inlineValue && typeof token.value === 'string' && token.value.startsWith('-')) throw new Error('--tsa requires a URL value');
  return values.tsa;
}
