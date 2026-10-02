import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import { applyUpdate, type Doc as YDoc, type XmlFragment } from "yjs";

import { AGENT_CLIENT_ID, isReconcileLeadClient } from "../collab-ui/index.js";
import {
  RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION,
  applyDocSurgically,
  defaultParseValue,
  reconcileDocAgainstBase,
} from "./surgical-apply.js";

export { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION };

export function isRemoteCollaborativeTransaction(
  transaction: Transaction,
): boolean {
  return (
    isChangeOrigin(transaction) &&
    !transaction.getMeta(ySyncPluginKey)?.isUndoRedoOperation
  );
}

type InitialSeedNode = ReturnType<XmlFragment["toArray"]>[number];

export function applyAuthoritativeInitialSeed(
  ydoc: YDoc,
  state: Uint8Array,
  initialNodes: ReadonlyArray<{ node: InitialSeedNode; serialized: string }>,
): void {
  const fragment = ydoc.getXmlFragment("default");
  ydoc.transact(() => {
    for (const { node, serialized } of initialNodes) {
      if (node.toString() !== serialized) continue;
      const index = fragment.toArray().indexOf(node);
      if (index !== -1) fragment.delete(index, 1);
    }
    applyUpdate(ydoc, state, "authoritative-initial-seed");
  }, "authoritative-initial-seed");
}

export function getEditorMarkdown(editor: Editor): string {
  const markdownStorage = editor.storage as unknown as {
    markdown?: { getMarkdown?: () => string };
  };
  return markdownStorage.markdown?.getMarkdown?.() ?? "";
}

const EMITTED_RING_MAX = 16;
const PEER_SETTLE_MS = 2500;
// A non-lead client leaves a newer snapshot to the lead; if the lead has not
// converged the doc by then (it never refetched), adopt it rather than keep a
// Yjs doc that disagrees with SQL until the next reload drops unsaved text.
const LEAD_FAILOVER_MS = PEER_SETTLE_MS * 2;
function pushEmittedRing(ring: string[], value: string): void {
  if (!value) return;
  if (ring[ring.length - 1] === value) return;
  const dupe = ring.indexOf(value);
  if (dupe !== -1) ring.splice(dupe, 1);
  ring.push(value);
  if (ring.length > EMITTED_RING_MAX) ring.shift();
}

export interface UseCollabReconcileOptions {
  editor: Editor | null;
  ydoc?: YDoc | null;
  collabSynced?: boolean;
  awareness?: Awareness | null;
  value: string;
  contentUpdatedAt?: string | null;
  contentRevision?: string | null;
  compareContentRevisions?: (first: string, second: string) => number | null;
  acknowledgedLocalSnapshot?: {
    value: string;
    revision: string;
    updatedAt: string;
    sequence: number;
  } | null;
  collabContentRevision?: string | null;
  requestCollabSync?: () => Promise<{
    status: "synced" | "failed" | "unavailable";
  }>;
  onBaseAwareReconcile?: (result: {
    status: "merged" | "conflict" | "failed";
    content: string;
    serverContent: string;
    baseRevision: string;
    serverRevision: string;
  }) => void;
  onRemoteSnapshotChange?: (markdown: string) => void;
  requestInitialSeed?: (editor: Editor, value: string) => Promise<Uint8Array>;
  /**
   * Flipping editability around the initial seed emits `update` unless this is
   * set. Set it when `update` saves the document, so that the flip is not
   * mistaken for an edit. Editors that leave it off rely on the emission to
   * report edits typed before the seed settled, which were ignored until then.
   */
  quietSeedEditability?: boolean;
  onInitialSeedError?: (error: unknown) => void;
  overlapPolicy?: "conflict" | "prefer-live";
  editable: boolean;
  isEditorFocused?: (editor: Editor) => boolean;
  getMarkdown?: (editor: Editor) => string;
  setContent?: (
    editor: Editor,
    value: string,
    options: { emitUpdate?: boolean; addToHistory?: boolean },
  ) => void;
  parseValue?:
    | ((editor: Editor, value: string) => ProseMirrorNode | null)
    | false;
  normalizeValue?: (value: string) => string;
  shouldSeed?: (info: {
    value: string;
    currentMarkdown: string;
    fragmentLength: number;
  }) => boolean;
  initialAppliedUpdatedAt?: string | null;
}

