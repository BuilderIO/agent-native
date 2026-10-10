import { parse, type DefaultTreeAdapterMap } from "parse5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OWNED_CURRENT_IMAGE_SOURCE_TEST_EFFECT } from "../shared/native-current-image-source.test-fixture.js";
import { editNativeEffectHtml } from "../shared/native-effect-edits.js";
import { OWNED_INTRINSIC_IMAGE_TEST_EFFECT } from "../shared/native-effect-owned-source-test-fixtures.js";
import { GRAIN_GRADIENT_EFFECT } from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import { parseEffectsFromHtml } from "../shared/native-effects.js";
import { defaultNativeIntrinsicSourceSizing } from "../shared/native-source-sizing.js";

const mocks = vi.hoisted(() => ({
  resolveSourceWorkspace: vi.fn(),
  loadSelectedSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
  writeInlineSourceFile: vi.fn(),
  snapshotDesignBeforeAgentEdit: vi.fn(),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  compareAndSetAppState: mocks.compareAndSetAppState,
}));

vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  loadSelectedSourceWorkspaceFile: mocks.loadSelectedSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
  SourceWorkspaceEditConflictError: class extends Error {},
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

import action from "./edit-native-shader.js";

const html =
  '<html><body><div data-agent-native-node-id="hero">Editable</div></body></html>';
const file = {
  id: "file-1",
  filename: "index.html",
  fileType: "html",
  updatedAt: "2026-10-06",
};

