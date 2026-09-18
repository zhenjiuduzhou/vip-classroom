import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertProductionBranch, generateProductionConfig } from './cloudflare-config';

// Explicit --config prevents publishing the development configuration.
assertProductionBranch(process.env);
await generateProductionConfig();
const root = fileURLToPath(new URL('../',import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
for (const args of [
  ['d1','migrations','apply','DB','--remote','--config','wrangler.production.jsonc'],
  ['deploy','--config','wrangler.production.jsonc']
]) {
  const result = spawnSync(process.execPath,[cli,...args],{cwd:root,stdio:'inherit',env:{...process.env,CI:'true'}});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
