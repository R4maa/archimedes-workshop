/* Afterimage — deterministic puzzle rules, shared by the browser and Node checks.
 * Codex / Astra 6, 17 November 2026. No clock, random numbers or DOM dependencies.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Afterimage = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const levels = [
    {
      id: "a-place-to-stay", title: "A place to stay", subtitle: "01 / A first echo",
      story: "Some doors need someone to stay behind. That someone can be you.",
      hint: "Walk right twice and up onto plate a. Record that path. Your echo will stay there while you take the straight route to the exit.",
      map: [
        "###########",
        "#....#....#",
        "#..a.#....#",
        "#S...A..E.#",
        "#....#....#",
        "#....#....#",
        "###########"
      ],
      limit: 18, maxEchoes: 1,
      solution: ["RRU", "RRRRRRR"]
    },
    {
      id: "a-second-self", title: "A second self", subtitle: "02 / Build on a memory",
      story: "A memory opens the first door. Make another on the other side.",
      hint: "Leave one echo on a. With its help, record a second path to b. Both memories replay together on your final walk.",
      map: [
        "###############",
        "#....#....#...#",
        "#..a.#..b.#...#",
        "#S...A....B.E.#",
        "#....#....#...#",
        "#....#....#...#",
        "###############"
      ],
      limit: 22, maxEchoes: 2,
      solution: ["RRU", "RRRRRRRU", "RRRRRRRRRRR"]
    },
    {
      id: "passing-through", title: "Passing through", subtitle: "03 / A moving memory",
      story: "One echo. Two doors. Staying forever is not always the answer.",
      hint: "Record: right, up, up, wait twice, then down four times. Your echo visits a, then b. Go up and right toward the exit; wait at the second door until b lights.",
      map: [
        "###############",
        "#....#...#....#",
        "#.a..#...#....#",
        "#....A...B..E.#",
        "#S...#...#....#",
        "#....#...#....#",
        "#.b..#...#....#",
        "#....#...#....#",
        "###############"
      ],
      limit: 20, maxEchoes: 1,
      solution: ["RUU..DDDD", "URRRRRRR.RRRR"]
    },
    {
      id: "counterpoint", title: "Counterpoint", subtitle: "04 / Two interlocking lives",
      story: "One memory carries you through. Another must remember what lies beyond.",
      hint: "Use the moving a-to-b echo from the previous room. Record a second journey through both gates to c. On your final pass, the two echoes will open all three doors.",
      map: [
        "###################",
        "#....#...#...#....#",
        "#.a..#...#...#....#",
        "#....A...B...C..E.#",
        "#S...#...#.c.#....#",
        "#....#...#...#....#",
        "#.b..#...#...#....#",
        "#....#...#...#....#",
        "###################"
      ],
      limit: 26, maxEchoes: 2,
      solution: ["RUU..DDDD", "URRRRRRR.RRRD", "URRRRRRR.RRRRRRRR"]
    },
    {
      id: "one-thread", title: "One thread", subtitle: "05 / The whole choreography",
      story: "Three doors. One memory. A small dance, performed twice, changes everything.",
      hint: "Give a two extra beats, then give b two extra beats, and finish on c. Meanwhile your present self can go up and walk straight across. The doors are checked before each step.",
      map: [
        "###################",
        "#....#...#...#....#",
        "#.a..#...#...#....#",
        "#....A...B...C..E.#",
        "#S...#...#...#....#",
        "#.b..#...#...#....#",
        "#....#...#...#....#",
        "#.c..#...#...#....#",
        "###################"
      ],
      limit: 24, maxEchoes: 1,
      solution: ["RUU..DDD..DD", "URRRRRRRRRRRRRRR"]
    }
  ];

  function tile(level, x, y) {
    return levels[level].map[y]?.[x] || "#";
  }

  function create(level = 0) {
    if (!Number.isInteger(level) || !levels[level]) throw new RangeError("Unknown room");
    const map = levels[level].map;
    for (let y = 0; y < map.length; y++) {
      const x = map[y].indexOf("S");
      if (x >= 0) return { level, x, y, tick: 0, path: [{ x, y }], echoes: [], won: false };
    }
    throw new Error("Room has no starting point");
  }

  // Echoes are recorded positions, not commands. They cannot be stranded by a
  // door which has since closed. After the final frame they hold that position.
  function positions(state) {
    return state.echoes.map(path => path[Math.min(state.tick, path.length - 1)]);
  }

  function doors(state) {
    const open = { a: false, b: false, c: false };
    for (const p of [state, ...positions(state)]) {
      const cell = tile(state.level, p.x, p.y);
      if (cell === "a" || cell === "b" || cell === "c") open[cell] = true;
    }
    return open;
  }

  function step(state, dx, dy) {
    if (state.won || state.tick >= levels[state.level].limit) return state;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) > 1) return state;
    let x = state.x + dx, y = state.y + dy;
    const cell = tile(state.level, x, y);
    const gate = cell === "A" || cell === "B" || cell === "C";
    // Occupancy at the START of a beat controls entry. A door closing on a
    // traveller does not trap them: only the destination cell is checked.
    if (cell === "#" || (gate && !doors(state)[cell.toLowerCase()])) {
      x = state.x; y = state.y;
    }
    return { ...state, x, y, tick: state.tick + 1,
      path: state.path.concat({ x, y }), won: tile(state.level, x, y) === "E" };
  }

  function record(state) {
    if (state.won || state.tick === 0 || state.echoes.length >= levels[state.level].maxEchoes) return state;
    return { ...create(state.level), echoes: state.echoes.concat([state.path.map(p => ({ ...p }))]) };
  }

  function undo(state) {
    if (state.tick === 0) return state;
    const path = state.path.slice(0, -1), p = path[path.length - 1];
    return { ...state, ...p, path, tick: state.tick - 1, won: false };
  }

  function removeEcho(state) {
    if (!state.echoes.length) return state;
    return { ...create(state.level), echoes: state.echoes.slice(0, -1) };
  }

  return { levels, create, step, record, undo, removeEcho, positions, doors, tile };
});
