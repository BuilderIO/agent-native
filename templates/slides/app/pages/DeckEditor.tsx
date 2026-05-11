import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  lazy,
  Suspense,
} from "react";
import {
  useParams,
  Navigate,
  useSearchParams,
  useNavigate,
} from "react-router";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { useDecks } from "@/context/DeckContext";
import type { SlideLayout } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import { shortcutLabel } from "@/lib/utils";
import EditorSidebar from "@/components/editor/EditorSidebar";
import EditorToolbar from "@/components/editor/EditorToolbar";
import SlideEditor from "@/components/editor/SlideEditor";
import ImageGenPanel from "@/components/editor/ImageGenPanel";
import GeneratingOverlay from "@/components/editor/GeneratingOverlay";
import AssetLibraryPanel from "@/components/editor/AssetLibraryPanel";
import ImageSearchPanel from "@/components/editor/ImageSearchPanel";
import LogoSearchPanel from "@/components/editor/LogoSearchPanel";
import HistoryPanel from "@/components/editor/HistoryPanel";
import ImageDropPromptPopover from "@/components/editor/ImageDropPromptPopover";
import { QuestionFlow } from "@/components/editor/QuestionFlow";
import { imageFileLooksSupported } from "@/lib/slide-image-replacement";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import {
  useCollaborativeDoc,
  useSession,
  emailToColor,
  emailToName,
  agentNativePath,
  appBasePath,
  useGuidedQuestionFlow,
} from "@agent-native/core/client";
import { useDeckPresence } from "@/hooks/use-deck-presence";
import { useDeckRole } from "@/hooks/use-deck-role";
import { useSlideComments } from "@/hooks/use-slide-comments";
import { SlideCommentsPanel } from "@/components/comments/SlideCommentsPanel";
import { AnimationsPanel } from "@/components/editor/AnimationsPanel";
import { useDeckDesignSystem } from "@/hooks/use-deck-design-system";
import { TweaksPanel } from "@/components/editor/TweaksPanel";
import { getPreset } from "@/lib/design-systems";
import { exportDeckAsPdf } from "@/lib/export-pdf-client";
import {
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
} from "@/lib/generation-state";
import { replaceImageTargetInSlideHtml } from "@/lib/slide-image-replacement";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { nanoid } from "nanoid";
import { TAB_ID } from "@/lib/tab-id";
const Pinpoint = lazy(() =>
  import("@agent-native/pinpoint/react").then((m) => ({
    default: m.Pinpoint,
  })),
);

