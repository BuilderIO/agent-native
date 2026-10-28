import { describe, expect, it } from "vitest";

import {
  buildNeededLayerModels,
  LAYER_MODEL_SYNC_CHARS,
} from "./layer-model-coverage";

const files = ["a", "b", "c"].map((id) => ({ id }));

function build(options: {
  needed: string[];
  chars: number;
  namesUnbuiltLayer?: boolean;
}) {
  const built: string[] = [];
  const models = buildNeededLayerModels({
    files,
    isNeeded: (fileId) => options.needed.includes(fileId),
    contentLength: () => options.chars,
    buildModel: (file) => {
      built.push(file.id);
      return file.id;
    },
    namesUnbuiltLayer: () => options.namesUnbuiltLayer ?? false,
  });
  return { models, built };
}

describe("buildNeededLayerModels", () => {
  it("builds only the needed screens of a large design", () => {
    const { models, built } = build({
      needed: ["b"],
      chars: LAYER_MODEL_SYNC_CHARS,
    });
    expect(models).toEqual(["b"]);
    expect(built).toEqual(["b"]);
  });

  it("builds every screen when the rest fits the synchronous budget", () => {
    expect(
      build({ needed: ["b"], chars: LAYER_MODEL_SYNC_CHARS / 2 }).models,
    ).toEqual(["a", "b", "c"]);
  });

  it("builds every screen when a selection names an unbuilt layer", () => {
    expect(
      build({
        needed: ["b"],
        chars: LAYER_MODEL_SYNC_CHARS,
        namesUnbuiltLayer: true,
      }).models,
    ).toEqual(["a", "b", "c"]);
  });
});
