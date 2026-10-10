import {
  catalogColor,
  catalogFloat,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { CatalogShaderSpec } from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = Omit<CatalogShaderSpec, "fragment"> & {
  fragment: string;
  mechanism: string;
  cost: string;
  looks: readonly [Look, Look];
};
const fraction = (label: string, value: number) =>
  catalogFloat(label, value, 0, 1);
const distance = (
  label: string,
  value: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});
const color = (
  label: string,
  r: number,
  g: number,
  b: number,
  a = 1,
): EffectProperty => ({
  type: "color",
  label,
  default: catalogColor(r, g, b, a),
});
const shared =
  "fn painted(c:vec4f,v:f32)->vec4f{let a=c.a*clamp(v,0.0,1.0);return vec4f(c.rgb*a,a);} fn over(a:vec4f,b:vec4f)->vec4f{return vec4f(a.rgb+b.rgb*(1.0-a.a),a.a+b.a*(1.0-a.a));}";

export const OWNED_O_GENERATOR_DRAFTS: readonly Draft[] = [
  {
    id: "owned-o-angular-stops",
    name: "Angular Color Stops",
    kind: "generator",
    mechanism:
      "Four separately positioned color stops form a piecewise polar-angle field with a controllable circular seam and repeat count. The angular topology differs from a radial or mesh gradient.",
    cost: "Four color stops, three position controls and one polar coordinate evaluation",
    properties: {
      centerX: fraction("Center X", 0.5),
      centerY: fraction("Center Y", 0.5),
      rotation: catalogFloat("Rotation", 0, -6.2831853, 6.2831853),
      repeats: catalogFloat("Repeats", 1, 1, 8, 1),
      stop1: fraction("Second stop", 0.25),
      stop2: fraction("Third stop", 0.5),
      stop3: fraction("Fourth stop", 0.75),
      seam: fraction("Seam softness", 0.02),
      first: color("First", 0.95, 0.15, 0.2),
      second: color("Second", 0.95, 0.65, 0.16),
      third: color("Third", 0.16, 0.7, 0.78),
      fourth: color("Fourth", 0.35, 0.15, 0.7),
    },
    fragment:
      "let aspect=globals.viewport.x/max(globals.viewport.y,1.0); let q=(input.uv-vec2f(@centerX.x,@centerY.x))*vec2f(aspect,1.0); let angle=fract((atan2(q.y,q.x)+@rotation.x)/TAU*@repeats.x+2.0); var aP=@stop1.x;var bP=@stop2.x;var cP=@stop3.x;var aC=@second;var bC=@third;var cC=@fourth;var tempP=0.0;var tempC=vec4f(0.0);if(aP>bP){tempP=aP;aP=bP;bP=tempP;tempC=aC;aC=bC;bC=tempC;}if(bP>cP){tempP=bP;bP=cP;cP=tempP;tempC=bC;bC=cC;cC=tempC;}if(aP>bP){tempP=aP;aP=bP;bP=tempP;tempC=aC;aC=bC;bC=tempC;} var colorOut=@first; if(angle<aP){colorOut=mix(@first,aC,smoothstep(0.0,max(aP,0.0001),angle));} else if(angle<bP){colorOut=mix(aC,bC,smoothstep(aP,max(bP,aP+0.0001),angle));} else if(angle<cP){colorOut=mix(bC,cC,smoothstep(bP,max(cP,bP+0.0001),angle));} else{let arc=smoothstep(cP,1.0,angle);let eased=smoothstep(0.0,1.0,arc);colorOut=mix(cC,@first,mix(arc,eased,@seam.x));} return painted(colorOut,1.0);",
    looks: [
      ["Four sectors", { stop1: 0.18, stop2: 0.52, stop3: 0.84, seam: 0.01 }],
      [
        "Tidal rotation",
        {
          centerX: 0.4,
          centerY: 0.61,
          rotation: 1.2,
          repeats: 3,
          stop1: 0.14,
          stop2: 0.63,
          stop3: 0.91,
          third: catalogColor(0.13, 0.88, 0.54),
        },
      ],
    ],
  },
  {
    id: "owned-o-studio-light-rig",
    name: "Studio Light Rig",
    kind: "generator",
    mechanism:
      "A curved matte surface receives independent directional key, fill and grazing rim lighting. The lights act on one synthetic normal field, rather than combining three color gradients.",
    cost: "One analytic surface normal and three light responses",
    properties: {
      curve: fraction("Surface curvature", 0.68),
      keyX: catalogFloat("Key X", -0.55, -1, 1),
      keyY: catalogFloat("Key Y", -0.42, -1, 1),
      fillX: catalogFloat("Fill X", 0.72, -1, 1),
      fillY: catalogFloat("Fill Y", 0.2, -1, 1),
      key: fraction("Key strength", 0.85),
      fill: fraction("Fill strength", 0.36),
      rim: fraction("Rim strength", 0.45),
      ambient: fraction("Ambient", 0.15),
      surface: color("Surface", 0.44, 0.55, 0.7),
      keyColor: color("Key color", 1, 0.86, 0.66),
      fillColor: color("Fill color", 0.39, 0.62, 1),
    },
    fragment:
      "let q=(input.uv-vec2f(0.5))*2.0; let normal=normalize(vec3f(-q*@curve.x,1.0)); let k=normalize(vec3f(@keyX.x,@keyY.x,1.0)); let f=normalize(vec3f(@fillX.x,@fillY.x,1.0)); let kd=max(dot(normal,k),0.0)*@key.x; let fd=max(dot(normal,f),0.0)*@fill.x; let rim=pow(1.0-max(normal.z,0.0),2.0)*@rim.x; let baseColor=@surface; let lit=baseColor.rgb*(@ambient.x+kd*@keyColor.rgb*@keyColor.a+fd*@fillColor.rgb*@fillColor.a)+rim*@keyColor.rgb*@keyColor.a; return vec4f(lit*baseColor.a,baseColor.a);",
    looks: [
      ["Softbox", { curve: 0.38, key: 0.7, fill: 0.55, rim: 0.15 }],
      [
        "Raking light",
        {
          curve: 0.92,
          keyX: -0.9,
          keyY: -0.7,
          key: 1,
          fill: 0.16,
          rim: 0.8,
          ambient: 0.06,
        },
      ],
    ],
  },
  {
    id: "owned-o-inhibited-stipple",
    name: "Inhibited Stipple",
    kind: "generator",
    mechanism:
      "One seeded point candidate per jittered cell survives only when no neighboring candidate of higher priority lies within its exclusion disk. This hard-core point process suppresses adjacent dots, unlike independent grain or periodic dither.",
    cost: "Up to 225 bounded priority checks and 250 candidate positions per pixel; spectral gate remains pending",
    properties: {
      spacing: {
        type: "float",
        label: "Mean spacing",
        default: 13,
        min: 2,
        max: 35,
        step: 0.1,
        unit: "px",
      },
      exclusion: fraction("Exclusion", 0.72),
      dotRadius: fraction("Dot radius", 0.17),
      jitter: catalogFloat("Jitter", 0.22, 0, 0.45),
      ink: color("Dots", 0.92, 0.91, 0.8),
      background: color("Background", 0.07, 0.09, 0.13),
    },
    helpers: () =>
      "fn candidate(c:vec2i,j:f32)->vec2f{return vec2f(c)+vec2f(random(c*3+vec2i(11,7))-0.5,random(c*3+vec2i(37,17))-0.5)*j*2.0;} fn retained(c:vec2i,j:f32,r:f32)->bool{let point=candidate(c,j);let rank=random(c*5+vec2i(101,59));for(var y=-1;y<=1;y+=1){for(var x=-1;x<=1;x+=1){if(x==0&&y==0){continue;}let n=c+vec2i(x,y);let otherRank=random(n*5+vec2i(101,59));if(distance(point,candidate(n,j))<r&&(otherRank<rank||(otherRank==rank&&(n.y<c.y||(n.y==c.y&&n.x<c.x))))){return false;}}}return true;}",
    fragment:
      "let point=input.uv*globals.viewport.xy/max(globals.clock.z*@spacing.x,1.0); let cell=vec2i(floor(point)); var nearest=10.0; for(var y=-2;y<=2;y+=1){for(var x=-2;x<=2;x+=1){let c=cell+vec2i(x,y);if(retained(c,@jitter.x,@exclusion.x)){nearest=min(nearest,distance(point,candidate(c,@jitter.x)));}}} let mark=1.0-smoothstep(@dotRadius.x,@dotRadius.x+0.8/max(@spacing.x,1.0),nearest);return over(painted(@ink,mark),painted(@background,1.0));",
    looks: [
      [
        "Fine stipple",
        { spacing: 9, exclusion: 0.65, dotRadius: 0.13, jitter: 0.18 },
      ],
      [
        "Open field",
        {
          spacing: 22,
          exclusion: 0.85,
          dotRadius: 0.23,
          jitter: 0.3,
          ink: catalogColor(0.87, 0.56, 0.28),
        },
      ],
    ],
  },
  {
    id: "owned-o-ghost-chain",
    name: "Optical Ghost Chain",
    kind: "generator",
    mechanism:
      "A bounded sequence of lens-aperture ghosts lies on the line between one emitter and the image center. Ghost size and spectral tint vary along that optical axis, making a linked optical system rather than isolated halos.",
    cost: "Six bounded ghosts and one primary emitter",
    properties: {
      lightX: fraction("Emitter X", 0.22),
      lightY: fraction("Emitter Y", 0.2),
      size: distance("Aperture size", 54, 160),
      spread: fraction("Ghost spread", 0.82),
      ghosts: catalogFloat("Ghost count", 5, 1, 6, 1),
      intensity: fraction("Intensity", 0.75),
      halo: fraction("Halo", 0.35),
      warm: color("Warm flare", 1, 0.42, 0.17),
      cool: color("Cool flare", 0.18, 0.48, 1),
    },
    fragment:
      "let point=input.uv*globals.viewport.xy/globals.clock.z;let view=globals.viewport.xy/globals.clock.z;let emitter=vec2f(@lightX.x,@lightY.x)*view;let axis=view*0.5-emitter;let d=length(point-emitter)/max(@size.x,1.0);var light=@warm.rgb*@warm.a*exp(-d*d*5.0)*@intensity.x+@warm.rgb*@warm.a*exp(-d*1.5)*@halo.x*0.3;for(var i=0;i<6;i+=1){if(f32(i)>=@ghosts.x){break;}let phase=(f32(i)+1.0)/7.0;let center=emitter+axis*(1.0+phase*@spread.x*2.0);let radius=@size.x*(0.18+phase*0.55);let distanceToGhost=length(point-center)/max(radius,1.0);let aperture=pow(max(1.0-distanceToGhost*distanceToGhost,0.0),2.0);light+=mix(@warm.rgb*@warm.a,@cool.rgb*@cool.a,phase)*aperture*@intensity.x*(0.5-phase*0.3);}let alpha=clamp(max(max(light.r,light.g),light.b),0.0,1.0);return vec4f(light,alpha);",
    looks: [
      [
        "Window flare",
        { lightX: 0.13, lightY: 0.2, size: 42, spread: 0.85, ghosts: 6 },
      ],
      [
        "Cool optics",
        {
          lightX: 0.81,
          lightY: 0.16,
          size: 84,
          spread: 0.54,
          ghosts: 4,
          cool: catalogColor(0.16, 0.8, 0.94),
          intensity: 0.56,
        },
      ],
    ],
  },
];

