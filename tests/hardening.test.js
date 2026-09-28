// v1.3.1 hardening: things two independent reviews of v1.3.0 found, each reproduced first and pinned here.
//  • project files are untrusted input: size caps, path length, the translator must not be a way to hang the app
//  • (correctness cases are appended below as they are fixed)
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter } = require('./helpers');

const t = reporter('hardening');
const ck = (n, ok, d = '') => t.check(n, ok, d);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes(2);

  async function page_(opts = {}) {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    if (opts.electron) {
      await page.addInitScript(([bytes, project]) => {
        const buf = new Uint8Array(bytes).buffer;
        window.__project = project;
        window.electronAPI = {
          isElectron: true,
          showOpenFileDialog: async () => '/shows/p.cuepro',
          showOpenAudioDialog: async () => null, showOpenFolderDialog: async () => null, showSaveDialog: async () => null,
          readTextFile: async () => JSON.stringify(window.__project),
          writeTextFile: async () => true,
          fileExists: async p => p === '/audio/one.wav', readFile: async () => buf,
          joinPath: async (...a) => a.join('/'),
          onUpdateProgress() {}, onUpdateReady() {}, onUpdateError() {},
          remote: { getConfig: async () => ({}), setConfig: async () => ({}), regenToken: async () => ({}), sendState() {}, onCommand() {} },
        };
        window.mkFile = (name = 'a.wav') => new File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
      }, [wav, opts.project]);
    }
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => document.querySelector('.pad') && typeof commitProject === 'function');
    return { page, errors };
  }

  // ═══════════ the translator can't be used to hang the renderer
  {
    const { page } = await page_();
    const r = await page.evaluate(() => {
      const out = {};
      const seg = '": the OUT point (a) is past the end of the sound (';
      const worst = (lang, k) => { setLanguage(lang); const s = 'Pad 1 "' + seg.repeat(k) + 'x'; const t0 = performance.now(); tr(s); return { ms: performance.now() - t0, len: s.length }; };
      out.el4 = worst('el', 4); out.de4 = worst('de', 4);
      out.el2000 = worst('el', 2000); out.de2000 = worst('de', 2000);          // ~100 KB of hostile text
      setLanguage('el');
      out.normal = tr('Pad 1 "' + 'n'.repeat(150) + '": the audio is empty');   // an ordinary long-ish message still translates
      setLanguage('en');
      return out;
    });
    ck('translator: a 100 KB hostile string in Greek / German returns at once (was ~52 s for 81 KB), and one at the length limit stays fast',
      r.el2000.ms < 100 && r.de2000.ms < 100 && r.el4.ms < 150 && r.de4.ms < 150, JSON.stringify(r));
    ck('translator: ordinary messages with a long pad name still translate', /ο ήχος είναι κενός/.test(r.normal), r.normal);
    await page.close();
  }
  {
    const { page } = await page_();
    const r = await page.evaluate(() => {
      setLanguage('el');
      const box = document.createElement('div');
      box.innerHTML = '<div data-notr title="Delete"><span title="Close">Delete</span></div><span id="ctl" title="Delete">x</span>';
      document.body.appendChild(box);
      translateTree(box);
      const out = {
        notrTitle: box.querySelector('[data-notr]').getAttribute('title'), innerTitle: box.querySelector('span').getAttribute('title'),
        innerText: box.querySelector('span').textContent, control: box.querySelector('#ctl').getAttribute('title'),
      };
      retranslateAll();
      out.afterRetrans = box.querySelector('[data-notr]').getAttribute('title') + '|' + box.querySelector('span').getAttribute('title');
      box.remove(); setLanguage('en');
      return out;
    });
    ck('user text (data-notr) is not translated in title="" attributes either, on translate and on language change; normal titles still are',
      r.notrTitle === 'Delete' && r.innerTitle === 'Close' && r.innerText === 'Delete' && r.control !== 'Delete' && r.afterRetrans === 'Delete|Close', JSON.stringify(r));
    await page.close();
  }

  // ═══════════ project files are size-capped
  {
    const { page } = await page_();
    const r = await page.evaluate(() => {
      const pad = { id: 0, name: 'A' };
      const tryParse = cfg => { try { parseProjectConfig(cfg); return 'ok'; } catch (e) { return e.message; } };
      const scenes = n => Array.from({ length: n }, (_, i) => ({ name: 'S' + i, stack: [0] }));
      const out = {
        scenesOk: tryParse({ pads: [pad], scenes: scenes(100) }), scenesBad: tryParse({ pads: [pad], scenes: scenes(101) }),
        stackOk: tryParse({ pads: [pad], scenes: [{ stack: new Array(2000).fill(0) }] }), stackBad: tryParse({ pads: [pad], scenes: [{ stack: new Array(2001).fill(0) }] }),
        legacyBad: tryParse({ pads: [pad], stack: new Array(2001).fill(0) }),
        scOk: tryParse({ pads: [pad], customShortcuts: Array.from({ length: 500 }, () => ({ combo: 'F1', padId: 0 })) }),
        scBad: tryParse({ pads: [pad], customShortcuts: Array.from({ length: 501 }, () => ({ combo: 'F1', padId: 0 })) }),
      };
      return out;
    });
    ck('a project may have 100 scenes / 2000 cues per scene / 500 shortcuts; more is refused with a clear message (a 300 000-cue file froze the UI for 16 s)',
      r.scenesOk === 'ok' && /too many scenes/.test(r.scenesBad) && r.stackOk === 'ok' && /too many cues/.test(r.stackBad) && /too many cues/.test(r.legacyBad) &&
      r.scOk === 'ok' && /too many shortcuts/.test(r.scBad), JSON.stringify(r));
    await page.close();
  }

  // ═══════════ Electron load: absurd audio paths are ignored, and a hostile one can't stall the "files not found" dialog
  {
    const seg = '": the OUT point (a) is past the end of the sound (';
    const hostileShort = 'Pad 1 "' + seg.repeat(15) + 'x';                       // < 1024 characters, still crafted to hit the translator
    const project = {
      name: 'Evil', version: 5, masterVol: 1, autoAdv: false, fadeDuration: 2, padsScale: 1, stackScale: 1,
      scenes: [{ id: 0, name: 'S', stack: [0], stackIdx: 0 }], currentSceneIdx: 0, customShortcuts: [],
      pads: [
        { id: 0, name: 'Huge', audioPath: 'x'.repeat(5000) + '.wav', color: '#00d4ff' },
        { id: 1, name: 'Crafted', audioPath: hostileShort, color: '#ff6b35' },
        { id: 2, name: 'Fine', audioPath: '/audio/one.wav', color: '#ff3388' },
      ],
    };
    const { page, errors } = await page_({ electron: true, project });
    const r = await page.evaluate(async () => {
      setLanguage('de');
      const t0 = performance.now();
      await loadElectronProject();
      const ms = performance.now() - t0;
      const body = document.getElementById('modalBody').textContent;
      const out = { ms, huge: pads[0].missingPath, hugeListed: /xxxxxxxxxx/.test(body), craftedMissing: pads[1].missingPath === __project.pads[1].audioPath, loaded: !!pads[2].file, modalOpen: !document.getElementById('modalOverlay').classList.contains('hidden') };
      setLanguage('en');
      return out;
    });
    ck('Electron load: a 5000-character audioPath is ignored (never stored, listed or read); a crafted short one loads fast even in German; normal pads load',
      r.huge === null && !r.hugeListed && r.craftedMissing && r.loaded && r.modalOpen && r.ms < 1500 && !errors.length, JSON.stringify({ ...r, errors }));
    await page.close();
  }

  // ═══════════ correctness: undo
  const sleepIn = ms => new Promise(r => setTimeout(r, ms));
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile('old.wav')); pads[0].name = 'OLD SOUND';
      await new Promise(r => setTimeout(r, 300));
      clearPad(0);
      const before = undoStack.length;
      commitProject(parseProjectConfig({ pads: [{ name: 'NEW', color: '#00d4ff' }, { name: 'B' }] }));
      const afterLoad = undoStack.length, btnDisabled = document.getElementById('undoBtn').disabled;
      undo();
      return { before, afterLoad, btnDisabled, name0: pads[0].name, hasFile: !!pads[0].file };
    });
    ck('loading a project clears the undo history: Ctrl+Z afterwards can not put the previous show\'s sound into the new one',
      r.before === 1 && r.afterLoad === 0 && r.btnDisabled && r.name0 === 'NEW' && !r.hasFile, JSON.stringify(r));
    await page.close();
  }
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) loadFile(i, mkFile(`s${i}.wav`));
      await new Promise(r => setTimeout(r, 500));
      for (let i = 0; i < 6; i++) addToStack(i);
      const s = getScene(); s.stackIdx = 1;
      removeFromStack(5);                        // snapshot: 6 cues, cursor at 1
      s.stackIdx = 3;                            // the show carries on
      undo();
      const out = { len: s.stack.length, idx: s.stackIdx };
      // deleting a scene then undoing must not move the operator to another scene
      addScene(); addScene();                    // scenes: 0, 1, 2 (added scenes become current)
      switchScene(2); removeScene(1); switchScene(0);
      const liveBefore = scenes[currentSceneIdx];
      undo();
      out.sceneStays = scenes[currentSceneIdx] === liveBefore && scenes.length === 3;
      return out;
    });
    ck('undo brings a removed cue back without rewinding the show\'s position; undoing a deleted scene leaves you on the scene you are on',
      r.len === 6 && r.idx === 3 && r.sceneStays === true, JSON.stringify(r));
    await page.close();
  }

  // ═══════════ correctness: STOP FADE, auto-advance, crossfade
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      loadFile(0, mkFile('a.wav')); loadFile(1, mkFile('b.wav'));
      await wait(400);
      addToStack(0); addToStack(1);
      autoAdv = true; fadeDuration = 3; prefs.stopFade = true;
      getScene().stackIdx = 0;
      togglePad(0); await wait(150);
      pads[0].audio.currentTime = 1.75;                     // ~0.25 s left of a 2 s sound, fade-out is 3 s long
      stopAll('auto');
      await wait(1800);                                     // it runs out during the fade; the next cue must NOT start
      return { next: pads[1].playing, first: pads[0].playing };
    });
    ck('STOP FADE + auto-advance: a sound that runs out while STOP ALL is fading it does not start the next cue', r.next === false && r.first === false, JSON.stringify(r));
    await page.close();
  }
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      loadFile(0, mkFile('a.wav')); loadFile(1, mkFile('b.wav'));
      await wait(400);
      fadeDuration = 3; prefs.stopFade = true;
      togglePad(0); togglePad(1); await wait(150);
      stopPad(0, true);                                     // pad 0 is already fading out (like the old cue of a crossfade)
      stopAll('auto');                                      // first STOP ALL press
      const first = { p0: pads[0].playing && pads[0].stopping, p1: pads[1].playing && pads[1].stopping, v0: pads[0].audio.volume };
      stopAll('auto');                                      // second press cuts everything
      const second = { any: pads.some(p => p.playing) };
      return { first, second };
    });
    ck('STOP ALL: the first press fades everything playing (a sound already fading out is not clicked off), the second press cuts',
      r.first.p0 && r.first.p1 && r.first.v0 > 0 && r.second.any === false, JSON.stringify(r));
    await page.close();
  }

  // ═══════════ correctness: MIDI, pre-show check, keyboard
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      loadFile(0, mkFile('a.wav')); await wait(300);
      prefs.midiMap = [{ msg: 'note', ch: 9, num: 36, cmd: { type: 'stop_all' } }, { msg: 'note', ch: -1, num: 36, cmd: { type: 'pad_toggle', id: 0 } }];   // learned first, then "map notes 36-47"
      onMidiMessage({ data: [0x99, 36, 100] });             // channel 10: the exact mapping (STOP ALL) wins, the quick-mapped pad does not also start
      await wait(100);
      const exactOnly = pads[0].playing === false;
      onMidiMessage({ data: [0x90, 36, 100] });             // any other channel: the "any channel" mapping
      await wait(100);
      return { exactOnly, wildcard: pads[0].playing === true };
    });
    ck('MIDI: one action per hit — a mapping for the exact channel beats the "any channel" one instead of both firing',
      r.exactOnly && r.wildcard, JSON.stringify(r));
    await page.close();
  }
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = { empty: (await runPreShowCheck()).verdict };
      loadFile(0, mkFile('a.wav')); await wait(300); addToStack(0);
      const full = await runPreShowCheck();
      out.full = full.verdict; out.noEmptyItem = !full.items.some(i => /show is empty/.test(i.text));
      // a slow check must not write its result into whatever dialog is open by then
      const real = window.runPreShowCheck;
      window.runPreShowCheck = () => new Promise(res => setTimeout(() => real().then(res), 300));
      showPreShowCheck(); closeModal(); showSettingsModal();
      await wait(600);
      out.settingsIntact = !!document.getElementById('set-appearance') && !document.getElementById('chkVerdict') && document.getElementById('modalTitle').textContent === 'SETTINGS';
      showPreShowCheck(); await wait(600);
      out.checkShows = !!document.getElementById('chkVerdict');
      window.runPreShowCheck = real;
      return out;
    });
    ck('pre-show check: an empty show is NOT READY; a slow check does not overwrite another dialog, but still shows when left alone',
      /NOT READY/.test(r.empty) && !/NOT READY/.test(r.full) && r.noEmptyItem && r.settingsIntact && r.checkShows, JSON.stringify(r));
    await page.close();
  }
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      loadFile(0, mkFile('a.wav')); await wait(300);
      const key = (init) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, ...init }));
      const out = {};
      clearPad(0); key({ key: 'ζ', code: 'KeyZ' });         // Greek layout: the letter is not Latin, so the physical key counts
      out.greekUndo = !!pads[0].file;
      clearPad(0); key({ key: 'w', code: 'KeyZ' });         // AZERTY: this physical key types "w" — Ctrl+W must not undo
      out.azertyOther = !pads[0].file;
      key({ key: 'z', code: 'KeyW' });                      // AZERTY: Ctrl+Z is on the physical W position and still works
      out.azertyUndo = !!pads[0].file;
      key({ key: 'Λ', code: 'KeyL', shiftKey: true });      // Greek Ctrl+Shift+L → show lock
      out.greekLock = showLocked === true;
      key({ key: 'Λ', code: 'KeyL', shiftKey: true });
      out.unlocked = showLocked === false;
      return out;
    });
    ck('Ctrl+Z / Ctrl+Shift+L work on a Greek keyboard layout (physical key) and still follow the typed letter on Latin layouts (AZERTY)',
      Object.values(r).every(v => v === true), JSON.stringify(r));
    await page.close();
  }

  // ═══════════ correctness: header re-fit after a resize, user text in dialogs
  {
    const page = await browser.newPage({ viewport: { width: 960, height: 700 } });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => document.querySelector('.pad') && typeof fitHeader === 'function');
    const results = [];
    for (const lang of ['en', 'el', 'de']) {
      await page.evaluate(l => setLanguage(l), lang);
      await page.setViewportSize({ width: 960, height: 700 }); await sleepIn(300);
      for (const w of [1400, 1100, 960, 1250, 1000]) {
        await page.setViewportSize({ width: w, height: 700 }); await sleepIn(450);      // transitions are 150 ms: measure after them
        const o = await page.evaluate(() => { const h = document.querySelector('header'), b = document.querySelector('.hdr-btn.stop-all, #stopAllBtn, header [onclick*="stopAll"]');
          return { over: h.scrollWidth - h.clientWidth, right: b ? Math.round(b.getBoundingClientRect().right) : null, vw: innerWidth }; });
        if (o.over > 0 || (o.right !== null && o.right > o.vw)) results.push({ lang, w, ...o });
      }
    }
    ck('header: after any sequence of window resizes (wider, narrower, wider) nothing overflows and STOP ALL stays on screen, in English / Greek / German', results.length === 0, JSON.stringify(results));
    await page.close();
  }
  {
    const { page } = await page_({ electron: true, project: {} });
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      loadFile(0, mkFile('a.wav')); pads[0].name = 'Close'; loadFile(1, mkFile('b.wav')); pads[1].name = 'Delete';
      customShortcuts = [{ id: 0, combo: 'F1', padId: 0 }];
      await wait(300);
      setLanguage('el');
      showShortcutsModal(); await wait(150);
      const rowName = document.querySelector('.sh-custom-row .sh-pad-name').textContent;
      const optionNames = [...document.querySelectorAll('#modalBody select option')].map(o => o.textContent).filter(x => /Close|Delete|Κλείσιμο|Διαγραφή/.test(x));
      closeModal();
      showElectronMissingDialog([{ padId: 0, audioPath: '/x/Delete.wav', padName: 'Delete' }]); await wait(150);
      const missingName = document.querySelector('#modalBody [data-notr]')?.textContent;
      const missingText = document.getElementById('modalBody').textContent;
      closeModal();
      showSettingsModal(); await wait(200);
      const auto = document.querySelector('#langSelect option[value="auto"]').textContent;
      const langNames = [...document.querySelectorAll('#langSelect option[data-notr]')].map(o => o.textContent).join(',');
      setLanguage('en');
      return { rowName, optionNames, missingName, missingHasDelete: /Delete/.test(missingText), auto, langNames };
    });
    ck('Greek UI: pad names such as "Close" / "Delete" are never translated in the shortcuts dialog, its pad list or the files-not-found dialog; the "Automatic" language option is translated',
      r.rowName === 'Close' && r.optionNames.join() === 'Close,Delete' && r.missingName === 'Delete' && r.missingHasDelete && r.auto === 'Αυτόματα' && /English/.test(r.langNames), JSON.stringify(r));
    await page.close();
  }

  await browser.close();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
