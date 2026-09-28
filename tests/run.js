// `npm test` — runs every *.test.js in this folder one after another and fails if any does.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n────────── ${f}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} of ${files.length} test file(s) FAILED` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
