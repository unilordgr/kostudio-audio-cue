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
    check('Donate link goes to ko-fi.com/dkostoudis and opens a new tab safely',
      r.tag === 'A' && u.protocol === 'https:' && u.hostname === 'ko-fi.com' && u.pathname === '/dkostoudis' &&
      r.target === '_blank' && /noopener/.test(r.rel) && /noreferrer/.test(r.rel) && r.notPrevented === true, JSON.stringify(r));
    await page.close();
  });
  // The header must never push FADE / VOL / STOP ALL off-screen — including at the app's 960px minimum window
  for (const w of [960, 1100, 1120, 1121, 1200, 1280, 1281, 1440, 1441, 1600, 1920]) {
    await scenario(async () => {
    const page = await fresh({ width: w, height: 700 });
    const r = await page.evaluate(() => {
      const h = document.querySelector('header');
      const inView = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth; };
      return { overflow: h.scrollWidth - h.clientWidth, stopAll: inView('.stop-all'), vol: inView('#volSlider'),
               fade: inView('#fadeDurInput'), donate: inView('#donateBtn'), save: inView('.hdr-btn.save'), stopFade: inView('#stopFadeBtn'), lock: inView('#lockBtn'), settings: inView('#settingsBtn') };
    });
    check(`header fits at ${w}px: STOP ALL, VOL, FADE, STOP FADE, Save and Donate all on screen`,
      r.overflow <= 0 && r.stopAll && r.vol && r.fade && r.donate && r.save && r.stopFade && r.lock && r.settings, JSON.stringify(r));
    await page.close();
    });
  }

  // ── panic key + STOP FADE
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      [0, 1, 2].forEach(i => { loadFile(i, mkFile()); playPad(i); });
      autoAdv = true; addToStack(0); addToStack(1); getScene().stackIdx = 0; checkAutoAdvance(0);   // pending auto-advance timer
      const out = {};
      const esc = target => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      // focus in the master-volume slider, then in the FADE box: Escape must still cut everything
      document.getElementById('volSlider').focus();
      esc(document.getElementById('volSlider'));
      out.afterSlider = pads.slice(0, 3).map(p => p.playing);
      out.audioPaused = pads.slice(0, 3).every(p => p.audio.paused);
      [0, 1, 2].forEach(i => playPad(i));
      document.getElementById('fadeDurInput').focus();
      esc(document.getElementById('fadeDurInput'));
      out.afterFadeBox = pads.slice(0, 3).map(p => p.playing);
      await new Promise(res => setTimeout(res, 500));
      out.advanced = getScene().stackIdx;                       // the pending auto-advance must not have fired
      out.p1AfterAdvance = pads[1].playing;
      return out;
    });
    check('Escape cuts every pad instantly, even with focus in the volume slider or FADE box, and cancels auto-advance',
      r.afterSlider.every(v => v === false) && r.audioPaused && r.afterFadeBox.every(v => v === false) && r.p1AfterAdvance === false, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile()); playPad(0);
      const out = {};
      openModal('T', '<input id="mi">', '');
      document.getElementById('mi').focus();
      document.getElementById('mi').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      out.modalClosed = document.getElementById('modalOverlay').classList.contains('hidden');
      out.stillPlaying = pads[0].playing;                        // Escape closed the dialog; it did NOT stop the show
      startCapture(3);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      out.captureEnded = capturing === null; out.stillPlaying2 = pads[0].playing;
      return out;
    });
    check('Escape closes a dialog / cancels key capture without stopping the show',
      r.modalClosed && r.stillPlaying && r.captureEnded && r.stillPlaying2, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile()); loadFile(1, mkFile()); fadeDuration = 1;
      const out = {};
      playPad(0); playPad(1);
      stopAll();                                                 // STOP FADE off → instant
      out.offInstant = !pads[0].playing && pads[0].audio.paused;
      prefs.stopFade = true;
      playPad(0); playPad(1);
      stopAll();                                                 // STOP FADE on → fading, still audible
      await new Promise(res => setTimeout(res, 150));
      out.fading = pads[0].playing && pads[0].stopping && !pads[0].audio.paused && pads[0].audio.volume < 1;
      stopAll();                                                 // press again → hard cut
      out.secondPressCuts = !pads[0].playing && !pads[1].playing && pads[0].audio.paused && !pads[0].stopping;
      playPad(0); stopAll(); stopAll('cut');                     // panic path ignores the toggle
      out.cutIgnoresToggle = !pads[0].playing;
      // the pad ■ button follows the toggle too
      playPad(1); document.querySelector('#pad1 [data-action="stop"]').click();
      out.padStopFades = pads[1].stopping === true;
      return out;
    });
    check('STOP FADE: off = instant, on = fade out, pressing again = hard cut; ■ follows it; panic ignores it',
      r.offInstant && r.fading && r.secondPressCuts && r.cutIgnoresToggle && r.padStopFades, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    await page.evaluate(() => { loadFile(0, mkFile()); loadFile(1, mkFile()); addToStack(0); addToStack(1); prefs.stopFade = false; });
    await page.click('#stopFadeBtn');
    const on = await page.evaluate(() => ({ pref: prefs.stopFade, pressed: document.getElementById('stopFadeBtn').getAttribute('aria-pressed'),
                                           stored: JSON.parse(localStorage.getItem('cue-prefs')).stopFade }));
    check('the STOP FADE header button toggles the preference and remembers it', on.pref === true && on.pressed === 'true' && on.stored === true, JSON.stringify(on));
    await page.close();
  });
  await scenario(async () => {
    // Real keyboard: click STOP ALL (it keeps focus), start a cue with SPACE. The browser must not treat the
    // SPACE keyup as a click on the still-focused STOP ALL button and kill the cue that was just started.
    const page = await fresh();
    await page.evaluate(() => { loadFile(0, mkFile()); addToStack(0); getScene().stackIdx = -1; });
    await page.click('.stop-all');
    await page.keyboard.press(' ');
    await sleep(300);
    const r = await page.evaluate(() => ({ playing: pads[0].playing, focused: document.activeElement?.className }));
    check('SPACE with STOP ALL still focused starts the cue and is not undone by a keyup "click"', r.playing === true, JSON.stringify(r));
    await page.close();
  });

  // ── multi-file fill, audio filtering
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile('keep-me.wav'));                       // an already-loaded pad must never be overwritten
      const files = ['Cue 10.wav', 'Cue 2.wav', 'notes.txt', 'Cue 1.mp3'].map(n => n.endsWith('.txt') ? new File(['hello'], n, { type: 'text/plain' }) : mkFile(n));
      const placed = fillPadsFrom(files, null);
      const out = { placed, p0: pads[0].file.name, names: pads.slice(1, 4).map(p => p.file?.name) };
      out.status = document.getElementById('statusTxt').textContent;
      // grow the grid when it runs out
      const many = Array.from({ length: 15 }, (_, i) => mkFile(`Track ${i + 1}.wav`));
      const before = pads.length; fillPadsFrom(many, null);
      out.grew = pads.length > before; out.allLoaded = pads.slice(4).filter(p => p.file).length >= 15 - 8 && pads.every((p, i) => p.id === i);
      out.gridTiles = document.querySelectorAll('#padsGrid .pad').length === pads.length;
      return out;
    });
    check('Fill Pads: natural sort (1,2,10), non-audio skipped, loaded pads kept, grid grows when full',
      r.placed === 3 && r.p0 === 'keep-me.wav' && r.names.join() === 'Cue 1.mp3,Cue 2.wav,Cue 10.wav' && /1 non-audio file\(s\) skipped/.test(r.status) && r.grew && r.allLoaded && r.gridTiles, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      const drop = (el, files) => {
        const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      };
      const out = {};
      drop(document.getElementById('pad3'), [new File(['x'], 'malware.exe', { type: 'application/x-msdownload' })]);
      out.nonAudioRejected = !pads[3].file && /not an audio file/.test(document.getElementById('statusTxt').textContent);
      drop(document.getElementById('pad3'), [mkFile('b.wav'), mkFile('a.wav'), mkFile('c.wav')]);
      out.multi = [3, 4, 5].map(i => pads[i].file?.name).join();
      drop(document.getElementById('pad7'), [mkFile('solo.wav')]);
      out.single = pads[7].file?.name;
      return out;
    });
    check('dropping: a non-audio file is rejected; several files fill from the drop target; one file loads as before',
      r.nonAudioRejected && r.multi === 'a.wav,b.wav,c.wav' && r.single === 'solo.wav', JSON.stringify(r));
    await page.close();
  });

  // ── stack ordering + drag & drop
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      [0, 1, 2, 3].forEach(i => { loadFile(i, mkFile(`p${i}.wav`)); pads[i].name = `P${i}`; addToStack(i); });
      const s = getScene(); s.stackIdx = 1;                     // P1 selected
      const order = () => s.stack.map(x => x.padId).join('');
      const out = {};
      moveStackItem(3, -1);  out.afterUp = order();             // 0132
      moveStackItem(0, 1);   out.afterDown = order();           // 1032 — selection moved with P1
      out.selectedIsStillP1 = s.stack[s.stackIdx].padId === 1;
      moveStackItem(0, -1);  moveStackItem(3, 1);               // out-of-range moves are no-ops
      out.noop = order();
      insertPadIntoStack(2, 0);  out.inserted = order();        // 21032, selection still P1
      out.selectedAfterInsert = s.stack[s.stackIdx].padId === 1;
      out.rows = document.querySelectorAll('#stackList .stack-item').length;
      return out;
    });
    check('stack move / insert keep the selected cue selected (by identity)',
      r.afterUp === '0132' && r.afterDown === '1032' && r.selectedIsStillP1 && r.noop === '1032' && r.inserted === '21032' && r.selectedAfterInsert && r.rows === 5, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh({ width: 1400, height: 800 });
    await page.evaluate(() => { [0, 1, 2].forEach(i => { loadFile(i, mkFile(`p${i}.wav`)); pads[i].name = `P${i}`; addToStack(i); }); getScene().stackIdx = 0; renderStack(); });
    // real mouse-driven HTML5 drag: row 0 → below the last row
    await page.dragAndDrop('#stackList .stack-item[data-i="0"]', '#stackList .stack-item[data-i="2"]', { targetPosition: { x: 40, y: 20 } });
    const afterRowDrag = await page.evaluate(() => getScene().stack.map(x => x.padId).join(''));
    // pad name → stack (adds a new entry)
    await page.dragAndDrop('#pname3', '#stackList .stack-item[data-i="0"]', { targetPosition: { x: 40, y: 3 } }).catch(() => {});
    await page.evaluate(() => { loadFile(3, mkFile('p3.wav')); pads[3].name = 'P3'; refreshPad(3); });
    await page.dragAndDrop('#pname3', '#stackList .stack-item[data-i="0"]', { targetPosition: { x: 40, y: 3 } });
    const afterPadDrag = await page.evaluate(() => getScene().stack.map(x => x.padId).join(''));
    check('drag & drop: a stack row can be dragged to reorder, and a pad name can be dragged into the stack',
      afterRowDrag === '120' && afterPadDrag === '3120', `row=${afterRowDrag} pad=${afterPadDrag}`);
    await page.close();
  });

  // ── remaining-time displays
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile()); addToStack(0); pads[0].name = 'A';
      pads[5].name = 'Ghost'; getScene().stack.push({ padId: 5 }); renderStack();            // cue with no audio
      await new Promise(res => setTimeout(res, 250));                                          // let metadata load + RAF tick
      const timeEl = () => document.getElementById('ptime0').textContent;
      const rowTime = i => document.querySelectorAll('#stackList .stack-time')[i].textContent;
      const out = { idlePad: timeEl(), idleRow: rowTime(0), ghostRow: rowTime(1) };
      playPad(0);
      pads[0].audio.currentTime = 2;
      await new Promise(res => setTimeout(res, 200));
      out.playPad = timeEl(); out.playRow = rowTime(0);
      pads[0].loop = true; syncLoopFlag(pads[0]); await new Promise(res => setTimeout(res, 100));
      out.loopPad = timeEl(); out.loopRow = rowTime(0);
      pads[0].loop = false; pads[0].outPoint = 4; await new Promise(res => setTimeout(res, 100));
      out.outPad = timeEl();
      return out;
    });
    check('countdown: idle shows position/length; playing shows −remaining (to the OUT point); loops show ⟳; a cue without audio shows ⚠',
      /^0:00 \/ 0:0[56]$/.test(r.idlePad) && /^0:0[56]$/.test(r.idleRow) && r.ghostRow === '⚠' &&
      /^−0:0[34] \/ 0:0[56]$/.test(r.playPad) && /^−0:0[34]$/.test(r.playRow) &&
      /^⟳/.test(r.loopPad) && r.loopRow === '⟳' && /^−0:0[12] \/ /.test(r.outPad), JSON.stringify(r));
    await page.close();
  });

  // ── undo
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile('kick.wav')); pads[0].name = 'Kick'; pads[0].inPoint = 0.5; pads[0].outPoint = 3; pads[0].vol = 0.6; pads[0].loop = true;
      loadFile(1, mkFile('snare.wav')); pads[1].name = 'Snare';
      addToStack(0); addToStack(1); addToStack(0); getScene().stackIdx = 1;
      const out = { undoDisabledAtStart: document.getElementById('undoBtn').disabled };
      clearPad(0);
      out.cleared = !pads[0].file && getScene().stack.length === 1;
      out.undoEnabled = !document.getElementById('undoBtn').disabled && /cleared pad 1/.test(document.getElementById('undoBtn').title);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));   // Ctrl+Z
      await new Promise(res => setTimeout(res, 50));
      out.restored = pads[0].file?.name === 'kick.wav' && pads[0].name === 'Kick' && pads[0].inPoint === 0.5 && pads[0].outPoint === 3 &&
                     pads[0].vol === 0.6 && pads[0].loop === true && !!pads[0].audio && pads[0].audio.loop === false /* IN set → manual loop */;
      out.stackBack = getScene().stack.map(x => x.padId).join() === '0,1,0' && getScene().stack[getScene().stackIdx].padId === 1;
      out.playable = (playPad(0), pads[0].playing);
      // LIFO + replace sound + remove cue + clear stack + delete scene
      stopAll('cut');
      loadFile(1, mkFile('other.wav'));                    // replaces 'snare.wav'
      removeFromStack(0);
      clearStack();
      addScene(); const sc2 = getScene(); addToStack(1); switchScene(0);
      removeScene(1);                                       // has a cue → confirm() is auto-accepted in the test
      out.sceneGone = scenes.length === 1;
      undo(); out.sceneBack = scenes.length === 2 && scenes[1] === sc2 && sc2.stack.length === 1;
      undo(); out.stackBack2 = getScene().stack.length === 2;   // 'cleared the stack' undone → the 2 cues that were left
      undo(); out.cueBack = getScene().stack.length === 3;      // 'removed cue 1' undone → all 3 again
      out.status = document.getElementById('statusTxt').textContent;
      return out;
    });
    check('Undo (Ctrl+Z / button): clear pad restores sound, name, IN/OUT, volume, loop AND its cues; scene delete / clear stack undo too',
      r.undoDisabledAtStart && r.cleared && r.undoEnabled && r.restored && r.stackBack && r.playable && r.sceneGone && r.sceneBack && r.stackBack2 && r.cueBack, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile('one.wav')); pads[0].name = 'One';
      loadFile(0, mkFile('two.wav'));                                    // replace → undoable
      const out = { replaced: pads[0].file.name === 'two.wav' };
      undo();
      out.undone = pads[0].file.name === 'one.wav' && pads[0].name === 'One';
      out.nothing = (undo(), document.getElementById('statusTxt').textContent);
      // the undo history is capped by bytes so cleared audio can't pin unbounded memory
      for (let i = 0; i < 5; i++) pushUndo('big', () => {}, 200 * 1024 * 1024);
      out.capped = undoStack.length <= 2;
      return out;
    });
    check('Undo: replacing a pad\'s sound is undoable; empty history says so; history is capped by memory',
      r.replaced && r.undone && /Nothing to undo|Undid/.test(r.nothing) && r.capped, JSON.stringify(r));
    await page.close();
  });

  // ── show lock
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile('a.wav')); loadFile(1, mkFile('b.wav')); addToStack(0); addToStack(1); getScene().stackIdx = 0;
      pads[0].name = 'A';
      const snapshot = () => JSON.stringify({ n: pads.length, names: pads.map(p => p.name + (p.file ? '*' : '')), stack: getScene().stack.map(x => x.padId), scenes: scenes.length, in: pads[0].inPoint, color: pads[0].color, key: pads[0].key });
      const before = snapshot();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));   // Ctrl+Shift+L
      const out = { locked: showLocked && document.body.classList.contains('show-locked') && document.getElementById('lockBtn').textContent === '🔒' };
      // every editing path is refused …
      clearPad(0); loadFile(2, mkFile('c.wav')); fillPadsFrom([mkFile('d.wav')], null); addPad(); removeFromStack(0); clearStack(); addScene();
      removeScene(0); insertPadIntoStack(1, 0); moveStackItem(0, 1); addToStack(1); setInPoint(0); setOutPoint(0); startRename(0); startCapture(0);
      out.editsRefused = snapshot() === before;
      handleLoad(); out.loadRefused = document.getElementById('modalOverlay').classList.contains('hidden');
      undoStack.push({ label: 'x', restore: () => { out.undoRan = true; }, bytes: 0 }); undo(); out.undoRefused = !out.undoRan;
      // … but the show still runs
      playPad(0); setMasterVolume(0.5); setPadVolume(0, 0.4); playStackItem(1); nextCue();
      out.playbackWorks = pads[1].playing || pads[0].playing;
      stopAll('cut'); out.stopWorks = !pads[0].playing && !pads[1].playing;
      out.inertCss = getComputedStyle(document.querySelector('#pad0 .clear-pad')).pointerEvents === 'none';
      // unlock → editing works again
      toggleShowLock(); loadFile(2, mkFile('c.wav')); out.unlocked = !showLocked && !!pads[2].file;
      return out;
    });
    check('Show lock: every editing path is refused (clear, load, fill, add, stack edits, IN/OUT, rename, key capture, Load, undo) but playback, volume and STOP work',
      r.locked && r.editsRefused && r.loadRefused && r.undoRefused && r.playbackWorks && r.stopWorks && r.inertCss && r.unlocked, JSON.stringify(r));
    await page.close();
  });

  // ── settings + audio output device
  await scenario(async () => {
    const page = await fresh({ width: 1400, height: 800 });
    await page.click('#settingsBtn');
    const r = await page.evaluate(() => ({ open: !document.getElementById('modalOverlay').classList.contains('hidden'),
      sections: [...document.querySelectorAll('.set-hdr')].map(e => e.textContent), wide: document.getElementById('modalBox').classList.contains('wide') }));
    await page.click('.set-row .modal-btn:has-text("Dark")');
    const dark = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem('cue-theme') }));
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => document.getElementById('modalOverlay').classList.contains('hidden') && !document.getElementById('modalBox').classList.contains('wide'));
    check('Settings opens from ⚙, has Appearance + Audio output sections, switches/persists the theme, closes on Escape',
      r.open && r.wide && r.sections.includes('Appearance') && r.sections.includes('Audio output') && dark.theme === 'dark' && dark.stored === 'dark' && closed, JSON.stringify({ r, dark, closed }));
    await page.close();
  });
  await scenario(async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__sinkCalls = [];
      HTMLMediaElement.prototype.setSinkId = async function (id) {
        if (id === 'gone') throw Object.assign(new Error('no such device'), { name: 'NotFoundError' });
        window.__sinkCalls.push(id);
      };
      navigator.mediaDevices.enumerateDevices = async () => [
        { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
        { kind: 'audiooutput', deviceId: 'dev-usb', label: 'USB Audio Interface' },
        { kind: 'audiooutput', deviceId: 'dev-hdmi', label: 'HDMI Output' },
        { kind: 'audioinput',  deviceId: 'mic', label: 'Microphone' },
      ];
      localStorage.setItem('cue-prefs', JSON.stringify({ outputId: 'dev-usb', waveform: false }));
    });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    await page.evaluate(bytes => { window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' }); }, wav);
    const r = await page.evaluate(async () => {
      const out = {};
      loadFile(0, mkFile());                                            // a new element must pick up the SAVED device
      await new Promise(res => setTimeout(res, 30));
      out.newElementRouted = __sinkCalls.includes('dev-usb');
      await setOutputDevice('dev-hdmi');                                // switching re-routes elements that already exist
      out.switched = __sinkCalls.slice(-1)[0] === 'dev-hdmi' && prefs.outputId === 'dev-hdmi' && JSON.parse(localStorage.getItem('cue-prefs')).outputId === 'dev-hdmi';
      await setOutputDevice('gone');                                    // unplugged interface: warn loudly, keep the saved choice
      out.warned = /Output device not available/.test(document.getElementById('statusTxt').textContent) && prefs.outputId === 'gone' && outputProblem !== '';
      await setOutputDevice('');
      out.backToDefault = prefs.outputId === '' && outputProblem === '';
      prefs.outputId = 'dev-usb'; showSettingsModal();
      await new Promise(res => setTimeout(res, 100));
      const sel = document.getElementById('outputSelect');
      out.options = [...sel.options].map(o => o.textContent);
      out.selected = sel.value;
      return out;
    });
    check('Audio output: saved device is applied to new and existing pads; a missing device warns but is remembered; Settings lists real devices (not inputs / "default")',
      r.newElementRouted && r.switched && r.warned && r.backToDefault &&
      r.options.join('|') === 'System default|USB Audio Interface|HDMI Output' && r.selected === 'dev-usb', JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => { delete HTMLMediaElement.prototype.setSinkId; });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    const r = await page.evaluate(() => { showSettingsModal(); return { hasSelect: !!document.getElementById('outputSelect'), text: document.getElementById('set-output').textContent }; });
    check('Audio output: browsers without setSinkId (Safari / iPad) get an explanation instead of a broken control', !r.hasSelect && /isn't supported/.test(r.text), JSON.stringify(r));
    await page.close();
  });

  // ── pre-show check
  await scenario(async () => {
    const page = await fresh({ width: 1400, height: 800 });
    const r = await page.evaluate(async () => {
      const out = {};
      loadFile(0, mkFile('kick.wav')); pads[0].name = 'Kick';
      addToStack(0);
      await new Promise(res => setTimeout(res, 200));
      const clean = await runPreShowCheck();
      out.cleanVerdict = clean.verdict; out.cleanFails = clean.fails; out.cleanSounds = clean.sounds; out.cleanCues = clean.cues;
      // now break things in every way the check knows about
      pads[1].name = 'Snare'; getScene().stack.push({ padId: 1 });                 // cue whose pad has no audio
      loadFile(2, mkFile('bad-in.wav')); pads[2].inPoint = 100;                    // IN past the end
      loadFile(3, mkFile('bad-out.wav')); pads[3].inPoint = 3; pads[3].outPoint = 2; // OUT before IN
      loadFile(4, new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'corrupt.wav', { type: 'audio/wav' }));  // not audio at all
      pads[5].name = 'Orphan';                                                      // named, no audio, in no cue → warn
      pads[6].missingPath = 'D:\\Shows\\gone.wav'; pads[6].name = 'Gone';           // file was missing at load
      setMasterVolume(0.5); autoAdv = true;
      await new Promise(res => setTimeout(res, 300));
      const bad = await runPreShowCheck();
      out.verdict = bad.verdict;
      const texts = bad.items.map(i => `${i.level}|${i.padId}|${i.text}`);
      out.hasCueNoAudio = texts.some(x => /^fail\|1\|.*cue 2.*no audio/.test(x));
      out.hasIn = texts.some(x => /^fail\|2\|.*IN point/.test(x));
      out.hasOut = texts.some(x => /^fail\|3\|.*OUT point is not after/.test(x));
      out.hasCorrupt = texts.some(x => /^fail\|4\|.*can't be opened/.test(x));
      out.hasOrphan = texts.some(x => /^warn\|5\|.*no audio loaded/.test(x)) && !texts.some(x => /^fail\|5\|/.test(x));
      out.hasMissing = texts.some(x => /^fail\|6\|.*not found.*gone\.wav/.test(x));
      out.hasMaster = texts.some(x => /^warn\|null\|Master volume is at 50%/.test(x));
      out.hasAuto = texts.some(x => /^info\|null\|Auto-advance is ON/.test(x));
      return out;
    });
    check('Pre-show check: a clean show is READY; every kind of problem is found and reported at the right severity',
      r.cleanVerdict === 'READY' && r.cleanFails === 0 && r.cleanSounds === 1 && r.cleanCues === 1 && r.verdict === 'NOT READY' &&
      r.hasCueNoAudio && r.hasIn && r.hasOut && r.hasCorrupt && r.hasOrphan && r.hasMissing && r.hasMaster && r.hasAuto, JSON.stringify(r));
    // the UI: the ✔ button opens it, a "Go to pad" button focuses the pad, Escape closes
    await page.click('#checkBtn');
    await page.waitForSelector('#chkVerdict');
    const ui = await page.evaluate(() => ({ verdict: document.getElementById('chkVerdict').textContent.trim(), rows: document.querySelectorAll('.chk-item').length, goButtons: document.querySelectorAll('.chk-go').length }));
    await page.click('.chk-go >> nth=0');
    const after = await page.evaluate(() => ({ closed: document.getElementById('modalOverlay').classList.contains('hidden'), flashing: !!document.querySelector('.pad.flash') }));
    check('Pre-show check UI: ✔ opens it with a verdict + a row per issue; "Go to pad" closes it and highlights the pad',
      /NOT READY/.test(ui.verdict) && ui.rows >= 7 && ui.goButtons >= 5 && after.closed && after.flashing, JSON.stringify({ ui, after }));
    await page.close();
  });

  // ── waveform
  await scenario(async () => {
    const page = await fresh({ width: 1400, height: 800 });
    const toneBytes = wavBytes(6, { tone: true });
    const r = await page.evaluate(async (tone) => {
      const mk = (n) => new File([new Uint8Array(tone)], n, { type: 'audio/wav' });
      const out = { pref: prefs.waveform };
      loadFile(0, mk('tone.wav'));
      await new Promise(res => setTimeout(res, 1200));                         // decode + relayout
      const p = pads[0];
      out.buckets = p.peaks?.length;
      out.max = p.peaks ? Math.max(...p.peaks) : null;
      out.firstHalfQuiet = p.peaks ? Math.max(...p.peaks.slice(0, 120)) < 0.05 : false;   // first half of the file is silent…
      out.secondHalfLoud = p.peaks ? Math.max(...p.peaks.slice(200)) > 0.9 : false;       // …and it swells to full scale at the end
      const el = document.getElementById('pad0'), cv = document.getElementById('pwave0');
      out.hasWaveClass = el.classList.contains('has-wave');
      out.barHeight = Math.round(document.getElementById('pbar0').getBoundingClientRect().height);
      if (cv) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let painted = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++; out.painted = painted; }
      // replaced mid-decode: the OLD file's peaks must not land on the new file
      loadFile(1, mk('a.wav')); loadFile(1, new File([new Uint8Array(tone)], 'b.wav', { type: 'audio/wav' }));
      await new Promise(res => setTimeout(res, 1500));
      out.raceFile = pads[1].file.name; out.racePeaks = !!pads[1].peaks;
      // huge files are skipped without error and without a waveform
      const big = mk('big.wav'); Object.defineProperty(big, 'size', { value: 200 * 1024 * 1024 });
      loadFile(2, big); await new Promise(res => setTimeout(res, 300));
      out.bigSkipped = pads[2].peaks === null && !document.getElementById('pad2').classList.contains('has-wave');
      // switching the preference off removes waveforms everywhere and restores the slim bar
      setWaveformPref(false); await new Promise(res => setTimeout(res, 100));
      out.offClears = pads.every(q => q.peaks === null) && !document.querySelector('.pad.has-wave') && !document.querySelector('.pad-wave');
      setWaveformPref(true); await new Promise(res => setTimeout(res, 1500));
      out.onAgain = !!pads[0].peaks;
      return out;
    }, toneBytes);
    check('Waveform: peaks are computed (silent half / loud half), drawn, stale results discarded, big files skipped, preference on/off works',
      r.pref === true && r.buckets === 300 && r.max === 1 && r.firstHalfQuiet && r.secondHalfLoud && r.hasWaveClass && r.barHeight >= 30 && r.painted > 200 &&
      r.raceFile === 'b.wav' && r.racePeaks && r.bigSkipped && r.offClears && r.onAgain, JSON.stringify(r));
    await page.screenshot({ path: process.env.KCUE_SHOT || '/dev/null', clip: { x: 0, y: 50, width: 700, height: 260 } }).catch(() => {});
    await page.close();
  });
  await scenario(async () => {
    // the waveform must not break scrubbing or IN/OUT: click the bar, then set IN and OUT with the markers on top of the waveform
    const page = await fresh({ width: 1400, height: 800 });
    const toneBytes = wavBytes(6, { tone: true });
    await page.evaluate(async (tone) => { loadFile(0, new File([new Uint8Array(tone)], 'tone.wav', { type: 'audio/wav' })); await new Promise(res => setTimeout(res, 1200)); }, toneBytes);
    const box = await page.locator('#pbar0').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    const r = await page.evaluate(() => { const c = pads[0].audio.currentTime; setInPoint(0); return { t: c, inPoint: pads[0].inPoint }; });
    check('Waveform: clicking the taller bar seeks (≈ half way) and IN can still be set there', r.t > 2.5 && r.t < 3.5 && r.inPoint !== null && Math.abs(r.inPoint - r.t) < 0.3, JSON.stringify(r));
    await page.close();
  });

  // ── remote commands (the strict, shared entry point for the remote API and MIDI)
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => {
      loadFile(0, mkFile('a.wav')); loadFile(1, mkFile('b.wav')); addToStack(0); addToStack(1);
      const out = {};
      out.toggle = handleRemoteCommand({ type: 'pad_toggle', id: 0 }) && pads[0].playing;
      out.emptyPad = handleRemoteCommand({ type: 'pad_toggle', id: 7 }) === false && !pads[7].playing;
      out.select = handleRemoteCommand({ type: 'cue_select', index: 1 }) && getScene().stackIdx === 1;
      out.selectOob = handleRemoteCommand({ type: 'cue_select', index: 9 }) === false;
      out.master = handleRemoteCommand({ type: 'master', value: 0.3 }) && masterVol === 0.3 && document.getElementById('volSlider').value === '0.3';
      out.masterClamp = handleRemoteCommand({ type: 'master', value: 5 }) && masterVol === 1;
      // playback keeps working while the show is locked …
      toggleShowLock();
      out.lockedStop = handleRemoteCommand({ type: 'stop_all' }) && !pads[0].playing;
      out.lockedPlay = handleRemoteCommand({ type: 'pad_toggle', id: 1 }) && pads[1].playing;
      // … and there is simply no command that edits anything
      const before = JSON.stringify({ n: pads.map(p => !!p.file), s: getScene().stack.length, sc: scenes.length });
      const edits = [{ type: 'clear_pad', id: 0 }, { type: 'load_project', path: '/x' }, { type: 'remove_scene', index: 0 }, { type: 'add_pad' }, { type: 'unlock' },
                     { type: 'eval', code: 'window.__x=1' }, { type: 'pad_toggle', id: '0' }, { type: 'pad_toggle', id: -1 }, { type: 'pad_toggle', id: 1e6 }, { type: 'master', value: 'NaN' },
                     null, 'stop_all', [], { type: 'constructor' }, { type: '__proto__' }, { type: 'toString' }];
      out.editsIgnored = edits.every(c => handleRemoteCommand(c) === false) && before === JSON.stringify({ n: pads.map(p => !!p.file), s: getScene().stack.length, sc: scenes.length }) && showLocked && !window.__x;
      // stop_all_auto follows STOP FADE, stop_all always cuts
      toggleShowLock(); prefs.stopFade = true; playPad(0);
      handleRemoteCommand({ type: 'stop_all_auto' }); out.autoFades = pads[0].stopping === true;
      handleRemoteCommand({ type: 'stop_all' }); out.cutCuts = !pads[0].playing && !pads[0].stopping;
      return out;
    });
    check('remote commands: playback works (also while locked); anything that would edit is ignored; ids/values are validated; STOP ALL cuts, stop_all_auto follows STOP FADE',
      Object.values(r).every(v => v === true), JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await fresh();
    const r = await page.evaluate(() => { showSettingsModal(); return { text: document.getElementById('set-remote').textContent, hasBox: !!document.getElementById('remoteBox') }; });
    check('Settings → Remote control in a browser explains it needs the desktop app (no broken controls)', /desktop app/.test(r.text) && !r.hasBox, JSON.stringify(r));
    await page.close();
  });

  // ── MIDI (fake controller)
  const midiInit = () => {
    window.__midiIn = { id: 'in1', name: 'Fake Pad Controller', onmidimessage: null };
    window.__midiAccess = { inputs: new Map([['in1', window.__midiIn]]), onstatechange: null };
    window.__midiDenied = false;
    navigator.requestMIDIAccess = async () => { if (window.__midiDenied) throw new DOMException('denied', 'SecurityError'); return window.__midiAccess; };
    window.__midi = (...bytes) => window.__midiIn.onmidimessage?.({ data: new Uint8Array(bytes) });
  };
  await scenario(async () => {
    const page = await browser.newPage();
    await page.addInitScript(midiInit);
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    await page.evaluate(bytes => { window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' }); }, wav);
    const r = await page.evaluate(async () => {
      const out = {};
      loadFile(0, mkFile('kick.wav')); loadFile(1, mkFile('snare.wav')); addToStack(0); addToStack(1);
      showSettingsModal();
      await setMidiEnabled(true);
      out.enabled = prefs.midiEnabled && !!__midiIn.onmidimessage;
      out.deviceShown = /Fake Pad Controller/.test(document.getElementById('set-midi').textContent);
      // learn: Pad 1 ← note 36 on channel 10
      document.getElementById('midiAction').selectedIndex = 0;                 // first option = Pad 1
      startMidiLearn();
      out.learning = !!midiLearn && /Waiting/.test(document.getElementById('midiLearnBtn').textContent);
      __midi(0x99, 36, 100);                                                    // note-on, channel 10
      out.mapped = prefs.midiMap.length === 1 && JSON.stringify(prefs.midiMap[0]) === '{"msg":"note","ch":9,"num":36,"cmd":{"type":"pad_toggle","id":0}}';
      out.persisted = JSON.parse(localStorage.getItem('cue-prefs')).midiMap.length === 1;
      out.notLearningAfter = midiLearn === null;
      // triggering
      closeModal();
      __midi(0x99, 36, 100); out.fired = pads[0].playing;
      __midi(0x99, 36, 0);                                                      // velocity 0 = note-off: ignored
      __midi(0x89, 36, 64);                                                     // real note-off: ignored
      out.offIgnored = pads[0].playing;
      __midi(0x90, 36, 100);                                                    // same note, other channel: not mapped
      out.otherChannelIgnored = pads[0].playing;
      __midi(0x99, 37, 100); out.otherNoteIgnored = !pads[1].playing;
      __midi(0x99, 36, 100); out.togglesOff = !pads[0].playing || pads[0].stopping;   // second hit toggles it back (fade-out)
      stopAll('cut');
      // CC: a button fires once when it crosses 64 upwards; a held / repeated value doesn't retrigger
      assignMidi({ msg: 'cc', num: 20 }, { type: 'stop_all' }, -1);
      playPad(0); playPad(1);
      __midi(0xB3, 20, 10); out.ccBelow = pads[0].playing;
      __midi(0xB3, 20, 127); out.ccFires = !pads[0].playing && !pads[1].playing;
      playPad(0); __midi(0xB3, 20, 127); out.ccNoRepeat = pads[0].playing;       // still held high: no retrigger
      __midi(0xB3, 20, 0); __midi(0xB3, 20, 127); out.ccRearms = !pads[0].playing;
      // quick map, conflicts, removal
      mapDrumNotes(); out.drum = prefs.midiMap.filter(e => e.msg === 'note' && e.ch === -1).length === 12;
      __midi(0x92, 38, 90); out.drumAnyChannel = pads[2].audio ? pads[2].playing : 'pad 3 has no audio → nothing';   // note 38 = pad 3 (no audio) → no-op
      __midi(0x92, 37, 90); out.drumPad2 = pads[1].playing;
      assignMidi({ msg: 'note', num: 37 }, { type: 'stop_all' }, -1);              // same control re-learned replaces the old action
      out.replaced = prefs.midiMap.filter(e => e.msg === 'note' && e.num === 37 && e.ch === -1).length === 1;
      removeMidiMapping(prefs.midiMap.findIndex(e => e.msg === 'cc'));
      out.removed = !prefs.midiMap.some(e => e.msg === 'cc');
      await setMidiEnabled(false);
      out.unbound = __midiIn.onmidimessage === null && !prefs.midiEnabled;
      return out;
    });
    check('MIDI: learn maps a control (exact channel), note-off/velocity-0/other notes & channels are ignored, CC fires once per press, drum-pad quick map, re-learn replaces, disable unbinds',
      Object.entries(r).every(([, v]) => v === true || (typeof v === 'string' && /no audio/.test(v))), JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await browser.newPage();
    await page.addInitScript(midiInit);
    await page.addInitScript(() => localStorage.setItem('cue-prefs', JSON.stringify({ midiEnabled: true, midiMap: [
      { msg: 'note', ch: -1, num: 60, cmd: { type: 'pad_toggle', id: 0 } },                       // valid
      { msg: 'note', ch: -1, num: 61, cmd: { type: 'load_project', path: '/etc/passwd' } },       // not a playback command
      { msg: 'note', ch: -1, num: 999, cmd: { type: 'stop_all' } },                               // note out of range
      { msg: 'sysex', ch: -1, num: 5, cmd: { type: 'stop_all' } },                                // unknown message kind
      { msg: 'cc', ch: 77, num: 5, cmd: { type: 'stop_all' } },                                   // channel out of range
      { msg: 'cc', ch: 0, num: 5, cmd: { type: 'eval', code: 'alert(1)' } }, 'garbage', null, 42,
    ] })));
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({ kept: prefs.midiMap.length, cmd: prefs.midiMap[0]?.cmd?.type, bound: !!__midiIn.onmidimessage }));
    check('MIDI: a hand-edited / poisoned saved mapping keeps only valid playback entries, and MIDI is bound again at launch', r.kept === 1 && r.cmd === 'pad_toggle' && r.bound, JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await browser.newPage();
    await page.addInitScript(midiInit);
    await page.addInitScript(() => { window.__midiDenied = true; });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    const r = await page.evaluate(async () => { showSettingsModal(); await setMidiEnabled(true); return { pref: prefs.midiEnabled, status: document.getElementById('statusTxt').textContent }; });
    check('MIDI: if the browser denies access, the setting turns itself off and says so', r.pref === false && /denied/.test(r.status), JSON.stringify(r));
    await page.close();
  });
  await scenario(async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => { delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess; });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    const r = await page.evaluate(() => { showSettingsModal(); return { text: document.getElementById('set-midi').textContent, cb: !!document.getElementById('midiEnabled') }; });
    check('MIDI: browsers without Web MIDI (Safari / iPad) get an explanation instead of a control', /aren't|isn't available/.test(r.text) && !r.cb, JSON.stringify(r));
    await page.close();
  });

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
