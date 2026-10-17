import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
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
const CATCH_UP_ATTEMPTS = 3;
const CATCH_UP_RETRY_MS = 2000;
const JOIN_EVIDENCE_TIMEOUT_MS = 20_000;
const JOIN_EVIDENCE_RETRY_MS = 500;
function pushEmittedRing(ring: string[], value: string): void {
  if (!value) return;
  if (ring[ring.length - 1] === value) return;
  const dupe = ring.indexOf(value);
  if (dupe !== -1) ring.splice(dupe, 1);
  ring.push(value);
  if (ring.length > EMITTED_RING_MAX) ring.shift();
}

/** Awareness field naming the stored revision a client's live doc holds. */
const HELD_REVISION_FIELD = "reconciledRevision";

const JOIN_READ_ONLY = new PluginKey("collabJoinReadOnly");

/** Evidence for one stored revision; a revision that moves needs its own. */
type JoinEvidence = { ydoc: YDoc; revision: string } & (
  | { status: "pending" }
  | { status: "ready"; claims: Set<string>; current: () => boolean }
  | { status: "failed"; error: unknown }
);

/**
 * The stored revision a collaborator's report vouches for. Only a person's
 * editor that flushes its updates before reporting vouches for one.
 */
function heldRevisionClaim(state: unknown): string | null {
  const peer = state as
    | {
        user?: unknown;
        canFlushDocument?: boolean;
        [HELD_REVISION_FIELD]?: unknown;
      }
    | undefined;
  if (!peer?.user || peer.canFlushDocument === false) return null;
  const revision = peer[HELD_REVISION_FIELD];
  return typeof revision === "string" ? revision : null;
}

