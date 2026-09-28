// Adversarial tests for remote.js (the opt-in remote-control server) — plain Node, real HTTP on localhost.
// The point: anything a hostile web page, another device, or a malformed client can do must fail closed.
const http = require('http'), net = require('net'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ROOT, reporter, sleep } = require('./helpers');
// KCUE_REMOTE points the suite at a modified copy of remote.js (used to prove each defence is actually tested)
const { createRemote, validateCommand, loadConfig, hostOk } = require(process.env.KCUE_REMOTE || path.join(ROOT, 'remote.js'));

const t = reporter('remote');
const ck = (n, ok, d = '') => t.check(n, ok, d);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kcue-remote-'));
const pageHtml = () => fs.readFileSync(path.join(ROOT, 'remote.html'), 'utf8');
const sent = [];
const mk = (extra = {}) => createRemote({ configPath: path.join(work, `r${Math.random().toString(36).slice(2)}.json`), sendCommand: c => sent.push(c), pageHtml, timeouts: { heartbeat: 150, check: 100, headers: 400, request: 600 }, ...extra });

function request(port, method, p, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: host ?? `127.0.0.1:${port}`, ...headers } }, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const auth = tok => ({ Authorization: `Bearer ${tok}` });
const json = { 'Content-Type': 'application/json' };
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const refused = (port, host = '127.0.0.1') => new Promise(r => { const s = net.connect(port, host); s.on('connect', () => { s.destroy(); r(false); }); s.on('error', () => r(true)); });

