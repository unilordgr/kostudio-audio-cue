// Edge fades: with a pad's ↓ FADE on, the loop seam and the OUT point fade instead of jumping / cutting.
// Measured on the real <audio> element's volume in a real Chromium, using short sounds and a short FADE time.
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
  // Start pad 0 at `from` seconds and record {t, vol, cur, playing} every 40 ms for `ms`.
  const run = (page, cfg) => page.evaluate(async ({ from, ms, loop, fade, fadeSec, inP, outP, vol, act }) => {
    const p = pads[0];
    p.loop = !!loop; p.fadeEnabled = !!fade; p.inPoint = inP ?? null; p.outPoint = outP ?? null; p.vol = vol ?? 1;
    fadeDuration = fadeSec; masterVol = 1; syncLoopFlag(p);
    p.audio.currentTime = from; p.audio.volume = p.vol;
    p.audio.play(); p.playing = true; p.paused = false; p.stopping = false; p.edge = null; refreshPad(0);
    const out = [], t0 = performance.now();
    let acted = false;
    while (performance.now() - t0 < ms) {
      const now = performance.now() - t0;
      if (act && !acted && now >= act.at) { acted = true; if (act.name === 'stop') stopPad(0, true); else if (act.name === 'pause') pausePad(0); else if (act.name === 'fadeOff') pads[0].fadeEnabled = false; }
      out.push({ t: Math.round(now), vol: +p.audio.volume.toFixed(3), cur: +p.audio.currentTime.toFixed(2), playing: p.playing });
      await new Promise(r => setTimeout(r, 40));
    }
    return out;
  }, cfg);
  const min = (a, f = x => x.vol) => Math.min(...a.map(f));
  const at = (a, ms) => a.reduce((b, x) => Math.abs(x.t - ms) < Math.abs(b.t - ms) ? x : b, a[0]);

  // ── 1. loop to the end of the file, FADE on: fades into the seam and back up after it
  {
    const { page, errors } = await fresh();
    const s = await run(page, { from: 1.9, ms: 2700, loop: true, fade: true, fadeSec: 0.6 });        // seam at 3.0 s → ~1.1 s from the start
    const seam = s.filter(x => x.cur > 2.85 || x.cur < 0.3);
    const before = at(s, 200), end = s[s.length - 1];
    ck('loop + FADE: volume dips towards silence at the loop seam (min < 0.15), is full before it, and is back to full ~0.6 s after the jump',
      min(seam) < 0.15 && before.vol > 0.95 && end.vol > 0.95 && end.cur < 2.2 && end.playing && !errors.length, JSON.stringify({ minSeam: min(seam), before: before.vol, end }));
    const dropStart = s.find(x => x.vol < 0.95 && x.cur > 2.3);
    ck('the fade-out starts one FADE time (0.6 s) before the end of the file, not earlier', dropStart && dropStart.cur > 2.35 && dropStart.cur < 2.6, JSON.stringify(dropStart));
    await page.close();
  }
  // ── 2. loop WITHOUT fade keeps a hard seam (nothing changed for pads that don't ask for it)
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 2000, loop: true, fade: false, fadeSec: 0.6 });
    ck('loop without FADE: volume stays at full straight through the seam', min(s) > 0.99, String(min(s)));
    await page.close();
  }
  // ── 3. plays to its OUT point, FADE on: fades to silence exactly at OUT, then stops, and the level is restored for the next play
  {
    const { page } = await fresh();
    const s = await run(page, { from: 0.9, ms: 1900, loop: false, fade: true, fadeSec: 0.6, outP: 1.8 });
    const stopped = s.find(x => !x.playing);
    const mid = s.find(x => x.cur > 1.5);
    const lastVol = s[s.length - 1].vol;
    ck('OUT point + FADE: volume falls to ~0 as it reaches OUT, the pad then stops, and the level is back at full afterwards',
      stopped && mid && mid.vol < 0.75 && mid.vol > 0.05 && lastVol > 0.95 && (min(s, x => x.vol) < 0.2), JSON.stringify({ stopped, mid, lastVol, minVol: min(s) }));
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
  // ── 5. loop between IN and OUT with FADE: dips at OUT, jumps to IN, comes back up; respects the per-pad level
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.4, ms: 1600, loop: true, fade: true, fadeSec: 0.4, inP: 0.3, outP: 2.0, vol: 0.6 });
    const seam = s.filter(x => x.cur > 1.75 || x.cur < 0.6);
    const end = s[s.length - 1], before = at(s, 100);
    ck('loop between IN and OUT + FADE: fades out into OUT, jumps back to IN, fades up to the pad level (0.6), not to 1.0',
      s.some(x => x.cur >= 0.3 && x.cur < 0.6 && x.t > 300) && min(seam) < 0.15 && Math.abs(end.vol - 0.6) < 0.03 && Math.abs(before.vol - 0.6) < 0.03 && end.playing, JSON.stringify({ minSeam: min(seam), end, before }));
    await page.close();
  }
  // ── 6. a region shorter than the FADE time: the fade is clamped to a third of it (0.5 s region, 2 s FADE → 0.17 s)
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.0, ms: 1600, loop: true, fade: true, fadeSec: 2, inP: 1.0, outP: 1.5 });
    const first = s.filter(x => x.t < 120);
    ck('short IN–OUT region: the fade is clamped to a third of the region, so the sound is not stuck fading — full level shortly after the start, dips at each seam',
      min(s) < 0.4 && s.some(x => x.vol > 0.9 && x.t > 300) && first[0].vol > 0.9, JSON.stringify({ min: min(s), volumes: s.filter((_, i) => i % 4 === 0).map(x => x.vol) }));
    await page.close();
  }
  // ── 7. a stop / pause takes over an edge fade cleanly
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 1500, loop: true, fade: true, fadeSec: 0.6, act: { at: 700, name: 'stop' } });   // 700 ms → inside the fade-out zone
    const last = s[s.length - 1];
    ck('STOP FADE during an edge fade: the pad stops (no restart of the loop, no fade back up)', !last.playing && last.vol > 0.95 /* restored after the stop */, JSON.stringify(last));
    await page.close();
  }
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 2500, loop: true, fade: true, fadeSec: 0.6, act: { at: 600, name: 'pause' } });
    const paused = s.filter(x => x.t > 700);
    const resumed = await page.evaluate(async () => {
      const p = pads[0]; playPad(0);                                     // resume inside / near the fade zone
      const seen = []; const t0 = performance.now();
      while (performance.now() - t0 < 1800) { seen.push(p.audio.volume); await new Promise(r => setTimeout(r, 40)); }
      return { first: seen[0], last: seen[seen.length - 1], playing: p.playing };
    });
    ck('pause inside the fade zone: playback stays paused, and on resume the level is back and the loop carries on fading properly',
      paused.every(x => !x.playing) && resumed.first > 0.95 && resumed.last > 0.9 && resumed.playing, JSON.stringify({ pausedAll: paused.every(x => !x.playing), resumed }));
    await page.close();
  }
  // ── 8. switching FADE off during a fade-out gives the level back at once
  {
    const { page } = await fresh();
    const s = await run(page, { from: 1.9, ms: 1400, loop: true, fade: true, fadeSec: 0.9, act: { at: 550, name: 'fadeOff' } });
    const after = s.filter(x => x.t > 800);
    ck('switching ↓ FADE off in the middle of a fade-out restores the full level (no stuck-quiet pad)', after.every(x => x.vol > 0.95), JSON.stringify(after.slice(0, 4)));
    await page.close();
  }

  await browser.close();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
