import type { EffectInstance } from "../../../../shared/native-effects";

function withoutComments(source: string): string {
  let result = "";
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const pair = source.slice(index, index + 2);
    if (pair === "/*") {
      depth += 1;
      index += 1;
      if (depth === 1) result += " ";
    } else if (depth > 0) {
      if (pair === "*/") {
        depth -= 1;
        index += 1;
      }
    } else if (pair === "//") {
      const end = source.indexOf("\n", index + 2);
      if (end < 0) break;
      index = end;
      result += " ";
    } else {
      result += source[index];
    }
  }
  return result;
}

export function nativeRenderPlacementConstants(
  wgsl: string,
  placement?: EffectInstance["placement"],
): Record<string, number> {
  if (
    !wgsl.includes("NATIVE_GENERATED_FILL") ||
    !/\boverride\s+NATIVE_GENERATED_FILL\s*:\s*bool\b/.test(
      withoutComments(wgsl),
    )
  )
    return {};
  return { NATIVE_GENERATED_FILL: placement === "fill" ? 1 : 0 };
}
