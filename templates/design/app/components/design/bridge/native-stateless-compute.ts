import {
  NativeStatelessComputeError,
  type StatelessComputePlan,
} from "../../../../shared/native-stateless-compute";

declare const GPUBufferUsage: Readonly<{
  STORAGE: number;
  COPY_DST: number;
  UNIFORM: number;
}>;
declare const GPUShaderStage: Readonly<{
  COMPUTE: number;
  VERTEX: number;
  FRAGMENT: number;
}>;
export interface NativeStatelessBufferAllocator {
  allocate(byteLength: number, usage: GPUBufferUsageFlags): GPUBuffer;
  release(buffer: GPUBuffer): void;
}
export interface NativeStatelessComputeFrame {
  abandon(): void;
  retire(): Promise<void>;
}

export class NativeStatelessComputePipelines {
  private constructor(
    private readonly device: GPUDevice,
    private readonly compute: GPUComputePipeline,
    private readonly resolve: GPURenderPipeline,
    private readonly computeLayout: GPUBindGroupLayout,
    private readonly resolveLayout: GPUBindGroupLayout,
  ) {}

  static async create(
    device: GPUDevice,
    computeWgsl: string,
    resolveWgsl: string,
  ): Promise<NativeStatelessComputePipelines> {
    const entries = (
      stage: number,
      bufferType: GPUBufferBindingType,
    ): GPUBindGroupLayoutEntry[] => [
      {
        binding: 0,
        visibility: stage,
        buffer: { type: "uniform", minBindingSize: 544 },
      },
      { binding: 1, visibility: stage, sampler: { type: "filtering" } },
      {
        binding: 2,
        visibility: stage,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 3,
        visibility: stage,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 4,
        visibility: stage,
        buffer: { type: bufferType, minBindingSize: 4 },
      },
    ];
    const computeLayout = device.createBindGroupLayout({
      entries: entries(GPUShaderStage.COMPUTE, "storage"),
    });
    const resolveLayout = device.createBindGroupLayout({
      entries: entries(
        GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        "read-only-storage",
      ),
    });
    const computeModule = device.createShaderModule({ code: computeWgsl });
    const resolveModule = device.createShaderModule({ code: resolveWgsl });
    for (const module of [computeModule, resolveModule]) {
      const info = await module.getCompilationInfo();
      if (info.messages.some((message) => message.type === "error"))
        throw new NativeStatelessComputeError(
          "stateless-compute-shader-invalid",
        );
    }
    try {
      const compute = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [computeLayout],
        }),
        compute: { module: computeModule, entryPoint: "cs" },
      });
      const resolve = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [resolveLayout],
        }),
        vertex: { module: resolveModule, entryPoint: "vs" },
        fragment: {
          module: resolveModule,
          entryPoint: "fs",
          targets: [{ format: "rgba16float" }],
        },
        primitive: { topology: "triangle-list" },
      });
      return new NativeStatelessComputePipelines(
        device,
        compute,
        resolve,
        computeLayout,
        resolveLayout,
      );
    } catch {
      throw new NativeStatelessComputeError("stateless-compute-shader-invalid");
    }
  }

  encode(options: {
    plan: StatelessComputePlan;
    encoder: GPUCommandEncoder;
    source: GPUTexture;
    target: GPUTexture;
    white: GPUTexture;
    sampler: GPUSampler;
    data: Float32Array;
    allocator: NativeStatelessBufferAllocator;
    timestampWritesForPass?: (kind: "compute" | "resolve") => {
      timestampWrites?: GPUComputePassTimestampWrites;
    };
  }): NativeStatelessComputeFrame {
    const { plan, source, target, data, allocator } = options;
    if (
      plan.mode !== "compute" ||
      source === target ||
      source.width !== plan.sourceWidth ||
      source.height !== plan.sourceHeight ||
      target.format !== "rgba16float" ||
      data.length !== 136 ||
      data[6] !== plan.encodedDensity ||
      !Number.isSafeInteger(plan.byteLength) ||
      plan.byteLength < 4 ||
      plan.byteLength % 4 !== 0
    )
      throw new NativeStatelessComputeError("stateless-compute-frame-invalid");
    const buffers: GPUBuffer[] = [];
    let closed = false;
    const release = () => {
      for (const buffer of buffers.splice(0)) allocator.release(buffer);
    };
    try {
      const storage = allocator.allocate(
        plan.byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      );
      buffers.push(storage);
      const uniform = allocator.allocate(
        data.byteLength,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      );
      buffers.push(uniform);
      this.device.queue.writeBuffer(uniform, 0, data);
      const entries: GPUBindGroupEntry[] = [
        {
          binding: 0,
          resource: { buffer: uniform, offset: 0, size: data.byteLength },
        },
        { binding: 1, resource: options.sampler },
        { binding: 2, resource: source.createView() },
        { binding: 3, resource: options.white.createView() },
        {
          binding: 4,
          resource: { buffer: storage, offset: 0, size: plan.byteLength },
        },
      ];
      const computeGroup = this.device.createBindGroup({
        layout: this.computeLayout,
        entries,
      });
      const resolveGroup = this.device.createBindGroup({
        layout: this.resolveLayout,
        entries,
      });
      options.encoder.clearBuffer(storage, 0, plan.byteLength);
      const compute = options.encoder.beginComputePass(
        options.timestampWritesForPass?.("compute") ?? {},
      );
      compute.setPipeline(this.compute);
      compute.setBindGroup(0, computeGroup);
      compute.dispatchWorkgroups(...plan.workgroups);
      compute.end();
      const resolve = options.encoder.beginRenderPass({
        ...options.timestampWritesForPass?.("resolve"),
        colorAttachments: [
          {
            view: target.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      resolve.setPipeline(this.resolve);
      resolve.setBindGroup(0, resolveGroup);
      resolve.draw(3);
      resolve.end();
    } catch (error) {
      release();
      throw error;
    }
    return {
      abandon: () => {
        if (closed) return;
        closed = true;
        release();
      },
      retire: async () => {
        if (closed)
          throw new NativeStatelessComputeError(
            "stateless-compute-frame-invalid",
          );
        closed = true;
        try {
          await this.device.queue.onSubmittedWorkDone();
        } finally {
          release();
        }
      },
    };
  }
}
