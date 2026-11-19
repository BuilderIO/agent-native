import {
  tryCallActionKeepalive,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { tweakSelectionsHash } from "@shared/resolve-tweaks";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import type {
  ConfirmedTweakSelections,
  InFlightTweakSave,
  PendingTweakSave,
} from "@/pages/design-editor/tweak-save";
import {
  classifyTweakSaveFailure,
  clearCompletedTweakSave,
  rebaseTweakSaveForSend,
  selectionsHashIfApplied,
  sendJournaledTweakSaveKeepalive,
} from "@/pages/design-editor/tweak-save";

import { designMetadataQueryKey } from "../design-query-key";

export interface PersistTweakSaveArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  applyTweaksAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "apply-tweaks">
  >["mutateAsync"];
  canEditDesignRef: RefObject<boolean>;
  confirmedTweakSelectionsRef: RefObject<ConfirmedTweakSelections>;
  createTweakSaveOutboxEntry: (
    pending: PendingTweakSave,
  ) => DesignSaveOutboxEntry | null;
  id: string | undefined;
  journalTweakOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  /** The page-exit keepalive still on the wire, and the base it leaves if it lands. */
  keepaliveTweakSaveInFlightRef: RefObject<InFlightTweakSave | null>;
  /** Highest revision a page-exit keepalive has sent. */
  keepaliveTweakSaveRevisionRef: RefObject<number>;
  noteSaveLeftQueued: () => void;
  /** The latest unconfirmed snapshot; it stays here until a save confirms it. */
  pendingTweakSaveRef: RefObject<PendingTweakSave | null>;
  queryClient: QueryClient;
  setTweakSaveActive: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  tweakSaveInFlightRef: RefObject<InFlightTweakSave | null>;
  tweakSaveRevisionRef: RefObject<number>;
  warnChangesWillRetry: () => void;
}

type ApplyTweaksParams = Parameters<
  PersistTweakSaveArgs["applyTweaksAsync"]
>[0];

function applyTweaksParams(
  designId: string,
  pending: PendingTweakSave,
): ApplyTweaksParams {
  return {
    designId,
    selections: pending.selections,
    expectedSelectionsHash: pending.expectedSelectionsHash,
    ...(pending.inFlightSelectionsHash
      ? { inFlightSelectionsHash: pending.inFlightSelectionsHash }
      : {}),
  };
}

interface ApplyTweaksResult {
  appliedTweaks?: Record<string, unknown>;
  selectionsHash?: string;
  selectionsRevision?: number;
}

function confirmTweakSave(
  args: PersistTweakSaveArgs,
  sent: PendingTweakSave,
  result: ApplyTweaksResult | undefined,
) {
  const { id, pendingTweakSaveRef, queryClient } = args;
  // Page-exit keepalives overlap the normal save, so responses can arrive out
  // of order; an older one must not roll the confirmed base back.
  const staleConfirmation =
    (args.confirmedTweakSelectionsRef.current.revision ?? 0) > sent.revision;
  const applied = (result?.appliedTweaks ??
    sent.selections) as PendingTweakSave["selections"];
  const selectionsRevision =
    typeof result?.selectionsRevision === "number" &&
    Number.isSafeInteger(result.selectionsRevision) &&
    result.selectionsRevision >= 0
      ? result.selectionsRevision
      : args.confirmedTweakSelectionsRef.current.selectionsRevision;
  const hash = staleConfirmation
    ? args.confirmedTweakSelectionsRef.current.hash
    : typeof result?.selectionsHash === "string"
      ? result.selectionsHash
      : tweakSelectionsHash(applied, selectionsRevision);
  if (!staleConfirmation) {
    args.confirmedTweakSelectionsRef.current = {
      selections: applied,
      hash,
      selectionsRevision,
      revision: sent.revision,
    };
  }
  if (id && result?.appliedTweaks && !staleConfirmation) {
    queryClient.setQueryData(
      designMetadataQueryKey(id),
      (old: Record<string, unknown> | undefined) => {
        if (!old || typeof old !== "object") return old;
        let data: Record<string, unknown>;
        if (old.data != null && typeof old.data !== "string") return old;
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
            ...(typeof result.selectionsRevision === "number"
              ? { tweakSelectionsRevision: result.selectionsRevision }
              : {}),
          }),
        };
      },
    );
  }
  const queued = clearCompletedTweakSave(
    pendingTweakSaveRef.current,
    sent.revision,
  );
  if (queued) {
    const rebased = rebaseTweakSaveForSend(queued, hash);
    pendingTweakSaveRef.current = rebased;
    const rebasedEntry = args.createTweakSaveOutboxEntry(rebased);
    if (rebasedEntry) void args.journalTweakOutboxEntry(rebasedEntry);
  } else {
    pendingTweakSaveRef.current = null;
  }
  if (args.tweakSaveRevisionRef.current <= sent.revision) {
    args.setTweakSaveActive(false);
  }
}

