// Dev tool (not part of `npm test`): drives every screen / dialog / state of the app in English and prints every
// string the translation engine was asked about. Used to build (and re-check) the dictionaries.
//   node tests/tools/harvest-i18n.js > /tmp/strings.json          (English: every string the engine is asked about)
//   LANG=el node tests/tools/harvest-i18n.js                      (any language: only the strings that have NO translation)
const { chromium } = require('playwright');
const { INDEX, wavBytes } = require('../helpers');

async function harvest(lang = '') {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes(3);
  const seen = new Set();

  async function session(opts = {}, fn) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    page.on('dialog', d => d.accept());
    await page.addInitScript(({ bytes, electron, lang }) => {
      window.__trSeen = new Set(); window.__trMissing = new Set(); if (lang) localStorage.setItem('cue-prefs', JSON.stringify({ lang, waveform: false }));
      window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' });
      HTMLMediaElement.prototype.setSinkId = async () => {};
      navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audiooutput', deviceId: 'd1', label: 'USB Audio Interface' }];
      const inp = { id: 'i', name: 'Pad Controller', onmidimessage: null };
      navigator.requestMIDIAccess = async () => ({ inputs: new Map([['i', inp]]), onstatechange: null });
      if (electron) window.electronAPI = { isElectron: true, fileExists: async () => false, showSaveDialog: async () => null, showOpenFileDialog: async () => null, showOpenAudioDialog: async () => null,
        showOpenFolderDialog: async () => null, readFile: async () => new ArrayBuffer(0), readTextFile: async () => '{}', writeTextFile: async () => true, joinPath: async (...a) => a.join('/'),
        openDonate: async () => true, onUpdateProgress() {}, onUpdateReady() {}, onUpdateError() {},
        remote: { getConfig: async () => ({ enabled: false, lan: false, port: 28491, token: 'a'.repeat(64), configPath: '/x/remote.json', status: { running: false, port: 28491, error: '' }, urls: [] }), setConfig: async c => c, regenToken: async () => ({}), sendState() {}, onCommand() {} } };
    }, { bytes: wav, electron: !!opts.electron, lang });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    await page.waitForTimeout(200);
    try { await fn(page); } catch (e) { console.error('scenario error:', e.message.split('\n')[0]); }
    (await page.evaluate(m => [...(m ? window.__trMissing : window.__trSeen)], !!lang)).forEach(x => seen.add(x));
    await page.close();
  }

  // 1. main screen in many states
  await session({}, async page => {
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) { loadFile(i, mkFile(`s${i}.wav`)); pads[i].name = `Sound ${i}`; addToStack(i); }
      pads[5].name = 'Restored'; getScene().stack.push({ padId: 5 }); renderStack();
      pads[1].inPoint = 0.5; pads[1].outPoint = 2; pads[2].loop = true; pads[3].fadeEnabled = true; pads.forEach(p => refreshPad(p.id));
      await new Promise(r => setTimeout(r, 400));
      playPad(0); playPad(2); pausePad(2); await new Promise(r => setTimeout(r, 300));
      startCapture(3); await new Promise(r => setTimeout(r, 50)); capturing = null; buildPads();
      addScene(); switchScene(0);
      toggleShowLock(); toggleStopFade(); toggleShowLock();
      clearPad(3); undo(); stopAll('cut');
      document.getElementById('updateBanner').classList.add('visible');
    });
  });
  // 2. every dialog
  await session({}, async page => {
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) { loadFile(i, mkFile(`s${i}.wav`)); pads[i].name = `Sound ${i}`; addToStack(i); }
      pads[6].name = 'Ghost'; getScene().stack.push({ padId: 6 }); pads[7].missingPath = 'D:\\x.wav'; pads[7].name = 'Gone'; pads[2].inPoint = 100;
      setMasterVolume(0.5); autoAdv = true; prefs.stopFade = true;
      const step = () => new Promise(r => setTimeout(r, 250));
      showSettingsModal(); await step(); await setMidiEnabled(true); await step();
      startMidiLearn(); await step(); cancelMidiLearn(); mapDrumNotes(); await step();
      setOutputDevice('d1'); await step(); renderSettings(); await step();
      showShortcutsModal(); await step(); showAddHotkeyForm(); await step(); closeModal();
      await showPreShowCheck(); await step();
      showSaveModal(); await step(); await showLoadModal(); await step();
      showIdbSaveModal(); await step(); await showIdbLoadModal(); await step();
      showMissingFilesDialog([{ padId: 1, fileName: 'a.wav', padName: 'One' }], 'Proj'); await step();
      showBrowsePrompt('Proj'); await step();
      showRestoreDialog({ savedAt: Date.now() - 120000, pads: [{ hasAudio: true }] }); await step();
      showRestoreDialog({ savedAt: Date.now() - 20000, pads: [] }); await step();
      showRestoreDialog({ savedAt: Date.now() - 7200000, pads: [{ hasAudio: true }, { hasAudio: true }] }); await step();
      showElectronMissingDialog([{ padId: 1, audioPath: 'C:\\x.wav', padName: 'One' }]); await step();
      closeModal();
      await dbPut('ipad-projects', { name: 'Demo show', config: {}, audioData: {}, savedAt: Date.now() });
      await showIdbLoadModal(); await step(); closeModal();
      // a clean pre-show check
      for (let i = 0; i < pads.length; i++) if (!pads[i].file) { pads[i].name = ''; pads[i].missingPath = null; }
      getScene().stack = getScene().stack.filter(it => pads[it.padId].audio); pads[2].inPoint = null; setMasterVolume(1); autoAdv = false; prefs.stopFade = false;
      await showPreShowCheck(); await step(); closeModal();
    });
  });
  // 3. the desktop-only remote panel in each state
  await session({ electron: true }, async page => {
    await page.evaluate(async () => {
      showSettingsModal(); await new Promise(r => setTimeout(r, 300));
      const base = { enabled: true, lan: false, port: 28491, token: 'a'.repeat(64), configPath: '/x/remote.json' };
      await renderRemoteBox({ ...base, status: { running: true, host: '127.0.0.1', port: 28491, error: '' }, urls: [{ label: 'This computer', url: 'http://127.0.0.1:28491/remote#x' }] });
      await renderRemoteBox({ ...base, lan: true, status: { running: true, host: '0.0.0.0', port: 28491, error: '' }, urls: [{ label: 'Wi-Fi', url: 'http://192.168.1.2:28491/remote#x' }] });
      await renderRemoteBox({ ...base, status: { running: false, port: 28491, error: 'Port 28491 is already in use — pick another port' }, urls: [] });
      pads[0].filePath = 'C:\\gone.wav';
    });
  });
  // 4. browsers without setSinkId / Web MIDI
  await session({}, async page => {
    await page.evaluate(() => { delete HTMLMediaElement.prototype.setSinkId; });
  });

  await browser.close();
  return [...seen].sort();
}

module.exports = { harvest };
if (require.main === module) harvest(process.env.LANG_CODE || '').then(list => console.log(JSON.stringify(list, null, 1)));
