import { ENVIRONMENT } from './environment';

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
uniform float uGlyphSize;
uniform float uDpr;

uniform int uProfile;        // 0 squircle, 1 circle, 2 lip, 3 dome
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
uniform vec3 uLegibilityColor;
uniform float uLegibilityAmount;
uniform float uTintOpacity;
uniform float uDim;          // < 0 means automatic
uniform float uOpacity;
uniform float uShine;
uniform float uRim;
uniform float uRefl;
uniform int uEnvironment;    // 0 none, 1 auto, 2 studio
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
uniform float uWeight;       // grows the shape, in units of uUnit

// Set in main(): the drop shadow, so the glass can show its own shadow through its edge.
vec2 gShadowShift;
float gShadowBlur;
float gSelfShadow;   // strength of the shadow seen through the glass

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
  float convex = uProfile == 1 || uProfile == 3 ? sqrt(max(0.0, 1.0 - v * v)) : pow(max(0.0, 1.0 - v * v * v * v), 0.25);
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
  // Offsetting a distance field grows or shrinks the shape evenly, strokes and fills alike.
  return vec2(a.r - uWeight, max(a.g + uWeight, 0.002));
}

Layer makeLayer(float sd, vec2 g, float thick, float bevel, float aa) {
  Layer L;
  L.d = -sd;
  L.cover = 1.0 - smoothstep(-aa, aa, sd);
  L.g = g;
  // A stroke thinner than the bevel becomes a round tube of its own width.
  // A dome is round all the way across: its bevel is the whole half-width.
  float b = uProfile == 3 ? max(thick, 0.6) : max(min(bevel, thick), 0.6);
  float u = clamp(L.d / b, 0.0, 1.0);
  float lo = max(u - 0.02, 0.0), hi = min(u + 0.02, 1.0);
  float slope = (profile(hi) - profile(lo)) / (hi - lo);
  slope = clamp(slope, -5.0, 5.0) * uCurv * uLens;
  L.n = normalize(vec3(g * slope, 1.0));
  L.h = b * profile(u) * uCurv;
  L.edge = b;
  return L;
}

// The distance field folds along the middle of every stroke and along the bisector of
// every corner, so normals taken from it straight show sharp creases: a chiselled look.
// Real glass flows. The direction of the slope comes from the field averaged over a small
// ring; across a fold the two sides cancel, so the surface rounds over the ridge instead
// of breaking. The steepness still follows the profile at this point.
void smoothSurface(vec2 uv, inout Layer L) {
  float r = max(0.6 * L.edge, 0.8);
  vec2 dir = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 o = vec2(cos(a), sin(a));
    dir += fieldAt(uv + o * r / uCanvas).r * o;
  }
  dir *= 2.0 * uUnit / (8.0 * r);
  float m = length(dir);
  if (m > 1.0) dir /= m;
  float u = clamp(L.d / L.edge, 0.0, 1.0);
  float lo = max(u - 0.02, 0.0), hi = min(u + 0.02, 1.0);
  float slope = clamp((profile(hi) - profile(lo)) / (hi - lo), -5.0, 5.0) * uCurv * uLens;
  L.n = normalize(vec3(dir * slope, 1.0));
  // Shading and the rim light follow the same smoothed direction, fading out on the ridge.
  L.g = dir;
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

float shadowSeen(vec2 q);

