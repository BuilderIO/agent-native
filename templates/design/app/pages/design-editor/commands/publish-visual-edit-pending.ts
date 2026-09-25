import type { RefObject } from "react";

export interface PendingVisualEditHandoff {
  designId: string;
  publisherId: string;
  revision: number;
  pending: {
    designId: string;
    pendingEditCount: number;
    status: "ready";
    prompt: string;
  } | null;
}

export interface PublishVisualEditPendingArgs {
  activeScreenBridgeUrl: string | null | undefined;
  activeScreenPreviewToken: string | null | undefined;
  activeScreenLiveEditCapability: string | null | undefined;
  callAction: (
    name: "publish-visual-edit-pending",
    payload: PendingVisualEditHandoff,
  ) => Promise<unknown>;
  /** The durable action verifies editor access or the same-origin live-share
   *  URL; this only decides whether to attempt that action from the browser. */
  canPublishDurableHandoff: boolean;
  designId: string;
  fetchImpl: typeof fetch;
  pending: PendingVisualEditHandoff;
  pendingVisualEditClearRequestedRef: RefObject<string | null>;
  pendingVisualEditHadPendingRef: RefObject<string | null>;
  setPendingVisualEditPublicationFailed: (failed: boolean) => void;
  showHandoffErrorToast: (error: unknown) => void;
}

export function shouldPublishVisualEditPending(args: {
  designId: string | null | undefined;
  canEditDesign: boolean;
  canEditLiveScreen: boolean;
}): boolean {
  return (
    Boolean(args.designId) && (args.canEditDesign || args.canEditLiveScreen)
  );
}

export async function runPublishVisualEditPending(
  args: PublishVisualEditPendingArgs,
): Promise<void> {
  const {
    activeScreenBridgeUrl,
    activeScreenPreviewToken,
    activeScreenLiveEditCapability,
    callAction,
    canPublishDurableHandoff,
    designId,
    fetchImpl,
    pending,
    pendingVisualEditClearRequestedRef,
    pendingVisualEditHadPendingRef,
    setPendingVisualEditPublicationFailed,
    showHandoffErrorToast,
  } = args;
  const clearRequested = pending.pending === null;
  if (canPublishDurableHandoff) {
    try {
      await callAction("publish-visual-edit-pending", pending);
      setPendingVisualEditPublicationFailed(false);
      if (
        clearRequested &&
        pendingVisualEditClearRequestedRef.current === designId
      ) {
        pendingVisualEditClearRequestedRef.current = null;
        pendingVisualEditHadPendingRef.current = null;
      }
    } catch (error) {
      console.error(
        "[design:visual-edit] durable handoff publication failed",
        error,
      );
      setPendingVisualEditPublicationFailed(true);
      showHandoffErrorToast(error);
    }
  }

  if (
    !activeScreenBridgeUrl ||
    !activeScreenPreviewToken ||
    !activeScreenLiveEditCapability
  )
    return;
  try {
    const response = await fetchImpl(
      `${activeScreenBridgeUrl.replace(/\/$/, "")}/live-edit-pending`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-design-preview-token": activeScreenPreviewToken,
          "x-agent-native-live-edit-capability": activeScreenLiveEditCapability,
        },
        body: JSON.stringify({
          designId: pending.designId,
          revision: pending.revision,
          pending: pending.pending,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Bridge returned HTTP ${response.status}`);
    }
  } catch (error) {
    // The bridge is optional for static screens; durable MCP publication
    // remains authoritative when the local app is offline.
    console.warn(
      "[design:visual-edit] local bridge handoff publication failed",
      error,
    );
  }
}
