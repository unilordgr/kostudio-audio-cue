// SPACE (NEXT CUE) takes over the room: starting a cue fades out EVERYTHING else that is playing — the previous cue, a pad started from its
// key, a loop bed — each over its own FADE time. Measured on the real <audio> elements' volumes in a real Chromium, with the real SPACE key.
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter } = require('./helpers');

const t = reporter('space-cue');
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

  // Pads 0–2 are the cues (A, B, C); pad 5 "Key pad" and pad 6 "Loop bed" are not in the cue list.
  async function fresh() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.addInitScript(bytes => { window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' }); }, wav);
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad') && typeof nextCue === 'function');
    await page.evaluate(async () => {
      document.getElementById('tipsStrip').hidden = true;
      ['Cue A', 'Cue B', 'Cue C', null, null, 'Key pad', 'Loop bed'].forEach((n, i) => { if (n) { loadFile(i, mkFile(n + '.wav'), true); pads[i].name = n; refreshPad(i); } });
      [0, 1, 2].forEach(i => addToStack(i));
      fadeDuration = 0.4; masterVol = 1; prefs.stopFade = false;
      pads[6].loop = true; syncLoopFlag(pads[6]);
      await new Promise(r => setTimeout(r, 400));
    });
    return { page, errors };
  }
  // Start the given pads as if the operator had (a pad key / PLAY), at full level.
  const startPads = (page, ids) => page.evaluate(ids => { ids.forEach(i => { playPad(i); pads[i].audio.volume = 1; }); }, ids);
  // After `act`, sample every 25 ms for `ms`: per pad {on, vol}.
  const sample = (page, act, ms) => page.evaluate(async ({ act, ms }) => {
    const t0 = performance.now(), out = [];
    if (act === 'nextCueAuto')   nextCue(true);
    else if (act === 'remote')   handleRemoteCommand({ type: 'cue_next' });
    else if (act === 'nextCue')  nextCue();
    // (act === 'key' is pressed from Playwright, before sampling starts, via the callback below)
    while (performance.now() - t0 < ms) {
      out.push({ t: Math.round(performance.now() - t0), on: pads.map(p => !!p.playing), vol: pads.map(p => p.audio ? +p.audio.volume.toFixed(3) : null), paused: pads.map(p => !!p.paused), idx: getScene().stackIdx });
      await new Promise(r => setTimeout(r, 25));
    }
    return out;
  }, { act, ms });
  const at = (a, ms) => a.reduce((b, x) => Math.abs(x.t - ms) < Math.abs(b.t - ms) ? x : b, a[0]);
  const state = page => page.evaluate(() => ({ on: pads.map(p => !!p.playing), paused: pads.map(p => !!p.paused), idx: getScene().stackIdx, pos: pads.map(p => p.audio ? +p.audio.currentTime.toFixed(2) : null) }));

  // ── 1. the real SPACE key: the previous cue AND a pad started from its key AND a loop bed all fade out, the new cue fades in
  await scenario(async () => {
    const { page, errors } = await fresh();
    await page.evaluate(() => { getScene().stackIdx = 0; });
    await startPads(page, [0, 5, 6]);                                     // cue A is playing, plus two pads that are not part of the cue list
    await page.keyboard.press('Space');                                   // → cue B
    const s = await page.evaluate(async () => {
      const t0 = performance.now(), out = [];
      while (performance.now() - t0 < 900) { out.push({ t: Math.round(performance.now() - t0), on: pads.map(p => !!p.playing), vol: pads.map(p => p.audio ? +p.audio.volume.toFixed(3) : null), idx: getScene().stackIdx }); await new Promise(r => setTimeout(r, 25)); }
      return out;
    });
    const mid = at(s, 150), end = at(s, 850);
    check('SPACE fades out the previous cue, a pad started from its key and a loop bed — they are still sounding but dropping at 0.15 s (a fade, not a cut)',
      [0, 5, 6].every(i => mid.on[i] && mid.vol[i] < 0.95), JSON.stringify(mid));
    check('…and they are all stopped by 0.85 s, while cue B is playing at full level', [0, 5, 6].every(i => !end.on[i]) && end.on[1] && end.vol[1] > 0.97 && end.idx === 1, JSON.stringify(end));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ── 2. each pad fades over its own time (a short sting is gone while a pad with a long fade is still going down)
  await scenario(async () => {
    const { page } = await fresh();
    await page.evaluate(() => { pads[5].fade = 0.15; pads[6].fade = 1.2; getScene().stackIdx = 0; });
    await startPads(page, [5, 6]);
    const s = await sample(page, 'nextCue', 700);
    const x = at(s, 450);
    check('the others fade out over their OWN FADE time: at 0.45 s the 0.15 s pad is gone, the 1.2 s pad is still audible and going down', !x.on[5] && x.on[6] && x.vol[6] > 0.2 && x.vol[6] < 0.9, JSON.stringify(x));
    await page.close();
  });

  // ── 3. the other cue entry points do the same: the remote / Stream Deck / MIDI "next cue", and auto-advance
  await scenario(async () => {
    const { page } = await fresh();
    await page.evaluate(() => { getScene().stackIdx = 0; });
    await startPads(page, [0, 5]);
    const s = await sample(page, 'remote', 900);
    check('the remote / Stream Deck "next cue" (cue_next) also stops everything else', !at(s, 850).on[0] && !at(s, 850).on[5] && at(s, 850).on[1], JSON.stringify(at(s, 850)));
    await page.evaluate(() => { stopAll('cut'); getScene().stackIdx = 1; });
    await startPads(page, [1, 6]);
    const a = await sample(page, 'nextCueAuto', 900);
    check('auto-advance (the cue before finished) is the same: everything else is faded out, the next cue plays', !at(a, 850).on[6] && at(a, 850).on[2] && at(a, 850).idx === 2, JSON.stringify(at(a, 850)));
    await page.close();
  });

  // ── 4. what must NOT change
  await scenario(async () => {
    const { page } = await fresh();
    // (a) a cue with no audio must not cut the sound that is playing
    await page.evaluate(() => { pads[1].audio = null; pads[1].file = null; getScene().stackIdx = 0; });
    await startPads(page, [0, 5]);
    await page.evaluate(() => nextCue());
    await page.waitForTimeout(700);
    let s = await state(page);
    check('SPACE onto a cue whose audio is missing stops nothing (the room must not go silent)', s.on[0] && s.on[5] && s.idx === 1, JSON.stringify(s));
    await page.evaluate(() => stopAll('cut'));
    await page.close();
  });
  await scenario(async () => {
    const { page } = await fresh();
    // (b) a paused pad that is not the previous cue is left alone; a paused PREVIOUS cue is stopped and rewound (as before)
    await page.evaluate(() => { getScene().stackIdx = 0; });
    await startPads(page, [0, 5]);
    await page.waitForTimeout(300);
    const held = await page.evaluate(() => { pausePad(5); pausePad(0); return pads[5].audio.currentTime; });
    await page.evaluate(() => nextCue());
    await page.waitForTimeout(800);
    const s = await state(page);
    check('a paused pad that is not the previous cue stays paused, exactly where it was', s.paused[5] && !s.on[5] && held > 0.1 && Math.abs(s.pos[5] - held) < 0.05, JSON.stringify({ held, s }));
    check('a paused previous cue is stopped and rewound, as before; the next cue is playing', !s.paused[0] && !s.on[0] && s.pos[0] === 0 && s.on[1], JSON.stringify(s));
    await page.close();
  });
  await scenario(async () => {
    const { page } = await fresh();
    // (c) the PLAY CUE button still stops everything and plays the selected cue (unchanged), and the last cue wraps to the first
    await page.evaluate(() => { getScene().stackIdx = 2; });
    await startPads(page, [2, 5]);
    await page.evaluate(() => nextCue());                                 // wraps: C → A
    await page.waitForTimeout(800);
    let s = await state(page);
    check('on the last cue SPACE wraps to the first, and stops the last cue and everything else', s.on[0] && !s.on[2] && !s.on[5] && s.idx === 0, JSON.stringify(s));
    await page.evaluate(() => { getScene().stackIdx = 1; });
    await startPads(page, [5]);
    await page.evaluate(() => playCue());
    s = await state(page);
    check('PLAY CUE (the button) still plays the selected cue and stops everything else', s.on[1] && !s.on[5] && !s.on[0], JSON.stringify(s));
    await page.close();
  });

  await browser.close();
  t.finish();
})();