(async () => {
  // ── unit: command whitelist
  const V = validateCommand;
  ck('validateCommand accepts exactly the playback whitelist and strips extra fields',
    JSON.stringify(V({ type: 'pad_toggle', id: 3, evil: 1, __proto__: { x: 1 } })) === '{"type":"pad_toggle","id":3}' &&
    JSON.stringify(V({ type: 'master', value: 7 })) === '{"type":"master","value":1}' &&
    JSON.stringify(V({ type: 'master', value: -3 })) === '{"type":"master","value":0}' &&
    JSON.stringify(V({ type: 'cue_select', index: 2 })) === '{"type":"cue_select","index":2}' &&
    ['stop_all', 'stop_all_auto', 'cue_play', 'cue_next'].every(x => V({ type: x }).type === x) &&
    V({ type: 'toggle', id: 1 }).type === 'pad_toggle' && V({ type: 'play_cue' }).type === 'cue_play' && V({ type: 'next_cue' }).type === 'cue_next');
  ck('validateCommand rejects everything else (bad ids, wrong types, unknown / dangerous commands, non-objects)',
    [null, undefined, 5, 'stop_all', [], [{ type: 'stop_all' }], {}, { type: 'nope' }, { type: 'pad_toggle' }, { type: 'pad_toggle', id: -1 }, { type: 'pad_toggle', id: 1.5 },
     { type: 'pad_toggle', id: '1' }, { type: 'pad_toggle', id: 1e9 }, { type: 'pad_toggle', id: NaN }, { type: 'cue_select', index: -1 }, { type: 'master', value: 'loud' },
     { type: 'master', value: Infinity }, { type: 'load_project', path: '/etc/passwd' }, { type: 'sd_layout', columns: 5 }, { type: 'constructor' }, { type: '__proto__' },
     { type: 'toString' }, { type: 'hasOwnProperty' }].every(x => V(x) === null));
  ck('hostOk: IP literals and localhost on our port only (DNS-rebinding defence)',
    hostOk('127.0.0.1:28491', 28491) && hostOk('localhost:28491', 28491) && hostOk('192.168.1.20:28491', 28491) && hostOk('[::1]:28491', 28491) &&
    !hostOk('evil.example:28491', 28491) && !hostOk('127.0.0.1.evil.example', 28491) && !hostOk('127.0.0.1:9999', 28491) && !hostOk('', 28491) &&
    !hostOk(undefined, 28491) && !hostOk('localhost.evil.com:28491', 28491) && !hostOk('127.0.0.1@evil.com', 28491));

  // ── config: defaults, permissions, sanitising
  const r0 = mk();
  const cfg0 = await r0.init();
  ck('first run: token is 256-bit hex, the config file is private (0600), and the server is OFF by default',
    /^[0-9a-f]{64}$/.test(cfg0.token) && cfg0.enabled === false && cfg0.lan === false && cfg0.status.running === false &&
    (process.platform === 'win32' || (fs.statSync(cfg0.configPath).mode & 0o777) === 0o600));
  fs.writeFileSync(path.join(work, 'bad.json'), JSON.stringify({ enabled: 'yes', lan: 1, port: 80, token: 'short' }));
  const bad = loadConfig(path.join(work, 'bad.json'));
  ck('a hand-edited / corrupt config falls back to safe defaults (off, localhost, fresh token, valid port)',
    bad.enabled === false && bad.lan === false && bad.port === 28491 && /^[0-9a-f]{64}$/.test(bad.token) && bad.token !== 'short');

  // ── enable on localhost
  const R = mk(); await R.init();
  const port = await freePort();
  await R.start({ port });
  const TOKEN = R._config().token;
  const st = R.getConfig().status;
  ck('enabled without LAN: binds 127.0.0.1 only', st.running && st.host === '127.0.0.1' && st.port === port);
  const lanIp = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
  if (lanIp) ck(`really unreachable from other devices: connecting to ${lanIp}:${port} is refused`, await refused(port, lanIp));
  else t.skip('LAN reachability check', 'this machine has no non-loopback IPv4 address');

  // ── authentication
  const a1 = await request(port, 'GET', '/state');
  const a2 = await request(port, 'GET', '/state', { headers: auth('0'.repeat(64)) });
  const a3 = await request(port, 'GET', '/state', { headers: { Authorization: `Basic ${TOKEN}` } });
  const a4 = await request(port, 'GET', '/state', { headers: { Authorization: `Bearer ${TOKEN.toUpperCase()}` } });
  const a5 = await request(port, 'POST', '/command', { headers: json, body: '{"type":"stop_all"}' });
  const a6 = await request(port, 'GET', '/events');
  const a7 = await request(port, 'GET', `/state?token=${TOKEN}`);
  ck('no token / wrong token / wrong scheme / token in the query string → 401 on /state, /command and /events',
    [a1, a2, a3, a4, a5, a6, a7].every(x => x.status === 401) && sent.length === 0, JSON.stringify([a1, a2, a3, a4, a5, a6, a7].map(x => x.status)));
  const ok = await request(port, 'GET', '/state', { headers: auth(TOKEN) });
  ck('correct token → 200 with JSON', ok.status === 200 && /json/.test(ok.headers['content-type']) && JSON.parse(ok.body).v === 1);
  const ping = await request(port, 'GET', '/ping');
  ck('/ping is public and leaks nothing but the service name', ping.status === 200 && JSON.parse(ping.body).ok === true && !ping.body.includes(TOKEN) && Object.keys(JSON.parse(ping.body)).length === 2);

  // ── cross-site defences (each with a VALID token: they must fail on their own)
  const h1 = await request(port, 'GET', '/state', { headers: auth(TOKEN), host: `evil.example.com:${port}` });
  const h2 = await request(port, 'GET', '/state', { headers: auth(TOKEN), host: `127.0.0.1:${port + 1}` });
  ck('DNS rebinding: a hostname / wrong-port Host is refused (421) even with a valid token', h1.status === 421 && h2.status === 421);
  const o1 = await request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...json, Origin: 'https://evil.example' }, body: '{"type":"stop_all"}' });
  const o2 = await request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...json, Origin: 'null' }, body: '{"type":"stop_all"}' });
  const o3 = await request(port, 'GET', '/state', { headers: { ...auth(TOKEN), Origin: `http://127.0.0.1:${port + 1}` } });
  ck('a foreign / "null" / other-port Origin is refused (403) even with a valid token; nothing reached the app', [o1, o2, o3].every(x => x.status === 403) && sent.length === 0);
  const f1 = await request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...json, 'Sec-Fetch-Site': 'cross-site' }, body: '{"type":"stop_all"}' });
  const f2 = await request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...json, 'Sec-Fetch-Site': 'same-site' }, body: '{"type":"stop_all"}' });
  ck('Sec-Fetch-Site cross-site / same-site is refused (403)', f1.status === 403 && f2.status === 403 && sent.length === 0);
  const sameOrigin = await request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...json, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' }, body: '{"type":"stop_all"}' });
  ck('…while the app\'s own page (same Origin, same-origin fetch) works', sameOrigin.status === 200 && sent.length === 1 && sent[0].type === 'stop_all');
  sent.length = 0;
  const pre = await request(port, 'OPTIONS', '/command', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  ck('CORS preflight is refused (405) and never answered with Access-Control-Allow-*', pre.status === 405 && !Object.keys(pre.headers).some(k => k.startsWith('access-control-')));
  const all = [a1, a2, ok, ping, h1, o1, f1, pre, sameOrigin];
  ck('no response — success or error — ever carries an Access-Control-Allow-* header; all are no-store + nosniff',
    all.every(x => !Object.keys(x.headers).some(k => k.startsWith('access-control-allow')) && x.headers['cache-control'] === 'no-store' && x.headers['x-content-type-options'] === 'nosniff'));

  // ── the "simple request" trick: text/plain POST needs no preflight, so JSON content-type is mandatory
  for (const [label, ct] of [['text/plain', 'text/plain'], ['form', 'application/x-www-form-urlencoded'], ['multipart', 'multipart/form-data; boundary=x'], ['none', undefined]]) {
    const r = await request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...(ct ? { 'Content-Type': ct } : {}) }, body: '{"type":"stop_all"}' });
    if (r.status !== 415) ck(`Content-Type ${label} must be refused`, false, String(r.status));
  }
  ck('POST without Content-Type: application/json is refused (415) — closes the cross-site "simple request" hole', sent.length === 0);

  // ── input validation on the wire
  const send = body => request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...json }, body });
  const v1 = await send('{not json'), v2 = await send('[]'), v3 = await send('{"type":"rm -rf"}'), v4 = await send('{"type":"pad_toggle","id":-4}'),
        v5 = await send('null'), v6 = await send('"stop_all"'), v7 = await send('{"type":"pad_toggle","id":"1"}');
  ck('malformed JSON → 400; arrays / null / strings / unknown commands / bad ids → 422; nothing forwarded',
    v1.status === 400 && [v2, v3, v4, v5, v6, v7].every(x => x.status === 422) && sent.length === 0, JSON.stringify([v1, v2, v3, v4, v5, v6, v7].map(x => x.status)));
  const v8 = await send('{"type":"pad_toggle","id":2,"__proto__":{"polluted":true},"path":"/etc/passwd","cmd":"calc"}');
  ck('extra / prototype-pollution fields are dropped: the app receives exactly {type,id}',
    v8.status === 200 && JSON.stringify(sent[0]) === '{"type":"pad_toggle","id":2}' && ({}).polluted === undefined);
  sent.length = 0;
  const v9 = await send('{"toggle":true,"type":"toggle","id":4}'), v10 = await send('{"type":"next_cue"}'), v11 = await send('{"type":"play_cue"}');
  ck('the community Stream Deck plugin\'s command names still work (toggle / play_cue / next_cue)',
    [v9, v10, v11].every(x => x.status === 200) && sent.map(c => c.type).join() === 'pad_toggle,cue_next,cue_play');
  sent.length = 0;

  // ── body size
  const big = await request(port, 'POST', '/command', { headers: { ...auth(TOKEN), ...json }, body: JSON.stringify({ type: 'stop_all', pad: 'x'.repeat(10000) }) }).catch(e => ({ status: e.code }));
  ck('a body over 4 KB is rejected (413 / connection reset) and never parsed', (big.status === 413 || big.status === 'ECONNRESET' || big.status === 'EPIPE') && sent.length === 0, String(big.status));

  // ── the phone remote page
  const page = await request(port, 'GET', '/remote');
  ck('/remote serves the phone page without auth, with a locked-down CSP, no framing, no referrer, and no token inside it',
    page.status === 200 && /text\/html/.test(page.headers['content-type']) && /default-src 'none'/.test(page.headers['content-security-policy']) &&
    /connect-src 'self'/.test(page.headers['content-security-policy']) && /frame-ancestors 'none'/.test(page.headers['content-security-policy']) &&
    page.headers['x-frame-options'] === 'DENY' && page.headers['referrer-policy'] === 'no-referrer' && !page.body.includes(TOKEN));
  const inline = /<script>([\s\S]*?)<\/script>/.exec(page.body)[1];
  let syntaxOk = true; try { new Function(inline); } catch { syntaxOk = false; }
  ck('the phone page script is valid JavaScript and builds its DOM only with textContent (no innerHTML / eval / document.write)',
    syntaxOk && !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(inline));

  // ── state + event stream
  R.updateState({ v: 1, pads: [{ id: 0, name: 'Kick' }], stack: [] });
  const s2 = await request(port, 'GET', '/state', { headers: auth(TOKEN) });
  ck('GET /state returns the latest state pushed by the app', JSON.parse(s2.body).pads[0].name === 'Kick');
  R.updateState({ v: 1, pads: [{ id: 0, name: 'x'.repeat(300000) }] });
  const s3 = await request(port, 'GET', '/state', { headers: auth(TOKEN) });
  ck('an oversized state push (>256 KB) is ignored', JSON.parse(s3.body).pads[0].name === 'Kick');

  const events = [];
  const openSse = (tok = TOKEN) => new Promise(res => {
    const req = http.request({ host: '127.0.0.1', port, path: '/events', headers: { Host: `127.0.0.1:${port}`, ...auth(tok) } }, r => {
      const c = { req, status: r.statusCode, data: '' }; r.on('data', d => { c.data += d; }); res(c);
    });
    req.on('error', () => res({ status: 'error', data: '' })); req.end();
  });
  const c1 = await openSse();
  await sleep(50);
  R.updateState({ v: 1, pads: [{ id: 0, name: 'Snare' }], stack: [] });
  await sleep(400);                                                   // heartbeat interval is 150 ms in tests
  ck('/events streams the current state, then updates, plus heartbeats', c1.status === 200 && /"Kick"/.test(c1.data) && /"Snare"/.test(c1.data) && /: hb/.test(c1.data), c1.data.slice(0, 200));
  const more = await Promise.all([openSse(), openSse(), openSse()]);
  const fifth = await openSse();
  ck('at most 4 event streams; the 5th gets 503', more.every(c => c.status === 200) && fifth.status === 503, String(fifth.status));
  const oldToken = TOKEN;
  const cfg2 = await R.regenerateToken();
  await sleep(100);
  const rOld = await request(port, 'GET', '/state', { headers: auth(oldToken) });
  const rNew = await request(port, 'GET', '/state', { headers: auth(cfg2.token) });
  ck('regenerating the token: the old token stops working at once, the new one works, open event streams are cut',
    rOld.status === 401 && rNew.status === 200 && cfg2.token !== oldToken && JSON.parse(fs.readFileSync(cfg2.configPath, 'utf8')).token === cfg2.token);
  [c1, ...more].forEach(c => c.req?.destroy());

  // ── resource abuse
  const socks = await Promise.all(Array.from({ length: 30 }, () => new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => res(s)); s.on('error', () => res(null)); })));
  const alive = await request(port, 'GET', '/ping').then(() => true).catch(() => false);
  socks.forEach(s => s?.destroy());
  await sleep(150);
  const after = await request(port, 'GET', '/ping').then(x => x.status).catch(() => 'down');
  ck('30 idle connections cannot crash it, and it serves normally again after they close', after === 200 && typeof alive === 'boolean', `alive=${alive} after=${after}`);
  const slow = net.connect(port, '127.0.0.1');
  const closedAt = await new Promise(res => { const t0 = Date.now(); slow.write('GET /state HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Slow: '); slow.on('close', () => res(Date.now() - t0)); slow.on('error', () => {}); setTimeout(() => res(-1), 4000); });
  slow.destroy();
  ck('a slowloris client that never finishes its headers is dropped by the server', closedAt > 0 && closedAt < 3500, `closed after ${closedAt} ms`);

  // ── lifecycle: apply() persists + restarts; port conflicts are reported, not thrown; stop frees the port
  const blocker = net.createServer().listen(0, '127.0.0.1');
  await new Promise(r => blocker.once('listening', r));
  const bp = blocker.address().port;
  const R2 = mk(); await R2.init();
  const e = await R2.start({ port: bp });
  ck('port already in use → a clear status message, no crash', e.running === false && /already in use/.test(e.error), JSON.stringify(e));
  blocker.close();
  const R3 = mk(); await R3.init();
  const cfg3 = await R3.apply({ enabled: true, lan: false, port: await freePort() });
  const persisted = JSON.parse(fs.readFileSync(cfg3.configPath, 'utf8'));
  ck('apply() saves the settings and starts the server; urls() offers a localhost link with the token in the #fragment (never the query)',
    cfg3.status.running && persisted.enabled === true && cfg3.urls[0].url.includes(`/remote#${persisted.token}`) && !cfg3.urls[0].url.includes('?'));
  const cfg4 = await R3.apply({ enabled: false });
  ck('disabling stops the server and frees the port', cfg4.status.running === false && await refused(cfg3.port ?? persisted.port));
  const cfg5 = await R3.apply({ enabled: true, lan: true, port: 99999 });
  ck('an invalid port is ignored (previous valid port kept); LAN mode binds all interfaces and lists a link per network adapter',
    cfg5.port === persisted.port && cfg5.status.host === '0.0.0.0' && cfg5.urls.length >= 1);
  await R3.stop(); await R.stop(); await R2.stop();
  ck('stop() leaves nothing listening', await refused(port));

  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
