export type EdgeMode = "transparent" | "clamp" | "repeat" | "mirror";
export type Pixel = readonly [number, number, number, number];

export const EDGE_SAMPLING_WGSL = `
fn edgeIndex(index: i32, extent: i32, edge: u32) -> i32 {
  if (edge == 2u) { return ((index % extent) + extent) % extent; }
  if (edge == 3u) {
    let period = extent * 2;
    let wrapped = ((index % period) + period) % period;
    return min(wrapped, period - wrapped - 1);
  }
  return clamp(index, 0, extent - 1);
}
fn edgeTexel(texture: texture_2d<f32>, position: vec2i, extent: vec2i, edge: u32) -> vec4f {
  if (edge == 0u && (any(position < vec2i(0)) || any(position >= extent))) { return vec4f(0.0); }
  return textureLoad(texture, vec2i(edgeIndex(position.x, extent.x, edge), edgeIndex(position.y, extent.y, edge)), 0);
}
fn sampleEdgeTexture(texture: texture_2d<f32>, uv: vec2f, edge: u32) -> vec4f {
  let extent = vec2i(textureDimensions(texture, 0));
  let coordinate = uv * vec2f(extent) - vec2f(0.5);
  let base = vec2i(floor(coordinate));
  let blend = fract(coordinate);
  let top = mix(edgeTexel(texture, base, extent, edge), edgeTexel(texture, base + vec2i(1, 0), extent, edge), blend.x);
  let bottom = mix(edgeTexel(texture, base + vec2i(0, 1), extent, edge), edgeTexel(texture, base + vec2i(1, 1), extent, edge), blend.x);
  return mix(top, bottom, blend.y);
}
`;

function indexAt(index: number, extent: number, edge: EdgeMode): number | null {
  if (edge === "transparent" && (index < 0 || index >= extent)) return null;
  if (edge === "repeat") return ((index % extent) + extent) % extent;
  if (edge === "mirror") {
    const period = extent * 2;
    const wrapped = ((index % period) + period) % period;
    return Math.min(wrapped, period - wrapped - 1);
  }
  return Math.max(0, Math.min(index, extent - 1));
}

export function sampleEdgeBilinear(
  pixels: readonly Pixel[],
  width: number,
  height: number,
  u: number,
  v: number,
  edge: EdgeMode,
): Pixel {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height ||
    !Number.isFinite(u) ||
    !Number.isFinite(v)
  ) {
    throw new RangeError("Invalid texture extent, pixels, or UV");
  }
  const px = u * width - 0.5;
  const py = v * height - 0.5;
  const x = Math.floor(px);
  const y = Math.floor(py);
  const fx = px - x;
  const fy = py - y;
  const texel = (tx: number, ty: number): Pixel => {
    const sx = indexAt(tx, width, edge);
    const sy = indexAt(ty, height, edge);
    return sx === null || sy === null ? [0, 0, 0, 0] : pixels[sy * width + sx];
  };
  const a = texel(x, y),
    b = texel(x + 1, y),
    c = texel(x, y + 1),
    d = texel(x + 1, y + 1);
  return [0, 1, 2, 3].map(
    (channel) =>
      (a[channel] * (1 - fx) + b[channel] * fx) * (1 - fy) +
      (c[channel] * (1 - fx) + d[channel] * fx) * fy,
  ) as unknown as Pixel;
}
