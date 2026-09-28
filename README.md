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
- **Drag & drop** audio files directly onto pads

### Playback & Transport
- **Play / Pause / Resume / Stop** — dedicated transport controls per pad
- **Crossfade engine** — playing a new pad automatically fades out the previous one
- **Configurable fade duration** — set the crossfade time in seconds (header control)
- **Per-pad fade toggle** — enable or disable fade-in per pad independently
- **Per-pad volume** — individual sliders plus a master volume control
- **Loop toggle** — loop any cue indefinitely

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

### Cue Stack
- **Drag cues into a sequence** and step through them with `SPACE` or the Next Cue button
- **Click to select** — clicking a stack item selects it without playing (highlights in blue)
- **▶ PLAY CUE** — dedicated button plays the selected cue, stops all other audio first
- **■ STOP CUE** — the same button transforms while playing; click again to stop with fade
- **Multiple Scenes** — separate stacks per scene (e.g. Act 1, Act 2), tab-switched instantly
- **Auto-advance** — automatically moves to the next cue when the current one finishes, and stops at the end of the stack
- **Stack text scale** — independently resize the cue stack text with − / + buttons

### Interface & Scale
- **Kcue app icon** — custom icon visible in taskbar, dock, title bar, and browser tab
- **Header always fixed** — Save, Load, VOL, STOP ALL never scale or disappear
- **PADS scale** — zoom the pad grid from 40% to 200% using the − / + controls (bottom-left, always visible)
- **Stack + footer fixed** — cue stack panel and status bar stay at full size regardless of zoom level
- **Stack text scale** — resize stack list text independently (70%–160%)
- **Light & Dark theme** — toggle with one click, preference saved
- **Responsive layout** — header, footer, and stack panel stay anchored at all zoom levels

### Shortcuts
- **Custom hotkeys** — assign Ctrl / Alt / Shift + key combos to any pad
- **Default pad keys** — `1`–`8`, `Q`–`R` trigger crossfade play instantly
- **`SPACE`** — advances to the next cue in the stack

### Save / Load
- **Save / Save As / Load** — project files store audio file paths (Windows app) or copies (browser)
- **Missing file recovery** — if audio has moved, a dialog lets you Locate each file or Browse Folder to reconnect all at once
- **Session autosave** — recovers your layout automatically if you close without saving

### Auto-Update
- On launch, the app silently checks GitHub for a newer version
- If an update is available: a native dialog asks **Download Now** or **Later**
- **Windows**: downloads the new `.exe` in the background and shows a progress bar in the app. When it's ready you choose **Restart Now** or **Later** — Later applies the update the next time you close the app, so it never interrupts a show
- **Mac**: downloads the DMG for your chip (Apple Silicon or Intel), then copies the new `.app` over the old one, falling back to opening the DMG if it can't

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
| `1` – `8`, `Q` – `R` | Default pad shortcuts (crossfade play) |
| Custom | Assign Ctrl/Alt/Shift combos via the Shortcuts panel |

Click the key badge on any pad to reassign it.

---

## Building from Source

**Requirements:** Node.js 18+

```bash
git clone https://github.com/unilordgr/kostudio-audio-cue.git
cd kostudio-audio-cue
npm install
npm start          # run on macOS / Linux
npm run dist-win   # build Windows portable .exe
npm run dist-mac   # build Mac DMG (run on macOS)
```

The Windows `.exe` and Mac `.dmg` files are built automatically via GitHub Actions on every push to `main`, and published as the release for the `version` in `package.json` (an existing release with the same version is replaced). Release notes come from `RELEASE_NOTES.md`.

---

## Development & Tests

```bash
npm ci --ignore-scripts        # install (skips Electron's large binary download; not needed for tests)
npx playwright install chromium
npm test                       # runs everything in tests/
```

| Test file | What it covers |
|---|---|
| `tests/ui.test.js` | Playback, fades, cue stack, keyboard, header layout, CSP and donate link — in a real Chromium |
| `tests/loaders.test.js` | Project save/load/restore for the Electron path (mocked `electronAPI`) and the iPad path (real IndexedDB) |
| `tests/main.test.js` | `main.js` with Electron mocked: IPC allow-list, updater, download helper, donate handler |
| `tests/repo.test.js` | Consistency checks: licence, manifest and icons, packaging list, CSP, one donate URL everywhere |

The same suite runs on every pull request via GitHub Actions (`.github/workflows/test.yml`).

---

## Tech Stack

- **Electron** — desktop wrapper
- **Vanilla JS / HTML / CSS** — no frameworks, single file renderer
- **Web Audio API** — playback engine
- **File System Access API** — save/load in browser mode
- **IndexedDB** — project registry in browser mode
- **electron-builder** — packaging
- **GitHub Actions** — automated Windows + Mac build and release, and tests on every pull request

---

## Support

Kostudio Audio Cue is free. If it helps your shows, you can support development:

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-ffc439?style=for-the-badge&logo=paypal&logoColor=003087)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=etutorialsgr%40gmail.com&currency_code=EUR&item_name=Support%20Kostudio%20Audio%20Cue)

The app also has a **♥ Donate** button in the header.

---

## License

[Kostudio Audio Cue Free Use License](LICENSE) © 2026 [needitcreative.com](https://needitcreative.com)

- ✅ **Free to use — including commercially.** Run it at paid shows, events, productions and broadcasts, and get paid for your work.
- ✅ Free to copy, modify and share (free of charge, keeping the licence and copyright notice).
- ❌ **You may not sell the software** — or modified versions of it — or charge for access to it (paid downloads, paid app-store listings, "pro" versions, bundles or subscriptions).
- Need something else, like permission to resell? Contact needitcreative.com.

It is provided "as is", without warranty. See [LICENSE](LICENSE) for the full terms.
