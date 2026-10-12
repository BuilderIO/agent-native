import {
  catalogColor,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "../../../templates/design/shared/native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "../../../templates/design/shared/native-effects";

type Look = readonly [string, Record<string, EffectValue>];
export type Draft = CatalogShaderSpec & {
  mechanism: string;
  closest: string;
  cost: string;
  looks: readonly [Look, Look];
};
const px = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step: 0.1,
  unit: "px",
});
const pigment = (
  label: string,
  r: number,
  g: number,
  b: number,
): EffectProperty => ({ type: "color", label, default: catalogColor(r, g, b) });
const edge = (): EffectProperty => ({
  type: "enum",
  label: "Outside source",
  default: "clamp",
  options: ["transparent", "clamp"],
  advanced: true,
});

export const OWNED_NEXT_TWELVE_U_DRAFTS: readonly Draft[] = [
  {
    id: "owned-u-mobius-reprojection",
    name: "Möbius Reprojection",
    kind: "processor",
    mechanism:
      "Applies a bounded complex fractional-linear inverse map (z+a)/(bz+1) in centered source coordinates; straight lines can become circular arcs without a corner-perspective matrix.",
    closest: "Corner Perspective; Circle Inversion Web; Log-Polar Reprojection",
    cost: "One source read and one complex division per pixel.",
    properties: {
      edge: edge(),
      offsetX: catalogFloat("Numerator X", 0.13, -0.35, 0.35),
      offsetY: catalogFloat("Numerator Y", 0.04, -0.35, 0.35),
      bendX: catalogFloat("Denominator X", 0.22, -0.5, 0.5),
      bendY: catalogFloat("Denominator Y", 0, -0.5, 0.5),
    },
    fragment: (p) => `
  let z=(input.uv-vec2f(0.5))*2.0;
  let numerator=z+vec2f(${p("offsetX")}.x,${p("offsetY")}.x);
  let b=vec2f(${p("bendX")}.x,${p("bendY")}.x);
  let denominator=vec2f(1.0+b.x*z.x-b.y*z.y,b.x*z.y+b.y*z.x);
  let scale=max(dot(denominator,denominator),0.0001);
  let q=vec2f(dot(numerator,denominator),numerator.y*denominator.x-numerator.x*denominator.y)/scale;
  return sampleSource(q*0.5+vec2f(0.5));`,
    looks: [
      ["Arc lens", { offsetX: 0.1, bendX: 0.34 }],
      ["Cross bend", { offsetY: 0.2, bendX: -0.25, bendY: 0.3 }],
    ],
  },
  {
    id: "owned-u-vector-median",
    name: "Vector Median",
    kind: "processor",
    mechanism:
      "Chooses one actual premultiplied RGBA sample from a five-pixel cross by minimum summed four-channel distance, preserving sampled hues rather than synthesizing per-channel medians.",
    closest: "Median Speckle Removal; Bilateral Surface; Local Rank Contrast",
    cost: "Five source reads and 25 bounded vector-distance evaluations per pixel.",
    properties: {
      edge: edge(),
      reach: px("Cross radius", 2, 1, 5),
      amount: catalogFloat("Denoise blend", 0.9, 0, 1),
    },
    fragment: (p) => `
  let stepUv=globals.viewport.zw*${p("reach")}.x*globals.clock.z;
  let samples=array<vec4f,5>(sampleSource(input.uv),sampleSource(input.uv+vec2f(stepUv.x,0.0)),sampleSource(input.uv-vec2f(stepUv.x,0.0)),sampleSource(input.uv+vec2f(0.0,stepUv.y)),sampleSource(input.uv-vec2f(0.0,stepUv.y)));
  var best=1.0e6;var chosen=samples[0];
  for(var i=0u;i<5u;i+=1u){var score=0.0;for(var j=0u;j<5u;j+=1u){let d=samples[i]-samples[j];score+=dot(abs(d),vec4f(1.0));}
    if(score<best){best=score;chosen=samples[i];}}
  return mix(samples[0],chosen,${p("amount")}.x);`,
    looks: [
      ["Gentle cross", { reach: 1, amount: 0.55 }],
      ["Salt-pixel cleanup", { reach: 4, amount: 1 }],
    ],
  },
  {
    id: "owned-u-isophote-integration",
    name: "Isophote Integration",
    kind: "processor",
    mechanism:
      "Estimates the current luminance gradient, then averages five source taps along its perpendicular tangent; boundaries are followed locally rather than blurred across their normal.",
    closest: "Anisotropic Diffusion; Structure Orientation; Directional Smear",
    cost: "Nine source reads: four gradient, one center and four tangent taps.",
    properties: {
      edge: edge(),
      length: px("Tangent span", 6, 0, 16),
      amount: catalogFloat("Integration", 0.75, 0, 1),
    },
    helpers: () => `
fn uStraightExact(color: vec4f) -> vec3f {
  if (color.a <= 0.0) { return vec3f(0.0); }
  return color.rgb / color.a;
}`,
    fragment: (p) => `
  let stepUv=globals.viewport.zw*globals.clock.z;
  let left=sampleSource(input.uv-vec2f(stepUv.x,0.0));let right=sampleSource(input.uv+vec2f(stepUv.x,0.0));
  let up=sampleSource(input.uv-vec2f(0.0,stepUv.y));let down=sampleSource(input.uv+vec2f(0.0,stepUv.y));
  let gx=dot(uStraightExact(right)-uStraightExact(left),vec3f(0.2126,0.7152,0.0722));
  let gy=dot(uStraightExact(down)-uStraightExact(up),vec3f(0.2126,0.7152,0.0722));
  let axis=vec2f(-gy,gx)/max(length(vec2f(gx,gy)),0.00001)*${p("length")}.x*globals.viewport.zw*globals.clock.z;
  let center=sampleSource(input.uv);
  let integrated=center+sampleSource(input.uv+axis*0.5)+sampleSource(input.uv-axis*0.5)+sampleSource(input.uv+axis)+sampleSource(input.uv-axis);
  return mix(center,integrated/5.0,${p("amount")}.x);`,
    looks: [
      ["Fine contours", { length: 3, amount: 0.5 }],
      ["Long contours", { length: 12, amount: 1 }],
    ],
  },
  {
    id: "owned-u-local-range-compression",
    name: "Local Range Compression",
    kind: "processor",
    mechanism:
      "Measures a 3×3 luminance minimum and maximum, then compresses only deviations from their midpoint while preserving hue and source alpha; unlike global curves it adapts to local dynamic range.",
    closest: "Local Rank Contrast; Tone Ripple; Three-Point Tonal Map",
    cost: "Ten source reads per pixel: the 3×3 neighborhood and a separate center read.",
    properties: {
      edge: edge(),
      reach: px("Neighborhood", 2, 1, 6),
      compression: catalogFloat("Compression", 0.55, 0, 1),
    },
    helpers: () => `
fn uStraightExact(color: vec4f) -> vec3f {
  if (color.a <= 0.0) { return vec3f(0.0); }
  return color.rgb / color.a;
}`,
    fragment: (p) => `
  let stepUv=globals.viewport.zw*${p("reach")}.x*globals.clock.z;
  var low=1.0e9;var high=-1.0e9;
  for(var yy=-1;yy<=1;yy+=1){for(var xx=-1;xx<=1;xx+=1){
    let c=sampleSource(input.uv+vec2f(f32(xx),f32(yy))*stepUv);
    let l=dot(uStraightExact(c),vec3f(0.2126,0.7152,0.0722));low=min(low,l);high=max(high,l);}}
  let center=sampleSource(input.uv);let l=dot(uStraightExact(center),vec3f(0.2126,0.7152,0.0722));
  let mid=(low+high)*0.5;
  let adjusted=mix(l,mid+(l-mid)/(1.0+${p("compression")}.x*(high-low)*4.0),${p("compression")}.x);
  if (l <= 0.00001) { return center; }
  return vec4f(center.rgb * (adjusted / l), center.a);`,
    looks: [
      ["Soft scene", { reach: 1, compression: 0.35 }],
      ["Narrow highlight", { reach: 5, compression: 0.95 }],
    ],
  },
  {
    id: "owned-u-alpha-curvature-tint",
    name: "Alpha Curvature Tint",
    kind: "processor",
    mechanism:
      "Uses a signed five-point Laplacian of source coverage to tint convex and concave alpha edges differently without creating coverage outside the original silhouette.",
    closest: "Bevel Light; Alpha Medial Ridge; Edge Neon",
    cost: "Five alpha samples per pixel.",
    properties: {
      edge: edge(),
      reach: px("Curvature radius", 2, 1, 6),
      intensity: catalogFloat("Surface tint", 0.65, 0, 1),
      convex: pigment("Convex tint", 0.88, 0.77, 0.52),
      concave: pigment("Concave tint", 0.13, 0.26, 0.47),
    },
    fragment: (p) => `
  let stepUv=globals.viewport.zw*${p("reach")}.x*globals.clock.z;
  let center=sampleSource(input.uv);
  let lap=sampleSource(input.uv+vec2f(stepUv.x,0.0)).a+sampleSource(input.uv-vec2f(stepUv.x,0.0)).a+sampleSource(input.uv+vec2f(0.0,stepUv.y)).a+sampleSource(input.uv-vec2f(0.0,stepUv.y)).a-4.0*center.a;
  let positive=max(lap,0.0);let negative=max(-lap,0.0);
  let convex=${p("convex")};let concave=${p("concave")};
  let tint=mix(convex.rgb,concave.rgb,step(0.0,lap));
  let weight=clamp((positive+negative)*${p("intensity")}.x*mix(convex.a,concave.a,step(0.0,lap)),0.0,1.0);
  return vec4f(mix(center.rgb,tint*center.a,weight),center.a);`,
    looks: [
      ["Soft curvature", { reach: 1, intensity: 0.35 }],
      ["Deep relief", { reach: 5, intensity: 1 }],
    ],
  },
  {
    id: "owned-u-luma-flow-remap",
    name: "Luma Flow Remap",
    kind: "processor",
    mechanism:
      "A single inverse-transport sample moves source coordinates along the source's own finite-difference luminance gradient, distinct from integration along isophotes or an external vector-map input.",
    closest: "Vector Field Displacement; Brush Liquify; Isophote Integration",
    cost: "Five source reads, including four local gradient taps.",
    properties: {
      edge: edge(),
      reach: px("Gradient radius", 2, 1, 6),
      drift: px("Gradient drift", 9, -25, 25),
    },
    helpers: () => `
fn uStraightExact(color: vec4f) -> vec3f {
  if (color.a <= 0.0) { return vec3f(0.0); }
  return color.rgb / color.a;
}`,
    fragment: (p) => `
  let stepUv=globals.viewport.zw*${p("reach")}.x*globals.clock.z;
  let left=sampleSource(input.uv-vec2f(stepUv.x,0.0));let right=sampleSource(input.uv+vec2f(stepUv.x,0.0));
  let up=sampleSource(input.uv-vec2f(0.0,stepUv.y));let down=sampleSource(input.uv+vec2f(0.0,stepUv.y));
  let grad=vec2f(dot(uStraightExact(right)-uStraightExact(left),vec3f(0.2126,0.7152,0.0722)),dot(uStraightExact(down)-uStraightExact(up),vec3f(0.2126,0.7152,0.0722)));
  return sampleSource(input.uv-grad*${p("drift")}.x*globals.viewport.zw*globals.clock.z);`,
    looks: [
      ["Gentle run", { reach: 1, drift: 5 }],
      ["Reverse transport", { reach: 4, drift: -19 }],
    ],
  },
  {
    id: "owned-u-rule-thirty",
    name: "Rule Thirty Spacetime",
    kind: "generator",
    mechanism:
      "Evaluates a bounded elementary cellular automaton from a single seeded bit across fifteen prior rows; horizontal neighborhoods combine by XOR/OR, giving a causal spacetime texture rather than spatial noise.",
    closest: "Triangular Lacunae; Reaction Field; Life Mosaic compute draft",
    cost: "Fifteen integer neighborhood updates per pixel, no mutable history.",
    properties: {
      cell: px("Cell size", 8, 4, 24),
      seed: {
        type: "int",
        label: "Seed",
        default: 17,
        min: 0,
        max: 30,
        step: 1,
      },
      live: pigment("Live", 0.82, 0.62, 0.29),
      dead: pigment("Dead", 0.06, 0.1, 0.15),
    },
    fragment: (p) => `
  let point=input.uv*globals.viewport.xy/globals.clock.z;
  let column=i32(floor(point.x/${p("cell")}.x));
  let row=i32(floor(point.y/${p("cell")}.x));
  let cycle=((row%15)+15)%15;
  var bits=1u<<15u;
  for(var stepIndex=0;stepIndex<15;stepIndex+=1){
    if(stepIndex<cycle){let left=bits<<1u;let right=bits>>1u;bits=left^(bits|right);}
  }
  let shift=u32(((column+i32(${p("seed")}.x))%31+31)%31);
  let on=f32((bits>>shift)&1u);
  let a=${p("dead")};let b=${p("live")};
  return mix(vec4f(a.rgb*a.a,a.a),vec4f(b.rgb*b.a,b.a),on);`,
    looks: [
      ["Small cells", { cell: 5, seed: 9 }],
      ["Large field", { cell: 16, seed: 26 }],
    ],
  },
  {
    id: "owned-u-thue-morse-weave",
    name: "Thue–Morse Weave",
    kind: "generator",
    mechanism:
      "Uses parity of set bits in integer row and column indices to form a deterministic aperiodic substitution fabric; crossings are encoded by XOR, not a repeated checker or random stipple.",
    closest: "Checker Phase; Tartan Interlace; Quilted Diamonds",
    cost: "Two bounded bit-parity reductions per pixel.",
    properties: {
      cell: px("Thread cell", 12, 4, 40),
      seam: px("Thread gap", 1, 0, 5),
      front: pigment("Front", 0.75, 0.55, 0.37),
      back: pigment("Back", 0.08, 0.13, 0.2),
    },
    fragment: (p) => `
  let point=input.uv*globals.viewport.xy/globals.clock.z;
  let grid=vec2u(floor(point/${p("cell")}.x));
  var a=grid.x;var b=grid.y;var parityA=0u;var parityB=0u;
  for(var bitIndex=0u;bitIndex<12u;bitIndex+=1u){parityA^=(a&1u);parityB^=(b&1u);a>>=1u;b>>=1u;}
  let phase=f32(parityA^parityB);
  let local=fract(point/${p("cell")}.x)*${p("cell")}.x;
  let edge=min(min(local.x,local.y),min(${p("cell")}.x-local.x,${p("cell")}.x-local.y));
  let mask=smoothstep(0.0,${p("seam")}.x+1.0/globals.clock.z,edge);
  let front=${p("front")};let back=${p("back")};
  return mix(vec4f(back.rgb*back.a,back.a),vec4f(front.rgb*front.a,front.a),phase*mask);`,
    looks: [
      ["Fine substitution", { cell: 6, seam: 0.4 }],
      ["Open weave", { cell: 26, seam: 3 }],
    ],
  },
  {
    id: "owned-u-weierstrass-ridges",
    name: "Weierstrass Ridges",
    kind: "generator",
    mechanism:
      "Sums bounded lacunary cosine frequencies along an octave-rotated coordinate frame with geometrically decaying amplitudes and thresholded signed ridges; unlike fractal noise it has deterministic phase and ridge geometry.",
    closest: "Fractal Cloud; Harmonic Band Map; Wave Interference",
    cost: "Six cosine evaluations per pixel.",
    properties: {
      scale: px("Base wavelength", 70, 20, 160),
      growth: catalogFloat("Frequency growth", 2.1, 1.6, 2.8),
      decay: catalogFloat("Amplitude decay", 0.53, 0.3, 0.75),
      contour: catalogFloat("Ridge threshold", 0.2, 0, 0.8),
      ridge: pigment("Ridge", 0.76, 0.72, 0.5),
      ground: pigment("Ground", 0.06, 0.1, 0.17),
    },
    fragment: (p) => `
  var point=input.uv*globals.viewport.xy/globals.clock.z/${p("scale")}.x;
  var wave=0.0;var amplitude=0.5;var total=0.0;
  for(var octave=0u;octave<6u;octave+=1u){
    wave+=cos(6.2831853*point.x)*amplitude;
    total+=amplitude;point=vec2f(point.x*0.86-point.y*0.51,point.x*0.51+point.y*0.86)*${p("growth")}.x;amplitude*=${p("decay")}.x;}
  let height=abs(wave/max(total,0.00001));
  let coverage=smoothstep(${p("contour")}.x,${p("contour")}.x+0.08,height);
  let ridge=${p("ridge")};let ground=${p("ground")};
  return mix(vec4f(ground.rgb*ground.a,ground.a),vec4f(ridge.rgb*ridge.a,ridge.a),coverage);`,
    looks: [
      ["Broad bands", { scale: 110, growth: 1.7, contour: 0.35 }],
      ["Fine ridges", { scale: 30, growth: 2.6, decay: 0.68, contour: 0.1 }],
    ],
  },
  {
    id: "owned-u-staggered-pentagon",
    name: "Staggered Pentagon Mosaic",
    kind: "generator",
    mechanism:
      "Splits each staggered square cell into two complementary five-edge pentagons with a two-segment kinked seam; only the controlled grout separates the tiles.",
    closest: "Hex Tiles; Octagon Square Tiling; Quilted Diamonds",
    cost: "Two bounded segment projections and four exterior-edge distances per pixel.",
    properties: {
      scale: px("Tile scale", 44, 18, 90),
      grout: px("Grout", 2, 0.5, 9),
      face: pigment("Face", 0.77, 0.6, 0.43),
      mortar: pigment("Mortar", 0.07, 0.11, 0.17),
    },
    fragment: (p) => `
  let point=input.uv*globals.viewport.xy/globals.clock.z/${p("scale")}.x;
  let row=i32(floor(point.y));
  let odd=(row%2)!=0;
  let q=vec2f(fract(point.x-select(0.0,0.5,odd)),fract(point.y));
  let top=vec2f(0.5,0.0);
  let middle=vec2f(select(0.72,0.28,odd),0.5);
  let bottom=vec2f(0.5,1.0);
  let first=middle-top;let second=bottom-middle;
  let firstT=clamp(dot(q-top,first)/dot(first,first),0.0,1.0);
  let secondT=clamp(dot(q-middle,second)/dot(second,second),0.0,1.0);
  let seam=min(length(q-top-first*firstT),length(q-middle-second*secondT));
  let outer=min(min(q.x,1.0-q.x),min(q.y,1.0-q.y));
  let boundary=min(seam,outer)*${p("scale")}.x;
  let coverage=smoothstep(${p("grout")}.x*0.5,${p("grout")}.x*0.5+1.0/globals.clock.z,boundary);
  let face=${p("face")};let mortar=${p("mortar")};
  return mix(vec4f(mortar.rgb*mortar.a,mortar.a),vec4f(face.rgb*face.a,face.a),coverage);`,
    looks: [
      ["Small masonry", { scale: 25, grout: 1 }],
      ["Wide joints", { scale: 70, grout: 6 }],
    ],
  },
  {
    id: "owned-u-plastic-disc-light",
    name: "Plastic Disc Light",
    kind: "generator",
    mechanism:
      "Analytic disc normal and roughness-controlled Blinn halfway specular highlight over a diffuse body, without an environment texture or metal Fresnel response.",
    closest: "Environment Metal; Photo Sphere; Plastic source candidate",
    cost: "One disc normal, one diffuse and one specular lobe per pixel.",
    properties: {
      radius: px("Disc radius", 64, 20, 110),
      roughness: catalogFloat("Roughness", 0.35, 0.08, 0.9),
      lightX: catalogFloat("Light X", -0.35, -1, 1),
      lightY: catalogFloat("Light Y", -0.5, -1, 1),
      body: pigment("Body", 0.42, 0.16, 0.35),
      shine: pigment("Highlight", 0.95, 0.88, 0.79),
      ground: pigment("Ground", 0.05, 0.07, 0.11),
    },
    fragment: (p) => `
  let point=(input.uv-vec2f(0.5))*globals.viewport.xy/globals.clock.z;
  let radial=length(point)/${p("radius")}.x;
  let coverage=1.0-smoothstep(0.98,1.0+1.0/(${p("radius")}.x*globals.clock.z),radial);
  let z=sqrt(max(1.0-radial*radial,0.0));
  let normal=normalize(vec3f(point/${p("radius")}.x,z));
  let light=normalize(vec3f(${p("lightX")}.x,${p("lightY")}.x,0.8));
  let halfVector=normalize(light+vec3f(0.0,0.0,1.0));
  let diffuse=max(dot(normal,light),0.0);
  let gloss=pow(max(dot(normal,halfVector),0.0),mix(80.0,3.0,${p("roughness")}.x));
  let body=${p("body")};let shine=${p("shine")};let ground=${p("ground")};
  let lit=premultiply(body.rgb*(0.18+0.82*diffuse)+shine.rgb*gloss*shine.a,body.a);
  return mix(vec4f(ground.rgb*ground.a,ground.a),lit,coverage);`,
    looks: [
      ["Soft polymer", { roughness: 0.7, lightX: -0.6 }],
      ["Hard glaze", { roughness: 0.1, lightX: 0.3, lightY: -0.8 }],
    ],
  },
  {
    id: "owned-u-viscous-union",
    name: "Viscous Union",
    kind: "generator",
    mechanism:
      "Smooth-min union of three independent moving-free signed circles with gradient-derived normals and a wet specular lobe; differs from simple sum-threshold metaballs.",
    closest: "Metaball Field; Goo source candidate; Coral Polyps",
    cost: "Five field evaluations (15 circle distances), four finite-difference gradient taps and one specular lobe per pixel.",
    properties: {
      radius: px("Lobe radius", 38, 12, 70),
      blend: px("Merge width", 22, 2, 45),
      gloss: catalogFloat("Wet gloss", 0.7, 0, 1),
      body: pigment("Body", 0.21, 0.57, 0.43),
      shine: pigment("Glint", 0.85, 0.98, 0.78),
      ground: pigment("Ground", 0.04, 0.07, 0.1),
    },
    helpers: (p) => `
fn uField(q:vec2f)->f32{
  let a=length(q-vec2f(-32.0,13.0))-${p("radius")}.x;
  let b=length(q-vec2f(28.0,-15.0))-${p("radius")}.x*0.8;
  let c=length(q-vec2f(8.0,32.0))-${p("radius")}.x*0.64;
  let k=${p("blend")}.x;
  let h=clamp(0.5+0.5*(b-a)/k,0.0,1.0);
  let first=mix(b,a,h)-k*h*(1.0-h);
  let j=clamp(0.5+0.5*(c-first)/k,0.0,1.0);
  return mix(c,first,j)-k*j*(1.0-j);
}`,
    fragment: (p) => `
  let point=(input.uv-vec2f(0.5))*globals.viewport.xy/globals.clock.z;
  let d=uField(point);
  let coverage=1.0-smoothstep(-0.5/globals.clock.z,0.5/globals.clock.z,d);
  let gx=uField(point+vec2f(1.0,0.0))-uField(point-vec2f(1.0,0.0));
  let gy=uField(point+vec2f(0.0,1.0))-uField(point-vec2f(0.0,1.0));
  let normal=normalize(vec3f(gx,gy,2.5));
  let glint=pow(max(dot(normal,normalize(vec3f(-0.4,-0.5,1.0))),0.0),24.0)*${p("gloss")}.x;
  let body=${p("body")};let shine=${p("shine")};let ground=${p("ground")};
  let lit=premultiply(body.rgb*(0.45+0.55*max(normal.z,0.0))+shine.rgb*glint*shine.a,body.a);
  return mix(vec4f(ground.rgb*ground.a,ground.a),lit,coverage);`,
    looks: [
      ["Compact gel", { radius: 25, blend: 12, gloss: 0.4 }],
      ["Merged drops", { radius: 58, blend: 38, gloss: 1 }],
    ],
  },
];

export const OWNED_NEXT_TWELVE_U_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_TWELVE_U_DRAFTS.map((draft) => {
    const base = catalogShader(draft);
    return {
      ...base,
      resources: base.resources?.map((resource) =>
        resource.name === "color"
          ? { ...resource, format: "rgba16float" }
          : resource,
      ),
      provenance: {
        origin: "design-original",
        note: draft.mechanism.slice(0, 240),
      },
    };
  });

export const OWNED_NEXT_TWELVE_U_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_TWELVE_U_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: draft.version ?? 1,
      placement:
        draft.kind === "generator" ? ("fill" as const) : ("layer" as const),
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