// A dome is traced as a ball of glass of radius R floating uDepth above the page:
// light enters the upper surface, crosses the ball, leaves through the lower surface
// and lands on the page. Past the focal length the picture turns upside down, as in
// a real glass sphere. Returns where the page is seen, relative to the entry point.
vec2 domeOffset(Layer L, float ior) {
  float R = L.edge;
  float rho = clamp(R - max(L.d, 0.0), 0.0, R * 0.985); // distance from the ball's axis
  vec3 p1 = vec3(L.g * rho, sqrt(max(R * R - rho * rho, 0.0)));
  vec3 t1 = refract(vec3(0.0, 0.0, -1.0), p1 / R, 1.0 / ior);
  vec3 p2 = p1 - 2.0 * dot(p1, t1) * t1;
  vec3 t2 = refract(t1, -p2 / R, ior);
  if (dot(t2, t2) < 1e-6) { t2 = t1; } // total internal reflection near the rim
  float plane = -(R + uDepth);
  vec2 hit = p2.xy + t2.xy * (plane - p2.z) / min(t2.z, -0.15);
  return (hit - p1.xy) * uRefr * min(uCurv, 2.0) * uLens;
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
    vec2 offset = uProfile == 3 ? domeOffset(L, ior) : ray.xy / max(-ray.z, 0.3) * travel;
    // The glass casts a shadow; where the edge bends light outward it shows that shadow,
    // which is what outlines glass on a white page. Bands see it at slightly different
    // places, so the dark rim picks up colour fringes.
    vec2 q = p + offset;
    acc += sampleBack(q, blur) * (1.0 - gSelfShadow * shadowSeen(q)) * w;
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

${ENVIRONMENT}

vec3 lit(vec3 base, Layer L, vec3 ambient, float grain, float glow, float reflectivity, float bright) {
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
  // Over a bright page the edge reflects a neutral room, so it darkens a little instead of vanishing.
  vec3 env = mix(mix(ambient, vec3(1.0), 0.55), mix(vec3(0.55), ambient, 0.4), bright);
  vec3 room = env * (0.35 + 0.65 * smoothstep(-0.3, 0.9, dot(mirror, uLight)));
  if (gEnvironmentStrength > 0.0) {
    vec3 reflected = reflect(vec3(0.0, 0.0, -1.0), L.n);
    float roughness = clamp(uFrost / max(0.16 * uUnit, 0.001), 0.0, 1.0);
    room = mix(room, studioEnvironment(reflected, uLight, ambient, roughness), gEnvironmentStrength);
  }
  float k = clamp(fresnel * reflectivity, 0.0, 0.9) * uLens;
  float shade = 1.0 - 0.22 * exp(-max(L.d, 0.0) / (L.edge * 0.7 + 0.5)) * max(-facing, 0.0) * uLens * min(uCurv, 1.0);

  vec3 c = base * shade * (1.0 - k) + room * k;
  // Highlights take some colour from what is behind them rather than pure white.
  vec3 hl = mix(vec3(1.0), clamp(base * 1.25, 0.0, 1.0), 0.4);
  c += hl * (spec * 0.55 + rim * (0.75 + 1.5 * glow) + glow * 0.3) * uLens;
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

// The drop shadow at q, without the part hidden under the glass itself: a crescent
// on the far side from the light.
float shadowSeen(vec2 q) {
  vec2 c = q - 0.5 * uCanvas;
  float body, casted;
  if (uTile > 0.5) {
    vec2 g;
    body = tileDistance(c, g);
    casted = tileDistance(c - gShadowShift, g);
  } else {
    body = fieldAt(q / uCanvas).r * uUnit;
    casted = fieldAt((q - gShadowShift) / uCanvas).r * uUnit;
  }
  float s = 1.0 - smoothstep(-0.3 * gShadowBlur, gShadowBlur, casted);
  return s * smoothstep(-0.5, 0.06 * uUnit, body);
}

// The glass plate of a tile at q: what it refracts, graded and lit. With contact set, the
// icon's soft shadow on the plate is included.
vec3 plate(vec2 q, float aa, float dim, float bright, vec3 ambient, float grain, float glow, bool contact, out Layer tile) {
  vec2 tg;
  float tsd = tileDistance(q - 0.5 * uCanvas, tg);
  tile = makeLayer(tsd, tg, 0.5 * min(uBox.x, uBox.y), uTileBevel, aa);
  vec3 body = refracted(q, tile, uFrost * uLens);
  body = grade(body, dim, mix(uTint, vec3(1.0), uTintAuto), uTintOpacity);
  if (contact) {
    float d = fieldAt((q - gShadowShift * 0.5) / uCanvas).r * uUnit;
    body *= 1.0 - (0.22 + 0.2 * bright) * min(uShadow / 0.3, 1.5) * uGlyphOpacity * (1.0 - smoothstep(-0.01 * uUnit, 0.05 * uUnit, d)) * uLens;
  }
  return lit(body, tile, ambient, grain, glow, uRefl, bright);
}

void main() {
  vec2 p = vUv * uCanvas;
  vec2 c = p - 0.5 * uCanvas;
  float aa = 0.75 / uDpr;

  // The backdrop right under the icon decides light-on-dark or dark-on-light.
  float localLod = min(log2(max(uUnit * uBackDensity, 1.0)), uBackMaxLod);
  vec3 ambient = textureLod(uBack, backUv(0.5 * uCanvas), localLod).rgb;
  float bright = uScheme < 0.0 ? smoothstep(0.76, 0.9, luma(ambient)) : uScheme;
  // Detail under the icon: the difference between a sharp and a blurred look at it.
  float busy = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 o = i == 0 ? vec2(0.0) : 0.3 * uUnit * vec2(i == 1 ? 1.0 : i == 2 ? -1.0 : 0.0, i == 3 ? 1.0 : i == 4 ? -1.0 : 0.0);
    vec2 uv = backUv(0.5 * uCanvas + o);
    busy += abs(luma(textureLod(uBack, uv, max(localLod - 1.5, 0.0)).rgb) - luma(textureLod(uBack, uv, min(localLod + 1.0, uBackMaxLod)).rgb));
  }
  busy = clamp(busy * 0.8, 0.0, 1.0);
  gEnvironmentStrength = environmentStrength(uEnvironment, busy);
  // The 35% dimming is for busy bright content behind clear glass, not for a plain light page.
  float dim = uDim < 0.0 ? 0.35 * smoothstep(0.5, 0.85, luma(ambient)) * smoothstep(0.02, 0.25, busy) : uDim;
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
  // A mark on a tile is small; a wider bevel keeps it round and soft rather than a flat slab.
  Layer glyph = makeLayer(f.r * uUnit, g, f.g * uUnit, uTile > 0.5 ? uBevel * 2.2 : uBevel, fieldAa);
  // Past the bevel the top is flat, whatever the direction: nothing to smooth there.
  if (glyph.cover > 0.0 && glyph.d < glyph.edge + 1.0) smoothSurface(vUv, glyph);

  vec2 shadowShift = (vec2(0.0, 0.035) - uLight * 0.02) * uUnit;
  float shadowBlur = 0.07 * uUnit;
  gShadowShift = shadowShift;
  gShadowBlur = shadowBlur;
  gSelfShadow = clamp(uShadow * 1.4, 0.0, 0.7) * uLens;
  // Only small glyphs flip to dark ink on a bright page, as small system symbols do.
  float small = 1.0 - smoothstep(22.0, 34.0, uGlyphSize);

  vec3 color;
  float cover;
  float shadow;

  if (uTile > 0.5) {
    // The icon rests on the plate and casts a soft contact shadow onto it.
    Layer tile;
    vec3 body = plate(p, aa, dim, bright, ambient, grain, glow, true, tile);

    // The mark is a second layer of glass on the plate: it lenses the plate behind it
    // through its own curved surface, under a white, frosted body. Only tiny marks turn dark.
    Layer seen;
    vec3 bend = refract(vec3(0.0, 0.0, -1.0), glyph.n, 1.0 / uIor);
    vec2 lensed = p + bend.xy / max(-bend.z, 0.3) * (glyph.h + 0.06 * uUnit) * uRefr;
    vec3 through = plate(lensed, aa, dim, bright, ambient, grain, glow, false, seen);
    vec3 face = mix(mix(through, vec3(1.0), 0.35), mix(vec3(1.0), ink, small), 0.55 + 0.4 * small);
    vec3 mark = lit(face, glyph, ambient, 1.0, glow, uRefl * 0.6, bright);
    // Keep the plate optical; only its mark needs the small-icon contrast floor.
    if (uLegibilityAmount > 0.0) mark = mix(clamp(mark, 0.0, 1.0), uLegibilityColor, uLegibilityAmount * uLens);
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
    // Glass stays light on a light page. Small glyphs take on ink there, the way
    // small system symbols flip to dark.
    float inkiness = min(uTintOpacity + uTintAuto * small * (0.3 + 0.42 * bright), 1.0);
    body = grade(body, dim, mix(uTint, mix(vec3(1.0), ink, small), uTintAuto), inkiness);
    color = lit(body, glyph, ambient, grain, glow, uRefl, bright);
    if (uLegibilityAmount > 0.0) color = mix(clamp(color, 0.0, 1.0), uLegibilityColor, uLegibilityAmount * uLens);
    cover = glyph.cover;

    float ssd = fieldAt(vUv - shadowShift / uCanvas).r * uUnit;
    shadow = 1.0 - smoothstep(-0.3 * shadowBlur, shadowBlur, ssd);

    if (uHighContrast > 0.5) color = ink;
  }

  // Shadows are lighter over a plain light page.
  shadow *= uShadow * 0.55 * mix(1.0, 0.6, bright * (1.0 - busy)) * uLens * (1.0 - cover);
  // A thin dark contour just outside the edge, strongest where the highlight fades:
  // on a white page it is what draws the silhouette.
  {
    float sdOut = -(uTile > 0.5 ? -tileDistance(c, g) : glyph.d);
    vec2 og = uTile > 0.5 ? vec2(0.0) : glyph.g;
    if (uTile > 0.5) tileDistance(c, og);
    float facing = dot(og, uLight);
    float contour = 0.2 * min(uShadow / 0.3, 1.0) * bright * exp(-max(sdOut, 0.0) / (0.75 / uDpr + 0.4)) * (1.0 - cover) * (0.5 + 0.5 * (1.0 - facing)) * step(0.0, sdOut);
    shadow = max(shadow, contour * uLens);
  }
  // Mostly the bending of light brings the glass in; alpha only covers the last moment.
  float presence = clamp(uLens * 4.0, 0.0, 1.0) * uOpacity;
  outColor = vec4(clamp(color, 0.0, 1.0) * cover, cover + shadow) * presence;
}`;
