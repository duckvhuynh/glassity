/** Procedural room radiance, shared by glyphs and glass plates. */
export const ENVIRONMENT = /* glsl */ `
float gEnvironmentStrength;

float environmentStrength(int mode, float detail) {
  if (mode == 0) return 0.0;
  if (mode == 2) return 1.0;
  // Only nearly uniform backdrops get the full studio; photos keep their own light.
  float flatness = 1.0 - smoothstep(0.0, 0.025, detail);
  return flatness * flatness * flatness;
}

vec3 studioEnvironment(vec3 direction, vec2 light, vec3 ambient, float roughness) {
  // Project the reflected ray onto a tall window facing the key light.
  vec3 keyAxis = normalize(vec3(light, 0.25));
  vec3 across = vec3(-light.y, light.x, 0.0);
  vec3 up = cross(keyAxis, across);
  float facing = dot(direction, keyAxis);
  vec2 windowUv = vec2(dot(direction, across), dot(direction, up)) / max(facing, 0.15);
  float soft = mix(0.12, 0.6, roughness);
  vec2 edge = abs(windowUv) - vec2(0.65, 1.4);
  float key = (1.0 - smoothstep(-soft, soft, max(edge.x, edge.y))) * smoothstep(0.0, 0.25, facing);

  // The opposite wall is a larger, dimmer source, with no hard outline.
  vec3 fillAxis = normalize(vec3(-light, -0.15));
  float fill = smoothstep(mix(0.1, -0.35, roughness), 0.95, dot(direction, fillAxis));
  float horizon = 1.0 - smoothstep(0.08, mix(0.3, 0.55, roughness), abs(direction.y - 0.08));
  vec3 room = mix(vec3(0.16), ambient, 0.35) * (1.0 - 0.65 * horizon);
  // The backdrop supplies the colour cast; frost spreads the window and lowers its peak.
  room += mix(vec3(1.0), ambient, 0.18) * key * mix(2.4, 1.7, roughness);
  room += mix(vec3(0.7), ambient, 0.3) * fill * 0.35;
  // A window can be brighter than display white; the surface still applies Fresnel.
  return clamp(room, 0.0, 2.0);
}
`;
