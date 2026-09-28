### Fixes from a security and correctness review (v1.3.1)

**Live-show fixes**
- **Ctrl+Z after opening another show** could put the previous show's sound into a pad of the new one — the undo history is now cleared when a show is loaded
- **Undo no longer rewinds the show**: bringing back a removed cue keeps you on the cue you are on; undoing a deleted scene keeps you on the scene you are on
- **STOP FADE + auto-advance**: a sound that ran out while STOP ALL was fading it could start the next cue. It no longer does. The first STOP ALL press now also fades a sound that was already crossfading out (it used to click it off)
- **MIDI**: a mapping for an exact channel now wins over an "any channel" one, instead of both firing (a learned STOP ALL on a drum pad also started the pad underneath)
- **Pre-show check**: an empty show is now NOT READY; a slow check can no longer write its result into another open dialog
- **Ctrl+Z / Ctrl+Shift+L work on a Greek keyboard layout**
- The header re-fits correctly after resizing the window (STOP ALL could end up a few pixels off-screen)
- Pad names such as "Close" or "Delete" are no longer translated in the shortcuts and files-not-found dialogs; the "Automatic" language option is translated

**Security** *(a project file from someone else is untrusted input)*
- **Windows: a project can no longer make the app connect to a network path.** UNC / device paths in a project (`\\server\share\…`, WebDAV, `\\.\…`) used to be opened as soon as the project loaded, which could leak a Windows sign-in hash. They are now only read from a share you picked in a file dialog (opening a show from a NAS, Locate…, Browse Folder); local and mapped-drive paths work as before
- A specially crafted project could freeze the app for minutes in Greek / German (a slow text-matching pattern) or with hundreds of thousands of cues. Paths are capped at 1024 characters, a show at 100 scenes / 2000 cues per scene / 500 shortcuts, a `.cuepro` at 512 MB; the translator no longer runs its patterns on very long text
- Saving no longer follows a symlink left at `<show>.cuepro.tmp`
- **Remote control**: one device flooding the port can no longer lock out the Stream Deck / phone (per-address connection limit, idle connections are dropped after ~9 s); turning remote control off can no longer leave a listener running; the access link is hidden until you press Show

