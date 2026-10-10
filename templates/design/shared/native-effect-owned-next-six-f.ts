import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type {
  EffectColor,
  EffectDefinition,
  EffectPreset,
  EffectValue,
} from "./native-effects";

type Look = { name: string; params: Record<string, EffectValue> };
type Draft = {
  slug: string;
  name: string;
  mechanism: string;
  properties: EffectDefinition["properties"];
  body: string;
  looks: readonly [Look, Look];
};
const color = (r: number, g: number, b: number, alpha = 1): EffectColor => ({
  space: "srgb",
  components: [r, g, b],
  alpha,
});
const scalar = (
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step,
});
const shared = `
fn hash2(q:vec2f)->f32{return fract(sin(dot(q,vec2f(87.71,179.23)))*37161.39);}
fn noise2(q:vec2f)->f32{let i=floor(q);let f=fract(q);let u=f*f*(3.0-2.0*f);
 return mix(mix(hash2(i),hash2(i+vec2f(1.0,0.0)),u.x),mix(hash2(i+vec2f(0.0,1.0)),hash2(i+vec2f(1.0)),u.x),u.y);}
fn turn(p:vec2f,a:f32)->vec2f{return vec2f(p.x*cos(a)-p.y*sin(a),p.x*sin(a)+p.y*cos(a));}
fn mixPigment(a:vec4f,b:vec4f,t:f32)->vec4f{let f=clamp(t,0.0,1.0);let alpha=mix(a.a,b.a,f);return vec4f(mix(a.rgb,b.rgb,f)*alpha,alpha);}
`;
const revisedNoiseSlugs = new Set(["advected-marble", "basketweave-parquet"]);
const versionFor = (draft: Draft) =>
  revisedNoiseSlugs.has(draft.slug) ? 3 : 1;
