import { describe, expect, it, vi, afterEach } from "vitest";

import {
  NativeStatelessComputeError,
  planStatelessCompute,
} from "../../../../shared/native-stateless-compute";
import { STATELESS_SORT_TEST_DEFINITION as fixture } from "../../../../shared/native-stateless-sort.test-fixture";
import { NativeStatelessComputePipelines } from "./native-stateless-compute";

const limits = {
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456,
  maxComputeWorkgroupsPerDimension: 65535,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupStorageSize: 16384,
};
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  vi.stubGlobal("GPUShaderStage", { COMPUTE: 4, VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("GPUBufferUsage", { STORAGE: 128, COPY_DST: 8, UNIFORM: 64 });
  const trace: string[] = [],
    layouts: GPUBindGroupLayoutDescriptor[] = [],
    groups: GPUBindGroupDescriptor[] = [];
  let finish!: () => void, reject!: (error: unknown) => void;
  let shaderFailure = false,
    allocations = 0,
    failAllocation = Infinity;
  const pending = new Promise<void>((resolve, no) => {
    finish = resolve;
    reject = no;
  });
  const owned = new Map<GPUBuffer, number>(),
    destroyed: GPUBuffer[] = [];
  const device = {
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      layouts.push(descriptor);
      return { descriptor };
    },
    createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor) => ({
      descriptor,
    }),
    createShaderModule: () => ({
      getCompilationInfo: async () => ({
        messages: shaderFailure ? [{ type: "error" }] : [],
      }),
    }),
    createComputePipelineAsync: async () => ({}),
    createRenderPipelineAsync: async () => ({}),
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      groups.push(descriptor);
      return { descriptor };
    },
    queue: {
      writeBuffer: () => trace.push("write-uniform"),
      onSubmittedWorkDone: () => {
        trace.push("wait-completion");
        return pending;
      },
    },
  } as unknown as GPUDevice;
  const allocator = {
    allocate(size: number) {
      if (++allocations === failAllocation)
        throw new Error("allocation refused");
      const buffer = {
        size,
        destroy: () => destroyed.push(buffer),
      } as unknown as GPUBuffer;
      owned.set(buffer, size);
      trace.push(`allocate:${size}`);
      return buffer;
    },
    release(buffer: GPUBuffer) {
      if (!owned.has(buffer)) throw new Error("unowned");
      owned.delete(buffer);
      buffer.destroy();
    },
  };
  const source = {
    width: 13,
    height: 3,
    format: "rgba16float",
    createView: () => ({ name: "source" }),
  } as unknown as GPUTexture;
  const target = {
    width: 21,
    height: 7,
    format: "rgba16float",
    createView: () => ({ name: "target" }),
  } as unknown as GPUTexture;
  const encoder = {
    clearBuffer: (_buffer: GPUBuffer, offset: number, size: number) =>
      trace.push(`clear:${offset}:${size}`),
    beginComputePass: () => {
      trace.push("compute-begin");
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups: (...groups: number[]) =>
          trace.push(`dispatch:${groups.join(",")}`),
        end: () => trace.push("compute-end"),
      };
    },
    beginRenderPass: () => {
      trace.push("resolve-begin");
      return {
        setPipeline() {},
        setBindGroup() {},
        draw: (n: number) => trace.push(`draw:${n}`),
        end: () => trace.push("resolve-end"),
      };
    },
  } as unknown as GPUCommandEncoder;
  const plan = planStatelessCompute({
    dispatch: fixture.passes[0].dispatch as any,
    sourceWidth: 13,
    sourceHeight: 3,
    sourceBytesPerPixel: 1,
    sharedBytes: 512,
    pixelRatio: 1.6,
    params: { blockLength: 8 },
    limits,
  });
  const data = new Float32Array(136);
  data[6] = plan.encodedDensity;
  const pipelines = await NativeStatelessComputePipelines.create(
    device,
    fixture.passes[0].wgsl,
    fixture.passes[1].wgsl,
  );
  return {
    trace,
    layouts,
    groups,
    owned,
    destroyed,
    finish,
    reject,
    device,
    pipelines,
    allocator,
    options: {
      plan,
      encoder,
      source,
      target,
      white: source,
      sampler: {} as GPUSampler,
      data,
      allocator,
    },
    shaderFailure: () => {
      shaderFailure = true;
    },
    failAllocation: (n: number) => {
      failAllocation = n;
    },
  };
}

