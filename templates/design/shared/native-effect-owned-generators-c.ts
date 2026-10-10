import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type {
  EffectColor,
  EffectDefinition,
  EffectPreset,
} from "./native-effects";

type Pair = readonly [EffectColor, EffectColor];
type Family =
  | "material"
  | "textile"
  | "mathematical"
  | "atmosphere"
  | "geometry";
type Draft = {
  id: string;
  name: string;
  family: Family;
  mechanism: string;
  cost: string;
  control: { label: string; value: number; min: number; max: number };
  looks: readonly [Pair, Pair];
  body: string;
  animated?: true;
};
const effectColor = (r: number, g: number, b: number): EffectColor => ({
  space: "srgb",
  components: [r, g, b],
  alpha: 1,
});
const slate: Pair = [
  effectColor(0.025, 0.04, 0.055),
  effectColor(0.63, 0.78, 0.85),
];
const ochre: Pair = [
  effectColor(0.095, 0.055, 0.025),
  effectColor(0.92, 0.69, 0.34),
];
const paper: Pair = [
  effectColor(0.16, 0.13, 0.1),
  effectColor(0.95, 0.88, 0.72),
];
const moss: Pair = [
  effectColor(0.025, 0.085, 0.055),
  effectColor(0.58, 0.76, 0.39),
];
const violet: Pair = [
  effectColor(0.055, 0.028, 0.11),
  effectColor(0.8, 0.5, 0.89),
];
const coral: Pair = [
  effectColor(0.11, 0.035, 0.05),
  effectColor(0.96, 0.52, 0.41),
];
const frost: Pair = [
  effectColor(0.025, 0.085, 0.13),
  effectColor(0.73, 0.94, 0.95),
];
const basalt: Pair = [
  effectColor(0.018, 0.024, 0.033),
  effectColor(0.43, 0.48, 0.53),
];
const math = `
fn hashCell(q: vec2f) -> f32 { return fract(sin(dot(q,vec2f(71.37,219.83)))*25431.171); }
fn noise2(q: vec2f) -> f32 {
  let c=floor(q); let f=fract(q); let u=f*f*(3.0-2.0*f);
  return mix(mix(hashCell(c),hashCell(c+vec2f(1.0,0.0)),u.x),
    mix(hashCell(c+vec2f(0.0,1.0)),hashCell(c+vec2f(1.0)),u.x),u.y);
}
fn cell2(q: vec2f) -> vec3f {
  let base=floor(q); var nearest=100.0; var second=100.0; var tag=0.0;
  for(var yy=-1;yy<=1;yy+=1){for(var xx=-1;xx<=1;xx+=1){
    let c=base+vec2f(f32(xx),f32(yy));
    let site=c+vec2f(hashCell(c),hashCell(c+vec2f(11.0,7.0)))*0.7+0.15;
    let d=distance(site,q);
    if(d<nearest){second=nearest;nearest=d;tag=hashCell(c+vec2f(29.0,3.0));}
    else if(d<second){second=d;}
  }} return vec3f(nearest,second,tag);
}
fn rot(q: vec2f,a:f32)->vec2f{return vec2f(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a));}
fn box3(q:vec3f,s:vec3f)->f32{let d=abs(q)-s;return length(max(d,vec3f(0.0)))+min(max(d.x,max(d.y,d.z)),0.0);}
`;

