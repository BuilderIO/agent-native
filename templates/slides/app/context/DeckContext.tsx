import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  createLocalOpUndoController,
  type LocalOpUndoController,
  type LocalOpUndoEntry,
} from "@agent-native/core/client/collab";
import { callAction } from "@agent-native/core/client/hooks";
import { isEmbedAuthActive } from "@agent-native/core/client/host";
import { useOrg } from "@agent-native/core/client/org";
import { subscribeSyncEvents } from "@agent-native/core/client/use-db-sync";
import { DEFAULT_DECK_TITLE } from "@shared/deck-title";
import {
  createLayoutFitRevision,
  deckFitRenderFieldsChanged,
  hashSlideContent,
  slideFitRenderFieldsChanged,
} from "@shared/slide-fit";
import { repairDeckSlideReferences } from "@shared/slide-ids";
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

import { normalizeSlidePadding } from "../lib/normalize-slide-padding";

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
      /** Everything but `id` and the transient `imageLoading` flag. A slide
       * copied or restored through this op keeps its transition, animations,
       * and image/Excalidraw data instead of silently losing them on reload. */
      fields: Omit<Partial<Slide>, "id" | "imageLoading"> & { content: string };
    }
  | {
      op: "patch-deck-fields";
      fields: Partial<
        Omit<Deck, "id" | "slides" | "createdAt" | "updatedAt" | "createdByMe">
      >;
    }
  /** Sentinel: discard all accumulated ops and do a full PUT instead. */
  | {
      op: "full-replace";
      deck: Deck;
      onSaveSuccess?: (ops: GranularOp[]) => void;
    };

export type PatchDeckOp = Exclude<GranularOp, { op: "full-replace" }>;

type PersistedResultHandler = (
  results: readonly unknown[],
  slideWriteSequences: ReadonlyMap<string, number>,
) => void;

type PendingPersistedResultHandler = {
  handler: PersistedResultHandler;
  slideWriteSequences: Map<string, number>;
};

/** Slide payload for an `add-slide` op. `imageLoading` is transient UI state
 * and must not persist; everything else on the slide has to survive the round
 * trip or a duplicated/restored slide comes back missing fields. */
function addSlideFields(
  slide: Slide,
): Extract<GranularOp, { op: "add-slide" }>["fields"] {
  const { id: _id, imageLoading: _imageLoading, ...fields } = slide;
  return {
    ...fields,
    content: normalizeSlidePadding(fields.content),
  };
}
export type DeckReloadStatus = "loaded" | "failed" | "stale";
export interface UpdateSlideOptions {
  persistence?: "debounced" | "immediate";
  /** Queue a draft without replacing the active contentEditable DOM. */
  preserveLocalState?: boolean;
  /** Record the edit for undo without enqueueing a duplicate server write. */
  recordUndoOnly?: boolean;
  /** Explicit object deletion may clear previews missing from the submitted HTML. */
  clearMissingImagePreviews?: boolean;
}

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
  /** Changes on every persisted content write so fit measurements cannot cross writes. */
  layoutFitRevision?: string;
  /** Suppresses the overflow warning until an agent changes rendered layout. */
  layoutWarningDismissed?: boolean;
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
  /** Excluded from Present/Presenter mode playback, but stays in the deck. */
  skipped?: boolean;
}

export type AnimationType = "appear" | "fade" | "slide-up" | "zoom";

export interface SlideAnimation {
  id: string;
  /** Index of the child element within the content container */
  elementIndex: number;
  /** Preferred target: child-index path from the outer `.fmd-slide` wrapper. */
  elementPath?: number[];
  /** Reveal each paragraph in a text object as its own click step. */
  byParagraph?: boolean;
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
  /** Starred decks are offered first in the new-deck reference picker. */
  starred?: boolean;
  /** Slide aspect ratio (defaults to 16:9 when absent for backwards compat) */
  aspectRatio?: AspectRatio;
  /** First slide returned by the light deck listing for home-page previews. */
  previewSlide?: Slide;
}

export type DeckPersistenceResult =
  | { persisted: true }
  | { persisted: false; reason: "request-failed"; error: unknown }
  | { persisted: false; reason: "not-found" };

/**
 * Ask the server whether a deck row exists, keeping "absent" and "could not
 * check" distinct — a rejected write is not by itself proof the row is missing.
 */
async function probeDeckPersisted(id: string): Promise<DeckPersistenceResult> {
  try {
    const result = await callAction<unknown>(
      "get-deck",
      { id },
      {
        method: "GET",
      },
    );
    return normalizeActionDeck(result)
      ? { persisted: true }
      : { persisted: false, reason: "not-found" };
  } catch (error) {
    return { persisted: false, reason: "request-failed", error };
  }
}

export function describeDeckPersistenceFailure(
  result: DeckPersistenceResult,
  fallback: string,
): string {
  if (result.persisted || result.reason === "not-found") return fallback;
  if (result.error instanceof Error && result.error.message.trim()) {
    return result.error.message;
  }
  if (typeof result.error === "string" && result.error.trim()) {
    return result.error;
  }
  return fallback;
}