function expand(fragment: string, slot: (name: string) => string): string {
  return fragment.replace(/@([A-Za-z][A-Za-z0-9]*)/g, (_, name: string) =>
    slot(name),
  );
}
function definitionFor(draft: Draft): EffectDefinition {
  const definition = catalogShader({
    ...draft,
    fragment: (slot) => expand(draft.fragment, slot),
    helpers: (slot) => shared + (draft.helpers?.(slot) ?? ""),
  });
  return {
    ...definition,
    version:
      draft.id === "owned-o-angular-stops"
        ? 2
        : draft.id === "owned-o-inhibited-stipple"
          ? 3
          : definition.version,
    resources: definition.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" }
        : resource,
    ),
    provenance: { origin: "design-original", note: draft.mechanism },
  };
}
export const OWNED_O_GENERATOR_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_O_GENERATOR_DRAFTS.map(definitionFor);
export const OWNED_O_GENERATOR_PRESETS: readonly EffectPreset[] =
  OWNED_O_GENERATOR_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: "an-preset-" + draft.id + "-" + (index + 1),
      name,
      definitionId: "an-native-" + draft.id,
      definitionVersion:
        draft.id === "owned-o-angular-stops"
          ? 2
          : draft.id === "owned-o-inhibited-stipple"
            ? 3
            : 1,
      placement: draft.backdrop
        ? "backdrop"
        : draft.kind === "processor"
          ? "layer"
          : "fill",
      params,
      clip: "bounds",
      provenance: { origin: "design-original" },
    })),
  );