function claimsHoldRevision(
  claims: Set<string>,
  revision: string,
  compareContentRevisions:
    | ((first: string, second: string) => number | null)
    | undefined,
): boolean {
  for (const claim of claims) {
    const order =
      claim === revision ? 0 : compareContentRevisions?.(claim, revision);
    if (typeof order === "number" && order >= 0) return true;
  }
  return false;
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
  /**
   * Learns who else holds the document. Set it, with `flushCollabUpdates`,
   * `requestCollabSync`, `awareness` and revisions, and a client opening onto
   * a live doc that differs from the stored body keeps the doc when a
   * collaborator reports it already holds this stored revision or a newer one,
   * instead of replacing it with the stored body: the doc can be ahead of a
   * save still on its way, and the replace deletes that text for every
   * collaborator. Without such a report, or without these options, it replaces
   * the doc as before. Until the doc holds the stored body, kept on such a
   * report or applied, the editor is read-only and reports no update to save.
   * When it cannot learn who else is open, or the stored body has not reached
   * the doc in time, it stays that way, leaves the doc as it is and reports
   * `joinEvidenceFailed` until `retryJoinEvidence` succeeds or the doc and
   * the stored body match. A ready discovery whose `current()` turns false,
   * as when a presence answer since could not be read, is asked again.
   */
  discoverCollabPeers?: () => Promise<{
    status: "ready" | "failed" | "unavailable";
    error?: unknown;
    current?: () => boolean;
  }>;
  /**
   * Resolves `true` once the server has every local Yjs update. A client
   * reports the stored revision its doc holds (awareness `reconciledRevision`)
   * only after that, so a collaborator that trusts the report can fetch the
   * text it describes.
   */
  flushCollabUpdates?: () => Promise<boolean>;
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
  /**
   * True when a client joining a live doc that differs from the stored body
   * could not learn whether a collaborator holds that body, or learned that
   * none does and the body never reached the doc. The doc stays as it is,
   * neither replaced nor adopted, and the editor read-only, until
   * `retryJoinEvidence` succeeds or the doc and the stored body match.
   */
  joinEvidenceFailed: boolean;
  retryJoinEvidence: () => void;
  /**
   * True while a joining client's doc may lack the stored body: until a
   * collaborator vouches for it or it is applied, and after a failure. Nothing
   * may save the doc meanwhile: the save would delete a stored-only edit.
   * A function, read when saving: the join starts between renders.
   */
  isJoinPending: () => boolean;
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
  discoverCollabPeers,
  flushCollabUpdates,
  onBaseAwareReconcile,
  onRemoteSnapshotChange,
  requestInitialSeed,
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
  // A stored body the live doc wrote is held once this doc catches up to it,
  // as an applied one is, so a later snapshot merges against it rather than
  // joining again.
  const adoptedStoredBodyDocRef = useRef<YDoc | null>(null);
  const holdsStoredBody = () =>
    lastAppliedSerializedRef.current !== null ||
    (!!ydoc && adoptedStoredBodyDocRef.current === ydoc);
  const lastAppliedUpdatedAtRef = useRef<string | null>(
    initialAppliedUpdatedAt !== undefined
      ? initialAppliedUpdatedAt
      : (contentUpdatedAt ?? null),
  );
  const authoritativeBaseRef = useRef<{
    value: string;
    revision: string;
  } | null>(contentRevision ? { value, revision: contentRevision } : null);
  const joinsOnPeerEvidence = Boolean(
    collab &&
    awareness &&
    discoverCollabPeers &&
    flushCollabUpdates &&
    requestCollabSync,
  );
  const heldRevisionAwarenessRef = useRef<Awareness | null>(null);
  heldRevisionAwarenessRef.current = joinsOnPeerEvidence ? awareness : null;
  const flushCollabUpdatesRef = useRef(flushCollabUpdates);
  flushCollabUpdatesRef.current = flushCollabUpdates;
  const pendingHeldRevisionRef = useRef<string | null>(null);
  // A seed records the stored body as applied even when another client's seed
  // won with a different one, so this doc does not hold that body.
  const unheldSeedValueRef = useRef<string | null>(null);
  // A report goes out only once the server has the updates behind it: a joining
  // client that trusts a report fetches the doc from the server, and an update
  // still queued in a tab that then closes would never reach it.
  const publishHeldRevision = (revision: string) => {
    const target = heldRevisionAwarenessRef.current;
    const flush = flushCollabUpdatesRef.current;
    if (!target || !flush || pendingHeldRevisionRef.current === revision)
      return;
    pendingHeldRevisionRef.current = revision;
    const publish = (delivered: boolean) => {
      if (
        !delivered ||
        pendingHeldRevisionRef.current !== revision ||
        heldRevisionAwarenessRef.current !== target
      ) {
        if (pendingHeldRevisionRef.current === revision)
          pendingHeldRevisionRef.current = null;
        return;
      }
      if (target.getLocalState()?.[HELD_REVISION_FIELD] !== revision)
        target.setLocalStateField(HELD_REVISION_FIELD, revision);
    };
    flush().then(publish, () => publish(false));
  };
  const withdrawHeldRevision = () => {
    pendingHeldRevisionRef.current = null;
    const target = heldRevisionAwarenessRef.current;
    if (target && target.getLocalState()?.[HELD_REVISION_FIELD] != null)
      target.setLocalStateField(HELD_REVISION_FIELD, null);
  };
  // For a base the live doc now holds. The first base, taken before this client
  // has applied or adopted anything, is set directly instead.
  const holdAuthoritativeBase = (
    base: { value: string; revision: string },
    held = true,
  ) => {
    authoritativeBaseRef.current = base;
    if (held) publishHeldRevision(base.revision);
  };
  const discoverCollabPeersRef = useRef(discoverCollabPeers);
  discoverCollabPeersRef.current = discoverCollabPeers;
  const requestCollabSyncRef = useRef(requestCollabSync);
  requestCollabSyncRef.current = requestCollabSync;
  // Evidence for a client joining a live doc that differs from the stored
  // body: the revisions collaborators reported by the time it learned who else
  // is open, and the doc as the server has it after that, which holds every
  // update behind those reports. A report that arrives during the catch-up is
  // not covered by it, so a new report means catching up again.
  const [joinEvidence, setJoinEvidence] = useState<JoinEvidence | null>(null);
  // The gates read this, not the state: an update can arrive between a join
  // starting and the render that shows it.
  const joinEvidenceRef = useRef<JoinEvidence | null>(null);
  const putJoinEvidence = (next: JoinEvidence | null) => {
    joinEvidenceRef.current = next;
    setJoinEvidence(next);
  };
  const isJoinPending = () => {
    const evidence = joinEvidenceRef.current;
    if (!joinsOnPeerEvidence || evidence?.ydoc !== ydoc) return false;
    // Evidence that no collaborator holds the stored body leaves that body
    // still to apply, and a save before then deletes what only it has.
    return evidence.status !== "ready" || !holdsStoredBody();
  };
  const editableRef = useRef(editable);
  editableRef.current = editable;
  // A plugin rather than `setEditable`, which the seed sets back to `editable`.
  // `useEditor` without deps copies `isEditable` into the editor's options on
  // every render, so a render while the plugin holds leaves the editor
  // read-only after it goes unless `editable` is set back.
  const holdJoinReadOnly = () => {
    if (!editor || editor.isDestroyed || JOIN_READ_ONLY.get(editor.state))
      return;
    editor.registerPlugin(
      new Plugin({ key: JOIN_READ_ONLY, props: { editable: () => false } }),
    );
  };
  const releaseJoinReadOnly = () => {
    if (!editor || editor.isDestroyed || !JOIN_READ_ONLY.get(editor.state))
      return;
    editor.unregisterPlugin(JOIN_READ_ONLY);
    editor.setEditable(editableRef.current, false);
  };
  // Every revision a collaborator reported holding since this client started
  // joining its doc. The live doc keeps the updates behind a report, so a
  // presence list that later leaves the collaborator out, an older or partial
  // one included, does not take the report back. Recorded on every change, so
  // none is missed between two reads.
  const joinClaimsRef = useRef<{
    ydoc: YDoc;
    awareness: Awareness;
    claims: Set<string>;
    record: () => void;
  } | null>(null);
  const readJoinClaims = (doc: YDoc, target: Awareness) => {
    let current = joinClaimsRef.current;
    if (current?.ydoc !== doc || current.awareness !== target) {
      stopJoinClaims();
      const claims = new Set<string>();
      const record = () => {
        target.getStates().forEach((state, clientId) => {
          if (clientId === doc.clientID || clientId === AGENT_CLIENT_ID) return;
          const claim = heldRevisionClaim(state);
          if (claim !== null) claims.add(claim);
        });
      };
      target.on("change", record);
      current = { ydoc: doc, awareness: target, claims, record };
      joinClaimsRef.current = current;
    }
    current.record();
    return current.claims;
  };
  const stopJoinClaims = () => {
    const current = joinClaimsRef.current;
    current?.awareness.off("change", current.record);
    joinClaimsRef.current = null;
  };
  const joinEvidenceRequestRef = useRef<{
    ydoc: YDoc;
    revision: string;
    cancel: () => void;
  } | null>(null);
  // When the stored body must have reached a joining doc. Evidence asked for
  // again about the same revision keeps it, and must arrive by then too, so
  // asking again cannot put the failure off; a retry or a newer revision sets
  // a new one.
  const joinBodyDeadlineRef = useRef<{
    ydoc: YDoc;
    revision: string;
    at: number;
  } | null>(null);
  const requestJoinEvidence = (doc: YDoc, revision: string) => {
    const discover = discoverCollabPeersRef.current;
    const catchUp = requestCollabSyncRef.current;
    const target = heldRevisionAwarenessRef.current;
    const current = joinEvidenceRequestRef.current;
    if (
      (current?.ydoc === doc && current.revision === revision) ||
      !discover ||
      !catchUp ||
      !target
    )
      return;
    current?.cancel();
    readJoinClaims(doc, target);
    let settled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let unapplied: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      settled = true;
      clearTimeout(watchdog);
      clearTimeout(retry);
    };
    joinEvidenceRequestRef.current = {
      ydoc: doc,
      revision,
      cancel: () => {
        stop();
        clearTimeout(unapplied);
      },
    };
    putJoinEvidence({ ydoc: doc, revision, status: "pending" });
    holdJoinReadOnly();
    const settle = (evidence: Exclude<JoinEvidence, { status: "pending" }>) => {
      if (settled) return;
      stop();
      if (evidence.status === "failed")
        console.warn(
          "Could not learn who else holds this document; leaving it as it is until a retry",
          evidence.error,
        );
      if (joinEvidenceRef.current?.ydoc !== doc) return;
      putJoinEvidence(evidence);
      if (evidence.status !== "ready") return;
      // Unless a collaborator holds it, the stored body has yet to reach the
      // doc, by this client or the lead applying it. A doc it never reaches
      // stays unsaved, and says so.
      const deadline = joinBodyDeadlineRef.current;
      const at =
        deadline?.ydoc === doc && deadline.revision === revision
          ? deadline.at
          : Date.now() + JOIN_EVIDENCE_TIMEOUT_MS;
      joinBodyDeadlineRef.current = { ydoc: doc, revision, at };
      unapplied = setTimeout(
        () => {
          if (joinEvidenceRef.current !== evidence || holdsStoredBody()) return;
          const error = new Error("The stored body did not reach the document");
          console.warn(
            "The stored body did not reach this document; leaving it as it is until a retry",
            error,
          );
          putJoinEvidence({ ydoc: doc, revision, status: "failed", error });
        },
        Math.max(0, at - Date.now()),
      );
    };
    const fail = (error: unknown) =>
      settle({ ydoc: doc, revision, status: "failed", error });
    const bodyDeadline = joinBodyDeadlineRef.current;
    const watchdog = setTimeout(
      () => fail(new Error("Timed out")),
      bodyDeadline?.ydoc === doc && bodyDeadline.revision === revision
        ? Math.max(
            0,
            Math.min(JOIN_EVIDENCE_TIMEOUT_MS, bodyDeadline.at - Date.now()),
          )
        : JOIN_EVIDENCE_TIMEOUT_MS,
    );
    const attempt = async () => {
      const discovered = await discover();
      if (settled) return;
      if (discovered.status === "failed")
        return fail(discovered.error ?? new Error("Peer discovery failed"));
      if (discovered.status === "ready") {
        const current = discovered.current ?? (() => true);
        let claims = new Set(readJoinClaims(doc, target));
        while (current()) {
          const synced = await catchUp();
          if (settled) return;
          if (synced.status === "failed")
            return fail(new Error("Catching up with the server failed"));
          if (synced.status !== "synced" || !current()) break;
          const latest = readJoinClaims(doc, target);
          if (latest.size === claims.size)
            return settle({
              ydoc: doc,
              revision,
              status: "ready",
              claims,
              current,
            });
          claims = new Set(latest);
        }
      }
      // Not connected yet: ask again until the watchdog gives up.
      retry = setTimeout(
        () => void attempt().catch(fail),
        JOIN_EVIDENCE_RETRY_MS,
      );
    };
    void attempt().catch(fail);
  };
  useEffect(
    () => () => {
      joinEvidenceRequestRef.current?.cancel();
      stopJoinClaims();
    },
    [],
  );
  // The doc holds the stored body, adopted or applied, so it may be saved.
  const finishJoin = () => {
    if (joinEvidenceRef.current?.ydoc !== ydoc) return;
    joinEvidenceRequestRef.current?.cancel();
    joinEvidenceRequestRef.current = null;
    joinBodyDeadlineRef.current = null;
    putJoinEvidence(null);
    stopJoinClaims();
    releaseJoinReadOnly();
  };
  // Evidence a joining doc may act on: ready, about this revision, still
  // current, and holding every report collaborators made. A report made since
  // is not covered by its catch-up, so it catches up again.
  const currentJoinEvidence = (doc: YDoc, revision: string) => {
    const evidence = joinEvidenceRef.current;
    const target = heldRevisionAwarenessRef.current;
    if (
      evidence?.ydoc !== doc ||
      evidence.status !== "ready" ||
      evidence.revision !== revision ||
      !target
    )
      return null;
    if (
      evidence.current() &&
      readJoinClaims(doc, target).size === evidence.claims.size
    )
      return evidence;
    joinEvidenceRequestRef.current?.cancel();
    joinEvidenceRequestRef.current = null;
    requestJoinEvidence(doc, revision);
    return null;
  };
  // The stored snapshot a joining doc takes as current, props or an
  // acknowledged save, which the reconcile below records as it accepts one,
  // and the others it took at that time. Until the doc holds a stored body,
  // only the current one may finish its join: an older one, even one the doc
  // matches, lacks the newer stored edit. Revisions their times can't order,
  // the same time or none, go by revision order, else count in the order they
  // arrive, so one taken earlier cannot come back.
  const joinSnapshotRef = useRef<{
    ydoc: YDoc;
    updatedAt: string | null;
    revision: string | null;
    earlier: Set<string>;
  } | null>(null);
  const takeJoinSnapshot = (
    {
      updatedAt,
      revision: snapshotRevision,
    }: {
      updatedAt?: string | null;
      revision?: string | null;
    } = { updatedAt: contentUpdatedAt, revision: contentRevision },
  ) => {
    if (!joinsOnPeerEvidence || !ydoc || holdsStoredBody()) return true;
    const revision = snapshotRevision ?? null;
    const current =
      joinSnapshotRef.current?.ydoc === ydoc ? joinSnapshotRef.current : null;
    if (
      !current ||
      (updatedAt && current.updatedAt && updatedAt > current.updatedAt)
    ) {
      joinSnapshotRef.current = {
        ydoc,
        updatedAt: updatedAt ?? null,
        revision,
        earlier: new Set([
          ...(current?.earlier ?? []),
          ...(current?.revision ? [current.revision] : []),
        ]),
      };
      return true;
    }
    if (updatedAt && current.updatedAt && updatedAt < current.updatedAt)
      return false;
    if (revision === current.revision) {
      current.updatedAt ??= updatedAt ?? null;
      return true;
    }
    const order =
      revision && current.revision
        ? compareContentRevisions?.(revision, current.revision)
        : null;
    if (
      typeof order === "number"
        ? order <= 0
        : revision !== null && current.earlier.has(revision)
    )
      return false;
    if (current.revision) current.earlier.add(current.revision);
    current.updatedAt = updatedAt ?? null;
    current.revision = revision;
    return true;
  };
  const isCurrentJoinSnapshot = () => {
    const current = joinSnapshotRef.current;
    return (
      current?.ydoc === ydoc &&
      current.revision === (contentRevision ?? null) &&
      (!contentUpdatedAt || current.updatedAt === contentUpdatedAt)
    );
  };
  const reportedConflictRevisionRef = useRef<string | null>(null);
  const reconcileCallbacksRef = useRef({
    getMarkdown,
    setContent,
    parseValue,
    normalizeValue,
    isEditorFocused,
    isEditorClean,
    onBaseAwareReconcile,
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
    onRemoteSnapshotChange,
  };
  // Until it knows whether a collaborator holds the stored body, a joining
  // client's doc has no stored body under it: a save would delete whatever the
  // stored body holds that the doc lacks, and a replace once evidence arrives
  // would delete anything typed meanwhile. So it neither edits nor saves.
  const joinPending = isJoinPending();
  useEffect(() => {
    if (joinPending) holdJoinReadOnly();
    else releaseJoinReadOnly();
  }, [editor, joinPending, joinEvidence]);
  // The editor can outlive the hook, or be replaced under it.
  useEffect(() => () => releaseJoinReadOnly(), [editor]);
  // A doc the lead merged the stored body into also holds unsaved text, so it
  // never equals the stored body. The lead's report is how a waiting client
  // learns it arrived, and a report is trusted only after catching up again.
  useEffect(() => {
    const target = heldRevisionAwarenessRef.current;
    if (
      !target ||
      !ydoc ||
      joinEvidence?.ydoc !== ydoc ||
      joinEvidence.status !== "ready"
    )
      return;
    const evidence = joinEvidence;
    const onChange = () => {
      if (joinEvidenceRef.current === evidence && !holdsStoredBody())
        currentJoinEvidence(ydoc, evidence.revision);
    };
    target.on("change", onChange);
    onChange();
    return () => {
      target.off("change", onChange);
    };
  }, [joinEvidence, ydoc]);
  const acknowledgedLocalSnapshotRef = useRef<{
    value: string;
    revision: string;
    updatedAt: string;
    sequence: number;
  } | null>(null);
  // The latest acknowledgement a joining doc's snapshot record refused. The
  // record takes anything once the join finishes, so without this the refused
  // acknowledgement would then replace the newer body the join took.
  const refusedAcknowledgementRef = useRef<{
    ydoc: YDoc;
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
      holdAuthoritativeBase({
        value: pendingCollabSnapshot.value,
        revision: pendingCollabSnapshot.revision,
      });
      reportedConflictRevisionRef.current = null;
      if (pendingCollabSnapshot.updatedAt)
        lastAppliedUpdatedAtRef.current = pendingCollabSnapshot.updatedAt;
      acknowledgedCollabRef.current = pendingCollabSnapshot;
      // A newer snapshot the join took holds a stored edit this body lacks,
      // so only that one may finish it. Holding this body would end the join
      // too, so the doc holds it only then.
      const taken = joinSnapshotRef.current;
      if (
        taken?.ydoc !== pendingCollabSnapshot.ydoc ||
        taken.revision === pendingCollabSnapshot.revision
      ) {
        adoptedStoredBodyDocRef.current = pendingCollabSnapshot.ydoc;
        finishJoin();
      }
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
  // Read when the seed's timer fires, not when it was set: the inputs can
  // change in between without moving the seed.
  const seedJoinInputsRef = useRef({
    joinsOnPeerEvidence,
    contentRevision,
    value,
    collabBackedSnapshot,
    pendingCollabSnapshot,
    ydoc,
    editor,
  });
  seedJoinInputsRef.current = {
    joinsOnPeerEvidence,
    contentRevision,
    value,
    collabBackedSnapshot,
    pendingCollabSnapshot,
    ydoc,
    editor,
  };
  const markSeeded = () => {
    // The first reconcile runs a moment after this, and until it starts the
    // join the doc would report its updates as edits of the stored body.
    const inputs = seedJoinInputsRef.current;
    if (
      inputs.joinsOnPeerEvidence &&
      inputs.contentRevision &&
      inputs.value.trim() &&
      inputs.ydoc &&
      !inputs.collabBackedSnapshot &&
      inputs.pendingCollabSnapshot?.ydoc !== inputs.ydoc &&
      !holdsStoredBody() &&
      inputs.editor &&
      !inputs.editor.isDestroyed
    ) {
      const callbacks = reconcileCallbacksRef.current;
      const currentMarkdown = callbacks.getMarkdown(inputs.editor);
      if (
        currentMarkdown.trim() &&
        currentMarkdown !== callbacks.normalizeValue(inputs.value)
      )
        requestJoinEvidence(inputs.ydoc, inputs.contentRevision);
    }
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
      // Another client's seed can win with a different body. A doc that joins
      // on evidence leaves that body unapplied, as it leaves any live doc it
      // opens onto, so its join decides between it and the stored body.
      const takeSeededDoc = () => {
        const serialized = getMarkdown(editor);
        lastEmittedRef.current = serialized;
        pushEmittedRing(recentEmittedRef.current, serialized);
        const seededValueHeld =
          serialized === reconcileCallbacksRef.current.normalizeValue(value);
        unheldSeedValueRef.current = seededValueHeld ? null : value;
        if (seededValueHeld || !seedJoinInputsRef.current.joinsOnPeerEvidence) {
          lastAppliedValueRef.current = value;
          lastAppliedSerializedRef.current = serialized;
          if (contentUpdatedAt)
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
        if (contentRevision && seededValueHeld)
          publishHeldRevision(contentRevision);
        markSeeded();
      };
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
              takeSeededDoc();
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
      takeSeededDoc();
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
            withdrawHeldRevision();
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
        const refusedAcknowledgement = refusedAcknowledgementRef.current;
        const acknowledgementIsNewestAccepted =
          (!acceptedAcknowledgement ||
            acknowledgedLocalSnapshot.sequence >
              acceptedAcknowledgement.sequence) &&
          (refusedAcknowledgement?.ydoc !== ydoc ||
            acknowledgedLocalSnapshot.sequence >
              refusedAcknowledgement.sequence);
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
        const acknowledgementIsFresh =
          acknowledgementIsNewestAccepted && acknowledgementIsNotSuperseded;
        const acknowledgementTaken =
          acknowledgementIsFresh && takeJoinSnapshot(acknowledgedLocalSnapshot);
        if (acknowledgementIsFresh && !acknowledgementTaken && ydoc) {
          refusedAcknowledgementRef.current = {
            ydoc,
            sequence: acknowledgedLocalSnapshot.sequence,
          };
        }
        if (acknowledgementTaken) {
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
          holdAuthoritativeBase({
            value: acknowledgedLocalSnapshot.value,
            revision: acknowledgedLocalSnapshot.revision,
          });
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
          value === acknowledgedLocalSnapshot.value &&
          // Props stored after the acknowledgement they match are a snapshot
          // of their own, which a joining doc still takes.
          (!contentUpdatedAt ||
            contentUpdatedAt <= acknowledgedLocalSnapshot.updatedAt)
        ) {
          rejectedMatchingAcknowledgement = true;
        }
      }
      if (rejectedMatchingAcknowledgement) return;
      // Props older than ones already observed are a stale render, which the
      // base and the revision this tab reports must not move back to.
      if (
        joinsOnPeerEvidence &&
        contentUpdatedAt &&
        latestObservedUpdatedAtRef.current &&
        contentUpdatedAt < latestObservedUpdatedAtRef.current
      )
        return;
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
        if (!acknowledgementWasSuperseded && takeJoinSnapshot()) {
          holdAuthoritativeBase({
            value: acknowledged.value,
            revision: acknowledged.revision,
          });
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
      if (!takeJoinSnapshot()) return;
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
          finishJoin();
        }
        if (contentRevision) {
          holdAuthoritativeBase(
            { value, revision: contentRevision },
            currentMarkdown === normalizedValue ||
              unheldSeedValueRef.current !== value,
          );
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

      // This client opened onto a live doc that already differs from the
      // stored body. A collaborator may be typing ahead of a save still on its
      // way, and replacing the doc deletes that text for everyone; until
      // awareness arrives this client also counts itself the lead. So it waits
      // to learn who else is open, and keeps the doc when one reports holding
      // this revision.
      let joinedOn: ReturnType<typeof currentJoinEvidence> = null;
      if (
        joinsOnPeerEvidence &&
        contentRevision &&
        !holdsStoredBody() &&
        currentMarkdown.trim()
      ) {
        const evidence =
          joinEvidenceRef.current?.ydoc === ydoc
            ? joinEvidenceRef.current
            : null;
        if (
          !evidence ||
          (evidence.status !== "pending" &&
            evidence.revision !== contentRevision)
        ) {
          requestJoinEvidence(ydoc!, contentRevision);
          return;
        }
        // Without evidence this client cannot tell typing ahead of a save from
        // a stored change no collaborator holds yet, and either guess can lose
        // text, so a failure leaves the doc as it is and is reported.
        if (evidence.status !== "ready") return;
        joinedOn = currentJoinEvidence(ydoc!, contentRevision);
        if (!joinedOn) return;
        if (
          claimsHoldRevision(
            joinedOn.claims,
            contentRevision,
            compareContentRevisions,
          )
        ) {
          peerWait.deadline = null;
          peerWait.leadDeadline = null;
          lastAppliedValueRef.current = value;
          lastAppliedSerializedRef.current = normalizedValue;
          if (contentUpdatedAt)
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
          holdAuthoritativeBase({ value, revision: contentRevision });
          reportedConflictRevisionRef.current = null;
          finishJoin();
          return;
        }
      }

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
        const scheduledCallbacks = reconcileCallbacksRef.current;
        const beforeMarkdown = scheduledCallbacks.getMarkdown(editor);
        // A doc the gate let through can gain text, or its evidence a newer
        // report, before React cleans this timer up, so the gate runs again.
        const joining = joinsOnPeerEvidence && !holdsStoredBody();
        if (
          joining &&
          contentRevision &&
          beforeMarkdown.trim() &&
          (!joinedOn ||
            currentJoinEvidence(ydoc!, contentRevision) !== joinedOn)
        ) {
          apply(deferred);
          return;
        }
        peerWait.deadline = null;
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
          finishJoin();
          if (contentRevision) {
            holdAuthoritativeBase({ value, revision: contentRevision });
            reportedConflictRevisionRef.current = null;
          }
          if (contentUpdatedAt) {
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
          }
          return;
        }
        isSettingContentRef.current = true;
        const authoritativeBase = authoritativeBaseRef.current;
        // A joining doc has held no stored body, so the base it opened on
        // cannot tell its edits from text that never reached it, and a merge
        // against it can keep stale text over a stored edit. It takes the
        // stored body, as it would at the revision it opened on.
        if (
          contentRevision &&
          scheduledCallbacks.onBaseAwareReconcile &&
          authoritativeBase &&
          authoritativeBase.revision !== contentRevision &&
          !joining
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
          holdAuthoritativeBase({ value, revision: contentRevision });
          reportedConflictRevisionRef.current = null;
          lastEmittedRef.current = merged;
          pushEmittedRing(recentEmittedRef.current, merged);
          lastAppliedValueRef.current = value;
          lastAppliedSerializedRef.current = merged;
          finishJoin();
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
        const docBefore = editor.state.doc;
        let surgical: ReturnType<typeof applyDocSurgically> | null = null;
        if (scheduledCallbacks.parseValue !== false) {
          const parse = scheduledCallbacks.parseValue ?? defaultParseValue;
          const parsedDoc = parse(editor, value);
          if (parsedDoc) surgical = applyDocSurgically(editor, parsedDoc);
        }
        const appliedSurgically = surgical === "applied" || surgical === "noop";
        if (!appliedSurgically) {
          scheduledCallbacks.setContent(editor, value, {
            emitUpdate: false,
            addToHistory: false,
          });
        }
        isSettingContentRef.current = false;
        // A plugin can refuse the transaction, and dispatch does not say so.
        const refused = surgical !== "noop" && editor.state.doc === docBefore;
        const evidence = joinEvidenceRef.current;
        if (refused && joining && evidence?.ydoc === ydoc) {
          const error = new Error("The editor refused the stored body");
          console.warn(
            "The editor refused the stored body; leaving the document as it is until a retry",
            error,
          );
          joinEvidenceRequestRef.current?.cancel();
          putJoinEvidence({
            ydoc: evidence.ydoc,
            revision: evidence.revision,
            status: "failed",
            error,
          });
          return;
        }
        const serialized = scheduledCallbacks.getMarkdown(editor);
        lastEmittedRef.current = serialized;
        pushEmittedRing(recentEmittedRef.current, serialized);
        lastAppliedValueRef.current = value;
        lastAppliedSerializedRef.current = serialized;
        finishJoin();
        if (contentRevision) {
          holdAuthoritativeBase({ value, revision: contentRevision }, !refused);
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
    joinsOnPeerEvidence,
    joinEvidence,
    awareness,
  ]);

  // A join, pending, failed or waiting for the stored body, is moot once the
  // doc holds that body, whether the stored body or the doc moved. That body
  // becomes the base at once: the doc can move on again before the next
  // reconcile, which would then find it differing with no join left to wait
  // for. It runs after the reconcile, which takes the snapshot it checks for.
  useEffect(() => {
    if (!editor || editor.isDestroyed || joinEvidence?.ydoc !== ydoc) return;
    const check = () => {
      if (
        editor.isDestroyed ||
        joinEvidenceRef.current?.ydoc !== ydoc ||
        !isCurrentJoinSnapshot()
      )
        return;
      const callbacks = reconcileCallbacksRef.current;
      const normalizedValue = callbacks.normalizeValue(value);
      if (callbacks.getMarkdown(editor) !== normalizedValue) return;
      lastAppliedValueRef.current = value;
      lastAppliedSerializedRef.current = normalizedValue;
      if (contentUpdatedAt) lastAppliedUpdatedAtRef.current = contentUpdatedAt;
      if (contentRevision)
        holdAuthoritativeBase({ value, revision: contentRevision });
      reportedConflictRevisionRef.current = null;
      finishJoin();
    };
    check();
    editor.on("update", check);
    return () => {
      editor.off("update", check);
    };
  }, [
    acknowledgedLocalSnapshot,
    contentRevision,
    contentUpdatedAt,
    editor,
    joinEvidence,
    value,
    ydoc,
  ]);

  const shouldIgnoreUpdate = (transaction: Transaction): boolean => {
    if (!editable || isSettingContentRef.current || isJoinPending())
      return true;
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
      isJoinPending() ||
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
    joinEvidenceFailed:
      joinEvidence?.ydoc === ydoc && joinEvidence?.status === "failed",
    retryJoinEvidence: () => {
      const evidence = joinEvidenceRef.current;
      if (!ydoc || evidence?.ydoc !== ydoc) return;
      joinEvidenceRequestRef.current?.cancel();
      joinEvidenceRequestRef.current = null;
      joinBodyDeadlineRef.current = null;
      requestJoinEvidence(ydoc, evidence.revision);
    },
    isJoinPending,
    isSettingContentRef,
    shouldIgnoreUpdate,
    reportRemoteUpdate,
    registerEmitted,
  };
}
