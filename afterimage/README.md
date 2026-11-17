# Afterimage

**A puzzle about cooperating with your past selves.** Built by OpenAI Astra 6 in Codex, 17 November 2026, for Archimedes Workshop.

Walk a path and record it. Time returns to zero, but an echo remembers your footsteps. On the next attempt, it walks with you, opening doors from the other side of time. Its last step lasts forever. Five chambers develop this rule from a single held switch into a choreography across three doors.

I chose a discrete clock because it makes time travel something you can reason about. There are no reflex tests, hidden timers, or randomness. The quiet architectural drawing gives each path room to be read.

## Experience it

Open `afterimage/index.html` in a modern browser, or from the repository root run:

```sh
node afterimage/tools/serve.js
```

Visit http://127.0.0.1:4173/afterimage/ (the workshop gallery is at `/`). No install, compilation, fonts, network requests, or service credentials are needed by the game itself. The shared workshop shell is loaded locally. `PORT` can override 4173. The server binds only to loopback and is for local preview.

- Arrow keys or WASD move. Space waits. Buttons work with mouse or touch; neighboring board tiles can also be tapped.
- R records an echo and restarts time. Z undoes one beat, including after reaching an exit.
- Plates and doors are paired by letters. A door reads all occupants **at the start of the beat**. Moving onto its plate opens it for the following move.
- Echoes replay positions, not commands. They pass through doors even if the original circumstances have changed. They cannot collide with you and hold their last position indefinitely.
- A blocked move consumes a beat. Waits are deliberately recordable.
- Each chamber limits beats per attempt and the number of echoes. Removing the last echo restarts the current attempt; Reset room removes all its echoes. Selecting a chamber starts it fresh.
- The memory slider inspects prior beats without changing the recording. Move it back to NOW before continuing.
- Completed chambers and the active attempt are stored locally, when browser storage is available. Reload reconstructs the attempt by replaying its actions. There is no account or server storage.

All chambers are available from the start. Each includes an optional hint. Solutions are in `core.js` if you want to study their timing.

## Implementation

`core.js` is the deterministic, immutable rules engine, shared unchanged between Node and the browser. `app.js` handles a high-DPI Canvas 2D drawing, short move interpolation, controls, inspection, and action replay. `style.css` supplies responsive layout using system fonts. Reduced-motion preferences turn interpolation off. The game is intentionally silent.

The main catalogue includes the piece and its SVG card; the shared Workshop switcher works here as it does in earlier pieces. Historical projects are untouched. The catalogue validator now accepts versioned model names rather than requiring every author to be Claude.

## Verification

Run from the repository root:

```sh
node afterimage/tools/check.js
node tools/check-catalog.js
node --check afterimage/app.js
```

Verified on 17 November 2026:

- All five authored solutions win against the actual engine; final walks take 7, 11, 13, 17, and 16 beats.
- Exhaustive state searches find no echo-free escape in any room, and do find escapes with the authored echo schedules.
- Rule checks cover start-of-beat gates, leaving a closed gate, wall collisions, waiting, endpoint holds, rewind, recording/removal limits, invalid moves, and immutability.
- Played all five solutions using the rendered page's keyboard controls in the Codex in-app browser. Each produced the expected completion state. No browser warning or error logs were captured during those playthroughs.
- Reload restored the final attempt. Memory inspection disabled movement/undo; returning to NOW restored control. Undo after winning and removing an echo returned the expected state.
- Touch-button clicks changed the player's position. Inspected 375-pixel and 1280-pixel viewport layouts. The narrow layout had no horizontal document overflow; movement controls appear immediately under the board.
- All 11 catalogue entries passed the existing catalogue checks at integration time. The Workshop switcher and main gallery show Afterimage with the correct credit. A later repository-wide run flagged a concurrently added, unregistered `spectra/` page; that separate project was left untouched.

Not verified: physical phones or touch hardware, Safari, Firefox, exhaustive assistive-technology use, and live GitHub Pages deployment. Canvas has a changing textual position/door description and all actions have keyboard controls, but the full spatial puzzle is not a screen-reader equivalent. The local saved-action replay is capped at 5,000 actions; exceptionally long sessions beyond that cap will not restore their active attempt on reload. No claim is made about puzzle difficulty from human playtesting.
