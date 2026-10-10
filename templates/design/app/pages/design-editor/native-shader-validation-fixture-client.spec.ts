import { GRAIN_GRADIENT_EFFECT } from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { describe, expect, it } from "vitest";

import type { NativeValidationResult } from "@/components/design/native-thumbnail-plan";

import {
  parsePreparedNativeValidationFixtures,
  summarizeNativeValidationPixels,
} from "./native-shader-validation-fixture-client";

const item = {
  caseId: "grainSquare",
  instanceId: "instance-1",
  nodeId: "hero",
  definitionId: "grain",
  definitionVersion: 2,
  executionHash: "a".repeat(64),
  timeSeconds: 0,
  fixture: {
    sourceKind: "generated" as const,
    aspect: "square" as const,
    alpha: "transparent" as const,
    rounded: true,
    seed: 3,
  },
};

describe("clean native GPU validation result", () => {
  it("stores only a SHA-256 and coverage count from straight-sRGB GPU bytes", async () => {
    const rgba = new Uint8Array(160 * 100 * 4);
    rgba.set([220, 31, 18, 255], 4 * (50 * 160 + 50));
    const result: NativeValidationResult = {
      id: item.caseId,
      status: "ready",
      backend: "webgpu",
      executionHash: item.executionHash,
      width: 160,
      height: 100,
      colorSpace: "srgb",
      alpha: "straight",
      rgba,
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 64_000,
      renderWallMs: 3.2,
    };
    const summarized = await summarizeNativeValidationPixels(item, result);
    expect(summarized).toMatchObject({
      status: "ready",
      pixelWidth: 160,
      pixelHeight: 100,
      nonTransparentPixels: 1,
      pixelSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(summarized)).not.toContain("rgba");
  });

  it("records zero coverage without guessing intent and enforces an explicit coverage expectation", async () => {
    const blank: NativeValidationResult = {
      id: item.caseId,
      status: "ready",
      backend: "webgpu",
      executionHash: item.executionHash,
      width: 160,
      height: 100,
      colorSpace: "srgb",
      alpha: "straight",
      rgba: new Uint8Array(160 * 100 * 4),
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 64_000,
    };
    expect(await summarizeNativeValidationPixels(item, blank)).toMatchObject({
      status: "ready",
      nonTransparentPixels: 0,
      pixelSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      await summarizeNativeValidationPixels(
        {
          ...item,
          fixture: { ...item.fixture, coverageExpectation: "nonzero" },
        },
        blank,
      ),
    ).toMatchObject({
      status: "error",
      code: "validation-coverage-mismatch",
      nonTransparentPixels: 0,
    });
    await expect(
      summarizeNativeValidationPixels(item, {
        ...blank,
        executionHash: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "fixture-result-mismatch" });
  });

  it("rejects a transient definition whose exact execution hash differs from the claimed case", async () => {
    await expect(
      parsePreparedNativeValidationFixtures(
        {
          approvedExecutionHashes: [],
          items: [
            {
              id: item.caseId,
              definition: { id: "grain", version: 2, passes: [] },
              params: {},
              seed: 3,
              sourceRevision: "v1",
              timeSeconds: 0,
              fixture: item.fixture,
            },
          ],
        },
        [item],
        "v1",
      ),
    ).rejects.toMatchObject({ code: "fixture-response-unreadable" });
  });

  it("requires a prepared placement supported by the exact claimed definition", async () => {
    const executionHash = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
    const requested = {
      ...item,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash,
    };
    const prepared = {
      approvedExecutionHashes: [],
      items: [
        {
          id: item.caseId,
          definition: GRAIN_GRADIENT_EFFECT,
          placement: "fill",
          params: {},
          seed: item.fixture.seed,
          sourceRevision: "v1",
          timeSeconds: item.timeSeconds,
          fixture: item.fixture,
        },
      ],
    };
    expect(
      (await parsePreparedNativeValidationFixtures(prepared, [requested], "v1"))
        .items[0].placement,
    ).toBe("fill");
    await expect(
      parsePreparedNativeValidationFixtures(
        {
          ...prepared,
          items: [{ ...prepared.items[0], placement: "backdrop" }],
        },
        [requested],
        "v1",
      ),
    ).rejects.toMatchObject({ code: "fixture-response-mismatch" });
  });
});
