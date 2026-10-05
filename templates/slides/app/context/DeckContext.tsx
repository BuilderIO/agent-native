import { captureError } from "@agent-native/core/client/analytics";
import {
  createLocalOpUndoController,
  type LocalOpUndoController,
  type LocalOpUndoEntry,
} from "@agent-native/core/client/collab";
import {
  callAction,
  callActionWithRetry,
  tryCallActionKeepalive,
  type KeepaliveActionCallResult,
} from "@agent-native/core/client/hooks";
import { isEmbedAuthActive } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  REALTIME_CAP_POLL_LIVE,
  subscribeSyncEvents,
} from "@agent-native/core/client/use-db-sync";
import {
  addSurfaceVisibilityListener,
  isSurfaceHidden,
} from "@agent-native/core/shared";
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
  useLayoutEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
  ReactNode,
} from "react";
import { toast } from "sonner";

import type { AspectRatio } from "@/lib/aspect-ratios";

import { deckContentSignature as stableDeckContentSignature } from "../../shared/deck-content";
import {
  isMergeSafeDeckPatchOperations,
  type SlideFieldBaseline,
} from "../../shared/deck-write";
import {
  normalizeSlidePadding,
  normalizeSlidePaddingForWrite,
} from "../lib/normalize-slide-padding";
import { mergeSlideContent } from "../lib/slide-content-merge";
import { renderArtifactGrowth } from "../lib/slide-source-map";

type GranularOp =
  | {
      op: "patch-slide";
      slideId: string;
      fields: PatchSlideFields;
      baseContentHash?: string;
      baseFields?: PatchSlideBaselines;
    }
  | { op: "delete-slide"; slideId: string; allowEmpty?: boolean }
  | { op: "reorder-slides"; orderedIds: string[] }
  | {
      op: "add-slide";
      slideId: string;
      afterSlideId?: string;
      fields: Omit<Partial<Slide>, "id" | "imageLoading"> & { content: string };
    }
  | {
      op: "patch-deck-fields";
      fields: PatchDeckTopLevelFields;
    }
  /** Sentinel: discard all accumulated ops and do a full PUT instead. */
  | {
      op: "full-replace";
      deck: Deck;
      onSaveSuccess?: (ops: GranularOp[]) => void;
    };

type PatchSlideFields = Partial<
  Omit<
    Slide,
    | "id"
    | "background"
    | "layoutWarningDismissed"
    | "imageUrl"
    | "imageLoading"
    | "imagePrompt"
    | "excalidrawData"
    | "transition"
    | "animations"
    | "splitByParagraph"
    | "skipped"
  >
> & {
  background?: string | null;
  layoutWarningDismissed?: boolean | null;
  imageUrl?: string | null;
  imageLoading?: boolean | null;
  imagePrompt?: string | null;
  excalidrawData?: string | null;
  transition?: Slide["transition"] | null;
  animations?: SlideAnimation[] | null;
  splitByParagraph?: boolean | null;
  skipped?: boolean | null;
};

type PatchSlideBaselineField = Exclude<
  keyof PatchSlideFields,
  "content" | "layoutFitRevision"
>;
type PatchSlideBaselines = Partial<
  Record<PatchSlideBaselineField, SlideFieldBaseline>
>;

type PatchDeckTopLevelFields = Partial<
  Omit<
    Deck,
    | "id"
    | "slides"
    | "createdAt"
    | "updatedAt"
    | "createdByMe"
    | "designSystemId"
    | "tweaks"
    | "aspectRatio"
    | "starred"
  >
> & {
  designSystemId?: string | null;
  tweaks?: Deck["tweaks"] | null;
  aspectRatio?: Deck["aspectRatio"] | null;
  starred?: boolean | null;
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

function addSlideFields(
  slide: Slide,
): Extract<GranularOp, { op: "add-slide" }>["fields"] {
  const { id: _id, imageLoading: _imageLoading, ...fields } = slide;
  return {
    ...fields,
    content: normalizeSlidePadding(fields.content),
    notes: fields.notes ?? "",
  };
}

function slideFieldBaselines(
  slide: Slide | undefined,
  fields: PatchSlideFields,
): PatchSlideBaselines | undefined {
  if (!slide) return undefined;
  const baselines: PatchSlideBaselines = {};
  for (const [field, value] of Object.entries(fields)) {
    if (
      field === "content" ||
      field === "layoutFitRevision" ||
      value === undefined
    ) {
      continue;
    }
    const key = field as PatchSlideBaselineField;
    const baseline = slide[key];
    const absent =
      baseline === undefined || (key === "notes" && baseline === null);
    baselines[key] = absent
      ? { present: false }
      : { present: true, value: structuredClone(baseline) };
  }
  return Object.keys(baselines).length > 0 ? baselines : undefined;
}

function mergeSlideFieldBaselines(
  first: PatchSlideBaselines | undefined,
  later: PatchSlideBaselines | undefined,
): PatchSlideBaselines | undefined {
  const merged = { ...later, ...first };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function slideFieldDraftKey(slideId: string, field: string): string {
  return JSON.stringify([slideId, field]);
}

function rememberStaleSlideFieldDraft(
  deckId: string,
  draft: StaleSlideFieldDraft,
) {
  const drafts = staleSlideFieldDrafts.get(deckId) ?? new Map();
  drafts.set(slideFieldDraftKey(draft.slideId, draft.field), draft);
  staleSlideFieldDrafts.set(deckId, drafts);
}

function withStaleSlideFieldBaselines(
  deckId: string,
  op: GranularOp,
): GranularOp {
  if (op.op !== "patch-slide") return op;
  const drafts = staleSlideFieldDrafts.get(deckId);
  if (!drafts) return op;
  const baseFields = { ...op.baseFields };
  let changed = false;
  for (const field of Object.keys(op.fields)) {
    if (field === "content" || field === "layoutFitRevision") continue;
    const draft = drafts.get(slideFieldDraftKey(op.slideId, field));
    if (!draft) continue;
    draft.localValue = op.fields[field as PatchSlideBaselineField];
    baseFields[field as PatchSlideBaselineField] = draft.remoteBaseline;
    changed = true;
  }
  return changed ? { ...op, baseFields } : op;
}

function clearPersistedStaleSlideFieldDrafts(
  deckId: string,
  ops: readonly GranularOp[],
) {
  const drafts = staleSlideFieldDrafts.get(deckId);
  if (!drafts) return;
  for (const op of ops) {
    if (op.op !== "patch-slide") continue;
    for (const field of Object.keys(op.fields)) {
      if (field === "content" || field === "layoutFitRevision") continue;
      drafts.delete(slideFieldDraftKey(op.slideId, field));
    }
  }
  if (drafts.size === 0) staleSlideFieldDrafts.delete(deckId);
}

function withStaleSlideFieldDrafts(deck: Deck): Deck {
  const drafts = staleSlideFieldDrafts.get(deck.id);
  if (!drafts) return deck;
  const fieldsBySlide = new Map<string, Record<string, unknown>>();
  for (const draft of drafts.values()) {
    const fields = fieldsBySlide.get(draft.slideId) ?? {};
    fields[draft.field] = draft.localValue;
    fieldsBySlide.set(draft.slideId, fields);
  }
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      const fields = fieldsBySlide.get(slide.id);
      return fields ? { ...slide, ...fields } : slide;
    }),
  };
}

function refreshStaleSlideFieldBaselines(deck: Deck) {
  const drafts = staleSlideFieldDrafts.get(deck.id);
  if (!drafts) return;
  const slides = new Map(deck.slides.map((slide) => [slide.id, slide]));
  for (const draft of drafts.values()) {
    const slide = slides.get(draft.slideId);
    if (!slide) continue;
    const remoteValue = (slide as unknown as Record<string, unknown>)[
      draft.field
    ];
    draft.remoteBaseline =
      remoteValue === undefined
        ? { present: false }
        : { present: true, value: structuredClone(remoteValue) };
  }
}

function restoreStaleSlideFieldDrafts(
  deck: Deck,
  drafts: readonly StaleSlideFieldDraft[],
): Deck {
  const draftsBySlide = new Map<string, StaleSlideFieldDraft[]>();
  for (const draft of drafts) {
    const slideDrafts = draftsBySlide.get(draft.slideId) ?? [];
    slideDrafts.push(draft);
    draftsBySlide.set(draft.slideId, slideDrafts);
  }
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      const slideDrafts = draftsBySlide.get(slide.id);
      if (!slideDrafts) return slide;
      const restored = { ...slide };
      for (const draft of slideDrafts) {
        if (draft.remoteBaseline.present) {
          Object.assign(restored, {
            [draft.field]: draft.remoteBaseline.value,
          });
        } else {
          Reflect.deleteProperty(restored, draft.field);
        }
      }
      return restored;
    }),
  };
}

function withSlideFieldBaselines(deck: Deck, op: PatchDeckOp): PatchDeckOp {
  if (op.op !== "patch-slide") return op;
  const slide = deck.slides.find((entry) => entry.id === op.slideId);
  const captured = slideFieldBaselines(slide, op.fields);
  if (!captured) return op;
  return {
    ...op,
    baseFields: { ...captured, ...op.baseFields },
  };
}
export type DeckReloadStatus = "loaded" | "failed" | "stale";
export type DeckContentConflictChoice = "keep-mine" | "use-latest";
export interface DeckContentConflict {
  slideId: string;
  localContent: string;
  remoteContent?: string | null;
  remoteUpdatedAt?: string;
  canResolve: boolean;
}
export type DeckContentConflictResolution =
  | { status: "resolved"; content: string }
  | {
      status: "unresolved";
      reason:
        | "conflict-not-found"
        | "conflict-unknown"
        | "full-replace"
        | "pending-writes"
        | "remote-unavailable"
        | "slide-missing"
        | "draft-changed"
        | "write-failed"
        | "conflict";
    };
export interface UpdateSlideOptions {
  persistence?: "debounced" | "immediate";
  preserveLocalState?: boolean;
  recordUndoOnly?: boolean;
  clearMissingImagePreviews?: boolean;
}

export type DeckUndoOp =
  | ({ deckId: string } & PatchDeckOp)
  | { op: "delete-deck"; deckId: string }
  | { op: "restore-deck"; deckId: string; deck: Deck; index?: number };

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
  layoutFitRevision?: string;
  layoutWarningDismissed?: boolean;
  background?: string;
  imageUrl?: string;
  imageLoading?: boolean;
  imagePrompt?: string;
  excalidrawData?: string;
  transition?: "instant" | "none" | "fade" | "slide" | "zoom";
  animations?: SlideAnimation[];
  /** @deprecated Use animations instead */
  splitByParagraph?: boolean;
  skipped?: boolean;
}

export type AnimationType = "appear" | "fade" | "slide-up" | "zoom";

export interface SlideAnimation {
  id: string;
  elementIndex: number;
  elementPath?: number[];
  byParagraph?: boolean;
  type: AnimationType;
}

export interface Deck {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  slides: Slide[];
  shareToken?: string;
  visibility?: "private" | "org" | "public";
  createdByMe?: boolean;
  designSystemId?: string;
  tweaks?: Record<string, string | number | boolean>;
  starred?: boolean;
  aspectRatio?: AspectRatio;
  previewSlide?: Slide;
  sourceImport?: unknown;
  generationContext?: Record<string, unknown> | null;
}

export interface SetDeckSlidesOptions {
  deckFields?: Partial<
    Pick<Deck, "title" | "aspectRatio" | "tweaks" | "starred">
  > & { designSystemId?: string | null };
  clearDeckFields?: readonly ClearableDeckField[];
  persistence?: "debounced" | "immediate";
  forcePersistence?: boolean;
}

type ClearableDeckField =
  | "aspectRatio"
  | "designSystemId"
  | "tweaks"
  | "starred"
  | "sourceImport";

export type DeckPersistenceResult =
  | { persisted: true }
  | { persisted: false; reason: "request-failed"; error: unknown }
  | { persisted: false; reason: "not-found" };

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
  deckListRefreshing: boolean;
  createDeck: (
    title?: string,
    options?: {
      noDefaultSlides?: boolean;
      designSystemId?: string | null;
      deferPersistence?: boolean;
    },
  ) => Deck;
  ensureDeckPersisted: (id: string) => Promise<DeckPersistenceResult>;
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
  catchUpStaleDeckList: () => void;
  refreshOpenDeck: (
    deckId: string,
    options?: { clearPendingWrites?: boolean },
  ) => Promise<Deck | null>;
  resolveDeckContentConflict: (
    deckId: string,
    slideId: string,
    choice: DeckContentConflictChoice,
  ) => Promise<DeckContentConflictResolution>;
  getDeck: (id: string) => Deck | undefined;
  addSlide: (
    deckId: string,
    layout?: SlideLayout,
    afterIndex?: number,
    options?: { persistence?: "debounced" | "immediate" },
  ) => string;
  flushDeckSave: (deckId: string) => Promise<void>;
  retryDeckSave: (deckId: string) => Promise<void>;
  resolveContentConflict: (
    deckId: string,
    slideId: string,
    resolution: "latest" | "draft",
  ) => Promise<void>;
  updateSlide: (
    deckId: string,
    slideId: string,
    updates: Partial<Omit<Slide, "id">>,
    options?: UpdateSlideOptions,
  ) => string | undefined;
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
  setDeckSlides: (
    deckId: string,
    slides: Slide[],
    options?: SetDeckSlidesOptions,
  ) => void;
  markDeckDirty: (deckId: string) => void;
  undo: (deckId?: string) => void;
  redo: (deckId?: string) => void;
  undoAvailability: Record<string, { canUndo: boolean; canRedo: boolean }>;
}

const DeckContext = createContext<DeckContextType | null>(null);

const OPEN_DECK_FALLBACK_POLL_MS = 5_000;
const DECK_LIST_FALLBACK_POLL_MS = 15_000;
const LIVE_CHANNEL_IDLE_POLL_MS = 60_000;
// A hidden tab with an open deck keeps reconciling: external agents (MCP,
// WebMCP, CDP) edit decks in tabs that are never focused (#4393). Only the
// cadence drops, and repeated failures park it until the tab is visible.
const HIDDEN_OPEN_DECK_FALLBACK_POLL_MS = 30_000;
const HIDDEN_MAX_CONSECUTIVE_FAILURES = 2;
// The first retry is faster than the idle cadence so a visible error state
// recovers quickly; later ones back off instead of hammering a failing server.
const FAILURE_BACKOFF_POLL_MS = [5_000, 15_000, 60_000] as const;

type PollTerminalStop =
  | { scope: "session" }
  | { scope: "deck"; deckId: string };

type PollControl = {
  pollNow: () => void;
  onRead: (deckId: string | null, status: DeckRead["status"]) => void;
  onRouteChange: (openDeckId: string | null) => void;
};

const IDLE_POLL_CONTROL: PollControl = {
  pollNow: () => {},
  onRead: () => {},
  onRouteChange: () => {},
};