export default function DeckEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    getDeck,
    updateDeck,
    updateSlide,
    deleteSlide,
    duplicateSlide,
    duplicateDeck,
    reorderSlides,
    undo,
    redo,
    canUndo,
    canRedo,
    loading,
  } = useDecks();
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const { generating } = useAgentGenerating();
  // Track new-deck-creation intent: set once on mount if ?generating=1.
  // The editor reveals partial slides as soon as the first one lands.
  const wasNewDeckCreation = useRef(searchParams.get("generating") === "1");
  const [activeTab, setActiveTab] = useState<"visual" | "code">("visual");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768,
  );

  // Dialog/popover states
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const [logoSearchOpen, setLogoSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [animationsOpen, setAnimationsOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pendingComment, setPendingComment] = useState<{
    quotedText: string;
  } | null>(null);
  const imageGenButtonRef = useRef<HTMLButtonElement>(null);
  const assetsButtonRef = useRef<HTMLButtonElement>(null);

  // Track which image src to replace
  const [replaceImageSrc, setReplaceImageSrc] = useState<string | null>(null);

  // Hidden file input for direct upload
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Drop-to-prompt popover state. Opens when a user drops an image somewhere
  // other than an existing image/placeholder on the slide — so we ask "what
  // should we do with this?" and hand the image off to the agent chat instead
  // of guessing (or worse, letting the browser navigate to the file).
  const [imageDropPopover, setImageDropPopover] = useState<{
    open: boolean;
    file: File | null;
    position: { x: number; y: number } | null;
  }>({ open: false, file: null, position: null });
  const closeImageDropPopover = useCallback(() => {
    setImageDropPopover({ open: false, file: null, position: null });
  }, []);

  const deck = getDeck(id || "");
  const slideCount = deck?.slides.length ?? 0;
  // Mirror Google Slides: viewers see the editor shell with edit affordances
  // disabled (rather than a separate "viewer" route). Owners/Editors/Admins
  // get the full editor.
  const { canEdit } = useDeckRole(id);
  const isNewDeckGenerating = shouldShowNewDeckGeneratingOverlay({
    generating,
    isNewDeckCreation: wasNewDeckCreation.current,
    slideCount,
  });
  const { designSystem, designSystemTitle } = useDeckDesignSystem(
    deck?.designSystemId,
  );

  const {
    questions: questionFlowQuestions,
    title: questionFlowTitle,
    description: questionFlowDescription,
    skipLabel: questionFlowSkipLabel,
    submitLabel: questionFlowSubmitLabel,
    handleSubmit: handleQuestionSubmit,
    handleSkip: handleQuestionSkip,
  } = useGuidedQuestionFlow({
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
        "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels). Keep each slide within the density limits in AGENTS.md; split dense source material across more slides instead of packing it tightly.",
        "",
        `Now generate the slides based on these preferences. Start a manage-progress run, add the first slide as soon as it is ready, then continue one slide at a time so the editor visibly fills in. Use add-slide with --deckId=${id} to add slides sequentially. Wait for each add-slide result before calling it again.`,
      ].join("\n"),
    buildSkipContext: () =>
      `The user skipped the pre-generation questions for deck ${id}. Proceed with reasonable defaults. Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels); keep each slide within the density limits in AGENTS.md and split dense source material across more slides instead of packing it tightly. Start a manage-progress run, add the first slide as soon as it is ready, then continue sequentially using add-slide with --deckId=${id}. Wait for each add-slide result before calling it again.`,
  });

  const showQuestionFlow = Boolean(questionFlowQuestions?.length);

  // Clean up the generating URL param/ref when generation completes or when
  // the first slide lands, so partial progress is visible during long decks.
  useEffect(() => {
    if (!shouldClearNewDeckGeneratingState({ generating, slideCount })) {
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
  }, [generating, searchParams, setSearchParams, slideCount]);

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

  const uploadImageAsset = useCallback(async (file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${appBasePath()}/api/assets/upload`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) {
      throw new Error(data?.error || "Image upload failed");
    }
    return data.url as string;
  }, []);

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
      // When there's no concrete target (drop landed on slide whitespace, the
      // canvas, or the editor chrome), defer to the user: open the popover so
      // they can tell the agent what to do with the image. The agent can then
      // decide which slide / placeholder / element to update, generate a
      // matching layout, or add a new slide.
      if (!replaceSrc) {
        setImageDropPopover({
          open: true,
          file,
          position: position ?? null,
        });
        return;
      }
      const targetSlide = currentSlideRef.current;
      try {
        const newUrl = await uploadImageAsset(file);
        const updatedContent = replaceImageTargetInSlideHtml(
          targetSlide.content,
          replaceSrc,
          newUrl,
          { alt: file.name },
        );
        if (updatedContent !== targetSlide.content) {
          updateSlide(id, targetSlide.id, { content: updatedContent });
        }
        toast({
          title: "Image added",
          description: file.name,
        });
      } catch (error) {
        toast({
          title: "Image upload failed",
          description:
            error instanceof Error
              ? error.message
              : "Something went wrong uploading this image.",
          variant: "destructive",
        });
      }
    },
    [id, updateSlide, uploadImageAsset],
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
      const t = toast({
        title: `${slideTitle} deleted`,
        description: `Press ${shortcutLabel("cmd+z")} or click Undo to restore.`,
        action: (
          <ToastAction
            altText="Undo delete"
            data-undo-button
            onClick={() => {
              undo();
              t.dismiss();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
      // Auto-dismiss after 6 seconds (shadcn toast's TOAST_REMOVE_DELAY is
      // intentionally enormous, so we trigger it manually).
      setTimeout(() => t.dismiss(), 6000);
    },
    [deck, deleteSlide, undo],
  );

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

  // Resolve the active slide from URL/deck state. Imports replace slide IDs, so
  // keep this valid after deck contents change instead of only on first load.
  // Track the last URL ?slide param we processed so we can tell "the URL changed
  // externally" (agent navigate command, browser back/forward, deep link) apart
  // from "the URL is the same as last render, just other state moved". Without
  // this, the resolver short-circuited on external URL changes and the agent's
  // navigate --slideIndex was effectively ignored.
  const lastUrlSlideParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deck) return;
    if (deck.slides.length === 0) {
      if (activeSlideId) setActiveSlideId(null);
      lastUrlSlideParamRef.current = null;
      return;
    }

    const slideParam = searchParams.get("slide");
    const urlChanged = slideParam !== lastUrlSlideParamRef.current;
    lastUrlSlideParamRef.current = slideParam;

    if (urlChanged && slideParam) {
      const idx = parseInt(slideParam, 10) - 1;
      if (idx >= 0 && idx < deck.slides.length) {
        const targetId = deck.slides[idx].id;
        if (activeSlideId !== targetId) setActiveSlideId(targetId);
        return;
      }
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
  const { session } = useSession();
  const currentUser = session?.email
    ? {
        email: session.email,
        name: emailToName(session.email),
        color: emailToColor(session.email),
      }
    : undefined;

  // Slide-level collab: one Yjs doc per slide.
  // Uses activeSlideId (state) so it's stable before deck loads.
  // useCollaborativeDoc handles null docId gracefully (returns empty state).
  const slideDocId =
    id && activeSlideId ? `deck-${id}-slide-${activeSlideId}` : null;
  const {
    ydoc,
    awareness,
    activeUsers: slideActiveUsers,
    agentActive,
    agentPresent,
  } = useCollaborativeDoc({
    docId: slideDocId,
    requestSource: TAB_ID,
    user: currentUser,
  });

  // Deck-level presence: tracks which slide each user is viewing
  const { slidePresence } = useDeckPresence({
    deckId: id ?? null,
    activeSlideId: activeSlideId,
    user: currentUser,
  });

  // Comments for the current slide (for badge count)
  const { data: currentSlideThreads = [] } = useSlideComments(
    id ?? null,
    activeSlideId,
  );
  const unresolvedCommentCount = currentSlideThreads.filter(
    (t) => !t.resolved,
  ).length;

  if (loading) return <div className="h-screen bg-background" />;
  if (!deck || !id) return <Navigate to="/" replace />;

  const currentSlide =
    deck.slides.find((s) => s.id === activeSlideId) || deck.slides[0];
  const currentIndex = deck.slides.findIndex((s) => s.id === currentSlide?.id);
  currentSlideRef.current = currentSlide;

  // Editor-wide drag-and-drop catch-all. SlideEditor's own drop handler runs
  // first for drops landing on a slide (it calls stopPropagation), so this
  // only fires for drops that landed in the surrounding chrome — sidebar,
  // toolbar, deck thumbnails, or empty space. Without this, the browser's
  // default kicks in and navigates to the dropped image file, which
  // surprises users who expect drop-to-attach behavior everywhere.
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
    setImageDropPopover({
      open: true,
      file,
      position: { x: e.clientX, y: e.clientY },
    });
  };
  const contextHintForDrop = currentSlide
    ? `Current slide: ${currentSlide.id} (index ${currentIndex >= 0 ? currentIndex : 0}). Deck: ${id}.`
    : `Deck: ${id}.`;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-background"
      onDragOver={editorDragOver}
      onDrop={editorDrop}
    >
      <EditorToolbar
        deck={deck}
        deckId={id}
        deckTitle={deck.title}
        canEdit={canEdit}
        onTitleChange={(title) => updateDeck(id, { title })}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        slideCount={deck.slides.length}
        currentSlideIndex={currentIndex >= 0 ? currentIndex : 0}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onGenerateImage={() => setImageGenOpen(!imageGenOpen)}
        onOpenAssetLibrary={() => {
          setReplaceImageSrc(null);
          setAssetLibraryOpen(true);
        }}
        imageGenButtonRef={imageGenButtonRef}
        assetsButtonRef={assetsButtonRef}
        historyOpen={historyOpen}
        onShowHistory={() => setHistoryOpen(!historyOpen)}
        historyButtonRef={historyButtonRef}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        currentSlide={currentSlide}
        onUpdateSlide={(updates) =>
          currentSlide && updateSlide(id, currentSlide.id, updates)
        }
        activeUsers={slideActiveUsers.filter((u) => u.email !== session?.email)}
        agentPresent={agentPresent}
        agentActive={agentActive}
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((o) => !o)}
        unresolvedCommentCount={unresolvedCommentCount}
        currentUserEmail={session?.email}
        animationsOpen={animationsOpen}
        onToggleAnimations={() => setAnimationsOpen((o) => !o)}
        tweaksOpen={tweaksOpen}
        onToggleTweaks={() => setTweaksOpen((o) => !o)}
        drawMode={drawMode}
        onToggleDrawMode={() => setDrawMode((v) => !v)}
        pinMode={pinMode}
        onTogglePinMode={() => setPinMode((v) => !v)}
        onDuplicateDeck={() => {
          const newId = `deck-${nanoid()}`;
          const optimistic = duplicateDeck(id, newId);
          if (optimistic) navigate(`/deck/${optimistic.id}`);
        }}
        onExportPdf={async () => {
          try {
            const slideIds = deck.slides.map((s) => s.id);
            if (slideIds.length === 0) {
              toast({
                title: "Export failed",
                description: "Deck has no slides.",
                variant: "destructive",
              });
              return;
            }
            await exportDeckAsPdf(deck.title, slideIds, deck.aspectRatio);
          } catch (err) {
            console.error("[pdf-export] failed:", err);
            toast({
              title: "Export failed",
              description:
                err instanceof Error ? err.message : "Could not render PDF.",
              variant: "destructive",
            });
          }
        }}
        aspectRatio={deck.aspectRatio}
        designSystemTitle={designSystemTitle}
        onSetAspectRatio={(ratio: AspectRatio) => {
          const previous = deck.aspectRatio;
          // Optimistic UI: update local cache immediately so canvas resizes.
          updateDeck(id, { aspectRatio: ratio });
          fetch(
            agentNativePath("/_agent-native/actions/update-deck-aspect-ratio"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deckId: id, aspectRatio: ratio }),
            },
          ).catch((err) => {
            console.error("Failed to set aspect ratio:", err);
            updateDeck(id, { aspectRatio: previous });
          });
        }}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {sidebarOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 bg-black/50 z-30"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute md:relative z-40 h-full">
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
                  onSelectSlide={(slideId) => {
                    setActiveSlideId(slideId);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  }}
                  onDuplicateSlide={(slideId) => duplicateSlide(id, slideId)}
                  onDeleteSlide={(slideId) => {
                    const idx = deck.slides.findIndex((s) => s.id === slideId);
                    const nextSlide =
                      deck.slides[idx + 1] || deck.slides[idx - 1];
                    deleteSlideWithUndo(id, slideId);
                    if (nextSlide) setActiveSlideId(nextSlide.id);
                  }}
                  slidePresence={slidePresence}
                  aspectRatio={deck.aspectRatio}
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

        {isNewDeckGenerating &&
          deck.slides.length === 0 &&
          !showQuestionFlow && <GeneratingOverlay />}

        {isNewDeckGenerating && deck.slides.length > 0 && !showQuestionFlow && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border border-border bg-popover/95 px-3 py-2 text-sm text-popover-foreground shadow-lg backdrop-blur">
            <span className="font-medium">Building deck</span>
            <span className="ml-2 text-muted-foreground">
              {deck.slides.length} slide{deck.slides.length === 1 ? "" : "s"}{" "}
              added
            </span>
          </div>
        )}

        {!(isNewDeckGenerating && deck.slides.length === 0) &&
          !showQuestionFlow &&
          currentSlide && (
            <SlideEditor
              slide={currentSlide}
              deckId={id}
              readOnly={!canEdit}
              onUpdateSlide={(updates) =>
                updateSlide(id, currentSlide.id, updates)
              }
              activeTab={activeTab}
              onGenerateImage={() => setImageGenOpen(true)}
              onOpenAssetLibrary={(src) => {
                setReplaceImageSrc(src);
                setAssetLibraryOpen(true);
              }}
              onUploadImage={(src) => {
                setReplaceImageSrc(src);
                uploadInputRef.current?.click();
              }}
              onSearchImage={(src) => {
                setReplaceImageSrc(src);
                setImageSearchOpen(true);
              }}
              onLogoSearch={(src) => {
                setReplaceImageSrc(src);
                setLogoSearchOpen(true);
              }}
              onDropImage={uploadAndApplyImage}
              onToggleObjectFit={toggleObjectFit}
              slideIndex={currentIndex >= 0 ? currentIndex : 0}
              slideCount={deck.slides.length}
              designSystem={designSystem}
              aspectRatio={deck.aspectRatio}
              ydoc={ydoc}
              awareness={awareness}
              collabUser={
                currentUser
                  ? { name: currentUser.name, color: currentUser.color }
                  : undefined
              }
              agentActive={agentActive}
              onComment={(quotedText) => {
                setPendingComment({ quotedText });
                setCommentsOpen(true);
              }}
              drawMode={drawMode}
              onExitDrawMode={() => setDrawMode(false)}
              pinMode={pinMode}
              onExitPinMode={() => setPinMode(false)}
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
            />
          )}

        {commentsOpen && (
          <SlideCommentsPanel
            deckId={id}
            slideId={currentSlide?.id ?? null}
            pendingComment={pendingComment}
            onPendingDone={() => setPendingComment(null)}
            onClose={() => {
              setCommentsOpen(false);
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

        <Suspense>
          <Pinpoint
            author={session?.email || "anonymous"}
            colorScheme="dark"
            compactPopup
          />
        </Suspense>
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
        anchorRef={imageGenButtonRef}
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
        anchorRef={assetsButtonRef}
        onSelectAsset={
          replaceImageSrc
            ? (newUrl) => {
                replaceImageInSlide(replaceImageSrc, newUrl);
                setReplaceImageSrc(null);
              }
            : undefined
        }
      />
      <ImageSearchPanel
        open={imageSearchOpen}
        onOpenChange={setImageSearchOpen}
        onSelectImage={
          replaceImageSrc
            ? (newUrl) => {
                replaceImageInSlide(replaceImageSrc, newUrl);
                setReplaceImageSrc(null);
              }
            : undefined
        }
      />
      <LogoSearchPanel
        open={logoSearchOpen}
        onOpenChange={setLogoSearchOpen}
        onSelectLogo={
          replaceImageSrc
            ? (newUrl) => {
                replaceImageInSlide(replaceImageSrc, newUrl);
                setReplaceImageSrc(null);
              }
            : undefined
        }
      />
      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        anchorRef={historyButtonRef}
      />
      <ImageDropPromptPopover
        open={imageDropPopover.open}
        file={imageDropPopover.file}
        position={imageDropPopover.position}
        contextHint={contextHintForDrop}
        onClose={closeImageDropPopover}
      />
    </div>
  );
}
