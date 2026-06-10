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
import { nanoid } from "nanoid";
import {
  appBasePath,
  callAction,
  isEmbedAuthActive,
} from "@agent-native/core/client";
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
  | { op: "delete-slide"; slideId: string }
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

type PatchDeckOp = Exclude<GranularOp, { op: "full-replace" }>;

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

export interface HistoryEntry {
  timestamp: number;
  label: string;
  decks: Deck[];
}

interface DeckContextType {
  decks: Deck[];
  loading: boolean;
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
  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  history: HistoryEntry[];
  historyIndex: number;
  restoreFromHistory: (index: number) => void;
}

const DeckContext = createContext<DeckContextType | null>(null);

const MAX_HISTORY = 50;
const OPEN_DECK_FALLBACK_POLL_MS = 5_000;
const DECK_LIST_FALLBACK_POLL_MS = 15_000;

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
 * state (used by undo/redo and bulk generation which produce a known good
 * snapshot).
 *
 * The debounce fires after 500 ms of quiet, draining the queue via the
 * granular `patch-deck` action. If the queue contains a `full-replace` op,
 * a direct PUT to `/api/decks/:id` is used instead (backwards-compatible).
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
    // If there's already a full-replace queued, leave it alone — it dominates
    if (queue.length > 0 && queue[0].op === "full-replace") {
      // Replace the stored deck snapshot with the latest state by replacing
      // the full-replace op rather than appending more granular ops on top.
      // (The op already carries the full deck; newer state comes via the
      // dirty-deck save effect which will enqueue a fresh full-replace when
      // it runs.)
    } else {
      queue.push(op);
      pendingOpsQueue.set(deckId, queue);
    }
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
        // Legacy full-deck PUT — used by undo/redo and setDeckSlides
        const deck = ops[0].deck;
        await fetch(`${appBasePath()}/api/decks/${deckId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deck),
        });
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
  const res = await fetch(`${appBasePath()}/api/decks`, {
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
  const decksRef = useRef<Deck[]>([]);

  // History for undo/redo
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const skipHistoryRef = useRef(false);
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

  const markChangedDecksDirty = useCallback((nextDecks: Deck[]) => {
    const ids = changedDeckIds(decksRef.current, nextDecks);
    if (ids.length === 0) return;
    lastExternalUpdateRef.current = 0;
    for (const id of ids) dirtyDeckIdsRef.current.add(id);
  }, []);

  useEffect(() => {
    decksRef.current = decks;
  }, [decks]);

  const resetDeckBaseline = useCallback((nextDecks: Deck[]) => {
    skipHistoryRef.current = false;
    setDecks(nextDecks);
    setHistory([
      {
        timestamp: Date.now(),
        label: "Initial state",
        decks: JSON.parse(JSON.stringify(nextDecks)),
      },
    ]);
    setHistoryIndex(0);
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
      return;
    }
    lastExternalUpdateRef.current = Date.now();
    resetDeckBaseline(loaded);
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
      try {
        const now = Date.now();
        const currentOpenId = readOpenDeckId();
        const pending = pendingCreateIdsRef.current;

        if (
          !currentOpenId ||
          now - lastListFetchAt >= DECK_LIST_FALLBACK_POLL_MS
        ) {
          lastListFetchAt = now;
          const fresh = await fetchDecksFromAPI();
          // A null result means the fetch failed (network error or non-2xx).
          // Skip the diff so we don't wipe local state on a transient failure
          // — otherwise the user's open deck disappears and they're bounced
          // back to the empty "Create your first deck" screen until the next
          // poll succeeds.
          if (fresh !== null) {
            const currentDecks = decksRef.current;
            const currentIds = new Set(currentDecks.map((d) => d.id));
            const freshIds = new Set(fresh.map((d) => d.id));
            // Check if deck list changed (added or removed). Optimistic decks
            // still in flight are preserved (not treated as removed).
            const added = fresh.filter((d) => !currentIds.has(d.id));
            const removed = currentDecks.filter(
              (d) => !freshIds.has(d.id) && !pending.has(d.id),
            );
            if (added.length > 0 || removed.length > 0) {
              lastExternalUpdateRef.current = Date.now();
              setDecks((prev) => {
                const prevIds = new Set(prev.map((d) => d.id));
                let next = prev.filter(
                  (d) => freshIds.has(d.id) || pending.has(d.id),
                );
                // Only add decks that aren't already in prev (prevents duplicates
                // when the closure's deck snapshot is stale compared to `prev`).
                for (const a of added) {
                  if (!prevIds.has(a.id)) next = [...next, a];
                }
                return next;
              });
            }
          }
        }

        // Also re-fetch the currently-open deck so agent-added slides show up.
        // The list endpoint may not include full slide contents, and SSE can
        // miss events if the client reconnects between broadcasts.
        //
        // Skip the refetch if a save is pending or in flight — the server's
        // copy might be a few hundred ms behind the local edits the user is
        // mid-typing, and overwriting wholesale would briefly revert their
        // characters before the next save lands. The next poll tick (after
        // saves settle) catches up.
        if (
          currentOpenId &&
          !pending.has(currentOpenId) &&
          !hasUncommittedDeckChanges(currentOpenId, dirtyDeckIdsRef.current)
        ) {
          try {
            const serverDeck = await fetchDeckFromAPI(currentOpenId);
            if (serverDeck) {
              const clientDeck = decksRef.current.find(
                (d) => d.id === currentOpenId,
              );
              const changed =
                !clientDeck ||
                clientDeck.updatedAt !== serverDeck.updatedAt ||
                clientDeck.slides.length !== serverDeck.slides.length;
              if (changed) {
                lastExternalUpdateRef.current = Date.now();
                setDecks((prev) => {
                  const idx = prev.findIndex((d) => d.id === currentOpenId);
                  if (idx < 0) return [...prev, serverDeck];
                  const next = [...prev];
                  next[idx] = serverDeck;
                  return next;
                });
              }
            }
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
  }, [loading]);

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

  // Listen for file changes via SSE (so agent edits show up in real-time)
  useEffect(() => {
    if (isEmbedAuthActive()) return;
    const evtSource = new EventSource(`${appBasePath()}/api/decks/events`);
    evtSource.onmessage = async (event) => {
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
          setDecks((prev) => {
            const idx = prev.findIndex((d) => d.id === data.deckId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            return [...prev, updated];
          });
        }
      } catch {}
    };
    return () => evtSource.close();
  }, []);

  const pushHistory = useCallback(
    (label: string, newDecks: Deck[]) => {
      setHistory((prev) => {
        const truncated = prev.slice(0, historyIndex + 1);
        const newHistory = [
          ...truncated,
          {
            timestamp: Date.now(),
            label,
            decks: JSON.parse(JSON.stringify(newDecks)),
          },
        ];
        if (newHistory.length > MAX_HISTORY) {
          newHistory.shift();
          return newHistory;
        }
        return newHistory;
      });
      setHistoryIndex((prev) => {
        const truncatedLen = Math.min(prev + 1, history.length);
        return Math.min(truncatedLen, MAX_HISTORY - 1);
      });
    },
    [historyIndex, history.length],
  );

  const setDecksWithHistory = useCallback(
    (label: string, updater: (prev: Deck[]) => Deck[]) => {
      setDecks((prev) => {
        const next = updater(prev);
        // Push to history after state update
        setTimeout(() => {
          if (!skipHistoryRef.current) {
            pushHistory(label, next);
          }
          skipHistoryRef.current = false;
        }, 0);
        return next;
      });
    },
    [pushHistory],
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const nextDecks = JSON.parse(JSON.stringify(history[newIndex].decks));
    // Undo restores a complete known-good snapshot — use full-replace so
    // we don't try to infer granular ops from the diff.
    for (const deck of nextDecks) {
      enqueueDeckOp(deck.id, { op: "full-replace", deck });
    }
    markChangedDecksDirty(nextDecks);
    setHistoryIndex(newIndex);
    skipHistoryRef.current = true;
    setDecks(nextDecks);
  }, [historyIndex, history, markChangedDecksDirty]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const nextDecks = JSON.parse(JSON.stringify(history[newIndex].decks));
    // Same as undo — restore from a complete snapshot.
    for (const deck of nextDecks) {
      enqueueDeckOp(deck.id, { op: "full-replace", deck });
    }
    markChangedDecksDirty(nextDecks);
    setHistoryIndex(newIndex);
    skipHistoryRef.current = true;
    setDecks(nextDecks);
  }, [historyIndex, history, markChangedDecksDirty]);

  const restoreFromHistory = useCallback(
    (index: number) => {
      if (index < 0 || index >= history.length) return;
      const nextDecks = JSON.parse(JSON.stringify(history[index].decks));
      for (const deck of nextDecks) {
        enqueueDeckOp(deck.id, { op: "full-replace", deck });
      }
      markChangedDecksDirty(nextDecks);
      setHistoryIndex(index);
      skipHistoryRef.current = true;
      setDecks(nextDecks);
    },
    [history, markChangedDecksDirty],
  );

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
      setDecksWithHistory("Create deck", (prev) => [...prev, newDeck]);
      return newDeck;
    },
    [setDecksWithHistory],
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
      callAction<DuplicateDeckActionResult>("duplicate-deck", {
        deckId: sourceDeckId,
        newId,
        title,
      })
        .catch((err) => {
          console.error("Duplicate failed:", err);
          // Roll back: drop the optimistic deck from local state.
          setDecks((prev) => prev.filter((d) => d.id !== newId));
        })
        .finally(() => {
          pendingCreateIdsRef.current.delete(newId);
          pendingDuplicateSourceIdsRef.current.delete(sourceDeckId);
        });

      setDecksWithHistory("Duplicate deck", (prev) => [...prev, optimistic]);
      return optimistic;
    },
    [decks, setDecksWithHistory],
  );

  const deleteDeck = useCallback(
    (id: string) => {
      deleteDeckFromAPI(id);
      setDecksWithHistory("Delete deck", (prev) =>
        prev.filter((d) => d.id !== id),
      );
    },
    [setDecksWithHistory],
  );

  const updateDeck = useCallback(
    (id: string, updates: Partial<Omit<Deck, "id" | "createdAt">>) => {
      // Clear the external-update suppression window so a rename/update that
      // happens within 2s of page load (or an SSE event) is not silently dropped.
      markDeckDirty(id);
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
      void _ca;
      if (Object.keys(persistableUpdates).length > 0) {
        enqueueDeckOp(id, {
          op: "patch-deck-fields",
          fields: persistableUpdates,
        });
      }
    },
    [markDeckDirty],
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

      let afterSlideId: string | undefined;
      setDecksWithHistory("Add slide", (prev) =>
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
      enqueueDeckOp(deckId, {
        op: "add-slide",
        slideId: newSlide.id,
        afterSlideId,
        fields: {
          content: newSlide.content,
          notes: newSlide.notes,
          layout: newSlide.layout,
          background: newSlide.background,
        },
      });

      return newSlide.id;
    },
    [markDeckDirty, setDecksWithHistory],
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
      setDecksWithHistory(label, (prev: Deck[]) =>
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
      enqueueDeckOp(deckId, { op: "patch-slide", slideId, fields: updates });
    },
    [markDeckDirty, setDecksWithHistory],
  );

  const deleteSlide = useCallback(
    (deckId: string, slideId: string) => {
      markDeckDirty(deckId);
      setDecksWithHistory("Delete slide", (prev) =>
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
      enqueueDeckOp(deckId, { op: "delete-slide", slideId });
    },
    [markDeckDirty, setDecksWithHistory],
  );

  const duplicateSlide = useCallback(
    (deckId: string, slideId: string) => {
      markDeckDirty(deckId);
      let copiedSlide: Slide | undefined;
      setDecksWithHistory("Duplicate slide", (prev) =>
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
        enqueueDeckOp(deckId, {
          op: "add-slide",
          slideId: newSlideId,
          afterSlideId: slideId,
          fields: {
            content: rest.content,
            notes: rest.notes,
            layout: rest.layout,
            background: rest.background,
          },
        });
      }
    },
    [markDeckDirty, setDecksWithHistory],
  );

  const reorderSlides = useCallback(
    (deckId: string, oldIndex: number, newIndex: number) => {
      markDeckDirty(deckId);
      let orderedIds: string[] | undefined;
      setDecksWithHistory("Reorder slides", (prev) =>
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
        enqueueDeckOp(deckId, { op: "reorder-slides", orderedIds });
      }
    },
    [markDeckDirty, setDecksWithHistory],
  );

  const setDeckSlides = useCallback(
    (deckId: string, slides: Slide[]) => {
      markDeckDirty(deckId);
      setDecksWithHistory("Generate slides", (prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const updated = { ...d, slides, updatedAt: new Date().toISOString() };
          // setDeckSlides replaces ALL slides wholesale (used by AI generation
          // and imports). Use a full-replace so the server state always exactly
          // matches the generated result, regardless of any concurrent changes.
          enqueueDeckOp(deckId, { op: "full-replace", deck: updated });
          return updated;
        }),
      );
    },
    [markDeckDirty, setDecksWithHistory],
  );

  return (
    <DeckContext.Provider
      value={{
        decks,
        loading,
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
        canUndo: historyIndex > 0,
        canRedo: historyIndex < history.length - 1,
        history,
        historyIndex,
        restoreFromHistory,
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
