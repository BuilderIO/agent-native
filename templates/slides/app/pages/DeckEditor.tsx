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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDecks } from "@/context/DeckContext";
import type { SlideLayout } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import EditorSidebar from "@/components/editor/EditorSidebar";
import EditorToolbar from "@/components/editor/EditorToolbar";
import SlideEditor from "@/components/editor/SlideEditor";
import ImageGenPanel from "@/components/editor/ImageGenPanel";
import GeneratingOverlay from "@/components/editor/GeneratingOverlay";
import AssetLibraryPanel from "@/components/editor/AssetLibraryPanel";
import ImageSearchPanel from "@/components/editor/ImageSearchPanel";
import LogoSearchPanel from "@/components/editor/LogoSearchPanel";
import HistoryPanel from "@/components/editor/HistoryPanel";
import { QuestionFlow } from "@/components/editor/QuestionFlow";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import {
  useCollaborativeDoc,
  useSession,
  emailToColor,
  emailToName,
  sendToAgentChat,
} from "@agent-native/core/client";
import type { QuestionFlowQuestion } from "@shared/api";
import { useDeckPresence } from "@/hooks/use-deck-presence";
import { useSlideComments } from "@/hooks/use-slide-comments";
import { SlideCommentsPanel } from "@/components/comments/SlideCommentsPanel";
import { AnimationsPanel } from "@/components/editor/AnimationsPanel";
import { useDeckDesignSystem } from "@/hooks/use-deck-design-system";
import { TweaksPanel } from "@/components/editor/TweaksPanel";
import { getPreset } from "@/lib/design-systems";
import { exportDeckAsPdf } from "@/lib/export-pdf-client";
import { toast } from "@/hooks/use-toast";
const Pinpoint = lazy(() =>
  import("@agent-native/pinpoint/react").then((m) => ({
    default: m.Pinpoint,
  })),
);