export const OWNED_GENERATOR_C_DRAFTS: readonly Draft[] = [
  {
    id: "wood-endgrain",
    name: "Wood Endgrain",
    family: "material",
    mechanism: "off-center growth rings warped by radial grain and pore rays",
    cost: "one fragment; two noise evaluations",
    control: { label: "Ring density", value: 17, min: 5, max: 42 },
    looks: [ochre, paper],
    body: `let q=p+vec2f(noise2(p*3.0),noise2(p*3.0+13.0))*0.045;
    let angle=atan2(q.y,q.x); let r=length(q)+noise2(q*8.0)*0.07;
    let rings=0.5+0.5*cos(r*detail*6.283185+sin(angle*9.0)*0.12);
    let pores=pow(hashCell(floor(vec2f(angle*32.0,r*detail*2.0))),9.0);
    let field=clamp(rings*0.83+pores*0.18,0.0,1.0);`,
  },
  {
    id: "basalt-vesicles",
    name: "Basalt Vesicles",
    family: "material",
    mechanism: "irregular cellular cavities within granular stone",
    cost: "one cellular neighborhood and one noise evaluation",
    control: { label: "Vesicle density", value: 12, min: 4, max: 30 },
    looks: [basalt, slate],
    body: `let q=p*detail; let cells=cell2(q+noise2(q*0.3)*0.25);
    let cavity=1.0-smoothstep(0.1,0.33,cells.x);
    let crust=noise2(q*4.0)*0.21;
    let field=clamp(0.48+crust-cavity*0.66+smoothstep(0.02,0.18,cells.y-cells.x)*0.1,0.0,1.0);`,
  },
  {
    id: "terrazzo-chips",
    name: "Terrazzo Chips",
    family: "material",
    mechanism: "faceted polygon fragments separated by grout",
    cost: "one cellular neighborhood",
    control: { label: "Chip density", value: 11, min: 3, max: 28 },
    looks: [paper, coral],
    body: `let q=p*detail;let cells=cell2(q);let grout=1.0-smoothstep(0.025,0.11,cells.y-cells.x);
    let facet=0.24+0.66*cells.z+0.12*sin(q.x*4.0+q.y*3.0);
    let field=clamp(facet*(1.0-grout)+grout*0.08,0.0,1.0);`,
  },
  {
    id: "mica-schist",
    name: "Mica Schist",
    family: "material",
    mechanism:
      "folded metamorphic strata with sparse angle-dependent mica flecks",
    cost: "one fragment; two noise evaluations",
    control: { label: "Strata folds", value: 15, min: 4, max: 40 },
    looks: [slate, violet],
    body: `let bend=noise2(p*2.1)*0.22;
    let layers=0.5+0.5*cos((p.y+bend)*detail*6.283185);
    let flakes=pow(noise2(p*detail*3.0+vec2f(17.0)),18.0);
    let field=clamp(layers*0.63+flakes*0.57,0.0,1.0);`,
  },
  {
    id: "salt-crust",
    name: "Salt Crust",
    family: "material",
    mechanism: "square-norm crystal islands with stepped evaporative edges",
    cost: "one cellular neighborhood",
    control: { label: "Crystal density", value: 14, min: 5, max: 35 },
    looks: [paper, frost],
    body: `let q=p*detail;let cell=floor(q);let local=fract(q)-0.5;
    let angle=hashCell(cell)*6.283185;let crystal=rot(local,angle);
    let diamond=abs(crystal.x)+abs(crystal.y);
    let height=0.22+0.16*hashCell(cell+vec2f(5.0));
    let terraces=1.0-smoothstep(height-0.04,height+0.02,diamond);
    let field=clamp(terraces*(0.6+0.4*hashCell(cell+vec2f(13.0))),0.0,1.0);`,
  },
  {
    id: "parchment-fibrils",
    name: "Parchment Fibrils",
    family: "material",
    mechanism: "anisotropic sparse cellulose strands over low-frequency stain",
    cost: "two noise evaluations and one hash",
    control: { label: "Fiber density", value: 48, min: 12, max: 110 },
    looks: [paper, ochre],
    body: `let q=vec2f(p.x*detail,p.y*detail*0.15);
    let longFiber=pow(1.0-abs(fract(q.x+noise2(q*0.7)*0.3)-0.5)*2.0,12.0);
    let breaks=hashCell(floor(q*vec2f(1.0,5.0)));
    let stain=noise2(p*3.0);
    let field=clamp(0.42+stain*0.28+longFiber*step(0.47,breaks)*0.34,0.0,1.0);`,
  },
  {
    id: "corduroy-ridges",
    name: "Corduroy Ridges",
    family: "textile",
    mechanism: "pile ridges with directional nap and alternating seam shadows",
    cost: "one noise evaluation",
    control: { label: "Wale count", value: 23, min: 6, max: 60 },
    looks: [ochre, violet],
    body: `let lane=p.x*detail;let ridge=pow(max(0.0,cos(lane*6.283185)),4.0);
    let side=sin(lane*6.283185)*0.11;
    let nap=noise2(vec2f(p.x*detail*0.7,p.y*85.0));
    let field=clamp(0.19+ridge*0.62+side+nap*0.19,0.0,1.0);`,
  },
  {
    id: "ikat-warp",
    name: "Ikat Warp",
    family: "textile",
    mechanism: "blurred tie-dyed warp bands shifted independently by row",
    cost: "two noise evaluations",
    control: { label: "Dye band count", value: 8, min: 3, max: 24 },
    looks: [violet, coral],
    body: `let yarn=floor((p.y+1.0)*detail*8.0);
    let offset=noise2(vec2f(yarn*0.17,3.0))*0.18;
    let dyed=abs(sin((p.x+offset)*detail*3.141592));
    let bleed=noise2(vec2f(p.x*detail,p.y*detail*2.0))*0.17;
    let field=1.0-smoothstep(0.37,0.63,dyed+bleed);`,
  },
  {
    id: "marled-yarn",
    name: "Marled Yarn",
    family: "textile",
    mechanism: "helical contrasting fibers twisted around each yarn axis",
    cost: "one noise evaluation",
    control: { label: "Twist count", value: 18, min: 5, max: 52 },
    looks: [slate, coral],
    body: `let lane=floor(p.x*detail);let cross=fract(p.x*detail)-0.5;
    let twist=sin(p.y*detail*5.0+lane*1.7);
    let helix=1.0-smoothstep(0.03,0.13,abs(cross-twist*0.28));
    let fiber=noise2(vec2f(p.x*detail*4.0,p.y*detail*8.0));
    let field=clamp(0.27+helix*0.55+fiber*0.17,0.0,1.0);`,
  },
  {
    id: "crochet-chain",
    name: "Crochet Chain",
    family: "textile",
    mechanism: "interlinked offset loops with strand crossing order",
    cost: "analytic periodic distances",
    control: { label: "Loop density", value: 10, min: 3, max: 24 },
    looks: [paper, violet],
    body: `let q=p*detail;let row=floor(q.y);let local=fract(q+vec2f(select(0.0,0.5,i32(row)%2==0),0.0))-0.5;
    let ring=abs(length(local*vec2f(1.0,1.35))-0.32);
    let knot=length(local-vec2f(0.0,0.38));
    let strand=1.0-smoothstep(0.02,0.075,min(ring,knot));
    let field=clamp(strand*(0.75+0.25*smoothstep(-0.2,0.2,local.y)),0.0,1.0);`,
  },
  {
    id: "tartan-interlace",
    name: "Tartan Interlace",
    family: "textile",
    mechanism:
      "unequal horizontal/vertical plaid bands with over-under yarn shading",
    cost: "analytic modular bands",
    control: { label: "Set repeat", value: 9, min: 3, max: 25 },
    looks: [coral, moss],
    body: `let q=p*detail;let warp=fract(q.x);let weft=fract(q.y);
    let a=select(0.15,0.8,warp<0.18||warp>0.72);
    let b=select(0.12,0.75,weft<0.27||weft>0.83);
    let over=select(-0.13,0.13,i32(floor(q.x)+floor(q.y))%2==0);
    let field=clamp(a*0.43+b*0.43+over*(a*b),0.0,1.0);`,
  },
  {
    id: "knotted-net",
    name: "Knotted Net",
    family: "textile",
    mechanism: "diamond rope mesh joined by raised knot cells",
    cost: "analytic diagonal distances",
    control: { label: "Mesh pitch", value: 12, min: 4, max: 32 },
    looks: [paper, slate],
    body: `let q=p*detail;let a=abs(fract(q.x+q.y)-0.5);let b=abs(fract(q.x-q.y)-0.5);
    let rope=1.0-smoothstep(0.04,0.11,min(a,b));
    let joint=pow(max(0.0,1.0-length(fract(q*2.0)-0.5)*2.0),5.0);
    let field=clamp(rope*0.72+joint*0.45,0.0,1.0);`,
  },
  {
    id: "guilloche-rosettes",
    name: "Guilloche Rosettes",
    family: "mathematical",
    mechanism: "nested radial epicycle engravings",
    cost: "analytic polar bands",
    control: { label: "Lobe count", value: 11, min: 4, max: 30 },
    looks: [slate, ochre],
    body: `let a=atan2(p.y,p.x);let r=length(p);
    let orbit=0.42+0.09*cos(a*detail)+0.035*cos(a*detail*3.0);
    let stroke=1.0-smoothstep(0.005,0.027,abs(r-orbit));
    let inner=1.0-smoothstep(0.004,0.019,abs(r-(orbit*0.7)));
    let field=clamp(stroke*0.86+inner*0.54,0.0,1.0);`,
  },
  {
    id: "hypotrochoid-ink",
    name: "Hypotrochoid Ink",
    family: "mathematical",
    mechanism: "nearest distance to a sampled rolling-circle curve",
    cost: "32 parametric samples per pixel",
    control: { label: "Rolling ratio", value: 3, min: 2, max: 7 },
    looks: [violet, ochre],
    body: `var nearest=100.0;
    for(var i=0u;i<32u;i+=1u){let a=f32(i)*0.19634954;
      let small=1.0/max(detail,2.0);
      let point=vec2f((1.0-small)*cos(a)+0.47*small*cos((1.0-small)/small*a),
        (1.0-small)*sin(a)-0.47*small*sin((1.0-small)/small*a));
      nearest=min(nearest,distance(p,point));}
    let field=1.0-smoothstep(0.012,0.052,nearest);`,
  },
  {
    id: "logarithmic-spiral-lines",
    name: "Logarithmic Spiral Lines",
    family: "mathematical",
    mechanism:
      "log-polar spiral bands repeated across independent radial cells",
    cost: "analytic log/polar",
    control: { label: "Spiral arms", value: 7, min: 2, max: 20 },
    looks: [moss, ochre],
    body: `let r=max(length(p),0.001);let a=atan2(p.y,p.x);
    let phase=a*detail+log(r)*5.0;
    let line=abs(fract(phase/6.283185)-0.5);
    let field=1.0-smoothstep(0.02,0.11,line);`,
  },
  {
    id: "phyllotaxis-seeds",
    name: "Phyllotaxis Seeds",
    family: "mathematical",
    mechanism: "nearest of 64 golden-angle indexed seed positions",
    cost: "64 seed distances per pixel",
    control: { label: "Seed spread", value: 0.083, min: 0.04, max: 0.16 },
    looks: [ochre, moss],
    body: `var nearest=100.0;var seedIndex=0.0;
    for(var i=0u;i<64u;i+=1u){let k=f32(i)+0.5;
      let center=sqrt(k)*detail*vec2f(cos(k*2.399963),sin(k*2.399963));
      let d=distance(p,center);if(d<nearest){nearest=d;seedIndex=k;}}
    let disk=1.0-smoothstep(0.016,0.055,nearest);
    let field=disk*(0.55+0.45*hashCell(vec2f(seedIndex,5.0)));`,
  },
  {
    id: "quasicrystal-bands",
    animated: true,
    name: "Quasicrystal Bands",
    family: "mathematical",
    mechanism: "five incommensurate directional standing waves",
    cost: "five trigonometric wave terms",
    control: { label: "Wave frequency", value: 14, min: 4, max: 35 },
    looks: [frost, violet],
    body: `var interference=0.0;
    for(var i=0u;i<5u;i+=1u){let a=f32(i)*1.256637;
      interference+=cos(dot(p,vec2f(cos(a),sin(a)))*detail+t*0.07)/5.0;}
    let field=clamp(0.5+interference*0.58,0.0,1.0);`,
  },
  {
    id: "lissajous-weft",
    animated: true,
    name: "Lissajous Weft",
    family: "mathematical",
    mechanism:
      "crossing orthogonal sine trajectories with alternating crossing shade",
    cost: "analytic curves",
    control: { label: "Curve cycles", value: 8, min: 2, max: 24 },
    looks: [slate, coral],
    body: `let a=abs(p.y-sin(p.x*detail+t*0.1)*0.39);
    let b=abs(p.x-cos(p.y*(detail+1.0))*0.39);
    let first=1.0-smoothstep(0.017,0.052,a);
    let second=1.0-smoothstep(0.017,0.052,b);
    let field=clamp(first*0.73+second*0.64+first*second*0.2,0.0,1.0);`,
  },
  {
    id: "sinc-diffraction",
    name: "Sinc Diffraction",
    family: "atmosphere",
    mechanism: "radial sinc-squared core and decaying side lobes",
    cost: "analytic radial trigonometry",
    control: { label: "Ring frequency", value: 28, min: 8, max: 65 },
    looks: [slate, frost],
    body: `let radius=max(length(p),0.0001)*detail;
    let wave=sin(radius)/radius;
    let core=exp(-radius*radius*0.4);
    let field=clamp(core*0.35+wave*wave*0.9,0.0,1.0);`,
  },
  {
    id: "snow-squall",
    animated: true,
    name: "Snow Squall",
    family: "atmosphere",
    mechanism:
      "three parallax snow-particle strata with speed/depth-dependent size",
    cost: "three hashed cell neighborhoods",
    control: { label: "Flake density", value: 18, min: 5, max: 45 },
    looks: [slate, frost],
    body: `var field=0.03;
    for(var layer=0u;layer<3u;layer+=1u){let depth=f32(layer)+1.0;
      let q=p*detail*depth*0.55+vec2f(t*0.11/depth,-t*0.21/depth);
      let c=floor(q);let local=fract(q)-vec2f(hashCell(c),hashCell(c+vec2f(19.0)));
      let flake=1.0-smoothstep(0.012,0.055/depth,length(local));
      field+=flake*(0.55/depth);}
    field=clamp(field,0.0,1.0);`,
  },
  {
    id: "underwater-sediment",
    animated: true,
    name: "Underwater Sediment",
    family: "atmosphere",
    mechanism: "buoyancy-sorted particulate drift attenuated by vertical depth",
    cost: "two noise evaluations and one hash",
    control: { label: "Particle density", value: 27, min: 7, max: 65 },
    looks: [slate, moss],
    body: `let q=p*detail+vec2f(t*0.04,-t*0.09);
    let c=floor(q);let local=fract(q)-vec2f(hashCell(c),hashCell(c+vec2f(11.0)));
    let fleck=1.0-smoothstep(0.005,0.07,length(local));
    let depth=exp(-max(p.y+1.0,0.0)*1.1);
    let cloud=noise2(p*3.0+vec2f(0.0,t*0.015))*0.22;
    let field=clamp(fleck*depth*0.88+cloud,0.0,1.0);`,
  },
  {
    id: "dust-storm",
    animated: true,
    name: "Dust Storm",
    family: "atmosphere",
    mechanism:
      "wind-sheared density fronts with high-frequency suspended grains",
    cost: "three noise evaluations",
    control: { label: "Shear strength", value: 0.38, min: 0.05, max: 1.4 },
    looks: [ochre, paper],
    body: `let q=vec2f(p.x+p.y*detail+t*0.15,p.y);
    let front=noise2(q*2.0)+0.28*noise2(q*7.0);
    let grit=noise2(q*24.0)*0.12;
    let field=clamp(smoothstep(0.38,0.88,front+grit)*0.86,0.0,1.0);`,
  },
  {
    id: "twin-halo-arcs",
    name: "Twin Halo Arcs",
    family: "atmosphere",
    mechanism: "paired off-axis light spots with a shared circular halo",
    cost: "analytic angular lobes",
    control: { label: "Angular offset", value: 0.52, min: 0.2, max: 0.85 },
    looks: [slate, ochre],
    body: `let left=length(p-vec2f(-detail,0.13));let right=length(p-vec2f(detail,0.13));
    let dogs=exp(-left*left*32.0)+exp(-right*right*32.0);
    let halo=exp(-pow((length(p)-detail*1.25)*17.0,2.0))*0.31;
    let field=clamp(dogs*0.88+halo,0.0,1.0);`,
  },
  {
    id: "heat-inversion",
    animated: true,
    name: "Heat Inversion",
    family: "atmosphere",
    mechanism: "stratified density bands warped by rising convective cells",
    cost: "two noise evaluations",
    control: { label: "Thermal cells", value: 9, min: 3, max: 25 },
    looks: [coral, slate],
    body: `let rise=noise2(vec2f(p.x*detail,p.y*2.0-t*0.12));
    let horizon=p.y+rise*0.15;
    let layers=0.5+0.5*sin(horizon*detail*3.0);
    let cell=noise2(vec2f(p.x*detail*0.5,p.y*detail*0.8-t*0.06));
    let field=clamp(layers*0.41+cell*0.48,0.0,1.0);`,
  },
  {
    id: "superellipsoid",
    name: "Superellipsoid",
    family: "geometry",
    mechanism:
      "raymarched Lp superellipsoid with exponent-controlled roundness",
    cost: "48 bounded distance steps",
    control: { label: "Shape exponent", value: 3, min: 1.2, max: 7 },
    looks: [slate, coral],
    body: `let ray=normalize(vec3f(p,-1.7));var travel=0.0;var field=0.0;
    for(var i=0u;i<48u;i+=1u){let q=vec3f(0.0,0.0,2.6)+ray*travel;
      let lp=pow(pow(abs(q.x)/0.55,detail)+pow(abs(q.y)/0.69,detail)+pow(abs(q.z)/0.44,detail),1.0/detail)-1.0;
      let dist=lp*0.32;
      if(dist<0.003){let normal=normalize(vec3f(sign(q.x)*pow(abs(q.x),detail-1.0),sign(q.y)*pow(abs(q.y),detail-1.0),sign(q.z)*pow(abs(q.z),detail-1.0)));
        field=0.17+0.83*max(dot(normal,normalize(vec3f(-0.4,0.7,0.8))),0.0);break;}
      if(travel>5.0){break;} travel+=max(dist,0.007);}`,
  },
  {
    id: "catenoid-shell",
    name: "Catenoid Shell",
    family: "geometry",
    mechanism: "raymarched minimal-surface waist with axial crop",
    cost: "48 bounded distance steps",
    control: { label: "Waist radius", value: 0.36, min: 0.2, max: 0.6 },
    looks: [frost, ochre],
    body: `let ray=normalize(vec3f(p,-1.8));var travel=0.0;var field=0.0;
    for(var i=0u;i<48u;i+=1u){let q=vec3f(0.0,0.0,2.8)+ray*travel;
      let radial=length(q.xz);let h=clamp(q.y*1.4,-1.4,1.4);let waist=detail*(exp(h)+exp(-h))*0.5;
      let dist=max(abs(radial-waist)-0.035,abs(q.y)-0.75);
      if(dist<0.003){field=clamp(0.22+0.78*max(dot(normalize(vec3f(q.x,0.2,q.z)),normalize(vec3f(-0.5,0.7,0.5))),0.0),0.0,1.0);break;}
      if(travel>5.0){break;}travel+=max(dist,0.007);}`,
  },
  {
    id: "trefoil-tube",
    name: "Trefoil Tube",
    family: "geometry",
    mechanism: "sampled 3D trefoil centerline swept by constant tube radius",
    cost: "32 centerline checks × 40 ray steps",
    control: { label: "Tube radius", value: 0.13, min: 0.06, max: 0.24 },
    looks: [violet, frost],
    body: `let ray=normalize(vec3f(p,-1.8));var travel=0.0;var field=0.0;
    for(var stepIndex=0u;stepIndex<40u;stepIndex+=1u){let q=vec3f(0.0,0.0,2.8)+ray*travel;var dist=100.0;
      for(var k=0u;k<32u;k+=1u){let a=f32(k)*0.19634954;
        let curve=vec3f((0.44+0.18*cos(3.0*a))*cos(2.0*a),(0.44+0.18*cos(3.0*a))*sin(2.0*a),0.18*sin(3.0*a));
        dist=min(dist,distance(q,curve));}
      dist-=detail;if(dist<0.004){field=clamp(0.9-travel*0.13,0.0,1.0);break;}
      if(travel>5.0){break;}travel+=max(dist,0.01);}`,
  },
  {
    id: "dodecahedron-facets",
    name: "Dodecahedron Facets",
    family: "geometry",
    mechanism: "convex golden-ratio face-plane intersection with faceted shade",
    cost: "40 bounded distance steps",
    control: { label: "Face inset", value: 0.04, min: 0, max: 0.15 },
    looks: [slate, frost],
    body: `let ray=normalize(vec3f(p,-1.7));var travel=0.0;var field=0.0;
    for(var i=0u;i<40u;i+=1u){let q=vec3f(0.0,0.0,2.5)+ray*travel;
      let a=abs(q);let phi=1.618034;
      let planes=max(max(dot(a,normalize(vec3f(0.0,1.0,phi))),dot(a,normalize(vec3f(1.0,phi,0.0)))),dot(a,normalize(vec3f(phi,0.0,1.0))));
      let dist=planes-(0.72-detail);
      if(dist<0.003){field=clamp(0.23+0.77*max(dot(normalize(a+vec3f(0.01)),normalize(vec3f(0.4,0.7,0.8))),0.0),0.0,1.0);break;}
      if(travel>5.0){break;}travel+=max(dist,0.008);}`,
  },
  {
    id: "menger-cutaway",
    name: "Menger Cutaway",
    family: "geometry",
    mechanism:
      "three-level box subtraction with orthogonal recursive cross voids",
    cost: "48 ray steps × 3 fractal levels",
    control: { label: "Cut depth", value: 3, min: 1, max: 3 },
    looks: [basalt, coral],
    body: `let ray=normalize(vec3f(p,-1.7));var travel=0.0;var field=0.0;
    for(var i=0u;i<48u;i+=1u){let q=vec3f(0.0,0.0,2.5)+ray*travel;var dist=box3(q,vec3f(0.75));var size=1.0;
      for(var level=0u;level<3u;level+=1u){if(f32(level)>=detail){break;}
        let cell=abs(fract(q*size*0.5+0.5)*2.0-1.0);
        let cut=min(max(cell.x,cell.y),min(max(cell.y,cell.z),max(cell.z,cell.x)));
        dist=max(dist,(0.31-cut)/size);size*=3.0;}
      if(dist<0.003){field=clamp(0.3+0.7*(1.0-travel/5.0),0.0,1.0);break;}
      if(travel>5.0){break;}travel+=max(dist,0.008);}`,
  },
  {
    id: "twisted-prism",
    name: "Twisted Prism",
    family: "geometry",
    mechanism: "height-dependent rotation of a bounded hexagonal prism",
    cost: "44 bounded distance steps",
    control: { label: "Twist angle", value: 1.8, min: -3.1, max: 3.1 },
    looks: [ochre, violet],
    body: `let ray=normalize(vec3f(p,-1.7));var travel=0.0;var field=0.0;
    for(var i=0u;i<44u;i+=1u){let q=vec3f(0.0,0.0,2.5)+ray*travel;
      let v=rot(q.xz,q.y*detail);let a=abs(v);
      let hex=max(a.x*0.866025+a.y*0.5,a.y)-0.55;
      let dist=max(hex,abs(q.y)-0.77)*0.65;
      if(dist<0.003){field=clamp(0.25+0.75*max(dot(normalize(vec3f(v.x,0.35,v.y)),normalize(vec3f(-0.3,0.8,0.5))),0.0),0.0,1.0);break;}
      if(travel>5.0){break;}travel+=max(dist,0.008);}`,
  },
] as const;

