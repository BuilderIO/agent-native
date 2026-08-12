import {
  callAction,
  deleteClientAppState,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
  fetchFirstRunOnboardingStatus,
  isFirstRunOnboardingEnabled,
} from "@agent-native/core/client/onboarding";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { extractGoogleDocUrls } from "@shared/google-docs";
import {
  IconAlertTriangle,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStack2,
  IconUserCircle,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import DeckCard from "@/components/deck/DeckCard";
import { DeckEditorSkeleton } from "@/components/editor/DeckEditorSkeleton";
import {
  NewDeckReferenceStep,
  type ImportedReference,
  type NewDeckReferenceSelection,
  type NewDeckReferenceSource,
} from "@/components/editor/NewDeckReferenceStep";
import PromptPopover, {
  uploadPromptFiles,
  type PromptImportSelection,
  type UploadedFile,
} from "@/components/editor/PromptDialog";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  describeDeckPersistenceFailure,
  type Deck,
} from "@/context/DeckContext";
import { deckIdFromPathname, useDecks } from "@/context/DeckContext";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useWorkspaceDefaults } from "@/hooks/use-workspace-defaults";
import { createDeckAgentMessage } from "@/lib/agent-visible-message";
import { savePromptToComposerDraft } from "@/lib/composer-draft";
import { isSourceImprovementRequest } from "@/lib/create-deck-generation";
import { sortDecksByRecency } from "@/lib/deck-sorting";
import {
  IMPORT_ACTION_TIMEOUT_MS,
  importUploadedDeckIntoDeck,
  type ImportedSourceDeck,
} from "@/lib/import-uploaded-deck";
import {
  forgetRecentReference,
  readRecentReferences,
  rememberRecentReference,
  type RecentReference,
} from "@/lib/recent-references";
import { TAB_ID } from "@/lib/tab-id";

const NEW_DECK_DRAFT_SCOPE = "slides-new-deck";
const PENDING_PROMPT_KEY = "slides:pending-deck-prompt";

/** Router-state payload for recovering the new-deck prompt after a failed
 *  generation kickoff forces a navigate away from and back to this route. */
interface DeckGenerationRetryState {
  retryPrompt?: string;
  retryFiles?: UploadedFile[];
}

function savePromptForRetry(
  prompt: string,
  options: { persistAcrossSignIn?: boolean } = {},
) {
  let signInHandoffSaved = !options.persistAcrossSignIn;
  if (options.persistAcrossSignIn) {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
      signInHandoffSaved = true;
    } catch {}
  }
  const draftSaved = savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, prompt);
  return signInHandoffSaved && draftSaved;
}

