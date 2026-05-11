import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { agentChat } from "@agent-native/core";
import {
  AgentPresenceChip,
  agentNativePath,
  sendToAgentChat,
  usePinchZoom,
} from "@agent-native/core/client";
import { createPortal } from "react-dom";
import { enterSelectionMode } from "@/root";
import type { Slide } from "@/context/DeckContext";
import { getAspectRatioDims, type AspectRatio } from "@/lib/aspect-ratios";
import SlideRenderer from "@/components/deck/SlideRenderer";
import CodeEditor from "./CodeEditor";
import ImageOverlay from "./ImageOverlay";
import { ExcalidrawSlide } from "@/components/deck/ExcalidrawSlide";
import { BlockBubbleMenu } from "./BlockBubbleMenu";
import { SpeakerNotesPanel } from "./SpeakerNotesPanel";
import {
  DrawOverlay,
  CanvasCommentPins,
  MultiSelectChip,
} from "@/components/visual-editor";
import type { DesignSystemData } from "../../../shared/api";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { TAB_ID } from "@/lib/tab-id";
import {
  createPlaceholderImageTarget,
  imageFileLooksSupported,
} from "@/lib/slide-image-replacement";
import {
  IconAlertTriangle,
  IconMaximize,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SlideOverflowInfo } from "@/components/deck/SlideRenderer";

let builderIdCounter = 0;
const CANVAS_ZOOM_PRESETS = [50, 75, 100, 125, 150, 200] as const;

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

/** Strip renderer/editor-only attributes from an HTML string before saving */
function stripBuilderIds(html: string): string {
  let cleaned = html;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(
      `<div data-strip-root>${html}</div>`,
      "text/html",
    );
    for (const wrapper of Array.from(
      doc.querySelectorAll("[data-fmd-autofit-content]"),
    )) {
      const parent = wrapper.parentNode;
      if (!parent) continue;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    }
    cleaned =
      doc.querySelector("[data-strip-root]")?.innerHTML ?? doc.body.innerHTML;
  }

  return cleaned.replace(/\s*data-builder-id="[^"]*"/g, "");
}

interface SlideEditorProps {
  slide: Slide;
  onUpdateSlide: (updates: Partial<Omit<Slide, "id">>) => void;
  /** When true, all inline-edit affordances are disabled — the slide is
   *  navigable but contentEditable / image overlays don't activate.
   *  Mirrors Google Slides' viewer experience. */
  readOnly?: boolean;
  activeTab: "visual" | "code";
  onGenerateImage: () => void;
  onOpenAssetLibrary: (replaceSrc: string) => void;
  onUploadImage: (replaceSrc: string) => void;
  onSearchImage: (replaceSrc: string) => void;
  onLogoSearch: (replaceSrc: string) => void;
  onDropImage?: (
    replaceSrc: string | null,
    file: File,
    position?: { x: number; y: number },
  ) => void;
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
  /** Whether the draw-to-prompt overlay is visible */
  drawMode?: boolean;
  /** Called when the draw overlay should exit (Esc, Send, close button) */
  onExitDrawMode?: () => void;
  /** Whether comment-pin mode is active on the canvas */
  pinMode?: boolean;
  /** Called when pin mode should exit */
  onExitPinMode?: () => void;
  /** Slide id for pin mode contextId — falls back to slide.id if omitted */
  slideId?: string;
  /** Slide title for pin mode contextLabel */
  slideTitle?: string;
  /** Owning deck id — surfaced in the slide-fit-check app-state payload so
   *  `_await-fit-check` can build correct `update-slide --deckId=<id>`
   *  agent retry commands. */
  deckId?: string;
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

/** Outline rendered around a multi-select element */
function MultiSelectOutline({ rect }: { rect: DOMRect }) {
  const pad = 1;
  return createPortal(
    <div
      style={{
        position: "fixed",
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        pointerEvents: "none",
        zIndex: 49,
        border: "2px solid #609FF8",
        borderRadius: 2,
        boxShadow: "0 0 0 1px rgba(96, 159, 248, 0.25)",
      }}
    />,
    document.body,
  );
}

/** Translucent rectangle drawn while marquee-dragging */
function MarqueeRect({
  rect,
}: {
  rect: { x: number; y: number; w: number; h: number };
}) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        top: rect.y,
        left: rect.x,
        width: rect.w,
        height: rect.h,
        pointerEvents: "none",
        zIndex: 48,
        background: "rgba(96, 159, 248, 0.12)",
        border: "1px solid #609FF8",
        borderRadius: 1,
      }}
    />,
    document.body,
  );
}

