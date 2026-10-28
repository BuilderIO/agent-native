import { describe, expect, it } from "vitest";

import { NativePipelineCache } from "../../../../shared/native-pipeline-cache";
import { nativeRenderPlacementConstants } from "./native-render-placement";

const declaration = "override NATIVE_GENERATED_FILL: bool = false;";

describe("native render placement specialization", () => {
  it("uses explicit placement even when Fill and Layer source dimensions agree", () => {
    expect(nativeRenderPlacementConstants(declaration, "fill")).toEqual({
      NATIVE_GENERATED_FILL: 1,
    });
    expect(nativeRenderPlacementConstants(declaration, "layer")).toEqual({
      NATIVE_GENERATED_FILL: 0,
    });
    expect(nativeRenderPlacementConstants(declaration, "backdrop")).toEqual({
      NATIVE_GENERATED_FILL: 0,
    });
    expect(nativeRenderPlacementConstants(declaration)).toEqual({
      NATIVE_GENERATED_FILL: 0,
    });
  });

  it.each([
    "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }",
    `// ${declaration}\nconst unrelated = true;`,
    `/* ${declaration} */`,
    `/* outer /* nested */ ${declaration} */`,
    `/* // ${declaration} */`,
    "const NATIVE_GENERATED_FILL: bool = false;",
    "override NATIVE_GENERATED_FILL_OTHER: bool = false;",
  ])("does not bind undeclared overrides: %s", (source) => {
    expect(nativeRenderPlacementConstants(source, "fill")).toEqual({});
  });

  it("recognizes declarations with WGSL comments between tokens", () => {
    expect(
      nativeRenderPlacementConstants(
        "override /* placement */ NATIVE_GENERATED_FILL\n : bool = false;",
        "fill",
      ),
    ).toEqual({ NATIVE_GENERATED_FILL: 1 });
  });

  it("caches distinct placement specializations while sharing identical ones", async () => {
    const cache = new NativePipelineCache<object>();
    let compilations = 0;
    const get = (placement: "fill" | "layer" | "backdrop") => {
      const constants = nativeRenderPlacementConstants(declaration, placement);
      return cache.getOrCreate(JSON.stringify(constants), async () => ({
        compilation: ++compilations,
      }));
    };
    const fill = await get("fill");
    const layer = await get("layer");
    expect(fill).not.toBe(layer);
    expect(await get("fill")).toBe(fill);
    expect(await get("backdrop")).toBe(layer);
    expect(compilations).toBe(2);
  });
});
