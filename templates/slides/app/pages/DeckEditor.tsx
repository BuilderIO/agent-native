import { useGuidedQuestionFlow } from "@agent-native/core/client/agent-chat";
import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
} from "@agent-native/core/client/collab";
import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  IconAt,
  IconArrowLeft,
  IconLock,
  IconLoader2,
  IconLogin2,
  IconRefresh,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { SlideCommentsPanel } from "@/components/comments/SlideCommentsPanel";
import { AnimationsPanel } from "@/components/editor/AnimationsPanel";
import AssetLibraryPanel from "@/components/editor/AssetLibraryPanel";
import { DeckEditorSkeleton } from "@/components/editor/DeckEditorSkeleton";
import { EditorActionCluster } from "@/components/editor/EditorActionCluster";
import EditorSidebar from "@/components/editor/EditorSidebar";
import EditorToolbar from "@/components/editor/EditorToolbar";
import { canExportPptxFromServer } from "@/components/editor/ExportMenu";
import GeneratingSlidePreview from "@/components/editor/GeneratingSlidePreview";
import HistoryPanel from "@/components/editor/HistoryPanel";
import ImageGenPanel from "@/components/editor/ImageGenPanel";
import { QuestionFlow } from "@/components/editor/QuestionFlow";
import SlideEditor from "@/components/editor/SlideEditor";
import { TweaksPanel } from "@/components/editor/TweaksPanel";
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
import {
  clearSlideEditingActive,
  deckIdFromPathname,
  hasUnsavedDeckChanges,
  markSlideEditingActive,
  type Slide,
  useDecks,
  useSaveState,
} from "@/context/DeckContext";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import {
  useDeckAccessStatus,
  useRequestDeckAccess,
  type DeckAccessStatusResponse,
} from "@/hooks/use-deck-access";
import { useDeckDesignSystem } from "@/hooks/use-deck-design-system";
import { useDeckPresence } from "@/hooks/use-deck-presence";
import { useDeckRole } from "@/hooks/use-deck-role";
import {
  useSlideComments,
  type CommentThread,
} from "@/hooks/use-slide-comments";
import { getAspectRatioDims } from "@/lib/aspect-ratios";
import {
  deckAccessCheckKey,
  shouldShowDeckEditorSkeleton,
} from "@/lib/deck-editor-loading";
import { getPreset } from "@/lib/design-systems";
import { shouldSuppressSlidesItalicShortcut } from "@/lib/editor-shortcuts";
import {
  exportDeckToGoogleSlides,
  fetchDeckPptxFromServer,
} from "@/lib/export-google-slides-client";
import { exportDeckAsPdf } from "@/lib/export-pdf-client";
import { exportDeckAsPptx } from "@/lib/export-pptx-client";
import {
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
  shouldShowNewDeckGeneratingProgress,
  slideBeingFilledInPlace,
} from "@/lib/generation-state";
import { isMissingUploadProviderError } from "@/lib/image-drop-to-agent";
import {
  shouldBlockPendingDeckNavigation,
  usePendingDeckUnloadGuard,
} from "@/lib/pending-deck-changes";
import { imageFileLooksSupported } from "@/lib/slide-image-replacement";
import {
  insertDroppedImageIntoSlideHtml,
  replaceImageTargetInSlideHtml,
} from "@/lib/slide-image-replacement";
import { TAB_ID } from "@/lib/tab-id";
import { shouldActivateTextTool } from "@/lib/text-tool-shortcut";
import { shortcutLabel } from "@/lib/utils";

type EditorSidePanel = "comments" | null;

