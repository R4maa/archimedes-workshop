/* Spectra · geometric optics, independent of the renderer. OpenAI GPT-6 / Codex. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpectraOptics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 1200, H = 760, EPS = 0.002;
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const add = (a, b, t = 1) => ({ x: a.x + b.x * t, y: a.y + b.y * t });
  const unit = a => { const l = Math.hypot(a.x, a.y); return { x: a.x / l, y: a.y / l }; };
  function index(nm, dispersion = 1) { return 1.5 + 0.012 * dispersion / (nm / 1000) ** 2; }
  function reflect(d, n) { return add(d, n, -2 * dot(d, n)); }
  // n points into the incident medium; null denotes total internal reflection.
  function refract(d, n, n1, n2) {
    const ratio = n1 / n2, c = -dot(d, n), k = 1 - ratio * ratio * (1 - c * c);
    return k < 0 ? null : unit(add({ x: d.x * ratio, y: d.y * ratio }, n, ratio * c - Math.sqrt(k)));
  }
  function fresnel(d, n, n1, n2) {
    const ci = Math.abs(dot(d, n)), st2 = (n1 / n2) ** 2 * (1 - ci * ci);
    if (st2 >= 1) return 1;
    const ct = Math.sqrt(1 - st2);
    return (((n1 * ci - n2 * ct) / (n1 * ci + n2 * ct)) ** 2 +
      ((n1 * ct - n2 * ci) / (n1 * ct + n2 * ci)) ** 2) / 2;
  }
  function polygon(o) {
    let p;
    if (o.type === 'prism') p = [{ x: 0, y: -108 }, { x: 94, y: 55 }, { x: -94, y: 55 }];
    else if (o.type === 'mirror') p = [{ x: 0, y: -90 }, { x: 0, y: 90 }];
    else if (o.type === 'lens') {
      p = []; const h = 110, r = 230, cut = Math.sqrt(r * r - h * h);
      for (let i = 0; i <= 40; i++) { const y = -h + 2 * h * i / 40; p.push({ x: cut - Math.sqrt(r * r - y * y), y }); }
      for (let i = 39; i > 0; i--) { const y = -h + 2 * h * i / 40; p.push({ x: Math.sqrt(r * r - y * y) - cut, y }); }
    } else return [];
    const c = Math.cos(o.angle), s = Math.sin(o.angle), size = o.size || 1;
    return p.map(v => ({ x: o.x + size * (v.x * c - v.y * s), y: o.y + size * (v.x * s + v.y * c) }));
  }
  function contains(p, q) {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i], b = p[j];
      if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function intersect(p, d, a, b) {
    const e = { x: b.x - a.x, y: b.y - a.y }, delta = { x: a.x - p.x, y: a.y - p.y };
    const den = cross(d, e);
    if (Math.abs(den) < 1e-10) return null;
    const t = cross(delta, e) / den, u = cross(delta, d) / den;
    if (t <= EPS / 2 || u < -1e-9 || u > 1 + 1e-9) return null;
    let n = unit({ x: e.y, y: -e.x });
    if (dot(n, d) > 0) n = { x: -n.x, y: -n.y };
    return { t, n };
  }
  function trace(objects, source, options = {}) {
    const shapes = objects.map(o => ({ o, p: polygon(o) }));
    const bounds = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
    const segments = [], events = [];
    const wavelengths = options.wavelengths || (source.color === 'mono' ? [source.wavelength || 540] : Array.from({ length: 25 }, (_, i) => 400 + i * 12.5));
    const count = options.rays || 11, maxDepth = options.maxDepth || 18, maxSegments = options.maxSegments || 24000;
    const dispersion = options.dispersion ?? 1;
    function medium(p, nm) {
      for (let i = shapes.length - 1; i >= 0; i--) if (shapes[i].o.type !== 'mirror' && contains(shapes[i].p, p)) return index(nm, dispersion);
      return 1;
    }
    for (const wavelength of wavelengths) for (let beam = 0; beam < count; beam++) {
      const d = { x: Math.cos(source.angle), y: Math.sin(source.angle) };
      const offset = count === 1 ? 0 : ((beam / (count - 1)) - 0.5) * source.width;
      const start = { x: source.x - d.y * offset, y: source.y + d.x * offset };
      const stack = [{ p: start, d, energy: 1, depth: 0, distance: 0 }];
      while (stack.length && segments.length < maxSegments) {
        const ray = stack.pop();
        if (ray.depth >= maxDepth || ray.energy < 0.012) continue;
        let hit = null, target = null;
        for (let i = 0; i < 4; i++) { const h = intersect(ray.p, ray.d, bounds[i], bounds[(i + 1) % 4]); if (h && (!hit || h.t < hit.t)) { hit = h; target = null; } }
        for (const shape of shapes) for (let i = 0; i < (shape.o.type === 'mirror' ? 1 : shape.p.length); i++) {
          const h = intersect(ray.p, ray.d, shape.p[i], shape.p[(i + 1) % shape.p.length]);
          if (h && (!hit || h.t < hit.t - EPS)) { hit = h; target = shape; }
        }
        if (!hit) continue;
        const end = add(ray.p, ray.d, hit.t);
        segments.push({ a: ray.p, b: end, wavelength, energy: ray.energy, distance: ray.distance, depth: ray.depth });
        if (!target) continue;
        const n1 = medium(add(end, ray.d, -EPS), wavelength), n2 = medium(add(end, ray.d, EPS), wavelength);
        const transmitted = target.o.type === 'mirror' ? null : refract(ray.d, hit.n, n1, n2);
        const R = target.o.type === 'mirror' ? 0.96 : fresnel(ray.d, hit.n, n1, n2);
        events.push({ p: end, n: hit.n, n1, n2, wavelength, reflectance: R, type: target.o.type === 'mirror' ? 'mirror' : transmitted ? 'refraction' : 'tir' });
        const next = (dir, energy) => stack.push({ p: add(end, dir, EPS), d: dir, energy, depth: ray.depth + 1, distance: ray.distance + hit.t });
        if (transmitted) next(transmitted, ray.energy * (1 - R));
        if (!transmitted || options.reflections) next(reflect(ray.d, hit.n), ray.energy * R);
      }
    }
    return { segments, events, truncated: segments.length >= maxSegments };
  }
  function color(nm) {
    // A display approximation, not a calibrated spectral-to-sRGB conversion.
    let r = 0, g = 0, b = 0;
    if (nm < 440) { r = (440 - nm) / 60; b = 1; }
    else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
    else r = 1;
    return [r, g, b].map(v => Math.round(255 * Math.max(0, Math.min(1, v)) ** 0.8));
  }
  return { W, H, index, reflect, refract, fresnel, polygon, contains, intersect, trace, color };
});
