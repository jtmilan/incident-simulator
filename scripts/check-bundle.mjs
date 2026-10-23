// Fails the build if the JavaScript a first-time visitor downloads (gzipped) exceeds the budget.
// The ?debug console is excluded: normal visitors never request it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 300;
const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('debug-view'));
let total = 0;
for (const file of files) {
  const kb = gzipSync(readFileSync(join(dir, file))).length / 1024;
  total += kb;
  console.log(`${file.padEnd(32)} ${kb.toFixed(1)} KB gz`);
}
console.log(`total ${total.toFixed(1)} KB gz (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB) {
  console.error(`JS budget exceeded by ${(total - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