interface DeckContextType {
  decks: Deck[];
  loading: boolean;
  loadError: boolean;
  createDeck: (
    title?: string,
    options?: { noDefaultSlides?: boolean; designSystemId?: string | null },
  ) => Deck;
  ensureDeckPersisted: (id: string) => Promise<DeckPersistenceResult>;
  /**
   * Duplicate a deck, hydrating a preview-only source before creating the
   * optimistic copy. On error, the optimistic deck is rolled back.
   *
   * Returns the optimistic deck (or `null` if the source deck isn't found or
   * could not be hydrated).
   */
  duplicateDeck: (
    sourceDeckId: string,
    newId: string,
    title?: string,
    onFailure?: () => void,
  ) => Promise<Deck | null>;
  deleteDeck: (id: string) => void;
  updateDeck: (
    id: string,
    updates: Partial<Omit<Deck, "id" | "createdAt">>,
  ) => void;
  reloadDecks: () => Promise<void>;
  reloadDecksWithStatus: () => Promise<DeckReloadStatus>;
  refreshOpenDeck: (
    deckId: string,
    options?: { clearPendingWrites?: boolean },
  ) => Promise<Deck | null>;
  getDeck: (id: string) => Deck | undefined;
  addSlide: (
    deckId: string,
    layout?: SlideLayout,
    afterIndex?: number,
    options?: { persistence?: "debounced" | "immediate" },
  ) => string;
  flushDeckSave: (deckId: string) => Promise<void>;
  updateSlide: (
    deckId: string,
    slideId: string,
    updates: Partial<Omit<Slide, "id">>,
    options?: UpdateSlideOptions,
  ) => void;
  updateSlides: (
    deckId: string,
    slideUpdates: {
      slideId: string;
      updates: Partial<Omit<Slide, "id">>;
    }[],
  ) => void;
  deleteSlide: (deckId: string, slideId: string) => void;
  deleteSlides: (deckId: string, slideIds: string[]) => void;
  duplicateSlide: (deckId: string, slideId: string) => string | undefined;
  /** Inserts a copy of arbitrary slide data after `afterSlideId`. Used for
   *  slide cut/paste, where the original may already be deleted so there is
   *  no live slide id left to duplicate from. */
  pasteSlide: (
    deckId: string,
    afterSlideId: string,
    slideFields: Omit<Slide, "id">,
  ) => string | undefined;
  pasteSlides: (
    deckId: string,
    afterSlideId: string,
    slideFields: Omit<Slide, "id">[],
    options?: { beforeSlideId?: string },
  ) => string[];
  reorderSlides: (
    deckId: string,
    activeSlideId: string,
    overSlideId: string,
    selectedSlideIds?: string[],
  ) => void;
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
// Safety-net interval used while the SSE channel is actually connected. The
// fast intervals above are for when the live channel is genuinely down; running
// them unconditionally cost an idle deck page ~36 requests/minute.
const LIVE_CHANNEL_IDLE_POLL_MS = 60_000;
/**
 * How long to wait before the next fallback poll. The poll only takes over at
 * its fast intervals when the live channel is genuinely not carrying updates;
 * while SSE is connected it drops to a slow safety net.
 */
export function fallbackPollIntervalMs(state: {
  liveChannelConnected: boolean;
  hasOpenDeck: boolean;
}): number {
  if (state.liveChannelConnected) return LIVE_CHANNEL_IDLE_POLL_MS;
  return state.hasOpenDeck
    ? OPEN_DECK_FALLBACK_POLL_MS
    : DECK_LIST_FALLBACK_POLL_MS;
}

type DeckListActionResult = {
  decks?: unknown[];
};

type DuplicateDeckActionResult = {
  id: string;
  title: string;
  slideCount: number;
  url?: string;
};

/** Per-slide fields `get-deck` computes for the agent (slide position/hash
 *  hints) that aren't part of the client's own `Slide` shape. Left on the
 *  fetched deck, they make every server refetch look "changed" relative to
 *  the client's slim optimistic copy — see `normalizeActionDeck`. */
const GET_DECK_ONLY_SLIDE_FIELDS = [
  "slideNumber",
  "zeroBasedIndex",
  "contentHash",
] as const;

/** Deck-level fields `get-deck` computes for the agent (counts, deep links,
 *  the currently-selected slide) that aren't part of the client's own `Deck`
 *  shape. See `normalizeActionDeck`. */
const GET_DECK_ONLY_DECK_FIELDS = [
  "slideCount",
  "slideNumbering",
  "deepLink",
  "selectedSlideId",
] as const;

function normalizeActionDeck(value: unknown): Deck | null {
  if (!value || typeof value !== "object") return null;
  const deck = value as Partial<Deck>;
  if (typeof deck.id !== "string") return null;

  const deckRecord = deck as unknown as Record<string, unknown>;
  const cleanedDeck = { ...deckRecord };
  for (const field of GET_DECK_ONLY_DECK_FIELDS) delete cleanedDeck[field];
  const previewSlide = deckRecord.previewSlide;
  delete cleanedDeck.previewSlide;

  // Strip the same decorative fields from every slide, so a deck fetched from
  // `get-deck` is structurally identical to one built by local mutations —
  // otherwise `deckContentSignature` sees a "change" on every refetch of the
  // open deck and spams the undo stack with no-op `replace-deck` entries.
  const slides = Array.isArray(deck.slides)
    ? deck.slides.map((slide) => {
        if (!slide || typeof slide !== "object") return slide;
        const cleanedSlide = {
          ...(slide as unknown as Record<string, unknown>),
        };
        for (const field of GET_DECK_ONLY_SLIDE_FIELDS) {
          delete cleanedSlide[field];
        }
        return cleanedSlide as unknown as Slide;
      })
    : [];

  return {
    ...cleanedDeck,
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
    slides,
    ...(previewSlide && typeof previewSlide === "object"
      ? { previewSlide: previewSlide as Slide }
      : {}),
  } as Deck;
}

export function getDuplicateSourceSlides(deck: Deck): Slide[] {
  return deck.slides.length > 0
    ? deck.slides
    : deck.previewSlide
      ? [deck.previewSlide]
      : [];
}

// Debounced save to API + save-state listeners (so the toolbar indicator
// can show "Saving…" / "Saved"). The map tracks pending debounce timers;
// `inFlight` tracks active fetches. Combined, they answer "is anything
// uncommitted?" for the indicator.
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightSaves = new Set<string>();
const inFlightSaveChains = new Map<string, Promise<void>>();
const inFlightSaveControllers = new Map<string, AbortController>();
const deckSaveGenerations = new Map<string, number>();
const immediateFlushRequests = new Map<string, boolean>();
const deckSaveRetryAttempts = new Map<string, number>();
const failedSaveDecks = new Set<string>();
const saveStateListeners = new Set<() => void>();
const MAX_DECK_SAVE_RETRIES = 2;
const DECK_SAVE_RETRY_BASE_MS = 250;

// Per-deck queue of granular ops waiting to be flushed. Keys are deck IDs.
// Ops are appended by enqueueDeckOp and drained when the debounce fires.
const pendingOpsQueue = new Map<string, GranularOp[]>();
const pendingPersistedResultHandlers = new Map<
  string,
  PendingPersistedResultHandler[]
>();
const slideLocalWriteSequences = new Map<string, Map<string, number>>();

// Bumped on every local write enqueued for a deck. A deck read that spans a
// local write is stale for that deck no matter what the pending state looks
// like at either endpoint — the write can be enqueued, debounced, flushed and
// drained entirely inside one GET, leaving nothing pending to notice it.
// Comparing this counter across the read is the only way to see that.
const deckLocalWriteSeq = new Map<string, number>();

// The ops a deck's current in-flight save actually sent, so a slide-scoped
// check can tell "this slide's save is in flight" from "some other slide in
// this deck has a save in flight" — `inFlightSaves` alone can't, since it is
// deck-wide and previously made every slide in the deck look pending for the
// whole request duration, starving unrelated agent writes of live sync.
const inFlightOpSlides = new Map<string, GranularOp[]>();

// Slides currently mid inline-edit (contentEditable open). `onInlineEditStart`
// /`onInlineEditEnd` keep this current while content captures queue granular
// ops without replacing the live DOM.
const activeInlineEditSlides = new Map<string, Set<string>>();

/** Mark `slideId` as mid inline-edit so a concurrent agent write to the same
 *  slide is not adopted over the user's uncommitted keystrokes. */
export function markSlideEditingActive(deckId: string, slideId: string) {
  const set = activeInlineEditSlides.get(deckId) ?? new Set<string>();
  set.add(slideId);
  activeInlineEditSlides.set(deckId, set);
}

/** Clear the mid-edit mark once inline editing ends (committed or discarded). */
export function clearSlideEditingActive(deckId: string, slideId: string) {
  const set = activeInlineEditSlides.get(deckId);
  if (!set) return;
  set.delete(slideId);
  if (set.size === 0) activeInlineEditSlides.delete(deckId);
}

// Cached snapshot for useSyncExternalStore. MUST be stable when either value
// is unchanged or React will infinite-loop (it compares snapshots with
// Object.is — a fresh object literal every call schedules a new update,
// which calls getSnapshot again, which returns a new object… etc).
let cachedSnapshot: { saving: boolean; hasUnsavedChanges: boolean } = {
  saving: false,
  hasUnsavedChanges: false,
};

function recomputeSnapshot() {
  const saving =
    pendingSaves.size > 0 || inFlightSaves.size > 0 || pendingOpsQueue.size > 0;
  const hasUnsavedChanges = saving || failedSaveDecks.size > 0;
  if (
    saving !== cachedSnapshot.saving ||
    hasUnsavedChanges !== cachedSnapshot.hasUnsavedChanges
  ) {
    cachedSnapshot = { saving, hasUnsavedChanges };
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

/**
 * True when a deck still has a local write that has not been confirmed by the
 * server, including a save that exhausted its retry budget.
 */
export function hasUnsavedDeckChanges(deckId: string): boolean {
  return (
    pendingSaves.has(deckId) ||
    inFlightSaves.has(deckId) ||
    pendingOpsQueue.has(deckId) ||
    failedSaveDecks.has(deckId)
  );
}

/** Snapshot of save state — true when anything is debounced or in flight. */
export function getSaveSnapshot(): {
  saving: boolean;
  hasUnsavedChanges: boolean;
} {
  return cachedSnapshot;
}

/**
 * `Deck` is an interface, so it has no implicit index signature and cannot be
 * passed straight to an action that takes an opaque JSON deck payload.
 */
function deckPayload(deck: Deck): Record<string, unknown> {
  return { ...deck };
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
 * the `save-deck` action is called first, then any trailing granular ops are
 * sent through `patch-deck`.
 */
async function sendKeepaliveAction(
  url: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-Frontend": "1",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    keepalive: true,
    signal,
  });
  if (!response.ok) {
    throw new Error(`Action request failed with status ${response.status}`);
  }
}

async function persistDeckOps(
  deckId: string,
  ops: GranularOp[],
  signal?: AbortSignal,
  options?: { keepalive?: boolean },
): Promise<unknown[]> {
  if (options?.keepalive) {
    const actionsBase = agentNativePath("/_agent-native/actions");
    if (ops[0].op === "full-replace") {
      const deck = ops[0].deck;
      await sendKeepaliveAction(
        `${actionsBase}/save-deck`,
        "PUT",
        { deckId, deck: deckPayload(deck) },
        signal,
      );
      const trailingOps = ops.slice(1) as PatchDeckOp[];
      if (trailingOps.length > 0) {
        await sendKeepaliveAction(
          `${actionsBase}/patch-deck`,
          "POST",
          { deckId, operations: trailingOps },
          signal,
        );
      }
    } else {
      await sendKeepaliveAction(
        `${actionsBase}/patch-deck`,
        "POST",
        { deckId, operations: ops as PatchDeckOp[] },
        signal,
      );
    }
    return [];
  }

  const results: unknown[] = [];
  if (ops[0].op === "full-replace") {
    // Legacy full-deck write — used by undo/redo and setDeckSlides.
    // `callAction` bounds it so a stalled save can't wedge `inFlightSaves`
    // forever (its `finally` cleanup below only runs once this await
    // settles; an AbortError from the timeout still reaches it).
    const deck = ops[0].deck;
    results.push(
      await callAction<unknown>(
        "save-deck",
        { deckId, deck: deckPayload(deck) },
        { method: "PUT", signal },
      ),
    );
    const trailingOps = ops.slice(1) as PatchDeckOp[];
    if (trailingOps.length > 0) {
      results.push(
        await callAction<unknown>(
          "patch-deck",
          {
            deckId,
            operations: trailingOps,
          },
          { signal },
        ),
      );
    }
  } else {
    results.push(
      await callAction<unknown>(
        "patch-deck",
        {
          deckId,
          operations: ops as PatchDeckOp[],
        },
        { signal },
      ),
    );
  }
  return results;
}

function layoutFitSlideIdsForOp(op: GranularOp): string[] {
  if (op.op === "add-slide") return [op.slideId];
  if (
    op.op === "patch-slide" &&
    (op.fields.content !== undefined ||
      op.fields.layout !== undefined ||
      op.fields.excalidrawData !== undefined)
  ) {
    return [op.slideId];
  }
  if (op.op === "full-replace") {
    return op.deck.slides.map((slide) => slide.id);
  }
  return [];
}

function layoutFitSlideIdsForDeckFields(
  deck: Deck | undefined,
  op: GranularOp,
): string[] {
  if (!deck || op.op !== "patch-deck-fields") return [];
  return deckFitRenderFieldsChanged(deck, { ...deck, ...op.fields })
    ? deck.slides.map((slide) => slide.id)
    : [];
}

function nextSlideWriteSequence(deckId: string, slideId: string): number {
  const sequences = slideLocalWriteSequences.get(deckId) ?? new Map();
  const next = (sequences.get(slideId) ?? 0) + 1;
  sequences.set(slideId, next);
  slideLocalWriteSequences.set(deckId, sequences);
  return next;
}

function currentSlideWriteSequence(
  deckId: string,
  slideId: string,
): number | undefined {
  return slideLocalWriteSequences.get(deckId)?.get(slideId);
}

type PersistedLayoutFitRevision = {
  slideId: string;
  contentHash: string;
  layoutFitRevision: string;
};

function persistedLayoutFitRevisions(
  results: readonly unknown[],
): Map<string, PersistedLayoutFitRevision> {
  const revisions = new Map<string, PersistedLayoutFitRevision>();
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const record = result as Record<string, unknown>;
    const layoutFit = record.layoutFit;
    if (layoutFit && typeof layoutFit === "object") {
      const fit = layoutFit as Record<string, unknown>;
      const entries = Array.isArray(fit.slides) ? fit.slides : [fit];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const value = entry as Record<string, unknown>;
        if (
          typeof value.slideId === "string" &&
          typeof value.contentHash === "string" &&
          typeof value.layoutFitRevision === "string"
        ) {
          revisions.set(value.slideId, {
            slideId: value.slideId,
            contentHash: value.contentHash,
            layoutFitRevision: value.layoutFitRevision,
          });
        }
      }
    }

    if (Array.isArray(record.slides)) {
      for (const slide of record.slides) {
        if (!slide || typeof slide !== "object") continue;
        const value = slide as Record<string, unknown>;
        if (
          typeof value.id === "string" &&
          typeof value.layoutFitRevision === "string"
        ) {
          revisions.set(value.id, {
            slideId: value.id,
            contentHash: hashSlideContent(
              typeof value.content === "string" ? value.content : "",
            ),
            layoutFitRevision: value.layoutFitRevision,
          });
        }
      }
    }
  }
  return revisions;
}

/**
 * Drain the current operation batch behind every earlier batch for this deck.
 * Slide content patches replace the full HTML field, so overlapping requests
 * could otherwise complete out of order and let a stale drag overwrite a
 * newer resize.
 */
function drainPendingDeckOps(
  deckId: string,
  options?: { keepalive?: boolean },
): Promise<void> {
  const timer = pendingSaves.get(deckId);
  if (timer) clearTimeout(timer);
  pendingSaves.delete(deckId);

  const active = inFlightSaveChains.get(deckId);
  if (active) {
    immediateFlushRequests.set(
      deckId,
      (immediateFlushRequests.get(deckId) ?? false) ||
        options?.keepalive === true,
    );
    notifySaveListeners();
    return active;
  }

  const ops = pendingOpsQueue.get(deckId) ?? [];
  pendingOpsQueue.delete(deckId);
  const persistedResultHandlers =
    pendingPersistedResultHandlers.get(deckId) ?? [];
  pendingPersistedResultHandlers.delete(deckId);
  if (ops.length === 0) {
    notifySaveListeners();
    return Promise.resolve();
  }

  const onSaveSuccess =
    ops[0]?.op === "full-replace" ? ops[0].onSaveSuccess : undefined;

  const generation = deckSaveGenerations.get(deckId) ?? 0;
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  if (controller) inFlightSaveControllers.set(deckId, controller);
  inFlightSaves.add(deckId);
  inFlightOpSlides.set(deckId, ops);
  const isCurrentGeneration = () =>
    (deckSaveGenerations.get(deckId) ?? 0) === generation;
  const next = persistDeckOps(deckId, ops, controller?.signal, options)
    .then((results) => {
      if (!isCurrentGeneration()) return;
      for (const { handler, slideWriteSequences } of persistedResultHandlers) {
        handler(results, slideWriteSequences);
      }
      onSaveSuccess?.(ops);
      deckSaveRetryAttempts.delete(deckId);
      failedSaveDecks.delete(deckId);
    })
    .catch((err) => {
      // A restore or delete invalidated this request. Its result must not
      // resurrect the old queue or schedule a retry after the boundary.
      if (!isCurrentGeneration()) return;
      console.error(`Failed to save deck ${deckId}:`, err);
      const pending = pendingOpsQueue.get(deckId) ?? [];
      // A queued full replacement already includes the latest local snapshot,
      // so retry it instead of sending an older replacement as a patch op.
      pendingOpsQueue.set(
        deckId,
        pending[0]?.op === "full-replace" ? pending : [...ops, ...pending],
      );
      const pendingHandlers = pendingPersistedResultHandlers.get(deckId) ?? [];
      const handlers =
        pending[0]?.op === "full-replace"
          ? pendingHandlers
          : [...persistedResultHandlers, ...pendingHandlers];
      if (handlers.length > 0) {
        pendingPersistedResultHandlers.set(deckId, handlers);
      } else {
        pendingPersistedResultHandlers.delete(deckId);
      }
      const attempt = (deckSaveRetryAttempts.get(deckId) ?? 0) + 1;
      deckSaveRetryAttempts.set(deckId, attempt);
      immediateFlushRequests.delete(deckId);
      const pendingTimer = pendingSaves.get(deckId);
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingSaves.delete(deckId);
      if (attempt <= MAX_DECK_SAVE_RETRIES) {
        const retryTimer = setTimeout(
          () => {
            void drainPendingDeckOps(deckId);
          },
          DECK_SAVE_RETRY_BASE_MS * 2 ** (attempt - 1),
        );
        pendingSaves.set(deckId, retryTimer);
      } else {
        failedSaveDecks.add(deckId);
      }
    })
    .finally(() => {
      if (inFlightSaveChains.get(deckId) === next) {
        inFlightSaveChains.delete(deckId);
        if (controller && inFlightSaveControllers.get(deckId) === controller) {
          inFlightSaveControllers.delete(deckId);
        }
        inFlightSaves.delete(deckId);
        inFlightOpSlides.delete(deckId);
        const requestedFlush = immediateFlushRequests.get(deckId);
        const flushImmediately = requestedFlush !== undefined;
        immediateFlushRequests.delete(deckId);
        notifySaveListeners();
        if (flushImmediately) {
          void drainPendingDeckOps(
            deckId,
            requestedFlush ? { keepalive: true } : undefined,
          );
        }
      }
    });
  inFlightSaveChains.set(deckId, next);
  notifySaveListeners();
  return next;
}

