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
  cost: string;
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
  defaultValue: number,
  min: number,
  max: number,
  step: number,
) => ({ type: "float" as const, label, default: defaultValue, min, max, step });
const shade = `
fn hashCell(p:vec2f)->f32{return fract(sin(dot(p,vec2f(103.17,277.91)))*37819.347);}
fn segmentDistance(p:vec2f,a:vec2f,b:vec2f)->f32{let v=b-a;let t=clamp(dot(p-a,v)/max(dot(v,v),0.000001),0.0,1.0);return length(p-a-v*t);}
`;
const drafts: readonly Draft[] = [
  {
    id: "perspective-floor-grid",
    name: "Perspective Floor Grid",
    mechanism:
      "Inverse horizon projection makes orthogonal ground-plane lines converge at one horizon.",
    cost: "One fragment; constant arithmetic and derivative antialiasing.",
    properties: {
      floor: {
        type: "color",
        label: "Floor",
        default: color(0.05, 0.08, 0.12),
      },
      lines: { type: "color", label: "Lines", default: color(0.42, 0.8, 0.92) },
      horizon: float("Horizon", 0.36, 0.12, 0.72, 0.01),
      cameraHeight: float("Camera height", 0.42, 0.1, 1.5, 0.01),
      tileScale: float("Tile scale", 8, 2, 24, 0.1),
      lineWidth: float("Line width", 0.025, 0.002, 0.08, 0.001),
    },
    body: `let uv=input.uv; let horizon=globals.params[2].x;
let below=max(uv.y-horizon,0.0005); let depth=globals.params[3].x/below;
let plane=vec2f((uv.x-0.5)*depth,depth)*globals.params[4].x;
let cell=abs(fract(plane+vec2f(0.5))-vec2f(0.5));
let dx=min(cell.x,cell.y);let footprint=max(fwidth(plane.x),fwidth(plane.y));
let line=1.0-smoothstep(globals.params[5].x,globals.params[5].x+footprint,dx);
let fade=smoothstep(horizon+0.002,horizon+0.06,uv.y);
let field=line*fade;
let alpha=mix(globals.params[0].a,globals.params[1].a,field);
let rgb=mix(globals.params[0].rgb,globals.params[1].rgb,field);
return vec4f(rgb*alpha,alpha);`,
    looks: [
      {
        name: "Dusk Tiles",
        params: {
          horizon: 0.38,
          cameraHeight: 0.45,
          tileScale: 7,
          lineWidth: 0.022,
        },
      },
      {
        name: "Neon Runway",
        params: {
          floor: color(0.012, 0.022, 0.06),
          lines: color(0.25, 0.95, 0.74),
          horizon: 0.28,
          cameraHeight: 0.26,
          tileScale: 13,
          lineWidth: 0.011,
        },
      },
    ],
  },
  {
    id: "hyperbolic-geodesics",
    name: "Hyperbolic Geodesics",
    mechanism:
      "Orthogonal boundary circles trace Poincare-disk geodesics with edge compression.",
    cost: "Up to nine analytic circle distances per fragment.",
    properties: {
      disk: { type: "color", label: "Disk", default: color(0.04, 0.04, 0.09) },
      seams: {
        type: "color",
        label: "Seams",
        default: color(0.88, 0.64, 0.29),
      },
      curves: float("Geodesics", 6, 3, 9, 1),
      stroke: float("Stroke", 0.016, 0.003, 0.05, 0.001),
      radius: float("Disk radius", 0.42, 0.25, 0.48, 0.005),
    },
    body: `let p=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0)*2.0/max(globals.params[4].x,0.01);
let radial=length(p); var nearest=100.0;
for(var i=0u;i<9u;i+=1u){if(i>=u32(round(globals.params[2].x))){break;}
 let angle=6.2831853*f32(i)/max(globals.params[2].x,1.0);let center=vec2f(cos(angle),sin(angle))*1.28;
 let d=abs(length(p-center)-sqrt(1.28*1.28-1.0));nearest=min(nearest,d);
}
let width=max(fwidth(nearest),0.001);let seam=1.0-smoothstep(globals.params[3].x,globals.params[3].x+width,nearest);
let boundary=1.0-smoothstep(.98,1.01,radial);let field=seam*boundary;
let alpha=mix(globals.params[0].a,globals.params[1].a,field)*boundary;
let rgb=mix(globals.params[0].rgb,globals.params[1].rgb,field);
return vec4f(rgb*alpha,alpha);`,
    looks: [
      {
        name: "Brass Disk",
        params: { curves: 6, stroke: 0.014, radius: 0.42 },
      },
      {
        name: "Midnight Geodesics",
        params: {
          disk: color(0.005, 0.015, 0.035),
          seams: color(0.39, 0.9, 0.98),
          curves: 9,
          stroke: 0.008,
          radius: 0.46,
        },
      },
    ],
  },
  {
    id: "isometric-voxel-field",
    name: "Isometric Block Field",
    mechanism:
      "Each projected cell draws a top diamond and two ordered shaded side faces from one height sample.",
    cost: "One fragment; one cell hash and three face tests.",
    properties: {
      top: { type: "color", label: "Top", default: color(0.68, 0.77, 0.78) },
      left: {
        type: "color",
        label: "Left face",
        default: color(0.16, 0.29, 0.38),
      },
      right: {
        type: "color",
        label: "Right face",
        default: color(0.3, 0.43, 0.5),
      },
      columns: float("Columns", 10, 4, 24, 1),
      heightSpread: float("Height spread", 0.65, 0, 1, 0.01),
      gap: float("Gap", 0.025, 0, 0.12, 0.005),
    },
    body: `let aspect=globals.viewport.x/max(globals.viewport.y,1.0);let q=(input.uv-vec2f(.5))*vec2f(aspect,1.0)*globals.params[3].x;
let skew=vec2f(q.x+q.y*.57735027,q.y*1.15470054);let cell=floor(skew);let local=fract(skew)-vec2f(.5);
let height=.12+hashCell(cell)*globals.params[4].x*.5;
let diamond=abs(local.x)*.57735027+abs(local.y);
let top=1.0-smoothstep(.245-globals.params[5].x,.25-globals.params[5].x,diamond+height*.16);
let sideBand=step(.0,local.y)*step(diamond,.25+height);
let rightSide=step(0.0,local.x);
let sideLeft=sideBand*(1.0-rightSide)*(1.0-top);
let sideRight=sideBand*rightSide*(1.0-top);
let rgb=globals.params[0].rgb*globals.params[0].a*top+globals.params[1].rgb*globals.params[1].a*sideLeft+globals.params[2].rgb*globals.params[2].a*sideRight;
let alpha=globals.params[0].a*top+globals.params[1].a*sideLeft+globals.params[2].a*sideRight;
return vec4f(rgb,alpha);`,
    looks: [
      {
        name: "Mineral Blocks",
        params: { columns: 10, heightSpread: 0.65, gap: 0.025 },
      },
      {
        name: "Glass City",
        params: {
          top: color(0.66, 0.93, 0.96),
          left: color(0.04, 0.15, 0.32),
          right: color(0.16, 0.46, 0.63),
          columns: 16,
          heightSpread: 0.9,
          gap: 0.04,
        },
      },
    ],
  },
  {
    id: "dielectric-branching",
    name: "Dielectric Branching",
    mechanism:
      "Finite binary segment tree deposits distance-limited emissive paths with level attenuation.",
    cost: "At most 63 line segments, each reconstructed through at most five ancestors.",
    properties: {
      ground: {
        type: "color",
        label: "Ground",
        default: color(0.02, 0.025, 0.07),
      },
      spark: { type: "color", label: "Spark", default: color(0.7, 0.86, 1) },
      levels: float("Branch levels", 5, 2, 6, 1),
      spread: float("Spread", 0.38, 0.1, 0.85, 0.01),
      width: float("Core width", 0.011, 0.003, 0.04, 0.001),
      pulse: float("Pulse", 0.3, 0, 2, 0.01),
    },
    body: `let p=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0)*2.0;
var glow=0.0;var core=0.0;
for(var level=0u;level<6u;level+=1u){if(level>=u32(round(globals.params[2].x))){break;}
 let paths=1u<<level;
 for(var path=0u;path<32u;path+=1u){if(path>=paths){break;}
  var a=vec2f(0.0,-.88);var angle=1.5707963;var lengthStep=.48;
  for(var depth=0u;depth<5u;depth+=1u){if(depth>=level){break;}
   let bit=(path>>(level-depth-1u))&1u;
   a+=vec2f(cos(angle),sin(angle))*lengthStep;
   lengthStep*=.68;
   angle+=(select(-1.0,1.0,bit==1u))*globals.params[3].x;
  }
  let b=a+vec2f(cos(angle),sin(angle))*lengthStep;
  let dist=segmentDistance(p,a,b);let taper=1.0-f32(level)/max(globals.params[2].x,1.0);
  core=max(core,(1.0-smoothstep(globals.params[4].x*taper,globals.params[4].x*taper+fwidth(dist),dist))*taper);
  glow=max(glow,exp(-dist*32.0)*taper);
 }
}
let pulse=.85+.15*sin(globals.clock.x*globals.params[5].x*6.2831853);
let field=clamp(core*pulse+glow*.24,0.0,1.0);
let alpha=mix(globals.params[0].a,globals.params[1].a,field);
let rgb=mix(globals.params[0].rgb,globals.params[1].rgb,field);
return vec4f(rgb*alpha,alpha);`,
    looks: [
      {
        name: "Cold Discharge",
        params: { levels: 5, spread: 0.38, width: 0.009, pulse: 0.3 },
      },
      {
        name: "Copper Spark",
        params: {
          ground: color(0.07, 0.025, 0.016),
          spark: color(1, 0.55, 0.22),
          levels: 6,
          spread: 0.58,
          width: 0.014,
          pulse: 0.7,
        },
      },
    ],
  },
];
function buildDefinition(spec: Draft): EffectDefinition {
  return {
    id: `an-native-owned-breadth-${spec.id}`,
    name: spec.name,
    version: 1,
    kind: "generator",
    placements: ["fill"],
    properties: spec.properties,
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
          shade +
          `\n@fragment fn fs(input:VertexOutput)->@location(0) vec4f{${spec.body}\n}`,
      },
    ],
    provenance: {
      origin: "design-original",
      note: `Independent Design ${spec.mechanism}`,
    },
  };
}
export const BREADTH_A_DRAFTS = drafts;
export const BREADTH_A_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(buildDefinition);
export const BREADTH_A_PRESETS: readonly EffectPreset[] = drafts.flatMap(
  (spec) =>
    spec.looks.map((look, index) => ({
      id: `an-preset-owned-breadth-${spec.id}-${index + 1}`,
      name: look.name,
      definitionId: `an-native-owned-breadth-${spec.id}`,
      definitionVersion: 1,
      placement: "fill" as const,
      clip: "bounds" as const,
      params: look.params,
      provenance: { origin: "design-original" as const },
    })),
);
