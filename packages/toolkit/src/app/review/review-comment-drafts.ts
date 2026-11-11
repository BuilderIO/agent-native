import type { ReviewMention } from "@agent-native/core/review/types";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import {
  MAX_REVIEW_COMMENT_IMAGES,
  type ReviewCommentImage,
} from "./review-comment-images.js";

/** What a comment box holds before it's sent. */
export interface ReviewCommentDraft {
  text: string;
  mentions: ReviewMention[];
  images: ReviewCommentImage[];
  /**
   * Anything else the app keeps with the draft, such as where a new pin sits.
   * It's stored as JSON.
   */
  context?: unknown;
}

/** Whose drafts, on what: one stored set per person, account and resource. */
export interface ReviewCommentDraftScope {
  resourceType: string;
  resourceId: string;
  /**
   * Without a signed-in person, nothing is stored: drafts last while a box
   * on the resource is open.
   */
  userEmail?: string | null | undefined;
  orgId?: string | null | undefined;
}

export interface ReviewCommentDraftState {
  draft: ReviewCommentDraft;
  /** Whether this key holds a draft of its own rather than `initial`. */
  saved: boolean;
  setText: (text: string) => void;
  setMentions: (mentions: ReviewMention[]) => void;
  setImages: (images: ReviewCommentImage[]) => void;
  setContext: (context: unknown) => void;
  update: (change: Partial<ReviewCommentDraft>) => void;
  /** Forgets the draft, after it's sent or discarded. */
  clear: () => void;
}

interface StoredDraft extends ReviewCommentDraft {
  updatedAt: number;
}

interface StoredDrafts {
  version: 1;
  drafts: Record<string, StoredDraft>;
}

const DRAFT_STORAGE_VERSION = 1;
const MAX_STORED_DRAFTS = 50;
const MAX_DRAFT_STORAGE_BYTES = 256_000;
const MAX_DRAFT_KEY_LENGTH = 512;
const EMPTY_DRAFT: ReviewCommentDraft = { text: "", mentions: [], images: [] };

/**
 * The browser storage key for a scope's drafts, or null without a signed-in
 * person, whose drafts then stay in memory.
 */
export function reviewCommentDraftStorageKey(
  scope: ReviewCommentDraftScope,
): string | null {
  const email = scope.userEmail?.trim().toLowerCase();
  if (!email) return null;
  const account = scope.orgId?.trim()
    ? `org:${scope.orgId.trim()}`
    : "personal";
  return `agent-native-review-drafts:${JSON.stringify({
    version: DRAFT_STORAGE_VERSION,
    account,
    email,
    resourceType: scope.resourceType,
    resourceId: scope.resourceId,
  })}`;
}

// Each scope's drafts, read once and shared by every box in the tab while any
// is open. A box changing its draft hands the others a new record, so each
// re-renders only when its own draft changes.
const records = new Map<string, Record<string, StoredDraft>>();
const listeners = new Map<string, Set<() => void>>();
let storageListener: ((event: StorageEvent) => void) | null = null;

function scopeId(scope: ReviewCommentDraftScope): {
  id: string;
  persisted: boolean;
} {
  const storageKey = reviewCommentDraftStorageKey(scope);
  return storageKey
    ? { id: storageKey, persisted: true }
    : {
        id: `memory:${JSON.stringify([scope.resourceType, scope.resourceId])}`,
        persisted: false,
      };
}

function recordFor(
  id: string,
  persisted: boolean,
): Record<string, StoredDraft> {
  let record = records.get(id);
  if (!record) {
    record = persisted ? readStoredDrafts(id) : {};
    records.set(id, record);
  }
  return record;
}

function readStoredDrafts(storageKey: string): Record<string, StoredDraft> {
  if (typeof window === "undefined") return {};
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
    // coercion-ok: storage that can't be read leaves drafts in memory only.
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: Partial<StoredDrafts>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredDrafts>;
    // coercion-ok: an unreadable record is dropped, as a fresh start.
  } catch {
    return {};
  }
  if (
    parsed.version !== DRAFT_STORAGE_VERSION ||
    !parsed.drafts ||
    typeof parsed.drafts !== "object" ||
    Array.isArray(parsed.drafts)
  ) {
    return {};
  }
  const drafts: Record<string, StoredDraft> = {};
  for (const [key, value] of Object.entries(parsed.drafts)) {
    const draft = readStoredDraft(value);
    if (key.length <= MAX_DRAFT_KEY_LENGTH && draft) drafts[key] = draft;
  }
  return drafts;
}

function readStoredDraft(value: unknown): StoredDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  if (typeof draft.text !== "string") return null;
  const mentions = Array.isArray(draft.mentions)
    ? draft.mentions.flatMap((mention): ReviewMention[] => {
        if (!mention || typeof mention !== "object") return [];
        const { label, email, id } = mention as Record<string, unknown>;
        if (typeof label !== "string" || !label) return [];
        return [
          {
            label,
            ...(typeof email === "string" ? { email } : {}),
            ...(typeof id === "string" ? { id } : {}),
          },
        ];
      })
    : [];
  const images = Array.isArray(draft.images)
    ? draft.images
        .flatMap((image): ReviewCommentImage[] => {
          if (!image || typeof image !== "object") return [];
          const { url, name, contentType, provider } = image as Record<
            string,
            unknown
          >;
          if (typeof url !== "string" || !url) return [];
          return [
            {
              url,
              name: typeof name === "string" && name ? name : "image",
              ...(typeof contentType === "string" ? { contentType } : {}),
              ...(typeof provider === "string" ? { provider } : {}),
            },
          ];
        })
        .slice(0, MAX_REVIEW_COMMENT_IMAGES)
    : [];
  return {
    text: draft.text,
    mentions,
    images,
    ...(draft.context !== undefined ? { context: draft.context } : {}),
    updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : 0,
  };
}

