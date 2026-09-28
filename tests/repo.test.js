// Static consistency checks: things that broke silently before because nothing verified them.
const fs = require('fs'), path = require('path');
const { ROOT, reporter } = require('./helpers');

const t = reporter('repo');
const ck = (n, ok, d = '') => t.check(n, ok, d);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const pkg = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('manifest.json'));
const html = read('index.html');
const main = read('main.js');

// ── licence
const lic = exists('LICENSE') ? read('LICENSE') : '';
ck('LICENSE is the Free Use License, copyright needitcreative.com',
  /^Kostudio Audio Cue — Free Use License/.test(lic) && /Copyright \(c\) \d{4} needitcreative\.com/.test(lic));
ck('LICENSE allows commercial use but forbids selling the software (and is not MIT, which would allow it)',
  /FREE COMMERCIAL USE/.test(lic) && /including\s+commercial\s+purposes/.test(lic) &&
  /NO SELLING/.test(lic) && /may not sell the Software/.test(lic) && !/sublicense, and\/or sell/.test(lic));
ck('package.json points at the LICENSE file and names the author', pkg.license === 'SEE LICENSE IN LICENSE' && pkg.author === 'needitcreative.com');
const readme = read('README.md');
ck('README links the LICENSE, says commercial use is free and that the software may not be sold',
  /\]\(LICENSE\)/.test(readme) && /commercially/.test(readme) && /may not sell the software/i.test(readme) && !/\[MIT\]/.test(readme));

// ── one donate URL, everywhere
const DONATE = /https:\/\/www\.paypal\.com\/cgi-bin\/webscr\?cmd=_donations[^"'\s)\]]*/;
const urls = { 'main.js': main, 'index.html': html, 'README.md': read('README.md'), '.github/FUNDING.yml': read('.github/FUNDING.yml') }
const found = Object.fromEntries(Object.entries(urls).map(([f, s]) => [f, (s.match(DONATE) || [])[0]]));
ck('main.js, index.html, README.md and FUNDING.yml all use the identical donate URL',
  Object.values(found).every(Boolean) && new Set(Object.values(found)).size === 1, JSON.stringify(found));
ck('the donate URL pays etutorialsgr@gmail.com', new URL(found['main.js']).searchParams.get('business') === 'etutorialsgr@gmail.com');

// ── web-app manifest + Pages deploy
ck('manifest start_url points at a file that exists', exists(manifest.start_url.replace(/^\.\//, '')), manifest.start_url);
const pagesYml = read('.github/workflows/deploy-pages.yml');
for (const icon of manifest.icons) {
  const src = path.basename(icon.src), file = path.join('build', 'icons', src);
  let dims = null;
  if (exists(file)) { const b = fs.readFileSync(path.join(ROOT, file)); dims = `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; }   // PNG IHDR
  ck(`manifest icon ${icon.src} exists, is really ${icon.sizes}, and is copied to the Pages site`,
    dims === icon.sizes && pagesYml.includes(src), `dims=${dims}`);
}
ck('index.html links the manifest and an apple-touch-icon', /rel="manifest"/.test(html) && /rel="apple-touch-icon"/.test(html));

// ── packaging: every file main.js loads at runtime must be in the electron-builder `files` list
const iconRef = /path\.join\(__dirname, 'build', 'icons', '([^']+)'\)/.exec(main);
ck('the window icon used by main.js is packaged (build.files)', !!iconRef && pkg.build.files.includes(`build/icons/${iconRef[1]}`) && exists(`build/icons/${iconRef[1]}`));
ck('main.js, preload.js and index.html are packaged', ['main.js', 'preload.js', 'index.html'].every(f => pkg.build.files.includes(f)));

// ── the page loads nothing from the network, and a CSP says so
const csp = (/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html) || [])[1] || '';
ck('index.html has a CSP with no remote origin allowed', /default-src 'self'/.test(csp) && !/https?:/.test(csp) && /object-src 'none'/.test(csp));
const remote = [...html.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/g)].map(x => x[1]).filter(u => !u.startsWith('https://www.paypal.com/cgi-bin/webscr'));
ck('the page references no remote resources (only the donate link)', remote.length === 0, remote.join(', '));

// ── release notes feed the release workflow
ck('RELEASE_NOTES.md exists and starts with the current version', exists('RELEASE_NOTES.md') && new RegExp(`\\(v${pkg.version.replace(/\./g, '\\.')}\\)`).test(read('RELEASE_NOTES.md').split('\n').slice(0, 3).join(' ')));
ck('the lockfile matches package.json (npm ci works)', (() => {
  const lock = JSON.parse(read('package-lock.json')).packages[''];
  return JSON.stringify(lock.devDependencies) === JSON.stringify(pkg.devDependencies);
})());

t.finish();