const noiseTailAt = shared.indexOf("fn noise2(");
if (noiseTailAt < 0) throw new Error("Design noise helper is unavailable");
const integerShared =
  `
fn hash2(q:vec2f)->f32{
 let cell=floor(q);
 let x=bitcast<u32>(i32(cell.x));let y=bitcast<u32>(i32(cell.y));
 var h:u32=(x*0x9e3779b9u) ^ (y*0x85ebca6bu) ^ 0xc2b2ae35u;
 h=(h^(h>>16u))*0x7feb352du;
 h=(h^(h>>15u))*0x846ca68bu;
 h=h^(h>>16u);
 return f32(h>>8u)*(1.0/16777216.0);
}
` + shared.slice(noiseTailAt);
export const OWNED_NEXT_SIX_F_DRAFTS: readonly Draft[] = [
  {
    slug: "photoelastic-stress",
    name: "Photoelastic Stress",
    mechanism:
      "A two-axis stress tensor sets a principal polarization axis and wavelength-dependent retardance through crossed polarizers; transmitted color follows local load and shear.",
    properties: {
      field: {
        type: "color",
        label: "Field",
        default: color(0.015, 0.025, 0.045),
      },
      illumination: {
        type: "color",
        label: "Illumination",
        default: color(0.95, 0.97, 1),
      },
      load: scalar("Axial load", 420, 80, 900, 1),
      shear: scalar("Shear load", 250, 0, 800, 1),
      analyzer: scalar("Analyzer angle", 0, -90, 90, 1),
      retardance: scalar("Retardance scale", 1, 0.25, 2, 0.01),
    },
    body: `let q=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0);
let neckA=exp(-22.0*(q.x-.32)*(q.x-.32)-6.0*q.y*q.y);
let neckB=exp(-22.0*(q.x+.32)*(q.x+.32)-6.0*q.y*q.y);
let axial=globals.params[2].x*(.18+.82*(neckA+neckB));
let transverse=-globals.params[2].x*.25*exp(-8.0*q.y*q.y);
let shear=globals.params[3].x*q.x*q.y*4.0;
let difference=length(vec2f(axial-transverse,2.0*shear))*globals.params[5].x;
let principal=.5*atan2(2.0*shear,axial-transverse);
let analyzer=globals.params[4].x*.01745329252;
let orientation=pow(sin(2.0*(principal-analyzer)),2.0);
let phases=vec3f(3.14159265*difference/650.0,3.14159265*difference/530.0,3.14159265*difference/460.0);
let transmission=orientation*pow(sin(phases),vec3f(2.0));
let illuminationAlpha=globals.params[1].a;
let lightCoverage=clamp(max(transmission.r,max(transmission.g,transmission.b))*illuminationAlpha,0.0,1.0);
let base=vec4f(globals.params[0].rgb*globals.params[0].a,globals.params[0].a);
let light=vec4f(globals.params[1].rgb*transmission*illuminationAlpha,lightCoverage);
return light+base*(1.0-lightCoverage);`,
    looks: [
      {
        name: "Crossed Load",
        params: { load: 420, shear: 250, analyzer: 0, retardance: 1 },
      },
      {
        name: "Tilted Compression",
        params: {
          field: color(0.01, 0.025, 0.035),
          illumination: color(1, 0.9, 0.78),
          load: 670,
          shear: 410,
          analyzer: 32,
          retardance: 1.45,
        },
      },
    ],
  },
  {
    slug: "advected-marble",
    name: "Advected Marble",
    mechanism:
      "Two finite backward-advection steps along a rotated stationary noise flow deform mineral sediment bands; bands are sampled after transport.",
    properties: {
      stone: {
        type: "color",
        label: "Stone",
        default: color(0.76, 0.72, 0.65),
      },
      vein: { type: "color", label: "Vein", default: color(0.11, 0.13, 0.17) },
      bands: scalar("Band density", 11, 3, 26, 0.1),
      advection: scalar("Advection", 0.26, 0, 0.7, 0.01),
      veinWidth: scalar("Vein width", 0.085, 0.01, 0.22, 0.005),
    },
    body: `let aspect=globals.viewport.x/max(globals.viewport.y,1.0);var q=input.uv*vec2f(aspect,1.0);
for(var i=0u;i<2u;i+=1u){let v=vec2f(noise2(q*2.7+vec2f(3.2,7.4))-.5,noise2(q*2.7+vec2f(11.7,1.3))-.5);
 q-=vec2f(v.y,-v.x)*globals.params[3].x;}
let sediment=q.y*globals.params[2].x+noise2(q*4.9)*.85+noise2(q*13.1)*.17;
let dist=abs(fract(sediment)-.5);
let aa=max(fwidth(sediment),.001);
let ink=1.0-smoothstep(globals.params[4].x,globals.params[4].x+aa,dist);
return mixPigment(globals.params[0],globals.params[1],ink);`,
    looks: [
      {
        name: "Ivory Veins",
        params: { bands: 11, advection: 0.26, veinWidth: 0.085 },
      },
      {
        name: "Green Stone",
        params: {
          stone: color(0.16, 0.34, 0.28),
          vein: color(0.82, 0.82, 0.62),
          bands: 17,
          advection: 0.43,
          veinWidth: 0.045,
        },
      },
    ],
  },
  {
    slug: "superformula-bloom",
    name: "Superformula Bloom",
    mechanism:
      "Polar superformula radius with independent rotational symmetry and exponent; finite petal silhouette and inner radial shading.",
    properties: {
      field: {
        type: "color",
        label: "Field",
        default: color(0.025, 0.04, 0.075),
      },
      petals: {
        type: "color",
        label: "Petals",
        default: color(0.95, 0.45, 0.58),
      },
      lobes: scalar("Lobes", 7, 3, 16, 1),
      exponent: scalar("Lobe exponent", 3.2, 0.4, 9, 0.1),
      radius: scalar("Radius", 0.38, 0.12, 0.48, 0.005),
    },
    body: `let p=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0);
let angle=atan2(p.y,p.x);let lobe=abs(cos(globals.params[2].x*angle*.25));
let companion=abs(sin(globals.params[2].x*angle*.25));
let radial=pow(max(pow(lobe,globals.params[3].x)+pow(companion,globals.params[3].x),.00001),-1.0/globals.params[3].x);
let signed=length(p)-globals.params[4].x*radial;
let coverage=1.0-smoothstep(-max(fwidth(signed),.0005),max(fwidth(signed),.0005),signed);
let ridge=clamp(.8+.2*cos(angle*globals.params[2].x),0.0,1.0);
return mixPigment(globals.params[0],globals.params[1],coverage*ridge);`,
    looks: [
      {
        name: "Coral Petals",
        params: { lobes: 7, exponent: 3.2, radius: 0.38 },
      },
      {
        name: "Silver Quatrefoil",
        params: {
          field: color(0.025, 0.04, 0.045),
          petals: color(0.75, 0.85, 0.86),
          lobes: 4,
          exponent: 0.9,
          radius: 0.43,
        },
      },
    ],
  },
  {
    slug: "circle-inversion-web",
    name: "Circle Inversion Web",
    mechanism:
      "Euclidean straight-line grid is mapped through a bounded circle inversion; curved branches and singular center follow inverse geometry.",
    properties: {
      ground: {
        type: "color",
        label: "Ground",
        default: color(0.04, 0.035, 0.07),
      },
      web: { type: "color", label: "Web", default: color(0.6, 0.85, 0.94) },
      density: scalar("Grid density", 7, 3, 18, 0.1),
      inversion: scalar("Inversion radius", 0.37, 0.12, 0.8, 0.01),
      lineWidth: scalar("Line width", 0.025, 0.004, 0.09, 0.001),
    },
    body: `let p=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0);
let r2=dot(p,p);let q=p*globals.params[3].x*globals.params[3].x/max(r2,.0008);
let lattice=q*globals.params[2].x;
let edge=abs(fract(lattice+.5)-vec2f(.5));
let d=min(edge.x,edge.y);
let footprint=max(max(fwidth(lattice.x),fwidth(lattice.y)),.0005);
let coverage=1.0-smoothstep(globals.params[4].x,globals.params[4].x+footprint,d);
let centerFade=smoothstep(.008,.03,r2);
return mixPigment(globals.params[0],globals.params[1],coverage*centerFade);`,
    looks: [
      {
        name: "Polar Web",
        params: { density: 7, inversion: 0.37, lineWidth: 0.025 },
      },
      {
        name: "Fine Inversion",
        params: {
          ground: color(0.018, 0.025, 0.035),
          web: color(0.98, 0.65, 0.38),
          density: 13,
          inversion: 0.55,
          lineWidth: 0.011,
        },
      },
    ],
  },
  {
    slug: "basketweave-parquet",
    name: "Basketweave Parquet",
    mechanism:
      "Alternating orthogonal long planks are assigned by checkerboard block parity, with per-plank end joints and directional grain.",
    properties: {
      oak: { type: "color", label: "Wood", default: color(0.45, 0.25, 0.11) },
      joint: {
        type: "color",
        label: "Joint",
        default: color(0.065, 0.045, 0.035),
      },
      plankCount: scalar("Planks", 12, 4, 28, 1),
      seam: scalar("Seam", 0.028, 0.005, 0.09, 0.001),
      grain: scalar("Grain contrast", 0.23, 0, 0.55, 0.01),
    },
    body: `let q=input.uv*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0)*globals.params[2].x;
let tile=floor(q*.5);let alternating=(i32(tile.x)+i32(tile.y))%2==0;
let local=fract(q*.5)*2.0;var wood=local;if(!alternating){wood=local.yx;}
let lane=floor(wood.y);let along=wood.x+select(.5,0.0,i32(lane)%2==0);
let plank=vec2f(floor(along),lane);
let edge=min(min(fract(along),1.0-fract(along)),min(fract(wood.y),1.0-fract(wood.y)));
let seam=1.0-smoothstep(globals.params[3].x,globals.params[3].x+max(fwidth(along),.001),edge);
let grain=(noise2(vec2f(along*2.0,wood.y*27.0)+plank*3.7)-.5)*globals.params[4].x;
let colored=vec4f(clamp(globals.params[0].rgb*(1.0+grain),vec3f(0.0),vec3f(1.0)),globals.params[0].a);
return mixPigment(colored,globals.params[1],seam);`,
    looks: [
      {
        name: "Warm Parquet",
        params: { plankCount: 12, seam: 0.028, grain: 0.23 },
      },
      {
        name: "Ash Basketweave",
        params: {
          oak: color(0.69, 0.65, 0.53),
          joint: color(0.16, 0.14, 0.13),
          plankCount: 18,
          seam: 0.014,
          grain: 0.34,
        },
      },
    ],
  },
  {
    slug: "spherical-harmonic-surface",
    name: "Harmonic Sphere",
    mechanism:
      "Analytic ray-sphere hit normal modulates Lambert lighting by a second-order spherical harmonic, distinct from a 2D Fresnel rim.",
    properties: {
      backdrop: {
        type: "color",
        label: "Backdrop",
        default: color(0.018, 0.028, 0.055),
      },
      shell: {
        type: "color",
        label: "Shell",
        default: color(0.55, 0.67, 0.92),
      },
      radius: scalar("Sphere radius", 0.39, 0.18, 0.48, 0.005),
      harmonic: scalar("Harmonic amplitude", 0.38, 0, 0.8, 0.01),
      azimuth: scalar("Light azimuth", 35, -180, 180, 1),
    },
    body: `let p=(input.uv-vec2f(.5))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0);
let radius=globals.params[2].x;let q=p/radius;let r2=dot(q,q);
let cover=1.0-smoothstep(1.0-max(fwidth(r2),.001),1.0+max(fwidth(r2),.001),r2);
let normal=normalize(vec3f(q,sqrt(max(1.0-r2,.0001))));
let angle=globals.params[4].x*.01745329252;
let light=normalize(vec3f(cos(angle)*.6,sin(angle)*.6,.8));
let diffuse=max(dot(normal,light),0.0);
let harmonic=(3.0*normal.z*normal.z-1.0)*.5;
let shade=clamp(.2+.65*diffuse+globals.params[3].x*harmonic,0.0,1.0);
let shell=vec4f(globals.params[1].rgb*shade,globals.params[1].a);
return mixPigment(globals.params[0],shell,cover);`,
    looks: [
      {
        name: "Porcelain Sphere",
        params: { radius: 0.39, harmonic: 0.38, azimuth: 35 },
      },
      {
        name: "Lunar Relief",
        params: {
          backdrop: color(0.01, 0.015, 0.025),
          shell: color(0.8, 0.78, 0.68),
          radius: 0.43,
          harmonic: 0.66,
          azimuth: -70,
        },
      },
    ],
  },
];

const makeDefinition = (draft: Draft): EffectDefinition => ({
  id: `an-native-owned-f-${draft.slug}`,
  name: draft.name,
  version: versionFor(draft),
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
        (revisedNoiseSlugs.has(draft.slug) ? integerShared : shared) +
        `\n@fragment fn fs(input:VertexOutput)->@location(0) vec4f{${draft.body}\n}`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: `Independent Design ${draft.mechanism}`,
  },
});
export const OWNED_NEXT_SIX_F_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_F_DRAFTS.map(makeDefinition);
export const OWNED_NEXT_SIX_F_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_F_DRAFTS.flatMap((draft) =>
    draft.looks.map((look, index) => ({
      id: `an-preset-owned-f-${draft.slug}-${index + 1}`,
      name: look.name,
      definitionId: `an-native-owned-f-${draft.slug}`,
      definitionVersion: versionFor(draft),
      placement: "fill" as const,
      clip: "bounds" as const,
      params: look.params,
      provenance: { origin: "design-original" as const },
    })),
  );
