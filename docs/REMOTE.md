# Remote control (Stream Deck, Companion, phone / tablet, scripts)

Kostudio Audio Cue (desktop app) can be started and stopped from other devices. It is **off by default** and only ever
**plays** things — a fixed set of playback commands. It cannot edit, delete, load, save or lock a show.

Turn it on in **⚙ Settings → Remote control**.

## Quick start

1. **Settings → Remote control → Enable remote control.** The app now listens on `127.0.0.1` (this computer only).
2. **Phone or tablet?** Also tick *Allow phones, tablets and other devices on my network*, then open one of the links
   shown (`http://<your-ip>:28491/remote#…`) on the phone. The link contains the secret token — the page hides it from
   the address bar. Use a private show network: the connection is plain HTTP.
3. **Stream Deck / Companion / scripts?** Send the token in an `Authorization` header — see below.

## Security model

| | |
|---|---|
| Off by default | Nothing listens until you enable it. |
| Localhost by default | The LAN option is a separate, clearly-warned tick box. |
| Token | A random 256-bit secret in `remote.json` (mode 0600). Every request except `/ping` and the phone page needs `Authorization: Bearer <token>`. **New…** in Settings replaces it instantly and cuts open streams. |
| Web pages can't use it | No CORS headers are ever sent, preflights are refused, foreign `Origin` / `Sec-Fetch-Site` requests are rejected, JSON is required, and `Host` must be an IP address or `localhost` (DNS-rebinding defence). |
| Playback only | `pad_toggle`, `pad_stop`, `stop_all`, `stop_all_auto`, `cue_play`, `cue_next`, `cue_select`, `master`. Nothing else is accepted. |
| Bounded | 4 KB request bodies, 32 connections (8 per address, so one device on the network can't fill them all), 4 event streams, request timeouts; a connection that never sends a request is dropped after about 9 s. |

The exact location of the settings file (which also holds the token) is shown in **Settings → Remote control** under the
token. It sits in the app's per-user data folder (for example `%APPDATA%` on Windows, `~/Library/Application Support` on
macOS, `~/.config` on Linux), so a plugin that needs the port and token can read it from there.

## Endpoints

Base URL: `http://127.0.0.1:28491` (port configurable, 1024–65535).

| Method & path | Auth | What it does |
|---|---|---|
| `GET /ping` | no | `{"ok":true,"service":"Kostudio Audio Cue"}` — is the app there? |
| `GET /remote` | no | The phone / tablet remote page (contains no secrets). |
| `GET /state` | yes | Current state as JSON (pads, cue stack, scene, master volume…). |
| `GET /events` | yes | The same state as a server-sent-event stream (heartbeat every 15 s, max 4 streams). |
| `POST /command` | yes | Run a command. `Content-Type: application/json` is required. |

Responses: `200` ok · `400` bad JSON · `401` missing/wrong token · `403` cross-origin · `413` body too large ·
`415` wrong content type · `421` bad Host · `422` unknown/invalid command · `503` app not ready.

## Commands

```json
{"type":"pad_toggle","id":0}       // play / crossfade-stop pad 1 (ids start at 0)
{"type":"pad_stop","id":0}         // stop pad 1 (fades if STOP FADE is on)
{"type":"stop_all"}                // STOP ALL — instant cut (the panic button)
{"type":"stop_all_auto"}           // STOP ALL — follows the STOP FADE setting
{"type":"cue_play"}                // PLAY CUE (play / stop the selected cue)
{"type":"cue_next"}                // NEXT CUE (same as SPACE)
{"type":"cue_select","index":2}    // select cue 3 in the current scene's stack
{"type":"master","value":0.8}      // master volume 0–1
```

The names `toggle`, `play_cue` and `next_cue` used by the community Stream Deck plugin are accepted as aliases.

## Examples

```bash
TOKEN=…64 hex characters from Settings…

# is it running?
curl http://127.0.0.1:28491/ping

# state
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:28491/state

# panic
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"type":"stop_all"}' http://127.0.0.1:28491/command
```

```js
// Node 18+
await fetch('http://127.0.0.1:28491/command', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'pad_toggle', id: 0 }),
});
```

## Stream Deck

Any Stream Deck plugin or tool that can send an HTTP `POST` with headers works, for example
**Bitfocus Companion** (*Generic: HTTP Requests* → *POST*, URL `http://127.0.0.1:28491/command`, header
`Authorization: Bearer <token>`, header `Content-Type: application/json`, body `{"type":"pad_toggle","id":0}`), or an
"API request" / "web request" Stream Deck plugin. Read `/state` (or `/events`) to colour a key by whether its pad is
playing. A dedicated plugin can read the port and token from the settings file (`remote.json`).

## Troubleshooting

* **"Port … is already in use"** — another program (or a second copy of the app) has it. Pick another port in Settings.
* **The phone can't connect** — the LAN box must be ticked, both devices on the same network, and your computer's
  firewall must allow the app to accept incoming connections on that port.
* **`401`** — the token changed (someone pressed *New…*) or the header is missing/misspelt.
* **`421`** — you addressed it by a hostname; use the IP address or `localhost`.
