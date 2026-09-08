import * as React from "react";

import { cn } from "../utils.js";

const VERTEX_SHADER_SOURCE =
  "attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}";

const FRAGMENT_SHADER_SOURCE = [
  "precision highp float;",
  "uniform float iTime;uniform vec2 iResolution;uniform vec3 uPointer;",
  "#define S(a,b,t) smoothstep(a,b,t)",
  "#define NUM_LAYERS 4.",
  "float N21(vec2 p){vec3 a=fract(vec3(p.xyx)*vec3(213.897,653.453,253.098));a+=dot(a,a.yzx+79.76);return fract((a.x+a.y)*a.z);}",
  "vec2 GetPos(vec2 id,vec2 offs,float t){float n=N21(id+offs);float n1=fract(n*10.);float n2=fract(n*100.);float a=t+n;return offs+vec2(sin(a*n1),cos(a*n2))*.4;}",
  "vec2 Attract(vec2 p,vec2 cursor,float strength){vec2 delta=cursor-p;float d=length(delta);float pull=1.-smoothstep(.08,1.9,d);pull=pull*pull*(3.-2.*pull);return p+delta*pull*.095*strength;}",
  "float df_line(vec2 a,vec2 b,vec2 p){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}",
  "float line(vec2 a,vec2 b,vec2 uv){float r1=.025;float r2=.006;float d=df_line(a,b,uv);float d2=length(a-b);float fade=S(1.5,.5,d2);fade+=S(.05,.02,abs(d2-.75));return S(r1,r2,d)*fade;}",
  "float NetLayer(vec2 st,float n,float t,vec2 pointer,float pointerStrength){",
  "  vec2 cell=floor(st);vec2 id=cell+n;vec2 cursor=pointer-cell;st=fract(st)-.5;",
  "  vec2 p0=Attract(GetPos(id,vec2(-1,-1),t),cursor,pointerStrength);vec2 p1=Attract(GetPos(id,vec2(0,-1),t),cursor,pointerStrength);vec2 p2=Attract(GetPos(id,vec2(1,-1),t),cursor,pointerStrength);",
  "  vec2 p3=Attract(GetPos(id,vec2(-1,0),t),cursor,pointerStrength);vec2 p4=Attract(GetPos(id,vec2(0,0),t),cursor,pointerStrength);vec2 p5=Attract(GetPos(id,vec2(1,0),t),cursor,pointerStrength);",
  "  vec2 p6=Attract(GetPos(id,vec2(-1,1),t),cursor,pointerStrength);vec2 p7=Attract(GetPos(id,vec2(0,1),t),cursor,pointerStrength);vec2 p8=Attract(GetPos(id,vec2(1,1),t),cursor,pointerStrength);",
  "  float m=0.;float sparkle=0.;float d;float s;float pulse;",
  "  m+=line(p4,p0,st);d=length(st-p0);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p0.x)+fract(p0.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p1,st);d=length(st-p1);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p1.x)+fract(p1.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p2,st);d=length(st-p2);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p2.x)+fract(p2.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p3,st);d=length(st-p3);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p3.x)+fract(p3.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p4,st);d=length(st-p4);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p4.x)+fract(p4.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p5,st);d=length(st-p5);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p5.x)+fract(p5.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p6,st);d=length(st-p6);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p6.x)+fract(p6.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p7,st);d=length(st-p7);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p7.x)+fract(p7.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p4,p8,st);d=length(st-p8);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p8.x)+fract(p8.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;",
  "  m+=line(p1,p3,st);m+=line(p1,p5,st);m+=line(p7,p5,st);m+=line(p7,p3,st);",
  "  float sPhase=(sin(t+n)+sin(t*.1))*.25+.5;sPhase+=pow(sin(t*.1)*.5+.5,50.)*5.;m+=sparkle*sPhase;",
  "  return m;",
  "}",
  "void mainImage(out vec4 fragColor,in vec2 fragCoord){",
  "  vec2 uv=(fragCoord-iResolution.xy*.5)/iResolution.y;",
  "  float t=iTime*.03;float s=sin(t);float c=cos(t);mat2 rot=mat2(c,-s,s,c);vec2 st=uv*rot;vec2 pointerUv=(uPointer.xy-iResolution.xy*.5)/iResolution.y;",
  "  float m=0.;",
  "  for(float i=0.;i<1.;i+=1./NUM_LAYERS){float z=fract(t+i);float size=mix(15.,1.,z);float fade=S(0.,.6,z)*S(1.,.8,z);vec2 pointerSt=pointerUv*rot*size;vec2 layerSt=st*size;float warp=1.-smoothstep(.15,2.7,length(layerSt-pointerSt));warp=warp*warp*(3.-2.*warp)*uPointer.z;layerSt-=(pointerSt-layerSt)*warp*.035;m+=fade*NetLayer(layerSt,i,iTime*0.3,pointerSt,uPointer.z);}",
  "  float cursorLift=1.-smoothstep(.04,.48,length(uv-pointerUv));cursorLift=cursorLift*cursorLift*(3.-2.*cursorLift)*uPointer.z;m*=1.+cursorLift*1.6;",
  "  vec3 col=vec3(0.35)*m;col*=1.-dot(uv,uv);",
  "  float tt=min(iTime,5.0);col*=S(0.,20.,tt);",
  "  col=clamp(col,0.,1.);fragColor=vec4(col,1.);",
  "}",
  "void main(){mainImage(gl_FragColor,gl_FragCoord.xy);}",
].join("\n");

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function initializeStarfield(canvas: HTMLCanvasElement): () => void {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false });
  } catch {
    return () => undefined;
  }
  if (!gl) return () => undefined;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  if (!vertexShader) return () => undefined;

  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
  );
  if (!fragmentShader) {
    gl.deleteShader(vertexShader);
    return () => undefined;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }

  const buffer = gl.createBuffer();
  const position = gl.getAttribLocation(program, "position");
  if (!buffer || position < 0) {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const timeUniform = gl.getUniformLocation(program, "iTime");
  const resolutionUniform = gl.getUniformLocation(program, "iResolution");
  const pointerUniform = gl.getUniformLocation(program, "uPointer");
  const reducedMotionQuery = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  );
  const listenerOptions: AddEventListenerOptions = { passive: true };
  let reducedMotion = reducedMotionQuery?.matches ?? false;
  let pointerDpr = 1;
  let hasPointer = false;
  let pointerX = 0;
  let pointerY = 0;
  let pointerStrength = 0;
  let targetX = 0;
  let targetY = 0;
  let targetStrength = 0;
  let animationFrame = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    pointerDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(width * pointerDpr);
    canvas.height = Math.floor(height * pointerDpr);
    gl?.viewport(0, 0, canvas.width, canvas.height);
    if (!hasPointer) {
      pointerX = targetX = canvas.width * 0.5;
      pointerY = targetY = canvas.height * 0.5;
    }
  };

  const onPointerMove = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    const rect = canvas.getBoundingClientRect();
    const x = mouseEvent.clientX - rect.left;
    const y = mouseEvent.clientY - rect.top;
    hasPointer = true;
    targetX = x * pointerDpr;
    targetY = (rect.height - y) * pointerDpr;
    targetStrength =
      x >= 0 && x <= rect.width && y >= 0 && y <= rect.height ? 1 : 0;
  };
  const fadePointer = () => {
    targetStrength = 0;
  };
  const easePointer = (allowPointer: boolean) => {
    if (!allowPointer) {
      pointerStrength = 0;
      return;
    }
    pointerX += (targetX - pointerX) * 0.22;
    pointerY += (targetY - pointerY) * 0.22;
    pointerStrength += (targetStrength - pointerStrength) * 0.14;
    if (pointerStrength < 0.001 && targetStrength === 0) pointerStrength = 0;
  };
  const draw = (timeSeconds: number, allowPointer: boolean) => {
    easePointer(allowPointer && !reducedMotion);
    gl?.uniform1f(timeUniform, timeSeconds);
    gl?.uniform2f(resolutionUniform, canvas.width, canvas.height);
    gl?.uniform3f(pointerUniform, pointerX, pointerY, pointerStrength);
    gl?.drawArrays(gl.TRIANGLES, 0, 6);
  };

  let start = performance.now();
  let last = 0;
  const render = (now: number) => {
    if (reducedMotion) {
      animationFrame = 0;
      return;
    }
    animationFrame = requestAnimationFrame(render);
    if (now - last < 33) return;
    last = now;
    draw((now - start) * 0.001, true);
  };
  const startAnimation = () => {
    if (!animationFrame) animationFrame = requestAnimationFrame(render);
  };
  const stopAnimation = () => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  };
  const onReducedMotionChange = () => {
    reducedMotion = reducedMotionQuery?.matches ?? false;
    if (reducedMotion) {
      stopAnimation();
      last = 0;
      draw(20, false);
    } else {
      start = performance.now();
      startAnimation();
    }
  };

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, listenerOptions);
  window.addEventListener("mousemove", onPointerMove, listenerOptions);
  document.addEventListener("pointerleave", fadePointer, listenerOptions);
  window.addEventListener("blur", fadePointer);
  draw(reducedMotion ? 20 : 0, !reducedMotion);
  if (reducedMotionQuery) {
    if (reducedMotionQuery.addEventListener) {
      reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    } else {
      reducedMotionQuery.addListener(onReducedMotionChange);
    }
  }
  if (!reducedMotion) startAnimation();

  return () => {
    stopAnimation();
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onPointerMove, listenerOptions);
    window.removeEventListener("mousemove", onPointerMove, listenerOptions);
    document.removeEventListener("pointerleave", fadePointer, listenerOptions);
    window.removeEventListener("blur", fadePointer);
    if (reducedMotionQuery) {
      if (reducedMotionQuery.removeEventListener) {
        reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
      } else {
        reducedMotionQuery.removeListener(onReducedMotionChange);
      }
    }
    gl?.deleteBuffer(buffer);
    gl?.deleteProgram(program);
    gl?.deleteShader(vertexShader);
    gl?.deleteShader(fragmentShader);
  };
}

export interface StarfieldProps extends Omit<
  React.ComponentPropsWithoutRef<"canvas">,
  "children"
> {
  /** Keep the default id for compatibility with existing starfield styles. */
  id?: string;
}

export function Starfield({
  className,
  id = "starfield",
  ...props
}: StarfieldProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return initializeStarfield(canvas);
  }, []);

  return (
    <canvas
      {...props}
      ref={canvasRef}
      id={id}
      aria-hidden="true"
      className={cn(
        "pointer-events-none block h-full w-full opacity-[0.35] motion-reduce:opacity-[0.18]",
        className,
      )}
      data-agent-native-starfield
    />
  );
}
