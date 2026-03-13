#!/usr/bin/env node

import { bootstrapLocalDev, mintLocalDevAccessToken, readLocalDevConfig } from './local-dev.ts';

async function main(argv: string[]): Promise<void> {
  const envFile = argv[0] ?? '.env';
  const config = readLocalDevConfig(envFile);

  await bootstrapLocalDev(config, (message) => process.stderr.write(`${message}\n`));
  const token = await mintLocalDevAccessToken(config);
  process.stdout.write(`${token}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
