import { useRef, useEffect } from "react";

const vertexShader = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Adapted from "The Universe Within" by BigWings (Martijn Steinrucken)
// https://www.shadertoy.com/view/lscczl
// License: CC BY-NC-SA 3.0
const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float uDark;

#define S(a, b, t) smoothstep(a, b, t)
#define NUM_LAYERS 4.

float N21(vec2 p) {
  vec3 a = fract(vec3(p.xyx) * vec3(213.897, 653.453, 253.098));
  a += dot(a, a.yzx + 79.76);
  return fract((a.x + a.y) * a.z);
}

vec2 GetPos(vec2 id, vec2 offs, float t) {
  float n = N21(id + offs);
  float n1 = fract(n * 10.);
  float n2 = fract(n * 100.);
  float a = t + n;
  return offs + vec2(sin(a * n1), cos(a * n2)) * .4;
}

float df_line(in vec2 a, in vec2 b, in vec2 p) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * h);
}

float line(vec2 a, vec2 b, vec2 uv) {
  float r1 = .025;
  float r2 = .006;
  float d = df_line(a, b, uv);
  float d2 = length(a - b);
  float fade = S(1.5, .5, d2);
  fade += S(.05, .02, abs(d2 - .75));
  return S(r1, r2, d) * fade;
}

// Unrolled for WebGL1 compatibility (no dynamic array indexing)
float NetLayer(vec2 st, float n, float t) {
  vec2 id = floor(st) + n;
  st = fract(st) - .5;

  vec2 p0 = GetPos(id, vec2(-1,-1), t);
  vec2 p1 = GetPos(id, vec2( 0,-1), t);
  vec2 p2 = GetPos(id, vec2( 1,-1), t);
  vec2 p3 = GetPos(id, vec2(-1, 0), t);
  vec2 p4 = GetPos(id, vec2( 0, 0), t);
  vec2 p5 = GetPos(id, vec2( 1, 0), t);
  vec2 p6 = GetPos(id, vec2(-1, 1), t);
  vec2 p7 = GetPos(id, vec2( 0, 1), t);
  vec2 p8 = GetPos(id, vec2( 1, 1), t);

  float m = 0.;
  float sparkle = 0.;
  float d; float s; float pulse;

  m += line(p4, p0, st);
  d = length(st-p0); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p0.x)+fract(p0.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p1, st);
  d = length(st-p1); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p1.x)+fract(p1.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p2, st);
  d = length(st-p2); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p2.x)+fract(p2.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p3, st);
  d = length(st-p3); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p3.x)+fract(p3.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p4, st);
  d = length(st-p4); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p4.x)+fract(p4.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p5, st);
  d = length(st-p5); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p5.x)+fract(p5.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p6, st);
  d = length(st-p6); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p6.x)+fract(p6.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p7, st);
  d = length(st-p7); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p7.x)+fract(p7.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p8, st);
  d = length(st-p8); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p8.x)+fract(p8.y)+t)*5.)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p1, p3, st);
  m += line(p1, p5, st);
  m += line(p7, p5, st);
  m += line(p7, p3, st);

  float sPhase = (sin(t + n) + sin(t * .1)) * .25 + .5;
  sPhase += pow(sin(t * .1) * .5 + .5, 50.) * 5.;
  m += sparkle * sPhase;

  return m;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - iResolution.xy * .5) / iResolution.y;

  float t = iTime * .03;

  float s = sin(t);
  float c = cos(t);
  mat2 rot = mat2(c, -s, s, c);
  vec2 st = uv * rot;

  float m = 0.;
  for (float i = 0.; i < 1.; i += 1. / NUM_LAYERS) {
    float z = fract(t + i);
    float size = mix(15., 1., z);
    float fade = S(0., .6, z) * S(1., .8, z);
    m += fade * NetLayer(st * size, i, iTime * 0.3);
  }

  // Gray instead of rainbow
  vec3 baseCol = vec3(0.35) * uDark + vec3(0.12) * (1.0 - uDark);
  vec3 col = baseCol * m;

  // Vignette from original
  col *= 1. - dot(uv, uv);

  // Fade in then cap at the subtle sparkle state
  float tt = min(iTime, 5.0);
  col *= S(0., 20., tt);

  // Background
  vec3 bg = mix(vec3(1.0), vec3(0.0), uDark);

  if (uDark < 0.5) {
    col = bg - col * 1.2;
  } else {
    col = bg + col;
  }

  col = clamp(col, 0., 1.);
  fragColor = vec4(col, 1.);
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

interface SeascapeProps {
  className?: string;
}

export default function Seascape({ className = "" }: SeascapeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    function compileShader(src: string, type: number) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.error(gl!.getShaderInfoLog(s));
      }
      return s;
    }

    const vs = compileShader(vertexShader, gl.VERTEX_SHADER);
    const fs = compileShader(fragmentShader, gl.FRAGMENT_SHADER);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const pos = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "iTime");
    const uRes = gl.getUniformLocation(program, "iResolution");
    const uDark = gl.getUniformLocation(program, "uDark");

    function resize() {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = w + "px";
      canvas!.style.height = h + "px";
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
    }

    resize();
    window.addEventListener("resize", resize);

    function isDarkMode() {
      return (
        document.documentElement.classList.contains("dark") ||
        document.documentElement.getAttribute("data-theme") === "dark"
      );
    }

    const startTime = performance.now();

    function render() {
      const t = (performance.now() - startTime) * 0.001;
      gl!.uniform1f(uTime, t);
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform1f(uDark, isDarkMode() ? 1.0 : 0.0);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
      rafRef.current = requestAnimationFrame(render);
    }
    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
