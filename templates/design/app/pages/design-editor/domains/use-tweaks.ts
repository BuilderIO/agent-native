import {
  callAction,
  useReconciledState,
} from "@agent-native/core/client/hooks";
import type { TweakDefinition } from "@shared/api";
import {
  readTweakSelectionsRevision,
  resolveTweaksToCssVars,
  tweakSelectionsHash,
  type TweakSelections,
} from "@shared/resolve-tweaks";
import type { QueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import {
  createDesignSaveOutboxEntry,
  journalDesignSaveOutboxEntry,
  type DesignSaveOutboxEntry,
} from "@/lib/design-save-outbox";
import {
  sendLatestTweakSave,
  sendLatestTweakSaveKeepalive,
  type PersistTweakSaveArgs,
} from "@/pages/design-editor/commands/persist-tweak-save";
import {
  areTweakSelectionsEqual,
  buildAuthoritativeTweakSelections,
} from "@/pages/design-editor/design-data-geometry-utils";
import { getTweakHandoffChanges } from "@/pages/design-editor/tweak-handoff";
import {
  createQueuedTweakSave,
  type ConfirmedTweakSelections,
  type InFlightTweakSave,
  type PendingTweakSave,
} from "@/pages/design-editor/tweak-save";

interface UseTweaksArgs {
  acknowledgeOutboxEntry: PersistTweakSaveArgs["acknowledgeOutboxEntry"];
  applyTweaksAsync: PersistTweakSaveArgs["applyTweaksAsync"];
  canEditDesign: boolean;
  canEditDesignRef: RefObject<boolean>;
  design: { data?: string | null } | null;
  designSaveActorScope: string;
  designSaveOperationSourceRef: RefObject<string>;
  id: string | undefined;
  noteSaveLeftQueued: () => void;
  queryClient: QueryClient;
  t: PersistTweakSaveArgs["t"];
  warnChangesWillRetry: () => void;
}

export interface UseTweaksResult {
  cssVarValues: Record<string, string>;
  flushPendingTweakSave: () => void;
  settlePendingTweakSaves: () => Promise<number | null>;
  resetTweakSelectionsToSourceBaseline: () => void;
  handleTweakChange: (
    tweakId: string,
    value: string | number | boolean,
  ) =>
    | { accepted: true }
    | { accepted: false; reason: "baseline_unreadable" | "not_editable" };
  setTweakSelections: Dispatch<SetStateAction<TweakSelections>>;
  tweakSelections: TweakSelections;
  tweaks: TweakDefinition[];
  pendingTweakChanges: ReturnType<typeof getTweakHandoffChanges>;
  persistedTweakSelectionsRevision: number | null;
  tweakMutationsEnabled: boolean;
}

export function useTweaks({
  acknowledgeOutboxEntry,
  applyTweaksAsync,
  canEditDesign,
  canEditDesignRef,
  design,
  designSaveActorScope,
  designSaveOperationSourceRef,
  id,
  noteSaveLeftQueued,
  queryClient,
  t,
  warnChangesWillRetry,
}: UseTweaksArgs): UseTweaksResult {
  const [tweakSaveActive, setTweakSaveActive] = useState(false);
  const pendingTweakSaveRef = useRef<PendingTweakSave | null>(null);
  const tweakSaveTimerRef = useRef<number | null>(null);
  const tweakSaveRevisionRef = useRef(0);
  const tweakSaveInFlightRef = useRef<InFlightTweakSave | null>(null);
  const keepaliveTweakSaveRevisionRef = useRef(0);
  const keepaliveTweakSaveInFlightRef = useRef<InFlightTweakSave | null>(null);
  const confirmedTweakSelectionsRef = useRef<ConfirmedTweakSelections>({
    selections: {},
    hash: tweakSelectionsHash({}),
    selectionsRevision: 0,
  });
  const journalTweakOutboxEntry = useCallback(
    async (entry: DesignSaveOutboxEntry) => {
      try {
        await journalDesignSaveOutboxEntry(entry);
        return true;
      } catch {
        // coercion-ok: `false` is the typed "not journaled" result, never
        // mistakable for success. Do not claim an offline retry exists when
        // IndexedDB itself failed — the mutation path uses this to tell
        // durable retries from edits that must stay in this tab's memory.
        return false;
      }
    },
    [],
  );
  const createTweakSaveOutboxEntry = useCallback(
    (pending: PendingTweakSave) => {
      if (!id) return null;
      return createDesignSaveOutboxEntry({
        designId: id ?? "",
        actorScope: designSaveActorScope,
        actionName: "apply-tweaks",
        resourceId: id,
        operationSource: designSaveOperationSourceRef.current,
        operationRevision: pending.revision,
        payload: {
          designId: id,
          selections: pending.selections,
          expectedSelectionsHash: pending.expectedSelectionsHash,
          ...(pending.inFlightSelectionsHash
            ? { inFlightSelectionsHash: pending.inFlightSelectionsHash }
            : {}),
        },
      });
    },
    [designSaveActorScope, id],
  );
  const tweakSaveArgs = useMemo<PersistTweakSaveArgs>(
    () => ({
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
      queryClient,
      setTweakSaveActive,
      t,
      tweakSaveInFlightRef,
      tweakSaveRevisionRef,
      warnChangesWillRetry,
    }),
    [
      acknowledgeOutboxEntry,
      applyTweaksAsync,
      createTweakSaveOutboxEntry,
      id,
      journalTweakOutboxEntry,
      noteSaveLeftQueued,
      queryClient,
      t,
      warnChangesWillRetry,
    ],
  );
  const flushPendingTweakSave = useCallback(() => {
    if (tweakSaveTimerRef.current !== null) {
      window.clearTimeout(tweakSaveTimerRef.current);
      tweakSaveTimerRef.current = null;
    }
    sendLatestTweakSave(tweakSaveArgs);
  }, [tweakSaveArgs]);
  const settlePendingTweakSaves = useCallback(async () => {
    const hadPendingSave =
      tweakSaveTimerRef.current !== null ||
      tweakSaveInFlightRef.current !== null ||
      pendingTweakSaveRef.current !== null;
    flushPendingTweakSave();
    const deadline = Date.now() + 15_000;
    while (
      tweakSaveInFlightRef.current ||
      pendingTweakSaveRef.current !== null
    ) {
      if (!tweakSaveInFlightRef.current && pendingTweakSaveRef.current) {
        throw new Error("A pending tweak save did not complete.");
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for pending tweak saves.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    const confirmed = confirmedTweakSelectionsRef.current;
    return hadPendingSave || confirmed.revision !== undefined
      ? confirmed.selectionsRevision
      : null;
  }, [flushPendingTweakSave]);
  const queueTweakSave = useCallback(
    (selections: TweakSelections) => {
      if (!id || !canEditDesignRef.current) return;
      const revision = tweakSaveRevisionRef.current + 1;
      tweakSaveRevisionRef.current = revision;
      setTweakSaveActive(true);
      const pending = createQueuedTweakSave(
        selections,
        revision,
        confirmedTweakSelectionsRef.current.hash,
        pendingTweakSaveRef.current,
      );
      pendingTweakSaveRef.current = pending;
      const entry = createTweakSaveOutboxEntry(pending);
      if (entry) void journalTweakOutboxEntry(entry);
      if (tweakSaveTimerRef.current !== null) {
        window.clearTimeout(tweakSaveTimerRef.current);
      }
      tweakSaveTimerRef.current = window.setTimeout(flushPendingTweakSave, 600);
    },
    [
      createTweakSaveOutboxEntry,
      flushPendingTweakSave,
      id,
      journalTweakOutboxEntry,
    ],
  );

  useEffect(() => {
    const handlePageHide = () => sendLatestTweakSaveKeepalive(tweakSaveArgs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handlePageHide();
    };
    const handleOnline = () => flushPendingTweakSave();
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      flushPendingTweakSave();
    };
  }, [flushPendingTweakSave, tweakSaveArgs]);

  const tweaks: TweakDefinition[] = useMemo(() => {
    if (!design?.data) return [];
    try {
      const parsed = JSON.parse(design.data);
      if (Array.isArray(parsed?.tweaks)) return parsed.tweaks;
      return [];
      // coercion-ok: unreadable design data means "no tweaks configured", which the empty list already expresses.
    } catch {
      return [];
    }
  }, [design?.data]);

  const persistedSelections: TweakSelections = useMemo(() => {
    if (!design?.data) return {};
    try {
      const parsed = JSON.parse(design.data);
      const sel = parsed?.tweakSelections;
      return sel && typeof sel === "object" && !Array.isArray(sel) ? sel : {};
      // coercion-ok: unreadable design data means "no tweak selections", which the empty object already expresses.
    } catch {
      return {};
    }
  }, [design?.data]);
  const persistedSelectionsRevision = useMemo(() => {
    if (!design?.data) return 0;
    try {
      const parsed: unknown = JSON.parse(design.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return readTweakSelectionsRevision(parsed as Record<string, unknown>);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }, [design?.data]);
  const sourceBaseline = useMemo(() => {
    if (!design?.data) return { status: "readable" as const, value: {} };
    try {
      const parsed = JSON.parse(design.data);
      const value = parsed?.tweakSourceBaseline;
      if (value === undefined)
        return { status: "readable" as const, value: {} };
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return { status: "readable" as const, value: value as TweakSelections };
      }
      return { status: "unreadable" as const };
    } catch {
      return { status: "unreadable" as const };
    }
  }, [design?.data]);
  useEffect(() => {
    if (sourceBaseline.status === "unreadable") {
      toast.warning(t("designEditor.toasts.tweakBaselineUnreadable"), {
        action: {
          label: t("designEditor.toasts.resetTweakBaseline"),
          onClick: () => {
            if (id)
              void callAction("reset-tweak-source-baseline", { designId: id });
          },
        },
      });
    }
  }, [id, sourceBaseline.status, t]);
  useLayoutEffect(() => {
    if (
      persistedSelectionsRevision !== null &&
      !tweakSaveActive &&
      !tweakSaveInFlightRef.current &&
      pendingTweakSaveRef.current === null
    ) {
      const confirmed = confirmedTweakSelectionsRef.current;
      const confirmedSaveRevision =
        confirmed.selectionsRevision === persistedSelectionsRevision &&
        areTweakSelectionsEqual(confirmed.selections, persistedSelections)
          ? confirmed.revision
          : undefined;
      confirmedTweakSelectionsRef.current = {
        selections: persistedSelections,
        hash: tweakSelectionsHash(
          persistedSelections,
          persistedSelectionsRevision,
        ),
        selectionsRevision: persistedSelectionsRevision,
        ...(confirmedSaveRevision === undefined
          ? {}
          : { revision: confirmedSaveRevision }),
      };
    }
  }, [persistedSelections, persistedSelectionsRevision, tweakSaveActive]);

  const authoritativeTweakSelections = useMemo(
    () => buildAuthoritativeTweakSelections(tweaks, persistedSelections),
    [tweaks, persistedSelections],
  );
  const [tweakSelections, setTweakSelections] = useReconciledState(
    authoritativeTweakSelections,
    {
      active: tweakSaveActive,
      equals: areTweakSelectionsEqual,
    },
  );
  const pendingTweakChanges = useMemo(() => {
    if (sourceBaseline.status === "unreadable") return [];
    return getTweakHandoffChanges({
      tweaks,
      before: sourceBaseline.value,
      after: tweakSelections,
    });
  }, [sourceBaseline, tweakSelections, tweaks]);
  const resetTweakSelectionsToSourceBaseline = useCallback(() => {
    if (
      sourceBaseline.status === "unreadable" ||
      persistedSelectionsRevision === null
    ) {
      throw new Error("The tweak source baseline is unreadable.");
    }
    setTweakSelections(sourceBaseline.value);
  }, [persistedSelectionsRevision, setTweakSelections, sourceBaseline]);

  const cssVarValues = useMemo(
    () => resolveTweaksToCssVars(tweaks, tweakSelections),
    [tweaks, tweakSelections],
  );

  const handleTweakChange = useCallback(
    (tweakId: string, value: string | number | boolean) => {
      if (
        sourceBaseline.status === "unreadable" ||
        persistedSelectionsRevision === null
      ) {
        return {
          accepted: false as const,
          reason: "baseline_unreadable" as const,
        };
      }
      if (!canEditDesignRef.current) {
        return { accepted: false as const, reason: "not_editable" as const };
      }
      setTweakSelections((prev) => {
        const next = { ...prev, [tweakId]: value };
        queueTweakSave(next);
        return next;
      });
      return { accepted: true as const };
    },
    [
      canEditDesignRef,
      persistedSelectionsRevision,
      queueTweakSave,
      sourceBaseline.status,
    ],
  );

  return {
    cssVarValues,
    flushPendingTweakSave,
    settlePendingTweakSaves,
    resetTweakSelectionsToSourceBaseline,
    handleTweakChange,
    setTweakSelections,
    tweakSelections,
    tweaks,
    pendingTweakChanges,
    persistedTweakSelectionsRevision: persistedSelectionsRevision,
    tweakMutationsEnabled:
      sourceBaseline.status === "readable" &&
      persistedSelectionsRevision !== null,
  };
}
