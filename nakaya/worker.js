// Nakaya's worker: grows crystals off the main thread and posts snapshots for drawing.
// Two slots: 0 is the crystal on show (or the letter), 1 is the reply in "Read a letter".
importScripts("snow.js?v=1");

var R = 200;
var slots = [null, null];
var speed = 1;          // multiplies the pace
var FALL_SECONDS = 42;  // how long a fall takes at speed 1, whatever the weather
var lastTick = 0;

function Slot(id, opts, pace) {
  this.id = id;
  this.fall = new SNOW.Fall(Object.assign({ R: R }, opts));
  this.pace = pace || "fall"; // "fall" (real-time, paced), "fast" (regrow in a few seconds), "instant"
  this.acc = 0;
  this.rate = 1 / 4000;        // progress per step, measured
  this.lastP = 0; this.lastT = 0;
  this.dirty = true;
  this.done = false;
}

function snapshot(i, s) {
  var cr = s.fall.cr, n = cr.L.n, data = new Float32Array(n * 4);
  for (var k = 0; k < n; k++) {
    data[k * 4] = cr.a[k];
    data[k * 4 + 1] = cr.c[k];
    data[k * 4 + 2] = cr.born[k];
    data[k * 4 + 3] = cr.inFront[k] ? cr.b[k] : 0;
  }
  var h = s.fall.history, trail = [];
  // the sky so far, thinned to at most ~400 points for the diagram
  var stepH = Math.max(1, Math.ceil(h.length / 400));
  for (var j = 0; j < h.length; j += stepH) trail.push(h[j][0], h[j][1], h[j][2]);
  if (h.length) trail.push(h[h.length - 1][0], h[h.length - 1][1], h[h.length - 1][2]);
  postMessage({
    type: "frame", slot: i, id: s.id, n: n, data: data, t: cr.t, extent: cr.extent, R: R,
    progress: Math.min(1, s.fall.progress()), now: s.fall.now, landed: s.fall.landed, trail: trail,
    name: s.fall.describe()
  }, [data.buffer]);
  s.dirty = false;
}

function tick() {
  var now = Date.now(), dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  var budgetEnd = now + 12;
  for (var i = 0; i < 2; i++) {
    var s = slots[i];
    if (!s || s.fall.landed) continue;
    var f = s.fall;
    if (s.pace === "instant") {
      while (!f.landed && Date.now() < budgetEnd + 400) f.advance(SNOW.K * 50);
      s.dirty = true;
    } else {
      // Pace: aim for a steady share of the fall per second, so a slow plate and a racing fern both take
      // about FALL_SECONDS. The step rate follows the measured progress per step.
      var seconds = s.pace === "fast" ? 5 : FALL_SECONDS / speed;
      var stepsPerSec = Math.max(40, Math.min(s.pace === "fast" ? 30000 : 6000, (1 / seconds) / s.rate));
      s.acc += stepsPerSec * dt;
      var want = Math.floor(s.acc / SNOW.K) * SNOW.K;
      if (want > 0) {
        var ran = 0;
        while (ran < want && !f.landed && Date.now() < budgetEnd) ran += f.advance(SNOW.K);
        s.acc -= want;
        if (s.acc > SNOW.K * 4) s.acc = SNOW.K * 4;
        s.dirty = true;
        var p = f.progress(), dT = f.cr.t - s.lastT;
        if (dT >= 400) {
          var r = (p - s.lastP) / dT;
          if (r > 0) s.rate = s.rate * 0.6 + r * 0.4;
          s.lastP = p; s.lastT = f.cr.t;
        }
      }
    }
    if (f.landed && !s.done) {
      s.done = true;
      snapshot(i, s);
      postMessage({ type: "landed", slot: i, id: s.id, code: f.code(), name: f.describe(), t: f.cr.t, extent: f.cr.extent });
      if (i === 1 && slots[0] && slots[0].fall.landed) {
        postMessage({ type: "score", id: s.id, value: SNOW.compare(slots[0].fall.cr, f.cr).score });
      }
    }
  }
  setTimeout(tick, 8);
}

var wantFrame = [false, false];
onmessage = function (e) {
  var m = e.data;
  if (m.cmd === "start") {
    slots[m.slot] = new Slot(m.id, m.opts, m.pace);
    if (m.slot === 0 && m.clearReply) slots[1] = null;
  } else if (m.cmd === "target") {
    var s = slots[m.slot];
    if (s && !s.fall.landed) s.fall.takeOver(m.T, m.s);
  } else if (m.cmd === "speed") {
    speed = m.value;
  } else if (m.cmd === "land") {
    var s2 = slots[m.slot];
    if (s2 && !s2.fall.landed) { s2.fall.landed = true; }
  } else if (m.cmd === "frame") {
    // the page asks for a snapshot when it is ready to draw one
    var s3 = slots[m.slot];
    if (s3 && (s3.dirty || m.force)) snapshot(m.slot, s3);
    else postMessage({ type: "idle", slot: m.slot });
  } else if (m.cmd === "drop") {
    slots[m.slot] = null;
  }
};
lastTick = Date.now();
tick();
