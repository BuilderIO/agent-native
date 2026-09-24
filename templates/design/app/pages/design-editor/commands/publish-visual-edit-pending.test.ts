import { describe, expect, it, vi } from "vitest";

import { runPublishVisualEditPending } from "./publish-visual-edit-pending";

function makeArgs(
  overrides: Partial<Parameters<typeof runPublishVisualEditPending>[0]> = {},
) {
  return {
    activeScreenBridgeUrl: "http://127.0.0.1:7331",
    activeScreenPreviewToken: "preview-token",
    callAction: vi.fn().mockResolvedValue(undefined),
    canEditDesign: true,
    designId: "design-1",
    fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    pending: {
      designId: "design-1",
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
    setPendingVisualEditPublicationFailed: vi.fn(),
    showHandoffErrorToast: vi.fn(),
    ...overrides,
  };
}

describe("runPublishVisualEditPending", () => {
  it("skips the durable action and its error state for a viewer, but still posts to the local bridge", async () => {
    const args = makeArgs({ canEditDesign: false });

    await runPublishVisualEditPending(args);

    expect(args.callAction).not.toHaveBeenCalled();
    expect(args.setPendingVisualEditPublicationFailed).not.toHaveBeenCalled();
    expect(args.showHandoffErrorToast).not.toHaveBeenCalled();
    expect(args.fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/live-edit-pending",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("publishes the durable handoff and still posts to the local bridge for an editor", async () => {
    const args = makeArgs({ canEditDesign: true });

    await runPublishVisualEditPending(args);

    expect(args.callAction).toHaveBeenCalledWith(
      "publish-visual-edit-pending",
      args.pending,
    );
    expect(args.setPendingVisualEditPublicationFailed).toHaveBeenCalledWith(
      false,
    );
    expect(args.showHandoffErrorToast).not.toHaveBeenCalled();
    expect(args.fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/live-edit-pending",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces the handoff error toast only when an editor's durable publish itself fails", async () => {
    const args = makeArgs({
      canEditDesign: true,
      callAction: vi.fn().mockRejectedValue(new Error("editor access")),
    });

    await runPublishVisualEditPending(args);

    expect(args.setPendingVisualEditPublicationFailed).toHaveBeenCalledWith(
      true,
    );
    expect(args.showHandoffErrorToast).toHaveBeenCalledTimes(1);
    // The bridge POST is independent and must still run after the failure.
    expect(args.fetchImpl).toHaveBeenCalled();
  });

  it("skips the local bridge POST entirely when no bridge is connected", async () => {
    const args = makeArgs({
      canEditDesign: false,
      activeScreenBridgeUrl: null,
    });

    await runPublishVisualEditPending(args);

    expect(args.fetchImpl).not.toHaveBeenCalled();
  });
});
