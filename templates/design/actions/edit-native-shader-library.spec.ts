import { beforeEach, describe, expect, it, vi } from "vitest";

import { GRAIN_GRADIENT_EFFECT } from "../shared/native-effect-presets.js";
import { applyNativeEffectToHtml } from "../shared/native-effects.js";

const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  resolveSourceWorkspace: vi.fn(),
  loadSelectedSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.email,
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  loadSelectedSourceWorkspaceFile: mocks.loadSelectedSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
}));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: () => ({ select: mocks.select, insert: mocks.insert }),
}));

import action from "./edit-native-shader-library.js";

const html = applyNativeEffectToHtml(
  '<html><body><div data-agent-native-node-id="hero"></div></body></html>',
  {
    nodeId: "hero",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
  },
).html;

const register = {
  operation: {
    kind: "register" as const,
    designId: "design-1",
    fileId: "file-1",
    expectedVersionHash: "hash-1",
    instanceId: "missing",
    name: "Reusable grain",
  },
};

describe("edit-native-shader-library", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.email.mockReturnValue("Maker@Example.test");
    mocks.resolveSourceWorkspace.mockResolvedValue({
      sourceType: "inline",
      canEdit: true,
      files: [{ id: "file-1", filename: "index.html", fileType: "html" }],
    });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      id: "file-1",
      filename: "index.html",
      fileType: "html",
      content: html,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: html,
      versionHash: "hash-1",
    });
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });
    mocks.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("requires a signed-in editor and a fresh source version before registration", async () => {
    expect(action.requiresAuth).toBe(true);
    mocks.readLiveSourceFile.mockResolvedValueOnce({
      content: html,
      versionHash: "newer",
    });
    await expect(action.run(register)).rejects.toThrow("Design source changed");
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.resolveSourceWorkspace.mockResolvedValueOnce({
      sourceType: "inline",
      canEdit: false,
      files: [],
    });
    await expect(action.run(register)).rejects.toThrow("editor access");
  });

  it("stores a validated pinned definition and preset without granting execution approval", async () => {
    const parsed = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(html);
    const instanceId = parsed.document?.instances[0].id;
    expect(instanceId).toBeTruthy();
    const result = await action.run({
      operation: { ...register.operation, instanceId: instanceId! },
    });
    expect(result).toMatchObject({
      itemKey: expect.stringMatching(/^library:/),
      sourceVersionHash: "hash-1",
      executionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const saved = mocks.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(saved).toMatchObject({
      ownerEmail: "maker@example.test",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      kind: "generator",
      presetPlacement: "fill",
    });
    expect(saved).not.toHaveProperty("thumbnailHandle");
    expect(JSON.parse(saved.presetJson)).toMatchObject({
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      placement: "fill",
      provenance: { origin: "user-authored" },
    });
  });

  it("persists favorite and recent activity for an exact known built-in version", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    mocks.insert.mockReturnValue({ values });
    const itemKey = `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`;
    const favorite = await action.run({
      operation: { kind: "favorite", itemKey, favorite: true },
    });
    const recent = await action.run({
      operation: { kind: "mark-used", itemKey },
    });
    expect(favorite).toMatchObject({ itemKey, favorite: true });
    expect(recent).toMatchObject({ itemKey, lastUsedAt: expect.any(String) });
    expect(values).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "maker@example.test",
        itemKey,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
