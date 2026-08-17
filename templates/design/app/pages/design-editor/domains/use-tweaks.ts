import {
  tryCallActionKeepalive,
  useReconciledState,
} from "@agent-native/core/client/hooks";
import type { TweakDefinition } from "@shared/api";
import {
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

import {
  createDesignSaveOutboxEntry,
  journalDesignSaveOutboxEntry,
  type DesignSaveOutboxEntry,
} from "@/lib/design-save-outbox";
import { runPersistTweakSave } from "@/pages/design-editor/commands/persist-tweak-save";
import {
  areTweakSelectionsEqual,
  buildAuthoritativeTweakSelections,
} from "@/pages/design-editor/editor-helpers";
import {
  createQueuedTweakSave,
  sendJournaledTweakSaveKeepalive,
  type PendingTweakSave,
} from "@/pages/design-editor/tweak-save";

interface UseTweaksArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  applyTweaksAsync: (variables: any) => Promise<unknown>;
  canEditDesign: boolean;
  canEditDesignRef: RefObject<boolean>;
  design: { data?: string | null } | null;
  designSaveActorScope: string;
  designSaveOperationSourceRef: RefObject<string>;
  id: string | undefined;
  queryClient: QueryClient;
  t: (key: string, values?: Record<string, unknown>) => string;
  warnChangesWillRetry: () => void;
}

export interface UseTweaksResult {
  cssVarValues: Record<string, string>;
  flushPendingTweakSave: () => void;
  handleTweakChange: (
    tweakId: string,
    value: string | number | boolean,
  ) => void;
  setTweakSelections: Dispatch<SetStateAction<TweakSelections>>;
  tweakSelections: TweakSelections;
  tweaks: TweakDefinition[];
}

/**
 * Owns the tweak (visual-knob) domain: the parsed definitions, the reconciled
 * selection state, the CSS-var projection for the canvas iframe, and the
 * debounced save queue that persists selections into designs.data.
 *
 * Every dependency array below is byte-identical to the inline version this
 * replaced. The keepalive/unload effect must stay in this hook so the 600 ms
 * debounce is flushed before the keyed editor instance unmounts.
 */
export function useTweaks({
  acknowledgeOutboxEntry,
  applyTweaksAsync,
  canEditDesign,
  canEditDesignRef,
  design,
  designSaveActorScope,
  designSaveOperationSourceRef,
  id,
  queryClient,
  t,
  warnChangesWillRetry,
}: UseTweaksArgs): UseTweaksResult {
  const [tweakSaveActive, setTweakSaveActive] = useState(false);
  const pendingTweakSaveRef = useRef<PendingTweakSave | null>(null);
  const tweakSaveTimerRef = useRef<number | null>(null);
  const tweakSaveRevisionRef = useRef(0);
  const tweakSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const tweakSaveInFlightRef = useRef(false);
  const confirmedTweakSelectionsHashRef = useRef(tweakSelectionsHash({}));
  const journalTweakOutboxEntry = useCallback(
    async (entry: DesignSaveOutboxEntry) => {
      try {
        await journalDesignSaveOutboxEntry(entry);
        return true;
      } catch {
        // Do not claim an offline retry exists when IndexedDB itself failed.
        // The mutation path below distinguishes durable retries from edits
        // that must stay in this tab's memory.
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
        },
      });
    },
    [designSaveActorScope, id],
  );
  const persistTweakSave = useCallback(
    (pending: PendingTweakSave) =>
      runPersistTweakSave(
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
        },
        pending,
      ),
    [
      acknowledgeOutboxEntry,
      applyTweaksAsync,
      createTweakSaveOutboxEntry,
      id,
      journalTweakOutboxEntry,
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
    const pending = pendingTweakSaveRef.current;
    pendingTweakSaveRef.current = null;
    if (pending) persistTweakSave(pending);
  }, [persistTweakSave]);
  const queueTweakSave = useCallback(
    (selections: TweakSelections) => {
      if (!id || !canEditDesignRef.current) return;
      const revision = tweakSaveRevisionRef.current + 1;
      tweakSaveRevisionRef.current = revision;
      setTweakSaveActive(true);
      const pending = createQueuedTweakSave(
        selections,
        revision,
        confirmedTweakSelectionsHashRef.current,
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
    const handlePageHide = () => {
      const pending = pendingTweakSaveRef.current;
      if (!id || !pending || !canEditDesignRef.current) return;
      if (tweakSaveInFlightRef.current) return;
      // Keep the normal timer/pending entry intact for bfcache restores. The
      // keepalive is the unload safety net; if the page survives, the regular
      // mutation still settles state and confirms persistence.
      const entry = createTweakSaveOutboxEntry(pending);
      if (!entry) return;
      void sendJournaledTweakSaveKeepalive({
        journal: () => journalTweakOutboxEntry(entry),
        send: () =>
          tryCallActionKeepalive("apply-tweaks", entry.payload as any),
        acknowledge: () => acknowledgeOutboxEntry(entry),
      }).catch(() => {});
    };
    const handleOnline = () => {
      if (pendingTweakSaveRef.current && !tweakSaveInFlightRef.current) {
        flushPendingTweakSave();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("online", handleOnline);
      // Client-side navigation used to cancel the 600 ms debounce and drop
      // the user's final knob position. Flush it synchronously into the
      // mutation pipeline before this keyed editor instance unmounts.
      flushPendingTweakSave();
    };
  }, [
    acknowledgeOutboxEntry,
    createTweakSaveOutboxEntry,
    flushPendingTweakSave,
    id,
    journalTweakOutboxEntry,
  ]);

  // Parse design.data for agent-supplied tweaks. The agent writes a JSON blob
  // to designs.data containing { tweaks: TweakDefinition[], ... }; we surface
  // the tweaks as live controls bound to the design's CSS custom properties.
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

  // Persisted user knob values live in designs.data.tweakSelections (written by
  // the apply-tweaks action). Restoring them on load is what makes the
  // visual-tune round-trip survive a refresh and feed the snapshot/handoff.
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
  useLayoutEffect(() => {
    if (
      !tweakSaveActive &&
      !tweakSaveInFlightRef.current &&
      pendingTweakSaveRef.current === null
    ) {
      confirmedTweakSelectionsHashRef.current =
        tweakSelectionsHash(persistedSelections);
    }
  }, [persistedSelections, tweakSaveActive]);

  // Tweak values are keyed by tweak id while in the panel, then mapped to
  // CSS-var -> value for the iframe so the design's :root block picks them up.
  // Persisted selections are authoritative for agent edits; a local queued
  // save temporarily pauses adoption so stale refetches don't clobber a drag.
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

  // Map tweak selections (id -> value) to CSS-var assignments (--var -> value)
  // for the iframe bridge. Shared with the snapshot/handoff actions via
  // `@shared/resolve-tweaks` so the UI and external agents resolve identically.
  const cssVarValues = useMemo(
    () => resolveTweaksToCssVars(tweaks, tweakSelections),
    [tweaks, tweakSelections],
  );

  const handleTweakChange = useCallback(
    (tweakId: string, value: string | number | boolean) => {
      setTweakSelections((prev) => {
        if (!canEditDesign) return prev;
        const next = { ...prev, [tweakId]: value };
        queueTweakSave(next);
        return next;
      });
    },
    [canEditDesign, queueTweakSave],
  );

  return {
    cssVarValues,
    flushPendingTweakSave,
    handleTweakChange,
    setTweakSelections,
    tweakSelections,
    tweaks,
  };
}
