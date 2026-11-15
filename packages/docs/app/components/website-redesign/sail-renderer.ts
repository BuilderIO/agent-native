import { createSailPost } from "./sail-post";

const noise = `
uint turn(uint value) { return (value << 17u) | (value >> 15u); }
vec2 gradient(vec2 p) {
  uvec2 bits = floatBitsToUint(p);
  uint value = turn(3266489917u * bits.x + 374761401u) * 668265263u;
  value = turn(value + 3266489917u * bits.y) * 668265263u;
  value = (value ^ (value >> 15u)) * 2246822519u;
  value = (value ^ (value >> 13u)) * 3266489917u;
  value ^= value >> 16u;
  float a = (uintBitsToFloat((value >> 9u) | 1065353216u) - 1.) * 6.283185307;
  return vec2(cos(a), sin(a));
}
float noise(vec2 p) {
  vec2 cell = floor(p + (p.x + p.y) * .366025404);
  vec2 a = p - cell + (cell.x + cell.y) * .211324865;
  vec2 corner = a.x > a.y ? vec2(1., 0.) : vec2(0., 1.);
  vec2 b = a - corner + .211324865;
  vec2 c = a - 1. + .42264973;
  vec3 h = max(.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.);
  return dot(h*h*h, vec3(dot(a,gradient(cell)),dot(b,gradient(cell+corner)),dot(c,gradient(cell+1.)))) * 32.99;
}
vec3 rotate(vec3 p, vec3 axis, float angle) {
  axis = normalize(axis);
  return p*cos(angle) + cross(axis,p)*sin(angle) + axis*dot(axis,p)*(1.-cos(angle));
}`;