/**
 * Sends the latest unconfirmed snapshot. Saves are latest-wins: at most one is
 * on the wire, and edits made meanwhile wait as one snapshot, never a backlog.
 */
export function sendLatestTweakSave(args: PersistTweakSaveArgs): void {
  const {
    acknowledgeOutboxEntry,
    applyTweaksAsync,
    canEditDesignRef,
    confirmedTweakSelectionsRef,
    createTweakSaveOutboxEntry,
    id,
    journalTweakOutboxEntry,
    keepaliveTweakSaveInFlightRef,
    keepaliveTweakSaveRevisionRef,
    noteSaveLeftQueued,
    pendingTweakSaveRef,
    setTweakSaveActive,
    t,
    tweakSaveInFlightRef,
    tweakSaveRevisionRef,
    warnChangesWillRetry,
  } = args;
  if (!id || !canEditDesignRef.current || tweakSaveInFlightRef.current) return;
  const pending = pendingTweakSaveRef.current;
  if (!pending) return;
  const confirmed = confirmedTweakSelectionsRef.current;
  const rebased = rebaseTweakSaveForSend(pending, confirmed.hash);
  // A keepalive that lands first moves the server base; accept that one too.
  const keepaliveBase = keepaliveTweakSaveInFlightRef.current;
  const sendPending: PendingTweakSave = keepaliveBase
    ? {
        ...rebased,
        inFlightSelectionsHash: keepaliveBase.selectionsHashIfApplied,
      }
    : rebased;
  const entry = createTweakSaveOutboxEntry(sendPending);
  if (!entry) return;
  tweakSaveInFlightRef.current = {
    revision: sendPending.revision,
    selectionsHashIfApplied: selectionsHashIfApplied(
      confirmed,
      sendPending.selections,
    ),
  };
  void (async () => {
    const journaled = await journalTweakOutboxEntry(entry);
    try {
      const result = (await applyTweaksAsync(
        applyTweaksParams(id, sendPending),
      )) as ApplyTweaksResult;
      confirmTweakSave(args, sendPending, result);
      if (journaled) await acknowledgeOutboxEntry(entry);
    } catch (error) {
      if (tweakSaveRevisionRef.current === sendPending.revision) {
        setTweakSaveActive(true);
      }
      const failureKind = classifyTweakSaveFailure(
        error,
        journaled,
        navigator.onLine,
      );
      // A page-exit keepalive carrying a later snapshot can land first and
      // refuse this one. That later snapshot decides; the save that follows
      // this one re-sends it and reports its own conflict if there is one.
      const overtaken =
        failureKind === "conflict" &&
        keepaliveTweakSaveRevisionRef.current > sendPending.revision;
      if (overtaken) {
        // Left to the later snapshot's save.
      } else if (failureKind === "conflict") {
        toast.error(t("designEditor.toasts.tweakConflict"));
      } else if (failureKind === "durable-retry") {
        warnChangesWillRetry();
      } else {
        toast.error(t("designEditor.toasts.tweakSaveNotDurable"));
      }
      // A conflicting snapshot can never be replayed into a save, and the
      // user was just told to redo it, so it must not wait in the outbox as
      // an unsaved change. Any other failure leaves the entry for the replay.
      if (journaled) {
        if (failureKind === "conflict") await acknowledgeOutboxEntry(entry);
        else noteSaveLeftQueued();
      }
    } finally {
      tweakSaveInFlightRef.current = null;
    }
    const next = pendingTweakSaveRef.current;
    if (next && next.revision > sendPending.revision) sendLatestTweakSave(args);
  })();
}