export interface UseCollabReconcileResult {
  collab: boolean;
  initialSeedFailed: boolean;
  /**
   * True from the moment a server-seeded document exists until its first seed
   * has been applied. The editor must stay read-only meanwhile: text typed into
   * the still-empty document is merged with the seed rather than placed after it.
   */
  initialSeedPending: boolean;
  retryInitialSeed: () => void;
  isSettingContentRef: MutableRefObject<boolean>;
  shouldIgnoreUpdate: (transaction: Transaction) => boolean;
  reportRemoteUpdate: (transaction: Transaction) => void;
  registerEmitted: (markdown: string) => boolean;
}

function defaultShouldSeed({
  currentMarkdown,
  fragmentLength,
}: {
  value: string;
  currentMarkdown: string;
  fragmentLength: number;
}): boolean {
  return fragmentLength === 0 || !currentMarkdown.trim();
}

function defaultSetContent(
  editor: Editor,
  value: string,
  options: { emitUpdate?: boolean; addToHistory?: boolean },
): void {
  if (options.addToHistory === false) {
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta("addToHistory", false);
        return true;
      })
      .setContent(value, { emitUpdate: options.emitUpdate })
      .run();
    return;
  }
  editor.commands.setContent(value);
}

function defaultIsEditorFocused(editor: Editor): boolean {
  return editor.isFocused;
}

