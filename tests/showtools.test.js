// v1.6 — the things an operator leans on during a show: LAYER pads (sounds on top of each other), per-cue settings (notes,
// auto-follow, stop cues), ↑/↓ in the cue list, the status bar (what is playing, clock, timer, level), the compact view, the show
// name with its "unsaved" mark, volume above 100 %, the headphone preview, and the layout fixes. Real Chromium via Playwright.
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter } = require('./helpers');

const t = reporter('showtools');
const { check } = t;
let scenarioNo = 0;
async function scenario(fn) {
  scenarioNo++;
  try { await fn(); }
  catch (e) { check(`scenario #${scenarioNo} threw`, false, String(e.message).split('\n')[0]); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes(6), tone = wavBytes(4, { tone: true });

  async function fresh({ width = 1280, height = 800, touch = false, prefs = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.addInitScript(({ wav, tone, prefs }) => {
      window.mkFile = (n = 'a.wav') => new File([new Uint8Array(wav)], n, { type: 'audio/wav' });
      window.mkTone = (n = 'tone.wav') => new File([new Uint8Array(tone)], n, { type: 'audio/wav' });
      try { if (prefs) localStorage.setItem('cue-prefs', JSON.stringify(prefs)); } catch {}
    }, { wav, tone, prefs });
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad') && typeof nextCue === 'function');
    return { page, ctx, errors };
  }
  // pads 0–3 = cues A B C D; pad 5 "Bed" and pad 6 "Sting" are outside the cue list
  const build = page => page.evaluate(async () => {
    ['Cue A', 'Cue B', 'Cue C', 'Cue D', null, 'Bed', 'Sting'].forEach((n, i) => { if (n) { loadFile(i, mkFile(n + '.wav'), true); pads[i].name = n; } });
    [0, 1, 2, 3].forEach(i => addToStack(i));
    fadeDuration = 0.3; masterVol = 1; prefs.stopFade = false; prefs.tipsDismissed = true;
    await new Promise(r => setTimeout(r, 450));
    buildPads(); renderStack();
  });
  const st = page => page.evaluate(() => ({ on: pads.map(p => !!p.playing), paused: pads.map(p => !!p.paused), idx: getScene().stackIdx }));
  const wait = (page, ms) => page.waitForTimeout(ms);

  // ══ LAYER pads ══
  await scenario(async () => {
    const { page, errors } = await fresh();
    await build(page);
    await page.click('#pad5 [data-action="overlap"]');
    const chip = await page.evaluate(() => ({ on: pads[5].overlap, pressed: document.querySelector('#pad5 [data-action="overlap"]').getAttribute('aria-pressed'), cls: document.querySelector('#pad5 [data-action="overlap"]').classList.contains('layer-on') }));
    check('the LAYER chip switches a pad to "plays on top of the others" (and shows it)', chip.on === true && chip.pressed === 'true' && chip.cls, JSON.stringify(chip));
    await page.evaluate(() => { togglePad(0); });                            // a normal pad plays…
    await page.evaluate(() => { togglePad(5); });                            // …starting the LAYER pad stops nothing
    await wait(page, 500);
    let s = await st(page);
    check('starting a LAYER pad does not fade out the pad that is playing — both sound', s.on[0] && s.on[5], JSON.stringify(s.on));
    await page.evaluate(() => { togglePadCrossfade(6); });                   // another normal pad (its key): fades out the normal one, not the layer
    await wait(page, 600);
    s = await st(page);
    check('starting another normal pad fades out the normal pad but leaves the LAYER pad playing', !s.on[0] && s.on[5] && s.on[6], JSON.stringify(s.on));
    await page.keyboard.press('Space');                                      // SPACE → cue A: takes over the room, except the layer
    await wait(page, 600);
    s = await st(page);
    check('SPACE still fades out everything else — except a LAYER pad, which keeps playing under the cue', s.on[0] && s.on[5] && !s.on[6] && s.idx === 0, JSON.stringify(s));
    await page.evaluate(() => { getScene().stackIdx = 1; playCue(); });      // PLAY CUE (cuts): same exception
    s = await st(page);
    check('PLAY CUE cuts the other sounds but not a LAYER pad', s.on[1] && !s.on[0] && s.on[5], JSON.stringify(s.on));
    await page.evaluate(() => stopAll('cut'));
    s = await st(page);
    check('STOP ALL / Esc stop a LAYER pad like everything else', s.on.every(x => !x), JSON.stringify(s.on));
    const saved = await page.evaluate(() => { saveAutosave(); const a = JSON.parse(localStorage.getItem('cue-autosave')); return { ov: a.pads.map(p => p.overlap), parsed: parseProjectConfig(a).pads.map(p => p.overlap), old: parseProjectConfig({ pads: [{ id: 0 }] }).pads[0].overlap, junk: parseProjectConfig({ pads: [{ id: 0, overlap: 'yes' }] }).pads[0].overlap }; });
    check('LAYER is saved with the show and read back; older shows and junk values mean "normal pad"', saved.ov[5] === true && saved.ov[0] === false && saved.parsed[5] === true && saved.old === false && saved.junk === false, JSON.stringify(saved));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ══ per-cue settings ══
  await scenario(async () => {
    const { page, errors } = await fresh();
    await build(page);
    // the dialog
    await page.hover('#stackList .stack-item[data-i="1"]');
    await page.click('#stackList .stack-item[data-i="1"] .stack-ed');
    await page.fill('#cueNote', 'GO on the blackout');
    await page.selectOption('#cueFollow', 'after');
    const waitShown = await page.evaluate(() => !document.getElementById('cueWaitRow').hidden);
    await page.fill('#cueWait', '0.4');
    await page.click('#modalFtr .modal-btn.primary');
    const c = await page.evaluate(() => ({ cue: getScene().stack[1], row: document.querySelector('#stackList .stack-item[data-i="1"]').textContent.replace(/\s+/g, ' '), undo: undoStack[undoStack.length - 1]?.label, modal: !document.getElementById('modalOverlay').classList.contains('hidden') }));
    check('the pencil on a cue row opens its settings; Save stores the note and what follows it',
      c.cue.note === 'GO on the blackout' && c.cue.follow === 'after' && c.cue.wait === 0.4 && c.cue.stop === false && waitShown && !c.modal, JSON.stringify(c.cue));
    check('the cue row shows the note and a follow marker', /GO on the blackout/.test(c.row) && /↪ 0\.4s/.test(c.row), c.row);
    const nb = await page.evaluate(() => { getScene().stackIdx = 0; renderStack(); return document.getElementById('nextBtn').textContent.replace(/\s+/g, ' '); });
    check('the NEXT CUE button shows the note of the cue it is about to fire', /SPACE 2 · Cue B/.test(nb) && /GO on the blackout/.test(nb), nb);
    await page.keyboard.press('Control+z');
    const u = await page.evaluate(() => getScene().stack[1]);
    check('changing a cue\'s settings is one undo step', u.note === '' && u.follow === '', JSON.stringify(u));

    // follow: "after N seconds" — B starts by itself 0.4 s after A starts; and with a LAYER pad both keep sounding
    await page.evaluate(() => { stopAll('cut'); const s = getScene(); s.stackIdx = -1; s.stack[0] = { ...s.stack[0], follow: 'after', wait: 0.4 }; pads[1].overlap = true; renderStack(); });
    await page.keyboard.press('Space');
    await wait(page, 150);
    const a1 = await st(page);
    await wait(page, 700);
    const a2 = await st(page);
    check('"start the next cue after a delay": cue 2 starts by itself 0.4 s after cue 1 (not before)', a1.on[0] && !a1.on[1] && a1.idx === 0 && a2.on[1] && a2.idx === 1, JSON.stringify({ a1: a1.on.slice(0, 2), a2: a2.on.slice(0, 2), idx: a2.idx }));
    check('…and because cue 2 is a LAYER pad, cue 1 keeps playing under it', a2.on[0] && a2.on[1], JSON.stringify(a2.on.slice(0, 2)));

    // follow: "when this one ends" without the global switch; "hold" beats the global switch
    await page.evaluate(() => { stopAll('cut'); autoAdv = false; pads[1].overlap = false; const s = getScene(); s.stack[0] = { ...s.stack[0], follow: 'end', wait: 0 }; s.stack[1] = { ...s.stack[1], follow: 'hold' }; s.stackIdx = -1; renderStack(); });
    await page.evaluate(() => { nextCue(); pads[0].audio.currentTime = pads[0].audio.duration - 0.25; });
    await wait(page, 900);
    const e1 = await st(page);
    check('"start the next cue when this one ends" works for one cue with the Auto-advance switch off', !e1.on[0] && e1.on[1] && e1.idx === 1, JSON.stringify(e1));
    await page.evaluate(() => { autoAdv = true; pads[1].audio.currentTime = pads[1].audio.duration - 0.25; });
    await wait(page, 900);
    const e2 = await st(page);
    check('"wait for SPACE" on a cue holds the show there even with Auto-advance on', !e2.on[1] && !e2.on[2] && e2.idx === 1, JSON.stringify(e2));
    await page.evaluate(() => { autoAdv = false; });

    // stop cue: ends one sound (a LAYER bed) and touches nothing else
    await page.evaluate(() => { stopAll('cut'); pads[5].overlap = true; const s = getScene(); s.stack.splice(1, 0, { padId: 5, note: '', follow: '', wait: 0, stop: true }); s.stackIdx = 0; renderStack(); playPad(0); playPad(5); pads[0].audio.volume = 1; });
    const row = await page.evaluate(() => document.querySelector('#stackList .stack-item[data-i="1"]').textContent.replace(/\s+/g, ' '));
    await page.keyboard.press('Space');
    await wait(page, 700);
    const s1 = await st(page);
    check('a stop cue fades out its own sound and nothing else (the cue before it keeps playing); the row says Stop', !s1.on[5] && s1.on[0] && s1.idx === 1 && /Stop/.test(row), JSON.stringify({ on: s1.on, row }));

    // saved compatibly: `stack` stays a list of ids (older versions read it), settings ride in `cues`
    const sv = await page.evaluate(() => {
      const s = getScene(); s.stack[0] = { ...s.stack[0], note: 'hello', follow: 'end' };
      saveAutosave();
      const a = JSON.parse(localStorage.getItem('cue-autosave')), sc = a.scenes[0];
      const back = parseProjectConfig(a).scenes[0].stack;
      const plain = parseProjectConfig({ pads: [{ id: 0 }, { id: 1 }], scenes: [{ stack: [0, 1] }] }).scenes[0].stack;
      const hostile = parseProjectConfig({ pads: [{ id: 0 }, { id: 1 }], scenes: [{ stack: [0, 9, 1], cues: [{ note: 5, follow: 'boom', wait: 1e9, stop: 'yes' }, { note: 'gone' }, { note: 'x'.repeat(999), follow: 'after', wait: -3, stop: true }] }] }).scenes[0].stack;
      const mismatch = parseProjectConfig({ pads: [{ id: 0 }], scenes: [{ stack: [0], cues: [{ note: 'a' }, { note: 'b' }] }] }).scenes[0].stack;
      return { ids: sc.stack, cues: sc.cues, back, plain, hostile, mismatch };
    });
    check('saved so older versions still open it: `stack` is the plain id list, the settings are a parallel `cues` list',
      sv.ids.every(Number.isInteger) && sv.cues.length === sv.ids.length && sv.cues[0].note === 'hello' && sv.cues[1].stop === true && sv.cues[2].follow === 'hold' && sv.cues[3] === null && sv.back[0].note === 'hello' && sv.back[0].follow === 'end' && sv.back[1].stop === true && sv.back[3].note === '' && sv.back[3].follow === '', JSON.stringify({ ids: sv.ids, cues: sv.cues }));
    check('a show without cue settings has plain cues; hostile values are cleaned (junk type → default, invalid id dropped with its settings, long note cut, wait clamped)',
      sv.plain.every(c => c.note === '' && c.follow === '' && !c.stop) && sv.hostile.length === 2 && sv.hostile[0].note === '' && sv.hostile[0].follow === '' && sv.hostile[0].wait === 3600 && sv.hostile[0].stop === false &&
      sv.hostile[1].note.length === 300 && sv.hostile[1].follow === 'after' && sv.hostile[1].wait === 0 && sv.hostile[1].stop === true && sv.mismatch[0].note === '', JSON.stringify(sv.hostile.map(c => ({ ...c, note: c.note.length }))));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ══ ↑ / ↓ in the cue list ══
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    await page.evaluate(() => { getScene().stackIdx = 1; renderStack(); });
    await page.keyboard.press('ArrowDown');
    const d1 = await page.evaluate(() => ({ idx: getScene().stackIdx, next: +document.querySelector('#stackList .stack-item.is-next').dataset.i, playing: pads.some(p => p.playing) }));
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    const d2 = await page.evaluate(() => ({ idx: getScene().stackIdx, next: +document.querySelector('#stackList .stack-item.is-next').dataset.i }));
    check('↓ moves the NEXT marker one cue on without playing anything; ↑ moves it back and stops at the top (next = cue 1)', d1.idx === 2 && d1.next === 3 && !d1.playing && d2.idx === -1 && d2.next === 0, JSON.stringify({ d1, d2 }));
    await page.keyboard.press('Space');
    check('…and SPACE then plays the cue the marker is on', (await st(page)).on[0] === true);
    // not while a slider or a pad's move handle has the focus (they use the arrows themselves)
    await page.evaluate(() => { stopAll('cut'); getScene().stackIdx = 1; renderStack(); });
    await page.focus('#pvol-0'); await page.keyboard.press('ArrowDown');
    await page.focus('#pad0 .pad-grip'); await page.keyboard.press('ArrowDown');
    const d3 = await page.evaluate(() => getScene().stackIdx);
    check('the arrows are left alone inside a volume slider and on a pad\'s move handle', d3 === 1, String(d3));
    // a pending auto-follow is cancelled when the operator moves the marker
    await page.evaluate(() => { const s = getScene(); s.stackIdx = -1; s.stack[0] = { ...s.stack[0], follow: 'after', wait: 0.3 }; renderStack(); nextCue(); });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('ArrowDown');
    await wait(page, 600);
    const d4 = await st(page);
    check('moving the marker cancels an auto-follow that was about to fire', d4.on[0] && !d4.on[1] && !d4.on[2], JSON.stringify(d4));
    await page.close();
  });

  // ══ status bar: now playing, timer, level ══
  await scenario(async () => {
    const { page, errors } = await fresh();
    await build(page);
    const idle = await page.evaluate(() => ({ txt: document.getElementById('nbPlaying').textContent.trim(), timer: document.getElementById('nbTimer').textContent, clock: document.getElementById('nbClock').textContent }));
    check('nothing playing: the bar says so, the show timer is at zero, the clock runs', /Nothing is playing/.test(idle.txt) && idle.timer === '0:00:00' && /\d/.test(idle.clock), JSON.stringify(idle));
    await page.evaluate(() => { loadFile(4, mkTone('Tone.wav'), true); pads[4].name = 'Tone'; pads[4].overlap = true; });
    await wait(page, 500);
    await page.evaluate(() => { playPad(0); playPad(4); pads[4].audio.currentTime = 2.3; document.querySelector('.pads-section').scrollTop = 9999; });   // the tone file is silent for 2 s, then swells
    await wait(page, 1100);
    const live = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#nbPlaying .np')].map(e => e.textContent.replace(/\s+/g, ' ').trim()), timer: document.getElementById('nbTimer').textContent,
      fill: parseFloat(document.getElementById('nbMeterFill').style.width) || 0, level: mixLevel() }));
    check('every sounding pad is listed in the status bar with its countdown — wherever the pad itself is on screen', live.chips.length === 2 && /Cue A −0:0\d/.test(live.chips[0]) && /Tone/.test(live.chips[1]), JSON.stringify(live.chips));
    check('the show timer started with the first sound', /^0:00:0[1-9]$/.test(live.timer), live.timer);
    check('the level meter moves with what is playing (a silent file adds nothing, the tone does)', live.fill > 40 && live.level.level > 0.3 && live.level.known === 2, JSON.stringify({ fill: live.fill, level: live.level }));
    await page.evaluate(() => { pausePad(0); });
    const paused = await page.evaluate(() => [...document.querySelectorAll('#nbPlaying .np')].map(e => e.className));
    check('a paused pad stays in the bar, marked as paused', paused.some(c => /paused/.test(c)), JSON.stringify(paused));
    await page.click('#nbPlaying .np:nth-child(2) .np-stop');
    await wait(page, 150);
    const after = await page.evaluate(() => ({ on4: pads[4].playing, chips: document.querySelectorAll('#nbPlaying .np').length }));
    check('the ■ on a chip stops that sound', after.on4 === false && after.chips === 1, JSON.stringify(after));
    await page.click('#nbTimer');
    await wait(page, 80);
    check('clicking the timer sets it back to zero', (await page.evaluate(() => document.getElementById('nbTimer').textContent)) === '0:00:00');
    const clip = await page.evaluate(async () => { stopAll('cut'); pads[4].vol = 2; applyBoost(pads[4]); playPad(4); pads[4].audio.currentTime = 3.3; await new Promise(r => setTimeout(r, 450)); return { cls: document.getElementById('nbMeter').className, level: mixLevel().level, gain: pads[4].gain?.gain.value }; });
    check('a boosted pad that goes over full scale turns the meter red (clipping)', /clip/.test(clip.cls) && clip.level > 1 && clip.gain === 2, JSON.stringify(clip));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ══ compact view ══
  await scenario(async () => {
    const { page, ctx } = await fresh({ width: 1440, height: 900 });
    await build(page);
    const full = await page.evaluate(() => ({ h: document.getElementById('pad0').getBoundingClientRect().height, cols: [...document.querySelectorAll('#padsGrid > .pad')].filter(e => Math.abs(e.getBoundingClientRect().top - document.getElementById('pad0').getBoundingClientRect().top) < 2).length }));
    await page.click('#viewBtn');
    await wait(page, 200);
    const c = await page.evaluate(() => {
      const p = document.getElementById('pad0'), r = p.getBoundingClientRect(), vis = sel => { const e = p.querySelector(sel); return !!e && e.getClientRects().length > 0; };
      return { cls: document.body.classList.contains('compact'), pressed: document.getElementById('viewBtn').getAttribute('aria-pressed'), h: r.height,
        cols: [...document.querySelectorAll('#padsGrid > .pad')].filter(e => Math.abs(e.getBoundingClientRect().top - r.top) < 2).length,
        name: vis('.pad-name'), time: vis('.pad-time'), bar: vis('.pad-progress'), key: vis('.shortcut-key'),
        hidden: ['.pad-footer .btn-sm', '.pad-vol-slider', '.inout-btn', '.transport-pp', '.pad-grip', '.color-dot'].map(vis), timeTxt: p.querySelector('.pad-time').textContent,
        inside: [...p.querySelectorAll('.pad-name, .pad-time, .pad-progress')].every(e => { const b = e.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }) };
    });
    check('the view button switches to compact pads: key, name, length and waveform only — the edit controls are gone',
      c.cls && c.pressed === 'true' && c.name && c.time && c.bar && c.key && c.hidden.every(v => v === false) && c.inside && /^0:0\d$/.test(c.timeTxt), JSON.stringify(c));
    check(`…and many more fit: ${c.cols} columns of ${Math.round(c.h)} px cards instead of ${full.cols} columns of ${Math.round(full.h)} px`, c.cols >= full.cols + 2 && c.h < full.h * 0.45, JSON.stringify({ full, compact: { cols: c.cols, h: c.h } }));
    await page.click('#pad1 .pad-name');
    await wait(page, 400);
    const pl = await page.evaluate(() => ({ on: pads[1].playing, stop: document.querySelector('#pad1 .transport-stop').getClientRects().length > 0, time: document.querySelector('#pad1 .pad-time').textContent }));
    check('clicking a compact pad plays it; it then shows a countdown and a stop button', pl.on && pl.stop && /^−0:0\d$/.test(pl.time), JSON.stringify(pl));
    await page.click('#pad1 .transport-stop');
    check('…and that stop button stops it', (await page.evaluate(() => pads[1].playing)) === false);
    const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('cue-prefs')).compact);
    await page.reload(); await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad'));
    check('the view is remembered on this computer', remembered === true && await page.evaluate(() => document.body.classList.contains('compact')));
    await ctx.close();
  });

  // ══ show name + unsaved mark ══
  await scenario(async () => {
    const { page } = await fresh();
    const a = await page.evaluate(() => ({ name: document.getElementById('showName').textContent, dot: document.getElementById('showDirty').hidden, title: document.title, dirty: showDirty }));
    check('a new show is "Untitled show" with no unsaved mark', a.name === 'Untitled show' && a.dot === true && /^Untitled show — /.test(a.title) && a.dirty === false, JSON.stringify(a));
    await page.evaluate(() => loadFile(0, mkFile('kick.wav')));
    const b = await page.evaluate(() => ({ dot: document.getElementById('showDirty').hidden, title: document.title }));
    check('any change marks it unsaved: a dot in the status bar and in the window title', b.dot === false && /^● /.test(b.title), JSON.stringify(b));
    const c = await page.evaluate(() => { commitProject(parseProjectConfig({ name: 'x', pads: [{ id: 0, name: 'One' }] }), 'Friday night'); return { name: document.getElementById('showName').textContent, notr: document.getElementById('showName').hasAttribute('data-notr'), dot: document.getElementById('showDirty').hidden, title: document.title }; });
    check('opening a show names it and clears the mark (the name is never translated)', c.name === 'Friday night' && c.notr && c.dot === true && /^Friday night — /.test(c.title), JSON.stringify(c));
    const leave = await page.evaluate(() => { const fire = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }; const clean = fire(); setPadVolume(0, 0.5); return { clean, dirty: fire() }; });
    check('in a browser, leaving the page with unsaved changes asks first; with none it does not', leave.clean === false && leave.dirty === true, JSON.stringify(leave));
    const r = await page.evaluate(() => { saveAutosave(); restoreSessionData(JSON.parse(localStorage.getItem('cue-autosave'))); return showDirty; });
    check('a restored session counts as unsaved (it exists nowhere else yet)', r === true);
    await page.close();
  });

  // ══ volume above 100 % ══
  await scenario(async () => {
    const { page, errors } = await fresh();
    await page.evaluate(async () => { loadFile(0, mkTone('quiet.wav'), true); loadFile(1, mkFile('other.wav'), true); await new Promise(r => setTimeout(r, 450)); });
    const base = await page.evaluate(() => ({ gain: !!pads[0].gain, ctx: !!boostCtx, pos: +document.getElementById('pvol-0').value, max: +document.getElementById('pvol-0').max }));
    check('at 100 % or below a pad plays the plain way (no Web Audio path); the slider keeps 100 % at four fifths of its travel', !base.gain && !base.ctx && base.pos === 1 && base.max === 1.25, JSON.stringify(base));
    const up = await page.evaluate(() => { const s = document.getElementById('pvol-0'); s.value = 1.125; s.dispatchEvent(new Event('input', { bubbles: true })); return { vol: pads[0].vol, pct: document.getElementById('pvol-pct-0').textContent, boostCls: document.getElementById('pvol-pct-0').classList.contains('boost'), gain: pads[0].gain?.gain.value, el: pads[0].audio.volume, routed: !!pads[0].audio._boosted, other: !!pads[1].gain }; });
    check('pushing the slider past the notch boosts: 150 % = the element at full plus a gain of 1.5 — for that pad only', up.vol === 1.5 && up.pct === '150%' && up.boostCls && up.gain === 1.5 && up.el === 1 && up.routed && !up.other, JSON.stringify(up));
    const snap = await page.evaluate(() => { const s = document.getElementById('pvol-0'); s.value = 1.008; s.dispatchEvent(new Event('input', { bubbles: true })); return { vol: pads[0].vol, pos: +s.value, gain: pads[0].gain?.gain.value }; });
    check('the slider snaps to exactly 100 % near the notch, and the gain goes back to 1', snap.vol === 1 && snap.pos === 1 && snap.gain === 1, JSON.stringify(snap));
    const fade = await page.evaluate(async () => { setPadVolume(0, 2); fadeDuration = 0.4; masterVol = 0.5; playPad(0, true); await new Promise(r => setTimeout(r, 200)); const mid = pads[0].audio.volume; await new Promise(r => setTimeout(r, 450)); return { mid, end: pads[0].audio.volume, gain: pads[0].gain.gain.value, state: boostCtx.state }; });
    check('fades and the master volume still work on a boosted pad (the element fades 0 → master; the gain stays put)', fade.mid > 0.05 && fade.mid < 0.45 && Math.abs(fade.end - 0.5) < 0.02 && fade.gain === 2 && fade.state === 'running', JSON.stringify(fade));
    const io = await page.evaluate(() => { stopAll('cut'); saveAutosave(); const a = JSON.parse(localStorage.getItem('cue-autosave')); return { saved: a.pads[0].vol, back: parseProjectConfig(a).pads[0].vol, clamp: parseProjectConfig({ pads: [{ id: 0, vol: 9 }] }).pads[0].vol, set: (setPadVolume(1, 99), pads[1].vol), nan: (setPadVolume(1, 'abc'), pads[1].vol) }; });
    check('the boost is saved with the show; 200 % is the ceiling everywhere', io.saved === 2 && io.back === 2 && io.clamp === 2 && io.set === 2 && io.nan === 1, JSON.stringify(io));
    const rep = await page.evaluate(async () => { setPadVolume(0, 1.5); loadFile(0, mkTone('new.wav'), true); await new Promise(r => setTimeout(r, 300)); return { gain: pads[0].gain?.gain.value, routed: !!pads[0].audio._boosted }; });
    check('replacing the sound of a boosted pad keeps it boosted (the new element joins the gain)', rep.gain === 1.5 && rep.routed, JSON.stringify(rep));
    const chk = await page.evaluate(async () => { setPadVolume(0, 2); const r = await runPreShowCheck(); return r.items.filter(i => /boosted to 200%/.test(i.text)).length; });
    check('the pre-show check warns when a boosted pad will distort at its loudest point', chk === 1, String(chk));
    const noSink = await page.evaluate(() => { const AC = window.AudioContext; const had = AC.prototype.setSinkId; delete AC.prototype.setSinkId; prefs.outputId = 'usb'; const can = canBoost(); if (had) AC.prototype.setSinkId = had; const can2 = canBoost(); prefs.outputId = ''; return { can, can2: can2 === !!had || can2 === true }; });
    check('with an output device chosen, boost is only used when it can be sent to that same device (never out of the wrong speakers)', noSink.can === false, JSON.stringify(noSink));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ══ headphone preview ══
  await scenario(async () => {
    const { page, errors } = await fresh();
    await build(page);
    const none = await page.evaluate(() => document.querySelectorAll('.transport-pre').length);
    const r = await page.evaluate(async () => {
      const sinks = []; HTMLMediaElement.prototype.setSinkId = function (id) { sinks.push(id); return id === 'bad' ? Promise.reject(new Error('NotFound')) : Promise.resolve(); };
      setPreviewDevice('phones');
      const btns = document.querySelectorAll('.transport-pre').length;
      pads[0].inPoint = 2; pads[0].vol = 0.6;
      document.querySelector('#pad0 [data-action="preview"]').click();
      await new Promise(r => setTimeout(r, 400));
      const during = { sink: sinks[sinks.length - 1], playing: !!preview && !preview.audio.paused, sameEl: preview?.audio === pads[0].audio, padPlaying: pads[0].playing, t: preview?.audio.currentTime, vol: preview?.audio.volume, on: document.querySelector('#pad0 .transport-pre').classList.contains('on') };
      playPad(1);                                                           // the show goes on: the preview is not part of it
      const stillPreviewing = !!preview;
      document.querySelector('#pad0 [data-action="preview"]').click();
      const toggledOff = preview === null;
      document.querySelector('#pad2 [data-action="preview"]').click();
      await new Promise(r => setTimeout(r, 150));
      const second = preview?.padId;
      stopAll('cut');
      const afterStop = preview;
      prefs.previewId = 'bad'; document.querySelector('#pad0 [data-action="preview"]').click();
      await new Promise(r => setTimeout(r, 100));
      const bad = { preview, status: document.getElementById('statusTxt').textContent };
      setPreviewDevice('');
      return { btns, during, stillPreviewing, toggledOff, second, afterStop, bad, gone: document.querySelectorAll('.transport-pre').length, saved: JSON.parse(localStorage.getItem('cue-prefs')).previewId };
    });
    check('no preview buttons until a preview output is chosen in Settings; then every loaded pad has one', none === 0 && r.btns >= 6 && r.gone === 0 && r.saved === '', JSON.stringify({ none, btns: r.btns, gone: r.gone }));
    check('preview plays the sound on the preview device only: its own element, from the IN point, at the pad\'s volume — the pad itself is untouched',
      r.during.sink === 'phones' && r.during.playing && !r.during.sameEl && !r.during.padPlaying && r.during.t >= 2 && r.during.t < 3 && Math.abs(r.during.vol - 0.6) < 0.01 && r.during.on, JSON.stringify(r.during));
    check('starting pads does not stop a preview; the button toggles it off; one preview at a time; STOP ALL / Esc stop it', r.stillPreviewing && r.toggledOff && r.second === 2 && r.afterStop === null, JSON.stringify(r));
    check('if the preview device has gone, nothing plays and the operator is told', r.bad.preview === null && /preview output is not available/.test(r.bad.status), JSON.stringify(r.bad));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ══ layout: columns, the FADE box, the iPad colour swatch, the GO button, the cue list width ══
  for (const [w, h, wantCols] of [[960, 720, 2], [1280, 800, 3], [1920, 1080, 4], [2560, 1440, 6]]) {
    await scenario(async () => {
      const { page, ctx } = await fresh({ width: w, height: h });
      await build(page);
      const r = await page.evaluate(() => {
        const top = document.getElementById('pad0').getBoundingClientRect().top;
        const btn = document.querySelector('#pad0 [data-action="fade-toggle"]').getBoundingClientRect(), box = document.querySelector('#pad0 .pad-fade').getBoundingClientRect();
        const kids = [...document.querySelector('#pad0 .pad-footer').children];
        return { cols: [...document.querySelectorAll('#padsGrid > .pad')].filter(e => Math.abs(e.getBoundingClientRect().top - top) < 2).length, card: Math.round(document.getElementById('pad0').getBoundingClientRect().width),
                 fade: [Math.round(btn.height), Math.round(box.height), Math.round(btn.top), Math.round(box.top)], rows: new Set(kids.map(c => Math.round(c.getBoundingClientRect().top))).size, chips: kids.length };
      });
      check(`${w}×${h}: ${wantCols} pad columns (cards ${r.card} px), the FADE time box is exactly as tall as its button, and the five chips sit on one line`,
        r.cols === wantCols && r.card >= 300 && r.fade[0] === r.fade[1] && r.fade[2] === r.fade[3] && r.rows === 1 && r.chips === 5, JSON.stringify(r));
      await ctx.close();
    });
  }
  await scenario(async () => {
    const { page, ctx } = await fresh({ width: 1024, height: 768, touch: true });
    await build(page);
    const r = await page.evaluate(() => {
      const d = document.querySelector('#pad0 .color-dot'), cs = getComputedStyle(d), box = d.getBoundingClientRect();
      const fill = box.width - 2 * parseFloat(cs.paddingLeft) - 2 * parseFloat(cs.borderLeftWidth);
      const kids = [...document.querySelector('#pad0 .pad-footer').children];
      return { fill, wave: document.getElementById('pad0').classList.contains('has-wave'), pref: prefs.waveform, rows: new Set(kids.map(c => Math.round(c.getBoundingClientRect().top))).size,
               next: document.getElementById('nextBtn').getBoundingClientRect().width, play: document.getElementById('playCueBtn').getBoundingClientRect().width };
    });
    check('iPad: the pad colour swatch has colour in it again (it had 8 px padding inside an 18 px box)', r.fill >= 8, JSON.stringify(r));
    check('iPad: waveforms are drawn on a touch screen too, and the chip row is one line', r.wave && r.pref === true && r.rows === 1, JSON.stringify(r));
    check('iPad: NEXT CUE is the big button, STOP / PLAY CUE the small one', r.next > r.play * 1.6, JSON.stringify(r));
    await ctx.close();
  });
  // The chip row must not depend on one font's letter widths. The UI is drawn in the system font, and that is a different font on every
  // platform: DejaVu Sans (the Linux default, and what the CI machine uses) is about 11 % wider than Inter / San Francisco / Segoe UI, and
  // with it the five chips wrapped to two lines on an iPad-sized screen. So: every standard screen in this machine's own font, and — where
  // DejaVu Sans is installed — the same screens plus the two tightest window widths (the narrowest card that still shows words) in that font.
  await scenario(async () => {
    const SIZES = { touch: [[1024, 768], [1366, 1024], [1180, 820], [768, 1024]], mouse: [[960, 720], [1280, 800], [1600, 900], [1920, 1080]] };
    const TIGHTEST = { touch: [[1012, 800]], mouse: [[1560, 900]] };
    const measure = () => {
      const f = document.querySelector('#pad1 .pad-footer'), kids = [...f.children], inp = f.querySelector('.pad-fade');
      const used = kids.reduce((n, c) => n + c.getBoundingClientRect().width, 0);
      return { w: innerWidth, card: Math.round(document.getElementById('pad1').getBoundingClientRect().width), chips: kids.length,
               rows: new Set(kids.map(c => Math.round(c.getBoundingClientRect().top))).size,
               spare: Math.round(f.getBoundingClientRect().width - used - (kids.length - 1) * parseFloat(getComputedStyle(f).columnGap)),
               words: getComputedStyle(f.querySelector('[data-action="loop"] .cl')).display !== 'none', fits: inp.scrollWidth <= inp.clientWidth };
    };
    // a font is installed if text set in it measures differently from the generic fallbacks
    const installed = name => {
      const c = document.createElement('canvas').getContext('2d'), w = f => { c.font = '72px ' + f; return c.measureText('mmmmmmmmmmlliWW@').width; };
      return w(`"${name}", monospace`) !== w('monospace') || w(`"${name}", serif`) !== w('serif');
    };
    const own = [], wide = []; let hasWide = true;
    for (const kind of ['touch', 'mouse']) {
      const { page, ctx } = await fresh({ touch: kind === 'touch' });
      await build(page);
      await page.evaluate(async () => { pads[1].fade = 10.5; pads[1].fadeEnabled = true; pads[1].overlap = true; buildPads(); await new Promise(r => setTimeout(r, 100)); });
      const run = async (sizes, into) => {
        for (const [w, h] of sizes) {
          await page.setViewportSize({ width: w, height: h });
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          into.push({ kind, ...await page.evaluate(measure) });
        }
      };
      await run(SIZES[kind], own);
      if (await page.evaluate(installed, 'DejaVu Sans')) {
        await page.addStyleTag({ content: '*, *::before, *::after { font-family: "DejaVu Sans" !important; }' });
        await run([...SIZES[kind], ...TIGHTEST[kind]], wide);
      } else hasWide = false;
      await ctx.close();
    }
    const oneLine = a => a.length > 0 && a.every(r => r.rows === 1 && r.chips === 5 && r.words && r.fits);
    const brief = a => JSON.stringify(a.map(r => `${r.kind} ${r.w}: card ${r.card}, rows ${r.rows}, ${r.spare} px spare`));
    check('the five chips keep their words and sit on one line on every standard screen (iPad 1024 / 1180 / 1366 and portrait, laptop 960 – 1920), in this machine\'s font',
      oneLine(own), brief(own));
    check(hasWide ? '…and in a font about 11 % wider (DejaVu Sans, the Linux default), also at the two tightest window widths — with a few pixels still to spare'
                  : '…(the wide-font run needs DejaVu Sans, which is not installed on this machine — not run here; the CI machine has it)',
      !hasWide || (oneLine(wide) && Math.min(...wide.map(r => r.spare)) >= 4), brief(wide));
  });
  await scenario(async () => {
    const { page, ctx } = await fresh({ width: 1440, height: 900 });
    await build(page);
    const g = await page.evaluate(() => { nextCue(); const n = document.getElementById('nextBtn').getBoundingClientRect(), p = document.getElementById('playCueBtn').getBoundingClientRect(), cs = getComputedStyle(document.getElementById('nextBtn')), ps = getComputedStyle(document.getElementById('playCueBtn'));
      return { nh: n.height, ph: p.height, above: n.top < p.top, nextFilled: cs.backgroundColor !== 'rgba(0, 0, 0, 0)', stopFilled: ps.backgroundColor !== 'rgba(0, 0, 0, 0)', stopTxt: document.getElementById('playCueBtn').textContent }; });
    check('NEXT CUE is the GO button: on top, filled, about twice the height of STOP CUE — which is now a quiet outline even while a cue plays', g.above && g.nh >= g.ph * 1.7 && g.nextFilled && !g.stopFilled && /STOP CUE/.test(g.stopTxt), JSON.stringify(g));
    // the running cue's name is not cut off by row buttons
    const nm = await page.evaluate(() => { const row = document.querySelector('#stackList .stack-item.active'), l = row.querySelector('.stack-lbl'); return { cut: l.scrollWidth > l.clientWidth + 1, btns: [...row.querySelectorAll('.stack-mv, .stack-rm, .stack-ed')].filter(e => e.getClientRects().length).length }; });
    check('the running cue shows its whole name: the row buttons only appear when the pointer is on the row', !nm.cut && nm.btns === 0, JSON.stringify(nm));
    // drag the edge of the cue list
    const before = await page.evaluate(() => document.getElementById('stackPanel').getBoundingClientRect().width);
    const hb = await page.locator('#stackResize').boundingBox();
    await page.mouse.move(hb.x + 3, hb.y + 200); await page.mouse.down(); await page.mouse.move(hb.x - 140, hb.y + 210, { steps: 6 }); await page.mouse.up();
    const after = await page.evaluate(() => ({ w: document.getElementById('stackPanel').getBoundingClientRect().width, saved: JSON.parse(localStorage.getItem('cue-prefs')).stackW, grid: document.getElementById('padsGrid').getBoundingClientRect().right, panel: document.getElementById('stackPanel').getBoundingClientRect().left }));
    check('dragging the left edge of the cue list makes it wider; the pads make room; the width is remembered', Math.abs(after.w - (before + 143)) < 6 && Math.abs(after.saved - after.w) < 2 && after.grid <= after.panel, JSON.stringify({ before, after }));
    await page.dblclick('#stackResize');
    const reset = await page.evaluate(() => ({ w: document.getElementById('stackPanel').getBoundingClientRect().width, saved: JSON.parse(localStorage.getItem('cue-prefs')).stackW }));
    check('double-clicking the edge goes back to the automatic width', Math.abs(reset.w - before) < 2 && reset.saved === 0, JSON.stringify(reset));
    await ctx.close();
  });

  await browser.close();
  t.finish();
})();
