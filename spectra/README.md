# Spectra

An optical bench for light's hidden colours. Built by **OpenAI GPT-6, working in Codex**, on 17 November 2026.

Open `index.html` directly in a modern browser, or run this from the repository root:

```sh
node spectra/tools/serve.js
```

Then visit http://127.0.0.1:4187/spectra/ (or open the workshop at http://127.0.0.1:4187/). An optional port argument changes the preview port. The experience is plain HTML, CSS and JavaScript: no install, build, backend, account, or graphics-library dependency. Google Fonts are optional; system fonts work offline.

## The experience

Four composed experiments introduce dispersion, focusing, mirrors, and total internal reflection. Drag the source or any optic; turn it with the circular handle. Add up to twelve prisms, biconvex lenses, or two-sided mirrors. Change the beam width, wavelength, or glass dispersion, reveal weak Fresnel reflections, and sweep the source through a range of angles. Surface normals make the geometry visible.

The selection list and sliders provide an alternative to dragging. Focus the canvas and use arrows to move the selection, Shift + arrows to turn it, and Alt for finer adjustments. Delete removes the selected optic. Ctrl/Cmd + Z undoes an edit. Reset restores the selected experiment and is itself undoable.

The arrangement saves locally in the browser. **Share** encodes the complete bench into the URL fragment and copies the link, with an address-bar fallback if clipboard access is denied. The link needs a reachable copy of the site; a localhost link works only on the same computer. No arrangement is sent to a server. **Image** renders a clean 2400 × 1520 PNG without selection handles.

## Model

`optics.js` is the model loaded by both the browser and the tests. It is also a CommonJS module, so the verification exercises the actual tracer rather than a separate implementation.

- Twenty-five wavelengths, 400–700 nm, and thirteen parallel rays per wavelength form a white bundle. Monochromatic light uses one wavelength.
- Rays meet polygon edges by analytic line intersection. Mirrors reflect the direction vector and retain 96% of ray energy.
- Glass boundaries use vector Snell refraction and unpolarised Fresnel reflectance. Above the critical angle a ray reflects completely. With faint reflections disabled, reflected energy is discarded; the transmitted path still loses its Fresnel share.
- Glass follows an illustrative Cauchy law: `n = 1.50 + 0.012 D / λ²`, where `λ` is measured in micrometres and `D` is the dispersion setting. This is a controllable material, not a claim about a particular commercial glass.
- The lens consists of two circular surfaces with local radius 230 and aperture half-height 110, each represented with forty subdivisions. Its thickness and aperture scale together. It naturally exhibits spherical and chromatic aberration.
- The medium is sampled on both sides of a boundary, so sources can begin inside glass. All glass has the same index; overlapping shapes act as a union. A small offset after each hit prevents self-intersection.
- Branches below 1.2% energy, branches after eighteen encounters, and traces above 24,000 segments are stopped. The segment counter indicates if the global cap is reached. There is no hidden random input.

## What was tested

```sh
node spectra/tools/check.js
node spectra/tools/check-app.js
node tools/check-catalog.js
```

The ten optics checks cover Snell's law across angles and both directions, reflection invariants, Fresnel reflectance and the critical angle, prism exit ordering, identical paths at zero dispersion, energy accounting with branch cutoffs, lens convergence relative to its thick-lens prediction, a three-mirror route, sources inside glass, and eighty seeded mixed arrangements with finite and bounded traces.

The application checks execute the actual handlers in a minimal DOM: all preset traces, undo grouping, add/remove/reset and the twelve-optic cap, pointer translation and rotation, keyboard adjustment, multiple-pointer isolation, URL and local-storage round trips, and malformed-state fallback. These checks do not substitute for a browser.

Browser verification was performed in the Codex in-app Chromium browser: the prism, focus, and internal-reflection compositions; sliders and reflected paths; object addition, removal, and undo; field notes; sharing followed by reload; and responsive layout at a 390 × 844 viewport. No horizontal overflow was observed. Rendering and clipboard copying worked without console errors. See the final verification additions below for export and integration results.

## Limits and unverified behavior

This is two-dimensional geometric optics. It omits diffraction, interference, polarisation state, absorption, scattering and out-of-plane paths. Spectral RGB colours and glow are illustrative, not a calibrated detector. Discretised lens edges introduce small angular errors, especially near the axis. Large or overlapping optics may extend beyond the bench, which absorbs rays at its boundary.

Physical touch hardware, Safari, Firefox, screen-reader usability, and low-powered-device performance have not been verified. The responsive viewport check uses a desktop browser and is not a real phone test. Nothing here claims laboratory accuracy.

## Files

- `index.html`, `style.css`, `app.js`: instrument, controls, renderer, and persistence.
- `optics.js`: dependency-free, deterministic tracer.
- `tools/check.js`: physical invariants and integration checks.
- `tools/check-app.js`: actual-handler regression checks in a minimal DOM.
- `tools/serve.js`: optional loopback-only static preview.
- `../art/spectra.svg`: vector artwork for the workshop card.

Spectra registers in `../catalog.js` and uses the existing Workshop switcher. Previous creations are preserved.
