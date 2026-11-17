export const VERTEX = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(pos.x, 1.0 - pos.y); // origin top-left, like the DOM
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * One pass per icon. All lengths are CSS pixels unless noted; the origin is
 * the top-left of the icon's canvas with y pointing down.
 */
export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uFieldA;   // RG: signed distance, local thickness (units of uUnit)
uniform sampler2D uFieldB;   // morph target
uniform float uMorph;
uniform vec2 uFieldTexel;

uniform sampler2D uBack;
uniform vec4 uBackRect;      // backdrop x, y, w, h relative to this canvas
uniform float uBackDensity;  // backdrop texels per CSS px
uniform float uBackMaxLod;

uniform vec2 uCanvas;
uniform vec2 uBox;
uniform float uUnit;
uniform float uDpr;

uniform int uProfile;        // 0 squircle, 1 circle, 2 lip
uniform float uBevel;
uniform float uCurv;
uniform float uDepth;
uniform float uIor;
uniform float uRefr;
uniform float uDisp;
uniform int uBands;
uniform float uFrost;
uniform float uSat;
uniform float uBright;
uniform float uContrast;
uniform vec3 uTint;
uniform float uTintAuto;
uniform float uTintOpacity;
uniform float uDim;          // < 0 means automatic
uniform float uOpacity;
uniform float uShine;
uniform float uRim;
uniform float uRefl;
uniform float uShadow;
uniform vec2 uLight;         // unit vector towards the light
uniform float uScheme;       // -1 automatic, 0 dark page, 1 light page
uniform float uLens;         // 0 = not there yet, 1 = fully materialised
uniform vec3 uTouch;         // x, y, strength
uniform float uTile;
uniform float uTileRadius;
uniform float uTileBevel;
uniform float uGlyphOpacity;
uniform float uHighContrast;
uniform float uSeed;

struct Layer {
  float d;      // distance inside the edge
  float cover;  // antialiased coverage
  vec2 g;       // outward direction
  vec3 n;       // surface normal
  float h;      // surface height
  float edge;   // effective bevel width
};

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Height of the edge cross-section: 0 at the rim, rising over the bevel.
float profile(float u) {
  float v = 1.0 - clamp(u, 0.0, 1.0);
  float convex = uProfile == 1 ? sqrt(max(0.0, 1.0 - v * v)) : pow(max(0.0, 1.0 - v * v * v * v), 0.25);
  if (uProfile != 2) return convex;
  float t = u * u * u * (u * (u * 6.0 - 15.0) + 10.0);
  return mix(convex, 1.0 - convex, clamp(t, 0.0, 1.0)) * 1.6;
}

vec2 fieldAt(vec2 uv) {
  vec2 a = texture(uFieldA, uv).rg;
  if (uMorph > 0.001) {
    a = mix(a, texture(uFieldB, uv).rg, uMorph);
    // Halfway between two outlines thin strokes cancel out and the shape would
    // break into specks. Swelling it mid-way keeps one liquid body.
    float swell = 4.0 * uMorph * (1.0 - uMorph);
    a.r -= 0.035 * swell;
    a.g += 0.035 * swell;
  }
  return a;
}

Layer makeLayer(float sd, vec2 g, float thick, float bevel, float aa) {
  Layer L;
  L.d = -sd;
  L.cover = 1.0 - smoothstep(-aa, aa, sd);
  L.g = g;
  // A stroke thinner than the bevel becomes a round tube of its own width.
  float b = max(min(bevel, thick), 0.6);
  float u = clamp(L.d / b, 0.0, 1.0);
  float lo = max(u - 0.02, 0.0), hi = min(u + 0.02, 1.0);
  float slope = (profile(hi) - profile(lo)) / (hi - lo);
  slope = clamp(slope, -5.0, 5.0) * uCurv * uLens;
  L.n = normalize(vec3(g * slope, 1.0));
  L.h = b * profile(u) * uCurv;
  L.edge = b;
  return L;
}

vec2 backUv(vec2 p) { return (p - uBackRect.xy) / uBackRect.zw; }

