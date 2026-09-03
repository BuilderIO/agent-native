import { useActionMutation } from "@agent-native/core/client/hooks";
import { tweakSelectionsHash } from "@shared/resolve-tweaks";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import type { PendingTweakSave } from "@/pages/design-editor/tweak-save";
import {
  classifyTweakSaveFailure,
  clearCompletedTweakSave,
  rebaseTweakSaveForSend,
  retainLatestFailedTweakSave,
} from "@/pages/design-editor/tweak-save";

export interface PersistTweakSaveArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  applyTweaksAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "apply-tweaks">
  >["mutateAsync"];
  canEditDesignRef: RefObject<boolean>;
  confirmedTweakSelectionsHashRef: RefObject<string>;
  createTweakSaveOutboxEntry: (
    pending: PendingTweakSave,
  ) => DesignSaveOutboxEntry | null;
  id: string | undefined;
  journalTweakOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  pendingTweakSaveRef: RefObject<PendingTweakSave | null>;
  queryClient: QueryClient;
  setTweakSaveActive: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  tweakSaveChainRef: RefObject<Promise<void>>;
  tweakSaveInFlightRef: RefObject<boolean>;
  tweakSaveRevisionRef: RefObject<number>;
  warnChangesWillRetry: () => void;
}

export function runPersistTweakSave(
  {
    acknowledgeOutboxEntry,
    applyTweaksAsync,
    canEditDesignRef,
    confirmedTweakSelectionsHashRef,
    createTweakSaveOutboxEntry,
    id,
    journalTweakOutboxEntry,
    pendingTweakSaveRef,
    queryClient,
    setTweakSaveActive,
    t,
    tweakSaveChainRef,
    tweakSaveInFlightRef,
    tweakSaveRevisionRef,
    warnChangesWillRetry,
  }: PersistTweakSaveArgs,
  pending: PendingTweakSave,
) {
  if (!id || !canEditDesignRef.current) return;
  const previous = tweakSaveChainRef.current;
  const current = previous
    .catch(() => {})
    .then(async () => {
      tweakSaveInFlightRef.current = true;
      const sendPending = rebaseTweakSaveForSend(
        pending,
        confirmedTweakSelectionsHashRef.current,
      );
      const entry = createTweakSaveOutboxEntry(sendPending);
      if (!entry) {
        tweakSaveInFlightRef.current = false;
        return;
      }
      const journaled = await journalTweakOutboxEntry(entry);
      try {
        const result = (await applyTweaksAsync(entry.payload as any)) as {
          appliedTweaks?: Record<string, unknown>;
          selectionsHash?: string;
        };
        const confirmedHash =
          typeof result?.selectionsHash === "string"
            ? result.selectionsHash
            : tweakSelectionsHash(
                result?.appliedTweaks ?? sendPending.selections,
              );
        confirmedTweakSelectionsHashRef.current = confirmedHash;
        if (result?.appliedTweaks) {
          queryClient.setQueryData(
            ["action", "get-design", { id }],
            (old: any) => {
              if (!old || typeof old !== "object") return old;
              let data: Record<string, unknown>;
              try {
                const parsed = JSON.parse(old.data ?? "{}");
                data =
                  parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? parsed
                    : {};
              } catch {
                return old;
              }
              return {
                ...old,
                data: JSON.stringify({
                  ...data,
                  tweakSelections: result.appliedTweaks,
                }),
              };
            },
          );
        }
        if (journaled) await acknowledgeOutboxEntry(entry);

        const queuedAfterSuccess = clearCompletedTweakSave(
          pendingTweakSaveRef.current,
          pending.revision,
        );
        if (
          queuedAfterSuccess &&
          queuedAfterSuccess.revision > pending.revision
        ) {
          const rebasedQueued = rebaseTweakSaveForSend(
            queuedAfterSuccess,
            confirmedHash,
          );
          pendingTweakSaveRef.current = rebasedQueued;
          const rebasedEntry = createTweakSaveOutboxEntry(rebasedQueued);
          if (rebasedEntry) void journalTweakOutboxEntry(rebasedEntry);
        } else {
          pendingTweakSaveRef.current = queuedAfterSuccess;
        }
        if (tweakSaveRevisionRef.current === pending.revision) {
          setTweakSaveActive(false);
        }
      } catch (error) {
        pendingTweakSaveRef.current = retainLatestFailedTweakSave(
          pendingTweakSaveRef.current,
          sendPending,
        );
        if (tweakSaveRevisionRef.current === pending.revision) {
          setTweakSaveActive(true);
        }
        const failureKind = classifyTweakSaveFailure(error, journaled);
        if (failureKind === "conflict") {
          toast.error(t("designEditor.toasts.tweakConflict"));
        } else if (failureKind === "durable-retry") {
          warnChangesWillRetry();
        } else {
          toast.error(t("designEditor.toasts.tweakSaveNotDurable"));
        }
      } finally {
        tweakSaveInFlightRef.current = false;
      }
    });
  tweakSaveChainRef.current = current;
  void current.finally(() => {
    if (tweakSaveChainRef.current === current) {
      tweakSaveChainRef.current = Promise.resolve();
    }
  });
}