const vertex = `#version 300 es
precision highp float;
in vec3 position;
in vec2 uv;
uniform vec2 resolution;
uniform float time, angle;
uniform vec3 meshScale, meshPosition, meshRotation;
out vec2 vUv;
${noise}
void main() {
  vUv = uv;
  vec3 p = position;
  p.y += -7.821 * noise(vec2(p.x*.005831+time, p.z*.016001+time));
  p = rotate(p, vec3(.5,0.,.5), .41*exp2(-exp2(.7)*pow(uv.x,.7)));
  p = rotate(p, vec3(0.,.5,.5), -.65*exp2(-exp2(3.63)*pow(uv.y,3.63)));
  p = rotate(p, vec3(.5,0.,.5), -.58*exp2(-exp2(3.95)*pow(uv.y,3.95)));
  p *= meshScale;
  p = rotate(p, vec3(0.,0.,1.), meshRotation.z+angle);
  p = rotate(p, vec3(0.,1.,0.), meshRotation.y);
  p = rotate(p, vec3(1.,0.,0.), meshRotation.x);
  p += meshPosition;
  float cameraX = .99980006*p.x - .019996*p.z;
  float cameraZ = .019996*p.x + .99980006*p.z - 5001.;
  gl_Position = vec4(cameraX*2./resolution.x, p.y*2./resolution.y, -.00020002*cameraZ - 1.0002, 1.);
}`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 resolution;
uniform vec3 color0,color1,color2,color3,color4;
uniform float opacity,grain;
in vec2 vUv;
out vec4 fragmentColor;
${noise}
vec3 palette(float t) {
  t = clamp(t,0.,1.)*4.;
  if(t<1.) return mix(color0,color1,t);
  if(t<2.) return mix(color1,color2,t-1.);
  if(t<3.) return mix(color2,color3,t-2.);
  return mix(color3,color4,t-3.);
}
void main() {
 float glow = clamp(dFdy(vUv).y*resolution.y*1.98*.5+.5,0.,1.);
 glow = smoothstep(0.,.834,pow(glow,.806));
 float low = noise(vec2(vUv.x*.1,vUv.y*.5));
 float fiber = noise(vec2(vUv.x*(600.+300.*low),vUv.y*4.*low))*.5+.5;
 float edge = 1.-pow(4.*vUv.x*(1.-vUv.x),3.);
 float field = .05 + .9*(1.-vUv.y) + .9*vUv.x + .75*exp(-pow((vUv.x-.25)*10.,2.));
 vec3 c = palette(field);
 c += fiber*.2*(1.-c.b*.9)*glow*edge*grain;
 c += (1.-glow)*.25;
 fragmentColor = vec4(clamp(c,0.,1.)*opacity,opacity);
}`;

const defaultColors = ["#00dff6", "#01c8f1", "#4285f4", "#a8c1ff", "#6079ee"];

export function createSailTweaks(labels: {
  speed: string;
  color: (index: number) => string;
  opacity: string;
  grain: string;
  angle: string;
}) {
  return [
    {
      id: "speed",
      label: labels.speed,
      type: "slider",
      defaultValue: 1,
      min: 0,
      max: 2,
      step: 0.05,
      cssVar: "--sail-speed",
    },
    ...defaultColors.map((color, i) => ({
      id: `color${i}`,
      label: labels.color(i + 1),
      type: "color-swatch",
      defaultValue: color,
      cssVar: `--sail-color${i}`,
    })),
    {
      id: "opacity",
      label: labels.opacity,
      type: "slider",
      defaultValue: 1,
      min: 0,
      max: 1,
      step: 0.01,
      cssVar: "--sail-opacity",
    },
    {
      id: "grain",
      label: labels.grain,
      type: "slider",
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      cssVar: "--sail-grain",
    },
    {
      id: "angle",
      label: labels.angle,
      type: "slider",
      defaultValue: 0,
      min: -0.4,
      max: 0.4,
      step: 0.01,
      cssVar: "--sail-angle",
    },
  ];
}

export function startSail(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
  if (!gl) return;
  const shaders: WebGLShader[] = [];
  const buffers: WebGLBuffer[] = [];
  const program = gl.createProgram();
  let post: ReturnType<typeof createSailPost> | undefined;
  const release = () => {
    post?.dispose();
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteProgram(program);
  };
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Could not allocate hero shader");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`Hero shader: ${gl.getShaderInfoLog(shader)}`);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Hero program: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);
    const positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    const nx = 128,
      ny = 256;
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++) {
        let across = (x / nx) * 400 - 200;
        const along = 200 - (y / ny) * 400;
        const bend = 4 - 2 * Math.pow((4 * (1 - y / ny) * y) / ny, 9.5);
        let height = bend;
        if (across >= -16 && across < 16) {
          height = Math.cos(((across + 16) * Math.PI) / 32) * bend;
          across =
            Math.cos(-Math.PI / 2 + ((across + 16) * Math.PI) / 32) * bend - 16;
        } else if (across >= 16) {
          height = -bend;
          across = -across;
        }
        positions.push(along, height, across + 100);
        uvs.push(x / nx, 1 - y / ny);
      }
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const a = x + (nx + 1) * y,
          b = a + nx + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    for (const [name, size, data] of [
      ["position", 3, positions],
      ["uv", 2, uvs],
    ] as const) {
      const buffer = gl.createBuffer();

      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 0, 0);
    }
    const index = gl.createBuffer();

    buffers.push(index);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(indices),
      gl.STATIC_DRAW,
    );
    const finishing = createSailPost(gl);
    post = finishing;
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      elapsed = 0,
      previous = performance.now();
    const draw = () => {
      const now = performance.now();
      const style = getComputedStyle(canvas);
      const number = (name: string, fallback: number) => {
        const value = style.getPropertyValue(`--sail-${name}`).trim();
        if (!value) return fallback;
        const result = Number(value);
        if (!Number.isFinite(result))
          throw new Error(`Invalid hero parameter ${name}`);
        return result;
      };
      if (!reduced.matches) elapsed += (now - previous) * number("speed", 1);
      previous = now;
      const width = canvas.clientWidth,
        height = canvas.clientHeight;
      const ratio = Math.min(devicePixelRatio, 1.5);
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      const mobile = window.innerWidth < 640;
      const medium = !mobile && window.innerWidth < 1264;
      gl.uniform2f(uniform("resolution"), width, height);
      gl.uniform1f(uniform("time"), number("time", 35000 + elapsed) * 0.00004);
      gl.uniform1f(uniform("angle"), number("angle", 0));
      gl.uniform3f(uniform("meshScale"), 9, 8, 5);
      gl.uniform3f(
        uniform("meshPosition"),
        mobile ? 320 : medium ? 525 : 380,
        mobile ? -315 : -301.7,
        -11.1,
      );
      gl.uniform3f(
        uniform("meshRotation"),
        mobile ? -0.5 : medium ? -0.64 : -0.4495926536,
        -0.1175926536,
        mobile ? 1.64 : medium ? 1.68 : 1.8744073464,
      );
      for (let i = 0; i < 5; i++) {
        const fallback = defaultColors[i];
        const value =
          style.getPropertyValue(`--sail-color${i}`).trim() || String(fallback);
        if (!/^#[0-9a-f]{6}$/i.test(value))
          throw new Error(`Invalid hero color ${i}`);
        gl.uniform3f(
          uniform(`color${i}`),
          parseInt(value.slice(1, 3), 16) / 255,
          parseInt(value.slice(3, 5), 16) / 255,
          parseInt(value.slice(5, 7), 16) / 255,
        );
      }
      gl.uniform1f(uniform("opacity"), number("opacity", 1));
      gl.uniform1f(uniform("grain"), number("grain", 1));
      finishing.begin(canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      finishing.finish(number("grain", 1));
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      previous = performance.now();
      draw();
    };
    document.addEventListener("visibilitychange", resume);
    draw();
    return () => {
      release();
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
    };
  } catch (error) {
    release();
    throw error;
  }
}
