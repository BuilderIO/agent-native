import { GRAIN_GRADIENT_EFFECT } from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { describe, expect, it } from "vitest";

import {
  bundledNativeEffectApproval,
  readNativeEffectApprovalReview,
} from "./NativeEffectApproval";

describe("native shader source review", () => {
  const source = {
    designId: "design-1",
    fileId: "file-1",
    versionHash: "source-hash",
    selectedDefinition: GRAIN_GRADIENT_EFFECT,
    approvedDefinitionHashes: [],
  };

  it("does not request approval for the exact bundled definition", async () => {
    expect(
      await bundledNativeEffectApproval(GRAIN_GRADIENT_EFFECT),
    ).toMatchObject({
      status: "builtin",
    });
    expect(
      await readNativeEffectApprovalReview(
        source,
        "design-1",
        "file-1",
        GRAIN_GRADIENT_EFFECT.id,
        GRAIN_GRADIENT_EFFECT.version,
      ),
    ).toMatchObject({ status: "builtin" });
  });

  it("does not trust an authored built-in ID after its executable source changes", async () => {
    expect(
      await bundledNativeEffectApproval({
        ...GRAIN_GRADIENT_EFFECT,
        passes: [
          {
            ...GRAIN_GRADIENT_EFFECT.passes[0],
            wgsl: `${GRAIN_GRADIENT_EFFECT.passes[0].wgsl}\n// changed`,
          },
        ],
      }),
    ).toBeNull();
  });

  it("requires review for a changed WGSL hash and displays the pinned source", async () => {
    const changed = {
      ...GRAIN_GRADIENT_EFFECT,
      passes: [
        {
          ...GRAIN_GRADIENT_EFFECT.passes[0],
          wgsl: `${GRAIN_GRADIENT_EFFECT.passes[0].wgsl}\n// custom`,
        },
      ],
    };
    const review = await readNativeEffectApprovalReview(
      { ...source, selectedDefinition: changed },
      "design-1",
      "file-1",
      changed.id,
      changed.version,
    );
    expect(review.status).toBe("review");
    if (review.status !== "review") return;
    expect(review.hash).toBe(await hashEffectDefinition(changed));
    expect(review.source).toContain("// custom");
    expect(review.versionHash).toBe("source-hash");
  });

  it("keeps unreadable source or wrong file identity distinct from approval", async () => {
    expect(
      await readNativeEffectApprovalReview(
        { ...source, fileId: "other-file" },
        "design-1",
        "file-1",
        GRAIN_GRADIENT_EFFECT.id,
        GRAIN_GRADIENT_EFFECT.version,
      ),
    ).toEqual({ status: "unreadable" });
  });
});
