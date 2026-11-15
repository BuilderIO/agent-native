import { useEffect, useRef } from "react";

const vertexSource = `attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const fragmentSource = `precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform vec3 cyan;
uniform vec3 violet;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = (uv - .5) * vec2(resolution.x / resolution.y, 1.0);
  p.y += sin(p.x * 2.4 + time * .2) * .10
       + sin(p.x * 5.0 - time * .13) * .035;
  vec3 light = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float layer = float(i);
    float center = -.22 + layer * .055
      + sin(p.x * 2.5 + time * .2 + layer * .6) * .09;
    float distance = abs(p.y - center);
    float ribbon = exp(-distance * 90.0) * .48
      + exp(-distance * 14.0) * .075;
    vec3 color = mix(cyan, violet, .5 + .5 * sin(p.x * 1.4 + layer * .8));
    light += color * ribbon;
  }
  float edge = smoothstep(.0, .2, uv.x) * smoothstep(.0, .2, 1.0 - uv.x);
  float fade = smoothstep(.0, .12, uv.y) * (1.0 - smoothstep(.55, .85, uv.y));
  float opacity = max(light.r, max(light.g, light.b));
  gl_FragColor = vec4(light, opacity) * edge * fade * .8;
}`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not allocate hero shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Could not compile hero shader: ${detail}`);
  }
  return shader;
}

function tokenColor(style: CSSStyleDeclaration, name: string) {
  const hex = style.getPropertyValue(name).trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Hero color token ${name} must be a six-digit hex color`);
  }
  return [0, 2, 4].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
}

export function HeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return;
    let frame = 0;
    let disposed = false;
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: ResizeObserver | undefined;

    try {
      shaders.push(compileShader(gl, gl.VERTEX_SHADER, vertexSource));
      shaders.push(compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(
          `Could not link hero shader: ${gl.getProgramInfoLog(program)}`,
        );
      }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const resolution = gl.getUniformLocation(program, "resolution");
      const time = gl.getUniformLocation(program, "time");
      const style = getComputedStyle(canvas);
      const cyan = tokenColor(style, "--c-blue-500");
      const violet = tokenColor(style, "--c-violet-400");
      gl.uniform3fv(gl.getUniformLocation(program, "cyan"), cyan);
      gl.uniform3fv(gl.getUniformLocation(program, "violet"), violet);
      const start = performance.now();
      const draw = () => {
        if (disposed) return;
        gl.uniform1f(
          time,
          reduced.matches ? 3 : (performance.now() - start) / 1000 + 3,
        );
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!reduced.matches && !document.hidden)
          frame = requestAnimationFrame(draw);
      };
      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio, 1.5);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        cancelAnimationFrame(frame);
        draw();
      };
      const resume = () => {
        cancelAnimationFrame(frame);
        draw();
      };
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
      document.addEventListener("visibilitychange", resume);
      reduced.addEventListener("change", resume);
      resize();
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        observer?.disconnect();
        document.removeEventListener("visibilitychange", resume);
        reduced.removeEventListener("change", resume);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        for (const shader of shaders) gl.deleteShader(shader);
      };
    } catch (error) {
      console.error("Could not start hero ribbon background", error);
      observer?.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[-1] h-full w-full"
    />
  );
}
