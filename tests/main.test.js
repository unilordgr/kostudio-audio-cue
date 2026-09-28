// Tests for the Electron main process (main.js) with `electron` mocked — no Electron binary needed.
// Covers the IPC allow-list, the download helper (against a local HTTPS server), the Windows
// updater script and the fixed-URL donate handler.
const Module = require('module'), fs = require('fs'), os = require('os'), path = require('path'), https = require('https');
const { execFileSync } = require('child_process');
const { ROOT, reporter } = require('./helpers');

const t = reporter('main.js');
const ck = (n, ok, d = '') => t.check(n, ok, d);

// ── mock electron
const handlers = {}, listeners = {}, sent = [], spawned = [], dialogs = [], opened = [], windowSends = [], permHandlers = {};
let dialogAnswer = 0, saveResult, openResult, willQuit;
const electron = {
  app: { commandLine: { appendSwitch() {} }, whenReady: () => new Promise(() => {}), on() {},
         once: (ev, fn) => { if (ev === 'will-quit') willQuit = fn; }, isPackaged: true, getVersion: () => '1.3.0', quit() {},
         getPath: () => work },
  BrowserWindow: Object.assign(function () {
    return { webContents: { send: (ch, d) => windowSends.push([ch, d]), setWindowOpenHandler() {}, on() {} },
             loadFile() {}, setMenuBarVisibility() {}, isDestroyed: () => false };
  }, { getAllWindows: () => [] }),
  session: { defaultSession: {
    setPermissionRequestHandler: fn => { permHandlers.request = fn; },
    setPermissionCheckHandler:   fn => { permHandlers.check = fn; },
  } },
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; }, on: (name, fn) => { listeners[name] = fn; } },
  dialog: {
    showMessageBox: async (w, o) => { dialogs.push(o); return { response: dialogAnswer }; },
    showSaveDialog: async () => saveResult, showOpenDialog: async () => openResult,
  },
  shell: { openPath() {}, openExternal: async url => { opened.push(url); } },
  net: {},
};
require('child_process').spawn = (...a) => { spawned.push(a); return { unref() {} }; };
const realLoad = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return electron;
  if (req === './remote') return realLoad.call(this, path.join(ROOT, 'remote.js'), ...r);   // main.js is copied to a temp dir for the test
  return realLoad.call(this, req, ...r);
};

// ── load main.js with the internals we want to test exported
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kcue-main-'));
const tmpMain = path.join(work, 'main.under-test.js');
fs.writeFileSync(tmpMain, fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8') +
  '\nmodule.exports = { downloadFile, isNewerVersion, installWindows, DONATE_URL, createWindow, initRemote, restrictPermissions };');
const m = require(tmpMain);

const rejects = async p => { try { await p; return false; } catch (e) { return e.message; } };

