const vertexSource = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = corner;
  gl_Position = vec4(corner * 2. - 1., 0., 1.);
}`;

const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform float grain;
in vec2 uv;
out vec4 color;
void main() {
  vec2 offset = uv - .5;
  float angle = .02 / 6.;
  mat2 rotation = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  vec4 blurred = vec4(0.);
  for (int i = 0; i < 6; i++) {
    blurred += texture(image, offset + .5);
    offset = rotation * offset;
  }
  float detail = smoothstep(0., .7, uv.y) - smoothstep(.2, 1., uv.y);
  color = mix(blurred / 6., texture(image, uv), detail);
  float random = fract(sin(dot(gl_FragCoord.xy * .01, vec2(12.9898, 78.233))) * 43758.5453);
  color.rgb = clamp(color.rgb + (1. - 2. * random) * (4. / 255.) * 1.1 * grain * color.a, 0., 1.);
}`;

export function createSailPost(gl: WebGL2RenderingContext) {
  const framebuffer = gl.createFramebuffer();
  const texture = gl.createTexture();
  const depth = gl.createRenderbuffer();
  const program = gl.createProgram();
  const vao = gl.createVertexArray();
  const shaders: WebGLShader[] = [];
  let width = 0;
  let height = 0;
  let previousProgram: WebGLProgram | null = null;
  let previousVao: WebGLVertexArrayObject | null = null;
  const dispose = () => {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    gl.deleteRenderbuffer(depth);
    gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    for (const shader of shaders) gl.deleteShader(shader);
  };
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Could not allocate hero finishing shader");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(
          `Hero finishing shader: ${gl.getShaderInfoLog(shader)}`,
        );
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Hero finishing program: ${gl.getProgramInfoLog(program)}`,
      );
    }
  } catch (error) {
    dispose();
    throw error;
  }
  const grainLocation = gl.getUniformLocation(program, "grain");
  const imageLocation = gl.getUniformLocation(program, "image");

  return {
    begin(nextWidth: number, nextHeight: number) {
      previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (width !== nextWidth || height !== nextHeight) {
        width = nextWidth;
        height = nextHeight;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          texture,
          0,
        );
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(
          gl.RENDERBUFFER,
          gl.DEPTH_COMPONENT16,
          width,
          height,
        );
        gl.framebufferRenderbuffer(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.RENDERBUFFER,
          depth,
        );
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        ) {
          throw new Error("Hero finishing framebuffer is incomplete");
        }
      }
      gl.viewport(0, 0, width, height);
    },
    finish(grain: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(imageLocation, 0);
      gl.uniform1f(grainLocation, grain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(previousVao);
      gl.useProgram(previousProgram);
    },
    dispose,
  };
}
