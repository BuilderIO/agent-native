import { beforeEach, describe, expect, it, vi } from "vitest";

import { editNativeEffectHtml } from "../shared/native-effect-edits.js";
import { GRAIN_GRADIENT_EFFECT } from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import { parseEffectsFromHtml } from "../shared/native-effects.js";

const mocks = vi.hoisted(() => ({
  state: null as Record<string, unknown> | null,
  content: "",
  versionHash: "v1",
  canEdit: true,
  payload: "",
  minted: vi.fn(),
  deleted: vi.fn(),
  compareAndSetAppState: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  getCurrentRequestBrowserTabId: () => "tab-1",
  readAppState: async () => mocks.state,
  compareAndSetAppState: mocks.compareAndSetAppState,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "editor@example.test",
}));
vi.mock("@agent-native/core/private-blob", () => ({
  mintAttachmentRef: mocks.minted,
  resolveAttachment: async () => ({
    status: "ok",
    file: { data: Buffer.from(mocks.payload), mimeType: "application/json" },
  }),
  deleteAttachment: mocks.deleted,
}));
vi.mock("./_native-local-export-server.js", () => ({
  requireNativeLocalExportTabId: () => "tab-1",
  assertNativeLocalExportEditor: async () => undefined,
}));
vi.mock("./_native-render-contexts.js", () => ({
  resolveNativeRenderContextTarget: async () => "tab-1",
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: async () => ({
    sourceType: "inline",
    canEdit: mocks.canEdit,
    files: [{ id: "screen-1", fileType: "html" }],
  }),
  loadSelectedSourceWorkspaceFile: async (file: unknown) => file,
  readLiveSourceFile: async () => ({
    content: mocks.content,
    versionHash: mocks.versionHash,
  }),
}));

import action from "./native-shader-draft-foreground.js";

describe("private native shader draft action", () => {
  beforeEach(() => {
    mocks.content = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      },
    ).html;
    mocks.state = null;
    mocks.versionHash = "v1";
    mocks.canEdit = true;
    mocks.minted
      .mockReset()
      .mockImplementation(async ({ data }: { data: Uint8Array }) => {
        mocks.payload = Buffer.from(data).toString("utf8");
        return { status: "ok", ref: "attachment:opaque" };
      });
    mocks.deleted
      .mockReset()
      .mockResolvedValue({ status: "ok", deleted: true });
    mocks.compareAndSetAppState
      .mockReset()
      .mockImplementation(async (_key, prior, next) => {
        if (JSON.stringify(prior) !== JSON.stringify(mocks.state)) return false;
        mocks.state = next;
        return true;
      });
  });
  async function requestDraft() {
    const instance = parseEffectsFromHtml(mocks.content).document!.instances[0];
    const definition = {
      ...GRAIN_GRADIENT_EFFECT,
      version: GRAIN_GRADIENT_EFFECT.version + 1,
    };
    return action.run({
      kind: "request",
      designId: "design-1",
      fileId: "screen-1",
      nodeId: "hero",
      instanceId: instance.id,
      expectedVersionHash: "v1",
      baseExecutionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      command: "preview",
      draftDefinition: definition,
      params: {},
      seed: 77,
      time: 1,
    });
  }
  it("stores only an opaque scoped attachment ref, then returns located results without WGSL", async () => {
    const queued = await requestDraft();
    expect(queued).toMatchObject({
      status: "pending",
      draftExecutionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(mocks.state)).not.toContain("@fragment");
    expect(JSON.stringify(queued)).not.toContain("attachment:opaque");
    const claimed = await action.run({
      kind: "claim",
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(claimed.status).toBe("running");
    const opened = await action.run({
      kind: "open",
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(opened.payload).toMatchObject({ seed: 77, time: 1 });
    const finished = await action.run({
      kind: "finish",
      designId: "design-1",
      requestId: queued.requestId,
      result: {
        status: "last-good",
        displayed: "draft-last-good",
        diagnostics: [
          {
            code: "wgsl",
            message: "compile-failed",
            severity: "error",
            passId: "grain",
            line: 2,
            column: 61,
          },
        ],
      },
    });
    expect(finished.result?.diagnostics[0]).toMatchObject({
      line: 2,
      column: 61,
    });
    expect(mocks.deleted).toHaveBeenCalledOnce();
  });
  it("rejects a stale live source before storing private WGSL", async () => {
    mocks.versionHash = "v2";
    await expect(requestDraft()).rejects.toThrow();
    expect(mocks.minted).not.toHaveBeenCalled();
  });
  it("rejects changed private attachment bytes before exposing WGSL to the editor", async () => {
    const queued = await requestDraft();
    await action.run({
      kind: "claim",
      designId: "design-1",
      requestId: queued.requestId,
    });
    mocks.payload = mocks.payload.replace("@fragment", "@vertex");
    await expect(
      action.run({
        kind: "open",
        designId: "design-1",
        requestId: queued.requestId,
      }),
    ).rejects.toThrow();
  });
  it("rechecks editor access at claim after a role change", async () => {
    const queued = await requestDraft();
    mocks.canEdit = false;
    await expect(
      action.run({
        kind: "claim",
        designId: "design-1",
        requestId: queued.requestId,
      }),
    ).rejects.toThrow();
    expect(mocks.state).toMatchObject({ status: "pending" });
  });
  it("keeps a running cancellation pending until the editor acknowledges a clear", async () => {
    const queued = await requestDraft();
    await action.run({
      kind: "claim",
      designId: "design-1",
      requestId: queued.requestId,
    });
    const pending = await action.run({
      kind: "cancel",
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(pending.status).toBe("cancel-requested");
    expect(mocks.deleted).not.toHaveBeenCalled();
    expect(
      (
        await action.run({
          kind: "cancel",
          designId: "design-1",
          requestId: queued.requestId,
        })
      ).status,
    ).toBe("cancel-requested");
    const canceled = await action.run({
      kind: "cancel-complete",
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(canceled.status).toBe("canceled");
    expect(mocks.deleted).toHaveBeenCalledOnce();
  });
});