describe("stateless compute GPU command ownership", () => {
  it("clears the entire packed source buffer before compute, then resolves without source/output alias", async () => {
    const s = await setup(),
      frame = s.pipelines.encode(s.options);
    expect(s.trace).toEqual([
      "allocate:40",
      "allocate:544",
      "write-uniform",
      "clear:0:40",
      "compute-begin",
      "dispatch:1,3,1",
      "compute-end",
      "resolve-begin",
      "draw:3",
      "resolve-end",
    ]);
    expect(
      [...s.layouts[0].entries].find((e) => e.binding === 4),
    ).toMatchObject({ visibility: 4, buffer: { type: "storage" } });
    expect(
      [...s.layouts[1].entries].find((e) => e.binding === 4),
    ).toMatchObject({ visibility: 3, buffer: { type: "read-only-storage" } });
    const storage = [...s.groups[0].entries].find(
      (e) => e.binding === 4,
    )!.resource;
    expect(storage).toMatchObject({ offset: 0, size: 40 });
    expect(
      [...s.groups[1].entries].find((e) => e.binding === 4)!.resource,
    ).toEqual(storage);
    frame.abandon();
    expect(s.owned.size).toBe(0);
    expect(s.destroyed.length).toBe(2);
  });
  it("retains both owned buffers through queued resolve completion, even if abandon is called", async () => {
    const s = await setup(),
      frame = s.pipelines.encode(s.options),
      retirement = frame.retire();
    frame.abandon();
    expect(s.owned.size).toBe(2);
    expect(s.destroyed.length).toBe(0);
    s.finish();
    await retirement;
    expect(s.owned.size).toBe(0);
    expect(s.destroyed.length).toBe(2);
    await expect(frame.retire()).rejects.toThrow(NativeStatelessComputeError);
  });
  it("does not reuse a queued index range for a second frame", async () => {
    const s = await setup(),
      a = s.pipelines.encode(s.options),
      b = s.pipelines.encode(s.options);
    expect(s.owned.size).toBe(4);
    const aa = [...s.groups[0].entries].find((e) => e.binding === 4)!
      .resource as GPUBufferBinding;
    const bb = [...s.groups[2].entries].find((e) => e.binding === 4)!
      .resource as GPUBufferBinding;
    expect(aa.buffer).not.toBe(bb.buffer);
    a.abandon();
    b.abandon();
    expect(s.owned.size).toBe(0);
  });
  it("detaches all newly allocated resources on an unsubmitted partial allocation failure", async () => {
    const s = await setup();
    s.failAllocation(2);
    expect(() => s.pipelines.encode(s.options)).toThrow("allocation refused");
    expect(s.owned.size).toBe(0);
    expect(s.destroyed.length).toBe(1);
    expect(s.trace).not.toContain("compute-begin");
  });
  it("retire rejects on device completion failure after releasing every owned byte", async () => {
    const s = await setup(),
      frame = s.pipelines.encode(s.options),
      retirement = frame.retire();
    s.reject(new Error("device lost"));
    await expect(retirement).rejects.toThrow("device lost");
    expect(s.owned.size).toBe(0);
    expect(s.destroyed.length).toBe(2);
  });
  it.each(["alias", "source-size", "density", "uniform-size", "format"])(
    "rejects a stale frame before allocation: %s",
    async (kind) => {
      const s = await setup(),
        options = { ...s.options };
      if (kind === "alias") options.target = options.source;
      if (kind === "source-size")
        options.source = { ...options.source, width: 14 } as GPUTexture;
      if (kind === "density") options.data[6] = 1;
      if (kind === "uniform-size") options.data = new Float32Array(8);
      if (kind === "format")
        options.target = {
          ...options.target,
          format: "rgba8unorm",
        } as GPUTexture;
      expect(() => s.pipelines.encode(options)).toThrow(
        NativeStatelessComputeError,
      );
      expect(s.owned.size).toBe(0);
    },
  );
  it("rejects shader compilation errors without allocating a buffer", async () => {
    const s = await setup();
    s.shaderFailure();
    await expect(
      NativeStatelessComputePipelines.create(s.device, "bad", "bad"),
    ).rejects.toThrow("stateless-compute-shader-invalid");
    expect(s.owned.size).toBe(0);
  });
});
