import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

import { AGENT_CLIENT_ID } from "../../collab/agent-identity.js";
import { isReconcileLeadClient } from "../../collab/client.js";
import {
  RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION,
  applyDocSurgically,
  defaultParseValue,
} from "./surgical-apply.js";

export { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION };

/** Reads the current markdown out of the tiptap-markdown storage. */
export function getEditorMarkdown(editor: Editor): string {
  const markdownStorage = editor.storage as unknown as {
    markdown?: { getMarkdown?: () => string };
  };
  return markdownStorage.markdown?.getMarkdown?.() ?? "";
}

/**
 * Push a value onto the bounded ring of recently-emitted markdown (most recent
 * last, deduped, capped). The reconcile uses this to recognize a stale-but-recent
 * echo of OUR OWN edits: a debounced autosave can persist a PARTIAL burst, and
 * the next poll re-supplies that partial value with a newer timestamp — applying
 * it would clobber the freshly-typed tail. An external change (agent/peer) never
 * byte-matches one of our own recent emissions, and if it somehow did the content
 * is identical, so skipping it is safe by construction.
 */
const EMITTED_RING_MAX = 16;
function pushEmittedRing(ring: string[], value: string): void {
  if (!value) return;
  if (ring[ring.length - 1] === value) return;
  const dupe = ring.indexOf(value);
  if (dupe !== -1) ring.splice(dupe, 1);
  ring.push(value);
  if (ring.length > EMITTED_RING_MAX) ring.shift();
}

export interface UseCollabReconcileOptions {
  /** The live editor, or null until it mounts. */
  editor: Editor | null;
  /** Shared Y.Doc when collaborating; null disables all collab paths. */
  ydoc?: YDoc | null;
  /** True after the collab provider has loaded the persisted initial Y.Doc state. */
  collabSynced?: boolean;
  /** Shared awareness; null keeps the sole-client lead path. */
  awareness?: Awareness | null;
  /** Authoritative markdown value (SQL source of truth). */
  value: string;
  /** Timestamp of the authoritative value; gates newer-than reconcile. */
  contentUpdatedAt?: string | null;
  /** Whether the editor accepts edits. Reconcile/seed only run for the live editor. */
  editable: boolean;
  /**
   * Reads the current markdown from the editor. Injected so a dialect could
   * swap serializers; defaults to the tiptap-markdown storage reader. For an app
   * with a custom serializer (e.g. Content's `docToNfm(editor.getJSON())`), pass
   * it here so the seed/reconcile equality checks compare like-for-like.
   */
  getMarkdown?: (editor: Editor) => string;
  /**
   * Applies the authoritative `value` into the editor. Defaults to passing the
   * raw markdown string to `editor.commands.setContent`. Apps whose serializer
   * is NOT tiptap-markdown (Content parses `nfmToDoc(value)` into a PM doc)
   * override this so seed + reconcile write the correct content shape. The
   * supplied `options` carry the history/whitespace flags the default path uses;
   * a custom implementation should forward them when relevant.
   */
  setContent?: (
    editor: Editor,
    value: string,
    options: { emitUpdate?: boolean; addToHistory?: boolean },
  ) => void;
  /**
   * Parses the authoritative `value` into a full ProseMirror document for the
   * SURGICAL reconcile path: instead of a whole-document `setContent` (which
   * under Collaboration rewrites the entire Y.XmlFragment and tears down every
   * block NodeView), the reconcile diffs the parsed doc against the live doc
   * and replaces only the changed top-level run. Return null to skip the
   * surgical path for a given value (falls back to `setContent`).
   *
   * Defaults to a best-effort tiptap-markdown parse; apps with their own
   * serializers (Content's NFM, Plan's blocks[] doc) should supply the exact
   * doc their `setContent` would write. Pass `false` to disable surgical
   * application entirely.
   */
  parseValue?:
    | ((editor: Editor, value: string) => ProseMirrorNode | null)
    | false;
  /**
   * Normalizes the authoritative `value` to the canonical markdown the editor
   * would emit, so the "already in sync / our own echo" equality checks match a
   * serializer that re-canonicalizes (Content's `canonicalizeNfm`). Defaults to
   * identity (GFM already round-trips byte-stably).
   */
  normalizeValue?: (value: string) => string;
  /**
   * Decides whether the empty-doc seed should run for the current shared
   * fragment. Defaults to "fragment has no nodes, or the editor holds no
   * semantic markdown". Apps with sentinel-empty content (Content's
   * `<empty-block/>` filler) override this. Receives the live fragment length
   * and the editor's current markdown.
   */
  shouldSeed?: (info: {
    value: string;
    currentMarkdown: string;
    fragmentLength: number;
  }) => boolean;
  /**
   * The initial "applied" watermark. Default mirrors `contentUpdatedAt`, so a
   * fresh mount whose Y.Doc already matches SQL doesn't re-apply. Pass `null`
   * to force the first reconcile pass to adopt authoritative SQL even at the
   * same timestamp — Content does this so a stale persisted Y.Doc (an agent that
   * edited the CLOSED doc) is corrected on open. The editor is keyed per
   * document upstream, so this only affects the first mount of each doc.
   */
  initialAppliedUpdatedAt?: string | null;
}