/**
 * Page-exit flush: always sends the latest snapshot, even with a save on the
 * wire. Either may land first, so the in-flight save's result is also an
 * accepted base.
 */
export function sendLatestTweakSaveKeepalive(args: PersistTweakSaveArgs): void {
  const {
    acknowledgeOutboxEntry,
    canEditDesignRef,
    confirmedTweakSelectionsRef,
    createTweakSaveOutboxEntry,
    id,
    journalTweakOutboxEntry,
    keepaliveTweakSaveInFlightRef,
    keepaliveTweakSaveRevisionRef,
    noteSaveLeftQueued,
    pendingTweakSaveRef,
    t,
    tweakSaveInFlightRef,
  } = args;
  const pending = pendingTweakSaveRef.current;
  if (!id || !pending || !canEditDesignRef.current) return;
  if (pending.revision <= keepaliveTweakSaveRevisionRef.current) return;
  const rebased = rebaseTweakSaveForSend(
    pending,
    confirmedTweakSelectionsRef.current.hash,
  );
  // An earlier keepalive still on the wire may land before this one, so its
  // result is the base to accept; otherwise the regular save's.
  const acceptedBase =
    keepaliveTweakSaveInFlightRef.current ?? tweakSaveInFlightRef.current;
  const sendPending: PendingTweakSave = acceptedBase
    ? {
        ...rebased,
        inFlightSelectionsHash: acceptedBase.selectionsHashIfApplied,
      }
    : rebased;
  const entry = createTweakSaveOutboxEntry(sendPending);
  if (!entry) return;
  keepaliveTweakSaveRevisionRef.current = sendPending.revision;
  const keepaliveBase: InFlightTweakSave = {
    revision: sendPending.revision,
    selectionsHashIfApplied: selectionsHashIfApplied(
      confirmedTweakSelectionsRef.current,
      sendPending.selections,
    ),
  };
  keepaliveTweakSaveInFlightRef.current = keepaliveBase;
  const settle = () => {
    if (keepaliveTweakSaveInFlightRef.current === keepaliveBase) {
      keepaliveTweakSaveInFlightRef.current = null;
    }
  };
  let result: ApplyTweaksResult | undefined;
  // The request starts before the journal write finishes, so a failure can
  // arrive first; wait for the journal result before judging what is replayable.
  let journalResult: Promise<boolean> = Promise.resolve(false);
  void sendJournaledTweakSaveKeepalive({
    journal: () => {
      journalResult = journalTweakOutboxEntry(entry);
      return journalResult;
    },
    send: () => {
      const attempt = tryCallActionKeepalive(
        "apply-tweaks",
        applyTweaksParams(id, sendPending),
      );
      if (!attempt.accepted) return attempt;
      return {
        accepted: true,
        completion: attempt.completion.then((value) => {
          result = value as ApplyTweaksResult;
        }),
      };
    },
    acknowledge: () => acknowledgeOutboxEntry(entry),
  })
    .then((landed) => {
      settle();
      if (landed) confirmTweakSave(args, sendPending, result);
      else if (keepaliveTweakSaveRevisionRef.current === sendPending.revision) {
        // The browser refused the keepalive: let the next page exit retry.
        keepaliveTweakSaveRevisionRef.current = sendPending.revision - 1;
      }
    })
    .catch(async (error: unknown) => {
      settle();
      // Let the next page exit send this snapshot again.
      if (keepaliveTweakSaveRevisionRef.current === sendPending.revision) {
        keepaliveTweakSaveRevisionRef.current = sendPending.revision - 1;
      }
      const journaled = await journalResult;
      const failureKind = classifyTweakSaveFailure(
        error,
        journaled,
        navigator.onLine,
      );
      // A conflicting snapshot can never be replayed, so it must not wait in
      // the outbox as an unsaved change.
      if (failureKind === "conflict" && journaled) {
        await acknowledgeOutboxEntry(entry);
      }
      // A hidden page is on its way out; only a page still open can be told.
      if (document.visibilityState !== "visible") return;
      if (failureKind === "conflict") {
        toast.error(t("designEditor.toasts.tweakConflict"));
      } else if (!journaled) {
        toast.error(t("designEditor.toasts.tweakSaveNotDurable"));
      } else {
        noteSaveLeftQueued();
      }
    });
}
