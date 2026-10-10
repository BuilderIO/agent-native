import {
  isStatelessComputeDispatch,
  validateStatelessComputeGraph,
  type StatelessComputeDispatch,
} from "./native-stateless-compute";

export interface EffectStatelessComputeSpec {
  abi: "source-buffer-v1";
  bufferResource: string;
  sharedBytes: number;
  subpixelBlocks?: "source-identity";
}

export interface EffectPass {
  id: string;
  kind: "render" | "compute";
  wgsl: string;
  original?: unknown;
  reads: string[];
  output: string;
  additionalOutputs?: string[];
  persistent?: boolean;
  previousFrameReads?: string[];
  dispatch?:
    | { workgroupSize: 256; elements: "simulation-count" }
    | { workgroupSize: readonly [8, 8]; elements: "fixed-grid" }
    | StatelessComputeDispatch;
  draw?: { vertices: 6; instances: "simulation-count" };
}

export interface EffectFeedbackSpec {
  abi: "texture-feedback-v1";
  grid: {
    width: number;
    height: number;
    format: "rgba16float";
    workgroup: readonly [8, 8];
  };
  timing: {
    fixedDt: number;
    maxStepsPerCall: number;
    maxStepIndex: number;
  };
  stateResource: string;
  displayResource: string;
  uniformProperties?: Partial<Record<FeedbackUniformSlot, string>>;
}

export const FEEDBACK_UNIFORM_SLOTS = [
  "intensity",
  "blockSize",
  "drift",
  "churn",
  "blend",
  "seed",
] as const;

export type FeedbackUniformSlot = (typeof FEEDBACK_UNIFORM_SLOTS)[number];

export function feedbackUniformProperties(
  feedback: EffectFeedbackSpec,
): Record<FeedbackUniformSlot, string> {
  return Object.fromEntries(
    FEEDBACK_UNIFORM_SLOTS.map((slot) => [
      slot,
      feedback.uniformProperties?.[slot] ?? slot,
    ]),
  ) as Record<FeedbackUniformSlot, string>;
}

export interface EffectResourceSpec {
  name: string;
  kind: "texture-2d" | "buffer";
  format?: string;
  usage?: ("sampled" | "render" | "storage" | "copy-src" | "copy-dst")[];
  size?: "viewport" | "fixed" | "source";
  sourceBytesPerPixel?: 1 | 4 | 8 | 16;
  width?: number;
  height?: number;
  byteLength?: number;
  persistent?: boolean;
  external?: boolean;
  sampleEncoding?:
    | "srgb-color"
    | "srgb-color-premultiplied"
    | "linear-data"
    | "srgb-encoded-straight";
  preprocess?: "paper-liquid-mask" | "paper-gem-smoke-mask-32";
  mipmap?: "generated";
}

export interface EffectResourceLifetime {
  name: string;
  producer: string | null;
  firstUse: number;
  lastUse: number;
  persistent: boolean;
  external: boolean;
  kind?: EffectResourceSpec["kind"];
  format?: string;
  size?: EffectResourceSpec["size"];
}

export interface EffectPassPlan {
  passes: EffectPass[];
  resources: EffectResourceLifetime[];
  errors: string[];
}