export interface UseCollabReconcileResult {
  /** True when a Y.Doc is bound (collaborative editing active). */
  collab: boolean;
  /**
   * Set true around any programmatic `setContent` so the editor's `onUpdate`
   * can ignore the resulting transaction (it isn't a user edit).
   */
  isSettingContentRef: MutableRefObject<boolean>;
  /**
   * Call from `onUpdate` BEFORE serializing. Returns true when the update must
   * be ignored: editor not editable, mid-programmatic-setContent, or (in collab
   * mode) a remote-origin transaction. Also records the local typing time.
   */
  shouldIgnoreUpdate: (transaction: Transaction) => boolean;
  /**
   * Call from `onUpdate` AFTER computing the markdown to emit. Returns false
   * when the value must NOT be persisted yet (an empty collab doc before the
   * seed has run); records it as the last-emitted value otherwise.
   */
  registerEmitted: (markdown: string) => boolean;
}

/**
 * The subtle seed / reconcile / lead-client logic for the shared markdown
 * editor, extracted once so it can never be duplicated across embedders.
 *
 * Responsibilities (reproducing the Plan editor's behavior exactly):
 *  - Track whether THIS client is the reconcile lead (sole client always leads;
 *    otherwise elected via {@link isReconcileLeadClient}) and how many other
 *    visible human peers are present.
 *  - Seed an empty shared Y.Doc once from `value` — lead client only — so two
 *    clients opening a brand-new block don't both insert the content.
 *  - Reconcile authoritative external markdown (agent edit, source patch, peer
 *    edit mirrored to SQL) into the editor: in collab mode only the lead client
 *    applies it through `setContent` and Yjs propagates; in non-collab mode this
 *    is the original controlled-value reconcile.
 *  - Provide the `onUpdate` guards (`shouldIgnoreUpdate`, `registerEmitted`) so
 *    the component never persists remote-origin or pre-seed empty content.
 */
/** Default seed predicate: seed only when the shared doc is genuinely empty. */
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

/**
 * Default content writer: hand the raw markdown string to `setContent`, which
 * tiptap-markdown overrides to parse the markdown into a ProseMirror doc.
 *
 * IMPORTANT: do NOT pass `parseOptions: { preserveWhitespace: "full" }` here.
 * In tiptap v3 the core `setContent` command routes `preserveWhitespace: "full"`
 * through `insertContentAt`, which tiptap-markdown ALSO overrides to re-run its
 * markdown parser. That double-parse stringifies the already-parsed PM doc and
 * re-parses it as HTML, so a clean heading/list/code block comes back as the
 * escaped, non-idempotent `&lt;h1&gt;…` — which then escalates every reconcile
 * cycle (`<p>` → `&lt;p&gt;` → `&amp;lt;p&amp;gt;` …). Letting the markdown
 * override parse the string directly (no `parseOptions`) round-trips byte-stably
 * for the GFM corpus, including code-block and empty-line whitespace. Content's
 * NFM path supplies its own `setContent` (it passes a pre-parsed PM doc) and is
 * unaffected by this default.
 */
