// Nakaya's snow-crystal model. Loads in the browser (window.SNOW), in a worker (self.SNOW) and in Node.
//
// The crystal grows by Gravner and Griffeath's mesoscopic lattice model ("Modeling snow crystal growth II",
// Physica D 2008), on a hexagonal lattice of radius R. Every site holds:
//   a  attached (part of the crystal) or not
//   b  boundary mass: quasi-liquid layer on a site touching the crystal
//   c  crystal mass (ice) - the thickness we draw
//   d  diffusive mass: vapour
// Each step: vapour diffuses (reflecting off the crystal), boundary sites freeze part of their vapour, a
// boundary site attaches when it has gathered enough mass (less is needed the more crystal it touches),
// boundary mass melts back a little, and the vapour gets a small random kick.
//
// Six-fold symmetry is exact here: only one site of each 12-site orbit is stored (the lattice is folded by
// its rotations and reflections), and a neighbour lookup goes through a table. That makes a radius-260
// lattice cost about as much as a radius-75 one, and it is also the story the page tells: all six arms
// fall through the same sky, so they record the same history.
//
// Determinism: the step uses only + - * / and comparisons, plus an integer PRNG, so the same sky gives the
// same crystal in every browser. `climate()` (temperature and supersaturation -> parameters) is piecewise
// linear for the same reason.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SNOW = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- lattice ----------
  // Axial coordinates (q, r). Directions in a fixed order; folding keeps this order per site.
  var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  function hexDist(q, r) { var s = -q - r; return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)); }

  // The 12 images of (q, r) under the hexagon's symmetry group.
  function images(q, r) {
    var out = [], x = q, z = r, y = -q - r, i, t;
    for (var m = 0; m < 2; m++) {
      var a = x, b = y, c = z;
      if (m === 1) { t = b; b = c; c = t; } // reflection: swap y and z
      for (i = 0; i < 6; i++) {
        out.push([a, c]);
        // rotate 60 degrees: (x, y, z) -> (-z, -x, -y)
        var na = -c, nb = -a, nc = -b; a = na; b = nb; c = nc;
      }
    }
    return out;
  }

  var latticeCache = {};
  // Builds (and caches) the folded lattice for radius R.
  //   n        number of stored (canonical) sites
  //   q, r     coordinates of each stored site
  //   w        orbit size (how many lattice sites each stored site stands for)
  //   nb       6 neighbour indices per stored site (-1 off the lattice)
  //   dist     hex distance from the centre
  //   full     for each full-grid cell ((q+R)*(2R+1) + (r+R)), the stored index, or -1 outside
  function lattice(R) {
    if (latticeCache[R]) return latticeCache[R];
    var N = 2 * R + 1, full = new Int32Array(N * N).fill(-1);
    var qs = [], rs = [], ws = [];
    var q, r, k;
    // First pass: pick a canonical representative for each orbit (the image with the smallest grid index).
    for (q = -R; q <= R; q++) for (r = -R; r <= R; r++) {
      if (hexDist(q, r) > R) continue;
      var im = images(q, r), best = Infinity, bq = 0, br = 0;
      for (k = 0; k < 12; k++) {
        var g = (im[k][0] + R) * N + (im[k][1] + R);
        if (g < best) { best = g; bq = im[k][0]; br = im[k][1]; }
      }
      if (bq === q && br === r) {
        full[(q + R) * N + (r + R)] = qs.length;
        qs.push(q); rs.push(r);
        var seen = {}, cnt = 0;
        for (k = 0; k < 12; k++) { var key = im[k][0] + "," + im[k][1]; if (!seen[key]) { seen[key] = 1; cnt++; } }
        ws.push(cnt);
      }
    }
    // Second pass: every other cell points at its representative's index.
    for (q = -R; q <= R; q++) for (r = -R; r <= R; r++) {
      if (hexDist(q, r) > R) continue;
      var gi = (q + R) * N + (r + R);
      if (full[gi] >= 0) continue;
      var im2 = images(q, r), b2 = Infinity;
      for (k = 0; k < 12; k++) { var g2 = (im2[k][0] + R) * N + (im2[k][1] + R); if (g2 < b2) b2 = g2; }
      full[gi] = full[b2];
    }
    var n = qs.length, nb = new Int32Array(n * 6), dist = new Int32Array(n);
    for (var i = 0; i < n; i++) {
      dist[i] = hexDist(qs[i], rs[i]);
      for (k = 0; k < 6; k++) {
        var nq = qs[i] + DIRS[k][0], nr = rs[i] + DIRS[k][1];
        nb[i * 6 + k] = hexDist(nq, nr) > R ? -1 : full[(nq + R) * N + (nr + R)];
      }
    }
    var L = { R: R, N: N, n: n, q: Int32Array.from(qs), r: Int32Array.from(rs), w: Int32Array.from(ws), nb: nb, dist: dist, full: full };
    latticeCache[R] = L;
    return L;
  }

  // ---------- small deterministic PRNG (mulberry32) ----------
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- the model ----------
  // opts: R (lattice radius), seed, closed (true: no vapour reservoir at the rim; used by the mass check)
  function Crystal(opts) {
    opts = opts || {};
    var L = lattice(opts.R || 200);
    this.L = L;
    this.closed = !!opts.closed;
    this.rand = rng(opts.seed == null ? 1 : opts.seed);
    var n = L.n;
    this.a = new Uint8Array(n);      // attached
    this.b = new Float64Array(n);
    this.c = new Float64Array(n);
    this.d = new Float64Array(n);
    this.d2 = new Float64Array(n);
    this.nA = new Uint8Array(n);     // attached neighbour count (kept up to date)
    this.born = new Float32Array(n); // step at which the site attached (-1 never)
    this.front = [];                 // boundary sites (not attached, at least one attached neighbour)
    this.inFront = new Uint8Array(n);
    this.t = 0;
    this.extent = 0;                 // furthest attached hex distance
    this.attachedCount = 0;          // in lattice sites (weighted by orbit)
    this.p = null;
    this.rho = 0;
    this.born.fill(-1);
  }

  Crystal.prototype.setParams = function (p) {
    // Changing rho rescales the vapour everywhere off the crystal: the crystal has fallen into air that
    // holds a different amount of water. (Waiting for the change to diffuse in from the rim would take
    // far longer than the fall.)
    if (this.p && p.rho !== this.rho && this.rho > 0) {
      var f = p.rho / this.rho, d = this.d, a = this.a;
      for (var i = 0; i < d.length; i++) if (!a[i]) d[i] *= f;
    }
    this.p = p; this.rho = p.rho;
  };

  Crystal.prototype.seed = function (p) {
    this.setParams(p);
    var n = this.L.n;
    for (var i = 0; i < n; i++) { this.d[i] = p.rho; }
    var o = this.idx0;
    this.attach(o);
    this.c[o] = 1; this.d[o] = 0;
  };

  Object.defineProperty(Crystal.prototype, "idx0", { get: function () { var L = this.L; return L.full[L.R * L.N + L.R]; } });

  Crystal.prototype.attach = function (i) {
    var L = this.L, nb = L.nb;
    this.a[i] = 1; this.born[i] = this.t;
    this.attachedCount += L.w[i];
    if (L.dist[i] > this.extent) this.extent = L.dist[i];
    // Neighbour counts: count via the full-lattice neighbours of each neighbour, which the folded table
    // gives directly (a folded neighbour may appear twice; that is correct, by symmetry).
    for (var k = 0; k < 6; k++) {
      var j = nb[i * 6 + k];
      if (j < 0 || this.a[j]) continue;
      if (!this.inFront[j]) { this.inFront[j] = 1; this.front.push(j); }
    }
    this.inFront[i] = 0;
  };

  // Attached-neighbour count of site i, from the table (exact for folded sites).
  Crystal.prototype.countA = function (i) {
    var nb = this.L.nb, a = this.a, n = 0;
    for (var k = 0; k < 6; k++) { var j = nb[i * 6 + k]; if (j >= 0 && a[j]) n++; }
    return n;
  };

  Crystal.prototype.step = function () {
    var L = this.L, n = L.n, nb = L.nb, dist = L.dist, R = L.R;
    var a = this.a, b = this.b, c = this.c, d = this.d, d2 = this.d2, p = this.p;
    var i, k, j, s;
    // 1. diffusion (off the crystal; attached neighbours reflect: they count as the site itself)
    for (i = 0; i < n; i++) {
      if (a[i]) { d2[i] = 0; continue; }
      var di = d[i];
      s = di;
      for (k = 0; k < 6; k++) {
        j = nb[i * 6 + k];
        if (j < 0) s += this.closed ? di : this.rho; // rim: closed wall, or the reservoir
        else s += a[j] ? di : d[j];
      }
      d2[i] = s / 7;
    }
    if (!this.closed) for (i = 0; i < n; i++) if (dist[i] === R && !a[i]) d2[i] = this.rho;
    this.d = d2; this.d2 = d; d = this.d;

    // 2. freezing on the boundary
    var front = this.front, kap = p.kappa;
    for (var f = 0; f < front.length; f++) {
      i = front[f];
      var dd = d[i];
      b[i] += (1 - kap) * dd;
      c[i] += kap * dd;
      d[i] = 0;
    }

    // 3. attachment (decided for all boundary sites first, then applied)
    var join = [];
    for (f = 0; f < front.length; f++) {
      i = front[f];
      var na = this.countA(i), bi = b[i], ok = false;
      if (na >= 4) ok = true;
      else if (na === 3) {
        if (bi >= 1) ok = true;
        else if (bi >= p.alpha) {
          s = d[i];
          for (k = 0; k < 6; k++) { j = nb[i * 6 + k]; s += j < 0 ? this.rho : d[j]; }
          if (s < p.theta) ok = true;
        }
      } else if (bi >= p.beta) ok = true;
      if (ok) join.push(i);
    }
    this.t++;
    if (join.length) {
      for (f = 0; f < join.length; f++) {
        i = join[f];
        c[i] += b[i]; b[i] = 0;
        this.attach(i); // pushes newly exposed boundary sites onto the end of this.front
      }
      var keep = [];
      for (f = 0; f < this.front.length; f++) if (!a[this.front[f]]) keep.push(this.front[f]);
      this.front = keep;
      front = keep;
    }

    // 4. melting on the boundary
    var mu = p.mu, gam = p.gamma;
    for (f = 0; f < front.length; f++) {
      i = front[f];
      var bb = b[i], cc = c[i];
      b[i] = (1 - mu) * bb;
      c[i] = (1 - gam) * cc;
      d[i] += mu * bb + gam * cc;
    }

    // 5. noise
    var sig = p.sigma;
    if (sig > 0) {
      var rand = this.rand;
      for (i = 0; i < n; i++) if (!a[i]) d[i] *= rand() < 0.5 ? 1 - sig : 1 + sig;
    }
  };

  // Total mass, counting every lattice site (used by the checks).
  Crystal.prototype.mass = function () {
    var w = this.L.w, s = 0;
    for (var i = 0; i < this.L.n; i++) s += w[i] * (this.b[i] + this.c[i] + this.d[i]);
    return s;
  };

  // ---------- climate: temperature and supersaturation -> model parameters ----------
  // T in degrees C (0 to -30), s from 0 (just saturated with respect to ice) to 1 (the top of the diagram,
  // well above water saturation). Nakaya's diagram, as Libbrecht redrew it:
  //   0 to -4      thin plates
  //   -4 to -10    columns and needles (on this flat lattice we look down their axis: a slow hexagon)
  //   -10 to -22   plates; sectored plates as the air gets wetter; stellar and fern-like dendrites near -15
  //   below -22    thick plates and columns mixed, little branching
  // Below these regimes sit five anchor parameter sets for the lattice model; climate() picks a point between
  // them. Only +, -, *, / are used so every browser agrees.
  var ANCHORS = {
    //            rho    beta   alpha   theta   kappa    mu      gamma    sigma
    prism:     [0.38,  2.40,  0.30,   0.030,  0.0030,  0.070,  0.00010, 0.000],
    plate:     [0.50,  1.60,  0.30,   0.030,  0.0030,  0.070,  0.00010, 0.000],
    sector:    [0.40,  1.30,  0.08,   0.025,  0.0030,  0.070,  0.00005, 0.000],
    stellar:   [0.60,  1.70,  0.25,   0.020,  0.0040,  0.020,  0.00030, 0.000],
    fern:      [0.50,  1.40,  0.10,   0.005,  0.0010,  0.0010, 0.00050, 0.000]
  };
  var KEYS = ["rho", "beta", "alpha", "theta", "kappa", "mu", "gamma", "sigma"];

  // How much the air at temperature T favours branching (0..1), piecewise linear over Nakaya's diagram.
  var BRANCH_T = [[0, 0.30], [-2, 0.55], [-3.5, 0.35], [-5, 0.0], [-9, 0.0], [-11, 0.45], [-13, 0.85], [-15, 1.0], [-17, 0.85], [-20, 0.5], [-23, 0.25], [-30, 0.15]];
  // How much it favours columns (looked at end-on: slow, compact, thickening).
  var COLUMN_T = [[0, 0], [-3, 0], [-4.5, 1], [-9, 1], [-10.5, 0], [-22, 0], [-25, 0.5], [-30, 0.6]];

  function table(tab, T) {
    if (T >= tab[0][0]) return tab[0][1];
    for (var i = 1; i < tab.length; i++) {
      if (T >= tab[i][0]) {
        var t0 = tab[i - 1][0], t1 = tab[i][0];
        return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * (T - t0) / (t1 - t0);
      }
    }
    return tab[tab.length - 1][1];
  }
  function mix(A, B, t) { var o = []; for (var i = 0; i < A.length; i++) o.push(A[i] + (B[i] - A[i]) * t); return o; }

  // Path from compact to wildly branched, by "drive" m in [0, 1].
  var LADDER = [[0, ANCHORS.plate], [0.3, ANCHORS.sector], [0.62, ANCHORS.stellar], [1, ANCHORS.fern]];

  function climate(T, s) {
    if (T > 0) T = 0; if (T < -30) T = -30;
    if (s < 0) s = 0; if (s > 1) s = 1;
    var m = s * table(BRANCH_T, T);
    var v = LADDER[0][1];
    for (var i = 1; i < LADDER.length; i++) {
      if (m <= LADDER[i][0]) { v = mix(LADDER[i - 1][1], LADDER[i][1], (m - LADDER[i - 1][0]) / (LADDER[i][0] - LADDER[i - 1][0])); break; }
      v = LADDER[i][1];
    }
    var col = table(COLUMN_T, T);
    if (col > 0) v = mix(v, ANCHORS.prism, col);
    var p = {};
    for (var k = 0; k < KEYS.length; k++) p[KEYS[k]] = v[k];
    p.m = m; p.col = col;
    return p;
  }

  // ---------- skies: what the crystal falls through ----------
  // A sky is a list of keyframes, one per K steps: [T, s] quantised to the encoding grid (T in half degrees,
  // s in 1/40ths) so a sky read back from a link is exactly the sky that was grown.
  var K = 40;
  function quantT(T) { var q = Math.round(-T * 2); if (q < 0) q = 0; if (q > 60) q = 60; return q; }
  function quantS(s) { var q = Math.round(s * 40); if (q < 0) q = 0; if (q > 40) q = 40; return q; }
  function keyframe(T, s) { return [-quantT(T) / 2, quantS(s) / 40]; }

  // Waypoints [[T, s], ...] spread evenly over `steps` steps, linearly between them.
  function skyFromWaypoints(wp, steps) {
    var frames = Math.ceil(steps / K), out = [];
    for (var f = 0; f < frames; f++) {
      var u = wp.length === 1 ? 0 : f / Math.max(1, frames - 1) * (wp.length - 1);
      var i = Math.min(wp.length - 2, Math.floor(u)), t = u - i;
      if (wp.length === 1) { out.push(keyframe(wp[0][0], wp[0][1])); continue; }
      out.push(keyframe(wp[i][0] + (wp[i + 1][0] - wp[i][0]) * t, wp[i][1] + (wp[i + 1][1] - wp[i][1]) * t));
    }
    return out;
  }

  // Run-length encoding into a URL-safe string: groups of (count-1, T, s), each one base-64 digit pair.
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function encodeSky(sky, seed) {
    var out = B64[(seed >>> 6) & 63] + B64[seed & 63];
    for (var i = 0; i < sky.length;) {
      var j = i + 1;
      while (j < sky.length && j - i < 64 && sky[j][0] === sky[i][0] && sky[j][1] === sky[i][1]) j++;
      out += B64[j - i - 1] + B64[quantT(sky[i][0])] + B64[quantS(sky[i][1])];
      i = j;
    }
    return out;
  }
  function decodeSky(str) {
    if (!str || str.length < 5 || (str.length - 2) % 3) return null;
    var idx = function (ch) { return B64.indexOf(ch); };
    var seed = idx(str[0]) * 64 + idx(str[1]);
    var sky = [];
    for (var i = 2; i < str.length; i += 3) {
      var n = idx(str[i]) + 1, t = idx(str[i + 1]), s = idx(str[i + 2]);
      if (n < 1 || t < 0 || t > 60 || s < 0 || s > 40) return null;
      for (var k = 0; k < n; k++) sky.push([-t / 2, s / 40]);
    }
    return sky.length ? { sky: sky, seed: seed } : null;
  }

  // ---------- comparing two crystals (for the "read the letter" puzzle) ----------
  // Two measures, both on crystals scaled to their own size:
  //  - overlap: both sampled on a grid over one quadrant (the rest follows by symmetry); where both have ice,
  //    credit falls off with the difference in when that spot froze (as a share of the whole fall).
  //  - rings: for each of 24 rings of the hexagon from centre to tip, how full the ring is and how thick its
  //    ice; this weighs the centre as much as the rim, which plain overlap does not.
  // compare() returns { score } in 0..1 (plus the two raw measures). The score is stretched so that unrelated
  // crystals land near 0. Calibrated by eye on test letters
  // (tools/check.js): a crystal against itself scores 1, a plate against a fern well under half.
  function shapeOf(cr, res) {
    res = res || 72;
    var L = cr.L, R = L.R, N = L.N, ext = Math.max(2, cr.extent + 1);
    var out = new Float32Array(res * res).fill(-1), sq3 = Math.sqrt(3);
    for (var iy = 0; iy < res; iy++) for (var ix = 0; ix < res; ix++) {
      // sample square [-1,1]^2 in units of the crystal extent; only one quadrant is needed by symmetry
      var x = (ix + 0.5) / res * ext, y = (iy + 0.5) / res * ext;
      var rr = y * 2 / sq3, qq = x - rr / 2;
      // round axial to the nearest hex
      var cx = qq, cz = rr, cy = -cx - cz;
      var rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
      var dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
      if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
      if (hexDist(rx, rz) > R) continue;
      var k = L.full[(rx + R) * N + (rz + R)];
      if (k >= 0 && cr.a[k]) out[iy * res + ix] = cr.born[k] / Math.max(1, cr.t);
    }
    return out;
  }
  var RINGS = 24;
  function ringsOf(cr) {
    var L = cr.L, f = new Float64Array(RINGS), n = new Float64Array(RINGS), th = new Float64Array(RINGS), cm = 0, i;
    for (i = 0; i < L.n; i++) if (cr.a[i] && cr.c[i] > cm) cm = cr.c[i];
    for (i = 0; i < L.n; i++) {
      var r = L.dist[i] / (cr.extent + 1);
      if (r >= 1) continue;
      var b = Math.floor(r * RINGS);
      n[b] += L.w[i];
      if (cr.a[i]) { f[b] += L.w[i]; th[b] += L.w[i] * cr.c[i] / cm; }
    }
    for (var j = 0; j < RINGS; j++) { th[j] = f[j] ? th[j] / f[j] : 0; f[j] = n[j] ? f[j] / n[j] : 0; }
    return { f: f, th: th };
  }
  function compare(A, B) {
    var sa = shapeOf(A), sb = shapeOf(B), uni = 0, sum = 0, i;
    for (i = 0; i < sa.length; i++) {
      if (sa[i] >= 0 || sb[i] >= 0) uni++;
      if (sa[i] >= 0 && sb[i] >= 0) sum += Math.max(0, 1 - 2 * Math.abs(sa[i] - sb[i]));
    }
    var overlap = uni ? sum / uni : 0;
    var ra = ringsOf(A), rb = ringsOf(B), d = new Float64Array(RINGS), tot = 0;
    for (i = 0; i < RINGS; i++) { d[i] = Math.abs(ra.f[i] - rb.f[i]) + 0.5 * Math.abs(ra.th[i] - rb.th[i]); tot += d[i]; }
    var rings = Math.max(0, 1 - 1.6 * tot / RINGS);
    var stretch = function (x) { return Math.max(0, Math.min(1, (x - 0.3) / 0.7)); };
    return { score: stretch(0.5 * overlap + 0.5 * rings), overlap: overlap, rings: rings };
  }

  // ---------- running a sky ----------
  // Grows a crystal through `sky` (time keyframes) until it lands (reaches `landAt` of the radius) or the sky
  // runs out. Used by the tuning tools.
  function grow(sky, opts) {
    opts = opts || {};
    var fall = new Fall({ R: opts.R || 200, seed: opts.seed, kind: "time", keyframes: sky, landAt: opts.landAt, maxSteps: sky.length * K });
    while (!fall.landed) fall.advance(K * 25);
    return fall.cr;
  }

  // A fall: one crystal and the sky it falls through. Three kinds:
  //   "live"    the climate comes from the caller (someone dragging on the diagram); recorded as keyframes
  //   "time"    replays recorded keyframes, one per K steps
  //   "layers"  2-4 waypoints met in order as the crystal widens: waypoint i rules at (i + 0.5)/n of the
  //             landing size, linearly in between, so the centre records the first and the tips the last.
  //             Slow climates move the sky on by time as well (whichever is further along), or a fall
  //             through column weather would never end.
  // The crystal lands at `landAt` of the lattice radius or after maxSteps.
  var LAND_AT = 0.86, MAX_STEPS = 48000;
  function Fall(o) {
    this.kind = o.kind || "live";
    this.seed = o.seed == null ? 1 : o.seed;
    this.cr = new Crystal({ R: o.R || 200, seed: this.seed });
    this.landAt = o.landAt || LAND_AT;
    this.maxSteps = o.maxSteps || MAX_STEPS;
    this.keyframes = o.keyframes || null;
    this.waypoints = o.waypoints || null;
    this.history = [];     // [T, s, progress before the frame] for every K-step frame grown
    this.switched = false; // a layered or replayed sky taken over by hand partway down
    this.target = o.target || [-15, 0.5];
    this.key = "";
    this.landed = false;
    this.now = null; // the climate in force [T, s]
  }
  Fall.prototype.progress = function () {
    var cr = this.cr;
    return Math.max(cr.extent / (cr.L.R * this.landAt), cr.t / this.maxSteps);
  };
  Fall.prototype.climateNow = function () {
    var t = this.cr.t;
    if (this.kind === "live") return keyframe(this.target[0], this.target[1]);
    if (this.kind === "time") {
      var f = Math.min(this.keyframes.length - 1, Math.floor(t / K));
      return this.keyframes[f];
    }
    var wp = this.waypoints, n = wp.length, u = this.progress() * n - 0.5;
    if (u <= 0) return keyframe(wp[0][0], wp[0][1]);
    if (u >= n - 1) return keyframe(wp[n - 1][0], wp[n - 1][1]);
    var i = Math.floor(u), x = u - i;
    return keyframe(wp[i][0] + (wp[i + 1][0] - wp[i][0]) * x, wp[i][1] + (wp[i + 1][1] - wp[i][1]) * x);
  };
  // Runs up to `steps` steps (a whole number of K-step frames). Returns the number run.
  Fall.prototype.advance = function (steps) {
    var cr = this.cr, ran = 0;
    while (ran < steps && !this.landed) {
      var kf = this.climateNow(), key = kf[0] + "," + kf[1];
      this.now = kf;
      this.history.push([kf[0], kf[1], this.progress()]);
      if (key !== this.key) {
        var p = climate(kf[0], kf[1]);
        if (cr.t === 0) cr.seed(p); else cr.setParams(p);
        this.key = key;
      }
      for (var k = 0; k < K; k++) cr.step();
      ran += K;
      if (cr.extent >= cr.L.R * this.landAt || cr.t >= this.maxSteps ||
          (this.kind === "time" && cr.t >= this.keyframes.length * K)) this.landed = true;
    }
    return ran;
  };
  // Take the weather over by hand from here on.
  Fall.prototype.takeOver = function (T, s) {
    if (this.kind !== "live") { this.kind = "live"; this.switched = true; }
    this.target = [T, s];
  };
  // The link that regrows this crystal: "t" + seed + run-length keyframes, or "w" + seed + waypoints.
  Fall.prototype.code = function () {
    if (this.kind === "layers" && !this.switched) {
      var s = "w" + B64[(this.seed >>> 6) & 63] + B64[this.seed & 63];
      for (var i = 0; i < this.waypoints.length; i++) s += B64[quantT(this.waypoints[i][0])] + B64[quantS(this.waypoints[i][1])];
      return s;
    }
    return "t" + encodeSky(this.history.map(function (h) { return [h[0], h[1]]; }), this.seed);
  };
  // A name for the crystal from the weather that built its core and its tips.
  function habitOf(T, s) {
    var p = climate(T, s);
    if (p.col > 0.5) return "hexagonal prism";
    if (p.m < 0.16) return "plate";
    if (p.m < 0.42) return "sectored plate";
    if (p.m < 0.8) return "stellar dendrite";
    return "fern-like dendrite";
  }
  Fall.prototype.describe = function () {
    var h = this.history;
    if (!h.length) return "";
    var pick = function (lo, hi) {
      var votes = {}, best = null;
      for (var i = 0; i < h.length; i++) if (h[i][2] >= lo && h[i][2] <= hi) {
        var n = habitOf(h[i][0], h[i][1]); votes[n] = (votes[n] || 0) + 1;
        if (!best || votes[n] > votes[best]) best = n;
      }
      return best;
    };
    var tips = pick(0.55, 1) || pick(0, 1), core = pick(0, 0.22) || tips;
    var short = function (n) { return n === "hexagonal prism" ? "column" : n.replace("fern-like dendrite", "fern").replace("stellar dendrite", "star"); };
    var branched = function (n) { return /dendrite/.test(n); };
    if (core !== tips && branched(core) && !branched(tips) && tips !== "hexagonal prism")
      return "Star with " + (tips === "plate" ? "plate" : "sectored") + " tips";
    var name = tips === "hexagonal prism" ? "Column seen end-on" : tips.charAt(0).toUpperCase() + tips.slice(1);
    if (core !== tips) name += ", grown on a " + short(core) + " core";
    return name;
  };
  // Reads a code back into Fall options (null if it doesn't parse).
  function parseCode(code) {
    if (!code || code.length < 3) return null;
    var idx = function (ch) { return B64.indexOf(ch); };
    if (code[0] === "w") {
      var seed = idx(code[1]) * 64 + idx(code[2]), wp = [];
      if ((code.length - 3) % 2 || code.length < 5) return null;
      for (var i = 3; i < code.length; i += 2) {
        var t = idx(code[i]), s = idx(code[i + 1]);
        if (t < 0 || t > 60 || s < 0 || s > 40) return null;
        wp.push([-t / 2, s / 40]);
      }
      if (wp.length > 6) return null;
      return { kind: "layers", seed: seed, waypoints: wp };
    }
    if (code[0] === "t") {
      var d = decodeSky(code.slice(1));
      return d ? { kind: "time", seed: d.seed, keyframes: d.sky, maxSteps: d.sky.length * K } : null;
    }
    return null;
  }

  return {
    lattice: lattice, images: images, hexDist: hexDist, DIRS: DIRS, rng: rng,
    Crystal: Crystal, climate: climate, ANCHORS: ANCHORS, KEYS: KEYS, BRANCH_T: BRANCH_T, COLUMN_T: COLUMN_T,
    K: K, keyframe: keyframe, skyFromWaypoints: skyFromWaypoints, encodeSky: encodeSky, decodeSky: decodeSky,
    shapeOf: shapeOf, compare: compare, grow: grow, Fall: Fall, parseCode: parseCode, habitOf: habitOf, LAND_AT: LAND_AT, MAX_STEPS: MAX_STEPS
  };
});
