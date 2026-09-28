// Behavioural tests for index.html, run in a real Chromium via Playwright.
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter, sleep } = require('./helpers');

const t = reporter('ui');
const { check } = t;

// One scenario = one isolated browser page. If it throws (e.g. a missing element), record a FAIL and carry on
// instead of aborting the whole suite.
let scenarioNo = 0;
async function scenario(fn) {
  scenarioNo++;
  try { await fn(); }
  catch (e) { check(`scenario #${scenarioNo} threw`, false, String(e.message).split('\n')[0]); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes();

  async function fresh(viewport) {
    const page = await browser.newPage(viewport ? { viewport } : {});
    page.on('dialog', d => d.accept());
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    await page.evaluate(bytes => {
      window.mkFile = (name = 'a.wav') => new File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
    }, wav);
    return page;
  }

  // ── pad-element listeners must be bound exactly once
  await scenario(async () => {
    const page = await fresh();
    await page.evaluate(() => { loadFile(0, mkFile()); });
    await page.evaluate(() => document.querySelector('#pad0 .pad-tint').click());
    check('pad-body click starts playback (listeners bound once)', await page.evaluate(() => pads[0].playing) === true);
    await page.close();
  });

  // ── keyboard
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile()); loadFile(1, mkFile()); loadFile(2, mkFile());
      [0, 1, 2].forEach(i => addToStack(i));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      const afterFirst = getScene().stackIdx;
      for (let i = 0; i < 5; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
      return { afterFirst, afterRepeats: getScene().stackIdx };
    });
    check('SPACE auto-repeat does not race through the stack', r.afterFirst === 0 && r.afterRepeats === 0, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile()); addToStack(0);
      const sl = document.getElementById('volSlider'); sl.focus();
      sl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      return getScene().stackIdx;
    });
    check('SPACE works while the master slider has focus', r === 0, `stackIdx=${r}`);
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      startCapture(3);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      const stillCapturing = capturing === 3, keyAfterShift = pads[3].key;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      return { stillCapturing, keyAfterShift, keyAfterSpace: pads[3].key };
    });
    check('key capture ignores Shift alone and rejects SPACE',
      r.stillCapturing === true && r.keyAfterShift === '4' && r.keyAfterSpace === '4', JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    // the donate link is an <a>: it may hold focus after a click, and SPACE must still advance the show
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile()); addToStack(0);
      const a = document.getElementById('donateBtn'); a.focus();
      a.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      return getScene().stackIdx;
    });
    check('SPACE still advances the show when the Donate link has focus', r === 0, `stackIdx=${r}`);
    await page.close();
  });

  // ── stack + scenes
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile()); loadFile(1, mkFile()); addToStack(0); addToStack(1);
      autoAdv = true; getScene().stackIdx = 1;            // last cue just finished
      checkAutoAdvance(1);
      await new Promise(res => setTimeout(res, 500));
      return { idx: getScene().stackIdx, p0: pads[0].playing };
    });
    check('auto-advance does not wrap to cue 1 after the last cue', r.idx === 1 && r.p0 === false, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile()); addToStack(0);
      pads[1].name = 'Missing'; getScene().stack.push({ padId: 1 });   // no audio (file missing on load)
      getScene().stackIdx = 0; playPad(0);
      nextCue();
      return { playing: pads[0].playing, fading: !!fadeTimers[0], idx: getScene().stackIdx, vol: pads[0].audio.volume };
    });
    check('a cue without audio does not fade/cut the playing sound',
      r.playing === true && r.fading === false && r.vol > 0.99 && r.idx === 1, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      [0, 1, 2, 3].forEach(i => { loadFile(i, mkFile()); addToStack(i); });
      const s = getScene(); s.stackIdx = 2;
      removeFromStack(0);
      return s.stack[s.stackIdx].padId;
    });
    check('removeFromStack keeps the same cue selected', r === 2, `padId=${r}`);
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      addScene(); addScene(); switchScene(1);
      const keep = scenes[1];
      removeScene(0);
      return scenes[currentSceneIdx] === keep;
    });
    check('removeScene keeps the same scene selected', r === true);
    await page.close();
  });

  // ── audio engine
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile());
      try { setPadVolume(0, 5); setMasterVolume(9); setPadVolume(0, 'abc'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.name }; }
    });
    check('out-of-range / NaN volume is clamped, not thrown', r.ok === true, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const ms = await page.evaluate(async () => {
      loadFile(0, mkFile()); pads[0].audio.volume = 1;
      const t0 = performance.now();
      await new Promise(res => {
        startFade(0, 0, 0.6, res);
        setTimeout(() => { const end = performance.now() + 400; while (performance.now() < end); }, 100);   // 400 ms stall
      });
      return performance.now() - t0;
    });
    check('a 0.6s fade finishes in ~0.6s despite a 400ms main-thread stall', ms < 850, `took ${Math.round(ms)}ms`);
    await page.close();
  });
  await scenario(async () => {
    // hit the key of a pad that is fading out → it comes back, it does not restart or pause
    const page = await fresh();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile()); fadeDuration = 1; playPad(0);
      stopPad(0, true);
      await new Promise(res => setTimeout(res, 400));
      const mid = pads[0].audio.volume, timeMid = pads[0].audio.currentTime;
      togglePadCrossfade(0);
      const after = { playing: pads[0].playing, stopping: pads[0].stopping, fading: !!fadeTimers[0] };
      await new Promise(res => setTimeout(res, 1300));
      return { mid, after, end: pads[0].audio.volume, playing: pads[0].playing, paused: pads[0].audio.paused,
               progressed: pads[0].audio.currentTime > timeMid };
    });
    check('re-triggering a fading-out pad brings it back to full level without restarting',
      r.mid > 0.05 && r.mid < 0.95 && r.after.playing && !r.after.stopping && r.after.fading &&
      r.end > 0.99 && r.playing && !r.paused && r.progressed, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile()); fadeDuration = 1; playPad(0);
      stopPad(0, true); const first = fadeTimers[0];
      await new Promise(res => setTimeout(res, 100));
      stopPad(0, true);
      return first === fadeTimers[0];
    });
    check('a second fade-out request does not restart (stretch) the running fade', r === true);
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile()); pads[0].inPoint = 0.5; pads[0].outPoint = 0.8; pads[0].paused = true; pads[0].filePath = 'C:\\x.wav';
      loadFile(0, mkFile('b.wav'));
      const afterLoad = { i: pads[0].inPoint, o: pads[0].outPoint, p: pads[0].paused };
      pads[0].inPoint = 0.2; clearPad(0);
      return { afterLoad, afterClear: { i: pads[0].inPoint, o: pads[0].outPoint, p: pads[0].paused, fp: pads[0].filePath } };
    });
    check('loadFile/clearPad reset stale IN/OUT/paused/filePath',
      r.afterLoad.i === null && r.afterLoad.o === null && r.afterLoad.p === false &&
      r.afterClear.i === null && r.afterClear.fp === null, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(3, mkFile('x.wav')); const u1 = pads[3].audioUrl;
      const revoked = []; const orig = URL.revokeObjectURL; URL.revokeObjectURL = u => { revoked.push(u); orig.call(URL, u); };
      loadFile(3, mkFile('y.wav')); clearPad(3);
      URL.revokeObjectURL = orig;
      return { released: revoked.includes(u1), n: revoked.length, urlNull: pads[3].audioUrl === null };
    });
    check('replacing / clearing a pad revokes the old blob URL', r.released && r.n === 2 && r.urlNull, JSON.stringify(r));
    await page.close();
  });

  // ── project data validation
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile('keep.wav')); playPad(0);
      const out = {};
      try { parseProjectConfig({ name: 'x', config: { pads: [{}] }, audioData: {} }); out.ipad = 'no throw'; } catch (e) { out.ipad = e.message; }
      try { parseProjectConfig({ pads: [] }); out.empty = 'no throw'; } catch (e) { out.empty = e.message; }
      try { parseProjectConfig(null); out.nul = 'no throw'; } catch (e) { out.nul = e.message; }
      out.stillPlaying = pads[0].playing;
      return out;
    });
    check('foreign / empty / null project rejected, live state untouched',
      /iPad/.test(r.ipad) && /no pads/.test(r.empty) && /not a project/.test(r.nul) && r.stillPlaying === true, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      window.__pwned = 0;
      const evil = 'red;"><img src=x onerror="window.__pwned=1">';
      commitProject(parseProjectConfig({
        pads: [{ id: '"><img src=x onerror=window.__pwned=2>', color: evil, vol: 99, key: 'q', name: '<b>n</b>' }],
        scenes: [{ id: '"x', name: 'S', stack: ['"><img src=x onerror=window.__pwned=3>', 0], stackIdx: 7 }],
        customShortcuts: [{ id: '"x', combo: 'F1', padId: '"><img>' }],
        masterVol: 'NaN', fadeDuration: 1e9,
      }));
      return new Promise(res => setTimeout(() => res({
        pwned: window.__pwned, imgs: document.querySelectorAll('img[src="x"]').length,
        color: pads[0].color, vol: pads[0].vol, fade: fadeDuration,
      }), 200));
    });
    check('a hostile project cannot inject markup; values are clamped',
      r.pwned === 0 && r.imgs === 0 && /^#/.test(r.color) && r.vol === 1 && r.fade === 20, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => [sanitizeFilename('Νίκος'), sanitizeFilename('Κώστα'), sanitizeFilename('Show: A/B')]);
    check('sanitizeFilename keeps distinct non-ASCII names distinct', r[0] !== r[1] && !/[:/]/.test(r[2]), JSON.stringify(r));
    await page.close();
  });

  // ── security policy: the app loads nothing remote, and still works under it
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      const violated = [];
      document.addEventListener('securitypolicyviolation', e => violated.push(e.violatedDirective.split('-')[0]));
      new Image().src = 'https://example.com/x.png';
      let fetchBlocked = false;
      try { await fetch('https://example.com/'); } catch { fetchBlocked = true; }
      loadFile(0, mkFile()); playPad(0);                       // blob: audio must still play under the policy
      await new Promise(res => setTimeout(res, 400));
      return { violated, fetchBlocked, audioPlaying: !pads[0].audio.paused && !pads[0].audio.error };
    });
    check('CSP blocks remote images/fetch, but blob: audio still plays',
      r.violated.includes('img') && r.violated.includes('connect') && r.fetchBlocked && r.audioPlaying, JSON.stringify(r));
    await page.close();
  });

  // ── donate link (browser mode)
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      const a = document.getElementById('donateBtn');
      const notPrevented = a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { tag: a.tagName, href: a.href, target: a.target, rel: a.rel, notPrevented };
    });
    const u = new URL(r.href);
    check('Donate link goes to PayPal (business=etutorialsgr@gmail.com), opens a new tab safely',
      r.tag === 'A' && u.hostname === 'www.paypal.com' && u.searchParams.get('cmd') === '_donations' &&
      u.searchParams.get('business') === 'etutorialsgr@gmail.com' && r.target === '_blank' &&
      /noopener/.test(r.rel) && /noreferrer/.test(r.rel) && r.notPrevented === true, JSON.stringify(r));
    await page.close();
  });
  // The header must never push FADE / VOL / STOP ALL off-screen — including at the app's 960px minimum window
  for (const w of [960, 1100, 1200, 1280, 1400, 1920]) {
    await scenario(async () => {
    const page = await fresh({ width: w, height: 700 });
    const r = await page.evaluate(() => {
      const h = document.querySelector('header');
      const inView = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth; };
      return { overflow: h.scrollWidth - h.clientWidth, stopAll: inView('.stop-all'), vol: inView('#volSlider'),
               fade: inView('#fadeDurInput'), donate: inView('#donateBtn'), save: inView('.hdr-btn.save') };
    });
    check(`header fits at ${w}px: STOP ALL, VOL, FADE, Save and Donate all on screen`,
      r.overflow <= 0 && r.stopAll && r.vol && r.fade && r.donate && r.save, JSON.stringify(r));
    await page.close();
    });
  }

  // ── boot resilience
  await scenario(async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked'); } }); });
    await page.goto('file://' + INDEX);
    await sleep(400);
    check('theme/scales still initialise when IndexedDB is blocked',
      await page.evaluate(() => !!document.documentElement.dataset.theme) === true);
    await page.close();
  });

  await browser.close();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
