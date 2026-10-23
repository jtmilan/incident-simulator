// Fails the build if the JavaScript a first-time visitor downloads (gzipped) exceeds the budget.
// The ?debug console is excluded: normal visitors never request it.
// Two more guards: the entry chunk (what blocks first paint) has its own budget, and the animation
// library may only live in the lazily loaded motion chunk.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 300;
const ENTRY_BUDGET_KB = 25;
// A property only anime.js's engine has; it must never appear in the entry chunk.
const ANIME_SIGNATURE = 'useDefaultMainLoop';
const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('debug-view'));
let total = 0;
let failed = false;
for (const file of files) {
  const source = readFileSync(join(dir, file));
  const kb = gzipSync(source).length / 1024;
  total += kb;
  console.log(`${file.padEnd(32)} ${kb.toFixed(1)} KB gz`);
  if (file.startsWith('index-') && kb > ENTRY_BUDGET_KB) {
    console.error(`entry chunk ${file} is ${kb.toFixed(1)} KB gz (budget ${ENTRY_BUDGET_KB} KB)`);
    failed = true;
  }
  // Any chunk but the lazy engine chunk (shared or vendor chunks included) must be free of it.
  if (!file.startsWith('engine-') && source.includes(ANIME_SIGNATURE)) {
    console.error(`${file} contains the animation engine; it must stay in the lazy engine chunk`);
    failed = true;
  }
}
console.log(`total ${total.toFixed(1)} KB gz (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB) {
  console.error(`JS budget exceeded by ${(total - BUDGET_KB).toFixed(1)} KB`);
  failed = true;
}
if (failed) process.exit(1);
