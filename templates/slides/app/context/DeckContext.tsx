import {
  agentNativePath,
  appBasePath,
  callAction,
  createLocalOpUndoController,
  isEmbedAuthActive,
  type LocalOpUndoController,
  type LocalOpUndoEntry,
} from "@agent-native/core/client";
import { nanoid } from "nanoid";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
  ReactNode,
} from "react";

import type { AspectRatio } from "@/lib/aspect-ratios";

// ---------------------------------------------------------------------------
// Granular persistence types
// These mirror the Operation types in actions/patch-deck.ts but are kept
// client-side only so the build doesn't pull in server-only imports.
// ---------------------------------------------------------------------------
type GranularOp =
  | {
      op: "patch-slide";
      slideId: string;
      fields: Partial<Omit<Slide, "id">>;
    }
  | { op: "delete-slide"; slideId: string; allowEmpty?: boolean }
  | { op: "reorder-slides"; orderedIds: string[] }
  | {
      op: "add-slide";
      slideId: string;
      afterSlideId?: string;
      fields: {
        content: string;
        notes?: string;
        layout?: string;
        background?: string;
      };
    }
  | {
      op: "patch-deck-fields";
      fields: Partial<
        Omit<Deck, "id" | "slides" | "createdAt" | "updatedAt" | "createdByMe">
      >;
    }
  /** Sentinel: discard all accumulated ops and do a full PUT instead. */
  | { op: "full-replace"; deck: Deck };

export type PatchDeckOp = Exclude<GranularOp, { op: "full-replace" }>;

// ---------------------------------------------------------------------------
// Inverse-op undo
// ---------------------------------------------------------------------------
// Undo/redo is per-user and is granular for ordinary slide/deck-field edits.
// Deck lifecycle and generated/imported full replacements use explicit
// deck-level ops because those user actions are whole-resource mutations.
export type DeckUndoOp =
  | ({ deckId: string } & PatchDeckOp)
  | { op: "delete-deck"; deckId: string }
  | { op: "restore-deck"; deckId: string; deck: Deck; index?: number }
  | { op: "replace-deck"; deckId: string; deck: Deck };

export type SlideLayout =
  | "title"
  | "section"
  | "content"
  | "two-column"
  | "image"
  | "statement"
  | "full-image"
  | "blank";

export interface Slide {
  id: string;
  content: string;
  notes: string;
  layout: SlideLayout;
  background?: string;
  /** URL of the generated/loaded image for this slide */
  imageUrl?: string;
  /** If true, an image is currently being generated for this slide */
  imageLoading?: boolean;
  /** Prompt used to generate the image */
  imagePrompt?: string;
  /** Excalidraw scene data (elements + appState + files) as JSON string */
  excalidrawData?: string;
  /** Slide transition animation when entering this slide */
  transition?: "instant" | "none" | "fade" | "slide" | "zoom";
  /** Per-element animations (ordered). Each click reveals the next step. */
  animations?: SlideAnimation[];
  /** @deprecated Use animations instead */
  splitByParagraph?: boolean;
}

export type AnimationType = "appear" | "fade" | "slide-up" | "zoom";

export interface SlideAnimation {
  id: string;
  /** Index of the child element within the content container */
  elementIndex: number;
  /** Preferred target: child-index path from the outer `.fmd-slide` wrapper. */
  elementPath?: number[];
  type: AnimationType;
}

export interface Deck {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  slides: Slide[];
  /** Share token if this deck has been shared */
  shareToken?: string;
  /** Framework sharing visibility — private (default), org, or public. */
  visibility?: "private" | "org" | "public";
  /** True when the current user owns this deck. */
  createdByMe?: boolean;
  /** ID of the design system applied to this deck */
  designSystemId?: string;
  /** Per-deck tweak overrides (accent color, title case, etc.) */
  tweaks?: Record<string, string | number | boolean>;
  /** Slide aspect ratio (defaults to 16:9 when absent for backwards compat) */
  aspectRatio?: AspectRatio;
}

