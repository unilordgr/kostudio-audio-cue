// The real desktop app: launches Electron (main.js + preload.js + index.html) and drives it through Playwright.
// Everything else in this folder mocks Electron; this file proves the mocks are honest — the real IPC, the real
// preload bridge, the real permission handler, the real remote server inside the real main process.
// Needs the Electron binary (npm run postinstall / `node node_modules/electron/install.js`) and a display
// (xvfb-run -a npm test on a headless Linux box). Without either it says SKIP and passes, so `npm test` still works everywhere.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const { ROOT, wavBytes, reporter, sleep } = require('./helpers');

const t = reporter('electron');
const ck = (n, ok, d = '') => { if (process.env.KCUE_VERBOSE) console.log(ok ? 'ok    ' : 'NOT OK', n.slice(0, 90), ok ? '' : d); t.check(n, ok, d); };

// KCUE_APP_BIN=dist/linux-unpacked/needit-audio-cue runs the PACKAGED app instead (proves electron-builder put every file the app needs into it)
const packaged = process.env.KCUE_APP_BIN ? path.resolve(process.env.KCUE_APP_BIN) : null;
let electronPath = packaged;
if (!electronPath) { try { electronPath = require('electron'); } catch { /* binary not installed */ } }
if (!electronPath || !fs.existsSync(electronPath)) { t.skip('real Electron app', 'Electron binary not installed'); t.finish(); }
if (process.platform === 'linux' && !process.env.DISPLAY) { t.skip('real Electron app', 'no display (run under xvfb-run)'); t.finish(); }

