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
