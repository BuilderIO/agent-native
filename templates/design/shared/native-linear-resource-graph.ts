import type { EffectPass, EffectResourceSpec } from "./effect-graph";

export interface EffectLinearResourceGraphSpec {
  abi: "linear-resource-v1";
}

export type LinearResourceDispatch =
  | {
      elements: "output-texture";
      workgroupSize: readonly [number, number, 1];
    }
  | {
      elements: "output-buffer";
      workgroupSize: readonly [number, 1, 1];
    };

const RESOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TEXTURE_FORMATS = new Set(["rgba8unorm", "rgba16float"]);

export function isLinearResourceDispatch(
  value: unknown,
): value is LinearResourceDispatch {
  if (!value || typeof value !== "object") return false;
  const dispatch = value as Record<string, unknown>;
  const size = dispatch.workgroupSize;
  if (
    Object.keys(dispatch).length !== 2 ||
    !Array.isArray(size) ||
    size.length !== 3 ||
    size.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    size[2] !== 1 ||
    size[0] * size[1] > 256
  )
    return false;
  return (
    (dispatch.elements === "output-texture" &&
      size[0] <= 256 &&
      size[1] <= 256) ||
    (dispatch.elements === "output-buffer" && size[1] === 1 && size[0] <= 256)
  );
}

function withoutWgslCommentsAndStrings(source: string): string | null {
  let output = "";
  let blockDepth = 0;
  let line = false;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (line) {
      if (character === "\n") {
        line = false;
        output += "\n";
      } else output += " ";
      continue;
    }
    if (blockDepth) {
      if (character === "/" && next === "*") {
        blockDepth += 1;
        output += "  ";
        index += 1;
      } else if (character === "*" && next === "/") {
        blockDepth -= 1;
        output += "  ";
        index += 1;
      } else output += character === "\n" ? "\n" : " ";
      continue;
    }
    if (quote) {
      if (character === "\\") {
        output += "  ";
        index += 1;
      } else if (character === quote) {
        quote = null;
        output += " ";
      } else output += character === "\n" ? "\n" : " ";
      continue;
    }
    if (character === "/" && next === "/") {
      line = true;
      output += "  ";
      index += 1;
    } else if (character === "/" && next === "*") {
      blockDepth = 1;
      output += "  ";
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
      output += " ";
    } else output += character;
  }
  return blockDepth || quote ? null : output;
}

export function linearResourceWorkgroupSize(
  wgsl: string,
): readonly [number, number, number] | null {
  const source = withoutWgslCommentsAndStrings(wgsl);
  if (!source) return null;
  const entry =
    /@compute\s+@workgroup_size\s*\(\s*(\d+)u?\s*,\s*(\d+)u?\s*,\s*(\d+)u?\s*\)\s*fn\s+cs\s*\(/g;
  const matches = [...source.matchAll(entry)];
  if (
    matches.length !== 1 ||
    [...source.matchAll(/\bfn\s+cs\s*\(/g)].length !== 1 ||
    [...source.matchAll(/@compute\b/g)].length !== 1
  )
    return null;
  const values = matches[0]!.slice(1, 4).map(Number);
  return values.every(Number.isSafeInteger)
    ? (values as [number, number, number])
    : null;
}

export function validateLinearResourceGraph(
  spec: EffectLinearResourceGraphSpec,
  passes: readonly EffectPass[],
  resources: ReadonlyMap<string, EffectResourceSpec>,
  output: string | undefined,
): string[] {
  const errors: string[] = [];
  if (
    !spec ||
    spec.abi !== "linear-resource-v1" ||
    Object.keys(spec).length !== 1 ||
    !output ||
    !RESOURCE_NAME.test(output)
  )
    return ["linear resource graph needs an explicit final texture output"];
  const producers = new Map(passes.map((pass) => [pass.output, pass]));
  const final = resources.get(output);
  if (
    final?.kind !== "texture-2d" ||
    final.external === true ||
    !final.usage?.includes("sampled") ||
    !producers.has(output)
  )
    errors.push(
      "linear resource graph final output must be a produced sampled texture",
    );
  for (const resource of resources.values()) {
    if (
      resource.usage?.some(
        (usage) => usage === "copy-src" || usage === "copy-dst",
      )
    )
      errors.push(
        `linear resource ${resource.name} declares unsupported copy usage`,
      );
    if (
      resource.persistent ||
      resource.preprocess ||
      resource.mipmap ||
      resource.size === "source"
    )
      errors.push(
        `linear resource ${resource.name} has an unsupported lifetime or preprocessing mode`,
      );
    if (resource.external) {
      if (
        resource.kind !== "texture-2d" ||
        resource.usage?.length !== 1 ||
        resource.usage[0] !== "sampled"
      )
        errors.push(
          `linear external resource ${resource.name} must be a sampled texture`,
        );
      continue;
    }
    if (resource.kind === "buffer") {
      if (
        resource.size !== "fixed" ||
        !Number.isSafeInteger(resource.byteLength) ||
        !resource.byteLength ||
        resource.byteLength % 16 !== 0 ||
        resource.byteLength > 16_777_216 ||
        resource.format !== undefined ||
        resource.usage?.length !== 1 ||
        resource.usage[0] !== "storage"
      )
        errors.push(
          `linear buffer ${resource.name} needs bounded 16-byte storage cells`,
        );
    } else if (
      !TEXTURE_FORMATS.has(resource.format ?? "") ||
      (resource.size !== "viewport" && resource.size !== "fixed") ||
      !resource.usage?.includes("sampled")
    )
      errors.push(
        `linear texture ${resource.name} needs a supported sampled format and size`,
      );
  }
  for (const pass of passes) {
    const resource = resources.get(pass.output);
    if (
      pass.additionalOutputs !== undefined ||
      pass.previousFrameReads !== undefined ||
      pass.persistent !== undefined ||
      pass.draw !== undefined ||
      pass.original !== undefined
    )
      errors.push(
        `linear pass ${pass.id} uses an unsupported temporal or extra-output mode`,
      );
    if (pass.kind === "compute") {
      const dispatch = pass.dispatch;
      if (
        !isLinearResourceDispatch(dispatch) ||
        (dispatch.elements === "output-texture") !==
          (resource?.kind === "texture-2d") ||
        !resource?.usage?.includes("storage")
      ) {
        errors.push(
          `linear compute pass ${pass.id} needs a matching storage output and dispatch`,
        );
        continue;
      }
      const declared = linearResourceWorkgroupSize(pass.wgsl);
      if (
        !declared ||
        declared.some(
          (dimension, index) => dimension !== dispatch.workgroupSize[index],
        )
      )
        errors.push(
          `linear compute pass ${pass.id} has mismatched WGSL workgroup metadata`,
        );
    } else if (
      pass.kind !== "render" ||
      pass.dispatch !== undefined ||
      resource?.kind !== "texture-2d" ||
      !resource.usage?.includes("render")
    )
      errors.push(
        `linear render pass ${pass.id} needs a render texture output`,
      );
    for (const read of pass.reads) {
      const input = resources.get(read);
      if (
        !input ||
        (input.kind === "texture-2d" && !input.usage?.includes("sampled")) ||
        (input.kind === "buffer" && !input.usage?.includes("storage"))
      )
        errors.push(`linear pass ${pass.id} has an unsupported read ${read}`);
    }
  }
  return errors;
}
