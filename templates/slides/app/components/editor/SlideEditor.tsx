import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { agentChat } from "@agent-native/core";
import { createPortal } from "react-dom";
import { enterSelectionMode } from "@/root";
import type { Slide } from "@/context/DeckContext";
import SlideRenderer from "@/components/deck/SlideRenderer";
import CodeEditor from "./CodeEditor";
import ImageOverlay from "./ImageOverlay";
import { ExcalidrawSlide } from "@/components/deck/ExcalidrawSlide";
import { SlideInlineEditor } from "./SlideInlineEditor";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

let builderIdCounter = 0;

/** Stamp all elements inside a container with unique data-builder-id attributes */
function stampBuilderIds(container: HTMLElement) {
  const elements = container.querySelectorAll("*");
  elements.forEach((el) => {
    if (!el.getAttribute("data-builder-id")) {
      el.setAttribute("data-builder-id", `b-${++builderIdCounter}`);
    }
  });
}

/** Get the unique selector for an element using its data-builder-id */
function getBuilderSelector(el: HTMLElement): string | null {
  const id = el.getAttribute("data-builder-id");
  if (id) return `[data-builder-id="${id}"]`;
  return null;
}

interface SlideEditorProps {
  slide: Slide;
  onUpdateSlide: (updates: Partial<Omit<Slide, "id">>) => void;
  activeTab: "visual" | "code";
  onGenerateImage: () => void;
  onOpenAssetLibrary: (replaceSrc: string) => void;
  onUploadImage: (replaceSrc: string) => void;
  onSearchImage: (replaceSrc: string) => void;
  onLogoSearch: (replaceSrc: string) => void;
  onToggleObjectFit: (imgSrc: string, newFit: string) => void;
  /** Yjs document for collaborative editing */
  ydoc?: Y.Doc | null;
  /** Yjs Awareness for cursor/presence sync */
  awareness?: Awareness | null;
  /** Current user display info for cursor caret */
  collabUser?: { name: string; color: string };
  /** True briefly when AI agent is making edits */
  agentActive?: boolean;
  /** Called when the user selects text and clicks the comment button */
  onComment?: (quotedText: string) => void;
}

/** Selection outline rendered over a selected image */
function ImageSelectionOutline({ rect }: { rect: DOMRect }) {
  const pad = 2;
  return createPortal(
    <div
      style={{
        position: "fixed",
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        pointerEvents: "none",
        zIndex: 50,
        border: "2px solid #609FF8",
        borderRadius: 2,
      }}
    />,
    document.body,
  );
}

