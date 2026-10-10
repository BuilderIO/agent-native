import type {
  EffectPass,
  EffectResourceSpec,
  EffectStatelessComputeSpec,
} from "./effect-graph";

export type StatelessComputeDispatch =
  | { elements: "source-grid"; workgroupSize: readonly [number, number, 1] }
  | {
      elements: "source-row-blocks";
      workgroupSize: readonly [64, 1, 1];
      blockProperty: string;
    };

export function isStatelessComputeDispatch(
  value: unknown,
): value is StatelessComputeDispatch {
  if (!value || typeof value !== "object") return false;
  const dispatch = value as Record<string, unknown>;
  const size = dispatch.workgroupSize;
  if (
    !Array.isArray(size) ||
    size.length !== 3 ||
    size[2] !== 1 ||
    size.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 256) ||
    size[0] * size[1] > 256
  )
    return false;
  if (dispatch.elements === "source-grid")
    return Object.keys(dispatch).length === 2;
  return (
    dispatch.elements === "source-row-blocks" &&
    Object.keys(dispatch).length === 3 &&
    size[0] === 64 &&
    size[1] === 1 &&
    typeof dispatch.blockProperty === "string" &&
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(dispatch.blockProperty)
  );
}

export function validateStatelessComputeGraph(
  spec: EffectStatelessComputeSpec,
  passes: readonly EffectPass[],
  resources: ReadonlyMap<string, EffectResourceSpec>,
  output: string | undefined,
): string[] {
  const invalid = [
    "stateless compute needs a bounded source/buffer/resolve ABI",
  ];
  if (
    !spec ||
    typeof spec !== "object" ||
    spec.abi !== "source-buffer-v1" ||
    Object.keys(spec).some(
      (key) =>
        !["abi", "bufferResource", "sharedBytes", "subpixelBlocks"].includes(
          key,
        ),
    ) ||
    !Number.isSafeInteger(spec.sharedBytes) ||
    spec.sharedBytes < 0 ||
    spec.sharedBytes > 16_384 ||
    typeof spec.bufferResource !== "string" ||
    (spec.subpixelBlocks !== undefined &&
      spec.subpixelBlocks !== "source-identity")
  )
    return invalid;
  const [compute, resolve] = passes;
  const source = resources.get("source");
  const buffer = resources.get(spec.bufferResource);
  const color = output ? resources.get(output) : undefined;
  if (
    resources.size !== 3 ||
    passes.length !== 2 ||
    source?.kind !== "texture-2d" ||
    source.external !== true ||
    source.size !== "viewport" ||
    source.persistent === true ||
    source.preprocess !== undefined ||
    source.mipmap !== undefined ||
    source.sampleEncoding !== undefined ||
    source.usage?.length !== 1 ||
    !source.usage.includes("sampled") ||
    buffer?.kind !== "buffer" ||
    buffer.size !== "source" ||
    buffer.byteLength !== undefined ||
    ![1, 4, 8, 16].includes(buffer.sourceBytesPerPixel as number) ||
    buffer.external === true ||
    buffer.persistent === true ||
    buffer.format !== undefined ||
    buffer.usage?.length !== 2 ||
    !buffer.usage.includes("storage") ||
    !buffer.usage.includes("copy-dst") ||
    color?.kind !== "texture-2d" ||
    color.size !== "viewport" ||
    color.format !== "rgba16float" ||
    color.external === true ||
    color.persistent === true ||
    !color.usage?.includes("render") ||
    !color.usage.includes("sampled") ||
    compute?.kind !== "compute" ||
    compute.reads.length !== 1 ||
    compute.reads[0] !== "source" ||
    compute.output !== spec.bufferResource ||
    !isStatelessComputeDispatch(compute.dispatch) ||
    resolve?.kind !== "render" ||
    resolve.reads.length !== 2 ||
    resolve.reads[0] !== "source" ||
    resolve.reads[1] !== spec.bufferResource ||
    resolve.output !== output ||
    passes.some(
      (pass) =>
        pass.previousFrameReads !== undefined ||
        pass.additionalOutputs !== undefined ||
        pass.persistent === true ||
        pass.draw !== undefined ||
        pass.original !== undefined,
    ) ||
    resolve.dispatch !== undefined
  )
    return invalid;
  if (
    spec.subpixelBlocks !== undefined &&
    compute.dispatch.elements !== "source-row-blocks"
  )
    return invalid;
  const dispatch = compute.dispatch;
  const match =
    /@compute\s+@workgroup_size\(\s*(\d+)u?\s*(?:,\s*(\d+)u?\s*)?(?:,\s*(\d+)u?\s*)?\)\s*fn\s+cs\s*\(/.exec(
      compute.wgsl,
    );
  if (
    !match ||
    [
      Number(match[1]),
      match[2] === undefined ? 1 : Number(match[2]),
      match[3] === undefined ? 1 : Number(match[3]),
    ].some((n, i) => n !== dispatch.workgroupSize[i])
  )
    return invalid;
  return [];
}

export class NativeStatelessComputeError extends TypeError {
  constructor(
    readonly code:
      | "stateless-compute-definition-invalid"
      | "stateless-compute-source-invalid"
      | "stateless-compute-parameters-invalid"
      | "stateless-compute-limits-unavailable"
      | "stateless-compute-device-limit"
      | "stateless-compute-bytes-unavailable"
      | "stateless-compute-budget-exceeded"
      | "stateless-compute-frame-invalid"
      | "stateless-compute-shader-invalid",
  ) {
    super(code);
    this.name = "NativeStatelessComputeError";
  }
}

export interface StatelessComputeLimits {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  maxComputeWorkgroupsPerDimension: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupSizeX: number;
  maxComputeWorkgroupSizeY: number;
  maxComputeWorkgroupSizeZ: number;
  maxComputeWorkgroupStorageSize: number;
}
export interface StatelessComputePlan {
  mode: "identity" | "compute";
  byteLength: number;
  workgroups: readonly [number, number, 1];
  sourceWidth: number;
  sourceHeight: number;
  encodedDensity: number;
}

export function statelessRowBoundary(
  bucket: number,
  scale: number,
  shift: number,
  width: number,
): number {
  return Math.min(
    width,
    Number(
      (BigInt(bucket) * BigInt(scale) + (1n << BigInt(shift - 1)) - 1n) >>
        BigInt(shift),
    ),
  );
}

export function planStatelessCompute(options: {
  dispatch: StatelessComputeDispatch;
  sourceWidth: number;
  sourceHeight: number;
  sourceBytesPerPixel: number;
  sharedBytes: number;
  subpixelBlocks?: "source-identity";
  pixelRatio: number;
  params: Readonly<Record<string, unknown>>;
  limits: StatelessComputeLimits;
}): StatelessComputePlan {
  const {
    sourceWidth: width,
    sourceHeight: height,
    dispatch,
    limits,
  } = options;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 8_388_608
  )
    throw new NativeStatelessComputeError("stateless-compute-source-invalid");
  if (
    !isStatelessComputeDispatch(dispatch) ||
    (options.subpixelBlocks !== undefined &&
      (options.subpixelBlocks !== "source-identity" ||
        dispatch.elements !== "source-row-blocks")) ||
    ![1, 4, 8, 16].includes(options.sourceBytesPerPixel) ||
    !Number.isSafeInteger(options.sharedBytes) ||
    options.sharedBytes < 0 ||
    options.sharedBytes > 16_384
  )
    throw new NativeStatelessComputeError(
      "stateless-compute-definition-invalid",
    );
  const density = Math.fround(options.pixelRatio);
  if (!Number.isFinite(density) || density <= 0 || density > 4)
    throw new NativeStatelessComputeError(
      "stateless-compute-parameters-invalid",
    );
  const keys: (keyof StatelessComputeLimits)[] = [
    "maxStorageBufferBindingSize",
    "maxBufferSize",
    "maxComputeWorkgroupsPerDimension",
    "maxComputeInvocationsPerWorkgroup",
    "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupSizeY",
    "maxComputeWorkgroupSizeZ",
    "maxComputeWorkgroupStorageSize",
  ];
  if (
    !limits ||
    keys.some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(limits, key) ||
        !Number.isSafeInteger(limits[key]) ||
        limits[key] < 1,
    )
  )
    throw new NativeStatelessComputeError(
      "stateless-compute-limits-unavailable",
    );
  let groupsX = Math.ceil(width / dispatch.workgroupSize[0]);
  let groupsY = Math.ceil(height / dispatch.workgroupSize[1]);
  if (dispatch.elements === "source-row-blocks") {
    const run = options.params[dispatch.blockProperty];
    if (
      typeof run !== "number" ||
      !Number.isInteger(run) ||
      run < 1 ||
      run > 16
    )
      throw new NativeStatelessComputeError(
        "stateless-compute-parameters-invalid",
      );
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, density, true);
    const bits = view.getUint32(0, true);
    const exponent = (bits >>> 23) & 255;
    const shift = 150 - exponent;
    const scale = ((bits & 8_388_607) | 8_388_608) * run;
    if (exponent < 123 || scale < 2 ** shift) {
      if (options.subpixelBlocks !== "source-identity")
        throw new NativeStatelessComputeError("stateless-compute-device-limit");
      return {
        mode: "identity",
        byteLength: 0,
        workgroups: [0, 0, 1],
        sourceWidth: width,
        sourceHeight: height,
        encodedDensity: density,
      };
    }
    const maxSpan = Number(
      (BigInt(scale) + (1n << BigInt(shift)) - 1n) >> BigInt(shift),
    );
    if (maxSpan > 64)
      throw new NativeStatelessComputeError("stateless-compute-device-limit");
    let low = 0,
      high = width + 1;
    while (low + 1 < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (statelessRowBoundary(middle, scale, shift, width) < width)
        low = middle;
      else high = middle;
    }
    groupsX = low + 1;
    groupsY = height;
  }
  const byteLength =
    4 * Math.ceil((width * height * options.sourceBytesPerPixel) / 4);
  const size = dispatch.workgroupSize;
  if (
    byteLength > 16_777_216 ||
    byteLength > limits.maxBufferSize ||
    byteLength > limits.maxStorageBufferBindingSize ||
    groupsX > limits.maxComputeWorkgroupsPerDimension ||
    groupsY > limits.maxComputeWorkgroupsPerDimension ||
    size[0] > limits.maxComputeWorkgroupSizeX ||
    size[1] > limits.maxComputeWorkgroupSizeY ||
    size[2] > limits.maxComputeWorkgroupSizeZ ||
    size[0] * size[1] * size[2] > limits.maxComputeInvocationsPerWorkgroup ||
    options.sharedBytes > limits.maxComputeWorkgroupStorageSize
  )
    throw new NativeStatelessComputeError("stateless-compute-device-limit");
  return {
    mode: "compute",
    byteLength,
    workgroups: [groupsX, groupsY, 1],
    sourceWidth: width,
    sourceHeight: height,
    encodedDensity: density,
  };
}
