import { useAgentEngineConfigured } from "@agent-native/core/client/agent-chat";
import { trackEvent } from "@agent-native/core/client/analytics";
import type { PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import {
  callAction,
  deleteClientAppState,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { LazyChunkErrorBoundary } from "@agent-native/core/client/lazy-chunk-error-boundary";
import { LazyChunkRetryFallback } from "@agent-native/core/client/lazy-chunk-retry-fallback";
import {
  FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
  fetchFirstRunOnboardingStatus,
  isFirstRunOnboardingEnabled,
} from "@agent-native/core/client/onboarding";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
} from "@agent-native/core/client/settings";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import {
  AgentSuggestionBar,
  agentSuggestionPrompt,
} from "@agent-native/toolkit/agentkit";
import {
  PromptHome,
  PromptHomeLibrary,
  type PromptHomeLibraryTab,
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { extractGoogleDocUrls } from "@shared/google-docs";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import {
  lazy,
  Suspense,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import DeckCard from "@/components/deck/DeckCard";
import { DeckFilterMenu } from "@/components/deck/DeckFilterMenu";
import { DeckEditorSkeleton } from "@/components/editor/DeckEditorSkeleton";
import { ImportDeckButton } from "@/components/editor/ImportDeckButton";
import {
  NewDeckReferenceStep,
  type ImportedReference,
  type NewDeckReferenceSelection,
  type NewDeckReferenceSource,
} from "@/components/editor/NewDeckReferenceStep";
import type {
  PromptAttachmentActions,
  PromptImportSelection,
  PromptChatAttachment,
  PromptPopoverHandle,
} from "@/components/editor/PromptDialog";
import { useSlidesComposerContext } from "@/components/editor/SlidesComposerContext";
import { usePromptImport } from "@/components/editor/use-prompt-import";
import { HomeHeaderActions } from "@/components/layout/Header";
import { DeckTemplateLibrary } from "@/components/templates/DeckTemplateLibrary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeDeckPersistenceFailure,
  type Deck,
} from "@/context/DeckContext";
import { deckIdFromPathname, useDecks } from "@/context/DeckContext";
import {
  clearStartedGenerationAttempt,
  useAgentGenerating,
} from "@/hooks/use-agent-generating";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useWorkspaceDefaults } from "@/hooks/use-workspace-defaults";
import { createDeckAgentMessage } from "@/lib/agent-visible-message";
import {
  formatSlidesComposerContext,
  type SlidesPromptSubmitOptions,
} from "@/lib/composer-context";
import { savePromptToComposerDraft } from "@/lib/composer-draft";
import {
  describeUploadedFilesForAgent,
  getUploadedImageAgentOptions,
  isSourceImprovementRequest,
  persistDeckGenerationContext,
  requestedSlideCount,
  WEBSITE_STYLE_REFERENCE_DIRECTIVE,
} from "@/lib/create-deck-generation";
import {
  readStoredDeckFilter,
  resolveDeckFilter,
  writeStoredDeckFilter,
  type DeckFilter,
} from "@/lib/deck-filter";
import { deckListViewState } from "@/lib/deck-list-loading";
import { sortDecksByRecency } from "@/lib/deck-sorting";
import { resolveSelectableDesignSystemId } from "@/lib/design-system-selection";
import {
  IMPORT_ACTION_TIMEOUT_MS,
  importUploadedDeckIntoDeck,
  type ImportedSourceDeck,
} from "@/lib/import-uploaded-deck";
import type { UploadedFile } from "@/lib/prompt-file-uploads";
import {
  forgetRecentReference,
  readRecentReferences,
  rememberRecentReference,
  type RecentReference,
} from "@/lib/recent-references";
import { hydrateReferenceDocuments } from "@/lib/reference-document-hydration";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

const loadPromptPopover = () => import("@/components/editor/PromptDialog");
const LazyPromptPopover = lazy(loadPromptPopover);
const LazyDesignSystemSetup = lazy(() =>
  import("@/components/design-system/DesignSystemSetup").then(
    ({ DesignSystemSetup }) => ({
      default: DesignSystemSetup,
    }),
  ),
);

async function uploadPromptFiles(files: File[]): Promise<UploadedFile[]> {
  const module = await import("@/lib/prompt-file-uploads");
  return module.uploadPromptFiles(files);
}

function preloadPromptPopover() {
  // This is an optional hover/focus optimization; rendering the opened popover
  // is where a failed chunk load is surfaced through its recovery boundary.
  void loadPromptPopover().catch(() => {});
}

const NEW_DECK_DRAFT_SCOPE = "slides-new-deck";
const PENDING_PROMPT_KEY = "slides:pending-deck-prompt";
const PENDING_PROMPT_CONTEXT_KEY = "slides:pending-deck-prompt-context";
const PENDING_PROMPT_MODEL_SELECTION_KEY =
  "slides:pending-deck-model-selection";

type DeckModelSelection = Pick<
  PromptComposerSubmitOptions,
  "model" | "engine" | "effort"
>;

const RETRY_REASONING_EFFORTS = new Set([
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

interface HomeSuggestion {
  id?: string;
  label: string;
  prompt: string;
}

interface HomeSuggestionsResult {
  suggestions: HomeSuggestion[];
}

/** Router-state payload for recovering the new-deck prompt after a failed
 *  generation kickoff forces a navigate away from and back to this route. */
/**
 * A reference deck built from an upload, paired with the source file it came
 * from. Kept together so a retry skips re-reading that file only while the
 * same reference deck is still selected.
 */
interface ImportedReferenceSource {
  deckId: string;
  filePath: string;
}

interface DeckGenerationRetryState {
  retryPrompt?: string;
  retryFiles?: UploadedFile[];
  retryReferenceFilePaths?: string[];
  retryImportedReference?: ImportedReferenceSource;
  retryContext?: string;
  retryAttachments?: ReadonlyArray<PromptChatAttachment>;
  modelSelection?: DeckModelSelection;
}

type StoredModelSelectionResult =
  | { state: "absent" }
  | { state: "unreadable" }
  | { state: "available"; selection: DeckModelSelection };

function readStoredModelSelection(): StoredModelSelectionResult {
  try {
    const raw = sessionStorage.getItem(PENDING_PROMPT_MODEL_SELECTION_KEY);
    if (!raw) return { state: "absent" };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "unreadable" };
    }
    const value = parsed as Record<string, unknown>;
    if (
      (value.model !== undefined && typeof value.model !== "string") ||
      (value.engine !== undefined && typeof value.engine !== "string") ||
      (value.effort !== undefined &&
        (typeof value.effort !== "string" ||
          !RETRY_REASONING_EFFORTS.has(value.effort)))
    ) {
      return { state: "unreadable" };
    }
    if (
      value.model === undefined &&
      value.engine === undefined &&
      value.effort === undefined
    ) {
      return { state: "unreadable" };
    }
    return {
      state: "available",
      selection: {
        ...(typeof value.model === "string" ? { model: value.model } : {}),
        ...(typeof value.engine === "string" ? { engine: value.engine } : {}),
        ...(typeof value.effort === "string"
          ? { effort: value.effort as DeckModelSelection["effort"] }
          : {}),
      },
    };
  } catch (error) {
    console.warn(
      "[slides] pending model selection could not be restored",
      error,
    );
    return { state: "unreadable" };
  }
}

function savePromptForRetry(
  prompt: string,
  options: {
    context?: string;
    modelSelection?: DeckModelSelection;
    persistAcrossSignIn?: boolean;
  } = {},
) {
  let signInHandoffSaved = !options.persistAcrossSignIn;
  if (options.persistAcrossSignIn) {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
      if (options.context) {
        sessionStorage.setItem(PENDING_PROMPT_CONTEXT_KEY, options.context);
      } else {
        sessionStorage.removeItem(PENDING_PROMPT_CONTEXT_KEY);
      }
      if (options.modelSelection) {
        sessionStorage.setItem(
          PENDING_PROMPT_MODEL_SELECTION_KEY,
          JSON.stringify(options.modelSelection),
        );
      } else {
        sessionStorage.removeItem(PENDING_PROMPT_MODEL_SELECTION_KEY);
      }
      signInHandoffSaved = true;
    } catch {}
  }
  const draftSaved = savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, prompt);
  return signInHandoffSaved && draftSaved;
}

function clearPendingPromptForRetry() {
  try {
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
    sessionStorage.removeItem(PENDING_PROMPT_CONTEXT_KEY);
    sessionStorage.removeItem(PENDING_PROMPT_MODEL_SELECTION_KEY);
  } catch {}
}

