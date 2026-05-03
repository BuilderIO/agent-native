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
import { appBasePath, appPath } from "@agent-native/core/client";
import type { AspectRatio } from "@/lib/aspect-ratios";

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
  createDeck: (title?: string, options?: { noDefaultSlides?: boolean }) => Deck;
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
  getDeck: (id: string) => Deck | undefined;
  addSlide: (deckId: string, layout?: SlideLayout, afterIndex?: number) => void;
  updateSlide: (
    deckId: string,
    slideId: string,
    updates: Partial<Omit<Slide, "id">>,
  ) => void;
  deleteSlide: (deckId: string, slideId: string) => void;
  duplicateSlide: (deckId: string, slideId: string) => void;
  reorderSlides: (deckId: string, oldIndex: number, newIndex: number) => void;
  setDeckSlides: (deckId: string, slides: Slide[]) => void;
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

// Debounced save to API + save-state listeners (so the toolbar indicator
// can show "Saving…" / "Saved"). The map tracks pending debounce timers;
// `inFlight` tracks active fetches. Combined, they answer "is anything
// uncommitted?" for the indicator.
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightSaves = new Set<string>();
const saveStateListeners = new Set<() => void>();

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

function saveDeckToAPI(deck: Deck) {
  // Clear any pending save for this deck
  const existing = pendingSaves.get(deck.id);
  if (existing) clearTimeout(existing);

  // Debounce: wait 500ms before saving
  const timer = setTimeout(async () => {
    pendingSaves.delete(deck.id);
    inFlightSaves.add(deck.id);
    notifySaveListeners();
    try {
      await fetch(`${appBasePath()}/api/decks/${deck.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deck),
      });
    } catch (err) {
      console.error(`Failed to save deck ${deck.id}:`, err);
    } finally {
      inFlightSaves.delete(deck.id);
      notifySaveListeners();
    }
  }, 500);
  pendingSaves.set(deck.id, timer);
  notifySaveListeners();
}

async function fetchDecksFromAPI(): Promise<Deck[]> {
  try {
    const res = await fetch(`${appBasePath()}/api/decks`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch decks:", err);
    return [];
  }
}

async function deleteDeckFromAPI(id: string): Promise<void> {
  try {
    await fetch(`${appBasePath()}/api/decks/${id}`, { method: "DELETE" });
  } catch (err) {
    console.error(`Failed to delete deck ${id}:`, err);
  }
}

async function createDeckOnAPI(deck: Deck): Promise<void> {
  try {
    await fetch(`${appBasePath()}/api/decks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deck),
    });
  } catch (err) {
    console.error(`Failed to create deck ${deck.id}:`, err);
  }
}

const defaultSlideContent: Record<SlideLayout, string> = {
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
  blank: "",
};