/** True if two DOMRect-like rectangles intersect */
function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

/**
 * Push the multi-selection to application_state under "selection" so the
 * agent can read it. Empty array clears the key entirely.
 */
function syncSelectionToAppState(
  items: Array<{ selector: string; text: string }>,
) {
  const url = agentNativePath("/_agent-native/application-state/selection");
  if (items.length === 0) {
    fetch(url, {
      method: "DELETE",
      keepalive: true,
      headers: { "X-Request-Source": TAB_ID },
    }).catch(() => {});
    return;
  }
  fetch(url, {
    method: "PUT",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    body: JSON.stringify({ items }),
  }).catch(() => {});
}

/**
 * Push the current slide's vertical-fit measurement to application_state
 * under `slide-fit-check`. Always written, even when the slide fits — the
 * `add-slide` / `update-slide` actions poll this key and use the
 * `measuredAt` timestamp + matching `slideId` to confirm the slide they
 * just wrote has actually been re-rendered and re-measured. If
 * `verticalOverflow > 0`, the action returns an "overflow" message so the
 * agent can patch the slide; if it's 0, the action knows the slide fits.
 *
 * `view-screen` and the editor badge also read this key so the agent can
 * see fit status without browser access of its own.
 */
function syncOverflowToAppState(
  payload: {
    slideId: string;
    deckId?: string;
    contentHeight: number;
    viewportHeight: number;
    verticalOverflow: number;
  } | null,
) {
  const url = agentNativePath(
    "/_agent-native/application-state/slide-fit-check",
  );
  if (!payload) {
    fetch(url, {
      method: "DELETE",
      keepalive: true,
      headers: { "X-Request-Source": TAB_ID },
    }).catch(() => {});
    return;
  }
  fetch(url, {
    method: "PUT",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    body: JSON.stringify({ ...payload, measuredAt: Date.now() }),
  }).catch(() => {});
}

