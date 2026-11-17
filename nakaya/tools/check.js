// Checks Nakaya's model. Run: node nakaya/tools/check.js   (about 20 s; every line should say ok)
"use strict";
const path = require("path");
const SNOW = require(path.join(__dirname, "..", "snow.js"));
let bad = 0;
const ok = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) bad++; };

// 1. The folded lattice stands for every site exactly once.
{
  const R = 40, L = SNOW.lattice(R);
  let total = 0; for (let i = 0; i < L.n; i++) total += L.w[i];
  ok(total === 3 * R * (R + 1) + 1, `orbit sizes add up to the whole lattice (${total} sites stored as ${L.n})`);
  // every full-lattice neighbour pair maps to the folded table's pair for the representative
  let mism = 0;
  for (let i = 0; i < L.n; i++) for (let k = 0; k < 6; k++) {
    const q = L.q[i] + SNOW.DIRS[k][0], r = L.r[i] + SNOW.DIRS[k][1];
    const want = SNOW.hexDist(q, r) > R ? -1 : L.full[(q + R) * L.N + (r + R)];
    if (L.nb[i * 6 + k] !== want) mism++;
  }
  ok(mism === 0, "neighbour table matches the lattice");
}

// 2. Folded run = plain full-lattice run (a separate, unfolded implementation of the same rules).
{
  const R = 36, p = SNOW.climate(-15, 0.8); p.sigma = 0;
  const cr = new SNOW.Crystal({ R }); cr.seed(p);
  const N = 2 * R + 1, idx = (q, r) => (q + R) * N + (r + R), inside = (q, r) => SNOW.hexDist(q, r) <= R;
  const A = new Uint8Array(N * N), B = new Float64Array(N * N), C = new Float64Array(N * N);
  let D = new Float64Array(N * N), D2 = new Float64Array(N * N);
  const cells = []; for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) if (inside(q, r)) { cells.push([q, r]); D[idx(q, r)] = p.rho; }
  A[idx(0, 0)] = 1; C[idx(0, 0)] = 1; D[idx(0, 0)] = 0;
  const nbrs = (q, r) => SNOW.DIRS.map(([dq, dr]) => [q + dq, r + dr]);
  const isFront = (q, r) => !A[idx(q, r)] && nbrs(q, r).some(([a, b]) => inside(a, b) && A[idx(a, b)]);
  for (let t = 0; t < 900; t++) {
    for (const [q, r] of cells) {
      const i = idx(q, r);
      if (A[i]) { D2[i] = 0; continue; }
      let s = D[i];
      for (const [a, b] of nbrs(q, r)) s += !inside(a, b) ? p.rho : A[idx(a, b)] ? D[i] : D[idx(a, b)];
      D2[i] = SNOW.hexDist(q, r) === R ? p.rho : s / 7;
    }
    [D, D2] = [D2, D];
    const front = cells.filter(([q, r]) => isFront(q, r));
    for (const [q, r] of front) { const i = idx(q, r); B[i] += (1 - p.kappa) * D[i]; C[i] += p.kappa * D[i]; D[i] = 0; }
    const join = [];
    for (const [q, r] of front) {
      const i = idx(q, r), na = nbrs(q, r).filter(([a, b]) => inside(a, b) && A[idx(a, b)]).length;
      let go = false;
      if (na >= 4) go = true;
      else if (na === 3) {
        if (B[i] >= 1) go = true;
        else if (B[i] >= p.alpha) { let s = D[i]; for (const [a, b] of nbrs(q, r)) s += inside(a, b) ? D[idx(a, b)] : p.rho; if (s < p.theta) go = true; }
      } else if (B[i] >= p.beta) go = true;
      if (go) join.push(i);
    }
    for (const i of join) { C[i] += B[i]; B[i] = 0; A[i] = 1; }
    for (const [q, r] of cells) if (isFront(q, r)) { const i = idx(q, r); const b = B[i], c = C[i]; B[i] = (1 - p.mu) * b; C[i] = (1 - p.gamma) * c; D[i] += p.mu * b + p.gamma * c; }
    cr.step();
  }
  let aDiff = 0, cErr = 0, dErr = 0, count = 0;
  for (const [q, r] of cells) {
    const k = cr.L.full[idx(q, r)], i = idx(q, r);
    if (A[i] !== cr.a[k]) aDiff++;
    cErr = Math.max(cErr, Math.abs(C[i] - cr.c[k])); dErr = Math.max(dErr, Math.abs(D[i] - cr.d[k]));
    count += A[i];
  }
  ok(aDiff === 0 && cErr < 1e-9 && dErr < 1e-9, `folded model matches the full-lattice reference after 900 steps (${count} sites attached; max differences ${cErr.toExponential(1)}, ${dErr.toExponential(1)})`);
}

