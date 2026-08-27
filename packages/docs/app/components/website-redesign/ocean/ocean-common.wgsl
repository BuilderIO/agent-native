export const PI: f32 = 3.141592653589793;
export const G: f32 = 9.81;

export fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

export fn wrapCoord(coord: vec2i, N: i32) -> vec2u {
  let wrapped = (coord % vec2i(N) + vec2i(N)) % vec2i(N);
  return vec2u(wrapped);
}

export fn wrapLoad(tex: texture_2d<f32>, coord: vec2i, N: i32) -> vec4f {
  return textureLoad(tex, wrapCoord(coord, N), 0);
}