function MissingDeckAccessPane({
  accessStatus,
  accessStatusError,
  accessStatusLoading,
  hasTeamJoinOption,
  orgLoading,
  orgError,
  requestAccessPending,
  accessRequestSent,
  accessRequestNotified,
  signedIn,
  viewerEmail,
  refreshing,
  onRequestAccess,
  onSignIn,
  onRetry,
  onBack,
}: {
  accessStatus: DeckAccessStatusResponse | null;
  accessStatusError: boolean;
  accessStatusLoading: boolean;
  hasTeamJoinOption: boolean;
  orgLoading: boolean;
  orgError: boolean;
  requestAccessPending: boolean;
  accessRequestSent: boolean;
  accessRequestNotified: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
  refreshing: boolean;
  onRequestAccess: () => void;
  onSignIn: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const privateDeck = Boolean(
    accessStatus?.exists &&
    !accessStatus.hasAccess &&
    accessStatus.visibility === "private",
  );
  const checkingAccess = !privateDeck && (accessStatusLoading || orgLoading);
  const accessCheckFailed = accessStatusError || orgError;
  const Icon =
    privateDeck || (!hasTeamJoinOption && !checkingAccess && !accessCheckFailed)
      ? IconLock
      : IconUsersGroup;
  const title = checkingAccess
    ? t("deckEditor.lookingForDeck")
    : privateDeck
      ? t("deckEditor.privateDeckTitle")
      : accessCheckFailed
        ? t("deckEditor.teamAccessCheckFailed")
        : hasTeamJoinOption
          ? t("deckEditor.joinTeamToOpen")
          : t("deckEditor.deckUnavailable");
  const description = checkingAccess
    ? t("deckEditor.checkingSharedAccess")
    : privateDeck
      ? t("deckEditor.privateDeckDescription")
      : accessCheckFailed
        ? t("deckEditor.verifySharedAccessFailed")
        : hasTeamJoinOption
          ? t("deckEditor.joinTeamDescription")
          : t("deckEditor.deckUnavailableDescription");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground">{title}</h1>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        {privateDeck && viewerEmail ? (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
            <IconAt className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-muted-foreground">
              {t("deckEditor.signedInAs")}{" "}
              <span className="font-medium text-foreground">{viewerEmail}</span>
            </span>
          </div>
        ) : null}
        {privateDeck && accessRequestSent ? (
          <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {t(
              accessRequestNotified
                ? "deckEditor.accessRequestSentDescription"
                : "deckEditor.accessRequestRecordedDescription",
            )}
          </div>
        ) : null}
        <div className="mt-5 flex flex-col gap-2">
          {privateDeck ? (
            <Button
              type="button"
              onClick={signedIn ? onRequestAccess : onSignIn}
              disabled={requestAccessPending || accessRequestSent}
            >
              {requestAccessPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : signedIn ? (
                <IconUserPlus className="size-4" />
              ) : (
                <IconLogin2 className="size-4" />
              )}
              {requestAccessPending
                ? t("deckEditor.requestAccessPending")
                : accessRequestSent
                  ? t("deckEditor.accessRequestSent")
                  : signedIn
                    ? t("deckEditor.requestAccess")
                    : t("deckEditor.signInToRequestAccess")}
            </Button>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onBack}>
              <IconArrowLeft className="size-4" />
              {t("deckEditor.backToDecks")}
            </Button>
            <Button
              type="button"
              variant={privateDeck ? "ghost" : "default"}
              onClick={onRetry}
              disabled={refreshing || checkingAccess}
            >
              <IconRefresh
                className={refreshing ? "size-4 animate-spin" : "size-4"}
              />
              {t("deckEditor.tryAgain")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The Cmd/Ctrl+C-then-V slide-duplicate shortcut can only tell "this key
// event targets the slide rail/canvas" apart from "focus fell back to
// nothing because a panel/dialog elsewhere just closed" by checking a
// deny-list of known text surfaces — and that list can never be complete
// (see the Andrew Rohman Slack thread this guards against: a slide copied
// once early in a session kept silently re-duplicating on unrelated later
// pastes). Bounding how long a copy stays "armed" turns a missed deny-list
// entry from a silent, indefinite landmine into, at worst, a narrow window
// that still covers the real copy-then-paste gesture.
export const SLIDE_CLIPBOARD_ARM_WINDOW_MS = 30_000;

/** True when a Cmd/Ctrl+V should still be treated as "paste the slide that
 * was just copied" rather than unrelated clipboard activity landing outside
 * every recognized text field. */
export function isSlideClipboardStillArmed(
  armedAt: number | null,
  now: number = Date.now(),
): boolean {
  return armedAt !== null && now - armedAt <= SLIDE_CLIPBOARD_ARM_WINDOW_MS;
}

export default function DeckEditor() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, isLoading: sessionLoading } = useSession();
  const {
    getDeck,
    reloadDecks,
    reloadDecksWithStatus,
    refreshOpenDeck,
    updateDeck,
    updateSlide,
    deleteSlide,
    duplicateSlide,
    pasteSlide,
    duplicateDeck,
    addSlide,
    flushDeckSave,
    reorderSlides,
    markDeckDirty,
    undo,
    loading,
    loadError,
  } = useDecks();
  const deckAccessStatusQuery = useDeckAccessStatus(id);
  const requestDeckAccessMutation = useRequestDeckAccess();
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [inlineEditActive, setInlineEditActive] = useState(false);
  const [addSlideGenerating, setAddSlideGenerating] = useState(false);
  // The blank placeholder the agent was asked to fill in place. The rail must
  // light THAT row up as AI-active instead of appending a synthetic generating
  // row, which reads as a second, duplicate slide.
  const [addSlideTargetId, setAddSlideTargetId] = useState<string | null>(null);
  const endAddSlideGeneration = useCallback(() => {
    setAddSlideGenerating(false);
    setAddSlideTargetId(null);
  }, []);
  const [generatingSlideSelected, setGeneratingSlideSelected] = useState(false);
  const { hasUnsavedChanges: hasUnsavedSave } = useSaveState();
  const hasPendingDeckEdits =
    inlineEditActive || (id ? hasUnsavedDeckChanges(id) : hasUnsavedSave);
  usePendingDeckUnloadGuard(hasPendingDeckEdits);
  const pendingDeckNavigationBlocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        shouldBlockPendingDeckNavigation({
          hasPendingEdits: hasPendingDeckEdits,
          currentPathname: currentLocation.pathname,
          nextPathname: nextLocation.pathname,
        }),
      [hasPendingDeckEdits],
    ),
  );
  const pendingDeckNavigationWarningOpen =
    pendingDeckNavigationBlocker.state === "blocked";
  const keepEditingAfterNavigationAttempt = useCallback(() => {
    if (pendingDeckNavigationBlocker.state !== "blocked") return;
    pendingDeckNavigationBlocker.reset();
  }, [pendingDeckNavigationBlocker]);
  const leaveWithPendingDeckChanges = useCallback(() => {
    if (pendingDeckNavigationBlocker.state !== "blocked") return;
    pendingDeckNavigationBlocker.proceed();
  }, [pendingDeckNavigationBlocker]);
  const { generating } = useAgentGenerating();
  // Dedicated instance (not the `generating` one above, which reflects ANY
  // agent chat activity) so an unrelated concurrent run can't be mistaken
  // for this one finishing and clear the flag early. Owning the submit call
  // here — instead of in EditorSidebar, which unmounts when the rail closes
  // on narrow viewports — keeps both the run-scoping and the completion
  // tracking correct across a remount.
  const { generating: addSlideAgentGenerating, submit: addSlideAgentSubmit } =
    useAgentGenerating();
  const sawAddSlideAgentGeneratingRef = useRef(false);
  useEffect(() => {
    if (addSlideAgentGenerating) {
      sawAddSlideAgentGeneratingRef.current = true;
      return;
    }
    if (addSlideGenerating && sawAddSlideAgentGeneratingRef.current) {
      sawAddSlideAgentGeneratingRef.current = false;
      endAddSlideGeneration();
    }
  }, [addSlideGenerating, addSlideAgentGenerating, endAddSlideGeneration]);
  // Generation intent can arrive after this route mounts because the user
  // answers pre-generation questions from the empty editor.
  const wasNewDeckCreation = useRef(searchParams.get("generating") === "1");
  const newDeckGenerationStarted = useRef(false);
  if (searchParams.get("generating") === "1") {
    wasNewDeckCreation.current = true;
  }
  if (wasNewDeckCreation.current && generating) {
    newDeckGenerationStarted.current = true;
  }
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768,
  );
  // The slide just inserted via the toolbar's New Slide button, so the rail
  // can anchor the "describe this slide" popover to its thumbnail once it
  // mounts — even though the button that sets this now lives in the
  // toolbar, outside the rail.
  const [describeSlideId, setDescribeSlideId] = useState<string | null>(null);
  useEffect(() => {
    setDescribeSlideId(null);
  }, [id]);
  const [contextToolbarSlot, setContextToolbarSlot] =
    useState<HTMLDivElement | null>(null);
  const [wideContextToolbarSlot, setWideContextToolbarSlot] =
    useState<HTMLDivElement | null>(null);
  const [retryingMissingDeck, setRetryingMissingDeck] = useState(false);
  const [accessRequestSentDeckId, setAccessRequestSentDeckId] = useState<
    string | null
  >(null);
  const [accessRequestNotified, setAccessRequestNotified] = useState(false);
  const [checkedDeckAccessKey, setCheckedDeckAccessKey] = useState<
    string | null
  >(null);
  const {
    data: org,
    isLoading: orgLoading,
    isError: orgError,
    refetch: refetchOrg,
  } = useOrg();

  // Dialog/popover states
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const [sidePanel, setSidePanel] = useState<EditorSidePanel>(null);
  const [animationsOpen, setAnimationsOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [textBoxMode, setTextBoxMode] = useState(false);
  const toggleDrawMode = useCallback(() => {
    const next = !drawMode;
    if (next) {
      setPinMode(false);
      setTextBoxMode(false);
    }
    setDrawMode(next);
  }, [drawMode]);
  const togglePinMode = useCallback(() => {
    const next = !pinMode;
    if (next) {
      setDrawMode(false);
      setTextBoxMode(false);
    }
    setPinMode(next);
  }, [pinMode]);
  const toggleTextBoxMode = useCallback(() => {
    const next = !textBoxMode;
    if (next) {
      setDrawMode(false);
      setPinMode(false);
    }
    setTextBoxMode(next);
  }, [textBoxMode]);
  const [pendingComment, setPendingComment] = useState<{
    quotedText: string;
  } | null>(null);
  // Track which image src to replace
  const [replaceImageSrc, setReplaceImageSrc] = useState<string | null>(null);

  // Hidden file input for direct upload
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const deck = getDeck(id || "");
  const deckAccessStatus = deckAccessStatusQuery.data ?? null;
  const fitDims = getAspectRatioDims(deck?.aspectRatio);
  const currentDeckAccessKey = deckAccessCheckKey(id, org?.orgId);
  const hasTeamJoinOption =
    !org?.orgId &&
    ((org?.pendingInvitations?.length ?? 0) > 0 ||
      (org?.domainMatches?.length ?? 0) > 0);
  const slideCount = deck?.slides.length ?? 0;
  // Mirror Google Slides: viewers see the editor shell with edit affordances
  // disabled (rather than a separate "viewer" route). Owners/Editors/Admins
  // get the full editor. Only assume edit access while the role is still
  // loading when `createdByMe` already confirms ownership — otherwise a
  // viewer would briefly see (and could click) edit affordances.
  const { canEdit, canComment } = useDeckRole(id, deck?.createdByMe === true);
  const isNewDeckGenerating = shouldShowNewDeckGeneratingProgress({
    generating,
    isNewDeckCreation: wasNewDeckCreation.current,
  });
  const showNewDeckGeneratingOverlay = shouldShowNewDeckGeneratingOverlay({
    generating,
    isNewDeckCreation: wasNewDeckCreation.current,
    slideCount,
    generationStarted: newDeckGenerationStarted.current,
  });
  const { designSystem, imageStyleReferenceUrls } = useDeckDesignSystem(
    deck?.designSystemId,
  );
  const commentsOpen = sidePanel === "comments";

  const {
    questions: questionFlowQuestions,
    title: questionFlowTitle,
    description: questionFlowDescription,
    skipLabel: questionFlowSkipLabel,
    submitLabel: questionFlowSubmitLabel,
    handleSubmit: handleQuestionSubmit,
    handleSkip: handleQuestionSkip,
  } = useGuidedQuestionFlow({
    stateKey: "guided-questions",
    browserTabId: TAB_ID,
    queryKey: ["guided-questions"],
    submitMessage: "Here are my answers — go ahead and create the slides.",
    skipMessage:
      "Skip the questions — just go ahead and create the slides with your best judgment.",
    buildSubmitContext: ({ formattedAnswers }) =>
      [
        "The user answered the pre-generation questions.",
        `Deck ID: ${id}`,
        "",
        "Answers:",
        formattedAnswers,
        "",
        `Every slide is rendered into a fixed native canvas (${fitDims.width}x${fitDims.height} CSS pixels; standard padding leaves ${Math.max(0, fitDims.width - 220)}x${Math.max(0, fitDims.height - 160)}px for main content). Keep the main content within that fit budget; split dense source material across more slides instead of packing it tightly. Never use zoom, transform: scale(), clipping, or scroll overflow to hide content overflow, and keep body text at least 16px.`,
        "",
        `Now generate the slides based on these preferences. Start a manage-progress run, add the first slide as soon as it is ready, then continue one slide at a time so the editor visibly fills in. Use add-slide with --deckId=${id} to add slides sequentially. Wait for each add-slide result before calling it again.`,
      ].join("\n"),
    buildSkipContext: () =>
      `The user skipped the pre-generation questions for deck ${id}. Proceed with reasonable defaults. Every slide is rendered into a fixed native canvas (${fitDims.width}x${fitDims.height} CSS pixels; standard padding leaves ${Math.max(0, fitDims.width - 220)}x${Math.max(0, fitDims.height - 160)}px for main content); keep each slide within that fit budget and split dense source material across more slides instead of packing it tightly. Never use zoom, transform: scale(), clipping, or scroll overflow to hide content overflow, and keep body text at least 16px. Start a manage-progress run, add the first slide as soon as it is ready, then continue sequentially using add-slide with --deckId=${id}. Wait for each add-slide result before calling it again.`,
  });

  const showQuestionFlow = Boolean(questionFlowQuestions?.length);
  const fillingPlaceholderSlideId = slideBeingFilledInPlace({
    addSlideGenerating,
    addSlideTargetId,
    slideIds: deck?.slides.map((slide) => slide.id) ?? [],
  });
  const generatingSlideVisible =
    canEdit &&
    !showQuestionFlow &&
    (isNewDeckGenerating ||
      (addSlideGenerating && !fillingPlaceholderSlideId) ||
      showNewDeckGeneratingOverlay);
  const showCurrentSlideEditor =
    !generatingSlideSelected &&
    !showNewDeckGeneratingOverlay &&
    !showQuestionFlow;

  useEffect(() => {
    if (!generatingSlideVisible) setGeneratingSlideSelected(false);
  }, [generatingSlideVisible]);

  // The add-slide request is finished once the agent stops generating, so the
  // rail's placeholder must not outlive it.
  useEffect(() => {
    if (!generating) endAddSlideGeneration();
  }, [generating, endAddSlideGeneration]);

  // Below `md` the rail is a drawer behind a full-viewport dimming scrim; at
  // `md` and up it's docked with no scrim. `sidebarOpen` is seeded from the
  // width at mount only, so a window that starts wide and is then narrowed
  // (or an editor opened in a resizable preview pane) keeps `sidebarOpen`
  // true while the scrim stops being `md:hidden` — dimming the whole editor
  // with no way to dismiss it.
  useEffect(() => {
    const onResize = () => setSidebarOpen(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const previousSlideIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentSlideIds = deck?.slides.map((slide) => slide.id) ?? [];
    const previousSlideIds = previousSlideIdsRef.current;
    const addedSlide = deck?.slides.find(
      (slide) => !previousSlideIds.includes(slide.id),
    );
    const slideWasAdded = currentSlideIds.length > previousSlideIds.length;

    previousSlideIdsRef.current = currentSlideIds;
    if (!slideWasAdded) return;

    // Keep the user's current slide stable while AI appends slides. The only
    // exception is an explicit click on the synthetic generating-slide row,
    // which opts the user into following that one generated slide.
    if (addedSlide && generatingSlideSelected) {
      setActiveSlideId(addedSlide.id);
    }
    setGeneratingSlideSelected(false);
  }, [deck, generatingSlideSelected]);

  useEffect(() => {
    if (
      loading ||
      deck ||
      !id ||
      !currentDeckAccessKey ||
      orgLoading ||
      checkedDeckAccessKey === currentDeckAccessKey
    ) {
      return;
    }

    if (!org?.orgId) {
      setCheckedDeckAccessKey(currentDeckAccessKey);
      return;
    }

    let cancelled = false;
    void (async () => {
      let status = await reloadDecksWithStatus();
      while (!cancelled && status === "stale") {
        status = await reloadDecksWithStatus();
      }
      if (!cancelled) setCheckedDeckAccessKey(currentDeckAccessKey);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    checkedDeckAccessKey,
    currentDeckAccessKey,
    deck,
    id,
    loading,
    org?.orgId,
    orgLoading,
    reloadDecksWithStatus,
  ]);

  const retryOpenDeck = useCallback(async () => {
    setRetryingMissingDeck(true);
    try {
      await refetchOrg();
      await reloadDecks();
    } finally {
      setRetryingMissingDeck(false);
    }
  }, [refetchOrg, reloadDecks]);

  const openSignIn = useCallback(() => {
    window.location.href = buildSignInReturnHref();
  }, []);

  const requestDeckAccess = useCallback(() => {
    if (!id) return;
    requestDeckAccessMutation.mutate(
      { deckId: id },
      {
        onSuccess: (result) => {
          setAccessRequestSentDeckId(id);
          setAccessRequestNotified(result.notifiedOwner);
          toast.success(result.message);
          if (result.alreadyHasAccess) void reloadDecks();
        },
      },
    );
  }, [id, reloadDecks, requestDeckAccessMutation]);

  useEffect(() => {
    if (accessRequestSentDeckId && accessRequestSentDeckId !== id) {
      setAccessRequestSentDeckId(null);
      setAccessRequestNotified(false);
    }
  }, [accessRequestSentDeckId, id]);

  // The final generation write can race the last sync event. Pull the
  // authoritative open deck when the run settles so a stale canvas does not
  // require a browser refresh to reveal completed slides.
  useEffect(() => {
    if (
      !id ||
      !shouldClearNewDeckGeneratingState({
        generating,
        generationStarted: newDeckGenerationStarted.current,
      })
    ) {
      return;
    }
    void refreshOpenDeck(id);
  }, [generating, id, refreshOpenDeck]);

  // Clean up the generating URL param/ref when generation completes or when
  // the first slide lands, so partial progress is visible during long decks.
  useEffect(() => {
    if (
      !shouldClearNewDeckGeneratingState({
        generating,
        generationStarted: newDeckGenerationStarted.current,
      })
    ) {
      return;
    }
    wasNewDeckCreation.current = false;
    if (searchParams.get("generating")) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("generating");
          return next;
        },
        { replace: true },
      );
    }
  }, [generating, searchParams, setSearchParams]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!deck || !id) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = deck.slides.findIndex((s) => s.id === active.id);
      const newIndex = deck.slides.findIndex((s) => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderSlides(id, oldIndex, newIndex);
      }
    },
    [deck, id, reorderSlides],
  );

  const uploadImageAsset = useCallback(
    async (file: File): Promise<string> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        const serverError =
          typeof data?.error === "string" ? data.error : undefined;
        if (isMissingUploadProviderError(res.status, serverError)) {
          throw new Error(t("deckEditor.imageUploadNeedsBuilder"));
        }
        throw new Error(serverError || t("deckEditor.imageUploadFailed"));
      }
      return data.url as string;
    },
    [t],
  );

  // Replace an image or placeholder in the current slide's HTML content.
  const replaceImageInSlide = useCallback(
    (oldSrc: string, newSrc: string, alt?: string) => {
      if (!id || !currentSlideRef.current) return;
      const slide = currentSlideRef.current;
      const updatedContent = replaceImageTargetInSlideHtml(
        slide.content,
        oldSrc,
        newSrc,
        { alt },
      );
      if (updatedContent !== slide.content) {
        updateSlide(id, slide.id, { content: updatedContent });
      }
    },
    [id, updateSlide],
  );

  const uploadAndApplyImage = useCallback(
    async (
      replaceSrc: string | null,
      file: File,
      position?: { x: number; y: number },
    ) => {
      if (!id || !currentSlideRef.current) return;
      const targetSlideId = currentSlideRef.current.id;
      if (!replaceSrc) {
        try {
          const newUrl = await uploadImageAsset(file);
          const targetSlide =
            currentSlideRef.current?.id === targetSlideId
              ? currentSlideRef.current
              : getDeck(id)?.slides.find((slide) => slide.id === targetSlideId);
          if (!targetSlide) return;
          const updatedContent = insertDroppedImageIntoSlideHtml(
            targetSlide.content,
            newUrl,
            { alt: file.name, position },
          );
          if (updatedContent !== targetSlide.content) {
            updateSlide(id, targetSlide.id, { content: updatedContent });
          }
          toast.success(t("deckEditor.imageAdded"), {
            description: file.name,
          });
        } catch (error) {
          toast.error(t("deckEditor.imageUploadFailed"), {
            description:
              error instanceof Error
                ? error.message
                : t("deckEditor.imageUploadError"),
          });
        }
        return;
      }
      try {
        const newUrl = await uploadImageAsset(file);
        const targetSlide =
          currentSlideRef.current?.id === targetSlideId
            ? currentSlideRef.current
            : getDeck(id)?.slides.find((slide) => slide.id === targetSlideId);
        if (!targetSlide) return;
        const updatedContent = replaceImageTargetInSlideHtml(
          targetSlide.content,
          replaceSrc,
          newUrl,
          { alt: file.name },
        );
        if (updatedContent !== targetSlide.content) {
          updateSlide(id, targetSlide.id, { content: updatedContent });
        }
        toast.success(t("deckEditor.imageAdded"), {
          description: file.name,
        });
      } catch (error) {
        toast.error(t("deckEditor.imageUploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("deckEditor.imageUploadError"),
        });
      }
    },
    [getDeck, id, t, updateSlide, uploadImageAsset],
  );

  // Drag an already-hosted image (e.g. dragged out of a generated-image
  // preview in the agent chat panel) onto the slide canvas. Unlike
  // uploadAndApplyImage there's nothing to upload — the URL is already a
  // live asset — so this just swaps it into the target image/placeholder.
  const dropImageUrlOnSlide = useCallback(
    (
      replaceSrc: string | null,
      url: string,
      position?: { x: number; y: number },
    ) => {
      if (!id || !currentSlideRef.current) return;
      if (!replaceSrc) {
        const targetSlide = currentSlideRef.current;
        const updatedContent = insertDroppedImageIntoSlideHtml(
          targetSlide.content,
          url,
          { position },
        );
        if (updatedContent !== targetSlide.content) {
          updateSlide(id, targetSlide.id, { content: updatedContent });
        }
        toast.success(t("deckEditor.imageAdded"));
        return;
      }
      replaceImageInSlide(replaceSrc, url);
      toast.success(t("deckEditor.imageAdded"));
    },
    [id, replaceImageInSlide, t, updateSlide],
  );

  // Toggle object-fit on an image in the current slide
  const toggleObjectFit = useCallback(
    (imgSrc: string, newFit: string) => {
      if (!id || !currentSlideRef.current) return;
      const slide = currentSlideRef.current;
      const escapedSrc = imgSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match the img tag containing this src and update/add object-fit in its style
      const imgRegex = new RegExp(
        `(<img[^>]*src=["']${escapedSrc}["'][^>]*?)(/?>)`,
      );
      const match = slide.content.match(imgRegex);
      if (!match) return;
      let imgTag = match[1];
      // Update or add style attribute with object-fit
      if (/style\s*=\s*["']/.test(imgTag)) {
        if (/object-fit\s*:/.test(imgTag)) {
          imgTag = imgTag.replace(
            /object-fit\s*:\s*[^;"']+/,
            `object-fit: ${newFit}`,
          );
        } else {
          imgTag = imgTag.replace(
            /style\s*=\s*["']/,
            `style="object-fit: ${newFit}; `,
          );
        }
      } else {
        imgTag += ` style="object-fit: ${newFit};"`;
      }
      const updatedContent = slide.content.replace(imgRegex, imgTag + match[2]);
      if (updatedContent !== slide.content) {
        updateSlide(id, slide.id, { content: updatedContent });
      }
    },
    [id, updateSlide],
  );

  // Handle direct file upload and replace image
  const handleDirectUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !replaceImageSrc) return;
      await uploadAndApplyImage(replaceImageSrc, files[0]);
      setReplaceImageSrc(null);
      e.target.value = "";
    },
    [replaceImageSrc, uploadAndApplyImage],
  );

  /**
   * Delete a slide with an "Undo" toast.
   *
   * Why: Rochkind reported accidental slide deletions (clicking an element →
   * Delete → entire slide gone, no obvious recovery path). The undo
   * mechanism existed (Cmd+Z) but wasn't discoverable. This surfaces a
   * 6-second undo toast right next to the action.
   */
  const deleteSlideWithUndo = useCallback(
    (deckId: string, slideId: string) => {
      const slideTitle = (() => {
        const slide = deck?.slides.find((s) => s.id === slideId);
        if (!slide) return "Slide";
        const m = slide.content.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
        return (
          m?.[1]?.trim() || `Slide ${(deck?.slides.indexOf(slide) ?? 0) + 1}`
        );
      })();
      deleteSlide(deckId, slideId);
      toast(`${slideTitle} deleted`, {
        description: `Press ${shortcutLabel("cmd+z")} or click Undo to restore.`,
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => undo(),
        },
      });
    },
    [deck, deleteSlide, undo],
  );

  useEffect(() => {
    const handleTextToolShortcut = (event: KeyboardEvent) => {
      if (
        !shouldActivateTextTool(event, {
          canEdit,
          activeElement: document.activeElement,
          blockingSurfaceOpen: Boolean(
            document.querySelector(
              "[role='dialog'], [role='menu'], [role='listbox']",
            ),
          ),
        })
      ) {
        return;
      }

      event.preventDefault();
      setDrawMode(false);
      setPinMode(false);
      setTextBoxMode(true);
    };

    document.addEventListener("keydown", handleTextToolShortcut);
    return () =>
      document.removeEventListener("keydown", handleTextToolShortcut);
  }, [canEdit]);

  useEffect(() => {
    const handleItalicShortcut = (event: KeyboardEvent) => {
      if (!shouldSuppressSlidesItalicShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    document.addEventListener("keydown", handleItalicShortcut, true);
    return () =>
      document.removeEventListener("keydown", handleItalicShortcut, true);
  }, []);

  // Delete key deletes the current slide
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!deck || !id || !activeSlideId) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't intercept while the user is in an annotation mode (pin / draw)
      // — they are clearly composing, not navigating slides.
      if (pinMode || drawMode) return;
      // Bail if the focused element OR the event target is editable, lives
      // inside the agent sidebar, lives inside a pin popover, or is a slide
      // element selection. Walking ancestors instead of relying on tagName
      // alone catches Tiptap (contenteditable), portaled popovers, and
      // shadcn wrappers that re-route focus.
      const isInsideSafeZone = (el: Element | null) => {
        if (!el) return false;
        if (el instanceof HTMLInputElement) return true;
        if (el instanceof HTMLTextAreaElement) return true;
        if (el instanceof HTMLElement) {
          if (el.isContentEditable) return true;
          if (el.closest("[contenteditable='true']")) return true;
          if (el.closest("input, textarea, [role='textbox']")) return true;
          if (el.closest("[data-pin-popover]")) return true;
          if (el.closest(".agent-panel-root")) return true;
        }
        return false;
      };
      const target = e.target as Element | null;
      if (isInsideSafeZone(target)) return;
      if (isInsideSafeZone(document.activeElement)) return;
      // Belt-and-suspenders: if a pin composer is mounted anywhere, the user
      // is in mid-comment. The textarea has autoFocus but autoFocus isn't
      // instantaneous, so the first keystroke can land on the canvas before
      // focus moves — without this check, Backspace would delete the slide
      // the user is trying to comment on.
      if (document.querySelector("[data-pin-popover]")) return;
      // Skip if the SlideEditor reports an element is selected (image, text
      // block, or builder-id selector). Slide-level delete is reserved for
      // when the canvas itself has focus.
      if (document.querySelector("[data-slide-element-selected='true']"))
        return;
      if (deck.slides.length <= 1) return; // don't delete last slide
      const idx = deck.slides.findIndex((s) => s.id === activeSlideId);
      const nextSlide = deck.slides[idx + 1] || deck.slides[idx - 1];
      deleteSlideWithUndo(id, activeSlideId);
      if (nextSlide) setActiveSlideId(nextSlide.id);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deck, id, activeSlideId, deleteSlideWithUndo, pinMode, drawMode]);

  // Slide-level clipboard backing both the Cmd+C/Cmd+V shortcut below and the
  // rail's right-click Cut/Copy/Paste menu. Holds a full slide snapshot
  // (rather than just an id) so paste still works after Cut has already
  // removed the original slide from the deck.
  const slideClipboardRef = useRef<Slide | null>(null);
  // Only gates the ambient document-level Cmd/Ctrl+V shortcut below — the
  // rail's right-click "Paste" menu item is an explicit click with no
  // ambiguity risk, so it keeps working off `hasSlideClipboard` alone however
  // long ago the copy happened.
  const slideClipboardArmedAtRef = useRef<number | null>(null);
  const [hasSlideClipboard, setHasSlideClipboard] = useState(false);

  const copySlide = useCallback(
    (slideId: string) => {
      const slide = deck?.slides.find((s) => s.id === slideId);
      if (!slide) return;
      slideClipboardRef.current = slide;
      slideClipboardArmedAtRef.current = Date.now();
      setHasSlideClipboard(true);
    },
    [deck],
  );

  const cutSlide = useCallback(
    (slideId: string) => {
      if (!deck || !id || deck.slides.length <= 1) return; // don't cut the last slide
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return;
      slideClipboardRef.current = slide;
      slideClipboardArmedAtRef.current = Date.now();
      setHasSlideClipboard(true);
      const idx = deck.slides.findIndex((s) => s.id === slideId);
      const nextSlide = deck.slides[idx + 1] || deck.slides[idx - 1];
      deleteSlideWithUndo(id, slideId);
      if (activeSlideId === slideId && nextSlide) {
        setActiveSlideId(nextSlide.id);
      }
    },
    [deck, id, activeSlideId, deleteSlideWithUndo],
  );

  const pasteSlideAfter = useCallback(
    (targetSlideId: string) => {
      const clipboard = slideClipboardRef.current;
      if (!clipboard || !id) return;
      const { id: _clipboardId, ...fields } = clipboard;
      const newId = pasteSlide(id, targetSlideId, fields);
      if (newId) setActiveSlideId(newId);
    },
    [id, pasteSlide],
  );

  // Handlers backing the slide rail's right-click menu.
  const handleDeleteSlideFromRail = useCallback(
    (slideId: string) => {
      if (!deck || !id || deck.slides.length <= 1) return; // don't delete the last slide
      const idx = deck.slides.findIndex((s) => s.id === slideId);
      const nextSlide = deck.slides[idx + 1] || deck.slides[idx - 1];
      deleteSlideWithUndo(id, slideId);
      if (activeSlideId === slideId && nextSlide) {
        setActiveSlideId(nextSlide.id);
      }
    },
    [deck, id, activeSlideId, deleteSlideWithUndo],
  );

  const handleDuplicateSlideFromRail = useCallback(
    (slideId: string) => {
      if (!id) return;
      const newId = duplicateSlide(id, slideId);
      if (newId) setActiveSlideId(newId);
    },
    [id, duplicateSlide],
  );

  const handleNewSlideAfter = useCallback(
    (afterSlideId: string) => {
      if (!deck || !id) return;
      const afterIdx = deck.slides.findIndex((s) => s.id === afterSlideId);
      // Immediate persistence: mirrors handleAddEmptySlide, since this also
      // opens the "describe this slide" popover right away.
      const newId = addSlide(
        id,
        "blank",
        afterIdx >= 0 ? afterIdx : undefined,
        { persistence: "immediate" },
      );
      setActiveSlideId(newId);
      setSidebarOpen(true);
      setDescribeSlideId(newId);
    },
    [deck, id, addSlide],
  );

  const handleToggleSkipSlide = useCallback(
    (slideId: string) => {
      if (!deck || !id) return;
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return;
      updateSlide(id, slideId, { skipped: !slide.skipped });
    },
    [deck, id, updateSlide],
  );

  // Command/Ctrl+C then Command/Ctrl+V on the slide rail copies/pastes the
  // selected slide directly below itself. Only claims the shortcut when no
  // slide element is selected — SlideEditor owns Cmd+C/V for object copy/paste
  // in that case.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!deck || !id || !canEdit) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      if (pinMode || drawMode) return;

      // A live browser text selection (e.g. the user triple-clicked rendered,
      // non-editable slide copy) means Cmd/Ctrl+C is a normal text copy —
      // let it through instead of hijacking it into a slide duplicate.
      if (key === "c" && (window.getSelection()?.toString().length ?? 0) > 0) {
        return;
      }

      // Radix Popper positions Popover/DropdownMenu/Select/Tooltip content
      // inside the same [data-radix-popper-content-wrapper]. A tooltip opens
      // on plain hover, so treating every such wrapper as blocking would
      // disable this shortcut just by mousing over a toolbar button; only
      // wrappers that aren't tooltips (marked with data-agent-native-tooltip)
      // should count as an open menu/popover/dialog owning the keystroke.
      const isBlockingPopperWrapper = (el: Element) =>
        el.matches("[data-radix-popper-content-wrapper]") &&
        !el.querySelector("[data-agent-native-tooltip]");
      const isInsideSafeZone = (el: Element | null) => {
        if (!el) return false;
        if (el instanceof HTMLInputElement) return true;
        if (el instanceof HTMLTextAreaElement) return true;
        if (el instanceof HTMLElement) {
          if (el.isContentEditable) return true;
          if (el.closest("[contenteditable='true']")) return true;
          if (el.closest("input, textarea, [role='textbox']")) return true;
          if (el.closest("[data-pin-popover]")) return true;
          if (el.closest("[data-add-slide-popover]")) return true;
          if (el.closest(".agent-panel-root")) return true;
          if (el.closest("[role='dialog'], [role='alertdialog']")) return true;
          const popperWrapper = el.closest(
            "[data-radix-popper-content-wrapper]",
          );
          if (popperWrapper && isBlockingPopperWrapper(popperWrapper))
            return true;
        }
        return false;
      };
      if (isInsideSafeZone(e.target as Element | null)) return;
      if (isInsideSafeZone(document.activeElement)) return;
      if (document.querySelector("[data-pin-popover]")) return;
      if (document.querySelector("[data-add-slide-popover]")) return;
      // A dialog/sheet/menu/popover owning focus elsewhere in the DOM (not
      // just under the event target) still shouldn't let this document-level
      // shortcut duplicate the slide underneath it.
      if (
        document.querySelector(
          "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']",
        )
      )
        return;
      if (
        Array.from(
          document.querySelectorAll("[data-radix-popper-content-wrapper]"),
        ).some(isBlockingPopperWrapper)
      )
        return;
      if (document.querySelector("[data-slide-element-selected='true']"))
        return;

      if (key === "c") {
        if (!activeSlideId) return;
        copySlide(activeSlideId);
        return;
      }

      if (
        !hasSlideClipboard ||
        !activeSlideId ||
        !isSlideClipboardStillArmed(slideClipboardArmedAtRef.current)
      )
        return;
      e.preventDefault();
      pasteSlideAfter(activeSlideId);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    deck,
    id,
    canEdit,
    activeSlideId,
    copySlide,
    hasSlideClipboard,
    pasteSlideAfter,
    pinMode,
    drawMode,
  ]);

  // Resolve the active slide from URL/deck state. Imports replace slide IDs, so
  // keep this valid after deck contents change instead of only on first load.
  // Track the last URL ?slide param we processed so we can tell "the URL changed
  // externally" (agent navigate command, browser back/forward, deep link) apart
  // from "the URL is the same as last render, just other state moved". Without
  // this, the resolver short-circuited on external URL changes and the agent's
  // navigate --slideNumber / --slideIndex commands were effectively ignored.
  const lastUrlSlideParamRef = useRef<string | null>(null);
  const pendingUrlSlideIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deck) return;
    if (deck.slides.length === 0) {
      if (activeSlideId) setActiveSlideId(null);
      lastUrlSlideParamRef.current = null;
      pendingUrlSlideIdRef.current = null;
      return;
    }

    const slideParam = searchParams.get("slide");
    const urlChanged = slideParam !== lastUrlSlideParamRef.current;
    lastUrlSlideParamRef.current = slideParam;

    if (urlChanged && slideParam) {
      const idx = parseInt(slideParam, 10) - 1;
      if (idx >= 0 && idx < deck.slides.length) {
        const targetId = deck.slides[idx].id;
        if (activeSlideId !== targetId) {
          pendingUrlSlideIdRef.current = targetId;
          setActiveSlideId(targetId);
        } else if (pendingUrlSlideIdRef.current === targetId) {
          pendingUrlSlideIdRef.current = null;
        }
        return;
      }
    }

    if (
      pendingUrlSlideIdRef.current &&
      !deck.slides.some((s) => s.id === pendingUrlSlideIdRef.current)
    ) {
      pendingUrlSlideIdRef.current = null;
    }

    if (activeSlideId && deck.slides.some((s) => s.id === activeSlideId)) {
      return;
    }
    if (slideParam) {
      const idx = parseInt(slideParam, 10) - 1;
      if (idx >= 0 && idx < deck.slides.length) {
        setActiveSlideId(deck.slides[idx].id);
        return;
      }
    }
    setActiveSlideId(deck.slides[0].id);
  }, [deck, activeSlideId, searchParams]);

  // Sync active slide index to URL
  useEffect(() => {
    if (!deck || !activeSlideId) return;
    const pendingUrlSlideId = pendingUrlSlideIdRef.current;
    if (pendingUrlSlideId) {
      if (!deck.slides.some((s) => s.id === pendingUrlSlideId)) {
        pendingUrlSlideIdRef.current = null;
      } else if (activeSlideId !== pendingUrlSlideId) {
        return;
      } else {
        pendingUrlSlideIdRef.current = null;
      }
    }
    const idx = deck.slides.findIndex((s) => s.id === activeSlideId);
    if (idx >= 0) {
      const current = searchParams.get("slide");
      const newVal = String(idx + 1);
      if (current !== newVal) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("slide", newVal);
            return next;
          },
          { replace: true },
        );
      }
    }
  }, [activeSlideId, deck, searchParams, setSearchParams]);

  // Expose current selection state to agent chat / scripts via window global + data attrs
  useEffect(() => {
    if (!deck || !id) return;
    const slide =
      deck.slides.find((s) => s.id === activeSlideId) || deck.slides[0];
    const idx = deck.slides.findIndex((s) => s.id === slide?.id);
    const selection = {
      deckId: id,
      deckTitle: deck.title,
      slideId: slide?.id || null,
      slideIndex: idx >= 0 ? idx : 0,
      slideLayout: slide?.layout || null,
      slideContent: slide?.content || null,
      selectedImageSrc: replaceImageSrc,
    };
    (window as any).__deckSelection = selection;
    const el = document.documentElement;
    el.dataset.deckId = id;
    el.dataset.slideId = slide?.id || "";
    el.dataset.slideIndex = String(idx >= 0 ? idx : 0);
    if (replaceImageSrc) {
      el.dataset.selectedImage = replaceImageSrc;
    } else {
      delete el.dataset.selectedImage;
    }
    return () => {
      delete (window as any).__deckSelection;
      delete el.dataset.deckId;
      delete el.dataset.slideId;
      delete el.dataset.slideIndex;
      delete el.dataset.selectedImage;
    };
  }, [deck, id, activeSlideId, replaceImageSrc]);

  const currentSlideRef =
    useRef<typeof deck extends undefined ? null : any>(null);

  // Session for collab user identity
  const currentUser = session?.email
    ? {
        email: session.email,
        name: emailToName(session.email),
        color: emailToColor(session.email),
      }
    : undefined;

  // Slide-level collab: one Yjs doc per slide. This tracks HUMAN collaborators
  // editing the active slide's content (slideActiveUsers) and any agent edits
  // that flow through the slide-content Yjs doc.
  // Uses activeSlideId (state) so it's stable before deck loads.
  // useCollaborativeDoc handles null docId gracefully (returns empty state).
  const slideDocId =
    id && activeSlideId ? `deck-${id}-slide-${activeSlideId}` : null;
  const {
    activeUsers: slideActiveUsers,
    agentActive: slideAgentActive,
    agentPresent: slideAgentPresent,
  } = useCollaborativeDoc({
    docId: slideDocId,
    requestSource: TAB_ID,
    user: currentUser,
  });

  // Deck-level presence: which slide each participant (human OR agent) is on.
  // The slide-editing actions write agent presence + lingering "AI edited"
  // highlights to THIS doc (`deck-<id>`) via agentTouchDocument, so the agent's
  // per-slide presence and recent edits come from here.
  const {
    slidePresence,
    agentPresent: deckAgentPresent,
    agentActive: deckAgentActive,
    agentSlideId,
    recentEdits: deckRecentEdits,
    awareness: deckPresenceAwareness,
  } = useDeckPresence({
    deckId: deck ? (id ?? null) : null,
    activeSlideId: activeSlideId,
    user: currentUser,
  });

  // The agent is "present"/"active" if EITHER the deck presence doc (action
  // edits) or the slide-content doc (Yjs edits) says so — a single unified
  // signal for the toolbar/slide chips.
  const agentPresent = generating || deckAgentPresent || slideAgentPresent;
  const agentActive = generating || deckAgentActive || slideAgentActive;

  // Comments for the current slide (for badge count)
  const currentSlideCommentsQuery = useSlideComments(
    deck ? (id ?? null) : null,
    activeSlideId,
  );
  const currentSlideThreads: CommentThread[] =
    currentSlideCommentsQuery.data ?? [];
  const unresolvedCommentCount = currentSlideThreads.filter(
    (t) => !t.resolved,
  ).length;

  if (
    shouldShowDeckEditorSkeleton({
      deckFound: Boolean(deck),
      decksLoading: loading,
      orgLoading,
      accessCheckKey: currentDeckAccessKey,
      checkedAccessKey: checkedDeckAccessKey,
      retrying: retryingMissingDeck,
      privateDeckAccessConfirmed: Boolean(
        deckAccessStatus?.exists &&
        !deckAccessStatus.hasAccess &&
        deckAccessStatus.visibility === "private",
      ),
    })
  ) {
    return <DeckEditorSkeleton label={t("deckEditor.lookingForDeck")} />;
  }
  if (!deck || !id) {
    return (
      <MissingDeckAccessPane
        accessStatus={deckAccessStatus}
        accessStatusError={deckAccessStatusQuery.isError}
        accessStatusLoading={loading || deckAccessStatusQuery.isLoading}
        hasTeamJoinOption={hasTeamJoinOption}
        orgLoading={orgLoading}
        orgError={orgError || loadError}
        requestAccessPending={requestDeckAccessMutation.isPending}
        accessRequestSent={accessRequestSentDeckId === id}
        accessRequestNotified={accessRequestNotified}
        signedIn={Boolean(session) && !sessionLoading}
        viewerEmail={session?.email ?? deckAccessStatus?.viewerEmail ?? null}
        refreshing={retryingMissingDeck}
        onRequestAccess={requestDeckAccess}
        onSignIn={openSignIn}
        onRetry={() => void retryOpenDeck()}
        onBack={() => navigate("/")}
      />
    );
  }

  const currentSlide =
    deck.slides.find((s) => s.id === activeSlideId) || deck.slides[0];
  const currentIndex = deck.slides.findIndex((s) => s.id === currentSlide?.id);
  currentSlideRef.current = currentSlide;

  // Editor-wide drag-and-drop catch-all. SlideEditor's own drop handler runs
  // first for drops landing on a slide (it calls stopPropagation), so this
  // only fires for drops that landed in the surrounding chrome. Prevent the
  // browser from navigating to the dropped file, and add it to the active
  // slide at the default canvas position.
  const editorDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const editorDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    const file = files.find(imageFileLooksSupported);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    void uploadAndApplyImage(null, file);
  };

  const handleAddEmptySlide = () => {
    const activeIdx = deck.slides.findIndex((s) => s.id === activeSlideId);
    // Immediate persistence: this placeholder is immediately followed by an
    // agent request to `update-slide` it, which can reach the server before
    // the default 500ms debounce would have flushed the `add-slide` op.
    const newId = addSlide(
      id,
      "blank",
      activeIdx >= 0 ? activeIdx : undefined,
      {
        persistence: "immediate",
      },
    );
    setActiveSlideId(newId);
    return newId;
  };

  const handleNewSlideClick = () => {
    const newId = handleAddEmptySlide();
    if (newId) {
      // The rail owns the anchor node the describe-slide popover attaches
      // to, so it must be mounted even if it started closed on a narrow
      // viewport where the toolbar button is still reachable.
      setSidebarOpen(true);
      setDescribeSlideId(newId);
    }
  };

  return (
    <div
      className="deck-editor-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-l-lg bg-background"
      onDragOver={editorDragOver}
      onDrop={editorDrop}
    >
      <EditorToolbar
        deck={deck}
        deckId={id}
        deckTitle={deck.title}
        canEdit={canEdit}
        canComment={canComment}
        onTitleChange={(title) => updateDeck(id, { title })}
        currentSlideIndex={currentIndex >= 0 ? currentIndex : 0}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onGenerateImage={() => setImageGenOpen(!imageGenOpen)}
        onOpenAssetLibrary={() => {
          setReplaceImageSrc(null);
          setAssetLibraryOpen(true);
        }}
        onShowHistory={() => setHistoryOpen((open) => !open)}
        historyButtonRef={historyButtonRef}
        currentSlide={currentSlide}
        onAddEmptySlide={canEdit ? handleNewSlideClick : undefined}
        addSlideGenerating={addSlideGenerating}
        onWideContextToolbarSlotChange={setWideContextToolbarSlot}
        activeUsers={slideActiveUsers.filter((u) => u.email !== session?.email)}
        agentPresent={agentPresent}
        agentActive={agentActive}
        commentsOpen={commentsOpen}
        onToggleComments={() =>
          setSidePanel((panel) => (panel === "comments" ? null : "comments"))
        }
        unresolvedCommentCount={unresolvedCommentCount}
        currentUserEmail={session?.email}
        animationsOpen={animationsOpen}
        onToggleAnimations={() => setAnimationsOpen((o) => !o)}
        tweaksOpen={tweaksOpen}
        onToggleTweaks={() => setTweaksOpen((o) => !o)}
        drawMode={drawMode}
        onToggleDrawMode={toggleDrawMode}
        pinMode={pinMode}
        onTogglePinMode={togglePinMode}
        textBoxMode={textBoxMode}
        onToggleTextBoxMode={toggleTextBoxMode}
        onDuplicateDeck={() => {
          const newId = `deck-${nanoid()}`;
          const optimistic = duplicateDeck(id, newId, undefined, () => {
            // The background duplicate-deck action failed after we already
            // navigated to the optimistic copy. If the user is still there,
            // send them back instead of stranding them on a "Deck
            // unavailable" screen for a deck that no longer exists.
            if (deckIdFromPathname(window.location.pathname) === newId) {
              navigate("/");
            }
            toast.error(t("home.duplicateFailed"));
          });
          if (optimistic) navigate(`/deck/${optimistic.id}`);
        }}
        onExportPdf={async () => {
          try {
            const slideIds = deck.slides.map((s) => s.id);
            if (slideIds.length === 0) {
              toast.error(t("deckEditor.exportFailed"), {
                description: t("deckEditor.deckHasNoSlides"),
              });
              return;
            }
            await exportDeckAsPdf(deck.title, slideIds, deck.aspectRatio);
          } catch (err) {
            console.error("[pdf-export] failed:", err);
            toast.error(t("deckEditor.exportFailed"), {
              description:
                err instanceof Error
                  ? err.message
                  : t("deckEditor.pdfRenderFailed"),
            });
          }
        }}
        onExportPptx={async () => {
          const slides = deck.slides.map((s) => ({
            id: s.id,
            notes: s.notes,
          }));
          if (slides.length === 0) {
            throw new Error(t("deckEditor.deckHasNoSlides"));
          }
          await exportDeckAsPptx(deck.title, slides, deck.aspectRatio);
        }}
        onExportGoogleSlides={async () => {
          const slides = deck.slides.map((s) => ({
            id: s.id,
            notes: s.notes,
          }));
          if (slides.length === 0) {
            throw new Error(t("deckEditor.deckHasNoSlides"));
          }
          // Same routing as Export > PowerPoint: Google imports whichever file
          // we upload, so an imported deck's shapes survive only if the server
          // builds it. The server renders the persisted deck, hence the flush.
          if (canExportPptxFromServer(deck)) {
            await flushDeckSave(id);
            return exportDeckToGoogleSlides(
              deck.title,
              slides,
              deck.aspectRatio,
              () =>
                fetchDeckPptxFromServer(id, t("editorExport.exportPptxError")),
            );
          }
          return exportDeckToGoogleSlides(deck.title, slides, deck.aspectRatio);
        }}
        onChangeSlideTransition={
          canEdit && currentSlide
            ? (transition) => updateSlide(id, currentSlide.id, { transition })
            : undefined
        }
      />

      {/* Full-width host for the slide's contextual style toolbar: it spans the
       * slide rail as well as the canvas, matching the deck toolbar above it. */}
      <div
        ref={setContextToolbarSlot}
        data-context-toolbar-host="narrow"
        className="deck-editor-context-toolbar-host deck-editor-context-toolbar-host--narrow shrink-0"
      />

      <div className="deck-editor-workspace relative flex min-h-0 flex-1 overflow-hidden rounded-l-lg bg-background">
        {sidebarOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 bg-black/50 z-30"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute z-[70] h-full min-h-0 md:relative">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <EditorSidebar
                  slides={deck.slides}
                  activeSlideId={currentSlide?.id || ""}
                  deckId={id}
                  deckTitle={deck.title}
                  describeSlideId={describeSlideId}
                  onCloseDescribe={() => setDescribeSlideId(null)}
                  onAwaitAddSlidePersisted={() => flushDeckSave(id)}
                  onRemoveFailedSlide={(slideId) => deleteSlide(id, slideId)}
                  addSlideAgentSubmit={addSlideAgentSubmit}
                  onAddSlideGeneratingChange={(generating, targetSlideId) => {
                    setAddSlideGenerating(generating);
                    setAddSlideTargetId(generating ? targetSlideId : null);
                  }}
                  aiGeneratingSlideId={fillingPlaceholderSlideId}
                  onSelectSlide={(slideId) => {
                    setGeneratingSlideSelected(false);
                    setActiveSlideId(slideId);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  }}
                  readOnly={!canEdit}
                  slidePresence={slidePresence}
                  recentEdits={deckRecentEdits}
                  aspectRatio={deck.aspectRatio}
                  designSystem={designSystem}
                  generatingSlide={
                    generatingSlideVisible
                      ? {
                          index: deck.slides.length,
                        }
                      : undefined
                  }
                  generatingSlideSelected={generatingSlideSelected}
                  onSelectGeneratingSlide={() => {
                    setGeneratingSlideSelected(true);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  }}
                  hasSlideClipboard={hasSlideClipboard}
                  onCutSlide={cutSlide}
                  onCopySlide={copySlide}
                  onPasteSlide={pasteSlideAfter}
                  onDeleteSlide={handleDeleteSlideFromRail}
                  onNewSlideAfter={handleNewSlideAfter}
                  onDuplicateSlide={handleDuplicateSlideFromRail}
                  onToggleSkipSlide={handleToggleSkipSlide}
                />
              </DndContext>
            </div>
          </>
        )}

        {showQuestionFlow && (
          <QuestionFlow
            questions={questionFlowQuestions ?? []}
            onSubmit={handleQuestionSubmit}
            onSkip={handleQuestionSkip}
            designSystem={deck.designSystemId ? designSystem : undefined}
            title={questionFlowTitle}
            description={questionFlowDescription}
            skipLabel={questionFlowSkipLabel}
            submitLabel={questionFlowSubmitLabel}
          />
        )}

        {generatingSlideSelected && generatingSlideVisible && (
          <div className="flex min-h-0 flex-1 overflow-auto bg-[var(--slides-editor-surface)] p-4 md:p-8">
            <div className="m-auto w-full max-w-6xl">
              <GeneratingSlidePreview
                aspectRatio={deck.aspectRatio}
                designSystem={designSystem}
                thumbnail={false}
              />
            </div>
          </div>
        )}

        {!generatingSlideSelected &&
          generatingSlideVisible &&
          deck.slides.length === 0 &&
          !showQuestionFlow && (
            <div className="flex min-h-0 flex-1 overflow-auto bg-[var(--slides-editor-surface)] p-4 md:p-8">
              <div className="m-auto w-full max-w-6xl">
                <GeneratingSlidePreview
                  aspectRatio={deck.aspectRatio}
                  designSystem={designSystem}
                  thumbnail={false}
                />
              </div>
            </div>
          )}

        {showCurrentSlideEditor && currentSlide && (
          <SlideEditor
            slide={currentSlide}
            deckId={id}
            readOnly={!canEdit}
            contextToolbarSlot={contextToolbarSlot}
            wideContextToolbarSlot={wideContextToolbarSlot}
            contextToolbarLeading={
              canEdit ? (
                <EditorActionCluster
                  textBoxMode={textBoxMode}
                  onToggleTextBoxMode={toggleTextBoxMode}
                  onAddEmptySlide={handleNewSlideClick}
                  addSlideGenerating={addSlideGenerating}
                  currentSlideId={currentSlide.id}
                  slideTransition={currentSlide.transition}
                  onChangeSlideTransition={(transition) =>
                    updateSlide(id, currentSlide.id, { transition })
                  }
                />
              ) : undefined
            }
            onUpdateSlide={(updates, slideIdOverride, options) =>
              updateSlide(
                id,
                slideIdOverride ?? currentSlide.id,
                updates,
                options,
              )
            }
            onInlineEditStart={(slideId) => {
              setInlineEditActive(true);
              markDeckDirty(id);
              if (id) markSlideEditingActive(id, slideId);
            }}
            onInlineEditEnd={(slideId) => {
              setInlineEditActive(false);
              if (id) clearSlideEditingActive(id, slideId);
            }}
            onGenerateImage={() => setImageGenOpen(true)}
            onOpenAssetLibrary={(src) => {
              setReplaceImageSrc(src);
              setAssetLibraryOpen(true);
            }}
            onUploadImage={(src) => {
              setReplaceImageSrc(src);
              uploadInputRef.current?.click();
            }}
            onDropImage={uploadAndApplyImage}
            onDropImageUrl={dropImageUrlOnSlide}
            onToggleObjectFit={toggleObjectFit}
            slideIndex={currentIndex >= 0 ? currentIndex : 0}
            designSystem={designSystem}
            aspectRatio={deck.aspectRatio}
            collabUser={
              currentUser
                ? { name: currentUser.name, color: currentUser.color }
                : undefined
            }
            agentActive={
              slideAgentActive ||
              (deckAgentActive && agentSlideId === currentSlide.id) ||
              (isNewDeckGenerating &&
                currentSlide.id === deck.slides[deck.slides.length - 1]?.id)
            }
            recentEdits={deckRecentEdits}
            onComment={(quotedText) => {
              if (!canComment) return;
              setPendingComment({ quotedText });
              setSidePanel("comments");
            }}
            drawMode={drawMode}
            onExitDrawMode={() => setDrawMode(false)}
            pinMode={pinMode}
            onExitPinMode={() => setPinMode(false)}
            textBoxMode={textBoxMode}
            onExitTextBoxMode={() => setTextBoxMode(false)}
            slideId={currentSlide.id}
            slideTitle={(() => {
              const m = currentSlide.content?.match(
                /<h[12][^>]*>([^<]+)<\/h[12]>/i,
              );
              return (
                m?.[1]?.trim() ||
                `Slide ${(currentIndex >= 0 ? currentIndex : 0) + 1}`
              );
            })()}
            presentUsers={slidePresence.get(currentSlide.id) ?? []}
          />
        )}

        {commentsOpen && (
          <SlideCommentsPanel
            deckId={id}
            slideId={currentSlide?.id ?? null}
            canComment={canComment}
            pendingComment={pendingComment}
            onPendingDone={() => setPendingComment(null)}
            onClose={() => {
              setSidePanel(null);
              setPendingComment(null);
            }}
          />
        )}

        {animationsOpen && currentSlide && (
          <AnimationsPanel
            slide={currentSlide}
            onUpdateSlide={(updates) =>
              updateSlide(id, currentSlide.id, updates)
            }
            onClose={() => setAnimationsOpen(false)}
          />
        )}

        {tweaksOpen && (
          <TweaksPanel
            tweaks={getPreset(deck?.designSystemId || "default").tweaks}
            values={deck?.tweaks || {}}
            onChange={(tweakId, value) => {
              updateDeck(id, {
                tweaks: { ...(deck?.tweaks || {}), [tweakId]: value },
              });
            }}
            onClose={() => setTweaksOpen(false)}
          />
        )}
      </div>

      {/* Hidden upload input */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        onChange={handleDirectUpload}
        className="hidden"
      />

      {/* Popovers & Dialogs */}
      <ImageGenPanel
        open={imageGenOpen}
        onOpenChange={setImageGenOpen}
        anchorRef={historyButtonRef}
        referenceImageUrls={imageStyleReferenceUrls}
        slideContext={
          currentSlide
            ? {
                slideId: currentSlide.id,
                slideIndex: currentIndex >= 0 ? currentIndex : 0,
                slideContent: currentSlide.content,
                slideLayout: currentSlide.layout,
                deckId: id,
                deckTitle: deck.title,
              }
            : undefined
        }
      />
      <AssetLibraryPanel
        open={assetLibraryOpen}
        onOpenChange={setAssetLibraryOpen}
        anchorRef={historyButtonRef}
        onSelectAsset={
          replaceImageSrc
            ? (newUrl) => {
                replaceImageInSlide(replaceImageSrc, newUrl);
                setReplaceImageSrc(null);
              }
            : undefined
        }
      />
      <HistoryPanel
        deckId={id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canRestore={canEdit}
        anchorRef={historyButtonRef}
      />

      <AlertDialog open={pendingDeckNavigationWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deckEditor.unsavedChangesTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deckEditor.unsavedChangesDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepEditingAfterNavigationAttempt}>
              {t("deckEditor.keepEditing")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={leaveWithPendingDeckChanges}
            >
              {t("deckEditor.leaveWithoutSaving")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
