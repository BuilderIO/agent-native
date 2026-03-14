import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useParams, Navigate, useSearchParams } from "react-router-dom";
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
import EditorSidebar from "@/components/editor/EditorSidebar";
import EditorToolbar from "@/components/editor/EditorToolbar";
import SlideEditor from "@/components/editor/SlideEditor";
import ImageGenPanel from "@/components/editor/ImageGenPanel";
import GeneratingOverlay from "@/components/editor/GeneratingOverlay";
import AssetLibraryPanel from "@/components/editor/AssetLibraryPanel";
import ImageSearchPanel from "@/components/editor/ImageSearchPanel";
import LogoSearchPanel from "@/components/editor/LogoSearchPanel";
import ShareDialog from "@/components/editor/ShareDialog";
import HistoryPanel from "@/components/editor/HistoryPanel";
import { useAgentGenerating } from "@/hooks/use-agent-generating";

export default function DeckEditor() {
  const { id } = useParams<{ id: string }>();
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
    () => window.innerWidth >= 768,
  );

  // Dialog/popover states
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const [logoSearchOpen, setLogoSearchOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const imageGenButtonRef = useRef<HTMLButtonElement>(null);
  const assetsButtonRef = useRef<HTMLButtonElement>(null);

  // Track which image src to replace
  const [replaceImageSrc, setReplaceImageSrc] = useState<string | null>(null);

  // Hidden file input for direct upload
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const deck = getDeck(id || "");

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

  // Resolve initial slide from URL param once deck is available
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

  if (loading) return <div className="h-screen bg-[hsl(240,5%,5%)]" />;
  if (!deck || !id) return <Navigate to="/" replace />;

  const currentSlide =
    deck.slides.find((s) => s.id === activeSlideId) || deck.slides[0];
  const currentIndex = deck.slides.findIndex((s) => s.id === currentSlide?.id);
  currentSlideRef.current = currentSlide;

  return (
    <div className="h-screen flex flex-col bg-[hsl(240,5%,5%)]">
      <EditorToolbar
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
        onShare={() => setShareOpen(true)}
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
                />
              </DndContext>
            </div>
          </>
        )}

        {isNewDeckGenerating && <GeneratingOverlay />}

        {!isNewDeckGenerating && currentSlide && (
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
      {deck && (
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} deck={deck} />
      )}
      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        anchorRef={historyButtonRef}
      />
    </div>
  );
}
