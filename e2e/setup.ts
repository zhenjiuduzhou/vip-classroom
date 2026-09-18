import { execFileSync } from 'node:child_process';
export default async function setup(){execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/seed.ts'],{stdio:'pipe'});}