export function useCollabReconcile({
  editor,
  ydoc = null,
  collabSynced = true,
  awareness = null,
  value,
  contentUpdatedAt,
  contentRevision,
  compareContentRevisions,
  acknowledgedLocalSnapshot,
  collabContentRevision,
  requestCollabSync,
  onBaseAwareReconcile,
  onRemoteSnapshotChange,
  requestInitialSeed,
  quietSeedEditability = false,
  onInitialSeedError,
  overlapPolicy = "conflict",
  editable,
  isEditorFocused = defaultIsEditorFocused,
  getMarkdown = getEditorMarkdown,
  setContent = defaultSetContent,
  parseValue,
  normalizeValue = (v) => v,
  shouldSeed = defaultShouldSeed,
  initialAppliedUpdatedAt,
}: UseCollabReconcileOptions): UseCollabReconcileResult {
  const collab = !!ydoc;
  const collabBackedSnapshot = Boolean(
    collab && contentRevision && collabContentRevision === contentRevision,
  );
  const isSettingContentRef = useRef(false);
  const lastEmittedRef = useRef("");
  const lastRegisteredLocalEmissionRef = useRef<string | null>(null);
  const recentEmittedRef = useRef<string[]>([]);
  const lastTypedAtRef = useRef(0);
  const lastAppliedValueRef = useRef<string | null>(null);
  const lastAppliedSerializedRef = useRef<string | null>(null);
  const lastAppliedUpdatedAtRef = useRef<string | null>(
    initialAppliedUpdatedAt !== undefined
      ? initialAppliedUpdatedAt
      : (contentUpdatedAt ?? null),
  );
  const authoritativeBaseRef = useRef<{
    value: string;
    revision: string;
  } | null>(contentRevision ? { value, revision: contentRevision } : null);
  const reportedConflictRevisionRef = useRef<string | null>(null);
  const reconcileCallbacksRef = useRef({
    getMarkdown,
    setContent,
    parseValue,
    normalizeValue,
    isEditorFocused,
    onBaseAwareReconcile,
    onRemoteSnapshotChange,
  });
  reconcileCallbacksRef.current = {
    getMarkdown,
    setContent,
    parseValue,
    normalizeValue,
    isEditorFocused,
    onBaseAwareReconcile,
    onRemoteSnapshotChange,
  };
  const acknowledgedLocalSnapshotRef = useRef<{
    value: string;
    revision: string;
    updatedAt: string;
    sequence: number;
  } | null>(null);
  const latestObservedUpdatedAtRef = useRef<string | null>(
    contentUpdatedAt ?? null,
  );
  const latestObservedRevisionRef = useRef<string | null>(
    contentRevision ?? null,
  );
  const acknowledgementBaseRollbackRef = useRef<{
    acknowledgementRevision: string;
    updatedAt: string;
    base: { value: string; revision: string } | null;
  } | null>(null);
  const acknowledgedCollabRef = useRef<{ ydoc: YDoc; revision: string } | null>(
    null,
  );
  const [pendingCollabSnapshot, setPendingCollabSnapshot] = useState<{
    ydoc: YDoc;
    revision: string;
    value: string;
    updatedAt: string | null | undefined;
  } | null>(null);
  useEffect(() => {
    if (!collabBackedSnapshot || !ydoc || !contentRevision) return;
    if (
      acknowledgedCollabRef.current?.ydoc === ydoc &&
      acknowledgedCollabRef.current.revision === contentRevision
    )
      return;
    setPendingCollabSnapshot((pending) =>
      pending?.ydoc === ydoc && pending.revision === contentRevision
        ? pending
        : {
            ydoc,
            revision: contentRevision,
            value,
            updatedAt: contentUpdatedAt,
          },
    );
  }, [collabBackedSnapshot, ydoc, contentRevision, value, contentUpdatedAt]);
  useEffect(() => {
    if (
      !pendingCollabSnapshot ||
      !requestCollabSync ||
      pendingCollabSnapshot.ydoc !== ydoc
    )
      return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const sync = async () => {
      const result = await requestCollabSync().catch(() => ({
        status: "failed" as const,
      }));
      if (cancelled) return;
      if (result.status !== "synced") {
        retry = setTimeout(() => void sync(), 2000);
        return;
      }
      authoritativeBaseRef.current = {
        value: pendingCollabSnapshot.value,
        revision: pendingCollabSnapshot.revision,
      };
      reportedConflictRevisionRef.current = null;
      if (pendingCollabSnapshot.updatedAt)
        lastAppliedUpdatedAtRef.current = pendingCollabSnapshot.updatedAt;
      acknowledgedCollabRef.current = pendingCollabSnapshot;
      setPendingCollabSnapshot(null);
    };
    void sync();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [pendingCollabSnapshot, requestCollabSync, ydoc]);

  const [isLeadClient, setIsLeadClient] = useState(true);
  const seedLead = requestInitialSeed ? true : isLeadClient;
  const peerCountRef = useRef(0);
  const emptySnapshotDecisionPendingRef = useRef(false);
  useEffect(() => {
    if (!collab || !awareness || !ydoc) {
      setIsLeadClient(true);
      peerCountRef.current = 0;
      return;
    }
    const update = () => {
      setIsLeadClient(isReconcileLeadClient(awareness, ydoc.clientID));
      let peers = 0;
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === ydoc.clientID) return;
        if (clientId === AGENT_CLIENT_ID) return;
        const s = state as {
          user?: unknown;
          visible?: boolean;
          canFlushDocument?: boolean;
        };
        if (s?.canFlushDocument === false) return;
        if (s && s.user && s.visible !== false) peers += 1;
      });
      peerCountRef.current = peers;
    };
    update();
    awareness.on("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      awareness.off("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [collab, awareness, ydoc]);

  const seededRef = useRef(false);
  const [seeded, setSeeded] = useState(false);
  const markSeeded = () => {
    seededRef.current = true;
    if (requestInitialSeed) setSeeded(true);
  };
  const [initialSeedFailed, setInitialSeedFailed] = useState(false);
  const [initialSeedRetry, setInitialSeedRetry] = useState(0);
  useEffect(() => {
    if (!collab || !editor || editor.isDestroyed || !ydoc) return;
    if (seededRef.current) return;
    if (!collabSynced) return;
    if (collabBackedSnapshot) {
      markSeeded();
      if (requestInitialSeed)
        editor.setEditable(editable, !quietSeedEditability);
      return;
    }
    if (contentRevision) {
      authoritativeBaseRef.current = { value, revision: contentRevision };
      reportedConflictRevisionRef.current = null;
    }
    if (!value.trim()) {
      markSeeded();
      const fragment = ydoc.getXmlFragment("default");
      const currentMarkdown = getMarkdown(editor);
      if (fragment.length === 0 && !currentMarkdown.trim()) return;

      emptySnapshotDecisionPendingRef.current = true;
      let cancelled = false;
      const adoptTimer = setTimeout(
        () => {
          if (cancelled || editor.isDestroyed) return;
          const projectedMarkdown = getMarkdown(editor);
          const isOwnFreshEdit =
            projectedMarkdown.trim() &&
            (projectedMarkdown === lastEmittedRef.current ||
              recentEmittedRef.current.includes(projectedMarkdown));
          if (
            projectedMarkdown.trim() &&
            (peerCountRef.current > 0 || isOwnFreshEdit)
          ) {
            lastAppliedValueRef.current = value;
            lastAppliedSerializedRef.current = projectedMarkdown;
            if (contentUpdatedAt) {
              lastAppliedUpdatedAtRef.current = contentUpdatedAt;
            }
          }
          emptySnapshotDecisionPendingRef.current = false;
        },
        awareness ? PEER_SETTLE_MS : 0,
      );
      return () => {
        cancelled = true;
        clearTimeout(adoptTimer);
        emptySnapshotDecisionPendingRef.current = false;
      };
    }
    if (!seedLead) {
      const releaseTimer = setTimeout(() => {
        markSeeded();
      }, 0);
      return () => clearTimeout(releaseTimer);
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = 1000;
    const seedTimer = setTimeout(() => {
      if (cancelled || editor.isDestroyed) return;
      const fragment = ydoc.getXmlFragment("default");
      const currentMarkdown = getMarkdown(editor);
      if (
        !shouldSeed({
          value,
          currentMarkdown,
          fragmentLength: fragment.length,
        })
      ) {
        markSeeded();
        if (requestInitialSeed)
          editor.setEditable(editable, !quietSeedEditability);
        return;
      }
      if (requestInitialSeed) {
        editor.setEditable(false, !quietSeedEditability);
        const initialNodes = fragment.toArray().map((node) => ({
          node,
          serialized: node.toString(),
        }));
        const claim = () => {
          void requestInitialSeed(editor, value)
            .then((state) => {
              if (cancelled || editor.isDestroyed) return;
              isSettingContentRef.current = true;
              try {
                applyAuthoritativeInitialSeed(ydoc, state, initialNodes);
              } finally {
                isSettingContentRef.current = false;
              }
              const serialized = getMarkdown(editor);
              lastEmittedRef.current = serialized;
              pushEmittedRing(recentEmittedRef.current, serialized);
              lastAppliedValueRef.current = value;
              lastAppliedSerializedRef.current = serialized;
              if (contentUpdatedAt)
                lastAppliedUpdatedAtRef.current = contentUpdatedAt;
              markSeeded();
              setInitialSeedFailed(false);
              editor.setEditable(editable, !quietSeedEditability);
            })
            .catch((error: unknown) => {
              if (cancelled || editor.isDestroyed) return;
              onInitialSeedError?.(error);
              const status =
                error && typeof error === "object" && "status" in error
                  ? error.status
                  : undefined;
              if (
                typeof status === "number" &&
                status >= 400 &&
                status < 500 &&
                status !== 408 &&
                status !== 429
              ) {
                setInitialSeedFailed(true);
                return;
              }
              retryTimer = setTimeout(claim, retryDelayMs);
              retryDelayMs = Math.min(retryDelayMs * 2, 8000);
            });
        };
        claim();
        return;
      }
      isSettingContentRef.current = true;
      try {
        setContent(editor, value, {});
      } finally {
        isSettingContentRef.current = false;
      }
      const serialized = getMarkdown(editor);
      lastEmittedRef.current = serialized;
      pushEmittedRing(recentEmittedRef.current, serialized);
      lastAppliedValueRef.current = value;
      lastAppliedSerializedRef.current = serialized;
      if (contentUpdatedAt) lastAppliedUpdatedAtRef.current = contentUpdatedAt;
      markSeeded();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(seedTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (requestInitialSeed && !editor.isDestroyed)
        editor.setEditable(editable, !quietSeedEditability);
    };
  }, [
    collab,
    collabSynced,
    editor,
    ydoc,
    value,
    seedLead,
    requestInitialSeed,
    onInitialSeedError,
    editable,
    contentUpdatedAt,
    contentRevision,
    getMarkdown,
    setContent,
    shouldSeed,
    collabBackedSnapshot,
    initialSeedRetry,
  ]);

  const syncedBeforeAdoptRef = useRef<string | null>(null);
  const peerReconcileWaitRef = useRef<{
    editor: Editor;
    ydoc: YDoc | null;
    value: string;
    contentUpdatedAt: string | null | undefined;
    contentRevision: string | null | undefined;
    collabSynced: boolean;
    isLeadClient: boolean;
    editable: boolean;
    deadline: number | null;
    leadDeadline: number | null;
  } | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      peerReconcileWaitRef.current = null;
      return;
    }

    const previousWait = peerReconcileWaitRef.current;
    if (
      !previousWait ||
      previousWait.editor !== editor ||
      previousWait.ydoc !== ydoc ||
      previousWait.value !== value ||
      previousWait.contentUpdatedAt !== contentUpdatedAt ||
      previousWait.contentRevision !== contentRevision ||
      previousWait.collabSynced !== collabSynced ||
      previousWait.isLeadClient !== isLeadClient ||
      previousWait.editable !== editable
    ) {
      peerReconcileWaitRef.current = {
        editor,
        ydoc,
        value,
        contentUpdatedAt,
        contentRevision,
        collabSynced,
        isLeadClient,
        editable,
        deadline: null,
        leadDeadline: null,
      };
    }
    const peerWait = peerReconcileWaitRef.current!;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const apply = (deferred = false) => {
      if (cancelled || editor.isDestroyed) return;
      const callbacks = reconcileCallbacksRef.current;
      if (contentUpdatedAt) {
        const rollback = acknowledgementBaseRollbackRef.current;
        const conflictsWithAcceptedAcknowledgement =
          contentRevision &&
          rollback?.updatedAt === contentUpdatedAt &&
          rollback.acknowledgementRevision !== contentRevision;
        if (conflictsWithAcceptedAcknowledgement) {
          const order = compareContentRevisions?.(
            contentRevision,
            rollback.acknowledgementRevision,
          );
          if (order !== undefined && order !== null && order <= 0) {
            return;
          }
          if (
            authoritativeBaseRef.current?.revision ===
            rollback.acknowledgementRevision
          ) {
            authoritativeBaseRef.current = rollback.base;
          }
          acknowledgementBaseRollbackRef.current = null;
          latestObservedUpdatedAtRef.current = contentUpdatedAt;
          latestObservedRevisionRef.current = contentRevision;
        } else if (
          !latestObservedUpdatedAtRef.current ||
          contentUpdatedAt > latestObservedUpdatedAtRef.current
        ) {
          latestObservedUpdatedAtRef.current = contentUpdatedAt;
          latestObservedRevisionRef.current = contentRevision ?? null;
          acknowledgementBaseRollbackRef.current = null;
        } else if (
          contentUpdatedAt === latestObservedUpdatedAtRef.current &&
          contentRevision &&
          latestObservedRevisionRef.current !== contentRevision
        ) {
          const order = latestObservedRevisionRef.current
            ? compareContentRevisions?.(
                contentRevision,
                latestObservedRevisionRef.current,
              )
            : null;
          if (order !== undefined && order !== null && order <= 0) {
            return;
          }
          latestObservedRevisionRef.current =
            order !== undefined && order !== null ? contentRevision : null;
        }
      }
      let rejectedMatchingAcknowledgement = false;
      if (acknowledgedLocalSnapshot) {
        const acceptedAcknowledgement = acknowledgedLocalSnapshotRef.current;
        const acknowledgementIsNewestAccepted =
          !acceptedAcknowledgement ||
          acknowledgedLocalSnapshot.sequence > acceptedAcknowledgement.sequence;
        const acknowledgementRevisionOrder =
          acknowledgedLocalSnapshot.updatedAt ===
            latestObservedUpdatedAtRef.current &&
          latestObservedRevisionRef.current
            ? compareContentRevisions?.(
                acknowledgedLocalSnapshot.revision,
                latestObservedRevisionRef.current,
              )
            : null;
        const acknowledgementIsNotSuperseded =
          !latestObservedUpdatedAtRef.current ||
          acknowledgedLocalSnapshot.updatedAt >
            latestObservedUpdatedAtRef.current ||
          (acknowledgedLocalSnapshot.updatedAt ===
            latestObservedUpdatedAtRef.current &&
            (latestObservedRevisionRef.current ===
              acknowledgedLocalSnapshot.revision ||
              acknowledgementRevisionOrder === undefined ||
              acknowledgementRevisionOrder === null ||
              acknowledgementRevisionOrder >= 0));
        if (acknowledgementIsNewestAccepted && acknowledgementIsNotSuperseded) {
          acknowledgedLocalSnapshotRef.current = acknowledgedLocalSnapshot;
          const existingRollback = acknowledgementBaseRollbackRef.current;
          if (
            existingRollback?.acknowledgementRevision !==
              acknowledgedLocalSnapshot.revision ||
            existingRollback.updatedAt !== acknowledgedLocalSnapshot.updatedAt
          ) {
            acknowledgementBaseRollbackRef.current = {
              acknowledgementRevision: acknowledgedLocalSnapshot.revision,
              updatedAt: acknowledgedLocalSnapshot.updatedAt,
              base: authoritativeBaseRef.current,
            };
          }
          authoritativeBaseRef.current = {
            value: acknowledgedLocalSnapshot.value,
            revision: acknowledgedLocalSnapshot.revision,
          };
          if (
            acknowledgedLocalSnapshot.updatedAt ===
              latestObservedUpdatedAtRef.current &&
            acknowledgementRevisionOrder !== undefined &&
            acknowledgementRevisionOrder !== null &&
            acknowledgementRevisionOrder > 0
          ) {
            latestObservedRevisionRef.current =
              acknowledgedLocalSnapshot.revision;
          }
          if (
            !lastAppliedUpdatedAtRef.current ||
            acknowledgedLocalSnapshot.updatedAt >
              lastAppliedUpdatedAtRef.current
          ) {
            lastAppliedUpdatedAtRef.current =
              acknowledgedLocalSnapshot.updatedAt;
          }
        } else if (
          contentRevision === acknowledgedLocalSnapshot.revision &&
          value === acknowledgedLocalSnapshot.value
        ) {
          rejectedMatchingAcknowledgement = true;
        }
      }
      if (rejectedMatchingAcknowledgement) return;
      const acknowledged = acknowledgedLocalSnapshotRef.current;
      if (
        acknowledged &&
        contentRevision === acknowledged.revision &&
        value === acknowledged.value
      ) {
        const acknowledgementWasSuperseded =
          latestObservedUpdatedAtRef.current !== null &&
          (acknowledged.updatedAt < latestObservedUpdatedAtRef.current ||
            (acknowledged.updatedAt === latestObservedUpdatedAtRef.current &&
              latestObservedRevisionRef.current !== acknowledged.revision));
        if (!acknowledgementWasSuperseded) {
          authoritativeBaseRef.current = {
            value: acknowledged.value,
            revision: acknowledged.revision,
          };
          if (
            !lastAppliedUpdatedAtRef.current ||
            acknowledged.updatedAt > lastAppliedUpdatedAtRef.current
          ) {
            lastAppliedUpdatedAtRef.current = acknowledged.updatedAt;
          }
          reportedConflictRevisionRef.current = null;
        }
        return;
      }
      if (
        acknowledged &&
        contentUpdatedAt &&
        contentUpdatedAt < acknowledged.updatedAt
      ) {
        return;
      }
      if (collab && !collabSynced) {
        retry = setTimeout(() => apply(deferred), 300);
        return;
      }
      if (collab && !seededRef.current) {
        retry = setTimeout(() => apply(deferred), 25);
        return;
      }
      if (collab && emptySnapshotDecisionPendingRef.current) {
        retry = setTimeout(() => apply(deferred), 50);
        return;
      }
      if (
        collabBackedSnapshot ||
        (collab && pendingCollabSnapshot?.ydoc === ydoc)
      ) {
        peerWait.deadline = null;
        return;
      }
      const currentMarkdown = callbacks.getMarkdown(editor);
      const normalizedValue = callbacks.normalizeValue(value);
      const editorUnchangedSinceApply =
        lastAppliedSerializedRef.current !== null &&
        currentMarkdown === lastAppliedSerializedRef.current;
      const editorFocused = callbacks.isEditorFocused(editor);
      const typingRecently =
        editorFocused && Date.now() - lastTypedAtRef.current < 1500;

      if (
        currentMarkdown === normalizedValue ||
        (typingRecently &&
          !contentRevision &&
          (value === lastEmittedRef.current ||
            recentEmittedRef.current.includes(value) ||
            recentEmittedRef.current.includes(normalizedValue))) ||
        (editorUnchangedSinceApply &&
          (value === lastAppliedValueRef.current ||
            normalizedValue === lastAppliedSerializedRef.current))
      ) {
        peerWait.deadline = null;
        if (currentMarkdown === normalizedValue) {
          lastAppliedValueRef.current = value;
          lastAppliedSerializedRef.current = currentMarkdown;
        }
        if (contentRevision) {
          authoritativeBaseRef.current = { value, revision: contentRevision };
          reportedConflictRevisionRef.current = null;
        }
        if (contentUpdatedAt) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
        return;
      }

      const revisionChangedAtSameTimestamp =
        !!contentRevision &&
        !!authoritativeBaseRef.current &&
        contentRevision !== authoritativeBaseRef.current.revision &&
        !!contentUpdatedAt &&
        contentUpdatedAt === lastAppliedUpdatedAtRef.current;
      const externalNewer =
        revisionChangedAtSameTimestamp ||
        !lastAppliedUpdatedAtRef.current ||
        !contentUpdatedAt ||
        contentUpdatedAt > lastAppliedUpdatedAtRef.current;

      if (collab && !isLeadClient) {
        peerWait.deadline = null;
        if (!externalNewer) {
          peerWait.leadDeadline = null;
          if (contentUpdatedAt) {
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
          }
          return;
        }
        peerWait.leadDeadline ??= Date.now() + LEAD_FAILOVER_MS;
        const leadRemaining = peerWait.leadDeadline - Date.now();
        if (leadRemaining > 0) {
          retry = setTimeout(() => apply(deferred), leadRemaining);
          return;
        }
        // A live doc that moved on since the last snapshot holds typing the
        // snapshot predates (a peer's save lags the Yjs state); adopting it
        // would delete that text for every peer. SQL catches up on the next save.
        if (!editorUnchangedSinceApply) {
          peerWait.leadDeadline = null;
          return;
        }
      }

      if (typingRecently) {
        if (externalNewer) {
          retry = setTimeout(() => apply(deferred), 700);
        } else {
          peerWait.deadline = null;
        }
        return;
      }
      const hasAppliedSnapshot = lastAppliedSerializedRef.current !== null;
      const currentIsRegisteredLocalEmission =
        lastRegisteredLocalEmissionRef.current !== null &&
        currentMarkdown === lastRegisteredLocalEmissionRef.current;
      if (
        !externalNewer &&
        (editorFocused ||
          hasAppliedSnapshot ||
          currentIsRegisteredLocalEmission)
      ) {
        peerWait.deadline = null;
        return;
      }

      // A snapshot another writer saved can reach this tab before the Yjs
      // updates that carry the same text (a collab poll lags the action poll),
      // and applying it first inserts that text a second time when they land.
      // Snapshots with revisions are told apart from their collab copy by the
      // revision protocol above instead.
      const snapshotKey = contentUpdatedAt ?? "";
      if (
        collab &&
        externalNewer &&
        !contentRevision &&
        requestCollabSync &&
        syncedBeforeAdoptRef.current !== snapshotKey
      ) {
        // Adopting without the catch-up is the behavior before this step
        // existed, so a failed sync degrades to it, loudly.
        const adopt = () => {
          syncedBeforeAdoptRef.current = snapshotKey;
          if (!cancelled) apply(deferred);
        };
        void requestCollabSync().then(
          (result) => {
            if (result.status === "failed") {
              console.warn("Adopting a saved snapshot without a live sync");
            }
            adopt();
          },
          (error: unknown) => {
            console.warn(
              "Adopting a saved snapshot without a live sync:",
              error,
            );
            adopt();
          },
        );
        return;
      }

      if (collab && externalNewer && !deferred && peerCountRef.current > 0) {
        peerWait.deadline ??= Date.now() + PEER_SETTLE_MS;
        const remaining = peerWait.deadline - Date.now();
        if (remaining > 0) {
          retry = setTimeout(() => apply(true), remaining);
          return;
        }
      }

      const applyTimer = setTimeout(() => {
        if (cancelled || editor.isDestroyed) return;
        const scheduledCallbacks = reconcileCallbacksRef.current;
        peerWait.deadline = null;
        const beforeMarkdown = scheduledCallbacks.getMarkdown(editor);
        const normalized = scheduledCallbacks.normalizeValue(value);
        const unchangedSinceApply =
          lastAppliedSerializedRef.current !== null &&
          beforeMarkdown === lastAppliedSerializedRef.current;
        if (
          beforeMarkdown === normalized ||
          (unchangedSinceApply &&
            normalized === lastAppliedSerializedRef.current)
        ) {
          lastAppliedValueRef.current = value;
          lastAppliedSerializedRef.current = beforeMarkdown;
          if (contentRevision) {
            authoritativeBaseRef.current = { value, revision: contentRevision };
            reportedConflictRevisionRef.current = null;
          }
          if (contentUpdatedAt) {
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
          }
          return;
        }
        isSettingContentRef.current = true;
        const authoritativeBase = authoritativeBaseRef.current;
        if (
          contentRevision &&
          scheduledCallbacks.onBaseAwareReconcile &&
          authoritativeBase &&
          authoritativeBase.revision !== contentRevision
        ) {
          const parse =
            scheduledCallbacks.parseValue === false
              ? null
              : (scheduledCallbacks.parseValue ?? defaultParseValue);
          const baseDoc = parse?.(editor, authoritativeBase.value) ?? null;
          const serverDoc = parse?.(editor, value) ?? null;
          if (!baseDoc || !serverDoc) {
            isSettingContentRef.current = false;
            if (reportedConflictRevisionRef.current !== contentRevision) {
              reportedConflictRevisionRef.current = contentRevision;
              scheduledCallbacks.onBaseAwareReconcile({
                status: "failed",
                content: beforeMarkdown,
                serverContent: value,
                baseRevision: authoritativeBase.revision,
                serverRevision: contentRevision,
              });
            }
            return;
          }
          const reconciled = reconcileDocAgainstBase(
            editor,
            baseDoc,
            serverDoc,
            { overlapPolicy },
          );
          if (
            reconciled.status === "conflict" ||
            reconciled.status === "failed"
          ) {
            isSettingContentRef.current = false;
            if (reportedConflictRevisionRef.current !== contentRevision) {
              reportedConflictRevisionRef.current = contentRevision;
              scheduledCallbacks.onBaseAwareReconcile({
                status: reconciled.status,
                content: beforeMarkdown,
                serverContent: value,
                baseRevision: authoritativeBase.revision,
                serverRevision: contentRevision,
              });
            }
            return;
          }
          const merged = scheduledCallbacks.getMarkdown(editor);
          isSettingContentRef.current = false;
          authoritativeBaseRef.current = { value, revision: contentRevision };
          reportedConflictRevisionRef.current = null;
          lastEmittedRef.current = merged;
          pushEmittedRing(recentEmittedRef.current, merged);
          lastAppliedValueRef.current = value;
          lastAppliedSerializedRef.current = merged;
          if (contentUpdatedAt)
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
          if (merged !== beforeMarkdown)
            scheduledCallbacks.onRemoteSnapshotChange?.(merged);
          if (merged !== normalized) {
            scheduledCallbacks.onBaseAwareReconcile({
              status: "merged",
              content: merged,
              serverContent: value,
              baseRevision: authoritativeBase.revision,
              serverRevision: contentRevision,
            });
          }
          return;
        }
        let appliedSurgically = false;
        if (scheduledCallbacks.parseValue !== false) {
          const parse = scheduledCallbacks.parseValue ?? defaultParseValue;
          const parsedDoc = parse(editor, value);
          if (parsedDoc) {
            const result = applyDocSurgically(editor, parsedDoc);
            appliedSurgically = result === "applied" || result === "noop";
          }
        }
        if (!appliedSurgically) {
          scheduledCallbacks.setContent(editor, value, {
            emitUpdate: false,
            addToHistory: false,
          });
        }
        isSettingContentRef.current = false;
        const serialized = scheduledCallbacks.getMarkdown(editor);
        lastEmittedRef.current = serialized;
        pushEmittedRing(recentEmittedRef.current, serialized);
        lastAppliedValueRef.current = value;
        lastAppliedSerializedRef.current = serialized;
        if (contentRevision) {
          authoritativeBaseRef.current = { value, revision: contentRevision };
          reportedConflictRevisionRef.current = null;
        }
        if (contentUpdatedAt) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
        if (serialized !== beforeMarkdown) {
          scheduledCallbacks.onRemoteSnapshotChange?.(serialized);
        }
      }, 0);
      retry = applyTimer;
    };

    apply();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [
    contentUpdatedAt,
    contentRevision,
    compareContentRevisions,
    acknowledgedLocalSnapshot,
    editor,
    ydoc,
    editable,
    value,
    collab,
    collabSynced,
    isLeadClient,
    overlapPolicy,
    collabBackedSnapshot,
    pendingCollabSnapshot,
    requestCollabSync,
  ]);

  const shouldIgnoreUpdate = (transaction: Transaction): boolean => {
    if (!editable || isSettingContentRef.current) return true;
    if (collab && !seededRef.current) {
      const firstSyncedEmptyUserEdit =
        collabSynced &&
        !value.trim() &&
        transaction.docChanged &&
        Boolean(transaction.getMeta("uiEvent")) &&
        !isChangeOrigin(transaction);
      if (!firstSyncedEmptyUserEdit) return true;
      seededRef.current = true;
    }
    if (transaction.getMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION)) {
      return true;
    }
    if (collab && transaction && isRemoteCollaborativeTransaction(transaction))
      return true;
    lastTypedAtRef.current = Date.now();
    return false;
  };

  const reportRemoteUpdate = (transaction: Transaction): void => {
    if (
      !collab ||
      !collabSynced ||
      !seededRef.current ||
      !editor ||
      editor.isDestroyed ||
      isSettingContentRef.current ||
      !transaction.docChanged ||
      !isChangeOrigin(transaction) ||
      transaction.getMeta(ySyncPluginKey)?.isUndoRedoOperation
    ) {
      return;
    }
    onRemoteSnapshotChange?.(getMarkdown(editor));
  };

  const registerEmitted = (markdown: string): boolean => {
    if (collab && !markdown.trim()) return false;
    lastEmittedRef.current = markdown;
    pushEmittedRing(recentEmittedRef.current, markdown);
    lastRegisteredLocalEmissionRef.current = markdown;
    return true;
  };

  return {
    collab,
    initialSeedFailed,
    initialSeedPending: Boolean(requestInitialSeed) && collab && !seeded,
    retryInitialSeed: () => {
      setInitialSeedFailed(false);
      setInitialSeedRetry((retry) => retry + 1);
    },
    isSettingContentRef,
    shouldIgnoreUpdate,
    reportRemoteUpdate,
    registerEmitted,
  };
}
