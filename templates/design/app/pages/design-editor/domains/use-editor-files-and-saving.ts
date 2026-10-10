import { appBasePath } from "@agent-native/core/client/api-path";
import {
  useActionQuery,
  callAction,
  tryCallActionKeepalive,
  readClientAppState,
} from "@agent-native/core/client/hooks";
import { withShareLinkAttribution } from "@agent-native/core/client/sharing";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import {
  parseCreativeContexts,
  useCreativeContexts,
  useCreativeContextState,
} from "@agent-native/creative-context/client";
import { type CodeLayerSource } from "@shared/code-layer";
import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";
import type { LayoutGrid } from "@shared/layout-grid";
import {
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
  isNodeRewriteProposal,
  isPendingDesignReprompt,
  type NodeRewriteProposal,
} from "@shared/node-rewrite";
import { normalizeDesignSourceType } from "@shared/source-mode";
import { sourceContentHash } from "@shared/source-workspace";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { type DocumentColorSourceFile } from "@/components/design/EditPanel";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import { designSystemPickerOptions } from "@/components/editor/design-start-pickers";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useEditorPreferences } from "@/hooks/use-editor-preferences";
import {
  acknowledgeDesignSaveOutboxEntry,
  createDesignSaveOutboxEntry,
  discardDesignSaveOutboxEntry,
  drainDesignSaveOutbox,
  journalDesignSaveOutboxEntry,
  type DesignSaveOutboxEntry,
} from "@/lib/design-save-outbox";
import { isDesignSystemUsableForGeneration } from "@/lib/design-system-data";

import type {
  LiveScreenSnapshot,
  PatchProofState,
  PostAuthDesignIntent,
  RuntimeLayerSnapshot,
} from "../command-types";
import { runPublishCanonicalContent } from "../commands/publish-canonical-content";
import { runClearVisualEditSnapshotPublications } from "../commands/publish-visual-edit-snapshot";
import {
  runFileContentSaveKeepalive,
  runQueueFileContentSave,
  runSaveFileContent,
} from "../commands/save-file-content";
import { runSetLayoutGrid } from "../commands/set-layout-grid";
import {
  flushCommitsAfterPaint,
  flushCommitsOnInput,
} from "../commit-after-paint";
import {
  rebaseDesignDataWithPendingOperations,
  type PendingDesignDataOperations,
} from "../data-operations";
import {
  deriveOverviewScreens,
  reuseUnchangedOverviewScreens,
  type OverviewScreen,
} from "../derive/overview-screens";
import {
  getCanvasFrameGeometry,
  getDesignDataRecord,
  getLayoutGrids,
  nextLocalhostScreenPosition,
  parseDesignDataJson,
} from "../design-data-geometry-utils";
import { createEditorSaveOperationSource } from "../editor-session";
import {
  type FileContentSaveRequest,
  flushFileContentSavesOnBackground,
  flushPendingFileContentSavesOnCleanup,
  getDesignEditorShareUrl,
  resolveServerFiles,
  shouldRetirePendingLocalFileContent,
  shouldClearLatestUnloadSaveForOutboxEntry,
  shouldSendKeepalive,
} from "../editor-state";
import {
  resolveOverviewScreenSourceType,
  shouldClearReloadedVisualEditHandoff,
  shouldSuppressReloadedVisualEditHandoff,
} from "../pending-edits";
import {
  classifyDesignSaveFailure,
  designSaveErrorMessage,
  reportDesignSaveFailure,
} from "../save-failure";
import {
  designFileCodeLayerSource,
  forgetPreparedSourcesExcept,
  prepareCanonicalSourceContent,
} from "../source-publication";
import { shouldAskOnNewDesignArrival } from "../tool-state";
import type { EditorCore } from "./use-editor-core";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import { useTweaks } from "./use-tweaks";

