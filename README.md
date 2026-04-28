# Kostudio Audio Cue

A professional live performance audio cue manager. Load sounds onto pads, build cue sequences, and trigger them by keyboard shortcut or button — designed for theatre, events, and live shows.

<p align="center">
  <a href="https://github.com/unilordgr/kostudio-audio-cue/releases/latest">
    <img src="https://img.shields.io/badge/⬇%20%20DOWNLOAD%20FOR%20WINDOWS-Portable%20.exe%20%E2%80%94%20no%20install%20needed-0078d4?style=for-the-badge&logo=windows&logoColor=white" alt="Download Windows EXE">
  </a>
  &nbsp;
  <a href="https://github.com/unilordgr/kostudio-audio-cue/releases/latest">
    <img src="https://img.shields.io/badge/⬇%20%20DOWNLOAD%20FOR%20MAC-DMG%20%E2%80%94%20Intel%20%26%20Apple%20Silicon-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download Mac DMG">
  </a>
</p>

![Dark Mode](https://img.shields.io/badge/theme-dark%20%2F%20light-blue) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Browser-lightgrey) ![Portable](https://img.shields.io/badge/windows-portable%20.exe-green) ![Mac](https://img.shields.io/badge/mac-DMG%20%7C%20Intel%20%26%20Apple%20Silicon-silver)

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
- **Multiple Scenes** — separate stacks per scene (e.g. Act 1, Act 2), tab-switched instantly
- **Auto-advance** — automatically moves to the next cue when the current one finishes
- **Stack text scale** — independently resize the cue stack text with − / + buttons

### Interface & Scale
- **Header always fixed** — Save, Load, VOL, STOP ALL never scale or disappear
- **PADS scale** — zoom the pad grid from 40% to 200% using the footer − / + controls
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
- **Windows**: downloads the new `.exe` in the background, shows a progress bar in the app, then automatically replaces itself and restarts — no browser needed
- **Mac**: downloads the DMG, attempts to copy the `.app` to Applications automatically

---

## Getting Started

### Windows (Portable .exe)
1. Download `Kostudio Audio Cue.exe` from the [latest release](../../releases/latest)
2. Double-click — no installation needed
3. Drag audio files onto pads or click a pad to browse

### macOS (App)
1. Download `Kostudio Audio Cue.dmg` from the [latest release](../../releases/latest)
2. Open the DMG, drag the app to **Applications**
3. First launch: **right-click → Open** (bypasses macOS Gatekeeper for unsigned apps)

### macOS / Browser (no install)
Open `kostudio cue.html` directly in **Chrome** or **Edge**.
> Safari is not supported — the File System Access API (Save/Load) requires Chrome or Edge.

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

Both the Windows `.exe` and Mac `.dmg` are built automatically via GitHub Actions on every push to `main`.

---

## Tech Stack

- **Electron** — desktop wrapper
- **Vanilla JS / HTML / CSS** — no frameworks, single file renderer
- **Web Audio API** — playback engine
- **File System Access API** — save/load in browser mode
- **IndexedDB** — project registry in browser mode
- **electron-builder** — packaging
- **GitHub Actions** — automated Windows + Mac build and release

---

## License

MIT
