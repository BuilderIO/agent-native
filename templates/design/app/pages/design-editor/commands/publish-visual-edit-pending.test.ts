import { describe, expect, it, vi } from "vitest";

import {
  readLocalVisualEditPendingState,
  runPublishVisualEditPending,
  shouldPublishVisualEditPending,
} from "./publish-visual-edit-pending";

function makeArgs(
  overrides: Partial<Parameters<typeof runPublishVisualEditPending>[0]> = {},
) {
  return {
    activeScreenBridgeUrl: "http://127.0.0.1:7331",
    activeScreenPreviewToken: "preview-token",
    activeScreenLiveEditCapability: "design-capability",
    callAction: vi.fn(async (_name, payload) => ({
      designId: payload.designId,
      pendingEditCount: payload.pending?.pendingEditCount ?? 0,
      revision: payload.revision,
      status: payload.pending ? "ready" : "empty",
    })),
    canPublishDurableHandoff: true,
    designId: "design-1",
    fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    pending: {
      designId: "design-1",
      publisherId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      pending: {
        designId: "design-1",
        pendingEditCount: 1,
        status: "ready" as const,
        prompt: "prompt",
      },
    },
    pendingVisualEditClearRequestedRef: { current: null },
    pendingVisualEditHadPendingRef: { current: null },
    onHandoffPublicationStatusChange: vi.fn(),
    setPendingVisualEditPublicationFailed: vi.fn(),
    showHandoffErrorToast: vi.fn(),
    ...overrides,
  };
}