interface DeckContextType {
  decks: Deck[];
  loading: boolean;
  loadError: boolean;
  createDeck: (
    title?: string,
    options?: { noDefaultSlides?: boolean; designSystemId?: string | null },
  ) => Deck;
  ensureDeckPersisted: (id: string) => Promise<boolean>;
  /**
   * Optimistically duplicate a deck. Inserts a copy into local state with the
   * supplied `newId` immediately so the UI can navigate without awaiting the
   * server, then fires the duplicate-deck action in the background. On error,
   * the optimistic deck is rolled back.
   *
   * Returns the optimistic deck (or `null` if the source deck isn't found).
   */
  duplicateDeck: (
    sourceDeckId: string,
    newId: string,
    title?: string,
  ) => Deck | null;
  deleteDeck: (id: string) => void;
  updateDeck: (
    id: string,
    updates: Partial<Omit<Deck, "id" | "createdAt">>,
  ) => void;
  reloadDecks: () => Promise<void>;
  getDeck: (id: string) => Deck | undefined;
  addSlide: (
    deckId: string,
    layout?: SlideLayout,
    afterIndex?: number,
  ) => string;
  updateSlide: (
    deckId: string,
    slideId: string,
    updates: Partial<Omit<Slide, "id">>,
  ) => void;
  deleteSlide: (deckId: string, slideId: string) => void;
  duplicateSlide: (deckId: string, slideId: string) => void;
  reorderSlides: (deckId: string, oldIndex: number, newIndex: number) => void;
  setDeckSlides: (deckId: string, slides: Slide[]) => void;
  /**
   * Mark a deck as having uncommitted local changes without modifying its data.
   * Use this when the user begins an interaction (e.g. inline text editing) that
   * hasn't yet flushed a slide update, so SSE/poll refreshes do not clobber the
   * in-progress edit.
   */
  markDeckDirty: (deckId: string) => void;
  // Undo/Redo — per-user inverse-op undo (see DeckUndoOp above).
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const DeckContext = createContext<DeckContextType | null>(null);

const OPEN_DECK_FALLBACK_POLL_MS = 5_000;
const DECK_LIST_FALLBACK_POLL_MS = 15_000;
// Bounded exponential backoff for SSE reconnect after a fatal error (e.g. a
// non-2xx response, which EventSource treats as terminal and never retries
// on its own — see the SSE effect below). Doubles from BASE up to MAX.
const SSE_RECONNECT_BASE_MS = 1_000;
const SSE_RECONNECT_MAX_MS = 30_000;

type DeckListActionResult = {
  decks?: unknown[];
};

type DuplicateDeckActionResult = {
  id: string;
  title: string;
  slideCount: number;
  url?: string;
};

function normalizeActionDeck(value: unknown): Deck | null {
  if (!value || typeof value !== "object") return null;
  const deck = value as Partial<Deck>;
  if (typeof deck.id !== "string") return null;

  return {
    ...deck,
    id: deck.id,
    title: typeof deck.title === "string" ? deck.title : "Untitled",
    createdAt:
      typeof deck.createdAt === "string"
        ? deck.createdAt
        : deck.updatedAt || "",
    updatedAt:
      typeof deck.updatedAt === "string"
        ? deck.updatedAt
        : deck.createdAt || "",
    slides: Array.isArray(deck.slides) ? deck.slides : [],
  } as Deck;
}

// Debounced save to API + save-state listeners (so the toolbar indicator
// can show "Saving…" / "Saved"). The map tracks pending debounce timers;
// `inFlight` tracks active fetches. Combined, they answer "is anything
// uncommitted?" for the indicator.
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightSaves = new Set<string>();
const saveStateListeners = new Set<() => void>();

// Per-deck queue of granular ops waiting to be flushed. Keys are deck IDs.
// Ops are appended by enqueueDeckOp and drained when the debounce fires.
const pendingOpsQueue = new Map<string, GranularOp[]>();

// Every raw deck fetch (the legacy full-replace PUT, the create POST) MUST be
// bounded. Without a timeout, a stalled connection leaves the awaited promise
// forever pending, so the `finally` that drains `inFlightSaves` /
// `pendingCreateIdsRef` never runs — wedging the deck id in a set that
// `hasUncommittedDeckChanges` reads, which permanently suppresses the poll's
// and the SSE resync's open-deck refetch (the editor goes blind to agent edits
// until a full page reload). Matches the granular `patch-deck` path, which is
// already bounded at 60s by `actionFetch`'s DEFAULT_ACTION_TIMEOUT_MS.
const RAW_DECK_FETCH_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = RAW_DECK_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Cached snapshot for useSyncExternalStore. MUST be stable when the boolean
// is unchanged or React will infinite-loop (it compares snapshots with
// Object.is — a fresh object literal every call schedules a new update,
// which calls getSnapshot again, which returns a new object… etc).
let cachedSnapshot: { saving: boolean } = { saving: false };

function recomputeSnapshot() {
  const saving = pendingSaves.size > 0 || inFlightSaves.size > 0;
  if (saving !== cachedSnapshot.saving) {
    cachedSnapshot = { saving };
  }
}

function notifySaveListeners() {
  recomputeSnapshot();
  saveStateListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

/** Subscribe to save-state changes — used by `useSaveState`. */
export function subscribeSaveState(listener: () => void): () => void {
  saveStateListeners.add(listener);
  return () => saveStateListeners.delete(listener);
}

/** Snapshot of save state — true when anything is debounced or in flight. */
export function getSaveSnapshot(): { saving: boolean } {
  return cachedSnapshot;
}

/**
 * Enqueue a granular operation for a deck and (re-)arm the debounce.
 *
 * When a `full-replace` op is enqueued, all previously-queued ops for that
 * deck are discarded because the full replace already captures the authoritative
 * state at that moment (used by undo/redo and bulk generation which produce a
 * known good snapshot). Later granular edits inside the same debounce window
 * must still be appended after that snapshot so quick follow-up user edits are
 * not dropped on reload.
 *
 * The debounce fires after 500 ms of quiet, draining the queue via the
 * granular `patch-deck` action. If the queue starts with a `full-replace` op,
 * a direct PUT to `/api/decks/:id` is used first, then any trailing granular
 * ops are sent through `patch-deck`.
 */
function enqueueDeckOp(deckId: string, op: GranularOp) {
  // Clear any pending save timer — we're about to reset it
  const existing = pendingSaves.get(deckId);
  if (existing) clearTimeout(existing);

  if (op.op === "full-replace") {
    // Discard any accumulated granular ops — this is a wholesale replacement
    pendingOpsQueue.set(deckId, [op]);
  } else {
    const queue = pendingOpsQueue.get(deckId) ?? [];
    queue.push(op);
    pendingOpsQueue.set(deckId, queue);
  }

  // Arm the debounce
  const timer = setTimeout(async () => {
    pendingSaves.delete(deckId);
    inFlightSaves.add(deckId);
    notifySaveListeners();

    const ops = pendingOpsQueue.get(deckId) ?? [];
    pendingOpsQueue.delete(deckId);

    try {
      if (ops.length === 0) return;

      if (ops[0].op === "full-replace") {
        // Legacy full-deck PUT — used by undo/redo and setDeckSlides.
        // Bounded so a stalled PUT can't wedge `inFlightSaves` forever (its
        // `finally` cleanup below only runs once this await settles; an
        // AbortError from the timeout is a rejection that still reaches it).
        const deck = ops[0].deck;
        await fetchWithTimeout(`${appBasePath()}/api/decks/${deckId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deck),
        });
        const trailingOps = ops.slice(1) as PatchDeckOp[];
        if (trailingOps.length > 0) {
          await callAction("patch-deck", {
            deckId,
            operations: trailingOps,
          });
        }
      } else {
        // Granular patch — concurrent-safe
        await callAction("patch-deck", {
          deckId,
          operations: ops as PatchDeckOp[],
        });
      }
    } catch (err) {
      console.error(`Failed to save deck ${deckId}:`, err);
    } finally {
      inFlightSaves.delete(deckId);
      notifySaveListeners();
    }
  }, 500);

  pendingSaves.set(deckId, timer);
  notifySaveListeners();
}

/**
 * @deprecated Use enqueueDeckOp for new callers. This legacy helper still
 * does a full-deck PUT and is kept only for the initial deck creation path
 * which already inserts via POST — it is NOT called for edits any more.
 */
function saveDeckToAPI(deck: Deck) {
  enqueueDeckOp(deck.id, { op: "full-replace", deck });
}

/**
 * Synchronously flush every pending (debounced) deck op queue using
 * `fetch(..., { keepalive: true })` so in-flight edits survive a tab
 * close / navigation. Called from a `pagehide` / `visibilitychange(hidden)`
 * handler — without it there is a ~500ms window (the debounce) where the
 * user's most recent edits are only in memory and are lost on tab close.
 *
 * keepalive requests are best-effort and capped (~64KB by the browser), which
 * is fine: granular ops are small, and if a full-replace payload is too large
 * to send keepalive the normal debounce/poll path still catches up on reopen.
 */
function flushPendingSaves() {
  const actionUrl = `${agentNativePath("/_agent-native/actions")}/patch-deck`;
  for (const [deckId, timer] of pendingSaves) {
    clearTimeout(timer);
    const ops = pendingOpsQueue.get(deckId);
    pendingOpsQueue.delete(deckId);
    if (!ops || ops.length === 0) continue;
    try {
      if (ops[0].op === "full-replace") {
        const deck = ops[0].deck;
        void fetch(`${appBasePath()}/api/decks/${deckId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deck),
          keepalive: true,
        });
        const trailingOps = ops.slice(1) as PatchDeckOp[];
        if (trailingOps.length === 0) continue;
        void fetch(actionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Native-Frontend": "1",
          },
          body: JSON.stringify({
            deckId,
            operations: trailingOps,
          }),
          keepalive: true,
        });
      } else {
        void fetch(actionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Native-Frontend": "1",
          },
          body: JSON.stringify({
            deckId,
            operations: ops as PatchDeckOp[],
          }),
          keepalive: true,
        });
      }
    } catch {
      // Best-effort — nothing more we can do as the page is unloading.
    }
  }
  pendingSaves.clear();
  notifySaveListeners();
}

function discardPendingDeckOps(deckId: string) {
  const timer = pendingSaves.get(deckId);
  if (timer) clearTimeout(timer);
  pendingSaves.delete(deckId);
  pendingOpsQueue.delete(deckId);
  notifySaveListeners();
}

// ---------------------------------------------------------------------------
// Local op application + inverse derivation (for inverse-op undo)
// ---------------------------------------------------------------------------
// These mirror the server-side merge in actions/patch-deck.ts but operate on
// the in-memory Deck[] so undo/redo can apply optimistically. They are pure:
// they return a new slides array / deck rather than mutating in place.

/** Fields carried by a `patch-deck-fields` op. */
type PatchDeckFields = Extract<
  PatchDeckOp,
  { op: "patch-deck-fields" }
>["fields"];

/**
 * Apply a single granular op to a deck's slides/fields, returning the updated
 * Deck. Unknown/no-op cases (slide already gone, etc.) return the deck
 * unchanged so undo entries that no longer apply fail soft instead of
 * corrupting state.
 */
export function applyOpToDeck(deck: Deck, op: PatchDeckOp): Deck {
  switch (op.op) {
    case "patch-slide": {
      let changed = false;
      const slides = deck.slides.map((s) => {
        if (s.id !== op.slideId) return s;
        changed = true;
        return { ...s, ...op.fields };
      });
      if (!changed) return deck; // slide concurrently deleted — skip
      return { ...deck, slides, updatedAt: new Date().toISOString() };
    }
    case "delete-slide": {
      const slides = deck.slides.filter((s) => s.id !== op.slideId);
      if (slides.length === deck.slides.length) return deck; // already gone
      // NOTE: unlike the user-facing `deleteSlide` handler and the server merge,
      // undo/redo application does NOT inject a fallback blank slide when the
      // deck empties out. Undo must restore the EXACT prior state — if the deck
      // was legitimately empty before an add-slide (e.g. a freshly reloaded
      // empty deck), undoing that add must return it to empty, not to a
      // spurious blank slide.
      return { ...deck, slides, updatedAt: new Date().toISOString() };
    }
    case "reorder-slides": {
      const byId = new Map(deck.slides.map((s) => [s.id, s]));
      const reordered: Slide[] = [];
      for (const id of op.orderedIds) {
        const slide = byId.get(id);
        if (slide) reordered.push(slide);
      }
      // Preserve slides not named in orderedIds (concurrent adds) at the end.
      const named = new Set(op.orderedIds);
      for (const s of deck.slides) {
        if (!named.has(s.id)) reordered.push(s);
      }
      return {
        ...deck,
        slides: reordered,
        updatedAt: new Date().toISOString(),
      };
    }
    case "add-slide": {
      if (deck.slides.some((s) => s.id === op.slideId)) return deck; // idempotent
      const newSlide: Slide = {
        id: op.slideId,
        content: op.fields.content,
        notes: op.fields.notes ?? "",
        layout: (op.fields.layout as SlideLayout) ?? "content",
        ...(op.fields.background !== undefined
          ? { background: op.fields.background }
          : {}),
      };
      const slides = [...deck.slides];
      const afterIdx = op.afterSlideId
        ? slides.findIndex((s) => s.id === op.afterSlideId)
        : -1;
      if (afterIdx !== -1) slides.splice(afterIdx + 1, 0, newSlide);
      else slides.push(newSlide);
      return { ...deck, slides, updatedAt: new Date().toISOString() };
    }
    case "patch-deck-fields": {
      return {
        ...deck,
        ...op.fields,
        updatedAt: new Date().toISOString(),
      } as Deck;
    }
  }
}