describe("edit-native-shader", () => {
  it("keeps account-backed authentication mandatory", () => {
    expect(action.requiresAuth).toBe(true);
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      canEdit: true,
      files: [file],
    });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      ...file,
      designId: "design-1",
      content: html,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: html,
      versionHash: "hash-1",
      language: "html",
      source: "stored",
    });
    mocks.snapshotDesignBeforeAgentEdit.mockResolvedValue(undefined);
    mocks.readAppState.mockResolvedValue(null);
    mocks.compareAndSetAppState.mockResolvedValue(true);
    mocks.writeInlineSourceFile.mockResolvedValue({
      changed: true,
      versionHash: "hash-2",
      updatedAt: "2026-10-07",
    });
  });

  it("approves only the exact CPU-validated source hash through user-scoped CAS", async () => {
    const applied = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 2,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html,
      versionHash: "hash-1",
    });
    const executionHash = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
    const result = await action.run({
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "approve-definition",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: 2,
        expectedExecutionHash: executionHash,
      },
    });
    expect(result.approvedDefinitionHashes).toEqual([executionHash]);
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "design-native-effect-approvals:design-1",
      null,
      { schemaVersion: 1, hashes: [executionHash] },
    );
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    await expect(
      action.run({
        designId: "design-1",
        fileId: "file-1",
        expectedVersionHash: "hash-1",
        operation: {
          kind: "approve-definition",
          definitionId: GRAIN_GRADIENT_EFFECT.id,
          definitionVersion: 2,
          expectedExecutionHash: "a".repeat(64),
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_execution_hash_mismatch",
    });
  });

  it("surfaces malformed approval state and a concurrent approval change", async () => {
    const applied = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 2,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html,
      versionHash: "hash-1",
    });
    const input = {
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "approve-definition" as const,
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: 2,
        expectedExecutionHash: await hashEffectDefinition(
          GRAIN_GRADIENT_EFFECT,
        ),
      },
    };
    mocks.readAppState.mockResolvedValueOnce({
      schemaVersion: 1,
      hashes: "corrupt",
    });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "native_effect_approvals_unreadable",
      statusCode: 422,
    });
    mocks.compareAndSetAppState.mockResolvedValueOnce(false);
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "native_effect_approvals_stale",
      statusCode: 409,
    });
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("lets a view-only signed-in reader approve their own hash but not edit source", async () => {
    const applied = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 2,
    });
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      canEdit: false,
      files: [file],
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html,
      versionHash: "hash-1",
    });
    const executionHash = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
    const approved = await action.run({
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "approve-definition",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: 2,
        expectedExecutionHash: executionHash,
      },
    });
    expect(approved.approvedDefinitionHashes).toEqual([executionHash]);
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    await expect(
      action.run({
        designId: "design-1",
        fileId: "file-1",
        expectedVersionHash: "hash-1",
        operation: {
          kind: "set-params",
          instanceId: "any",
          params: { grain: 0.2 },
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_not_editable",
      statusCode: 403,
    });
  });

  it("returns a typed stale conflict before snapshot or write", async () => {
    await expect(
      action.run({
        designId: "design-1",
        fileId: "file-1",
        expectedVersionHash: "outdated",
        operation: {
          kind: "apply",
          nodeId: "hero",
          placement: "fill",
          definitionId: GRAIN_GRADIENT_EFFECT.id,
          definitionVersion: 2,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_stale_source",
      statusCode: 409,
    });
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("writes an applied effect through source CAS and returns host sync data", async () => {
    const result = await action.run({
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: 2,
      },
    });
    expect(result).toMatchObject({
      fileId: "file-1",
      changed: true,
      versionHash: "hash-2",
      nodeIds: ["hero"],
      validation: { cpuSchemaAndGraph: "passed", gpuCompiled: false },
    });
    expect(result.instanceIds).toHaveLength(1);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersionHash: "hash-1",
        content: expect.stringContaining("application/x-agent-native-effects"),
      }),
    );
    expect(mocks.resolveSourceWorkspace).toHaveBeenCalledWith("design-1", {
      includeContent: false,
      includeBoard: true,
    });
    expect(mocks.loadSelectedSourceWorkspaceFile).toHaveBeenCalledWith(file);
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
  });

  it("commits a multi-target apply as one source version and one snapshot", async () => {
    const content =
      '<html><body><div data-agent-native-node-id="hero"></div><div data-agent-native-node-id="second"></div></body></html>';
    mocks.readLiveSourceFile.mockResolvedValue({
      content,
      versionHash: "hash-1",
    });
    const result = await action.run({
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "apply-many",
        nodeIds: ["hero", "second"],
        placement: "fill",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      },
    });
    expect(result.nodeIds).toEqual(["hero", "second"]);
    expect(result.instanceIds).toHaveLength(2);
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
  });

  it("preserves distinct authored image sizing through the current source ABI and commits one source version", async () => {
    const content =
      '<html><body><img data-agent-native-node-id="hero" width="600" height="200" style="object-fit:contain"><img data-agent-native-node-id="second" width="200" height="500" style="object-fit:cover"></body></html>';
    mocks.readLiveSourceFile.mockResolvedValue({
      content,
      versionHash: "hash-1",
    });
    const input = action.schema.parse({
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "apply-many",
        nodeIds: ["hero", "second"],
        placement: "layer",
        definition: OWNED_CURRENT_IMAGE_SOURCE_TEST_EFFECT,
      },
    });
    const result = await action.run(input);
    expect(result.nodeIds).toEqual(["hero", "second"]);
    expect(result.instanceIds).toHaveLength(2);
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
    const written = mocks.writeInlineSourceFile.mock.calls[0]?.[0];
    const dimensions = new Map<
      string,
      { width: number; height: number; style: string }
    >();
    const visit = (node: DefaultTreeAdapterMap["node"]): void => {
      if ("attrs" in node && node.tagName === "img") {
        const attrs = Object.fromEntries(
          node.attrs.map((attr) => [attr.name, attr.value]),
        );
        dimensions.set(attrs["data-agent-native-node-id"]!, {
          width: Number(attrs.width),
          height: Number(attrs.height),
          style: attrs.style!,
        });
      }
      if ("childNodes" in node)
        for (const child of node.childNodes) visit(child);
    };
    visit(parse(written.content));
    expect(dimensions.get("hero")).toEqual({
      width: 600,
      height: 200,
      style: "object-fit:contain",
    });
    expect(dimensions.get("second")).toEqual({
      width: 200,
      height: 500,
      style: "object-fit:cover",
    });
    expect(
      [...dimensions.values()].map(({ width, height }) => width / height),
    ).toEqual([3, 0.4]);
    const instances = parseEffectsFromHtml(written.content).document!.instances;
    expect(instances.map(({ nodeId }) => nodeId)).toEqual(["hero", "second"]);
    expect(
      instances.every(({ sourceSizing }) => sourceSizing === undefined),
    ).toBe(true);
  });

  it("retains explicit rejection of new retired per-image sizing without a source version write", async () => {
    const content =
      '<html><body><img data-agent-native-node-id="hero"><img data-agent-native-node-id="second"></body></html>';
    const first = defaultNativeIntrinsicSourceSizing(600, 200);
    const second = defaultNativeIntrinsicSourceSizing(200, 500);
    if (!first.ok || !second.ok) throw new Error("fixture sizing failed");
    mocks.readLiveSourceFile.mockResolvedValue({
      content,
      versionHash: "hash-1",
    });
    const input = action.schema.parse({
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "apply-many",
        nodeIds: ["hero", "second"],
        placement: "layer",
        definition: OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
        sourceSizingByNodeId: { hero: first.value, second: second.value },
      },
    });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "native_effect_validation_failed",
      details: { errors: ["legacy-image-abi-retired"] },
    });
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("does not create a snapshot or write when the validated edit is unchanged", async () => {
    const applied = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 2,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html,
      versionHash: "hash-1",
      language: "html",
      source: "stored",
    });
    const result = await action.run({
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
      operation: {
        kind: "set-instance",
        instanceId: applied.instanceIds[0],
        enabled: true,
      },
    });
    expect(result.changed).toBe(false);
    expect(result.versionHash).toBe("hash-1");
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("keeps implicit Auto/60 source untouched and commits a preview policy in one versioned snapshot", async () => {
    const applied = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html,
      versionHash: "hash-1",
    });
    const base = {
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "hash-1",
    };
    const unchanged = await action.run({
      ...base,
      operation: {
        kind: "set-preview",
        preview: { quality: "auto", frameRateTarget: 60 },
      },
    });
    expect(unchanged.changed).toBe(false);
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    const changed = await action.run({
      ...base,
      operation: {
        kind: "set-preview",
        preview: {
          quality: "quality",
          frameRateTarget: 120,
          colorMode: "display-p3",
          dynamicRange: "hdr",
        },
      },
    });
    expect(changed.changed).toBe(true);
    expect(changed.content).toContain('"frameRateTarget":120');
    expect(changed.content).toContain('"colorMode":"display-p3"');
    expect(changed.content).toContain('"dynamicRange":"hdr"');
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
  });

  it("returns typed validation errors for an invalid node", async () => {
    await expect(
      action.run({
        designId: "design-1",
        fileId: "file-1",
        expectedVersionHash: "hash-1",
        operation: {
          kind: "apply",
          nodeId: "missing",
          placement: "fill",
          definitionId: GRAIN_GRADIENT_EFFECT.id,
          definitionVersion: 2,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_validation_failed",
      statusCode: 422,
    });
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });
});