vec3 sampleBack(vec2 p, float blur) {
  float lod = max(log2(max(blur * uBackDensity, 1.0)), log2(max(uBackDensity / uDpr, 1.0)));
  vec2 uv = backUv(p);
  if (blur < 0.5) return textureLod(uBack, uv, min(lod, uBackMaxLod)).rgb;
  // Four taps one level sharper hide the blocky look of a single mip sample.
  lod = min(max(lod - 1.0, 0.0), uBackMaxLod);
  vec2 r = vec2(blur * 0.5) / uBackRect.zw;
  vec3 c = textureLod(uBack, uv + r * vec2(0.92, 0.38), lod).rgb;
  c += textureLod(uBack, uv + r * vec2(-0.38, 0.92), lod).rgb;
  c += textureLod(uBack, uv + r * vec2(-0.92, -0.38), lod).rgb;
  c += textureLod(uBack, uv + r * vec2(0.38, -0.92), lod).rgb;
  return c * 0.25;
}

// What is seen through the surface. Each wavelength band has its own index of
// refraction, so colours separate where the surface is steep.
vec3 refracted(vec2 p, Layer L, float blur) {
  vec3 acc = vec3(0.0);
  vec3 weights = vec3(0.0);
  float travel = (L.h + uDepth) * uRefr;
  for (int i = 0; i < uBands; i++) {
    float s = uBands > 1 ? float(i) / float(uBands - 1) : 0.5;
    vec3 w = uBands > 1 ? clamp(1.5 - abs(4.0 * s - vec3(1.0, 2.0, 3.0)), 0.0, 1.0) + 0.03 : vec3(1.0);
    float ior = uIor + (s - 0.5) * 0.16 * uDisp; // shorter wavelengths bend more
    vec3 ray = refract(vec3(0.0, 0.0, -1.0), L.n, 1.0 / ior);
    vec2 offset = ray.xy / max(-ray.z, 0.3) * travel;
    acc += sampleBack(p + offset, blur) * w;
    weights += w;
  }
  return acc / weights;
}

vec3 grade(vec3 c, float dim, vec3 tint, float tintOpacity) {
  c = mix(vec3(luma(c)), c, mix(1.0, uSat, uLens));
  c = (c - 0.5) * mix(1.0, uContrast, uLens) + 0.5;
  c *= mix(1.0, uBright, uLens) * (1.0 - dim * uLens);
  c = mix(c, tint, tintOpacity * uLens);
  return clamp(c, 0.0, 1.0);
}

vec3 lit(vec3 base, Layer L, vec3 ambient, float grain, float glow, float reflectivity) {
  vec3 toLight = normalize(vec3(uLight, 0.85));
  vec3 halfway = normalize(toLight + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(L.n, halfway), 0.0), 60.0) * uShine;

  // A thin bright line along the edge: strong where the edge faces the light,
  // fainter on the far side, as on real glass.
  float facing = dot(L.g, uLight);
  float band = exp(-max(L.d, 0.0) / (0.9 + 0.012 * uUnit));
  float rim = band * (0.16 + 0.84 * pow(max(facing, 0.0), 1.4) + 0.5 * pow(max(-facing, 0.0), 2.2)) * uRim * grain;

  float fresnel = 0.04 + 0.96 * pow(1.0 - L.n.z, 5.0);
  vec2 mirror = L.n.xy * (2.0 * L.n.z);
  vec3 room = mix(ambient, vec3(1.0), 0.55) * (0.35 + 0.65 * smoothstep(-0.3, 0.9, dot(mirror, uLight)));
  float k = clamp(fresnel * reflectivity, 0.0, 0.9) * uLens;
  float shade = 1.0 - 0.22 * exp(-max(L.d, 0.0) / (L.edge * 0.7 + 0.5)) * max(-facing, 0.0) * uLens * min(uCurv, 1.0);

  vec3 c = base * shade * (1.0 - k) + room * k;
  c += (spec * 0.55 + rim * (0.75 + 1.5 * glow) + glow * 0.3) * uLens;
  return c;
}