const { _electron } = require('playwright');
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const httpReq = (port, method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  req.on('error', reject); if (body !== undefined) req.write(body); req.end();
});

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kcue-el-'));
  const userData = path.join(work, 'userdata'); fs.mkdirSync(userData);
  const wavPath = path.join(work, 'tone.wav'); fs.writeFileSync(wavPath, Buffer.from(wavBytes(3, { tone: true })));
  const netLog = path.join(work, 'net.json');
  const txtPath = path.join(work, 'secret.txt'); fs.writeFileSync(txtPath, 'top secret');

  const app = await _electron.launch({
    executablePath: electronPath,
    args: [...(packaged ? [] : [path.join(ROOT, 'main.js')]), `--user-data-dir=${userData}`, `--log-net-log=${netLog}`, '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  const win = await app.firstWindow();
  const errors = []; win.on('pageerror', e => errors.push(e.message));
  await win.waitForFunction(() => document.querySelector('.pad') && window.electronAPI && typeof loadFile === 'function', null, { timeout: 30000 });

  // ── the window and the bridge
  const info = await win.evaluate(() => ({
    isElectron: window.electronAPI.isElectron === true, hasRemote: typeof window.electronAPI.remote?.getConfig === 'function',
    leaked: [typeof require, typeof process, typeof module, typeof Buffer].join(),
    csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'), canSink: 'setSinkId' in HTMLMediaElement.prototype,
    keys: Object.keys(window.electronAPI).sort().join(),
  }));
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  ck('the real app starts: window titled "Untitled show — Needit Audio Cue", preload bridge present, no Node globals leaked into the page, CSP in place',
    title === 'Untitled show — Needit Audio Cue' && info.isElectron && info.hasRemote && info.leaked === 'undefined,undefined,undefined,undefined' && info.csp, JSON.stringify({ title, ...info }));
  ck('the bridge exposes exactly the intended functions (a new IPC surface must be a conscious decision)',
    info.keys === ['checkForUpdatesNow', 'exportShow', 'fileExists', 'getAppSettings', 'getPathForFile', 'isElectron', 'joinPath', 'onSaveBeforeClose', 'onUpdateError', 'onUpdateProgress', 'onUpdateReady',
                   'openDonate', 'readFile', 'readTextFile', 'remote', 'saveBeforeCloseDone', 'setAppSettings', 'setBusy', 'setDirty',
                   'showOpenAudioDialog', 'showOpenFileDialog', 'showOpenFolderDialog', 'showSaveDialog', 'writeTextFile'].join(), info.keys);

  // ── real filesystem IPC and its allow-list
  const io = await win.evaluate(async ([wav, txt]) => {
    const out = {};
    out.existsWav = await window.electronAPI.fileExists(wav);
    out.existsTxt = await window.electronAPI.fileExists(txt);
    out.bytes = (await window.electronAPI.readFile(wav)).byteLength;
    try { await window.electronAPI.readFile(txt); out.readTxt = 'allowed'; } catch (e) { out.readTxt = 'denied'; }
    try { await window.electronAPI.readFile('/etc/passwd'); out.passwd = 'allowed'; } catch (e) { out.passwd = 'denied'; }
    try { await window.electronAPI.writeTextFile('/tmp/kcue-should-not-exist.cuepro', '{}'); out.write = 'allowed'; } catch (e) { out.write = 'denied'; }
    return out;
  }, [wavPath, txtPath]);
  ck('real IPC: audio files read, other files and un-approved writes are refused',
    io.existsWav === true && io.existsTxt === false && io.bytes > 1000 && io.readTxt === 'denied' && io.passwd === 'denied' && io.write === 'denied' && !fs.existsSync('/tmp/kcue-should-not-exist.cuepro'), JSON.stringify(io));

  // ── dialogs stubbed in the main process, everything else real: open a project, save it, reopen it
  const projPath = path.join(work, 'Show.cuepro');
  fs.writeFileSync(projPath, JSON.stringify({ name: 'Smoke', version: 5, masterVol: 1, autoAdv: false, fadeDuration: 2, padsScale: 1, stackScale: 1,
    scenes: [{ id: 0, name: 'A', stack: [0], stackIdx: 0 }], currentSceneIdx: 0, customShortcuts: [],
    pads: [{ id: 0, name: 'Tone', key: '1', color: '#00d4ff', audioPath: wavPath, loop: false, vol: 1 }, { id: 1, name: 'Gone', key: '2', color: '#ff6b35', audioPath: path.join(work, 'nope.wav') }] }));
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, projPath);
  const opened = await win.evaluate(async () => {
    await loadElectronProject();
    return { name: pads[0].name, loaded: !!pads[0].file && !!pads[0].audio, missing: pads[1].missingPath, modal: document.getElementById('modalTitle').textContent, path: currentSavePath };
  });
  ck('opening a .cuepro through the real dialog / IPC loads its audio from disk and lists the missing file',
    opened.name === 'Tone' && opened.loaded && /nope\.wav$/.test(opened.missing) && opened.modal === 'FILES NOT FOUND' && opened.path === projPath, JSON.stringify(opened));
  const savedTo = path.join(work, 'Saved.cuepro');
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, savedTo);
  await win.evaluate(() => closeModal());
  const saved = await win.evaluate(async () => {
    currentSavePath = null;                                   // force "Save As"
    await doElectronSaveAs();
    return { path: currentSavePath };
  });
  let onDisk = null; try { onDisk = JSON.parse(fs.readFileSync(savedTo, 'utf8')); } catch { /* not written */ }
  ck('saving through the real Save dialog writes a valid project file (no leftover .tmp) that keeps the audio link and the missing link — relative to the project, because the audio sits in its folder',
    saved.path === savedTo && onDisk && onDisk.pads?.[0]?.audioPath === path.basename(wavPath) && onDisk.pads?.[1]?.audioPath === 'nope.wav' && !fs.existsSync(savedTo + '.tmp'), JSON.stringify({ saved, onDisk: onDisk && onDisk.pads?.map(p => p.audioPath) }));

  // ── a file picked in a file chooser / dropped keeps its real disk path (that is what a saved project links to).
  //    Electron 32 removed File.path, so this goes through the preload's webUtils.getPathForFile.
  await win.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'smokeInput'; i.style.display = 'none'; document.body.appendChild(i); });
  await win.setInputFiles('#smokeInput', wavPath);
  const picked = await win.evaluate(() => {
    const f = document.getElementById('smokeInput').files[0];
    loadFile(1, f, true);
    const out = { viaBridge: window.electronAPI.getPathForFile(f), filePath: pads[1].filePath, synthetic: window.electronAPI.getPathForFile(new File([new Uint8Array(4)], 'x.wav')) };
    clearPad(1); document.getElementById('smokeInput').remove();
    return out;
  });
  ck('a file picked in a file chooser keeps its real path (pad.filePath), and a synthetic File has none',
    picked.viaBridge === wavPath && picked.filePath === wavPath && picked.synthetic === '', JSON.stringify(picked));

  // ── real audio playback through Chromium's media stack
  const played = await win.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    togglePad(0); await wait(700);
    const a = pads[0].audio, out = { playing: pads[0].playing, time: a.currentTime, paused: a.paused };
    stopAll('cut');
    out.stopped = !pads[0].playing && a.paused;
    return out;
  });
  ck('a loaded pad really plays (the clock advances) and STOP ALL really stops it', played.playing && played.time > 0.3 && !played.paused && played.stopped, JSON.stringify(played));
  const xfade = await win.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const p = pads[0]; p.loop = true; p.fadeEnabled = true; p.inPoint = null; p.outPoint = null; fadeDuration = 0.5; syncLoopFlag(p);
    const first = p.audio; p.audio.currentTime = 2.2; p.audio.volume = 1; p.audio.play(); p.playing = true; p.paused = false; p.stopping = false;
    let minComp = 9, sawXf = false; const t0 = performance.now();
    while (performance.now() - t0 < 1600) {
      const els = [p.audio, p.spare].filter(e => e && !e.paused);
      minComp = Math.min(minComp, Math.sqrt(els.reduce((n, e) => n + e.volume ** 2, 0)));
      sawXf = sawXf || !!p.xf;
      await wait(30);
    }
    const out = { minComp, sawXf, swapped: p.audio !== first, playing: p.playing };
    stopAll('cut'); p.loop = false; p.fadeEnabled = false; syncLoopFlag(p);
    return out;
  });
  ck('a looping pad with ↓ FADE crossfades in the real app: a second element takes over and the combined level never dips (min > 0.85)',
    xfade.sawXf && xfade.swapped && xfade.minComp > 0.85 && xfade.playing, JSON.stringify(xfade));
  const dev = await win.evaluate(async () => ({ list: Array.isArray(await navigator.mediaDevices.enumerateDevices()), sink: CAN_SET_SINK }));
  ck('audio output selection is available (setSinkId) and device enumeration works', dev.list && dev.sink === true, JSON.stringify(dev));

  // ── the remote server inside the real main process
  const port = await freePort();
  const cfg = await win.evaluate(async p => { const c = await window.electronAPI.remote.setConfig({ enabled: true, lan: false, port: p }); await refreshRemoteActive(); return c; }, port);
  const ping = await httpReq(port, 'GET', '/ping').then(r => r.status).catch(e => e.code);
  const remotePage = await httpReq(port, 'GET', '/remote').then(r => r.status === 200 && /<title>[^<]*Remote/i.test(r.body)).catch(() => false);   // remote.html shipped and served
  const noTok = await httpReq(port, 'POST', '/command', { headers: { 'Content-Type': 'application/json' }, body: '{"type":"pad_toggle","id":0}' }).then(r => r.status).catch(e => e.code);
  const withTok = await httpReq(port, 'POST', '/command', { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` }, body: '{"type":"pad_toggle","id":0}' }).then(r => r.status).catch(e => e.code);
  await sleep(500);
  const viaRemote = await win.evaluate(() => ({ playing: pads[0].playing }));
  const state = await httpReq(port, 'GET', '/state', { headers: { Authorization: `Bearer ${cfg.token}` } }).then(r => JSON.parse(r.body)).catch(() => null);
  ck('remote control in the real app: off until enabled, then /ping works, a command without the token is refused, with the token it starts the pad, and /state reports it',
    cfg.status.running && ping === 200 && remotePage && noTok === 401 && withTok === 200 && viaRemote.playing === true && state?.pads?.[0]?.playing === true, JSON.stringify({ ping, remotePage, noTok, withTok, viaRemote, playingInState: state?.pads?.[0]?.playing }));
  await win.evaluate(() => stopAll('cut'));
  const off = await win.evaluate(() => window.electronAPI.remote.setConfig({ enabled: false, lan: false }));
  await sleep(200);
  const refused = await httpReq(port, 'GET', '/ping').then(() => false).catch(() => true);
  ck('turning remote control off closes the port', off.status.running === false && refused);

  // ── hardening that only exists in the real main process
  const hard = await win.evaluate(async () => {
    const out = {};
    out.geo = await new Promise(res => navigator.geolocation.getCurrentPosition(() => res('granted'), e => res(e.code), { timeout: 3000 }));
    out.notif = await Notification.requestPermission();
    const w = window.open('https://example.com/'); out.popup = w === null;
    try { location.assign('https://example.com/'); } catch { /* blocked */ }
    await new Promise(r => setTimeout(r, 400));
    out.stillLocal = location.protocol === 'file:';
    return out;
  });
  ck('the real permission handler and navigation guard: geolocation and notifications denied, pop-ups and navigation away blocked',
    hard.geo === 1 && hard.notif === 'denied' && hard.popup && hard.stillLocal, JSON.stringify(hard));
  await app.evaluate(() => { global.__opened = []; });
  await app.evaluate(({ shell }) => { shell.openExternal = async u => { global.__opened.push(u); }; });
  await win.evaluate(() => window.electronAPI.openDonate('https://evil.example/'));
  const opened2 = await app.evaluate(() => global.__opened);
  ck('the donate button opens only the fixed Ko-fi page, whatever the page passes in', opened2.length === 1 && opened2[0] === 'https://ko-fi.com/dkostoudis', JSON.stringify(opened2));

  // ── v1.6 in the real app
  // Volume above 100 % goes through Web Audio (element → gain). Prove the real file:// page really carries sound on that path:
  // an analyser hung behind the gain must see the tone (a tainted / blocked media source would give silence).
  const boost = await win.evaluate(async () => {
    const rate = 8000, n = rate * 2, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, t) => [...t].forEach((c, i) => { b[o + i] = c.charCodeAt(0); });
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin(2 * Math.PI * 440 * i / rate));
    const id = pads.findIndex(p => !p.file);
    loadFile(id, new File([b], 'boost-tone.wav', { type: 'audio/wav' }), true);
    await new Promise(r => setTimeout(r, 400));
    setPadVolume(id, 2);
    const an = boostCtx.createAnalyser(); pads[id].gain.connect(an);
    playPad(id);
    await new Promise(r => setTimeout(r, 500));
    const buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf);
    const out = { peak: Math.max(...buf.map(Math.abs)), state: boostCtx.state, gain: pads[id].gain.gain.value, el: pads[id].audio.volume, env: pads[id].envTop, level: mixLevel().level };
    stopAll('cut');
    return out;
  });
  ck('volume above 100 % in the real app: the boosted pad really sounds through the gain (an analyser behind it sees the tone at about twice the file\'s level)',
    boost.state === 'running' && boost.gain === 2 && boost.el === 1 && boost.peak > 0.6 && boost.peak < 1.2 && Math.abs(boost.env - 60 / 128) < 0.03 && boost.level > 0.6, JSON.stringify(boost));
  const st16 = await win.evaluate(async () => ({ settings: await window.electronAPI.getAppSettings(), upd: await window.electronAPI.checkForUpdatesNow(), name: document.getElementById('showName').textContent, title: document.title }));
  ck('settings / update IPC in the real app: version reported, check on by default, and on Linux "check now" answers without touching the network',
    st16.settings.checkUpdates === true && /^\d+\.\d+\.\d+/.test(st16.settings.version) && st16.settings.canUpdate === false && st16.upd.status === 'unsupported', JSON.stringify(st16));
  // Unsaved changes: closing the window asks first (the native question is answered by a stub: first Cancel, then Don't Save)
  await app.evaluate(({ dialog }) => { global.__asked = []; global.__answer = 2; dialog.showMessageBox = async (_w, o) => { global.__asked.push(o); return { response: global.__answer }; }; });
  await win.evaluate(() => { setPadVolume(0, 0.7); });
  await sleep(200);
  const winTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await sleep(400);
  const held = await app.evaluate(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().length, asked: global.__asked.map(o => ({ m: o.message, b: o.buttons })) }));
  ck('unsaved changes in the real app: the window title carries the show name and a ● mark; closing asks Save / Don\'t Save / Cancel, and Cancel keeps the app open',
    /^● .+ — Needit Audio Cue$/.test(winTitle) && held.windows === 1 && held.asked.length === 1 && /not saved/.test(held.asked[0].m) && held.asked[0].b.join('|') === "Save|Don't Save|Cancel", JSON.stringify({ winTitle, held }));
  await app.evaluate(() => { global.__answer = 1; });                    // Don't Save → the close goes through

  ck('no page errors during the whole run', errors.length === 0, errors.join(' | '));
  await app.close();
  await sleep(500);
  // Chromium's own net-log: the app must not make ANY request of its own (it once fetched a spell-check dictionary from Google at start-up).
  // The update check only runs on Windows / macOS and is not part of this run.
  let netUrls = null;
  try { netUrls = [...new Set([...fs.readFileSync(netLog, 'utf8').matchAll(/"url":"([^"]+)"/g)].map(m => m[1]))]; } catch { /* log not written */ }
  ck('the running app makes no network requests at all (net-log is empty)', Array.isArray(netUrls) && netUrls.length === 0, JSON.stringify(netUrls));
  fs.rmSync(work, { recursive: true, force: true });
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
