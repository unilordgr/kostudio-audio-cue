// The phone remote page, in a real browser against a real server — plus a hostile cross-origin page trying to drive it.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { ROOT, reporter, sleep } = require('./helpers');
const { createRemote } = require(path.join(ROOT, 'remote.js'));

const t = reporter('remote-page');
const ck = (n, ok, d = '') => t.check(n, ok, d);

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const STATE = {
  v: 1, scene: { index: 0, name: 'Act 1' }, scenes: ['Act 1'], masterVol: 0.8, autoAdv: false, stopFade: false, locked: false,
  pads: [
    { id: 0, name: 'Kick', color: '#00d4ff', key: '1', loaded: true, playing: false, paused: false, stopping: false, remain: null },
    { id: 1, name: '<img src=x onerror="window.__pwned=1">', color: 'red;background:url(https://evil.example/x)', key: 'q', loaded: true, playing: false, paused: false, stopping: false, remain: null },
    { id: 2, name: 'Empty', color: '#ff0000', key: '', loaded: false, playing: false, paused: false, stopping: false, remain: null },
  ],
  stack: [{ padId: 0, name: 'Kick', noAudio: false }, { padId: 1, name: 'Ghost', noAudio: true }], stackIdx: 0,
};

(async () => {
  const sent = [];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kcue-rp-'));
  const remote = createRemote({ configPath: path.join(work, 'r.json'), sendCommand: c => sent.push(c), pageHtml: () => fs.readFileSync(path.join(ROOT, 'remote.html'), 'utf8') });
  await remote.init();
  const port = await freePort();
  await remote.start({ port });
  const TOKEN = remote._config().token;
  remote.updateState(STATE);
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();

  // ── the page itself
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });     // phone-sized
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const externalRequests = []; page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) externalRequests.push(r.url()); });
    await page.goto(`${base}/remote#${TOKEN}`);
    await page.waitForSelector('.pad');
    const r = await page.evaluate(() => ({
      pads: [...document.querySelectorAll('.pad .nm')].map(e => e.textContent),
      cues: [...document.querySelectorAll('.cue .nm')].map(e => e.textContent),
      activeCue: document.querySelector('.cue.active .nm')?.textContent, noAudioCue: document.querySelectorAll('.cue.noaudio').length,
      hash: location.hash, stored: sessionStorage.getItem('kcue-remote')?.length, scene: document.getElementById('scene').textContent,
      dot: document.getElementById('dot').className, vol: document.getElementById('volSlider').value, pwned: window.__pwned, imgs: document.querySelectorAll('img').length,
      colourApplied: getComputedStyle(document.querySelectorAll('.pad')[1]).borderLeftColor,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    ck('phone page: shows loaded pads only, the cue stack, the scene and the connection light; volume follows the app',
      r.pads.length === 2 && r.pads[0] === 'Kick' && r.cues.join() === 'Kick,Ghost' && r.activeCue === 'Kick' && r.noAudioCue === 1 && r.scene === 'Act 1' && r.dot === 'ok' && r.vol === '80', JSON.stringify(r));
    ck('phone page: a pad named with HTML is shown as plain text; a hostile colour is dropped; nothing external is requested; no page errors',
      r.pwned === undefined && r.imgs === 0 && r.pads[1].startsWith('<img') && externalRequests.length === 0 && errors.length === 0 && r.colourApplied !== 'rgb(255, 0, 0)', JSON.stringify({ r: r.pwned, imgs: r.imgs, externalRequests, errors }));
    ck('phone page: the token is removed from the address bar (kept only for reloads) and the layout fits a phone with no sideways scroll', r.hash === '' && r.stored === 64 && !r.overflowX, JSON.stringify({ hash: r.hash, stored: r.stored, overflowX: r.overflowX }));

    sent.length = 0;
    await page.click('.pad >> nth=0');
    await page.click('.cue >> nth=1');
    await page.click('#play'); await page.click('#next'); await page.click('#stop');
    await page.evaluate(() => { const s = document.getElementById('volSlider'); s.value = 25; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(400);
    ck('phone page: taps send exactly the right commands (pad, cue select, play, next, STOP ALL, master volume)',
      JSON.stringify(sent) === JSON.stringify([{ type: 'pad_toggle', id: 0 }, { type: 'cue_select', index: 1 }, { type: 'cue_play' }, { type: 'cue_next' }, { type: 'stop_all' }, { type: 'master', value: 0.25 }]), JSON.stringify(sent));

    remote.updateState({ ...STATE, pads: STATE.pads.map((p, i) => i === 0 ? { ...p, playing: true, remain: 75 } : p) });
    await page.waitForSelector('.pad.playing');
    const live = await page.evaluate(() => document.querySelector('.pad.playing .st').textContent);
    ck('phone page: live updates — a playing pad lights up with its countdown (−1:15) within a moment', live === '−1:15', live);

    // reload survives (token from sessionStorage), and a regenerated token is reported clearly
    await page.reload(); await page.waitForSelector('.pad');
    await remote.regenerateToken();
    await page.waitForFunction(() => /expired|token/i.test(document.getElementById('msg').textContent), null, { timeout: 4000 });
    ck('phone page: survives a reload; when the token changes it says the link has expired instead of failing silently', true);
    await page.close();

    const p2 = await browser.newPage();
    await p2.goto(`${base}/remote#${'0'.repeat(64)}`);
    await p2.waitForFunction(() => document.getElementById('msg').style.display === 'block', null, { timeout: 4000 });
    ck('phone page: a wrong token shows an explanation and no controls work', /expired|token/i.test(await p2.evaluate(() => document.getElementById('msg').textContent)));
    await p2.close();
  }

  // ── a hostile web page on another origin
  {
    const TOKEN2 = remote._config().token;                          // assume the attacker even learned the current token
    const attackPort = await freePort();
    const attackPage = `<!doctype html><script>
      const B = 'http://127.0.0.1:${port}', T = '${TOKEN2}', out = {};
      const j = { 'Content-Type': 'application/json' };
      const attempt = async (name, fn) => { try { const r = await fn(); out[name] = r; } catch (e) { out[name] = 'blocked:' + e.name; } };
      (async () => {
        await attempt('simplePostNoAuth', async () => (await fetch(B + '/command', { method: 'POST', mode: 'no-cors', body: '{"type":"stop_all"}' })).type);
        await attempt('simplePostFormNoAuth', async () => (await fetch(B + '/command', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x' })).type);
        await attempt('jsonWithLeakedToken', async () => (await fetch(B + '/command', { method: 'POST', headers: { ...j, Authorization: 'Bearer ' + T }, body: '{"type":"stop_all"}' })).status);
        await attempt('readStateWithToken', async () => (await fetch(B + '/state', { headers: { Authorization: 'Bearer ' + T } })).status);
        await attempt('readPageCrossOrigin', async () => (await (await fetch(B + '/remote')).text()).length);
        await attempt('eventSource', () => new Promise(res => { const es = new EventSource(B + '/events'); es.onerror = () => { es.close(); res('error'); }; es.onmessage = () => { es.close(); res('LEAKED'); }; setTimeout(() => res('timeout'), 1500); }));
        await attempt('imgGet', () => new Promise(res => { const i = new Image(); i.onerror = () => res('error'); i.onload = () => res('loaded'); i.src = B + '/state?token=' + T; }));
        document.title = 'done'; window.__out = out;
      })();
    <\/script>`;
    const attackSrv = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(attackPage); });
    await new Promise(r => attackSrv.listen(attackPort, '127.0.0.1', r));
    sent.length = 0;
    const page = await browser.newPage();
    await page.goto(`http://localhost:${attackPort}/`);
    await page.waitForFunction(() => document.title === 'done', null, { timeout: 8000 });
    const out = await page.evaluate(() => window.__out);
    await sleep(200);
    ck('a hostile web page (other origin) drives NOTHING: simple POSTs, JSON POSTs with a LEAKED token, state reads, page reads and event streams are all stopped',
      sent.length === 0 && /blocked/.test(out.jsonWithLeakedToken) && /blocked/.test(out.readStateWithToken) && /blocked/.test(out.readPageCrossOrigin) && out.eventSource !== 'LEAKED' && out.imgGet !== 'loaded', JSON.stringify({ out, sent }));
    await page.close();
    attackSrv.close();
  }

  await browser.close();
  await remote.stop();
  t.finish();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