/**
 * Wait for a deck's in-flight save(s) to fully settle, including any
 * follow-up drain chained by immediateFlushRequests for ops queued while a
 * save was already running, and any requeued retry after a failed attempt.
 * Used when a caller must not proceed (e.g. firing an agent request against
 * a slide or restoring a saved version) until every write issued before that
 * boundary has reached the server. Throws if the save ultimately fails after
 * retries exhaust, since `drainPendingDeckOps` swallows save errors internally
 * to drive its own retry loop and its promise always resolves regardless of
 * outcome.
 */
async function flushDeckSave(deckId: string): Promise<void> {
  while (true) {
    const active = inFlightSaveChains.get(deckId);
    if (active) {
      await active;
      continue;
    }
    if (failedSaveDecks.has(deckId)) {
      throw new Error(
        `Failed to save deck ${deckId} after ${MAX_DECK_SAVE_RETRIES} attempts`,
      );
    }
    if (pendingOpsQueue.has(deckId) || pendingSaves.has(deckId)) {
      // A failed op was requeued for retry, or a debounced save is armed;
      // wait for it to actually run rather than declaring success early.
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    return;
  }
}

function enqueueDeckOp(
  deckId: string,
  op: GranularOp,
  options?: {
    persistence?: "debounced" | "immediate";
    coalesceContent?: boolean;
    onSaveSuccess?: (ops: GranularOp[]) => void;
    onPersisted?: PersistedResultHandler;
    layoutFitSlideIds?: readonly string[];
  },
) {
  deckLocalWriteSeq.set(deckId, (deckLocalWriteSeq.get(deckId) ?? 0) + 1);
  const slideWriteSequences = new Map<string, number>();
  const layoutFitSlideIds = new Set([
    ...layoutFitSlideIdsForOp(op),
    ...(options?.layoutFitSlideIds ?? []),
  ]);
  for (const slideId of layoutFitSlideIds) {
    slideWriteSequences.set(slideId, nextSlideWriteSequence(deckId, slideId));
  }
  const existing = pendingSaves.get(deckId);
  if (existing) clearTimeout(existing);
  if (
    (deckSaveRetryAttempts.get(deckId) ?? 0) > MAX_DECK_SAVE_RETRIES &&
    !inFlightSaveChains.has(deckId)
  ) {
    deckSaveRetryAttempts.delete(deckId);
    failedSaveDecks.delete(deckId);
  }

  if (op.op === "full-replace") {
    // A newer snapshot supersedes any retry budget from the older write.
    deckSaveRetryAttempts.delete(deckId);
    failedSaveDecks.delete(deckId);
    const queuedOp = options?.onSaveSuccess
      ? { ...op, onSaveSuccess: options.onSaveSuccess }
      : op;
    // Discard any accumulated granular ops — this is a wholesale replacement
    pendingOpsQueue.set(deckId, [queuedOp]);
    pendingPersistedResultHandlers.delete(deckId);
  } else {
    const queue = pendingOpsQueue.get(deckId) ?? [];
    const previous = queue[queue.length - 1];
    if (
      options?.coalesceContent &&
      previous?.op === "patch-slide" &&
      op.op === "patch-slide" &&
      previous.slideId === op.slideId &&
      Object.keys(previous.fields).length === 1 &&
      Object.keys(op.fields).length === 1 &&
      "content" in previous.fields &&
      "content" in op.fields
    ) {
      queue[queue.length - 1] = op;
    } else {
      queue.push(op);
    }
    pendingOpsQueue.set(deckId, queue);
  }

  if (options?.onPersisted && slideWriteSequences.size > 0) {
    const handlers = pendingPersistedResultHandlers.get(deckId) ?? [];
    handlers.push({
      handler: options.onPersisted,
      slideWriteSequences,
    });
    pendingPersistedResultHandlers.set(deckId, handlers);
  }

  if (options?.persistence === "immediate") {
    void drainPendingDeckOps(deckId);
  } else {
    const timer = setTimeout(() => {
      void drainPendingDeckOps(deckId);
    }, 500);
    pendingSaves.set(deckId, timer);
    notifySaveListeners();
  }
}

/**
 * @deprecated Use enqueueDeckOp for new callers. This legacy helper still
 * does a full-deck `save-deck` write and is kept only for the initial deck
 * creation path which already inserts via `add-deck` — it is NOT called for
 * edits any more.
 */
function saveDeckToAPI(
  deck: Deck,
  onSaveSuccess?: (ops: GranularOp[]) => void,
  onPersisted?: PersistedResultHandler,
) {
  enqueueDeckOp(
    deck.id,
    { op: "full-replace", deck },
    {
      onSaveSuccess,
      onPersisted,
    },
  );
}

/**
 * Flush every pending (debounced) deck op through the same per-deck queue used
 * by normal saves, using keepalive transport so in-flight edits survive a tab
 * close / navigation. Called from a `pagehide` / `visibilitychange(hidden)`
 * handler - without it there is a ~500ms window (the debounce) where the
 * user's most recent edits are only in memory and are lost on tab close.
 *
 * keepalive requests are best-effort and capped (~64KB by the browser), which
 * is fine: granular ops are small, and if a full-replace payload is too large
 * to send keepalive the normal debounce/poll path still catches up on reopen.
 */
export function flushPendingSaves() {
  for (const deckId of [...pendingSaves.keys()]) {
    void drainPendingDeckOps(deckId, { keepalive: true });
  }
}

function discardPendingDeckOps(deckId: string) {
  deckSaveGenerations.set(deckId, (deckSaveGenerations.get(deckId) ?? 0) + 1);
  inFlightSaveControllers.get(deckId)?.abort();
  const timer = pendingSaves.get(deckId);
  if (timer) clearTimeout(timer);
  pendingSaves.delete(deckId);
  pendingOpsQueue.delete(deckId);
  pendingPersistedResultHandlers.delete(deckId);
  deckSaveRetryAttempts.delete(deckId);
  failedSaveDecks.delete(deckId);
  immediateFlushRequests.delete(deckId);
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

/** Reorders the current slide list by stable IDs, or returns null for a no-op. */
export function reorderSlidesById(
  slides: Slide[],
  activeSlideId: string,
  overSlideId: string,
  selectedSlideIds?: readonly string[],
): Slide[] | null {
  const oldIndex = slides.findIndex((slide) => slide.id === activeSlideId);
  const newIndex = slides.findIndex((slide) => slide.id === overSlideId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null;

  const movingIds = new Set(
    selectedSlideIds?.includes(activeSlideId)
      ? selectedSlideIds
      : [activeSlideId],
  );
  if (movingIds.has(overSlideId)) return null;

  const moving = slides.filter((slide) => movingIds.has(slide.id));
  const remaining = slides.filter((slide) => !movingIds.has(slide.id));
  const targetIndex = remaining.findIndex((slide) => slide.id === overSlideId);
  if (moving.length === 0 || targetIndex === -1) return null;

  remaining.splice(targetIndex + (oldIndex < newIndex ? 1 : 0), 0, ...moving);
  const reordered = remaining;
  return reordered;
}

/**
 * Apply a single granular op to a deck's slides/fields, returning the updated
 * Deck. Unknown/no-op cases (slide already gone, etc.) return the deck
 * unchanged so undo entries that no longer apply fail soft instead of
 * corrupting state.
 */
export function applyOpToDeck(deck: Deck, op: PatchDeckOp): Deck {
  switch (op.op) {
    case "patch-slide": {
      const prior = deck.slides.find((s) => s.id === op.slideId);
      if (!prior || !hasChangedFields(prior, op.fields)) return deck;
      const slides = deck.slides.map((s) => {
        if (s.id !== op.slideId) return s;
        return { ...s, ...op.fields };
      });
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
      if (
        reordered.length === deck.slides.length &&
        reordered.every((slide, index) => slide.id === deck.slides[index]?.id)
      ) {
        return deck;
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
        ...op.fields,
        id: op.slideId,
        content: op.fields.content,
        notes: op.fields.notes ?? "",
        layout: (op.fields.layout as SlideLayout) ?? "content",
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
      if (!hasChangedFields(deck, op.fields)) return deck;
      return {
        ...deck,
        ...op.fields,
        updatedAt: new Date().toISOString(),
      } as Deck;
    }
  }
}

function equalDeckValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasChangedFields(current: object, fields: object): boolean {
  const currentRecord = current as Record<string, unknown>;
  const fieldRecord = fields as Record<string, unknown>;
  return Object.keys(fieldRecord).some(
    (key) => !equalDeckValue(currentRecord[key], fieldRecord[key]),
  );
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
        if (!equalDeckValue(prior[key], op.fields[key])) {
          let priorValue: unknown = prior[key];
          // Boolean fields are undefined on slides that never set them, but
          // `undefined` doesn't survive JSON transport to the server — its
          // `patch-slide` handler treats an absent field as "don't touch",
          // so the persisted deck would stay changed after undo. `false` is
          // equivalent for these boolean fields and does survive.
          if (
            (key === "skipped" || key === "layoutWarningDismissed") &&
            priorValue === undefined
          ) {
            priorValue = false;
          }
          (priorFields as Record<string, unknown>)[key] = priorValue;
        }
      }
      if (Object.keys(priorFields).length === 0) return null;
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
          fields: addSlideFields(prior),
        },
        {
          op: "reorder-slides",
          orderedIds: before.slides.map((s) => s.id),
        },
      ];
    }
    case "add-slide": {
      // Inverse of adding a slide is deleting it.
      if (before.slides.some((slide) => slide.id === op.slideId)) return null;
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
      if (applyOpToDeck(before, op) === before) return null;
      return [
        { op: "reorder-slides", orderedIds: before.slides.map((s) => s.id) },
      ];
    }
    case "patch-deck-fields": {
      const priorFields: Record<string, unknown> = {};
      const beforeRecord = before as unknown as Record<string, unknown>;
      const nextRecord = op.fields as Record<string, unknown>;
      for (const key of Object.keys(op.fields)) {
        if (!equalDeckValue(beforeRecord[key], nextRecord[key])) {
          priorFields[key] = beforeRecord[key];
        }
      }
      if (Object.keys(priorFields).length === 0) return null;
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
 * Fetch the deck metadata list. Returns `null` on any failure (network error, non-2xx
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
      { light: "true", includePreview: "true" },
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

const DECK_FETCH_RETRY_ATTEMPTS = 3;
const DECK_FETCH_RETRY_DELAY_MS = 400;

// `get-deck` returns a real 404/403 only when the deck is genuinely gone or
// the caller genuinely lacks access (see actions/get-deck.ts). A network blip
// or 5xx is transient and must not be coerced into the same "not found" null
// the caller uses to show the owner-facing "deck unavailable" pane — that
// flashed a wrong message on brief server hiccups even though the deck still
// existed.
function isConfirmedDeckAbsence(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 404 || status === 403;
}

// A timeout already made the caller wait the full action timeout window once
// (see DEFAULT_ACTION_TIMEOUT_MS in use-action.ts); retrying would multiply
// that wait instead of surfacing the failure — same reasoning as
// `isActionTimeout` in the shared action-query retry policy.
function isDeckFetchTimeout(err: unknown): boolean {
  return (err as { timedOut?: unknown } | null)?.timedOut === true;
}

async function fetchDeckFromAPI(id: string): Promise<Deck | null> {
  for (let attempt = 1; attempt <= DECK_FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await callAction<unknown>(
        "get-deck",
        { id },
        { method: "GET" },
      );
      return normalizeActionDeck(result);
    } catch (err) {
      if (
        isConfirmedDeckAbsence(err) ||
        isDeckFetchTimeout(err) ||
        attempt === DECK_FETCH_RETRY_ATTEMPTS
      ) {
        console.error(`Failed to fetch deck ${id}:`, err);
        return null;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, attempt * DECK_FETCH_RETRY_DELAY_MS),
      );
    }
  }
  return null;
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
  if (loaded === null) {
    if (!currentOpenDeckId) return null;
    const directDeck = await fetchDeckFromAPI(currentOpenDeckId);
    return directDeck ? [directDeck] : null;
  }
  if (!currentOpenDeckId) return loaded;

  // The list has only first-slide previews. Hydrate just the deck the user
  // opened so the editor gets full slide content without making the home page
  // download every deck body.
  const directDeck = await fetchDeckFromAPI(currentOpenDeckId);
  if (!directDeck) return loaded;
  const index = loaded.findIndex((deck) => deck.id === currentOpenDeckId);
  if (index < 0) return [...loaded, directDeck];
  const next = [...loaded];
  next[index] = directDeck;
  return next;
}

async function deleteDeckFromAPI(id: string): Promise<void> {
  try {
    await callAction("delete-deck", { id }, { method: "DELETE" });
  } catch (error) {
    // Deleting an optimistic deck is intentionally idempotent. A create can
    // fail after the server committed the row, or before it created one.
    if (
      !(
        error &&
        typeof error === "object" &&
        "status" in error &&
        (error as { status?: unknown }).status === 404
      )
    ) {
      throw error;
    }
  }
}

async function createDeckOnAPI(deck: Deck): Promise<void> {
  // `callAction` bounds the request so a stalled create response can't leave
  // the deck id in `pendingCreateIdsRef` forever (cleared only in the caller's
  // `.finally`, which needs this promise to settle). A wedged pending-create id
  // would otherwise suppress the open-deck refetch just like a wedged save.
  await callAction("add-deck", { deck: deckPayload(deck) });
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
  return dirtyDeckIds.has(deckId) || hasUnsavedDeckChanges(deckId);
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
export function mergeServerAddedSlides(
  local: Deck,
  server: Deck,
  options?: { shouldMergeServerOnlySlide?: (slide: Slide) => boolean },
): Deck {
  const shouldMergeServerOnlySlide =
    options?.shouldMergeServerOnlySlide ?? (() => true);
  const localIds = new Set(local.slides.map((s) => s.id));
  const additions = server.slides.filter(
    (s) => !localIds.has(s.id) && shouldMergeServerOnlySlide(s),
  );
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
    if (localSlide) {
      merged.push(localSlide);
    } else if (shouldMergeServerOnlySlide(s)) {
      merged.push(s);
    } else {
      continue;
    }
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

/** True when `op` is a deck-wide write (touches every slide) or targets
 *  `slideId` specifically. */
function opTargetsSlide(op: GranularOp, slideId: string): boolean {
  return (
    op.op === "full-replace" ||
    op.op === "reorder-slides" ||
    ("slideId" in op && op.slideId === slideId)
  );
}

/**
 * True when some queued-or-in-flight write for `deckId` could still touch
 * `slideId`, so adopting the server's copy of that slide would race a local
 * write instead of reflecting it. Checking the actual ops (queued or
 * in-flight) rather than a deck-wide "a save is running" flag matters: an
 * in-flight save for slide B must not block slide A's live update for the
 * whole request duration. The slide being mid inline-edit (typing not yet
 * committed to any op) also counts as a pending write.
 */
function hasPendingWriteForSlide(deckId: string, slideId: string): boolean {
  if (activeInlineEditSlides.get(deckId)?.has(slideId)) return true;
  const inFlightOps = inFlightOpSlides.get(deckId);
  if (inFlightOps?.some((op) => opTargetsSlide(op, slideId))) return true;
  const queue = pendingOpsQueue.get(deckId);
  if (!queue) return false;
  return queue.some((op) => opTargetsSlide(op, slideId));
}

/**
 * Slides that have a local write pending at this instant.
 *
 * Captured BEFORE an async deck read, because `hasPendingWriteForSlide` alone
 * only reports a write while it is still outstanding: a read issued before a
 * local save and resolved after it comes back holding the pre-save body with
 * nothing left marked pending, and adopting that would visibly revert the edit
 * the user just made. Holding back whatever was mid-write when the read
 * started closes that window — the next read starts clean and delivers the
 * server's copy.
 */
export function pendingWriteSlideIds(deck: Deck | undefined): Set<string> {
  const ids = new Set<string>();
  if (!deck) return ids;
  for (const slide of deck.slides) {
    if (hasPendingWriteForSlide(deck.id, slide.id)) ids.add(slide.id);
  }
  return ids;
}

function hasPendingDeleteForSlide(deckId: string, slideId: string): boolean {
  const inFlightOps = inFlightOpSlides.get(deckId);
  if (
    inFlightOps?.some(
      (op) => op.op === "delete-slide" && op.slideId === slideId,
    )
  ) {
    return true;
  }
  const queue = pendingOpsQueue.get(deckId);
  if (!queue) return false;
  return queue.some((op) => op.op === "delete-slide" && op.slideId === slideId);
}

/**
 * Same additive merge as `mergeServerAddedSlides`, but also adopts the
 * server's content for every slide that has no pending local write.
 *
 * This runs on EVERY reconcile — SSE event and fallback poll alike — and its
 * result depends only on current state, never on which slide a notification
 * happened to name. That is the property the previous version lacked: it
 * adopted exactly one `changedSlideId`, taken from the SSE payload, so an
 * agent edit went permanently unseen whenever the notification carried no
 * slide id (`patch-deck` touching more than one slide, or any structural op,
 * plus save-deck / apply-design-system / restore-deck-version / the imports)
 * or when that one slide happened to be busy at the instant the event landed
 * — sync events do not replay, and the poll never named a slide, so nothing
 * re-checked afterwards.
 *
 * Measured on production by chaining `update-slide`'s returned `contentHash`
 * to a later `get-deck` hash: of 160 successful writes read back with no
 * intervening agent write, 128 were still exactly what the write claimed and
 * ZERO had reverted. On the complaint turns themselves, 7 of 8 found the edit
 * already committed — 6s to 360s before the user said nothing had changed.
 * The writes were landing; this function was hiding them.
 */
export function mergeServerSlideUpdate(
  local: Deck,
  server: Deck,
  deckId: string,
  options?: {
    shouldMergeServerOnlySlide?: (slide: Slide) => boolean;
    /** Slides that were mid-write when `server` was requested — see
     *  `pendingWriteSlideIds`. Required for a snapshot read asynchronously. */
    pendingAtReadStart?: ReadonlySet<string>;
  },
): Deck {
  const merged = mergeServerAddedSlides(local, server, {
    shouldMergeServerOnlySlide: (slide) =>
      !hasPendingDeleteForSlide(deckId, slide.id) &&
      (options?.shouldMergeServerOnlySlide?.(slide) ?? true),
  });
  const serverById = new Map(server.slides.map((s) => [s.id, s]));
  let adopted = false;
  const nextSlides = merged.slides.map((slide) => {
    const serverSlide = serverById.get(slide.id);
    if (!serverSlide || equalDeckValue(slide, serverSlide)) return slide;
    // A slide the user is typing in, or that has a queued/in-flight/retrying
    // local write, keeps its local body — adopting the server's copy there
    // would revert an edit that has not landed yet. A slide that was mid-write
    // when this snapshot was REQUESTED keeps it too: the response predates the
    // write even though nothing is pending by the time it arrives.
    if (
      options?.pendingAtReadStart?.has(slide.id) ||
      hasPendingWriteForSlide(deckId, slide.id)
    ) {
      return slide;
    }
    adopted = true;
    return serverSlide;
  });
  return adopted ? { ...merged, slides: nextSlides } : merged;
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
  blank: `<div class="fmd-slide" style="padding: 80px 110px; position: relative; font-family: 'Poppins', sans-serif;"></div>`,
};

export function DeckProvider({ children }: { children: ReactNode }) {
  const { data: org, isLoading: orgLoading } = useOrg();
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
  const deletedSlideTombstonesRef = useRef<Map<string, Set<string>>>(new Map());
  const slideDeleteGenerationsRef = useRef<Map<string, Map<string, number>>>(
    new Map(),
  );
  const successfulReplacementTombstoneBoundariesRef = useRef<
    Map<
      string,
      Map<string, { generation: number; omitted: boolean; updatedAt: string }>
    >
  >(new Map());
  const serverSnapshotGenerationRef = useRef(0);
  const deckBaselineRequestIdRef = useRef(0);
  const deckListRequestIdRef = useRef(0);
  const openDeckRequestIdByDeckRef = useRef<Map<string, number>>(new Map());
  // True only while the SSE channel is actually open. Stays false when SSE is
  // never started (embed auth), so the poll keeps its fast intervals there.
  const liveChannelConnectedRef = useRef(false);
  // Lets the SSE effect wake the poll the moment the live channel drops.
  const pollNowRef = useRef<() => void>(() => {});
  // Bumped on every local deck create. A deck-list snapshot fetched before a
  // deck's bump cannot prove that deck is absent server-side, so any
  // reconciliation against such a snapshot must leave it alone. Keyed by id and
  // deliberately outliving `pendingCreateIdsRef`, which clears the moment the
  // create resolves — often before the older list response lands.
  const localCreateSeqRef = useRef(0);
  const localCreateSeqByIdRef = useRef<Map<string, number>>(new Map());
  const noteLocalCreate = useCallback((deckId: string) => {
    localCreateSeqRef.current += 1;
    localCreateSeqByIdRef.current.set(deckId, localCreateSeqRef.current);
  }, []);
  /** True when `deckId` is local state a snapshot taken at `seq` cannot refute. */
  const isNewerThanSnapshot = useCallback((deckId: string, seq: number) => {
    return (
      pendingCreateIdsRef.current.has(deckId) ||
      (localCreateSeqByIdRef.current.get(deckId) ?? 0) >= seq
    );
  }, []);

  const markSlideDeleteTombstone = useCallback(
    (deckId: string, slideId: string) => {
      const generations =
        slideDeleteGenerationsRef.current.get(deckId) ??
        new Map<string, number>();
      generations.set(slideId, (generations.get(slideId) ?? 0) + 1);
      slideDeleteGenerationsRef.current.set(deckId, generations);
      successfulReplacementTombstoneBoundariesRef.current
        .get(deckId)
        ?.delete(slideId);
      const tombstones =
        deletedSlideTombstonesRef.current.get(deckId) ?? new Set<string>();
      tombstones.add(slideId);
      deletedSlideTombstonesRef.current.set(deckId, tombstones);
    },
    [],
  );

  const markReplacedSlideOmissions = useCallback(
    (current: Deck | undefined, replacement: Deck) => {
      if (!current) return;
      const replacementIds = new Set(
        replacement.slides.map((slide) => slide.id),
      );
      for (const slide of current.slides) {
        if (!replacementIds.has(slide.id)) {
          markSlideDeleteTombstone(replacement.id, slide.id);
        }
      }
    },
    [markSlideDeleteTombstone],
  );

  const markDeckDirty = useCallback(
    (deckId: string) => {
      lastExternalUpdateRef.current = 0;
      dirtyDeckIdsRef.current.add(deckId);
      if (failedSaveDecks.has(deckId)) {
        for (const op of pendingOpsQueue.get(deckId) ?? []) {
          if (op.op === "delete-slide") {
            markSlideDeleteTombstone(deckId, op.slideId);
          }
        }
      }
    },
    [markSlideDeleteTombstone],
  );

  const clearSlideDeleteTombstone = useCallback(
    (deckId: string, slideId: string) => {
      const tombstones = deletedSlideTombstonesRef.current.get(deckId);
      if (tombstones) {
        tombstones.delete(slideId);
        if (tombstones.size === 0) {
          deletedSlideTombstonesRef.current.delete(deckId);
        }
      }
      successfulReplacementTombstoneBoundariesRef.current
        .get(deckId)
        ?.delete(slideId);
    },
    [],
  );

  const clearDeckDeleteTombstones = useCallback((deckId: string) => {
    deletedSlideTombstonesRef.current.delete(deckId);
    successfulReplacementTombstoneBoundariesRef.current.delete(deckId);
  }, []);

  const recordReplacedSlideDeleteTombstones = useCallback(
    (
      deckId: string,
      capturedTombstones: ReadonlyMap<string, number>,
      replacementUpdatedAt: string,
      replacementSlideIds: ReadonlySet<string>,
    ) => {
      const tombstones = deletedSlideTombstonesRef.current.get(deckId);
      if (!tombstones || capturedTombstones.size === 0) return;
      const generations = slideDeleteGenerationsRef.current.get(deckId);
      const boundary = ++serverSnapshotGenerationRef.current;
      const boundaries =
        successfulReplacementTombstoneBoundariesRef.current.get(deckId) ??
        new Map<
          string,
          { generation: number; omitted: boolean; updatedAt: string }
        >();
      for (const [slideId, generation] of capturedTombstones) {
        if (
          tombstones.has(slideId) &&
          generations?.get(slideId) === generation
        ) {
          boundaries.set(slideId, {
            generation: boundary,
            omitted: !replacementSlideIds.has(slideId),
            updatedAt: replacementUpdatedAt,
          });
        }
      }
      if (boundaries.size > 0) {
        successfulReplacementTombstoneBoundariesRef.current.set(
          deckId,
          boundaries,
        );
      }
    },
    [],
  );

  const captureReplacedSlideDeleteTombstones = useCallback(
    (deck: Deck) => {
      const tombstones = deletedSlideTombstonesRef.current.get(deck.id);
      const generations = slideDeleteGenerationsRef.current.get(deck.id);
      const capturedTombstones = new Map<string, number>();
      for (const slideId of tombstones ?? []) {
        const generation = generations?.get(slideId);
        if (generation !== undefined) {
          capturedTombstones.set(slideId, generation);
        }
      }
      return () =>
        recordReplacedSlideDeleteTombstones(
          deck.id,
          capturedTombstones,
          deck.updatedAt,
          new Set(deck.slides.map((slide) => slide.id)),
        );
    },
    [recordReplacedSlideDeleteTombstones],
  );

  const nextOpenDeckRequestId = useCallback((deckId: string) => {
    const requestId = (openDeckRequestIdByDeckRef.current.get(deckId) ?? 0) + 1;
    openDeckRequestIdByDeckRef.current.set(deckId, requestId);
    return requestId;
  }, []);

  const reconcileServerDeckWithDeleteTombstones = useCallback(
    (
      server: Deck,
      snapshotGeneration = serverSnapshotGenerationRef.current,
    ): Deck => {
      const tombstones = deletedSlideTombstonesRef.current.get(server.id);
      if (!tombstones?.size) return server;

      const serverSlideIds = new Set(server.slides.map((slide) => slide.id));
      const replacementBoundaries =
        successfulReplacementTombstoneBoundariesRef.current.get(server.id);
      const failedOps = failedSaveDecks.has(server.id)
        ? (pendingOpsQueue.get(server.id) ?? [])
        : [];
      const failedDeleteSlideIds = new Set(
        failedOps
          .filter((op) => op.op === "delete-slide")
          .map((op) => op.slideId),
      );
      const failedFullReplace = failedOps.find(
        (op): op is Extract<GranularOp, { op: "full-replace" }> =>
          op.op === "full-replace",
      );
      const failedFullReplaceSlideIds = failedFullReplace
        ? new Set(failedFullReplace.deck.slides.map((slide) => slide.id))
        : null;
      for (const slideId of tombstones) {
        const replacementBoundary = replacementBoundaries?.get(slideId);
        const replacementSnapshotIsCurrent =
          replacementBoundary &&
          replacementBoundary.generation <= snapshotGeneration &&
          (!replacementBoundary.omitted ||
            server.updatedAt > replacementBoundary.updatedAt);
        if (
          failedDeleteSlideIds.has(slideId) ||
          (failedFullReplaceSlideIds &&
            !failedFullReplaceSlideIds.has(slideId)) ||
          !serverSlideIds.has(slideId) ||
          replacementSnapshotIsCurrent
        ) {
          tombstones.delete(slideId);
          replacementBoundaries?.delete(slideId);
        }
      }
      if (tombstones.size === 0) {
        deletedSlideTombstonesRef.current.delete(server.id);
        successfulReplacementTombstoneBoundariesRef.current.delete(server.id);
        return server;
      }

      const slides = server.slides.filter((slide) => !tombstones.has(slide.id));
      return slides.length === server.slides.length
        ? server
        : { ...server, slides };
    },
    [],
  );

  const deleteDeckAfterPendingCreate = useCallback(
    (deckId: string, onFailure?: () => void) => {
      const pendingCreate = pendingCreatePromisesRef.current.get(deckId);
      const deletion = pendingCreate
        ? pendingCreate.then(
            () => deleteDeckFromAPI(deckId),
            () => deleteDeckFromAPI(deckId),
          )
        : deleteDeckFromAPI(deckId);
      void deletion.catch((err) => {
        console.error(`Failed to delete deck ${deckId}:`, err);
        onFailure?.();
      });
    },
    [],
  );

  // Plain local decks update. Undo entries are recorded explicitly by each
  // mutation via `recordUndo` (inverse ops), so this no longer snapshots the
  // whole decks array the way the old `setDecksWithHistory` did.
  const setDecksLocal = useCallback((updater: (prev: Deck[]) => Deck[]) => {
    setDecks(updater);
  }, []);

  const reconcilePersistedLayoutFit = useCallback(
    (
      deckId: string,
      results: readonly unknown[],
      slideWriteSequences: ReadonlyMap<string, number>,
    ) => {
      const revisions = persistedLayoutFitRevisions(results);
      if (revisions.size === 0) return;
      setDecks((prev) => {
        let changed = false;
        const next = prev.map((deck) => {
          if (deck.id !== deckId) return deck;
          let deckChanged = false;
          const slides = deck.slides.map((slide) => {
            const revision = revisions.get(slide.id);
            const expectedSequence = slideWriteSequences.get(slide.id);
            if (
              !revision ||
              expectedSequence === undefined ||
              currentSlideWriteSequence(deckId, slide.id) !== expectedSequence
            ) {
              return slide;
            }
            // The sequence guards A → B → A and layout-only writes. During an
            // inline edit, the DOM draft may not be in React state yet, so the
            // in-flight write is the safe exception to the hash check.
            if (
              revision.contentHash !== hashSlideContent(slide.content) &&
              !hasPendingWriteForSlide(deckId, slide.id)
            ) {
              return slide;
            }
            if (slide.layoutFitRevision === revision.layoutFitRevision) {
              return slide;
            }
            deckChanged = true;
            return {
              ...slide,
              layoutFitRevision: revision.layoutFitRevision,
            };
          });
          if (!deckChanged) return deck;
          changed = true;
          return { ...deck, slides };
        });
        if (changed) decksRef.current = next;
        return changed ? next : prev;
      });
    },
    [],
  );

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
            markReplacedSlideOmissions(
              decksRef.current.find((deck) => deck.id === op.deckId),
              op.deck,
            );
            enqueueDeckOp(
              op.deckId,
              { op: "full-replace", deck: op.deck },
              {
                onSaveSuccess: captureReplacedSlideDeleteTombstones(op.deck),
                onPersisted: (results, slideWriteSequences) =>
                  reconcilePersistedLayoutFit(
                    op.deckId,
                    results,
                    slideWriteSequences,
                  ),
              },
            );
          } else {
            const { deckId, ...granular } = op;
            if (granular.op === "delete-slide") {
              markSlideDeleteTombstone(deckId, granular.slideId);
            } else if (granular.op === "add-slide") {
              clearSlideDeleteTombstone(deckId, granular.slideId);
            }
            const currentDeck = decksRef.current.find(
              (deck) => deck.id === deckId,
            );
            enqueueDeckOp(deckId, granular, {
              layoutFitSlideIds: layoutFitSlideIdsForDeckFields(
                currentDeck,
                granular,
              ),
              onPersisted: (results, slideWriteSequences) =>
                reconcilePersistedLayoutFit(
                  deckId,
                  results,
                  slideWriteSequences,
                ),
            });
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

  const recordUndoBatch = useCallback(
    (before: Deck, redoOps: PatchDeckOp[], label: string) => {
      let state = before;
      const undoOps: PatchDeckOp[] = [];
      for (const redoOp of redoOps) {
        const inverseOps = deriveInverseOp(state, redoOp);
        if (!inverseOps) continue;
        undoOps.unshift(...inverseOps);
        state = applyOpToDeck(state, redoOp);
      }
      if (undoOps.length === 0) return;
      undoControllerRef.current?.push({
        undo: undoOps.map((op) => ({ deckId: before.id, ...op })),
        redo: redoOps.map((op) => ({ deckId: before.id, ...op })),
        label,
      });
    },
    [],
  );

  /**
   * Apply a remote deck snapshot (agent / collaborator via SSE or poll) and
   * record a replace-deck undo entry when content actually changed. Without
   * this, chat-driven edits land in the editor with Undo disabled.
   */
  const applyRemoteDeckUpdate = useCallback(
    (
      updated: Deck,
      label = "Agent edit",
      options?: { clearPendingWrites?: boolean },
    ) => {
      if (options?.clearPendingWrites) {
        discardPendingDeckOps(updated.id);
        dirtyDeckIdsRef.current.delete(updated.id);
        clearDeckDeleteTombstones(updated.id);
      }
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
    [
      captureReplacedSlideDeleteTombstones,
      clearDeckDeleteTombstones,
      reconcilePersistedLayoutFit,
    ],
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
    const requestId = ++deckListRequestIdRef.current;
    const createSeqAtRequest = localCreateSeqRef.current;
    const fresh = await fetchDeckListLightFromAPI();
    if (requestId !== deckListRequestIdRef.current) return;
    // A null result means the fetch failed (network error or non-2xx). Skip
    // the diff so we don't wipe local state on a transient failure.
    if (fresh === null) return;
    setLoadError(false);
    const currentDecks = decksRef.current;
    const currentIds = new Set(currentDecks.map((d) => d.id));
    const freshIds = new Set(fresh.map((d) => d.id));
    // Check if deck list changed (added or removed). Decks this client created
    // after the snapshot was taken are absent from the response because the
    // snapshot predates them, not because the server dropped them — treating
    // that as a removal is what wiped a just-created deck back to the "Create
    // your first deck" empty state.
    const addedIds = fresh
      .filter((d) => !currentIds.has(d.id))
      .map((d) => d.id);
    const removed = currentDecks.filter(
      (d) =>
        !freshIds.has(d.id) && !isNewerThanSnapshot(d.id, createSeqAtRequest),
    );
    for (const id of freshIds) localCreateSeqByIdRef.current.delete(id);
    if (addedIds.length === 0 && removed.length === 0) return;

    const addedDecks = (
      await Promise.all(addedIds.map((id) => fetchDeckFromAPI(id)))
    ).filter((d): d is Deck => d !== null);
    if (requestId !== deckListRequestIdRef.current) return;

    lastExternalUpdateRef.current = Date.now();
    const removedIds = new Set(removed.map((d) => d.id));
    setDecks((prev) => {
      const prevIds = new Set(prev.map((d) => d.id));
      // Drop only the decks this diff actually judged removed — a deck added to
      // `prev` after the snapshot was taken must survive.
      let next = prev.filter((d) => !removedIds.has(d.id));
      // Only add decks that aren't already in prev (prevents duplicates when
      // the closure's deck snapshot is stale compared to `prev`).
      for (const a of addedDecks) {
        if (!prevIds.has(a.id)) next = [...next, a];
      }
      return next;
    });
  }, [isNewerThanSnapshot]);

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
  //   - Dirty deck / unsaved local create → per-slide merge: surface
  //     agent-added slides and adopt server content for every slide with no
  //     pending local write, holding back only the slides actually being
  //     written. Removals and reorders still wait for the deck to go clean.
  //
  // The dirty branch protects local work per SLIDE, not per deck, because
  // "somewhere in this deck is unsaved" is not a reason to hide an agent's
  // edit to a different slide. Making it deck-wide is what produced the
  // "you said you changed it but nothing changed" reports.
  const refetchOpenDeckIfChanged = useCallback(
    async (
      currentOpenId: string,
      options?: { clearPendingWrites?: boolean },
    ): Promise<Deck | null> => {
      const snapshotGeneration = serverSnapshotGenerationRef.current;
      const requestId = nextOpenDeckRequestId(currentOpenId);
      // Captured before the read: a save that lands while this request is in
      // flight leaves nothing pending by the time the response arrives, and the
      // response still holds the pre-save body.
      const pendingAtReadStart = pendingWriteSlideIds(
        decksRef.current.find((d) => d.id === currentOpenId),
      );
      const writeSeqAtReadStart = deckLocalWriteSeq.get(currentOpenId) ?? 0;
      const fetchedServerDeck = await fetchDeckFromAPI(currentOpenId);
      if (openDeckRequestIdByDeckRef.current.get(currentOpenId) !== requestId) {
        return null;
      }
      // A local write started AFTER this read did, so the response predates it
      // and nothing is pending at either endpoint to reveal that. Drop this
      // snapshot rather than adopt it; the next reconcile starts after the
      // write and carries the truth. `pendingAtReadStart` covers the mirror
      // case — a write already outstanding when the read began.
      if (
        !options?.clearPendingWrites &&
        (deckLocalWriteSeq.get(currentOpenId) ?? 0) !== writeSeqAtReadStart
      ) {
        return null;
      }
      // Null means 404 (row not created yet), a transient failure, or a
      // still-pending create — nothing authoritative to reconcile.
      if (!fetchedServerDeck) return null;
      if (options?.clearPendingWrites) {
        clearDeckDeleteTombstones(currentOpenId);
      }
      const serverDeck = reconcileServerDeckWithDeleteTombstones(
        fetchedServerDeck,
        snapshotGeneration,
      );
      const clientDeck = decksRef.current.find((d) => d.id === currentOpenId);
      if (options?.clearPendingWrites) {
        lastExternalUpdateRef.current = Date.now();
        applyRemoteDeckUpdate(serverDeck, "Deck restored", {
          clearPendingWrites: true,
        });
        return serverDeck;
      }

      const hasLocalEdits =
        pendingCreateIdsRef.current.has(currentOpenId) ||
        hasUncommittedDeckChanges(currentOpenId, dirtyDeckIdsRef.current) ||
        (activeInlineEditSlides.get(currentOpenId)?.size ?? 0) > 0 ||
        // A write that landed mid-request leaves the deck looking clean; take
        // the per-slide merge so this older snapshot cannot adopt over it.
        pendingAtReadStart.size > 0;

      if (hasLocalEdits && clientDeck) {
        // Content-preserving: only ADD server slides missing locally.
        const merged = mergeServerSlideUpdate(
          clientDeck,
          serverDeck,
          currentOpenId,
          {
            pendingAtReadStart,
            shouldMergeServerOnlySlide: (slide) =>
              !deletedSlideTombstonesRef.current
                .get(currentOpenId)
                ?.has(slide.id),
          },
        );
        if (merged === clientDeck) return serverDeck; // nothing new to surface
        lastExternalUpdateRef.current = Date.now();
        setDecks((prev) => {
          const idx = prev.findIndex((d) => d.id === currentOpenId);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = merged;
          return next;
        });
        return serverDeck;
      }

      const changed =
        !clientDeck ||
        clientDeck.updatedAt !== serverDeck.updatedAt ||
        deckContentSignature(clientDeck) !== deckContentSignature(serverDeck);
      if (!changed) return serverDeck;
      lastExternalUpdateRef.current = Date.now();
      applyRemoteDeckUpdate(serverDeck);
      return serverDeck;
    },
    [
      applyRemoteDeckUpdate,
      clearDeckDeleteTombstones,
      nextOpenDeckRequestId,
      reconcileServerDeckWithDeleteTombstones,
    ],
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

  const resetDeckBaseline = useCallback(
    (
      nextDecks: Deck[],
      createSeqAtRequest: number,
      snapshotGeneration = serverSnapshotGenerationRef.current,
    ) => {
      // A baseline snapshot supersedes any in-flight light-list membership
      // diff before it replaces local state.
      ++deckListRequestIdRef.current;
      const reconciledDecks = nextDecks.map((deck) =>
        deck.previewSlide
          ? deck
          : reconcileServerDeckWithDeleteTombstones(deck, snapshotGeneration),
      );
      const nextIds = new Set(reconciledDecks.map((d) => d.id));
      setDecks((prev) => {
        // A wholesale replace still can't discard state the snapshot never saw:
        // a deck created here after the fetch started is missing from
        // `nextDecks` because the response predates it.
        const preserved = prev.filter(
          (d) =>
            !nextIds.has(d.id) && isNewerThanSnapshot(d.id, createSeqAtRequest),
        );
        return preserved.length === 0
          ? reconciledDecks
          : [...reconciledDecks, ...preserved];
      });
      for (const id of nextIds) localCreateSeqByIdRef.current.delete(id);
      // A baseline reset (initial mount, route change, or access reload) starts a
      // fresh undo timeline. Note: this is NOT the SSE/poll "remote update" path —
      // those call setDecks directly and intentionally leave the undo stack
      // intact so a collaborator's edit doesn't wipe your local undo history.
      undoControllerRef.current?.clear();
    },
    [isNewerThanSnapshot, reconcileServerDeckWithDeleteTombstones],
  );

  const reloadDecksWithStatus =
    useCallback(async (): Promise<DeckReloadStatus> => {
      const requestId = ++deckBaselineRequestIdRef.current;
      const createSeqAtRequest = localCreateSeqRef.current;
      const snapshotGeneration = serverSnapshotGenerationRef.current;
      const requestedOpenDeckId = currentOpenDeckIdFromWindow();
      const openDeckRequestId = requestedOpenDeckId
        ? nextOpenDeckRequestId(requestedOpenDeckId)
        : null;
      setLoading(true);
      const loaded = await fetchDecksForCurrentRoute();
      if (
        requestId !== deckBaselineRequestIdRef.current ||
        requestedOpenDeckId !== currentOpenDeckIdFromWindow() ||
        (requestedOpenDeckId !== null &&
          openDeckRequestId !==
            openDeckRequestIdByDeckRef.current.get(requestedOpenDeckId))
      ) {
        setLoading(false);
        return "stale";
      }
      if (loaded === null) {
        setLoadError(true);
        setLoading(false);
        return "failed";
      }
      lastExternalUpdateRef.current = Date.now();
      resetDeckBaseline(loaded, createSeqAtRequest, snapshotGeneration);
      setLoadError(false);
      setLoading(false);
      return "loaded";
    }, [nextOpenDeckRequestId, resetDeckBaseline]);

  const reloadDecks = useCallback(async () => {
    await reloadDecksWithStatus();
  }, [reloadDecksWithStatus]);

  // Load decks from API on mount
  useEffect(() => {
    // The deck query is scoped by the active organization on the server. Do
    // not turn the pre-scope empty response into the app's authoritative empty
    // state while the org query is still hydrating.
    if (orgLoading) return;
    const requestId = ++deckBaselineRequestIdRef.current;
    const createSeqAtRequest = localCreateSeqRef.current;
    const snapshotGeneration = serverSnapshotGenerationRef.current;
    const requestedOpenDeckId = currentOpenDeckIdFromWindow();
    const openDeckRequestId = requestedOpenDeckId
      ? nextOpenDeckRequestId(requestedOpenDeckId)
      : null;
    void fetchDecksForCurrentRoute().then(async (loaded) => {
      if (
        requestId !== deckBaselineRequestIdRef.current ||
        requestedOpenDeckId !== currentOpenDeckIdFromWindow() ||
        (requestedOpenDeckId !== null &&
          openDeckRequestId !==
            openDeckRequestIdByDeckRef.current.get(requestedOpenDeckId))
      ) {
        setLoading(false);
        return;
      }
      // Initial fetch failed — start empty so the UI can render. The fallback
      // poll will retry shortly; until then `decks` stays empty without
      // triggering the save effect (lastExternalUpdateRef is bumped).
      const initial = loaded ?? [];
      lastExternalUpdateRef.current = Date.now(); // Don't save initial load back
      resetDeckBaseline(initial, createSeqAtRequest, snapshotGeneration);
      setLoadError(loaded === null);
      setLoading(false);
    });
  }, [nextOpenDeckRequestId, orgLoading, resetDeckBaseline]);

  // Switching orgs re-scopes list-decks server-side but leaves this context's
  // in-memory list untouched, so the previous org's decks linger. Reload when
  // the org id actually changes; skip the first observed id so we don't double
  // up on the mount fetch above.
  const lastOrgIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading) return;
    const orgId = org?.orgId ?? null;
    if (lastOrgIdRef.current === undefined) {
      lastOrgIdRef.current = orgId;
      return;
    }
    if (lastOrgIdRef.current === orgId) return;
    lastOrgIdRef.current = orgId;
    void reloadDecks();
  }, [org?.orgId, orgLoading, reloadDecks]);

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
      timer = setTimeout(
        poll,
        fallbackPollIntervalMs({
          liveChannelConnected: liveChannelConnectedRef.current,
          hasOpenDeck: Boolean(readOpenDeckId()),
        }),
      );
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
    pollNowRef.current = pollNow;
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (pollNowRef.current === pollNow) pollNowRef.current = () => {};
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
      if (
        !pendingOpsQueue.has(id) &&
        !pendingSaves.has(id) &&
        !inFlightSaves.has(id)
      ) {
        const deck = decks.find((d) => d.id === id);
        if (!deck) continue;
        markReplacedSlideOmissions(
          decksRef.current.find((d) => d.id === id),
          deck,
        );
        saveDeckToAPI(
          deck,
          captureReplacedSlideDeleteTombstones(deck),
          (results, slideWriteSequences) =>
            reconcilePersistedLayoutFit(id, results, slideWriteSequences),
        );
      }
    }
  }, [
    captureReplacedSlideDeleteTombstones,
    decks,
    loading,
    markReplacedSlideOmissions,
    reconcilePersistedLayoutFit,
  ]);

  // Listen for deck changes through the shared framework sync transport. A
  // separate deck EventSource used to consume another long-lived browser
  // connection per tab on top of the framework stream and Vite HMR, which
  // exhausts the six-connection HTTP/1.1 budget quickly in local workspaces.
  // The transport owns reconnects; a reconnect still triggers a full resync
  // because sync events do not replay the deck row contents.
  useEffect(() => {
    if (isEmbedAuthActive()) return;
    let stopped = false;
    let hasConnectedOnce = false;

    const unsubscribe = subscribeSyncEvents({
      onEvents: (events) => {
        for (const data of events) {
          if (
            (data.source !== "deck" && data.source !== undefined) ||
            typeof data.deckId !== "string"
          ) {
            continue;
          }
          if (data.type === "deck-deleted") {
            lastExternalUpdateRef.current = Date.now();
            setDecks((prev) => prev.filter((d) => d.id !== data.deckId));
          } else if (data.type === "deck-changed") {
            // Do not drop the event while a local edit/save is pending. The
            // event may be an own-write echo, but it may also be an agent
            // write that arrived during the same local edit. The reconciler
            // preserves local slide bodies and local-only slides while still
            // surfacing server-added slides immediately. It reads the deck
            // itself rather than trusting `data.slideId`, so an event that
            // names no slide still delivers the edit.
            const refetchPromise = refetchOpenDeckIfChanged(data.deckId);
            void refetchPromise.catch((error) => {
              console.error(
                `Failed to refresh deck ${typeof data.deckId === "string" ? data.deckId : (JSON.stringify(data.deckId) ?? "unknown")} after sync event:`,
                error,
              );
            });
          }
        }
      },
      onSseStateChange: (connected) => {
        if (stopped) return;
        const wasConnected = liveChannelConnectedRef.current;
        liveChannelConnectedRef.current = connected;
        if (connected) {
          if (hasConnectedOnce) void resyncDeckState();
          hasConnectedOnce = true;
        } else if (wasConnected) {
          // The shared transport will reconnect independently. Keep the deck
          // fallback poll fast while the stream is unavailable.
          pollNowRef.current();
        }
      },
    });

    return () => {
      stopped = true;
      liveChannelConnectedRef.current = false;
      unsubscribe();
    };
  }, [refetchOpenDeckIfChanged, resyncDeckState]);

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
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        if (isTyping) return;
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && key === "y") {
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
        title: title?.trim() || DEFAULT_DECK_TITLE,
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
      noteLocalCreate(newDeck.id);
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
    [noteLocalCreate, setDecksLocal],
  );

  const ensureDeckPersisted = useCallback(
    async (id: string): Promise<DeckPersistenceResult> => {
      const pendingCreate = pendingCreatePromisesRef.current.get(id);
      if (pendingCreate) {
        try {
          await pendingCreate;
          return { persisted: true };
        } catch (error) {
          return { persisted: false, reason: "request-failed", error };
        }
      }

      return probeDeckPersisted(id);
    },
    [],
  );

  const duplicateDeck = useCallback(
    async (
      sourceDeckId: string,
      newId: string,
      title?: string,
      onFailure?: () => void,
    ): Promise<Deck | null> => {
      if (pendingDuplicateSourceIdsRef.current.has(sourceDeckId)) return null;
      pendingDuplicateSourceIdsRef.current.add(sourceDeckId);
      let source = decks.find((d) => d.id === sourceDeckId);
      if (!source) {
        pendingDuplicateSourceIdsRef.current.delete(sourceDeckId);
        return null;
      }
      if (source.slides.length === 0 && source.previewSlide) {
        const hydrated = await fetchDeckFromAPI(sourceDeckId);
        if (!hydrated) {
          pendingDuplicateSourceIdsRef.current.delete(sourceDeckId);
          return null;
        }
        source = hydrated;
      }

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
      delete optimistic.previewSlide;
      const sourceSlides = getDuplicateSourceSlides(source);
      const copiedSlides = sourceSlides.map((s) => ({
        ...s,
        id: `slide-${nanoid(8)}`,
      }));
      Object.assign(
        optimistic,
        repairDeckSlideReferences(
          { ...optimistic, slides: copiedSlides },
          copiedSlides,
          sourceSlides.map((slide) => slide.id),
        ),
      );
      const sourceImport = (optimistic as Deck & { sourceImport?: unknown })
        .sourceImport;
      if (
        sourceImport &&
        typeof sourceImport === "object" &&
        !Array.isArray(sourceImport)
      ) {
        (optimistic as Deck & { sourceImport?: unknown }).sourceImport = {
          ...sourceImport,
          editableSnapshot: true,
        };
      }

      // Track as pending so the poll doesn't wipe the optimistic deck before
      // the duplicate-deck action's INSERT lands.
      pendingCreateIdsRef.current.add(newId);
      noteLocalCreate(newId);

      // Fire the action in the background. On error, roll back.
      const duplicatePromise = callAction<DuplicateDeckActionResult>(
        "duplicate-deck",
        {
          deckId: sourceDeckId,
          newId,
          title,
          // Preview-only sources were hydrated above. An empty array is not
          // a valid optimistic slide-id projection, so omit it for empty
          // decks and let the server generate ids for any uncovered slides.
          ...(optimistic.slides.length > 0
            ? { slideIds: optimistic.slides.map((s) => s.id) }
            : {}),
        },
      ).then(() => undefined);
      pendingCreatePromisesRef.current.set(newId, duplicatePromise);
      duplicatePromise
        .catch(async (err) => {
          // A rejected request is not proof the row is missing: a timeout or
          // dropped response can land after the server committed the insert.
          // Discarding the copy then would delete work that actually exists
          // and tell the user it failed, so confirm against the server first.
          const probe = await probeDeckPersisted(newId);
          if (probe.persisted) {
            console.warn(
              `Duplicate request for ${newId} failed but the deck persisted:`,
              err,
            );
            return;
          }
          console.error("Duplicate failed:", err);
          // Roll back: drop the optimistic deck from local state. The caller
          // (via onFailure) is responsible for navigating away if the user
          // is still sitting on this now-gone deck's route — otherwise
          // they're stranded on a "Deck unavailable" screen with no way back.
          setDecks((prev) => prev.filter((d) => d.id !== newId));
          onFailure?.();
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
    [decks, noteLocalCreate, setDecksLocal],
  );

  const deleteDeck = useCallback(
    (id: string) => {
      const beforeDeck = decksRef.current.find((deck) => deck.id === id);
      const beforeIndex = decksRef.current.findIndex((deck) => deck.id === id);
      discardPendingDeckOps(id);
      deleteDeckAfterPendingCreate(id, () => {
        if (!beforeDeck) return;
        setDecks((prev) => {
          if (prev.some((deck) => deck.id === id)) return prev;
          const next = [...prev];
          next.splice(
            Math.max(0, Math.min(beforeIndex, next.length)),
            0,
            beforeDeck,
          );
          return next;
        });
      });
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
      const before = decksRef.current.find((d) => d.id === id);
      const optimisticDeckFitChange = before
        ? deckFitRenderFieldsChanged(before, { ...before, ...updates })
        : false;
      // Enqueue a granular patch-deck-fields op — only the changed fields are
      // sent to the server, so concurrent edits to slides are never clobbered.
      // Exclude internal/derived fields that live only in client state.
      const { slides: _slides, ...persistableUpdates } = updates;
      const hasPersistableUpdates = Object.keys(persistableUpdates).length > 0;
      const op: PatchDeckOp | null = hasPersistableUpdates
        ? {
            op: "patch-deck-fields",
            fields: persistableUpdates as PatchDeckFields,
          }
        : null;
      if (before && op && !deriveInverseOp(before, op)) return;

      // Clear the external-update suppression window so a rename/update that
      // happens within 2s of page load (or an SSE event) is not silently dropped.
      markDeckDirty(id);
      setDecks((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                ...updates,
                ...(optimisticDeckFitChange
                  ? {
                      slides: d.slides.map((slide) => ({
                        ...slide,
                        layoutFitRevision: createLayoutFitRevision(),
                      })),
                    }
                  : {}),
                updatedAt: new Date().toISOString(),
              }
            : d,
        ),
      );
      if (op) {
        enqueueDeckOp(id, op, {
          layoutFitSlideIds: layoutFitSlideIdsForDeckFields(before, op),
          onPersisted: (results, slideWriteSequences) =>
            reconcilePersistedLayoutFit(id, results, slideWriteSequences),
        });
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
    [markDeckDirty, recordUndo, reconcilePersistedLayoutFit],
  );

  const getDeck = useCallback(
    (id: string) => decks.find((d) => d.id === id),
    [decks],
  );

  const addSlide = useCallback(
    (
      deckId: string,
      layout: SlideLayout = "content",
      afterIndex?: number,
      addOptions?: { persistence?: "debounced" | "immediate" },
    ) => {
      markDeckDirty(deckId);
      const newSlide: Slide = {
        id: nanoid(8),
        content: normalizeSlidePadding(defaultSlideContent[layout]),
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
        fields: addSlideFields(newSlide),
      };
      enqueueDeckOp(deckId, op, {
        ...addOptions,
        onPersisted: (results, slideWriteSequences) =>
          reconcilePersistedLayoutFit(deckId, results, slideWriteSequences),
      });
      if (before) recordUndo(before, op, { label: "Add slide" });

      return newSlide.id;
    },
    [markDeckDirty, reconcilePersistedLayoutFit, recordUndo, setDecksLocal],
  );

  const updateSlide = useCallback(
    (
      deckId: string,
      slideId: string,
      updates: Partial<Omit<Slide, "id">>,
      options?: UpdateSlideOptions,
    ) => {
      const normalizedUpdates =
        typeof updates.content === "string"
          ? { ...updates, content: normalizeSlidePadding(updates.content) }
          : updates;
      const label = updates.layout
        ? "Change layout"
        : updates.background
          ? "Change background"
          : updates.content
            ? "Update content"
            : "Edit slide";
      const before = decksRef.current.find((d) => d.id === deckId);
      const previousSlide = before?.slides.find(
        (slide) => slide.id === slideId,
      );
      const optimisticSlideFitChange =
        !options?.preserveLocalState &&
        !options?.recordUndoOnly &&
        previousSlide &&
        slideFitRenderFieldsChanged(previousSlide, {
          ...previousSlide,
          ...normalizedUpdates,
        });
      const localUpdates = optimisticSlideFitChange
        ? { ...normalizedUpdates, layoutFitRevision: createLayoutFitRevision() }
        : normalizedUpdates;
      const op: PatchDeckOp = {
        op: "patch-slide",
        slideId,
        fields: normalizedUpdates,
      };
      if (
        before &&
        !deriveInverseOp(before, op) &&
        !options?.preserveLocalState
      ) {
        return;
      }
      if (options?.recordUndoOnly) {
        if (before) {
          setDecksLocal((prev: Deck[]) =>
            prev.map((d) => {
              if (d.id !== deckId) return d;
              return {
                ...d,
                slides: d.slides.map((s) =>
                  s.id === slideId ? { ...s, ...localUpdates } : s,
                ),
                updatedAt: new Date().toISOString(),
              };
            }),
          );
          recordUndo(before, op, {
            label,
            coalesceKey: `${deckId}:${slideId}:${Object.keys(updates)
              .sort()
              .join(",")}`,
          });
        }
        return;
      }
      markDeckDirty(deckId);
      if (!options?.preserveLocalState) {
        setDecksLocal((prev: Deck[]) =>
          prev.map((d) => {
            if (d.id !== deckId) return d;
            return {
              ...d,
              slides: d.slides.map((s) =>
                s.id === slideId ? { ...s, ...localUpdates } : s,
              ),
              updatedAt: new Date().toISOString(),
            };
          }),
        );
      }
      // Granular op — only this slide's changed fields reach the server.
      enqueueDeckOp(deckId, op, {
        persistence: options?.persistence,
        coalesceContent: options?.preserveLocalState,
        onPersisted: (results, slideWriteSequences) =>
          reconcilePersistedLayoutFit(deckId, results, slideWriteSequences),
      });
      if (before && !options?.preserveLocalState) {
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
    [markDeckDirty, recordUndo, reconcilePersistedLayoutFit, setDecksLocal],
  );

  const updateSlides = useCallback(
    (
      deckId: string,
      slideUpdates: {
        slideId: string;
        updates: Partial<Omit<Slide, "id">>;
      }[],
    ) => {
      const before = decksRef.current.find((d) => d.id === deckId);
      if (!before) return;
      const validUpdates = slideUpdates.filter(({ slideId }) =>
        before.slides.some((slide) => slide.id === slideId),
      );
      if (validUpdates.length === 0) return;
      const ops: PatchDeckOp[] = validUpdates.map(({ slideId, updates }) => ({
        op: "patch-slide",
        slideId,
        fields: updates,
      }));
      const applyUpdates = (d: Deck) => {
        if (d.id !== deckId) return d;
        return {
          ...d,
          slides: d.slides.map((slide) => {
            const update = validUpdates.find(
              ({ slideId }) => slideId === slide.id,
            );
            return update ? { ...slide, ...update.updates } : slide;
          }),
          updatedAt: new Date().toISOString(),
        };
      };
      markDeckDirty(deckId);
      decksRef.current = decksRef.current.map(applyUpdates);
      setDecksLocal((prev) => prev.map(applyUpdates));
      for (const op of ops) enqueueDeckOp(deckId, op);
      recordUndoBatch(before, ops, "Update slides");
    },
    [markDeckDirty, recordUndoBatch, setDecksLocal],
  );

  const deleteSlide = useCallback(
    (deckId: string, slideId: string) => {
      markDeckDirty(deckId);
      const before = decksRef.current.find((d) => d.id === deckId);
      if (before?.slides.some((slide) => slide.id === slideId)) {
        markSlideDeleteTombstone(deckId, slideId);
      }
      const removeSlide = (d: Deck) => {
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
      };
      // Keep same-event bulk deletes' undo snapshots anchored to the result of
      // the previous delete, before React applies the queued state updater.
      decksRef.current = decksRef.current.map(removeSlide);
      setDecksLocal((prev) => prev.map(removeSlide));
      // Granular op — server deletes only this slide from the blob.
      const op: PatchDeckOp = { op: "delete-slide", slideId };
      enqueueDeckOp(deckId, op);
      // Inverse re-adds the full prior slide at its old position, so undo
      // restores content/notes/layout/background exactly. (This is the case
      // behind the "Undo delete" toast in DeckEditor.)
      if (before) recordUndo(before, op, { label: "Delete slide" });
    },
    [markDeckDirty, markSlideDeleteTombstone, recordUndo, setDecksLocal],
  );

  const deleteSlides = useCallback(
    (deckId: string, slideIds: string[]) => {
      const before = decksRef.current.find((d) => d.id === deckId);
      if (!before) return;
      const ids = new Set(slideIds);
      const slides = before.slides.filter((slide) => ids.has(slide.id));
      if (slides.length === 0) return;
      const deletedIds = new Set(slides.map((slide) => slide.id));
      const ops: PatchDeckOp[] = slides.map((slide) => ({
        op: "delete-slide",
        slideId: slide.id,
      }));
      markDeckDirty(deckId);
      for (const slide of slides) {
        markSlideDeleteTombstone(deckId, slide.id);
      }
      const removeSlides = (d: Deck) => {
        if (d.id !== deckId) return d;
        const remaining = d.slides.filter((slide) => !deletedIds.has(slide.id));
        if (remaining.length === 0) {
          remaining.push({
            id: nanoid(8),
            content: defaultSlideContent.blank,
            notes: "",
            layout: "blank",
          });
        }
        return { ...d, slides: remaining, updatedAt: new Date().toISOString() };
      };
      decksRef.current = decksRef.current.map(removeSlides);
      setDecksLocal((prev) => prev.map(removeSlides));
      for (const op of ops) enqueueDeckOp(deckId, op);
      recordUndoBatch(before, ops, "Delete slides");
    },
    [markDeckDirty, markSlideDeleteTombstone, recordUndoBatch, setDecksLocal],
  );

  const duplicateSlide = useCallback(
    (deckId: string, slideId: string) => {
      const before = decksRef.current.find((d) => d.id === deckId);
      const original = before?.slides.find((slide) => slide.id === slideId);
      if (!before || !original) return undefined;

      markDeckDirty(deckId);
      const copiedSlide: Slide = {
        ...original,
        id: nanoid(8),
        content: normalizeSlidePadding(original.content),
      };
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const idx = d.slides.findIndex((s) => s.id === slideId);
          if (idx === -1) return d;
          const slides = [...d.slides];
          slides.splice(idx + 1, 0, copiedSlide);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
      // Granular add-slide op — inserts the copy after the original. Build it
      // from the current deck before scheduling the React state update; the
      // functional updater runs later and cannot be used to produce the op.
      const op: PatchDeckOp = {
        op: "add-slide",
        slideId: copiedSlide.id,
        afterSlideId: slideId,
        fields: addSlideFields(copiedSlide),
      };
      enqueueDeckOp(deckId, op, {
        onPersisted: (results, slideWriteSequences) =>
          reconcilePersistedLayoutFit(deckId, results, slideWriteSequences),
      });
      recordUndo(before, op, { label: "Duplicate slide" });
      return copiedSlide.id;
    },
    [markDeckDirty, reconcilePersistedLayoutFit, recordUndo, setDecksLocal],
  );

  const pasteSlide = useCallback(
    (deckId: string, afterSlideId: string, slideFields: Omit<Slide, "id">) => {
      const before = decksRef.current.find((d) => d.id === deckId);
      if (!before) return undefined;

      markDeckDirty(deckId);
      const newSlide: Slide = {
        ...slideFields,
        id: nanoid(8),
        content: normalizeSlidePadding(slideFields.content),
      };
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const idx = d.slides.findIndex((s) => s.id === afterSlideId);
          const insertAt = idx === -1 ? d.slides.length : idx + 1;
          const slides = [...d.slides];
          slides.splice(insertAt, 0, newSlide);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
      // Granular add-slide op, same as duplicateSlide — inserts after
      // afterSlideId regardless of whether that id is also the copy source.
      const op: PatchDeckOp = {
        op: "add-slide",
        slideId: newSlide.id,
        afterSlideId,
        fields: addSlideFields(newSlide),
      };
      enqueueDeckOp(deckId, op, {
        onPersisted: (results, slideWriteSequences) =>
          reconcilePersistedLayoutFit(deckId, results, slideWriteSequences),
      });
      recordUndo(before, op, { label: "Paste slide" });
      return newSlide.id;
    },
    [markDeckDirty, reconcilePersistedLayoutFit, recordUndo, setDecksLocal],
  );

  const pasteSlides = useCallback(
    (
      deckId: string,
      afterSlideId: string,
      slideFields: Omit<Slide, "id">[],
      options?: { beforeSlideId?: string },
    ) => {
      const before = decksRef.current.find((d) => d.id === deckId);
      if (!before || slideFields.length === 0) return [];

      markDeckDirty(deckId);
      const beforeIndex = options?.beforeSlideId
        ? before.slides.findIndex((slide) => slide.id === options.beforeSlideId)
        : -1;
      const afterIndex = before.slides.findIndex(
        (slide) => slide.id === afterSlideId,
      );
      const insertAt =
        beforeIndex !== -1
          ? beforeIndex
          : afterIndex === -1
            ? before.slides.length
            : afterIndex + 1;
      let insertAfter = before.slides[insertAt - 1]?.id;
      const newSlides: Slide[] = [];
      const ops: PatchDeckOp[] = [];
      for (const fields of slideFields) {
        const newSlide: Slide = { ...fields, id: nanoid(8) };
        newSlides.push(newSlide);
        ops.push({
          op: "add-slide",
          slideId: newSlide.id,
          afterSlideId: insertAfter,
          fields: addSlideFields(newSlide),
        });
        insertAfter = newSlide.id;
      }
      if (insertAt === 0) {
        ops.push({
          op: "reorder-slides",
          orderedIds: [
            ...newSlides.map((slide) => slide.id),
            ...before.slides.map((slide) => slide.id),
          ],
        });
      }
      const addSlides = (d: Deck) => {
        if (d.id !== deckId) return d;
        const slides = [...d.slides];
        slides.splice(insertAt, 0, ...newSlides);
        return { ...d, slides, updatedAt: new Date().toISOString() };
      };
      decksRef.current = decksRef.current.map(addSlides);
      setDecksLocal((prev) => prev.map(addSlides));
      for (const op of ops) enqueueDeckOp(deckId, op);
      recordUndoBatch(before, ops, "Paste slides");
      return newSlides.map((slide) => slide.id);
    },
    [markDeckDirty, recordUndoBatch, setDecksLocal],
  );

  const reorderSlides = useCallback(
    (
      deckId: string,
      activeSlideId: string,
      overSlideId: string,
      selectedSlideIds?: string[],
    ) => {
      const before = decksRef.current.find((d) => d.id === deckId);
      if (!before) return;

      const currentSlides = before.slides.filter(
        (slide) => !hasPendingDeleteForSlide(deckId, slide.id),
      );
      const orderedSlides = reorderSlidesById(
        currentSlides,
        activeSlideId,
        overSlideId,
        selectedSlideIds,
      );
      if (!orderedSlides) return;
      const orderedIds = orderedSlides.map((slide) => slide.id);
      const updatedAt = new Date().toISOString();

      markDeckDirty(deckId);
      decksRef.current = decksRef.current.map((d) =>
        d.id === deckId ? { ...d, slides: orderedSlides, updatedAt } : d,
      );
      setDecksLocal((prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const slides = reorderSlidesById(
            d.slides.filter(
              (slide) => !hasPendingDeleteForSlide(deckId, slide.id),
            ),
            activeSlideId,
            overSlideId,
            selectedSlideIds,
          );
          return slides ? { ...d, slides, updatedAt } : d;
        }),
      );

      // Granular op — server reorders by slide ID rather than by index,
      // so concurrent adds from other writers don't get dropped.
      const op: PatchDeckOp = { op: "reorder-slides", orderedIds };
      enqueueDeckOp(deckId, op);
      recordUndo(before, op, { label: "Reorder slides" });
    },
    [markDeckDirty, recordUndo, setDecksLocal],
  );

  const setDeckSlides = useCallback(
    (deckId: string, slides: Slide[]) => {
      const before = decksRef.current.find((deck) => deck.id === deckId);
      const after = before
        ? { ...before, slides, updatedAt: new Date().toISOString() }
        : null;
      if (
        before &&
        after &&
        deckContentSignature(before) === deckContentSignature(after)
      ) {
        return;
      }
      if (before && after) {
        markReplacedSlideOmissions(before, after);
      }
      const onSaveSuccess = after
        ? captureReplacedSlideDeleteTombstones(after)
        : undefined;
      markDeckDirty(deckId);
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
          enqueueDeckOp(
            deckId,
            { op: "full-replace", deck: next },
            {
              onSaveSuccess,
              onPersisted: (results, slideWriteSequences) =>
                reconcilePersistedLayoutFit(
                  deckId,
                  results,
                  slideWriteSequences,
                ),
            },
          );
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
    [
      captureReplacedSlideDeleteTombstones,
      markDeckDirty,
      markReplacedSlideOmissions,
      reconcilePersistedLayoutFit,
      setDecksLocal,
    ],
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
        reloadDecksWithStatus,
        refreshOpenDeck: refetchOpenDeckIfChanged,
        getDeck,
        addSlide,
        flushDeckSave,
        updateSlide,
        updateSlides,
        deleteSlide,
        deleteSlides,
        duplicateSlide,
        pasteSlide,
        pasteSlides,
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
 * Subscribe to deck save-state. `saving` is true while any deck has a pending
 * debounce timer or an in-flight PUT. `hasUnsavedChanges` also stays true when
 * a save has exhausted its retry budget, so navigation can warn before the
 * user leaves work that is still only local.
 *
 * Used by SaveStatusIndicator in the toolbar so users always see whether
 * their work has been committed (Rochkind reported losing a full deck because
 * there was no save signal).
 */
export function useSaveState(): {
  saving: boolean;
  hasUnsavedChanges: boolean;
} {
  return useSyncExternalStore(subscribeSaveState, getSaveSnapshot, () => ({
    saving: false,
    hasUnsavedChanges: false,
  }));
}
