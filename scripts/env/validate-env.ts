#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE =
  'usage: node --experimental-strip-types scripts/env/validate-env.ts [--keys-only] <required-keys-file> <env-file>';

type ValidateEnvOptions = {
  keysOnly?: boolean;
};

function parseRequiredKeys(requiredText: string): string[] {
  return requiredText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function parseEnvEntries(envText: string): Map<string, string> {
  const envEntries = new Map<string, string>();

  for (const rawLine of envText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const line = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trimStart()
      : trimmed;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);

    if (key !== '') {
      envEntries.set(key, value);
    }
  }

  return envEntries;
}

export function validateEnv(
  requiredText: string,
  envText: string,
  options: ValidateEnvOptions = {}
): string[] {
  const { keysOnly = false } = options;
  const requiredKeys = parseRequiredKeys(requiredText);
  const envEntries = parseEnvEntries(envText);

  const missingKeys: string[] = [];

  for (const key of requiredKeys) {
    if (!envEntries.has(key)) {
      missingKeys.push(key);
      continue;
    }

    if (!keysOnly && envEntries.get(key) === '') {
      missingKeys.push(key);
    }
  }

  return missingKeys;
}

export function validateEnvFiles(
  requiredFile: string,
  envFile: string,
  options: ValidateEnvOptions = {}
): string[] {
  const requiredText = fs.readFileSync(requiredFile, 'utf8');
  const envText = fs.readFileSync(envFile, 'utf8');
  return validateEnv(requiredText, envText, options);
}

function main(argv: string[]): void {
  const args = [...argv];
  let keysOnly = false;

  if (args[0] === '--keys-only') {
    keysOnly = true;
    args.shift();
  }

  if (args.length !== 2) {
    console.error(USAGE);
    process.exit(2);
  }

  const [requiredFile, envFile] = args;

  if (!fs.existsSync(requiredFile)) {
    console.error(`required keys file not found: ${requiredFile}`);
    process.exit(2);
  }

  if (!fs.existsSync(envFile)) {
    console.error(`env file not found: ${envFile}`);
    process.exit(2);
  }

  const missingKeys = validateEnvFiles(requiredFile, envFile, { keysOnly });

  if (missingKeys.length > 0) {
    console.error(`Missing required env keys: ${missingKeys.join(' ')}`);
    process.exit(1);
  }

  console.log(`Validation passed: ${envFile}`);
}

const modulePath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(modulePath);

if (isMain) {
  main(process.argv.slice(2));
}
