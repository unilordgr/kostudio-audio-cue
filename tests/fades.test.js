// Edge fades: with a pad's ↓ FADE on,
//   • a LOOP crossfades — the head of the loop starts under the fading tail on a second <audio> element, so the seam never goes
//     quiet (measured as the combined level of every element that is playing) and never clicks;
//   • a pad that plays to its OUT point fades out and lands on silence exactly at OUT.
// Measured on the real <audio> elements' volumes in a real Chromium, using short sounds and a short FADE time.
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter } = require('./helpers');

const t = reporter('fades');
const ck = (n, ok, d = '') => t.check(n, ok, d);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes(3);                                               // 3 s

  async function fresh() {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.addInitScript(bytes => { window.mkFile = (name = 'a.wav') => new File([new Uint8Array(bytes)], name, { type: 'audio/wav' }); }, wav);
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => document.querySelector('.pad') && typeof loadFile === 'function');
    await page.evaluate(async () => { loadFile(0, mkFile('a.wav')); await new Promise(r => setTimeout(r, 400)); });
    return { page, errors };
  }
  // Start pad 0 at `from` seconds and record a sample every 40 ms for `ms`:
  //   vol  = the pad's current element volume, comp = combined level of all playing elements (sqrt of the sum of squares),
  //   n = how many elements are playing, xf = crossfade in progress, sw = number of hand-overs so far.
  const run = (page, cfg) => page.evaluate(async ({ from, ms, loop, fade, fadeSec, inP, outP, vol, act }) => {
    const p = pads[0];
    p.loop = !!loop; p.fadeEnabled = !!fade; p.inPoint = inP ?? null; p.outPoint = outP ?? null; p.vol = vol ?? 1;
    fadeDuration = fadeSec; masterVol = 1; syncLoopFlag(p);
    p.audio.currentTime = from; p.audio.volume = p.vol;
    p.audio.play(); p.playing = true; p.paused = false; p.stopping = false; p.edge = null; refreshPad(0);
    const first = p.audio, elements = new Set([p.audio]);
    const out = [], t0 = performance.now();
    let acted = false, lastEl = p.audio, sw = 0;
    while (performance.now() - t0 < ms) {
      const now = performance.now() - t0;
      if (act && !acted && now >= act.at) {
        acted = true;
        if (act.name === 'stop') stopPad(0, true); else if (act.name === 'stopCut') stopPad(0, false); else if (act.name === 'pause') pausePad(0);
        else if (act.name === 'fadeOff') pads[0].fadeEnabled = false; else if (act.name === 'clear') clearPad(0);
      }
      if (p.audio && p.audio !== lastEl) { sw++; lastEl = p.audio; }
      [p.audio, p.spare].forEach(e => e && elements.add(e));
      const playing = [p.audio, p.spare].filter(e => e && !e.paused);
      out.push({ t: Math.round(now), vol: p.audio ? +p.audio.volume.toFixed(3) : null, cur: p.audio ? +p.audio.currentTime.toFixed(2) : null, playing: p.playing,
                 comp: +Math.sqrt(playing.reduce((n, e) => n + e.volume ** 2, 0)).toFixed(3), n: playing.length, xf: !!p.xf, sw, swapped: p.audio !== first });
      await new Promise(r => setTimeout(r, 40));
    }
    window.__els = [...elements];
    return out;
  }, cfg);
  const min = (a, f = x => x.vol) => Math.min(...a.map(f));
  const at = (a, ms) => a.reduce((b, x) => Math.abs(x.t - ms) < Math.abs(b.t - ms) ? x : b, a[0]);

  // ── 1. loop to the end of the file, FADE on: a real crossfade — the seam is never quiet
  {
    const { page, errors } = await fresh();
    const s = await run(page, { from: 1.9, ms: 2500, loop: true, fade: true, fadeSec: 0.6 });         // crossfade 0.5 s → 1.1 s after the start
    const overlap = s.filter(x => x.xf);
    const end = s[s.length - 1], before = at(s, 200);
    ck('loop + FADE crossfades: two elements overlap for the FADE time, the combined level stays ≈ full through the seam (min > 0.85; the old dip went below 0.15)',
      overlap.length > 8 && overlap.every(x => x.n === 2) && min(s, x => x.comp) > 0.85 && before.comp > 0.95 && !errors.length,
      JSON.stringify({ overlapSamples: overlap.length, minComp: min(s, x => x.comp), before: before.comp, errors }));
    ck('…the tail fades out while the head fades in (each element passes through low and high), and the head then carries on as the pad (hand-over, one element left)',
      min(overlap, x => x.vol) < 0.35 && end.swapped && end.n === 1 && end.playing && end.comp > 0.95 && end.cur < 2.3, JSON.stringify({ minVol: min(overlap, x => x.vol), end }));
    const dropStart = s.find(x => x.vol < 0.95 && x.cur > 2.3);
    ck('the crossfade starts one FADE time (0.6 s) before the end of the file, not earlier', dropStart && dropStart.cur > 2.35 && dropStart.cur < 2.6, JSON.stringify(dropStart));
    await page.close();
  }
  // ── 2. loop WITHOUT fade keeps a hard seam (nothing changed for pads that don't ask for it)
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 2000, loop: true, fade: false, fadeSec: 0.6 });
    ck('loop without FADE: volume stays at full straight through the seam, no second element is ever started', min(s) > 0.99 && s.every(x => !x.xf && x.n === 1), String(min(s)));
    await page.close();
  }
  // ── 3. plays to its OUT point, FADE on: fades to silence exactly at OUT, then stops, and the level is restored for the next play
  {
    const { page } = await fresh();
    const s = await run(page, { from: 0.9, ms: 1900, loop: false, fade: true, fadeSec: 0.6, outP: 1.8 });
    const stopped = s.find(x => !x.playing);
    const mid = s.find(x => x.cur > 1.5);
    const lastVol = s[s.length - 1].vol;
    ck('OUT point + FADE (no loop): volume falls to ~0 as it reaches OUT, the pad then stops, and the level is back at full afterwards',
      stopped && mid && mid.vol < 0.75 && mid.vol > 0.05 && lastVol > 0.95 && (min(s, x => x.vol) < 0.2) && s.every(x => !x.xf), JSON.stringify({ stopped, mid, lastVol, minVol: min(s) }));
    await page.close();
  }
  // ── 4. OUT point without FADE: cuts hard, exactly as before
  {
    const { page } = await fresh();
    const s = await run(page, { from: 0.9, ms: 1500, loop: false, fade: false, fadeSec: 0.6, outP: 1.8 });
    const beforeStop = s.filter(x => x.playing);
    ck('OUT point without FADE: full volume right up to the cut', min(beforeStop) > 0.99 && s.some(x => !x.playing), JSON.stringify({ min: min(beforeStop) }));
    await page.close();
  }
  // ── 5. loop between IN and OUT with FADE: crossfades from OUT back into IN at the pad level (0.6), not at 1.0
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.4, ms: 1600, loop: true, fade: true, fadeSec: 0.4, inP: 0.3, outP: 2.0, vol: 0.6 });
    const end = s[s.length - 1], before = at(s, 100);
    ck('loop between IN and OUT + FADE: the seam crossfades (combined level ≥ 0.5 of the 0.6 pad level throughout), the head restarts at IN, and the level stays 0.6',
      min(s, x => x.comp) > 0.5 && s.some(x => x.xf) && end.swapped && end.cur >= 0.3 && end.cur < 1.2 && Math.abs(end.comp - 0.6) < 0.04 && Math.abs(before.comp - 0.6) < 0.04 && end.playing,
      JSON.stringify({ minComp: min(s, x => x.comp), end, before }));
    await page.close();
  }
  // ── 6. a region shorter than the FADE time: the crossfade is clamped to a third of it (0.5 s region, 2 s FADE → 0.17 s)
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.0, ms: 1600, loop: true, fade: true, fadeSec: 2, inP: 1.0, outP: 1.5 });
    const first = s.filter(x => x.t < 120);
    ck('short IN–OUT region: the crossfade is clamped to a third of the region — it still crossfades (never silent), and there is steady sound between the seams',
      min(s, x => x.comp) > 0.6 && s.some(x => x.xf) && s.some(x => !x.xf && x.comp > 0.95 && x.t > 300) && first[0].vol > 0.9, JSON.stringify({ minComp: min(s, x => x.comp), sw: s[s.length - 1].sw }));
    await page.close();
  }
  // ── 7. the loop keeps crossfading, cycle after cycle (each cycle hands over to the other element)
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 3800, loop: true, fade: true, fadeSec: 0.6 });
    ck('several loop cycles in a row: two hand-overs, never quieter than 0.85 combined, exactly one element playing between seams',
      s[s.length - 1].sw >= 2 && min(s, x => x.comp) > 0.85 && s.filter(x => !x.xf).every(x => x.n === 1), JSON.stringify({ sw: s[s.length - 1].sw, minComp: min(s, x => x.comp) }));
    await page.close();
  }
  // ── 8. STOP FADE / hard stop / pause in the middle of a crossfade take over cleanly (no orphaned element playing)
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 1900, loop: true, fade: true, fadeSec: 0.6, act: { at: 700, name: 'stop' } });   // 700 ms → inside the crossfade
    const last = s[s.length - 1];
    const anyPlaying = await page.evaluate(() => window.__els.some(e => !e.paused));
    ck('STOP FADE during a loop crossfade: the pad fades out and stops — no element left playing, no loop restart, level restored', !last.playing && !anyPlaying && !last.xf && last.vol > 0.95, JSON.stringify({ last, anyPlaying }));
    await page.close();
  }
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 1100, loop: true, fade: true, fadeSec: 0.6, act: { at: 700, name: 'stopCut' } });
    const anyPlaying = await page.evaluate(() => window.__els.some(e => !e.paused));
    ck('a hard stop during a loop crossfade silences BOTH elements at once', !s[s.length - 1].playing && !anyPlaying, JSON.stringify({ anyPlaying }));
    await page.close();
  }
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 1200, loop: true, fade: true, fadeSec: 0.6, act: { at: 700, name: 'pause' } });     // mid-crossfade
    const paused = s.filter(x => x.t > 800);
    const anyPlaying = await page.evaluate(() => window.__els.some(e => !e.paused));
    const resumed = await page.evaluate(async () => {
      const p = pads[0]; playPad(0);
      const seen = []; const t0 = performance.now();
      while (performance.now() - t0 < 2200) { seen.push({ v: p.audio.volume, n: [p.audio, p.spare].filter(e => e && !e.paused).length }); await new Promise(r => setTimeout(r, 40)); }
      return { first: seen[0].v, last: seen[seen.length - 1], playing: p.playing };
    });
    ck('pause in the middle of a crossfade pauses both elements; on resume the level is back and the loop goes on crossfading properly',
      paused.every(x => !x.playing) && !anyPlaying && resumed.first > 0.95 && resumed.last.v > 0.9 && resumed.last.n === 1 && resumed.playing, JSON.stringify({ anyPlaying, resumed }));
    await page.close();
  }
  // ── 9. switching FADE off in the middle of a crossfade: one element carries on at the full level, the other is silent and stopped
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 1500, loop: true, fade: true, fadeSec: 0.9, act: { at: 700, name: 'fadeOff' } });
    const after = s.filter(x => x.t > 800);
    ck('switching ↓ FADE off in the middle of a crossfade leaves exactly one element playing at the full level (no stuck-quiet or doubled pad)',
      after.every(x => x.n === 1 && x.comp > 0.95 && !x.xf) && after[after.length - 1].playing, JSON.stringify(after.slice(0, 4)));
    await page.close();
  }
  // ── 10. clearing the pad in the middle of a crossfade releases both elements
  {
    const { page } = await fresh();
    await run(page, { from: 1.9, ms: 1000, loop: true, fade: true, fadeSec: 0.6, act: { at: 700, name: 'clear' } });
    const r = await page.evaluate(() => ({ audio: pads[0].audio, spare: pads[0].spare, xf: pads[0].xf, anyPlaying: window.__els.some(e => !e.paused), srcs: window.__els.map(e => e.getAttribute('src')) }));
    ck('clearing a pad mid-crossfade releases the audio and the spare: nothing playing, nothing left attached', r.audio === null && !r.spare && !r.xf && !r.anyPlaying && r.srcs.every(x => x === null), JSON.stringify(r));
    await page.close();
  }

  await browser.close();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