export function DeckProvider({ children }: { children: ReactNode }) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);

  // History for undo/redo
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const skipHistoryRef = useRef(false);
  // Track when external (SSE) updates happen so the save effect doesn't echo them back
  const lastExternalUpdateRef = useRef(0);
  // Track client-created decks that haven't been confirmed on the server yet.
  // Prevents the poll from wiping optimistic decks before their POST lands.
  const pendingCreateIdsRef = useRef<Set<string>>(new Set());

  // Load decks from API on mount
  useEffect(() => {
    fetchDecksFromAPI().then((loaded) => {
      lastExternalUpdateRef.current = Date.now(); // Don't save initial load back
      setDecks(loaded);
      setHistory([
        {
          timestamp: Date.now(),
          label: "Initial state",
          decks: JSON.parse(JSON.stringify(loaded)),
        },
      ]);
      setHistoryIndex(0);
      setLoading(false);
    });
  }, []);

  // Poll for deck list + open-deck changes (handles agent db-exec updates that bypass SSE)
  useEffect(() => {
    if (loading) return;
    // Figure out which deck (if any) is currently open, so we can poll faster
    // and re-fetch its contents each tick to catch agent slide additions.
    const readOpenDeckId = (): string | null => {
      if (typeof window === "undefined") return null;
      const m = window.location.pathname.match(/\/deck\/([^/?#]+)/);
      return m ? m[1] : null;
    };
    const openDeckId = readOpenDeckId();
    const intervalMs = openDeckId ? 1000 : 3000;
    const interval = setInterval(async () => {
      try {
        const fresh = await fetchDecksFromAPI();
        const currentIds = new Set(decks.map((d) => d.id));
        const freshIds = new Set(fresh.map((d) => d.id));
        const pending = pendingCreateIdsRef.current;
        // Check if deck list changed (added or removed)
        // Optimistic decks still in flight are preserved (not treated as removed).
        const added = fresh.filter((d) => !currentIds.has(d.id));
        const removed = decks.filter(
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
            // when the closure's `decks` is stale compared to `prev`)
            for (const a of added) {
              if (!prevIds.has(a.id)) next = [...next, a];
            }
            return next;
          });
        }

        // Also re-fetch the currently-open deck so agent-added slides show up.
        // The list endpoint may not include full slide contents, and SSE can
        // miss events if the client reconnects between broadcasts.
        const currentOpenId = readOpenDeckId();
        if (currentOpenId && !pending.has(currentOpenId)) {
          try {
            const res = await fetch(
              `${appBasePath()}/api/decks/${currentOpenId}`,
            );
            if (res.ok) {
              const serverDeck = (await res.json()) as Deck;
              const clientDeck = decks.find((d) => d.id === currentOpenId);
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
    }, intervalMs);
    return () => clearInterval(interval);
  }, [loading, decks]);

  // Save ALL changed decks to API — files are the single source of truth
  // Skip saves that happen within 2s of an external update (SSE or initial load)
  useEffect(() => {
    if (loading) return;
    if (Date.now() - lastExternalUpdateRef.current < 2000) return;
    for (const deck of decks) {
      saveDeckToAPI(deck);
    }
  }, [decks, loading]);

  // Listen for file changes via SSE (so agent edits show up in real-time)
  useEffect(() => {
    const evtSource = new EventSource(`${appBasePath()}/api/decks/events`);
    evtSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "deck-deleted" && data.deckId) {
          lastExternalUpdateRef.current = Date.now();
          setDecks((prev) => prev.filter((d) => d.id !== data.deckId));
        } else if (data.type === "deck-changed" && data.deckId) {
          // Refetch the changed deck from the API
          const res = await fetch(`${appBasePath()}/api/decks/${data.deckId}`);
          if (!res.ok) return;
          const updated = await res.json();
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
    setHistoryIndex(newIndex);
    skipHistoryRef.current = true;
    setDecks(JSON.parse(JSON.stringify(history[newIndex].decks)));
  }, [historyIndex, history]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    skipHistoryRef.current = true;
    setDecks(JSON.parse(JSON.stringify(history[newIndex].decks)));
  }, [historyIndex, history]);

  const restoreFromHistory = useCallback(
    (index: number) => {
      if (index < 0 || index >= history.length) return;
      setHistoryIndex(index);
      skipHistoryRef.current = true;
      setDecks(JSON.parse(JSON.stringify(history[index].decks)));
    },
    [history],
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
    (title?: string, options?: { noDefaultSlides?: boolean }): Deck => {
      const newDeck: Deck = {
        id: nanoid(10),
        title: title || "Untitled Deck",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
      createDeckOnAPI(newDeck).finally(() => {
        pendingCreateIdsRef.current.delete(newDeck.id);
      });
      setDecksWithHistory("Create deck", (prev) => [...prev, newDeck]);
      return newDeck;
    },
    [setDecksWithHistory],
  );

  const duplicateDeck = useCallback(
    (sourceDeckId: string, newId: string, title?: string): Deck | null => {
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
        shareToken: undefined,
      };
      optimistic.slides = optimistic.slides.map((s) => ({
        ...s,
        id: nanoid(8),
      }));

      // Track as pending so the poll doesn't wipe the optimistic deck before
      // the duplicate-deck action's INSERT lands.
      pendingCreateIdsRef.current.add(newId);

      // Fire the action in the background. On error, roll back.
      fetch(`${appBasePath()}/_agent-native/actions/duplicate-deck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckId: sourceDeckId, newId, title }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .catch((err) => {
          console.error("Duplicate failed:", err);
          // Roll back: drop the optimistic deck from local state.
          setDecks((prev) => prev.filter((d) => d.id !== newId));
        })
        .finally(() => {
          pendingCreateIdsRef.current.delete(newId);
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
      // Don't push history for title changes (too noisy)
      // Clear the external-update suppression window so a rename/update that
      // happens within 2s of page load (or an SSE event) is not silently dropped.
      lastExternalUpdateRef.current = 0;
      setDecks((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, ...updates, updatedAt: new Date().toISOString() }
            : d,
        ),
      );
    },
    [],
  );

  const getDeck = useCallback(
    (id: string) => decks.find((d) => d.id === id),
    [decks],
  );

  const addSlide = useCallback(
    (deckId: string, layout: SlideLayout = "content", afterIndex?: number) => {
      const newSlide: Slide = {
        id: nanoid(8),
        content: defaultSlideContent[layout],
        notes: "",
        layout,
        background: "bg-[#000000]",
      };
      setDecksWithHistory("Add slide", (prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const slides = [...d.slides];
          const insertAt =
            afterIndex !== undefined ? afterIndex + 1 : slides.length;
          slides.splice(insertAt, 0, newSlide);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [setDecksWithHistory],
  );

  const updateSlide = useCallback(
    (deckId: string, slideId: string, updates: Partial<Omit<Slide, "id">>) => {
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
    },
    [setDecksWithHistory],
  );

  const deleteSlide = useCallback(
    (deckId: string, slideId: string) => {
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
    },
    [setDecksWithHistory],
  );

  const duplicateSlide = useCallback(
    (deckId: string, slideId: string) => {
      setDecksWithHistory("Duplicate slide", (prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const idx = d.slides.findIndex((s) => s.id === slideId);
          if (idx === -1) return d;
          const original = d.slides[idx];
          const copy: Slide = { ...original, id: nanoid(8) };
          const slides = [...d.slides];
          slides.splice(idx + 1, 0, copy);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [setDecksWithHistory],
  );

  const reorderSlides = useCallback(
    (deckId: string, oldIndex: number, newIndex: number) => {
      setDecksWithHistory("Reorder slides", (prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          const slides = [...d.slides];
          const [moved] = slides.splice(oldIndex, 1);
          slides.splice(newIndex, 0, moved);
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [setDecksWithHistory],
  );

  const setDeckSlides = useCallback(
    (deckId: string, slides: Slide[]) => {
      setDecksWithHistory("Generate slides", (prev) =>
        prev.map((d) => {
          if (d.id !== deckId) return d;
          return { ...d, slides, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [setDecksWithHistory],
  );

  return (
    <DeckContext.Provider
      value={{
        decks,
        loading,
        createDeck,
        duplicateDeck,
        deleteDeck,
        updateDeck,
        getDeck,
        addSlide,
        updateSlide,
        deleteSlide,
        duplicateSlide,
        reorderSlides,
        setDeckSlides,
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
