# Kostudio Audio Cue

A professional live performance audio cue manager. Load sounds onto pads, build cue sequences, and trigger them by keyboard shortcut or button — designed for theatre, events, and live shows.

[![Version](https://img.shields.io/github/v/release/unilordgr/kostudio-audio-cue?style=flat-square&color=brightgreen)](https://github.com/unilordgr/kostudio-audio-cue/releases/latest)

---

## Download

| Platform | | |
|---|---|---|
| **Windows** x64 | Portable — no install needed | [![Windows](https://img.shields.io/badge/Download-.exe-0078d4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/unilordgr/kostudio-audio-cue/releases/latest/download/Kostudio-Audio-Cue-x64.exe) |
| **macOS** Apple Silicon | M1 / M2 / M3 / M4 | [![macOS ARM](https://img.shields.io/badge/Download-arm64%20.dmg-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/unilordgr/kostudio-audio-cue/releases/latest/download/Kostudio-Audio-Cue-arm64.dmg) |
| **macOS** Intel | x64 | [![macOS Intel](https://img.shields.io/badge/Download-x64%20.dmg-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/unilordgr/kostudio-audio-cue/releases/latest/download/Kostudio-Audio-Cue-x64.dmg) |
| **iPad / Browser** | Safari · Chrome · Edge | [![iPad](https://img.shields.io/badge/Download-HTML%20file-00d4ff?style=for-the-badge&logo=safari&logoColor=white)](https://github.com/unilordgr/kostudio-audio-cue/releases/latest/download/Kostudio-Audio-Cue-iPad-Web.html) |

> All releases: [github.com/unilordgr/kostudio-audio-cue/releases](https://github.com/unilordgr/kostudio-audio-cue/releases)

**System requirements:** the desktop app is built on Electron 43 (Chromium 150), which needs **Windows 10 or newer** and **macOS 12 (Monterey) or newer**. On an older system, use the browser version (any current Chrome, Edge or Safari) or an [older release](https://github.com/unilordgr/kostudio-audio-cue/releases) (v1.2.x runs on older systems but no longer gets security fixes).

### First-run warnings (app is unsigned)

**macOS — "damaged and can't be opened"**

macOS quarantines apps downloaded from the internet. Run this once in Terminal, then double-click normally:

```bash
xattr -cr "/Applications/Kostudio Audio Cue.app"
```

If you installed it somewhere other than Applications, adjust the path accordingly.

**Windows — SmartScreen prompt**

Click **More info** → **Run anyway**.

---

## Features

### Cue Pads
- **Any number of pads** — each with its own audio file, colour, and keyboard shortcut
- **Colour + shortcut** displayed in a left column on each pad for quick identification
- **Rename** any pad by double-clicking its name
- **Drag & drop** audio files directly onto pads — drop several at once (or use **Fill Pads…**) to fill the next empty pads, sorted naturally (Cue 2 before Cue 10); non-audio files are skipped

### Playback & Transport
- **Play / Pause / Resume / Stop** — dedicated transport controls per pad
- **Crossfade engine** — playing a new pad automatically fades out the previous one
- **Configurable fade duration** — set the crossfade time in seconds (header control)
- **Per-pad fade toggle** — enable or disable fade-in per pad independently
- **Per-pad volume** — individual sliders plus a master volume control
- **Loop toggle** — loop any cue indefinitely
- **Loops crossfade into themselves; OUT points fade out** — with a pad's **↓ FADE** on, a looping pad crossfades at the loop point (the start of the loop comes in under the fading tail, equal power, so you never hear it stop or restart), and a pad that plays to its OUT point fades out and lands on silence exactly at OUT. It uses the header **FADE** time, shortened automatically for a very short region. Pads with FADE off behave exactly as before
- **Countdown** — while a pad plays it shows the time *remaining* (to the end, or the OUT point); the cue stack shows each cue's length and the running cue's countdown
- **Bring it back** — press the key of a pad that is fading out and it fades back up instead of stopping
- **STOP FADE** — a header toggle: when on, STOP ALL and the ■ buttons fade out over the FADE time; pressing STOP ALL again cuts instantly
- **Panic key** — `Esc` always cuts everything instantly, even with focus in a slider, and cancels any pending auto-advance

### IN / OUT Points
- **Set an IN point** — scrub the timeline to a position, click **▶ IN** to mark where playback starts
- **Set an OUT point** — scrub to the end position, click **OUT ◼** to mark where playback stops
- **No OUT point** — plays to the end of the track
- **Loop with IN/OUT** — loops within the marked region
- **Click again to reset** — clicking a set IN or OUT point clears it
- Visual markers on the timeline bar show exactly where IN and OUT are set

### Timeline
- **Thick scrub bar** — easy to click and drag-seek with the mouse
- **Active zone highlight** — the region between IN and OUT is shaded on the bar
- **Click to seek** — click anywhere on the bar to jump to that position
- **Live time display** — shows current position and total duration
- **Waveforms** — each pad can show its waveform behind the bar, so IN / OUT points are easy to place (Settings → Appearance; skipped for very long files and on touch devices)

### Cue Stack
- **Drag cues into a sequence** and step through them with `SPACE` or the Next Cue button
- **Click to select** — clicking a stack item selects it without playing (highlights in blue)
- **▶ PLAY CUE** — dedicated button plays the selected cue, stops all other audio first
- **■ STOP CUE** — the same button transforms while playing; click again to stop with fade
- **Multiple Scenes** — separate stacks per scene (e.g. Act 1, Act 2), tab-switched instantly
- **Auto-advance** — automatically moves to the next cue when the current one finishes, and stops at the end of the stack
- **Reorder** — ▲▼ buttons or drag a row; drag a pad's name onto the stack to insert it; the selected cue stays selected
- **Stack text scale** — independently resize the cue stack text with − / + buttons

### Live-show safety
- **Pre-show check (✔)** — one button verifies every sound opens, every cue has audio, IN/OUT points make sense, the output device is connected and the project is saved, and gives a clear **READY / NOT READY** with a "Go to pad" link for each problem
- **Show lock (🔒)** — disables editing, loading and deleting so nothing changes by accident; playback, volume and STOP keep working (`Ctrl+Shift+L`)
- **Undo (`Ctrl+Z`)** — restores cleared pads (with their sound, IN/OUT and cues), replaced sounds, removed cues, cleared stacks and deleted scenes
- **Audio output device** — send the sound to a specific interface / PA feed (Settings → Audio output; desktop and Chrome / Edge)
- **Missing-audio protection** — a cue whose file is missing is skipped with a warning instead of cutting the sound that is playing

### Remote control & MIDI
- **Stream Deck, Bitfocus Companion and scripts** — an opt-in, token-protected local API (off by default; playback commands only). See [docs/REMOTE.md](docs/REMOTE.md)
- **Phone / tablet remote** — a page served by the desktop app to devices on your network (a separate opt-in tick box)
- **MIDI controllers** — *Learn* any note / pad / button and map it to a pad, STOP ALL or the cue stack (Chrome, Edge and the desktop app)

### Languages
- **English, Ελληνικά, Deutsch** — follows your system language, or choose in Settings → Appearance. Control labels such as STOP ALL, FADE, VOL, IN and OUT stay in English, as on a mixing desk

### Look & first run
- **A dark, control-room look** by default (light theme in Settings), one consistent icon set, tabular numerals for every time, and **pad states readable from across the room** — playing (colour glow), paused, fading out, missing audio, locked
- **Welcome card** on an empty show (three steps, "Add sounds…"), then a dismissible **quick-tips** strip (back from Settings → Help)
- **NEXT marker** in the cue stack and a NEXT CUE button that says what SPACE will play; **toasts with Undo**; labelled **Settings**, **Check** and **Lock** buttons

### Interface & Scale
- **Kcue app icon** — custom icon visible in taskbar, dock, title bar, and browser tab
- **Header always fixed** — Save, Load, VOL, STOP ALL never scale or disappear
- **PADS scale** — zoom the pad grid from 40% to 200% using the − / + controls (bottom-left, always visible)
- **Stack + footer fixed** — cue stack panel and status bar stay at full size regardless of zoom level
- **Stack text scale** — resize stack list text independently (70%–160%)
- **Light & Dark theme** — in Settings, preference saved
- **Adaptive header** — the header measures itself and drops the logo, then text labels, as the window (or a longer language) needs, so the transport controls never leave the screen
- **Responsive layout** — header, footer, and stack panel stay anchored at all zoom levels

### Shortcuts
- **Custom hotkeys** — assign Ctrl / Alt / Shift + key combos to any pad
- **Default pad keys** — `1`–`8`, `Q`–`R` trigger crossfade play instantly
- **`SPACE`** — advances to the next cue in the stack
- **`Esc`** — panic: stop everything instantly
- **`Ctrl+Z`** — undo · **`Ctrl+Shift+L`** — lock / unlock the show

### Save / Load
- **Save / Save As / Load** — project files store audio file paths (Windows app) or copies (browser)
- **Missing file recovery** — if audio has moved, a dialog lets you Locate each file or Browse Folder to reconnect all at once
- **Session autosave** — recovers your layout automatically if you close without saving

### Auto-Update
- On launch, the app silently checks GitHub for a newer version
- If an update is available: a native dialog asks **Download Now** or **Later**
- **Windows**: downloads the new `.exe` in the background and shows a progress bar in the app. When it's ready you choose **Restart Now** or **Later** — Later applies the update the next time you close the app, so it never interrupts a show
- **Mac**: downloads the DMG for your chip (Apple Silicon or Intel), then copies the new `.app` over the old one, falling back to opening the DMG if it can't
- Downloads use HTTPS only and are checked for size **and** against the SHA-256 GitHub publishes for the file. The builds are **not code-signed**, so the update is only as trustworthy as this GitHub repository — see [Security](#security--privacy)

---

## Security & privacy

- **Nothing leaves your computer.** The app never loads anything from the internet (strict Content-Security-Policy); the only network traffic is the update check to GitHub, and the ♥ Donate button, which opens Ko-fi in your browser.
- **Project files are treated as untrusted input** — they are validated before anything changes, sizes are capped (100 scenes, 2000 cues per scene, 500 pads, 500 shortcuts, 512 MB), and on Windows a project can't make the app open a network path (`\\server\share\…`) unless you picked that share in a file dialog yourself. Only open shows from people you trust all the same.
- **The desktop app can only read audio files and `.cuepro` projects, and only write `.cuepro` files you chose in a Save dialog.** Window navigation, pop-ups and every Chromium permission except MIDI and clipboard copy are blocked.
- **Remote control is off by default.** When you turn it on it listens on this computer only, unless you also tick the network box; it needs a secret token, can only start and stop sounds, and rejects requests from other web pages. On a network the connection is plain HTTP — use a private show network. Details: [docs/REMOTE.md](docs/REMOTE.md).
- **Unsigned builds.** Windows SmartScreen and macOS Gatekeeper warn about the app because it is not signed with a paid certificate. Download it only from this repository's releases.
- Found a vulnerability? Please read [SECURITY.md](SECURITY.md) and report it privately.

---

## Getting Started

### Windows (Portable .exe)
1. Download `Kostudio-Audio-Cue-x64.exe` from the [latest release](../../releases/latest)
2. Double-click — no installation needed
3. Drag audio files onto pads or click a pad to browse

### macOS (App)
1. Download the `.dmg` for your chip from the table above
2. Open the DMG, drag the app to **Applications**
3. If macOS says "damaged and can't be opened", run in Terminal: `xattr -cr "/Applications/Kostudio Audio Cue.app"`

### Browser / iPad (no install)
Use the hosted web app at **https://unilordgr.github.io/kostudio-audio-cue/**, or download `Kostudio-Audio-Cue-iPad-Web.html` from the [latest release](../../releases/latest) and open it locally.

| Browser | Save / Load |
|---|---|
| **Chrome / Edge** | Saves a project folder (audio copied in) using the File System Access API |
| **Safari / iPad** | Saves to the device's browser storage; use **Export… / Import .cuepro** to back up or move projects |

On iPad: open it in Safari, tap **Share → Add to Home Screen** to install it as a standalone app.

---

## Saving Projects

| | Windows App | Browser |
|---|---|---|
| **Save As** | Saves a `.cuepro` file anywhere on disk; audio file paths are stored | Copies audio files into a project folder |
| **Save** | Overwrites the last saved `.cuepro` instantly | Same as Save As |
| **Load** | Opens a `.cuepro` file; missing audio can be re-linked | Opens a saved project folder |

If audio files have moved since last save, a dialog lets you **Locate** each file individually or **Browse Folder** to reconnect all at once.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `SPACE` | Next cue in stack |
| `Esc` | **Panic** — stop everything instantly (also closes a dialog) |
| `1` – `8`, `Q` – `R` | Default pad shortcuts (crossfade play; press again while fading out to bring it back) |
| `Ctrl+Z` | Undo the last destructive action |
| `Ctrl+Shift+L` | Lock / unlock the show |
| Custom | Assign Ctrl/Alt/Shift combos via the Shortcuts panel |

Click the key badge on any pad to reassign it.

---

## Building from Source

**Requirements:** Node.js 22.12 or newer (Electron's installer needs it)

```bash
git clone https://github.com/unilordgr/kostudio-audio-cue.git
cd kostudio-audio-cue
npm ci             # installs Electron (a ~100 MB download) and the build tools
npm start          # run the desktop app
npm run dist-win   # build Windows portable .exe
npm run dist-mac   # build Mac DMG (run on macOS)
```

The Windows `.exe` and Mac `.dmg` files are built automatically via GitHub Actions on every push to `main`, and published as the release for the `version` in `package.json` (an existing release with the same version is replaced). Release notes come from `RELEASE_NOTES.md`. Only `main` publishes: to check that the installers still build on a branch, run the **Build Windows & Mac** workflow by hand on it (Actions → Run workflow) — it builds but does not publish.

---

## Development & Tests

```bash
npm ci                         # includes the Electron binary
npx playwright install chromium
npm test                       # runs everything in tests/
xvfb-run -a npm test           # on a headless Linux box (the real-app test needs a display)
```

Without the Electron binary or a display, `tests/electron.test.js` says SKIP and everything else still runs. To test the *packaged* app instead of the source:
`npx electron-builder --linux --dir --publish never && KCUE_APP_BIN=dist/linux-unpacked/kostudio-audio-cue xvfb-run -a node tests/electron.test.js`

| Test file | What it covers |
|---|---|
| `tests/electron.test.js` | **The real desktop app**, headless: preload bridge, IPC allow-list, open / save through the real dialog IPC, a picked file keeping its disk path, playback, the remote server, permission handler, navigation guard, donate URL — also against the packaged build |
| `tests/fades.test.js` | Loop crossfades and OUT-point fades, measured on the real audio elements (combined level through the seam, hand-over, stop / pause / FADE-off / clear mid-crossfade) |
| `tests/ux.test.js` | Usability fixes: welcome card and tips, NEXT marker, toasts and Undo, labelled header buttons and the compaction ladder, pad layout at every width, touch targets, locked-show clicks |
| `tests/hardening.test.js` | Fixes from the v1.3.0 security and correctness reviews: hostile project files, translator limits, undo / STOP FADE / MIDI / pre-show-check edge cases |
| `tests/ui.test.js` | Playback, fades, panic / STOP FADE, cue stack, undo, lock, waveform, MIDI, pre-show check, header layout, CSP, donate link — in a real Chromium |
| `tests/loaders.test.js` | Project save/load/restore for the Electron path (mocked `electronAPI`) and the iPad path (real IndexedDB) |
| `tests/main.test.js` | `main.js` with Electron mocked: IPC allow-list, permissions, remote-control wiring, updater, download helper, donate handler |
| `tests/remote.test.js` | The remote-control server, attacked: auth, DNS rebinding, cross-origin, CORS, body limits, slowloris, command whitelist |
| `tests/remote-page.test.js` | The phone page in a real browser, and a hostile cross-origin page trying to drive the server |
| `tests/i18n.test.js` | Translation table integrity, coverage of every message, in-place language switching, layout in Greek / German |
| `tests/repo.test.js` | Consistency checks: licence, manifest and icons, packaging list, CSP, one donate URL everywhere |

The same suite runs on every pull request via GitHub Actions (`.github/workflows/test.yml`).

---

## Tech Stack

- **Electron 43** (Chromium 150) — desktop wrapper (kept one major behind the newest on purpose: Electron 44 needs macOS 13, Electron 43 still runs on macOS 12)
- **Vanilla JS / HTML / CSS** — no frameworks, single file renderer
- **Web Audio API** — playback engine
- **File System Access API** — save/load in browser mode
- **IndexedDB** — project registry in browser mode
- **electron-builder** — packaging
- **GitHub Actions** — automated Windows + Mac build and release, and tests on every pull request

---

## Support

Kostudio Audio Cue is free. If it helps your shows, you can support development:

[![Support me on Ko-fi](https://img.shields.io/badge/Support%20me%20on-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/dkostoudis)

The app also has a **♥ Donate** button in the header.

---

## License

[Kostudio Audio Cue Free Use License](LICENSE) © 2026 [needitcreative.com](https://needitcreative.com)

- ✅ **Free to use — including commercially.** Run it at paid shows, events, productions and broadcasts, and get paid for your work.
- ✅ Free to copy, modify and share (free of charge, keeping the licence and copyright notice).
- ❌ **You may not sell the software** — or modified versions of it — or charge for access to it (paid downloads, paid app-store listings, "pro" versions, bundles or subscriptions).
- Need something else, like permission to resell? Contact needitcreative.com.

It is provided "as is", without warranty. See [LICENSE](LICENSE) for the full terms.