export default function SlideEditor({
  slide,
  onUpdateSlide,
  readOnly = false,
  activeTab,
  onGenerateImage,
  onOpenAssetLibrary,
  onUploadImage,
  onSearchImage,
  onLogoSearch,
  onDropImage,
  onToggleObjectFit,
  agentActive,
  slideIndex = 0,
  slideCount = 1,
  designSystem,
  aspectRatio,
  drawMode,
  onExitDrawMode,
  pinMode,
  onExitPinMode,
  slideId,
  slideTitle,
  deckId,
}: SlideEditorProps) {
  const content = typeof slide.content === "string" ? slide.content : "";
  const isHtmlSlide =
    content.includes('class="fmd-slide"') ||
    ["blank", "section", "statement", "full-image"].includes(slide.layout);

  const [isHoveringText, setIsHoveringText] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [imageOverlay, setImageOverlay] = useState<{
    rect: DOMRect;
    src: string;
    objectFit: "cover" | "contain";
  } | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // --- Multi-select state ---
  /** Set of data-builder-id values currently in the multi-select */
  const [multiSelection, setMultiSelection] = useState<Set<string>>(
    () => new Set(),
  );
  /** Cached client rects + text per selected id (kept in sync on resize/scroll) */
  const [multiSelectionRects, setMultiSelectionRects] = useState<
    Map<string, { rect: DOMRect; text: string; selector: string }>
  >(() => new Map());
  /** Anchor rect for the floating chip (the slide canvas) */
  const [chipAnchorRect, setChipAnchorRect] = useState<DOMRect | null>(null);
  /** Active marquee rectangle (viewport coords). null = not dragging. */
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  /** Vertical overflow for the current slide (0 = fits). Reported by the
   *  renderer so we can prompt the agent to rewrite the slide HTML instead of
   *  silently scaling it down (which created unbalanced right/bottom margins
   *  on slides whose content was too tall for the canvas). */
  const [overflowInfo, setOverflowInfo] = useState<SlideOverflowInfo | null>(
    null,
  );
  const [isAskingAgentToFix, setIsAskingAgentToFix] = useState(false);
  const dims = getAspectRatioDims(aspectRatio);
  const canvasWidth = Math.round(dims.width * (canvasZoom / 100));
  const canvasZoomIn = useCallback(() => {
    const next = CANVAS_ZOOM_PRESETS.find((preset) => preset > canvasZoom);
    setCanvasZoom(next ?? CANVAS_ZOOM_PRESETS[CANVAS_ZOOM_PRESETS.length - 1]);
  }, [canvasZoom]);
  const canvasZoomOut = useCallback(() => {
    const previous = [...CANVAS_ZOOM_PRESETS]
      .reverse()
      .find((preset) => preset < canvasZoom);
    setCanvasZoom(previous ?? CANVAS_ZOOM_PRESETS[0]);
  }, [canvasZoom]);

  usePinchZoom({
    containerRef: scrollContainerRef,
    zoom: canvasZoom,
    setZoom: setCanvasZoom,
    min: 25,
    max: 400,
  });

  // Reset overflow state whenever the slide changes — the renderer will
  // report the next measurement (or stay null if the new slide fits).
  useEffect(() => {
    setOverflowInfo(null);
    setIsAskingAgentToFix(false);
    syncOverflowToAppState(null);
  }, [slide.id, slide.content]);

  // Clear the app-state overflow key when this editor unmounts, so a stale
  // measurement never leaks into a different deck/slide context.
  useEffect(() => {
    return () => {
      syncOverflowToAppState(null);
    };
  }, []);

  const handleOverflowChange = useCallback(
    (info: SlideOverflowInfo) => {
      const overflowing = info.verticalOverflow > 0 ? info : null;
      // Dedup the React state update — the renderer fires on every
      // measurement (so the action can confirm freshness via the app-state
      // `measuredAt` timestamp), but most measurements report the same
      // value and shouldn't churn the badge UI.
      setOverflowInfo((prev) => {
        if (prev?.verticalOverflow === overflowing?.verticalOverflow) {
          return prev;
        }
        return overflowing;
      });
      // Always write the measurement (even when verticalOverflow=0) so the
      // add-slide / update-slide actions can poll for confirmation that the
      // slide they just wrote has been re-rendered and re-measured.
      syncOverflowToAppState({
        slideId: slide.id,
        deckId,
        contentHeight: info.contentHeight,
        viewportHeight: info.viewportHeight,
        verticalOverflow: info.verticalOverflow,
      });
    },
    [slide.id, deckId],
  );

  const handleAskAgentToFixLayout = useCallback(() => {
    if (!overflowInfo || overflowInfo.verticalOverflow <= 0) return;
    const slideHeading = (() => {
      if (typeof document === "undefined") return null;
      const main = document.querySelector("[data-main-slide-canvas]");
      const heading = main?.querySelector("h1, h2, h3, [class*='heading']");
      return heading?.textContent?.trim()?.slice(0, 80) || null;
    })();
    const dimsW = dims.width;
    const dimsH = dims.height;
    setIsAskingAgentToFix(true);
    sendToAgentChat({
      message: [
        `The current slide's content vertically overflows the canvas by ${overflowInfo.verticalOverflow}px and needs to be rewritten to fit.`,
        ``,
        `Slide id: \`${slide.id}\``,
        slideHeading ? `Slide heading: "${slideHeading}"` : null,
        `Canvas size: ${dimsW}x${dimsH}px (16:9 native render).`,
        `Available content area inside the slide's padding: ${overflowInfo.viewportHeight}px tall.`,
        `Natural rendered content height: ${overflowInfo.contentHeight}px → overflows by ${overflowInfo.verticalOverflow}px.`,
        ``,
        `Please use \`view-screen\` to read the current slide HTML, then \`update-slide --fullContent\` to rewrite the slide so its rendered height is at most ${overflowInfo.viewportHeight}px. Options to shrink the layout, in order of preference:`,
        `1. Tighten copy — shorten headings/body, drop low-value bullets, replace prose with terse phrases.`,
        `2. Reduce vertical density — fewer stacked cards, smaller gaps, smaller body font (don't go below 16px), shorter labels.`,
        `3. Reduce slide padding (e.g. 40px top/bottom instead of 60-80px) if the layout is genuinely tight.`,
        `4. If the content really can't be compressed without losing meaning, split it across two slides.`,
        ``,
        `Do NOT solve this by adding \`transform: scale()\`, \`overflow: scroll\`, or absolute positioning — the renderer no longer auto-shrinks overflowing slides, so the HTML itself has to fit ${dimsW}x${dimsH}.`,
      ]
        .filter(Boolean)
        .join("\n"),
      submit: true,
    });
  }, [overflowInfo, slide.id, dims.width, dims.height]);
  /** Marquee origin (viewport coords). Set on pointerdown. */
  const marqueeOriginRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * If the user pressed shift/cmd before starting a marquee, additive mode
   * preserves the existing selection on pointerup.
   */
  const marqueeAdditiveRef = useRef(false);
  /** Selection at marquee start — used for additive mode */
  const marqueePrevSelectionRef = useRef<Set<string>>(new Set());
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

  /** Enter edit mode on a smart block (text leaf or smart group) */
  const enterInlineEdit = useCallback((el: HTMLElement) => {
    el.contentEditable = "true";
    el.setAttribute("data-editing-block", "true");
    // Don't override the selection. The browser's native double-click
    // word-select (or single-click caret) is already on the element from the
    // user's gesture; re-selecting from JS clobbers it. focus() on an
    // element that already contains the selection preserves it in modern
    // browsers, so it's safe to keep for keyboard delivery.
    el.focus({ preventScroll: true });
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
    // Determine "multi-line capable" once at entry time. contentEditable's
    // default Enter behavior inserts block-level children (e.g. <div><br></div>)
    // after a couple of presses, which would otherwise flip isTextLeaf to false
    // mid-edit and incorrectly commit the user out of the block. The user's
    // intent (rich-block edit vs single-line commit) doesn't change while
    // they're editing the same node, so latch it.
    const isMultiLineLeaf =
      isTextLeaf(editingEl) && RICH_BLOCK_TAGS.has(editingEl.tagName);
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

  // --- Multi-select helpers ---

  /** Resolve the slide-content root element (where selectable items live) */
  const getSlideContent = useCallback((): HTMLElement | null => {
    return (
      (containerRef.current?.querySelector(
        ".slide-content",
      ) as HTMLElement | null) || null
    );
  }, []);

  /**
   * Apply a new multi-selection: caches rects + selectors and pushes to
   * application_state. Pass an empty set to clear.
   */
  const applyMultiSelection = useCallback(
    (ids: Set<string>) => {
      const slideContent = getSlideContent();
      const rects = new Map<
        string,
        { rect: DOMRect; text: string; selector: string }
      >();
      const items: Array<{ selector: string; text: string }> = [];
      if (slideContent) {
        ids.forEach((id) => {
          const el = slideContent.querySelector(
            `[data-builder-id="${id}"]`,
          ) as HTMLElement | null;
          if (!el) return;
          const selector = `[data-builder-id="${id}"]`;
          const text = (el.textContent || "").trim().slice(0, 200);
          rects.set(id, { rect: el.getBoundingClientRect(), text, selector });
          items.push({ selector, text });
        });
      }
      setMultiSelection(ids);
      setMultiSelectionRects(rects);
      // Anchor the chip to the slide canvas (clickable wrapper)
      const canvas = containerRef.current?.querySelector(
        ".slide-image-clickable",
      ) as HTMLElement | null;
      setChipAnchorRect(canvas?.getBoundingClientRect() || null);
      syncSelectionToAppState(items);
    },
    [getSlideContent],
  );

  const clearMultiSelection = useCallback(() => {
    if (multiSelection.size === 0) return;
    applyMultiSelection(new Set());
  }, [applyMultiSelection, multiSelection.size]);

  const getPlaceholderTarget = useCallback(
    (placeholder: HTMLElement): string => {
      const slideContent = getSlideContent();
      const placeholders = slideContent
        ? Array.from(
            slideContent.querySelectorAll<HTMLElement>(".fmd-img-placeholder"),
          )
        : [];
      const index = Math.max(0, placeholders.indexOf(placeholder));
      return createPlaceholderImageTarget(
        index,
        placeholder.textContent?.trim() || "image",
      );
    },
    [getSlideContent],
  );

  const getImageReplacementTarget = useCallback(
    (target: HTMLElement): string | null => {
      if (target.tagName === "IMG") {
        return (target as HTMLImageElement).getAttribute("src") || null;
      }
      const placeholder = target.closest(
        ".fmd-img-placeholder",
      ) as HTMLElement | null;
      return placeholder ? getPlaceholderTarget(placeholder) : null;
    },
    [getPlaceholderTarget],
  );

  // Keep cached rects fresh on scroll/resize so outlines + chip stay aligned
  useEffect(() => {
    if (multiSelection.size === 0) return;
    const update = () => {
      const slideContent = getSlideContent();
      if (!slideContent) return;
      const next = new Map<
        string,
        { rect: DOMRect; text: string; selector: string }
      >();
      multiSelection.forEach((id) => {
        const el = slideContent.querySelector(
          `[data-builder-id="${id}"]`,
        ) as HTMLElement | null;
        if (!el) return;
        next.set(id, {
          rect: el.getBoundingClientRect(),
          text: (el.textContent || "").trim().slice(0, 200),
          selector: `[data-builder-id="${id}"]`,
        });
      });
      setMultiSelectionRects(next);
      const canvas = containerRef.current?.querySelector(
        ".slide-image-clickable",
      ) as HTMLElement | null;
      setChipAnchorRect(canvas?.getBoundingClientRect() || null);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [multiSelection, getSlideContent]);

  // Clear multi-selection when slide changes (and clear app state too)
  useEffect(() => {
    setMultiSelection(new Set());
    setMultiSelectionRects(new Map());
    setChipAnchorRect(null);
    syncSelectionToAppState([]);
  }, [slide.id]);

  // Escape key clears multi-selection (only when not inline-editing)
  useEffect(() => {
    if (multiSelection.size === 0) return;
    if (editingEl) return; // Esc handler in editing mode owns this key
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearMultiSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiSelection.size, editingEl, clearMultiSelection]);

  /**
   * Find the nearest meaningful "element" for multi-select from a click target.
   * Walks up to the closest [data-builder-id] inside the slide content. Skips
   * the slide-content root itself (clicking the slide background means
   * "deselect / start marquee", not "select the whole slide").
   */
  const findSelectableId = useCallback(
    (target: HTMLElement, slideContent: HTMLElement): string | null => {
      let el: HTMLElement | null = target;
      while (el && slideContent.contains(el) && el !== slideContent) {
        const id = el.getAttribute("data-builder-id");
        if (id) return id;
        el = el.parentElement;
      }
      return null;
    },
    [],
  );

  /** True if the click is on "whitespace" inside the slide (not on any leaf) */
  const isSlideWhitespaceTarget = useCallback(
    (target: HTMLElement, slideContent: HTMLElement): boolean => {
      // The slide root itself, or a direct child container that has no text /
      // image content at the point of click. Simplest heuristic: target IS
      // the slide-content element, OR it's the .fmd-slide wrapper.
      if (target === slideContent) return true;
      if (target.classList.contains("fmd-slide")) return true;
      return false;
    },
    [],
  );

  // --- Marquee drag handlers (attached to slide-content via React props) ---

  const handleSlidePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editingEl) return; // don't interfere with inline edit
      if (e.button !== 0) return; // left click only
      const slideContent = getSlideContent();
      if (!slideContent) return;
      const target = e.target as HTMLElement;

      // Only start a marquee from "whitespace" inside the slide. Clicks on
      // an actual element fall through to handleSlideClick (which handles
      // shift/cmd-click toggle below).
      if (!isSlideWhitespaceTarget(target, slideContent)) return;

      e.preventDefault();
      marqueeOriginRef.current = { x: e.clientX, y: e.clientY };
      marqueeAdditiveRef.current = e.shiftKey || e.metaKey || e.ctrlKey;
      marqueePrevSelectionRef.current = new Set(multiSelection);
      setMarquee({ x: e.clientX, y: e.clientY, w: 0, h: 0 });

      // Clear single-select feedback when starting a marquee on whitespace
      // (non-additive). Additive marquee preserves the existing selection.
      if (!marqueeAdditiveRef.current && multiSelection.size > 0) {
        applyMultiSelection(new Set());
      }
    },
    [
      editingEl,
      getSlideContent,
      isSlideWhitespaceTarget,
      multiSelection,
      applyMultiSelection,
    ],
  );

  // Window-level pointermove / pointerup so the drag still tracks if the
  // pointer leaves the slide.
  useEffect(() => {
    if (!marquee) return;
    const onMove = (e: PointerEvent) => {
      const origin = marqueeOriginRef.current;
      if (!origin) return;
      const x = Math.min(origin.x, e.clientX);
      const y = Math.min(origin.y, e.clientY);
      const w = Math.abs(e.clientX - origin.x);
      const h = Math.abs(e.clientY - origin.y);
      setMarquee({ x, y, w, h });
    };
    const onUp = () => {
      const origin = marqueeOriginRef.current;
      const current = marquee;
      marqueeOriginRef.current = null;
      setMarquee(null);
      if (!origin || !current) return;

      const slideContent = getSlideContent();
      if (!slideContent) return;

      // Tiny drag = treat as a "click on whitespace" → just clear selection
      // (already handled on pointerdown); do nothing here.
      if (current.w < 4 && current.h < 4) return;

      const marqueeRect = {
        left: current.x,
        top: current.y,
        right: current.x + current.w,
        bottom: current.y + current.h,
      };

      const hits = new Set<string>(
        marqueeAdditiveRef.current ? marqueePrevSelectionRef.current : [],
      );
      const candidates = slideContent.querySelectorAll("[data-builder-id]");
      candidates.forEach((node) => {
        const el = node as HTMLElement;
        const id = el.getAttribute("data-builder-id");
        if (!id) return;
        // Skip the slide-content root itself if it ever got stamped
        if (el === slideContent) return;
        // Don't include containers that have selectable descendants — pick
        // the leaves so the agent gets a precise list, not duplicated parents.
        if (el.querySelector("[data-builder-id]")) return;
        const r = el.getBoundingClientRect();
        if (rectsIntersect(marqueeRect, r)) hits.add(id);
      });

      applyMultiSelection(hits);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [marquee, getSlideContent, applyMultiSelection]);

  /** Send the current selection to the agent chat composer */
  const sendSelectionToAgent = useCallback(() => {
    if (multiSelection.size === 0) return;
    const list = Array.from(multiSelectionRects.values())
      .map((v) => v.selector)
      .join(", ");
    agentChat.prefill(`[Selected: ${list}]\n`);
  }, [multiSelection.size, multiSelectionRects]);

  const showImageOverlay = useCallback(
    (target: HTMLElement) => {
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
        setSelectedImg(placeholder as any);
        setImageOverlay({
          rect,
          src: getPlaceholderTarget(placeholder),
          objectFit: "cover",
        });
      }
    },
    [getPlaceholderTarget],
  );

  const handleSlideDragOver = useCallback((e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files ?? []);
    const items = Array.from(e.dataTransfer.items ?? []);
    const types = Array.from(e.dataTransfer.types ?? []);
    const hasImage =
      types.includes("Files") ||
      files.some(imageFileLooksSupported) ||
      items.some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
    if (!hasImage) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleSlideDrop = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files ?? []);
      const file = files.find(imageFileLooksSupported);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (!file) return;
      onDropImage?.(getImageReplacementTarget(e.target as HTMLElement), file, {
        x: e.clientX,
        y: e.clientY,
      });
    },
    [getImageReplacementTarget, onDropImage],
  );

  const handleSlideClick = useCallback(
    (e: React.MouseEvent) => {
      // If currently editing a block, clicks inside it are for the caret —
      // don't select/style-edit.
      if (editingEl?.contains(e.target as Node)) return;

      const target = e.target as HTMLElement;
      const slideContent = getSlideContent();

      // --- Shift / Cmd / Ctrl click → toggle membership in the multi-selection
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (additive && slideContent) {
        const id = findSelectableId(target, slideContent);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const next = new Set(multiSelection);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        applyMultiSelection(next);
        return;
      }

      // --- Plain click on whitespace → clear multi-selection (the marquee
      // pointerdown already cleared it for non-additive drags, but a click
      // with zero movement won't trigger pointerup with a real rect).
      if (slideContent && isSlideWhitespaceTarget(target, slideContent)) {
        if (multiSelection.size > 0) clearMultiSelection();
        return;
      }

      // --- Plain click on an element → drop multi-selection back to single,
      // then run the existing single-select / style-editing flow.
      if (multiSelection.size > 0) clearMultiSelection();

      showImageOverlay(target);

      // Send style-editing postMessage with a unique selector for the clicked element
      const selector = getBuilderSelector(target);
      if (selector) {
        enterSelectionMode("agentNative.enterStyleEditing", { selector });
      }
    },
    [
      showImageOverlay,
      editingEl,
      getSlideContent,
      findSelectableId,
      isSlideWhitespaceTarget,
      multiSelection,
      applyMultiSelection,
      clearMultiSelection,
    ],
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
      // Viewers see the slide but can't enter edit mode — matches Google
      // Slides' viewer experience.
      if (readOnly) return;

      const target = e.target as HTMLElement;

      // For images / placeholders, show overlay
      if (target.tagName === "IMG" || target.closest(".fmd-img-placeholder")) {
        showImageOverlay(target);
        return;
      }

      // Per-block inline editing only works for HTML-backed slides
      // (fmd-slide / raw HTML layouts). Markdown-rendered slides would
      // round-trip through React reconciliation and lose content.
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
    [showImageOverlay, enterInlineEdit, isHtmlSlide, readOnly],
  );

  const slideElementSelected = !!selectedImg || !!editingEl;

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-slide-element-selected={slideElementSelected ? "true" : undefined}
    >
      <div className="flex-1 overflow-hidden">
        {activeTab === "visual" ? (
          slide.excalidrawData ? (
            <div className="h-full bg-background">
              <ExcalidrawSlide
                initialData={slide.excalidrawData}
                onChange={(data) => onUpdateSlide({ excalidrawData: data })}
              />
            </div>
          ) : (
            <div className="relative h-full bg-background">
              <div className="absolute right-3 top-3 z-20 flex h-8 items-center gap-0.5 rounded-md border border-border bg-popover/95 px-1 shadow-lg backdrop-blur">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 cursor-pointer"
                      onClick={canvasZoomOut}
                      disabled={canvasZoom <= CANVAS_ZOOM_PRESETS[0]}
                      aria-label="Zoom out"
                    >
                      <IconZoomOut className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Zoom out</TooltipContent>
                </Tooltip>
                <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
                  {canvasZoom}%
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 cursor-pointer"
                      onClick={canvasZoomIn}
                      disabled={
                        canvasZoom >=
                        CANVAS_ZOOM_PRESETS[CANVAS_ZOOM_PRESETS.length - 1]
                      }
                      aria-label="Zoom in"
                    >
                      <IconZoomIn className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Zoom in</TooltipContent>
                </Tooltip>
                <div className="mx-0.5 h-4 w-px bg-border" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 cursor-pointer"
                      onClick={() => setCanvasZoom(100)}
                      aria-label="Reset zoom"
                    >
                      <IconMaximize className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset to 100%</TooltipContent>
                </Tooltip>
              </div>
              <div
                ref={scrollContainerRef}
                className={`h-full overflow-auto ${
                  drawMode ? "pb-24 sm:pb-28" : ""
                }`}
              >
                <div className="flex min-h-full w-max min-w-full items-center justify-center p-2 pt-14 sm:p-4 sm:pt-14 md:p-8 md:pt-16">
                  <div
                    ref={containerRef}
                    data-main-slide-canvas="true"
                    className="shrink-0"
                    style={{ width: canvasWidth, maxWidth: canvasWidth }}
                  >
                    <div
                      className="slide-image-clickable relative"
                      onClick={handleSlideClick}
                      onContextMenu={handleSlideContextMenu}
                      onDoubleClick={handleSlideDoubleClick}
                      onPointerDown={handleSlidePointerDown}
                      onDragOver={handleSlideDragOver}
                      onDrop={handleSlideDrop}
                      onMouseEnter={() => setIsHoveringText(true)}
                      onMouseLeave={() => setIsHoveringText(false)}
                    >
                      <SlideRenderer
                        slide={slide}
                        className={`shadow-2xl shadow-black/40 ${isHoveringText ? "ring-2 ring-[#609FF8]/60" : ""}`}
                        designSystem={designSystem}
                        aspectRatio={aspectRatio}
                        onOverflowChange={handleOverflowChange}
                      />
                      {/* Double-click hint — only shown for HTML slides that support inline editing */}
                      {isHoveringText && !editingEl && isHtmlSlide && (
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs text-white/40 pointer-events-none select-none">
                          Double-click any text to edit
                        </div>
                      )}
                      {agentActive && (
                        <div className="absolute top-2 right-2 z-10 pointer-events-none">
                          <AgentPresenceChip active={agentActive} />
                        </div>
                      )}
                      {overflowInfo && !readOnly && !agentActive && (
                        <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 backdrop-blur px-2.5 py-1.5 text-xs text-amber-100 shadow-lg">
                          <IconAlertTriangle
                            className="h-3.5 w-3.5 flex-shrink-0"
                            stroke={2}
                          />
                          <span className="leading-tight">
                            Layout overflows by {overflowInfo.verticalOverflow}
                            px
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-1 h-6 cursor-pointer px-2 text-[11px] font-medium text-amber-100 hover:bg-amber-500/20 hover:text-white"
                            onClick={handleAskAgentToFixLayout}
                            disabled={isAskingAgentToFix}
                          >
                            {isAskingAgentToFix ? "Asking…" : "Fix with AI"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
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

      {/* Multi-select outlines */}
      {Array.from(multiSelectionRects.entries()).map(([id, v]) => (
        <MultiSelectOutline key={id} rect={v.rect} />
      ))}

      {/* Active marquee rectangle */}
      {marquee && (marquee.w > 1 || marquee.h > 1) && (
        <MarqueeRect rect={marquee} />
      )}

      {/* Floating "N selected" chip */}
      <MultiSelectChip
        count={multiSelection.size}
        anchorRect={chipAnchorRect}
        onClear={clearMultiSelection}
        onSendToAgent={sendSelectionToAgent}
      />

      <BlockBubbleMenu editingEl={editingEl} />

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

      <DrawOverlay
        visible={!!drawMode}
        onClose={() => onExitDrawMode?.()}
        onSend={(annotations, instruction, canvasSize) => {
          const summary = annotations
            .map((a) =>
              a.type === "path"
                ? `[stroke ${a.color} w=${a.lineWidth}] ${a.pathData}`
                : `[label "${a.text}" at ${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}]`,
            )
            .join("\n");
          const lines = [
            `[Drawing on slide ${slide.id}]`,
            `Canvas size: ${canvasSize.width.toFixed(0)}x${canvasSize.height.toFixed(0)}`,
            summary,
            "",
            instruction || "Apply these annotations to the slide.",
          ];
          agentChat.submit(lines.join("\n"));
          onExitDrawMode?.();
        }}
      />
      <CanvasCommentPins
        key={slideId || slide.id}
        active={!!pinMode}
        onClose={() => onExitPinMode?.()}
        canvasSelector="[data-main-slide-canvas='true'] .slide-content"
        contextId={slideId || slide.id}
        contextLabel={slideTitle || `slide ${slideIndex + 1}`}
      />
    </div>
  );
}
