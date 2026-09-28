# Contributing

Thanks for wanting to help! Kostudio Audio Cue is used live, so the bar is "it must not surprise the operator during a show".

## Before you start

- For anything bigger than a small fix, **open an issue first** so we can agree on the idea before you spend time on it.
- Contributions are accepted under the project's [Free Use License](LICENSE): free to use, including commercially, but the software may not be sold. By sending a pull request you agree your contribution is licensed the same way.
- Security problems: **don't** open a public issue — see [SECURITY.md](SECURITY.md).

## Setup

```bash
git clone https://github.com/unilordgr/kostudio-audio-cue.git
cd kostudio-audio-cue
npm ci                          # Node 22.12+; installs Electron
npx playwright install chromium
npm start                       # run the desktop app
```

The renderer is a single file, `index.html` (vanilla JS, no framework, no build step). `main.js` / `preload.js` are the Electron main process and bridge; `remote.js` / `remote.html` are the opt-in remote control.

## Tests — please add one

```bash
npm test                # everything
xvfb-run -a npm test    # on a headless Linux box (the real-app test needs a display)
```

Every pull request runs the full suite in GitHub Actions, including the real Electron app and the packaged Linux build. A change should come with a test that **fails without it**. Look at how `tests/hardening.test.js` does it: reproduce the bug on the old code, then fix it.

## House rules

- **Playback comes first.** Nothing may be able to silence, mis-trigger or fail to stop audio during a show. Editing actions must go through the show-lock check (`lockedOut()`); remote and MIDI commands are playback-only.
- **Project files, remote requests and the network are untrusted input.** Validate in `parseProjectConfig` / `normalizePad` / `validateCommand`; escape anything that reaches `innerHTML` (`escHtml`, `escAttr`); never widen the IPC allow-lists in `main.js` without a test in `tests/main.test.js` and `tests/electron.test.js`.
- **User-visible text must be translated.** English text is the translation key (`I18N_TABLE` in `index.html`: English, Ελληνικά, Deutsch); `tests/i18n.test.js` fails if a new message has no translation. Put user-typed text (pad, scene, project names, file paths) in an element with `data-notr`.
- Keep the app **free of network calls**, other than the update check.
- Match the surrounding style; comments explain *why*, not what.

## Releases

Merging to `main` publishes a release for the `version` in `package.json` (Windows `.exe`, both macOS `.dmg`s and the iPad HTML file), with the notes from `RELEASE_NOTES.md`. So a pull request that should ship also bumps the version (`package.json` and `package-lock.json`) and adds a section at the top of `RELEASE_NOTES.md`. To check that the installers still build on your branch without publishing, run the **Build Windows & Mac** workflow on it by hand (Actions → Run workflow).
