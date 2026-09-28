'use strict';
// Opt-in remote control for Kostudio Audio Cue: a small HTTP API (Stream Deck / Bitfocus Companion / scripts)
// and a phone/tablet remote page. Electron-free on purpose so it can be tested as plain Node — main.js injects
// `sendCommand` (forward a command to the app window) and the config path.
//
// Threat model — this port sits next to a live show, so it is treated as hostile:
//   • OFF by default; binds 127.0.0.1 unless the user also ticks "allow other devices on my network".
//   • Every request except GET /ping and the static remote page needs `Authorization: Bearer <256-bit token>`.
//   • A web page in the user's browser must not be able to drive it: no CORS headers are ever sent, preflight is
//     refused, requests carrying a foreign Origin / Sec-Fetch-Site are rejected, JSON content-type is required
//     (so "simple" cross-site POSTs can't get through), and Host must be an IP literal or localhost (DNS rebinding).
//   • It can only PLAY things: a fixed whitelist of playback commands. It cannot edit, delete, load, save or lock.
//   • Small, bounded: 4 KB bodies, 32 connections (8 per address), 4 event streams, request timeouts.
//   • No failed-auth lockout on purpose: any web page can send junk to 127.0.0.1, so a lockout would let it
//     lock the real Stream Deck out — and a 256-bit token can't be guessed anyway.

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const DEFAULT_PORT     = 28491;
const MAX_BODY_BYTES   = 4096;
const MAX_STATE_BYTES  = 256 * 1024;
const MAX_PADS         = 500;
const MAX_SSE_CLIENTS  = 4;
const MAX_CONNECTIONS  = 32;
const MAX_CONNECTIONS_PER_IP = 8;   // one host (a flooding laptop on the show Wi-Fi) can't use up every slot and lock the real remotes out

// ── config (userData/remote.json, mode 0600) ───────────────
function loadConfig(configPath) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}; } catch { /* first run / unreadable → defaults */ }
  const port  = Number.isInteger(raw.port) && raw.port >= 1024 && raw.port <= 65535 ? raw.port : DEFAULT_PORT;
  const token = typeof raw.token === 'string' && /^[0-9a-f]{64}$/.test(raw.token) ? raw.token : crypto.randomBytes(32).toString('hex');
  return { enabled: raw.enabled === true, lan: raw.lan === true, port, token };
}
function saveConfig(configPath, cfg) {
  const tmp = `${configPath}.tmp`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configPath);
  try { fs.chmodSync(configPath, 0o600); } catch { /* not supported on this filesystem (e.g. Windows) */ }
}

// ── commands: an explicit whitelist, normalised so nothing but known fields is ever forwarded ─────────
const ALIASES = { toggle: 'pad_toggle', play_cue: 'cue_play', next_cue: 'cue_next' };   // names used by the community Stream Deck plugin
function validateCommand(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const type = Object.prototype.hasOwnProperty.call(ALIASES, c.type) ? ALIASES[c.type] : c.type;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  switch (type) {
    case 'pad_toggle':
    case 'pad_stop':      return int(c.id, 0, MAX_PADS - 1) ? { type, id: c.id } : null;
    case 'cue_select':    return int(c.index, 0, 9999) ? { type, index: c.index } : null;
    case 'master':        return typeof c.value === 'number' && Number.isFinite(c.value) ? { type, value: Math.min(1, Math.max(0, c.value)) } : null;
    case 'stop_all':      // instant cut (panic)
    case 'stop_all_auto': // follows the app's STOP FADE setting
    case 'cue_play':
    case 'cue_next':      return { type };
    default:              return null;
  }
}

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();
const tokenMatches = (given, real) => crypto.timingSafeEqual(sha256(given), sha256(real));   // constant time, no length leak

// Host must be an IP literal or localhost (a DNS-rebinding page is reached through a hostname), on our own port.
function hostOk(hostHeader, port) {
  const m = /^(\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::(\d{1,5}))?$/i.exec(hostHeader || '');
  return !!m && (!m[2] || Number(m[2]) === port);
}