const EXTERNAL_RESOURCES = new Set(["source", "mask", "backdrop"]);
const RESOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function validateFeedbackGraph(
  feedback: EffectFeedbackSpec,
  passes: readonly EffectPass[],
  resources: ReadonlyMap<string, EffectResourceSpec>,
  output: string | undefined,
): string[] {
  if (
    feedback?.abi !== "texture-feedback-v1" ||
    !feedback.grid ||
    !Number.isSafeInteger(feedback.grid.width) ||
    !Number.isSafeInteger(feedback.grid.height) ||
    feedback.grid.width < 1 ||
    feedback.grid.height < 1 ||
    feedback.grid.width > 2048 ||
    feedback.grid.height > 2048 ||
    feedback.grid.width * feedback.grid.height > 2_097_152 ||
    feedback.grid.format !== "rgba16float" ||
    !Array.isArray(feedback.grid.workgroup) ||
    feedback.grid.workgroup.length !== 2 ||
    feedback.grid.workgroup[0] !== 8 ||
    feedback.grid.workgroup[1] !== 8 ||
    !feedback.timing ||
    !Number.isFinite(feedback.timing.fixedDt) ||
    feedback.timing.fixedDt < 1 / 240 ||
    feedback.timing.fixedDt > 1 / 15 ||
    !Number.isSafeInteger(feedback.timing.maxStepsPerCall) ||
    feedback.timing.maxStepsPerCall < 1 ||
    feedback.timing.maxStepsPerCall > 512 ||
    !Number.isSafeInteger(feedback.timing.maxStepIndex) ||
    feedback.timing.maxStepIndex < 0 ||
    feedback.timing.maxStepIndex > 36_000 ||
    typeof feedback.stateResource !== "string" ||
    !RESOURCE_NAME.test(feedback.stateResource) ||
    typeof feedback.displayResource !== "string" ||
    !RESOURCE_NAME.test(feedback.displayResource) ||
    feedback.stateResource === feedback.displayResource ||
    (feedback.uniformProperties !== undefined &&
      (typeof feedback.uniformProperties !== "object" ||
        feedback.uniformProperties === null ||
        Array.isArray(feedback.uniformProperties) ||
        Object.keys(feedback.uniformProperties).some(
          (slot) =>
            !FEEDBACK_UNIFORM_SLOTS.includes(slot as FeedbackUniformSlot) ||
            !RESOURCE_NAME.test(
              feedback.uniformProperties?.[slot as FeedbackUniformSlot] ?? "",
            ),
        ) ||
        new Set(Object.values(feedbackUniformProperties(feedback))).size !==
          FEEDBACK_UNIFORM_SLOTS.length))
  )
    return ["feedback specification is malformed or unbounded"];
  const errors: string[] = [];
  const [compute, resolve] = passes;
  const state = resources.get(feedback.stateResource);
  const display = resources.get(feedback.displayResource);
  const presented = output ? resources.get(output) : undefined;
  const fixedTexture = (resource: EffectResourceSpec | undefined): boolean =>
    resource?.kind === "texture-2d" &&
    resource.external !== true &&
    resource.size === "fixed" &&
    resource.width === feedback.grid.width &&
    resource.height === feedback.grid.height &&
    resource.format === "rgba16float" &&
    resource.usage?.includes("sampled") === true &&
    resource.usage.includes("storage");
  if (
    passes.length !== 2 ||
    compute?.kind !== "compute" ||
    compute.reads.length !== 1 ||
    compute.reads[0] !== "source" ||
    compute.output !== feedback.stateResource ||
    compute.additionalOutputs?.length !== 1 ||
    compute.additionalOutputs[0] !== feedback.displayResource ||
    compute.previousFrameReads?.length !== 1 ||
    compute.previousFrameReads[0] !== feedback.stateResource ||
    compute.dispatch?.elements !== "fixed-grid" ||
    !Array.isArray(compute.dispatch.workgroupSize) ||
    compute.dispatch.workgroupSize[0] !== 8 ||
    compute.dispatch.workgroupSize[1] !== 8 ||
    resolve?.kind !== "render" ||
    resolve.reads.length !== 2 ||
    resolve.reads[0] !== "source" ||
    resolve.reads[1] !== feedback.displayResource ||
    resolve.additionalOutputs !== undefined ||
    resolve.previousFrameReads !== undefined ||
    resolve.dispatch !== undefined ||
    resolve.draw !== undefined ||
    output !== resolve.output
  )
    errors.push(
      "feedback needs one state/display compute and one source/display resolve pass",
    );
  if (
    !fixedTexture(state) ||
    state?.persistent !== true ||
    !fixedTexture(display) ||
    display?.persistent === true ||
    presented?.kind !== "texture-2d" ||
    presented.external === true ||
    presented.size !== "viewport" ||
    presented.format !== "rgba16float" ||
    !presented.usage?.includes("render") ||
    !presented.usage.includes("sampled")
  )
    errors.push(
      "feedback needs bounded float state, display, and resolve resources",
    );
  return errors;
}

