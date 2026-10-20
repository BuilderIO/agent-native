import { describe, expect, it } from "vitest";

import { catalogShader } from "./native-effect-catalog-kit";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  hashEffectDefinition,
  nativeSceneExecutableHashes,
  nativeDefinitionAuthorizationError,
} from "./native-effect-trust";
import { parseEffectsFromHtml, type EffectDocument } from "./native-effects";

const custom = catalogShader({
  id: "user-waves",
  name: "User waves",
  kind: "generator",
  properties: {},
  fragment: () => "return vec4f(0.2, 0.3, 0.4, 1.0);",
});
const scene = (definition: typeof custom): EffectDocument => ({
  schemaVersion: 2 as const,
  definitions: [definition],
  instances: [
    {
      id: "effect",
      nodeId: "node",
      definitionId: definition.id,
      definitionVersion: definition.version,
      placement: "fill" as const,
      enabled: true,
      opacity: 1,
      seed: 0,
      clip: "bounds",
      blend: "normal",
      timing: { speed: 1, paused: false, time: 0 },
      params: {},
    },
  ],
});

describe("custom native scene approvals", () => {
  it("requires the exact approved custom execution hash", async () => {
    const hash = await hashEffectDefinition(custom);
    await expect(
      nativeSceneExecutableHashes(scene(custom), [], []),
    ).rejects.toMatchObject({ code: "unapproved" });
    await expect(
      nativeSceneExecutableHashes(scene(custom), [hash], []),
    ).resolves.toEqual([hash]);
    const changed = { ...custom, version: custom.version + 1 };
    await expect(
      nativeSceneExecutableHashes(scene(changed), [hash], []),
    ).rejects.toMatchObject({ code: "unapproved" });
  });
  it("cannot approve rewritten built-in identities or invented built-in versions", async () => {
    for (const changed of [
      {
        ...custom,
        passes: custom.passes.map((pass) => ({
          ...pass,
          wgsl: pass.wgsl + "\n",
        })),
      },
      { ...custom, version: custom.version + 1 },
    ]) {
      const hash = await hashEffectDefinition(changed);
      await expect(
        nativeSceneExecutableHashes(scene(changed), [hash], [custom]),
      ).rejects.toMatchObject({ code: "catalog-conflict" });
    }
  });
});

describe("custom native definition drafts", () => {
  it("stores a validated definition without enabling any effect", () => {
    const result = editNativeEffectHtml("<html><body></body></html>", {
      kind: "define-definition",
      definition: custom,
    });
    expect(result.errors).toEqual([]);
    const document = parseEffectsFromHtml(result.html).document;
    expect(document?.definitions).toEqual([custom]);
    expect(document?.instances).toEqual([]);
  });
  it("rejects invalid and conflicting definitions without changing source", () => {
    const html = "<html><body></body></html>";
    const invalid = editNativeEffectHtml(html, {
      kind: "define-definition",
      definition: { ...custom, version: -1 },
    });
    expect(invalid.errors.length).toBeGreaterThan(0);
    expect(invalid.html).toBe(html);
    const draft = editNativeEffectHtml(html, {
      kind: "define-definition",
      definition: custom,
    });
    const conflict = editNativeEffectHtml(draft.html, {
      kind: "define-definition",
      definition: { ...custom, name: "Different" },
    });
    expect(conflict.errors.length).toBeGreaterThan(0);
    expect(conflict.html).toBe(draft.html);
  });
});

describe("runtime definition authorization boundary", () => {
  it.each(["pending", "unreadable"] as const)(
    "reports %s approvals separately from an unapproved hash",
    (approvalStatus) => {
      const input = {
        definitionId: "user-effect",
        executionHash: "custom-hash",
        builtinIds: new Set(["builtin-effect"]),
        builtinHashes: new Set(["builtin-hash"]),
        approvedHashes: new Set(["custom-hash"]),
        approvalStatus,
      };
      expect(nativeDefinitionAuthorizationError(input)).toBe(
        `approvals-${approvalStatus}`,
      );
      expect(
        nativeDefinitionAuthorizationError({
          ...input,
          executionHash: "builtin-hash",
        }),
      ).toBeNull();
      expect(
        nativeDefinitionAuthorizationError({
          ...input,
          definitionId: "builtin-effect",
        }),
      ).toBe("catalog-conflict");
    },
  );

  it("permits approved custom hashes while reserving every built-in identity", () => {
    const input = {
      definitionId: "user-effect",
      executionHash: "custom-hash",
      builtinIds: new Set(["builtin-effect"]),
      builtinHashes: new Set(["builtin-hash"]),
      approvedHashes: new Set<string>(),
      approvalStatus: "ready" as const,
    };
    expect(nativeDefinitionAuthorizationError(input)).toBe("unapproved");
    input.approvedHashes.add("custom-hash");
    expect(nativeDefinitionAuthorizationError(input)).toBeNull();
    expect(
      nativeDefinitionAuthorizationError({
        ...input,
        definitionId: "builtin-effect",
      }),
    ).toBe("catalog-conflict");
    expect(
      nativeDefinitionAuthorizationError({
        ...input,
        definitionId: "builtin-effect",
        executionHash: "builtin-hash",
        approvedHashes: new Set(),
      }),
    ).toBeNull();
    expect(
      nativeDefinitionAuthorizationError({
        ...input,
        executionHash: "changed-hash",
      }),
    ).toBe("unapproved");
  });
});
