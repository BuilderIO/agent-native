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

/** Inline tags allowed inside a "text leaf" element */
const INLINE_TAGS = new Set([
  "SPAN",
  "STRONG",
  "EM",
  "B",
  "I",
  "U",
  "A",
  "BR",
  "CODE",
  "SUB",
  "SUP",
  "MARK",
  "SMALL",
  "S",
]);

/**
 * A "text leaf" is a block-level element whose children are only text nodes
 * or inline elements — i.e. it's safe to make contentEditable without
 * exposing layout containers to editing.
 */
function isTextLeaf(el: HTMLElement): boolean {
  if (!el || el.tagName === "IMG") return false;
  if (el.classList.contains("fmd-img-placeholder")) return false;
  // Must contain some text
  if (!el.textContent?.trim()) return false;
  for (const child of Array.from(el.children)) {
    if (!INLINE_TAGS.has(child.tagName)) return false;
  }
  return true;
}

/** Walk up from target to find the nearest text-leaf ancestor within root. */
function findTextLeaf(
  target: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let el: HTMLElement | null = target;
  while (el && root.contains(el)) {
    if (isTextLeaf(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/** Strip data-builder-id attributes from an HTML string */
function stripBuilderIds(html: string): string {
  return html.replace(/\s*data-builder-id="[^"]*"/g, "");
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
  agentActive,
}: SlideEditorProps) {
  const [isHoveringText, setIsHoveringText] = useState(false);
  const [imageOverlay, setImageOverlay] = useState<{
    rect: DOMRect;
    src: string;
    objectFit: "cover" | "contain";
  } | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Currently-edited text-leaf element (per-element inline editing) */
  const editingElRef = useRef<HTMLElement | null>(null);
  /** Latest onUpdateSlide in a ref so blur handlers always see the current version */
  const onUpdateSlideRef = useRef(onUpdateSlide);
  useEffect(() => {
    onUpdateSlideRef.current = onUpdateSlide;
  }, [onUpdateSlide]);

  /** Exit per-element edit mode, saving changes to slide.content */
  const exitInlineEdit = useCallback(() => {
    const el = editingElRef.current;
    if (!el) return;
    el.contentEditable = "false";
    el.removeAttribute("data-editing-leaf");
    editingElRef.current = null;

    const slideContent = containerRef.current?.querySelector(
      ".slide-content",
    ) as HTMLElement | null;
    if (slideContent) {
      const html = stripBuilderIds(slideContent.innerHTML);
      onUpdateSlideRef.current({ content: html });
    }
  }, []);

  /** Enter per-element edit mode on a text-leaf element */
  const enterInlineEdit = useCallback(
    (el: HTMLElement) => {
      if (editingElRef.current === el) return;
      if (editingElRef.current) exitInlineEdit();

      el.contentEditable = "true";
      el.setAttribute("data-editing-leaf", "true");
      el.focus();
      // Select all text in the element so typing replaces it
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      editingElRef.current = el;
    },
    [exitInlineEdit],
  );

  // Exit edit mode when switching slides
  useEffect(() => {
    if (editingElRef.current) {
      editingElRef.current.contentEditable = "false";
      editingElRef.current.removeAttribute("data-editing-leaf");
      editingElRef.current = null;
    }
  }, [slide.id]);

  // Global keyboard handling while inline-editing a text leaf
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editing = editingElRef.current;
      if (!editing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        exitInlineEdit();
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Enter on a single-line leaf should commit and exit, not break layout
        const isHeading = /^H[1-6]$/.test(editing.tagName);
        if (isHeading || editing.children.length === 0) {
          e.preventDefault();
          exitInlineEdit();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [exitInlineEdit]);

  // Click-outside: exit inline edit mode
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const editing = editingElRef.current;
      if (!editing) return;
      const target = e.target as Node;
      if (editing.contains(target)) return;
      // Clicking another text leaf → let the click handler transition
      exitInlineEdit();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [exitInlineEdit]);

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
      // If currently editing a text leaf, clicks inside it are for the
      // caret — don't select/style-edit.
      if (editingElRef.current?.contains(e.target as Node)) return;

      showImageOverlay(e.target as HTMLElement);

      // Send style-editing postMessage with a unique selector for the clicked element
      const target = e.target as HTMLElement;
      const selector = getBuilderSelector(target);
      if (selector) {
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

      // Per-element inline editing only works for HTML-backed slides
      // (fmd-slide / raw HTML layouts). Markdown-rendered slides would
      // round-trip through React reconciliation and lose content.
      const content = typeof slide.content === "string" ? slide.content : "";
      const isHtmlSlide =
        content.includes('class="fmd-slide"') ||
        ["blank", "section", "statement", "full-image"].includes(slide.layout);
      if (!isHtmlSlide) return;

      // Find the nearest text-leaf ancestor and make just that element editable
      const slideContent = containerRef.current?.querySelector(
        ".slide-content",
      ) as HTMLElement | null;
      if (!slideContent) return;
      const leaf = findTextLeaf(target, slideContent);
      if (!leaf) return;

      e.preventDefault();
      e.stopPropagation();
      enterInlineEdit(leaf);
    },
    [showImageOverlay, enterInlineEdit, slide.content, slide.layout],
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
            <div className="h-full flex items-center justify-center p-2 sm:p-4 md:p-8 bg-[hsl(240,5%,5%)]">
              <div ref={containerRef} className="w-full max-w-4xl">
                <div
                  className="slide-image-clickable relative"
                  onClick={handleSlideClick}
                  onContextMenu={handleSlideContextMenu}
                  onDoubleClick={handleSlideDoubleClick}
                  onMouseEnter={() => setIsHoveringText(true)}
                  onMouseLeave={() => setIsHoveringText(false)}
                >
                  <SlideRenderer
                    slide={slide}
                    className={`shadow-2xl shadow-black/40 ${isHoveringText ? "ring-2 ring-[#609FF8]/60" : ""}`}
                  />
                  {/* Double-click hint */}
                  {isHoveringText && !editingElRef.current && (
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white/40 pointer-events-none select-none bg-black/60 px-2 py-0.5 rounded">
                      Double-click any text to edit
                    </div>
                  )}
                  {agentActive && (
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#a78bfa]/20 border border-[#a78bfa]/40 text-[#a78bfa] text-xs font-medium animate-pulse pointer-events-none">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#a78bfa]" />
                      AI editing
                    </div>
                  )}
                </div>
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