function mergeUploadedFilesForRetry(
  savedFiles: UploadedFile[],
  newFiles: UploadedFile[],
): UploadedFile[] {
  const seen = new Set<string>();
  return [...savedFiles, ...newFiles].filter((file) => {
    const key = file.path || file.url || file.filename;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface DesignSystemGenerationContextResult {
  title?: string;
  agentContext?: string;
}

async function loadDesignSystemGenerationContext(
  designSystemId?: string | null,
): Promise<string> {
  if (!designSystemId) return "";
  try {
    const result = (await callAction(
      "get-design-system",
      { id: designSystemId },
      { method: "GET" },
    )) as DesignSystemGenerationContextResult | undefined;
    if (result?.agentContext?.trim()) {
      return [
        "",
        result.agentContext.trim(),
        "",
        "The selected design system context above was hydrated before this agent run. Follow it directly; do not replace it with generic colors, fonts, spacing, imagery, or slide components.",
      ].join("\n");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    return [
      "",
      "## Selected Design System Context",
      `The selected design system id "${designSystemId}" could not be loaded before generation: ${message}`,
      "Before adding slides, call `get-design-system` for this id. If it still fails, stop and tell the user the selected design system is unavailable instead of improvising a generic style.",
    ].join("\n");
  }
  return [
    "",
    "## Selected Design System Context",
    `The selected design system id "${designSystemId}" returned no generation context.`,
    "Call `get-design-system` for this id before adding slides. If it still has no usable tokens/docs, stop and ask the user to finish design-system indexing instead of improvising a generic style.",
  ].join("\n");
}

interface ReferenceDeckContextResult {
  agentContext?: string;
}

async function loadReferenceDeckGenerationContext(
  referenceDeckId?: string | null,
): Promise<string> {
  if (!referenceDeckId) return "";
  try {
    const result = (await callAction(
      "get-deck-reference-context",
      { id: referenceDeckId },
      { method: "GET" },
    )) as ReferenceDeckContextResult | undefined;
    if (result?.agentContext?.trim()) {
      return `\n${result.agentContext.trim()}`;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    return [
      "",
      "## Reference Deck",
      `The user picked deck "${referenceDeckId}" as a style reference, but it could not be loaded before generation: ${message}`,
      "Before adding slides, call `get-deck-reference-context` for this id. If it still fails, tell the user the reference deck is unavailable instead of inventing a style.",
    ].join("\n");
  }
  return [
    "",
    "## Reference Deck",
    `The user picked deck "${referenceDeckId}" as a style reference, but it returned no usable context.`,
    `Call \`get-deck --id ${referenceDeckId}\` before adding slides. If that deck is empty, tell the user instead of silently generating without a reference.`,
  ].join("\n");
}

export default function Index() {
  const t = useT();
  const {
    decks,
    createDeck,
    duplicateDeck,
    ensureDeckPersisted,
    deleteDeck,
    updateDeck,
    loading,
    loadError,
    reloadDecks,
    catchUpStaleDeckList,
  } = useDecks();
  const systemsEnabled = useDesignSystemWorkflows();
  const {
    designSystems,
    defaultSystem,
    refetch: refetchDesignSystems,
    error: designSystemsError,
    isLoading: designSystemsLoading,
  } = useDesignSystems(systemsEnabled);
  const {
    referenceDeck: workspaceReferenceDeck,
    designSystem: workspaceDesignSystem,
    canManage: canManageWorkspaceDefaults,
    refetch: refetchWorkspaceDefaults,
  } = useWorkspaceDefaults();
  const { session } = useSession();
  const agentEngine = useAgentEngineConfigured();
  const builderConnect = useBuilderConnectFlow({
    enabled: agentEngine.missing,
    provisionAccount: true,
    trackingSource: "slides_home",
  });
  const quickActionsEnabled =
    agentEngine.state === "configured" && !agentEngine.missing;
  const homeSuggestionsQuery = useActionQuery<HomeSuggestionsResult>(
    "generate-home-suggestions",
    {},
    {
      enabled: quickActionsEnabled,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  );
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deckToDelete, setDeckToDelete] = useState<string | null>(null);
  const [workspaceDefaultCandidate, setWorkspaceDefaultCandidate] =
    useState<Deck | null>(null);
  const [showNewDeckPrompt, setShowNewDeckPrompt] = useState(true);
  const homeComposerRef = useRef<PromptPopoverHandle>(null);
  const [newDeckInitialPrompt, setNewDeckInitialPrompt] = useState<{
    text: string;
    key: number;
  } | null>(null);
  const [newDeckRetryFiles, setNewDeckRetryFiles] = useState<UploadedFile[]>(
    [],
  );
  const [newDeckRetryReferenceFilePaths, setNewDeckRetryReferenceFilePaths] =
    useState<string[]>([]);
  const [newDeckRetryImportedReference, setNewDeckRetryImportedReference] =
    useState<ImportedReferenceSource | undefined>();
  const [newDeckRetryContext, setNewDeckRetryContext] = useState<
    string | undefined
  >();
  const [newDeckRetryPrompt, setNewDeckRetryPrompt] = useState<
    string | undefined
  >();
  const [newDeckRetryAttachments, setNewDeckRetryAttachments] = useState<
    ReadonlyArray<PromptChatAttachment>
  >([]);
  const [newDeckRetryModelSelection, setNewDeckRetryModelSelection] = useState<
    DeckModelSelection | undefined
  >();
  const [pendingDeck, setPendingDeck] = useState<{
    prompt: string;
    files: UploadedFile[];
    referenceFilePaths: string[];
    importedReference?: ImportedReferenceSource;
    context?: string;
    attachments: ReadonlyArray<PromptChatAttachment>;
    modelSelection?: DeckModelSelection;
  } | null>(null);
  const pendingDeckAttachmentActionsRef =
    useRef<PromptAttachmentActions | null>(null);
  const pendingDeckGenerationRef = useRef<Promise<void> | null>(null);
  const [showNewDeckReferenceStep, setShowNewDeckReferenceStep] =
    useState(false);
  const [isStartingNewDeck, setIsStartingNewDeck] = useState(false);
  const [recentReferences, setRecentReferences] = useState<RecentReference[]>(
    [],
  );
  const [referenceImporting, setReferenceImporting] = useState(false);
  const initialPromptConsumedRef = useRef(false);
  const [signInPromptHadFiles, setSignInPromptHadFiles] = useState(false);
  const [chosenDesignSystemId, setSelectedDesignSystemId] = useState<
    string | null
  >(null);
  const selectedDesignSystemId = systemsEnabled ? chosenDesignSystemId : null;
  const [selectedReferenceDeckId, setSelectedReferenceDeckId] = useState<
    string | null
  >(null);
  const [deckSearch, setDeckSearch] = useState("");
  const [homeSection, setHomeSection] =
    useState<PromptHomeLibraryTab>("templates");
  const deckFilterWasSelectedRef = useRef(false);
  useEffect(() => {
    if (deckSearch.trim()) setHomeSection("recent");
  }, [deckSearch]);
  const [storedDeckFilter, setStoredDeckFilter] = useState<DeckFilter>("mine");
  // True while the picker still reflects an auto-applied default rather than
  // an explicit user choice. `useWorkspaceDefaults()`/`useDesignSystems()`
  // resolve asynchronously, so the initial value set on dialog open can be a
  // placeholder ("none") - these stay true so the hydration effects below
  // can overwrite it once the real default arrives, and flip to false the
  // moment the user picks explicitly.
  const designSystemAutoRef = useRef(true);
  const referenceDeckAutoRef = useRef(true);
  const [showSignInDialog, setShowSignInDialog] = useState(false);
  const [showDesignSystemSetup, setShowDesignSystemSetup] = useState(false);
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const effectiveDefaultDesignSystemId = resolveSelectableDesignSystemId(
    designSystems,
    defaultSystem?.id,
  );
  const workspaceDesignSystemId =
    workspaceDesignSystem && workspaceDesignSystem.status === "available"
      ? workspaceDesignSystem.id
      : null;
  const lastUsedDesignSystemId =
    recentReferences.find(
      (reference) =>
        reference.kind === "design-system" &&
        designSystems.some((designSystem) => designSystem.id === reference.id),
    )?.id ?? null;
  const lastUsedReferenceDeckId =
    recentReferences.find(
      (reference) =>
        reference.kind === "deck" &&
        decks.some((deck) => deck.id === reference.id),
    )?.id ?? null;
  const initialDesignSystemId = systemsEnabled
    ? (lastUsedDesignSystemId ??
      effectiveDefaultDesignSystemId ??
      workspaceDesignSystemId)
    : null;
  const initialReferenceDeckId = lastUsedReferenceDeckId;
  const composerContext = useSlidesComposerContext({
    defaultDesignSystemId: initialDesignSystemId,
    defaultReferenceDeck: decks.find(
      (deck) => deck.id === initialReferenceDeckId,
    ),
    systems: designSystems,
    systemsError: designSystemsError,
    systemsLoading: designSystemsLoading,
    retrySystems: refetchDesignSystems,
    onCreateDesignSystem: () => setShowDesignSystemSetup(true),
  });
  const createdByParam = searchParams.get("createdBy");
  const deckFilter = resolveDeckFilter(createdByParam, storedDeckFilter);
  const normalizedDeckSearch = deckSearch.trim().toLowerCase();
  const visibleDecks = useMemo(
    () =>
      sortDecksByRecency(
        decks.filter((deck) => {
          if (deckFilter === "mine" && !deck.createdByMe) return false;
          return (
            normalizedDeckSearch.length === 0 ||
            deck.title.toLowerCase().includes(normalizedDeckSearch)
          );
        }),
      ),
    [deckFilter, decks, normalizedDeckSearch],
  );
  const rememberReference = useCallback(
    (reference: Parameters<typeof rememberRecentReference>[0]) => {
      const result = rememberRecentReference(reference);
      if (result.readable) setRecentReferences(result.items);
    },
    [],
  );
  const forgetReference = useCallback((kind: RecentReference["kind"]) => {
    const result = forgetRecentReference(kind);
    if (result.readable) setRecentReferences(result.items);
  }, []);

  // Refreshes cards for decks that changed while a different deck was open
  // (see `catchUpStaleDeckList`'s own comment in DeckContext).
  useEffect(() => {
    catchUpStaleDeckList();
  }, [catchUpStaleDeckList]);

  useEffect(() => {
    const result = readRecentReferences();
    if (result.readable) setRecentReferences(result.items);
  }, []);

  useEffect(() => {
    if (createdByParam !== null) return;
    const savedFilter = readStoredDeckFilter();
    if (savedFilter) setStoredDeckFilter(savedFilter);
  }, [createdByParam]);

  const initialPrompt = searchParams.get("initialPrompt")?.trim() ?? "";
  const clearInitialPromptFromUrl = useCallback(() => {
    setSearchParams(
      (previous) => {
        if (previous.get("initialPrompt")?.trim() !== initialPrompt) {
          return previous;
        }
        const next = new URLSearchParams(previous);
        next.delete("initialPrompt");
        return next;
      },
      { replace: true },
    );
  }, [initialPrompt, setSearchParams]);
  const onboardingPreview = searchParams.get("onboarding") === "preview";
  const firstRunOnboardingEnabled =
    onboardingPreview || isFirstRunOnboardingEnabled();
  const openInitialPrompt = useCallback(() => {
    if (!initialPrompt || initialPromptConsumedRef.current) return;
    initialPromptConsumedRef.current = true;
    setNewDeckInitialPrompt({ text: initialPrompt, key: Date.now() });
    setShowNewDeckPrompt(true);
    void loadPromptPopover()
      .then(clearInitialPromptFromUrl)
      .catch(() => {});
  }, [clearInitialPromptFromUrl, initialPrompt]);

  useEffect(() => {
    if (!initialPrompt || initialPromptConsumedRef.current) return;
    const handleFirstRunCompleted = () => openInitialPrompt();
    const handleFirstRunStatusResolved = (event: Event) => {
      const firstRun =
        (event as CustomEvent<{ firstRun?: unknown }>).detail?.firstRun ===
        true;
      if (!firstRun) openInitialPrompt();
    };

    if (!firstRunOnboardingEnabled) {
      openInitialPrompt();
      return;
    }

    window.addEventListener(
      "agent-native:first-run-completed",
      handleFirstRunCompleted,
    );
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      handleFirstRunStatusResolved,
    );
    void fetchFirstRunOnboardingStatus().catch(() => {
      openInitialPrompt();
    });
    return () => {
      window.removeEventListener(
        "agent-native:first-run-completed",
        handleFirstRunCompleted,
      );
      window.removeEventListener(
        FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
        handleFirstRunStatusResolved,
      );
    };
  }, [firstRunOnboardingEnabled, initialPrompt, openInitialPrompt]);

  const setDeckFilter = useCallback(
    (value: string) => {
      const nextFilter = value === "mine" ? "mine" : "all";
      deckFilterWasSelectedRef.current = true;
      setStoredDeckFilter(nextFilter);
      writeStoredDeckFilter(nextFilter);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextFilter === "mine") {
            next.set("createdBy", "me");
          } else {
            next.delete("createdBy");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (
      deckFilterWasSelectedRef.current ||
      deckFilter !== "mine" ||
      searchParams.has("createdBy") ||
      decks.length === 0 ||
      decks.some((deck) => deck.createdByMe)
    ) {
      return;
    }
    deckFilterWasSelectedRef.current = true;
    setStoredDeckFilter("all");
    writeStoredDeckFilter("all");
  }, [deckFilter, decks, searchParams]);

  const setNewDeckPromptOpen = useCallback(
    (open: boolean, options: { clearInitialPrompt?: boolean } = {}) => {
      if (open) preloadPromptPopover();
      setShowNewDeckPrompt(open);
      if (!open) {
        if (options.clearInitialPrompt !== false) {
          setNewDeckInitialPrompt(null);
          setNewDeckRetryFiles([]);
          setNewDeckRetryReferenceFilePaths([]);
          setNewDeckRetryImportedReference(undefined);
          setNewDeckRetryContext(undefined);
          setNewDeckRetryPrompt(undefined);
          setNewDeckRetryAttachments([]);
          setNewDeckRetryModelSelection(undefined);
        }
      }
    },
    [],
  );

  const preservePromptForSignIn = useCallback(
    (
      prompt: string,
      options: {
        context?: string;
        attachments?: ReadonlyArray<PromptChatAttachment>;
        hadFiles?: boolean;
        modelSelection?: DeckModelSelection;
      } = {},
    ) => {
      if (
        !savePromptForRetry(prompt, {
          context: options.context,
          modelSelection: options.modelSelection,
          persistAcrossSignIn: true,
        })
      ) {
        setNewDeckInitialPrompt({ text: prompt, key: Date.now() });
      }
      setNewDeckRetryContext(options.context);
      setNewDeckRetryPrompt(prompt);
      setNewDeckRetryFiles([]);
      setNewDeckRetryReferenceFilePaths([]);
      setNewDeckRetryImportedReference(undefined);
      setNewDeckRetryAttachments(options.attachments ?? []);
      setNewDeckRetryModelSelection(options.modelSelection);
      setSignInPromptHadFiles(Boolean(options.hadFiles));
      setNewDeckPromptOpen(false, { clearInitialPrompt: false });
      setShowSignInDialog(true);
    },
    [setNewDeckPromptOpen],
  );

  const setSignInDialogOpen = useCallback((open: boolean) => {
    setShowSignInDialog(open);
    if (!open) {
      setSignInPromptHadFiles(false);
      setShowNewDeckPrompt(true);
    }
  }, []);

  // Re-syncs the design-system picker whenever the resolved default changes
  // while the dialog is open, not just on the first render after it opens.
  // `useWorkspaceDefaults()` and `useDesignSystems()` load asynchronously and
  // can settle in either order, so `initialDesignSystemId` may go from a
  // provisional value to the real one after the picker already has a
  // selection - guarding on `designSystemAutoRef` (instead of on whether
  // `selectedDesignSystemId` is already set) lets that later value win as
  // long as the user hasn't explicitly chosen something.
  useEffect(() => {
    if (!showNewDeckPrompt || !designSystemAutoRef.current) return;
    if (initialDesignSystemId) {
      setSelectedDesignSystemId(initialDesignSystemId);
    } else {
      setSelectedDesignSystemId(null);
    }
  }, [initialDesignSystemId, designSystems.length, showNewDeckPrompt]);

  // Same as above for the reference-deck picker: the local last-used reference
  // can still be loading when the dialog opens, so re-apply it once it
  // resolves unless the user already picked a reference deck.
  useEffect(() => {
    if (!showNewDeckPrompt || !referenceDeckAutoRef.current) return;
    setSelectedReferenceDeckId(initialReferenceDeckId ?? null);
  }, [initialReferenceDeckId, showNewDeckPrompt]);

  // Restore a prompt that was held back when the user wasn't signed in:
  // we wrote the text to sessionStorage before redirecting to sign-in,
  // and now that they're back and authenticated, replay it into the
  // composer's localStorage draft and pop the new-deck dialog open so
  // they can hit submit without retyping.
  useEffect(() => {
    if (!session) return;
    let saved: string | null = null;
    let savedContext: string | undefined;
    let savedModelSelection: DeckModelSelection | undefined;
    try {
      saved = sessionStorage.getItem(PENDING_PROMPT_KEY);
      savedContext =
        sessionStorage.getItem(PENDING_PROMPT_CONTEXT_KEY) ?? undefined;
      const storedModelSelection = readStoredModelSelection();
      savedModelSelection =
        storedModelSelection.state === "available"
          ? storedModelSelection.selection
          : undefined;
    } catch {}
    if (!saved) return;
    setNewDeckRetryContext(savedContext);
    setNewDeckRetryPrompt(saved);
    setNewDeckRetryModelSelection(savedModelSelection);
    savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, saved);
    clearPendingPromptForRetry();
    setNewDeckInitialPrompt({ text: saved, key: Date.now() });
    designSystemAutoRef.current = true;
    referenceDeckAutoRef.current = true;
    setSelectedDesignSystemId(initialDesignSystemId ?? null);
    setSelectedReferenceDeckId(initialReferenceDeckId ?? null);
    setShowNewDeckPrompt(true);
  }, [initialDesignSystemId, initialReferenceDeckId, session]);

  // Recovering from a failed deck-generation kickoff (see
  // recoverFromGenerationSetupFailure below) navigates back to this route
  // from an Index instance that already unmounted, so that instance's own
  // setShowNewDeckPrompt/setNewDeckInitialPrompt calls landed on a dead
  // component and did nothing. Carry the retry payload through router state
  // instead and restore it here, on the freshly mounted instance.
  useEffect(() => {
    const state = location.state as DeckGenerationRetryState | null;
    if (!state?.retryPrompt) return;
    savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, state.retryPrompt);
    setNewDeckInitialPrompt({ text: state.retryPrompt, key: Date.now() });
    setNewDeckRetryFiles(state.retryFiles ?? []);
    setNewDeckRetryReferenceFilePaths(state.retryReferenceFilePaths ?? []);
    setNewDeckRetryImportedReference(state.retryImportedReference);
    setNewDeckRetryContext(state.retryContext);
    setNewDeckRetryPrompt(state.retryPrompt);
    setNewDeckRetryAttachments(state.retryAttachments ?? []);
    setNewDeckRetryModelSelection(state.modelSelection);
    setShowNewDeckPrompt(true);
    void navigate(".", { replace: true, state: null });
  }, [location.state, navigate]);

  const handleCreateDeckBlank = () => {
    const selectedDesignSystem = selectedDesignSystemId
      ? designSystems.find((ds) => ds.id === selectedDesignSystemId)
      : undefined;
    let deck: ReturnType<typeof createDeck> | undefined;
    flushSync(() => {
      setIsStartingNewDeck(true);
      deck = createDeck(undefined, {
        designSystemId: selectedDesignSystem?.id ?? null,
      });
    });
    if (!deck) {
      setIsStartingNewDeck(false);
      return;
    }
    void navigate(`/deck/${deck.id}`);
  };

  const settlePendingDeckAttachments = useCallback(
    (result: "commit" | "discard") => {
      const actions = pendingDeckAttachmentActionsRef.current;
      pendingDeckAttachmentActionsRef.current = null;
      actions?.[result]();
    },
    [],
  );

  const handlePendingDeckAttachmentsAbandoned = useCallback(() => {
    if (!pendingDeckGenerationRef.current) {
      settlePendingDeckAttachments("discard");
    }
  }, [settlePendingDeckAttachments]);

  const handleCreateDeckWithPrompt = async (
    prompt: string,
    files: UploadedFile[],
    referenceSelection: NewDeckReferenceSelection = {},
    additionalContext = "",
    attachments: ReadonlyArray<PromptChatAttachment> = [],
    modelSelection?: DeckModelSelection,
  ) => {
    // Pre-flight auth check. The add-deck action returns 403 silently
    // when unauthenticated, leaving the user stuck on a deck page that
    // doesn't exist server-side and a small auth error in the chat
    // sidebar. Catch it here so the user sees a clear sign-in prompt
    // and the typed prompt isn't lost when they come back.
    if (!session) {
      settlePendingDeckAttachments("discard");
      preservePromptForSignIn(prompt, {
        context: additionalContext,
        attachments,
        hadFiles: files.length > 0,
        modelSelection,
      });
      return;
    }

    const filesForGeneration = mergeUploadedFilesForRetry(
      newDeckRetryFiles,
      files,
    );
    const attachmentsForGeneration = [
      ...newDeckRetryAttachments,
      ...attachments,
    ];
    const designSystemId =
      referenceSelection.designSystemId !== undefined
        ? referenceSelection.designSystemId
        : selectedDesignSystemId && selectedDesignSystemId !== "none"
          ? selectedDesignSystemId
          : null;
    const referenceDeckId =
      referenceSelection.referenceDeckId !== undefined
        ? referenceSelection.referenceDeckId
        : selectedReferenceDeckId && selectedReferenceDeckId !== "none"
          ? selectedReferenceDeckId
          : null;
    const referenceFilePaths = new Set(
      referenceSelection.referenceFilePaths ?? [],
    );
    const importedReferenceFilePath =
      referenceSelection.importedReferenceFilePath;
    const importedReferenceSource: ImportedReferenceSource | undefined =
      referenceSelection.referenceDeckId && importedReferenceFilePath
        ? {
            deckId: referenceSelection.referenceDeckId,
            filePath: importedReferenceFilePath,
          }
        : undefined;
    const filesForSourceImprovement = filesForGeneration.filter(
      (file) => !referenceFilePaths.has(file.path),
    );
    const selectedDesignSystem = designSystemId
      ? designSystems.find((ds) => ds.id === designSystemId)
      : undefined;
    let deck: ReturnType<typeof createDeck> | undefined;
    flushSync(() => {
      // Commit the destination-shaped shell before navigating. React Router
      // keeps the current outlet mounted while a cold route chunk loads, and
      // showing the deck grid during that handoff makes the route indicator
      // look like a second app.
      setIsStartingNewDeck(true);
      deck = createDeck(undefined, {
        noDefaultSlides: true,
        designSystemId: selectedDesignSystem?.id ?? null,
      });
    });
    if (!deck) {
      settlePendingDeckAttachments("discard");
      setIsStartingNewDeck(false);
      return;
    }
    const deckId = deck.id;
    const generationAttemptId = nanoid();
    let generationFailureTracked = false;
    const generationSubmitMessageId = nanoid();
    trackEvent("generation_started", {
      app_name: "slides",
      template_name: "slides",
      generation_attempt_id: generationAttemptId,
      output_id: deckId,
      output_type: "deck",
      source: "new_deck_prompt",
    });
    setNewDeckPromptOpen(false);

    // Leave the grid as soon as the optimistic deck exists. Persistence and
    // agent context hydration can take several seconds, so the editor's
    // generation state is the only useful surface while that work finishes.
    void navigate(
      `/deck/${deck.id}?generating=1&generation_attempt_id=${encodeURIComponent(generationAttemptId)}&generationSubmitId=${encodeURIComponent(generationSubmitMessageId)}`,
      {
        replace: true,
        flushSync: true,
      },
    );

    const recoverFromGenerationSetupFailure = (
      description: string,
      failureCode = "setup_failed",
    ) => {
      if (!generationFailureTracked) {
        generationFailureTracked = true;
        trackEvent("generation_failed", {
          app_name: "slides",
          template_name: "slides",
          generation_attempt_id: generationAttemptId,
          output_id: deckId,
          output_type: "deck",
          failure_code: failureCode,
          failure_stage: "setup",
          source: "new_deck_prompt",
        });
      }
      settlePendingDeckAttachments("discard");
      if (
        !savePromptForRetry(prompt, {
          context: additionalContext,
          modelSelection,
        })
      ) {
        setNewDeckInitialPrompt({ text: prompt, key: Date.now() });
      }
      setNewDeckRetryContext(additionalContext || undefined);
      setNewDeckRetryPrompt(prompt);
      setNewDeckRetryFiles(filesForGeneration);
      setNewDeckRetryReferenceFilePaths([...referenceFilePaths]);
      setNewDeckRetryImportedReference(importedReferenceSource);
      setNewDeckRetryAttachments(attachmentsForGeneration);
      setNewDeckRetryModelSelection(modelSelection);
      clearStartedGenerationAttempt(generationAttemptId, deckId);
      deleteDeck(deckId);
      toast.error(t("home.generationStartFailed"), { description });
      if (
        typeof window !== "undefined" &&
        deckIdFromPathname(window.location.pathname) === deckId
      ) {
        void navigate("/home", {
          replace: true,
          state: {
            retryPrompt: prompt,
            retryFiles: filesForGeneration,
            retryReferenceFilePaths: [...referenceFilePaths],
            retryImportedReference: importedReferenceSource,
            retryContext: additionalContext || undefined,
            retryAttachments: attachmentsForGeneration,
            modelSelection,
          } satisfies DeckGenerationRetryState,
          flushSync: true,
        });
      }
    };

    const persisted = await ensureDeckPersisted(deck.id);
    if (!persisted.persisted) {
      recoverFromGenerationSetupFailure(
        describeDeckPersistenceFailure(
          persisted,
          t("home.generationStartFailedDescription"),
        ),
      );
      return;
    }

    let importedSourceDeck: ImportedSourceDeck | null = null;
    if (isSourceImprovementRequest(prompt, filesForSourceImprovement)) {
      try {
        importedSourceDeck = await importUploadedDeckIntoDeck(
          filesForSourceImprovement,
          deckId,
        );
      } catch (error) {
        recoverFromGenerationSetupFailure(
          error instanceof Error
            ? error.message
            : t("home.generationStartFailedDescription"),
        );
        return;
      }
    }

    // Only the document that actually became the reference deck is already
    // represented; the import controls accept several files but import one, so
    // excluding all of `referenceFilePaths` would drop the rest entirely while
    // telling the agent every attachment had been read.
    const referenceHydration = await hydrateReferenceDocuments(
      filesForGeneration,
      {
        excludePaths: [
          ...(importedReferenceFilePath ? [importedReferenceFilePath] : []),
          ...(importedSourceDeck ? [importedSourceDeck.file.path] : []),
        ],
      },
    );
    if (referenceHydration.status === "unreadable") {
      recoverFromGenerationSetupFailure(referenceHydration.message);
      return;
    }
    const referenceDocumentContext =
      referenceHydration.status === "hydrated"
        ? referenceHydration.context
        : "";
    // An attached document reference never sets `referenceDeckId`, so without
    // this the no-design-system branch below prescribed the same generic
    // fallback look a reference-less prompt gets — which is how a styled PDF
    // produced a deck indistinguishable from one generated with no reference.
    // Keyed on a measured design, not merely a successful read: a DOCX, or a
    // PDF whose digest could not be built, would otherwise suppress both the
    // workspace default and the fallback and leave no styling guidance at all.
    const hasHydratedReferenceDesign =
      referenceHydration.status === "hydrated" &&
      referenceHydration.measuredDesignCount > 0;

    clearPendingPromptForRetry();
    setNewDeckInitialPrompt(null);
    setNewDeckRetryFiles([]);
    setNewDeckRetryReferenceFilePaths([]);
    setNewDeckRetryImportedReference(undefined);
    setNewDeckRetryContext(undefined);
    setNewDeckRetryPrompt(undefined);
    setNewDeckRetryAttachments([]);
    setNewDeckRetryModelSelection(undefined);
    const trimmedPrompt = prompt.trim();
    const hasImportedGoogleDocContext = [additionalContext, trimmedPrompt].some(
      (value) => value.includes("<google-doc "),
    );
    const googleDocUrls = hasImportedGoogleDocContext
      ? []
      : extractGoogleDocUrls(trimmedPrompt);
    const fileContext = describeUploadedFilesForAgent(
      filesForGeneration,
      deckId,
      importedSourceDeck,
    );
    const googleDocContext = [
      additionalContext,
      googleDocUrls.length > 0
        ? [
            "The request includes Google Docs URL(s):",
            ...googleDocUrls.map((url) => `- ${url}`),
            "Before adding slides, call `import-google-doc` for each URL and use the returned text as source material.",
            "If the action cannot read a private document, tell the user the exact sharing step from the action error instead of generating from the URL alone.",
          ].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const [referenceDeckContext, hydratedDesignSystemContext] =
      await Promise.all([
        loadReferenceDeckGenerationContext(referenceDeckId),
        loadDesignSystemGenerationContext(selectedDesignSystem?.id),
      ]);
    const designSystemContext = referenceSelection.composerContext
      ? formatSlidesComposerContext(
          referenceSelection.composerContext,
          referenceSelection.contextItems ?? [],
          t("home.context.notReady"),
        )
      : selectedDesignSystem
        ? [
            "",
            "Design system selection:",
            `- Use "${selectedDesignSystem.title}" (id: ${selectedDesignSystem.id}).`,
            "- The deck has already been linked to this design system.",
            "- Use the hydrated design system context below for colors, typography, spacing, imagery, and slide defaults.",
            hydratedDesignSystemContext,
            "- Do not choose or apply a different design system.",
          ].join("\n")
        : [
            "",
            "Design system selection:",
            "- No design system was selected in the picker.",
            ...(referenceDeckId || hasHydratedReferenceDesign
              ? [
                  "- A reference deck or attached reference document is selected above. Follow its measured visual language — type scale, weights, colors, alignment, margins, page proportions — as the styling source of truth. Do not call `get-workspace-defaults`, apply a workspace default design system, or substitute a generic look.",
                ]
              : [
                  "- Before generating a bare or on-brand deck, call `get-workspace-defaults`. If it returns a usable design system, patch this deck with that designSystemId, call `get-design-system`, and follow its exact tokens, assets, and custom instructions.",
                  "- If no workspace default exists, establish one deliberate deck-level visual contract before the first slide: choose a background family, readable text and surface roles, one accent, a type pairing, spacing, radius, and image treatment that fit the subject. Record those choices as semantic --deck-* values on every fmd-slide wrapper and reuse them exactly; never alternate light and dark canvases, swap fonts, or invent a new palette per slide.",
                ]),
          ].join("\n");
    const referenceSource = referenceSelection.referenceSource;
    const referenceSourceContext = referenceSource
      ? [
          "",
          "Additional reference source selected in the reference step:",
          `- ${referenceSource.kind}: ${referenceSource.value}`,
          referenceSource.kind === "google-docs"
            ? "Call `import-google-doc` before generating and use the returned text as source material."
            : referenceSource.kind === "website"
              ? "Call `import-from-url` before generating and use the returned page context as a reference."
              : "Use the Figma source as the design reference. If Builder or Figma access is required, report the exact connection step instead of guessing.",
        ].join("\n")
      : "";
    const sourceDeckContext = importedSourceDeck
      ? [
          "",
          "Source-preserving improvement mode:",
          `- The target deck already contains ${importedSourceDeck.slideCount} imported source slides. Treat those slides as the user's complete source, not as inspiration for a new deck.`,
          "- Keep the exact source slide count, order, IDs, factual meaning, notes, images, charts, tables, diagrams, and freeform objects unless the user explicitly asks to change one of them.",
          "- Read the full deck once with get-deck compact=false to get sourceImport.slideIds, every slide's HTML and contentHash, and the linked design context; call get-design-system once for its full tokens, assets, and instructions. Make the deck-wide restyle in one patch-deck call using requireAllSourceSlides=true, with each patch-slide's matching contentHash as baseContentHash; use styleOnly=true for CSS-only changes that preserve slide structure. Do not split a full-deck restyle into arbitrary batches or fall back to one-by-one update-slide calls; use update-slide only for a targeted one-slide edit. Keep every original image source and enough original factual copy for each slide; for PDF slides, use restrained design-system chrome around the page without obscuring it.",
          "- For this restyle, keep the source slide structure and do not replace source images with generic cards. If the user explicitly asks to add, delete, or reorder slides, use the corresponding operation normally; it clears source-import provenance, so verify the edited slide count and order instead of waiting for sourceCoverage.",
          "- After a source-preserving patch that leaves sourceImport present, verify once with get-deck using slideIds=sourceImport.slideIds and compact=false. Confirm the full source reflects the request and sourceCoverage.complete is true with expectedSlideIds and actualSlideIds matching in order. If structural operations cleared sourceImport, verify the resulting slide count and order instead and do not require sourceCoverage.complete. Do not report an initial or partial pass, and do not leave any source slides for a later run.",
          "- If get-deck reports partial source fidelity or skipped images, stop and report the exact warning instead of claiming a reliable restyle.",
        ].join("\n")
      : "";
    const sourceModeInstructions = importedSourceDeck
      ? [
          "The request is an in-place visual improvement of an imported source deck. Make a coherent style pass across every existing slide while preserving all source content and media.",
          "Do not use the new-deck add-slide workflow for this source-preserving restyle. Finish every source slide in this run; if the user explicitly requests structural changes, use the normal slide operations and verify the resulting deck instead of treating source coverage as a limit.",
          "While sourceImport is present, the ordered source manifest and its full slide count are hard completion gates: do not declare success, switch to unrelated content, or start a different deck brief until every source slide ID has been patched and get-deck compact=true reports sourceCoverage.complete=true with the expected and actual IDs matching in order. After structural edits clear sourceImport, verify the resulting slide count and order instead.",
        ].join("\n")
      : [
          "This is a new deck. Keep it empty until generation begins; attached reference files must not seed it with imported slides.",
          "Start a `manage-progress` run so progress appears in the app header. First make a compact outline and deck-level visual contract in working context, then add slides with `add-slide` one at a time so every generated slide preserves its per-slide Creative Context provenance.",
          "After reading any requested or attached reference material, but before adding the first slide, choose a concise, specific deck title from the user's request and source material. Never use the deck id, run id, file id, or another opaque alphanumeric token as the title. Call `patch-deck` with `deckId: \"" +
            deckId +
            '\"` and `operations: [{ "op": "patch-deck-fields", "fields": { "title": "<generated title>" } }]`. Include only `title` in `fields`; omit all other optional fields. Never leave a generated deck named "Untitled Deck" or another placeholder, and do not reuse the uploaded filename or a generic label like "Untitled scene" when the content can describe the deck better.',
          "If the user asks for a standalone visual, diagram, hero, one-pager, poster, or a couple of visuals, create only the requested one/few polished visual slides. Do not pad the result into a full presentation.",
          "If the request is for a presentation or deck and does not explicitly ask for one slide, infer a coherent multi-slide outline from the scope and keep adding slides until that outline is complete. Do not stop after the first slide just because the prompt has few explicit instructions. Vary composition and information hierarchy while keeping the visual contract fixed across the deck.",
          "Add every generated slide ONE AT A TIME using the `add-slide` action with --deckId=" +
            deckId +
            "; wait for each result. After the first slide, call `get-deck` with its returned slideId and compact=false, inspect the full HTML for the semantic --deck-* declarations, canvas, type, spacing, and composition, and reuse that visual contract before continuing. Do not use `patch-deck` to append generated slides because `add-slide` records per-slide Creative Context provenance; use `patch-deck` for deck fields, existing-slide edits, ordering, or source-preserving work. Never issue parallel writes to the same deck.",
          "Use create-deck and add-slide/patch-deck for this already-created deck. Do not call the legacy generate-slides-ai action: it returns Markdown drafts rather than persisted rendered slide HTML. Treat each successful write and compact readback as confirmation to continue with the next planned slides.",
        ].join("\n");

    const context = [
      importedSourceDeck
        ? `The user uploaded a source presentation into target deck (id: "${deckId}") and wants a reliable visual improvement.`
        : `The user just created a new empty deck (id: "${deckId}") and wants to create a presentation or standalone visual.`,
      `The browser owns this deck's generation lifecycle. Its exact generationAttemptId is "${generationAttemptId}". If a tool call for this deck accepts generationAttemptId, pass this exact value unchanged; never create a substitute ID.`,
      "The visible user message above contains the user's request and/or pasted source material for the deck. Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
      googleDocContext,
      fileContext,
      referenceDocumentContext,
      referenceDeckContext,
      designSystemContext,
      referenceSourceContext,
      WEBSITE_STYLE_REFERENCE_DIRECTIVE,
      sourceDeckContext,
      "",
      "Before generating, if the request or selected references leave a meaningful choice unresolved, use the `ask-question` tool to ask one concise, prompt-specific question in the inline guided-question flow. Generate the question wording and 2 to 4 options from the user's request and selected references; do not use a fixed generic questionnaire. Ask only a choice that materially affects the deck, such as audience, tone, structure, or length. If the prompt already makes the choice clear, do not ask it again. Wait for the user's answer or skip before adding slides.",
      sourceModeInstructions,
      "If the user asked for a specific slide count, keep going until that count is reached unless a tool error blocks you. Add each generated slide through sequential add-slide calls, preserving the established deck contract and using a targeted get-deck read with slideId and compact=false after the first slide to verify it. If no explicit count was given (including when the guided slide-count question was skipped), infer the count from the distinct topics/sections implied by the request — one slide per section plus a title and closing slide — and add slides for every section before considering the deck done. Do not stop at an arbitrary round number (e.g. 10) if sections remain uncovered, and never call `generate-slides-ai` for this flow; it is a legacy single-shot helper capped at 10 slides.",
      "The original brief and uploaded/reference handles are persisted on the deck as generationContext. On every continuation or follow-up, call get-deck first and treat that context as the canonical brief. Continue the original slide sequence from the current slide count; do not replace it with a fresh topic inferred only from the follow-up message.",
      "An explicit theme or brand instruction in the original brief overrides the background, palette, and styling of an uploaded/reference image or source page. Preserve source content and imagery, but do not copy a white wireframe background when the requested theme is dark.",
      "Do not report completion until the persisted generationContext targetSlideCount is reached, or, when sourceCoverage is present for source-preserving mode, get-deck compact=true reports it complete for the ordered source manifest. If the current deck is short, finish the missing requested slides before adding unrelated content.",
      "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels, with 800x412px available inside standard 64px 80px padding). Keep the main content within that fit budget; split dense source material across more slides instead of packing it tightly. Never use zoom, transform: scale(), clipping, or scroll overflow to hide content overflow, and keep body text at least 16px.",
      hasHydratedReferenceDesign
        ? "The attached reference document's measured visual language above is the styling source of truth for this deck. Match its type scale, weights, colors, alignment, and margins instead of a generic light-card layout — a deck built from a style reference must not be indistinguishable from one built without it."
        : "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction and lock it before authoring: one canvas/background family, text and surface roles, type pairing, spacing scale, radius, and accent treatment. Express the contract with semantic --deck-* values on every fmd-slide wrapper. Keep the canvas and type system consistent across slides; vary layout, rhythm, and meaningful visual structure instead of adding colorful cards, decorative rectangles, gradient text, or filler bullets.",
      "Each slide's --content must be full HTML. Slide HTML templates are in your AGENTS.md.",
      "Do NOT use create-deck (the deck already exists). Do NOT call db-schema, the resources tool, or search-files.",
    ].join("\n");

    try {
      await persistDeckGenerationContext(deckId, {
        originalPrompt: trimmedPrompt,
        additionalContext,
        files: filesForGeneration.map((file) => ({
          path: file.path,
          ...(file.url ? { url: file.url } : {}),
          originalName: file.originalName,
          type: file.type,
        })),
        designSystemId,
        referenceDeckId,
        composerContext: referenceSelection.composerContext,
        contextItems: referenceSelection.contextItems,
        ...(referenceSource ? { referenceSource } : {}),
        mode: importedSourceDeck ? "source-preserving" : "new",
        targetSlideCount:
          importedSourceDeck?.slideCount ?? requestedSlideCount(trimmedPrompt),
        generationAttemptId,
      });
    } catch (error) {
      recoverFromGenerationSetupFailure(
        error instanceof Error
          ? error.message
          : t("home.generationStartFailedDescription"),
      );
      return;
    }

    // See the matching comment in create-deck-generation.ts: clear any
    // guided-question card left over from the previous deck's still-finishing
    // run so it can't surface on top of the deck we're navigating to now.
    deleteClientAppState(
      appStateKeyForBrowserTab("guided-questions", TAB_ID),
    ).catch(() => {});
    deleteClientAppState("guided-questions").catch(() => {});

    try {
      agentSubmit(createDeckAgentMessage(prompt), context, {
        newTab: true,
        reuseEmptyTab: true,
        openSidebar: true,
        submitMessageId: generationSubmitMessageId,
        generationAttemptId,
        generationOutputId: deckId,
        ...getUploadedImageAgentOptions(filesForGeneration),
        attachments: attachmentsForGeneration,
        ...modelSelection,
      });
      trackEvent("generation_request_accepted", {
        app_name: "slides",
        template_name: "slides",
        generation_attempt_id: generationAttemptId,
        output_id: deckId,
        output_type: "deck",
        source: "new_deck_prompt",
      });
    } catch (error) {
      recoverFromGenerationSetupFailure(
        error instanceof Error
          ? error.message
          : t("home.generationStartFailedDescription"),
        "agent_submit_failed",
      );
      return;
    }
    settlePendingDeckAttachments("commit");
  };

  const runPendingDeckGeneration = useCallback(
    (
      prompt: string,
      files: UploadedFile[],
      referenceSelection: NewDeckReferenceSelection,
      context?: string,
      attachments: ReadonlyArray<PromptChatAttachment> = [],
      modelSelection?: DeckModelSelection,
    ) => {
      const generation = Promise.resolve().then(() =>
        handleCreateDeckWithPrompt(
          prompt,
          files,
          referenceSelection,
          context,
          attachments,
          modelSelection,
        ),
      );
      pendingDeckGenerationRef.current = generation;
      void generation.then(
        () => {
          if (pendingDeckGenerationRef.current === generation) {
            pendingDeckGenerationRef.current = null;
          }
        },
        () => {
          if (pendingDeckGenerationRef.current !== generation) return;
          pendingDeckGenerationRef.current = null;
          settlePendingDeckAttachments("discard");
        },
      );
      return generation;
    },
    [handleCreateDeckWithPrompt, settlePendingDeckAttachments],
  );

  useEffect(() => {
    return () => {
      if (!pendingDeckGenerationRef.current) {
        settlePendingDeckAttachments("discard");
      }
    };
  }, [settlePendingDeckAttachments]);

  const handlePromptSubmit = useCallback(
    (
      prompt: string,
      files: UploadedFile[],
      attachments: PromptAttachmentActions,
      options?: SlidesPromptSubmitOptions,
    ) => {
      pendingDeckAttachmentActionsRef.current = attachments;
      setNewDeckPromptOpen(false, { clearInitialPrompt: false });
      const retryContext =
        attachments.context ??
        (prompt === newDeckRetryPrompt ? newDeckRetryContext : undefined);
      if (options?.slidesContext) {
        void runPendingDeckGeneration(
          prompt,
          files,
          {
            designSystemId: options.slidesContext.designSystemId,
            referenceDeckId: null,
            composerContext: options.slidesContext,
            contextItems: options.contextItems,
          },
          retryContext,
          attachments.attachments,
          options,
        );
        return "retain" as const;
      }
      const retryReferenceFilePaths =
        newDeckRetryFiles.length > 0 ? newDeckRetryReferenceFilePaths : [];
      setPendingDeck({
        prompt,
        files,
        referenceFilePaths: retryReferenceFilePaths,
        importedReference:
          retryReferenceFilePaths.length > 0
            ? newDeckRetryImportedReference
            : undefined,
        context: retryContext,
        attachments: [
          ...(prompt === newDeckRetryPrompt ? newDeckRetryAttachments : []),
          ...attachments.attachments,
        ],
        modelSelection: options
          ? {
              model: options.model,
              engine: options.engine,
              effort: options.effort,
            }
          : newDeckRetryModelSelection,
      });
      setNewDeckRetryPrompt(undefined);
      setNewDeckRetryReferenceFilePaths([]);
      setNewDeckRetryImportedReference(undefined);
      setNewDeckRetryContext(undefined);
      setNewDeckRetryAttachments([]);
      setNewDeckRetryModelSelection(undefined);
      setShowNewDeckReferenceStep(true);
      return "retain" as const;
    },
    [
      newDeckRetryFiles,
      newDeckRetryAttachments,
      newDeckRetryReferenceFilePaths,
      newDeckRetryImportedReference,
      newDeckRetryContext,
      newDeckRetryModelSelection,
      newDeckRetryPrompt,
      setNewDeckPromptOpen,
      runPendingDeckGeneration,
    ],
  );

  const handlePromptSkip = useCallback(() => {
    settlePendingDeckAttachments("discard");
    setNewDeckPromptOpen(false, { clearInitialPrompt: false });
    setNewDeckRetryPrompt(undefined);
    setNewDeckRetryReferenceFilePaths([]);
    setNewDeckRetryImportedReference(undefined);
    setNewDeckRetryContext(undefined);
    setNewDeckRetryAttachments([]);
    setNewDeckRetryModelSelection(undefined);
    setPendingDeck({
      prompt: "",
      files: [],
      referenceFilePaths: [],
      attachments: [],
    });
    setShowNewDeckReferenceStep(true);
  }, [setNewDeckPromptOpen, settlePendingDeckAttachments]);

  const handleDirectImport = useCallback(
    async (selection: PromptImportSelection): Promise<boolean> => {
      if (!session) {
        setSignInPromptHadFiles(selection.kind !== "google-slides");
        setShowSignInDialog(true);
        return false;
      }

      if (selection.kind === "google-slides") {
        const imported = (await callAction("import-google-slides-reference", {
          presentationUrl: selection.url,
        })) as {
          id?: unknown;
          imported?: unknown;
          slideCount?: unknown;
        };
        if (
          typeof imported.id !== "string" ||
          !imported.id ||
          imported.imported !== true ||
          typeof imported.slideCount !== "number" ||
          imported.slideCount < 1
        ) {
          throw new Error(
            "The Google Slides presentation did not create a deck.",
          );
        }
        await reloadDecks();
        void navigate(`/deck/${imported.id}`, { flushSync: true });
        return true;
      }

      const uploaded = await uploadPromptFiles(selection.files);
      const file = uploaded[0];
      if (!file) throw new Error("The selected file could not be uploaded.");

      if (selection.kind === "pptx") {
        const imported = (await callAction("import-pptx", {
          filePath: file.path,
          designSystemId: initialDesignSystemId,
        })) as {
          id?: unknown;
          imported?: unknown;
          slideCount?: unknown;
        };
        if (
          typeof imported.id !== "string" ||
          !imported.id ||
          imported.imported !== true ||
          typeof imported.slideCount !== "number" ||
          imported.slideCount < 1
        ) {
          throw new Error("The PowerPoint presentation did not create a deck.");
        }
        await reloadDecks();
        void navigate(`/deck/${imported.id}`, { flushSync: true });
        return true;
      }

      let deck: ReturnType<typeof createDeck> | undefined;
      flushSync(() => {
        deck = createDeck(undefined, {
          noDefaultSlides: true,
          designSystemId: initialDesignSystemId,
        });
      });
      if (!deck) throw new Error("The PDF deck could not be created.");

      const persisted = await ensureDeckPersisted(deck.id);
      if (!persisted.persisted) {
        deleteDeck(deck.id);
        throw new Error(
          describeDeckPersistenceFailure(
            persisted,
            "The PDF deck could not be saved.",
          ),
        );
      }

      try {
        const imported = (await callAction("import-file", {
          filePath: file.path,
          format: "pdf",
          deckId: deck.id,
          importIntoDeck: true,
        })) as {
          imported?: unknown;
          deckId?: unknown;
          pageCount?: unknown;
        };
        if (
          imported.imported !== true ||
          imported.deckId !== deck.id ||
          typeof imported.pageCount !== "number" ||
          imported.pageCount < 1
        ) {
          throw new Error("The PDF could not be imported into the new deck.");
        }
        await reloadDecks();
        void navigate(`/deck/${deck.id}`, { flushSync: true });
        return true;
      } catch (error) {
        deleteDeck(deck.id);
        throw error;
      }
    },
    [
      createDeck,
      deleteDeck,
      ensureDeckPersisted,
      initialDesignSystemId,
      navigate,
      reloadDecks,
      session,
    ],
  );

  const handleReferenceSelect = useCallback(
    async (selection: NewDeckReferenceSelection) => {
      const pending = pendingDeck;
      if (!pending) return;
      if (selection.designSystemId !== undefined) {
        if (selection.designSystemId) {
          rememberReference({
            id: selection.designSystemId,
            kind: "design-system",
          });
        } else {
          forgetReference("design-system");
        }
      }
      if (selection.referenceDeckId !== undefined) {
        if (selection.referenceDeckId) {
          rememberReference({ id: selection.referenceDeckId, kind: "deck" });
        } else {
          forgetReference("deck");
        }
      }
      const referenceFilePaths = [
        ...new Set([
          ...(pending.referenceFilePaths ?? []),
          ...(selection.referenceFilePaths ?? []),
        ]),
      ];
      // A retry re-enters this step with the reference deck from the failed
      // attempt already in the list rather than freshly imported, so the
      // selection no longer says which upload it was built from. Without this
      // the retry re-reads that file, duplicating it alongside the reference
      // deck and turning any read hiccup into a second hard stop.
      const carriedImportedReference = pending.importedReference;
      const carriedDeckSelected =
        carriedImportedReference !== undefined &&
        selection.referenceDeckId === carriedImportedReference.deckId;
      // The reference deck can be deleted between the failed attempt and the
      // retry. Its id then loads nothing while still reading as a reference,
      // and its source would stay excluded — leaving the run with neither.
      const carriedDeckMissing =
        carriedDeckSelected &&
        !decks.some((deck) => deck.id === carriedImportedReference.deckId);
      const importedReferenceFilePath =
        selection.importedReferenceFilePath ??
        (carriedDeckSelected && !carriedDeckMissing
          ? carriedImportedReference.filePath
          : undefined);
      const generation = runPendingDeckGeneration(
        pending.prompt,
        pending.files,
        {
          ...selection,
          ...(referenceFilePaths.length > 0 ? { referenceFilePaths } : {}),
          ...(importedReferenceFilePath ? { importedReferenceFilePath } : {}),
          ...(carriedDeckMissing ? { referenceDeckId: null } : {}),
        },
        pending.context,
        pending.attachments,
        pending.modelSelection,
      );
      setShowNewDeckReferenceStep(false);
      setPendingDeck(null);
      await generation;
    },
    [
      decks,
      forgetReference,
      pendingDeck,
      rememberReference,
      runPendingDeckGeneration,
    ],
  );

  const handleReferenceImport = useCallback(
    async (files: File[]): Promise<ImportedReference | null> => {
      const pending = pendingDeck;
      if (!pending) return null;
      setReferenceImporting(true);
      try {
        const uploaded = await uploadPromptFiles(files);
        const pptxReference = uploaded.find((file) =>
          file.originalName.toLowerCase().endsWith(".pptx"),
        );
        const pdfReference = uploaded.find((file) =>
          file.originalName.toLowerCase().endsWith(".pdf"),
        );
        const docxReference = uploaded.find((file) =>
          file.originalName.toLowerCase().endsWith(".docx"),
        );
        const referenceFilePaths = uploaded
          .filter((file) => /\.(pdf|pptx|docx)$/i.test(file.originalName))
          .map((file) => file.path);
        let importedReference: ImportedReference | null = null;
        // The target generation context must retain the source handle; the
        // imported reference deck stores rendered slides, not the original file.
        let generationFiles = uploaded;
        if (pptxReference) {
          const imported = (await callAction(
            "import-pptx",
            { filePath: pptxReference.path },
            { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
          )) as {
            id?: unknown;
            imported?: unknown;
            slideCount?: unknown;
            title?: unknown;
          };
          if (
            typeof imported.id !== "string" ||
            !imported.id ||
            imported.imported !== true ||
            typeof imported.slideCount !== "number" ||
            imported.slideCount < 1
          ) {
            throw new Error("The imported presentation did not create a deck.");
          }
          importedReference = {
            id: imported.id,
            title:
              typeof imported.title === "string" && imported.title
                ? imported.title
                : t("home.importedReferenceDeck"),
            source: "pptx",
            referenceFilePaths,
            importedFilePath: pptxReference.path,
          };
        } else if (pdfReference || docxReference) {
          const documentReference = pdfReference ?? docxReference;
          const documentFormat = pdfReference ? "pdf" : "docx";
          const documentSaveError = t("editorToolbar.uploadFailed");
          const documentImportError = t(
            "editorToolbar.importFailedDescription",
          );
          if (!documentReference) {
            throw new Error(documentImportError);
          }
          const referenceDeck = createDeck(undefined, {
            noDefaultSlides: true,
          });
          const persisted = await ensureDeckPersisted(referenceDeck.id);
          if (!persisted.persisted) {
            deleteDeck(referenceDeck.id);
            throw new Error(
              describeDeckPersistenceFailure(persisted, documentSaveError),
            );
          }
          try {
            const imported = (await callAction(
              "import-file",
              {
                filePath: documentReference.path,
                format: documentFormat,
                deckId: referenceDeck.id,
                importIntoDeck: true,
              },
              { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
            )) as {
              imported?: unknown;
              deckId?: unknown;
              pageCount?: unknown;
              slideCount?: unknown;
              title?: unknown;
            };
            const importedSlideCount =
              documentFormat === "pdf"
                ? imported.pageCount
                : imported.slideCount;
            if (
              imported.imported !== true ||
              imported.deckId !== referenceDeck.id ||
              typeof importedSlideCount !== "number" ||
              importedSlideCount < 1
            ) {
              throw new Error(documentImportError);
            }
            importedReference = {
              id: referenceDeck.id,
              title:
                typeof imported.title === "string" && imported.title
                  ? imported.title
                  : t("home.importedReferenceDeck"),
              source: documentFormat,
              referenceFilePaths,
              importedFilePath: documentReference.path,
            };
          } catch (error) {
            deleteDeck(referenceDeck.id);
            throw error;
          }
        }
        setPendingDeck((current) =>
          current
            ? {
                ...current,
                files: [...current.files, ...generationFiles],
                referenceFilePaths: [
                  ...new Set([
                    ...current.referenceFilePaths,
                    ...(importedReference?.referenceFilePaths ?? []),
                  ]),
                ],
              }
            : current,
        );
        if (importedReference) {
          await reloadDecks();
          setSelectedReferenceDeckId(importedReference.id);
        }
        return importedReference;
      } catch (error) {
        toast.error(t("editorToolbar.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("editorToolbar.importFailedDescription"),
        });
        return null;
      } finally {
        setReferenceImporting(false);
      }
    },
    [createDeck, deleteDeck, ensureDeckPersisted, pendingDeck, reloadDecks, t],
  );

  const handleReferenceSourceImport = useCallback(
    async (
      source: NewDeckReferenceSource,
    ): Promise<ImportedReference | null> => {
      if (source.kind !== "google-docs") return null;
      setReferenceImporting(true);
      try {
        const imported = (await callAction("import-google-slides-reference", {
          presentationUrl: source.value,
        })) as {
          id?: unknown;
          imported?: unknown;
          slideCount?: unknown;
          title?: unknown;
        };
        if (
          typeof imported.id !== "string" ||
          !imported.id ||
          imported.imported !== true ||
          typeof imported.slideCount !== "number" ||
          imported.slideCount < 1
        ) {
          throw new Error(
            "The Google Slides presentation did not create a deck.",
          );
        }
        const importedReference: ImportedReference = {
          id: imported.id,
          title:
            typeof imported.title === "string" && imported.title
              ? imported.title
              : t("home.importedReferenceDeck"),
          source: "google-slides",
        };
        await reloadDecks();
        setSelectedReferenceDeckId(importedReference.id);
        return importedReference;
      } catch (error) {
        toast.error(t("editorToolbar.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("editorToolbar.importFailedDescription"),
        });
        return null;
      } finally {
        setReferenceImporting(false);
      }
    },
    [reloadDecks, t],
  );

  const handleReferenceSkip = useCallback(async () => {
    const pending = pendingDeck;
    if (!pending) {
      setShowNewDeckReferenceStep(false);
      return;
    }
    forgetReference("design-system");
    forgetReference("deck");
    if (!pending.prompt.trim() && pending.files.length === 0) {
      setShowNewDeckReferenceStep(false);
      setPendingDeck(null);
      handleCreateDeckBlank();
      return;
    }
    const generation = runPendingDeckGeneration(
      pending.prompt,
      pending.files,
      {
        designSystemId: null,
        referenceDeckId: null,
        ...(pending.referenceFilePaths.length > 0
          ? { referenceFilePaths: pending.referenceFilePaths }
          : {}),
      },
      pending.context,
      pending.attachments,
      pending.modelSelection,
    );
    setShowNewDeckReferenceStep(false);
    setPendingDeck(null);
    await generation;
  }, [
    forgetReference,
    handleCreateDeckBlank,
    pendingDeck,
    runPendingDeckGeneration,
  ]);

  const handleConfirmDelete = () => {
    if (deckToDelete) {
      deleteDeck(deckToDelete);
      setDeckToDelete(null);
    }
  };

  const handleRename = useCallback(
    (id: string, newTitle: string) => {
      updateDeck(id, { title: newTitle });
    },
    [updateDeck],
  );

  const handleToggleStar = useCallback(
    (id: string, starred: boolean) => {
      updateDeck(id, { starred });
    },
    [updateDeck],
  );

  const applyWorkspaceDefaultDeck = useCallback(
    async (deck: Deck) => {
      try {
        // A private deck is unreadable to everyone else, so share it through
        // the audited sharing action first - it owns org binding and collab
        // cache invalidation, which a direct visibility write here would skip.
        if (deck.visibility === "private") {
          await callAction("set-resource-visibility", {
            resourceType: "deck",
            resourceId: deck.id,
            visibility: "org",
          });
          await reloadDecks();
        }
        await callAction("set-workspace-defaults", {
          referenceDeckId: deck.id,
        });
        await refetchWorkspaceDefaults();
        toast.success(t("home.workspaceDefaultSet"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("home.workspaceDefaultFailed"),
        );
      }
    },
    [reloadDecks, refetchWorkspaceDefaults, t],
  );

  const handleSetWorkspaceDefaultDeck = useCallback(
    async (id: string, isDefault: boolean) => {
      if (isDefault) {
        const deck = decks.find((d) => d.id === id);
        if (!deck) return;
        // Setting the default is one click to undo. Publishing a private deck
        // to the whole workspace is not, so that is the only part we confirm.
        if (deck.visibility === "private") {
          setWorkspaceDefaultCandidate(deck);
          return;
        }
        await applyWorkspaceDefaultDeck(deck);
        return;
      }
      try {
        await callAction("set-workspace-defaults", { referenceDeckId: null });
        await refetchWorkspaceDefaults();
        toast.success(t("home.workspaceDefaultCleared"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("home.workspaceDefaultFailed"),
        );
      }
    },
    [applyWorkspaceDefaultDeck, decks, refetchWorkspaceDefaults, t],
  );

  const confirmWorkspaceDefaultDeck = useCallback(() => {
    // Read but do not clear: AlertDialogAction closes the dialog itself, and
    // unmounting it here too would pre-empt Radix's close sequence and strand
    // `pointer-events: none` on <body>. `onOpenChange` clears the candidate.
    const deck = workspaceDefaultCandidate;
    if (!deck) return;
    void applyWorkspaceDefaultDeck(deck);
  }, [workspaceDefaultCandidate, applyWorkspaceDefaultDeck]);

  // Navigating on the action's response raced the deck list: the editor reads
  // the copy out of `useDecks()`, which had not seen the new row yet, so the
  // route rendered "Deck unavailable". Insert the optimistic copy locally
  // first (the same path the editor's own Duplicate uses) and navigate to
  // that; the background action reconciles or rolls the copy back.
  const handleDuplicate = useCallback(
    async (id: string) => {
      const newId = `deck-${nanoid()}`;
      const copy = await duplicateDeck(id, newId, undefined, () => {
        // The background duplicate-deck action failed after we already
        // navigated to the optimistic copy's route. If the user is still
        // there, send them back to the deck list instead of stranding them
        // on a "Deck unavailable" screen for a deck that no longer exists.
        if (deckIdFromPathname(window.location.pathname) === newId) {
          void navigate("/home");
        }
        toast.error(t("home.duplicateFailed"));
      });
      // The context refuses a second copy of the same deck while the first
      // one's action is still in flight.
      if (!copy) {
        toast.error(t("home.duplicateFailed"));
        return;
      }
      void navigate(`/deck/${copy.id}`);
    },
    [duplicateDeck, navigate, t],
  );

  useSetPageTitle(t("home.decksTitle"));
  const deckImport = usePromptImport({ onImport: handleDirectImport });
  const viewState = deckListViewState({
    loading,
    loadError,
    deckCount: decks.length,
  });
  const hasRecentDecks = viewState === "decks" && decks.length > 0;
  const hasDeckSearch = normalizedDeckSearch.length > 0;

  useSetHeaderActions(
    useMemo(
      () => (
        <HomeHeaderActions
          search={
            viewState !== "empty" ? (
              <DeckSearchInput
                value={deckSearch}
                onChange={setDeckSearch}
                className="w-full"
              />
            ) : null
          }
        >
          {viewState !== "empty" ? (
            <DeckFilterMenu value={deckFilter} onChange={setDeckFilter} />
          ) : null}
          <Button
            onClick={openNewDeck}
            onPointerEnter={preloadPromptPopover}
            onFocus={preloadPromptPopover}
            size="sm"
            className="cursor-pointer"
          >
            <IconPlus className="w-3.5 h-3.5" />
            {t("home.newDeck")}
          </Button>
          <ImportDeckButton controller={deckImport} />
        </HomeHeaderActions>
      ),
      [
        deckFilter,
        deckImport,
        deckSearch,
        openNewDeck,
        setDeckFilter,
        t,
        viewState,
      ],
    ),
  );
  if (isStartingNewDeck) {
    return (
      <div
        className="fixed inset-0 z-[300] min-h-screen bg-background"
        data-testid="new-deck-loading"
      >
        <DeckEditorSkeleton label={t("deckEditor.lookingForDeck")} />
      </div>
    );
  }

  return (
    <PromptHome
      title={t("home.firstDeckPromptTitle")}
      mobileToolbar={
        <>
          <DeckSearchInput
            value={deckSearch}
            onChange={setDeckSearch}
            className="w-full"
          />
          <ImportDeckButton controller={deckImport} />
        </>
      }
      connection={
        agentEngine.missing ? (
          <>
            <BuilderConnectPopover flow={builderConnect}>
              <Button variant="outline" disabled={builderConnect.connecting}>
                {builderConnect.connecting
                  ? t("home.connectingBuilder")
                  : t("home.connectBuilderIo")}
                <IconArrowRight />
              </Button>
            </BuilderConnectPopover>
            {builderConnect.error ? (
              <p role="alert" className="max-w-md text-xs text-destructive">
                {builderConnect.error}
              </p>
            ) : null}
          </>
        ) : null
      }
      composer={
        <div data-slides-home-composer>
          <LazyChunkErrorBoundary
            fallback={
              <div
                className="flex min-h-44 items-center justify-center gap-3"
                role="alert"
              >
                <span className="text-sm text-muted-foreground">
                  {t("home.loadFailed")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  {t("home.retry")}
                </Button>
              </div>
            }
          >
            <Suspense
              fallback={
                <div
                  className="skeleton-shimmer h-44 rounded-xl bg-muted"
                  aria-busy="true"
                />
              }
            >
              <LazyPromptPopover
                presentation="inline"
                context={composerContext}
                controllerRef={homeComposerRef}
                submissionDisabled={agentEngine.missing}
                showModelSelector={!agentEngine.missing}
                modelStatusChecksEnabled={!agentEngine.missing}
                open={showNewDeckPrompt}
                onOpenChange={setNewDeckPromptOpen}
                title={t("home.newDeckPromptTitle")}
                placeholder={t("home.newDeckPlaceholder")}
                onSkip={handlePromptSkip}
                skipLabel={t("home.skipPrompt")}
                onSubmit={handlePromptSubmit}
                onBeforeUpload={(
                  prompt,
                  files,
                  context,
                  attachments,
                  options,
                ) => {
                  if (session) return true;
                  preservePromptForSignIn(prompt, {
                    context,
                    attachments,
                    hadFiles: files.length > 0,
                    modelSelection: options
                      ? {
                          model: options.model,
                          engine: options.engine,
                          effort: options.effort,
                        }
                      : undefined,
                  });
                  return false;
                }}
                loading={generating}
                draftScope={NEW_DECK_DRAFT_SCOPE}
                initialText={newDeckInitialPrompt?.text}
                initialTextKey={newDeckInitialPrompt?.key}
                initialModelSelection={newDeckRetryModelSelection}
                onRetainedAttachmentsAbandoned={
                  handlePendingDeckAttachmentsAbandoned
                }
              />
            </Suspense>
          </LazyChunkErrorBoundary>
        </div>
      }
      quickActions={
        quickActionsEnabled && homeSuggestionsQuery.data?.suggestions.length ? (
          <AgentSuggestionBar
            suggestions={homeSuggestionsQuery.data.suggestions.map(
              (suggestion, index) => ({
                ...suggestion,
                id: suggestion.id ?? `slides-home-${index}`,
                disabled: !showNewDeckPrompt || generating,
              }),
            )}
            ariaLabel={t("home.suggestedPrompts")}
            className="px-0 py-0"
            onSelect={(suggestion) => {
              if (!showNewDeckPrompt || generating) return;
              void homeComposerRef.current?.submitSource(
                agentSuggestionPrompt(suggestion),
                [],
              );
            }}
          />
        ) : null
      }
    >
      {viewState === "error" ? (
        <div className="flex min-h-40 items-center justify-center">
          <div
            className="flex max-w-sm flex-col items-center gap-3 text-center"
            role="alert"
          >
            <IconAlertTriangle className="size-7 text-destructive/70" />
            <h2 className="font-medium">{t("home.loadFailed")}</h2>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reloadDecks()}
            >
              <IconRefresh className="size-4" />
              {t("home.retry")}
            </Button>
          </div>
        </div>
      ) : null}
      <PromptHomeLibrary
        value={homeSection}
        onValueChange={setHomeSection}
        showRecent={hasRecentDecks || hasDeckSearch}
        labels={{
          templates: t("templatesPage.title"),
          recent: t("home.recent"),
        }}
        browseAll={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/templates">
              {t("templatesPage.browseAll")}
              <IconArrowRight />
            </Link>
          </Button>
        }
        recentActions={
          <DeckFilterMenu value={deckFilter} onChange={setDeckFilter} />
        }
        templates={<DeckTemplateLibrary home />}
        recent={
          <div className="agent-template-library-grid">
            {visibleDecks.map((deck) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                onDelete={(id) => setDeckToDelete(id)}
                onRename={handleRename}
                onDuplicate={handleDuplicate}
                onToggleStar={handleToggleStar}
                isWorkspaceDefault={workspaceReferenceDeck?.id === deck.id}
                canSetWorkspaceDefault={canManageWorkspaceDefaults}
                onSetWorkspaceDefault={handleSetWorkspaceDefaultDeck}
              />
            ))}
            {visibleDecks.length === 0 && (
              <div className="rounded-xl bg-card p-6 text-sm text-muted-foreground">
                {normalizedDeckSearch
                  ? t("home.noDecksMatchSearch")
                  : t("home.noMineDecks")}
              </div>
            )}
          </div>
        }
      />

      <AlertDialog
        open={!!workspaceDefaultCandidate}
        onOpenChange={(open) => !open && setWorkspaceDefaultCandidate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("home.workspaceDefaultConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.workspaceDefaultDeckShareBody", {
                title: workspaceDefaultCandidate?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmWorkspaceDefaultDeck}>
              {t("home.workspaceDefaultConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deckToDelete}
        onOpenChange={(open) => !open && setDeckToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.deleteDeckTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.deleteDeckDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("home.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewDeckReferenceStep
        open={showNewDeckReferenceStep}
        onOpenChange={(open) => {
          if (!open && !pendingDeckGenerationRef.current) {
            const pending = pendingDeck;
            settlePendingDeckAttachments("discard");
            setShowNewDeckReferenceStep(false);
            setPendingDeck(null);
            if (pending) {
              setNewDeckInitialPrompt({
                text: pending.prompt,
                key: Date.now(),
              });
              setShowNewDeckPrompt(true);
            }
          }
        }}
        designSystems={designSystems}
        decks={decks}
        defaultDesignSystemId={initialDesignSystemId}
        defaultReferenceDeckId={initialReferenceDeckId}
        onDesignSystemsChanged={() => void refetchDesignSystems()}
        onSelect={handleReferenceSelect}
        onImport={handleReferenceImport}
        onImportSource={handleReferenceSourceImport}
        onSkip={handleReferenceSkip}
        importing={referenceImporting}
        title={t("home.newDeckPromptTitle")}
        designSystemLabel={t("home.designSystem")}
        referenceDeckLabel={t("home.referenceDeck")}
        chooseDeckLabel={t("home.referenceDeckPlaceholder")}
        importingLabel={t("editorToolbar.importing")}
        skipLabel={t("home.referenceDeckNone")}
        searchDecksLabel={t("root.searchDecks")}
        promptSummary={pendingDeck?.prompt}
      />

      {systemsEnabled && showDesignSystemSetup && (
        <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
          <Suspense fallback={<Skeleton className="h-8 w-48" />}>
            <LazyDesignSystemSetup
              open
              onClose={() => setShowDesignSystemSetup(false)}
              onComplete={() => {
                setShowDesignSystemSetup(false);
                void refetchDesignSystems();
              }}
            />
          </Suspense>
        </LazyChunkErrorBoundary>
      )}

      {/* Sign-in required to create a deck. Shown when an unauthenticated
          user submits a prompt - the typed prompt is preserved in
          sessionStorage and replayed into the composer after sign-in. */}
      <AlertDialog open={showSignInDialog} onOpenChange={setSignInDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.signInTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {signInPromptHadFiles
                ? t("home.signInDescriptionWithFiles")
                : t("home.signInDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.location.href = buildSignInReturnHref();
              }}
            >
              {t("home.signIn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PromptHome>
  );
}

function DeckSearchInput({
  value,
  onChange,
  className = "w-full",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("relative min-w-0", className)}>
      <IconSearch
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("root.searchDecks")}
        aria-label={t("root.searchDecks")}
        className="ps-9"
      />
    </div>
  );
}