function createRemote({ configPath, sendCommand, pageHtml, log = () => {}, timeouts = {} }) {
  let config = loadConfig(configPath);
  let server = null;
  let status = { running: false, host: null, port: config.port, error: '' };
  let latestState = null;                 // JSON string
  const sockets = new Set();
  const perIp = new Map();
  const sseClients = new Set();
  let heartbeat = null;
  const t = { request: 10000, headers: 8000, keepAlive: 5000, heartbeat: 15000, check: 1000, ...timeouts };

  const send = (res, code, body, headers = {}) => {
    const isStr = typeof body === 'string';
    res.writeHead(code, {
      'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...headers,
    });
    res.end(isStr ? body : JSON.stringify(body));
  };

  function handle(req, res) {
    // 1. DNS rebinding: Host must be an IP literal / localhost on our port
    if (!hostOk(req.headers.host, status.port)) return send(res, 421, { error: 'bad host' });

    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { error: 'bad url' }); }
    const p = url.pathname;

    // 2. Public, static, secret-free
    if (req.method === 'GET' && p === '/ping') return send(res, 200, { ok: true, service: 'Kostudio Audio Cue' });
    if (req.method === 'GET' && (p === '/' || p === '/remote')) {
      return send(res, 200, pageHtml(), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      });
    }

    // 3. No CORS, ever: preflights are refused outright
    if (req.method === 'OPTIONS') return send(res, 405, { error: 'no CORS' }, { Allow: 'GET, POST' });

    // 4. Cross-site requests: a foreign Origin / fetch-metadata is refused even with a valid token
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let oh = null;
      try { oh = new URL(origin).host; } catch { /* "null" origin etc. */ }
      if (oh !== req.headers.host) return send(res, 403, { error: 'cross-origin request refused' });
    }
    const sfs = req.headers['sec-fetch-site'];
    if (sfs !== undefined && sfs !== 'same-origin' && sfs !== 'none') return send(res, 403, { error: 'cross-site request refused' });

    // 5. Bearer token
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
    if (!m || !tokenMatches(m[1], config.token)) return send(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });

    if (req.method === 'GET' && p === '/state') {
      return send(res, 200, latestState || '{"v":1,"pads":[],"stack":[]}', { 'Content-Type': 'application/json; charset=utf-8' });
    }

    if (req.method === 'GET' && p === '/events') {
      if (sseClients.size >= MAX_SSE_CLIENTS) return send(res, 503, { error: 'too many event streams' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'keep-alive' });
      res.write(`data: ${latestState || '{"v":1,"pads":[],"stack":[]}'}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'POST' && p === '/command') {
      if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Content-Type must be application/json' });
      let size = 0; const chunks = [];
      let aborted = false;
      req.on('data', c => {
        if (aborted) return;
        size += c.length;
        if (size > MAX_BODY_BYTES) { aborted = true; send(res, 413, { error: 'body too large' }, { Connection: 'close' }); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: 'bad json' }); }
        const cmd = validateCommand(parsed);
        if (!cmd) return send(res, 422, { error: 'unknown or invalid command' });
        try { sendCommand(cmd); } catch (e) { log('remote: sendCommand failed', e.message); return send(res, 503, { error: 'app not ready' }); }
        send(res, 200, { ok: true });
      });
      req.on('error', () => {});
      return;
    }

    send(res, 404, { error: 'not found' });
  }

  // start / stop / apply share `server`, so they run one at a time (two IPC calls in the same tick used to leave an
  // orphaned listener that "disable" could not close)
  let queue = Promise.resolve();
  const serial = fn => { const run = queue.then(fn, fn); queue = run.then(() => {}, () => {}); return run; };

  function stopNow() {
    clearInterval(heartbeat); heartbeat = null;
    sseClients.clear();
    for (const s of sockets) s.destroy();
    sockets.clear(); perIp.clear();
    return new Promise(resolve => {
      if (!server) { status = { ...status, running: false }; return resolve(); }
      const srv = server; server = null;
      srv.close(() => { status = { ...status, running: false, host: null }; resolve(); });
    });
  }

  async function startNow(override = {}) {
    if (server) await stopNow();
    return new Promise(resolve => {
      const port = override.port ?? config.port;
      const host = config.lan ? '0.0.0.0' : '127.0.0.1';
      status = { running: false, host, port, error: '' };
      const srv = http.createServer({ connectionsCheckingInterval: t.check }, handle);
      srv.maxConnections = MAX_CONNECTIONS;
      srv.requestTimeout = t.request; srv.headersTimeout = t.headers; srv.keepAliveTimeout = t.keepAlive;
      srv.on('connection', s => {
        const ip = s.remoteAddress || '?';
        if ((perIp.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) { s.destroy(); return; }
        perIp.set(ip, (perIp.get(ip) || 0) + 1);
        sockets.add(s);
        s.on('close', () => {
          sockets.delete(s);
          const n = (perIp.get(ip) || 1) - 1;
          if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
        });
        s.setTimeout(t.headers + 1000, () => s.destroy());   // a socket that never sends a request is hung up on; cleared by the first request
      });
      srv.on('request', req => req.socket.setTimeout(0));
      srv.on('clientError', (_e, s) => { try { s.destroy(); } catch { /* already gone */ } });
      srv.on('error', e => {                       // permanent: an error event with no listener would crash the main process
        status = { running: false, host, port, error: e.code === 'EADDRINUSE' ? `Port ${port} is already in use — pick another port` : `Could not start: ${e.message}` };
        if (server === srv) server = null;             // only ever forget our own listener
        log('remote: server error', e.message);
        resolve(status);
      });
      srv.listen(port, host, () => {
        server = srv;
        status = { running: true, host, port: srv.address().port, error: '' };
        heartbeat = setInterval(() => { for (const c of sseClients) c.write(': hb\n\n'); }, t.heartbeat);
        heartbeat.unref?.();
        resolve(status);
      });
    });
  }

  function urls() {
    const list = [{ label: 'This computer', url: `http://127.0.0.1:${status.port}/remote#${config.token}` }];
    if (config.lan) {
      for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) list.push({ label: name, url: `http://${a.address}:${status.port}/remote#${config.token}` });
      }
    }
    return list;
  }

  const self = {
    getConfig: () => ({ enabled: config.enabled, lan: config.lan, port: config.port, token: config.token, configPath, status: { ...status }, urls: status.running ? urls() : [] }),
    apply(next = {}) {
      const port = Number.isInteger(next.port) && next.port >= 1024 && next.port <= 65535 ? next.port : config.port;
      config = { ...config,
        enabled: next.enabled === undefined ? config.enabled : next.enabled === true,
        lan:     next.lan     === undefined ? config.lan     : next.lan === true,
        port };
      saveConfig(configPath, config);
      return serial(async () => {
        await stopNow();
        if (config.enabled) await startNow();
        return self.getConfig();
      });
    },
    async regenerateToken() {
      config = { ...config, token: crypto.randomBytes(32).toString('hex') };
      saveConfig(configPath, config);
      for (const c of sseClients) c.end();          // old streams die with the old token
      sseClients.clear();
      return this.getConfig();
    },
    init() { saveConfig(configPath, config); return serial(async () => { if (config.enabled) await startNow(); return self.getConfig(); }); },
    start: override => serial(() => startNow(override)),
    stop:  () => serial(stopNow),
    updateState(state) {
      let json;
      try { json = JSON.stringify(state); } catch { return; }
      if (json.length > MAX_STATE_BYTES) return;
      latestState = json;
      for (const c of sseClients) c.write(`data: ${json}\n\n`);
    },
    _config: () => config,
  };
  return self;
}

module.exports = { createRemote, validateCommand, loadConfig, saveConfig, hostOk, DEFAULT_PORT, MAX_BODY_BYTES, MAX_PADS };
