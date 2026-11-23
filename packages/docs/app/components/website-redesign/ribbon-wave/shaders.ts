import { RIBBON_FINISH } from "./presets";

// Shared by the sheet's vertex and fragment stages: the motion and the fibres
// must sample the same noise field. The lattice hash keys on the float bits of
// each cell corner, so it needs GLSL ES 3.00 (WebGL2).
const noiseChunk = /* glsl */ `
uint rotl17(uint v) {
  return (v << 17u) | (v >> 15u);
}

uint avalanche(uint h) {
  h = (h ^ (h >> 15u)) * 0x85ebca77u;
  h = (h ^ (h >> 13u)) * 0xc2b2ae3du;
  return h ^ (h >> 16u);
}

vec2 cornerGradient(vec2 corner) {
  uvec2 bits = floatBitsToUint(corner);
  uint h = rotl17(bits.x * 0xc2b2ae3du + 0x165667b9u) * 0x27d4eb2fu;
  h = rotl17(h + bits.y * 0xc2b2ae3du) * 0x27d4eb2fu;
  float unit = uintBitsToFloat((avalanche(h) >> 9u) | 0x3f800000u) - 1.0;
  float angle = 6.283185307 * unit;
  return vec2(cos(angle), sin(angle));
}

float simplex(vec2 p) {
  const float SKEW = 0.366025404;
  const float UNSKEW = 0.211324865;
  vec2 cell = floor(p + (p.x + p.y) * SKEW);
  vec2 d0 = p - cell + (cell.x + cell.y) * UNSKEW;
  vec2 step1 = d0.x >= d0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 d1 = d0 - step1 + UNSKEW;
  vec2 d2 = d0 - 1.0 + 2.0 * UNSKEW;
  vec3 falloff = max(0.5 - vec3(dot(d0, d0), dot(d1, d1), dot(d2, d2)), 0.0);
  vec3 ramps = vec3(
    dot(d0, cornerGradient(cell)),
    dot(d1, cornerGradient(cell + step1)),
    dot(d2, cornerGradient(cell + 1.0))
  );
  return 32.99 * dot(falloff * falloff * falloff, ramps);
}

vec3 turnAbout(vec3 p, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}
`;

export const sheetVertexShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec3 a_position;
in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_viewProjection;
uniform float u_phase;
uniform vec2 u_displaceFrequency;
uniform float u_displaceAmount;
// x: along the sheet (v), y: across it (u), z: lengthwise second pass (v).
uniform vec3 u_twistAngle;
uniform vec3 u_twistFalloff;

out vec2 v_uv;

${noiseChunk}

float twistWeight(float x, float n) {
  return exp2(-exp2(n) * pow(x, n));
}

const vec3 DIAGONAL_XZ = vec3(0.70710678, 0.0, 0.70710678);
const vec3 DIAGONAL_YZ = vec3(0.0, 0.70710678, 0.70710678);

void main() {
  vec3 p = a_position;
  p.y += u_displaceAmount * simplex(vec2(
    p.x * u_displaceFrequency.x + u_phase,
    p.z * u_displaceFrequency.y + u_phase
  ));
  p = turnAbout(p, DIAGONAL_XZ, u_twistAngle.y * twistWeight(a_uv.x, u_twistFalloff.y));
  p = turnAbout(p, DIAGONAL_YZ, u_twistAngle.x * twistWeight(a_uv.y, u_twistFalloff.x));
  p = turnAbout(p, DIAGONAL_XZ, u_twistAngle.z * twistWeight(a_uv.y, u_twistFalloff.z));

  v_uv = a_uv;
  gl_Position = u_viewProjection * u_model * vec4(p, 1.0);
}
`;

export const sheetFragmentShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;

uniform sampler2D u_palette;
uniform float u_drawingHeight;
// amount, power, ramp
uniform vec3 u_glow;
// strength, frequency, blue damping, edge power
uniform vec4 u_fibres;
// contrast, saturation, hue turn
uniform vec3 u_grade;
uniform float u_faceLift;

out vec4 fragColor;

${noiseChunk}

void main() {
  // Where the sheet turns edge-on, v changes fast down the screen and the
  // colour comes through; where it faces the camera it washes out.
  float edgeOn = clamp(dFdy(v_uv).y * u_drawingHeight * u_glow.x * 0.5 + 0.5, 0.0, 1.0);
  edgeOn = smoothstep(0.0, u_glow.z, pow(edgeOn, u_glow.y));

  vec3 color = texture(u_palette, v_uv).rgb;

  float drift = simplex(v_uv * vec2(0.1, 0.5));
  float fibre = 0.5 + 0.5 * simplex(vec2(
    v_uv.x * u_fibres.y * (1.0 + 0.5 * drift),
    v_uv.y * 4.0 * drift
  ));
  float centreFade = 1.0 - pow(4.0 * v_uv.x * (1.0 - v_uv.x), u_fibres.w);
  color += fibre * u_fibres.x * (1.0 - color.b * u_fibres.z) * edgeOn * centreFade;

  color = (color - 0.5) * u_grade.x + 0.5;
  color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, u_grade.y);
  color = turnAbout(color, vec3(0.57735027), u_grade.z);

  color = clamp(color + (1.0 - edgeOn) * u_faceLift, 0.0, 1.0);
  fragColor = vec4(color * color, 1.0);
}
`;

export const finishVertexShader = /* glsl */ `#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  // One oversized triangle covers the viewport.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const finishFragmentShader = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_scene;
uniform float u_blurAngle;
uniform float u_grain;

out vec4 fragColor;

const int TAPS = ${RIBBON_FINISH.blurTaps};

void main() {
  float stepAngle = u_blurAngle / float(TAPS);
  mat2 spin = mat2(cos(stepAngle), -sin(stepAngle), sin(stepAngle), cos(stepAngle));
  vec2 offset = v_uv - 0.5;
  vec4 smeared = vec4(0.0);
  for (int i = 0; i < TAPS; i++) {
    smeared += texture(u_scene, offset + 0.5);
    offset = spin * offset;
  }
  smeared /= float(TAPS);

  // Sharp through the middle band, smeared toward the top and bottom.
  float sharpness = smoothstep(0.0, 0.7, v_uv.y) - smoothstep(0.2, 1.0, v_uv.y);
  vec4 color = mix(smeared, texture(u_scene, v_uv), sharpness);

  float dither = fract(sin(dot(gl_FragCoord.xy * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
  color.rgb += mix(u_grain, -u_grain, dither) * (4.0 / 255.0);
  fragColor = vec4(min(color.rgb, 1.0), color.a);
}
`;
