// Run: node spectra/tools/check.js
// Physical invariants and complete ray-path checks, independent of the canvas.
// OpenAI Sol 6.1 / Codex, 17 November 2026.
'use strict';
const assert = require('node:assert/strict');
const O = require('../optics.js');
let checks = 0;
function check(name, run) {
  run(); checks++;
  console.log('ok   ' + name);
}
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const norm = v => Math.hypot(v.x, v.y);
const angle = a => ({ x: Math.cos(a), y: Math.sin(a) });
const normal = { x: -1, y: 0 };
const source = (extra = {}) => ({ x: 90, y: 330, angle: 0, width: 20, color: 'white', ...extra });
const prism = { type: 'prism', x: 470, y: 350, angle: 0.35, size: 1.5 };
const opts = { rays: 1, wavelengths: [550] };
const boundary = p => Math.min(Math.abs(p.x), Math.abs(p.y), Math.abs(p.x - O.W), Math.abs(p.y - O.H)) < 1e-6;

check('Snell law holds across angles, wavelengths, and both directions', () => {
  for (const nm of [400, 550, 700]) for (const n1 of [1, O.index(nm)]) {
    const n2 = n1 === 1 ? O.index(nm) : 1;
    for (let deg = 0; deg < 89; deg++) {
      const d = angle(deg * Math.PI / 180), t = O.refract(d, normal, n1, n2);
      if (n1 * Math.abs(d.y) > n2) assert.equal(t, null);
      else { assert.ok(t); near(norm(t), 1); near(n1 * d.y, n2 * t.y); assert.ok(t.x >= 0); }
    }
  }
  const t = O.refract(angle(Math.PI / 6), normal, 1, 1.5);
  near(Math.asin(t.y) * 180 / Math.PI, 19.47122063449069);
});

check('reflection is an involution and preserves incidence angle and ray length', () => {
  for (let i = 0; i < 100; i++) {
    const d = angle(i * 0.047), n = angle(i * 0.123);
    const r = O.reflect(d, n), rr = O.reflect(r, n);
    near(norm(r), 1); near(rr.x, d.x); near(rr.y, d.y);
    near(r.x * n.x + r.y * n.y, -(d.x * n.x + d.y * n.y));
  }
});

check('Fresnel reflection matches normal incidence and becomes complete above the critical angle', () => {
  for (const n of [1.2, 1.5, 1.8]) {
    near(O.fresnel({ x: 1, y: 0 }, normal, 1, n), ((n - 1) / (n + 1)) ** 2);
    const critical = Math.asin(1 / n);
    assert.ok(O.refract(angle(critical - 1e-5), normal, n, 1));
    assert.equal(O.refract(angle(critical + 1e-5), normal, n, 1), null);
    near(O.fresnel(angle(critical + 1e-5), normal, n, 1), 1);
  }
});

check('dispersion bends violet more than red; disabling it makes every wavelength identical', () => {
  assert.ok(O.index(400) > O.index(550) && O.index(550) > O.index(700));
  near(O.index(400, 0), O.index(700, 0));
  const result = O.trace([prism], source(), { rays: 1, wavelengths: [400, 550, 700] });
  const exits = result.segments.filter(s => s.depth === 2);
  assert.equal(exits.length, 3);
  const slopes = exits.map(s => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x));
  assert.ok(slopes[0] > slopes[1] && slopes[1] > slopes[2]);
  assert.ok(slopes[0] - slopes[2] > 0.06, 'the complete prism path must separate the spectrum');
  const noDispersion = O.trace([prism], source(), { rays: 1, wavelengths: [400, 700], dispersion: 0 });
  const same = noDispersion.segments.filter(s => s.depth === 2);
  near(same[0].b.x, same[1].b.x); near(same[0].b.y, same[1].b.y);
});

check('prism paths enter and leave glass; normal preset transmits and rotated preset internally reflects', () => {
  const t = O.trace([prism], source(), opts);
  assert.deepEqual(t.events.map(e => e.type), ['refraction', 'refraction']);
  near(t.events[0].n1, 1); near(t.events[1].n2, 1);
  near(t.events[0].n2, t.events[1].n1);
  const tir = O.trace([{ ...prism, angle: 0 }], source(), { rays: 1, wavelengths: [400] });
  assert.deepEqual(tir.events.map(e => e.type), ['refraction', 'tir', 'refraction']);
  near(tir.events[1].reflectance, 1);
  near(tir.segments[1].energy, tir.segments[2].energy);
  assert.ok(boundary(tir.segments.at(-1).b));
});