function clearPendingPromptForRetry() {
  try {
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
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

function describeUploadedFilesForAgent(
  files: UploadedFile[],
  deckId: string,
  importedSourceDeck?: ImportedSourceDeck | null,
): string {
  if (files.length === 0) return "";
  const fileList = files
    .map(
      (f) =>
        `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}${f.url ? `; embeddable URL: ${f.url}` : ""}`,
    )
    .join("\n");
  return [
    "",
    importedSourceDeck
      ? `The user uploaded ${files.length} file(s). The ${importedSourceDeck.file.originalName} source deck has already been imported into target deck ${deckId} with ${importedSourceDeck.slideCount} source slide(s); do not import it again.`
      : `The user attached ${files.length} file(s) as reference material for this new deck. Attachments are context for the agent by default; do not import or append their slides to target deck ${deckId} merely because they were attached.`,
    fileList,
    "",
    "File handling rules:",
    importedSourceDeck
      ? "- The imported source deck is canonical. Preserve its slide count, order, IDs, factual copy, notes, imagery, charts, tables, diagrams, and freeform objects while improving styling. For a deck-wide restyle, use one patch-deck call with requireAllSourceSlides=true; use update-slide only for a targeted one-slide edit. Do not rebuild it with add-slide."
      : `- PDF, PPTX, and DOCX files: call \`import-file --filePath "<path>" --format auto\` (without \`importIntoDeck\`) when you need their text or structure. Use the returned material as reference while creating new slides with \`add-slide\`.`,
    importedSourceDeck
      ? "- For a PDF source, keep the original full-page image in every slide and add restrained design-system chrome around it without obscuring source content. Never OCR-reconstruct a source-faithful page from extracted text."
      : "- Do not pass `importIntoDeck: true` for an attached file unless the user explicitly asks to import or preserve the source pages in the current deck. An attached reference is not an instruction to replace or seed the deck.",
    "- Text-like files: use the uploaded-text-file blocks already included in the prompt; do not call import-file for them.",
    '- Image files with an embeddable URL are mandatory assets: if the user specified where to use one (e.g. "on the first and last slide"), embed it there with `<img src="...">` exactly as requested. Do not omit a requested image and continue silently — if it truly cannot be placed, say why in your final chat response.',
    "- Image files without a URL are visual/reference assets only; do not claim to have processed a PPTX/PDF/DOCX unless the relevant import action succeeds.",
    importedSourceDeck
      ? "- Before your final response, verify the same source slide IDs and count with get-deck after the restyle. If source fidelity is partial or images were skipped, report the exact warning instead of claiming success."
      : "- Before your final response, verify every uploaded file above was either used as reference or placed as explicitly requested. If any file's content or requested placement is missing from the deck, say so explicitly instead of reporting success.",
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
  } = useDecks();
  const { designSystems } = useDesignSystems();
  const {
    referenceDeck: workspaceReferenceDeck,
    designSystem: workspaceDesignSystem,
    canManage: canManageWorkspaceDefaults,
    refetch: refetchWorkspaceDefaults,
  } = useWorkspaceDefaults();
  const { session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deckToDelete, setDeckToDelete] = useState<string | null>(null);
  const [workspaceDefaultCandidate, setWorkspaceDefaultCandidate] =
    useState<Deck | null>(null);
  const [showNewDeckPrompt, setShowNewDeckPrompt] = useState(false);
  const [newDeckInitialPrompt, setNewDeckInitialPrompt] = useState<{
    text: string;
    key: number;
  } | null>(null);
  const [newDeckRetryFiles, setNewDeckRetryFiles] = useState<UploadedFile[]>(
    [],
  );
  const [pendingDeck, setPendingDeck] = useState<{
    prompt: string;
    files: UploadedFile[];
  } | null>(null);
  const [showNewDeckReferenceStep, setShowNewDeckReferenceStep] =
    useState(false);
  const [isStartingNewDeck, setIsStartingNewDeck] = useState(false);
  const [recentReferences, setRecentReferences] = useState<RecentReference[]>(
    [],
  );
  const [referenceImporting, setReferenceImporting] = useState(false);
  const initialPromptConsumedRef = useRef(false);
  const [signInPromptHadFiles, setSignInPromptHadFiles] = useState(false);
  const [selectedDesignSystemId, setSelectedDesignSystemId] = useState<
    string | null
  >(null);
  const [selectedReferenceDeckId, setSelectedReferenceDeckId] = useState<
    string | null
  >(null);
  const [deckSearch, setDeckSearch] = useState("");
  // True while the picker still reflects an auto-applied default rather than
  // an explicit user choice. `useWorkspaceDefaults()`/`useDesignSystems()`
  // resolve asynchronously, so the initial value set on dialog open can be a
  // placeholder ("none", or the first-loaded design system) - these stay
  // true so the hydration effects below can overwrite it once the real
  // default arrives, and flip to false the moment the user picks explicitly.
  const designSystemAutoRef = useRef(true);
  const referenceDeckAutoRef = useRef(true);
  const [showSignInDialog, setShowSignInDialog] = useState(false);
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;
  const workspaceDesignSystemId =
    workspaceDesignSystem && !workspaceDesignSystem.unavailable
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
  const initialDesignSystemId =
    lastUsedDesignSystemId ?? workspaceDesignSystemId;
  const initialReferenceDeckId = lastUsedReferenceDeckId;
  const deckFilter = searchParams.get("createdBy") === "me" ? "mine" : "all";
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

  useEffect(() => {
    const result = readRecentReferences();
    if (result.readable) setRecentReferences(result.items);
  }, []);

  const initialPrompt = searchParams.get("initialPrompt")?.trim() ?? "";
  const onboardingPreview = searchParams.get("onboarding") === "preview";
  const firstRunOnboardingEnabled =
    onboardingPreview || isFirstRunOnboardingEnabled();
  const openInitialPrompt = useCallback(() => {
    if (!initialPrompt || initialPromptConsumedRef.current) return;
    initialPromptConsumedRef.current = true;
    anchorElRef.current = null;
    setNewDeckInitialPrompt({ text: initialPrompt, key: Date.now() });
    setShowNewDeckPrompt(true);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("initialPrompt");
        return next;
      },
      { replace: true },
    );
  }, [initialPrompt, setSearchParams]);

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

  const openNewDeck = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      anchorElRef.current = e.currentTarget;
      designSystemAutoRef.current = true;
      referenceDeckAutoRef.current = true;
      setSelectedDesignSystemId(initialDesignSystemId ?? null);
      setSelectedReferenceDeckId(initialReferenceDeckId ?? null);
      setShowNewDeckPrompt(true);
    },
    [initialDesignSystemId, initialReferenceDeckId],
  );

  const setNewDeckPromptOpen = useCallback(
    (open: boolean, options: { clearInitialPrompt?: boolean } = {}) => {
      setShowNewDeckPrompt(open);
      if (!open) {
        if (options.clearInitialPrompt !== false) {
          setNewDeckInitialPrompt(null);
          setNewDeckRetryFiles([]);
        }
      }
    },
    [],
  );

  const preservePromptForSignIn = useCallback(
    (prompt: string, options: { hadFiles?: boolean } = {}) => {
      if (!savePromptForRetry(prompt, { persistAcrossSignIn: true })) {
        setNewDeckInitialPrompt({ text: prompt, key: Date.now() });
      }
      setNewDeckRetryFiles([]);
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
    try {
      saved = sessionStorage.getItem(PENDING_PROMPT_KEY);
    } catch {}
    if (!saved) return;
    if (savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, saved)) {
      clearPendingPromptForRetry();
      setNewDeckInitialPrompt(null);
    } else {
      clearPendingPromptForRetry();
      setNewDeckInitialPrompt({ text: saved, key: Date.now() });
    }
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
    if (savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, state.retryPrompt)) {
      setNewDeckInitialPrompt(null);
    } else {
      setNewDeckInitialPrompt({ text: state.retryPrompt, key: Date.now() });
    }
    setNewDeckRetryFiles(state.retryFiles ?? []);
    setShowNewDeckPrompt(true);
    navigate(".", { replace: true, state: null });
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
    navigate(`/deck/${deck.id}`);
  };

  const handleCreateDeckWithPrompt = async (
    prompt: string,
    files: UploadedFile[],
    referenceSelection: NewDeckReferenceSelection = {},
  ) => {
    // Pre-flight auth check. The add-deck action returns 403 silently
    // when unauthenticated, leaving the user stuck on a deck page that
    // doesn't exist server-side and a small auth error in the chat
    // sidebar. Catch it here so the user sees a clear sign-in prompt
    // and the typed prompt isn't lost when they come back.
    if (!session) {
      preservePromptForSignIn(prompt, { hadFiles: files.length > 0 });
      return;
    }

    const filesForGeneration = mergeUploadedFilesForRetry(
      newDeckRetryFiles,
      files,
    );
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
      setIsStartingNewDeck(false);
      return;
    }
    const deckId = deck.id;
    setNewDeckPromptOpen(false);

    // Leave the grid as soon as the optimistic deck exists. Persistence and
    // agent context hydration can take several seconds, so the editor's
    // generation state is the only useful surface while that work finishes.
    navigate(`/deck/${deck.id}?generating=1`, {
      replace: true,
      flushSync: true,
    });

    const recoverFromGenerationSetupFailure = (description: string) => {
      if (!savePromptForRetry(prompt)) {
        setNewDeckInitialPrompt({ text: prompt, key: Date.now() });
      }
      setNewDeckRetryFiles(filesForGeneration);
      deleteDeck(deckId);
      toast.error(t("home.generationStartFailed"), { description });
      if (
        typeof window !== "undefined" &&
        deckIdFromPathname(window.location.pathname) === deckId
      ) {
        navigate("/", {
          replace: true,
          state: {
            retryPrompt: prompt,
            retryFiles: filesForGeneration,
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
    if (isSourceImprovementRequest(prompt, filesForGeneration)) {
      try {
        importedSourceDeck = await importUploadedDeckIntoDeck(
          filesForGeneration,
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

    clearPendingPromptForRetry();
    setNewDeckInitialPrompt(null);
    setNewDeckRetryFiles([]);
    const trimmedPrompt = prompt.trim();
    const hasImportedGoogleDocContext = trimmedPrompt.includes("<google-doc ");
    const googleDocUrls = hasImportedGoogleDocContext
      ? []
      : extractGoogleDocUrls(trimmedPrompt);
    const fileContext = describeUploadedFilesForAgent(
      filesForGeneration,
      deckId,
      importedSourceDeck,
    );
    const googleDocContext =
      googleDocUrls.length > 0
        ? [
            "",
            "The request includes Google Docs URL(s):",
            ...googleDocUrls.map((url) => `- ${url}`),
            "Before adding slides, call `import-google-doc` for each URL and use the returned text as source material.",
            "If the action cannot read a private document, tell the user the exact sharing step from the action error instead of generating from the URL alone.",
          ].join("\n")
        : "";
    const [referenceDeckContext, hydratedDesignSystemContext] =
      await Promise.all([
        loadReferenceDeckGenerationContext(referenceDeckId),
        loadDesignSystemGenerationContext(selectedDesignSystem?.id),
      ]);
    const designSystemContext = selectedDesignSystem
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
          "- Before generating a bare or on-brand deck, call `get-workspace-defaults`. If it returns a usable design system, patch this deck with that designSystemId, call `get-design-system`, and follow its exact tokens, assets, and custom instructions.",
          "- If no workspace default exists, report the missing configuration instead of inventing a generic Builder-like palette.",
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
          "- Read get-deck once before editing to obtain every existing slide ID and source HTML, load the linked design system with get-design-system, then make a deck-wide restyle with one patch-deck call using requireAllSourceSlides=true and one patch-slide operation with fields.content for every source slide ID. Do not split a full-deck restyle into arbitrary batches or fall back to one-by-one update-slide calls; use update-slide only for a targeted one-slide edit. Keep every original image source and enough original factual copy for each slide; for PDF slides, use restrained design-system chrome around the page without obscuring it.",
          "- Do not call add-slide, delete slides, reorder slides, or replace source images with generic cards. Do not claim success until get-deck verifies the same slide IDs and count after the edits.",
          '- After the patch succeeds, verify with get-deck using compact: "true" so only slide IDs, count, and previews are returned. Do not report an initial or partial pass, and do not leave any source slides for a later run.',
          "- If get-deck reports partial source fidelity or skipped images, stop and report the exact warning instead of claiming a reliable restyle.",
        ].join("\n")
      : "";
    const sourceModeInstructions = importedSourceDeck
      ? [
          "The request is an in-place visual improvement of an imported source deck. Make a coherent style pass across every existing slide while preserving all source content and media.",
          "Do not use the new-deck add-slide workflow for this source-preserving request. Finish every source slide in this run; if patch-deck rejects incomplete coverage, continue with the returned missing IDs instead of reporting success with a partial deck.",
        ].join("\n")
      : [
          "This is a new deck. Keep it empty until generation begins; attached reference files must not seed it with imported slides.",
          "Start a `manage-progress` run so progress appears in the app header. Add the first slide as soon as it is ready, then continue one slide at a time so the editor visibly fills in.",
          "After reading any requested or attached reference material, but before adding the first slide, choose a concise, specific deck title from the user's request and source material. Never use the deck id, run id, file id, or another opaque alphanumeric token as the title. Call `patch-deck` with `deckId: \"" +
            deckId +
            '\"` and `operations: [{ "op": "patch-deck-fields", "fields": { "title": "<generated title>" } }]`. Include only `title` in `fields`; omit all other optional fields. Never leave a generated deck named "Untitled Deck" or another placeholder, and do not reuse the uploaded filename or a generic label like "Untitled scene" when the content can describe the deck better.',
          "If the user asks for a standalone visual, diagram, hero, one-pager, poster, or a couple of visuals, create only the requested one/few polished visual slides. Do not pad the result into a full presentation.",
          "If the request is for a presentation or deck and does not explicitly ask for one slide, infer a coherent multi-slide outline from the scope and keep adding slides until that outline is complete. Do not stop after the first slide just because the prompt has few explicit instructions.",
          "Add slides ONE AT A TIME using the `add-slide` action with --deckId=" +
            deckId +
            ". Wait for each `add-slide` result before calling it again; do not batch or parallelize slide writes.",
          "Use create-deck and add-slide for this already-created deck. Do not call the legacy generate-slides-ai action: it returns Markdown drafts rather than persisted rendered slide HTML. Treat each successful add-slide result as confirmation to continue with the next planned slide.",
        ].join("\n");

    const context = [
      importedSourceDeck
        ? `The user uploaded a source presentation into target deck (id: "${deckId}") and wants a reliable visual improvement.`
        : `The user just created a new empty deck (id: "${deckId}") and wants to create a presentation or standalone visual.`,
      "The visible user message above contains the user's request and/or pasted source material for the deck. Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
      googleDocContext,
      fileContext,
      referenceDeckContext,
      designSystemContext,
      referenceSourceContext,
      sourceDeckContext,
      "",
      "Before generating, if the request or selected references leave a meaningful choice unresolved, use the `ask-question` tool to ask one concise, prompt-specific question in the inline guided-question flow. Generate the question wording and 2 to 4 options from the user's request and selected references, like Claude's design-question flow; do not use a fixed generic questionnaire. Ask only a choice that materially affects the deck, such as audience, tone, structure, or length. If the prompt already makes the choice clear, do not ask it again. Wait for the user's answer or skip before adding slides.",
      sourceModeInstructions,
      "If the user asked for a specific slide count, keep going sequentially until that count is reached unless a tool error blocks you. If no explicit count was given (including when the guided slide-count question was skipped), infer the count from the distinct topics/sections implied by the request — one slide per section plus a title and closing slide — and add slides for every section before considering the deck done. Do not stop at an arbitrary round number (e.g. 10) if sections remain uncovered, and never call `generate-slides-ai` for this flow; it is a legacy single-shot helper capped at 10 slides.",
      "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels, with 740x380px available inside standard 80px 110px padding). Keep the main content within that fit budget; split dense source material across more slides instead of packing it tightly. Never use zoom, transform: scale(), clipping, or scroll overflow to hide content overflow, and keep body text at least 16px.",
      "When no reference deck or hydrated design system is available, use a restrained, content-first visual language. Do not invent colorful cards, boxes, or decorative rectangles behind or over text; add a colored shape only when it has a clear semantic role and leaves the text unobscured. Prefer typography, spacing, alignment, and one restrained accent.",
      "Each slide's --content must be full HTML. Slide HTML templates are in your AGENTS.md.",
      "Do NOT use create-deck (the deck already exists). Do NOT call db-schema, the resources tool, or search-files.",
    ].join("\n");

    // See the matching comment in create-deck-generation.ts: clear any
    // guided-question card left over from the previous deck's still-finishing
    // run so it can't surface on top of the deck we're navigating to now.
    deleteClientAppState(
      appStateKeyForBrowserTab("guided-questions", TAB_ID),
    ).catch(() => {});
    deleteClientAppState("guided-questions").catch(() => {});

    agentSubmit(createDeckAgentMessage(trimmedPrompt), context, {
      newTab: true,
      reuseEmptyTab: true,
      openSidebar: true,
    });
  };

  const handlePromptSubmit = useCallback(
    (prompt: string, files: UploadedFile[]) => {
      setNewDeckPromptOpen(false, { clearInitialPrompt: false });
      setPendingDeck({ prompt, files });
      setShowNewDeckReferenceStep(true);
    },
    [setNewDeckPromptOpen],
  );

  const handlePromptSkip = useCallback(() => {
    setNewDeckPromptOpen(false, { clearInitialPrompt: false });
    setPendingDeck({ prompt: "", files: [] });
    setShowNewDeckReferenceStep(true);
  }, [setNewDeckPromptOpen]);

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
        navigate(`/deck/${imported.id}`, { flushSync: true });
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
        navigate(`/deck/${imported.id}`, { flushSync: true });
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
        navigate(`/deck/${deck.id}`, { flushSync: true });
        return true;
      } catch (error) {
        deleteDeck(deck.id);
        throw error;
      }
    },
    [
      callAction,
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
      setShowNewDeckReferenceStep(false);
      setPendingDeck(null);
      await handleCreateDeckWithPrompt(
        pending.prompt,
        pending.files,
        selection,
      );
    },
    [
      forgetReference,
      handleCreateDeckWithPrompt,
      pendingDeck,
      rememberReference,
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
        let importedReference: ImportedReference | null = null;
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
          };
          generationFiles = uploaded.filter((file) => file !== pptxReference);
        } else if (pdfReference) {
          const referenceDeck = createDeck(undefined, {
            noDefaultSlides: true,
          });
          const persisted = await ensureDeckPersisted(referenceDeck.id);
          if (!persisted.persisted) {
            deleteDeck(referenceDeck.id);
            throw new Error(
              describeDeckPersistenceFailure(
                persisted,
                "The PDF reference deck could not be saved.",
              ),
            );
          }
          try {
            const imported = (await callAction(
              "import-file",
              {
                filePath: pdfReference.path,
                format: "pdf",
                deckId: referenceDeck.id,
                importIntoDeck: true,
              },
              { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
            )) as {
              imported?: unknown;
              deckId?: unknown;
              pageCount?: unknown;
              title?: unknown;
            };
            if (
              imported.imported !== true ||
              imported.deckId !== referenceDeck.id ||
              typeof imported.pageCount !== "number" ||
              imported.pageCount < 1
            ) {
              throw new Error("The PDF reference deck could not be imported.");
            }
            importedReference = {
              id: referenceDeck.id,
              title:
                typeof imported.title === "string" && imported.title
                  ? imported.title
                  : t("home.importedReferenceDeck"),
              source: "pdf",
            };
            generationFiles = uploaded.filter((file) => file !== pdfReference);
          } catch (error) {
            deleteDeck(referenceDeck.id);
            throw error;
          }
        }
        setPendingDeck((current) =>
          current
            ? { ...current, files: [...current.files, ...generationFiles] }
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
    [
      callAction,
      createDeck,
      deleteDeck,
      ensureDeckPersisted,
      pendingDeck,
      reloadDecks,
      t,
    ],
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
    [callAction, reloadDecks, t],
  );

  const handleReferenceSkip = useCallback(() => {
    const pending = pendingDeck;
    if (!pending) {
      setShowNewDeckReferenceStep(false);
      return;
    }
    setShowNewDeckReferenceStep(false);
    setPendingDeck(null);
    forgetReference("design-system");
    forgetReference("deck");
    if (!pending.prompt.trim() && pending.files.length === 0) {
      handleCreateDeckBlank();
      return;
    }
    void handleCreateDeckWithPrompt(pending.prompt, pending.files, {
      designSystemId: null,
      referenceDeckId: null,
    });
  }, [
    forgetReference,
    handleCreateDeckBlank,
    handleCreateDeckWithPrompt,
    pendingDeck,
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
    (id: string) => {
      let copy: ReturnType<typeof duplicateDeck> | undefined;
      flushSync(() => {
        copy = duplicateDeck(id, `deck-${nanoid()}`, undefined, () => {
          // The background duplicate-deck action failed after we already
          // navigated to the optimistic copy's route. If the user is still
          // there, send them back to the deck list instead of stranding them
          // on a "Deck unavailable" screen for a deck that no longer exists.
          if (deckIdFromPathname(window.location.pathname) === copy?.id) {
            navigate("/");
          }
          toast.error(t("home.duplicateFailed"));
        });
      });
      // The context refuses a second copy of the same deck while the first
      // one's action is still in flight.
      if (!copy) {
        toast.error(t("home.duplicateFailed"));
        return;
      }
      navigate(`/deck/${copy.id}`);
    },
    [duplicateDeck, navigate, t],
  );

  useSetPageTitle(t("home.decksTitle"));

  // Inject "New Deck" into the global header actions slot.
  useSetHeaderActions(
    useMemo(
      () => (
        <Button onClick={openNewDeck} size="sm" className="cursor-pointer">
          <IconPlus className="w-3.5 h-3.5" />
          {t("home.newDeck")}
        </Button>
      ),
      [openNewDeck, t],
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
    <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 pt-0 sm:px-6 sm:pb-10">
      {loading ? (
        <>
          <div className="mb-4 flex items-center justify-end">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="deck-grid-container">
            <div className="deck-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-xl bg-card">
                  <div className="aspect-video animate-pulse bg-muted/50" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : loadError ? (
        <div className="flex min-h-[360px] items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <IconAlertTriangle className="size-7 text-destructive/70" />
            <div>
              <h2 className="font-medium">{t("home.loadFailed")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("home.loadFailedDescription")}
              </p>
            </div>
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
      ) : decks.length === 0 ? (
        <EmptyState onCreateDeck={openNewDeck} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ToggleGroup
              type="single"
              value={deckFilter}
              onValueChange={(value) => value && setDeckFilter(value)}
              className="w-fit rounded-lg border border-border bg-card p-0.5"
              size="sm"
            >
              <ToggleGroupItem
                value="all"
                aria-label={t("home.showAllDecks")}
                className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-accent"
              >
                <IconStack2 className="me-1.5 h-3.5 w-3.5" />
                {t("home.all")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="mine"
                aria-label={t("home.showMineDecks")}
                className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-accent"
              >
                <IconUserCircle className="me-1.5 h-3.5 w-3.5" />
                {t("home.mine")}
              </ToggleGroupItem>
            </ToggleGroup>
            <label className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground sm:w-60">
              <IconSearch className="size-3.5 shrink-0" aria-hidden="true" />
              <Input
                type="search"
                value={deckSearch}
                onChange={(event) => setDeckSearch(event.target.value)}
                placeholder={t("root.searchDecks")}
                aria-label={t("root.searchDecks")}
                className="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </label>
          </div>
          <div className="deck-grid-container">
            <div className="deck-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {/* New deck card */}
              <button
                onClick={openNewDeck}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-transparent bg-card text-start transition-[background-color,border-color] duration-200 hover:border-border hover:bg-accent/30"
              >
                <div className="flex aspect-video items-center justify-center bg-muted/30">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/50 group-hover:bg-accent">
                    <IconPlus className="h-6 w-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium text-muted-foreground group-hover:text-foreground/70">
                    {t("home.newDeck")}
                  </h3>
                </div>
              </button>

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
          </div>
        </>
      )}

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

      <PromptPopover
        open={showNewDeckPrompt}
        onOpenChange={setNewDeckPromptOpen}
        title={t("home.newDeckPromptTitle")}
        placeholder={t("home.newDeckPlaceholder")}
        onSkip={handlePromptSkip}
        skipLabel={t("home.skipPrompt")}
        onSubmit={handlePromptSubmit}
        onImport={handleDirectImport}
        importFromLabel={t("home.importFrom")}
        importingLabel={t("editorToolbar.importing")}
        onBeforeUpload={(prompt, files) => {
          if (session) return true;
          preservePromptForSignIn(prompt, { hadFiles: files.length > 0 });
          return false;
        }}
        loading={generating}
        anchorRef={anchorRef}
        draftScope={NEW_DECK_DRAFT_SCOPE}
        initialText={newDeckInitialPrompt?.text}
        initialTextKey={newDeckInitialPrompt?.key}
      />

      <NewDeckReferenceStep
        open={showNewDeckReferenceStep}
        onOpenChange={(open) => {
          if (!open) {
            const pending = pendingDeck;
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
        onSelect={(selection) => void handleReferenceSelect(selection)}
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
    </main>
  );
}

function EmptyState({
  onCreateDeck,
}: {
  onCreateDeck: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <h2 className="text-xl font-semibold text-foreground">
        {t("home.emptyTitle")}
      </h2>
      <Button
        onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
          onCreateDeck(e as React.MouseEvent<HTMLElement>)
        }
      >
        <IconPlus className="size-4" />
        {t("home.createFirstDeck")}
      </Button>
    </div>
  );
}
