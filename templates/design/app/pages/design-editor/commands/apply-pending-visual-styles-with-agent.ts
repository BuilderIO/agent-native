import { callAction } from "@agent-native/core/client/hooks";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { sendDesignSourceHandoffAndConfirm } from "@/lib/agent-chat";
import { actionErrorDetail } from "@/pages/design-editor/action-error";
import type {
  PendingStructureVerificationSession,
  PendingStructureVerificationStatus,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  HOST_TURN_START_TIMEOUT_MS,
  PENDING_STRUCTURE_RUNTIME_POLL_MS,
  PENDING_STRUCTURE_RUNTIME_TIMEOUT_MS,
  PENDING_STRUCTURE_SOURCE_POLL_MS,
  PENDING_STRUCTURE_VERIFICATION_TIMEOUT_MS,
} from "@/pages/design-editor/editor-constants";
import type {
  PendingLiveNonStyleEdit,
  PendingLiveStructureEdit,
  PendingVisualStyleEdit,
} from "@/pages/design-editor/pending-edits";
import {
  buildPendingVisualStyleRevertPatches,
  pendingStructureEditSourcePaths,
} from "@/pages/design-editor/pending-edits";
import { verifyPendingStructuresRuntime } from "@/pages/design-editor/pending-structure-verification";
import type { DesignLeftPanel } from "@/pages/design-editor/types";