function defaultSetContent(
  editor: Editor,
  value: string,
  options: { emitUpdate?: boolean; addToHistory?: boolean },
): void {
  if (options.addToHistory === false) {
    editor
      .chain()
      .command(({ tr }) => {
        // addToHistory:false so cmd+z (or Yjs undo) doesn't erase
        // externally-loaded content.
        tr.setMeta("addToHistory", false);
        return true;
      })
      .setContent(value, { emitUpdate: options.emitUpdate })
      .run();
    return;
  }
  editor.commands.setContent(value);
}

export function useCollabReconcile({
  editor,
  ydoc = null,
  collabSynced = true,
  awareness = null,
  value,
  contentUpdatedAt,
  editable,
  getMarkdown = getEditorMarkdown,
  setContent = defaultSetContent,
  parseValue,
  normalizeValue = (v) => v,
  shouldSeed = defaultShouldSeed,
  initialAppliedUpdatedAt,
}: UseCollabReconcileOptions): UseCollabReconcileResult {
  const collab = !!ydoc;
  const isSettingContentRef = useRef(false);
  const lastEmittedRef = useRef("");
  // Ring of recent local emissions (see pushEmittedRing). Lets the reconcile
  // recognize a stale-but-recent echo of our OWN (possibly partial, debounced)
  // save so a lagging poll never clobbers freshly-typed text.
  const recentEmittedRef = useRef<string[]>([]);
  const lastTypedAtRef = useRef(0);
  // The raw authoritative `value` string the reconcile last applied. When the
  // SAME raw string is re-fetched (a lagging poll, or a source-sync that keeps
  // re-supplying the same stored markdown), applying it again would only
  // reproduce the doc we already hold — and if `value` is NON-idempotent
  // (serialize(parse(value)) !== value) re-applying compounds the divergence
  // every cycle (`<p>` → `&lt;p&gt;` → `&amp;lt;p&amp;gt;` …). Tracked so the
  // identical re-fetch is recognized and skipped.
  const lastAppliedValueRef = useRef<string | null>(null);
  // The editor's SERIALIZED output captured right AFTER the last reconcile/seed
  // apply (`getMarkdown(editor)` once the content settled). For non-idempotent
  // input this is what autosave actually persists, so the NEXT poll hands it
  // back as the new `value`. Comparing the incoming value against this lets the
  // reconcile recognize its own echo even when the raw string changed once, so
  // it never re-parses content the editor already represents. This is the
  // doc-equivalence guard that breaks the escalation loop.
  const lastAppliedSerializedRef = useRef<string | null>(null);
  const lastAppliedUpdatedAtRef = useRef<string | null>(
    initialAppliedUpdatedAt !== undefined
      ? initialAppliedUpdatedAt
      : (contentUpdatedAt ?? null),
  );

  // Whether THIS client is the one that seeds the empty shared doc / applies an
  // authoritative external snapshot into it. Exactly one client does, so the
  // content isn't inserted once per open editor. A sole client always leads.
  const [isLeadClient, setIsLeadClient] = useState(true);
  // Count of OTHER visible human collaborators. When >0, a peer's edit also
  // arrives via Yjs, so external markdown reconcile must defer (avoid applying
  // the same change through both Yjs and setContent).
  const peerCountRef = useRef(0);
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
        if (clientId === ydoc.clientID) return; // self
        if (clientId === AGENT_CLIENT_ID) return; // agent isn't a Yjs editor
        const s = state as { user?: unknown; visible?: boolean };
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

  // Collab seed: populate an empty shared Y.Doc from the markdown `value` once.
  // The Collaboration extension does NOT auto-seed; only the lead client does,
  // so two clients opening a brand-new block at once don't both seed (which
  // would duplicate the content via concurrent inserts at the same position).
  const seededRef = useRef(false);
  useEffect(() => {
    if (!collab || !editor || editor.isDestroyed || !ydoc) return;
    if (seededRef.current) return;
    if (!collabSynced) return;
    if (!isLeadClient) return;
    if (!value.trim()) return;
    const fragment = ydoc.getXmlFragment("default");
    const currentMarkdown = getMarkdown(editor);
    // Seed only when the shared doc is genuinely empty — either the fragment has
    // no nodes yet, or it holds no semantic markdown (an empty paragraph, or an
    // app's sentinel-empty filler via a custom `shouldSeed`).
    seededRef.current = true;
    if (
      !shouldSeed({ value, currentMarkdown, fragmentLength: fragment.length })
    ) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return;
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
    });
    return () => {
      cancelled = true;
    };
  }, [
    collab,
    collabSynced,
    editor,
    ydoc,
    value,
    isLeadClient,
    contentUpdatedAt,
    getMarkdown,
    setContent,
    shouldSeed,
  ]);

  // Reconcile authoritative external markdown (agent edit, source patch, or a
  // peer edit mirrored to SQL) into the live editor. In collab mode only the
  // lead client applies it through setContent; Yjs propagates the result to
  // every other client. In non-collab mode this is the original controlled-value
  // reconcile, unchanged.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // With peers present, a peer's edit also arrives via Yjs. Defer one poll
    // cycle (+margin) and re-check before applying via setContent so the same
    // change isn't inserted twice (Yjs + setContent → duplicated region).
    const PEER_SETTLE_MS = 2500;

    const apply = (deferred = false) => {
      if (cancelled || editor.isDestroyed) return;
      // In collab mode, defer all reconcile until the shared doc is seeded so we
      // never setContent over an unseeded fragment.
      if (collab && (!collabSynced || !seededRef.current)) {
        retry = setTimeout(() => apply(deferred), 300);
        return;
      }
      const currentMarkdown = getMarkdown(editor);
      // Compare against the canonical form the editor would emit so a serializer
      // that re-normalizes (Content's NFM) still recognizes "already in sync".
      const normalizedValue = normalizeValue(value);
      // Whether the editor still holds exactly what THIS hook last applied (the
      // user hasn't edited since). Only then are the round-trip echo guards
      // below safe: if the user has since edited away from the applied content,
      // an external snapshot equal to a previously-applied value is a real
      // revert and must NOT be swallowed as an echo.
      const editorUnchangedSinceApply =
        lastAppliedSerializedRef.current !== null &&
        currentMarkdown === lastAppliedSerializedRef.current;

      // Doc-equivalence skip. Never re-apply content the editor already
      // represents — comparing by DOC EQUIVALENCE, not raw strings/timestamps:
      //   1. `currentMarkdown === normalizedValue` — the editor's CURRENT
      //      serialized doc already equals the (normalized) incoming value.
      //   2. `value === lastEmittedRef.current` — the incoming value is our own
      //      just-emitted markdown echoing back.
      //   3. `value === lastAppliedValueRef.current` — the SAME raw value we
      //      already applied is being re-supplied (a lagging poll or a
      //      source-sync re-handing the same stored markdown). Applying it again
      //      would only reproduce the doc we hold; for NON-idempotent input it
      //      would compound divergence. Guarded by `editorUnchangedSinceApply`
      //      so a deliberate revert-to-previous after a local edit still lands.
      //   4. `normalizedValue === lastAppliedSerializedRef.current` — the
      //      incoming value round-trips to the serialized output we last
      //      produced (our own autosaved echo coming back from SQL). For
      //      non-idempotent input the raw string differs from what we were
      //      handed, but it is doc-equivalent to what the editor already shows,
      //      so re-parsing it must be skipped. This is the guard that stops the
      //      `<p>` → `&lt;p&gt;` → `&amp;lt;p&amp;gt;` escalation.
      if (
        currentMarkdown === normalizedValue ||
        value === lastEmittedRef.current ||
        // A stale-but-recent echo of our own (possibly partial) save — applying
        // it would clobber the freshly-typed tail. External edits never match.
        recentEmittedRef.current.includes(value) ||
        recentEmittedRef.current.includes(normalizedValue) ||
        (editorUnchangedSinceApply &&
          (value === lastAppliedValueRef.current ||
            normalizedValue === lastAppliedSerializedRef.current))
      ) {
        if (contentUpdatedAt) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
        return;
      }

      const externalNewer =
        !lastAppliedUpdatedAtRef.current ||
        !contentUpdatedAt ||
        contentUpdatedAt > lastAppliedUpdatedAtRef.current;

      // Only the lead client applies an authoritative snapshot into the shared
      // Y.Doc; peers receive it through Yjs sync.
      if (collab && !isLeadClient) {
        if (contentUpdatedAt && !externalNewer) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
        return;
      }

      // Never clobber an in-progress edit. While the user is actively typing
      // (focused and a keystroke landed within the window) defer and re-check —
      // applying external content now would yank text out from under them and,
      // for non-idempotent input, fight every keystroke. Newer external content
      // retries so it still lands once they pause; older-or-equal content is a
      // stale poll and is dropped outright while focused.
      const typingRecently =
        editor.isFocused && Date.now() - lastTypedAtRef.current < 1500;
      if (typingRecently) {
        if (externalNewer) {
          retry = setTimeout(() => apply(deferred), 700);
        }
        return;
      }
      // Older-or-equal content is a stale poll / lagging echo. Drop it while
      // focused (a peer/agent edit would be NEWER and retries above). In
      // NON-COLLAB mode there is no peer, so older-or-equal external content is
      // ALWAYS stale — dropping it regardless of focus stops a lagging
      // `get-visual-plan` poll from reverting a just-applied local structural
      // change (drag-to-columns) while the editor is blurred (the drag grips the
      // handle, not the prose, so `isFocused` is false at drop time). Gated on
      // `lastAppliedSerializedRef` so the very first seed (nothing applied yet,
      // also not-newer) still lands.
      const seeded = lastAppliedSerializedRef.current !== null;
      if (!externalNewer && (editor.isFocused || (!collab && seeded))) return;

      // Race guard: with peers present, let Yjs deliver a peer's edit first.
      // Defer once and re-check — a peer edit makes the equality check above
      // no-op next pass; an agent/source edit still differs and applies.
      if (collab && externalNewer && !deferred && peerCountRef.current > 0) {
        retry = setTimeout(() => apply(true), PEER_SETTLE_MS);
        return;
      }

      queueMicrotask(() => {
        if (cancelled || editor.isDestroyed) return;
        // Re-check doc-equivalence at apply time. Between the decision above and
        // this microtask a peer/Yjs edit (or our own prior apply) may have made
        // the editor already represent this value — re-applying would be a
        // wasted setContent that, for non-idempotent input, re-triggers the
        // loop. Skip when the editor's current serialization already matches the
        // normalized value, or the value round-trips to what we last produced.
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
          if (contentUpdatedAt) {
            lastAppliedUpdatedAtRef.current = contentUpdatedAt;
          }
          return;
        }
        isSettingContentRef.current = true;
        // Surgical path first: replace only the changed top-level run so
        // unchanged block NodeViews are never torn down and (under
        // Collaboration) Yjs sees a minimal edit instead of a full-fragment
        // rewrite. Falls back to the classic whole-document setContent when no
        // parser is available or the targeted transaction cannot be applied.
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
        // Capture the SERIALIZED result, not the raw value. For non-idempotent
        // input these differ; recording the serialized output is what lets the
        // next poll (which returns this serialized form) be recognized as our
        // own echo and skipped — stabilizing the doc after exactly one apply.
        const serialized = getMarkdown(editor);
        lastEmittedRef.current = serialized;
        pushEmittedRing(recentEmittedRef.current, serialized);
        lastAppliedValueRef.current = value;
        lastAppliedSerializedRef.current = serialized;
        if (contentUpdatedAt) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
      });
    };

    apply();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [
    contentUpdatedAt,
    editor,
    value,
    collab,
    collabSynced,
    isLeadClient,
    getMarkdown,
    setContent,
    parseValue,
    normalizeValue,
  ]);

  const shouldIgnoreUpdate = (transaction: Transaction): boolean => {
    if (!editable || isSettingContentRef.current) return true;
    if (transaction.getMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION)) {
      return true;
    }
    // In collab mode, never persist remote-originated changes (the initial Yjs
    // state load or a peer's edit arriving via sync). Each client saves only its
    // OWN local edits; a peer's edit is saved by that peer. Without this, a
    // lagging Y.Doc load would write stale markdown over newer SQL.
    if (collab && transaction && isChangeOrigin(transaction)) return true;
    lastTypedAtRef.current = Date.now();
    return false;
  };

  const registerEmitted = (markdown: string): boolean => {
    // Don't persist an empty doc before Collaboration has seeded — that would
    // clobber the saved block content with an empty string.
    if (collab && !markdown.trim()) return false;
    lastEmittedRef.current = markdown;
    pushEmittedRing(recentEmittedRef.current, markdown);
    return true;
  };

  return {
    collab,
    isSettingContentRef,
    shouldIgnoreUpdate,
    registerEmitted,
  };
}
