import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type {
  EffectColor,
  EffectDefinition,
  EffectPreset,
  EffectValue,
} from "./native-effects";

type Draft = {
  id: string;
  name: string;
  mechanism: string;
  complexity: string;
  properties: EffectDefinition["properties"];
  body: string;
  looks: readonly [
    { name: string; params: Record<string, EffectValue> },
    { name: string; params: Record<string, EffectValue> },
  ];
};
const color = (r: number, g: number, b: number, alpha = 1): EffectColor => ({
  space: "srgb",
  components: [r, g, b],
  alpha,
});
const float = (
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
) => ({ type: "float" as const, label, default: value, min, max, step });
const helper = `
fn cellHash(p:vec2f)->f32{return fract(sin(dot(p,vec2f(127.41,219.73)))*48271.37);}
fn colorOver(base:vec4f, top:vec4f)->vec4f{return top+base*(1.0-top.a);}
`;
const drafts: readonly Draft[] = [
  {
    id: "masonry-bond",
    name: "Masonry Bond",
    mechanism:
      "Alternating offset courses cut independent rectangular brick interiors and mortar, with cell-local worn edges.",
    complexity: "One fragment, one cell hash, no texture or feedback.",
    properties: {
      mortar: {
        type: "color",
        label: "Mortar",
        default: color(0.11, 0.12, 0.13),
      },
      brick: {
        type: "color",
        label: "Brick",
        default: color(0.54, 0.18, 0.12),
      },
      courses: float("Courses", 9, 3, 24, 1),
      joint: float("Joint width", 0.035, 0.005, 0.12, 0.001),
      stagger: float("Course offset", 0.5, 0, 1, 0.01),
      wear: float("Edge wear", 0.035, 0, 0.15, 0.001),
    },
    body: `let aspect=globals.viewport.x/max(globals.viewport.y,1.0);
let course=globals.params[2].x;
let q=input.uv*vec2f(course*aspect*.5,course);
let row=floor(q.y);
let x=q.x+select(0.0,globals.params[4].x,u32(abs(row))%2u==1u);
let cell=vec2f(floor(x),row);let local=vec2f(fract(x),fract(q.y));
let edge=min(min(local.x,1.0-local.x),min(local.y,1.0-local.y));
let worn=globals.params[5].x*(cellHash(cell*1.7+vec2f(local.y*13.0,local.x*9.0))-.5);
let feather=max(1.0/min(globals.viewport.x,globals.viewport.y),.0005);
let brickMask=smoothstep(globals.params[3].x+worn,globals.params[3].x+worn+feather,edge);
let tone=.8+.2*cellHash(cell);
let alpha=mix(globals.params[0].a,globals.params[1].a,brickMask);
let rgb=mix(globals.params[0].rgb,globals.params[1].rgb*tone,brickMask);
return vec4f(rgb*alpha,alpha);`,
    looks: [
      {
        name: "Warm Bond",
        params: { courses: 9, joint: 0.035, stagger: 0.5, wear: 0.035 },
      },
      {
        name: "Pale Stack",
        params: {
          mortar: color(0.2, 0.23, 0.23),
          brick: color(0.71, 0.68, 0.58),
          courses: 14,
          joint: 0.018,
          stagger: 0.25,
          wear: 0.065,
        },
      },
    ],
  },
  {
    id: "sand-ripple-bed",
    name: "Sand Ripple Bed",
    mechanism:
      "Oblique wind courses use asymmetric crest and lee-face slopes with slope-derived shading.",
    complexity:
      "One fragment, analytic periodic phase and slope; no texture or feedback.",
    properties: {
      sand: { type: "color", label: "Sand", default: color(0.64, 0.43, 0.23) },
      crest: {
        type: "color",
        label: "Crest",
        default: color(0.97, 0.79, 0.45),
      },
      density: float("Ripple density", 13, 3, 32, 0.1),
      slant: float("Wind slant", 0.28, -1, 1, 0.01),
      sharpness: float("Crest sharpness", 4, 1, 12, 0.1),
      light: float("Light direction", 0.7, -1, 1, 0.01),
    },
    body: `let q=input.uv*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0);
let phase=fract((q.x+q.y*globals.params[3].x)*globals.params[2].x+.055*sin(q.y*20.0));
let rise=pow(clamp(phase/.72,0.0,1.0),globals.params[4].x);
let fall=clamp((1.0-phase)/.28,0.0,1.0);
let height=select(fall,rise,phase<.72);
let slope=select(-1.0/.28,globals.params[4].x*pow(max(phase/.72,.0001),globals.params[4].x-1.0)/.72,phase<.72);
let facing=clamp(.58+.42*slope*globals.params[5].x,0.0,1.0);
let field=clamp(height*.55+facing*.45,0.0,1.0);
let alpha=mix(globals.params[0].a,globals.params[1].a,field);
let rgb=mix(globals.params[0].rgb,globals.params[1].rgb,field);
return vec4f(rgb*alpha,alpha);`,
    looks: [
      {
        name: "Morning Dunes",
        params: { density: 13, slant: 0.28, sharpness: 4, light: 0.7 },
      },
      {
        name: "Cool Wind Bed",
        params: {
          sand: color(0.21, 0.3, 0.36),
          crest: color(0.72, 0.82, 0.84),
          density: 20,
          slant: -0.42,
          sharpness: 7,
          light: -0.65,
        },
      },
    ],
  },
  {
    id: "sierpinski-gasket",
    name: "Triangular Lacunae",
    mechanism:
      "Iterative barycentric corner selection removes the central inverted triangle at each requested depth.",
    complexity: "One fragment, at most seven bounded barycentric iterations.",
    properties: {
      field: {
        type: "color",
        label: "Field",
        default: color(0.025, 0.045, 0.1),
      },
      triangle: {
        type: "color",
        label: "Triangle",
        default: color(0.22, 0.85, 0.7),
      },
      depth: float("Subdivision depth", 5, 1, 7, 1),
      size: float("Triangle size", 0.78, 0.25, 1.5, 0.01),
      rotation: float("Rotation", 0, -180, 180, 1),
    },
    body: `let angle=globals.params[4].x*.01745329252;let ca=cos(angle);let sa=sin(angle);
let centered=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0)/globals.params[3].x;
let p=vec2f(centered.x*ca-centered.y*sa,centered.x*sa+centered.y*ca);
var a=(.4-p.y)/.8660254;var b=p.x+.5-.5*a;var c=1.0-a-b;
let initial=min(a,min(b,c));var retained=initial>=0.0;
for(var level=0u;level<7u;level+=1u){
 if(level>=u32(round(globals.params[2].x))){break;}
 if(a>=.5){a=2.0*a-1.0;b*=2.0;c*=2.0;}
 else if(b>=.5){b=2.0*b-1.0;a*=2.0;c*=2.0;}
 else if(c>=.5){c=2.0*c-1.0;a*=2.0;b*=2.0;}
 else {retained=false;break;}
}
let pixel=max(1.0/min(globals.viewport.x,globals.viewport.y),.0005);
let outer=smoothstep(-pixel,pixel,initial);
let field=select(0.0,outer,retained);
let alpha=mix(globals.params[0].a,globals.params[1].a,field);
let rgb=mix(globals.params[0].rgb,globals.params[1].rgb,field);
return vec4f(rgb*alpha,alpha);`,
    looks: [
      { name: "Sea Glass", params: { depth: 5, size: 0.78, rotation: 0 } },
      {
        name: "Copper Lacunae",
        params: {
          field: color(0.11, 0.035, 0.025),
          triangle: color(1, 0.57, 0.24),
          depth: 7,
          size: 1.05,
          rotation: 18,
        },
      },
    ],
  },
  {
    id: "polarized-light-sheets",
    name: "Polarized Light Sheets",
    mechanism:
      "Two oriented spatial sheets interact through a squared angular transmission term, separating sheet geometry from polarization attenuation.",
    complexity:
      "One fragment, two analytic stripe fields and a squared angular projection.",
    properties: {
      ground: {
        type: "color",
        label: "Ground",
        default: color(0.018, 0.025, 0.08),
      },
      sheetA: {
        type: "color",
        label: "First sheet",
        default: color(0.18, 0.66, 0.96, 0.65),
      },
      sheetB: {
        type: "color",
        label: "Second sheet",
        default: color(0.95, 0.29, 0.72, 0.65),
      },
      angleA: float("First angle", 25, -180, 180, 1),
      angleB: float("Second angle", -40, -180, 180, 1),
      density: float("Sheet density", 8, 2, 24, 0.1),
      contrast: float("Transmission contrast", 0.8, 0, 1, 0.01),
    },
    body: `let a=globals.params[3].x*.01745329252;let b=globals.params[4].x*.01745329252;
let q=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0);
let waveA=pow(.5+.5*sin(dot(q,vec2f(cos(a),sin(a)))*globals.params[5].x*6.2831853),2.0);
let waveB=pow(.5+.5*sin(dot(q,vec2f(cos(b),sin(b)))*globals.params[5].x*6.2831853),2.0);
let transmission=pow(cos(a-b),2.0);
let overlap=mix(1.0,transmission,globals.params[6].x*globals.params[1].a*waveA);
let first=vec4f(globals.params[1].rgb*globals.params[1].a*waveA,globals.params[1].a*waveA);
let second=vec4f(globals.params[2].rgb*globals.params[2].a*waveB*overlap,globals.params[2].a*waveB*overlap);
let base=vec4f(globals.params[0].rgb*globals.params[0].a,globals.params[0].a);
return colorOver(colorOver(base,first),second);`,
    looks: [
      {
        name: "Crossed Sheets",
        params: { angleA: 25, angleB: -40, density: 8, contrast: 0.8 },
      },
      {
        name: "Parallel Sheets",
        params: {
          ground: color(0.025, 0.06, 0.085),
          sheetA: color(0.14, 0.81, 0.73, 0.7),
          sheetB: color(0.96, 0.75, 0.28, 0.55),
          angleA: 12,
          angleB: 18,
          density: 13,
          contrast: 1,
        },
      },
    ],
  },
];
function buildDefinition(draft: Draft): EffectDefinition {
  return {
    id: `an-native-owned-breadth-${draft.id}`,
    name: draft.name,
    version: 1,
    kind: "generator",
    placements: ["fill"],
    properties: draft.properties,
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    resources: [
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    output: "color",
    passes: [
      {
        id: "render",
        kind: "render",
        reads: [],
        output: "color",
        wgsl:
          NATIVE_RENDER_GLOBALS +
          helper +
          `\n@fragment fn fs(input:VertexOutput)->@location(0) vec4f{${draft.body}\n}`,
      },
    ],
    provenance: {
      origin: "design-original",
      note: `Independent Design ${draft.mechanism}`,
    },
  };
}
export const BREADTH_B_DRAFTS = drafts;
export const BREADTH_B_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(buildDefinition);
export const BREADTH_B_PRESETS: readonly EffectPreset[] = drafts.flatMap(
  (draft) =>
    draft.looks.map((look, index) => ({
      id: `an-preset-owned-breadth-${draft.id}-${index + 1}`,
      name: look.name,
      definitionId: `an-native-owned-breadth-${draft.id}`,
      definitionVersion: 1,
      placement: "fill" as const,
      clip: "bounds" as const,
      params: look.params,
      provenance: { origin: "design-original" as const },
    })),
);
