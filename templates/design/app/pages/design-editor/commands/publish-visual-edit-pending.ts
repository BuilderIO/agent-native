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
  onHandoffPublicationStatusChange: (
    status: "empty" | "failed" | "ready" | "local-ready",
    publicationRevision: number,
    serverRevision?: number,
  ) => void;
  setPendingVisualEditPublicationFailed: (failed: boolean) => void;
  showHandoffErrorToast: (error: unknown) => void;
  onLocalRevisionConflict?: () => void;
}

export async function readLocalVisualEditPendingState(args: {
  activeScreenBridgeUrl: string;
  activeScreenPreviewToken: string;
  activeScreenLiveEditCapability: string;
  designId: string;
  fetchImpl: typeof fetch;
}): Promise<{
  revision: number;
  pending: Record<string, unknown> | null;
}> {
  const url = new URL(
    `${args.activeScreenBridgeUrl.replace(/\/$/, "")}/live-edit-pending`,
  );
  url.searchParams.set("designId", args.designId);
  const response = await args.fetchImpl(url, {
    headers: {
      "x-design-preview-token": args.activeScreenPreviewToken,
      "x-agent-native-live-edit-capability":
        args.activeScreenLiveEditCapability,
    },
  });
  if (!response.ok) {
    throw new Error(`Bridge returned HTTP ${response.status}`);
  }
  const result = (await response.json()) as {
    pending?: unknown;
    revision?: unknown;
  } | null;
  if (
    !result ||
    typeof result.revision !== "number" ||
    !Number.isSafeInteger(result.revision) ||
    result.revision < 0 ||
    (result.pending !== null &&
      (!result.pending ||
        typeof result.pending !== "object" ||
        Array.isArray(result.pending)))
  ) {
    throw new Error("Bridge returned invalid pending state");
  }
  return {
    revision: result.revision,
    pending: result.pending as Record<string, unknown> | null,
  };
}

function samePendingState(
  current: Record<string, unknown> | null,
  next: PendingVisualEditHandoff["pending"],
): boolean {
  if (current === null || next === null) return current === next;
  return (
    current.designId === next.designId &&
    current.pendingEditCount === next.pendingEditCount &&
    current.status === next.status &&
    current.prompt === next.prompt
  );
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
    onHandoffPublicationStatusChange,
    onLocalRevisionConflict,
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
      onHandoffPublicationStatusChange(
        expectedStatus,
        pending.revision,
        result.revision ?? undefined,
      );
      if (
        clearRequested &&
        pendingVisualEditClearRequestedRef.current === designId
      ) {
        pendingVisualEditClearRequestedRef.current = null;
        pendingVisualEditHadPendingRef.current = null;
      }
    } catch (error) {
      onHandoffPublicationStatusChange("failed", pending.revision);
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
    let localRevision = pending.revision;
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
          revision: localRevision,
          pending: pending.pending,
        }),
      },
    );
    if (response.status === 409) {
      onLocalRevisionConflict?.();
      const bridgeState = await readLocalVisualEditPendingState({
        activeScreenBridgeUrl,
        activeScreenPreviewToken,
        activeScreenLiveEditCapability,
        designId,
        fetchImpl,
      });
      if (!samePendingState(bridgeState.pending, pending.pending)) {
        throw { errorCode: "visual_edit_pending_conflict" };
      }
      localRevision = bridgeState.revision;
    } else if (!response.ok) {
      throw new Error(`Bridge returned HTTP ${response.status}`);
    }
    setPendingVisualEditPublicationFailed(false);
    if (!clearRequested && !canPublishDurableHandoff) {
      onHandoffPublicationStatusChange("local-ready", localRevision);
    } else if (!canPublishDurableHandoff) {
      onHandoffPublicationStatusChange("empty", localRevision);
    }
    if (
      clearRequested &&
      !canPublishDurableHandoff &&
      pendingVisualEditClearRequestedRef.current === designId
    ) {
      pendingVisualEditClearRequestedRef.current = null;
      pendingVisualEditHadPendingRef.current = null;
    }
  } catch (error) {
    onHandoffPublicationStatusChange("failed", pending.revision);
    setPendingVisualEditPublicationFailed(true);
    showHandoffErrorToast(error);
    console.warn(
      "[design:visual-edit] local bridge handoff publication failed",
      error,
    );
  }
}