/** Returns `null` when the loop should not schedule another tick. */
export function fallbackPollIntervalMs(state: {
  liveChannelConnected: boolean;
  hasOpenDeck: boolean;
  hidden: boolean;
  consecutiveFailures: number;
}): number | null {
  const { liveChannelConnected, hasOpenDeck, hidden, consecutiveFailures } =
    state;
  if (hidden) {
    if (!hasOpenDeck) return null;
    if (consecutiveFailures >= HIDDEN_MAX_CONSECUTIVE_FAILURES) return null;
    if (consecutiveFailures > 0 || liveChannelConnected) {
      return LIVE_CHANNEL_IDLE_POLL_MS;
    }
    return HIDDEN_OPEN_DECK_FALLBACK_POLL_MS;
  }
  if (consecutiveFailures > 0) {
    return FAILURE_BACKOFF_POLL_MS[
      Math.min(consecutiveFailures, FAILURE_BACKOFF_POLL_MS.length) - 1
    ];
  }
  if (liveChannelConnected) return LIVE_CHANNEL_IDLE_POLL_MS;
  return hasOpenDeck ? OPEN_DECK_FALLBACK_POLL_MS : DECK_LIST_FALLBACK_POLL_MS;
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

const GET_DECK_ONLY_SLIDE_FIELDS = [
  "slideNumber",
  "zeroBasedIndex",
  "contentHash",
] as const;

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
  if (typeof deck.updatedAt === "string") {
    deckServerRevisions.set(deck.id, deck.updatedAt);
  }

  const deckRecord = deck as unknown as Record<string, unknown>;
  const cleanedDeck = { ...deckRecord };
  for (const field of GET_DECK_ONLY_DECK_FIELDS) delete cleanedDeck[field];
  const previewSlide = deckRecord.previewSlide;
  delete cleanedDeck.previewSlide;

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

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightSaves = new Set<string>();
const inFlightSaveChains = new Map<string, Promise<void>>();
const inFlightKeepaliveSaves = new Map<string, Promise<void>>();
const inFlightSaveControllers = new Map<string, AbortController>();
const deckSaveGenerations = new Map<string, number>();
const immediateFlushRequests = new Map<string, boolean>();
const deckSaveRetryAttempts = new Map<string, number>();
const deckRevisionConflictRetryAttempts = new Map<string, number>();
const failedSaveDecks = new Set<string>();
const deckSaveErrors = new Map<string, DeckSaveError>();
const staleContentConflicts = new Map<string, Set<string> | null>();
const staleFullReplaceDrafts = new Map<string, Deck>();
const verifiedFullReplaceOps = new WeakSet<
  Extract<GranularOp, { op: "full-replace" }>
>();
const staleContentRetrySlides = new Map<string, Set<string>>();
const staleContentDrafts = new Map<
  string,
  Map<string, Extract<GranularOp, { op: "patch-slide" }>>
>();
const staleContentRemoteSlides = new Map<
  string,
  Map<string, { content: string | null; updatedAt: string }>
>();
type StaleSlideFieldDraft = {
  slideId: string;
  field: PatchSlideBaselineField;
  localValue: unknown;
  remoteBaseline: SlideFieldBaseline;
};
const staleSlideFieldDrafts = new Map<
  string,
  Map<string, StaleSlideFieldDraft>
>();
const conflictResolutionDecks = new Set<string>();
const saveStateListeners = new Set<() => void>();
const MAX_DECK_SAVE_RETRIES = 2;
const DECK_SAVE_RETRY_BASE_MS = 250;
const MAX_DECK_REVISION_CONFLICT_RETRIES = 5;
const DECK_REVISION_CONFLICT_RETRY_MAX_MS = 2_000;

export class DeckSaveError extends Error {
  readonly status?: number;
  readonly errorCode?: string;
  readonly serverBuildId?: string;
  readonly requiredCompatibility?: string;
  readonly retryable: boolean;

  constructor(
    deckId: string,
    cause?: unknown,
    message?: string,
    retryable = false,
  ) {
    super(message ?? `Failed to save deck ${deckId}`);
    this.name = "DeckSaveError";
    this.retryable = retryable;
    if (cause && typeof cause === "object") {
      if ("status" in cause && typeof cause.status === "number") {
        this.status = cause.status;
      }
      if ("errorCode" in cause && typeof cause.errorCode === "string") {
        this.errorCode = cause.errorCode;
      } else if ("code" in cause && typeof cause.code === "string") {
        this.errorCode = cause.code;
      }
      if ("serverBuildId" in cause && typeof cause.serverBuildId === "string") {
        this.serverBuildId = cause.serverBuildId;
      }
      if (
        "requiredCompatibility" in cause &&
        typeof cause.requiredCompatibility === "string"
      ) {
        this.requiredCompatibility = cause.requiredCompatibility;
      }
    }
    this.cause = cause;
  }
}

function markDeckSaveFailed(
  deckId: string,
  cause?: unknown,
  message?: string,
): void {
  failedSaveDecks.add(deckId);
  deckSaveErrors.set(
    deckId,
    new DeckSaveError(
      deckId,
      cause,
      message,
      pendingOpsQueue.has(deckId) &&
        !staleContentConflicts.has(deckId) &&
        !staleFullReplaceDrafts.has(deckId) &&
        !isTerminalClientSaveError(cause),
    ),
  );
}

function clearDeckSaveFailure(deckId: string): void {
  failedSaveDecks.delete(deckId);
  deckSaveErrors.delete(deckId);
}

const pendingOpsQueue = new Map<string, GranularOp[]>();
const pendingPersistedResultHandlers = new Map<
  string,
  PendingPersistedResultHandler[]
>();
const deckClientWriteId = nanoid(12);
const deckClientWriteSequences = new Map<string, number>();
const deckKeepaliveSuccessGenerations = new Map<string, number>();
const deckServerRevisions = new Map<string, string | null>();
const slideLocalWriteSequences = new Map<string, Map<string, number>>();
const sentSlideContent = new Map<
  string,
  Map<string, { content: string; over: string }>
>();
const confirmedSlideContentHashes = new Map<string, Map<string, string>>();
// Content behind each confirmed hash: the common ancestor for a three-way
// merge when another writer saved the same slide first.
const confirmedSlideContents = new Map<string, Map<string, string>>();
const draftCommittedContent = new WeakMap<GranularOp, string>();

const deckLocalWriteSeq = new Map<string, number>();

const inFlightOpSlides = new Map<string, GranularOp[]>();

function confirmedSlideContentHash(deckId: string, slideId: string) {
  return confirmedSlideContentHashes.get(deckId)?.get(slideId);
}

function confirmedSlideBaseContent(deckId: string, slideId: string) {
  const content = confirmedSlideContents.get(deckId)?.get(slideId);
  return content !== undefined &&
    hashSlideContent(content) === confirmedSlideContentHash(deckId, slideId)
    ? content
    : undefined;
}

function fullReplaceConflictSlides(
  deckId: string,
  replacement: Deck,
  remoteDeck: Deck | null,
  attemptedOps: GranularOp[],
): Set<string> | null {
  if (!remoteDeck) return null;

  const confirmed = confirmedSlideContentHashes.get(deckId) ?? new Map();
  const attempted = new Map<string, Set<string>>();
  for (const op of attemptedOps) {
    if (op.op !== "patch-slide" || typeof op.fields.content !== "string") {
      continue;
    }
    const hashes = attempted.get(op.slideId) ?? new Set<string>();
    hashes.add(hashSlideContent(op.fields.content));
    attempted.set(op.slideId, hashes);
  }

  const remoteSlides = new Map(
    remoteDeck.slides.map((slide) => [slide.id, slide]),
  );
  const replacementSlides = new Map(
    replacement.slides.map((slide) => [slide.id, slide]),
  );
  const slideIds = new Set([
    ...confirmed.keys(),
    ...attempted.keys(),
    ...remoteSlides.keys(),
    ...replacementSlides.keys(),
  ]);
  const conflicts = new Set<string>();

  for (const slideId of slideIds) {
    const remote = remoteSlides.get(slideId);
    const next = replacementSlides.get(slideId);
    const confirmedHash = confirmed.get(slideId);
    const remoteHash = remote ? hashSlideContent(remote.content) : undefined;
    const replacementHash = next ? hashSlideContent(next.content) : undefined;

    if (!remote) {
      if (confirmedHash && next) conflicts.add(slideId);
      continue;
    }
    if (!next) {
      if (confirmedHash !== undefined && remoteHash !== confirmedHash) {
        conflicts.add(slideId);
      } else if (confirmedHash === undefined) {
        conflicts.add(slideId);
      }
      continue;
    }
    if (
      remoteHash === confirmedHash ||
      attempted.get(slideId)?.has(remoteHash ?? "") ||
      remoteHash === replacementHash
    ) {
      continue;
    }
    conflicts.add(slideId);
  }

  return conflicts;
}

/**
 * Merge this client's unsaved draft of a slide with the copy another writer
 * saved first. `null` when the edits overlap or the shared ancestor is gone.
 */
function mergeConflictedDraft(
  deckId: string,
  slideId: string,
  ops: GranularOp[],
  remoteContent: string,
): string | null {
  let draft: string | undefined;
  for (const op of ops) {
    if (
      op.op === "patch-slide" &&
      op.slideId === slideId &&
      typeof op.fields.content === "string"
    ) {
      draft = op.fields.content;
    }
  }
  const base = confirmedSlideBaseContent(deckId, slideId);
  if (draft === undefined || base === undefined) return null;
  return mergeSlideContent(base, draft, remoteContent);
}

function rememberConfirmedSlideContent(
  deckId: string,
  slideId: string,
  content: string,
) {
  const hashes = confirmedSlideContentHashes.get(deckId) ?? new Map();
  hashes.set(slideId, hashSlideContent(content));
  confirmedSlideContentHashes.set(deckId, hashes);
  const contents = confirmedSlideContents.get(deckId) ?? new Map();
  contents.set(slideId, content);
  confirmedSlideContents.set(deckId, contents);
}

function rememberPersistedSlideContent(deckId: string, ops: GranularOp[]) {
  for (const op of ops) {
    if (op.op === "full-replace") {
      const hashes = new Map(
        op.deck.slides.map((slide) => [
          slide.id,
          hashSlideContent(slide.content),
        ]),
      );
      confirmedSlideContentHashes.set(deckId, hashes);
      confirmedSlideContents.set(
        deckId,
        new Map(op.deck.slides.map((slide) => [slide.id, slide.content])),
      );
      staleContentRetrySlides.delete(deckId);
    } else if (
      op.op === "patch-slide" &&
      typeof op.fields.content === "string"
    ) {
      rememberConfirmedSlideContent(deckId, op.slideId, op.fields.content);
      const retries = staleContentRetrySlides.get(deckId);
      retries?.delete(op.slideId);
      if (retries?.size === 0) staleContentRetrySlides.delete(deckId);
    } else if (op.op === "add-slide") {
      rememberConfirmedSlideContent(deckId, op.slideId, op.fields.content);
    } else if (op.op === "delete-slide") {
      const hashes = confirmedSlideContentHashes.get(deckId);
      hashes?.delete(op.slideId);
      if (hashes?.size === 0) confirmedSlideContentHashes.delete(deckId);
      confirmedSlideContents.get(deckId)?.delete(op.slideId);
      const retries = staleContentRetrySlides.get(deckId);
      retries?.delete(op.slideId);
      if (retries?.size === 0) staleContentRetrySlides.delete(deckId);
    }
  }
}

function nextDeckClientWrite(deckId: string) {
  const sequence = (deckClientWriteSequences.get(deckId) ?? 0) + 1;
  deckClientWriteSequences.set(deckId, sequence);
  return {
    clientId: deckClientWriteId,
    sequence,
    ...(deckServerRevisions.has(deckId)
      ? { expectedUpdatedAt: deckServerRevisions.get(deckId) }
      : {}),
  };
}

function isDeckRevisionConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "errorCode" in error &&
    error.errorCode === "deck_revision_conflict",
  );
}

function didRefreshDeckRevision(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "deckRevisionRefreshed" in error &&
    error.deckRevisionRefreshed === true,
  );
}

function isTerminalClientSaveError(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429 &&
    !(isDeckRevisionConflict(error) && didRefreshDeckRevision(error))
  );
}

function revisionConflictError(
  error: unknown,
  refreshed: boolean,
): Error & {
  status: 409;
  errorCode: "deck_revision_conflict";
  deckRevisionRefreshed: boolean;
} {
  const wrapped = Object.assign(
    new Error(error instanceof Error ? error.message : "Deck revision changed"),
    {
      status: 409 as const,
      errorCode: "deck_revision_conflict" as const,
      deckRevisionRefreshed: refreshed,
    },
  );
  Object.assign(wrapped, { cause: error });
  return wrapped;
}

