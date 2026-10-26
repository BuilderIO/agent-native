import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { updateYFragment, ySyncPluginKey } from "@tiptap/y-tiptap";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import {
  Doc as YDoc,
  applyUpdate,
  encodeStateAsUpdate,
  equalSnapshots,
  snapshot,
  type XmlFragment,
} from "yjs";

import { AGENT_CLIENT_ID, isReconcileLeadClient } from "../collab-ui/index.js";
import {
  RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION,
  applyDocSurgically,
  defaultParseValue,
  planDocReconcile,
  reconcileDocAgainstBase,
  surgicalApplyTarget,
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
const CATCH_UP_ATTEMPTS = 3;
const CATCH_UP_RETRY_MS = 2000;
const ADOPTION_RETRY_MS = 1000;
const ADOPTION_RETRY_MAX_MS = 30_000;
const ADOPTION_WARN_AFTER_FAILURES = 3;
// Each rebase follows a change another editor made first. Past a few in a
// row, the doc is busy, so rebuilds back off like failures.
const ADOPTION_REBASES_BEFORE_BACKOFF = 3;
// The Y.Map in which the server records the saved revision the live doc last
// took in, and its body; SNAPSHOT_ADOPTION_MAP in @agent-native/core/collab.
export const SNAPSHOT_ADOPTION_MAP = "agentNativeSnapshotAdoption";

function adoptedMarkerOf(doc: YDoc): {
  revision: string | null;
  body: string | null;
} {
  const marker = doc.getMap(SNAPSHOT_ADOPTION_MAP);
  const revision = marker.get("revision");
  const body = marker.get("body");
  return {
    revision: typeof revision === "string" ? revision : null,
    body: typeof body === "string" ? body : null,
  };
}

/** Whether the doc `whole` encodes already holds every change in `part`. */
function stateHoldsAll(whole: Uint8Array, part: Uint8Array): boolean {
  const before = new YDoc();
  const merged = new YDoc();
  try {
    applyUpdate(before, whole);
    applyUpdate(merged, whole);
    applyUpdate(merged, part);
    return equalSnapshots(snapshot(merged), snapshot(before));
  } finally {
    before.destroy();
    merged.destroy();
  }
}
// The provider sends the server every update but its own; the adopted state
// came from the server, so it is not sent back.
const SNAPSHOT_ADOPTION_ORIGIN = "remote";
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
  /**
   * Called once for each changed saved body the base-aware merge takes in, with
   * how many of its changed runs of top-level blocks were set aside for
   * overlapping this tab's edits (only `prefer-live` sets any aside). For
   * counting: it runs once the merge is in the doc (when the server adopts
   * snapshots, once the server takes it in) and cannot change it, even by
   * throwing.
   */
  onBaseAwareMerge?: (outcome: { setAside: number }) => void;
  onRemoteSnapshotChange?: (markdown: string) => void;
  requestInitialSeed?: (editor: Editor, value: string) => Promise<Uint8Array>;
  /**
   * Sends the live doc with a newer saved snapshot taken in, as a Yjs update,
   * for the server to apply once per revision; returns the server's doc. Every
   * open editor proposes the same snapshot, and without this each one's
   * inserts survive the merge, so the text appears once per editor.
   * `already-adopted` means another editor's proposal won; `rebase` means the
   * doc took in `adoptedRevision`, or live edits, that the proposal was not
   * built on, and `state` is the doc to build it on again; `stale` means
   * a newer body was saved. `adoptedBody` is the saved body at
   * `adoptedRevision`, which the next proposal is planned against. A
   * rejection retries with backoff, except a 4xx other than 404, 408 or 429, which
   * stops; the snapshot is never applied here alone. Leave it unset and the
   * snapshot is applied locally.
   */
  requestSnapshotAdoption?: (request: {
    revision: string;
    update: Uint8Array;
  }) => Promise<{
    status: "adopted" | "already-adopted" | "rebase" | "stale";
    adoptedRevision?: string | null;
    adoptedBody?: string | null;
    state: Uint8Array;
  }>;
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
  /**
   * The host's half of "this client holds no unsaved text": no save queued or
   * in flight and no recovery draft pending. The hook adds the other half, that
   * the live doc still equals the last authoritative snapshot it adopted. Only
   * when both hold may an idle lead adopt a newer snapshot without the peer
   * settle wait. Leave it unset and the wait always applies.
   * `lastAppliedSerialized` cannot stand in, because local emits update it.
   */
  isEditorClean?: (liveMarkdown: string) => boolean;
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
  onBaseAwareMerge,
  onRemoteSnapshotChange,
  requestInitialSeed,
  requestSnapshotAdoption,
  quietSeedEditability = false,
  onInitialSeedError,
  overlapPolicy = "conflict",
  editable,
  isEditorFocused = defaultIsEditorFocused,
  getMarkdown = getEditorMarkdown,
  isEditorClean,
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
    isEditorClean,
    onBaseAwareReconcile,
    onBaseAwareMerge,
    onRemoteSnapshotChange,
  });
  reconcileCallbacksRef.current = {
    getMarkdown,
    setContent,
    parseValue,
    normalizeValue,
    isEditorFocused,
    isEditorClean,
    onBaseAwareReconcile,
    onBaseAwareMerge,
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
              lastAppliedSerializedRef.current = serialized;
              // Another editor's seed of an older body can win the claim; the
              // newer body is then still to be taken in, not applied.
              if (
                serialized ===
                reconcileCallbacksRef.current.normalizeValue(value)
              ) {
                lastAppliedValueRef.current = value;
                if (contentUpdatedAt)
                  lastAppliedUpdatedAtRef.current = contentUpdatedAt;
              } else {
                lastAppliedValueRef.current = null;
                lastAppliedUpdatedAtRef.current = null;
              }
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
  const adoptionInFlightRef = useRef(false);
  const adoptionRebasesRef = useRef<{ revision: string; count: number }>({
    revision: "",
    count: 0,
  });
  // The adoption marker this editor last read from its doc. One that changes
  // under it came from another editor, and the doc holds that saved body.
  const seenAdoptionRef = useRef<string | null | undefined>(undefined);
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
    catchUpFailures: number;
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
        catchUpFailures: 0,
      };
    }
    const peerWait = peerReconcileWaitRef.current!;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // Adoption retries waiting out a backoff, each dropped with its wait.
    const backoffs = new Set<() => void>();
    // Another editor's adoption that reached this doc through sync makes its
    // body the base; measured against an older one, that body would look like
    // typing here, and the next snapshot's changes to it would be dropped.
    const takeInReceivedAdoption = () => {
      if (!ydoc || !requestSnapshotAdoption) return;
      const marker = adoptedMarkerOf(ydoc);
      const seen = seenAdoptionRef.current;
      seenAdoptionRef.current = marker.revision;
      if (seen === undefined || seen === marker.revision) return;
      if (marker.revision === null || marker.body === null) return;
      const base = authoritativeBaseRef.current;
      if (base?.revision === marker.revision) return;
      const order = base
        ? compareContentRevisions?.(marker.revision, base.revision)
        : null;
      // A save this editor made since then is the newer base.
      if (order !== undefined && order !== null && order < 0) return;
      authoritativeBaseRef.current = {
        value: marker.body,
        revision: marker.revision,
      };
      reportedConflictRevisionRef.current = null;
      const callbacks = reconcileCallbacksRef.current;
      const markdown = callbacks.getMarkdown(editor);
      if (markdown === callbacks.normalizeValue(marker.body)) {
        lastAppliedValueRef.current = marker.body;
        lastAppliedSerializedRef.current = markdown;
      }
    };
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
      // The doc the server returns decides what this snapshot still changes.
      if (adoptionInFlightRef.current) {
        retry = setTimeout(() => apply(deferred), 100);
        return;
      }
      takeInReceivedAdoption();
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
      // A parent that derives `value` and `contentUpdatedAt` separately can
      // render the new timestamp next to the old value first. That render
      // marks the timestamp applied, so the new value that follows it would
      // never be adopted.
      const valueChangedAtSameTimestamp =
        !contentRevision &&
        !!contentUpdatedAt &&
        contentUpdatedAt === lastAppliedUpdatedAtRef.current &&
        lastAppliedValueRef.current !== null &&
        value !== lastAppliedValueRef.current;
      const externalNewer =
        revisionChangedAtSameTimestamp ||
        valueChangedAtSameTimestamp ||
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
      // updates that carry the same text (a collab poll lags the action poll,
      // and a save's merged answer lags neither), and applying it first
      // inserts that text a second time when they land. Only a collab-backed
      // revision, returned above, is known to be in the Yjs doc already.
      const snapshotKey = `${contentRevision ?? ""}@${contentUpdatedAt ?? ""}`;
      if (
        collab &&
        externalNewer &&
        requestCollabSync &&
        syncedBeforeAdoptRef.current !== snapshotKey
      ) {
        // The update a failed catch-up missed may only be late, so the
        // catch-up retries first. Past that, adopting without it is the
        // behavior before this step existed, so the sync degrades to it,
        // loudly.
        const caughtUp = (
          status: "synced" | "failed" | "unavailable",
          error?: unknown,
        ) => {
          if (status !== "synced") {
            if (++peerWait.catchUpFailures < CATCH_UP_ATTEMPTS) {
              if (!cancelled)
                retry = setTimeout(() => apply(deferred), CATCH_UP_RETRY_MS);
              return;
            }
            console.warn(
              `Adopting a saved snapshot without a live sync (${status})`,
              ...(error === undefined ? [] : [error]),
            );
          }
          syncedBeforeAdoptRef.current = snapshotKey;
          if (!cancelled) apply(deferred);
        };
        void requestCollabSync().then(
          (result) => caughtUp(result.status),
          (error: unknown) => caughtUp("failed", error),
        );
        return;
      }

      if (
        collab &&
        externalNewer &&
        !deferred &&
        peerCountRef.current > 0 &&
        !(
          authoritativeBaseRef.current !== null &&
          callbacks.normalizeValue(authoritativeBaseRef.current.value) ===
            currentMarkdown &&
          callbacks.isEditorClean?.(currentMarkdown)
        )
      ) {
        peerWait.deadline ??= Date.now() + PEER_SETTLE_MS;
        const remaining = peerWait.deadline - Date.now();
        if (remaining > 0) {
          retry = setTimeout(() => apply(true), remaining);
          return;
        }
      }

      const applyTimer = setTimeout(() => {
        if (cancelled || editor.isDestroyed) return;
        if (adoptionInFlightRef.current) {
          retry = setTimeout(() => apply(deferred), 100);
          return;
        }
        takeInReceivedAdoption();
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
        const parse =
          scheduledCallbacks.parseValue === false
            ? null
            : (scheduledCallbacks.parseValue ?? defaultParseValue);
        // Every open editor proposes the same snapshot. Applied locally, each
        // proposal's inserts survive the merge and the text appears once per
        // editor, so the server takes in one proposal per revision and every
        // editor shows the doc it returns.
        const adoptSnapshot =
          collab && ydoc && contentRevision && requestSnapshotAdoption
            ? requestSnapshotAdoption
            : null;
        // `onTaken` runs once the server takes the proposal in, even when a
        // newer snapshot has cancelled this one; `settle` runs only when
        // nothing has.
        const adoptThroughServer = (
          target: ProseMirrorNode,
          settle: () => void,
          onTaken?: () => void,
        ) => {
          if (!adoptSnapshot || !ydoc || !contentRevision) return;
          let update: Uint8Array;
          const scratch = new YDoc();
          try {
            applyUpdate(scratch, encodeStateAsUpdate(ydoc));
            updateYFragment(
              scratch,
              scratch.getXmlFragment("default"),
              target,
              {
                mapping: new Map(),
                isOMark: new Map(),
              },
            );
            update = encodeStateAsUpdate(scratch);
          } finally {
            scratch.destroy();
          }
          const proposedMarker = adoptedMarkerOf(ydoc).revision;
          const proposedBase = authoritativeBaseRef.current;
          adoptionInFlightRef.current = true;
          let failures = 0;
          const release = () => {
            adoptionInFlightRef.current = false;
          };
          const backoff = (attempt: number) =>
            Math.min(
              ADOPTION_RETRY_MS * 2 ** (attempt - 1),
              ADOPTION_RETRY_MAX_MS,
            );
          // Only the server's answer may put the snapshot into the doc. A
          // proposal applied here as well would sit beside the one the server
          // took, and an answer lost after the server took it would too. So
          // would one applied here because this editor's server cannot take
          // it while another editor's server can.
          const fail = (error: unknown) => {
            if (cancelled || editor.isDestroyed) {
              release();
              return;
            }
            const status =
              error && typeof error === "object" && "status" in error
                ? error.status
                : undefined;
            if (
              typeof status === "number" &&
              status >= 400 &&
              status < 500 &&
              // An instance from before adoptions existed answers 404 while
              // a deploy rolls out; a later attempt reaches a newer one.
              status !== 404 &&
              status !== 408 &&
              status !== 429
            ) {
              release();
              console.warn("The server refused a saved snapshot", error);
              return;
            }
            failures += 1;
            if (failures === ADOPTION_WARN_AFTER_FAILURES) {
              console.warn(
                "Still retrying a saved snapshot the server has not taken",
                error,
              );
            }
            // Not `retry`: cleanup drops the wait and the in-flight mark
            // together, so a newer snapshot doesn't wait out this one's
            // backoff. No request is out while it waits.
            const abandon = () => {
              backoffs.delete(abandon);
              clearTimeout(timer);
              release();
            };
            const timer = setTimeout(() => {
              backoffs.delete(abandon);
              propose();
            }, backoff(failures));
            backoffs.add(abandon);
          };
          const propose = () => {
            if (cancelled || editor.isDestroyed) {
              release();
              return;
            }
            void adoptSnapshot({ revision: contentRevision, update }).then(
              (result) => {
                if (editor.isDestroyed) {
                  release();
                  return;
                }
                isSettingContentRef.current = true;
                try {
                  applyUpdate(ydoc, result.state, SNAPSHOT_ADOPTION_ORIGIN);
                } catch (error) {
                  isSettingContentRef.current = false;
                  fail(error);
                  return;
                }
                isSettingContentRef.current = false;
                release();
                const taken =
                  result.status === "adopted" ||
                  result.status === "already-adopted";
                if (taken) onTaken?.();
                // For `rebase`, a marker past the one this proposal held is
                // another editor's adoption, whose body is the new base. With
                // the marker unchanged, the server held live edits the
                // proposal lacked, and the base stands.
                const markerMoved =
                  result.status === "rebase" &&
                  result.adoptedRevision !== proposedMarker;
                const adopted = taken
                  ? { value, revision: contentRevision }
                  : markerMoved &&
                      typeof result.adoptedRevision === "string" &&
                      typeof result.adoptedBody === "string"
                    ? {
                        value: result.adoptedBody,
                        revision: result.adoptedRevision,
                      }
                    : null;
                if (adopted) seenAdoptionRef.current = adopted.revision;
                if (cancelled) {
                  // The newer snapshot that cancelled this one is planned
                  // against the revision the doc holds.
                  if (
                    adopted &&
                    authoritativeBaseRef.current === proposedBase
                  ) {
                    authoritativeBaseRef.current = adopted;
                  }
                  return;
                }
                // A newer body was saved meanwhile; it arrives as its own
                // snapshot, measured against the base this one would replace.
                if (result.status === "stale") return;
                if (result.status === "rebase") {
                  if (
                    (markerMoved && !adopted) ||
                    stateHoldsAll(update, result.state)
                  ) {
                    console.warn(
                      "The server sent a saved snapshot back to rebuild on a doc it did not send",
                      result.adoptedRevision,
                    );
                    return;
                  }
                  const rebases = adoptionRebasesRef.current;
                  if (rebases.revision !== contentRevision) {
                    rebases.revision = contentRevision;
                    rebases.count = 0;
                  }
                  rebases.count += 1;
                  if (adopted) {
                    authoritativeBaseRef.current = adopted;
                    reportedConflictRevisionRef.current = null;
                    const callbacks = reconcileCallbacksRef.current;
                    const markdown = callbacks.getMarkdown(editor);
                    // A doc that is exactly that revision holds no typing
                    // this snapshot could overwrite.
                    if (markdown === callbacks.normalizeValue(adopted.value)) {
                      lastAppliedValueRef.current = adopted.value;
                      lastAppliedSerializedRef.current = markdown;
                    }
                  }
                  // Plan this snapshot again on the doc the server sent.
                  retry = setTimeout(
                    () => apply(deferred),
                    rebases.count <= ADOPTION_REBASES_BEFORE_BACKOFF
                      ? 0
                      : backoff(
                          rebases.count - ADOPTION_REBASES_BEFORE_BACKOFF,
                        ),
                  );
                  return;
                }
                settle();
              },
              fail,
            );
          };
          propose();
        };
        const authoritativeBase = authoritativeBaseRef.current;
        if (
          contentRevision &&
          scheduledCallbacks.onBaseAwareReconcile &&
          authoritativeBase &&
          authoritativeBase.revision !== contentRevision
        ) {
          const baseDoc = parse?.(editor, authoritativeBase.value) ?? null;
          const serverDoc = parse?.(editor, value) ?? null;
          const report = (status: "conflict" | "failed") => {
            if (reportedConflictRevisionRef.current === contentRevision) return;
            reportedConflictRevisionRef.current = contentRevision;
            scheduledCallbacks.onBaseAwareReconcile?.({
              status,
              content: beforeMarkdown,
              serverContent: value,
              baseRevision: authoritativeBase.revision,
              serverRevision: contentRevision,
            });
          };
          if (!baseDoc || !serverDoc) {
            report("failed");
            return;
          }
          // Only a newer body that differs from the base is a merge; one with
          // the base's body brings nothing to merge.
          const countMerge = (setAside: number) => {
            if (serverDoc.eq(baseDoc)) return;
            try {
              scheduledCallbacks.onBaseAwareMerge?.({ setAside });
            } catch {
              // coercion-ok: counting a merge never changes the merge.
            }
          };
          const settleMerged = () => {
            const merged = scheduledCallbacks.getMarkdown(editor);
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
              scheduledCallbacks.onBaseAwareReconcile?.({
                status: "merged",
                content: merged,
                serverContent: value,
                baseRevision: authoritativeBase.revision,
                serverRevision: contentRevision,
              });
            }
          };
          const reconcileLocally = () => {
            isSettingContentRef.current = true;
            const reconciled = reconcileDocAgainstBase(
              editor,
              baseDoc,
              serverDoc,
              { overlapPolicy },
            );
            isSettingContentRef.current = false;
            if (
              reconciled.status === "conflict" ||
              reconciled.status === "failed"
            ) {
              report(reconciled.status);
              return;
            }
            countMerge(reconciled.setAside);
            settleMerged();
          };
          if (!adoptSnapshot) {
            reconcileLocally();
            return;
          }
          const plan = planDocReconcile(editor.state.doc, baseDoc, serverDoc, {
            overlapPolicy,
            ...(editor.isFocused
              ? { liveSelection: editor.state.selection }
              : {}),
          });
          if (plan.status === "conflict" || plan.status === "failed") {
            report(plan.status);
            return;
          }
          if (plan.status === "noop") {
            countMerge(plan.setAside);
            settleMerged();
            return;
          }
          // The server can send a proposal back to plan again, or call it
          // stale; only the one it takes in is counted.
          adoptThroughServer(plan.mergedDoc, settleMerged, () =>
            countMerge(plan.setAside),
          );
          return;
        }
        const settleApplied = () => {
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
        };
        const applyLocally = () => {
          isSettingContentRef.current = true;
          let appliedSurgically = false;
          const parsedDoc = parse?.(editor, value) ?? null;
          if (parsedDoc) {
            const result = applyDocSurgically(editor, parsedDoc);
            appliedSurgically = result === "applied" || result === "noop";
          }
          if (!appliedSurgically) {
            scheduledCallbacks.setContent(editor, value, {
              emitUpdate: false,
              addToHistory: false,
            });
          }
          isSettingContentRef.current = false;
          settleApplied();
        };
        const parsedDoc = adoptSnapshot
          ? (parse?.(editor, value) ?? null)
          : null;
        if (!parsedDoc) {
          applyLocally();
          return;
        }
        const target = surgicalApplyTarget(editor.state.doc, parsedDoc);
        if (target === "noop") {
          settleApplied();
          return;
        }
        // Where no surgical change fits, the whole parsed body replaces the
        // doc, as `setContent` would.
        adoptThroughServer(
          target === "failed" ? parsedDoc : target,
          settleApplied,
        );
      }, 0);
      retry = applyTimer;
    };

    apply();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      for (const abandon of [...backoffs]) abandon();
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
    requestSnapshotAdoption,
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
