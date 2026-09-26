import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

import { AGENT_CLIENT_ID, isReconcileLeadClient } from "../collab-ui/index.js";
import {
  RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION,
  applyDocSurgically,
  defaultParseValue,
  reconcileDocAgainstBase,
} from "./surgical-apply.js";

export { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION };

export function getEditorMarkdown(editor: Editor): string {
  const markdownStorage = editor.storage as unknown as {
    markdown?: { getMarkdown?: () => string };
  };
  return markdownStorage.markdown?.getMarkdown?.() ?? "";
}

const EMITTED_RING_MAX = 16;
const PEER_SETTLE_MS = 2500;
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
  isSettingContentRef: MutableRefObject<boolean>;
  shouldIgnoreUpdate: (transaction: Transaction) => boolean;
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
  useEffect(() => {
    if (!collab || !editor || editor.isDestroyed || !ydoc) return;
    if (seededRef.current) return;
    if (!collabSynced) return;
    if (collabBackedSnapshot) {
      seededRef.current = true;
      return;
    }
    if (contentRevision) {
      authoritativeBaseRef.current = { value, revision: contentRevision };
      reportedConflictRevisionRef.current = null;
    }
    if (!value.trim()) {
      seededRef.current = true;
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
    if (!isLeadClient) {
      const releaseTimer = setTimeout(() => {
        seededRef.current = true;
      }, 0);
      return () => clearTimeout(releaseTimer);
    }
    let cancelled = false;
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
        seededRef.current = true;
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
      seededRef.current = true;
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(seedTimer);
    };
  }, [
    collab,
    collabSynced,
    editor,
    ydoc,
    value,
    isLeadClient,
    contentUpdatedAt,
    contentRevision,
    getMarkdown,
    setContent,
    shouldSeed,
    collabBackedSnapshot,
  ]);

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
      };
    }
    const peerWait = peerReconcileWaitRef.current!;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const apply = (deferred = false) => {
      if (cancelled || editor.isDestroyed) return;
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
      const currentMarkdown = getMarkdown(editor);
      const normalizedValue = normalizeValue(value);
      const editorUnchangedSinceApply =
        lastAppliedSerializedRef.current !== null &&
        currentMarkdown === lastAppliedSerializedRef.current;
      const editorFocused = isEditorFocused(editor);
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
        if (contentUpdatedAt && !externalNewer) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
        return;
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
        peerWait.deadline = null;
        const beforeMarkdown = getMarkdown(editor);
        const normalized = normalizeValue(value);
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
          onBaseAwareReconcile &&
          authoritativeBase &&
          authoritativeBase.revision !== contentRevision
        ) {
          const parse =
            parseValue === false ? null : (parseValue ?? defaultParseValue);
          const baseDoc = parse?.(editor, authoritativeBase.value) ?? null;
          const serverDoc = parse?.(editor, value) ?? null;
          if (!baseDoc || !serverDoc) {
            isSettingContentRef.current = false;
            if (reportedConflictRevisionRef.current !== contentRevision) {
              reportedConflictRevisionRef.current = contentRevision;
              onBaseAwareReconcile({
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
              onBaseAwareReconcile({
                status: reconciled.status,
                content: beforeMarkdown,
                serverContent: value,
                baseRevision: authoritativeBase.revision,
                serverRevision: contentRevision,
              });
            }
            return;
          }
          const merged = getMarkdown(editor);
          isSettingContentRef.current = false;
          authoritativeBaseRef.current = { value, revision: contentRevision };
          reportedConflictRevisionRef.current = null;
          lastEmittedRef.current = merged;
          pushEmittedRing(recentEmittedRef.current, merged);
          lastAppliedValueRef.current = value;
          lastAppliedSerializedRef.current = merged;
          if (contentUpdatedAt)
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
          if (merged !== normalized) {
            onBaseAwareReconcile({
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
        if (parseValue !== false) {
          const parse = parseValue ?? defaultParseValue;
          const parsedDoc = parse(editor, value);
          if (parsedDoc) {
            const result = applyDocSurgically(editor, parsedDoc);
            appliedSurgically = result === "applied" || result === "noop";
          }
        }
        if (!appliedSurgically) {
          setContent(editor, value, { emitUpdate: false, addToHistory: false });
        }
        isSettingContentRef.current = false;
        const serialized = getMarkdown(editor);
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
    getMarkdown,
    setContent,
    parseValue,
    normalizeValue,
    isEditorFocused,
    onBaseAwareReconcile,
    overlapPolicy,
    collabBackedSnapshot,
    pendingCollabSnapshot,
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
    if (collab && transaction && isChangeOrigin(transaction)) return true;
    lastTypedAtRef.current = Date.now();
    return false;
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
    isSettingContentRef,
    shouldIgnoreUpdate,
    registerEmitted,
  };
}
