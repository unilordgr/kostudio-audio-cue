// Project load/save paths end to end, in a real Chromium:
//  • Electron mode  — a mocked window.electronAPI that emulates the main process's write allow-list
//  • Browser / iPad — real IndexedDB
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter } = require('./helpers');

const t = reporter('loaders');
const ck = (n, ok, d = '') => t.check(n, ok, d);
const file = INDEX;

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes(2);

  // ═══════════ Electron mode (mocked electronAPI emulating main.js's write allow-list)
  async function electronPage() {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.addInitScript((wav) => {
      const bytes = new Uint8Array(wav).buffer;
      window.__files = {}; window.__audio = { '/audio/one.wav': bytes, '/audio/two.wav': bytes };
      window.__written = {}; window.__approved = new Set(); window.__nextOpen = null; window.__nextSave = null; window.__saveDialogs = 0;
      window.electronAPI = {
        isElectron: true,
        showOpenFileDialog: async () => { const p = window.__nextOpen; if (p && p.endsWith('.cuepro')) window.__approved.add(p); return p; },
        showOpenAudioDialog: async () => window.__nextOpen,
        showSaveDialog: async () => { window.__saveDialogs++; window.__approved.add(window.__nextSave); return window.__nextSave; },
        showOpenFolderDialog: async () => null,
        readTextFile: async p => { if (!(p in window.__files)) throw new Error('ENOENT'); return window.__files[p]; },
        writeTextFile: async (p, c) => { if (!window.__approved.has(p)) throw new Error('Write not permitted — use Save As to choose a location'); window.__written[p] = c; return true; },
        fileExists: async p => p in window.__audio, readFile: async p => window.__audio[p],
        joinPath: async (...a) => a.join('/'),
        onUpdateProgress() {}, onUpdateReady() {}, onUpdateError() {},
      };
      window.mkFile = (name='a.wav') => new File([new Uint8Array(wav)], name, { type: 'audio/wav' });
    }, wav);
    await page.goto('file://' + file);
    await page.waitForFunction(() => document.querySelector('.pad') && typeof commitProject === 'function');
    return { page, errors };
  }

  const goodProject = {
    name: 'Good Show', version: 5, savedAt: 1, masterVol: 0.5, autoAdv: true, fadeDuration: 3, padsScale: 1.2, stackScale: 1,
    scenes: [{ id: 0, name: 'Act 1', stack: [0, 1], stackIdx: 1 }, { id: 1, name: 'Act 2', stack: [2], stackIdx: -1 }],
    currentSceneIdx: 1, customShortcuts: [{ id: 0, combo: 'F1', padId: 0 }],
    pads: [
      { id: 0, key: '1', name: 'One', loop: false, vol: 0.8, fadeEnabled: true, color: '#00d4ff', audioPath: '/audio/one.wav', inPoint: 0.1, outPoint: 0.5 },
      { id: 1, key: '2', name: 'Two', loop: true, vol: 1, fadeEnabled: false, color: '#ff6b35', audioPath: '/audio/two.wav', inPoint: null, outPoint: null },
      { id: 2, key: '3', name: 'Gone', loop: false, vol: 1, fadeEnabled: false, color: '#ff3388', audioPath: '/audio/GONE.wav', inPoint: null, outPoint: null },
    ],
  };

  // E1/E2 — load a good project; missing file keeps its link through a Save
  {
    const { page, errors } = await electronPage();
    await page.evaluate(g => { window.__files['/shows/good.cuepro'] = JSON.stringify(g); window.__nextOpen = '/shows/good.cuepro'; }, goodProject);
    await page.evaluate(() => loadElectronProject());
    const r = await page.evaluate(() => ({
      n: pads.length, f0: !!pads[0].file, f1: !!pads[1].file, f2: !!pads[2].file, miss: pads[2].missingPath,
      scenes: scenes.map(s => s.name), cur: currentSceneIdx, stack0: scenes[0].stack.map(i => i.padId), idx0: scenes[0].stackIdx,
      masterVol, fadeDuration, autoAdv, vol0: pads[0].vol, in0: pads[0].inPoint, out0: pads[0].outPoint, loop1: pads[1].loop,
      sc: customShortcuts.length, path: currentSavePath, modal: !document.getElementById('modalOverlay').classList.contains('hidden'),
      audioVol: pads[0].audio.volume,
    }));
    ck('E1 Electron load restores pads, audio, scenes, stack, shortcuts, settings',
      r.n === 3 && r.f0 && r.f1 && !r.f2 && r.scenes.join() === 'Act 1,Act 2' && r.cur === 1 && r.stack0.join() === '0,1' && r.idx0 === 1 &&
      r.masterVol === 0.5 && r.fadeDuration === 3 && r.autoAdv === true && r.vol0 === 0.8 && r.in0 === 0.1 && r.out0 === 0.5 && r.loop1 === true &&
      r.sc === 1 && r.path === '/shows/good.cuepro', JSON.stringify(r));
    ck('E1b missing file → link remembered + "files not found" dialog shown', r.miss === '/audio/GONE.wav' && r.modal === true, JSON.stringify({ miss: r.miss, modal: r.modal }));
    ck('loaded audio element volume = pad.vol x the project\'s master volume (0.8 x 0.5)', Math.abs(r.audioVol - 0.4) < 0.001, `vol=${r.audioVol}`);

    await page.evaluate(() => { closeModal(); return doElectronSave(currentSavePath); });
    const saved = await page.evaluate(() => JSON.parse(window.__written['/shows/good.cuepro']));
    ck('E2 Save after loading with a missing file keeps its audioPath (used to write null and destroy the link)',
      saved.pads[2].audioPath === '/audio/GONE.wav' && saved.pads[0].audioPath === '/audio/one.wav', JSON.stringify(saved.pads.map(p => p.audioPath)));
    ck('E2b no page errors during load/save', errors.length === 0, errors.join('|'));
    await page.close();
  }

  // E3 — foreign .cuepro (iPad export) is rejected and the live show + save path are untouched
  {
    const { page } = await electronPage();
    const r = await page.evaluate(async () => {
      loadFile(0, mkFile('live.wav')); playPad(0); currentSavePath = '/shows/mine.cuepro';
      window.__files['/shows/ipad.cuepro'] = JSON.stringify({ name: 'From iPad', config: { pads: [{ id: 0 }] }, audioData: {} });
      window.__nextOpen = '/shows/ipad.cuepro';
      await loadElectronProject();
      return { playing: pads[0].playing, path: currentSavePath, status: document.getElementById('statusTxt').textContent, hasFile: !!pads[0].file };
    });
    ck('E3 iPad-format file rejected: show keeps playing, save path NOT switched to that file',
      r.playing && r.hasFile && r.path === '/shows/mine.cuepro' && /iPad/.test(r.status), JSON.stringify(r));
    await page.close();
  }

  // E4 — hostile project loads but cannot inject
  {
    const { page } = await electronPage();
    const evil = JSON.parse(JSON.stringify(goodProject));
    evil.pads[0].color = 'red" onmouseover="window.__pwned=1" x="'; evil.pads[1].vol = 1e9; evil.pads[1].name = '<img src=x onerror=window.__pwned=2>';
    evil.scenes[0].name = '<img src=x onerror=window.__pwned=3>'; evil.masterVol = 'oops'; evil.padsScale = 0;
    await page.evaluate(e => { window.__files['/shows/evil.cuepro'] = JSON.stringify(e); window.__nextOpen = '/shows/evil.cuepro'; window.__pwned = 0; }, evil);
    await page.evaluate(() => loadElectronProject());
    await page.evaluate(() => { document.querySelector('#pad0 .color-dot').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); pads[1].audio && playPad(1); });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({ pwned: window.__pwned, imgs: document.querySelectorAll('img[src="x"]').length, c0: pads[0].color, vol1: pads[1].vol, mv: masterVol, ps: padsScale, name1: pads[1].name }));
    ck('E4 hostile project: colour sanitised, vol clamped, NaN/0 settings defaulted, names inert',
      r.pwned === 0 && r.imgs === 0 && /^#/.test(r.c0) && r.vol1 === 1 && r.mv === 1 && r.ps === 0.4, JSON.stringify(r));
    await page.close();
  }

  // E5/E6 — session restore
  {
    const { page } = await electronPage();
    const r = await page.evaluate(async () => {
      const data = { savedAt: Date.now(), masterVol: 0.7, autoAdv: false, fadeDuration: 2, padsScale: 1, stackScale: 1, currentSavePath: '/shows/old.cuepro',
        scenes: [{ id: 0, name: 'S', stack: [0], stackIdx: 0 }], currentSceneIdx: 0, customShortcuts: [],
        pads: [{ id: 0, key: 'z', name: 'Cue A', loop: false, vol: 0.9, fadeEnabled: false, color: '#00d4ff', hasAudio: true, audioPath: '/audio/one.wav', inPoint: null, outPoint: null }] };
      restoreSessionData(data);
      const out = { n: pads.length, name: pads[0].name, key: pads[0].key, needsAudio: !pads[0].file, miss: pads[0].missingPath, path: currentSavePath };
      window.__nextSave = '/shows/new.cuepro';
      handleSave();                                   // no currentSavePath → must go through Save As
      await new Promise(r => setTimeout(r, 100));
      out.saveDialogs = window.__saveDialogs; out.written = Object.keys(window.__written);
      out.audioPath = JSON.parse(window.__written['/shows/new.cuepro'] || '{"pads":[{}]}').pads[0].audioPath;
      return out;
    });
    ck('E5 restore replaces state, keeps the on-disk link, forgets the old save path', r.n === 1 && r.name === 'Cue A' && r.key === 'z' && r.needsAudio && r.miss === '/audio/one.wav' && r.path === null, JSON.stringify(r));
    ck('E6 first Save after a restore goes via Save As and preserves the audio link (no denied write, no overwrite of old.cuepro)',
      r.saveDialogs === 1 && r.written.join() === '/shows/new.cuepro' && r.audioPath === '/audio/one.wav', JSON.stringify(r));
    await page.close();
  }

  // E7 — a denied write falls back to Save As instead of failing silently
  {
    const { page } = await electronPage();
    const r = await page.evaluate(async () => {
      currentSavePath = '/shows/never-approved.cuepro'; window.__nextSave = '/shows/picked.cuepro';
      await doElectronSave(currentSavePath);
      await new Promise(r => setTimeout(r, 100));
      return { written: Object.keys(window.__written), path: currentSavePath };
    });
    ck('E7 denied write → Save As dialog → saved', r.written.join() === '/shows/picked.cuepro' && r.path === '/shows/picked.cuepro', JSON.stringify(r));
    await page.close();
  }

  // Electron: the Donate link must open in the system browser via the fixed-URL IPC (window.open is blocked there)
  {
    const { page } = await electronPage();
    const r = await page.evaluate(() => {
      window.__donateCalls = 0;
      window.electronAPI.openDonate = async () => { window.__donateCalls++; return true; };
      const a = document.getElementById('donateBtn');
      const notPrevented = a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { calls: window.__donateCalls, notPrevented };
    });
    ck('Electron: Donate click calls openDonate() once and cancels the in-app navigation', r.calls === 1 && r.notPrevented === false, JSON.stringify(r));
    await page.close();
  }

  // ═══════════ Browser / iPad mode with real IndexedDB
  {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let confirms = 0; page.on('dialog', d => { confirms++; d.accept(); });
    await page.addInitScript((wav) => { window.mkFile = (name='a.wav') => new File([new Uint8Array(wav)], name, { type: 'audio/wav' }); }, wav);
    await page.goto('file://' + file);
    await page.waitForFunction(() => document.querySelector('.pad') && typeof commitProject === 'function');
    await page.waitForTimeout(300);

    const NAME = `O'Brien "Act 1" \\ <b>&#39;);window.__pwned=1;//`;
    const r1 = await page.evaluate(async (NAME) => {
      window.__pwned = 0;
      loadFile(0, mkFile('kick.wav')); loadFile(1, mkFile('snare.wav')); addToStack(0); addToStack(1);
      pads[0].color = '#123456'; pads[0].inPoint = 0.2; pads[0].outPoint = 0.6; setMasterVolume(0.6);
      await doSaveProjectIDB(NAME);
      // scramble live state, then reload from the store through the real modal + real onclick attribute
      loadFile(0, mkFile('other.wav')); clearStack(); setMasterVolume(1);
      await showIdbLoadModal();
      document.querySelector('.proj-item').click();
      await new Promise(r => setTimeout(r, 400));
      return { pwned: window.__pwned, f0: pads[0].file?.name, f1: pads[1].file?.name, col: pads[0].color, inp: pads[0].inPoint, out: pads[0].outPoint,
               stack: getScene().stack.length, mv: masterVol };
    }, NAME);
    ck('I1 iPad save → Load modal → click restores audio/points/stack/volume; hostile project NAME is inert and round-trips',
      r1.pwned === 0 && r1.f0 === 'kick.wav' && r1.f1 === 'snare.wav' && r1.col === '#123456' && r1.inp === 0.2 && r1.out === 0.6 && r1.stack === 2 && r1.mv === 0.6, JSON.stringify(r1));

    const before = confirms;
    await page.evaluate(async (NAME) => { await doSaveProjectIDB(NAME); }, NAME);
    ck('I2 saving over an existing project asks first', confirms === before + 1, `confirm dialogs: ${confirms - before}`);

    const r3 = await page.evaluate(async () => {
      loadFile(2, mkFile('live.wav')); playPad(2);
      await dbPut('ipad-projects', { name: 'corrupt', config: {}, audioData: {}, savedAt: 1 });
      await loadProjectIDB('corrupt');
      return { playing: pads[2].playing, status: document.getElementById('statusTxt').textContent, hasFile: !!pads[2].file };
    });
    ck('I3 corrupt stored project: refused with a message, live show untouched (used to blank the show, then throw)', r3.playing && r3.hasFile && /Cannot load/.test(r3.status), JSON.stringify(r3));

    const r4 = await page.evaluate(async () => {
      const before = (await dbGetAll('ipad-projects')).length;
      await deleteIdbProject('corrupt');
      return { before, after: (await dbGetAll('ipad-projects')).length };
    });
    ck('I4 delete asks for confirmation then deletes', r4.after === r4.before - 1, JSON.stringify(r4));

    // old-format audio data survives, and revoke: blob URLs released on replace
    const r5 = await page.evaluate(() => {
      loadFile(3, mkFile('x.wav')); const u1 = pads[3].audioUrl;
      const revoked = []; const orig = URL.revokeObjectURL; URL.revokeObjectURL = u => { revoked.push(u); orig.call(URL, u); };
      loadFile(3, mkFile('y.wav')); clearPad(3);
      URL.revokeObjectURL = orig;
      return { released: revoked.includes(u1), n: revoked.length, urlNull: pads[3].audioUrl === null };
    });
    ck('I5 replacing / clearing a pad revokes the old blob URL (memory leak fix)', r5.released && r5.n === 2 && r5.urlNull, JSON.stringify(r5));

    ck('I6 no uncaught page errors across all browser-mode tests', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  await browser.close();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
