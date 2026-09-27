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

interface PublishedVisualEditHandoff {
  designId: string;
  pendingEditCount: number | null;
  revision: number | null;
  status: "empty" | "ready" | "stale";
}

export interface PublishVisualEditPendingArgs {
  activeScreenBridgeUrl: string | null | undefined;
  activeScreenPreviewToken: string | null | undefined;
  activeScreenLiveEditCapability: string | null | undefined;
  callAction: (
    name: "publish-visual-edit-pending",
    payload: PendingVisualEditHandoff,
  ) => Promise<unknown>;
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
      const result = (await callAction(
        "publish-visual-edit-pending",
        pending,
      )) as PublishedVisualEditHandoff | null;
      const expectedStatus = clearRequested ? "empty" : "ready";
      if (
        result?.designId !== designId ||
        result.status !== expectedStatus ||
        !Number.isInteger(result.revision) ||
        (result.revision ?? 0) < 1
      ) {
        throw { errorCode: "visual_edit_handoff_unconfirmed" };
      }
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
    console.warn(
      "[design:visual-edit] local bridge handoff publication failed",
      error,
    );
  }
}