function deckRevisionConflictRetryDelay(retryAttempt: number): number {
  const ceiling = Math.min(
    DECK_REVISION_CONFLICT_RETRY_MAX_MS,
    DECK_SAVE_RETRY_BASE_MS * 2 ** (retryAttempt - 1),
  );
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

function rememberDeckServerRevision(deckId: string, value: unknown) {
  if (!value || typeof value !== "object") return;
  const updatedAt = (value as Record<string, unknown>).updatedAt;
  if (typeof updatedAt === "string") {
    deckServerRevisions.set(deckId, updatedAt);
  }
}

const activeInlineEditSlides = new Map<string, Set<string>>();

export function markSlideEditingActive(deckId: string, slideId: string) {
  const set = activeInlineEditSlides.get(deckId) ?? new Set<string>();
  set.add(slideId);
  activeInlineEditSlides.set(deckId, set);
}

export function clearSlideEditingActive(deckId: string, slideId: string) {
  const set = activeInlineEditSlides.get(deckId);
  if (!set) return;
  set.delete(slideId);
  if (set.size === 0) activeInlineEditSlides.delete(deckId);
  flushDeferredRemoteSyncs();
}

// A remote change that arrived while local edits were pending is only partly
// applied (see `mergeServerSlideUpdate`), and nothing else re-reads the deck
// until the next idle poll. Remember it and re-read once the local writes
// settle.
const deferredRemoteSyncDecks = new Set<string>();
const deckResyncHandlers = new Set<(deckId: string) => void>();

function requestDeckResync(deckId: string) {
  for (const handler of deckResyncHandlers) handler(deckId);
}

function flushDeferredRemoteSyncs() {
  for (const deckId of [...deferredRemoteSyncDecks]) {
    if (
      hasUnsavedDeckChanges(deckId) ||
      (activeInlineEditSlides.get(deckId)?.size ?? 0) > 0
    ) {
      continue;
    }
    deferredRemoteSyncDecks.delete(deckId);
    setTimeout(() => requestDeckResync(deckId), 0);
  }
}

// Slides whose pending save carries a merge of another writer's edits, with
// the local draft the merge started from. Until the editor re-reads the merged
// result its content still derives from that draft, so the draft - not the
// merged text - is what the next write must be based on; otherwise the next
// keystroke save would silently overwrite the merged-in edits.
const mergedSlideDrafts = new Map<string, Map<string, string>>();

type SaveStateSnapshot = {
  saving: boolean;
  hasUnsavedChanges: boolean;
  revision: number;
};

let cachedSnapshot: SaveStateSnapshot = {
  saving: false,
  hasUnsavedChanges: false,
  revision: 0,
};

const serverSaveSnapshot: SaveStateSnapshot = {
  saving: false,
  hasUnsavedChanges: false,
  revision: 0,
};

function recomputeSnapshot() {
  const saving =
    pendingSaves.size > 0 ||
    inFlightSaves.size > 0 ||
    inFlightKeepaliveSaves.size > 0 ||
    pendingOpsQueue.size > 0 ||
    conflictResolutionDecks.size > 0;
  const hasUnsavedChanges =
    saving ||
    failedSaveDecks.size > 0 ||
    staleContentConflicts.size > 0 ||
    staleSlideFieldDrafts.size > 0 ||
    staleFullReplaceDrafts.size > 0;
  if (
    saving !== cachedSnapshot.saving ||
    hasUnsavedChanges !== cachedSnapshot.hasUnsavedChanges
  ) {
    cachedSnapshot = {
      ...cachedSnapshot,
      saving,
      hasUnsavedChanges,
    };
  }
}

function notifySaveListeners() {
  recomputeSnapshot();
  cachedSnapshot = {
    ...cachedSnapshot,
    revision: cachedSnapshot.revision + 1,
  };
  saveStateListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
  flushDeferredRemoteSyncs();
}

export function subscribeSaveState(listener: () => void): () => void {
  saveStateListeners.add(listener);
  return () => saveStateListeners.delete(listener);
}

export function hasUnsavedDeckChanges(deckId: string): boolean {
  return (
    pendingSaves.has(deckId) ||
    inFlightSaves.has(deckId) ||
    inFlightKeepaliveSaves.has(deckId) ||
    pendingOpsQueue.has(deckId) ||
    failedSaveDecks.has(deckId) ||
    staleContentConflicts.has(deckId) ||
    staleSlideFieldDrafts.has(deckId) ||
    staleFullReplaceDrafts.has(deckId) ||
    conflictResolutionDecks.has(deckId)
  );
}

export function hasFailedDeckSave(deckId: string): boolean {
  return (
    failedSaveDecks.has(deckId) ||
    staleContentConflicts.has(deckId) ||
    staleSlideFieldDrafts.has(deckId) ||
    staleFullReplaceDrafts.has(deckId)
  );
}

export function getDeckSaveError(deckId: string): DeckSaveError | undefined {
  if (!hasFailedDeckSave(deckId)) return undefined;
  return (
    deckSaveErrors.get(deckId) ??
    (staleContentConflicts.has(deckId) || staleFullReplaceDrafts.has(deckId)
      ? new DeckSaveError(
          deckId,
          { errorCode: "slide_content_conflict" },
          `Failed to save deck ${deckId}: unresolved slide content conflict; local draft retained`,
        )
      : staleSlideFieldDrafts.has(deckId)
        ? new DeckSaveError(
            deckId,
            { errorCode: "slide_field_conflict" },
            `Failed to save deck ${deckId}: unresolved slide field conflict; local draft retained`,
          )
        : new DeckSaveError(deckId))
  );
}

export function getStaleContentDraft(
  deckId: string,
  slideId: string,
): string | undefined {
  const content = staleContentDrafts.get(deckId)?.get(slideId)?.fields.content;
  return typeof content === "string" ? content : undefined;
}

export function getDeckContentConflicts(deckId: string): DeckContentConflict[] {
  if (!staleContentConflicts.has(deckId)) return [];
  const conflictIds = staleContentConflicts.get(deckId);
  const drafts = staleContentDrafts.get(deckId);
  const remoteSlides = staleContentRemoteSlides.get(deckId);
  const fullReplace = staleFullReplaceDrafts.get(deckId);
  const slideIds =
    conflictIds === null
      ? new Set([
          ...(drafts?.keys() ?? []),
          ...(remoteSlides?.keys() ?? []),
          ...(fullReplace?.slides.map((slide) => slide.id) ?? []),
        ])
      : new Set(conflictIds);

  return [...slideIds].flatMap((slideId) => {
    const localContent =
      drafts?.get(slideId)?.fields.content ??
      fullReplace?.slides.find((slide) => slide.id === slideId)?.content;
    if (typeof localContent !== "string") return [];
    const remote = remoteSlides?.get(slideId);
    return [
      {
        slideId,
        localContent,
        ...(remote
          ? {
              remoteContent: remote.content,
              remoteUpdatedAt: remote.updatedAt,
            }
          : {}),
        canResolve:
          conflictIds !== null &&
          !fullReplace &&
          !conflictResolutionDecks.has(deckId) &&
          drafts?.has(slideId) === true,
      },
    ];
  });
}

export function useDeckContentConflicts(
  deckId: string | null,
): DeckContentConflict[] {
  useSyncExternalStore(
    subscribeSaveState,
    getSaveSnapshot,
    () => serverSaveSnapshot,
  );
  return deckId ? getDeckContentConflicts(deckId) : [];
}

function rememberStaleContentRemoteSlides(
  deckId: string,
  remoteDeck: Deck | null,
  slideIds: Iterable<string>,
) {
  if (!remoteDeck) return;
  const byId = new Map(remoteDeck.slides.map((slide) => [slide.id, slide]));
  const remoteSlides = staleContentRemoteSlides.get(deckId) ?? new Map();
  for (const slideId of slideIds) {
    const slide = byId.get(slideId);
    remoteSlides.set(slideId, {
      content: slide?.content ?? null,
      updatedAt: remoteDeck.updatedAt,
    });
  }
  staleContentRemoteSlides.set(deckId, remoteSlides);
}

function clearStaleContentConflict(deckId: string, slideId: string): boolean {
  const conflicts = staleContentConflicts.get(deckId);
  if (conflicts === null || !conflicts?.has(slideId)) return false;
  const remaining = new Set(conflicts);
  remaining.delete(slideId);
  if (remaining.size > 0) staleContentConflicts.set(deckId, remaining);
  else staleContentConflicts.delete(deckId);

  const drafts = staleContentDrafts.get(deckId);
  drafts?.delete(slideId);
  if (drafts?.size === 0) staleContentDrafts.delete(deckId);
  const remoteSlides = staleContentRemoteSlides.get(deckId);
  remoteSlides?.delete(slideId);
  if (remoteSlides?.size === 0) staleContentRemoteSlides.delete(deckId);
  const retrySlides = staleContentRetrySlides.get(deckId);
  retrySlides?.delete(slideId);
  if (retrySlides?.size === 0) staleContentRetrySlides.delete(deckId);
  const sent = sentSlideContent.get(deckId);
  sent?.delete(slideId);
  if (sent?.size === 0) sentSlideContent.delete(deckId);
  return true;
}

export function getStaleContentConflictSlideId(
  deckId: string,
): string | undefined {
  const conflicts = staleContentConflicts.get(deckId);
  return conflicts?.values().next().value;
}

function hasStaleContentConflict(deckId: string, slideId: string): boolean {
  const conflicts = staleContentConflicts.get(deckId);
  return conflicts === null || conflicts?.has(slideId) === true;
}

function holdStaleFullReplace(
  deckId: string,
  deck: Deck,
  conflictingSlideIds: ReadonlySet<string> | null,
) {
  staleFullReplaceDrafts.set(deckId, deck);
  const previous = staleContentConflicts.get(deckId);
  if (previous === null || conflictingSlideIds === null) {
    staleContentConflicts.set(deckId, null);
  } else {
    const conflicts = new Set(previous ?? []);
    for (const slideId of conflictingSlideIds) conflicts.add(slideId);
    staleContentConflicts.set(deckId, conflicts.size > 0 ? conflicts : null);
  }

  pendingOpsQueue.delete(deckId);
  const timer = pendingSaves.get(deckId);
  if (timer) clearTimeout(timer);
  pendingSaves.delete(deckId);
  pendingPersistedResultHandlers.delete(deckId);
  immediateFlushRequests.delete(deckId);
  markDeckSaveFailed(
    deckId,
    {
      errorCode: "slide_content_conflict",
    },
    `Failed to save deck ${deckId}: unresolved slide content conflict; local draft retained`,
  );
  notifySaveListeners();
}

function deckWithQueuedFullReplaceOps(ops: GranularOp[]): Deck | null {
  const replacementIndex = ops.findIndex((op) => op.op === "full-replace");
  const replacement = ops[replacementIndex];
  if (replacement?.op !== "full-replace") return null;

  return ops
    .slice(replacementIndex + 1)
    .reduce(
      (deck, op) =>
        op.op === "full-replace" ? op.deck : applyOpToDeck(deck, op),
      replacement.deck,
    );
}

export function getSaveSnapshot(): SaveStateSnapshot {
  return cachedSnapshot;
}

function deckPayload(deck: Deck): Record<string, unknown> {
  return { ...deck };
}

function requireKeepaliveAction<TResult>(
  actionName: string,
  attempt: KeepaliveActionCallResult<TResult>,
): Promise<TResult> {
  if (!attempt.accepted) {
    throw new Error(
      `Keepalive ${actionName} was not started (${attempt.reason}; ${attempt.bodyBytes} bytes)`,
    );
  }
  return attempt.completion;
}

async function callDeckWriteAction<TResult>(
  actionName: string,
  deckId: string,
  payload: Record<string, unknown>,
  options?: {
    keepalive?: boolean;
    method?: "POST" | "PUT";
    signal?: AbortSignal;
  },
): Promise<TResult> {
  const body = {
    deckId,
    ...payload,
    clientWrite: nextDeckClientWrite(deckId),
  };
  let result: TResult;
  try {
    result = options?.keepalive
      ? await requireKeepaliveAction(
          actionName,
          tryCallActionKeepalive<TResult>(actionName, body, {
            method: options.method,
            signal: options.signal,
          }),
        )
      : await callAction<TResult>(actionName, body, {
          ...(options?.method ? { method: options.method } : {}),
          ...(options?.signal ? { signal: options.signal } : {}),
        });
  } catch (error) {
    const operations = payload.operations;
    const mergeablePatch =
      actionName === "patch-deck" && isMergeSafeDeckPatchOperations(operations);
    if (mergeablePatch && isDeckRevisionConflict(error)) {
      const latest = await readDeckFromAPI(deckId);
      if (latest.status === "ok") {
        rememberDeckServerRevision(deckId, latest.deck);
      }
      if (isDeckRevisionConflict(error)) {
        throw revisionConflictError(error, latest.status === "ok");
      }
    }
    throw error;
  }
  rememberDeckServerRevision(deckId, result);
  return result;
}

async function persistDeckOps(
  deckId: string,
  ops: GranularOp[],
  signal?: AbortSignal,
  options?: { keepalive?: boolean },
): Promise<unknown[]> {
  if (options?.keepalive) {
    const results: unknown[] = [];
    if (ops[0].op === "full-replace") {
      const deck = ops[0].deck;
      results.push(
        await callDeckWriteAction(
          "save-deck",
          deckId,
          { deck: deckPayload(deck) },
          { keepalive: true, method: "PUT", signal },
        ),
      );
      const trailingOps = ops.slice(1) as PatchDeckOp[];
      if (trailingOps.length > 0) {
        results.push(
          await callDeckWriteAction(
            "patch-deck",
            deckId,
            { operations: trailingOps },
            { keepalive: true, signal },
          ),
        );
      }
    } else {
      results.push(
        await callDeckWriteAction(
          "patch-deck",
          deckId,
          { operations: ops as PatchDeckOp[] },
          { keepalive: true, signal },
        ),
      );
    }
    deckKeepaliveSuccessGenerations.set(
      deckId,
      (deckKeepaliveSuccessGenerations.get(deckId) ?? 0) + 1,
    );
    return results;
  }

  const results: unknown[] = [];
  if (ops[0].op === "full-replace") {
    const deck = ops[0].deck;
    results.push(
      await callDeckWriteAction<unknown>(
        "save-deck",
        deckId,
        { deck: deckPayload(deck) },
        { method: "PUT", signal },
      ),
    );
    const trailingOps = ops.slice(1) as PatchDeckOp[];
    if (trailingOps.length > 0) {
      results.push(
        await callDeckWriteAction<unknown>(
          "patch-deck",
          deckId,
          { operations: trailingOps },
          { signal },
        ),
      );
    }
  } else {
    results.push(
      await callDeckWriteAction<unknown>(
        "patch-deck",
        deckId,
        { operations: ops as PatchDeckOp[] },
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

function drainPendingDeckOps(
  deckId: string,
  options?: { keepalive?: boolean },
): Promise<void> {
  if (
    conflictResolutionDecks.has(deckId) ||
    staleFullReplaceDrafts.has(deckId)
  ) {
    return Promise.resolve();
  }

  const timer = pendingSaves.get(deckId);
  if (timer) clearTimeout(timer);
  pendingSaves.delete(deckId);

  const active = inFlightSaveChains.get(deckId);
  if (active) {
    const keepaliveAlreadyRequested =
      immediateFlushRequests.get(deckId) === true;
    immediateFlushRequests.set(
      deckId,
      (immediateFlushRequests.get(deckId) ?? false) ||
        options?.keepalive === true,
    );
    const activeOps = inFlightOpSlides.get(deckId);
    const controller = inFlightSaveControllers.get(deckId);
    if (
      options?.keepalive &&
      !keepaliveAlreadyRequested &&
      !inFlightKeepaliveSaves.has(deckId) &&
      activeOps?.length
    ) {
      const queuedOps = pendingOpsQueue.get(deckId) ?? [];
      const replacementIndex = queuedOps.findIndex(
        (op) => op.op === "full-replace",
      );
      const keepaliveCandidates = [...activeOps, ...queuedOps];
      const unverifiedReplacement = keepaliveCandidates.find(
        (op) => op.op === "full-replace" && !verifiedFullReplaceOps.has(op),
      );
      if (unverifiedReplacement?.op === "full-replace") {
        const draft = deckWithQueuedFullReplaceOps(keepaliveCandidates);
        if (draft) holdStaleFullReplace(deckId, draft, null);
      } else {
        const keepaliveOps =
          replacementIndex >= 0
            ? queuedOps.slice(replacementIndex)
            : collapseKeepaliveSlidePatches([...activeOps, ...queuedOps]);
        const coveredQueuedOps =
          replacementIndex >= 0 ? queuedOps.slice(replacementIndex) : queuedOps;
        const coveredSlideSequences = new Map(
          slideLocalWriteSequences.get(deckId) ?? [],
        );
        const keepaliveSave = persistDeckOps(
          deckId,
          keepaliveOps,
          controller?.signal,
          { keepalive: true },
        ).then(
          (results) => {
            acknowledgeKeepaliveDeckOps(
              deckId,
              keepaliveOps,
              coveredQueuedOps,
              coveredSlideSequences,
              results,
            );
          },
          (err) => {
            if (!controller?.signal.aborted) {
              console.error(`Failed to keepalive save deck ${deckId}:`, err);
            }
            throw err;
          },
        );
        inFlightKeepaliveSaves.set(deckId, keepaliveSave);
        const clearKeepaliveSave = () => {
          if (inFlightKeepaliveSaves.get(deckId) === keepaliveSave) {
            inFlightKeepaliveSaves.delete(deckId);
            notifySaveListeners();
          }
        };
        void keepaliveSave.then(clearKeepaliveSave, clearKeepaliveSave);
      }
    }
    notifySaveListeners();
    return active;
  }

  const activeKeepalive = inFlightKeepaliveSaves.get(deckId);
  if (activeKeepalive) {
    return activeKeepalive.then(() => drainPendingDeckOps(deckId, options));
  }

  const ops = pendingOpsQueue.get(deckId) ?? [];
  const queuedReplacement = options?.keepalive ? ops[0] : undefined;
  if (
    queuedReplacement?.op === "full-replace" &&
    !verifiedFullReplaceOps.has(queuedReplacement)
  ) {
    const draft = deckWithQueuedFullReplaceOps(ops);
    if (draft) holdStaleFullReplace(deckId, draft, null);
    return Promise.resolve();
  }
  pendingOpsQueue.delete(deckId);
  for (const op of ops) {
    if (op.op !== "patch-slide" || typeof op.fields.content !== "string") {
      continue;
    }
    const sent =
      sentSlideContent.get(deckId) ??
      new Map<string, { content: string; over: string }>();
    const over = draftCommittedContent.get(op);
    if (over === undefined) sent.delete(op.slideId);
    else sent.set(op.slideId, { content: op.fields.content, over });
    if (sent.size > 0) sentSlideContent.set(deckId, sent);
    else sentSlideContent.delete(deckId);
  }
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
  const keepaliveSuccessGenerationAtStart =
    deckKeepaliveSuccessGenerations.get(deckId) ?? 0;
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
      if (
        (deckKeepaliveSuccessGenerations.get(deckId) ?? 0) <=
        keepaliveSuccessGenerationAtStart
      ) {
        rememberPersistedSlideContent(deckId, ops);
      }
      clearPersistedStaleSlideFieldDrafts(deckId, ops);
      for (const { handler, slideWriteSequences } of persistedResultHandlers) {
        handler(results, slideWriteSequences);
      }
      onSaveSuccess?.(ops);
      deckSaveRetryAttempts.delete(deckId);
      deckRevisionConflictRetryAttempts.delete(deckId);
      clearDeckSaveFailure(deckId);
      const mergedDrafts = mergedSlideDrafts.get(deckId);
      if (mergedDrafts) {
        for (const op of ops) {
          const draft =
            op.op === "patch-slide" ? mergedDrafts.get(op.slideId) : undefined;
          if (op.op !== "patch-slide" || draft === undefined) continue;
          mergedDrafts.delete(op.slideId);
          rememberConfirmedSlideContent(deckId, op.slideId, draft);
          const sent = sentSlideContent.get(deckId)?.get(op.slideId);
          if (sent) sent.content = draft;
          deferredRemoteSyncDecks.add(deckId);
        }
        if (mergedDrafts.size === 0) mergedSlideDrafts.delete(deckId);
      }
    })
    .catch(async (err) => {
      if (!isCurrentGeneration()) return;
      const keepaliveSave = inFlightKeepaliveSaves.get(deckId);
      let replayedByKeepalive =
        (deckKeepaliveSuccessGenerations.get(deckId) ?? 0) >
        keepaliveSuccessGenerationAtStart;
      if (!replayedByKeepalive && keepaliveSave) {
        const [keepaliveResult] = await Promise.allSettled([keepaliveSave]);
        replayedByKeepalive = keepaliveResult?.status === "fulfilled";
      }
      if (!isCurrentGeneration()) return;
      const handledConflict =
        Boolean(
          err &&
          typeof err === "object" &&
          "errorCode" in err &&
          err.errorCode === "slide_content_stale",
        ) || isDeckRevisionConflict(err);
      if (!handledConflict) {
        console.error(`Failed to save deck ${deckId}:`, err);
      }
      const pending = pendingOpsQueue.get(deckId) ?? [];
      const pendingHandlers = pendingPersistedResultHandlers.get(deckId) ?? [];
      if (
        err &&
        typeof err === "object" &&
        "errorCode" in err &&
        err.errorCode === "slide_content_stale"
      ) {
        let canRetryPendingOps = true;
        if (replayedByKeepalive && pending[0]?.op !== "full-replace") {
          if (pending.length > 0) pendingOpsQueue.set(deckId, pending);
          else pendingOpsQueue.delete(deckId);
          if (pendingHandlers.length > 0) {
            pendingPersistedResultHandlers.set(deckId, pendingHandlers);
          } else {
            pendingPersistedResultHandlers.delete(deckId);
          }
          clearDeckSaveFailure(deckId);
        } else {
          const latest = deckOrNull(await readDeckFromAPI(deckId));
          canRetryPendingOps = latest !== null;
          if (latest) rememberDeckServerRevision(deckId, latest);
          const details =
            "details" in err && err.details && typeof err.details === "object"
              ? (err.details as Record<string, unknown>)
              : undefined;
          const attemptedContentSlideIds = new Set(
            ops.flatMap((op) =>
              op.op === "patch-slide" && typeof op.fields.content === "string"
                ? [op.slideId]
                : [],
            ),
          );
          const conflictedSlideIds =
            typeof details?.slideId === "string"
              ? new Set([details.slideId])
              : attemptedContentSlideIds;
          const previousConflicts = staleContentConflicts.get(deckId);
          const retrySlides = staleContentRetrySlides.get(deckId) ?? new Set();
          const remoteDeck = latest;
          if (!isCurrentGeneration()) return;
          const latestPending = pendingOpsQueue.has(deckId)
            ? (pendingOpsQueue.get(deckId) ?? [])
            : pending;
          const latestPendingHandlers = pendingPersistedResultHandlers.has(
            deckId,
          )
            ? (pendingPersistedResultHandlers.get(deckId) ?? [])
            : pendingHandlers;
          if (latestPending[0]?.op === "full-replace") {
            const replacement = latestPending[0];
            const replacementDraft =
              deckWithQueuedFullReplaceOps(latestPending);
            const conflicts = fullReplaceConflictSlides(
              deckId,
              replacementDraft ?? replacement.deck,
              remoteDeck,
              ops,
            );
            if (
              staleContentConflicts.has(deckId) ||
              conflicts === null ||
              conflicts.size > 0
            ) {
              const heldSlideIds = conflicts ?? new Set<string>();
              if (conflicts === null) {
                for (const op of ops) {
                  if (
                    op.op === "patch-slide" &&
                    typeof op.fields.content === "string"
                  ) {
                    heldSlideIds.add(op.slideId);
                  }
                }
              }
              for (const op of ops) {
                if (
                  op.op !== "patch-slide" ||
                  typeof op.fields.content !== "string" ||
                  (conflicts !== null && !heldSlideIds.has(op.slideId))
                ) {
                  continue;
                }
                const drafts = staleContentDrafts.get(deckId) ?? new Map();
                const previous = drafts.get(op.slideId);
                const baseFields = mergeSlideFieldBaselines(
                  previous?.baseFields,
                  op.baseFields,
                );
                drafts.set(op.slideId, {
                  ...op,
                  fields: { ...previous?.fields, ...op.fields },
                  ...(baseFields ? { baseFields } : {}),
                });
                staleContentDrafts.set(deckId, drafts);
              }
              rememberStaleContentRemoteSlides(
                deckId,
                remoteDeck,
                heldSlideIds,
              );
              holdStaleFullReplace(
                deckId,
                replacementDraft ?? replacement.deck,
                conflicts,
              );
              deckSaveRetryAttempts.delete(deckId);
              deckRevisionConflictRetryAttempts.delete(deckId);
              return;
            }

            verifiedFullReplaceOps.add(replacement);
            pendingOpsQueue.set(deckId, latestPending);
            if (latestPendingHandlers.length > 0) {
              pendingPersistedResultHandlers.set(deckId, latestPendingHandlers);
            } else {
              pendingPersistedResultHandlers.delete(deckId);
            }
            clearDeckSaveFailure(deckId);
            deckSaveRetryAttempts.delete(deckId);
            deckRevisionConflictRetryAttempts.delete(deckId);
            immediateFlushRequests.set(
              deckId,
              immediateFlushRequests.get(deckId) ?? false,
            );
            return;
          }
          const allOps = [...ops, ...latestPending];
          const contentOps = allOps.filter(
            (op): op is Extract<GranularOp, { op: "patch-slide" }> =>
              op.op === "patch-slide" && typeof op.fields.content === "string",
          );
          const remoteSlides = new Map(
            remoteDeck?.slides.map((slide) => [slide.id, slide]) ?? [],
          );
          const attemptedContentHashes = new Map<string, Set<string>>();
          for (const op of ops) {
            if (
              op.op !== "patch-slide" ||
              typeof op.fields.content !== "string"
            ) {
              continue;
            }
            const hashes =
              attemptedContentHashes.get(op.slideId) ?? new Set<string>();
            hashes.add(hashSlideContent(op.fields.content));
            attemptedContentHashes.set(op.slideId, hashes);
          }
          const safeToRebase = new Map<string, string>();
          const mergedContent = new Map<string, string>();
          const conflicts = new Set(previousConflicts ?? []);
          const candidateSlideIds = new Set([
            ...contentOps.map((op) => op.slideId),
            ...conflictedSlideIds,
          ]);
          const globallyConflicted =
            (staleContentConflicts.has(deckId) && previousConflicts === null) ||
            candidateSlideIds.size === 0;
          for (const slideId of candidateSlideIds) {
            const remoteSlide = remoteSlides.get(slideId);
            const confirmedHash = confirmedSlideContentHash(deckId, slideId);
            const remoteHash = remoteSlide
              ? hashSlideContent(remoteSlide.content)
              : undefined;
            if (
              !globallyConflicted &&
              !conflicts.has(slideId) &&
              !retrySlides.has(slideId) &&
              remoteHash &&
              (remoteHash === confirmedHash ||
                attemptedContentHashes.get(slideId)?.has(remoteHash))
            ) {
              safeToRebase.set(slideId, remoteHash);
              retrySlides.add(slideId);
              continue;
            }
            const merged =
              !globallyConflicted &&
              !conflicts.has(slideId) &&
              remoteHash &&
              remoteSlide
                ? mergeConflictedDraft(
                    deckId,
                    slideId,
                    allOps,
                    remoteSlide.content,
                  )
                : null;
            if (merged !== null && remoteHash) {
              mergedContent.set(slideId, merged);
              safeToRebase.set(slideId, remoteHash);
              retrySlides.add(slideId);
            } else {
              conflicts.add(slideId);
            }
          }
          if (safeToRebase.size > 0) {
            staleContentRetrySlides.set(deckId, retrySlides);
          }
          if (conflicts.size > 0) {
            const drafts = staleContentDrafts.get(deckId) ?? new Map();
            for (const slideId of conflicts) {
              let held: Extract<GranularOp, { op: "patch-slide" }> | undefined;
              for (const op of allOps) {
                if (
                  op.op !== "patch-slide" ||
                  op.slideId !== slideId ||
                  typeof op.fields.content !== "string"
                ) {
                  continue;
                }
                const baseFields = mergeSlideFieldBaselines(
                  held?.baseFields,
                  op.baseFields,
                );
                held = {
                  ...op,
                  fields: { ...held?.fields, ...op.fields },
                  ...(baseFields ? { baseFields } : {}),
                };
              }
              if (held) drafts.set(slideId, held);
            }
            if (drafts.size > 0) staleContentDrafts.set(deckId, drafts);
            rememberStaleContentRemoteSlides(deckId, remoteDeck, conflicts);
          }
          const rebasedContentOps = new Map<
            string,
            { index: number; op: Extract<GranularOp, { op: "patch-slide" }> }
          >();
          for (const [index, op] of allOps.entries()) {
            if (
              op.op !== "patch-slide" ||
              typeof op.fields.content !== "string" ||
              !safeToRebase.has(op.slideId)
            ) {
              continue;
            }
            const previous = rebasedContentOps.get(op.slideId);
            const baseFields = mergeSlideFieldBaselines(
              previous?.op.baseFields,
              op.baseFields,
            );
            const rebasedOp = {
              ...op,
              fields: { ...previous?.op.fields, ...op.fields },
              ...(baseFields ? { baseFields } : {}),
              baseContentHash: safeToRebase.get(op.slideId),
            };
            const merged = mergedContent.get(op.slideId);
            if (merged !== undefined) {
              const drafts = mergedSlideDrafts.get(deckId) ?? new Map();
              if (!drafts.has(op.slideId)) {
                drafts.set(op.slideId, rebasedOp.fields.content as string);
              }
              mergedSlideDrafts.set(deckId, drafts);
              rebasedOp.fields.content = merged;
            }
            const remoteContent = remoteSlides.get(op.slideId)?.content;
            if (typeof remoteContent === "string") {
              draftCommittedContent.set(rebasedOp, remoteContent);
            }
            rebasedContentOps.set(op.slideId, {
              index,
              op: rebasedOp,
            });
          }
          const isUnrecoverableContent = (op: GranularOp) =>
            op.op === "patch-slide" &&
            typeof op.fields.content === "string" &&
            (globallyConflicted || conflicts.has(op.slideId));
          const retryable: GranularOp[] = [];
          const retryableOps: GranularOp[] = [];
          const retryablePending: GranularOp[] = [];
          for (const [index, op] of allOps.entries()) {
            let retryOp: GranularOp | undefined;
            if (op.op === "patch-slide" && isUnrecoverableContent(op)) {
              const withoutContent = { ...op, fields: { ...op.fields } };
              delete withoutContent.fields.content;
              delete withoutContent.baseContentHash;
              if (Object.keys(withoutContent.fields).length > 0) {
                retryOp = withoutContent;
              }
            } else if (
              op.op === "patch-slide" &&
              typeof op.fields.content === "string" &&
              safeToRebase.has(op.slideId)
            ) {
              const rebased = rebasedContentOps.get(op.slideId);
              if (rebased?.index === index) retryOp = rebased.op;
            } else {
              retryOp = op;
            }
            if (!retryOp) continue;
            retryable.push(retryOp);
            if (index < ops.length) retryableOps.push(retryOp);
            else retryablePending.push(retryOp);
          }
          if (retryable.length > 0) pendingOpsQueue.set(deckId, retryable);
          else pendingOpsQueue.delete(deckId);
          if (conflicts.size > 0 || globallyConflicted) {
            staleContentConflicts.set(
              deckId,
              globallyConflicted ? null : conflicts,
            );
          }

          const keepSafeHandlers = (
            entries: PendingPersistedResultHandler[],
            retryableLayoutFitSlideIds: ReadonlySet<string>,
          ) =>
            entries.flatMap(({ handler, slideWriteSequences }) => {
              const safeSequences = new Map(
                [...slideWriteSequences].filter(
                  ([slideId]) =>
                    (!globallyConflicted && !conflicts.has(slideId)) ||
                    retryableLayoutFitSlideIds.has(slideId),
                ),
              );
              return safeSequences.size > 0
                ? [{ handler, slideWriteSequences: safeSequences }]
                : [];
            });
          const retryableLayoutFitSlideIds = new Set(
            retryableOps.flatMap(layoutFitSlideIdsForOp),
          );
          const retryablePendingLayoutFitSlideIds = new Set(
            retryablePending.flatMap(layoutFitSlideIdsForOp),
          );
          const handlers = [
            ...(retryableOps.length > 0
              ? keepSafeHandlers(
                  persistedResultHandlers,
                  retryableLayoutFitSlideIds,
                )
              : []),
            ...keepSafeHandlers(
              latestPendingHandlers,
              retryablePendingLayoutFitSlideIds,
            ),
          ];
          if (handlers.length > 0) {
            pendingPersistedResultHandlers.set(deckId, handlers);
          } else {
            pendingPersistedResultHandlers.delete(deckId);
          }
          if (latest || retryable.length === 0) {
            clearDeckSaveFailure(deckId);
          } else {
            markDeckSaveFailed(
              deckId,
              err,
              `Failed to save deck ${deckId}: unresolved slide content conflict; local draft retained`,
            );
          }
        }
        deckSaveRetryAttempts.delete(deckId);
        deckRevisionConflictRetryAttempts.delete(deckId);
        if (failedSaveDecks.has(deckId) && !canRetryPendingOps) {
          deckSaveRetryAttempts.set(deckId, MAX_DECK_SAVE_RETRIES + 1);
        }
        if (pendingOpsQueue.has(deckId)) {
          if (!pendingSaves.has(deckId) && canRetryPendingOps) {
            immediateFlushRequests.set(
              deckId,
              immediateFlushRequests.get(deckId) ?? false,
            );
          } else if (!canRetryPendingOps) {
            immediateFlushRequests.delete(deckId);
          }
        } else {
          immediateFlushRequests.delete(deckId);
        }
        return;
      }

      if (
        err &&
        typeof err === "object" &&
        "errorCode" in err &&
        err.errorCode === "slide_field_stale" &&
        ops[0]?.op !== "full-replace"
      ) {
        if (replayedByKeepalive && pending[0]?.op !== "full-replace") {
          if (pending.length > 0) pendingOpsQueue.set(deckId, pending);
          else pendingOpsQueue.delete(deckId);
          if (pendingHandlers.length > 0) {
            pendingPersistedResultHandlers.set(deckId, pendingHandlers);
          } else {
            pendingPersistedResultHandlers.delete(deckId);
          }
          clearDeckSaveFailure(deckId);
          deckSaveRetryAttempts.delete(deckId);
          deckRevisionConflictRetryAttempts.delete(deckId);
          return;
        }

        const details =
          "details" in err && err.details && typeof err.details === "object"
            ? (err.details as Record<string, unknown>)
            : undefined;
        const slideId =
          typeof details?.slideId === "string" ? details.slideId : undefined;
        const fieldName =
          typeof details?.field === "string" ? details.field : undefined;
        const latest = deckOrNull(await readDeckFromAPI(deckId));
        if (!isCurrentGeneration()) return;
        if (latest) rememberDeckServerRevision(deckId, latest);
        const latestPending = pendingOpsQueue.has(deckId)
          ? (pendingOpsQueue.get(deckId) ?? [])
          : pending;
        const latestPendingHandlers = pendingPersistedResultHandlers.has(deckId)
          ? (pendingPersistedResultHandlers.get(deckId) ?? [])
          : pendingHandlers;
        const remoteSlide = latest?.slides.find(
          (slide) => slide.id === slideId,
        );
        const allOps = [...ops, ...latestPending];
        const conflictingOps = allOps.filter(
          (op) =>
            op.op === "patch-slide" &&
            op.slideId === slideId &&
            fieldName !== undefined &&
            Object.hasOwn(op.fields, fieldName),
        );
        if (
          latest &&
          remoteSlide &&
          slideId &&
          fieldName &&
          conflictingOps.length > 0
        ) {
          const field = fieldName as PatchSlideBaselineField;
          const localValue = (
            conflictingOps[conflictingOps.length - 1] as Extract<
              GranularOp,
              { op: "patch-slide" }
            >
          ).fields[field];
          const remoteValue = (
            remoteSlide as unknown as Record<string, unknown>
          )[field];
          rememberStaleSlideFieldDraft(deckId, {
            slideId,
            field,
            localValue,
            remoteBaseline:
              remoteValue === undefined
                ? { present: false }
                : { present: true, value: structuredClone(remoteValue) },
          });

          const retryableOps: GranularOp[] = [];
          const retryablePending: GranularOp[] = [];
          for (const [index, op] of allOps.entries()) {
            let retryOp = op;
            if (
              op.op === "patch-slide" &&
              op.slideId === slideId &&
              Object.hasOwn(op.fields, field)
            ) {
              const fields = { ...op.fields };
              delete (fields as Record<string, unknown>)[field];
              const baseFields = { ...op.baseFields };
              delete baseFields[field];
              if (Object.keys(fields).length === 0) continue;
              const retryPatch: typeof op = { ...op, fields };
              if (Object.keys(baseFields).length > 0) {
                retryPatch.baseFields = baseFields;
              } else {
                delete retryPatch.baseFields;
              }
              retryOp = retryPatch;
            }
            if (index < ops.length) retryableOps.push(retryOp);
            else retryablePending.push(retryOp);
          }

          const retryable = [...retryableOps, ...retryablePending];
          if (retryable.length > 0) pendingOpsQueue.set(deckId, retryable);
          else pendingOpsQueue.delete(deckId);
          const retryableLayoutFitSlideIds = new Set(
            retryable.flatMap(layoutFitSlideIdsForOp),
          );
          const handlers = [
            ...persistedResultHandlers,
            ...latestPendingHandlers,
          ].flatMap(({ handler, slideWriteSequences }) => {
            const safeSequences = new Map(
              [...slideWriteSequences].filter(([id]) =>
                retryableLayoutFitSlideIds.has(id),
              ),
            );
            return safeSequences.size > 0
              ? [{ handler, slideWriteSequences: safeSequences }]
              : [];
          });
          if (handlers.length > 0) {
            pendingPersistedResultHandlers.set(deckId, handlers);
          } else {
            pendingPersistedResultHandlers.delete(deckId);
          }
          clearDeckSaveFailure(deckId);
          deckSaveRetryAttempts.delete(deckId);
          deckRevisionConflictRetryAttempts.delete(deckId);
          const timer = pendingSaves.get(deckId);
          if (timer) clearTimeout(timer);
          pendingSaves.delete(deckId);
          if (retryable.length > 0) {
            immediateFlushRequests.set(
              deckId,
              immediateFlushRequests.get(deckId) ?? false,
            );
          } else {
            immediateFlushRequests.delete(deckId);
          }
          return;
        }
      }

      if (staleFullReplaceDrafts.has(deckId)) {
        pendingOpsQueue.delete(deckId);
        pendingPersistedResultHandlers.delete(deckId);
        markDeckSaveFailed(
          deckId,
          {
            errorCode: "slide_content_conflict",
          },
          `Failed to save deck ${deckId}: unresolved slide content conflict; local draft retained`,
        );
        return;
      }

      if (!replayedByKeepalive) {
        pendingOpsQueue.set(
          deckId,
          pending[0]?.op === "full-replace" ? pending : [...ops, ...pending],
        );
      }
      const handlers =
        pending[0]?.op === "full-replace" || replayedByKeepalive
          ? pendingHandlers
          : [...persistedResultHandlers, ...pendingHandlers];
      if (handlers.length > 0) {
        pendingPersistedResultHandlers.set(deckId, handlers);
      } else {
        pendingPersistedResultHandlers.delete(deckId);
      }

      const attempt = (deckSaveRetryAttempts.get(deckId) ?? 0) + 1;
      deckSaveRetryAttempts.set(deckId, attempt);
      const retryableRevisionConflict =
        isDeckRevisionConflict(err) && didRefreshDeckRevision(err);
      const revisionConflictAttempt = retryableRevisionConflict
        ? (deckRevisionConflictRetryAttempts.get(deckId) ?? 0) + 1
        : 0;
      if (retryableRevisionConflict) {
        deckRevisionConflictRetryAttempts.set(deckId, revisionConflictAttempt);
      }
      immediateFlushRequests.delete(deckId);
      const pendingTimer = pendingSaves.get(deckId);
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingSaves.delete(deckId);
      const isTerminalClientError = isTerminalClientSaveError(err);
      const shouldRetry = isTerminalClientError
        ? false
        : retryableRevisionConflict
          ? revisionConflictAttempt <= MAX_DECK_REVISION_CONFLICT_RETRIES
          : attempt <= MAX_DECK_SAVE_RETRIES;
      if (shouldRetry) {
        const delay = retryableRevisionConflict
          ? deckRevisionConflictRetryDelay(revisionConflictAttempt)
          : DECK_SAVE_RETRY_BASE_MS * 2 ** (attempt - 1);
        const retryTimer = setTimeout(() => {
          void drainPendingDeckOps(deckId);
        }, delay);
        pendingSaves.set(deckId, retryTimer);
      } else {
        markDeckSaveFailed(deckId, err);
        deckSaveRetryAttempts.set(deckId, MAX_DECK_SAVE_RETRIES + 1);
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
          const flush = () =>
            void drainPendingDeckOps(
              deckId,
              requestedFlush ? { keepalive: true } : undefined,
            );
          const keepaliveSave = inFlightKeepaliveSaves.get(deckId);
          if (keepaliveSave) void keepaliveSave.then(flush, flush);
          else flush();
        }
      }
    });
  inFlightSaveChains.set(deckId, next);
  notifySaveListeners();
  return next;
}

function acknowledgeKeepaliveDeckOps(
  deckId: string,
  persistedOps: GranularOp[],
  coveredQueuedOps: GranularOp[],
  coveredSlideSequences: Map<string, number>,
  results: unknown[],
) {
  clearPersistedStaleSlideFieldDrafts(deckId, persistedOps);
  rememberPersistedSlideContent(deckId, persistedOps);
  const acknowledgedContent = new Map<string, string>();
  const sent = sentSlideContent.get(deckId) ?? new Map();
  for (const op of persistedOps) {
    if (op.op !== "patch-slide" || typeof op.fields.content !== "string") {
      continue;
    }
    acknowledgedContent.set(op.slideId, op.fields.content);
    sent.set(op.slideId, {
      content: op.fields.content,
      over: sent.get(op.slideId)?.over ?? draftCommittedContent.get(op) ?? "",
    });
  }
  if (sent.size > 0) sentSlideContent.set(deckId, sent);

  const coveredOps = new Set(coveredQueuedOps);
  const currentQueue = pendingOpsQueue.get(deckId) ?? [];
  const remaining = currentQueue
    .filter((op) => !coveredOps.has(op))
    .map((op) => {
      if (
        op.op !== "patch-slide" ||
        typeof op.fields.content !== "string" ||
        !acknowledgedContent.has(op.slideId)
      ) {
        return op;
      }
      return {
        ...op,
        baseContentHash: hashSlideContent(acknowledgedContent.get(op.slideId)!),
      };
    });
  if (remaining.length > 0) pendingOpsQueue.set(deckId, remaining);
  else pendingOpsQueue.delete(deckId);

  const coveredSlideIds = new Set(
    coveredQueuedOps.flatMap((op) => layoutFitSlideIdsForOp(op)),
  );
  const handlers = pendingPersistedResultHandlers.get(deckId) ?? [];
  const settled: PendingPersistedResultHandler[] = [];
  const retained: PendingPersistedResultHandler[] = [];
  for (const entry of handlers) {
    const isCovered = [...entry.slideWriteSequences].every(
      ([slideId, sequence]) =>
        coveredSlideIds.has(slideId) &&
        sequence <= (coveredSlideSequences.get(slideId) ?? 0),
    );
    (isCovered ? settled : retained).push(entry);
  }
  for (const entry of settled) {
    entry.handler(results, entry.slideWriteSequences);
  }
  if (retained.length > 0) {
    pendingPersistedResultHandlers.set(deckId, retained);
  } else {
    pendingPersistedResultHandlers.delete(deckId);
  }
}

function collapseKeepaliveSlidePatches(ops: GranularOp[]): GranularOp[] {
  const latestBySlide = new Map<
    string,
    { index: number; op: Extract<GranularOp, { op: "patch-slide" }> }
  >();
  const firstContentHashBySlide = new Map<string, string | undefined>();

  for (const [index, op] of ops.entries()) {
    if (op.op !== "patch-slide") continue;
    const previous = latestBySlide.get(op.slideId)?.op;
    if (typeof op.fields.content === "string") {
      if (!firstContentHashBySlide.has(op.slideId)) {
        firstContentHashBySlide.set(op.slideId, op.baseContentHash);
      }
    }
    const baseFields = mergeSlideFieldBaselines(
      previous?.baseFields,
      op.baseFields,
    );
    const merged = {
      ...op,
      fields: { ...previous?.fields, ...op.fields },
      ...(baseFields ? { baseFields } : {}),
      ...(typeof op.fields.content === "string" ||
      typeof previous?.fields.content === "string"
        ? {
            baseContentHash:
              firstContentHashBySlide.get(op.slideId) ?? op.baseContentHash,
          }
        : {}),
    };
    latestBySlide.set(op.slideId, { index, op: merged });
  }

  const collapsed: GranularOp[] = [];
  for (const [index, op] of ops.entries()) {
    if (op.op !== "patch-slide") {
      collapsed.push(op);
      continue;
    }
    const latest = latestBySlide.get(op.slideId);
    if (latest?.index !== index) continue;
    collapsed.push(latest.op);
  }
  return collapsed;
}

async function flushDeckSave(
  deckId: string,
  options?: { allowStaleContentConflicts?: boolean },
): Promise<void> {
  while (true) {
    if (staleFullReplaceDrafts.has(deckId)) {
      throw (
        getDeckSaveError(deckId) ??
        new DeckSaveError(
          deckId,
          { errorCode: "slide_content_conflict" },
          `Failed to save deck ${deckId}: unresolved slide content conflict; local draft retained`,
        )
      );
    }
    const active = inFlightSaveChains.get(deckId);
    if (active) {
      await active;
      continue;
    }
    const keepaliveSave = inFlightKeepaliveSaves.get(deckId);
    if (keepaliveSave) {
      await keepaliveSave;
      continue;
    }
    if (failedSaveDecks.has(deckId)) {
      throw getDeckSaveError(deckId) ?? new DeckSaveError(deckId);
    }
    if (
      staleContentConflicts.has(deckId) &&
      !options?.allowStaleContentConflicts
    ) {
      if (pendingOpsQueue.has(deckId) || pendingSaves.has(deckId)) {
        await drainPendingDeckOps(deckId);
        continue;
      }
      throw (
        getDeckSaveError(deckId) ??
        new DeckSaveError(
          deckId,
          { errorCode: "slide_content_conflict" },
          `Failed to save deck ${deckId}: unresolved slide content conflict; local draft retained`,
        )
      );
    }
    if (staleSlideFieldDrafts.has(deckId)) {
      if (pendingOpsQueue.has(deckId) || pendingSaves.has(deckId)) {
        await drainPendingDeckOps(deckId);
        continue;
      }
      throw new DeckSaveError(
        deckId,
        { errorCode: "slide_field_conflict" },
        `Failed to save deck ${deckId}: unresolved slide field conflict; local draft retained`,
      );
    }
    if (pendingOpsQueue.has(deckId) || pendingSaves.has(deckId)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    return;
  }
}

async function retryDeckSave(deckId: string): Promise<void> {
  const failedSaveError = getDeckSaveError(deckId);
  if (
    !failedSaveError?.retryable ||
    staleFullReplaceDrafts.has(deckId) ||
    staleContentConflicts.has(deckId) ||
    !pendingOpsQueue.has(deckId)
  ) {
    throw failedSaveError ?? new DeckSaveError(deckId);
  }
  const timer = pendingSaves.get(deckId);
  if (timer) clearTimeout(timer);
  pendingSaves.delete(deckId);
  deckSaveRetryAttempts.delete(deckId);
  deckRevisionConflictRetryAttempts.delete(deckId);
  clearDeckSaveFailure(deckId);
  notifySaveListeners();
  await drainPendingDeckOps(deckId);
  await flushDeckSave(deckId);
}

async function flushSafeDeckWritesForConflictResolution(
  deckId: string,
): Promise<boolean> {
  while (true) {
    if (staleFullReplaceDrafts.has(deckId) || failedSaveDecks.has(deckId)) {
      return false;
    }
    const active = inFlightSaveChains.get(deckId);
    if (active) {
      await active;
      continue;
    }
    const keepaliveSave = inFlightKeepaliveSaves.get(deckId);
    if (keepaliveSave) {
      await keepaliveSave;
      continue;
    }
    if (failedSaveDecks.has(deckId)) {
      throw getDeckSaveError(deckId) ?? new DeckSaveError(deckId);
    }
    if (pendingOpsQueue.has(deckId) || pendingSaves.has(deckId)) {
      await drainPendingDeckOps(deckId);
      continue;
    }
    return true;
  }
}

function enqueueDeckOp(
  deckId: string,
  op: GranularOp,
  options?: {
    persistence?: "debounced" | "immediate";
    coalesceContent?: boolean;
    resolvingContentConflict?: boolean;
    onSaveSuccess?: (ops: GranularOp[]) => void;
    onPersisted?: PersistedResultHandler;
    layoutFitSlideIds?: readonly string[];
  },
) {
  op = withStaleSlideFieldBaselines(deckId, op);
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
  const heldFullReplace = staleFullReplaceDrafts.get(deckId);
  if (heldFullReplace) {
    holdStaleFullReplace(
      deckId,
      op.op === "full-replace" ? op.deck : applyOpToDeck(heldFullReplace, op),
      staleContentConflicts.get(deckId) ?? null,
    );
    return;
  }
  if (
    op.op === "patch-slide" &&
    typeof op.fields.content === "string" &&
    hasStaleContentConflict(deckId, op.slideId) &&
    !options?.resolvingContentConflict
  ) {
    const drafts = staleContentDrafts.get(deckId) ?? new Map();
    const previous = drafts.get(op.slideId);
    const baseFields = mergeSlideFieldBaselines(
      previous?.baseFields,
      op.baseFields,
    );
    drafts.set(op.slideId, {
      ...op,
      fields: { ...previous?.fields, ...op.fields },
      ...(baseFields ? { baseFields } : {}),
    });
    staleContentDrafts.set(deckId, drafts);
    notifySaveListeners();
    return;
  }
  if (
    op.op === "full-replace" &&
    (staleContentConflicts.has(deckId) || staleFullReplaceDrafts.has(deckId))
  ) {
    holdStaleFullReplace(
      deckId,
      op.deck,
      staleContentConflicts.get(deckId) ?? null,
    );
    return;
  }
  if (existing) {
    clearTimeout(existing);
    pendingSaves.delete(deckId);
  }
  if (
    (deckSaveRetryAttempts.get(deckId) ?? 0) > MAX_DECK_SAVE_RETRIES &&
    !inFlightSaveChains.has(deckId)
  ) {
    deckSaveRetryAttempts.delete(deckId);
    deckRevisionConflictRetryAttempts.delete(deckId);
    clearDeckSaveFailure(deckId);
  }

  if (op.op === "full-replace") {
    deckSaveRetryAttempts.delete(deckId);
    deckRevisionConflictRetryAttempts.delete(deckId);
    clearDeckSaveFailure(deckId);
    staleContentConflicts.delete(deckId);
    staleContentDrafts.delete(deckId);
    staleContentRemoteSlides.delete(deckId);
    staleSlideFieldDrafts.delete(deckId);
    const queuedOp = options?.onSaveSuccess
      ? { ...op, onSaveSuccess: options.onSaveSuccess }
      : op;
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
      queue[queue.length - 1] = {
        ...op,
        baseContentHash: previous.baseContentHash ?? op.baseContentHash,
      };
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
  return op;
}

function discardPendingDeckOp(
  deckId: string,
  op: GranularOp,
  handler: PersistedResultHandler,
) {
  const queue = pendingOpsQueue.get(deckId);
  if (queue) {
    const remaining = queue.filter((queued) => queued !== op);
    if (remaining.length === 0) pendingOpsQueue.delete(deckId);
    else if (remaining.length !== queue.length)
      pendingOpsQueue.set(deckId, remaining);
  }

  const handlers = pendingPersistedResultHandlers.get(deckId);
  if (handlers) {
    const remaining = handlers.filter((entry) => entry.handler !== handler);
    if (remaining.length === 0) pendingPersistedResultHandlers.delete(deckId);
    else if (remaining.length !== handlers.length)
      pendingPersistedResultHandlers.set(deckId, remaining);
  }

  if (
    !pendingOpsQueue.has(deckId) &&
    !inFlightSaveChains.has(deckId) &&
    !pendingSaves.has(deckId)
  ) {
    clearDeckSaveFailure(deckId);
    deckSaveRetryAttempts.delete(deckId);
    deckRevisionConflictRetryAttempts.delete(deckId);
  }
  notifySaveListeners();
}

function settleQueuedContentDraft(
  deckId: string,
  slideId: string,
  committedContent: string,
): boolean {
  const queue = pendingOpsQueue.get(deckId) ?? [];
  for (;;) {
    let index = queue.length - 1;
    for (; index >= 0; index--) {
      const op = queue[index];
      if (
        op.op === "full-replace" ||
        (op.op === "patch-slide"
          ? op.slideId === slideId && typeof op.fields.content === "string"
          : "slideId" in op && op.slideId === slideId)
      ) {
        break;
      }
    }
    if (index < 0) break;
    const op = queue[index];
    if (op.op !== "patch-slide") return false;
    if (op.fields.content === committedContent) return true;
    if (Object.keys(op.fields).length !== 1) return false;
    queue.splice(index, 1);
  }
  const sent = sentSlideContent.get(deckId)?.get(slideId);
  return (
    sent === undefined ||
    sent.content === committedContent ||
    sent.over !== committedContent
  );
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

export function flushPendingSaves() {
  for (const deckId of new Set([
    ...pendingSaves.keys(),
    ...inFlightSaveChains.keys(),
  ])) {
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
  deckRevisionConflictRetryAttempts.delete(deckId);
  clearDeckSaveFailure(deckId);
  staleContentConflicts.delete(deckId);
  staleFullReplaceDrafts.delete(deckId);
  staleContentRetrySlides.delete(deckId);
  staleContentDrafts.delete(deckId);
  staleContentRemoteSlides.delete(deckId);
  staleSlideFieldDrafts.delete(deckId);
  confirmedSlideContentHashes.delete(deckId);
  confirmedSlideContents.delete(deckId);
  immediateFlushRequests.delete(deckId);
  notifySaveListeners();
}

type PatchDeckFields = Extract<
  PatchDeckOp,
  { op: "patch-deck-fields" }
>["fields"];

function clearSourceImport(deck: Deck): Deck {
  if (deck.sourceImport === undefined || deck.sourceImport === null)
    return deck;
  const next = { ...deck };
  delete next.sourceImport;
  return next;
}

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

export function applyOpToDeck(deck: Deck, op: PatchDeckOp): Deck {
  switch (op.op) {
    case "patch-slide": {
      const prior = deck.slides.find((s) => s.id === op.slideId);
      if (!prior || !hasChangedFields(prior, op.fields)) return deck;
      const slides = deck.slides.map((s) => {
        if (s.id !== op.slideId) return s;
        const updated = { ...s, ...op.fields } as Slide;
        for (const [key, value] of Object.entries(op.fields)) {
          if (value === null)
            delete (updated as unknown as Record<string, unknown>)[key];
        }
        return updated;
      });
      return { ...deck, slides, updatedAt: new Date().toISOString() };
    }
    case "delete-slide": {
      const slides = deck.slides.filter((s) => s.id !== op.slideId);
      if (slides.length === deck.slides.length) return deck;
      return {
        ...clearSourceImport(deck),
        slides,
        updatedAt: new Date().toISOString(),
      };
    }
    case "reorder-slides": {
      const byId = new Map(deck.slides.map((s) => [s.id, s]));
      const reordered: Slide[] = [];
      for (const id of op.orderedIds) {
        const slide = byId.get(id);
        if (slide) reordered.push(slide);
      }
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
        ...clearSourceImport(deck),
        slides: reordered,
        updatedAt: new Date().toISOString(),
      };
    }
    case "add-slide": {
      if (deck.slides.some((s) => s.id === op.slideId)) return deck;
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
      return {
        ...clearSourceImport(deck),
        slides,
        updatedAt: new Date().toISOString(),
      };
    }
    case "patch-deck-fields": {
      if (!hasChangedFields(deck, op.fields)) return deck;
      const updated = { ...deck, ...op.fields } as Deck;
      for (const [key, value] of Object.entries(op.fields)) {
        if (value === null)
          delete (updated as unknown as Record<string, unknown>)[key];
      }
      return {
        ...updated,
        updatedAt: new Date().toISOString(),
      };
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
  return Object.keys(fieldRecord).some((key) =>
    fieldRecord[key] === null
      ? currentRecord[key] !== undefined
      : !equalDeckValue(currentRecord[key], fieldRecord[key]),
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

function undoOpsWithoutRemoteFieldConflicts(
  ops: DeckUndoOp[],
  oppositeOps: DeckUndoOp[],
  decks: Deck[],
): DeckUndoOp[] {
  const expectedSlideFields = new Map<string, Map<string, unknown>>();
  const expectedDeckFields = new Map<string, Map<string, unknown>>();
  for (const op of oppositeOps) {
    if (op.op === "patch-slide") {
      const key = JSON.stringify([op.deckId, op.slideId]);
      const fields = expectedSlideFields.get(key) ?? new Map<string, unknown>();
      for (const [field, value] of Object.entries(op.fields)) {
        fields.set(field, value);
      }
      expectedSlideFields.set(key, fields);
    } else if (op.op === "patch-deck-fields") {
      const fields =
        expectedDeckFields.get(op.deckId) ?? new Map<string, unknown>();
      for (const [field, value] of Object.entries(op.fields)) {
        fields.set(field, value);
      }
      expectedDeckFields.set(op.deckId, fields);
    }
  }

  return ops.flatMap<DeckUndoOp>((op): DeckUndoOp[] => {
    if (op.op === "patch-slide") {
      const deck = decks.find((entry) => entry.id === op.deckId);
      const slide = deck?.slides.find((entry) => entry.id === op.slideId);
      if (!slide) return [];
      const expected = expectedSlideFields.get(
        JSON.stringify([op.deckId, op.slideId]),
      );
      if (!expected) return [op];
      const fields = { ...op.fields };
      for (const field of Object.keys(fields)) {
        if (!expected.has(field)) continue;
        const expectedValue = expected.get(field);
        const currentValue = slide[field as keyof Slide];
        if (
          !equalDeckValue(
            currentValue,
            expectedValue === null ? undefined : expectedValue,
          )
        ) {
          delete fields[field as keyof PatchSlideFields];
        }
      }
      const baseFields = Object.fromEntries(
        Object.entries(op.baseFields ?? {}).filter(
          ([field]) => field !== "content" && field in fields,
        ),
      ) as PatchSlideBaselines;
      const { baseFields: _baseFields, ...withoutBaseFields } = op;
      return Object.keys(fields).length > 0
        ? [
            {
              ...withoutBaseFields,
              fields,
              ...(Object.keys(baseFields).length > 0 ? { baseFields } : {}),
            },
          ]
        : [];
    }

    if (op.op === "patch-deck-fields") {
      const deck = decks.find((entry) => entry.id === op.deckId);
      if (!deck) return [];
      const expected = expectedDeckFields.get(op.deckId);
      if (!expected) return [op];
      const fields = { ...op.fields };
      for (const field of Object.keys(fields)) {
        if (!expected.has(field)) continue;
        const expectedValue = expected.get(field);
        const currentValue = deck[field as keyof Deck];
        if (
          !equalDeckValue(
            currentValue,
            expectedValue === null ? undefined : expectedValue,
          )
        ) {
          delete fields[field as keyof PatchDeckTopLevelFields];
        }
      }
      return Object.keys(fields).length > 0 ? [{ ...op, fields }] : [];
    }

    return [op];
  });
}

export function deckContentSignature(deck: Deck): string {
  return stableDeckContentSignature(deck);
}

export function deriveInverseOp(
  before: Deck,
  op: PatchDeckOp,
): PatchDeckOp[] | null {
  switch (op.op) {
    case "patch-slide": {
      const prior = before.slides.find((s) => s.id === op.slideId);
      if (!prior) return null;
      const priorFields: PatchSlideFields = {};
      for (const key of Object.keys(op.fields) as (keyof Omit<Slide, "id">)[]) {
        if (!equalDeckValue(prior[key], op.fields[key])) {
          let priorValue: unknown = prior[key];
          if (
            (key === "skipped" || key === "layoutWarningDismissed") &&
            priorValue === undefined
          ) {
            priorValue = false;
          } else if (priorValue === undefined) {
            priorValue = null;
          }
          (priorFields as unknown as Record<string, unknown>)[key] = priorValue;
        }
      }
      if (Object.keys(priorFields).length === 0) return null;
      const baseFields: PatchSlideBaselines = {};
      for (const key of Object.keys(priorFields)) {
        if (key === "content") continue;
        const field = key as PatchSlideBaselineField;
        const requestedValue = (op.fields as Record<string, unknown>)[field];
        const baseline =
          requestedValue === undefined
            ? prior[field]
            : requestedValue === null
              ? undefined
              : requestedValue;
        baseFields[field] =
          baseline === undefined
            ? { present: false }
            : { present: true, value: structuredClone(baseline) };
      }
      return [
        {
          op: "patch-slide",
          slideId: op.slideId,
          fields: priorFields,
          ...(Object.keys(baseFields).length > 0 ? { baseFields } : {}),
        },
      ];
    }
    case "delete-slide": {
      const prior = before.slides.find((s) => s.id === op.slideId);
      if (!prior) return null;
      const idx = before.slides.findIndex((s) => s.id === op.slideId);
      const afterSlideId = idx > 0 ? before.slides[idx - 1]?.id : undefined;
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
          priorFields[key] = beforeRecord[key] ?? null;
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

export function deriveDeckDiffOps(before: Deck, after: Deck): PatchDeckOp[] {
  const beforeIds = new Set(before.slides.map((slide) => slide.id));
  const afterIds = new Set(after.slides.map((slide) => slide.id));
  const operations: PatchDeckOp[] = [];

  for (const slide of after.slides) {
    if (!beforeIds.has(slide.id)) {
      operations.push({
        op: "add-slide",
        slideId: slide.id,
        fields: addSlideFields(slide),
      });
      continue;
    }

    const prior = before.slides.find((entry) => entry.id === slide.id)!;
    const fields: Record<string, unknown> = {};
    for (const key of [
      "content",
      "notes",
      "layout",
      "layoutWarningDismissed",
      "background",
      "imageUrl",
      "imagePrompt",
      "excalidrawData",
      "transition",
      "animations",
      "splitByParagraph",
      "skipped",
    ] as const) {
      if (!equalDeckValue(prior[key], slide[key])) {
        fields[key] = slide[key] === undefined ? null : slide[key];
      }
    }
    if (Object.keys(fields).length > 0) {
      operations.push({
        op: "patch-slide",
        slideId: slide.id,
        fields: fields as unknown as PatchSlideFields,
      });
    }
  }

  for (const slide of before.slides) {
    if (!afterIds.has(slide.id)) {
      operations.push({
        op: "delete-slide",
        slideId: slide.id,
        ...(after.slides.length === 0 ? { allowEmpty: true } : {}),
      });
    }
  }

  const beforeOrder = before.slides.map((slide) => slide.id);
  const afterOrder = after.slides.map((slide) => slide.id);
  if (!equalDeckValue(beforeOrder, afterOrder)) {
    operations.push({ op: "reorder-slides", orderedIds: afterOrder });
  }

  const deckFields: Record<string, unknown> = {};
  for (const key of [
    "title",
    "designSystemId",
    "tweaks",
    "aspectRatio",
    "starred",
  ] as const) {
    if (!equalDeckValue(before[key], after[key])) {
      deckFields[key] = after[key] === undefined ? null : after[key];
    }
  }
  if (Object.keys(deckFields).length > 0) {
    operations.push({
      op: "patch-deck-fields",
      fields: deckFields as PatchDeckFields,
    });
  }

  return operations;
}

type DeckReadFailureStatus =
  | "not-found"
  | "forbidden"
  | "unauthorized"
  | "unavailable";

type DeckReadFailure = {
  status: DeckReadFailureStatus;
  error: unknown;
};

type DeckRead = { status: "ok"; deck: Deck } | DeckReadFailure;

type DeckListRead = { status: "ok"; decks: Deck[] } | DeckReadFailure;

type OpenDeckSync = {
  read: DeckRead["status"] | "superseded";
  deck: Deck | null;
};

function classifyDeckReadFailure(error: unknown): DeckReadFailureStatus {
  const status = (error as { status?: unknown } | undefined)?.status;
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  return "unavailable";
}

function deckOrNull(read: DeckRead): Deck | null {
  return read.status === "ok" ? read.deck : null;
}

async function readDecksFromAPI(includePreview = true): Promise<DeckListRead> {
  try {
    const result = await callActionWithRetry<DeckListActionResult>(
      "list-decks",
      { light: "true", ...(includePreview ? { includePreview: "true" } : {}) },
      { method: "GET" },
    );
    if (!Array.isArray(result?.decks)) {
      console.warn("Failed to fetch decks: invalid action response");
      return {
        status: "unavailable",
        error: new Error("list-decks returned an invalid response"),
      };
    }
    return {
      status: "ok",
      decks: result.decks
        .map((deck) => normalizeActionDeck(deck))
        .filter((deck): deck is Deck => deck !== null),
    };
  } catch (err) {
    console.error("Failed to fetch decks:", err);
    return { status: classifyDeckReadFailure(err), error: err };
  }
}

async function readDeckFromAPI(id: string): Promise<DeckRead> {
  try {
    const result = await callActionWithRetry<unknown>(
      "get-deck",
      { id },
      { method: "GET" },
    );
    const deck = normalizeActionDeck(result);
    if (!deck) {
      return {
        status: "unavailable",
        error: new Error(`get-deck returned an invalid deck for ${id}`),
      };
    }
    return { status: "ok", deck };
  } catch (err) {
    console.error(`Failed to fetch deck ${id}:`, err);
    return { status: classifyDeckReadFailure(err), error: err };
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

function replaceOpenDeckRouteWithDeckList(): void {
  if (typeof window === "undefined") return;
  const deckSegmentIndex = window.location.pathname.indexOf("/deck/");
  if (deckSegmentIndex < 0) return;
  const nextPath = `${window.location.pathname.slice(0, deckSegmentIndex)}/home`;
  window.history.replaceState(window.history.state, "", nextPath);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export async function includeOpenDeckIfMissing(
  decks: Deck[],
  openDeckId: string | null,
  fetchById: (id: string) => Promise<Deck | null> = async (id) =>
    deckOrNull(await readDeckFromAPI(id)),
): Promise<Deck[]> {
  if (!openDeckId || decks.some((deck) => deck.id === openDeckId)) {
    return decks;
  }

  const directDeck = await fetchById(openDeckId);
  return directDeck ? [...decks, directDeck] : decks;
}

async function fetchDecksForCurrentRoute(): Promise<Deck[] | null> {
  const currentOpenDeckId = currentOpenDeckIdFromWindow();
  const listRead = await readDecksFromAPI();
  if (listRead.status !== "ok") {
    if (!currentOpenDeckId) return null;
    const directDeck = deckOrNull(await readDeckFromAPI(currentOpenDeckId));
    return directDeck ? [directDeck] : null;
  }
  const loaded = listRead.decks;
  if (!currentOpenDeckId) return loaded;

  const directDeck = deckOrNull(await readDeckFromAPI(currentOpenDeckId));
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
    deckServerRevisions.delete(id);
    deckClientWriteSequences.delete(id);
    deckKeepaliveSuccessGenerations.delete(id);
  } catch (error) {
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
    deckServerRevisions.delete(id);
    deckClientWriteSequences.delete(id);
    deckKeepaliveSuccessGenerations.delete(id);
  }
}

async function createDeckOnAPI(deck: Deck): Promise<void> {
  const result = await callAction<unknown>("add-deck", {
    deck: deckPayload(deck),
  });
  rememberDeckServerRevision(deck.id, result);
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
  return { ...local, slides: merged };
}

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
  if (staleFullReplaceDrafts.has(deckId)) return true;
  if (hasStaleContentConflict(deckId, slideId)) return true;
  if (activeInlineEditSlides.get(deckId)?.has(slideId)) return true;
  const inFlightOps = inFlightOpSlides.get(deckId);
  if (inFlightOps?.some((op) => opTargetsSlide(op, slideId))) return true;
  const queue = pendingOpsQueue.get(deckId);
  if (!queue) return false;
  return queue.some((op) => opTargetsSlide(op, slideId));
}

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

export function mergeServerSlideUpdate(
  local: Deck,
  server: Deck,
  deckId: string,
  options?: {
    shouldMergeServerOnlySlide?: (slide: Slide) => boolean;
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
    if (
      options?.pendingAtReadStart?.has(slide.id) ||
      hasStaleContentConflict(deckId, slide.id) ||
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

function refuseRenderArtifactWrite(
  markers: string[],
  target: { deckId: string; slideId: string },
  message: string,
) {
  const error = new Error(
    `Refused a slide write that adds rendered markup: ${markers.join(", ")}`,
  );
  console.error(error, target);
  captureError(error, {
    tags: { area: "slides-save-boundary" },
    extra: { ...target, markers },
  });
  toast.error(message);
  if (import.meta.env.DEV) throw error;
}

export function DeckProvider({
  children,
  realtimeEnabled = false,
  openDeckId,
}: {
  children: ReactNode;
  realtimeEnabled?: boolean;
  openDeckId?: string | null;
}) {
  const { data: org, isLoading: orgLoading } = useOrg();
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const activeOrgId = org?.orgId ?? null;
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckScopeOrgId, setDeckScopeOrgId] = useState<
    string | null | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deckListRefreshCount, setDeckListRefreshCount] = useState(0);
  const decksRef = useRef<Deck[]>([]);

  const [undoAvailability, setUndoAvailability] = useState<
    Record<string, { canUndo: boolean; canRedo: boolean }>
  >({});
  const undoControllerRef = useRef(
    new Map<string, LocalOpUndoController<DeckUndoOp>>(),
  );
  const lastUndoDeckIdRef = useRef<string | null>(null);
  const lastExternalUpdateRef = useRef(0);
  const pendingCreateIdsRef = useRef<Set<string>>(new Set());
  const pendingCreatePromisesRef = useRef<Map<string, Promise<void>>>(
    new Map(),
  );
  const deferredCreateDecksRef = useRef<Map<string, Deck>>(new Map());
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
  const deckScopeGenerationRef = useRef(0);
  const deckBaselineRequestIdRef = useRef(0);
  const deckListRequestIdRef = useRef(0);
  const openDeckRequestIdByDeckRef = useRef<Map<string, number>>(new Map());
  const liveChannelConnectedRef = useRef(false);
  const sseStreamConnectedRef = useRef(false);
  const pollControlRef = useRef<PollControl>(IDLE_POLL_CONTROL);
  const syncListRefreshInFlightRef = useRef(false);
  const syncListRefreshPendingRef = useRef(false);
  const staleDeckIdsRef = useRef<Set<string>>(new Set());
  const localCreateSeqRef = useRef(0);
  const localCreateSeqByIdRef = useRef<Map<string, number>>(new Map());
  const noteLocalCreate = useCallback((deckId: string) => {
    localCreateSeqRef.current += 1;
    localCreateSeqByIdRef.current.set(deckId, localCreateSeqRef.current);
  }, []);
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
      const scopeGeneration = deckScopeGenerationRef.current;
      const deleteInCurrentScope = () => {
        if (scopeGeneration !== deckScopeGenerationRef.current) {
          return Promise.resolve();
        }
        return deleteDeckFromAPI(deckId);
      };
      const pendingCreate = pendingCreatePromisesRef.current.get(deckId);
      const deletion = pendingCreate
        ? pendingCreate.then(deleteInCurrentScope, deleteInCurrentScope)
        : deleteInCurrentScope();
      void deletion.catch((err) => {
        if (scopeGeneration !== deckScopeGenerationRef.current) return;
        console.error(`Failed to delete deck ${deckId}:`, err);
        onFailure?.();
      });
    },
    [],
  );

  const setDecksLocal = useCallback((updater: (prev: Deck[]) => Deck[]) => {
    const next = updater(decksRef.current);
    decksRef.current = next;
    setDecks(next);
  }, []);

  const resolveDeckContentConflict = useCallback(
    async (
      deckId: string,
      slideId: string,
      choice: DeckContentConflictChoice,
    ): Promise<DeckContentConflictResolution> => {
      const scopeGeneration = deckScopeGenerationRef.current;
      if (!staleContentConflicts.has(deckId)) {
        return { status: "unresolved", reason: "conflict-not-found" };
      }
      if (staleFullReplaceDrafts.has(deckId)) {
        return { status: "unresolved", reason: "full-replace" };
      }
      const initialConflicts = staleContentConflicts.get(deckId);
      if (initialConflicts === null) {
        return { status: "unresolved", reason: "conflict-unknown" };
      }
      if (!initialConflicts?.has(slideId)) {
        return { status: "unresolved", reason: "conflict-not-found" };
      }

      try {
        if (!(await flushSafeDeckWritesForConflictResolution(deckId))) {
          return { status: "unresolved", reason: "pending-writes" };
        }
      } catch {
        return { status: "unresolved", reason: "pending-writes" };
      }
      if (scopeGeneration !== deckScopeGenerationRef.current) {
        return { status: "unresolved", reason: "conflict-not-found" };
      }
      if (conflictResolutionDecks.has(deckId)) {
        return { status: "unresolved", reason: "pending-writes" };
      }
      if (staleFullReplaceDrafts.has(deckId)) {
        return { status: "unresolved", reason: "full-replace" };
      }
      const conflicts = staleContentConflicts.get(deckId);
      if (conflicts === null) {
        return { status: "unresolved", reason: "conflict-unknown" };
      }
      if (!conflicts?.has(slideId)) {
        return { status: "unresolved", reason: "conflict-not-found" };
      }
      const initialDraft = getStaleContentDraft(deckId, slideId);
      if (initialDraft === undefined) {
        return { status: "unresolved", reason: "conflict-not-found" };
      }

      conflictResolutionDecks.add(deckId);
      notifySaveListeners();
      const setLocalSlideContent = (content: string) => {
        let updated = false;
        setDecksLocal((previous) =>
          previous.map((deck) => {
            if (deck.id !== deckId) return deck;
            if (!deck.slides.some((slide) => slide.id === slideId)) return deck;
            updated = true;
            return {
              ...deck,
              slides: deck.slides.map((slide) =>
                slide.id === slideId ? { ...slide, content } : slide,
              ),
            };
          }),
        );
        return updated;
      };

      try {
        const remoteDeck = deckOrNull(await readDeckFromAPI(deckId));
        if (scopeGeneration !== deckScopeGenerationRef.current) {
          return { status: "unresolved", reason: "conflict-not-found" };
        }
        if (!remoteDeck) {
          return { status: "unresolved", reason: "remote-unavailable" };
        }
        const remoteSlide = remoteDeck.slides.find(
          (slide) => slide.id === slideId,
        );
        if (!remoteSlide) {
          rememberStaleContentRemoteSlides(deckId, remoteDeck, [slideId]);
          notifySaveListeners();
          return { status: "unresolved", reason: "slide-missing" };
        }
        rememberDeckServerRevision(deckId, remoteDeck);
        rememberStaleContentRemoteSlides(deckId, remoteDeck, [slideId]);

        if (staleFullReplaceDrafts.has(deckId)) {
          return { status: "unresolved", reason: "full-replace" };
        }
        const latestConflicts = staleContentConflicts.get(deckId);
        if (latestConflicts === null) {
          return { status: "unresolved", reason: "conflict-unknown" };
        }
        if (!latestConflicts?.has(slideId)) {
          return { status: "unresolved", reason: "conflict-not-found" };
        }
        const localContent = getStaleContentDraft(deckId, slideId);
        if (localContent === undefined) {
          return { status: "unresolved", reason: "conflict-not-found" };
        }

        if (choice === "use-latest") {
          if (localContent !== initialDraft) {
            return { status: "unresolved", reason: "draft-changed" };
          }
          if (!setLocalSlideContent(remoteSlide.content)) {
            return { status: "unresolved", reason: "slide-missing" };
          }
          if (!clearStaleContentConflict(deckId, slideId)) {
            return { status: "unresolved", reason: "conflict-not-found" };
          }
          rememberConfirmedSlideContent(deckId, slideId, remoteSlide.content);
          notifySaveListeners();
          return { status: "resolved", content: remoteSlide.content };
        }

        if (localContent === remoteSlide.content) {
          if (!setLocalSlideContent(remoteSlide.content)) {
            return { status: "unresolved", reason: "slide-missing" };
          }
          if (!clearStaleContentConflict(deckId, slideId)) {
            return { status: "unresolved", reason: "conflict-not-found" };
          }
          rememberConfirmedSlideContent(deckId, slideId, remoteSlide.content);
          notifySaveListeners();
          return { status: "resolved", content: remoteSlide.content };
        }

        const op: PatchDeckOp = {
          op: "patch-slide",
          slideId,
          fields: { content: localContent },
          baseContentHash: hashSlideContent(remoteSlide.content),
        };
        try {
          await persistDeckOps(deckId, [op]);
        } catch (error) {
          const latestRemoteDeck = deckOrNull(await readDeckFromAPI(deckId));
          if (
            latestRemoteDeck &&
            scopeGeneration === deckScopeGenerationRef.current
          ) {
            rememberDeckServerRevision(deckId, latestRemoteDeck);
            rememberStaleContentRemoteSlides(deckId, latestRemoteDeck, [
              slideId,
            ]);
          }
          notifySaveListeners();
          const staleContentConflict =
            error &&
            typeof error === "object" &&
            (("errorCode" in error &&
              error.errorCode === "slide_content_stale") ||
              ("status" in error && error.status === 409));
          return {
            status: "unresolved",
            reason: staleContentConflict ? "conflict" : "write-failed",
          };
        }
        if (scopeGeneration !== deckScopeGenerationRef.current) {
          return { status: "unresolved", reason: "conflict-not-found" };
        }

        rememberPersistedSlideContent(deckId, [op]);
        const latestDraft = getStaleContentDraft(deckId, slideId);
        if (staleFullReplaceDrafts.has(deckId)) {
          return { status: "unresolved", reason: "full-replace" };
        }
        if (latestDraft !== localContent) {
          const remoteAfterSave = {
            ...remoteDeck,
            slides: remoteDeck.slides.map((slide) =>
              slide.id === slideId
                ? { ...slide, content: localContent }
                : slide,
            ),
          };
          rememberStaleContentRemoteSlides(deckId, remoteAfterSave, [slideId]);
          notifySaveListeners();
          return { status: "unresolved", reason: "draft-changed" };
        }
        if (!setLocalSlideContent(localContent)) {
          return { status: "unresolved", reason: "slide-missing" };
        }
        if (!clearStaleContentConflict(deckId, slideId)) {
          return { status: "unresolved", reason: "conflict-not-found" };
        }
        notifySaveListeners();
        return { status: "resolved", content: localContent };
      } finally {
        conflictResolutionDecks.delete(deckId);
        if (scopeGeneration === deckScopeGenerationRef.current) {
          void drainPendingDeckOps(deckId);
        }
        notifySaveListeners();
      }
    },
    [setDecksLocal],
  );

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

  const undoControllerForDeck = useCallback(
    (deckId: string) => {
      const existing = undoControllerRef.current.get(deckId);
      if (existing) return existing;

      const controller = createLocalOpUndoController<DeckUndoOp>({
        apply: (ops, direction, entry) => {
          let startingDecks = decksRef.current;
          if (direction === "undo") {
            const drafts = staleSlideFieldDrafts.get(deckId);
            if (drafts && startingDecks.some((deck) => deck.id === deckId)) {
              const draftsToDiscard = new Map<string, StaleSlideFieldDraft>();
              for (const op of entry.redo) {
                if (op.op !== "patch-slide" || op.deckId !== deckId) continue;
                for (const field of Object.keys(op.fields)) {
                  const key = slideFieldDraftKey(op.slideId, field);
                  const draft = drafts.get(key);
                  if (draft) draftsToDiscard.set(key, draft);
                }
              }
              if (draftsToDiscard.size > 0) {
                for (const key of draftsToDiscard.keys()) drafts.delete(key);
                if (drafts.size === 0) staleSlideFieldDrafts.delete(deckId);
                startingDecks = startingDecks.map((deck) =>
                  deck.id === deckId
                    ? restoreStaleSlideFieldDrafts(deck, [
                        ...draftsToDiscard.values(),
                      ])
                    : deck,
                );
                setDecksLocal(() => startingDecks);
                notifySaveListeners();
              }
            }
          }
          const applicableOps = undoOpsWithoutRemoteFieldConflicts(
            ops,
            direction === "undo" ? entry.redo : entry.undo,
            startingDecks,
          );
          setDecks((prev) => {
            let next = prev;
            for (const op of applicableOps) {
              next = applyUndoOpToDecks(next, op);
            }
            return next;
          });
          let currentDecks = startingDecks;
          for (const op of applicableOps) {
            markDeckDirty(op.deckId);
            if (op.op === "delete-deck") {
              discardPendingDeckOps(op.deckId);
              deleteDeckAfterPendingCreate(op.deckId);
              currentDecks = applyUndoOpToDecks(currentDecks, op);
            } else if (op.op === "restore-deck") {
              markReplacedSlideOmissions(
                currentDecks.find((deck) => deck.id === op.deckId),
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
              currentDecks = applyUndoOpToDecks(currentDecks, op);
            } else {
              const { deckId, ...granular } = op;
              if (granular.op === "delete-slide") {
                markSlideDeleteTombstone(deckId, granular.slideId);
              } else if (granular.op === "add-slide") {
                clearSlideDeleteTombstone(deckId, granular.slideId);
              }
              const currentDeck = currentDecks.find(
                (deck) => deck.id === deckId,
              );
              const persistedOp =
                granular.op === "patch-slide" &&
                typeof granular.fields.content === "string" &&
                currentDeck
                  ? {
                      ...granular,
                      baseContentHash: hashSlideContent(
                        currentDeck.slides.find(
                          (slide) => slide.id === granular.slideId,
                        )?.content ?? "",
                      ),
                    }
                  : granular;
              enqueueDeckOp(deckId, persistedOp, {
                layoutFitSlideIds: layoutFitSlideIdsForDeckFields(
                  currentDeck,
                  persistedOp,
                ),
                onPersisted: (results, slideWriteSequences) =>
                  reconcilePersistedLayoutFit(
                    deckId,
                    results,
                    slideWriteSequences,
                  ),
              });
              currentDecks = applyUndoOpToDecks(currentDecks, op);
            }
          }
        },
        onChange: () => {
          const current = undoControllerRef.current.get(deckId);
          if (!current) return;
          lastUndoDeckIdRef.current = deckId;
          setUndoAvailability((previous) => ({
            ...previous,
            [deckId]: {
              canUndo: current.canUndo(),
              canRedo: current.canRedo(),
            },
          }));
        },
      });
      undoControllerRef.current.set(deckId, controller);
      return controller;
    },
    [
      captureReplacedSlideDeleteTombstones,
      clearSlideDeleteTombstone,
      deleteDeckAfterPendingCreate,
      markDeckDirty,
      markReplacedSlideOmissions,
      markSlideDeleteTombstone,
      reconcilePersistedLayoutFit,
      setDecksLocal,
    ],
  );

  const clearUndoHistory = useCallback(() => {
    for (const controller of undoControllerRef.current.values()) {
      controller.clear();
    }
    undoControllerRef.current.clear();
    lastUndoDeckIdRef.current = null;
    setUndoAvailability({});
  }, []);

  const recordUndo = useCallback(
    (
      before: Deck,
      redoOp: PatchDeckOp,
      opts?: { label?: string; coalesceKey?: string },
    ) => {
      const redo = withSlideFieldBaselines(before, redoOp);
      const inverseOps = deriveInverseOp(before, redo);
      if (!inverseOps || inverseOps.length === 0) return;
      const entry: LocalOpUndoEntry<DeckUndoOp> = {
        undo: inverseOps.map((o) => ({ deckId: before.id, ...o })),
        redo: [{ deckId: before.id, ...redo }],
        label: opts?.label,
        coalesceKey: opts?.coalesceKey,
      };
      undoControllerForDeck(before.id).push(entry);
    },
    [undoControllerForDeck],
  );

  const recordUndoBatch = useCallback(
    (before: Deck, redoOps: PatchDeckOp[], label: string) => {
      let state = before;
      const undoOps: PatchDeckOp[] = [];
      const normalizedRedoOps: PatchDeckOp[] = [];
      for (const redoOp of redoOps) {
        const normalizedRedo = withSlideFieldBaselines(state, redoOp);
        const nextState = applyOpToDeck(state, normalizedRedo);
        const inverseOps = deriveInverseOp(state, normalizedRedo);
        if (inverseOps) undoOps.unshift(...inverseOps);
        normalizedRedoOps.push(normalizedRedo);
        state = nextState;
      }
      if (undoOps.length === 0) return;
      undoControllerForDeck(before.id).push({
        undo: undoOps.map((op) => ({ deckId: before.id, ...op })),
        redo: normalizedRedoOps.map((op) => ({ deckId: before.id, ...op })),
        label,
      });
    },
    [undoControllerForDeck],
  );

  const applyRemoteDeckUpdate = useCallback(
    (updated: Deck, options?: { clearPendingWrites?: boolean }) => {
      if (staleFullReplaceDrafts.has(updated.id)) return;
      if (options?.clearPendingWrites) {
        discardPendingDeckOps(updated.id);
        dirtyDeckIdsRef.current.delete(updated.id);
        clearDeckDeleteTombstones(updated.id);
      }
      updated = withStaleSlideFieldDrafts(updated);
      const confirmedHashes =
        confirmedSlideContentHashes.get(updated.id) ?? new Map();
      const confirmedContents =
        confirmedSlideContents.get(updated.id) ?? new Map();
      const updatedSlideIds = new Set(updated.slides.map((slide) => slide.id));
      for (const slideId of confirmedHashes.keys()) {
        if (
          !updatedSlideIds.has(slideId) &&
          !hasPendingWriteForSlide(updated.id, slideId)
        ) {
          confirmedHashes.delete(slideId);
          confirmedContents.delete(slideId);
        }
      }
      for (const slide of updated.slides) {
        if (!hasPendingWriteForSlide(updated.id, slide.id)) {
          confirmedHashes.set(slide.id, hashSlideContent(slide.content));
          confirmedContents.set(slide.id, slide.content);
        }
      }
      if (confirmedHashes.size > 0) {
        confirmedSlideContentHashes.set(updated.id, confirmedHashes);
        confirmedSlideContents.set(updated.id, confirmedContents);
      } else {
        confirmedSlideContentHashes.delete(updated.id);
        confirmedSlideContents.delete(updated.id);
      }
      const sentContent = sentSlideContent.get(updated.id);
      if (sentContent) {
        const slideIds = new Set(updated.slides.map((slide) => slide.id));
        for (const slideId of sentContent.keys()) {
          if (
            !slideIds.has(slideId) ||
            !hasPendingWriteForSlide(updated.id, slideId)
          ) {
            sentContent.delete(slideId);
          }
        }
        if (sentContent.size === 0) sentSlideContent.delete(updated.id);
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
    [clearDeckDeleteTombstones],
  );

  const refreshDeckListIfChanged = useCallback(async (): Promise<
    DeckRead["status"] | "superseded"
  > => {
    const requestId = ++deckListRequestIdRef.current;
    const createSeqAtRequest = localCreateSeqRef.current;
    const includePreview = currentOpenDeckIdFromWindow() === null;
    // A write that is enqueued, debounced, flushed, and drained entirely
    // inside this GET leaves nothing in the pending maps by the time the
    // response lands, so `hasPendingLocalWrite` below can't see it from those
    // alone. Snapshot each known deck's write sequence up front so that race
    // is still detectable.
    const writeSeqAtRequest = new Map(
      decksRef.current.map((d) => [d.id, deckLocalWriteSeq.get(d.id) ?? 0]),
    );
    const listRead = await readDecksFromAPI(includePreview);
    if (requestId !== deckListRequestIdRef.current) return "superseded";
    pollControlRef.current.onRead(null, listRead.status);
    if (listRead.status !== "ok") {
      setLoadError(true);
      return listRead.status;
    }
    const fresh = listRead.decks;
    staleDeckIdsRef.current.clear();
    const currentDecks = decksRef.current;
    const currentIds = new Set(currentDecks.map((d) => d.id));
    const freshById = new Map(fresh.map((d) => [d.id, d]));
    const addedIds = fresh
      .filter((d) => !currentIds.has(d.id))
      .map((d) => d.id);
    const removed = currentDecks.filter(
      (d) =>
        !freshById.has(d.id) &&
        !staleFullReplaceDrafts.has(d.id) &&
        !isNewerThanSnapshot(d.id, createSeqAtRequest),
    );
    for (const id of freshById.keys()) localCreateSeqByIdRef.current.delete(id);

    // A deck with an uncommitted local write (mid-edit, a debounced/in-flight
    // save, or an optimistic create still saving) must not have this stale
    // server snapshot clobber it — the same checks `refetchOpenDeckIfChanged`
    // uses per slide, plus the write-seq race captured above.
    const hasPendingLocalWrite = (id: string) =>
      pendingCreateIdsRef.current.has(id) ||
      hasUncommittedDeckChanges(id, dirtyDeckIdsRef.current) ||
      (activeInlineEditSlides.get(id)?.size ?? 0) > 0 ||
      (deckLocalWriteSeq.get(id) ?? 0) !== (writeSeqAtRequest.get(id) ?? 0);
    const previewKey = (slide: Deck["previewSlide"]) =>
      slide ? JSON.stringify(slide) : "";
    const metadataChanged = (local: Deck, remote: Deck) =>
      local.title !== remote.title ||
      local.updatedAt !== remote.updatedAt ||
      (includePreview &&
        previewKey(local.previewSlide) !== previewKey(remote.previewSlide));
    const changedMetadataIds = currentDecks
      .filter((d) => {
        const remote = freshById.get(d.id);
        return (
          remote && !hasPendingLocalWrite(d.id) && metadataChanged(d, remote)
        );
      })
      .map((d) => d.id);

    if (
      addedIds.length === 0 &&
      removed.length === 0 &&
      changedMetadataIds.length === 0
    ) {
      setLoadError(false);
      return "ok";
    }

    const addedResults = await Promise.all(
      addedIds.map((id) => readDeckFromAPI(id)),
    );
    if (requestId !== deckListRequestIdRef.current) return "superseded";
    const addedDecks = addedResults.flatMap((read) =>
      read.status === "ok" ? [read.deck] : [],
    );
    const hydratedEveryAddedDeck = addedDecks.length === addedIds.length;

    lastExternalUpdateRef.current = Date.now();
    const removedIds = new Set(removed.map((d) => d.id));
    setDecks((prev) => {
      const prevIds = new Set(prev.map((d) => d.id));
      let next = prev
        .filter((d) => !removedIds.has(d.id))
        .map((d) => {
          const remote = freshById.get(d.id);
          if (!remote || hasPendingLocalWrite(d.id)) return d;
          if (!metadataChanged(d, remote)) return d;
          return {
            ...d,
            title: remote.title,
            updatedAt: remote.updatedAt,
            ...(includePreview ? { previewSlide: remote.previewSlide } : {}),
          };
        });
      for (const a of addedDecks) {
        if (!prevIds.has(a.id)) next = [...next, a];
      }
      return next;
    });
    if (hydratedEveryAddedDeck) {
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    return "ok";
  }, [isNewerThanSnapshot]);

  const refetchDeckListIfChanged = useCallback(async (): Promise<
    DeckRead["status"] | "superseded"
  > => {
    setDeckListRefreshCount((count) => count + 1);
    try {
      return await refreshDeckListIfChanged();
    } finally {
      setDeckListRefreshCount((count) => count - 1);
    }
  }, [refreshDeckListIfChanged]);

  const runHomeGridListRefresh = useCallback(() => {
    if (syncListRefreshInFlightRef.current) {
      syncListRefreshPendingRef.current = true;
      return;
    }
    syncListRefreshInFlightRef.current = true;
    void refetchDeckListIfChanged()
      .catch((error) => {
        console.error("Failed to refresh deck list after sync events:", error);
      })
      .finally(() => {
        syncListRefreshInFlightRef.current = false;
        if (syncListRefreshPendingRef.current) {
          syncListRefreshPendingRef.current = false;
          runHomeGridListRefresh();
        }
      });
  }, [refetchDeckListIfChanged]);

  const catchUpStaleDeckList = useCallback(() => {
    if (staleDeckIdsRef.current.size > 0) runHomeGridListRefresh();
  }, [runHomeGridListRefresh]);

  const syncOpenDeck = useCallback(
    async (
      currentOpenId: string,
      options?: { clearPendingWrites?: boolean },
    ): Promise<OpenDeckSync> => {
      const snapshotGeneration = serverSnapshotGenerationRef.current;
      const requestId = nextOpenDeckRequestId(currentOpenId);
      const pendingAtReadStart = pendingWriteSlideIds(
        decksRef.current.find((d) => d.id === currentOpenId),
      );
      const writeSeqAtReadStart = deckLocalWriteSeq.get(currentOpenId) ?? 0;
      const read = await readDeckFromAPI(currentOpenId);
      if (openDeckRequestIdByDeckRef.current.get(currentOpenId) !== requestId) {
        return { read: "superseded", deck: null };
      }
      pollControlRef.current.onRead(currentOpenId, read.status);
      if (
        !options?.clearPendingWrites &&
        (deckLocalWriteSeq.get(currentOpenId) ?? 0) !== writeSeqAtReadStart
      ) {
        deferredRemoteSyncDecks.add(currentOpenId);
        return { read: read.status, deck: null };
      }
      if (read.status !== "ok") return { read: read.status, deck: null };
      const fetchedServerDeck = read.deck;
      if (options?.clearPendingWrites) {
        clearDeckDeleteTombstones(currentOpenId);
      }
      const serverDeck = reconcileServerDeckWithDeleteTombstones(
        fetchedServerDeck,
        snapshotGeneration,
      );
      refreshStaleSlideFieldBaselines(serverDeck);
      const clientDeck = decksRef.current.find((d) => d.id === currentOpenId);
      if (staleFullReplaceDrafts.has(currentOpenId)) {
        return { read: "ok", deck: serverDeck };
      }
      if (options?.clearPendingWrites) {
        lastExternalUpdateRef.current = Date.now();
        applyRemoteDeckUpdate(serverDeck, { clearPendingWrites: true });
        return { read: "ok", deck: serverDeck };
      }

      const hasLocalEdits =
        pendingCreateIdsRef.current.has(currentOpenId) ||
        hasUncommittedDeckChanges(currentOpenId, dirtyDeckIdsRef.current) ||
        (activeInlineEditSlides.get(currentOpenId)?.size ?? 0) > 0 ||
        pendingAtReadStart.size > 0;

      if (hasLocalEdits && clientDeck) {
        deferredRemoteSyncDecks.add(currentOpenId);
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
        if (merged === clientDeck) return { read: "ok", deck: serverDeck };
        lastExternalUpdateRef.current = Date.now();
        applyRemoteDeckUpdate(merged);
        return { read: "ok", deck: serverDeck };
      }

      const changed =
        !clientDeck ||
        clientDeck.updatedAt !== serverDeck.updatedAt ||
        deckContentSignature(clientDeck) !== deckContentSignature(serverDeck);
      if (!changed) return { read: "ok", deck: serverDeck };
      lastExternalUpdateRef.current = Date.now();
      applyRemoteDeckUpdate(serverDeck);
      return { read: "ok", deck: serverDeck };
    },
    [
      applyRemoteDeckUpdate,
      clearDeckDeleteTombstones,
      nextOpenDeckRequestId,
      reconcileServerDeckWithDeleteTombstones,
    ],
  );

  const refetchOpenDeckIfChanged = useCallback(
    async (
      currentOpenId: string,
      options?: { clearPendingWrites?: boolean },
    ): Promise<Deck | null> =>
      (await syncOpenDeck(currentOpenId, options)).deck,
    [syncOpenDeck],
  );

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
      ++deckListRequestIdRef.current;
      const reconciledDecks = nextDecks.map((deck) =>
        deck.previewSlide
          ? deck
          : reconcileServerDeckWithDeleteTombstones(deck, snapshotGeneration),
      );
      const protectedDecks = reconciledDecks.map(
        (deck) => staleFullReplaceDrafts.get(deck.id) ?? deck,
      );
      const protectedIds = new Set(protectedDecks.map((deck) => deck.id));
      const currentIds = new Set([
        ...decksRef.current.map((deck) => deck.id),
        ...protectedIds,
      ]);
      for (const deck of staleFullReplaceDrafts.values()) {
        if (currentIds.has(deck.id) && !protectedIds.has(deck.id)) {
          protectedDecks.push(deck);
          protectedIds.add(deck.id);
        }
      }
      const nextIds = new Set(protectedDecks.map((d) => d.id));
      for (const deck of reconciledDecks) {
        if (
          !staleFullReplaceDrafts.has(deck.id) &&
          !hasUncommittedDeckChanges(deck.id, dirtyDeckIdsRef.current)
        ) {
          confirmedSlideContentHashes.set(
            deck.id,
            new Map(
              deck.slides.map((slide) => [
                slide.id,
                hashSlideContent(slide.content),
              ]),
            ),
          );
          confirmedSlideContents.set(
            deck.id,
            new Map(deck.slides.map((slide) => [slide.id, slide.content])),
          );
        }
      }
      setDecks((prev) => {
        const preserved = prev.filter(
          (d) =>
            !nextIds.has(d.id) && isNewerThanSnapshot(d.id, createSeqAtRequest),
        );
        return preserved.length === 0
          ? protectedDecks
          : [...protectedDecks, ...preserved];
      });
      for (const id of nextIds) localCreateSeqByIdRef.current.delete(id);
      clearUndoHistory();
    },
    [
      clearUndoHistory,
      isNewerThanSnapshot,
      reconcileServerDeckWithDeleteTombstones,
    ],
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
        if (requestId === deckBaselineRequestIdRef.current) setLoading(false);
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

  const resetDeckScope = useCallback((nextOrgId: string | null) => {
    deckScopeGenerationRef.current += 1;
    const scopedDeckIds = new Set([
      ...decksRef.current.map((deck) => deck.id),
      ...pendingCreateIdsRef.current,
      ...pendingCreatePromisesRef.current.keys(),
      ...pendingDuplicateSourceIdsRef.current,
      ...dirtyDeckIdsRef.current,
      ...localCreateSeqByIdRef.current.keys(),
      ...openDeckRequestIdByDeckRef.current.keys(),
      ...pendingSaves.keys(),
      ...pendingOpsQueue.keys(),
      ...inFlightSaves,
      ...failedSaveDecks,
      ...staleContentConflicts.keys(),
      ...staleSlideFieldDrafts.keys(),
      ...staleFullReplaceDrafts.keys(),
      ...activeInlineEditSlides.keys(),
    ]);
    for (const deckId of scopedDeckIds) {
      discardPendingDeckOps(deckId);
      deckLocalWriteSeq.delete(deckId);
      deckClientWriteSequences.delete(deckId);
      deckKeepaliveSuccessGenerations.delete(deckId);
      deckServerRevisions.delete(deckId);
      slideLocalWriteSequences.delete(deckId);
      sentSlideContent.delete(deckId);
      activeInlineEditSlides.delete(deckId);
    }

    ++deckBaselineRequestIdRef.current;
    ++deckListRequestIdRef.current;
    ++serverSnapshotGenerationRef.current;
    openDeckRequestIdByDeckRef.current.clear();
    pendingCreateIdsRef.current.clear();
    pendingCreatePromisesRef.current.clear();
    deferredCreateDecksRef.current.clear();
    pendingDuplicateSourceIdsRef.current.clear();
    dirtyDeckIdsRef.current.clear();
    deletedSlideTombstonesRef.current.clear();
    slideDeleteGenerationsRef.current.clear();
    successfulReplacementTombstoneBoundariesRef.current.clear();
    localCreateSeqRef.current = 0;
    localCreateSeqByIdRef.current.clear();
    for (const controller of undoControllerRef.current.values()) {
      controller.clear();
    }
    undoControllerRef.current.clear();
    lastUndoDeckIdRef.current = null;
    setUndoAvailability({});
    lastExternalUpdateRef.current = Date.now();
    decksRef.current = [];
    setDeckScopeOrgId(nextOrgId);
    setDecks([]);
    setLoadError(false);
    setLoading(true);
  }, []);

  useEffect(() => {
    if (orgLoading) return;
    const requestId = ++deckBaselineRequestIdRef.current;
    const createSeqAtRequest = localCreateSeqRef.current;
    const snapshotGeneration = serverSnapshotGenerationRef.current;
    const requestedOpenDeckId = currentOpenDeckIdFromWindow();
    const openDeckRequestId = requestedOpenDeckId
      ? nextOpenDeckRequestId(requestedOpenDeckId)
      : null;
    const isRequestStale = () =>
      requestId !== deckBaselineRequestIdRef.current ||
      requestedOpenDeckId !== currentOpenDeckIdFromWindow() ||
      (requestedOpenDeckId !== null &&
        openDeckRequestId !==
          openDeckRequestIdByDeckRef.current.get(requestedOpenDeckId));
    const stopStaleRequest = () => {
      if (requestId === deckBaselineRequestIdRef.current) setLoading(false);
    };
    void (async () => {
      let loaded = await fetchDecksForCurrentRoute();
      if (isRequestStale()) {
        stopStaleRequest();
        return;
      }
      if (loaded === null && requestedOpenDeckId === null) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, OPEN_DECK_FALLBACK_POLL_MS),
        );
        if (isRequestStale()) {
          stopStaleRequest();
          return;
        }
        loaded = await fetchDecksForCurrentRoute();
      }
      if (isRequestStale()) {
        stopStaleRequest();
        return;
      }
      const initial = loaded ?? [];
      lastExternalUpdateRef.current = Date.now();
      resetDeckBaseline(initial, createSeqAtRequest, snapshotGeneration);
      setLoadError(loaded === null);
      setLoading(false);
    })();
  }, [nextOpenDeckRequestId, orgLoading, resetDeckBaseline]);

  // Organization changes are a hard access boundary. Clear the previous
  // scope before loading the next one so optimistic state and stale responses
  // cannot keep prior-organization decks visible.
  const lastOrgIdRef = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (orgLoading) return;
    const orgId = org?.orgId ?? null;
    if (lastOrgIdRef.current === undefined) {
      lastOrgIdRef.current = orgId;
      setDeckScopeOrgId(orgId);
      return;
    }
    if (lastOrgIdRef.current === orgId) return;
    lastOrgIdRef.current = orgId;
    replaceOpenDeckRouteWithDeckList();
    resetDeckScope(orgId);
    void reloadDecks();
  }, [org?.orgId, orgLoading, reloadDecks, resetDeckScope]);

  useEffect(() => {
    if (loading || !realtimeEnabled || isEmbedAuthActive()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastListFetchAt = 0;
    let consecutiveFailures = 0;
    // A terminal read (401, or 403/404 on the open deck) will fail the same way
    // on every tick, so the loop parks until something can change the answer:
    // focus, visibility, an announced write, navigation, or any successful read.
    let terminalStop: PollTerminalStop | null = null;
    let inFlight = false;
    let rerunForced = false;

    const readOpenDeckId = (): string | null => {
      if (typeof window === "undefined") return null;
      return deckIdFromPathname(window.location.pathname);
    };

    const isIdleHidden = () => isSurfaceHidden() && !readOpenDeckId();

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || terminalStop) return;
      const delay = fallbackPollIntervalMs({
        liveChannelConnected: liveChannelConnectedRef.current,
        hasOpenDeck: Boolean(readOpenDeckId()),
        hidden: isSurfaceHidden(),
        consecutiveFailures,
      });
      if (delay === null) return;
      timer = setTimeout(poll, delay);
    };

    const resume = () => {
      terminalStop = null;
      consecutiveFailures = 0;
    };

    const onRead = (deckId: string | null, status: DeckRead["status"]) => {
      if (stopped) return;
      // A late 403/404 for a deck the route has already left must not park
      // the loop that now serves the newly opened deck.
      const stop: PollTerminalStop | null =
        status === "unauthorized"
          ? { scope: "session" }
          : deckId !== null &&
              deckId === readOpenDeckId() &&
              (status === "not-found" || status === "forbidden")
            ? { scope: "deck", deckId }
            : null;
      if (stop) {
        terminalStop = stop;
        clearTimer();
        return;
      }
      if (status !== "ok" || !terminalStop) return;
      if (terminalStop.scope === "deck" && terminalStop.deckId !== deckId) {
        return;
      }
      resume();
      schedule();
    };

    const onRouteChange = (openDeckId: string | null) => {
      if (terminalStop?.scope !== "deck") return;
      if (terminalStop.deckId === openDeckId) return;
      resume();
      pollNow();
    };

    const isFailedRead = (read: DeckRead["status"] | "superseded") =>
      read !== "ok" && read !== "superseded";

    async function poll(force = false) {
      if (stopped || terminalStop || (!force && isIdleHidden())) return;
      // Focus and visibilitychange fire together on tab return. A trigger that
      // lands mid-tick joins it instead of racing it, so one failing tick counts
      // once; only an announced write reruns, since the read may predate it.
      if (inFlight) {
        rerunForced ||= force;
        return;
      }
      inFlight = true;
      clearTimer();
      const now = Date.now();
      const currentOpenId = readOpenDeckId();
      let failed = false;

      try {
        if (
          !currentOpenId ||
          now - lastListFetchAt >= DECK_LIST_FALLBACK_POLL_MS
        ) {
          lastListFetchAt = now;
          if (isFailedRead(await refetchDeckListIfChanged())) failed = true;
        }

        if (currentOpenId && !terminalStop && !stopped) {
          const { read } = await syncOpenDeck(currentOpenId);
          if (isFailedRead(read)) failed = true;
        }
      } catch (error) {
        failed = true;
        console.error("Deck fallback poll failed:", error);
      }
      inFlight = false;
      if (stopped) return;
      consecutiveFailures = failed ? consecutiveFailures + 1 : 0;
      if (rerunForced) {
        // The announcement is a resume trigger; a terminal result from the read
        // it raced must not swallow it.
        rerunForced = false;
        terminalStop = null;
        void poll(true);
        return;
      }
      schedule();
    }

    const pollNow = () => {
      if (terminalStop || isIdleHidden()) return;
      void poll();
    };

    const resumeAndPollNow = () => {
      resume();
      pollNow();
    };

    const refreshNow = () => {
      resume();
      void poll(true);
    };

    const handleVisibilityChange = () => {
      if (isSurfaceHidden()) schedule();
      else resumeAndPollNow();
    };

    const handlePopState = () => {
      if (staleDeckIdsRef.current.size > 0 && !readOpenDeckId()) pollNow();
    };

    void poll();
    const control: PollControl = { pollNow, onRead, onRouteChange };
    pollControlRef.current = control;
    window.addEventListener("focus", resumeAndPollNow);
    window.addEventListener("agentNative:refresh-data", refreshNow);
    const removeVisibilityListener = addSurfaceVisibilityListener(
      handleVisibilityChange,
    );
    window.addEventListener("popstate", handlePopState);

    return () => {
      stopped = true;
      clearTimer();
      if (pollControlRef.current === control) {
        pollControlRef.current = IDLE_POLL_CONTROL;
      }
      window.removeEventListener("focus", resumeAndPollNow);
      window.removeEventListener("agentNative:refresh-data", refreshNow);
      removeVisibilityListener();
      window.removeEventListener("popstate", handlePopState);
    };
  }, [loading, realtimeEnabled, refetchDeckListIfChanged, syncOpenDeck]);

  useEffect(() => {
    if (openDeckId === undefined) return;
    pollControlRef.current.onRouteChange(openDeckId);
  }, [openDeckId]);

  useEffect(() => {
    const resync = (deckId: string) => {
      if (currentOpenDeckIdFromWindow() !== deckId) return;
      void refetchOpenDeckIfChanged(deckId).catch((error) => {
        console.error(
          `Failed to re-read deck ${deckId} after local writes:`,
          error,
        );
      });
    };
    deckResyncHandlers.add(resync);
    return () => {
      deckResyncHandlers.delete(resync);
    };
  }, [refetchOpenDeckIfChanged]);

  useEffect(() => {
    if (loading) return;
    if (Date.now() - lastExternalUpdateRef.current < 2000) return;
    const dirtyIds = Array.from(dirtyDeckIdsRef.current);
    if (dirtyIds.length === 0) return;
    for (const id of dirtyIds) {
      if (
        staleContentConflicts.has(id) ||
        staleSlideFieldDrafts.has(id) ||
        staleFullReplaceDrafts.has(id) ||
        (staleContentDrafts.get(id)?.size ?? 0) > 0
      ) {
        continue;
      }
      dirtyDeckIdsRef.current.delete(id);
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

  useEffect(() => {
    const sideEffectTabs = new Set<string>();

    const onToolDone = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          completedSideEffect?: unknown;
          tabId?: unknown;
        }>
      ).detail;
      if (detail?.completedSideEffect !== true) return;
      sideEffectTabs.add(
        typeof detail.tabId === "string" && detail.tabId
          ? detail.tabId
          : "__default__",
      );
    };
    const onChatRunning = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          isRunning?: unknown;
          tabId?: unknown;
        }>
      ).detail;
      const tabId =
        typeof detail?.tabId === "string" && detail.tabId
          ? detail.tabId
          : "__default__";
      if (detail?.isRunning === true) {
        sideEffectTabs.delete(tabId);
        return;
      }
      if (detail?.isRunning !== false) return;
      if (!sideEffectTabs.delete(tabId)) return;
      const openId = currentOpenDeckIdFromWindow();
      if (openId) {
        void refetchOpenDeckIfChanged(openId).catch((error) => {
          console.error(
            `Failed to refresh deck ${openId} after agent run:`,
            error,
          );
        });
      } else {
        runHomeGridListRefresh();
      }
    };

    window.addEventListener("agent-native:tool-done", onToolDone);
    window.addEventListener("agentNative.chatRunning", onChatRunning);

    return () => {
      window.removeEventListener("agent-native:tool-done", onToolDone);
      window.removeEventListener("agentNative.chatRunning", onChatRunning);
    };
  }, [refetchOpenDeckIfChanged, runHomeGridListRefresh]);

  useEffect(() => {
    if (!realtimeEnabled || isEmbedAuthActive()) return;
    let stopped = false;
    let hasConnectedOnce = false;
    const unsubscribe = subscribeSyncEvents({
      pauseWhenHidden: true,
      onEvents: (events) => {
        const changedDeckIds = new Set<string>();
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
            changedDeckIds.add(data.deckId);
          }
        }
        if (changedDeckIds.size === 0) return;

        const openId = currentOpenDeckIdFromWindow();
        if (openId) {
          if (changedDeckIds.has(openId)) {
            const refetchPromise = refetchOpenDeckIfChanged(openId);
            void refetchPromise.catch((error) => {
              console.error(
                `Failed to refresh deck ${openId} after sync event:`,
                error,
              );
            });
          }
          for (const id of changedDeckIds.keys()) {
            if (id !== openId) staleDeckIdsRef.current.add(id);
          }
        } else {
          runHomeGridListRefresh();
        }
      },
      onSseStateChange: (connected, capabilities) => {
        if (stopped) return;
        const wasConnected = sseStreamConnectedRef.current;
        sseStreamConnectedRef.current = connected;
        liveChannelConnectedRef.current =
          connected || capabilities?.includes(REALTIME_CAP_POLL_LIVE) === true;
        if (connected) {
          if (hasConnectedOnce) void resyncDeckState();
          hasConnectedOnce = true;
        } else if (wasConnected) {
          pollControlRef.current.pollNow();
        }
      },
    });

    return () => {
      stopped = true;
      liveChannelConnectedRef.current = false;
      sseStreamConnectedRef.current = false;
      unsubscribe();
    };
  }, [
    realtimeEnabled,
    refetchOpenDeckIfChanged,
    resyncDeckState,
    runHomeGridListRefresh,
  ]);

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

  const undo = useCallback(
    (deckId = currentOpenDeckIdFromWindow() ?? lastUndoDeckIdRef.current) => {
      if (!deckId) return;
      void undoControllerRef.current.get(deckId)?.undo();
    },
    [],
  );

  const redo = useCallback(
    (deckId = currentOpenDeckIdFromWindow() ?? lastUndoDeckIdRef.current) => {
      if (!deckId) return;
      void undoControllerRef.current.get(deckId)?.redo();
    },
    [],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
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
      options?: {
        noDefaultSlides?: boolean;
        designSystemId?: string | null;
        deferPersistence?: boolean;
      },
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
      pendingCreateIdsRef.current.add(newDeck.id);
      noteLocalCreate(newDeck.id);
      if (options?.deferPersistence) {
        deferredCreateDecksRef.current.set(newDeck.id, newDeck);
      } else {
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
      }
      setDecksLocal((prev) => [...prev, newDeck]);
      undoControllerForDeck(newDeck.id).push({
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
    [noteLocalCreate, setDecksLocal, undoControllerForDeck],
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

      const deferredDeck = deferredCreateDecksRef.current.get(id);
      if (deferredDeck) {
        deferredCreateDecksRef.current.delete(id);
        const scopeGeneration = deckScopeGenerationRef.current;
        const createPromise = createDeckOnAPI(deferredDeck);
        pendingCreatePromisesRef.current.set(id, createPromise);
        try {
          await createPromise;
          return { persisted: true };
        } catch (error) {
          return { persisted: false, reason: "request-failed", error };
        } finally {
          if (scopeGeneration === deckScopeGenerationRef.current) {
            pendingCreateIdsRef.current.delete(id);
            if (pendingCreatePromisesRef.current.get(id) === createPromise) {
              pendingCreatePromisesRef.current.delete(id);
            }
          }
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
      const scopeGeneration = deckScopeGenerationRef.current;
      if (pendingDuplicateSourceIdsRef.current.has(sourceDeckId)) return null;
      pendingDuplicateSourceIdsRef.current.add(sourceDeckId);
      let source = decks.find((d) => d.id === sourceDeckId);
      if (!source) {
        pendingDuplicateSourceIdsRef.current.delete(sourceDeckId);
        return null;
      }
      if (source.slides.length === 0 && source.previewSlide) {
        const hydrated = deckOrNull(await readDeckFromAPI(sourceDeckId));
        if (!hydrated) {
          pendingDuplicateSourceIdsRef.current.delete(sourceDeckId);
          return null;
        }
        source = hydrated;
      }
      if (scopeGeneration !== deckScopeGenerationRef.current) return null;

      const now = new Date().toISOString();
      const newTitle = title || `Copy of ${source.title}`;
      const insertIndex = decksRef.current.length;
      const optimistic: Deck = {
        ...(JSON.parse(JSON.stringify(source)) as Deck),
        id: newId,
        title: newTitle,
        createdAt: now,
        updatedAt: now,
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

      pendingCreateIdsRef.current.add(newId);
      noteLocalCreate(newId);

      const duplicatePromise = callAction<DuplicateDeckActionResult>(
        "duplicate-deck",
        {
          deckId: sourceDeckId,
          newId,
          title,
          ...(optimistic.slides.length > 0
            ? { slideIds: optimistic.slides.map((s) => s.id) }
            : {}),
        },
      ).then((created) => {
        rememberDeckServerRevision(newId, created);
      });
      pendingCreatePromisesRef.current.set(newId, duplicatePromise);
      duplicatePromise
        .catch(async (err) => {
          if (scopeGeneration !== deckScopeGenerationRef.current) return;
          const probe = await probeDeckPersisted(newId);
          if (scopeGeneration !== deckScopeGenerationRef.current) return;
          if (probe.persisted) {
            console.warn(
              `Duplicate request for ${newId} failed but the deck persisted:`,
              err,
            );
            return;
          }
          console.error("Duplicate failed:", err);
          setDecks((prev) => prev.filter((d) => d.id !== newId));
          onFailure?.();
        })
        .finally(() => {
          if (scopeGeneration !== deckScopeGenerationRef.current) return;
          pendingCreateIdsRef.current.delete(newId);
          if (
            pendingCreatePromisesRef.current.get(newId) === duplicatePromise
          ) {
            pendingCreatePromisesRef.current.delete(newId);
          }
          pendingDuplicateSourceIdsRef.current.delete(sourceDeckId);
        });

      setDecksLocal((prev) => [...prev, optimistic]);
      undoControllerForDeck(optimistic.id).push({
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
    [decks, noteLocalCreate, setDecksLocal, undoControllerForDeck],
  );

  const deleteDeck = useCallback(
    (id: string) => {
      const scopeGeneration = deckScopeGenerationRef.current;
      if (deferredCreateDecksRef.current.delete(id)) {
        pendingCreateIdsRef.current.delete(id);
      }
      const beforeDeck = decksRef.current.find((deck) => deck.id === id);
      const beforeIndex = decksRef.current.findIndex((deck) => deck.id === id);
      discardPendingDeckOps(id);
      deleteDeckAfterPendingCreate(id, () => {
        if (scopeGeneration !== deckScopeGenerationRef.current || !beforeDeck) {
          return;
        }
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
        undoControllerForDeck(id).push({
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
    [deleteDeckAfterPendingCreate, setDecksLocal, undoControllerForDeck],
  );

  const updateDeck = useCallback(
    (id: string, updates: Partial<Omit<Deck, "id" | "createdAt">>) => {
      const before = decksRef.current.find((d) => d.id === id);
      const deferredDeck = deferredCreateDecksRef.current.get(id);
      if (deferredDeck) {
        const nextDeck = {
          ...deferredDeck,
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        deferredCreateDecksRef.current.set(id, nextDeck);
        setDecksLocal((prev) =>
          prev.map((deck) => (deck.id === id ? nextDeck : deck)),
        );
        return;
      }
      const optimisticDeckFitChange = before
        ? deckFitRenderFieldsChanged(before, { ...before, ...updates })
        : false;
      const { slides: _slides, ...persistableUpdates } = updates;
      const hasPersistableUpdates = Object.keys(persistableUpdates).length > 0;
      const op: PatchDeckOp | null = hasPersistableUpdates
        ? {
            op: "patch-deck-fields",
            fields: persistableUpdates as PatchDeckFields,
          }
        : null;
      if (before && op && !deriveInverseOp(before, op)) return;

      markDeckDirty(id);
      setDecksLocal((prev) =>
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
          recordUndo(before, op, {
            label: "Update deck",
            coalesceKey: `${id}:deck-fields:${Object.keys(persistableUpdates)
              .sort()
              .join(",")}`,
          });
        }
      }
    },
    [markDeckDirty, recordUndo, reconcilePersistedLayoutFit, setDecksLocal],
  );

  const deckScopeMatchesOrg =
    !orgLoading &&
    deckScopeOrgId !== undefined &&
    deckScopeOrgId === activeOrgId;
  const scopedDecks = deckScopeMatchesOrg ? decks : [];
  const getDeck = useCallback(
    (id: string) => scopedDecks.find((d) => d.id === id),
    [scopedDecks],
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
          afterSlideId = insertAt > 0 ? slides[insertAt - 1]?.id : undefined;
          slides.splice(insertAt, 0, newSlide);
          return {
            ...clearSourceImport(d),
            slides,
            updatedAt: new Date().toISOString(),
          };
        }),
      );

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
    ): string | undefined => {
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
      let normalizedUpdates = updates;
      if (typeof updates.content === "string") {
        const content = normalizeSlidePaddingForWrite(
          previousSlide?.content,
          updates.content,
        );
        const markers = renderArtifactGrowth(
          previousSlide?.content ?? "",
          content,
        );
        if (markers.length > 0) {
          refuseRenderArtifactWrite(
            markers,
            { deckId, slideId },
            tRef.current("deckEditor.editorMarkupNotSaved"),
          );
          return undefined;
        }
        normalizedUpdates = { ...updates, content };
      }
      const storedContent = normalizedUpdates.content;
      if (
        typeof storedContent === "string" &&
        previousSlide &&
        confirmedSlideContentHash(deckId, slideId) === undefined
      ) {
        rememberConfirmedSlideContent(deckId, slideId, previousSlide.content);
      }
      if (
        options?.preserveLocalState &&
        Object.keys(normalizedUpdates).length === 1 &&
        storedContent !== undefined &&
        storedContent === previousSlide?.content &&
        !hasStaleContentConflict(deckId, slideId) &&
        settleQueuedContentDraft(deckId, slideId, storedContent)
      ) {
        return storedContent;
      }
      const baseFields = slideFieldBaselines(previousSlide, normalizedUpdates);
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
      const sentContent = sentSlideContent.get(deckId)?.get(slideId)?.content;
      const op: PatchDeckOp = {
        op: "patch-slide",
        slideId,
        fields: normalizedUpdates,
        ...(baseFields ? { baseFields } : {}),
        ...(typeof normalizedUpdates.content === "string" && previousSlide
          ? {
              baseContentHash: hashSlideContent(
                sentContent ?? previousSlide.content,
              ),
            }
          : {}),
      };
      if (options?.preserveLocalState && previousSlide) {
        draftCommittedContent.set(op, previousSlide.content);
      }
      if (
        before &&
        !deriveInverseOp(before, op) &&
        !options?.preserveLocalState
      ) {
        return storedContent;
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
        return storedContent;
      }
      if (!options?.preserveLocalState) markDeckDirty(deckId);
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
      enqueueDeckOp(deckId, op, {
        persistence: options?.persistence,
        coalesceContent: options?.preserveLocalState,
        onPersisted: (results, slideWriteSequences) =>
          reconcilePersistedLayoutFit(deckId, results, slideWriteSequences),
      });
      if (before && !options?.preserveLocalState) {
        recordUndo(before, op, {
          label,
          coalesceKey: `${deckId}:${slideId}:${Object.keys(updates)
            .sort()
            .join(",")}`,
        });
      }
      return storedContent;
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
      const changedUpdates = validUpdates.filter(({ slideId, updates }) => {
        const op: PatchDeckOp = {
          op: "patch-slide",
          slideId,
          fields: updates,
        };
        return deriveInverseOp(before, op) !== null;
      });
      if (changedUpdates.length === 0) return;
      for (const { slideId, updates } of changedUpdates) {
        if (typeof updates.content !== "string") continue;
        const previousSlide = before.slides.find(
          (slide) => slide.id === slideId,
        );
        if (
          previousSlide &&
          confirmedSlideContentHash(deckId, slideId) === undefined
        ) {
          rememberConfirmedSlideContent(deckId, slideId, previousSlide.content);
        }
      }
      const ops: PatchDeckOp[] = changedUpdates.map(({ slideId, updates }) => {
        const previousSlide = before.slides.find(
          (slide) => slide.id === slideId,
        );
        const baseFields = slideFieldBaselines(previousSlide, updates);
        return {
          op: "patch-slide",
          slideId,
          fields: updates,
          ...(baseFields ? { baseFields } : {}),
          ...(typeof updates.content === "string"
            ? {
                baseContentHash: hashSlideContent(previousSlide?.content ?? ""),
              }
            : {}),
        };
      });
      const applyUpdates = (d: Deck) => {
        if (d.id !== deckId) return d;
        return {
          ...d,
          slides: d.slides.map((slide) => {
            const update = changedUpdates.find(
              ({ slideId }) => slideId === slide.id,
            );
            return update ? { ...slide, ...update.updates } : slide;
          }),
          updatedAt: new Date().toISOString(),
        };
      };
      markDeckDirty(deckId);
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
        return {
          ...clearSourceImport(d),
          slides,
          updatedAt: new Date().toISOString(),
        };
      };
      setDecksLocal((prev) => prev.map(removeSlide));
      const op: PatchDeckOp = { op: "delete-slide", slideId };
      enqueueDeckOp(deckId, op);
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
        return {
          ...clearSourceImport(d),
          slides: remaining,
          updatedAt: new Date().toISOString(),
        };
      };
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
          return {
            ...clearSourceImport(d),
            slides,
            updatedAt: new Date().toISOString(),
          };
        }),
      );
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
          return {
            ...clearSourceImport(d),
            slides,
            updatedAt: new Date().toISOString(),
          };
        }),
      );
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
        const newSlide: Slide = {
          ...fields,
          id: nanoid(8),
          content: normalizeSlidePadding(fields.content),
        };
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
        return {
          ...clearSourceImport(d),
          slides,
          updatedAt: new Date().toISOString(),
        };
      };
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
          return slides ? { ...clearSourceImport(d), slides, updatedAt } : d;
        }),
      );

      const op: PatchDeckOp = { op: "reorder-slides", orderedIds };
      enqueueDeckOp(deckId, op);
      recordUndo(before, op, { label: "Reorder slides" });
    },
    [markDeckDirty, recordUndo, setDecksLocal],
  );

  const setDeckSlides = useCallback(
    (deckId: string, slides: Slide[], options?: SetDeckSlidesOptions) => {
      // A full snapshot would overwrite the peer value behind an overlaid draft.
      if (staleSlideFieldDrafts.has(deckId)) return;
      const before = decksRef.current.find((deck) => deck.id === deckId);
      if (!before) return;
      const after: Deck = {
        ...clearSourceImport(before),
        slides,
        updatedAt: new Date().toISOString(),
      };
      for (const field of options?.clearDeckFields ?? []) {
        delete (after as unknown as Record<string, unknown>)[field];
      }
      Object.assign(after, options?.deckFields ?? {});
      if (
        deckContentSignature(before) === deckContentSignature(after) &&
        !options?.forcePersistence
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
      setDecksLocal((prev) => prev.map((d) => (d.id === deckId ? after : d)));
      enqueueDeckOp(
        deckId,
        { op: "full-replace", deck: after },
        {
          onSaveSuccess,
          persistence: options?.persistence,
          onPersisted: (results, slideWriteSequences) =>
            reconcilePersistedLayoutFit(deckId, results, slideWriteSequences),
        },
      );
      recordUndoBatch(
        before,
        deriveDeckDiffOps(before, after),
        "Replace slides",
      );
    },
    [
      captureReplacedSlideDeleteTombstones,
      markDeckDirty,
      markReplacedSlideOmissions,
      reconcilePersistedLayoutFit,
      recordUndoBatch,
      setDecksLocal,
    ],
  );

  const resolveContentConflict = useCallback(
    async (deckId: string, slideId: string, resolution: "latest" | "draft") => {
      const latestRead = await readDeckFromAPI(deckId);
      if (latestRead.status !== "ok") {
        throw new Error("Could not load the latest deck version", {
          cause: latestRead.error,
        });
      }
      const latest = latestRead.deck;
      const latestSlide = latest.slides.find((slide) => slide.id === slideId);
      if (!latestSlide)
        throw new Error("The conflicted slide no longer exists");

      const currentDeck = decksRef.current.find((deck) => deck.id === deckId);
      const localSlide = currentDeck?.slides.find(
        (slide) => slide.id === slideId,
      );
      if (!currentDeck || !localSlide) {
        throw new Error("The local slide draft is unavailable");
      }
      if (!hasStaleContentConflict(deckId, slideId)) {
        throw new Error("The slide conflict has already been resolved");
      }

      const pendingSlideOps = [
        ...(inFlightOpSlides.get(deckId) ?? []),
        ...(pendingOpsQueue.get(deckId) ?? []),
      ];
      const latestSlideWithPendingFields = pendingSlideOps.reduce(
        (slide, op) => {
          if (op.op !== "patch-slide" || op.slideId !== slideId) {
            return slide;
          }
          const fields = { ...op.fields };
          delete fields.content;
          if (Object.keys(fields).length === 0) return slide;
          return (
            applyOpToDeck({ ...latest, slides: [slide] }, { ...op, fields })
              .slides[0] ?? slide
          );
        },
        latestSlide,
      );
      const resolvedSlide = {
        ...latestSlideWithPendingFields,
        content:
          resolution === "latest" ? latestSlide.content : localSlide.content,
        layoutFitRevision: latestSlide.layoutFitRevision,
      };

      rememberDeckServerRevision(deckId, latest);
      setDecksLocal((prev) =>
        prev.map((deck) =>
          deck.id !== deckId
            ? deck
            : {
                ...deck,
                updatedAt: latest.updatedAt,
                slides: deck.slides.map((slide) =>
                  slide.id !== slideId ? slide : resolvedSlide,
                ),
              },
        ),
      );

      if (
        resolution === "draft" &&
        localSlide.content !== latestSlide.content
      ) {
        let persisted = false;
        const onPersisted: PersistedResultHandler = () => {
          persisted = true;
        };
        const op = enqueueDeckOp(
          deckId,
          {
            op: "patch-slide",
            slideId,
            fields: { content: localSlide.content },
            baseContentHash: hashSlideContent(latestSlide.content),
          },
          {
            persistence: "immediate",
            resolvingContentConflict: true,
            onPersisted,
          },
        );
        if (!op) throw new Error("The slide draft could not be queued");
        try {
          await flushDeckSave(deckId, { allowStaleContentConflicts: true });
          if (!persisted) {
            throw new Error("The slide draft could not be saved");
          }
        } catch (error) {
          discardPendingDeckOp(deckId, op, onPersisted);
          throw error;
        }
      }

      if (!clearStaleContentConflict(deckId, slideId)) {
        throw new Error("The slide conflict has already been resolved");
      }
      if (resolution === "latest") {
        const hasPendingWrites =
          pendingOpsQueue.has(deckId) ||
          inFlightOpSlides.has(deckId) ||
          pendingSaves.has(deckId) ||
          inFlightSaveChains.has(deckId) ||
          inFlightKeepaliveSaves.has(deckId);
        if (!hasPendingWrites) {
          const wasFailed = failedSaveDecks.has(deckId);
          clearDeckSaveFailure(deckId);
          deckSaveRetryAttempts.delete(deckId);
          deckRevisionConflictRetryAttempts.delete(deckId);
          if (wasFailed) notifySaveListeners();
        }
        if (pendingOpsQueue.has(deckId)) void drainPendingDeckOps(deckId);
      }
    },
    [setDecksLocal],
  );

  return (
    <DeckContext.Provider
      value={{
        decks: scopedDecks,
        loading: loading || !deckScopeMatchesOrg,
        loadError,
        deckListRefreshing: deckListRefreshCount > 0,
        createDeck,
        ensureDeckPersisted,
        duplicateDeck,
        deleteDeck,
        updateDeck,
        reloadDecks,
        reloadDecksWithStatus,
        catchUpStaleDeckList,
        refreshOpenDeck: refetchOpenDeckIfChanged,
        resolveDeckContentConflict,
        getDeck,
        addSlide,
        flushDeckSave,
        retryDeckSave,
        resolveContentConflict,
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
        undoAvailability,
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

export function useSaveState(): {
  saving: boolean;
  hasUnsavedChanges: boolean;
} {
  const snapshot = useSyncExternalStore(
    subscribeSaveState,
    getSaveSnapshot,
    () => serverSaveSnapshot,
  );
  return {
    saving: snapshot.saving,
    hasUnsavedChanges: snapshot.hasUnsavedChanges,
  };
}
