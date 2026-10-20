import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  html: '<html><body><div data-agent-native-node-id="node"></div></body></html>',
  version: "v1",
  approvals: null as Record<string, unknown> | null,
  canEdit: true,
  cas: true,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => state.approvals),
  compareAndSetAppState: vi.fn(async (_key, _prior, next) => {
    if (!state.cas) return false;
    state.approvals = next;
    return true;
  }),
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: vi.fn(),
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: vi.fn(async () => ({
    sourceType: "inline",
    canEdit: state.canEdit,
    files: [
      { id: "file", filename: "scene.html", fileType: "html", updatedAt: null },
    ],
  })),
  loadSelectedSourceWorkspaceFile: vi.fn(async (file) => file),
  readLiveSourceFile: vi.fn(async () => ({
    content: state.html,
    versionHash: state.version,
  })),
  writeInlineSourceFile: vi.fn(async ({ content }) => {
    state.html = content;
    state.version += "x";
    return {
      content,
      changed: true,
      versionHash: state.version,
      updatedAt: null,
    };
  }),
  SourceWorkspaceEditConflictError: class extends Error {},
}));
import { readAppState } from "@agent-native/core/application-state";

import { catalogShader } from "../shared/native-effect-catalog-kit";
import { NATIVE_EFFECT_BUILTIN_VERSIONS } from "../shared/native-effect-presets";
import { hashEffectDefinition } from "../shared/native-effect-trust";
import {
  parseEffectsFromHtml,
  writeEffectsToHtml,
} from "../shared/native-effects";
import {
  defaultNativeIntrinsicSourceSizing,
  isNativeSourceSizing,
} from "../shared/native-source-sizing";
import editShader from "./edit-native-shader";

const custom = catalogShader({
  id: "user-gradient",
  name: "User gradient",
  kind: "generator",
  properties: {},
  fragment: () => "return vec4f(0.2, 0.3, 0.4, 1.0);",
});
function run(operation: unknown, expectedVersionHash = state.version) {
  return editShader.run(
    {
      designId: "design",
      fileId: "file",
      expectedVersionHash,
      operation,
    } as never,
    {} as never,
  );
}
async function approve(definition = custom) {
  return run({
    kind: "approve-definition",
    definitionId: definition.id,
    definitionVersion: definition.version,
    expectedExecutionHash: await hashEffectDefinition(definition),
  });
}
beforeEach(() => {
  state.html =
    '<html><body><div data-agent-native-node-id="node"></div></body></html>';
  state.version = "v1";
  state.approvals = null;
  state.canEdit = true;
  state.cas = true;
});

