import { buildRibbonSheet } from "./geometry";
import {
  RIBBON_CAMERA,
  RIBBON_MOTION,
  RIBBON_SURFACE,
  type RibbonPlacement,
} from "./presets";
import {
  finishFragmentShader,
  finishVertexShader,
  sheetFragmentShader,
  sheetVertexShader,
} from "./shaders";

export interface RibbonDrawParams {
  /** Noise phase: clock milliseconds times the phase rate. */
  phase: number;
  placement: RibbonPlacement;
  displaceAmount: number;
  /** Multiplier on every twist angle. */
  twist: number;
  glowAmount: number;
  blurAngle: number;
  grain: number;
}

type Mat4 = Float32Array;

export class RibbonWaveRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly sheetProgram: WebGLProgram;
  private readonly finishProgram: WebGLProgram;
  private readonly sheetVao: WebGLVertexArrayObject;
  private readonly finishVao: WebGLVertexArrayObject;
  private readonly indexCount: number;
  private readonly sceneTexture: WebGLTexture;
  private readonly depthBuffer: WebGLRenderbuffer;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly sheetUniforms: Record<string, WebGLUniformLocation | null>;
  private readonly finishUniforms: Record<string, WebGLUniformLocation | null>;
  private paletteTexture: WebGLTexture | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private lost = false;

  /** Returns null when WebGL2 is unavailable or would be slow. */
  static create(canvas: HTMLCanvasElement): RibbonWaveRenderer | null {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: true,
    });
    return gl ? new RibbonWaveRenderer(canvas, gl) : null;
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", this.handleContextLost);

    this.sheetProgram = linkProgram(gl, sheetVertexShader, sheetFragmentShader);
    this.finishProgram = linkProgram(
      gl,
      finishVertexShader,
      finishFragmentShader,
    );
    this.sheetUniforms = uniformLocations(gl, this.sheetProgram, [
      "u_model",
      "u_viewProjection",
      "u_phase",
      "u_displaceFrequency",
      "u_displaceAmount",
      "u_twistAngle",
      "u_twistFalloff",
      "u_palette",
      "u_drawingHeight",
      "u_glow",
      "u_fibres",
      "u_grade",
      "u_faceLift",
    ]);
    this.finishUniforms = uniformLocations(gl, this.finishProgram, [
      "u_scene",
      "u_blurAngle",
      "u_grain",
    ]);

    const sheet = buildRibbonSheet();
    this.indexCount = sheet.indices.length;
    this.sheetVao = required(gl.createVertexArray(), "vertex array");
    gl.bindVertexArray(this.sheetVao);
    bindAttribute(gl, this.sheetProgram, "a_position", sheet.positions, 3);
    bindAttribute(gl, this.sheetProgram, "a_uv", sheet.uvs, 2);
    const indexBuffer = required(gl.createBuffer(), "index buffer");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sheet.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.finishVao = required(gl.createVertexArray(), "vertex array");

    this.sceneTexture = required(gl.createTexture(), "scene texture");
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.depthBuffer = required(gl.createRenderbuffer(), "depth buffer");
    this.framebuffer = required(gl.createFramebuffer(), "framebuffer");
  }

  get isLost(): boolean {
    return this.lost;
  }

  setPalette(source: TexImageSource): void {
    const gl = this.gl;
    const texture = this.paletteTexture ?? gl.createTexture();
    this.paletteTexture = required(texture, "palette texture");
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    // Image row 0 is the top of the palette, which the sheet reads as v = 1.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    const gl = this.gl;
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    gl.canvas.width = width;
    gl.canvas.height = height;

    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT24,
      width,
      height,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.sceneTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.depthBuffer,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw(params: RibbonDrawParams): void {
    const gl = this.gl;
    if (this.lost || !this.paletteTexture || this.cssWidth === 0) return;
    const width = gl.canvas.width;
    const height = gl.canvas.height;
    const { placement } = params;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.useProgram(this.sheetProgram);
    const u = this.sheetUniforms;
    gl.uniformMatrix4fv(u.u_model, false, modelMatrix(placement));
    gl.uniformMatrix4fv(
      u.u_viewProjection,
      false,
      viewProjection(this.cssWidth, this.cssHeight),
    );
    gl.uniform1f(u.u_phase, params.phase);
    gl.uniform2f(
      u.u_displaceFrequency,
      RIBBON_MOTION.displaceFrequency[0],
      RIBBON_MOTION.displaceFrequency[1],
    );
    gl.uniform1f(u.u_displaceAmount, params.displaceAmount);
    const { twistAngle, twistFalloff } = RIBBON_MOTION;
    gl.uniform3f(
      u.u_twistAngle,
      twistAngle.along * params.twist,
      twistAngle.across * params.twist,
      twistAngle.lengthwise * params.twist,
    );
    gl.uniform3f(
      u.u_twistFalloff,
      twistFalloff.along,
      twistFalloff.across,
      twistFalloff.lengthwise,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(u.u_palette, 0);
    gl.uniform1f(u.u_drawingHeight, height);
    gl.uniform3f(
      u.u_glow,
      params.glowAmount,
      RIBBON_SURFACE.glowPower,
      RIBBON_SURFACE.glowRamp,
    );
    gl.uniform4f(
      u.u_fibres,
      RIBBON_SURFACE.fibreStrength,
      RIBBON_SURFACE.fibreFrequency,
      RIBBON_SURFACE.fibreBlueDamping,
      RIBBON_SURFACE.fibreEdgePower,
    );
    gl.uniform3f(
      u.u_grade,
      RIBBON_SURFACE.contrast,
      RIBBON_SURFACE.saturation,
      RIBBON_SURFACE.hueTurn,
    );
    gl.uniform1f(u.u_faceLift, RIBBON_SURFACE.faceLift);
    gl.bindVertexArray(this.sheetVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.finishProgram);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.uniform1i(this.finishUniforms.u_scene, 0);
    gl.uniform1f(this.finishUniforms.u_blurAngle, params.blurAngle);
    gl.uniform1f(this.finishUniforms.u_grain, params.grain);
    gl.bindVertexArray(this.finishVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.canvas.removeEventListener?.("webglcontextlost", this.handleContextLost);
    gl.deleteProgram(this.sheetProgram);
    gl.deleteProgram(this.finishProgram);
    gl.deleteVertexArray(this.sheetVao);
    gl.deleteVertexArray(this.finishVao);
    gl.deleteTexture(this.sceneTexture);
    gl.deleteTexture(this.paletteTexture);
    gl.deleteRenderbuffer(this.depthBuffer);
    gl.deleteFramebuffer(this.framebuffer);
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
  };
}

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`Could not create the ribbon ${what}`);
  return value;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = required(gl.createShader(type), "shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Ribbon shader failed to compile: ${log}`);
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = required(gl.createProgram(), "program");
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(
      `Ribbon program failed to link: ${gl.getProgramInfoLog(program)}`,
    );
  }
  return program;
}

function uniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): Record<string, WebGLUniformLocation | null> {
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  );
}

function bindAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  data: Float32Array,
  size: number,
): void {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Ribbon attribute ${name} is unused`);
  const buffer = required(gl.createBuffer(), "vertex buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

// Column-major 4x4 helpers.

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function rotationX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotationY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotationZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function modelMatrix({ position, rotation, scale }: RibbonPlacement): Mat4 {
  const stretch = new Float32Array(16);
  stretch[0] = scale[0];
  stretch[5] = scale[1];
  stretch[10] = scale[2];
  stretch[15] = 1;
  const turn = multiply(
    multiply(rotationX(rotation[0]), rotationY(rotation[1])),
    rotationZ(rotation[2]),
  );
  const out = multiply(turn, stretch);
  out.set([position[0], position[1], position[2], 1], 12);
  return out;
}

function viewProjection(width: number, height: number): Mat4 {
  const [ex, ey, ez] = RIBBON_CAMERA.eye;
  const length = Math.hypot(ex, ey, ez);
  const back = [ex / length, ey / length, ez / length];
  // right = normalize(up x back) with up = +Y.
  const rightLength = Math.hypot(back[2], back[0]);
  const right = [back[2] / rightLength, 0, -back[0] / rightLength];
  const up = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  const dot = (v: number[]) => v[0] * ex + v[1] * ey + v[2] * ez;
  const view = new Float32Array([
    right[0],
    up[0],
    back[0],
    0,
    right[1],
    up[1],
    back[1],
    0,
    right[2],
    up[2],
    back[2],
    0,
    -dot(right),
    -dot(up),
    -dot(back),
    1,
  ]);

  const { near, far } = RIBBON_CAMERA;
  const projection = new Float32Array([
    2 / width,
    0,
    0,
    0,
    0,
    2 / height,
    0,
    0,
    0,
    0,
    -2 / (far - near),
    0,
    0,
    0,
    -(far + near) / (far - near),
    1,
  ]);
  return multiply(projection, view);
}
