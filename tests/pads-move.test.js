// Moving pads: drag a pad's grip (or the card, with a mouse) onto another pad and the two swap places. Only the screen order changes —
// each pad keeps its id, key, colour, sound and cues. Real Chromium via Playwright, real mouse events; saved with the show; undoable.
const { chromium } = require('playwright');
const { INDEX, wavBytes, reporter } = require('./helpers');

const t = reporter('pads-move');
const { check } = t;
let scenarioNo = 0;
async function scenario(fn) {
  scenarioNo++;
  try { await fn(); }
  catch (e) { check(`scenario #${scenarioNo} threw`, false, String(e.message).split('\n')[0]); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wav = wavBytes(6);

  async function fresh({ width = 1280, height = 800 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.addInitScript(bytes => { window.mkFile = (n = 'a.wav') => new File([new Uint8Array(bytes)], n, { type: 'audio/wav' }); }, wav);
    await page.goto('file://' + INDEX);
    await page.waitForFunction(() => typeof pads !== 'undefined' && document.querySelector('.pad') && typeof movePad === 'function');
    await page.evaluate(() => { document.getElementById('tipsStrip').hidden = true; });
    return { page, ctx, errors };
  }
  // four named sounds on pads 0–3, a cue for each
  const build = page => page.evaluate(() => {
    ['Thunder', 'Rain', 'Door slam', 'Applause'].forEach((n, i) => { loadFile(i, mkFile(n + '.wav'), true); pads[i].name = n; refreshPad(i); });
    [0, 1, 2, 3].forEach(i => addToStack(i));
  });
  const domOrder = page => page.evaluate(() => [...document.querySelectorAll('#padsGrid > .pad')].map(e => +e.id.slice(3)));
  const order = page => page.evaluate(() => [...padOrder]);
  const box = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  async function drag(page, from, to, { steps = 8, release = true } = {}) {
    const a = await box(page, from), z = typeof to === 'string' ? await box(page, to) : to;
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps });
    await page.mouse.move(z.x, z.y, { steps });
    if (release) await page.mouse.up();
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ── 1. dragging the grip onto another pad swaps their places; nothing else about either pad changes
  await scenario(async () => {
    const { page, errors } = await fresh();
    await build(page);
    const before = await page.evaluate(() => pads.map(p => ({ id: p.id, key: p.key, color: p.color, name: p.name })));
    await drag(page, '#pad0 .pad-grip', '#pad3');
    const dom = await domOrder(page), ord = await order(page);
    check('drag the grip of pad 1 onto pad 4: the two swap places on screen (and in the saved order)', same(dom.slice(0, 4), [3, 1, 2, 0]) && same(ord.slice(0, 4), [3, 1, 2, 0]), JSON.stringify({ dom, ord }));
    const after = await page.evaluate(() => pads.map(p => ({ id: p.id, key: p.key, color: p.color, name: p.name })));
    check('…each pad keeps its id, key, colour and name (the key goes with the pad)', same(before, after), JSON.stringify({ before: before.slice(0, 4), after: after.slice(0, 4) }));
    const keysOnScreen = await page.evaluate(() => [...document.querySelectorAll('#padsGrid > .pad .shortcut-key')].slice(0, 4).map(e => e.textContent));
    check('…so the keys now read 4, 2, 3, 1 across the top row', same(keysOnScreen, ['4', '2', '3', '1']), JSON.stringify(keysOnScreen));
    const stack = await page.evaluate(() => getScene().stack.map(i => i.padId));
    check('the cue list still points at the same sounds (cues follow the sound, not the place)', same(stack, [0, 1, 2, 3]), JSON.stringify(stack));
    const st = await page.evaluate(() => ({ playing: pads.some(p => p.playing), toast: !document.getElementById('toast').hidden }));
    check('releasing the drag does not also click the pad underneath (nothing started playing)', !st.playing, JSON.stringify(st));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  });

  // ── 2. the card itself can be dragged with a mouse, but a plain click still plays it and a small wobble is not a drag
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    const c0 = await box(page, '#pad0 .pad-time');                   // the countdown text: nothing interactive
    await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.mouse.move(c0.x + 4, c0.y + 3, { steps: 3 }); await page.mouse.up();
    check('a 5 px wobble while clicking is not a drag — the click still plays the pad', same((await order(page)).slice(0, 4), [0, 1, 2, 3]) && await page.evaluate(() => pads[0].playing), '');
    await page.evaluate(() => stopAll('cut'));
    await page.mouse.click(c0.x, c0.y);                               // a plain click on the card body plays it (unchanged behaviour)
    check('a plain click on the card still plays the pad', await page.evaluate(() => pads[0].playing), '');
    await page.evaluate(() => stopAll('cut'));
    await drag(page, '#pad1 .pad-time', '#pad2');
    check('dragging the card by a blank spot (mouse) swaps it with the pad it is dropped on', same((await domOrder(page)).slice(0, 4), [0, 2, 1, 3]), JSON.stringify(await domOrder(page)));
    check('…and that did not start a sound', !(await page.evaluate(() => pads.some(p => p.playing))));
    // controls are not drag handles: pressing a button / the volume slider / the scrub bar never moves the card
    const before = await order(page);
    await drag(page, '#pad0 [data-action="loop"]', '#pad3');
    await drag(page, '#pad0 .pad-progress', '#pad3');
    await drag(page, '#pad3 .pad-name', '#pad0');
    check('dragging from a button, the scrub bar or the name does not move a card (the name drags into the cue list instead)', same(before, await order(page)), JSON.stringify({ before, now: await order(page) }));
    await page.close();
  });

  // ── 3. a playing pad can be moved without interrupting it
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    await page.evaluate(() => { playPad(0); });
    await page.waitForTimeout(400);
    const t0 = await page.evaluate(() => pads[0].audio.currentTime);
    await drag(page, '#pad0 .pad-grip', '#pad2');
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ playing: pads[0].playing, paused: pads[0].audio.paused, t: pads[0].audio.currentTime, cls: document.getElementById('pad0').classList.contains('playing') }));
    check('moving a pad that is playing: the sound keeps playing without a break, the card stays lit', s.playing && !s.paused && s.t > t0 + 0.3 && s.cls, JSON.stringify({ t0, s }));
    check('…and it moved', same((await domOrder(page)).slice(0, 3), [2, 1, 0]));
    await page.close();
  });

  // ── 4. undo, the toast, locked shows
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    await drag(page, '#pad0 .pad-grip', '#pad1');
    const info = await page.evaluate(() => ({ undo: undoStack.length, label: undoStack[undoStack.length - 1]?.label, toast: document.getElementById('toastMsg')?.textContent || '' }));
    check('a move is one undo step, and the toast says what happened', info.undo === 1 && /Swapped "Thunder" and "Rain"/.test(info.toast), JSON.stringify(info));
    await page.keyboard.press('Control+z');
    check('Ctrl+Z puts the two pads back', same((await domOrder(page)).slice(0, 4), [0, 1, 2, 3]) && same((await order(page)).slice(0, 4), [0, 1, 2, 3]));
    await page.evaluate(() => toggleShowLock());
    await drag(page, '#pad0 .pad-grip', '#pad1');
    check('a locked show refuses to move pads', same((await order(page)).slice(0, 4), [0, 1, 2, 3]) && same((await domOrder(page)).slice(0, 4), [0, 1, 2, 3]));
    await page.evaluate(() => toggleShowLock());
    // moving into an empty pad, and two empty pads
    await drag(page, '#pad0 .pad-grip', '#pad7');
    const toast = await page.evaluate(() => document.getElementById('toastMsg')?.textContent || '');
    check('moving a sound onto an empty pad says so', /Moved "Thunder" to an empty pad/.test(toast), toast);
    check('…and the empty pad took its old place', same((await domOrder(page)).slice(0, 4), [7, 1, 2, 3]) && (await domOrder(page))[7] === 0, JSON.stringify(await domOrder(page)));
    await page.close();
  });

  // ── 5. the keyboard: ← → on the grip
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    await page.focus('#pad1 .pad-grip');
    await page.keyboard.press('ArrowRight');
    const a = await order(page);
    const focused = await page.evaluate(() => document.activeElement?.className + '|' + document.activeElement?.closest('.pad')?.id);
    check('ArrowRight on a pad\'s grip moves it one place on (and keeps the focus on the grip)', same(a.slice(0, 4), [0, 2, 1, 3]) && /pad-grip\|pad1/.test(focused), JSON.stringify({ a, focused }));
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    check('ArrowLeft moves it back, and the first place stops at the edge', same((await order(page)).slice(0, 4), [1, 0, 2, 3]));
    check('the arrow keys never scrolled the page or played anything', !(await page.evaluate(() => pads.some(p => p.playing))));
    await page.close();
  });

  // ── 6. saved with the show: projects, the autosave, the remote's list; damaged data is repaired, old shows keep their order
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    await drag(page, '#pad0 .pad-grip', '#pad3');
    const r = await page.evaluate(() => {
      const raw = { pads: pads.map(p => ({ id: p.id, key: p.key, name: p.name })), padOrder: [...padOrder] };
      saveAutosave();
      const auto = JSON.parse(localStorage.getItem('cue-autosave'));
      const parsed = c => parseProjectConfig(c).padOrder.slice(0, 6);
      const base = { pads: Array.from({ length: 6 }, (_, i) => ({ id: i })) };
      return {
        autosaved: auto.padOrder.slice(0, 4),
        roundTrip: parsed({ ...base, padOrder: raw.padOrder.slice(0, 6) }),
        old: parsed(base),
        garbage: parsed({ ...base, padOrder: [4, 4, 'x', -1, 99, 1.5, null, 2] }),
        notArray: parsed({ ...base, padOrder: 'nope' }),
        short: parsed({ ...base, padOrder: [5] }),
      };
    });
    check('the autosave holds the order', same(r.autosaved, [3, 1, 2, 0]), JSON.stringify(r.autosaved));
    check('a project round-trips its order', same(r.roundTrip, [3, 1, 2, 0, 4, 5]), JSON.stringify(r.roundTrip));
    check('a show saved before this feature (no order) opens in the old order', same(r.old, [0, 1, 2, 3, 4, 5]), JSON.stringify(r.old));
    check('a damaged order (duplicates, strings, out of range, not a list) is repaired: every pad once, nothing invented', same(r.garbage, [4, 2, 0, 1, 3, 5]) && same(r.notArray, [0, 1, 2, 3, 4, 5]) && same(r.short, [5, 0, 1, 2, 3, 4]), JSON.stringify(r));
    // restoring a saved session re-applies it on screen
    const dom = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('cue-autosave'));
      padOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; buildPads();
      restoreSessionData(data);
      return [...document.querySelectorAll('#padsGrid > .pad')].map(e => +e.id.slice(3)).slice(0, 4);
    });
    check('restoring a session puts the tiles back in the saved order on screen', same(dom, [3, 1, 2, 0]), JSON.stringify(dom));
    const remote = await page.evaluate(() => buildRemoteState().pads.map(p => p.id).slice(0, 4));
    check('the phone / Stream Deck remote lists the pads in the same order as the screen', same(remote, [3, 1, 2, 0]), JSON.stringify(remote));
    await page.close();
  });

  // ── 7. things that walk the pads follow the screen: Fill Pads, the "Pad N" numbers in messages
  await scenario(async () => {
    const { page } = await fresh();
    await page.evaluate(() => { loadFile(0, mkFile('a.wav'), true); loadFile(1, mkFile('b.wav'), true); });
    await drag(page, '#pad5 .pad-grip', '#pad2');                       // pad 5 (key 6) now sits in the third place
    const r = await page.evaluate(() => { fillPadsFrom([mkFile('c.wav'), mkFile('d.wav')]); return { ids: pads.filter(p => p.file).map(p => p.id), names: pads.filter(p => p.file).map(p => p.name) }; });
    check('Fill Pads fills the next empty pads in the order they appear on screen (the moved empty pad comes third)', same(r.ids, [0, 1, 3, 5]) || same(r.ids, [0, 1, 5, 3]), JSON.stringify(r));
    check('…first c.wav on the third tile, then d.wav on the fourth', await page.evaluate(() => pads[5].name === 'c' && pads[2].file === null && pads[3].name === 'd'), JSON.stringify(r));
    const label = await page.evaluate(() => { clearPad(5); return undoStack[undoStack.length - 1]?.label; });
    check('"Pad N" in messages is the number of the place the pad is in on screen', /pad 3\b/.test(label), label);
    await page.close();
  });

  // ── 8. touch / pen: the grip drags, the card does not (a finger on a card scrolls the pads)
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    const r = await page.evaluate(() => {
      const fire = (el, type, x, y, pointerType) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, pointerType }));
      const center = el => { const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; };
      const grid = document.getElementById('padsGrid');
      const [tx, ty] = center(document.getElementById('pad2'));
      const body = document.querySelector('#pad1 .pad-time'), grip = document.querySelector('#pad1 .pad-grip');
      const [bx, by] = center(body), [gx, gy] = center(grip);
      fire(body, 'pointerdown', bx, by, 'touch'); fire(grid, 'pointermove', bx + 40, by + 40, 'touch'); fire(grid, 'pointermove', tx, ty, 'touch'); fire(grid, 'pointerup', tx, ty, 'touch');
      const afterBody = [...padOrder].slice(0, 4);
      fire(grip, 'pointerdown', gx, gy, 'touch'); fire(grid, 'pointermove', gx + 20, gy + 20, 'touch'); fire(grid, 'pointermove', tx, ty, 'touch'); fire(grid, 'pointerup', tx, ty, 'touch');
      return { afterBody, afterGrip: [...padOrder].slice(0, 4) };
    });
    check('with a finger the card itself does not drag (it would fight scrolling)', same(r.afterBody, [0, 1, 2, 3]), JSON.stringify(r));
    check('with a finger the grip does drag', same(r.afterGrip, [0, 2, 1, 3]), JSON.stringify(r));
    await page.close();
  });

  // ── 9. zoomed-in pads and a narrow window: the drop still lands on the right tile
  await scenario(async () => {
    const { page } = await fresh({ width: 960, height: 720 });
    await build(page);
    await page.evaluate(() => { padsScale = 1.2; applyScales(); });
    await drag(page, '#pad0 .pad-grip', '#pad3');
    check('at a 960 px window with the pads zoomed to 120 % the drop still lands on the pad under the pointer', same((await domOrder(page)).slice(0, 4), [3, 1, 2, 0]), JSON.stringify(await domOrder(page)));
    const grip = await page.evaluate(() => { const g = document.querySelector('#pad0 .pad-grip').getBoundingClientRect(), p = document.getElementById('pad0').getBoundingClientRect(); return { inside: g.right <= p.right + 0.5 && g.left >= p.left && g.width >= 20 }; });
    check('the grip is fully inside its card at that size', grip.inside, JSON.stringify(grip));
    await page.close();
  });

  // ── 10. an engine without pointer capture (or one that retargets the click): the release still must not click the pad it lands on
  await scenario(async () => {
    const { page } = await fresh();
    await build(page);
    await page.evaluate(() => { Element.prototype.setPointerCapture = () => { throw new Error('not supported'); }; });
    const z = await box(page, '#pad1');
    await drag(page, '#pad0 .pad-grip', { x: z.x, y: z.y + 20 });
    const swapped = await page.evaluate(() => ({ playing: pads.some(p => p.playing), order: padOrder.slice(0, 3) }));
    // picking a card up and putting it back down on itself: press and release land inside the same card, which is where a click would be aimed
    await drag(page, '#pad2 .pad-grip', '#pad2 .pad-time');
    const back = await page.evaluate(() => ({ playing: pads.some(p => p.playing), order: padOrder.slice(0, 3) }));
    check('without pointer capture a drag still swaps, and releasing on a card does not also play it', JSON.stringify(swapped.order) === '[1,0,2]' && !swapped.playing, JSON.stringify(swapped));
    check('…and picking a card up and putting it back on itself changes nothing and does not play it', JSON.stringify(back.order) === '[1,0,2]' && !back.playing, JSON.stringify(back));
    await page.close();
  });

  await browser.close();
  t.finish();
})();