export default function SlideEditor({
  slide,
  onUpdateSlide,
  activeTab,
  onGenerateImage,
  onOpenAssetLibrary,
  onUploadImage,
  onSearchImage,
  onLogoSearch,
  onToggleObjectFit,
  ydoc,
  awareness,
  collabUser,
  agentActive,
  onComment,
}: SlideEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [imageOverlay, setImageOverlay] = useState<{
    rect: DOMRect;
    src: string;
    objectFit: "cover" | "contain";
  } | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Exit edit mode when switching slides
  useEffect(() => {
    setIsEditing(false);
  }, [slide.id]);

  // Exit edit mode on Escape key
  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEditing]);

  // Keep selection rect in sync with the element (scroll, resize)
  useEffect(() => {
    if (!selectedImg) {
      setSelectionRect(null);
      return;
    }
    const update = () => setSelectionRect(selectedImg.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [selectedImg]);

  // Deselect when clicking outside
  useEffect(() => {
    if (!selectedImg) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".image-overlay-menu")) return;
      if (target.tagName === "IMG" && containerRef.current?.contains(target))
        return;
      setSelectedImg(null);
      setImageOverlay(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectedImg]);

  // Clear selection when slide changes
  useEffect(() => {
    setSelectedImg(null);
    setImageOverlay(null);
  }, [slide.id]);

  // Stamp all elements with data-builder-id after render
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Small delay to ensure SlideRenderer has rendered its content
    const timer = setTimeout(() => {
      const slideContent = container.querySelector(
        ".slide-content",
      ) as HTMLElement;
      if (slideContent) stampBuilderIds(slideContent);
    }, 50);
    return () => clearTimeout(timer);
  }, [slide.id, slide.content]);

  const showImageOverlay = useCallback((target: HTMLElement) => {
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      const src = img.getAttribute("src") || "";
      const fit = (
        window.getComputedStyle(img).objectFit === "contain"
          ? "contain"
          : "cover"
      ) as "cover" | "contain";
      setSelectedImg(img);
      setImageOverlay({ rect, src, objectFit: fit });
      return;
    }
    // Also handle placeholder divs (dashed border boxes meant for images)
    const placeholder = target.closest(
      ".fmd-img-placeholder",
    ) as HTMLElement | null;
    if (placeholder) {
      const rect = placeholder.getBoundingClientRect();
      const src = `placeholder:${placeholder.textContent?.trim() || "image"}`;
      setSelectedImg(placeholder as any);
      setImageOverlay({ rect, src, objectFit: "cover" });
    }
  }, []);

  const handleSlideClick = useCallback(
    (e: React.MouseEvent) => {
      showImageOverlay(e.target as HTMLElement);

      // Send style-editing postMessage with a unique selector for the clicked element
      const target = e.target as HTMLElement;
      const selector = getBuilderSelector(target);
      if (selector) {
        console.log(
          "[SlideEditor] click selector:",
          selector,
          document.querySelector(selector),
        );
        enterSelectionMode("builder.enterStyleEditing", { selector });
      }
    },
    [showImageOverlay],
  );

  const handleSlideContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG" || target.closest(".fmd-img-placeholder")) {
        e.preventDefault();
        showImageOverlay(target);
      }
    },
    [showImageOverlay],
  );

  // --- Pending visual updates ---
  const [pendingUpdateCount, setPendingUpdateCount] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const count = (e as CustomEvent).detail?.count ?? 0;
      setPendingUpdateCount(count);
    };
    window.addEventListener("builder.agentChat.pendingUpdates", handler);
    return () =>
      window.removeEventListener("builder.agentChat.pendingUpdates", handler);
  }, []);

  const handleApplyUpdates = useCallback(() => {
    agentChat.submit("Apply the pending visual updates");
  }, []);

  const handleSlideDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      const target = e.target as HTMLElement;

      // For images / placeholders, show overlay
      if (target.tagName === "IMG" || target.closest(".fmd-img-placeholder")) {
        showImageOverlay(target);
        return;
      }

      // Enter inline text editing mode
      setIsEditing(true);
    },
    [showImageOverlay],
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {activeTab === "visual" ? (
          slide.excalidrawData ? (
            <div className="h-full bg-[hsl(240,5%,5%)]">
              <ExcalidrawSlide
                initialData={slide.excalidrawData}
                onChange={(data) => onUpdateSlide({ excalidrawData: data })}
              />
            </div>
          ) : (
            <div
              className="h-full flex items-center justify-center p-2 sm:p-4 md:p-8 bg-[hsl(240,5%,5%)]"
              onMouseDown={(e) => {
                // Click outside the slide canvas → exit edit mode.
                // But don't exit if clicking on portaled overlays (slash menu,
                // bubble menu) which live in document.body outside containerRef.
                const target = e.target as Element;
                if (
                  isEditing &&
                  containerRef.current &&
                  !containerRef.current.contains(target) &&
                  !target.closest('[data-slash-menu="true"]') &&
                  !target.closest('[data-bubble-menu="true"]')
                ) {
                  setIsEditing(false);
                }
              }}
            >
              <div ref={containerRef} className="w-full max-w-4xl">
                {isEditing ? (
                  <SlideInlineEditor
                    slide={slide}
                    onContentChange={(html) => onUpdateSlide({ content: html })}
                    onExitEdit={() => setIsEditing(false)}
                    ydoc={ydoc}
                    awareness={awareness}
                    collabUser={collabUser}
                    agentActive={agentActive}
                    onComment={onComment}
                  />
                ) : (
                  <div
                    className="slide-image-clickable"
                    onClick={handleSlideClick}
                    onContextMenu={handleSlideContextMenu}
                    onDoubleClick={handleSlideDoubleClick}
                  >
                    <SlideRenderer
                      slide={slide}
                      className="shadow-2xl shadow-black/40"
                    />
                    {/* Double-click hint */}
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white/20 pointer-events-none select-none opacity-0 group-hover:opacity-100">
                      Double-click to edit text
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <CodeEditor slide={slide} onUpdateSlide={onUpdateSlide} />
        )}
      </div>

      {selectionRect && <ImageSelectionOutline rect={selectionRect} />}

      {pendingUpdateCount > 0 && (
        <div className="absolute top-4 right-4 z-50">
          <button
            onClick={handleApplyUpdates}
            className="px-4 py-2 rounded-lg bg-[#609FF8] text-black text-sm font-semibold hover:bg-[#7AB2FA] transition-colors shadow-lg"
          >
            Apply Updates ({pendingUpdateCount})
          </button>
        </div>
      )}

      {imageOverlay && (
        <ImageOverlay
          anchorRect={imageOverlay.rect}
          objectFit={imageOverlay.objectFit}
          onGenerate={onGenerateImage}
          onLibrary={() => onOpenAssetLibrary(imageOverlay.src)}
          onUpload={() => onUploadImage(imageOverlay.src)}
          onSearch={() => onSearchImage(imageOverlay.src)}
          onLogo={() => onLogoSearch(imageOverlay.src)}
          onToggleObjectFit={() => {
            const newFit =
              imageOverlay.objectFit === "cover" ? "contain" : "cover";
            onToggleObjectFit(imageOverlay.src, newFit);
            setImageOverlay({ ...imageOverlay, objectFit: newFit });
          }}
          onClose={() => setImageOverlay(null)}
        />
      )}
    </div>
  );
}