export function applyUndoOpToDecks(decks: Deck[], op: DeckUndoOp): Deck[] {
  switch (op.op) {
    case "delete-deck":
      return decks.filter((deck) => deck.id !== op.deckId);
    case "restore-deck": {
      const nextDeck = op.deck;
      const existingIndex = decks.findIndex((deck) => deck.id === op.deckId);
      if (existingIndex >= 0) {
        const next = [...decks];
        next[existingIndex] = nextDeck;
        return next;
      }
      const next = [...decks];
      const index =
        typeof op.index === "number" && op.index >= 0
          ? Math.min(op.index, next.length)
          : next.length;
      next.splice(index, 0, nextDeck);
      return next;
    }
    case "replace-deck": {
      const existingIndex = decks.findIndex((deck) => deck.id === op.deckId);
      if (existingIndex < 0) return [...decks, op.deck];
      const next = [...decks];
      next[existingIndex] = op.deck;
      return next;
    }
    default: {
      const idx = decks.findIndex((deck) => deck.id === op.deckId);
      if (idx < 0) return decks;
      const { deckId: _deckId, ...granular } = op;
      void _deckId;
      const updated = applyOpToDeck(decks[idx], granular);
      if (updated === decks[idx]) return decks;
      const next = [...decks];
      next[idx] = updated;
      return next;
    }
  }
}

/**
 * Compare deck content for remote-sync undo. Ignores `updatedAt` so a
 * metadata-only refresh does not create a no-op undo entry.
 */
export function deckContentSignature(deck: Deck): string {
  const { updatedAt: _updatedAt, ...rest } = deck;
  void _updatedAt;
  return JSON.stringify(rest);
}

/**
 * Build the inverse of a granular op given the deck state BEFORE the op was
 * applied. Returns an array of ops to apply (usually one, occasionally two) or
 * `null` when the op has no meaningful inverse (e.g. a no-op patch) so the
 * caller skips pushing an undo entry.
 */
export function deriveInverseOp(
  before: Deck,
  op: PatchDeckOp,
): PatchDeckOp[] | null {
  switch (op.op) {
    case "patch-slide": {
      const prior = before.slides.find((s) => s.id === op.slideId);
      if (!prior) return null; // slide didn't exist before — nothing to restore
      const priorFields: Partial<Omit<Slide, "id">> = {};
      for (const key of Object.keys(op.fields) as (keyof Omit<Slide, "id">)[]) {
        // Capture the prior value for every field this op touches, so undo
        // restores exactly what changed (including clearing fields back to
        // undefined).
        (priorFields as Record<string, unknown>)[key] = prior[key];
      }
      return [{ op: "patch-slide", slideId: op.slideId, fields: priorFields }];
    }
    case "delete-slide": {
      const prior = before.slides.find((s) => s.id === op.slideId);
      if (!prior) return null;
      const idx = before.slides.findIndex((s) => s.id === op.slideId);
      const afterSlideId = idx > 0 ? before.slides[idx - 1]?.id : undefined;
      // Re-add the deleted slide with its full prior content, then reorder to
      // the exact prior order. The add-slide op alone can only express "after
      // slide X" or "append", so it cannot restore a slide to the HEAD of the
      // deck; the follow-up reorder guarantees exact position regardless.
      return [
        {
          op: "add-slide",
          slideId: prior.id,
          afterSlideId,
          fields: {
            content: prior.content,
            notes: prior.notes,
            layout: prior.layout,
            ...(prior.background !== undefined
              ? { background: prior.background }
              : {}),
          },
        },
        {
          op: "reorder-slides",
          orderedIds: before.slides.map((s) => s.id),
        },
      ];
    }
    case "add-slide": {
      // Inverse of adding a slide is deleting it.
      return [
        {
          op: "delete-slide",
          slideId: op.slideId,
          ...(before.slides.length === 0 ? { allowEmpty: true } : {}),
        },
      ];
    }
    case "reorder-slides": {
      // Inverse reorder = the order the slides were in before.
      return [
        { op: "reorder-slides", orderedIds: before.slides.map((s) => s.id) },
      ];
    }
    case "patch-deck-fields": {
      const priorFields: Record<string, unknown> = {};
      const beforeRecord = before as unknown as Record<string, unknown>;
      for (const key of Object.keys(op.fields)) {
        priorFields[key] = beforeRecord[key];
      }
      return [
        {
          op: "patch-deck-fields",
          fields: priorFields as PatchDeckFields,
        },
      ];
    }
  }
}

/**
 * Fetch the deck list. Returns `null` on any failure (network error, non-2xx
 * response) so callers can distinguish "authoritative empty list" from
 * "couldn't reach the server" — wiping local state on a transient failure
 * kicks the user out of the editor and shows the "Create your first deck"
 * empty state, even though their decks still exist on the server. The 200/[]
 * case still means the user has no decks and is returned as `[]`.
 */
async function fetchDecksFromAPI(): Promise<Deck[] | null> {
  try {
    const result = await callAction<DeckListActionResult>(
      "list-decks",
      { includeSlides: "true" },
      { method: "GET" },
    );
    if (!Array.isArray(result?.decks)) {
      console.warn("Failed to fetch decks: invalid action response");
      return null;
    }
    return result.decks
      .map((deck) => normalizeActionDeck(deck))
      .filter((deck): deck is Deck => deck !== null);
  } catch (err) {
    console.error("Failed to fetch decks:", err);
    return null;
  }
}

/**
 * Fetch a minimal id-only deck listing (`light: "true"`) for cheap add/remove
 * diffing. Never downloads deck bodies — see `list-decks.ts`. Returns `null`
 * on any failure so callers can skip the diff instead of wiping local state.
 */
async function fetchDeckListLightFromAPI(): Promise<{ id: string }[] | null> {
  try {
    const result = await callAction<DeckListActionResult>(
      "list-decks",
      { light: "true" },
      { method: "GET" },
    );
    if (!Array.isArray(result?.decks)) {
      console.warn("Failed to fetch deck list: invalid action response");
      return null;
    }
    return result.decks
      .filter(
        (deck): deck is { id: string } =>
          !!deck &&
          typeof deck === "object" &&
          typeof (deck as { id?: unknown }).id === "string",
      )
      .map((deck) => ({ id: deck.id }));
  } catch (err) {
    console.error("Failed to fetch deck list:", err);
    return null;
  }
}

async function fetchDeckFromAPI(id: string): Promise<Deck | null> {
  try {
    const result = await callAction<unknown>(
      "get-deck",
      { id },
      { method: "GET" },
    );
    return normalizeActionDeck(result);
  } catch (err) {
    console.error(`Failed to fetch deck ${id}:`, err);
    return null;
  }
}

export function deckIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/\/deck\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function currentOpenDeckIdFromWindow(): string | null {
  if (typeof window === "undefined") return null;
  return deckIdFromPathname(window.location.pathname);
}

export async function includeOpenDeckIfMissing(
  decks: Deck[],
  openDeckId: string | null,
  fetchById: (id: string) => Promise<Deck | null> = fetchDeckFromAPI,
): Promise<Deck[]> {
  if (!openDeckId || decks.some((deck) => deck.id === openDeckId)) {
    return decks;
  }

  const directDeck = await fetchById(openDeckId);
  return directDeck ? [...decks, directDeck] : decks;
}

async function fetchDecksForCurrentRoute(): Promise<Deck[] | null> {
  const currentOpenDeckId = currentOpenDeckIdFromWindow();
  const loaded = await fetchDecksFromAPI();
  if (loaded !== null) {
    return includeOpenDeckIfMissing(loaded, currentOpenDeckId);
  }
  if (!currentOpenDeckId) return null;
  const directDeck = await fetchDeckFromAPI(currentOpenDeckId);
  return directDeck ? [directDeck] : null;
}