export function planEffectPasses(
  passes: readonly EffectPass[],
  declaredResources?: readonly EffectResourceSpec[],
  finalOutput?: string,
  feedback?: EffectFeedbackSpec,
  statelessCompute?: EffectStatelessComputeSpec,
): EffectPassPlan {
  const errors: string[] = [];
  if (!Array.isArray(passes) || passes.length < 1 || passes.length > 16) {
    return {
      passes: [],
      resources: [],
      errors: ["effect graph needs 1–16 passes"],
    };
  }
  for (const [index, pass] of passes.entries()) {
    if (
      !pass ||
      typeof pass !== "object" ||
      typeof pass.id !== "string" ||
      typeof pass.output !== "string" ||
      typeof pass.wgsl !== "string" ||
      !Array.isArray(pass.reads) ||
      (pass.additionalOutputs !== undefined &&
        (!Array.isArray(pass.additionalOutputs) ||
          pass.additionalOutputs.length !== 1 ||
          !pass.additionalOutputs.every(
            (output: unknown) => typeof output === "string",
          ))) ||
      pass.reads.length > 16 ||
      !pass.reads.every((read: unknown) => typeof read === "string") ||
      new Set(pass.reads).size !== pass.reads.length ||
      (pass.previousFrameReads !== undefined &&
        (!Array.isArray(pass.previousFrameReads) ||
          pass.previousFrameReads.length > 16 ||
          !pass.previousFrameReads.every(
            (read: unknown) => typeof read === "string",
          ) ||
          new Set(pass.previousFrameReads).size !==
            pass.previousFrameReads.length)) ||
      (pass.dispatch !== undefined &&
        (pass.kind !== "compute" ||
          !(
            (pass.dispatch.workgroupSize === 256 &&
              pass.dispatch.elements === "simulation-count") ||
            (Array.isArray(pass.dispatch.workgroupSize) &&
              pass.dispatch.workgroupSize.length === 2 &&
              pass.dispatch.workgroupSize[0] === 8 &&
              pass.dispatch.workgroupSize[1] === 8 &&
              pass.dispatch.elements === "fixed-grid") ||
            isStatelessComputeDispatch(pass.dispatch)
          ) ||
          (!isStatelessComputeDispatch(pass.dispatch) &&
            Object.keys(pass.dispatch).length !== 2))) ||
      (pass.draw !== undefined &&
        (pass.kind !== "render" ||
          pass.draw.vertices !== 6 ||
          pass.draw.instances !== "simulation-count" ||
          Object.keys(pass.draw).length !== 2))
    ) {
      errors.push(`pass[${index}] is malformed`);
    }
  }
  if (errors.length) return { passes: [], resources: [], errors };
  if (passes.some((pass) => pass.original !== undefined)) {
    return {
      passes: [],
      resources: [],
      errors: ["retired original-pass execution is unsupported"],
    };
  }
  if (
    declaredResources?.some((resource) => resource.preprocess !== undefined)
  ) {
    return {
      passes: [],
      resources: [],
      errors: ["retired source preprocessing is unsupported"],
    };
  }
  const declarations = new Map<string, EffectResourceSpec>();
  if (declaredResources) {
    if (!Array.isArray(declaredResources) || declaredResources.length > 48) {
      return {
        passes: [],
        resources: [],
        errors: ["effect graph declares too many resources"],
      };
    }
    for (const [index, resource] of declaredResources.entries()) {
      if (
        !resource ||
        typeof resource !== "object" ||
        typeof resource.name !== "string" ||
        !RESOURCE_NAME.test(resource.name) ||
        (resource.kind !== "texture-2d" && resource.kind !== "buffer") ||
        (resource.format !== undefined &&
          (typeof resource.format !== "string" ||
            !/^[a-z0-9-]{1,64}$/.test(resource.format))) ||
        (resource.size !== undefined &&
          resource.size !== "viewport" &&
          resource.size !== "fixed" &&
          resource.size !== "source") ||
        (resource.kind === "buffer" &&
          ((resource.size === "source"
            ? resource.byteLength !== undefined ||
              ![1, 4, 8, 16].includes(resource.sourceBytesPerPixel as number)
            : !Number.isSafeInteger(resource.byteLength) ||
              (resource.byteLength as number) < 1 ||
              (resource.byteLength as number) > 16_777_216 ||
              resource.sourceBytesPerPixel !== undefined) ||
            resource.width !== undefined ||
            resource.height !== undefined)) ||
        (resource.kind === "texture-2d" &&
          (resource.byteLength !== undefined ||
            resource.sourceBytesPerPixel !== undefined ||
            resource.size === "source" ||
            (resource.size === "fixed" &&
              (!Number.isSafeInteger(resource.width) ||
                !Number.isSafeInteger(resource.height) ||
                (resource.width as number) < 1 ||
                (resource.height as number) < 1 ||
                (resource.width as number) > 8_192 ||
                (resource.height as number) > 8_192)) ||
            (resource.size !== "fixed" &&
              (resource.width !== undefined ||
                resource.height !== undefined)))) ||
        (resource.persistent !== undefined &&
          typeof resource.persistent !== "boolean") ||
        (resource.external !== undefined &&
          typeof resource.external !== "boolean") ||
        (resource.sampleEncoding !== undefined &&
          ((resource.sampleEncoding !== "srgb-color" &&
            resource.sampleEncoding !== "srgb-color-premultiplied" &&
            resource.sampleEncoding !== "linear-data" &&
            resource.sampleEncoding !== "srgb-encoded-straight") ||
            (resource.sampleEncoding === "srgb-encoded-straight" &&
              resource.name !== "source" &&
              resource.name !== "image") ||
            resource.kind !== "texture-2d" ||
            resource.external !== true ||
            (resource.usage !== undefined &&
              (!Array.isArray(resource.usage) ||
                !resource.usage.includes("sampled"))))) ||
        (resource.preprocess !== undefined &&
          ((resource.preprocess !== "paper-liquid-mask" &&
            resource.preprocess !== "paper-gem-smoke-mask-32") ||
            resource.kind !== "texture-2d" ||
            resource.external !== true ||
            resource.sampleEncoding !== "linear-data" ||
            resource.mipmap !== "generated")) ||
        (resource.mipmap !== undefined &&
          (resource.mipmap !== "generated" ||
            resource.kind !== "texture-2d" ||
            resource.external !== true ||
            (resource.usage !== undefined &&
              !resource.usage.includes("sampled")))) ||
        (resource.usage !== undefined &&
          (!Array.isArray(resource.usage) ||
            new Set(resource.usage).size !== resource.usage.length ||
            !resource.usage.every(
              (usage: unknown) =>
                typeof usage === "string" &&
                [
                  "sampled",
                  "render",
                  "storage",
                  "copy-src",
                  "copy-dst",
                ].includes(usage),
            )))
      ) {
        errors.push(`resource[${index}] is malformed`);
        continue;
      }
      if (declarations.has(resource.name))
        errors.push(`resource "${resource.name}" is duplicated`);
      if (EXTERNAL_RESOURCES.has(resource.name) && !resource.external) {
        errors.push(`resource "${resource.name}" has invalid external binding`);
      }
      declarations.set(resource.name, resource);
    }
  }
  if (errors.length) return { passes: [], resources: [], errors };
  const producers = new Map<string, EffectPass>();
  const ids = new Set<string>();
  for (const pass of passes) {
    if (!RESOURCE_NAME.test(pass.id) || ids.has(pass.id)) {
      errors.push(`pass id "${pass.id}" is invalid or duplicated`);
    }
    ids.add(pass.id);
    for (const output of [pass.output, ...(pass.additionalOutputs ?? [])]) {
      if (
        !RESOURCE_NAME.test(output) ||
        EXTERNAL_RESOURCES.has(output) ||
        declarations.get(output)?.external
      )
        errors.push(`pass "${pass.id}" has invalid output "${output}"`);
      if (producers.has(output))
        errors.push(`resource "${output}" has multiple producers`);
      producers.set(output, pass);
    }
    if (declaredResources) {
      for (const output of [pass.output, ...(pass.additionalOutputs ?? [])]) {
        const resource = declarations.get(output);
        if (!resource)
          errors.push(`pass "${pass.id}" output "${output}" is undeclared`);
        else if (pass.kind === "render" && resource.kind !== "texture-2d")
          errors.push(
            `render pass "${pass.id}" must output a texture-2d resource`,
          );
        if (
          resource &&
          pass.persistent !== undefined &&
          resource.persistent !== undefined &&
          pass.persistent !== resource.persistent &&
          output === pass.output
        )
          errors.push(
            `pass "${pass.id}" persistence disagrees with resource "${output}"`,
          );
        if (
          resource?.usage &&
          !resource.usage.includes(
            pass.kind === "render" ? "render" : "storage",
          )
        )
          errors.push(
            `pass "${pass.id}" output "${output}" lacks ${pass.kind === "render" ? "render" : "storage"} usage`,
          );
      }
    }
    if (
      [...pass.reads].some((read) =>
        [pass.output, ...(pass.additionalOutputs ?? [])].includes(read),
      )
    ) {
      errors.push(
        `pass "${pass.id}" reads and writes "${pass.output}" in one frame`,
      );
    }
    if (pass.kind !== "render" && pass.kind !== "compute") {
      errors.push(`pass "${pass.id}" has invalid kind`);
    }
  }
  if (!feedback && passes.some((pass) => pass.additionalOutputs?.length))
    errors.push("additional outputs require a feedback definition");
  if (
    !feedback &&
    passes.some((pass) => pass.dispatch?.elements === "fixed-grid")
  )
    errors.push("fixed-grid dispatch requires a feedback definition");
  if (feedback)
    errors.push(
      ...validateFeedbackGraph(feedback, passes, declarations, finalOutput),
    );

  if (statelessCompute)
    errors.push(
      ...validateStatelessComputeGraph(
        statelessCompute,
        passes,
        declarations,
        finalOutput,
      ),
    );
  else if (
    passes.some((pass) => isStatelessComputeDispatch(pass.dispatch)) ||
    [...declarations.values()].some((resource) => resource.size === "source")
  )
    errors.push("stateless-compute-definition-invalid");

  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const pass of passes) {
    edges.set(pass.id, new Set());
    indegree.set(pass.id, 0);
  }
  for (const pass of passes) {
    for (const resource of pass.reads) {
      if (!RESOURCE_NAME.test(resource))
        errors.push(`invalid resource "${resource}"`);
      const producer = producers.get(resource);
      if (declaredResources && !declarations.has(resource)) {
        errors.push(
          `pass "${pass.id}" reads undeclared resource "${resource}"`,
        );
      }
      const declaration = declarations.get(resource);
      if (
        declaration?.usage &&
        !declaration.usage.includes(
          declaration.kind === "texture-2d" ? "sampled" : "storage",
        )
      )
        errors.push(
          `pass "${pass.id}" read "${resource}" lacks ${declaration.kind === "texture-2d" ? "sampled" : "storage"} usage`,
        );
      if (
        !producer &&
        !declaration?.external &&
        !EXTERNAL_RESOURCES.has(resource)
      ) {
        errors.push(`pass "${pass.id}" reads unknown resource "${resource}"`);
      }
      if (
        producer &&
        producer.id !== pass.id &&
        !edges.get(producer.id)?.has(pass.id)
      ) {
        edges.get(producer.id)?.add(pass.id);
        indegree.set(pass.id, (indegree.get(pass.id) ?? 0) + 1);
      }
    }
    for (const resource of pass.previousFrameReads ?? []) {
      if (!RESOURCE_NAME.test(resource))
        errors.push(`invalid resource "${resource}"`);
      const producer = producers.get(resource);
      const declaration = declarations.get(resource);
      if (!producer || !(declaration?.persistent ?? producer.persistent)) {
        errors.push(
          `pass "${pass.id}" previous-frame read "${resource}" requires a persistent producer`,
        );
      }
      if (
        declaration?.usage &&
        !declaration.usage.includes(
          declaration.kind === "texture-2d" ? "sampled" : "storage",
        )
      )
        errors.push(
          `pass "${pass.id}" previous-frame read "${resource}" lacks ${declaration.kind === "texture-2d" ? "sampled" : "storage"} usage`,
        );
    }
  }

  const ready = passes.filter((pass) => indegree.get(pass.id) === 0);
  const ordered: EffectPass[] = [];
  while (ready.length) {
    const next = ready.shift()!;
    ordered.push(next);
    for (const dependent of edges.get(next.id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        const pass = passes.find((candidate) => candidate.id === dependent);
        if (pass) ready.push(pass);
      }
    }
  }
  if (ordered.length !== passes.length)
    errors.push("same-frame pass graph contains a cycle");
  if (finalOutput !== undefined) {
    if (!RESOURCE_NAME.test(finalOutput) || !producers.has(finalOutput)) {
      errors.push(`final output "${finalOutput}" has no producing pass`);
    } else if (
      declaredResources &&
      declarations.get(finalOutput)?.kind !== "texture-2d"
    ) {
      errors.push(`final output "${finalOutput}" must be texture-2d`);
    }
  }
  const presentedOutput = finalOutput ?? ordered[ordered.length - 1]?.output;
  const presentedDeclaration = presentedOutput
    ? declarations.get(presentedOutput)
    : undefined;
  if (
    presentedOutput &&
    presentedDeclaration?.usage &&
    !presentedDeclaration.usage.includes("sampled")
  )
    errors.push(
      `final output "${presentedOutput}" lacks sampled usage for presentation`,
    );

  const indexes = new Map(ordered.map((pass, index) => [pass.id, index]));
  const resources = new Map<string, EffectResourceLifetime>();
  for (const external of EXTERNAL_RESOURCES) {
    resources.set(external, {
      name: external,
      producer: null,
      firstUse: 0,
      lastUse: -1,
      persistent: false,
      external: true,
      kind: declarations.get(external)?.kind,
      format: declarations.get(external)?.format,
      size: declarations.get(external)?.size,
    });
  }
  for (const pass of ordered) {
    const index = indexes.get(pass.id)!;
    for (const output of [pass.output, ...(pass.additionalOutputs ?? [])])
      resources.set(output, {
        name: output,
        producer: pass.id,
        firstUse: index,
        lastUse: index,
        persistent: declarations.get(output)?.persistent ?? !!pass.persistent,
        external: false,
        kind: declarations.get(output)?.kind,
        format: declarations.get(output)?.format,
        size: declarations.get(output)?.size ?? "viewport",
      });
  }
  for (const pass of ordered) {
    const index = indexes.get(pass.id)!;
    for (const name of [...pass.reads, ...(pass.previousFrameReads ?? [])]) {
      const resource = resources.get(name);
      if (resource) resource.lastUse = Math.max(resource.lastUse, index);
    }
  }
  if (presentedOutput) {
    const presented = resources.get(presentedOutput);
    if (presented)
      presented.lastUse = Math.max(presented.lastUse, ordered.length);
  }
  return {
    passes: errors.length ? [] : ordered,
    resources: [...resources.values()].filter(
      (resource) => resource.lastUse >= 0 || !resource.external,
    ),
    errors,
  };
}

export function planEffectGraph(definition: {
  passes: readonly EffectPass[];
  resources?: readonly EffectResourceSpec[];
  output?: string;
  feedback?: EffectFeedbackSpec;
  statelessCompute?: EffectStatelessComputeSpec;
}): EffectPassPlan {
  return planEffectPasses(
    definition.passes,
    definition.resources,
    definition.output,
    definition.feedback,
    definition.statelessCompute,
  );
}

export function dirtyEffectPasses(
  plan: EffectPassPlan,
  changedResources: readonly string[],
): string[] {
  const dirty = new Set(changedResources);
  const all = dirty.has("params") || dirty.has("clock") || dirty.has("resize");
  const affected: string[] = [];
  for (const pass of plan.passes) {
    if (
      all ||
      pass.reads.some((resource) => dirty.has(resource)) ||
      (pass.previousFrameReads ?? []).some((resource) => dirty.has(resource))
    ) {
      affected.push(pass.id);
      dirty.add(pass.output);
    }
  }
  return affected;
}

export function resizeInvalidatedResources(plan: EffectPassPlan): string[] {
  return plan.resources
    .filter((resource) => !resource.external && resource.size !== "fixed")
    .map((resource) => resource.name);
}
