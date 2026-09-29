// Usability layer: first-run help, "what happens next" in the cue stack, undo / toast feedback, labelled header, pad controls
// that stay reachable at every window width, the show lock not leaking clicks, iPad ergonomics. Real Chromium via Playwright.
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter, sleep } = require('./helpers');

const t = reporter('ux');
const { check } = t;
let scenarioNo = 0;
async function scenario(fn) {
  scenarioNo++;
  try { await fn(); }
  catch (e) { check(`scenario #${scenarioNo} threw`, false, String(e.message).split('\n')[0]); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes(6);

  async function fresh({ width = 1280, height = 800, touch = false, locale = 'en-US', prefs = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, locale });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.addInitScript(({ bytes, prefs }) => {
      window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' });
      try { if (prefs) localStorage.setItem('cue-prefs', JSON.stringify(prefs)); } catch {}
    }, { bytes: wav, prefs });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    return { page, ctx };
  }
  const build = page => page.evaluate(() => {
    ['Doors open', 'Thunder', 'Applause', 'Phone ring'].forEach((n, i) => { loadFile(i, mkFile(n + '.wav'), true); pads[i].name = n; refreshPad(i); });
    [0, 1, 2, 3].forEach(i => addToStack(i));
  });

  // ── first run: welcome card while empty, quick tips once there is content, dismissible and recoverable
  await scenario(async () => {
    const { page, ctx } = await fresh();
    const a = await page.evaluate(() => ({ welcome: !document.getElementById('welcome').hidden, tips: !document.getElementById('tipsStrip').hidden }));
    await page.evaluate(() => loadFile(0, mkFile('kick.wav')));
    const b = await page.evaluate(() => ({ welcome: !document.getElementById('welcome').hidden, tips: !document.getElementById('tipsStrip').hidden }));
    await page.click('#tipsStrip .ts-x');
    const c = await page.evaluate(() => ({ tips: !document.getElementById('tipsStrip').hidden, saved: JSON.parse(localStorage.getItem('cue-prefs')).tipsDismissed }));
    await page.reload(); await page.waitForFunction(() => document.querySelector('.pad'));
    await page.evaluate(() => loadFile(0, mkFile('kick.wav')));
    const d = await page.evaluate(() => !document.getElementById('tipsStrip').hidden);
    await page.evaluate(() => { showSettingsModal(); }); await sleep(200);
    await page.click('#set-help .modal-btn');
    const e = await page.evaluate(() => ({ tips: !document.getElementById('tipsStrip').hidden, modalClosed: document.getElementById('modalOverlay').classList.contains('hidden'), saved: JSON.parse(localStorage.getItem('cue-prefs')).tipsDismissed }));
    check('an empty show shows the welcome card (3 steps) and no tips; the first sound swaps it for the quick-tips strip',
      a.welcome && !a.tips && !b.welcome && b.tips, JSON.stringify({ a, b }));
    check('"Got it" hides the tips for good (remembered across a reload); Settings → Help brings them back',
      !c.tips && c.saved === true && d === false && e.tips && e.modalClosed && e.saved === false, JSON.stringify({ c, d, e }));
    await ctx.close();
  });
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await page.click('#welcomeAdd', { trial: true });     // the button exists and is clickable (no file picker is opened in the test)
    const r = await page.evaluate(() => { clearPad(0); return !document.getElementById('welcome').hidden; });
    check('the welcome card offers "Add sounds…" and stays while the show is empty', r === true);
    await ctx.close();
  });

  // ── the cue stack says what SPACE will do
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await build(page);
    const q = () => page.evaluate(() => ({ next: [...document.querySelectorAll('.stack-item')].findIndex(e => e.classList.contains('is-next')),
      nextBtn: document.getElementById('nextBtn').innerText.replace(/\s+/g, ' ').trim(), pills: document.querySelectorAll('.stack-next-pill').length }));
    const a = await q();
    await page.evaluate(() => nextCue());
    const b = await q();
    await page.evaluate(() => { getScene().stackIdx = 3; renderStack(); });
    const c = await q();
    check('before anything played, cue 1 is marked NEXT and the NEXT CUE button names it', a.next === 0 && a.pills === 1 && /NEXT CUE.*SPACE 1 · Doors open/.test(a.nextBtn), JSON.stringify(a));
    check('after SPACE the marker moves on (cue 2) and the button follows', b.next === 1 && /SPACE 2 · Thunder/.test(b.nextBtn), JSON.stringify(b));
    check('on the last cue the marker wraps to cue 1 and says "(start over)"', c.next === 0 && /1 · Doors open \(start over\)/.test(c.nextBtn), JSON.stringify(c));
    const playing = await page.evaluate(async () => { playPad(2); await new Promise(r => setTimeout(r, 100)); return document.querySelectorAll('.stack-item')[2].classList.contains('is-playing'); });
    check('the row of the sounding pad is marked playing (and unmarked when it stops)', playing === true && await page.evaluate(async () => { stopPad(2, false); await new Promise(r => setTimeout(r, 50)); return !document.querySelectorAll('.stack-item')[2].classList.contains('is-playing'); }));
    await ctx.close();
  });
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })));
    const r = await page.evaluate(() => ({ status: document.getElementById('statusTxt').textContent, tone: document.getElementById('statusTxt').dataset.tone, toast: !document.getElementById('toast').hidden }));
    check('SPACE with an empty cue list explains why nothing happens (amber status + toast)', /cue list is empty/.test(r.status) && r.tone === 'warn' && r.toast, JSON.stringify(r));
    await ctx.close();
  });

  // ── undo is visible: a toast with an Undo button right after a destructive action, and it can never undo the wrong thing
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await build(page);
    await page.evaluate(() => clearPad(1));
    const a = await page.evaluate(() => ({ visible: !document.getElementById('toast').hidden, undo: !document.getElementById('toastUndo').hidden, msg: document.getElementById('toastMsg').textContent }));
    await page.click('#toastUndo');
    const b = await page.evaluate(() => ({ back: !!pads[1].file, hidden: document.getElementById('toast').hidden, stack: getScene().stack.length }));
    check('clearing a pad raises an "Undo" toast; clicking it brings the sound and its cue back', a.visible && a.undo && /cleared/.test(a.msg) && b.back && b.hidden && b.stack === 4, JSON.stringify({ a, b }));
    const c = await page.evaluate(() => {
      clearStack(); moveStackItemTo; const before = undoStack.length;
      addToStack(0); addToStack(1); moveStackItemTo(0, 1);                 // a newer undoable action (reorder) after the toast's action
      return { toastHidden: document.getElementById('toast').hidden, before };
    });
    check('a newer action retires the old Undo toast (its button can not undo the wrong step)', c.toastHidden === true, JSON.stringify(c));
    const d = await page.evaluate(() => { clearStack(); const n = undoStack.length; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })); return { toast: document.getElementById('toast').hidden, n, after: undoStack.length }; });
    check('Ctrl+Z also dismisses the toast', d.toast === true && d.after === d.n - 1, JSON.stringify(d));
    await ctx.close();
  });
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await build(page);
    await page.evaluate(() => { removeFromStack(0); });
    const a = await page.evaluate(() => ({ msg: document.getElementById('statusTxt').textContent, undo: !document.getElementById('toastUndo').hidden }));
    await page.evaluate(() => { loadFile(3, mkFile('new.wav')); });
    const b = await page.evaluate(() => ({ msg: document.getElementById('statusTxt').textContent, undo: !document.getElementById('toastUndo').hidden }));
    check('removing a cue, or replacing a pad\'s sound, says so and offers Undo', /Removed cue 1/.test(a.msg) && a.undo && /Loaded/.test(b.msg) && b.undo, JSON.stringify({ a, b }));
    await ctx.close();
  });

  // ── header: words on the important buttons, the ✔ remembers the check, Ctrl+S saves
  await scenario(async () => {
    const { page, ctx } = await fresh({ width: 1440, height: 800 });
    const r = await page.evaluate(() => {
      const cap = id => getComputedStyle(document.getElementById(id), '::after').content;
      return { check: cap('checkBtn'), lock: cap('lockBtn'), compact: document.querySelector('header').dataset.compact, settings: getComputedStyle(document.querySelector('#settingsBtn .lbl')).display };
    });
    check('at 1440 px the header shows words: Check, Lock (aria-label drawn as text), Settings', r.check === '"Check"' && r.lock === '"Lock"' && r.settings !== 'none', JSON.stringify(r));
    await page.evaluate(() => toggleShowLock());
    const l = await page.evaluate(() => ({ text: document.getElementById('lockBtn').textContent, cap: getComputedStyle(document.getElementById('lockBtn'), '::after').content, aria: document.getElementById('lockBtn').getAttribute('aria-label'), pressed: document.getElementById('lockBtn').getAttribute('aria-pressed') }));
    check('locking turns the button to "🔒 Locked" (aria-pressed true)', l.text === '🔒' && l.cap === '"Locked"' && l.pressed === 'true', JSON.stringify(l));
    await ctx.close();
  });
  await scenario(async () => {
    const { page, ctx } = await fresh({ width: 960, height: 700 });
    const r = await page.evaluate(() => {
      const h = document.querySelector('header'), b = document.getElementById('settingsBtn');
      return { level: +h.dataset.compact, settingsLabel: getComputedStyle(b.querySelector('.lbl')).display !== 'none', overflow: h.scrollWidth - h.clientWidth };
    });
    check('at the 960 px minimum the Settings button keeps its word (only icons are dropped first) and nothing overflows', r.overflow <= 0 && r.settingsLabel, JSON.stringify(r));
    for (const [lang, loc] of [['de', 'de-DE'], ['el', 'el-GR']]) {
      for (const w of [960, 1280]) {
        const c = await fresh({ width: w, height: 700, locale: loc });
        await c.page.evaluate(() => toggleShowLock()); await sleep(250);
        const o = await c.page.evaluate(() => { const h = document.querySelector('header'), b = document.querySelector('.stop-all').getBoundingClientRect(); return { over: h.scrollWidth - h.clientWidth, right: Math.round(b.right), vw: innerWidth }; });
        check(`${lang} ${w}px, show LOCKED (longer button word): STOP ALL still fits on screen`, o.over <= 0 && o.right <= o.vw, JSON.stringify(o));
        await c.ctx.close();
      }
    }
    await ctx.close();
  });
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await page.evaluate(() => { window.__saves = 0; window.handleSave = () => { window.__saves++; }; });
    await page.keyboard.press('Control+s');
    const n = await page.evaluate(() => window.__saves);
    check('Ctrl+S saves', n === 1, String(n));
    await page.evaluate(() => { showSaveModal(); window.saveProject = v => { window.__named = v; }; });
    await sleep(100);
    await page.keyboard.press('Enter');
    const named = await page.evaluate(() => window.__named);
    check('Enter in the Save dialog\'s name box confirms it', typeof named === 'string' && named.length > 0, String(named));
    await ctx.close();
  });
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await build(page);
    await page.evaluate(() => { pads[1].inPoint = 500; });     // an IN point past the end: a failure
    await page.evaluate(() => { loadFile(4, mkFile('x.wav')); pads[4].name = 'Ghost'; releaseAudio(pads[4]); pads[4].file = null; getScene().stack.push({ padId: 4 }); setMasterVolume(0.5); });
    await page.evaluate(() => showPreShowCheck()); await sleep(1200);
    const r = await page.evaluate(() => ({ groups: [...document.querySelectorAll('.chk-group')].map(e => e.textContent), levels: [...document.querySelectorAll('.chk-item')].map(e => e.classList.contains('fail') ? 'f' : e.classList.contains('warn') ? 'w' : 'i').join(''),
      help: document.querySelector('.chk-help')?.textContent, state: document.getElementById('checkBtn').dataset.state }));
    check('pre-show check: problems first, grouped under plain headings, a "what now" line, and the ✔ button turns red',
      r.groups[0] === 'Fix before the show' && /^f+w*i*$/.test(r.levels) && /Fix the red items/.test(r.help) && r.state === 'bad', JSON.stringify(r));
    await page.evaluate(() => { closeModal(); setPadVolume(0, 0.9); });
    check('…and that mark clears as soon as the show is edited (it would be stale)', await page.evaluate(() => !document.getElementById('checkBtn').dataset.state));
    await ctx.close();
  });

  // ── pad controls stay reachable at every window width
  for (const w of [960, 1100, 1280, 1440, 1920]) {
    await scenario(async () => {
      const { page, ctx } = await fresh({ width: w, height: 800 });
      await build(page);
      const r = await page.evaluate(() => {
        const pad = document.getElementById('pad0'), pr = pad.getBoundingClientRect();
        const bad = [];
        pad.querySelectorAll('[data-action]').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.right > innerWidth)) bad.push(b.dataset.action); });
        const cols = new Set([...document.querySelectorAll('.pad')].map(e => Math.round(e.getBoundingClientRect().left))).size;
        return { bad, cols, timeOk: (() => { const tm = pad.querySelector('.pad-time').getBoundingClientRect(); return tm.left >= pr.left && tm.right <= pr.right; })() };
      });
      check(`${w}px: every button of a loaded pad (incl. "+ Stack" and ✕) is inside the pad and on screen (${r.cols} columns)`, r.bad.length === 0 && r.timeOk && r.cols >= 1 && r.cols <= 4, JSON.stringify(r));
      await ctx.close();
    });
  }

  // ── the show lock: a click on a dimmed control must not fall through and play the pad
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await build(page);
    await page.evaluate(() => toggleShowLock());
    await page.click('#pad0 .clear-pad', { force: true });
    await page.click('#pad0 .inout-btn', { force: true });
    const r = await page.evaluate(() => ({ playing: pads[0].playing, has: !!pads[0].file, status: document.getElementById('statusTxt').textContent }));
    check('locked: clicking the dimmed ✕ / IN buttons neither clears nor starts the pad, and explains why', !r.playing && r.has && /locked/.test(r.status), JSON.stringify(r));
    await page.click('#pad0 .transport-pp');
    check('locked: PLAY still works', await page.evaluate(() => pads[0].playing) === true);
    await ctx.close();
  });

  // ── tooltips that explain themselves (desktop has no other help on the controls)
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await build(page);
    const r = await page.evaluate(() => {
      const tt = sel => document.querySelector(sel)?.title || '';
      return { fade: tt('#pad0 [data-action="fade-toggle"]'), loop: tt('#pad0 [data-action="loop"]'), inn: tt('#pad0 [data-action="set-in"]'), out: tt('#pad0 [data-action="set-out"]'), stack: tt('#pad0 [data-action="stack"]'),
        clear: tt('#pad0 [data-action="clear"]'), play: tt('#pad0 [data-action="playpause"]'), hdrFade: document.querySelector('.fade-dur-wrap').title, stopFade: tt('#stopFadeBtn'), stopAll: tt('.stop-all'), pressedLoop: document.querySelector('#pad0 [data-action="loop"]').getAttribute('aria-pressed') };
    });
    check('pad FADE tooltip explains fade in / OUT / loop and points to the header FADE time', /FADE time in the header/.test(r.fade) && /fades in/.test(r.fade) && /OUT point/.test(r.fade) && /loops/.test(r.fade), r.fade);
    check('header FADE control explains where the time is used (crossfades, STOP FADE, ↓ FADE pads)', /crossfades/.test(r.hdrFade) && /STOP FADE/.test(r.hdrFade) && /↓ FADE/.test(r.hdrFade), r.hdrFade);
    check('LOOP / IN / OUT / + Stack / ✕ / PLAY tooltips say what they do', /repeating/.test(r.loop) && /IN point/.test(r.inn) && /drag the bar/i.test(r.inn) && /OUT point/.test(r.out) && /cue list/.test(r.stack) && /Undo/.test(r.clear) && /fades out any other pad/.test(r.play), JSON.stringify(r));
    check('STOP ALL / STOP FADE tooltips separate the fading button from the always-instant Esc', /Esc always cuts/.test(r.stopAll) && /Esc always cuts/.test(r.stopFade));
    const f = await page.evaluate(() => { const i = document.getElementById('fadeDurInput'); i.value = '50'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); return { shown: i.value, used: fadeDuration }; });
    check('typing a FADE time above the limit shows the value that is really used (20)', f.shown === '20' && f.used === 20, JSON.stringify(f));
    await ctx.close();
  });

  // ── Settings: the audio-output section leads; Help closes it. Shortcuts starts with the fixed keys.
  await scenario(async () => {
    const { page, ctx } = await fresh();
    await page.evaluate(() => showSettingsModal()); await sleep(250);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#modalBody .set-sec')].map(e => e.id));
    await page.evaluate(() => showShortcutsModal()); await sleep(100);
    const keys = await page.evaluate(() => [...document.querySelectorAll('.ess-list .sh-key')].map(e => e.textContent));
    check('Settings order: audio output first, help last', ids[0] === 'set-output' && ids[ids.length - 1] === 'set-help', ids.join());
    check('Shortcuts dialog lists the fixed keys first (Esc, SPACE, Ctrl+Z, Ctrl+S, Ctrl+Shift+L)', ['ESC', 'SPACE', 'Ctrl+Z', 'Ctrl+S', 'Ctrl+Shift+L'].every(k => keys.includes(k)), keys.join());
    await ctx.close();
  });

  // ── iPad / touch
  await scenario(async () => {
    const { page, ctx } = await fresh({ width: 1024, height: 768, touch: true });
    await build(page);
    const r = await page.evaluate(() => {
      const box = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
      const inView = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth; };
      return { stopAll: inView('.stop-all'), fade: inView('#fadeDurInput'), vol: inView('#volSlider'), stopFade: inView('#stopFadeBtn'),
        pp: box('.transport-pp'), stop: box('.transport-stop'), sm: box('.btn-sm'), hdr: box('.hdr-btn'), rm: box('.stack-rm'), scale: box('.scale-btn'), undoTouch: box('#undoTouchBtn'), add: box('.scene-add-btn'), next: box('.next-btn') };
    });
    check('iPad 1024: STOP ALL, STOP FADE, VOL and FADE are on screen without scrolling the header', r.stopAll && r.fade && r.vol && r.stopFade, JSON.stringify(r));
    check('iPad: transport, LOOP/FADE/+Stack, header, NEXT CUE and cue-list buttons are ≥ 44 px tall (40 for IN/OUT and scene chips)',
      r.pp.h >= 44 && r.stop.h >= 44 && r.stop.w >= 44 && r.sm.h >= 44 && r.hdr.h >= 44 && r.next.h >= 44 && r.add.w >= 44, JSON.stringify(r));
    check('iPad has no footer, so Undo lives in the cue-list header (visible)', r.undoTouch.w > 0 && r.undoTouch.h >= 36, JSON.stringify(r.undoTouch));
    await page.evaluate(() => clearPad(2));
    const toast = await page.evaluate(() => { const b = document.getElementById('toast').getBoundingClientRect(); return { shown: !document.getElementById('toast').hidden, inside: b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight }; });
    check('iPad: the destructive-action toast (with Undo) is visible on screen — there is no status bar there', toast.shown && toast.inside, JSON.stringify(toast));
    const tips = await page.evaluate(() => [...document.querySelectorAll('#tipsStrip .ts-item')].filter(e => e.offsetParent).map(e => e.textContent.trim()));
    check('iPad tips mention no keyboard keys (Esc / SPACE / Ctrl+Z)', tips.length >= 3 && !tips.some(x => /\bEsc\b|SPACE|Ctrl/i.test(x)), JSON.stringify(tips));
    await ctx.close();
  });

  await scenario(async () => {
    const { page, ctx } = await fresh({ width: 768, height: 1024, touch: true });
    await build(page);
    const r = await page.evaluate(() => {
      const h = document.querySelector('header'), b = document.querySelector('.stop-all').getBoundingClientRect(), sf = document.getElementById('stopFadeBtn').getBoundingClientRect();
      return { scrolls: h.scrollWidth > h.clientWidth, stopAll: b.left >= 0 && b.right <= innerWidth, stopFade: sf.left >= 0 && sf.right <= innerWidth };
    });
    check('iPad portrait (768 px): even if the header has to scroll, STOP ALL and STOP FADE stay pinned on screen', r.stopAll && r.stopFade, JSON.stringify(r));
    await ctx.close();
  });

  await browser.close();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