// Stable tab ID for jitter prevention (module-level = never recreated)
const COLLAB_TAB_ID = `slides-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function DeckEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    getDeck,
    updateDeck,
    updateSlide,
    deleteSlide,
    duplicateSlide,
    reorderSlides,
    undo,
    redo,
    canUndo,
    canRedo,
    loading,
  } = useDecks();
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const { generating } = useAgentGenerating();
  // Track new-deck-creation intent: set once on mount if ?generating=1, cleared when done
  const wasNewDeckCreation = useRef(searchParams.get("generating") === "1");
  const isNewDeckGenerating = generating && wasNewDeckCreation.current;
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
  const [pendingComment, setPendingComment] = useState<{
    quotedText: string;
  } | null>(null);
  const imageGenButtonRef = useRef<HTMLButtonElement>(null);
  const assetsButtonRef = useRef<HTMLButtonElement>(null);

  // Track which image src to replace
  const [replaceImageSrc, setReplaceImageSrc] = useState<string | null>(null);

  // Hidden file input for direct upload
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const deck = getDeck(id || "");
  const { designSystem } = useDeckDesignSystem(deck?.designSystemId);

  // Poll for question flow from agent (show-questions application state)
  const { data: questionFlowData } = useQuery<{
    questions: QuestionFlowQuestion[];
  } | null>({
    queryKey: ["show-questions"],
    queryFn: async () => {
      const res = await fetch(
        "/_agent-native/application-state/show-questions",
      );
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
  });

  const showQuestionFlow =
    questionFlowData?.questions && questionFlowData.questions.length > 0;

  const handleQuestionSubmit = useCallback(
    (answers: Record<string, any>) => {
      // Format answers for the agent
      const formatted = Object.entries(answers)
        .map(([key, val]) => {
          if (Array.isArray(val)) return `${key}: ${val.join(", ")}`;
          return `${key}: ${val}`;
        })
        .join("\n");

      const context = [
        "The user answered the pre-generation questions.",
        `Deck ID: ${id}`,
        "",
        "Answers:",
        formatted,
        "",
        "Now generate the slides based on these preferences. Use add-slide with --deckId=" +
          id +
          " to add slides one at a time in parallel.",
      ].join("\n");

      sendToAgentChat({
        message: "Here are my answers — go ahead and create the slides.",
        context,
        submit: true,
      });

      // Clear the question flow state — optimistically clear cache so overlay hides immediately
      queryClient.setQueryData(["show-questions"], null);
      fetch("/_agent-native/application-state/show-questions", {
        method: "DELETE",
      }).catch(() => {});
    },
    [id, queryClient],
  );

  const handleQuestionSkip = useCallback(() => {
    sendToAgentChat({
      message:
        "Skip the questions — just go ahead and create the slides with your best judgment.",
      context: `The user skipped the pre-generation questions for deck ${id}. Proceed with reasonable defaults and generate slides using add-slide with --deckId=${id}.`,
      submit: true,
    });

    // Clear the question flow state — optimistically clear cache so overlay hides immediately
    queryClient.setQueryData(["show-questions"], null);
    fetch("/_agent-native/application-state/show-questions", {
      method: "DELETE",
    }).catch(() => {});
  }, [id, queryClient]);

  // If deck already has slides on mount, it's not a fresh new-deck creation
  useEffect(() => {
    if (deck && deck.slides.length > 0 && wasNewDeckCreation.current) {
      wasNewDeckCreation.current = false;
    }
  }, []); // only on mount

  // Clean up the generating URL param and ref when generation completes
  useEffect(() => {
    if (!generating) {
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

  // Replace an image src in the current slide's HTML content
  const replaceImageInSlide = useCallback(
    (oldSrc: string, newSrc: string) => {
      if (!id || !currentSlideRef.current) return;
      const slide = currentSlideRef.current;
      const updatedContent = slide.content.replace(
        new RegExp(
          `src=["']${oldSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
        ),
        `src="${newSrc}"`,
      );
      if (updatedContent !== slide.content) {
        updateSlide(id, slide.id, { content: updatedContent });
      }
    },
    [id, updateSlide],
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
      const form = new FormData();
      form.append("file", files[0]);
      try {
        const res = await fetch("/api/assets/upload", {
          method: "POST",
          body: form,
        });
        if (res.ok) {
          const data = await res.json();
          replaceImageInSlide(replaceImageSrc, data.url);
        }
      } catch {}
      setReplaceImageSrc(null);
      e.target.value = "";
    },
    [replaceImageSrc, replaceImageInSlide],
  );

  // Delete key deletes the current slide
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!deck || !id || !activeSlideId) return;
      // Don't intercept if user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        if (deck.slides.length <= 1) return; // don't delete last slide
        const idx = deck.slides.findIndex((s) => s.id === activeSlideId);
        const nextSlide = deck.slides[idx + 1] || deck.slides[idx - 1];
        deleteSlide(id, activeSlideId);
        if (nextSlide) setActiveSlideId(nextSlide.id);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deck, id, activeSlideId, deleteSlide]);

  // Resolve initial slide from URL param once deck is available.
  // Always sets activeSlideId so collab docId is never null when a slide is showing.
  useEffect(() => {
    if (!deck || activeSlideId) return;
    const slideParam = searchParams.get("slide");
    if (slideParam) {
      const idx = parseInt(slideParam, 10) - 1;
      if (idx >= 0 && idx < deck.slides.length) {
        setActiveSlideId(deck.slides[idx].id);
        return;
      }
    }
    // No valid slide param — default to first slide
    if (deck.slides.length > 0) {
      setActiveSlideId(deck.slides[0].id);
    }
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
    requestSource: COLLAB_TAB_ID,
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <EditorToolbar
        deck={deck}
        deckId={id}
        deckTitle={deck.title}
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
        onDuplicateDeck={async () => {
          try {
            const res = await fetch("/_agent-native/actions/duplicate-deck", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deckId: id }),
            });
            const data = await res.json();
            if (data.id) {
              navigate(`/deck/${data.id}`);
            }
          } catch (err) {
            console.error("Duplicate failed:", err);
          }
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
        onSetAspectRatio={(ratio: AspectRatio) => {
          const previous = deck.aspectRatio;
          // Optimistic UI: update local cache immediately so canvas resizes.
          updateDeck(id, { aspectRatio: ratio });
          fetch("/_agent-native/actions/update-deck-aspect-ratio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deckId: id, aspectRatio: ratio }),
          }).catch((err) => {
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
                    deleteSlide(id, slideId);
                    const idx = deck.slides.findIndex((s) => s.id === slideId);
                    const nextSlide =
                      deck.slides[idx + 1] || deck.slides[idx - 1];
                    if (nextSlide) setActiveSlideId(nextSlide.id);
                  }}
                  slidePresence={slidePresence}
                  aspectRatio={deck.aspectRatio}
                />
              </DndContext>
            </div>
          </>
        )}

        {isNewDeckGenerating && <GeneratingOverlay />}

        {showQuestionFlow && !isNewDeckGenerating && (
          <QuestionFlow
            questions={questionFlowData!.questions}
            onSubmit={handleQuestionSubmit}
            onSkip={handleQuestionSkip}
          />
        )}

        {!isNewDeckGenerating && !showQuestionFlow && currentSlide && (
          <SlideEditor
            slide={currentSlide}
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
    </div>
  );
}