(async () => {
  const audio = path.join(work, 'a.wav');  fs.writeFileSync(audio, Buffer.from([1, 2, 3, 4]));
  const secret = path.join(work, 'secret.txt'); fs.writeFileSync(secret, 'top secret');

  // ── IPC: reads
  ck('read audio file works', (await handlers['fs-read-file']({}, audio)).byteLength === 4);
  ck('read of a non-audio file is denied', /Only audio/.test(await rejects(handlers['fs-read-file']({}, secret))));
  ck('read of /etc/passwd is denied', !!(await rejects(handlers['fs-read-file']({}, '/etc/passwd'))));
  ck('non-string path rejected', /Invalid path/.test(await rejects(handlers['fs-read-file']({}, { toString() { return audio; } }))));
  ck('fileExists: audio true / non-audio false',
    (await handlers['fs-file-exists']({}, audio)) === true && (await handlers['fs-file-exists']({}, secret)) === false);
  ck('fs-read-text denies non-.cuepro', /Only \.cuepro/.test(await rejects(handlers['fs-read-text']({}, secret))));

  // ── Windows: a project file must not be able to make the app touch a network / device path (NTLM leak, hangs)
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const asWindows = async fn => { Object.defineProperty(process, 'platform', { value: 'win32' }); try { return await fn(); } finally { Object.defineProperty(process, 'platform', realPlatform); } };
  const NET = /Network paths must be chosen/;
  const hostile = ['\\\\evil.example\\share\\a.wav', '//evil.example/share/a.wav', '\\\\evil@80\\DavWWWRoot\\a.wav', '\\\\?\\UNC\\evil.example\\share\\a.wav',
                   '\\\\.\\pipe\\x.wav', '\\\\?\\GLOBALROOT\\Device\\x.wav', '/\\evil.example/share/a.wav'];
  const blocked = await asWindows(async () => {
    const out = [];
    for (const h of hostile) out.push(NET.test(await rejects(handlers['fs-read-file']({}, h))) && (await handlers['fs-file-exists']({}, h)) === false);
    return out;
  });
  ck('Windows: UNC (\\\\host\\share, //host/share, WebDAV @80, \\\\?\\UNC) and device (\\\\.\\ , \\\\?\\GLOBALROOT) audio paths are refused, not read', blocked.every(Boolean), JSON.stringify(blocked));
  ck('Windows: a UNC .cuepro path is refused too',
    NET.test(await asWindows(() => rejects(handlers['fs-read-text']({}, '\\\\evil.example\\share\\x.cuepro')))));
  const localOk = await asWindows(async () => [await rejects(handlers['fs-read-file']({}, 'C:\\shows\\a.wav')), await rejects(handlers['fs-read-file']({}, '\\\\?\\C:\\shows\\a.wav'))]);
  ck('Windows: local drive paths (C:\\…, \\\\?\\C:\\…) are not blocked by the network rule', localOk.every(e => e && !NET.test(e)), JSON.stringify(localOk));
  openResult = { canceled: false, filePaths: ['\\\\nas\\audio\\pick.wav'] };
  await asWindows(() => handlers['dialog-open-audio']());
  const afterPick = await asWindows(async () => [await rejects(handlers['fs-read-file']({}, '\\\\NAS\\Audio\\other.wav')),
                                                 await rejects(handlers['fs-read-file']({}, '\\\\nas\\private\\other.wav')),
                                                 await rejects(handlers['fs-read-file']({}, '\\\\evil.example\\audio\\other.wav'))]);
  ck('Windows: a share the user picked in a dialog works (case-insensitive); other shares and other hosts stay refused',
    afterPick[0] && !NET.test(afterPick[0]) && NET.test(afterPick[1]) && NET.test(afterPick[2]), JSON.stringify(afterPick));
  ck('non-Windows: the network rule does not apply (a name that merely starts with backslashes is a normal file)',
    !NET.test(await rejects(handlers['fs-read-file']({}, '\\\\evil.example\\share\\a.wav'))));
  const big = path.join(work, 'big.cuepro'); fs.closeSync(fs.openSync(big, 'w')); fs.truncateSync(big, 513 * 1024 * 1024);
  ck('an oversized .cuepro is refused before it is read into memory', /too large/.test(await rejects(handlers['fs-read-text']({}, big))));
  fs.rmSync(big, { force: true });

  // ── IPC: writes need a dialog-approved .cuepro path
  const proj = path.join(work, 'show.cuepro');
  ck('write to an un-approved path is denied', /Write not permitted/.test(await rejects(handlers['fs-write-text']({}, proj, '{}'))));
  ck('write outside via traversal is denied', !!(await rejects(handlers['fs-write-text']({}, path.join(work, '..', '.bashrc'), 'x'))));
  saveResult = { canceled: false, filePath: proj };
  ck('dialog-save returns and approves the path', (await handlers['dialog-save']({}, 'x')) === proj);
  await handlers['fs-write-text']({}, proj, '{"a":1}');
  ck('approved write succeeds and leaves no .tmp', fs.readFileSync(proj, 'utf8') === '{"a":1}' && !fs.existsSync(proj + '.tmp'));
  const victim = path.join(work, 'victim.txt'), proj2 = path.join(work, 'show2.cuepro');
  fs.writeFileSync(victim, 'PRECIOUS'); fs.symlinkSync(victim, proj2 + '.tmp');
  saveResult = { canceled: false, filePath: proj2 };
  await handlers['dialog-save']({}, 'x');
  await handlers['fs-write-text']({}, proj2, '{"b":2}');
  ck('Save does not follow a symlink planted at "<show>.cuepro.tmp" (victim file untouched, show written)',
    fs.readFileSync(victim, 'utf8') === 'PRECIOUS' && fs.readFileSync(proj2, 'utf8') === '{"b":2}' && !fs.lstatSync(proj2).isSymbolicLink());
  ck('approved path still rejects non-string content', /Invalid content/.test(await rejects(handlers['fs-write-text']({}, proj, { a: 1 }))));
  saveResult = { canceled: false, filePath: path.join(work, 'noext') };
  ck('dialog-save appends .cuepro when the user typed no extension', (await handlers['dialog-save']({}, 'x')).endsWith('noext.cuepro'));
  openResult = { canceled: false, filePaths: [proj] };
  ck('dialog-open-file approves a .cuepro (Save can overwrite what was opened)', (await handlers['dialog-open-file']()) === proj);
  ck('dialog-open-audio exists', typeof handlers['dialog-open-audio'] === 'function');
  ck('isNewerVersion', m.isNewerVersion('1.2.8', '1.2.7') && !m.isNewerVersion('1.2.7', '1.2.7') && m.isNewerVersion('2.0.0', '1.9.9'));

  // ── donate: fixed URL only, page-supplied arguments ignored
  const u = new URL(m.DONATE_URL);
  ck('DONATE_URL is https://ko-fi.com/dkostoudis', u.protocol === 'https:' && u.hostname === 'ko-fi.com' && u.pathname === '/dkostoudis');
  await handlers['open-donate']({}, 'https://evil.example/phish', 'file:///etc/passwd');
  ck('open-donate opens only the fixed URL and ignores anything the page sends', opened.length === 1 && opened[0] === m.DONATE_URL, JSON.stringify(opened));

  // ── permissions: only MIDI + clipboard writes
  m.restrictPermissions();
  const asked = p => new Promise(res => permHandlers.request(null, p, res));
  ck('Chromium permissions: only midi and clipboard-sanitized-write are granted; media, geolocation, notifications, camera… are denied',
    (await asked('midi')) === true && (await asked('clipboard-sanitized-write')) === true &&
    (await Promise.all(['media', 'geolocation', 'notifications', 'display-capture', 'clipboard-read', 'midiSysex', 'openExternal', 'fullscreen'].map(asked))).every(v => v === false) &&
    permHandlers.check(null, 'midi') === true && permHandlers.check(null, 'media') === false);

  // ── remote control wiring, end to end through the real IPC handlers and a real HTTP request
  m.createWindow();
  m.initRemote();
  await new Promise(r => setTimeout(r, 50));
  const cfg0 = await handlers['remote-get-config']();
  ck('remote control is OFF at launch and has a private token on disk', cfg0.enabled === false && cfg0.status.running === false && /^[0-9a-f]{64}$/.test(cfg0.token) && cfg0.configPath.startsWith(work));
  const garbage = await handlers['remote-set-config']({}, { enabled: 'true', lan: 'yes', port: '80' });
  ck('the settings IPC treats non-boolean / out-of-range input as "off, localhost, default port"', garbage.enabled === false && garbage.lan === false && garbage.status.running === false);
  const freeP = await new Promise(r => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const on = await handlers['remote-set-config']({}, { enabled: true, lan: false, port: freeP });
  ck('enabling it starts the server on localhost', on.enabled && on.status.running && on.status.host === '127.0.0.1' && on.status.port === freeP);
  const http = require('http');
  const call = (method, p, headers, body) => new Promise((resolve, reject) => {
    const rq = http.request({ host: '127.0.0.1', port: freeP, method, path: p, headers: { Host: `127.0.0.1:${freeP}`, ...headers } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
    rq.on('error', reject); if (body) rq.write(body); rq.end();
  });
  const bearer = { Authorization: `Bearer ${on.token}`, 'Content-Type': 'application/json' };
  const denied = await call('POST', '/command', { 'Content-Type': 'application/json' }, '{"type":"stop_all"}');
  windowSends.length = 0;
  const good = await call('POST', '/command', bearer, '{"type":"pad_toggle","id":1,"x":"dropped"}');
  ck('a command over HTTP reaches the app window as a clean "remote-command" message; without the token it does not',
    denied.status === 401 && good.status === 200 && windowSends.length === 1 && windowSends[0][0] === 'remote-command' && JSON.stringify(windowSends[0][1]) === '{"type":"pad_toggle","id":1}', JSON.stringify(windowSends));
  listeners['remote-state']({}, { v: 1, pads: [{ id: 0, name: 'Kick' }], stack: [] });
  listeners['remote-state']({}, 'not an object');
  const stt = await call('GET', '/state', bearer);
  ck('state pushed by the page is served to the remote; a non-object push is ignored', JSON.parse(stt.body).pads[0].name === 'Kick');
  const regen = await handlers['remote-regen-token']();
  const oldTok = await call('GET', '/state', bearer);
  ck('regenerating the token over IPC invalidates the old one', regen.token !== on.token && oldTok.status === 401);
  await handlers['remote-set-config']({}, { enabled: false });

  // ── downloadFile against a local HTTPS server (self-signed cert generated now, never committed)
  let certOk = true;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(work, 'key.pem'),
      '-out', path.join(work, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  } catch { certOk = false; }

  if (!certOk) {
    t.skip('downloadFile tests', 'openssl not available to create a test certificate');
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';       // this process only talks to its own test server
    const body = Buffer.alloc(100000, 7);
    const server = https.createServer({ key: fs.readFileSync(path.join(work, 'key.pem')), cert: fs.readFileSync(path.join(work, 'cert.pem')) }, (req, res) => {
      if (req.url === '/ok')             { res.writeHead(200, { 'content-length': body.length }); res.end(body); }
      else if (req.url === '/rel')       { res.writeHead(302, { location: '/ok' }); res.end(); }                 // relative redirect
      else if (req.url === '/trunc')     { res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 1000)); setTimeout(() => res.destroy(), 30); }
      else if (req.url === '/http')      { res.writeHead(302, { location: 'http://localhost/x' }); res.end(); }
      else if (req.url === '/404')       { res.writeHead(404); res.end(); }
      else if (req.url === '/wrongsize') { res.writeHead(200, { 'content-length': 10 }); res.end(Buffer.alloc(10)); }
    });
    await new Promise(r => server.listen(0, r));
    const base = `https://localhost:${server.address().port}`;
    const dest = path.join(work, 'dl.bin');

    await m.downloadFile(base + '/ok', dest, null, body.length);
    ck('download works on a non-443 port and the file is complete', fs.statSync(dest).size === body.length);
    fs.rmSync(dest);
    await m.downloadFile(base + '/rel', dest, null, body.length);
    ck('a relative redirect is followed', fs.statSync(dest).size === body.length);
    fs.rmSync(dest);
    const e1 = await rejects(m.downloadFile(base + '/trunc', dest, null, body.length));
    ck('truncated download rejected and the partial file removed', !!e1 && !fs.existsSync(dest), String(e1));
    const e2 = await rejects(m.downloadFile(base + '/wrongsize', dest, null, body.length));
    ck('size differing from the release asset size is rejected and removed', /Incomplete/.test(e2) && !fs.existsSync(dest), String(e2));
    const sha = require('crypto').createHash('sha256').update(body).digest('hex');
    await m.downloadFile(base + '/ok', dest, null, body.length, sha.toUpperCase());
    ck('a download matching the published SHA-256 (any letter case) is accepted', fs.statSync(dest).size === body.length);
    fs.rmSync(dest);
    const e3 = await rejects(m.downloadFile(base + '/ok', dest, null, body.length, '0'.repeat(64)));
    ck('a download with the right size but the wrong SHA-256 is rejected and removed', /checksum/.test(e3) && !fs.existsSync(dest), String(e3));
    ck('a download that arrived via a redirect is checked against the checksum too', /checksum/.test(await rejects(m.downloadFile(base + '/rel', dest, null, body.length, 'f'.repeat(64)))) && !fs.existsSync(dest));
    ck('a redirect to plain http is refused', /non-HTTPS/.test(await rejects(m.downloadFile(base + '/http', dest, null, 0))));
    ck('HTTP 404 is rejected', /HTTP 404/.test(await rejects(m.downloadFile(base + '/404', dest, null, 0))));
    ck('an http:// start URL is refused', /non-HTTPS/.test(await rejects(m.downloadFile('http://localhost/x', dest, null, 0))));
    server.close();
  }

  // ── Windows updater: paths travel via env, never in the .bat text
  const win = { webContents: { send: (c, d) => sent.push([c, d]) } };
  const nasty = 'C:\\Users\\Κώστας 100%&co\\';
  process.env.PORTABLE_EXECUTABLE_FILE = nasty + 'Kostudio-Audio-Cue-x64.exe';
  dialogAnswer = 0;                                       // "Restart Now"
  const realSetTimeout = global.setTimeout; global.setTimeout = f => { f(); return 0; };
  await m.installWindows(nasty + 'AppData\\Temp\\new.exe', win);
  global.setTimeout = realSetTimeout;
  const bat = fs.readFileSync(path.join(os.tmpdir(), 'kostudio-updater.bat'), 'latin1');
  const [, , opts] = spawned[spawned.length - 1];
  ck('the .bat is pure ASCII with no username / % / & baked in', !/[^\x00-\x7f]/.test(bat) && !bat.includes('Κώστας') && !bat.includes('100%&'));
  ck('the .bat uses %NEW_EXE% / %CUR_EXE% and relaunches on failure too',
    bat.includes('"%NEW_EXE%"') && (bat.match(/start "" "%CUR_EXE%"/g) || []).length === 2);
  ck('real paths passed via env; the portable exe path is preferred over execPath',
    opts.env.CUR_EXE === process.env.PORTABLE_EXECUTABLE_FILE && opts.env.NEW_EXE.endsWith('new.exe') && opts.env.RELAUNCH === '1');
  ck('the user is asked before restarting (never force-quit)', dialogs.length === 1 && /Restart/.test(dialogs[0].buttons[0]));
  ck('the retry loop is capped at 30 tries', /GEQ 30 goto fail/.test(bat) && /timeout \/t 1/.test(bat));

  spawned.length = 0; dialogAnswer = 1;                    // "Later"
  await m.installWindows('C:\\t\\new.exe', win);
  ck('"Later": nothing is spawned yet', spawned.length === 0 && typeof willQuit === 'function');
  willQuit();
  ck('"Later": on quit the update is applied WITHOUT relaunching', spawned.length === 1 && spawned[0][2].env.RELAUNCH === '0');

  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
