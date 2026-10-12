import { describe, expect, it } from "vitest";

import { NATIVE_EFFECT_DEFINITIONS_V1 } from "./native-effect-definitions-v1";
import {
  GRAIN_GRADIENT_EFFECT,
  HALFTONE_EFFECT,
  FROSTED_REFRACTION_EFFECT,
} from "./native-effect-presets";
import {
  hashEffectDefinition,
  NativeEffectApprovalStateError,
  NativeSceneAuthorizationError,
  nativeSceneExecutableHashes,
  parseNativeEffectApprovalState,
} from "./native-effect-trust";
import type { EffectDocument } from "./native-effects";

describe("native effect execution trust", () => {
  it("keeps the six historical Design built-in execution hashes pinned", async () => {
    const entries = await Promise.all(
      [
        ...NATIVE_EFFECT_DEFINITIONS_V1,
        GRAIN_GRADIENT_EFFECT,
        HALFTONE_EFFECT,
        FROSTED_REFRACTION_EFFECT,
      ].map(
        async (definition) =>
          `${definition.id}@${definition.version}:${await hashEffectDefinition(definition)}`,
      ),
    );
    entries.sort();
    expect(entries).toHaveLength(6);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(entries.join("\n")),
    );
    expect(Buffer.from(digest).toString("hex")).toBe(
      "77b18f93d5d83b4c3a7ad6afbb140a45fa4dac28aea6c8fb313afdcd55ab88a7",
    );
  });
  it("pins executable source and ordered property packing, not provenance claims", async () => {
    const original = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await hashEffectDefinition({
        ...GRAIN_GRADIENT_EFFECT,
        provenance: { origin: "imported" },
      }),
    ).toBe(original);
    expect(
      await hashEffectDefinition({
        ...GRAIN_GRADIENT_EFFECT,
        passes: [
          {
            ...GRAIN_GRADIENT_EFFECT.passes[0],
            wgsl: GRAIN_GRADIENT_EFFECT.passes[0].wgsl + "\n// changed",
          },
        ],
      }),
    ).not.toBe(original);
    expect(
      await hashEffectDefinition({
        ...GRAIN_GRADIENT_EFFECT,
        properties: Object.fromEntries(
          Object.entries(GRAIN_GRADIENT_EFFECT.properties).reverse(),
        ),
      }),
    ).not.toBe(original);
    expect(
      await hashEffectDefinition({
        ...GRAIN_GRADIENT_EFFECT,
        extent: {
          output: { top: 8, right: 8, bottom: 8, left: 8 },
        },
      }),
    ).not.toBe(original);
    expect(
      await hashEffectDefinition({
        ...GRAIN_GRADIENT_EFFECT,
        interaction: {
          positionProperty: "pointerPosition",
          activeProperty: "pointerActive",
        },
      }),
    ).not.toBe(original);
    expect(
      await hashEffectDefinition({
        ...GRAIN_GRADIENT_EFFECT,
        sourceSizing: { uv: "paper-image" },
      }),
    ).not.toBe(original);
  });

  it("bounds persisted approvals while preserving exact hash validation", () => {
    expect(parseNativeEffectApprovalState(null).hashes).toEqual([]);
    expect(() =>
      parseNativeEffectApprovalState({ schemaVersion: 1, hashes: ["bad"] }),
    ).toThrow(NativeEffectApprovalStateError);
    const hashes = Array.from({ length: 512 }, (_, index) =>
      (index + 1).toString(16).padStart(64, "0"),
    );
    expect(
      parseNativeEffectApprovalState({ schemaVersion: 1, hashes }).hashes,
    ).toHaveLength(512);
    expect(() =>
      parseNativeEffectApprovalState({
        schemaVersion: 1,
        hashes: [...hashes, "f".repeat(64)],
      }),
    ).toThrow(NativeEffectApprovalStateError);
    expect(() =>
      parseNativeEffectApprovalState({
        schemaVersion: 1,
        hashes: ["a".repeat(64), "a".repeat(64)],
      }),
    ).toThrow(NativeEffectApprovalStateError);
  });

  it("keeps the active scene executable budget at 32", async () => {
    const definitions = Array.from({ length: 33 }, (_, index) => ({
      ...GRAIN_GRADIENT_EFFECT,
      id: `grain-gradient-${index}`,
    }));
    const documentFor = (count: number): EffectDocument => ({
      schemaVersion: 2,
      definitions: definitions.slice(0, count),
      instances: definitions.slice(0, count).map((definition, index) => ({
        id: `instance-${index}`,
        nodeId: `node-${index}`,
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement: "fill",
        params: {},
        enabled: true,
        opacity: 1,
        seed: index,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 1, paused: false, time: 0 },
      })),
    });
    const approved = await Promise.all(
      definitions.map((definition) => hashEffectDefinition(definition)),
    );
    await expect(
      nativeSceneExecutableHashes(documentFor(32), approved, []),
    ).resolves.toHaveLength(32);
    await expect(
      nativeSceneExecutableHashes(documentFor(33), approved, []),
    ).rejects.toMatchObject({
      name: "NativeSceneAuthorizationError",
      code: "limit",
    });
  });
});