export function useEditorFilesAndSaving({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
}) {
  const {
    t,
    id,
    session,
    isSignedIn,
    sessionResolved,
    location,
    initialSearchParams,
    searchParams,
    queryClient,
    shellMode,
    embedded,
    isVisualEditSurface,
    isLiveCanvasShareLink,
    readOnlyWidget,
    widgetEmbed,
    viewModeRef,
    pendingVisualEditHandoffPublicationRef,
    pendingVisualEditReloadedHandoffRef,
  } = editorCore;
  const {
    setActiveInspectorTab,
    activeBreakpointWidthState,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
  } = editorHistory;
  const {
    setRetryablePrompt,
    design,
    pendingNodeRewriteStateVersion,
    canShareDesign,
    canEditDesign,
    publicVisualEdit,
    visualEditSnapshotPublicationState,
    creativeContextLab,
    tweaksEnabled,
    canEditDesignRef,
    canPersistDesignSourceRef,
    rawServerFilesByIdRef,
    historyFilesRef,
    pendingLocalFileContentsRef,
    setPendingLocalFileContentsRevision,
    markPendingLocalFileContent,
    clearPendingLocalFileContent,
    rollbackPendingLocalFileContent,
    updateFileMutation,
    updateDesignMutation,
    applyTweaksAsync,
    duplicateDesignMutation,
    migrateBoardObjectsMutation,
    pendingLocalFileContentsSnapshot,
    scheduleVisualEditSnapshotPublication,
  } = editorGenerationAndAccess;

  const designSaveActorScope = session?.userId ?? "anonymous";
  const navigate = useNavigate();
  const postAuthIntent = useMemo<PostAuthDesignIntent | null>(() => {
    const value = searchParams.get("intent");
    return value === "save" || value === "share" ? value : null;
  }, [searchParams]);
  const locallyPinnedHeightIdsRef = useRef<Set<string>>(new Set());
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [optimisticFrameGeometryById, setOptimisticFrameGeometryById] =
    useState<Record<string, FrameGeometry>>({});
  const designSaveOperationSourceRef = useRef(
    createEditorSaveOperationSource(),
  );
  const pendingFrameGeometryOperationsForUnloadRef =
    useRef<PendingDesignDataOperations>({});
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTweakPrompt, setShowTweakPrompt] = useState(false);
  const tweakPromptAnchorRef = useRef<HTMLElement | null>(null);
  const [promptDesignSystemId, setPromptDesignSystemId] = useState<
    string | null | undefined
  >(undefined);
  const creativeContextEnabled = creativeContextLab.enabled;
  // §6.4 — "show all breakpoints" toggle: when true (default) the overview
  // renders one linked read-write frame per breakpoint width next to each
  // screen (same document at each viewport width); hiding keeps the chips
  // usable while decluttering the board.
  const [breakpointFramesHidden, setBreakpointFramesHidden] = useState(false);
  const [, setPatchProof] = useState<PatchProofState | null>(null);
  const pendingFileSavesRef = useRef<Record<string, FileContentSaveRequest>>(
    {},
  );
  const fileSaveChainsRef = useRef<Record<string, Promise<void>>>({});
  const fileSaveOperationRevisionRef = useRef<Record<string, number>>({});
  const latestFileSaveForUnloadRef = useRef<
    Record<string, FileContentSaveRequest>
  >({});
  const fileSaveOutboxJournalPromisesRef = useRef(
    new WeakMap<FileContentSaveRequest, Promise<boolean>>(),
  );
  const fileSaveTimersRef = useRef<Record<string, number>>({});
  const postAuthSaveRef = useRef<string | null>(null);

  // A directory widget's session is read-only, so a refused save is expected
  // there and not a lost connection or a lost edit to warn about.
  const warnChangesWillRetry = useCallback(() => {
    if (readOnlyWidget) return;
    toast.warning(t("visualEditor.changesSaveWhenReconnected"), {
      id: "design-save-outbox-warning",
    });
  }, [readOnlyWidget, t]);

  const warnChangesDiscarded = useCallback(() => {
    if (readOnlyWidget) return;
    toast.error(t("visualEditor.changesDiscarded"), {
      id: "design-save-outbox-discarded",
    });
  }, [readOnlyWidget, t]);

  const reportSaveFailure = useCallback(
    (error: unknown) =>
      reportDesignSaveFailure(error, navigator.onLine, {
        warnChangesWillRetry,
        showConflict: () => {
          if (readOnlyWidget) return;
          toast.error(t("designEditor.toasts.saveConflict"), {
            id: "design-save-error",
          });
        },
        showError: (message) => {
          if (readOnlyWidget) return;
          toast.error(message ?? t("common.genericError"), {
            id: "design-save-error",
          });
        },
      }),
    [readOnlyWidget, t, warnChangesWillRetry],
  );

  const journalOutboxEntry = useCallback(
    async (entry: DesignSaveOutboxEntry) => {
      try {
        await journalDesignSaveOutboxEntry(entry);
        return true;
        // coercion-ok: IndexedDB journaling is optional; the network save remains authoritative.
      } catch {
        // IndexedDB can be unavailable in private/embedded contexts. The
        // network mutation still runs below, so this is not a disconnect and
        // must not show “save when reconnected” on every edit.
        return false;
      }
    },
    [],
  );

  const acknowledgeOutboxEntry = useCallback(
    async (entry: DesignSaveOutboxEntry) => {
      try {
        await acknowledgeDesignSaveOutboxEntry(entry);
      } catch {
        // The server save already succeeded. A local outbox cleanup failure
        // is neither data loss nor a connectivity warning; operation ids make
        // a later replay idempotent.
        // coercion-ok: the server mutation already succeeded; cleanup is best effort.
      }
    },
    [],
  );

  const retryDesignSaveOutbox = useCallback(async () => {
    if (!id) return;
    try {
      const result = await drainDesignSaveOutbox({
        designId: id,
        actorScope: designSaveActorScope,
      });
      if (result.rebased.length > 0) {
        toast.error(t("designEditor.toasts.saveConflict"), {
          id: "design-save-conflict:outbox",
        });
        for (const { entry } of result.rebased) {
          const content = entry.payload.content;
          if (typeof content === "string") {
            rollbackPendingLocalFileContent(entry.resourceId, content);
          }
        }
      }
      for (const entry of [
        ...result.saved,
        ...result.rebased.map(({ entry }) => entry),
        ...result.dropped.map(({ entry }) => entry),
      ]) {
        if (
          shouldClearLatestUnloadSaveForOutboxEntry(
            latestFileSaveForUnloadRef.current[entry.resourceId],
            entry,
          )
        ) {
          delete latestFileSaveForUnloadRef.current[entry.resourceId];
        }
      }
      if (result.saved.length > 0 || result.rebased.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      }
      if (result.failed.length > 0 && navigator.onLine === false) {
        warnChangesWillRetry();
      }
      if (result.dropped.length > 0) {
        warnChangesDiscarded();
      }
    } catch (error) {
      if (classifyDesignSaveFailure(error, navigator.onLine) === "offline") {
        warnChangesWillRetry();
      }
    }
  }, [
    designSaveActorScope,
    id,
    rollbackPendingLocalFileContent,
    queryClient,
    t,
    warnChangesWillRetry,
    warnChangesDiscarded,
  ]);

  useEffect(() => {
    const handleRetryOpportunity = () => void retryDesignSaveOutbox();
    void retryDesignSaveOutbox();
    window.addEventListener("online", handleRetryOpportunity);
    window.addEventListener("pageshow", handleRetryOpportunity);
    return () => {
      window.removeEventListener("online", handleRetryOpportunity);
      window.removeEventListener("pageshow", handleRetryOpportunity);
    };
  }, [retryDesignSaveOutbox, sessionResolved]);

  const createFileSaveOutboxEntry = useCallback(
    (pending: FileContentSaveRequest) => {
      if (!id || shellMode) return null;
      return createDesignSaveOutboxEntry({
        designId: id ?? "",
        actorScope: designSaveActorScope,
        actionName: "update-file",
        resourceId: pending.id,
        operationSource: pending.operationSource,
        operationRevision: pending.operationRevision,
        payload: {
          id: pending.id,
          content: pending.content,
          syncCollab: pending.syncCollab,
          operationSource: pending.operationSource,
          operationRevision: pending.operationRevision,
          expectedVersionHash:
            pending.unloadExpectedVersionHash ?? pending.expectedVersionHash,
          ...(pending.identityMigrationSourceContent !== undefined
            ? { identityOnly: true }
            : {}),
        },
      });
    },
    [designSaveActorScope, id, shellMode],
  );

  const cancelQueuedFileContentSave = useCallback(
    (fileId: string) => {
      const queued = pendingFileSavesRef.current[fileId];
      const timer = fileSaveTimersRef.current[fileId];
      if (timer) {
        window.clearTimeout(timer);
        delete fileSaveTimersRef.current[fileId];
      }
      const latest = latestFileSaveForUnloadRef.current[fileId];
      delete pendingFileSavesRef.current[fileId];
      delete latestFileSaveForUnloadRef.current[fileId];
      const pending = queued ?? latest;
      const entry = pending ? createFileSaveOutboxEntry(pending) : null;
      if (entry) {
        void discardDesignSaveOutboxEntry(entry).catch(() => {});
      }
    },
    [createFileSaveOutboxEntry, warnChangesWillRetry],
  );

  const saveFileContent = useCallback(
    (
      pending: FileContentSaveRequest,
      outboxJournalPromise?: Promise<boolean>,
    ) =>
      runSaveFileContent(
        {
          acknowledgeOutboxEntry,
          canEditDesignRef,
          createFileSaveOutboxEntry,
          designId: id,
          fileSaveChainsRef,
          fileSaveOutboxJournalPromisesRef,
          journalOutboxEntry,
          latestFileSaveForUnloadRef,
          rollbackPendingLocalFileContent,
          markPendingLocalFileContent,
          getPendingBaseContent: (fileId) =>
            pendingLocalFileContentsRef.current.get(fileId)?.baseContent,
          readLiveFileContent: id
            ? async (fileId) =>
                (
                  await callAction<{ content: string }>(
                    "read-source-file",
                    { designId: id, fileId },
                    { method: "GET" },
                  )
                ).content
            : undefined,
          queryClient,
          setPatchProof,
          t,
          updateFileMutation,
          warnChangesWillRetry,
        },
        pending,
        outboxJournalPromise,
      ),
    [
      acknowledgeOutboxEntry,
      createFileSaveOutboxEntry,
      id,
      journalOutboxEntry,
      rollbackPendingLocalFileContent,
      markPendingLocalFileContent,
      queryClient,
      t,
      updateFileMutation,
      warnChangesWillRetry,
    ],
  );

  const queueFileContentSave = useCallback(
    (
      fileId: string,
      content: string,
      options: {
        expectedVersionHash: string;
        syncCollab?: boolean;
        immediate?: boolean;
        identityMigrationSourceContent?: string;
      },
    ) => {
      return runQueueFileContentSave(
        {
          canEditDesignRef,
          createFileSaveOutboxEntry,
          fileSaveOperationRevisionRef,
          fileSaveOutboxJournalPromisesRef,
          fileSaveTimersRef,
          journalOutboxEntry,
          latestFileSaveForUnloadRef,
          markPendingLocalFileContent,
          operationSource: designSaveOperationSourceRef.current,
          pendingFileSavesRef,
          saveFileContent,
          setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
          clearTimer: (timerId) => window.clearTimeout(timerId),
        },
        fileId,
        content,
        options,
      );
    },
    [
      createFileSaveOutboxEntry,
      journalOutboxEntry,
      markPendingLocalFileContent,
      saveFileContent,
    ],
  );

  const cancelIdentityMigration = useCallback(
    (fileId: string) => {
      const pending = pendingLocalFileContentsRef.current.get(fileId);
      if (pending?.identityMigrationSourceContent === undefined) return;
      const queued = pendingFileSavesRef.current[fileId];
      const latest = latestFileSaveForUnloadRef.current[fileId];
      if (queued?.identityMigrationSourceContent !== undefined) {
        const timer = fileSaveTimersRef.current[fileId];
        if (timer) window.clearTimeout(timer);
        delete fileSaveTimersRef.current[fileId];
        delete pendingFileSavesRef.current[fileId];
      }
      if (latest?.identityMigrationSourceContent !== undefined) {
        delete latestFileSaveForUnloadRef.current[fileId];
        const entry = createFileSaveOutboxEntry(latest);
        if (entry) void discardDesignSaveOutboxEntry(entry).catch(() => {});
      }
      clearPendingLocalFileContent(fileId, pending.content);
    },
    [clearPendingLocalFileContent, createFileSaveOutboxEntry],
  );

  const publishCanonicalContent = useCallback(
    (
      fileId: string,
      sourceContent: string,
      fileType: string = "html",
    ): string =>
      runPublishCanonicalContent(
        {
          canEditDesignRef,
          canPersistDesignSourceRef,
          pendingLocalFileContentsRef,
          cancelIdentityMigration,
          queueFileContentSave,
        },
        fileId,
        sourceContent,
        fileType,
      ),
    [cancelIdentityMigration, queueFileContentSave],
  );

  const flushPendingFileContentSavesForBackground = useCallback(async () => {
    if (!canEditDesignRef.current) return;
    const flushed = flushFileContentSavesOnBackground(
      pendingFileSavesRef.current,
      latestFileSaveForUnloadRef.current,
      Object.values(fileSaveTimersRef.current),
      saveFileContent,
      window.clearTimeout,
    );
    fileSaveTimersRef.current = {};
    pendingFileSavesRef.current = {};
    await flushed;
    await Promise.all(Object.values(fileSaveChainsRef.current));
  }, [saveFileContent]);

  const sendFileContentSaveKeepalive = useCallback(
    (pending: FileContentSaveRequest) => {
      const collabLive = pending.syncCollab === false;
      if (!shouldSendKeepalive(true, collabLive)) return;
      runFileContentSaveKeepalive(
        {
          acknowledgeOutboxEntry,
          createFileSaveOutboxEntry,
          journalOutboxEntry,
          latestFileSaveForUnloadRef,
          outboxJournalPromise:
            fileSaveOutboxJournalPromisesRef.current.get(pending),
          sendKeepalive: (payload) =>
            tryCallActionKeepalive("update-file", payload as any),
        },
        pending,
      );
    },
    [acknowledgeOutboxEntry, createFileSaveOutboxEntry, journalOutboxEntry],
  );

  useEffect(() => flushCommitsOnInput(window), []);
  useEffect(() => {
    const sendPendingKeepaliveSaves = () => {
      if (!canEditDesignRef.current) return;
      for (const pending of Object.values(pendingFileSavesRef.current)) {
        latestFileSaveForUnloadRef.current[pending.id] = pending;
      }
      Object.values(latestFileSaveForUnloadRef.current).forEach(
        sendFileContentSaveKeepalive,
      );
    };
    const handlePageHide = () => {
      flushCommitsAfterPaint();
      sendPendingKeepaliveSaves();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      flushPendingFileContentSavesOnCleanup(
        pendingFileSavesRef.current,
        Object.values(fileSaveTimersRef.current),
        saveFileContent,
        window.clearTimeout,
      );
      fileSaveTimersRef.current = {};
      pendingFileSavesRef.current = {};
    };
  }, [saveFileContent, sendFileContentSaveKeepalive]);

  const {
    cssVarValues,
    flushPendingTweakSave,
    handleTweakChange,
    setTweakSelections,
    tweakSelections,
    tweaks,
  } = useTweaks({
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
  });
  const systemsEnabled = useDesignSystemWorkflows();
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems(isSignedIn && showPrompt && systemsEnabled);
  const designSystemOptions = useMemo(
    () => designSystemPickerOptions(designSystems),
    [designSystems],
  );
  const {
    preferences: editorPreferences,
    setPreferences: setEditorPreferences,
  } = useEditorPreferences();

  useEffect(() => {
    if (!id || !design || !isSignedIn || !postAuthIntent) return;

    const shouldDuplicate =
      postAuthIntent === "share" ? !canShareDesign : !canEditDesign;
    if (!shouldDuplicate) return;

    const key = `${postAuthIntent}:${id}`;
    if (postAuthSaveRef.current === key) return;
    postAuthSaveRef.current = key;

    duplicateDesignMutation
      .mutateAsync({ id, title: design.title } as any)
      .then((result: any) => {
        if (!result?.id) throw new Error("Missing copied design id");
        const nextSearch = postAuthIntent === "share" ? "?intent=share" : "";
        void navigate(`/design/${result.id}${nextSearch}`, { replace: true });
      })
      .catch(() => {
        postAuthSaveRef.current = null;
        toast.error(t("designEditor.toasts.saveCopyError"));
      });
  }, [
    canEditDesign,
    canShareDesign,
    design,
    duplicateDesignMutation,
    id,
    isSignedIn,
    navigate,
    postAuthIntent,
    t,
  ]);

  const creativeContextsQuery = useCreativeContexts(
    {},
    { enabled: creativeContextEnabled },
  );
  const creativeContextState = useCreativeContextState({
    enabled: creativeContextEnabled,
  });
  const creativeContextOptions = useMemo(
    () =>
      parseCreativeContexts(creativeContextsQuery.data)
        .filter((context) => context.memberCount > 0)
        .map((context) => ({ id: context.id, name: context.name })),
    [creativeContextsQuery.data],
  );
  const creativeContextPersistRef = useRef<Promise<unknown> | null>(null);
  const handleCreativeContextChange = useCallback(
    (contextId: string | null) => {
      creativeContextPersistRef.current = creativeContextState
        .setState({
          ...creativeContextState.state,
          contextMode: "auto",
          selectedContextId: contextId,
          pinnedPackId: null,
        })
        .catch((error) => {
          toast.error(t("creativeContext.stateSaveFailed"));
          throw error;
        });
    },
    [creativeContextState, t],
  );
  const resolvePromptDesignSystemId = useCallback(() => {
    if (design?.designSystemId) return design.designSystemId;
    if (!systemsEnabled) return null;
    if (
      defaultSystem &&
      isDesignSystemUsableForGeneration(defaultSystem.data)
    ) {
      return defaultSystem.id;
    }
    return (
      designSystems.find((system) =>
        isDesignSystemUsableForGeneration(system.data),
      )?.id ?? null
    );
  }, [defaultSystem, design?.designSystemId, designSystems, systemsEnabled]);

  const selectedPromptDesignSystemId = !systemsEnabled
    ? (design?.designSystemId ?? null)
    : promptDesignSystemId === undefined
      ? designSystemsLoading
        ? undefined
        : resolvePromptDesignSystemId()
      : promptDesignSystemId;

  const handlePromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && !canEditDesign) return;
      setShowPrompt(open);
      if (open) {
        setPromptDesignSystemId(design?.designSystemId ?? undefined);
      } else {
        setPromptDesignSystemId(undefined);
      }
    },
    [canEditDesign, design?.designSystemId],
  );

  const handleTweakPromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && (!canEditDesign || !tweaksEnabled)) return;
      setShowTweakPrompt(open);
      if (!open) {
        tweakPromptAnchorRef.current = null;
      }
    },
    [canEditDesign, tweaksEnabled],
  );

  const handleRequestTweaks = useCallback(
    (anchor: HTMLElement) => {
      if (!canEditDesign || !tweaksEnabled) return;
      tweakPromptAnchorRef.current = anchor;
      setActiveInspectorTab("tweaks");
      setShowTweakPrompt(true);
    },
    [canEditDesign, tweaksEnabled],
  );

  useEffect(() => {
    if (!design?.title) return;
    const nextTitle = `${normalizeDocumentTitle(design.title, "Untitled design")} — Design`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) {
        document.title = previousTitle;
      }
    };
  }, [design?.title]);

  const commitTitleEdit = useCallback(() => {
    setTitleEditing(false);
    if (!id || !canEditDesign) return;
    const next = titleDraft.trim();
    if (!next || next === design?.title) return;

    const designQueryKey = ["action", "get-design", { id }];
    const previousDesign = queryClient.getQueryData(designQueryKey);
    const previousListDesignsQueries = queryClient.getQueriesData({
      queryKey: ["action", "list-designs"],
    });
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object") return old;
      return { ...old, title: next };
    });
    queryClient.setQueriesData(
      { queryKey: ["action", "list-designs"] },
      (old: any) => {
        if (!old) return old;
        return {
          ...old,
          designs: (old.designs ?? []).map((d: any) =>
            d.id === id ? { ...d, title: next } : d,
          ),
        };
      },
    );

    updateDesignMutation.mutate({ id, title: next } as any, {
      onError: () => {
        queryClient.setQueryData(designQueryKey, previousDesign);
        for (const [queryKey, data] of previousListDesignsQueries) {
          queryClient.setQueryData(queryKey, data);
        }
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      },
    });
  }, [
    canEditDesign,
    design?.title,
    id,
    queryClient,
    titleDraft,
    updateDesignMutation,
  ]);

  const handleTitleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commitTitleEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setTitleEditing(false);
      }
    },
    [commitTitleEdit],
  );

  const serverFiles = resolveServerFiles(design);
  rawServerFilesByIdRef.current = new Map(
    serverFiles.map((file) => [file.id, file]),
  );
  useEffect(() => {
    forgetPreparedSourcesExcept(new Set(serverFiles.map((file) => file.id)));
  }, [serverFiles]);
  useEffect(() => {
    if (pendingLocalFileContentsRef.current.size === 0) return;
    let changed = false;
    for (const file of serverFiles) {
      const pending = pendingLocalFileContentsRef.current.get(file.id);
      if (!shouldRetirePendingLocalFileContent(pending, file)) continue;
      pendingLocalFileContentsRef.current.delete(file.id);
      changed = true;
    }
    if (changed) {
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    }
  }, [serverFiles]);
  const files = useMemo(
    () =>
      serverFiles.map((file) => {
        const sourceContent =
          pendingLocalFileContentsSnapshot.get(file.id)?.content ??
          file.content ??
          "";
        const prepared = prepareCanonicalSourceContent(sourceContent, {
          fileId: file.id,
          fileType: file.fileType,
          source: designFileCodeLayerSource(id, file.id, file.filename),
        });
        return prepared.content === file.content
          ? file
          : { ...file, content: prepared.content };
      }),
    [id, pendingLocalFileContentsSnapshot, serverFiles],
  );
  const getComponentExpectedFiles = useCallback(
    () =>
      files
        .filter((file) => file.fileType === "html")
        .map((file) => ({
          fileId: file.id,
          versionHash: sourceContentHash(file.content),
        })),
    [files],
  );
  historyFilesRef.current = files;

  const codeLayerSourceForScreen = useCallback(
    (
      screenId: string,
      kind: "design-file" | "inline-html" = "design-file",
    ): CodeLayerSource =>
      designFileCodeLayerSource(
        id,
        screenId,
        files.find((file) => file.id === screenId)?.filename,
        kind,
      ),
    [files, id],
  );
  const [pendingNodeRewriteProposals, setPendingNodeRewriteProposals] =
    useState<NodeRewriteProposal[]>([]);
  const proposalFileIdsKey = files.map((file) => file.id).join("\u0000");
  const proposalFileIds = useMemo(
    () => (proposalFileIdsKey ? proposalFileIdsKey.split("\u0000") : []),
    [proposalFileIdsKey],
  );
  useEffect(() => {
    if (!id || proposalFileIds.length === 0) {
      setPendingNodeRewriteProposals([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      proposalFileIds.map(async (fileId) => {
        // coercion-ok: missing pending state means there is no active reprompt.
        const pending = await readClientAppState(
          designRepromptPendingStateKey(id, fileId),
        ).catch(() => null); // coercion-ok: missing pending state means no active reprompt.
        if (!isPendingDesignReprompt(pending)) return null;
        // coercion-ok: missing proposal state means the reprompt has no result.
        const current = await readClientAppState(
          designRepromptProposalStateKey(id, fileId, pending.repromptId),
        ).catch(() => null); // coercion-ok: missing state means the reprompt has no result.
        if (isNodeRewriteProposal(current)) return current;
        if (!pending.priorProposalId || !pending.priorRepromptId) return null;
        // coercion-ok: missing prior state means there is no earlier proposal.
        const prior = await readClientAppState(
          designRepromptProposalStateKey(id, fileId, pending.priorRepromptId),
        ).catch(() => null); // coercion-ok: missing state means no earlier proposal.
        return isNodeRewriteProposal(prior) &&
          prior.proposalId === pending.priorProposalId
          ? prior
          : null;
      }),
    ).then((values) => {
      if (cancelled) return;
      setPendingNodeRewriteProposals(
        values
          .filter(isNodeRewriteProposal)
          .filter(
            (proposal) =>
              proposal.designId === id &&
              proposalFileIds.includes(proposal.fileId),
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pendingNodeRewriteStateVersion, id, proposalFileIds]);
  const pendingNodeRewriteByFile = useMemo(
    () =>
      new Map(
        pendingNodeRewriteProposals.map((proposal) => [
          proposal.fileId,
          proposal,
        ]),
      ),
    [pendingNodeRewriteProposals],
  );
  const pendingNodeRewriteScreenIds = useMemo(
    () => new Set(pendingNodeRewriteByFile.keys()),
    [pendingNodeRewriteByFile],
  );
  const documentColorFiles = useMemo<DocumentColorSourceFile[]>(
    () => files.map((file) => ({ id: file.id, content: file.content })),
    [files],
  );
  const [liveScreenSnapshotsById, setLiveScreenSnapshotsById] = useState<
    Record<string, LiveScreenSnapshot>
  >({});
  const scheduleVisualEditSnapshotRef = useRef(
    (_screenId: string, _html: string, _reservationToken?: string) => {},
  );
  const [runtimeLayerSnapshotsById, setRuntimeLayerSnapshotsById] = useState<
    Record<string, RuntimeLayerSnapshot>
  >({});
  const [screenRootComputedStylesById, setScreenRootComputedStylesById] =
    useState<Record<string, Record<string, string>>>({});
  const screenRootComputedStylesByIdRef = useRef(screenRootComputedStylesById);
  screenRootComputedStylesByIdRef.current = screenRootComputedStylesById;
  const screenRootStyleCallbacksRef = useRef<
    Map<string, (styles: Record<string, string>) => void>
  >(new Map());
  const runtimeLayerSnapshotsByIdRef = useRef<
    Record<string, RuntimeLayerSnapshot>
  >({});
  useEffect(() => {
    runtimeLayerSnapshotsByIdRef.current = runtimeLayerSnapshotsById;
  }, [runtimeLayerSnapshotsById]);
  useEffect(() => {
    const liveFileIds = new Set(serverFiles.map((file) => file.id));
    setLiveScreenSnapshotsById((current) => {
      let changed = false;
      const next: Record<string, LiveScreenSnapshot> = {};
      Object.entries(current).forEach(([fileId, snapshot]) => {
        if (!liveFileIds.has(fileId)) {
          changed = true;
          return;
        }
        next[fileId] = snapshot;
      });
      return changed ? next : current;
    });
    setRuntimeLayerSnapshotsById((current) => {
      let changed = false;
      const next: Record<string, RuntimeLayerSnapshot> = {};
      Object.entries(current).forEach(([fileId, snapshot]) => {
        if (!liveFileIds.has(fileId)) {
          changed = true;
          return;
        }
        next[fileId] = snapshot;
      });
      return changed ? next : current;
    });
    setScreenRootComputedStylesById((current) => {
      let changed = false;
      const next: Record<string, Record<string, string>> = {};
      Object.entries(current).forEach(([fileId, styles]) => {
        const breakpointMarker = fileId.lastIndexOf("::bp-");
        const screenId =
          breakpointMarker < 0 ? fileId : fileId.slice(0, breakpointMarker);
        if (!liveFileIds.has(screenId)) {
          changed = true;
          return;
        }
        next[fileId] = styles;
      });
      return changed ? next : current;
    });
    for (const key of screenRootStyleCallbacksRef.current.keys()) {
      const breakpointMarker = key.lastIndexOf("::bp-");
      const screenId =
        breakpointMarker < 0 ? key : key.slice(0, breakpointMarker);
      if (!liveFileIds.has(screenId)) {
        screenRootStyleCallbacksRef.current.delete(key);
      }
    }
  }, [serverFiles]);
  const designDataJson = useMemo(
    () => parseDesignDataJson(design?.data),
    [design?.data],
  );
  const designSourceType = useMemo(
    () =>
      normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
      normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
      "inline",
    [designDataJson.sourceMode, designDataJson.sourceType],
  );
  const designSourceTypeRef = useRef(designSourceType);
  designSourceTypeRef.current = designSourceType;

  const layoutGrids = useMemo(
    () => getLayoutGrids(designDataJson),
    [designDataJson],
  );

  const designDataJsonRef = useRef(designDataJson);
  const handleLayoutGridChange = useCallback(
    (frameId: string, next: Partial<LayoutGrid> | null) =>
      runSetLayoutGrid(
        {
          id,
          canEditDesign: canEditDesignRef.current,
          designDataJsonRef,
          queryClient,
          updateDesignMutation,
        },
        frameId,
        next,
      ),
    [id, queryClient, updateDesignMutation],
  );
  const handleLayoutGridChangeRef = useRef(handleLayoutGridChange);
  const handleToggleLayoutGrids = useCallback(() => {
    const frameIds = Object.keys(layoutGrids);
    if (frameIds.length === 0) return;
    const anyVisible = frameIds.some(
      (frameId) => layoutGrids[frameId]!.visible,
    );
    for (const frameId of frameIds) {
      handleLayoutGridChangeRef.current?.(frameId, {
        ...layoutGrids[frameId]!,
        visible: !anyVisible,
      });
    }
  }, [layoutGrids]);
  handleLayoutGridChangeRef.current = handleLayoutGridChange;
  useEffect(() => {
    designDataJsonRef.current = rebaseDesignDataWithPendingOperations(
      designDataJson,
      pendingFrameGeometryOperationsForUnloadRef.current,
    );
  }, [designDataJson]);
  const canvasFrameGeometryById = useMemo(
    () => getCanvasFrameGeometry(designDataJson),
    [designDataJson],
  );
  const displayedCanvasFrameGeometryById = useMemo(() => {
    if (Object.keys(optimisticFrameGeometryById).length === 0) {
      return canvasFrameGeometryById;
    }
    const next = { ...canvasFrameGeometryById };
    for (const [screenId, geometry] of Object.entries(
      optimisticFrameGeometryById,
    )) {
      const persisted = canvasFrameGeometryById[screenId];
      const persistedGeometryIsComplete =
        persisted &&
        typeof persisted.x === "number" &&
        typeof persisted.y === "number" &&
        typeof persisted.width === "number" &&
        typeof persisted.height === "number";
      if (!persistedGeometryIsComplete) next[screenId] = geometry;
    }
    return next;
  }, [canvasFrameGeometryById, optimisticFrameGeometryById]);
  useEffect(() => {
    setOptimisticFrameGeometryById((current) => {
      let changed = false;
      const next: Record<string, FrameGeometry> = {};
      for (const [screenId, geometry] of Object.entries(current)) {
        const persisted = canvasFrameGeometryById[screenId];
        const persistedGeometryIsComplete =
          persisted &&
          typeof persisted.x === "number" &&
          typeof persisted.y === "number" &&
          typeof persisted.width === "number" &&
          typeof persisted.height === "number";
        if (persistedGeometryIsComplete) {
          changed = true;
        } else {
          next[screenId] = geometry;
        }
      }
      return changed ? next : current;
    });
  }, [canvasFrameGeometryById]);
  const liveFrameGeometryRef = useRef(canvasFrameGeometryById);
  useEffect(() => {
    liveFrameGeometryRef.current = canvasFrameGeometryById;
  }, [canvasFrameGeometryById]);

  const boardFileId = useMemo(() => {
    const raw = (designDataJson as Record<string, unknown>).boardFileId;
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }, [designDataJson]);
  const boardFileIdRef = useRef(boardFileId);
  boardFileIdRef.current = boardFileId;

  const migrateBoardTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    // A widget write grant covers only the design's own saves, never this migration.
    if (!id || !canEditDesign || shellMode || widgetEmbed) return;
    if (boardFileId) return;
    if (migrateBoardTriggeredRef.current === id) return;
    migrateBoardTriggeredRef.current = id;
    migrateBoardObjectsMutation.mutate({ designId: id } as any, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design", { id }],
        });
      },
    });
  }, [
    boardFileId,
    canEditDesign,
    id,
    migrateBoardObjectsMutation,
    queryClient,
    widgetEmbed,
  ]);

  const openGenerateInAgent = useCallback(() => {
    setRetryablePrompt(null);
    window.dispatchEvent(new Event("agent-panel:open"));
  }, []);

  const arrivedFromNewDesign = initialSearchParams.get("new") === "1";
  const newDesignAskedRef = useRef(false);
  useEffect(() => {
    if (
      !shouldAskOnNewDesignArrival({
        arrivedFromNewDesign,
        alreadyAsked: newDesignAskedRef.current,
        canEditDesign,
        embedded,
        shellMode,
      })
    )
      return;
    newDesignAskedRef.current = true;
    openGenerateInAgent();
    const next = new URLSearchParams(location.search);
    next.delete("new");
    const query = next.toString();
    void navigate(`${location.pathname}${query ? `?${query}` : ""}`, {
      replace: true,
    });
  }, [
    arrivedFromNewDesign,
    canEditDesign,
    embedded,
    location.pathname,
    location.search,
    navigate,
    openGenerateInAgent,
    shellMode,
  ]);

  const overviewScreensRef = useRef<
    (OverviewScreen & { codeLayerSource: CodeLayerSource })[]
  >([]);
  const overviewScreens = useMemo(() => {
    const next = reuseUnchangedOverviewScreens(
      overviewScreensRef.current,
      deriveOverviewScreens({
        designDataJson,
        files,
        activeBreakpointWidthState,
        breakpointFramesHidden,
        locallyPinnedHeightIds: locallyPinnedHeightIdsRef.current,
      }).map((screen) => ({
        ...screen,
        codeLayerSource: codeLayerSourceForScreen(screen.id),
      })),
    );
    overviewScreensRef.current = next;
    return next;
  }, [
    designDataJson,
    files,
    codeLayerSourceForScreen,
    activeBreakpointWidthState,
    boardFileId,
    breakpointFramesHidden,
  ]);
  const publicVisualEditConnectionIds = useMemo(() => {
    if (!isVisualEditSurface || isLiveCanvasShareLink) return [];
    return [
      ...new Set(
        overviewScreens.flatMap((screen) =>
          screen.connectionId ? [screen.connectionId] : [],
        ),
      ),
    ];
  }, [isLiveCanvasShareLink, isVisualEditSurface, overviewScreens]);
  const localhostConnectionIds = useMemo(() => {
    if (isLiveCanvasShareLink || (!canEditDesign && !isVisualEditSurface)) {
      return [];
    }
    return [
      ...new Set(
        overviewScreens.flatMap((screen) =>
          screen.connectionId &&
          resolveOverviewScreenSourceType(screen, designSourceType) ===
            "localhost"
            ? [screen.connectionId]
            : [],
        ),
      ),
    ];
  }, [
    canEditDesign,
    designSourceType,
    isLiveCanvasShareLink,
    isVisualEditSurface,
    overviewScreens,
  ]);
  const localhostPreviewTokenQuery = useActionQuery<{
    previewToken?: string;
    liveEditCapability?: string;
    liveEditRegistrationCapability?: string;
    connections?: Record<
      string,
      {
        previewToken?: string;
        liveEditCapability?: string;
        liveEditRegistrationCapability?: string;
        bridgeUrl?: string;
        status?: "available" | "unavailable";
        errorCode?:
          | "localhost_preview_credentials_unavailable"
          | "public_localhost_preview_unavailable";
      }
    >;
  }>(
    "refresh-localhost-preview-token",
    {
      designId: id!,
      connectionIds: localhostConnectionIds,
      publicVisualEdit,
    },
    {
      enabled: !shellMode && Boolean(id) && localhostConnectionIds.length > 0,
    },
  );
  const hasLocalhostScreens = overviewScreens.some(
    (screen) =>
      resolveOverviewScreenSourceType(screen, designSourceType) === "localhost",
  );
  const editorShareUrl = useMemo(() => {
    if (!id || typeof window === "undefined") return undefined;
    return withShareLinkAttribution(
      getDesignEditorShareUrl(
        id,
        window.location.origin,
        appBasePath(),
        hasLocalhostScreens ? "visual-edit" : "design",
      ),
      "design_share",
      session?.userId,
    );
  }, [hasLocalhostScreens, id, session?.userId]);
  scheduleVisualEditSnapshotRef.current = scheduleVisualEditSnapshotPublication;
  useEffect(
    () => () =>
      runClearVisualEditSnapshotPublications(
        visualEditSnapshotPublicationState,
      ),
    [id],
  );
  const visualEditPendingQuery = useActionQuery<{
    designId: string;
    pendingEditCount: number;
    status: "ready" | "empty";
    prompt: string;
    revision: number | null;
    updatedAt: string | null;
  }>(
    "get-visual-edit-pending",
    { designId: id! },
    {
      enabled: canEditDesign && Boolean(id) && !shellMode,
      refetchInterval:
        canEditDesign && Boolean(id) && !shellMode ? 2_000 : false,
    },
  );
  const remoteVisualEditPending =
    canEditDesign &&
    !shouldSuppressReloadedVisualEditHandoff({
      marker: pendingVisualEditReloadedHandoffRef.current,
      designId: id,
      status: visualEditPendingQuery.data?.status,
      revision: visualEditPendingQuery.data?.revision,
    }) &&
    visualEditPendingQuery.data?.status === "ready" &&
    visualEditPendingQuery.data.pendingEditCount > 0 &&
    Boolean(visualEditPendingQuery.data.prompt);
  useEffect(() => {
    const marker = pendingVisualEditReloadedHandoffRef.current;
    if (
      !shouldClearReloadedVisualEditHandoff({
        marker,
        designId: id,
        status: visualEditPendingQuery.data?.status,
        revision: visualEditPendingQuery.data?.revision,
      })
    ) {
      return;
    }
    pendingVisualEditReloadedHandoffRef.current = null;
    if (
      marker &&
      pendingVisualEditHandoffPublicationRef.current?.publicationRevision ===
        marker.publicationRevision &&
      pendingVisualEditHandoffPublicationRef.current.serverRevision ===
        marker.serverRevision
    ) {
      pendingVisualEditHandoffPublicationRef.current = null;
    }
  }, [
    id,
    visualEditPendingQuery.data?.revision,
    visualEditPendingQuery.data?.status,
  ]);
  const handleScreenExternalContentSnapshot = useCallback(
    (screenId: string, snapshot: LiveScreenSnapshot) => {
      setLiveScreenSnapshotsById((current) => {
        const existing = current[screenId];
        if (
          existing?.url === snapshot.url &&
          existing.html === snapshot.html &&
          existing.status === snapshot.status &&
          existing.contentType === snapshot.contentType
        ) {
          return current;
        }
        return { ...current, [screenId]: snapshot };
      });
    },
    [],
  );
  const handleScreenRuntimeLayerSnapshot = useCallback(
    (screenId: string, snapshot: RuntimeLayerSnapshot) => {
      const screen = overviewScreensRef.current.find(
        (candidate) => candidate.id === screenId,
      );
      if (
        screen &&
        resolveOverviewScreenSourceType(screen, designSourceTypeRef.current) ===
          "localhost" &&
        snapshot.reservationToken
      ) {
        scheduleVisualEditSnapshotRef.current(
          screenId,
          snapshot.html,
          snapshot.reservationToken,
        );
      }
      runtimeLayerSnapshotsByIdRef.current = {
        ...runtimeLayerSnapshotsByIdRef.current,
        [screenId]: snapshot,
      };
      setRuntimeLayerSnapshotsById((current) => {
        const existing = current[screenId];
        if (
          existing?.html === snapshot.html &&
          existing.nodeCount === snapshot.nodeCount &&
          existing.documentId === snapshot.documentId
        ) {
          return current;
        }
        return { ...current, [screenId]: snapshot };
      });
    },
    [],
  );
  const getScreenRootComputedStylesCallback = useCallback(
    (screenId: string) => {
      const callbacks = screenRootStyleCallbacksRef.current;
      const existingCallback = callbacks.get(screenId);
      if (existingCallback) return existingCallback;
      const callback = (styles: Record<string, string>) => {
        setScreenRootComputedStylesById((current) => {
          const existing = current[screenId];
          const sameStyles =
            existing &&
            Object.keys(existing).length === Object.keys(styles).length &&
            Object.entries(styles).every(
              ([property, value]) => existing[property] === value,
            );
          if (sameStyles) return current;
          return { ...current, [screenId]: styles };
        });
      };
      callbacks.set(screenId, callback);
      return callback;
    },
    [],
  );
  const updateLiveScreenSnapshotContent = useCallback(
    (
      screenId: string,
      html: string,
      options: { recordHistory?: boolean } = {},
    ) => {
      const existing = liveScreenSnapshotsById[screenId];
      if (!existing) return false;
      if (existing.html === html) return true;
      try {
        assertDesignHtmlEditIntegrity({
          previousContent: existing.html,
          nextContent: html,
          fileType: "html",
        });
      } catch (error) {
        toast.error(designSaveErrorMessage(error) ?? t("common.genericError"), {
          id: `design-source-integrity:${screenId}`,
        });
        return false;
      }
      if (options.recordHistory !== false) {
        const change = { fileId: screenId, before: existing.html, after: html };
        if (viewModeRef.current === "overview") {
          recordContentHistoryEntry(change);
        } else {
          recordLocalContentHistoryEntry(change);
        }
      }
      setLiveScreenSnapshotsById((current) => ({
        ...current,
        [screenId]: { ...existing, html },
      }));
      scheduleVisualEditSnapshotPublication(screenId, html);
      return true;
    },
    [
      liveScreenSnapshotsById,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      scheduleVisualEditSnapshotPublication,
      t,
    ],
  );
  const addLocalhostScreenPosition = useMemo(
    () =>
      nextLocalhostScreenPosition(canvasFrameGeometryById, {
        screenFileIds: overviewScreens.map((screen) => screen.id),
        screenMetadataByFileId: getDesignDataRecord(
          designDataJson,
          "screenMetadata",
        ),
        breakpointWidths: overviewScreens[0]?.breakpointWidths,
      }),
    [canvasFrameGeometryById, designDataJson, overviewScreens],
  );

  const handleTokensApplied = useCallback(
    (resolvedCssVars: Record<string, string>) => {
      if (!canEditDesign || !id) return;
      setTweakSelections((prev) => ({
        ...prev,
        ...resolvedCssVars,
      }));
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        let currentData: Record<string, unknown> = {};
        if (typeof old.data === "string" && old.data) {
          try {
            const parsed = JSON.parse(old.data);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              currentData = parsed;
            }
          } catch {
            currentData = {};
          }
        }
        const currentSelections =
          currentData.tweakSelections &&
          typeof currentData.tweakSelections === "object" &&
          !Array.isArray(currentData.tweakSelections)
            ? currentData.tweakSelections
            : {};
        return {
          ...old,
          data: JSON.stringify({
            ...currentData,
            tweakSelections: {
              ...currentSelections,
              ...resolvedCssVars,
            },
          }),
        };
      });
    },
    [canEditDesign, id, queryClient],
  );

  return {
    designSaveActorScope,
    navigate,
    postAuthIntent,
    locallyPinnedHeightIdsRef,
    titleEditing,
    setTitleEditing,
    titleDraft,
    setTitleDraft,
    optimisticFrameGeometryById,
    setOptimisticFrameGeometryById,
    designSaveOperationSourceRef,
    pendingFrameGeometryOperationsForUnloadRef,
    showPrompt,
    showTweakPrompt,
    setShowTweakPrompt,
    tweakPromptAnchorRef,
    promptDesignSystemId,
    setPromptDesignSystemId,
    creativeContextEnabled,
    breakpointFramesHidden,
    setBreakpointFramesHidden,
    setPatchProof,
    pendingFileSavesRef,
    fileSaveChainsRef,
    fileSaveOperationRevisionRef,
    latestFileSaveForUnloadRef,
    fileSaveTimersRef,
    reportSaveFailure,
    journalOutboxEntry,
    acknowledgeOutboxEntry,
    retryDesignSaveOutbox,
    cancelQueuedFileContentSave,
    queueFileContentSave,
    publishCanonicalContent,
    flushPendingFileContentSavesForBackground,
    cssVarValues,
    flushPendingTweakSave,
    handleTweakChange,
    tweakSelections,
    tweaks,
    designSystemsLoading,
    designSystemOptions,
    editorPreferences,
    setEditorPreferences,
    creativeContextsQuery,
    creativeContextState,
    creativeContextOptions,
    creativeContextPersistRef,
    handleCreativeContextChange,
    selectedPromptDesignSystemId,
    handlePromptOpenChange,
    handleTweakPromptOpenChange,
    handleRequestTweaks,
    commitTitleEdit,
    handleTitleInputKeyDown,
    serverFiles,
    files,
    getComponentExpectedFiles,
    codeLayerSourceForScreen,
    pendingNodeRewriteProposals,
    pendingNodeRewriteByFile,
    pendingNodeRewriteScreenIds,
    documentColorFiles,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    screenRootComputedStylesById,
    setScreenRootComputedStylesById,
    screenRootComputedStylesByIdRef,
    runtimeLayerSnapshotsByIdRef,
    designDataJson,
    designSourceType,
    layoutGrids,
    handleToggleLayoutGrids,
    handleLayoutGridChange,
    designDataJsonRef,
    canvasFrameGeometryById,
    displayedCanvasFrameGeometryById,
    liveFrameGeometryRef,
    boardFileId,
    boardFileIdRef,
    overviewScreens,
    publicVisualEditConnectionIds,
    localhostPreviewTokenQuery,
    hasLocalhostScreens,
    editorShareUrl,
    visualEditPendingQuery,
    remoteVisualEditPending,
    handleScreenExternalContentSnapshot,
    handleScreenRuntimeLayerSnapshot,
    getScreenRootComputedStylesCallback,
    updateLiveScreenSnapshotContent,
    addLocalhostScreenPosition,
    handleTokensApplied,
  };
}

export type EditorFilesAndSaving = ReturnType<typeof useEditorFilesAndSaving>;