async function deleteDeckFromAPI(id: string): Promise<void> {
  try {
    await fetch(`${appBasePath()}/api/decks/${id}`, { method: "DELETE" });
  } catch (err) {
    console.error(`Failed to delete deck ${id}:`, err);
  }
}

async function createDeckOnAPI(deck: Deck): Promise<void> {
  // Bounded so a stalled create response can't leave the deck id in
  // `pendingCreateIdsRef` forever (cleared only in the caller's `.finally`,
  // which needs this promise to settle). A wedged pending-create id would
  // otherwise suppress the open-deck refetch just like a wedged save.
  const res = await fetchWithTimeout(`${appBasePath()}/api/decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deck),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error || body.message || message;
    } catch {
      // Keep the HTTP status fallback.
    }
    throw new Error(message);
  }
}

export function changedDeckIds(before: Deck[], after: Deck[]): string[] {
  const beforeById = new Map(before.map((deck) => [deck.id, deck]));
  const changed: string[] = [];
  for (const deck of after) {
    const previous = beforeById.get(deck.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(deck)) {
      changed.push(deck.id);
    }
  }
  return changed;
}

export function hasUncommittedDeckChanges(
  deckId: string,
  dirtyDeckIds: Set<string>,
): boolean {
  return (
    dirtyDeckIds.has(deckId) ||
    pendingSaves.has(deckId) ||
    inFlightSaves.has(deckId)
  );
}

/**
 * Additive, content-preserving reconcile of a server deck snapshot onto the
 * local copy — used when the open deck has uncommitted local edits, where a
 * wholesale adopt would clobber the user's in-progress typing.
 *
 * The concern the "uncommitted changes" guard originally addressed (don't
 * overwrite local edits with slightly-stale server state) is legitimate for
 * slide BODIES, but it must not make the client permanently blind to the
 * agent ADDING slides — that is the production staleness bug. So we split the
 * two concerns:
 *   - never overwrite the content of a slide that exists locally, and
 *   - never drop a local-only slide (an unsaved local add), but
 *   - always surface server slides that are missing locally (agent additions),
 *     positioned to follow the server's ordering.
 *
 * Removals and content changes to slides that exist on both sides are left to
 * the clean-deck path (`applyRemoteDeckUpdate`), which runs once local edits
 * settle. This merge is intentionally conservative: it can only ADD slides, so
 * it can never destroy local work, yet it always heals an empty/stale rail.
 *
 * Returns the same `local` reference when nothing was added, so callers can
 * cheaply detect "no change".
 */
export function mergeServerAddedSlides(local: Deck, server: Deck): Deck {
  const localIds = new Set(local.slides.map((s) => s.id));
  const additions = server.slides.filter((s) => !localIds.has(s.id));
  if (additions.length === 0) return local;

  // Walk the server order, emitting local slides with their local (possibly
  // dirty) content and inserting server-only additions in place. Any local
  // slide not present on the server (an unsaved local add) is carried over at
  // the end so we never drop unsaved local work.
  const localById = new Map(local.slides.map((s) => [s.id, s]));
  const emitted = new Set<string>();
  const merged: Slide[] = [];
  for (const s of server.slides) {
    const localSlide = localById.get(s.id);
    merged.push(localSlide ?? s);
    emitted.add(s.id);
  }
  for (const s of local.slides) {
    if (!emitted.has(s.id)) {
      merged.push(s);
      emitted.add(s.id);
    }
  }
  // Keep local scalar fields (title/tweaks/etc. may be locally edited); only
  // the slide set is reconciled here.
  return { ...local, slides: merged };
}

export const defaultSlideContent: Record<SlideLayout, string> = {
  title: `<div class="fmd-slide" style="padding: 80px 110px; justify-content: space-between;">
  <div>
    <div style="font-size: 16px; font-weight: 800; color: #fff; letter-spacing: 0; font-family: 'Poppins', sans-serif;">Deck</div>
  </div>
  <div>
    <div style="font-size: 54px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -1px; font-family: 'Poppins', sans-serif;">Presentation Title</div>
  </div>
  <div>
    <div class="text-[16px] text-white/65 mb-1">Your Name</div>
    <div class="text-[16px] text-white/50">Date</div>
  </div>
</div>`,
  content: `<div class="fmd-slide" style="padding: 80px 110px; justify-content: center;">
  <div style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 32px; font-family: 'Poppins', sans-serif;">SECTION</div>
  <div style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; font-family: 'Poppins', sans-serif; margin-bottom: 40px;">Slide Title</div>
  <div style="display: flex; flex-direction: column; gap: 16px; padding-left: 16px;">
    <div style="display: flex; align-items: baseline; gap: 20px; font-size: 22px; color: rgba(255,255,255,0.85); font-family: 'Poppins', sans-serif; line-height: 1.4;"><span style="color: #fff; font-size: 8px; position: relative; top: -4px;">&#x25CF;</span><span>First point</span></div>
    <div style="display: flex; align-items: baseline; gap: 20px; font-size: 22px; color: rgba(255,255,255,0.85); font-family: 'Poppins', sans-serif; line-height: 1.4;"><span style="color: #fff; font-size: 8px; position: relative; top: -4px;">&#x25CF;</span><span>Second point</span></div>
    <div style="display: flex; align-items: baseline; gap: 20px; font-size: 22px; color: rgba(255,255,255,0.85); font-family: 'Poppins', sans-serif; line-height: 1.4;"><span style="color: #fff; font-size: 8px; position: relative; top: -4px;">&#x25CF;</span><span>Third point</span></div>
  </div>
</div>`,
  "two-column": `<div class="fmd-slide" style="padding: 50px 70px; justify-content: center;">
  <div style="display: flex; gap: 40px; align-items: flex-start; width: 100%;">
    <div style="flex: 1;">
      <div style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 8px; font-family: 'Poppins', sans-serif;">SECTION</div>
      <div style="font-size: 36px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; font-family: 'Poppins', sans-serif; margin-bottom: 28px;">Left Column</div>
      <div style="font-size: 20px; color: rgba(255,255,255,0.55); font-family: 'Poppins', sans-serif; line-height: 1.5;">Content for the left side</div>
    </div>
    <div class="fmd-img-placeholder" style="flex: 1; min-height: 280px;">Right column visual</div>
  </div>
</div>`,
  section: `<div class="fmd-slide" style="padding: 80px 110px; justify-content: center;">
  <div style="font-size: 54px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -1px; font-family: 'Poppins', sans-serif;">Section Title</div>
</div>`,
  image: `<div class="fmd-slide" style="padding: 60px 80px; align-items: center;">
  <div style="font-size: 38px; font-weight: 900; color: #fff; line-height: 1.2; letter-spacing: -1px; font-family: 'Poppins', sans-serif; text-align: center; margin-bottom: 32px;">Image Slide Title</div>
  <div class="fmd-img-placeholder" style="width: 560px; flex: 1; min-height: 300px;">Image description</div>
</div>`,
  statement: `<div class="fmd-slide" style="padding: 60px 110px; justify-content: center;">
  <div style="font-size: 38px; font-weight: 900; color: #fff; line-height: 1.2; letter-spacing: -1px; font-family: 'Poppins', sans-serif; margin-bottom: 20px;">Bold statement or key message goes here</div>
  <div style="font-size: 20px; color: rgba(255,255,255,0.6); line-height: 1.5; font-family: 'Poppins', sans-serif;">Supporting context or subtitle text</div>
</div>`,
  "full-image": `<div class="fmd-slide" style="padding: 0; align-items: center; justify-content: center;">
  <div class="fmd-img-placeholder" style="width: 100%; height: 100%;">Full-bleed image or screenshot</div>
</div>`,
  blank: `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;">
  <div style="font-size: 28px; font-weight: 600; color: rgba(255,255,255,0.4); line-height: 1.3; font-family: 'Poppins', sans-serif;">Double-click to edit</div>
</div>`,
};

export function DeckProvider({ children }: { children: ReactNode }) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const decksRef = useRef<Deck[]>([]);

  // Per-user inverse-op undo/redo. `canUndo`/`canRedo` are React state kept in
  // sync with the controller via its onChange callback. The controller and its
  // apply path are wired below once `decks`/enqueue are in scope.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoControllerRef = useRef<LocalOpUndoController<DeckUndoOp> | null>(
    null,
  );
  // Track when external (SSE) updates happen so the save effect doesn't echo them back
  const lastExternalUpdateRef = useRef(0);
  // Track client-created decks that haven't been confirmed on the server yet.
  // Prevents the poll from wiping optimistic decks before their POST lands.
  const pendingCreateIdsRef = useRef<Set<string>>(new Set());
  const pendingCreatePromisesRef = useRef<Map<string, Promise<void>>>(
    new Map(),
  );
  const pendingDuplicateSourceIdsRef = useRef<Set<string>>(new Set());
  const dirtyDeckIdsRef = useRef<Set<string>>(new Set());
  const deckBaselineRequestIdRef = useRef(0);

  const markDeckDirty = useCallback((deckId: string) => {
    lastExternalUpdateRef.current = 0;
    dirtyDeckIdsRef.current.add(deckId);
  }, []);

  const deleteDeckAfterPendingCreate = useCallback((deckId: string) => {
    const pendingCreate = pendingCreatePromisesRef.current.get(deckId);
    if (!pendingCreate) {
      void deleteDeckFromAPI(deckId);
      return;
    }

    void pendingCreate
      .then(() => deleteDeckFromAPI(deckId))
      .catch(() => {
        // The create/duplicate failed, so there is nothing on the server to delete.
      });
  }, []);

  // Plain local decks update. Undo entries are recorded explicitly by each
  // mutation via `recordUndo` (inverse ops), so this no longer snapshots the
  // whole decks array the way the old `setDecksWithHistory` did.
  const setDecksLocal = useCallback((updater: (prev: Deck[]) => Deck[]) => {
    setDecks(updater);
  }, []);

  useEffect(() => {
    decksRef.current = decks;
  }, [decks]);

  // ── Inverse-op undo controller ────────────────────────────────────────────
  // Applying an undo/redo entry runs each tagged op through the SAME optimistic
  // local update + granular persist path as a normal edit. Because we only ever
  // send granular ops (never full-replace), undo/redo can never clobber a
  // concurrent edit to a different slide by another human or the agent. Entries
  // that no longer apply (e.g. the slide was deleted remotely) fail soft:
  // applyOpToDeck returns the deck unchanged and the granular server merge
  // ignores the missing target.
  if (!undoControllerRef.current) {
    undoControllerRef.current = createLocalOpUndoController<DeckUndoOp>({
      apply: (ops) => {
        // Apply all ops to local state in one pass, then persist each.
        setDecks((prev) => {
          let next = prev;
          for (const op of ops) {
            next = applyUndoOpToDecks(next, op);
          }
          return next;
        });
        for (const op of ops) {
          markDeckDirty(op.deckId);
          if (op.op === "delete-deck") {
            discardPendingDeckOps(op.deckId);
            deleteDeckAfterPendingCreate(op.deckId);
          } else if (op.op === "restore-deck" || op.op === "replace-deck") {
            enqueueDeckOp(op.deckId, { op: "full-replace", deck: op.deck });
          } else {
            const { deckId, ...granular } = op;
            enqueueDeckOp(deckId, granular);
          }
        }
      },
      onChange: () => {
        const c = undoControllerRef.current;
        setCanUndo(c ? c.canUndo() : false);
        setCanRedo(c ? c.canRedo() : false);
      },
    });
  }

  /**
   * Record an undo entry for a just-applied local mutation. `before` is the
   * deck state prior to the mutation (for inverse derivation); `redoOp` is the
   * forward op that was applied. Same `coalesceKey` within the controller's
   * window merges bursts (e.g. rapid text edits to one slide).
   */
  const recordUndo = useCallback(
    (
      before: Deck,
      redoOp: PatchDeckOp,
      opts?: { label?: string; coalesceKey?: string },
    ) => {
      const inverseOps = deriveInverseOp(before, redoOp);
      if (!inverseOps || inverseOps.length === 0) return;
      const entry: LocalOpUndoEntry<DeckUndoOp> = {
        undo: inverseOps.map((o) => ({ deckId: before.id, ...o })),
        redo: [{ deckId: before.id, ...redoOp }],
        label: opts?.label,
        coalesceKey: opts?.coalesceKey,
      };
      undoControllerRef.current?.push(entry);
    },
    [],
  );

  /**
   * Apply a remote deck snapshot (agent / collaborator via SSE or poll) and
   * record a replace-deck undo entry when content actually changed. Without
   * this, chat-driven edits land in the editor with Undo disabled.
   */
  const applyRemoteDeckUpdate = useCallback(
    (updated: Deck, label = "Agent edit") => {
      const before = decksRef.current.find((d) => d.id === updated.id);
      if (
        before &&
        deckContentSignature(before) !== deckContentSignature(updated)
      ) {
        undoControllerRef.current?.push({
          undo: [{ op: "replace-deck", deckId: updated.id, deck: before }],
          redo: [{ op: "replace-deck", deckId: updated.id, deck: updated }],
          label,
        });
      }
      setDecks((prev) => {
        const idx = prev.findIndex((d) => d.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });
    },
    [],
  );

  // Re-fetch the deck list and diff it against local state (added/removed
  // decks). Shared by the fallback poll and the SSE resync-on-reconnect path
  // below so both pull from one implementation of "what changed".
  //
  // Uses the `light` (id-only) listing — this runs every 15s and previously
  // downloaded every deck's full slide JSON just to diff ids, even though
  // existing decks' content was thrown away unused. Only genuinely NEW decks
  // (rare — usually zero per poll) get a follow-up full fetch so DeckCard can
  // still render an immediate preview for them.
  const refetchDeckListIfChanged = useCallback(async () => {
    const fresh = await fetchDeckListLightFromAPI();
    // A null result means the fetch failed (network error or non-2xx). Skip
    // the diff so we don't wipe local state on a transient failure.
    if (fresh === null) return;
    setLoadError(false);
    const pending = pendingCreateIdsRef.current;
    const currentDecks = decksRef.current;
    const currentIds = new Set(currentDecks.map((d) => d.id));
    const freshIds = new Set(fresh.map((d) => d.id));
    // Check if deck list changed (added or removed). Optimistic decks still
    // in flight are preserved (not treated as removed).
    const addedIds = fresh
      .filter((d) => !currentIds.has(d.id))
      .map((d) => d.id);
    const removed = currentDecks.filter(
      (d) => !freshIds.has(d.id) && !pending.has(d.id),
    );
    if (addedIds.length === 0 && removed.length === 0) return;

    const addedDecks = (
      await Promise.all(addedIds.map((id) => fetchDeckFromAPI(id)))
    ).filter((d): d is Deck => d !== null);

    lastExternalUpdateRef.current = Date.now();
    setDecks((prev) => {
      const prevIds = new Set(prev.map((d) => d.id));
      // Only add decks that aren't already in prev (prevents duplicates when
      // the closure's deck snapshot is stale compared to `prev`).
      let next = prev.filter((d) => freshIds.has(d.id) || pending.has(d.id));
      for (const a of addedDecks) {
        if (!prevIds.has(a.id)) next = [...next, a];
      }
      return next;
    });
  }, []);

  // Re-fetch the currently-open deck's full slide data and reconcile it.
  //
  // We ALWAYS fetch — never gate on pending-create or uncommitted-edits state.
  // Gating the fetch was the liveness bug: a wedged `pendingSaves` /
  // `inFlightSaves` / `pendingCreateIdsRef` entry (or a legitimately dirty
  // deck) would make the editor permanently blind to agent-added slides.
  //
  // How we APPLY the result depends on whether there are local edits to
  // protect:
  //   - Clean deck → adopt the server snapshot wholesale (handles content
  //     changes, removals, and reorders too), exactly as before.
  //   - Dirty deck / unsaved local create → additive merge only: surface
  //     agent-added slides without ever overwriting or dropping local slides.
  const refetchOpenDeckIfChanged = useCallback(
    async (currentOpenId: string) => {
      const serverDeck = await fetchDeckFromAPI(currentOpenId);
      // Null means 404 (row not created yet), a transient failure, or a
      // still-pending create — nothing authoritative to reconcile.
      if (!serverDeck) return;
      const clientDeck = decksRef.current.find((d) => d.id === currentOpenId);

      const hasLocalEdits =
        pendingCreateIdsRef.current.has(currentOpenId) ||
        hasUncommittedDeckChanges(currentOpenId, dirtyDeckIdsRef.current);

      if (hasLocalEdits && clientDeck) {
        // Content-preserving: only ADD server slides missing locally.
        const merged = mergeServerAddedSlides(clientDeck, serverDeck);
        if (merged === clientDeck) return; // nothing new to surface
        lastExternalUpdateRef.current = Date.now();
        setDecks((prev) => {
          const idx = prev.findIndex((d) => d.id === currentOpenId);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = merged;
          return next;
        });
        return;
      }

      const changed =
        !clientDeck ||
        clientDeck.updatedAt !== serverDeck.updatedAt ||
        clientDeck.slides.length !== serverDeck.slides.length;
      if (!changed) return;
      lastExternalUpdateRef.current = Date.now();
      applyRemoteDeckUpdate(serverDeck);
    },
    [applyRemoteDeckUpdate],
  );

  /**
   * Full resync of authoritative deck/slide state from the server. The SSE
   * channel (`notifyClients` server-side) is fire-and-forget to whatever
   * connections are live at broadcast time — there is no backlog or replay,
   * so any event emitted while this tab was disconnected is gone forever.
   * Call this whenever the SSE connection (re)establishes after a drop so
   * agent writes made during the gap show up without requiring a full page
   * reload.
   */
  const resyncDeckState = useCallback(async () => {
    try {
      await refetchDeckListIfChanged();
    } catch {}
    const currentOpenId = currentOpenDeckIdFromWindow();
    if (!currentOpenId) return;
    try {
      await refetchOpenDeckIfChanged(currentOpenId);
    } catch {}
  }, [refetchDeckListIfChanged, refetchOpenDeckIfChanged]);

  const resetDeckBaseline = useCallback((nextDecks: Deck[]) => {
    setDecks(nextDecks);
    // A baseline reset (initial mount, route change, or access reload) starts a
    // fresh undo timeline. Note: this is NOT the SSE/poll "remote update" path —
    // those call setDecks directly and intentionally leave the undo stack
    // intact so a collaborator's edit doesn't wipe your local undo history.
    undoControllerRef.current?.clear();
  }, []);

  const reloadDecks = useCallback(async () => {
    const requestId = ++deckBaselineRequestIdRef.current;
    const requestedOpenDeckId = currentOpenDeckIdFromWindow();
    const loaded = await fetchDecksForCurrentRoute();
    if (
      requestId !== deckBaselineRequestIdRef.current ||
      requestedOpenDeckId !== currentOpenDeckIdFromWindow() ||
      loaded === null
    ) {
      if (requestId === deckBaselineRequestIdRef.current) {
        setLoadError(loaded === null);
      }
      return;
    }
    lastExternalUpdateRef.current = Date.now();
    resetDeckBaseline(loaded);
    setLoadError(false);
  }, [resetDeckBaseline]);

  // Load decks from API on mount
  useEffect(() => {
    const requestId = ++deckBaselineRequestIdRef.current;
    const requestedOpenDeckId = currentOpenDeckIdFromWindow();
    fetchDecksForCurrentRoute().then(async (loaded) => {
      if (
        requestId !== deckBaselineRequestIdRef.current ||
        requestedOpenDeckId !== currentOpenDeckIdFromWindow()
      ) {
        setLoading(false);
        return;
      }
      // Initial fetch failed — start empty so the UI can render. The fallback
      // poll will retry shortly; until then `decks` stays empty without
      // triggering the save effect (lastExternalUpdateRef is bumped).
      const initial = loaded ?? [];
      lastExternalUpdateRef.current = Date.now(); // Don't save initial load back
      resetDeckBaseline(initial);
      setLoadError(loaded === null);
      setLoading(false);
    });
  }, [resetDeckBaseline]);

  // Fallback polling for deck list + open-deck changes. SSE is the primary
  // path; this catches agent/db writes that bypass it without hammering idle
  // editor pages.
  useEffect(() => {
    if (loading) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastListFetchAt = 0;

    const readOpenDeckId = (): string | null => {
      if (typeof window === "undefined") return null;
      return deckIdFromPathname(window.location.pathname);
    };

    const isHidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";

    const schedule = () => {
      if (stopped || isHidden()) return;
      const intervalMs = readOpenDeckId()
        ? OPEN_DECK_FALLBACK_POLL_MS
        : DECK_LIST_FALLBACK_POLL_MS;
      timer = setTimeout(poll, intervalMs);
    };

    async function poll() {
      if (stopped || isHidden()) return;
      const now = Date.now();
      const currentOpenId = readOpenDeckId();

      try {
        if (
          !currentOpenId ||
          now - lastListFetchAt >= DECK_LIST_FALLBACK_POLL_MS
        ) {
          lastListFetchAt = now;
          // A failed fetch (network error or non-2xx) is swallowed inside
          // refetchDeckListIfChanged — skip the diff so we don't wipe local
          // state on a transient failure, otherwise the user's open deck
          // disappears and they're bounced back to the empty "Create your
          // first deck" screen until the next poll succeeds.
          await refetchDeckListIfChanged();
        }

        // Also re-fetch the currently-open deck so agent-added slides show up.
        // The list endpoint may not include full slide contents, and SSE can
        // miss events if the client reconnects between broadcasts.
        if (currentOpenId) {
          try {
            await refetchOpenDeckIfChanged(currentOpenId);
          } catch {}
        }
      } catch {}
      schedule();
    }

    const pollNow = () => {
      if (isHidden()) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void poll();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        pollNow();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    void poll();
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refetchDeckListIfChanged, refetchOpenDeckIfChanged, loading]);

  // The dirty-deck set is now only used as a sentinel that "something changed
  // for this deck". Ops are enqueued directly in each mutation handler below;
  // this effect is kept as a safety net that drains any dirty decks that did
  // NOT go through the granular path (e.g. future callers, undo/redo which
  // already enqueue full-replace ops, or edge cases we haven't anticipated).
  useEffect(() => {
    if (loading) return;
    if (Date.now() - lastExternalUpdateRef.current < 2000) return;
    const dirtyIds = Array.from(dirtyDeckIdsRef.current);
    if (dirtyIds.length === 0) return;
    for (const id of dirtyIds) {
      dirtyDeckIdsRef.current.delete(id);
      // Only fall back to full-replace if no granular ops were enqueued
      // for this deck (they handle the actual save).
      if (!pendingOpsQueue.has(id) && !pendingSaves.has(id)) {
        const deck = decks.find((d) => d.id === id);
        if (!deck) continue;
        saveDeckToAPI(deck);
      }
    }
  }, [decks, loading]);

  // Listen for deck changes via SSE (so agent edits show up in real-time).
  //
  // EventSource auto-reconnects on its own ONLY for network-level drops
  // (readyState stays CONNECTING while it retries). A non-2xx HTTP response
  // — e.g. a transient 503 during a cold start — is FATAL per spec: the
  // browser sets readyState CLOSED and never retries. Without our own
  // reconnect logic, a single 503 permanently kills live updates for the
  // rest of the tab's life (the rail goes stale until a manual reload).
  //
  // We reconnect manually with bounded exponential backoff, and because
  // notifyClients() on the server has no backlog/replay (fire-and-forget to
  // whatever connections are live at broadcast time — see
  // server/handlers/decks.ts), every reconnect after the first triggers a
  // full resync via resyncDeckState() so agent writes made during the gap
  // aren't silently lost.
  useEffect(() => {
    if (isEmbedAuthActive()) return;
    let stopped = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let hasConnectedOnce = false;

    const isHidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer || isHidden()) return;
      const delay = Math.min(
        SSE_RECONNECT_BASE_MS * 2 ** retryCount,
        SSE_RECONNECT_MAX_MS,
      );
      retryCount += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const handleMessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "deck-deleted" && data.deckId) {
          lastExternalUpdateRef.current = Date.now();
          setDecks((prev) => prev.filter((d) => d.id !== data.deckId));
        } else if (data.type === "deck-changed" && data.deckId) {
          // Skip if a save for this deck is pending or in flight — this
          // event is most likely the echo of our own write and the server
          // copy may be a few hundred ms behind what the user just typed.
          // Polling and the next save's response will bring the canonical
          // state once the local burst settles.
          if (hasUncommittedDeckChanges(data.deckId, dirtyDeckIdsRef.current)) {
            return;
          }
          // Refetch the changed deck from the shared action surface.
          const updated = await fetchDeckFromAPI(data.deckId);
          if (!updated) return;
          lastExternalUpdateRef.current = Date.now(); // Suppress save-back
          applyRemoteDeckUpdate(updated);
        }
      } catch {}
    };

    const connect = () => {
      if (stopped || isHidden()) return;
      // Never leak the previous connection.
      if (es) {
        es.close();
        es = null;
      }
      // request-storm-allow: one deck-scoped SSE with backoff and unmount cleanup carries payloads sync events omit.
      const next = new EventSource(`${appBasePath()}/api/decks/events`);
      es = next;
      next.onmessage = handleMessage;
      next.onopen = () => {
        retryCount = 0;
        // Every reconnect after the first can have missed broadcasts made
        // while we were disconnected — the SSE channel has no backlog, so
        // resync authoritative state instead of trusting the stream alone
        // to have caught us up.
        if (hasConnectedOnce) {
          void resyncDeckState();
        }
        hasConnectedOnce = true;
      };
      next.onerror = () => {
        if (es !== next) return;
        if (next.readyState === EventSource.CLOSED) {
          // Fatal per spec (non-2xx status, bad content-type, etc.) — the
          // browser will not retry on its own. Reconnect ourselves.
          next.close();
          es = null;
          scheduleReconnect();
        }
        // readyState === CONNECTING means the browser is already retrying a
        // network-level drop on its own; onopen above resyncs once that
        // succeeds.
      };
    };

    const handleVisibilityChange = () => {
      if (isHidden()) {
        clearReconnectTimer();
        return;
      }
      retryCount = 0;
      if (!es || es.readyState === EventSource.CLOSED) {
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      clearReconnectTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [applyRemoteDeckUpdate, resyncDeckState]);

  // Flush pending (debounced) saves before the tab is hidden or unloaded so the
  // last ~500ms of edits aren't lost on close/navigation. `pagehide` is the
  // reliable unload signal on modern browsers (incl. bfcache); we also flush on
  // `visibilitychange(hidden)` which fires on mobile tab-switch / app-background
  // where `pagehide` may not.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushPendingSaves();
    };
    const onPageHide = () => flushPendingSaves();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  const undo = useCallback(() => {
    void undoControllerRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    void undoControllerRef.current?.redo();
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't intercept undo/redo when typing in an input, textarea, or
      // contenteditable (TipTap inline editor) — let those handle it themselves.
      const isTyping =
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (isTyping) return;
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        if (isTyping) return;
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [undo, redo]);

  const createDeck = useCallback(
    (
      title?: string,
      options?: { noDefaultSlides?: boolean; designSystemId?: string | null },
    ): Deck => {
      const insertIndex = decksRef.current.length;
      const newDeck: Deck = {
        id: nanoid(10),
        title: title || "Untitled Deck",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdByMe: true,
        designSystemId: options?.designSystemId ?? undefined,
        slides: options?.noDefaultSlides
          ? []
          : [
              {
                id: nanoid(8),
                content: defaultSlideContent.title,
                notes: "",
                layout: "title",
                background: "bg-[#000000]",
              },
              {
                id: nanoid(8),
                content: defaultSlideContent.content,
                notes: "",
                layout: "content",
                background: "bg-[#000000]",
              },
            ],
      };
      // Save to API immediately (not debounced). Track as pending so the
      // poll doesn't wipe the optimistic deck before the POST completes.
      pendingCreateIdsRef.current.add(newDeck.id);
      const createPromise = createDeckOnAPI(newDeck);
      pendingCreatePromisesRef.current.set(newDeck.id, createPromise);
      createPromise
        .catch((err) => {
          console.error(`Failed to create deck ${newDeck.id}:`, err);
        })
        .finally(() => {
          pendingCreateIdsRef.current.delete(newDeck.id);
          if (
            pendingCreatePromisesRef.current.get(newDeck.id) === createPromise
          ) {
            pendingCreatePromisesRef.current.delete(newDeck.id);
          }
        });
      setDecksLocal((prev) => [...prev, newDeck]);
      undoControllerRef.current?.push({
        undo: [{ op: "delete-deck", deckId: newDeck.id }],
        redo: [
          {
            op: "restore-deck",
            deckId: newDeck.id,
            deck: newDeck,
            index: insertIndex,
          },
        ],
        label: "Create deck",
      });
      return newDeck;
    },
    [setDecksLocal],
  );

  const ensureDeckPersisted = useCallback(async (id: string) => {
    const pendingCreate = pendingCreatePromisesRef.current.get(id);
    if (pendingCreate) {
      try {
        await pendingCreate;
        return true;
      } catch {
        return false;
      }
    }

    return (await fetchDeckFromAPI(id)) !== null;
  }, []);

  const duplicateDeck = useCallback(
    (sourceDeckId: string, newId: string, title?: string): Deck | null => {
      if (pendingDuplicateSourceIdsRef.current.has(sourceDeckId)) return null;
      const source = decks.find((d) => d.id === sourceDeckId);
      if (!source) return null;

      const now = new Date().toISOString();
      const newTitle = title || `Copy of ${source.title}`;
      const insertIndex = decksRef.current.length;
      // Re-id slides so optimistic edits to the copy don't collide with the
      // original. The server does the same thing — these client ids will be
      // replaced by server-generated ones once the duplicate action lands and
      // the next poll/SSE refresh syncs the row.
      const optimistic: Deck = {
        ...(JSON.parse(JSON.stringify(source)) as Deck),
        id: newId,
        title: newTitle,
        createdAt: now,
        updatedAt: now,
        // Visibility/share state doesn't carry over to a fresh copy — server
        // creates the new row owned by the current user, private by default.
        visibility: "private",
        createdByMe: true,
        shareToken: undefined,
      };
      optimistic.slides = optimistic.slides.map((s) => ({
        ...s,
        id: nanoid(8),
      }));

      // Track as pending so the poll doesn't wipe the optimistic deck before
      // the duplicate-deck action's INSERT lands.
      pendingCreateIdsRef.current.add(newId);
      pendingDuplicateSourceIdsRef.current.add(sourceDeckId);

      // Fire the action in the background. On error, roll back.
      const duplicatePromise = callAction<DuplicateDeckActionResult>(
        "duplicate-deck",
        {
          deckId: sourceDeckId,
          newId,
          title,
        },
      ).then(() => undefined);
      pendingCreatePromisesRef.current.set(newId, duplicatePromise);
      duplicatePromise
        .catch((err) => {
          console.error("Duplicate failed:", err);
          // Roll back: drop the optimistic deck from local state.
          setDecks((prev) => prev.filter((d) => d.id !== newId));
        })
        .finally(() => {
          pendingCreateIdsRef.current.delete(newId);
          if (
            pendingCreatePromisesRef.current.get(newId) === duplicatePromise
          ) {
            pendingCreatePromisesRef.current.delete(newId);
          }
          pendingDuplicateSourceIdsRef.current.delete(sourceDeckId);
        });

      setDecksLocal((prev) => [...prev, optimistic]);
      undoControllerRef.current?.push({
        undo: [{ op: "delete-deck", deckId: optimistic.id }],
        redo: [
          {
            op: "restore-deck",
            deckId: optimistic.id,
            deck: optimistic,
            index: insertIndex,
          },
        ],
        label: "Duplicate deck",
      });
      return optimistic;
    },
    [decks, setDecksLocal],
  );

  const deleteDeck = useCallback(
    (id: string) => {
      const beforeDeck = decksRef.current.find((deck) => deck.id === id);
      const beforeIndex = decksRef.current.findIndex((deck) => deck.id === id);
      discardPendingDeckOps(id);
      deleteDeckAfterPendingCreate(id);
      setDecksLocal((prev) => prev.filter((d) => d.id !== id));
      if (beforeDeck) {
        undoControllerRef.current?.push({
          undo: [
            {
              op: "restore-deck",
              deckId: id,
              deck: beforeDeck,
              index: beforeIndex,
            },
          ],
          redo: [{ op: "delete-deck", deckId: id }],
          label: "Delete deck",
        });
      }
    },
    [deleteDeckAfterPendingCreate, setDecksLocal],
  );

  const updateDeck = useCallback(
    (id: string, updates: Partial<Omit<Deck, "id" | "createdAt">>) => {
      // Clear the external-update suppression window so a rename/update that
      // happens within 2s of page load (or an SSE event) is not silently dropped.
      markDeckDirty(id);
      const before = decksRef.current.find((d) => d.id === id);
      setDecks((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, ...updates, updatedAt: new Date().toISOString() }
            : d,
        ),
      );
      // Enqueue a granular patch-deck-fields op — only the changed fields are
      // sent to the server, so concurrent edits to slides are never clobbered.
      // Exclude internal/derived fields that live only in client state.
      const {
        slides: _slides,
        createdAt: _ca,
        ...persistableUpdates
      } = {
        slides: undefined,
        createdAt: undefined,
        ...updates,
      };
      void _slides;
      _ca;
      if (Object.keys(persistableUpdates).length > 0) {
        const op: PatchDeckOp = {
          op: "patch-deck-fields",
          fields: persistableUpdates as PatchDeckFields,
        };
        enqueueDeckOp(id, op);
        if (before) {
          // Coalesce rapid deck-field edits (e.g. title typing, tweak sliders)
          // per field-set so a burst becomes one undo step.
          recordUndo(before, op, {
            label: "Update deck",
            coalesceKey: `${id}:deck-fields:${Object.keys(persistableUpdates)
              .sort()
              .join(",")}`,
          });
        }
      }
    },
    [markDeckDirty, recordUndo],
  );

  const getDeck = useCallback(
    (id: string) => decks.find((d) => d.id === id),
    [decks],
  );

  const addSlide = useCallback(
    (deckId: string, layout: SlideLayout = "content", afterIndex?: number) => {
      markDeckDirty(deckId);
      const newSlide: Slide = {
        id: nanoid(8),
        content: defaultSlideContent[layout],
        notes: "",
        layout,
        background: "bg-[#000000]",
      };

      const before = decksRef.current.find((d) => d.id === deckId);
      let afterSlideId: string | undefined;
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const slides = [...d.slides];
          const insertAt =
            afterIndex !== undefined ? afterIndex + 1 : slides.length;
          // Capture the slide ID we're inserting after for the granular op
          afterSlideId = insertAt > 0 ? slides[insertAt - 1]?.id : undefined;
          slides.splice(insertAt, 0, newSlide);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );

      // Granular op — the server splices in only this slide, preserving any
      // concurrent changes to other slides.
      const op: PatchDeckOp = {
        op: "add-slide",
        slideId: newSlide.id,
        afterSlideId,
        fields: {
          content: newSlide.content,
          notes: newSlide.notes,
          layout: newSlide.layout,
          background: newSlide.background,
        },
      };
      enqueueDeckOp(deckId, op);
      if (before) recordUndo(before, op, { label: "Add slide" });

      return newSlide.id;
    },
    [markDeckDirty, recordUndo, setDecksLocal],
  );

  const updateSlide = useCallback(
    (deckId: string, slideId: string, updates: Partial<Omit<Slide, "id">>) => {
      markDeckDirty(deckId);
      const label = updates.layout
        ? "Change layout"
        : updates.background
          ? "Change background"
          : updates.content
            ? "Update content"
            : "Edit slide";
      const before = decksRef.current.find((d) => d.id === deckId);
      setDecksLocal((prev: Deck[]) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          return {
            ...d,
            slides: d.slides.map((s) =>
              s.id === slideId ? { ...s, ...updates } : s,
            ),
            updatedAt: new Date().toISOString(),
          };
        }),
      );
      // Granular op — only this slide's changed fields reach the server.
      const op: PatchDeckOp = { op: "patch-slide", slideId, fields: updates };
      enqueueDeckOp(deckId, op);
      if (before) {
        // Coalesce a burst of edits to the SAME slide's SAME field-set into one
        // undo step (e.g. typing characters into inline text). Distinct
        // field-sets (content vs background vs layout) get distinct undo steps.
        recordUndo(before, op, {
          label,
          coalesceKey: `${deckId}:${slideId}:${Object.keys(updates)
            .sort()
            .join(",")}`,
        });
      }
    },
    [markDeckDirty, recordUndo, setDecksLocal],
  );

  const deleteSlide = useCallback(
    (deckId: string, slideId: string) => {
      markDeckDirty(deckId);
      const before = decksRef.current.find((d) => d.id === deckId);
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const slides = d.slides.filter((s) => s.id !== slideId);
          if (slides.length === 0) {
            slides.push({
              id: nanoid(8),
              content: defaultSlideContent.blank,
              notes: "",
              layout: "blank",
            });
          }
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
      // Granular op — server deletes only this slide from the blob.
      const op: PatchDeckOp = { op: "delete-slide", slideId };
      enqueueDeckOp(deckId, op);
      // Inverse re-adds the full prior slide at its old position, so undo
      // restores content/notes/layout/background exactly. (This is the case
      // behind the "Undo delete" toast in DeckEditor.)
      if (before) recordUndo(before, op, { label: "Delete slide" });
    },
    [markDeckDirty, recordUndo, setDecksLocal],
  );

  const duplicateSlide = useCallback(
    (deckId: string, slideId: string) => {
      markDeckDirty(deckId);
      const before = decksRef.current.find((d) => d.id === deckId);
      let copiedSlide: Slide | undefined;
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const idx = d.slides.findIndex((s) => s.id === slideId);
          if (idx === -1) return d;
          const original = d.slides[idx];
          const copy: Slide = { ...original, id: nanoid(8) };
          copiedSlide = copy;
          const slides = [...d.slides];
          slides.splice(idx + 1, 0, copy);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
      if (copiedSlide) {
        // Granular add-slide op — inserts the copy after the original.
        const { id: newSlideId, ...rest } = copiedSlide;
        const op: PatchDeckOp = {
          op: "add-slide",
          slideId: newSlideId,
          afterSlideId: slideId,
          fields: {
            content: rest.content,
            notes: rest.notes,
            layout: rest.layout,
            background: rest.background,
          },
        };
        enqueueDeckOp(deckId, op);
        if (before) recordUndo(before, op, { label: "Duplicate slide" });
      }
    },
    [markDeckDirty, recordUndo, setDecksLocal],
  );

  const reorderSlides = useCallback(
    (deckId: string, oldIndex: number, newIndex: number) => {
      markDeckDirty(deckId);
      const before = decksRef.current.find((d) => d.id === deckId);
      let orderedIds: string[] | undefined;
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const slides = [...d.slides];
          const [moved] = slides.splice(oldIndex, 1);
          slides.splice(newIndex, 0, moved);
          orderedIds = slides.map((s) => s.id);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
      if (orderedIds) {
        // Granular op — server reorders by slide ID rather than by index,
        // so concurrent adds from other writers don't get dropped.
        const op: PatchDeckOp = { op: "reorder-slides", orderedIds };
        enqueueDeckOp(deckId, op);
        if (before) recordUndo(before, op, { label: "Reorder slides" });
      }
    },
    [markDeckDirty, recordUndo, setDecksLocal],
  );

  const setDeckSlides = useCallback(
    (deckId: string, slides: Slide[]) => {
      markDeckDirty(deckId);
      const before = decksRef.current.find((deck) => deck.id === deckId);
      const after = before
        ? { ...before, slides, updatedAt: new Date().toISOString() }
        : null;
      // setDeckSlides replaces ALL slides wholesale (used by AI generation and
      // imports), so its undo entry is a deck-level full replacement instead of
      // a fine-grained slide patch.
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const next = after ?? {
            ...d,
            slides,
            updatedAt: new Date().toISOString(),
          };
          enqueueDeckOp(deckId, { op: "full-replace", deck: next });
          return next;
        }),
      );
      if (before && after) {
        undoControllerRef.current?.push({
          undo: [{ op: "replace-deck", deckId, deck: before }],
          redo: [{ op: "replace-deck", deckId, deck: after }],
          label: "Replace slides",
        });
      }
    },
    [markDeckDirty, setDecksLocal],
  );

  return (
    <DeckContext.Provider
      value={{
        decks,
        loading,
        loadError,
        createDeck,
        ensureDeckPersisted,
        duplicateDeck,
        deleteDeck,
        updateDeck,
        reloadDecks,
        getDeck,
        addSlide,
        updateSlide,
        deleteSlide,
        duplicateSlide,
        reorderSlides,
        setDeckSlides,
        markDeckDirty,
        undo,
        redo,
        canUndo,
        canRedo,
      }}
    >
      {children}
    </DeckContext.Provider>
  );
}

export function useDecks() {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error("useDecks must be used within DeckProvider");
  return ctx;
}

/**
 * Subscribe to deck save-state. Returns `{ saving: boolean }` — true while any
 * deck has a pending debounce timer or an in-flight PUT.
 *
 * Used by SaveStatusIndicator in the toolbar so users always see whether
 * their work has been committed (Rochkind reported losing a full deck because
 * there was no save signal).
 */
export function useSaveState(): { saving: boolean } {
  return useSyncExternalStore(subscribeSaveState, getSaveSnapshot, () => ({
    saving: false,
  }));
}
