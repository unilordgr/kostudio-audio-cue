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

- **Cue Pads** — up to any number of pads, each with its own audio file, colour, and keyboard shortcut
- **Play / Pause / Stop** — dedicated transport controls per pad; playing a new pad automatically fades out the previous one
- **Crossfade engine** — smooth fade in/out with configurable duration
- **Per-pad volume** — individual volume sliders plus a master volume control
- **Loop toggle** — loop any cue indefinitely
- **Cue Stack** — drag cues into a sequence and step through them with `SPACE` or the Next Cue button
- **Multiple Scenes** — separate stacks per scene (e.g. Act 1, Act 2), tab-switched instantly
- **Auto-advance** — automatically moves to the next cue when the current one finishes
- **Custom hotkeys** — assign Ctrl / Alt / Shift + key combos to any pad
- **Save / Save As / Load** — project files store audio file paths (Windows) or copies (browser); missing files can be re-linked on load
- **Session autosave** — recovers your layout automatically if you close without saving
- **Light & Dark theme** — toggle with one click, preference saved
- **UI Scale** — zoom the interface from 50% to 200%

---

## Getting Started

### Windows (Portable .exe)
1. Download `Kostudio Audio Cue.exe` from the [latest release](../../actions)
2. Double-click — no installation needed
3. Drag audio files onto pads or click a pad to browse

### macOS (App)
1. Download `Kostudio Audio Cue.dmg` from the [latest release](../../releases/latest)
2. Open the DMG, drag the app to **Applications**
3. First launch: **right-click → Open** (macOS blocks unsigned apps by default — this bypasses it)

### macOS / Browser (no install)
Open `kostudio cue.html` directly in **Chrome** or **Edge**.  
> Safari is not supported — the File System Access API (Save/Load) requires Chrome or Edge.

---

## Saving Projects

| | Windows App | Browser |
|---|---|---|
| **Save As** | Saves a `.cuepro` file anywhere on disk; audio files stay in place, paths are stored | Copies audio files into a project folder |
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
- **GitHub Actions** — automated Windows build

---

## License

MIT