export interface ApplyPendingVisualStylesWithAgentArgs {
  cancelPendingStructureVerification: (
    nextStatus?: PendingStructureVerificationStatus,
  ) => void;
  clearPendingLiveEditState: () => void;
  id: string | undefined;
  overviewScreens: OverviewScreen[];
  pendingAgentHandoffBusyRef: RefObject<boolean>;
  pendingLiveNonStyleEdits: PendingLiveNonStyleEdit[];
  stagedHandoffStartTimerRef: RefObject<number | undefined>;
  stagedSourceHandoffRef: RefObject<"idle" | "awaiting-start" | "running">;
  pendingStructureVerificationRevisionRef: RefObject<number>;
  pendingStructureVerificationSessionRef: RefObject<
    PendingStructureVerificationSession | undefined
  >;
  pendingStructureVerificationSnapshotsRef: RefObject<
    Map<number, Record<string, RuntimeLayerSnapshot>>
  >;
  pendingStructureVerificationStatus: PendingStructureVerificationStatus;
  pendingVisualStyleEdits: PendingVisualStyleEdit[];
  pendingVisualStylePrompt: string;
  setActiveLeftPanel: Dispatch<SetStateAction<DesignLeftPanel>>;
  setApplyingViaHost: Dispatch<SetStateAction<boolean>>;
  setPendingAgentHandoffBusy: Dispatch<SetStateAction<boolean>>;
  setPendingStructureAckRequest: Dispatch<
    SetStateAction<{
      requestId: number;
      acks: Array<{ screenId: string; requestId: string; applied: boolean }>;
    } | null>
  >;
  setPendingStructureVerificationStatus: Dispatch<
    SetStateAction<PendingStructureVerificationStatus>
  >;
  setPendingVisualStyleBaselineResetRequest: Dispatch<
    SetStateAction<number | null>
  >;
  setPendingVisualStyleRevertRequest: Dispatch<
    SetStateAction<{
      requestId: number;
      patches: ReturnType<typeof buildPendingVisualStyleRevertPatches>;
    } | null>
  >;
  setRuntimeStructureVerificationRequest: Dispatch<
    SetStateAction<{ requestId: number; screenIds: string[] } | null>
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export async function runApplyPendingVisualStylesWithAgent({
  cancelPendingStructureVerification,
  clearPendingLiveEditState,
  id,
  overviewScreens,
  pendingAgentHandoffBusyRef,
  pendingLiveNonStyleEdits,
  stagedHandoffStartTimerRef,
  stagedSourceHandoffRef,
  pendingStructureVerificationRevisionRef,
  pendingStructureVerificationSessionRef,
  pendingStructureVerificationSnapshotsRef,
  pendingStructureVerificationStatus,
  pendingVisualStyleEdits,
  pendingVisualStylePrompt,
  setActiveLeftPanel,
  setApplyingViaHost,
  setPendingAgentHandoffBusy,
  setPendingStructureAckRequest,
  setPendingStructureVerificationStatus,
  setPendingVisualStyleBaselineResetRequest,
  setPendingVisualStyleRevertRequest,
  setRuntimeStructureVerificationRequest,
  t,
}: ApplyPendingVisualStylesWithAgentArgs) {
  if (
    pendingVisualStyleEdits.length === 0 &&
    pendingLiveNonStyleEdits.length === 0
  ) {
    return;
  }
  if (
    pendingAgentHandoffBusyRef.current ||
    pendingStructureVerificationStatus === "checking-source" ||
    pendingStructureVerificationStatus === "awaiting-source" ||
    pendingStructureVerificationStatus === "awaiting-runtime"
  ) {
    return;
  }
  pendingAgentHandoffBusyRef.current = true;
  setPendingAgentHandoffBusy(true);
  try {
    const preservePreviewPatches = pendingVisualStyleEdits
      .map((edit) => ({
        screenId: edit.screenId,
        selector: edit.selector,
        sourceId: edit.sourceId,
        styles: edit.styles,
        ...(edit.interactionState
          ? { interactionState: edit.interactionState }
          : {}),
      }))
      .filter((patch) => Object.keys(patch.styles).length > 0);
    const structureEdits = pendingLiveNonStyleEdits.filter(
      (edit): edit is PendingLiveStructureEdit => edit.kind === "structure",
    );
    const structureAcks = structureEdits
      .filter((edit) => Boolean(edit.requestId))
      .map((edit) => ({
        screenId: edit.screenId,
        requestId: edit.requestId!,
        applied: true,
      }));

    const finalizeWithoutStructureVerification = () => {
      clearPendingLiveEditState();
      const previewRequestId = Date.now() + Math.random();
      window.setTimeout(() => {
        if (preservePreviewPatches.length > 0) {
          setPendingVisualStyleRevertRequest({
            requestId: previewRequestId,
            patches: preservePreviewPatches,
          });
        }
        setPendingVisualStyleBaselineResetRequest(previewRequestId);
      }, 50);
    };

    if (structureEdits.length === 0) {
      const delivery = await sendDesignSourceHandoffAndConfirm(
        {
          message: t("designEditor.pendingVisualStyles.agentMessage"),
          context: pendingVisualStylePrompt,
          submit: true,
          openSidebar: true,
        },
        { timeoutMs: 10_000 },
      );
      if (!delivery.delivered) {
        toast.error(
          t("designEditor.pendingVisualStyles.agentHandoffFailedToast"),
        );
        return;
      }
      if (delivery.awaitingHostTurn) {
        stagedSourceHandoffRef.current = "awaiting-start";
        setApplyingViaHost(true);
        stagedHandoffStartTimerRef.current = window.setTimeout(() => {
          stagedHandoffStartTimerRef.current = undefined;
          if (stagedSourceHandoffRef.current !== "awaiting-start") return;
          stagedSourceHandoffRef.current = "idle";
          setApplyingViaHost(false);
          toast.error(
            t("designEditor.pendingVisualStyles.agentHandoffFailedToast"),
          );
        }, HOST_TURN_START_TIMEOUT_MS);
      } else finalizeWithoutStructureVerification();
      if (delivery.target === "local") setActiveLeftPanel("agent");
      toast.success(t("designEditor.pendingVisualStyles.sentToast"));
      return;
    }

    if (!id) return;
    pendingStructureVerificationRevisionRef.current += 1;
    const requestId = pendingStructureVerificationRevisionRef.current;
    const session: PendingStructureVerificationSession = {
      requestId,
      cancelled: false,
      edits: structureEdits,
      sources: [],
    };
    pendingStructureVerificationSessionRef.current = session;
    pendingStructureVerificationSnapshotsRef.current.set(requestId, {});
    setPendingStructureVerificationStatus("checking-source");

    const sourceTargets = new Map<
      string,
      { connectionId: string; path: string }
    >();
    for (const edit of structureEdits) {
      const connectionId = overviewScreens.find(
        (screen) => screen.id === edit.screenId,
      )?.connectionId;
      const paths = pendingStructureEditSourcePaths(edit);
      if (!connectionId || !paths) {
        cancelPendingStructureVerification("conflict");
        toast.error(t("designEditor.toasts.reactSourceAnchorsLoading"));
        return;
      }
      for (const path of paths) {
        sourceTargets.set(`${connectionId}:${path}`, {
          connectionId,
          path,
        });
      }
    }

    try {
      session.sources = await Promise.all(
        Array.from(sourceTargets.values()).map(async (source) => {
          // read-local-file declares `http: { method: "GET" }`, so a
          // default POST is refused with 405 and every Apply preflight
          // fails before it reads a single baseline hash.
          const result = (await callAction(
            "read-local-file",
            {
              designId: id,
              connectionId: source.connectionId,
              path: source.path,
            },
            { method: "GET" },
          )) as { versionHash?: string } | undefined;
          if (!result?.versionHash) {
            throw new Error(`Missing version hash for ${source.path}`);
          }
          return {
            ...source,
            baselineVersionHash: result.versionHash,
          };
        }),
      );
      if (session.cancelled) return;

      const delivery = await sendDesignSourceHandoffAndConfirm(
        {
          message: t("designEditor.pendingVisualStyles.agentMessage"),
          context: pendingVisualStylePrompt,
          submit: true,
          openSidebar: true,
        },
        { timeoutMs: 10_000 },
      );
      if (session.cancelled) return;
      if (!delivery.delivered) {
        cancelPendingStructureVerification();
        toast.error(
          t("designEditor.pendingVisualStyles.agentHandoffFailedToast"),
        );
        return;
      }

      const screenIds = Array.from(
        new Set(structureEdits.map((edit) => edit.screenId)),
      );
      setPendingStructureVerificationStatus("awaiting-source");
      if (delivery.target === "local") setActiveLeftPanel("agent");
      toast.success(t("designEditor.pendingVisualStyles.sentToast"));

      let deadline = Date.now() + PENDING_STRUCTURE_VERIFICATION_TIMEOUT_MS;
      let nextSourcePollAt = 0;
      let sourceChanged = false;
      let verificationRuntimeMounted = false;
      while (!session.cancelled && Date.now() < deadline) {
        const runtimeSnapshots =
          pendingStructureVerificationSnapshotsRef.current.get(requestId) ?? {};
        if (
          verificationRuntimeMounted &&
          screenIds.every((screenId) => runtimeSnapshots[screenId])
        ) {
          const runtimeResult = verifyPendingStructuresRuntime(
            runtimeSnapshots,
            structureEdits,
          );
          if (runtimeResult.ok) {
            if (structureAcks.length > 0) {
              setPendingStructureAckRequest({
                requestId: Date.now() + Math.random(),
                acks: structureAcks,
              });
            }
            clearPendingLiveEditState();
            toast.success(t("designEditor.pendingVisualStyles.verifiedToast"));
            return;
          }
        }

        if (Date.now() >= nextSourcePollAt) {
          nextSourcePollAt = Date.now() + PENDING_STRUCTURE_SOURCE_POLL_MS;
          try {
            const currentVersions = await Promise.all(
              session.sources.map(async (source) => {
                const result = (await callAction(
                  "read-local-file",
                  {
                    designId: id,
                    connectionId: source.connectionId,
                    path: source.path,
                  },
                  { method: "GET" },
                )) as { versionHash?: string } | undefined;
                return result?.versionHash;
              }),
            );
            if (session.cancelled) return;
            sourceChanged = currentVersions.some(
              (versionHash, index) =>
                Boolean(versionHash) &&
                versionHash !== session.sources[index]?.baselineVersionHash,
            );
            if (sourceChanged) {
              if (!verificationRuntimeMounted) {
                verificationRuntimeMounted = true;
                deadline = Math.min(
                  deadline,
                  Date.now() + PENDING_STRUCTURE_RUNTIME_TIMEOUT_MS,
                );
                pendingStructureVerificationSnapshotsRef.current.set(
                  requestId,
                  {},
                );
                setRuntimeStructureVerificationRequest({
                  requestId,
                  screenIds,
                });
              }
              setPendingStructureVerificationStatus("awaiting-runtime");
            }
            // coercion-ok: moved verbatim; a failed optional probe here is indistinguishable from "not applicable" by design.
          } catch {
            // A transient bridge read must not discard the still-undoable
            // preview. Keep polling until the bounded deadline.
          }
        }
        await new Promise((resolve) =>
          window.setTimeout(resolve, PENDING_STRUCTURE_RUNTIME_POLL_MS),
        );
      }
      if (session.cancelled) return;
      cancelPendingStructureVerification("conflict");
      toast.error(t("designEditor.pendingVisualStyles.conflictToast"));
    } catch (error) {
      if (session.cancelled) return;
      console.error(
        "[DesignEditor] pending structure verification failed:",
        error,
      );
      cancelPendingStructureVerification("conflict");
      toast.error(
        t("designEditor.pendingVisualStyles.sourceCheckFailedToast"),
        { description: actionErrorDetail(error) },
      );
    }
  } finally {
    pendingAgentHandoffBusyRef.current = false;
    setPendingAgentHandoffBusy(false);
  }
}