describe("custom native shader action lifecycle", () => {
  it("advertises the same bounded source sizing accepted by the renderer", () => {
    const defaultSizing = defaultNativeIntrinsicSourceSizing(100, 50);
    expect(defaultSizing.ok).toBe(true);
    if (!defaultSizing.ok) return;
    const valid = defaultSizing.value;
    const cases: unknown[] = [
      valid,
      { ...valid, aspectRatio: 0 },
      { ...valid, worldSize: [0, 16_385] },
      { ...valid, offset: [0, 2] },
      { ...valid, sampling: { ...valid.sampling, min: "cubic" } },
      { ...valid, unexpected: true },
    ];
    const schema = editShader.schema as unknown as {
      safeParse(value: unknown): { success: boolean };
    };
    for (const sourceSizing of cases) {
      const accepted = schema.safeParse({
        designId: "design",
        fileId: "file",
        expectedVersionHash: "v1",
        operation: {
          kind: "apply",
          nodeId: "node",
          placement: "fill",
          definitionId: "user-gradient",
          definitionVersion: 1,
          sourceSizing,
        },
      }).success;
      expect(accepted).toBe(isNativeSourceSizing(sourceSizing));
    }
  });

  it("stages, approves, applies and revises exact custom versions", async () => {
    await run({ kind: "define-definition", definition: custom });
    expect(parseEffectsFromHtml(state.html).document?.instances).toEqual([]);
    await expect(
      run({
        kind: "apply",
        nodeId: "node",
        placement: "fill",
        definitionId: custom.id,
        definitionVersion: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_definition_unapproved",
    });
    const approval = await approve();
    expect(approval).toMatchObject({
      approvedDefinitionHashes: [await hashEffectDefinition(custom)],
    });
    await run({
      kind: "apply",
      nodeId: "node",
      placement: "fill",
      definitionId: custom.id,
      definitionVersion: 1,
    });
    const instanceId = parseEffectsFromHtml(state.html).document!.instances[0]!
      .id;
    const revised = { ...custom, version: 2 };
    await run({ kind: "define-definition", definition: revised });
    await expect(
      run({
        kind: "revise-definition",
        definition: revised,
        fromVersion: 1,
        instanceIds: [instanceId],
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_definition_unapproved",
    });
    await approve(revised);
    await run({
      kind: "revise-definition",
      definition: revised,
      fromVersion: 1,
      instanceIds: [instanceId],
    });
    expect(
      parseEffectsFromHtml(state.html).document!.instances[0],
    ).toMatchObject({ id: instanceId, definitionVersion: 2 });
  });
  it("loads custom approvals once for a batch while built-ins do not depend on that state", async () => {
    state.html =
      '<html><body><div data-agent-native-node-id="node"></div><div data-agent-native-node-id="other"></div></body></html>';
    await run({ kind: "define-definition", definition: custom });
    await approve();
    vi.mocked(readAppState).mockClear();
    await run({
      kind: "apply-many",
      nodeIds: ["node", "other"],
      placement: "fill",
      definitionId: custom.id,
      definitionVersion: 1,
    });
    expect(readAppState).toHaveBeenCalledTimes(1);
    state.approvals = { schemaVersion: 1, hashes: "corrupt" };
    vi.mocked(readAppState).mockClear();
    const builtin = NATIVE_EFFECT_BUILTIN_VERSIONS[0]!;
    await run({
      kind: "apply",
      nodeId: "node",
      placement: builtin.placements[0],
      definitionId: builtin.id,
      definitionVersion: builtin.version,
    });
    expect(readAppState).not.toHaveBeenCalled();
  });
  it("rejects stale source and stale execution hashes without granting approval", async () => {
    state.html = writeEffectsToHtml(state.html, {
      schemaVersion: 2,
      definitions: [custom],
      instances: [],
    });
    await expect(
      run({
        kind: "approve-definition",
        definitionId: custom.id,
        definitionVersion: 1,
        expectedExecutionHash: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ errorCode: "native_effect_stale_definition" });
    await expect(
      run(
        {
          kind: "approve-definition",
          definitionId: custom.id,
          definitionVersion: 1,
          expectedExecutionHash: await hashEffectDefinition(custom),
        },
        "stale",
      ),
    ).rejects.toMatchObject({ errorCode: "native_effect_stale_source" });
    expect(state.approvals).toBeNull();
  });
  it("preserves built-in identity and validates custom definitions before writing", async () => {
    const builtin = NATIVE_EFFECT_BUILTIN_VERSIONS[0]!;
    await expect(
      run({
        kind: "define-definition",
        definition: { ...custom, id: builtin.id },
      }),
    ).rejects.toMatchObject({ errorCode: "native_effect_catalog_conflict" });
    await expect(
      run({
        kind: "define-definition",
        definition: { ...custom, version: -1 },
      }),
    ).rejects.toMatchObject({ errorCode: "native_effect_validation_failed" });
    expect(parseEffectsFromHtml(state.html).document).toBeNull();
  });
  it("enforces approval capacity and unreadable state without replacing it", async () => {
    await run({ kind: "define-definition", definition: custom });
    state.approvals = {
      schemaVersion: 1,
      hashes: Array.from({ length: 512 }, (_, index) =>
        index.toString(16).padStart(64, "0"),
      ),
    };
    const prior = state.approvals;
    await expect(approve()).rejects.toMatchObject({
      errorCode: "native_effect_approvals_full",
    });
    expect(state.approvals).toBe(prior);
    state.approvals = { schemaVersion: 1, hashes: "unreadable" };
    await expect(approve()).rejects.toMatchObject({
      errorCode: "native_effect_approvals_unreadable",
    });
    await expect(
      run({
        kind: "apply",
        nodeId: "node",
        placement: "fill",
        definitionId: custom.id,
        definitionVersion: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_approvals_unreadable",
    });
  });
  it("revokes custom execution permission without changing the staged source", async () => {
    await run({ kind: "define-definition", definition: custom });
    await approve();
    const source = state.html;
    await run({
      kind: "revoke-definition",
      executionHash: await hashEffectDefinition(custom),
    });
    expect(state.html).toBe(source);
    await expect(
      run({
        kind: "apply",
        nodeId: "node",
        placement: "fill",
        definitionId: custom.id,
        definitionVersion: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_definition_unapproved",
    });
  });
  it("keeps source edit access and approval compare-and-set guards", async () => {
    state.canEdit = false;
    await expect(
      run({ kind: "define-definition", definition: custom }),
    ).rejects.toMatchObject({ errorCode: "native_effect_not_editable" });
    state.canEdit = true;
    state.html = writeEffectsToHtml(state.html, {
      schemaVersion: 2,
      definitions: [custom],
      instances: [],
    });
    state.cas = false;
    await expect(approve()).rejects.toMatchObject({
      errorCode: "native_effect_approvals_stale",
    });
    expect(state.approvals).toBeNull();
  });
});