function writeStoredDrafts(
  storageKey: string,
  record: Record<string, StoredDraft>,
): void {
  if (typeof window === "undefined") return;
  const entries = Object.entries(record);
  try {
    if (!entries.length) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    const serialized = JSON.stringify({
      version: DRAFT_STORAGE_VERSION,
      drafts: record,
    } satisfies StoredDrafts);
    // Drafts too large to keep stay in memory rather than crowd the app's
    // other storage.
    if (serialized.length > MAX_DRAFT_STORAGE_BYTES) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, serialized);
    // coercion-ok: full or blocked storage leaves drafts in memory only.
  } catch {
    return;
  }
}

function notify(id: string): void {
  for (const listener of listeners.get(id) ?? []) listener();
}

function subscribe(id: string, listener: () => void): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  if (!storageListener && typeof window !== "undefined") {
    // Another tab's change to the same drafts.
    storageListener = (event) => {
      if (event.key === null) {
        for (const id of [...records.keys()]) {
          if (id.startsWith("memory:")) continue;
          records.delete(id);
          notify(id);
        }
        return;
      }
      if (!records.has(event.key)) return;
      records.delete(event.key);
      notify(event.key);
    };
    window.addEventListener("storage", storageListener);
  }
  return () => {
    set.delete(listener);
    if (set.size) return;
    listeners.delete(id);
    // With no box left on the resource, the next one reads storage afresh,
    // and a signed-out draft is gone.
    records.delete(id);
  };
}

function isEmptyDraft(draft: ReviewCommentDraft): boolean {
  return (
    !draft.text.trim() && !draft.images.length && draft.context === undefined
  );
}

function sameDraft(left: ReviewCommentDraft, right: ReviewCommentDraft) {
  return (
    left.text === right.text &&
    JSON.stringify(left.mentions) === JSON.stringify(right.mentions) &&
    JSON.stringify(left.images) === JSON.stringify(right.images) &&
    JSON.stringify(left.context) === JSON.stringify(right.context)
  );
}

function setStoredDraft(
  id: string,
  persisted: boolean,
  key: string,
  draft: ReviewCommentDraft | null,
): void {
  const current = recordFor(id, persisted);
  const next = { ...current };
  if (draft) {
    next[key] = { ...draft, updatedAt: Date.now() };
    // The oldest drafts make room past the limit.
    const entries = Object.entries(next);
    if (entries.length > MAX_STORED_DRAFTS) {
      entries
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(MAX_STORED_DRAFTS)
        .forEach(([old]) => delete next[old]);
    }
  } else {
    if (!(key in next)) return;
    delete next[key];
  }
  // A write after every box closed, such as a sent reply's, isn't kept here.
  if (listeners.has(id)) records.set(id, next);
  else records.delete(id);
  if (persisted) writeStoredDrafts(id, next);
  notify(id);
}

/**
 * A comment box's draft, kept in the browser so it survives a reload. Give
 * each box its own `key`: `new` for a new thread, `reply:<threadId>`, or
 * `edit:<commentId>` with the comment as `initial`. A draft that's empty, or
 * back to `initial`, isn't kept. With a null `key` the box has no draft.
 */
export function useReviewCommentDraft(
  scope: ReviewCommentDraftScope | null,
  key: string | null,
  initial: ReviewCommentDraft = EMPTY_DRAFT,
): ReviewCommentDraftState {
  const { id, persisted } = scope
    ? scopeId(scope)
    : { id: "", persisted: false };
  const draftKey = scope ? key : null;
  const active = draftKey !== null;
  const stored = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        active ? subscribe(id, listener) : () => undefined,
      [active, id],
    ),
    () => (draftKey === null ? undefined : recordFor(id, persisted)[draftKey]),
    () => undefined,
  );
  const initialRef = useRef(initial);
  if (!sameDraft(initialRef.current, initial)) initialRef.current = initial;
  const savedDraft = useMemo((): ReviewCommentDraft | undefined => {
    if (!stored) return undefined;
    const { updatedAt: _updatedAt, ...draft } = stored;
    return draft;
  }, [stored]);
  const draft: ReviewCommentDraft = savedDraft ?? initialRef.current;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const update = useCallback(
    (change: Partial<ReviewCommentDraft>) => {
      if (draftKey === null) return;
      const next = { ...draftRef.current, ...change };
      if ("context" in change && change.context === undefined)
        delete next.context;
      draftRef.current = next;
      setStoredDraft(
        id,
        persisted,
        draftKey,
        isEmptyDraft(next) || sameDraft(next, initialRef.current) ? null : next,
      );
    },
    [draftKey, id, persisted],
  );

  return useMemo(
    () => ({
      draft,
      saved: stored !== undefined,
      setText: (text) => update({ text }),
      setMentions: (mentions) => update({ mentions }),
      setImages: (images) => update({ images }),
      setContext: (context) => update({ context }),
      update,
      clear: () => {
        if (draftKey === null) return;
        draftRef.current = initialRef.current;
        setStoredDraft(id, persisted, draftKey, null);
      },
    }),
    [draft, draftKey, id, persisted, stored, update],
  );
}
