import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { agentChat } from "@agent-native/core";
import { AgentPresenceChip } from "@agent-native/core/client";
import { createPortal } from "react-dom";
import { enterSelectionMode } from "@/root";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import SlideRenderer from "@/components/deck/SlideRenderer";
import CodeEditor from "./CodeEditor";
import ImageOverlay from "./ImageOverlay";
import { ExcalidrawSlide } from "@/components/deck/ExcalidrawSlide";
import { BlockBubbleMenu } from "./BlockBubbleMenu";
import { SpeakerNotesPanel } from "./SpeakerNotesPanel";
import type { DesignSystemData } from "../../../shared/api";
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
  "FONT",
]);

/** Block tags that can hold rich multi-paragraph content */
const RICH_BLOCK_TAGS = new Set(["P", "DIV", "BLOCKQUOTE", "LI", "UL", "OL"]);

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

/**
 * A "smart group" is a container whose children are all text leaves OR
 * nested smart groups — i.e. a container that exists purely to hold text
 * chunks with no images / layout islands mixed in. These are safe to edit
 * as a single contentEditable region so users can work with multiple
 * chunks (bullet rows, stat pairs, bodies of paragraphs) at once.
 */
function isSmartGroup(el: HTMLElement): boolean {
  if (!el) return false;
  if (el.tagName === "IMG") return false;
  if (el.classList.contains("fmd-img-placeholder")) return false;
  const children = Array.from(el.children);
  if (children.length < 2) return false;
  // Must contain some text overall
  if (!el.textContent?.trim()) return false;
  for (const child of children) {
    const c = child as HTMLElement;
    if (c.tagName === "IMG") return false;
    if (c.classList.contains("fmd-img-placeholder")) return false;
    if (!isTextLeaf(c) && !isSmartGroup(c)) return false;
  }
  return true;
}

/**
 * Find the "smart block" to edit for a given click target. A smart block is
 * either:
 *   - a text leaf (single line / single rich text block), or
 *   - a smart group that is itself inside the top-level fmd-slide wrapper —
 *     i.e. a logical grouping of text chunks (a bullet list, a pair of
 *     stat number + label, etc.).
 *
 * We walk up from the click target and prefer the DEEPEST meaningful block
 * so each double-click targets the most specific editable region. Users who
 * want to edit multiple chunks together can double-click the whitespace
 * between them, or double-click a group's border — the click will resolve
 * to the group element rather than any single child.
 */