check('all escaped Fresnel branches conserve energy up to the documented branch cutoff', () => {
  const t = O.trace([prism], source(), { rays: 1, wavelengths: [400, 550, 700], reflections: true });
  for (const nm of [400, 550, 700]) {
    const escaped = t.segments.filter(s => s.wavelength === nm && boundary(s.b)).reduce((sum, s) => sum + s.energy, 0);
    assert.ok(escaped <= 1 + 1e-9 && escaped > 0.98, `escaped ${escaped} at ${nm}nm`);
  }
  for (const e of t.events) assert.ok(e.reflectance >= 0 && e.reflectance <= 1);
});

check('a convex lens converges parallel rays near its thick-lens prediction', () => {
  const lens = { type: 'lens', x: 450, y: 380, angle: 0, size: 1 };
  const n = O.index(550), radius = 230, thickness = 2 * (radius - Math.sqrt(radius ** 2 - 110 ** 2));
  const focal = 1 / ((n - 1) * (2 / radius - (n - 1) * thickness / (n * radius ** 2)));
  const backFocal = focal * (1 - (n - 1) * thickness / (n * radius));
  const prediction = lens.x + thickness / 2 + backFocal;
  const crosses = [];
  for (const y of [350, 410]) {
    const t = O.trace([lens], source({ y }), opts);
    assert.equal(t.events.length, 2);
    const s = t.segments.at(-1), slope = (s.b.y - s.a.y) / (s.b.x - s.a.x);
    assert.ok((380 - y) * slope > 0, 'each ray must turn toward the optical axis');
    const cross = s.a.x + (380 - s.a.y) / slope;
    // Faceted surfaces and spherical aberration shift the exact crossing.
    assert.ok(Math.abs(cross - prediction) < 0.12 * backFocal, `${cross} versus ${prediction}`);
    crosses.push(cross);
  }
  near(crosses[0], crosses[1], 1e-6);
});

check('a mirror sends a horizontal ray upward at 45 degrees and loses exactly 4% energy', () => {
  const mirror = { type: 'mirror', x: 500, y: 330, angle: Math.PI / 4, size: 1 };
  const t = O.trace([mirror], source(), opts);
  assert.equal(t.events.length, 1); assert.equal(t.events[0].type, 'mirror');
  assert.equal(t.segments.length, 2);
  near(t.segments[1].energy, 0.96);
  near(t.segments[1].b.x, 500); near(t.segments[1].b.y, 0);
});

check('source inside glass is recognized and an empty bench reaches the boundary', () => {
  const t = O.trace([prism], source({ x: 470, y: 350 }), opts);
  assert.ok(t.events[0].n1 > 1); near(t.events[0].n2, 1);
  const empty = O.trace([], source(), opts);
  assert.equal(empty.segments.length, 1); near(empty.segments[0].b.x, O.W);
  assert.equal(empty.events.length, 0);
  const mono = O.trace([], source({ color: 'mono', wavelength: 612 }), { rays: 1 });
  assert.equal(mono.segments[0].wavelength, 612);
});

check('seeded mixed-object scenes remain finite, bounded, and within the work limit', () => {
  let seed = 20261117;
  const rand = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  let paths = 0;
  for (let i = 0; i < 80; i++) {
    const objects = Array.from({ length: 4 }, (_, j) => ({
      type: ['prism', 'lens', 'mirror'][j % 3], x: 180 + rand() * 840, y: 180 + rand() * 400,
      angle: rand() * Math.PI * 2, size: 0.5 + rand() * 0.7
    }));
    const t = O.trace(objects, source({ x: 30 + rand() * 1140, y: 30 + rand() * 700, angle: rand() * Math.PI * 2, width: 0 }),
      { rays: 1, wavelengths: [400, 550, 700], reflections: true, maxSegments: 2000 });
    assert.ok(t.segments.length <= 2000);
    for (const s of t.segments) {
      for (const p of [s.a, s.b]) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
        assert.ok(p.x >= -0.003 && p.x <= O.W + 0.003 && p.y >= -0.003 && p.y <= O.H + 0.003);
      }
      assert.ok(s.energy > 0 && s.energy <= 1); assert.ok(s.depth < 18);
      assert.ok(Number.isFinite(s.distance));
    }
    paths += t.segments.length;
  }
  assert.ok(paths > 400, `only exercised ${paths} segments`);
  const capped = O.trace([prism], source(), { rays: 11, reflections: true, maxSegments: 10 });
  assert.equal(capped.segments.length, 10); assert.equal(capped.truncated, true);
  const shallow = O.trace([prism], source(), { rays: 1, wavelengths: [550], maxDepth: 1 });
  assert.equal(shallow.segments.length, 1);
});

console.log(`${checks} checks passed.`);
