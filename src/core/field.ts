/**
 * Geometry for the glass material, computed once per icon on the CPU.
 *
 * Input: the alpha coverage of the rasterized SVG.
 * Output: two floats per pixel, both in units of `unit` (the icon's reference size):
 *   [0] signed distance to the shape edge (negative inside)
 *   [1] local thickness: radius of the largest inscribed disc covering the pixel
 *
 * The shader turns distance into height and normals, so bevel, curvature and
 * profile can change without coming back here.
 */

const FAR = 1e10;

/** 1D squared-distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = 0;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Exact Euclidean distance from every pixel to the nearest pixel where `sites` is non-zero. */
export function distanceToSites(sites: ArrayLike<number>, w: number, h: number): Float32Array {
  return finish(distanceSteps(sites, w, h));
}

function* distanceSteps(sites: ArrayLike<number>, w: number, h: number): Generator<void, Float32Array> {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const tmp = new Float64Array(w * h);
  const out = new Float32Array(w * h);

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = sites[y * w + x] ? 0 : FAR;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y];
    yield;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = tmp[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
    yield;
  }
  return out;
}

function* blur3(src: Float32Array, w: number, h: number): Generator<void, Float32Array> {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = src[x > 0 ? i - 1 : i];
      const r = src[x < w - 1 ? i + 1 : i];
      tmp[i] = (l + 2 * src[i] + r) * 0.25;
    }
    yield;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = tmp[y > 0 ? i - w : i];
      const d = tmp[y < h - 1 ? i + w : i];
      out[i] = (u + 2 * tmp[i] + d) * 0.25;
    }
    yield;
  }
  return out;
}

/**
 * Local thickness: for every inside pixel, the radius of the largest inscribed
 * disc that covers it. A thin stroke reports its own half-width everywhere, so
 * the shader can give it a round tube section; a large filled area reports a
 * large radius and gets a flat top with a bevel.
 *
 * Every ridge pixel q of the inside-distance field paints a disc of radius
 * d(q) with value d(q); pixels keep the maximum. A painted value can never
 * exceed the truth because each painted disc is itself inscribed.
 */
function* localThickness(dIn: Float32Array, inside: Uint8Array, w: number, h: number): Generator<void, Float32Array> {
  const step = Math.max(w, h) > 256 ? 2 : 1;
  const cw = Math.ceil(w / step);
  const ch = Math.ceil(h / step);
  const coarse = new Float32Array(cw * ch);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : dIn[y * w + x]);
  const pairs = [1, 0, 0, 1, 1, 1, 1, -1];

  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const x = Math.min(w - 1, cx * step);
      const y = Math.min(h - 1, cy * step);
      if (!inside[y * w + x]) continue;
      const d = dIn[y * w + x];
      let ridge = false;
      for (let k = 0; k < 8 && !ridge; k += 2) {
        const a = at(x + pairs[k] * step, y + pairs[k + 1] * step);
        const b = at(x - pairs[k] * step, y - pairs[k + 1] * step);
        // A maximum across one line: above one neighbour, not below the other.
        ridge = (d > a && d >= b) || (d > b && d >= a);
      }
      if (!ridge) continue;
      const r = d / step;
      const r2 = r * r;
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(cw - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const y1 = Math.min(ch - 1, Math.ceil(cy + r));
      for (let py = y0; py <= y1; py++) {
        const dy = py - cy;
        for (let px = x0; px <= x1; px++) {
          const dx = px - cx;
          if (dx * dx + dy * dy > r2) continue;
          const j = py * cw + px;
          if (coarse[j] < d) coarse[j] = d;
        }
        // A large inscribed disc must not monopolize a slice.
        yield;
      }
    }
    yield;
  }

  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      const c = coarse[Math.min(ch - 1, Math.round(y / step)) * cw + Math.min(cw - 1, Math.round(x / step))];
      out[i] = Math.max(c, dIn[i]);
    }
    yield;
  }
  return out;
}

/**
 * Build the two-channel geometry field from alpha coverage.
 * @param alpha coverage 0..1 (or 0..255 when given a Uint8 array), row-major, top row first
 * @param unit  reference size in raster pixels; outputs are divided by it
 */
export function buildField(alpha: ArrayLike<number>, w: number, h: number, unit: number): Float32Array {
  return finish(buildFieldSteps(alpha, w, h, unit));
}

function finish(work: Generator<void, Float32Array>): Float32Array {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

/** Small CPU steps shared by the synchronous helpers and the browser's sliced build. */
export function* buildFieldSteps(alpha: ArrayLike<number>, w: number, h: number, unit: number): Generator<void, Float32Array> {
  const scale = alpha instanceof Uint8Array || alpha instanceof Uint8ClampedArray ? 1 / 255 : 1;
  const inside = new Uint8Array(w * h);
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) {
    const on = alpha[i] * scale >= 0.5 ? 1 : 0;
    inside[i] = on;
    outside[i] = on ^ 1;
    if ((i & 2047) === 2047) yield;
  }
  const dIn = yield* distanceSteps(outside, w, h); // for inside pixels: distance to the nearest outside pixel
  const dOut = yield* distanceSteps(inside, w, h);

  let sd: Float32Array = new Float32Array(w * h);
  for (let i = 0; i < sd.length; i++) {
    const a = alpha[i] * scale;
    let v = inside[i] ? -(Math.min(dIn[i], FAR) - 0.5) : Math.min(dOut[i], w + h) - 0.5;
    // Antialiased edge pixels know where the edge is to sub-pixel precision.
    if (a > 0.02 && a < 0.98 && Math.abs(v) <= 1) v = 0.5 - a;
    sd[i] = v;
    if ((i & 2047) === 2047) yield;
  }
  sd = yield* blur3(sd, w, h);

  // Shapes that touch nothing (empty raster) would otherwise report FAR.
  for (let i = 0; i < dIn.length; i++) {
    if (dIn[i] > w + h) dIn[i] = w + h;
    if ((i & 2047) === 2047) yield;
  }
  const thickness = yield* localThickness(dIn, inside, w, h);
  const thick = yield* blur3(thickness, w, h);

  const out = new Float32Array(w * h * 2);
  const inv = 1 / unit;
  for (let i = 0; i < sd.length; i++) {
    out[i * 2] = sd[i] * inv;
    out[i * 2 + 1] = Math.max(thick[i], 0.5) * inv;
    if ((i & 2047) === 2047) yield;
  }
  return out;
}