**A supported engine** *(the app now runs on Electron 43 / Chromium 150 instead of Electron 29 / Chromium 122, which stopped getting security fixes long ago)*
- **System requirements changed: Windows 10 or newer, macOS 12 (Monterey) or newer.** On an older system use the browser version or v1.2.x. (Electron 44 would need macOS 13, so 43 was chosen on purpose.)
- Electron 32 removed the way the app learned where a picked / dropped audio file lives on disk — without a fix, saved projects would have silently lost their links to the audio files. The app now asks Electron the supported way (`webUtils.getPathForFile`), and a test checks it
- The app made one network request of its own at start-up on Windows / Linux: Chromium's spell checker downloading a dictionary from Google (and underlining pad names in red). Spell checking is off, and a test now fails if the running app makes any network request
- Update downloads are checked against the SHA-256 GitHub publishes for the file, as well as the size. (The builds are still not code-signed — see SECURITY.md)
- New docs: `SECURITY.md` (how to report a vulnerability, what is and isn't covered) and `CONTRIBUTING.md`; the README has a Security & privacy section

**Under the hood**
- 257 automated checks run on every pull request, including the **real Electron app** launched headless (from source, and the packaged Linux build), so a problem in `main.js`, the preload bridge or the packaging can no longer hide behind mocks
- The release is only published from `main`; the build workflow can be run by hand on a branch to test the Windows / macOS installers first

---

### Panic, undo, remote control, MIDI, waveforms and more (v1.3.0)

**Live-show safety**
- **Esc = panic** — stops everything instantly, always, even with focus in a slider, and cancels any pending auto-advance. New **STOP FADE** toggle (header): STOP ALL and the ■ buttons fade out over the FADE time; press STOP ALL again to cut
- **Pre-show check (✔)** — verifies every sound, cue and setting and says READY or NOT READY, with a "Go to pad" link for every problem
- **Undo (Ctrl+Z)** for cleared pads, replaced sounds, removed cues, cleared stacks and deleted scenes
- **Show lock (🔒, Ctrl+Shift+L)** — nothing can be edited, loaded or deleted; playback keeps working
- Press the key of a pad that is **fading out** and it comes back instead of stopping; a second stop no longer stretches the fade

**Controlling it from elsewhere** *(all opt-in, off by default)*
- **Stream Deck / Bitfocus Companion / scripts** through a token-protected local API (playback only); a **phone / tablet remote page** for your show network; **MIDI controllers** with *Learn*. See `docs/REMOTE.md`. The server is hardened against hostile web pages (no CORS, Host / Origin checks, JSON only, size limits) and is covered by attack tests

**Working faster**
- **Countdown** on every playing pad and in the cue stack; **waveforms** behind the progress bar for easy IN / OUT points
- **Fill Pads** and multi-file drop (natural sort, non-audio skipped); **reorder the cue stack** with ▲▼ or by dragging; drag a pad's name into the stack
- **Audio output device** picker (interface / PA feed) with a warning if it is unplugged
- New **Settings** dialog (theme, language, output, waveforms, remote, MIDI)

**Languages** — **English, Ελληνικά, Deutsch** (follows your system, or choose in Settings). Translations were written by an AI assistant and would benefit from a native speaker's review.

**Support** — the donate button now goes to **Ko-fi** (ko-fi.com/dkostoudis).

**Under the hood**
- The header now measures itself and compacts as needed, so STOP ALL / VOL / FADE stay on screen in any window size and language
- The desktop app only accepts the Chromium permissions it needs (MIDI, clipboard copy)
- Over 200 automated checks run on every pull request (including attack tests for the remote server)

---

### Reliability & safety (v1.2.8)

**Playback**
- Fixed: clicking the body of a loaded pad could play and immediately pause it (or open several file pickers / load a dropped file several times) — pad click handlers were stacking up on every refresh
- Fixed: holding SPACE or a pad key no longer races through the cue stack / toggles the pad on and off (key auto-repeat is ignored)
- Fixed: SPACE and pad keys were silently ignored after touching the master volume or fade-time control
- Auto-advance now stops at the end of the stack instead of looping the whole show
- A cue whose audio file is missing no longer silences the sound that is playing — it is skipped with a warning
- The selected cue / scene stays correct when you delete earlier cues or scenes; deleting a scene that has cues asks first
- Crossfades are timed on the wall clock, so a busy moment no longer stretches a fade
- Volume values from a project file or a slider can no longer break playback; files that can't be played now say so instead of showing "PLAYING" over silence
- Loop + IN point now loops back to the IN point; replacing or clearing a pad resets its IN/OUT points; audio memory is released
- The timeline / OUT-point loop keeps running when the window is minimised

**Projects**
- A project file is fully validated before anything changes — opening a wrong-format, corrupt or empty `.cuepro` no longer stops the show or wipes the pads
- Saving after loading a show with missing audio files no longer erases the links to those files
- Restoring an autosaved session can no longer overwrite your original show file; the first Save goes through Save As
- "Locate…" now shows audio files by default
- iPad / browser: saving over, importing over, or deleting a saved project asks for confirmation; a failed audio read cancels the save instead of writing a project with missing sounds
- Non-Latin project names (e.g. Greek) no longer collapse to the same folder name

**Security**
- Project files can no longer inject script through colours, ids or names (colours, ids, volumes and names are validated on load; names containing `\` or quotes are escaped correctly)
- The desktop app only lets the page read audio files and `.cuepro` projects, and only write `.cuepro` files you chose in a Save dialog; window navigation and pop-ups are blocked

**Auto-update**
- Windows: the portable `.exe` now updates the file you actually launched (it used to replace a temp copy and re-prompt every launch); updating works with non-English user names and special characters in paths; the app asks **Restart Now / Later** instead of force-quitting mid-show
- macOS: the DMG matching your CPU is always used (an Intel Mac could previously be given the Apple-silicon build); the new app is copied in before the old one is removed
- Downloads are checked for size and completeness, use HTTPS only, and time out instead of hanging

**Other**
- New **♥ Donate** button in the header (PayPal) — the app stays free; opens in your browser
- Now has a proper licence (`LICENSE`, © needitcreative.com): free to use — including commercially, e.g. at paid shows — and to copy, modify and share; the software itself may not be sold
- Pressing the key of a pad that is fading out now brings it back instead of pausing it; a second stop request no longer stretches the fade
- Fixed: at the minimum window width (and even slightly above it) the **STOP ALL, VOL and FADE controls were pushed off-screen** — the header now uses the full width and drops the logo / donate label when space is tight
- The app now declares a strict Content-Security-Policy (it never loads anything from the internet)
- iPad: Add to Home Screen now uses the Kcue icon; the web app's manifest points at a page and icons that exist
- Behind the scenes: an automated test suite (`npm test`) now runs on every pull request, and the lockfile is back in sync so builds are reproducible

---

### macOS fix (v1.2.7)
- Fixed: "damaged and can't be opened" error on macOS — set identity:null and hardenedRuntime:false so Gatekeeper no longer rejects the unsigned app
- README: updated first-run instructions with the correct xattr fix command

### App icon (v1.2.6)
- New Kcue icon across the app — taskbar, dock, title bar, and browser tab
- Scale control (− / + zoom buttons) is now always fixed and never scales with the UI
- Cue stack panel and footer bar are now fixed overlays — they stay readable at any zoom level

### iPad fixes (v1.2.5)
- Fixed: tapping a pad now correctly opens the file picker on iOS Safari
- Fixed: all buttons now respond instantly — removed 300ms touch delay
- Fixed: grey tap flash removed from pads and buttons
- Fixed: pad labels now say "Tap to load audio" instead of "Click or drop file"
- Added: long-press on pad name to rename on touch

### iPad / Touch support (v1.2.4)
- Download the iPad HTML file, open in Safari on iPad, tap Share → Add to Home Screen to install as a standalone app
- Cue stack moves to a bottom sheet — tap the pill handle to expand/collapse
- Play Cue + Next Cue always visible even when the list is collapsed
- Save and Load work natively in Safari (stored on device via IndexedDB)
- Export / Import .cuepro files to back up or transfer between devices
- Safe-area support for notch and home indicator
