# Security policy

Kostudio Audio Cue runs at live shows, so a security problem can also be a show problem. Reports are welcome and taken seriously.

## Supported versions

Only the **latest release** gets fixes. The desktop app updates itself (Windows and macOS); the browser / iPad version updates when you reload it.

## Reporting a vulnerability

**Please don't open a public issue for a vulnerability.** Use GitHub's private reporting instead:

1. Go to the repository's **Security** tab → **Report a vulnerability** (a private security advisory).
2. Describe what you found, how to reproduce it (a sample `.cuepro` file or a small script is ideal) and what you think the impact is.

If you can't use that, contact needitcreative.com and ask for a private channel before sharing details.

You'll get an answer as soon as I can, and a fix is released before the details are made public. Credit is given if you want it.

## What is in scope

- Opening a malicious `.cuepro` project (path handling, resource exhaustion, script injection through names, colours, ids or paths)
- The opt-in remote control server (`remote.js`, `remote.html`): authentication, cross-site / DNS-rebinding attacks, denial of service by a device on the same network, anything beyond the playback-only command set
- The desktop app's IPC surface (`main.js`, `preload.js`): reading or writing files outside the intended allow-list, opening URLs, permissions
- The updater (`main.js`): anything that lets a download be replaced or an unintended file be installed

## Known limits (not treated as vulnerabilities)

- **The builds are not code-signed** (no Apple Developer ID / Windows Authenticode certificate). Updates are downloaded over HTTPS from this repository's GitHub releases and checked against the size and SHA-256 GitHub publishes, so an update is exactly as trustworthy as the repository. Signing would remove that dependency; it needs paid certificates.
- **Remote control over a network is plain HTTP.** Anyone on the same network who has the access link can control playback. It is off by default, and the setting explains this. Use a private show network.
- The page's Content-Security-Policy allows inline scripts (the interface uses inline handlers). All user text is escaped and validated instead; a bypass of that escaping *is* in scope.
- A project file that asks for a very large amount of audio can still use a lot of memory, because audio is decoded in memory.

## How the app defends itself (for reviewers)

See the "Security & privacy" section of the [README](README.md), the threat model at the top of [`remote.js`](remote.js), and [docs/REMOTE.md](docs/REMOTE.md). The `tests/` folder contains attack tests for all of it (`npm test`), including a hostile web page trying to drive the remote server.
