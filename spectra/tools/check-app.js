// Run: node spectra/tools/check-app.js
// Exercise the real app handlers in a minimal DOM. This does not verify browser rendering.
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const O = require('../optics.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
class Element {
  constructor(id = '') { this.id = id; this.listeners = {}; this.children = []; this.dataset = {}; this.checked = false; this.value = ''; this.attributes = {}; this.firstChild = { textContent: '' }; this.classList = { add() {}, remove() {}, toggle() {} }; this.tagName = 'BUTTON'; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type, extra = {}) { return Promise.all((this.listeners[type] || []).map(fn => fn({ target: this, preventDefault() {}, ...extra }))); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  append(e) { this.children.push(e); }
  replaceChildren() { this.children = []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 760 }; }
  setPointerCapture() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function boot({ hash = '', saved = null } = {}) {
  const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element(m[1])]));
  const add = ['prism', 'lens', 'mirror'].map(type => Object.assign(new Element(), { dataset: { add: type } }));
  const presets = ['prism', 'focus', 'fold', 'internal'].map(preset => Object.assign(new Element(), { dataset: { preset } }));
  const win = new Element(), doc = new Element(), store = new Map(), copied = [];
  if (saved !== null) store.set('spectra.bench.v1', saved);
  const location = { origin: 'https://example.test', pathname: '/spectra/', search: '', hash };
  doc.getElementById = id => ids[id];
  doc.querySelectorAll = selector => selector === '[data-preset]' ? presets : add;
  doc.createElement = tag => Object.assign(new Element(), { tagName: tag.toUpperCase() });
  doc.activeElement = { tagName: 'BODY' };
  ids.bench.tagName = 'CANVAS'; ids.bench.focus = () => doc.activeElement = ids.bench;
  ids.bench.getContext = () => ({});
  const timer = new Map(); let nextTimer = 1;
  const context = { window: win, document: doc, location, navigator: { clipboard: { writeText: async text => copied.push(text) } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    matchMedia: () => ({ matches: false }), devicePixelRatio: 1, ResizeObserver: class { observe() {} },
    requestAnimationFrame: () => 1, setTimeout: fn => { const id = nextTimer++; timer.set(id, fn); return id; }, clearTimeout: id => timer.delete(id),
    atob: str => Buffer.from(str, 'base64').toString('binary'), btoa: str => Buffer.from(str, 'binary').toString('base64'), console, URL };
  win.SpectraOptics = O;
  win.history = { replaceState: (_a, _b, url) => { const u = new URL(url, location.origin + location.pathname); location.hash = u.hash; location.pathname = u.pathname; location.search = u.search; } };
  vm.runInNewContext(source, context, { filename: 'spectra/app.js' });
  return { ids, add, presets, win, doc, store, location, copied,
    state() { win.fire('pagehide'); return JSON.parse(store.get('spectra.bench.v1')); },
    click: id => ids[id].fire('click'),
    input(id, value) { ids[id].value = value; return ids[id].fire('input'); },
    change: id => ids[id].fire('change'),
    pointer(type, x, y, extra = {}) { return ids.bench.fire(type, { clientX: x, clientY: y, pointerId: 1, button: 0, ...extra }); }
  };
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('ok   ' + name); }
async function main() {
  await check('all four composed experiments load and trace without truncation', async () => {
    const app = boot();
    for (const preset of app.presets) {
      await preset.fire('click'); const s = app.state();
      assert.equal(s.preset, preset.dataset.preset);
      const t = O.trace(s.objects, s.source, { rays: 13, dispersion: s.dispersion, reflections: s.reflections });
      assert.equal(t.truncated, false); assert.ok(t.segments.length > 20);
      if (s.preset === 'prism') assert.equal(t.events.filter(e => e.type === 'tir').length, 0);
      if (s.preset === 'fold') assert.equal(t.events.filter(e => e.type === 'mirror').length, 39);
      if (s.preset === 'internal') assert.ok(t.events.some(e => e.type === 'tir'), 'the glass-held preset must visibly demonstrate total internal reflection');
    }
  });
  await check('a slider gesture is one undo step and source modes undo correctly', async () => {
    const app = boot(), before = app.state();
    await app.input('width', 40); await app.input('width', 90); await app.change('width');
    assert.equal(app.state().source.width, 90);
    await app.click('undo'); assert.deepEqual(app.state(), before);
    await app.click('mono'); assert.equal(app.state().source.color, 'mono');
    await app.click('undo'); assert.equal(app.state().source.color, 'white');
  });
  await check('add/remove, empty bench selection, reset and undo preserve an editable scene', async () => {
    const app = boot(); await app.click('remove'); assert.equal(app.state().objects.length, 0);
    assert.equal(app.ids.remove.disabled, true);
    await app.input('angle', 25); await app.change('angle');
    assert.ok(Math.abs(app.state().source.angle - 25 * Math.PI / 180) < 1e-9);
    await app.add[1].fire('click'); assert.equal(app.state().objects[0].type, 'lens');
    await app.click('undo'); assert.equal(app.state().objects.length, 0);
    await app.click('reset'); assert.equal(app.state().objects[0].type, 'prism');
    for (let i = 0; i < 20; i++) await app.add[0].fire('click');
    assert.equal(app.state().objects.length, 12); assert.ok(app.add.every(b => b.disabled));
  });
  await check('dragging, rotation handles, keyboard movement and their undo use the real handlers', async () => {
    const app = boot(), initial = app.state().objects[0];
    await app.pointer('pointerdown', initial.x, initial.y);
    await app.pointer('pointermove', initial.x + 35, initial.y + 20);
    await app.pointer('pointerup', initial.x + 35, initial.y + 20);
    assert.equal(app.state().objects[0].x, initial.x + 35); assert.equal(app.state().objects[0].y, initial.y + 20);
    await app.click('undo'); assert.deepEqual(app.state().objects[0], initial);
    const radius = 110 * initial.size + 39;
    await app.pointer('pointerdown', initial.x + Math.sin(initial.angle) * radius, initial.y - Math.cos(initial.angle) * radius);
    await app.pointer('pointermove', initial.x + radius, initial.y);
    await app.pointer('pointerup', initial.x + radius, initial.y);
    assert.ok(Math.abs(app.state().objects[0].angle - Math.PI / 2) < 1e-9);
    await app.win.fire('keydown', { key: 'ArrowRight' }); assert.equal(app.state().objects[0].x, initial.x + 8);
    await app.win.fire('keydown', { key: 'ArrowDown', shiftKey: true });
    assert.ok(Math.abs(app.state().objects[0].angle - (Math.PI / 2 + 2 * Math.PI / 180)) < 1e-9);
    await app.win.fire('keydown', { key: 'z', ctrlKey: true });
    assert.ok(Math.abs(app.state().objects[0].angle - Math.PI / 2) < 1e-9);
  });
  await check('share URL and local persistence round-trip every arrangement field', async () => {
    const app = boot(); await app.presets[2].fire('click'); await app.add[0].fire('click');
    await app.input('dispersion', 2.3); await app.change('dispersion');
    app.ids.normals.checked = true; await app.change('normals');
    await app.click('share'); assert.equal(app.copied.length, 1);
    assert.ok(app.location.hash.startsWith('#s='));
    const expected = app.state(), shared = boot({ hash: app.location.hash });
    assert.deepEqual(shared.state(), expected);
    const restored = boot({ saved: JSON.stringify(expected) }); assert.deepEqual(restored.state(), expected);
    await app.input('width', 40); assert.equal(app.location.hash, '');
  });
  await check('a second pointer cannot steal, move, or end the active drag', async () => {
    const app = boot(), before = app.state(), optic = before.objects[0];
    await app.pointer('pointerdown', optic.x, optic.y, { pointerId: 7 });
    // A second finger touches the source while the first is holding the prism.
    await app.pointer('pointerdown', before.source.x, before.source.y, { pointerId: 9 });
    await app.pointer('pointermove', before.source.x + 100, before.source.y + 80, { pointerId: 9 });
    assert.deepEqual(app.state(), before, 'the second pointer must neither move nor select another object');
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) await app.pointer(type, 0, 0, { pointerId: 9 });
    await app.pointer('pointermove', optic.x + 35, optic.y + 20, { pointerId: 7 });
    assert.equal(app.state().objects[0].x, optic.x + 35);
    assert.equal(app.state().objects[0].y, optic.y + 20);
    assert.deepEqual(app.state().source, before.source);
    await app.pointer('pointercancel', optic.x + 35, optic.y + 20, { pointerId: 7 });
    // Cancellation commits one undoable gesture; later movements do nothing.
    await app.pointer('pointermove', optic.x + 80, optic.y + 60, { pointerId: 7 });
    assert.equal(app.state().objects[0].x, optic.x + 35);
    await app.click('undo'); assert.deepEqual(app.state(), before);
  });
  await check('starting a beam sweep clears an obsolete shared URL and remains undoable', async () => {
    const app = boot(), before = app.state();
    await app.click('share'); assert.ok(app.location.hash.startsWith('#s='));
    app.ids.sweep.checked = true; await app.change('sweep');
    assert.equal(app.location.hash, '');
    assert.equal(app.ids.undo.disabled, false);
    await app.click('undo'); assert.equal(app.ids.sweep.checked, false);
    assert.deepEqual(app.state(), before);
  });
  await check('malformed state cannot break startup and only known fields survive validation', async () => {
    for (const saved of ['{', 'null', JSON.stringify({ version: 1, preset: 'prism', objects: [] })]) assert.equal(boot({ saved }).state().preset, 'prism');
    assert.equal(boot({ hash: '#s=not-a-scene' }).state().preset, 'prism');
    const app = boot(), s = app.state(); s.name = '<script>bad()</script>'; s.surprise = true;
    const sanitized = boot({ saved: JSON.stringify(s) }).state();
    assert.equal(sanitized.name, 'First light'); assert.equal(sanitized.surprise, undefined);
    s.source.x = Infinity;
    assert.equal(boot({ saved: JSON.stringify(s) }).state().source.x, 130);
  });
  console.log(`${passed} application checks passed. Rendering, real DOM behavior and clipboard permissions require a browser.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
