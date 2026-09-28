// Shared bits for the test scripts. No test framework: each script is a plain Node program
// that prints PASS/FAIL lines and exits non-zero on failure (see run.js).
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
// KCUE_INDEX lets you point the browser tests at another copy of the page (e.g. an older commit) to prove a test can fail.
const INDEX = process.env.KCUE_INDEX || path.join(ROOT, 'index.html');

// A silent 8-bit mono WAV (default 6 s) — small, decodes everywhere, long enough for fade tests.
function wavBytes(seconds = 6) {
  const rate = 8000, n = rate * seconds;
  const b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const w = (o, s) => [...s].forEach((c, i) => { b[o + i] = c.charCodeAt(0); });
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
  return Array.from(b);
}

// Collects results, prints a summary, exits with the right code.
function reporter(title) {
  const results = [];
  return {
    check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); },
    skip(name, why) { console.log(` SKIP  ${name}   (${why})`); },
    finish() {
      const bad = results.filter(r => !r.ok);
      console.log(`\n=== ${title}: ${results.length - bad.length}/${results.length} passed ===`);
      for (const r of results) console.log(`${r.ok ? ' PASS' : ' FAIL'}  ${r.name}${r.ok ? '' : '   ← ' + r.detail}`);
      process.exit(bad.length ? 1 : 0);
    },
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { ROOT, INDEX, wavBytes, reporter, sleep };
