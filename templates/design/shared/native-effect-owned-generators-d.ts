import {
  CATALOG_PALETTES,
  catalogFloat,
  catalogPalette,
  catalogShader,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectValue,
} from "./native-effects";

type Look = { name: string; params: Record<string, EffectValue> };
type Draft = {
  slug: string;
  name: string;
  mechanism: string;
  cost: string;
  properties: EffectDefinition["properties"];
  helpers?: string;
  body: string;
  looks: readonly [Look, Look];
};

export const OWNED_GENERATOR_D_DRAFTS: readonly Draft[] = [
  {
    slug: "newton-basins",
    name: "Newton Basins",
    mechanism:
      "Complex Newton iteration partitions the plane by convergence to three roots.",
    cost: "At most 24 bounded complex iterations per fragment; no sampled textures.",
    properties: {
      palette: catalogPalette(CATALOG_PALETTES.orchid),
      zoom: catalogFloat("Zoom", 1.1, 0.45, 3, 0.01),
      rotation: catalogFloat("Rotation", 0, -3.14, 3.14, 0.01),
      iterations: {
        type: "int",
        label: "Iterations",
        default: 16,
        min: 4,
        max: 24,
        step: 1,
      },
      basinShade: catalogFloat("Basin shade", 0.65, 0, 1, 0.01),
    },
    helpers: `
fn complexProduct(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x);
}
fn complexQuotient(a: vec2f, b: vec2f) -> vec2f {
  let denominator=max(dot(b,b),0.0000001);
  return vec2f(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/denominator;
}
`,
    body: `
let aspect=globals.viewport.x/max(globals.viewport.y,1.0);
let point=rotate((input.uv-vec2f(0.5))*vec2f(aspect,1.0)*2.8/PARAM[1].x,PARAM[2].x);
var z=point;
var used=0.0;
let limit=u32(PARAM[3].x);
for(var i=0u;i<24u;i+=1u){
  if(i>=limit){break;}
  let square=complexProduct(z,z);
  let cubic=complexProduct(square,z);
  let remainder=cubic-vec2f(1.0,0.0);
  let slope=3.0*square;
  if(dot(slope,slope)>0.0000001){z-=complexQuotient(remainder,slope);}
  else{z+=vec2f(0.013,0.007);}
  z=clamp(z,vec2f(-100.0),vec2f(100.0));
  used=f32(i+1u);
  if(dot(remainder,remainder)<0.0000001){break;}
}
let roots=array<vec2f,3>(vec2f(1.0,0.0),vec2f(-0.5,0.8660254),vec2f(-0.5,-0.8660254));
var nearest=dot(z-roots[0],z-roots[0]);
var basin=0u;
for(var root=1u;root<3u;root+=1u){
  let distance=dot(z-roots[root],z-roots[root]);
  if(distance<nearest){nearest=distance;basin=root;}
}
let shade=1.0-PARAM[4].x*used/max(f32(limit),1.0);
let base=paletteAt(f32(basin)*0.5);
return vec4f(base.rgb*clamp(shade,0.15,1.0),base.a);
`,
    looks: [
      {
        name: "Orchid Basins",
        params: { zoom: 1.05, iterations: 17, basinShade: 0.68 },
      },
      {
        name: "Lagoon Roots",
        params: {
          palette: structuredClone(CATALOG_PALETTES.lagoon),
          zoom: 1.8,
          rotation: 0.42,
          iterations: 21,
          basinShade: 0.4,
        },
      },
    ],
  },
  {
    slug: "plate-nodal-lines",
    name: "Plate Nodal Lines",
    mechanism:
      "Two bounded standing plate modes interfere; their zero crossings form the nodal drawing.",
    cost: "One fragment with four trigonometric mode evaluations and derivative-width antialiasing.",
    properties: {
      palette: catalogPalette(CATALOG_PALETTES.ink),
      modeX: {
        type: "int",
        label: "Horizontal mode",
        default: 5,
        min: 1,
        max: 12,
        step: 1,
      },
      modeY: {
        type: "int",
        label: "Vertical mode",
        default: 3,
        min: 1,
        max: 12,
        step: 1,
      },
      coupling: catalogFloat("Mode coupling", 0.65, 0, 1, 0.01),
      lineWidth: catalogFloat("Nodal width", 0.035, 0.002, 0.2, 0.001),
      rotation: catalogFloat("Rotation", 0, -3.14, 3.14, 0.01),
    },
    body: `
let uv=rotate(input.uv-vec2f(0.5),PARAM[5].x)+vec2f(0.5);
let m=PARAM[1].x*PI;
let n=PARAM[2].x*PI;
let first=sin(m*uv.x)*sin(n*uv.y);
let second=sin(n*uv.x)*sin(m*uv.y);
let displacement=first-PARAM[3].x*second;
let footprint=max(fwidth(displacement),0.001);
let nodal=1.0-smoothstep(PARAM[4].x,PARAM[4].x+footprint,abs(displacement));
let frame=smoothstep(0.0,0.02,uv.x)*smoothstep(0.0,0.02,uv.y)*
  (1.0-smoothstep(0.98,1.0,uv.x))*(1.0-smoothstep(0.98,1.0,uv.y));
return paletteAt(mix(0.08,1.0,nodal*frame));
`,
    looks: [
      {
        name: "Bronze Plate",
        params: { modeX: 5, modeY: 3, coupling: 0.72, lineWidth: 0.034 },
      },
      {
        name: "Fine Interference",
        params: {
          palette: structuredClone(CATALOG_PALETTES.orchid),
          modeX: 9,
          modeY: 6,
          coupling: 0.45,
          lineWidth: 0.012,
          rotation: 0.12,
        },
      },
    ],
  },
  {
    slug: "orbital-lensing",
    name: "Orbital Lensing",
    mechanism:
      "A softened radial lens equation remaps a seeded star field and forms an analytic Einstein ring.",
    cost: "Nine bounded neighboring star tests and constant lens arithmetic per fragment.",
    properties: {
      palette: catalogPalette(CATALOG_PALETTES.lagoon),
      mass: catalogFloat("Lens mass", 0.09, 0.01, 0.3, 0.001),
      coreRadius: catalogFloat("Core radius", 0.07, 0.02, 0.2, 0.001),
      starDensity: catalogFloat("Star density", 32, 12, 72, 1),
      ringWidth: catalogFloat("Ring width", 0.018, 0.004, 0.07, 0.001),
      drift: catalogFloat("Sky drift", 0, -0.4, 0.4, 0.01),
    },
    body: `
let aspect=globals.viewport.x/max(globals.viewport.y,1.0);
let theta=(input.uv-vec2f(0.5))*vec2f(aspect,1.0)*1.7;
let distanceSquared=dot(theta,theta);
let core=PARAM[2].x;
let beta=theta-theta*PARAM[1].x/max(distanceSquared+core*core,0.0001);
let sky=(beta+vec2f(globals.clock.x*PARAM[5].x,0.0))*PARAM[3].x;
let cell=vec2i(floor(sky));
var stars=0.0;
for(var y=-1;y<=1;y+=1){for(var x=-1;x<=1;x+=1){
  let site=cell+vec2i(x,y);
  let brightness=random(site+vec2i(53,19));
  let jitter=vec2f(random(site+vec2i(17,31)),random(site+vec2i(71,7)));
  let delta=sky-(vec2f(site)+jitter);
  let sparkle=exp(-dot(delta,delta)/0.007);
  stars+=select(0.0,sparkle*(brightness-0.82)/0.18,brightness>0.82);
}}
let radius=sqrt(distanceSquared);
let ringDistance=(radius-sqrt(PARAM[1].x))/PARAM[4].x;
let ring=exp(-ringDistance*ringDistance)*0.45;
let visibility=smoothstep(core,core+0.025,radius);
return paletteAt(clamp((stars+ring)*visibility,0.0,1.0));
`,
    looks: [
      {
        name: "Blue Arc",
        params: { mass: 0.09, starDensity: 30, ringWidth: 0.018, drift: 0 },
      },
      {
        name: "Copper Orbit",
        params: {
          palette: structuredClone(CATALOG_PALETTES.ember),
          mass: 0.19,
          coreRadius: 0.09,
          starDensity: 52,
          ringWidth: 0.012,
          drift: 0.04,
        },
      },
    ],
  },
  {
    slug: "harmonic-band-map",
    name: "Harmonic Band Map",
    mechanism:
      "A synthetic time-frequency field sums localized chirped harmonic ridges with independent energy envelopes.",
    cost: "At most eight Gaussian band evaluations per fragment; no audio input or texture assets.",
    properties: {
      palette: catalogPalette(CATALOG_PALETTES.ember),
      fundamental: catalogFloat("Fundamental", 0.085, 0.025, 0.18, 0.001),
      harmonics: {
        type: "int",
        label: "Harmonics",
        default: 6,
        min: 2,
        max: 8,
        step: 1,
      },
      chirp: catalogFloat("Chirp", 0.12, -0.35, 0.35, 0.001),
      bandwidth: catalogFloat("Bandwidth", 0.024, 0.004, 0.08, 0.001),
      movement: catalogFloat("Movement", 0.05, 0, 0.3, 0.001),
    },
    body: `
let time=input.uv.x+globals.clock.x*PARAM[5].x*0.1;
let frequency=1.0-input.uv.y;
var energy=0.0;
for(var harmonic=1u;harmonic<=8u;harmonic+=1u){
  if(harmonic>u32(PARAM[2].x)){break;}
  let rank=f32(harmonic);
  let center=PARAM[1].x*rank+PARAM[3].x*(time-0.5)/sqrt(rank);
  let distance=(frequency-center)/PARAM[4].x;
  let envelope=exp(-0.5*distance*distance);
  let amplitude=0.65+0.35*cos(TAU*(time*rank*1.2+rank*0.17));
  energy+=envelope*amplitude/rank;
}
let field=1.0-exp(-energy*1.8);
return paletteAt(clamp(field,0.0,1.0));
`,
    looks: [
      {
        name: "Warm Harmonics",
        params: {
          fundamental: 0.085,
          harmonics: 6,
          chirp: 0.12,
          bandwidth: 0.024,
          movement: 0.05,
        },
      },
      {
        name: "Cold Chirp",
        params: {
          palette: structuredClone(CATALOG_PALETTES.lagoon),
          fundamental: 0.055,
          harmonics: 8,
          chirp: -0.24,
          bandwidth: 0.013,
          movement: 0.12,
        },
      },
    ],
  },
] as const;