// 3. Mass is conserved when the rim is closed and there is no noise.
{
  const cr = new SNOW.Crystal({ R: 60, closed: true }), p = SNOW.climate(-15, 0.9); p.sigma = 0;
  cr.seed(p);
  const m0 = cr.mass();
  for (let t = 0; t < 3000; t++) cr.step();
  const m1 = cr.mass();
  ok(Math.abs(m1 - m0) / m0 < 1e-9 && cr.attachedCount > 100, `mass conserved over 3000 steps in a closed box (relative drift ${(Math.abs(m1 - m0) / m0).toExponential(1)}, ${cr.attachedCount} sites grown)`);
}

// 4. The climate map gives the habits Nakaya's diagram promises.
function hold(T, s, R = 120, max = 40000) {
  const f = new SNOW.Fall({ R, kind: "time", keyframes: SNOW.skyFromWaypoints([[T, s]], max), maxSteps: max });
  while (!f.landed) f.advance(4000);
  const cr = f.cr, hex = 3 * cr.extent * (cr.extent + 1) + 1;
  return { t: cr.t, ext: cr.extent, fill: cr.attachedCount / hex };
}
{
  const plate = hold(-15, 0.05), fern = hold(-15, 1), col = hold(-7, 0.6), warm = hold(-2, 0.1);
  ok(plate.fill > 0.75, `-15 C, dry: a compact plate (fills ${(plate.fill * 100).toFixed(0)}% of its hexagon)`);
  ok(warm.fill > 0.75, `-2 C, dry: a compact plate (fills ${(warm.fill * 100).toFixed(0)}%)`);
  ok(fern.fill < 0.55 && fern.t < plate.t / 4, `-15 C, wet: a dendrite, branched (fills ${(fern.fill * 100).toFixed(0)}%) and fast (${fern.t} steps against ${plate.t})`);
  ok(col.ext < plate.ext * 0.6 || col.t > plate.t, `-7 C: columns seen end-on grow slowly (radius ${col.ext} in ${col.t} steps; plate ${plate.ext} in ${plate.t})`);
  // branching rises steadily with supersaturation at -15
  let prev = 2, mono = true;
  for (const s of [0, 0.25, 0.5, 0.75, 1]) { const r = hold(-15, s, 90); if (r.fill > prev + 0.05) mono = false; prev = r.fill; }
  ok(mono, "at -15 C the crystal gets more branched as the air gets wetter");
}