describe("runPublishVisualEditPending", () => {
  it("reads the bridge revision high-water mark for a resumed publisher", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pending: null, revision: 11 }),
    });

    await expect(
      readLocalVisualEditPendingState({
        activeScreenBridgeUrl: "http://127.0.0.1:7331/",
        activeScreenPreviewToken: "preview-token",
        activeScreenLiveEditCapability: "design-capability",
        designId: "design/one",
        fetchImpl,
      }),
    ).resolves.toEqual({ revision: 11, pending: null });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:7331/live-edit-pending?designId=design%2Fone",
    );
    expect(init).toEqual({
      headers: {
        "x-design-preview-token": "preview-token",
        "x-agent-native-live-edit-capability": "design-capability",
      },
    });
  });

  it("rejects an invalid revision from the local bridge", async () => {
    await expect(
      readLocalVisualEditPendingState({
        activeScreenBridgeUrl: "http://127.0.0.1:7331",
        activeScreenPreviewToken: "preview-token",
        activeScreenLiveEditCapability: "design-capability",
        designId: "design-1",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ revision: -1 }),
        }),
      }),
    ).rejects.toThrow("Bridge returned invalid pending state");
  });

  it("publishes local handoffs for public live-screen viewers without granting design edit access", () => {
    expect(
      shouldPublishVisualEditPending({
        designId: "design-1",
        canEditDesign: false,
        canEditLiveScreen: true,
      }),
    ).toBe(true);
    expect(
      shouldPublishVisualEditPending({
        designId: "design-1",
        canEditDesign: false,
        canEditLiveScreen: false,
      }),
    ).toBe(false);
    expect(
      shouldPublishVisualEditPending({
        designId: null,
        canEditDesign: true,
        canEditLiveScreen: false,
      }),
    ).toBe(false);
  });

  it("skips the durable action and its error state for a viewer, but still posts to the local bridge", async () => {
    const args = makeArgs({ canPublishDurableHandoff: false });

    await runPublishVisualEditPending(args);

    expect(args.callAction).not.toHaveBeenCalled();
    expect(args.setPendingVisualEditPublicationFailed).toHaveBeenCalledWith(
      false,
    );
    expect(args.showHandoffErrorToast).not.toHaveBeenCalled();
    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "local-ready",
      1,
    );
    expect(args.fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/live-edit-pending",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-agent-native-live-edit-capability": "design-capability",
        }),
        body: JSON.stringify({
          designId: args.pending.designId,
          revision: args.pending.revision,
          pending: args.pending.pending,
        }),
      }),
    );
  });

  it("publishes the durable handoff and still posts to the local bridge for an editor", async () => {
    const args = makeArgs({ canPublishDurableHandoff: true });

    await runPublishVisualEditPending(args);

    expect(args.callAction).toHaveBeenCalledWith(
      "publish-visual-edit-pending",
      args.pending,
    );
    expect(args.setPendingVisualEditPublicationFailed).toHaveBeenCalledWith(
      false,
    );
    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "ready",
      1,
      1,
    );
    expect(args.showHandoffErrorToast).not.toHaveBeenCalled();
    expect(args.fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/live-edit-pending",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces the handoff error only when an editor's durable publish itself fails", async () => {
    const error = new Error("editor access");
    const setFailed = vi.fn();
    const args = makeArgs({
      canPublishDurableHandoff: true,
      callAction: vi.fn().mockRejectedValue(error),
      setPendingVisualEditPublicationFailed: setFailed,
    });

    await runPublishVisualEditPending(args);

    expect(args.setPendingVisualEditPublicationFailed).toHaveBeenCalledWith(
      true,
    );
    expect(setFailed.mock.lastCall).toEqual([true]);
    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "failed",
      1,
    );
    expect(args.onHandoffPublicationStatusChange).not.toHaveBeenCalledWith(
      "local-ready",
      1,
    );
    expect(args.showHandoffErrorToast).toHaveBeenCalledWith(error);
    expect(args.fetchImpl).toHaveBeenCalled();
  });

  it("publishes the durable handoff when local revision synchronization fails", async () => {
    const setFailed = vi.fn();
    const order: string[] = [];
    const args = makeArgs({
      callAction: vi.fn(async (_name, payload) => {
        order.push("durable");
        return {
          designId: payload.designId,
          revision: payload.revision,
          status: "ready",
        };
      }),
      prepareLocalBridgeRevision: vi.fn(async () => {
        order.push("local");
        throw new Error("bridge unavailable");
      }),
      setPendingVisualEditPublicationFailed: setFailed,
    });

    await runPublishVisualEditPending(args);

    expect(args.callAction).toHaveBeenCalledWith(
      "publish-visual-edit-pending",
      args.pending,
    );
    expect(order).toEqual(["durable", "local"]);
    expect(args.fetchImpl).not.toHaveBeenCalled();
    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "ready",
      1,
      1,
    );
    expect(args.onHandoffPublicationStatusChange).not.toHaveBeenCalledWith(
      "failed",
      1,
    );
    expect(setFailed.mock.lastCall).toEqual([true]);
  });

  it("preserves durable success when the optional local bridge publish fails", async () => {
    const error = new Error("bridge unavailable");
    const setFailed = vi.fn();
    const args = makeArgs({
      fetchImpl: vi.fn().mockRejectedValue(error),
      setPendingVisualEditPublicationFailed: setFailed,
    });

    await runPublishVisualEditPending(args);

    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "ready",
      1,
      1,
    );
    expect(args.onHandoffPublicationStatusChange).not.toHaveBeenCalledWith(
      "failed",
      1,
    );
    expect(setFailed.mock.lastCall).toEqual([true]);
    expect(args.showHandoffErrorToast).toHaveBeenCalledWith(error);
  });

  it("does not clear local pending state when the durable clear is stale", async () => {
    const args = makeArgs({
      pending: { ...makeArgs().pending, pending: null },
      pendingVisualEditClearRequestedRef: { current: "design-1" },
      pendingVisualEditHadPendingRef: { current: "design-1" },
      callAction: vi.fn().mockResolvedValue({
        designId: "design-1",
        pendingEditCount: null,
        revision: null,
        status: "stale",
      }),
    });

    await runPublishVisualEditPending(args);

    expect(args.pendingVisualEditClearRequestedRef.current).toBe("design-1");
    expect(args.pendingVisualEditHadPendingRef.current).toBe("design-1");
    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "failed",
      1,
    );
    expect(args.setPendingVisualEditPublicationFailed).toHaveBeenCalledWith(
      true,
    );
    expect(args.showHandoffErrorToast).toHaveBeenCalledWith({
      errorCode: "visual_edit_handoff_unconfirmed",
    });
    expect(args.fetchImpl).toHaveBeenCalled();
  });

  it("skips the local bridge POST entirely when no bridge is connected", async () => {
    const args = makeArgs({
      canPublishDurableHandoff: false,
      activeScreenBridgeUrl: null,
    });

    await runPublishVisualEditPending(args);

    expect(args.fetchImpl).not.toHaveBeenCalled();
  });

  it("does not publish to the bridge without a design-scoped capability", async () => {
    const args = makeArgs({ activeScreenLiveEditCapability: undefined });

    await runPublishVisualEditPending(args);

    expect(args.fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a revision conflict when the bridge already holds the same payload", async () => {
    const onLocalRevisionConflict = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pending: makeArgs().pending.pending,
          revision: 8,
        }),
      });
    const args = makeArgs({
      canPublishDurableHandoff: false,
      fetchImpl,
      onLocalRevisionConflict,
    });

    await runPublishVisualEditPending(args);

    expect(onLocalRevisionConflict).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "local-ready",
      8,
    );
  });

  it("does not overwrite a newer prompt after a revision conflict", async () => {
    const args = makeArgs({
      canPublishDurableHandoff: false,
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 409 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pending: { ...makeArgs().pending.pending, prompt: "newer prompt" },
            revision: 8,
          }),
        }),
    });

    await runPublishVisualEditPending(args);

    expect(args.fetchImpl).toHaveBeenCalledTimes(2);
    expect(args.setPendingVisualEditPublicationFailed).toHaveBeenCalledWith(
      true,
    );
    expect(args.showHandoffErrorToast).toHaveBeenCalledWith({
      errorCode: "visual_edit_pending_conflict",
    });
  });

  it("does not clear another publisher's pending edits after a revision conflict", async () => {
    const args = makeArgs({
      canPublishDurableHandoff: false,
      pending: { ...makeArgs().pending, pending: null },
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 409 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pending: makeArgs().pending.pending,
            revision: 8,
          }),
        }),
    });

    await runPublishVisualEditPending(args);

    expect(args.fetchImpl).toHaveBeenCalledTimes(2);
    expect(args.showHandoffErrorToast).toHaveBeenCalledWith({
      errorCode: "visual_edit_pending_conflict",
    });
  });

  it("includes the design ID when clearing the bridge handoff", async () => {
    const args = makeArgs({
      canPublishDurableHandoff: false,
      pending: {
        ...makeArgs().pending,
        pending: null,
      },
    });

    await runPublishVisualEditPending(args);

    expect(args.fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/live-edit-pending",
      expect.objectContaining({
        body: JSON.stringify({
          designId: "design-1",
          revision: args.pending.revision,
          pending: null,
        }),
      }),
    );
  });

  it("reports when a durable handoff is confirmed empty", async () => {
    const args = makeArgs({
      pending: { ...makeArgs().pending, pending: null },
      pendingVisualEditClearRequestedRef: { current: "design-1" },
      pendingVisualEditHadPendingRef: { current: "design-1" },
    });

    await runPublishVisualEditPending(args);

    expect(args.onHandoffPublicationStatusChange).toHaveBeenCalledWith(
      "empty",
      1,
      1,
    );
  });
});