function buildDefinition(spec: Draft): EffectDefinition {
  const [dark, light] = spec.looks[0];
  const animated = spec.animated === true;
  const darkSlot = animated ? 2 : 1;
  const lightSlot = animated ? 3 : 2;
  const contrastSlot = animated ? 4 : 3;
  const featureSlot = animated ? 5 : 4;
  return {
    id: `an-native-owned-c-${spec.id}`,
    name: spec.name,
    version: animated ? 1 : 2,
    kind: "generator",
    placements: ["fill"],
    properties: {
      scale: {
        type: "float",
        label: "Scale",
        default: 1,
        min: 0.25,
        max: 4,
        step: 0.01,
      },
      ...(animated
        ? {
            motion: {
              type: "float" as const,
              label: "Motion",
              default: 0.25,
              min: 0,
              max: 2,
              step: 0.01,
            },
          }
        : {}),
      dark: {
        type: "color",
        label: "Shadow color",
        default: structuredClone(dark),
      },
      light: {
        type: "color",
        label: "Highlight color",
        default: structuredClone(light),
      },
      contrast: {
        type: "float",
        label: "Contrast",
        default: 1,
        min: 0.2,
        max: 3,
        step: 0.01,
      },
      feature: {
        type: "float",
        label: spec.control.label,
        default: spec.control.value,
        min: spec.control.min,
        max: spec.control.max,
        step: 0.01,
      },
    },
    resources: [
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    output: "color",
    passes: [
      {
        id: "render",
        kind: "render",
        reads: [],
        output: "color",
        wgsl:
          NATIVE_RENDER_GLOBALS +
          math +
          `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
 let scale=max(globals.params[0].x,0.0001);
 ${animated ? "let motion=globals.params[1].x;\n " : ""}let p=(input.uv*2.0-vec2f(1.0))*vec2f(globals.viewport.x/max(globals.viewport.y,1.0),1.0)*scale;
 ${animated ? "let t=globals.clock.x*motion;\n " : ""}let detail=globals.params[${featureSlot}].x;
 ${spec.body}
 let tone=clamp((field-0.5)*globals.params[${contrastSlot}].x+0.5,0.0,1.0);
 let alpha=mix(globals.params[${darkSlot}].a,globals.params[${lightSlot}].a,tone);
 let color=mix(globals.params[${darkSlot}].rgb,globals.params[${lightSlot}].rgb,tone);
 return vec4f(color*alpha,alpha);
}`,
      },
    ],
    provenance: {
      origin: "design-original",
      note: `Original Design ${spec.family} field.`,
    },
  };
}
export const OWNED_GENERATORS_C: readonly EffectDefinition[] =
  OWNED_GENERATOR_C_DRAFTS.map(buildDefinition);
export const OWNED_GENERATOR_C_PRESETS: readonly EffectPreset[] =
  OWNED_GENERATOR_C_DRAFTS.flatMap((spec) =>
    spec.looks.map((pair, index) => ({
      id: `an-preset-owned-c-${spec.id}-${index === 0 ? "base" : "variant"}`,
      name: `${spec.name} ${index === 0 ? "Base" : "Variant"}`,
      definitionId: `an-native-owned-c-${spec.id}`,
      definitionVersion: spec.animated ? 1 : 2,
      placement: "fill" as const,
      clip: "bounds" as const,
      params: {
        dark: structuredClone(pair[0]),
        light: structuredClone(pair[1]),
        feature: spec.control.value,
        scale: index === 0 ? 1 : 1.35,
        ...(spec.animated ? { motion: index === 0 ? 0.25 : 0.45 } : {}),
        contrast: index === 0 ? 1 : 1.4,
      },
      provenance: { origin: "design-original" },
    })),
  );