float tileDistance(vec2 c, out vec2 g) {
  vec2 halfBox = 0.5 * uBox;
  float r = min(uTileRadius, min(halfBox.x, halfBox.y));
  vec2 q = abs(c) - (halfBox - r);
  vec2 s = vec2(c.x < 0.0 ? -1.0 : 1.0, c.y < 0.0 ? -1.0 : 1.0);
  g = s * (q.x > 0.0 && q.y > 0.0 ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vUv * uCanvas;
  vec2 c = p - 0.5 * uCanvas;
  float aa = 0.75 / uDpr;

  // The backdrop right under the icon decides light-on-dark or dark-on-light.
  float localLod = min(log2(max(uUnit * uBackDensity, 1.0)), uBackMaxLod);
  vec3 ambient = textureLod(uBack, backUv(0.5 * uCanvas), localLod).rgb;
  float bright = uScheme < 0.0 ? smoothstep(0.76, 0.9, luma(ambient)) : uScheme;
  float dim = uDim < 0.0 ? 0.35 * smoothstep(0.5, 0.85, luma(ambient)) : uDim;
  vec3 ink = mix(vec3(1.0), vec3(0.05, 0.06, 0.08), bright);

  float grain = 0.86 + 0.14 * vnoise(p * 0.09 + uSeed);
  vec2 toTouch = p - uTouch.xy;
  float glow = uTouch.z * exp(-dot(toTouch, toTouch) / (0.2 * uUnit * uUnit));

  // Icon surface from the distance field.
  vec2 f = fieldAt(vUv);
  vec2 e = uFieldTexel * 1.5;
  vec2 grad = vec2(
    fieldAt(vUv + vec2(e.x, 0.0)).r - fieldAt(vUv - vec2(e.x, 0.0)).r,
    fieldAt(vUv + vec2(0.0, e.y)).r - fieldAt(vUv - vec2(0.0, e.y)).r);
  vec2 g = dot(grad, grad) > 1e-12 ? normalize(grad) : vec2(0.0);
  float fieldAa = max(aa, 0.6 * uFieldTexel.x * uCanvas.x);
  Layer glyph = makeLayer(f.r * uUnit, g, f.g * uUnit, uBevel, fieldAa);

  vec2 shadowShift = (vec2(0.0, 0.035) - uLight * 0.02) * uUnit;
  float shadowBlur = 0.07 * uUnit;

  vec3 color;
  float cover;
  float shadow;

  if (uTile > 0.5) {
    vec2 tg;
    float tsd = tileDistance(c, tg);
    Layer tile = makeLayer(tsd, tg, 0.5 * min(uBox.x, uBox.y), uTileBevel, aa);

    vec3 body = refracted(p, tile, uFrost * uLens);
    body = grade(body, dim, mix(uTint, vec3(1.0), uTintAuto), uTintOpacity);
    // The icon rests on the plate and casts a soft contact shadow onto it.
    float contact = fieldAt(vUv - shadowShift * 0.5 / uCanvas).r * uUnit;
    body *= 1.0 - 0.22 * uShadow * uGlyphOpacity * (1.0 - smoothstep(-0.01 * uUnit, 0.05 * uUnit, contact)) * uLens;
    body = lit(body, tile, ambient, grain, glow, uRefl);

    vec3 mark = lit(ink, glyph, ambient, 1.0, glow, uRefl * 0.35);
    color = mix(body, mark, glyph.cover * uGlyphOpacity * uLens);
    cover = tile.cover;

    vec2 sg;
    float ssd = tileDistance(c - shadowShift, sg);
    shadow = 1.0 - smoothstep(-0.3 * shadowBlur, shadowBlur, ssd);

    if (uHighContrast > 0.5) {
      vec3 plate = mix(vec3(0.04), vec3(1.0), bright);
      vec3 line = mix(vec3(1.0), vec3(0.0), bright);
      color = mix(plate, line, max(glyph.cover, 1.0 - smoothstep(1.0, 1.5, tile.d)));
    }
  } else {
    vec3 body = refracted(p, glyph, uFrost * uLens);
    // Clear glass vanishes on a bright page and in small sizes. With an automatic
    // tint the body takes on more ink there, the way small system glyphs flip to dark.
    float small = 1.0 - smoothstep(22.0, 56.0, uUnit);
    float inkiness = min(uTintOpacity + uTintAuto * (0.42 * bright + 0.3 * small), 1.0);
    body = grade(body, dim, mix(uTint, ink, uTintAuto), inkiness);
    color = lit(body, glyph, ambient, grain, glow, uRefl);
    // A darker line right at the edge keeps the outline readable on light backdrops.
    color *= 1.0 - 0.32 * bright * exp(-max(glyph.d, 0.0) / 1.4) * uLens;
    cover = glyph.cover;

    float ssd = fieldAt(vUv - shadowShift / uCanvas).r * uUnit;
    shadow = 1.0 - smoothstep(-0.3 * shadowBlur, shadowBlur, ssd);

    if (uHighContrast > 0.5) color = ink;
  }

  shadow *= uShadow * 0.55 * uLens * (1.0 - cover);
  // Mostly the bending of light brings the glass in; alpha only covers the last moment.
  float presence = clamp(uLens * 4.0, 0.0, 1.0) * uOpacity;
  outColor = vec4(clamp(color, 0.0, 1.0) * cover, cover + shadow) * presence;
}`;
