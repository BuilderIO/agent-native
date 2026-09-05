import { PI, cmul, wrapLoad } from "./ocean-common.wgsl";

struct IfftStageUniforms {
  resolution: f32,
  subtransformSize: f32,
  horizontal: f32,
};
@group(0) @binding(0) var<uniform> u: IfftStageUniforms;
@group(0) @binding(1) var u_input: texture_2d<f32>;

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let N = i32(u.resolution);
  let horizontal = u.horizontal > 0.5;
  let index = select(position.y - 0.5, position.x - 0.5, horizontal);

  let evenIndex = floor(index / u.subtransformSize) * (u.subtransformSize * 0.5)
                + (index % (u.subtransformSize * 0.5));

  let evenCoord = select(
    vec2i(i32(position.x - 0.5), i32(evenIndex)),
    vec2i(i32(evenIndex), i32(position.y - 0.5)),
    horizontal,
  );
  let oddCoord = select(
    vec2i(i32(position.x - 0.5), i32(evenIndex + u.resolution * 0.5)),
    vec2i(i32(evenIndex + u.resolution * 0.5), i32(position.y - 0.5)),
    horizontal,
  );
  let even = wrapLoad(u_input, evenCoord, N);
  let odd = wrapLoad(u_input, oddCoord, N);

  let twiddleArg = 2.0 * PI * (index / u.subtransformSize);
  let twiddle = vec2f(cos(twiddleArg), sin(twiddleArg));

  let outA = even.xy + cmul(twiddle, odd.xy);
  let outB = even.zw + cmul(twiddle, odd.zw);
  return vec4f(outA, outB);
}
