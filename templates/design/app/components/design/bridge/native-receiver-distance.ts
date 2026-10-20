export class NativeReceiverGeometryError extends Error {
  readonly code = "receiver-geometry-invalid";
  constructor(message: string) {
    super(message);
    this.name = "NativeReceiverGeometryError";
  }
}

function distanceLine(
  input: Float64Array,
  output: Float64Array,
  count: number,
  step: number,
  sites: Int32Array,
  cuts: Float64Array,
): void {
  const square = step * step;
  let last = 0;
  sites[0] = 0;
  cuts[0] = -Infinity;
  cuts[1] = Infinity;
  for (let point = 1; point < count; point += 1) {
    let cut: number;
    do {
      const prior = sites[last];
      cut =
        (input[point] -
          input[prior] +
          square * (point * point - prior * prior)) /
        (2 * square * (point - prior));
      if (cut > cuts[last]) break;
      last -= 1;
    } while (last >= 0);
    last += 1;
    sites[last] = point;
    cuts[last] = cut;
    cuts[last + 1] = Infinity;
  }
  last = 0;
  for (let point = 0; point < count; point += 1) {
    while (cuts[last + 1] < point) last += 1;
    output[point] = square * (point - sites[last]) ** 2 + input[sites[last]];
  }
}

function squaredDistance(
  occupancy: Uint8Array,
  width: number,
  height: number,
  seed: number,
  stepX: number,
  stepY: number,
): Float64Array {
  const values = new Float64Array(width * height);
  const size = Math.max(width, height);
  const input = new Float64Array(size);
  const output = new Float64Array(size);
  const sites = new Int32Array(size);
  const cuts = new Float64Array(size + 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      input[x] = occupancy[y * width + x] === seed ? 0 : 1e20;
    distanceLine(input, output, width, stepX, sites, cuts);
    for (let x = 0; x < width; x += 1) values[y * width + x] = output[x];
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) input[y] = values[y * width + x];
    distanceLine(input, output, height, stepY, sites, cuts);
    for (let y = 0; y < height; y += 1) values[y * width + x] = output[y];
  }
  return values;
}

export function buildNativeReceiverFields(
  alpha: Uint8Array,
  width: number,
  height: number,
  cssWidth: number,
  cssHeight: number,
  includeInterior = true,
): { geometry: Float32Array; interior: Float32Array | null } {
  if (
    ![width, height].every(
      (value) => Number.isSafeInteger(value) && value > 0 && value <= 512,
    ) ||
    alpha.length !== width * height ||
    ![cssWidth, cssHeight].every(
      (value) => Number.isFinite(value) && value > 0 && value <= 8192,
    )
  )
    throw new NativeReceiverGeometryError(
      "Receiver distance input exceeds its bounded geometry contract.",
    );
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const occupancy = new Uint8Array(paddedWidth * paddedHeight);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      occupancy[(y + 1) * paddedWidth + x + 1] = Number(
        alpha[y * width + x] > 0,
      );
  const stepX = cssWidth / width;
  const stepY = cssHeight / height;
  const outside = squaredDistance(
    occupancy,
    paddedWidth,
    paddedHeight,
    0,
    stepX,
    stepY,
  );
  const inside = squaredDistance(
    occupancy,
    paddedWidth,
    paddedHeight,
    1,
    stepX,
    stepY,
  );
  const distances = new Float32Array(width * height);
  const halfPixel = Math.min(stepX, stepY) * 0.5;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = (y + 1) * paddedWidth + x + 1;
      distances[pixel] = occupancy[index]
        ? Math.sqrt(outside[index]) - halfPixel
        : -Math.min(
            Math.max(cssWidth, cssHeight),
            Math.sqrt(inside[index]) - halfPixel,
          );
    }
  const geometry = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const left = x > 0 ? distances[pixel - 1] : -halfPixel;
      const right = x + 1 < width ? distances[pixel + 1] : -halfPixel;
      const top = y > 0 ? distances[pixel - width] : -halfPixel;
      const bottom = y + 1 < height ? distances[pixel + width] : -halfPixel;
      const normalX = (left - right) / stepX;
      const normalY = (top - bottom) / stepY;
      const length = Math.hypot(normalX, normalY);
      geometry[pixel * 4] = distances[pixel];
      geometry[pixel * 4 + 1] = length > 1e-6 ? normalX / length : 0;
      geometry[pixel * 4 + 2] = length > 1e-6 ? normalY / length : 0;
      geometry[pixel * 4 + 3] = alpha[pixel] / 255;
    }
  if (!includeInterior) return { geometry, interior: null };
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  const queue = new Int32Array(width * height);
  const maxima: number[] = [];
  let component = 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (alpha[start] === 0 || labels[start] !== -1) continue;
    let read = 0;
    let write = 0;
    let maximum = 0;
    queue[write++] = start;
    labels[start] = component;
    while (read < write) {
      const pixel = queue[read++];
      maximum = Math.max(maximum, distances[pixel]);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let deltaY = -1; deltaY <= 1; deltaY += 1)
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const neighborX = x + deltaX;
          const neighborY = y + deltaY;
          if (
            neighborX < 0 ||
            neighborX >= width ||
            neighborY < 0 ||
            neighborY >= height
          )
            continue;
          const neighbor = neighborY * width + neighborX;
          if (alpha[neighbor] > 0 && labels[neighbor] === -1) {
            labels[neighbor] = component;
            queue[write++] = neighbor;
          }
        }
    }
    maxima.push(maximum);
    component += 1;
  }
  const interior = new Float32Array(width * height * 4);
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const offset = pixel * 4;
    const label = labels[pixel];
    if (label >= 0 && maxima[label] > 1e-6) {
      const normalized = Math.min(
        1,
        Math.max(0, distances[pixel]) / maxima[label],
      );
      interior[offset] = normalized * (2 - normalized);
    }
    interior[offset + 1] = geometry[offset + 1];
    interior[offset + 2] = geometry[offset + 2];
    interior[offset + 3] = 1;
  }
  return { geometry, interior };
}

export function buildNativeReceiverDistanceField(
  alpha: Uint8Array,
  width: number,
  height: number,
  cssWidth: number,
  cssHeight: number,
): Float32Array {
  return buildNativeReceiverFields(
    alpha,
    width,
    height,
    cssWidth,
    cssHeight,
    false,
  ).geometry;
}

export function buildNativeReceiverInteriorField(
  alpha: Uint8Array,
  width: number,
  height: number,
  cssWidth: number,
  cssHeight: number,
): Float32Array {
  return buildNativeReceiverFields(alpha, width, height, cssWidth, cssHeight)
    .interior!;
}

export function packNativeReceiverFloat16(values: Float32Array): Uint16Array {
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
  const output = new Uint16Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index]) || Math.abs(values[index]) > 65504)
      throw new NativeReceiverGeometryError(
        "Receiver geometry contains an unrepresentable float value.",
      );
    const word = bits[index];
    const sign = (word >>> 16) & 0x8000;
    const exponent = ((word >>> 23) & 0xff) - 127 + 15;
    const mantissa = word & 0x7fffff;
    output[index] =
      exponent < -10
        ? sign
        : exponent <= 0
          ? sign |
            (((mantissa | 0x800000) + (1 << (13 - exponent))) >>>
              (14 - exponent))
          : sign | (((word + 0x1000 - (112 << 23)) >>> 13) & 0x7fff);
  }
  return output;
}
