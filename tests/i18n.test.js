// Translations: table integrity, coverage (static + runtime), and behaviour of the engine in a real browser.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { ROOT, INDEX, wavBytes, reporter, sleep } = require('./helpers');
const { harvest } = require('./tools/harvest-i18n');

const t = reporter('i18n');
const ck = (n, ok, d = '') => t.check(n, ok, d);
const html = fs.readFileSync(INDEX, 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

// ── load the table without running the app: evaluate just the I18N_TABLE literal
const tableSrc = /const I18N_TABLE = (\[[\s\S]*?\n\]);\n/.exec(script)[1];
const TABLE = new Function(`return ${tableSrc}`)();
const ph = s => [...s.matchAll(/\{(\d+)!?\}/g)].map(m => m[1]).sort().join(',');
const phDeep = s => [...s.matchAll(/\{(\d+)(!?)\}/g)].map(m => m[1] + m[2]).sort().join(',');

// ── 1. table integrity
ck(`the table has ${TABLE.length} rows, each with an English key, a Greek and a German translation`,
  TABLE.length > 250 && TABLE.every(r => r.length === 3 && r.every(x => typeof x === 'string' && x.trim())), String(TABLE.length));
const keys = TABLE.map(r => r[0]);
ck('no duplicate English keys', new Set(keys).size === keys.length, keys.filter((k, i) => keys.indexOf(k) !== i).join(' | '));
const badPh = TABLE.filter(([en, el, de]) => ph(en) !== ph(el) || ph(en) !== ph(de));
ck('every translation uses exactly the same {placeholders} as its English key', badPh.length === 0, badPh.map(r => r[0]).join(' | '));
const badDeep = TABLE.filter(([en]) => /\{\d+!\}/.test(en)).filter(([en, el, de]) => phDeep(en) !== phDeep(el) || phDeep(en) !== phDeep(de));
ck('nested-translation flags ({0!}) are kept in the translations', badDeep.length === 0, badDeep.map(r => r[0]).join(' | '));
const untranslated = TABLE.filter(([en, el, de]) => (el === en || de === en) && /[A-Za-z]{4,}/.test(en) && !/^(Pad \{0\}|Sound|Port|CC \{0\}|MIDI: \{0\} → \{1!\}|Pad \{0\} — \{1\}|Pad \{0\}: |TEXT)/.test(en) && !/^(STOP|Update)/.test(en));
ck('no row is silently left identical to English (except the deliberate ones)', untranslated.length === 0, untranslated.map(r => r[0]).join(' | '));

// ── 2. static coverage: every setStatus() / confirm() message in the source has a translation
function scanLiterals(src, start) {                 // src[start] is just after "(" ; returns { lits, nested, end }
  const lits = [], nested = [];
  let depth = 1, i = start;
  const readString = q => { let v = ''; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') { v += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; } else v += src[i++]; } i++; return v; };
  const readTemplate = () => {
    let v = '', n = 0; i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { v += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; }
      else if (src[i] === '$' && src[i + 1] === '{') {
        let d = 1; i += 2; const exprStart = i;
        while (i < src.length && d > 0) {
          if (src[i] === '{') d++; else if (src[i] === '}') d--;
          else if (src[i] === '\'' || src[i] === '"') { readString(src[i]); continue; }
          else if (src[i] === '`') { const inner = readTemplate(); nested.push(inner.v); continue; }
          i++;
        }
        const expr = src.slice(exprStart, i - 1);
        for (const m of expr.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)) nested.push(m[1] ?? m[2]);   // words spliced in by a ternary / fallback
        v += `{${n++}}`;
      } else v += src[i++];
    }
    i++;
    return { v };
  };
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '(') { depth++; i++; }
    else if (c === ')') { depth--; i++; }
    else if (c === '\'' || c === '"') lits.push(readString(c));
    else if (c === '`') lits.push(readTemplate().v);
    else i++;
  }
  return { lits, nested };
}
const found = [], spliced = [];
for (const m of script.matchAll(/(?<![\w.])(setStatus|confirm)\(/g)) {
  const line = script.slice(script.lastIndexOf('\n', m.index) + 1, script.indexOf('\n', m.index));
  if (/function setStatus|window\.confirm|_nativeConfirm/.test(line)) continue;
  const { lits, nested } = scanLiterals(script, m.index + m[0].length);
  found.push(...lits); spliced.push(...nested);
}
// messages built as  'prefix: ' + dynamicValue  →  the key is  "prefix: {0}"
const concatKeys = ['Save failed: {0}', 'Update error: {0}', 'Import failed: {0!}', 'Loaded {0} sound(s)', 'Loaded {0} sound(s) — {1} non-audio file(s) skipped', 'Loaded {0} sound(s) — stopped at {1} pads', 'Loaded {0} sound(s) — {1} non-audio file(s) skipped — stopped at {2} pads'];
const normalise = s => s.replace(/\n/g, '\n');
const keySet = new Set(keys.map(k => k.replace(/\{(\d+)!\}/g, '{$1}')));   // ({0!} is the same key as {0} for matching)
const missing = [...new Set(found.filter(x => x.trim()).map(normalise))].filter(x => {
  if (keySet.has(x)) return false;
  if (x === 'Save failed: ' || x === 'Update error: ' || x === 'Import failed: ' || x === '⚠ ' || x === 'unknown') return false;
  if (x === 'NotAllowedError') return false;                                                      // a comparison, not a message
  if (x === ' — {0} non-audio file(s) skipped' || x === ' — stopped at {0} pads') return false;   // pieces of the composed "Loaded …" message (all 4 combinations are keys, checked below)
  if (/^Generate a new access token\?\n\nEvery phone/.test(x)) return false;                     // covered by its two halves (line-by-line)
  if (/^(A project named ".*" already exists|Delete ".*" and its audio)/.test(x) || /\n\n/.test(x)) return false;   // multi-line: each line is a key
  return true;
});
// multi-line confirm() text is translated line by line — check each line
const multi = found.filter(x => /\n\n/.test(x)).flatMap(x => x.split('\n').filter(Boolean)).filter(l => !keySet.has(l) && !/^\{\d\}$/.test(l));
const multiMissing = multi.filter(l => ![...keySet].some(k => /\{\d+!?\}/.test(k) && new RegExp('^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\d+!?\\\}/g, '[\\s\\S]*?') + '$').test(l)));
ck('every setStatus() / confirm() message in the source has a translation (a new English message without one fails here)',
  missing.length === 0 && multiMissing.length === 0, JSON.stringify({ missing, multiMissing }, null, 1).slice(0, 900));
for (const k of concatKeys) if (!keySet.has(k.replace(/\{(\d+)!\}/g, '{$1}'))) ck(`concatenated message key present: ${k}`, false);
const allowedSplice = new Set(['Unnamed', 'That file', 'Project', 'unknown', 'note', 'CC ', 'Pad ', '']);
const badSplice = [...new Set(spliced)].filter(x => x && !allowedSplice.has(x));
ck('no message splices English words into a sentence (they would be untranslatable): only name fallbacks are allowed', badSplice.length === 0, JSON.stringify(badSplice));

(async () => {
  const wav = wavBytes(3);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  // ── 3. runtime coverage: drive every screen and dialog under each language; only deliberate leftovers may remain English
  const ALLOWED_ENGLISH = new Set(['ESC', 'FADE', 'KOSTUDIO AUDIO CUE', 'My Show', 'OUT ◼', 'PADS', 'PAUSE', 'PLAY', 'RESUME', 'SPACE', 'STOP FADE', 'VOL', 'Wi-Fi', '↓ FADE', '■ STOP ALL', '▶ IN', '⟳ LOOP']);
  const isUserData = x => /^(Sound \d|One|a\.wav|C:\\x\.wav|USB Audio Interface|\d)/.test(x) || /^\d+\/\d+\/\d+/.test(x);
  for (const lang of ['el', 'de']) {
    const left = (await harvest(lang)).filter(x => /[A-Za-z]/.test(x) && x.length > 1 && !ALLOWED_ENGLISH.has(x) && !isUserData(x) && !/^[\d:\s/−⟳-]+$/.test(x));
    ck(`runtime coverage (${lang}): every screen, dialog and state — nothing is left in English except deliberate control labels`, left.length === 0, JSON.stringify(left));
  }

  async function fresh(opts = {}) {
    const ctx = await browser.newContext({ locale: opts.locale || 'en-US', viewport: opts.viewport || { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    if (opts.prefs) await page.addInitScript(p => localStorage.setItem('cue-prefs', JSON.stringify(p)), opts.prefs);
    await page.addInitScript(bytes => { window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' }); }, wav);
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    return { page, dialogs, ctx };
  }
  const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent.trim(), sel);

  // ── 4. language selection
  {
    const cases = [['el-GR', 'el'], ['de-AT', 'de'], ['de', 'de'], ['fr-FR', 'en'], ['en-GB', 'en'], ['elx', 'en']];
    const got = [];
    for (const [loc] of cases) { const { page, ctx } = await fresh({ locale: loc }); got.push(await page.evaluate(() => LANG)); await ctx.close(); }
    ck('the language is detected from the browser (el-GR → Greek, de-AT → German, anything else → English)', got.join() === cases.map(c => c[1]).join(), got.join());
    const { page, ctx } = await fresh({ locale: 'el-GR', prefs: { lang: 'de' } });
    ck('a saved language choice beats the browser language; <html lang> follows', await page.evaluate(() => LANG === 'de' && document.documentElement.lang === 'de'));
    await ctx.close();
  }

  // ── 5. the main screen really changes language, and user text is never touched
  {
    const { page, ctx } = await fresh({ locale: 'el-GR' });
    await page.evaluate(() => {
      loadFile(0, mkFile('kick.wav')); pads[0].name = 'Save'; refreshPad(0);               // a pad NAMED like a button must stay "Save"
      pads[1].name = 'Cancel'; loadFile(1, mkFile('b.wav')); pads[1].name = 'Cancel'; refreshPad(1);
      addToStack(0); addToStack(1); renderStack();
      scenes[0].name = 'Close'; renderSceneTabs();
    });
    await sleep(100);
    const r = await page.evaluate(() => ({
      saveBtn: document.querySelector('.hdr-btn.save').textContent.trim(),
      stackTitle: document.querySelector('.stack-title').textContent.trim(),
      padName0: document.getElementById('pname0').textContent.trim(), padName1: document.getElementById('pname1').textContent.trim(),
      stackLbl: [...document.querySelectorAll('.stack-lbl')].map(e => e.textContent.trim()).join(),
      scene: document.querySelector('.scene-name').textContent.trim(),
      emptyPad: document.getElementById('pname5').textContent.trim(),
      status: document.getElementById('statusTxt').textContent,
      donateTitle: document.getElementById('donateBtn').title, lockTitle: document.getElementById('lockBtn').title,
      undoBtn: document.getElementById('undoBtn').textContent.trim(),
      tip: document.querySelector('.tip').textContent.trim(),
    }));
    ck('Greek: header, stack panel, empty pads, tooltips and status are translated; pads / cues / scenes named "Save", "Cancel", "Close" are NOT',
      /Αποθήκευση/.test(r.saveBtn) && r.stackTitle === 'Λίστα Cue' && r.padName0 === 'Save' && r.padName1 === 'Cancel' && r.stackLbl === 'Save,Cancel' && r.scene === 'Close' &&
      r.emptyPad === 'Κλικ ή σύρετε αρχείο' && /προστέθηκε στη λίστα/.test(r.status) && /δωρεάν/.test(r.donateTitle) && /Κλείδωμα/.test(r.lockTitle) && /Αναίρεση/.test(r.undoBtn), JSON.stringify(r));

    // a status with values: names come through untouched inside the translated sentence
    await page.evaluate(() => { loadFile(2, mkFile('My "quoted" file.wav')); });
    const st = await text(page, '#statusTxt');
    ck('values inside messages survive translation ("My \\"quoted\\" file.wav" inside the Greek sentence)', st === 'Φορτώθηκε το "My "quoted" file"', st);

    // nested translation: the undo label inside "Undid: …"
    await page.evaluate(() => { clearPad(0); undo(); });
    const und = await text(page, '#statusTxt');
    ck('nested translation: "Undid: cleared pad 1 …" translates both the frame and the action', /^Αναιρέθηκε: καθαρίστηκε το pad 1/.test(und), und);

    await ctx.close();
  }
  {
    // (separate context so the dialog text can be asserted directly)
    const { page, dialogs, ctx } = await fresh({ locale: 'de-DE' });
    await page.evaluate(() => { loadFile(0, mkFile('a.wav')); addScene(); addToStack(0); removeScene(1); });
    await sleep(100);
    ck('German: confirm() text is translated ("Szene … und ihre 1 Cue(s) löschen?")', dialogs.some(d => /^Szene ".*" und ihre 1 Cue\(s\) löschen\?/.test(d)), JSON.stringify(dialogs));
    const r = await page.evaluate(async () => {
      pads[3].name = 'Ghost'; getScene().stack.push({ padId: 3 }); pads[4].inPoint = 99;
      loadFile(4, mkFile('x.wav')); pads[4].inPoint = 99;
      await new Promise(res => setTimeout(res, 300));
      const res = await runPreShowCheck();
      showPreShowCheck(); await new Promise(res => setTimeout(res, 800));
      return { verdict: document.getElementById('chkVerdict')?.textContent.trim(), rows: [...document.querySelectorAll('.chk-tx')].map(e => e.textContent) };
    });
    ck('German pre-show check: verdict and each issue sentence (with 4 embedded values) are translated',
      /NICHT BEREIT/.test(r.verdict) && r.rows.some(x => /^Pad 5 "x": Der IN-Punkt \(1:39\) liegt hinter dem Ende des Sounds/.test(x)) && r.rows.some(x => /Cue \d+ \(Pad 4 "Ghost"\) hat kein Audio/.test(x)), JSON.stringify(r));
    await ctx.close();
  }

  // ── 6. switching language in place: nothing reloads, nothing is lost, and going back to English restores the original text exactly
  {
    const { page, ctx } = await fresh();
    await page.evaluate(() => { loadFile(0, mkFile('kick.wav')); addToStack(0); showSettingsModal(); });
    await sleep(500);                                             // let the Settings sections that fill in asynchronously finish
    const snap = () => page.evaluate(() => ({ hdr: document.querySelector('header').innerText, stack: document.getElementById('stackPanel').innerText, pads: document.getElementById('padsGrid').innerText, modal: document.getElementById('modalBox').innerText, foot: document.querySelector('footer').innerText }));
    const en1 = await snap();
    await page.selectOption('#langSelect', 'el');
    await sleep(150);
    const el = await snap();
    const kept = await page.evaluate(() => ({ file: pads[0].file?.name, stack: getScene().stack.length, lang: LANG, saved: JSON.parse(localStorage.getItem('cue-prefs')).lang, sel: document.getElementById('langSelect').value }));
    await page.selectOption('#langSelect', 'de');
    await sleep(150);
    const de = await snap();
    await page.selectOption('#langSelect', 'auto');
    await sleep(150);
    const en2 = await snap();
    ck('switching language in place changes header, stack, pads, footer and the open Settings dialog — with no reload and no loss of the loaded show',
      el.hdr !== en1.hdr && el.stack !== en1.stack && el.pads !== en1.pads && el.foot !== en1.foot && el.modal !== en1.modal && de.hdr !== el.hdr && de.modal !== el.modal &&
      kept.file === 'kick.wav' && kept.stack === 1 && kept.lang === 'el' && kept.saved === 'el' && kept.sel === 'el', JSON.stringify({ kept }));
    ck('…and "Automatic" (→ English here) restores the original English text exactly, with no Greek / German left behind', JSON.stringify(en2) === JSON.stringify(en1), JSON.stringify({ a: en1.hdr, b: en2.hdr }).slice(0, 300));
    await ctx.close();
  }

  // ── 7. layout: longer languages must not push the transport controls off-screen
  for (const lang of ['el', 'de']) {
    for (const w of [960, 1121, 1281, 1441]) {
      const { page, ctx } = await fresh({ locale: lang === 'el' ? 'el-GR' : 'de-DE', viewport: { width: w, height: 700 } });
      const r = await page.evaluate(() => {
        const h = document.querySelector('header');
        const inView = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth; };
        return { overflow: h.scrollWidth - h.clientWidth, stopAll: inView('.stop-all'), vol: inView('#volSlider'), fade: inView('#fadeDurInput'), stopFade: inView('#stopFadeBtn'), save: inView('.hdr-btn.save') };
      });
      ck(`${lang} at ${w}px: the header still fits (STOP ALL, VOL, FADE, STOP FADE, Save all on screen)`, r.overflow <= 0 && r.stopAll && r.vol && r.fade && r.stopFade && r.save, JSON.stringify(r));
      await ctx.close();
    }
  }

  // ── 8. the phone remote page
  {
    const rh = fs.readFileSync(path.join(ROOT, 'remote.html'), 'utf8');
    ck('the phone remote page carries Greek and German too (detected from the phone\'s language)', /el:\s*\{/.test(rh) && /de:\s*\{/.test(rh) && /navigator\.language/.test(rh));
  }

  await browser.close();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