// 5. Links regrow the same crystal, bit for bit.
function same(a, b) {
  if (a.t !== b.t || a.L.n !== b.L.n) return false;
  for (let i = 0; i < a.L.n; i++) if (a.a[i] !== b.a[i] || a.c[i] !== b.c[i]) return false;
  return true;
}
{
  const live = new SNOW.Fall({ R: 120, kind: "live", seed: 77 });
  const path = [[-15, 0.4], [-14, 0.9], [-6, 0.5], [-16, 0.7], [-2.3, 0.33]];
  let leg = 0;
  while (!live.landed) { live.target = path[Math.min(path.length - 1, Math.floor(live.cr.t / 2000))]; live.advance(400); leg++; }
  const code = live.code(), opts = SNOW.parseCode(code);
  const re = new SNOW.Fall(Object.assign({ R: 120 }, opts));
  while (!re.landed) re.advance(3000);
  ok(same(live.cr, re.cr), `a steered crystal regrows identically from its ${code.length}-character link (${live.cr.t} steps)`);
  const lay = new SNOW.Fall({ R: 120, kind: "layers", seed: 5, waypoints: [[-15, 0.2], [-7, 0.5], [-14.5, 0.95]] });
  while (!lay.landed) lay.advance(1000);
  const lay2 = new SNOW.Fall(Object.assign({ R: 120 }, SNOW.parseCode(lay.code())));
  while (!lay2.landed) lay2.advance(5000);
  ok(same(lay.cr, lay2.cr) && lay.code() === "wAF" + "eI" + "OU" + "dm", `a layered sky regrows identically from "${lay.code()}"`);
  const half = new SNOW.Fall({ R: 120, kind: "layers", seed: 9, waypoints: [[-2, 0.2], [-15, 0.9]] });
  while (half.progress() < 0.4) half.advance(200);
  half.takeOver(-13, 0.15);
  while (!half.landed) half.advance(800);
  const half2 = new SNOW.Fall(Object.assign({ R: 120 }, SNOW.parseCode(half.code())));
  while (!half2.landed) half2.advance(5000);
  ok(same(half.cr, half2.cr) && half.code()[0] === "t", `a preset sky taken over by hand halfway regrows identically ("${half.describe()}")`);
  ok(SNOW.parseCode("zzz") === null && SNOW.parseCode("w") === null && SNOW.parseCode("tAA") === null, "bad links are refused");
  // the shape comparison: a crystal matches itself perfectly and a plate doesn't match a fern
  const f1 = new SNOW.Fall({ R: 100, kind: "layers", waypoints: [[-15, 0.05]] }); while (!f1.landed) f1.advance(4000);
  const f2 = new SNOW.Fall({ R: 100, kind: "layers", waypoints: [[-15, 1]] }); while (!f2.landed) f2.advance(4000);
  const self = SNOW.compare(f2.cr, f2.cr).score, cross = SNOW.compare(f1.cr, f2.cr).score;
  ok(self === 1 && cross < 0.45, `letter score: fern with itself ${self.toFixed(2)}, plate with fern ${cross.toFixed(2)}`);
  // a letter, and replies from right to badly wrong: the score should fall in that order at the ends
  const grow3 = (w) => { const f = new SNOW.Fall({ R: 200, kind: "layers", seed: 7, waypoints: w.map((p) => SNOW.keyframe(p[0], p[1])) }); while (!f.landed) f.advance(8000); return f.cr; };
  const letter = grow3([[-13, 0.15], [-20, 0.6], [-13, 0.95]]);
  const sc = (w) => SNOW.compare(letter, grow3(w));
  const exact = sc([[-13, 0.15], [-20, 0.6], [-13, 0.95]]), core = sc([[-6, 0.5], [-20, 0.6], [-13, 0.95]]);
  const plate = sc([[-15, 0.05], [-15, 0.05], [-15, 0.05]]), swapped = sc([[-13, 0.95], [-20, 0.6], [-13, 0.15]]);
  ok(exact.score === 1 && core.score > plate.score && plate.score > swapped.score - 0.05 && swapped.score < 0.25,
    `letter scores: exact ${exact.score.toFixed(2)}, wrong centre ${core.score.toFixed(2)}, all plate ${plate.score.toFixed(2)}, upside-down sky ${swapped.score.toFixed(2)}`);
}

console.log(bad ? bad + " check(s) failed" : "all passed");
process.exit(bad ? 1 : 0);