function findSmartBlock(
  target: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let el: HTMLElement | null = target;
  while (el && root.contains(el)) {
    if (isTextLeaf(el)) return el;
    // The click landed on a container (e.g. a flex wrapper around stat
    // rows). If that container is a smart group, use IT as the block so
    // the user gets multi-chunk editing of everything inside.
    if (isSmartGroup(el)) return el;
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
  /** Zero-based index of the current slide */
  slideIndex?: number;
  /** Total number of slides in the deck */
  slideCount?: number;
  /** Design system to inject as CSS custom properties on the slide */
  designSystem?: DesignSystemData;
  /** Deck aspect ratio (defaults to 16:9 when omitted) */
  aspectRatio?: AspectRatio;
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
  slideIndex = 0,
  slideCount = 1,
  designSystem,
  aspectRatio,
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
  /** Currently-edited smart block (leaf or group). State, not ref, so menu re-renders. */
  const [editingEl, setEditingEl] = useState<HTMLElement | null>(null);
  /** Latest onUpdateSlide in a ref so blur handlers always see the current version */
  const onUpdateSlideRef = useRef(onUpdateSlide);
  useEffect(() => {
    onUpdateSlideRef.current = onUpdateSlide;
  }, [onUpdateSlide]);

  /** Exit edit mode, saving changes to slide.content */
  const exitInlineEdit = useCallback(() => {
    setEditingEl((el) => {
      if (!el) return null;
      el.contentEditable = "false";
      el.removeAttribute("data-editing-block");

      const slideContent = containerRef.current?.querySelector(
        ".slide-content",
      ) as HTMLElement | null;
      if (slideContent) {
        const html = stripBuilderIds(slideContent.innerHTML);
        onUpdateSlideRef.current({ content: html });
      }
      return null;
    });
  }, []);

  /** Save the current slide content without exiting edit mode (called from bubble menu). */
  const saveBlockContent = useCallback(() => {
    const slideContent = containerRef.current?.querySelector(
      ".slide-content",
    ) as HTMLElement | null;
    if (!slideContent) return;
    const html = stripBuilderIds(slideContent.innerHTML);
    onUpdateSlideRef.current({ content: html });
  }, []);

  /** Enter edit mode on a smart block (text leaf or smart group) */
  const enterInlineEdit = useCallback((el: HTMLElement) => {
    el.contentEditable = "true";
    el.setAttribute("data-editing-block", "true");
    el.focus();
    // If the block is a simple text leaf, pre-select its content so typing
    // replaces it. For smart groups (bullet lists, etc.) don't select all —
    // the user usually wants to edit just one part, so we place the caret
    // at the click location instead (which contentEditable does by default).
    const isSimpleLeaf =
      isTextLeaf(el) && el.children.length === 0 && !!el.textContent?.trim();
    if (isSimpleLeaf) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    setEditingEl(el);
  }, []);

  // Exit edit mode when switching slides — save pending content first so
  // typing isn't lost when the user clicks a different slide in the sidebar.
  useEffect(() => {
    setEditingEl((el) => {
      if (el) {
        el.contentEditable = "false";
        el.removeAttribute("data-editing-block");
        // Save whatever was typed before the slide switched.
        const slideContent = containerRef.current?.querySelector(
          ".slide-content",
        ) as HTMLElement | null;
        if (slideContent) {
          const html = stripBuilderIds(slideContent.innerHTML);
          onUpdateSlideRef.current({ content: html });
        }
      }
      return null;
    });
  }, [slide.id]);

  // Global keyboard handling while inline-editing
  useEffect(() => {
    if (!editingEl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        exitInlineEdit();
        return;
      }
      if (e.key === "Enter") {
        // Smart Enter:
        //  - Shift+Enter always inserts a <br>.
        //  - A single <p> or <div> leaf is multi-line capable — Enter
        //    creates a new line via contentEditable's default behavior.
        //  - Headings, inline leaves, and smart groups commit on Enter
        //    so the slide layout can never be broken by a stray new node.
        if (e.shiftKey) return;

        const isSimpleLeaf = isTextLeaf(editingEl);
        const isMultiLineLeaf =
          isSimpleLeaf && RICH_BLOCK_TAGS.has(editingEl.tagName);

        if (!isMultiLineLeaf) {
          e.preventDefault();
          exitInlineEdit();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [exitInlineEdit, editingEl]);

  // Click-outside: exit inline edit mode
  useEffect(() => {
    if (!editingEl) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (editingEl.contains(target)) return;
      // Ignore clicks on the bubble menu (it lives in a portal)
      if ((target as HTMLElement).closest?.("[data-block-bubble-menu]")) return;
      exitInlineEdit();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [exitInlineEdit, editingEl]);

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
      // If currently editing a block, clicks inside it are for the caret —
      // don't select/style-edit.
      if (editingEl?.contains(e.target as Node)) return;

      showImageOverlay(e.target as HTMLElement);

      // Send style-editing postMessage with a unique selector for the clicked element
      const target = e.target as HTMLElement;
      const selector = getBuilderSelector(target);
      if (selector) {
        enterSelectionMode("builder.enterStyleEditing", { selector });
      }
    },
    [showImageOverlay, editingEl],
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

      // Per-block inline editing only works for HTML-backed slides
      // (fmd-slide / raw HTML layouts). Markdown-rendered slides would
      // round-trip through React reconciliation and lose content.
      const content = typeof slide.content === "string" ? slide.content : "";
      const isHtmlSlide =
        content.includes('class="fmd-slide"') ||
        ["blank", "section", "statement", "full-image"].includes(slide.layout);
      if (!isHtmlSlide) return;

      // Find the nearest smart block (leaf OR group of leaves) and edit it.
      const slideContent = containerRef.current?.querySelector(
        ".slide-content",
      ) as HTMLElement | null;
      if (!slideContent) return;
      const block = findSmartBlock(target, slideContent);
      if (!block) return;

      e.preventDefault();
      e.stopPropagation();
      enterInlineEdit(block);
    },
    [showImageOverlay, enterInlineEdit, slide.content, slide.layout],
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {activeTab === "visual" ? (
          slide.excalidrawData ? (
            <div className="h-full bg-muted">
              <ExcalidrawSlide
                initialData={slide.excalidrawData}
                onChange={(data) => onUpdateSlide({ excalidrawData: data })}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-2 sm:p-4 md:p-8 bg-muted">
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
                    designSystem={designSystem}
                    aspectRatio={aspectRatio}
                  />
                  {/* Double-click hint */}
                  {isHoveringText && !editingEl && (
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white/40 pointer-events-none select-none bg-black/60 px-2 py-0.5 rounded">
                      Double-click any text to edit
                    </div>
                  )}
                  {agentActive && (
                    <div className="absolute top-2 right-2 z-10 pointer-events-none">
                      <AgentPresenceChip active={agentActive} />
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

      {activeTab === "visual" && (
        <SpeakerNotesPanel
          notes={slide.notes}
          onChange={(notes) => onUpdateSlide({ notes })}
          slideIndex={slideIndex}
          slideCount={slideCount}
        />
      )}

      {selectionRect && <ImageSelectionOutline rect={selectionRect} />}

      <BlockBubbleMenu editingEl={editingEl} onChange={saveBlockContent} />

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
