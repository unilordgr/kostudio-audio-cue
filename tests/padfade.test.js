// A FADE time per pad: the small box next to ↓ FADE. Empty = the pad follows the FADE time in the header; a number is that pad's own
// time for everything it fades — fade in, fade out / stop, crossfade with another pad or cue, STOP ALL, its loop crossfade / OUT fade.
// Measured on the real <audio> elements' volumes in a real Chromium; saved with the show.
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter } = require('./helpers');

const t = reporter('padfade');
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

  async function fresh() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.addInitScript(bytes => { window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' }); }, wav);
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad') && typeof setPadFade === 'function');
    await page.evaluate(async () => {
      document.getElementById('tipsStrip').hidden = true;
      ['Thunder', 'Rain', 'Wind'].forEach((n, i) => { loadFile(i, mkFile(n + '.wav'), true); pads[i].name = n; refreshPad(i); });
      await new Promise(r => setTimeout(r, 400));
    });
    return { page, errors };
  }
  // Run a named action in the page, then sample every 25 ms for `ms`: each pad's element volume and playing flag, and the STOP ALL guard.
  // (Named actions, not code strings: the page's CSP forbids eval.)
  const sample = (page, cfg) => page.evaluate(async ({ act, ms, fades, header, stopFade }) => {
    pads.forEach((p, i) => { if (i < 3) { p.fade = fades[i] ?? null; p.fadeEnabled = false; p.loop = false; p.inPoint = p.outPoint = null; p.vol = 1; } });
    fadeDuration = header; masterVol = 1; prefs.stopFade = !!stopFade;
    const t0 = performance.now(), out = [];
    const doAct = () => {
      if (act === 'in0')       playPad(0, true);
      else if (act === 'in1')  playPad(1, true);
      else if (act === 'in2')  playPad(2, true);
      else if (act === 'out')  { [0, 1, 2].forEach(i => { pads[i].audio.play(); pads[i].playing = true; pads[i].audio.volume = 1; }); [0, 1, 2].forEach(i => stopPad(i, true)); }
      else if (act === 'cross') { playPad(0); pads[0].audio.volume = 1; setTimeout(() => togglePadCrossfade(1), 0); }
      else if (act === 'stopall') { playPad(0); playPad(1); pads[0].audio.volume = 1; pads[1].audio.volume = 1; setTimeout(() => stopAll(), 0); }
    };
    doAct();
    while (performance.now() - t0 < ms) {
      out.push({ t: Math.round(performance.now() - t0), v: pads.slice(0, 3).map(p => +p.audio.volume.toFixed(3)), on: pads.slice(0, 3).map(p => !!p.playing), guard: stopAllFading });
      await new Promise(r => setTimeout(r, 25));
    }
    return out;
  }, cfg);
  const at = (a, ms) => a.reduce((b, x) => Math.abs(x.t - ms) < Math.abs(b.t - ms) ? x : b, a[0]);
  const reset = page => page.evaluate(() => { stopAll('cut'); pads.slice(0, 3).forEach(p => { p.audio.currentTime = 0; p.audio.volume = 1; p.playing = false; p.paused = false; p.stopping = false; clearFadeTimer(p.id); }); });

  // ── 1. the box: shows the header's time as a grey hint, takes a number, clamps, ignores nonsense, empty = follow the header
  await scenario(async () => {
    const { page, errors } = await fresh();
    const q = await page.evaluate(() => ({
      loaded: !!document.getElementById('pfade-0'), empty: !document.getElementById('pfade-5'),
      hint: document.getElementById('pfade-0').placeholder, val: document.getElementById('pfade-0').value,
    }));
    check('every loaded pad has a FADE time box showing the header time (2s) as a grey hint; an empty pad has none', q.loaded && q.empty && q.hint === '2s' && q.val === '', JSON.stringify(q));
    const box = '#pad0 .pad-fade';
    await page.click(box); await page.keyboard.type('3'); await page.keyboard.press('Enter');
    let s = await page.evaluate(() => ({ fade: pads[0].fade, val: document.getElementById('pfade-0').value, custom: document.getElementById('pfade-0').classList.contains('custom'), key3: pads[2].playing, p0: pads[0].playing }));
    check('typing 3 and Enter sets that pad\'s FADE time (shown as 3s, highlighted); typing in the box does not trigger the pad keys or play the pad', s.fade === 3 && s.val === '3s' && s.custom && !s.key3 && !s.p0, JSON.stringify(s));
    const set = async txt => { await page.evaluate(() => { const i = document.getElementById('pfade-0'); i.focus(); }); await page.fill(box, txt); await page.keyboard.press('Enter'); return page.evaluate(() => pads[0].fade); };
    check('"2,5" (comma) means 2.5, "50" is clamped to 20, "0" to 0.1', (await set('2,5')) === 2.5 && (await set('50')) === 20 && (await set('0')) === 0.1);
    check('text that is not a number leaves it as it was', (await set('abc')) === 0.1);
    check('emptying the box makes the pad follow the header again', (await set('')) === null);
    await page.fill(box, '1'); await page.keyboard.press('Enter');
    await page.focus(box); await page.keyboard.press('ArrowUp');
    const up = await page.evaluate(() => pads[0].fade);
    await page.keyboard.press('Shift+ArrowDown');
    const down = await page.evaluate(() => pads[0].fade);
    check('↑ adds half a second, Shift+↓ takes off a tenth', up === 1.5 && down === 1.4, JSON.stringify({ up, down }));
    await page.evaluate(() => setPadFade(0, ''));
    await page.fill('#fadeDurInput', '3.5');
    const hint = await page.evaluate(() => document.getElementById('pfade-1').placeholder);
    check('changing the header FADE time updates the hint on every pad', hint === '3.5s', hint);
    await page.fill('#fadeDurInput', '2');
    // pressing in the box is not a click on the pad and not a drag handle
    await page.evaluate(() => setPadFade(0, '1.2'));
    const b = await page.locator('#pad0 .pad-fade').boundingBox(), z = await page.locator('#pad3').boundingBox();
    await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.mouse.move(z.x + 80, z.y + 60, { steps: 8 }); await page.mouse.up();
    const m = await page.evaluate(() => ({ order: padOrder.slice(0, 4), playing: pads.some(p => p.playing) }));
    check('dragging from the box neither moves the card nor plays anything', JSON.stringify(m.order) === '[0,1,2,3]' && !m.playing, JSON.stringify(m));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ── 2. fade IN takes the pad's own time
  await scenario(async () => {
    const { page } = await fresh();
    const a = await sample(page, { act: 'in0', ms: 900, fades: [0.4, null, 1.2], header: 2 });
    check('a pad with its own 0.4 s FADE fades in over 0.4 s (not the header\'s 2 s): half way at 0.2 s, full by 0.55 s',
      at(a, 200).v[0] > 0.3 && at(a, 200).v[0] < 0.75 && at(a, 560).v[0] > 0.97, JSON.stringify({ t200: at(a, 200).v[0], t560: at(a, 560).v[0] }));
    await reset(page);
    const b = await sample(page, { act: 'in1', ms: 1300, fades: [0.4, null, 1.2], header: 1.0 });
    check('a pad with no FADE time of its own uses the header: with the header at 1 s it is at about half at 0.5 s, full at 1.1 s',
      at(b, 500).v[1] > 0.3 && at(b, 500).v[1] < 0.7 && at(b, 1150).v[1] > 0.97, JSON.stringify({ t500: at(b, 500).v[1], t1150: at(b, 1150).v[1] }));
    await reset(page);
    const c = await sample(page, { act: 'in2', ms: 1700, fades: [0.4, null, 1.2], header: 2 });
    check('a pad with 1.2 s fades in over 1.2 s: still below 0.6 at 0.5 s, full by 1.4 s',
      at(c, 500).v[2] < 0.6 && at(c, 500).v[2] > 0.2 && at(c, 1450).v[2] > 0.97, JSON.stringify({ t500: at(c, 500).v[2], t1450: at(c, 1450).v[2] }));
    await page.close();
  });

  // ── 3. fade OUT (a stop with a fade) takes the pad's own time: three pads, three lengths, one STOP
  await scenario(async () => {
    const { page } = await fresh();
    const s = await sample(page, { act: 'out', ms: 2000, fades: [0.4, null, 1.2], header: 2 });
    const x = at(s, 600), y = at(s, 1500);
    check('stopping three pads with fades of 0.4 s / header 2 s / 1.2 s: at 0.6 s the first is done, the others still audible', !x.on[0] && x.v[1] > 0.4 && x.on[1] && x.on[2] && x.v[2] > 0.2, JSON.stringify(x));
    check('…at 1.5 s the 1.2 s pad is done and the header-time pad (2 s) is still fading', !y.on[2] && y.on[1] && y.v[1] > 0.05 && y.v[1] < 0.5, JSON.stringify(y));
    check('…and the header-time pad is done by 2.2 s', !at(s, 1990).on[1] || at(s, 1990).v[1] < 0.05, JSON.stringify(at(s, 1990)));
    await page.close();
  });

  // ── 4. a crossfade between two pads: the one going out and the one coming in each use their own time
  await scenario(async () => {
    const { page } = await fresh();
    const s = await sample(page, { act: 'cross', ms: 1500, fades: [0.4, 1.2, null], header: 2 });
    const x = at(s, 600);
    check('crossfading pad 1 (out, 0.4 s) into pad 2 (in, 1.2 s): at 0.6 s the first is silent / stopped and the second is only about half up',
      !x.on[0] && x.v[1] > 0.25 && x.v[1] < 0.75 && at(s, 1400).v[1] > 0.97, JSON.stringify({ x, t1400: at(s, 1400).v[1] }));
    await page.close();
  });

  // ── 5. STOP ALL with STOP FADE: each pad fades over its own time, and the "still fading" guard lasts for the slowest
  await scenario(async () => {
    const { page } = await fresh();
    const s = await sample(page, { act: 'stopall', ms: 2000, fades: [0.3, 1.5, null], header: 2, stopFade: true });
    const x = at(s, 600), y = at(s, 1200);
    check('STOP ALL with STOP FADE: the 0.3 s pad is gone at 0.6 s while the 1.5 s one is still fading (between 0.2 and 0.8)', !x.on[0] && x.on[1] && x.v[1] > 0.2 && x.v[1] < 0.8, JSON.stringify(x));
    check('…the "fading" guard (it keeps auto-advance from starting the next cue) is still up at 1.2 s, i.e. it follows the slowest pad (1.5 s), not the header (2 s) or the fastest', y.guard === true && y.on[1], JSON.stringify(y));
    check('…and the 1.5 s pad is stopped by 1.9 s and the guard is down', !at(s, 1950).on[1] && at(s, 1950).guard === false, JSON.stringify(at(s, 1950)));
    await page.close();
  });

  // ── 6. the loop crossfade / OUT fade use the pad's own time
  await scenario(async () => {
    const { page } = await fresh();
    const r = await page.evaluate(async () => {
      const p = pads[0];
      p.loop = true; p.fadeEnabled = true; p.fade = 0.5; p.inPoint = p.outPoint = null; fadeDuration = 2; masterVol = 1; syncLoopFlag(p);
      p.audio.currentTime = 3.6; p.audio.volume = 1; p.audio.play(); p.playing = true; refreshPad(0);
      const out = []; const t0 = performance.now();
      while (performance.now() - t0 < 3000) { out.push({ t: performance.now() - t0, xf: !!p.xf, dur: p.xf?.dur ?? null }); await new Promise(r => setTimeout(r, 25)); }
      stopPad(0, false);
      const xs = out.filter(o => o.xf);
      return { first: xs[0]?.t ?? null, last: xs[xs.length - 1]?.t ?? null, dur: xs[0]?.dur ?? null };
    });
    check('a looping pad with ↓ FADE and its own 0.5 s FADE crossfades over about 0.5 s at the loop point (the header says 2 s)',
      r.first !== null && r.dur > 0.3 && r.dur < 0.7 && (r.last - r.first) > 300 && (r.last - r.first) < 800, JSON.stringify(r));
    await page.close();
  });

  // ── 7. saved with the show; damaged values are repaired; old shows have none
  await scenario(async () => {
    const { page } = await fresh();
    const r = await page.evaluate(() => {
      pads[1].fade = 4.5; saveAutosave();
      const auto = JSON.parse(localStorage.getItem('cue-autosave'));
      const parse = fade => parseProjectConfig({ pads: [{ id: 0, fade }] }).pads[0].fade;
      const old = parseProjectConfig({ pads: [{ id: 0 }] }).pads[0].fade;
      const snap = snapshotPad(pads[1]); pads[1].fade = null; restorePad(pads[1], snap);
      const restored = pads[1].fade;
      pads[1].fade = 2; const snap2 = snapshotPad(pads[1]); clearPad(1); undo();
      return { autosaved: auto.pads.map(p => p.fade ?? 'none').slice(0, 3), good: parse(3.5), big: parse(99), small: parse(0), neg: parse(-4), str: parse('2.5'), junk: parse('abc'), nul: parse(null), obj: parse({}), old, restored, afterUndo: pads[1].fade, snap2: snap2.fade };
    });
    check('the autosave carries each pad\'s FADE time (null for the pads that follow the header)', JSON.stringify(r.autosaved) === JSON.stringify([null, 4.5, null]) || JSON.stringify(r.autosaved) === JSON.stringify(['none', 4.5, 'none']) || (r.autosaved[1] === 4.5 && r.autosaved[0] === null), JSON.stringify(r.autosaved));
    check('a project round-trips it, clamped to 0.1 – 20 s; numbers in text are read; junk, null and old shows (no value at all) mean "follow the header"',
      r.good === 3.5 && r.big === 20 && r.small === 0.1 && r.neg === 0.1 && r.str === 2.5 && r.junk === null && r.nul === null && r.obj === null && r.old === null, JSON.stringify(r));
    check('Undo (replace / clear a sound) brings back the pad\'s FADE time too', r.restored === 4.5 && r.afterUndo === 2 && r.snap2 === 2, JSON.stringify(r));
    await page.close();
  });

  // ── 8. layout: the chip row (LOOP, ↓ FADE + its box, + Stack, ✕) stays on one line and the longest value fits — mouse and iPad
  for (const [w, h, touch] of [[1280, 800, false], [960, 720, false], [1024, 768, true], [768, 1024, true]]) {
    await scenario(async () => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      await page.addInitScript(bytes => { window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' }); }, wav);
      await page.goto('file://' + INDEX);
      await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad') && typeof loadFile === 'function');
      const r = await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) loadFile(i, mkFile('Sound ' + i + '.wav'), true);
        pads[1].fade = 10.5; pads[1].fadeEnabled = true; refreshPad(1);
        await new Promise(r => setTimeout(r, 300));
        const f = document.querySelector('#pad1 .pad-footer'), kids = [...f.children], inp = document.querySelector('#pad1 .pad-fade');
        const card = document.getElementById('pad1').getBoundingClientRect(), box = inp.getBoundingClientRect();
        return { rows: new Set(kids.map(c => Math.round(c.getBoundingClientRect().top))).size, fits: inp.scrollWidth <= inp.clientWidth, inside: box.right <= card.right && box.left >= card.left,
                 tall: Math.round(box.height), btn: Math.round(document.querySelector('#pad1 [data-action="fade-toggle"]').getBoundingClientRect().height) };
      });
      check(`${w}×${h} ${touch ? 'touch' : 'mouse'}: the chip row stays on one line, "10.5s" fits in the box, and the box is as tall as the ↓ FADE button beside it`, r.rows === 1 && r.fits && r.inside && r.tall === r.btn, JSON.stringify(r));
      await ctx.close();
    });
  }

  await browser.close();
  t.finish();
})();
