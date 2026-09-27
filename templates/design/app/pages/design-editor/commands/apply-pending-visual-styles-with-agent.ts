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
  PENDING_STRUCTURE_HARD_TIMEOUT_MS,
  PENDING_STRUCTURE_RUNTIME_POLL_MS,
  PENDING_STRUCTURE_SOURCE_POLL_MS,
} from "@/pages/design-editor/editor-constants";
import type {
  PendingLiveNonStyleEdit,
  PendingLiveStructureEdit,
  PendingVisualStyleEdit,
} from "@/pages/design-editor/pending-edits";
import {
  buildPendingVisualStyleRevertPatches,
  pendingLiveStructureEditsFromEdit,
  pendingStructureEditSourcePaths,
} from "@/pages/design-editor/pending-edits";
import {
  partitionPendingStructuresRuntime,
  type RuntimeStructureVerificationFailure,
  verifyPendingStructuresRuntime,
} from "@/pages/design-editor/pending-structure-verification";
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
  pendingLiveNonStyleEditsRef: RefObject<PendingLiveNonStyleEdit[]>;
  pendingStructureVerificationSnapshotsRef: RefObject<
    Map<number, Record<string, RuntimeLayerSnapshot>>
  >;
  pendingStructureVerificationStatus: PendingStructureVerificationStatus;
  pendingVisualStyleEdits: PendingVisualStyleEdit[];
  pendingVisualStylePrompt: string;
  allowPromptOnly?: boolean;
  setActiveLeftPanel: Dispatch<SetStateAction<DesignLeftPanel | null>>;
  setApplyingViaHost: Dispatch<SetStateAction<boolean>>;
  setPendingAgentHandoffBusy: Dispatch<SetStateAction<boolean>>;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
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
  pendingLiveNonStyleEditsRef,
  pendingStructureVerificationSnapshotsRef,
  pendingStructureVerificationStatus,
  pendingVisualStyleEdits,
  pendingVisualStylePrompt,
  allowPromptOnly = false,
  setActiveLeftPanel,
  setApplyingViaHost,
  setPendingAgentHandoffBusy,
  setPendingLiveNonStyleEdits,
  setPendingStructureAckRequest,
  setPendingStructureVerificationStatus,
  setPendingVisualStyleBaselineResetRequest,
  setPendingVisualStyleRevertRequest,
  setRuntimeStructureVerificationRequest,
  t,
}: ApplyPendingVisualStylesWithAgentArgs) {
  if (
    pendingVisualStyleEdits.length === 0 &&
    pendingLiveNonStyleEdits.length === 0 &&
    !allowPromptOnly
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
      } else if (!allowPromptOnly) finalizeWithoutStructureVerification();
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
      abortController: new AbortController(),
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

    const hardDeadline = Date.now() + PENDING_STRUCTURE_HARD_TIMEOUT_MS;
    let lastRuntimeFailure: RuntimeStructureVerificationFailure | undefined;
    const reportStructureConflict = () => {
      console.error("[DesignEditor] pending structure verification conflict", {
        failure: lastRuntimeFailure,
      });
      toast.error(t("designEditor.pendingVisualStyles.conflictToast"));
    };
    const sourceReadDeadline = Symbol("source-read-deadline");
    const readWithHardDeadline = async <T>(read: Promise<T>) => {
      let timeoutId: number | undefined;
      return Promise.race([
        read,
        new Promise<typeof sourceReadDeadline>((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve(sourceReadDeadline),
            Math.max(0, hardDeadline - Date.now()),
          );
        }),
      ]).finally(() => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      });
    };

    try {
      const initialSources = await readWithHardDeadline(
        Promise.all(
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
              { method: "GET", signal: session.abortController.signal },
            )) as { versionHash?: string } | undefined;
            if (!result?.versionHash) {
              throw new Error(`Missing version hash for ${source.path}`);
            }
            return {
              ...source,
              baselineVersionHash: result.versionHash,
            };
          }),
        ),
      );
      if (initialSources === sourceReadDeadline) {
        cancelPendingStructureVerification("conflict");
        reportStructureConflict();
        return;
      }
      session.sources = initialSources;
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
      if (Date.now() >= hardDeadline) {
        cancelPendingStructureVerification("conflict");
        reportStructureConflict();
        return;
      }
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

      let nextSourcePollAt = 0;
      let verificationRuntimeMounted = false;
      let observedVersionHashes = session.sources.map(
        (source) => source.baselineVersionHash,
      );
      while (!session.cancelled && Date.now() < hardDeadline) {
        const runtimeRequestId = session.requestId;
        const runtimeSnapshots =
          pendingStructureVerificationSnapshotsRef.current.get(
            runtimeRequestId,
          ) ?? {};
        if (verificationRuntimeMounted && session.edits.length > 0) {
          const runtimeResult = partitionPendingStructuresRuntime(
            runtimeSnapshots,
            session.edits,
          );
          if (!runtimeResult.verified.length) {
            const verification = session.edits
              .map((edit) => {
                const snapshot = runtimeSnapshots[edit.screenId];
                return snapshot
                  ? verifyPendingStructuresRuntime(
                      { [edit.screenId]: snapshot },
                      pendingLiveStructureEditsFromEdit(edit),
                    )
                  : undefined;
              })
              .find((result) => result && !result.ok);
            lastRuntimeFailure = verification?.failure;
          }
          if (runtimeResult.verified.length > 0) {
            session.edits = runtimeResult.remaining;
            const verifiedSet = new Set(runtimeResult.verified);
            pendingLiveNonStyleEditsRef.current =
              pendingLiveNonStyleEditsRef.current.filter(
                (edit) => edit.kind !== "structure" || !verifiedSet.has(edit),
              );
            setPendingLiveNonStyleEdits((current) =>
              current.filter(
                (edit) => edit.kind !== "structure" || !verifiedSet.has(edit),
              ),
            );
            const structureAcks = runtimeResult.verified.flatMap((edit) =>
              pendingLiveStructureEditsFromEdit(edit)
                .filter((member) => Boolean(member.requestId))
                .map((member) => ({
                  screenId: member.screenId,
                  requestId: member.requestId!,
                  applied: true,
                })),
            );
            if (structureAcks.length > 0) {
              setPendingStructureAckRequest({
                requestId: Date.now() + Math.random(),
                acks: structureAcks,
              });
            }
          }
          if (session.edits.length === 0) {
            clearPendingLiveEditState();
            toast.success(t("designEditor.pendingVisualStyles.verifiedToast"));
            return;
          }
        }

        if (Date.now() >= nextSourcePollAt) {
          nextSourcePollAt = Date.now() + PENDING_STRUCTURE_SOURCE_POLL_MS;
          try {
            const currentVersions = await readWithHardDeadline(
              Promise.all(
                session.sources.map(async (source) => {
                  const result = (await callAction(
                    "read-local-file",
                    {
                      designId: id,
                      connectionId: source.connectionId,
                      path: source.path,
                    },
                    { method: "GET", signal: session.abortController.signal },
                  )) as { versionHash?: string } | undefined;
                  return result?.versionHash;
                }),
              ),
            );
            if (currentVersions === sourceReadDeadline) break;
            if (session.cancelled) return;
            const versionChanged = currentVersions.some(
              (versionHash, index) =>
                Boolean(versionHash) &&
                versionHash !== observedVersionHashes[index],
            );
            if (versionChanged) {
              observedVersionHashes = currentVersions.map(
                (versionHash, index) =>
                  versionHash ?? observedVersionHashes[index]!,
              );
              if (!verificationRuntimeMounted) {
                verificationRuntimeMounted = true;
              }
              // A source write gets a fresh hidden iframe. Reusing the same
              // request key can leave the old document mounted and its
              // snapshot race with the next write.
              pendingStructureVerificationSnapshotsRef.current.delete(
                session.requestId,
              );
              pendingStructureVerificationRevisionRef.current += 1;
              session.requestId =
                pendingStructureVerificationRevisionRef.current;
              pendingStructureVerificationSnapshotsRef.current.set(
                session.requestId,
                {},
              );
              setRuntimeStructureVerificationRequest({
                requestId: session.requestId,
                screenIds,
              });
              setPendingStructureVerificationStatus("awaiting-runtime");
            }
            // coercion-ok: moved verbatim; a failed optional probe here is indistinguishable from "not applicable" by design.
          } catch {
            if (session.cancelled) return;
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
      reportStructureConflict();
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