export const OWNED_GENERATOR_D_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_GENERATOR_D_DRAFTS.map((draft) => {
    const propertyNames = Object.keys(draft.properties);
    if (
      propertyNames.length < 5 ||
      propertyNames.length > 6 ||
      propertyNames[0] !== "palette"
    )
      throw new Error(
        `Owned generator ${draft.slug} changed its declared control ABI`,
      );
    return catalogShader({
      id: `owned-${draft.slug}`,
      name: draft.name,
      kind: "generator",
      properties: draft.properties,
      helpers: draft.helpers ? () => draft.helpers! : undefined,
      fragment: (property) =>
        draft.body.replace(/PARAM\[(\d+)\]/g, (_, index: string) => {
          const name = propertyNames[Number(index)];
          if (!name)
            throw new Error(
              `Owned generator ${draft.slug} references an unknown control`,
            );
          return property(name);
        }),
    });
  });

export const OWNED_GENERATOR_D_PRESETS: readonly EffectPreset[] =
  OWNED_GENERATOR_D_DRAFTS.flatMap((draft, draftIndex) =>
    draft.looks.map((look, lookIndex) => ({
      id: `an-preset-owned-${draft.slug}-${lookIndex + 1}`,
      name: look.name,
      definitionId: OWNED_GENERATOR_D_DEFINITIONS[draftIndex]!.id,
      definitionVersion: 1,
      placement: "fill" as const,
      params: look.params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
