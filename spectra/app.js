/* Spectra · a small study of light. OpenAI Sol 6.1 / Codex, November 2026. */
(() => {
  'use strict';
  const O = window.SpectraOptics, $ = id => document.getElementById(id);
  const canvas = $('bench'), ctx = canvas.getContext('2d'), TAU = Math.PI * 2;
  const copy = v => JSON.parse(JSON.stringify(v)), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const degrees = a => Math.round(a * 180 / Math.PI);
  const names = { source: 'Light', prism: 'Prism', lens: 'Lens', mirror: 'Mirror' };
  const icons = { source: '☀', prism: '△', lens: '◖◗', mirror: '╱' };
  const presets = {
    prism: { name: 'First light', note: 'Try turning the prism. There is a point where violet can no longer escape.', source: { x: 130, y: 400, angle: -0.35, width: 26, color: 'white', wavelength: 540 }, objects: [{ type: 'prism', x: 510, y: 281, angle: -0.12, size: 1.65 }] },
    focus: { name: 'A point of warmth', note: 'Widen the beam. The outer rays meet a little sooner: spherical aberration.', source: { x: 130, y: 380, angle: 0, width: 120, color: 'white', wavelength: 540 }, objects: [{ type: 'lens', x: 470, y: 380, angle: 0, size: 1.4 }] },
    fold: { name: 'The long way round', note: 'Light has no memory of the last mirror. Every bounce follows the same rule.', source: { x: 120, y: 560, angle: 0, width: 8, color: 'mono', wavelength: 460 }, objects: [{ type: 'mirror', x: 420, y: 560, angle: Math.PI / 4, size: 0.8 }, { type: 'mirror', x: 420, y: 190, angle: Math.PI / 4, size: 0.8 }, { type: 'mirror', x: 910, y: 190, angle: -Math.PI / 4, size: 0.8 }] },
    internal: { name: 'Held by the glass', note: 'The light starts inside. Rotate it and find the angle where the glass lets go.', source: { x: 530, y: 365, angle: 0.25, width: 8, color: 'mono', wavelength: 520 }, objects: [{ type: 'prism', x: 560, y: 370, angle: 0, size: 2 }] }
  };
  let state, selection = 0, history = [], result, needsTrace = true, raf = 0, view, drag = null, sliderStart = null, toastTimer;
  let sweepBase = 0, sweepTime = 0, lastTime = 0, persistTimer;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fresh(key) { return { version: 1, preset: key, ...copy(presets[key]), dispersion: 1, reflections: false, normals: false }; }
  function validate(v) {
    if (!v || v.version !== 1 || !presets[v.preset] || !Array.isArray(v.objects) || v.objects.length > 12) throw Error('Invalid arrangement');
    const validNumber = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
    const position = o => o && validNumber(o.x, 20, 1180) && validNumber(o.y, 20, 740) && validNumber(o.angle, -100, 100);
    if (!position(v.source) || !['white', 'mono'].includes(v.source.color) || !validNumber(v.source.width, 2, 120) || !validNumber(v.source.wavelength, 400, 700)) throw Error('Invalid source');
    for (const o of v.objects) if (!['prism', 'lens', 'mirror'].includes(o.type) || !position(o) || !validNumber(o.size, 0.4, 2)) throw Error('Invalid optic');
    if (!validNumber(v.dispersion, 0, 3)) throw Error('Invalid glass');
    // Reconstruct only known data; URL/local storage text never becomes markup.
    return { version: 1, preset: v.preset, name: presets[v.preset].name, note: presets[v.preset].note,
      source: { x: v.source.x, y: v.source.y, angle: v.source.angle, width: v.source.width, color: v.source.color, wavelength: v.source.wavelength },
      objects: v.objects.map(o => ({ type: o.type, x: o.x, y: o.y, angle: o.angle, size: o.size })), dispersion: v.dispersion, reflections: !!v.reflections, normals: !!v.normals };
  }
  function readHash() {
    if (!location.hash.startsWith('#s=')) return null;
    if (location.hash.length > 16000) throw Error('Link too long');
    return validate(JSON.parse(atob(location.hash.slice(3).replace(/-/g, '+').replace(/_/g, '/'))));
  }
  let startupMessage = '';
  try { state = readHash(); } catch { startupMessage = 'This arrangement link could not be read. Opening the bench instead.'; }
  if (!state) { try { const saved = localStorage.getItem('spectra.bench.v1'); if (saved) state = validate(JSON.parse(saved)); } catch { /* Storage is optional. */ } }
  if (!state) state = fresh('prism');
  function selected() { return selection === -1 ? state.source : state.objects[selection]; }
  function snapshot() { return JSON.stringify(state); }
  function push(before = snapshot()) { if (history.at(-1) !== before) history.push(before); if (history.length > 60) history.shift(); $('undo').disabled = false; }
  function persist() { clearTimeout(persistTimer); persistTimer = setTimeout(() => { try { localStorage.setItem('spectra.bench.v1', snapshot()); } catch { /* Private browsing may disallow storage. */ } }, 180); }
  function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4600); }
  function dirty(trace = true) { needsTrace ||= trace; if (!raf) raf = requestAnimationFrame(frame); }
  function stopSweep() { $('sweep').checked = false; lastTime = 0; }
  function changed() { if (location.hash) window.history.replaceState(null, '', location.pathname + location.search); persist(); sync(); dirty(); }
  function sync() {
    if (selection >= state.objects.length) selection = state.objects.length - 1;
    $('scene-name').textContent = state.name;
    $('white').setAttribute('aria-pressed', state.source.color === 'white'); $('mono').setAttribute('aria-pressed', state.source.color === 'mono');
    $('wave-row').hidden = state.source.color !== 'mono'; $('wavelength').value = state.source.wavelength; $('wave-out').textContent = state.source.wavelength + ' nm';
    $('width').value = state.source.width; $('width-out').textContent = Math.round(state.source.width);
    $('dispersion').value = state.dispersion; $('disp-out').textContent = state.dispersion.toFixed(1) + '×';
    $('reflections').checked = state.reflections; $('normals').checked = state.normals;
    $('object-count').textContent = state.objects.length + ' / 12';
    $('object-list').replaceChildren();
    const entries = [{ type: 'source' }, ...state.objects];
    entries.forEach((o, i) => { const b = document.createElement('button'); b.textContent = icons[o.type] + ' ' + (i ? names[o.type] + ' ' + i : 'Light'); b.setAttribute('aria-pressed', selection === i - 1); b.addEventListener('click', () => { selection = i - 1; sync(); dirty(false); }); $('object-list').append(b); });
    const obj = selected(), type = selection === -1 ? 'source' : obj.type;
    const label = $('angle-label'); label.firstChild.textContent = names[type] + ' angle ';
    let deg = ((degrees(obj.angle) + 180) % 360 + 360) % 360 - 180;
    $('angle').value = deg; $('angle-out').textContent = deg + '°';
    $('size-row').hidden = selection === -1; $('remove').disabled = selection === -1;
    if (selection !== -1) { $('size').value = obj.size; $('size-out').textContent = obj.size.toFixed(2) + '×'; }
    document.querySelectorAll('[data-preset]').forEach(b => { b.classList.toggle('active', b.dataset.preset === state.preset); b.setAttribute('aria-pressed', b.dataset.preset === state.preset); });
    document.querySelectorAll('[data-add]').forEach(b => b.disabled = state.objects.length >= 12);
    $('undo').disabled = !history.length;
  }
  function loadPreset(key) { stopSweep(); push(); state = fresh(key); selection = key === 'internal' ? -1 : 0; changed(); toast(state.note); }
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => loadPreset(b.dataset.preset)));
  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    if (state.objects.length >= 12) return;
    stopSweep(); push(); state.objects.push({ type: b.dataset.add, x: 730 + (state.objects.length % 3) * 55, y: 360 + (state.objects.length % 3 - 1) * 100, angle: b.dataset.add === 'prism' ? 0.23 : 0, size: 1 }); selection = state.objects.length - 1; changed(); toast(names[b.dataset.add] + ' added. Drag it into the light.');
  }));
  for (const [id, setter] of [
    ['width', v => state.source.width = v], ['wavelength', v => state.source.wavelength = v], ['dispersion', v => state.dispersion = v],
    ['angle', v => selected().angle = v * Math.PI / 180], ['size', v => { if (selection !== -1) selected().size = v; }]
  ]) {
    $(id).addEventListener('input', e => { stopSweep(); if (sliderStart === null) sliderStart = snapshot(); setter(+e.target.value); changed(); });
    $(id).addEventListener('change', () => { if (sliderStart !== null) { push(sliderStart); sliderStart = null; sync(); } });
  }
  ['white', 'mono'].forEach(id => $(id).addEventListener('click', () => { push(); state.source.color = id; changed(); }));
  ['reflections', 'normals'].forEach(id => $(id).addEventListener('change', e => { push(); state[id] = e.target.checked; changed(); }));
  $('sweep').addEventListener('change', () => { if ($('sweep').checked) { push(); if (location.hash) window.history.replaceState(null, '', location.pathname + location.search); sweepBase = state.source.angle; sweepTime = 0; lastTime = 0; dirty(); } else { persist(); sync(); } });
  function remove() { if (selection === -1) return; stopSweep(); push(); state.objects.splice(selection, 1); selection = Math.min(selection, state.objects.length - 1); changed(); }
  $('remove').addEventListener('click', remove);
  function undo() { if (!history.length) return; stopSweep(); state = JSON.parse(history.pop()); selection = Math.min(selection, state.objects.length - 1); changed(); }
  $('undo').addEventListener('click', undo);
  $('reset').addEventListener('click', () => loadPreset(state.preset));
  $('about').addEventListener('click', () => $('notes').showModal()); $('close-notes').addEventListener('click', () => $('notes').close());
  $('notes').addEventListener('click', e => { if (e.target === $('notes')) { const r = $('notes').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('notes').close(); } });
  $('share').addEventListener('click', async () => {
    stopSweep(); persist();
    const code = btoa(snapshot()).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = location.origin + location.pathname + '#s=' + code;
    window.history.replaceState(null, '', '#s=' + code);
    try { await navigator.clipboard.writeText(url); toast('Arrangement link copied. The whole bench travels with it.'); }
    catch { toast('Your arrangement is in the address bar. Copy its URL to share.'); }
  });
  window.addEventListener('hashchange', () => { try { const s = readHash(); if (s) { stopSweep(); push(); state = s; selection = state.objects.length ? 0 : -1; persist(); sync(); dirty(); toast('Shared arrangement loaded.'); } } catch { toast('That arrangement link could not be read.'); } });
  const resize = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    const scale = Math.min(r.width / O.W, r.height / O.H);
    view = { scale, x: (r.width - O.W * scale) / 2, y: (r.height - O.H * scale) / 2, dpr };
    dirty(false);
  };
  new ResizeObserver(resize).observe(canvas);
  function point(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.scale, y: (e.clientY - r.top - view.y) / view.scale }; }
  function radius(o) { return (o.type === 'source' ? 45 : o.type === 'prism' ? 110 : o.type === 'lens' ? 110 : 90) * (o.size || 1); }
  function handle(o) { const r = radius(o) + 39; return { x: o.x + Math.sin(o.angle) * r, y: o.y - Math.cos(o.angle) * r }; }
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function sourceShape() { return { ...state.source, type: 'source' }; }
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    const p = point(e), obj = selected(), h = handle(selection === -1 ? sourceShape() : obj);
    let rotation = distance(p, h) < Math.max(17, 14 / view.scale), found = rotation;
    if (!rotation) {
      if (distance(p, state.source) < Math.max(34, 13 / view.scale)) { selection = -1; found = true; }
      else for (let i = state.objects.length - 1; i >= 0; i--) {
        const o = state.objects[i], poly = O.polygon(o);
        if (o.type === 'mirror' ? pointLineDistance(p, poly[0], poly[1]) < Math.max(12, 10 / view.scale) : O.contains(poly, p)) { selection = i; found = true; break; }
      }
    }
    if (!found) return;
    e.preventDefault(); stopSweep(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId);
    const target = selected(); drag = { pointerId: e.pointerId, before: snapshot(), x: p.x, y: p.y, ox: target.x, oy: target.y, rotation, initial: target.angle, pointerAngle: Math.atan2(p.y - target.y, p.x - target.x) };
    sync(); dirty(false);
  });
  function pointLineDistance(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = point(e), o = selected();
    if (drag.rotation) { const a = Math.atan2(p.y - o.y, p.x - o.x); let v = drag.initial + a - drag.pointerAngle; if (e.shiftKey) v = Math.round(v / (Math.PI / 12)) * Math.PI / 12; o.angle = Math.atan2(Math.sin(v), Math.cos(v)); }
    else { o.x = clamp(drag.ox + p.x - drag.x, 25, 1175); o.y = clamp(drag.oy + p.y - drag.y, 25, 735); }
    changed();
  });
  function endDrag(e) { if (drag && e.pointerId === drag.pointerId) { if (drag.before !== snapshot()) push(drag.before); drag = null; sync(); } }
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('lostpointercapture', endDrag);
  window.addEventListener('keydown', e => {
    if ($('notes').open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (document.activeElement !== canvas) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return; }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault(); stopSweep(); push(); const o = selected(), direction = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey) o.angle += direction * (e.altKey ? 0.2 : 2) * Math.PI / 180;
      else { const axis = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 'x' : 'y'; o[axis] = clamp(o[axis] + direction * (e.altKey ? 1 : 8), 25, axis === 'x' ? 1175 : 735); }
      o.angle = Math.atan2(Math.sin(o.angle), Math.cos(o.angle)); changed();
    }
  });
  function path(c, p, close = true) { c.beginPath(); p.forEach((v, i) => i ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)); if (close) c.closePath(); }
  function draw(c, exporting = false) {
    c.fillStyle = '#090f15'; c.fillRect(0, 0, O.W, O.H);
    const halo = c.createRadialGradient(560, 350, 20, 560, 350, 700); halo.addColorStop(0, '#17252e55'); halo.addColorStop(1, '#090e1300'); c.fillStyle = halo; c.fillRect(0, 0, O.W, O.H);
    // A quiet optical breadboard. Every fifth dot is a tiny cross.
    c.fillStyle = '#26343e';
    for (let x = 30; x < O.W; x += 30) for (let y = 20; y < O.H; y += 30) { c.globalAlpha = 0.55; c.fillRect(x - 0.65, y - 0.65, 1.3, 1.3); }
    c.globalAlpha = 1;
    c.strokeStyle = '#35434d'; c.lineWidth = 0.7;
    for (let x = 150; x < O.W; x += 150) for (let y = 140; y < O.H; y += 150) { c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.moveTo(x, y - 3); c.lineTo(x, y + 3); c.stroke(); }
    // Glass sits under the rays so the light remains visible inside it.
    for (const o of state.objects) if (o.type !== 'mirror') {
      path(c, O.polygon(o)); const fill = c.createLinearGradient(o.x - 110, o.y - 110, o.x + 100, o.y + 100); fill.addColorStop(0, '#8eb5bf20'); fill.addColorStop(0.5, '#5f909a0c'); fill.addColorStop(1, '#9cc8d528'); c.fillStyle = fill; c.fill();
    }
    // Draw one broad halo and one narrow core; additive mixing makes the incident bundle white.
    c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    const mono = state.source.color === 'mono';
    for (const [width, alpha] of [[8, mono ? 0.035 : 0.022], [1.25, mono ? 0.7 : 0.28]]) {
      c.lineWidth = width;
      for (const s of result.segments) {
        const rgb = O.color(s.wavelength); c.strokeStyle = `rgba(${rgb.join(',')},${alpha * s.energy})`;
        c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); c.stroke();
      }
    }
    // Light falling on the perimeter leaves a brighter spectral trace.
    for (const s of result.segments) if (s.b.x < 0.1 || s.b.x > 1199.9 || s.b.y < 0.1 || s.b.y > 759.9) {
      const rgb = O.color(s.wavelength); c.fillStyle = `rgba(${rgb.join(',')},${s.energy * (mono ? 0.5 : 0.2)})`; c.beginPath(); c.ellipse(clamp(s.b.x, 3, 1197), clamp(s.b.y, 3, 757), s.b.y < 1 || s.b.y > 759 ? 3 : 2, s.b.x < 1 || s.b.x > 1199 ? 3 : 2, 0, 0, TAU); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    if (state.normals) {
      c.setLineDash([4, 5]); c.lineWidth = 0.8; c.strokeStyle = '#9bb6b766';
      const seen = new Set();
      for (const e of result.events) { const key = Math.round(e.p.x / 6) + ',' + Math.round(e.p.y / 6); if (seen.has(key)) continue; seen.add(key); c.beginPath(); c.moveTo(e.p.x - e.n.x * 30, e.p.y - e.n.y * 30); c.lineTo(e.p.x + e.n.x * 30, e.p.y + e.n.y * 30); c.stroke(); }
      c.setLineDash([]);
    }
    state.objects.forEach((o, i) => {
      const p = O.polygon(o), chosen = !exporting && i === selection;
      path(c, p, o.type !== 'mirror'); c.strokeStyle = chosen ? '#dbcf9e' : '#7f9ca9'; c.lineWidth = o.type === 'mirror' ? 3.5 : 1.25; c.stroke();
      if (o.type === 'mirror') { c.save(); c.translate(o.x, o.y); c.rotate(o.angle); c.strokeStyle = '#5c7485'; c.lineWidth = 1; for (let y = -90 * o.size; y < 90 * o.size; y += 12) { c.beginPath(); c.moveTo(-3, y); c.lineTo(-12, y + 8); c.stroke(); } c.restore(); }
      c.font = '11px Consolas,monospace'; c.textAlign = 'center'; c.fillStyle = chosen ? '#cfc298' : '#70838f';
      const bottom = Math.max(...p.map(v => v.y)); c.fillText(names[o.type].toUpperCase() + ' ' + (i + 1), o.x, Math.min(715, bottom + 24));
    });
    // The emitter's aperture is at its origin; its body is behind the beam.
    c.save(); c.translate(state.source.x, state.source.y); c.rotate(state.source.angle);
    c.shadowColor = '#0008'; c.shadowBlur = 8; c.fillStyle = '#1e2a33'; c.strokeStyle = selection === -1 && !exporting ? '#d7c99c' : '#8297a4'; c.lineWidth = 1;
    c.beginPath(); c.roundRect(-54, -18, 46, 36, 5); c.fill(); c.stroke(); c.shadowBlur = 0;
    c.fillStyle = '#40515d'; c.fillRect(-45, -12, 3, 24); c.fillRect(-37, -12, 3, 24); c.fillRect(-29, -12, 3, 24);
    c.fillStyle = state.source.color === 'mono' ? `rgb(${O.color(state.source.wavelength).join(',')})` : '#f4e9c8'; c.shadowColor = c.fillStyle; c.shadowBlur = 12; c.fillRect(-5, -Math.max(6, state.source.width / 2), 4, Math.max(12, state.source.width)); c.restore();
    if (!exporting) {
      const o = selection === -1 ? sourceShape() : selected(), h = handle(o);
      c.setLineDash([3, 5]); c.strokeStyle = '#bcb08b66'; c.lineWidth = 1; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(h.x, h.y); c.stroke(); c.setLineDash([]);
      c.strokeStyle = '#d5c79a'; c.fillStyle = '#141e26'; c.beginPath(); c.arc(h.x, h.y, Math.max(8, 6 / view.scale), 0, TAU); c.fill(); c.stroke(); c.fillStyle = '#d5c79a'; c.beginPath(); c.arc(h.x, h.y, 2, 0, TAU); c.fill();
    }
    // Wavelength key is part of the instrument, and appears in exported images.
    c.font = '10px Consolas,monospace'; c.textAlign = 'left'; c.fillStyle = '#6d818f'; c.fillText('VISIBLE SPECTRUM', 920, 646);
    for (let i = 0; i < 180; i++) { c.fillStyle = `rgba(${O.color(400 + i / 179 * 300).join(',')},0.7)`; c.fillRect(920 + i, 660, 1, 3); }
    c.fillStyle = '#6d818f'; c.fillText('400', 920, 681); c.textAlign = 'right'; c.fillText('700 nm', 1100, 681);
    if (exporting) { c.textAlign = 'left'; c.fillStyle = '#e5e3d5'; c.font = '30px Georgia,serif'; c.fillText('Spectra.', 32, 48); c.font = '11px Consolas,monospace'; c.fillStyle = '#81939f'; c.fillText(state.name + ' / OpenAI Sol 6.1 · Codex', 33, 71); }
  }
  function frame(time) {
    raf = 0;
    if ($('sweep').checked && !document.hidden) { if (lastTime) sweepTime += Math.min(50, time - lastTime); lastTime = time; state.source.angle = sweepBase + Math.sin(sweepTime / 4000) * 0.28; needsTrace = true; }
    if (needsTrace || !result) { result = O.trace(state.objects, state.source, { dispersion: state.dispersion, reflections: state.reflections, rays: 13 }); needsTrace = false; $('ray-count').textContent = result.segments.length.toLocaleString() + ' RAY SEGMENTS' + (result.truncated ? ' · LIMIT' : ''); }
    if (!view) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#090f15'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale * view.dpr, 0, 0, view.scale * view.dpr, view.x * view.dpr, view.y * view.dpr); draw(ctx);
    if ($('sweep').checked && !document.hidden) raf = requestAnimationFrame(frame);
  }
  $('save').addEventListener('click', () => {
    if (needsTrace || !result) result = O.trace(state.objects, state.source, { dispersion: state.dispersion, reflections: state.reflections, rays: 13 });
    const out = document.createElement('canvas'); out.width = 2400; out.height = 1520; const c = out.getContext('2d'); c.scale(2, 2); draw(c, true);
    out.toBlob(blob => { if (!blob) { toast('The image could not be saved.'); return; } const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'spectra-' + state.preset + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); toast('A little light, saved as a PNG.'); });
  });
  document.addEventListener('visibilitychange', () => { lastTime = 0; if (!document.hidden) dirty(false); });
  window.addEventListener('pagehide', () => { try { localStorage.setItem('spectra.bench.v1', snapshot()); } catch { /* Optional. */ } });
  // Sweep starts only by request, including when reduced motion is preferred.
  if (reducedMotion) $('sweep').title = 'Animation starts only when you turn this on.';
  if (!state.objects.length) selection = -1;
  sync(); resize();
  if (startupMessage) toast(startupMessage);
})();
