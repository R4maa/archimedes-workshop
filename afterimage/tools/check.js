"use strict";
const assert = require("node:assert/strict");
const G = require("../core.js");
const moves = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0], ".": [0, 0] };
function walk(state, commands) {
  for (const c of commands) {
    assert.ok(moves[c], "Recognized solution command");
    state = G.step(state, ...moves[c]);
  }
  return state;
}

// Explore every reachable (position, beat) using the production rules. An echo
// schedule is fixed for each search; this verifies that it provides a route,
// not just that one hand-entered command string happened to pass.
function canEscape(initial) {
  const queue = [initial], seen = new Set();
  for (let i = 0; i < queue.length; i++) {
    const state = queue[i], key = `${state.x},${state.y},${state.tick}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (state.won) return true;
    if (state.tick === G.levels[state.level].limit) continue;
    for (const dir of Object.values(moves)) queue.push(G.step(state, ...dir));
  }
  return false;
}

for (const [i, level] of G.levels.entries()) {
  const width = level.map[0].length;
  assert.ok(level.map.every(row => row.length === width), `${level.id}: rectangular map`);
  const flat = level.map.join("");
  assert.equal((flat.match(/S/g) || []).length, 1);
  assert.equal((flat.match(/E/g) || []).length, 1);
  assert.match(flat, /^[#.SEabcABC]+$/);
  assert.ok(!canEscape(G.create(i)), `${level.id}: echoes are necessary`);
  let state = G.create(i);
  for (const script of level.solution.slice(0, -1)) {
    state = walk(state, script);
    assert.ok(!state.won, "Recording does not prematurely end the room");
    const before = state;
    state = G.record(state);
    assert.equal(state.echoes.length, before.echoes.length + 1);
    assert.equal(state.tick, 0);
  }
  assert.ok(canEscape(state), `${level.id}: recorded schedule opens a route`);
  state = walk(state, level.solution.at(-1));
  assert.ok(state.won, `${level.id}: authored solution wins`);
  assert.ok(state.tick <= level.limit);
  assert.equal(G.step(state, 0, 0), state, "Won state cannot advance");
  assert.equal(G.record(state), state, "Won state cannot record");
  assert.ok(!G.undo(state).won, "Undo can revisit the winning step");
  console.log(`PASS ${level.title}: ${state.echoes.length} echo(es), ${state.tick} final beats; no echo-free escape`);
}

let state = G.create(0);
assert.equal(G.record(state), state, "Cannot record an empty take");
assert.equal(G.undo(state), state, "Cannot undo before the first beat");
assert.equal(G.removeEcho(state), state, "Cannot remove a nonexistent echo");
assert.equal(G.step(state, 1, 1), state, "Diagonal movement rejected");
assert.equal(G.step(state, NaN, 0), state, "Nonfinite movement rejected");
assert.equal(G.step(state, 0.5, 0), state, "Fractional movement rejected");
assert.throws(() => G.create(-1), RangeError);
const blocked = G.step(state, -1, 0);
assert.equal(blocked.x, state.x, "Wall blocks movement");
assert.equal(blocked.tick, 1, "Wall bump still advances the clock");
assert.equal(state.tick, 0, "Step does not mutate its input");
assert.equal(state.path.length, 1, "Step does not mutate old path");

state = walk(state, "RRU");
const recording = state;
state = G.record(state);
assert.equal(state.echoes.length, 1);
assert.equal(recording.tick, 3, "Record does not mutate its input");
assert.notEqual(state.echoes[0], recording.path, "Recording owns its path array");
assert.notEqual(state.echoes[0][0], recording.path[0], "Recording owns its coordinates");
state = walk(state, "..");
assert.equal(G.doors(state).a, false, "Plate is not active before the echo arrives");
state = G.step(state, 0, 0);
assert.equal(G.doors(state).a, true, "Echo on plate opens gate");
assert.equal(G.record(state), state, "Echo cap enforced");
const rewind = G.undo(state);
assert.equal(G.doors(rewind).a, false, "Undo rewinds echoes as well as the player");
state = walk(state, "............");
assert.deepEqual(G.positions(state)[0], { x: 3, y: 2 }, "Echo holds its final square");
assert.equal(G.doors(state).a, true);
state = walk(state, "..........");
assert.equal(state.tick, G.levels[0].limit, "Beat cap enforced");
assert.equal(G.step(state, 1, 0), state, "No steps past the beat cap");
assert.equal(G.removeEcho(state).echoes.length, 0);
assert.equal(G.removeEcho(state).tick, 0, "Removing an echo resets the take");

// Gate timing: at beat 4 the echo leaves a on the next step. The player can
// still enter A on that beat, then leave after the gate closes.
state = G.record(walk(G.create(0), "RRU.D"));
state = walk(state, "RRR.");
assert.equal(state.x, 4);
assert.equal(G.doors(state).a, true);
state = G.step(state, 1, 0);
assert.equal(state.x, 5, "Entry uses occupancy before the step");
assert.equal(G.doors(state).a, false, "Gate closes after echo departs");
state = G.step(state, 1, 0);
assert.equal(state.x, 6, "A closing gate does not trap its occupant");

// Echo positions are memories rather than attempts to move: replaying a saved
// trajectory is independent of the gates currently open in the world.
state = G.create(1);
state.echoes = [[{ x: 1, y: 3 }, { x: 5, y: 3 }, { x: 8, y: 2 }]];
state = G.step(state, 0, 0);
assert.deepEqual(G.positions(state)[0], { x: 5, y: 3 });
assert.equal(G.doors(state).a, false);
state = G.step(state, 0, 0);
assert.equal(G.doors(state).b, true, "Echo replay is independent of closed gates");
console.log("PASS rule checks: timing, walls, rewind, holding, limits, immutability and replay");
