import { agentChat } from "@agent-native/core";
import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  type AttributedRecentEdit,
  type CollabUser,
} from "@agent-native/core/client/collab";
import {
  setClientAppState,
  usePinchZoom,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  AgentPresenceChip,
  RecentEditHighlights,
} from "@agent-native/toolkit/collab-ui";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { hashSlideContent } from "@shared/slide-fit";
import {
  IconMaximize,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { ExcalidrawSlide } from "@/components/deck/ExcalidrawSlide";
import SlideRenderer from "@/components/deck/SlideRenderer";
import type { SlideOverflowInfo } from "@/components/deck/SlideRenderer";
import {
  convertMarkdownPrefixToBullet,
  findEnclosingList,
  insertBulletAfterCaret,
  isBulletList,
  ZERO_WIDTH_SPACE,
} from "@/components/editor/bullet-editing";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DrawOverlay,
  CanvasCommentPins,
  MultiSelectChip,
} from "@/components/visual-editor";
import type { Slide, UpdateSlideOptions } from "@/context/DeckContext";
import { getAspectRatioDims, type AspectRatio } from "@/lib/aspect-ratios";
import {
  computeCanvasFitZoom,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from "@/lib/canvas-zoom";
import { extractMermaidBlocks } from "@/lib/mermaid-blocks";
import {
  createPlaceholderImageTarget,
  imageFileLooksSupported,
} from "@/lib/slide-image-replacement";
import { TAB_ID } from "@/lib/tab-id";
import { enterSelectionMode } from "@/root";

import type { DesignSystemData } from "../../../shared/api";
import { BlockBubbleMenu } from "./BlockBubbleMenu";
import {
  createSlidesCanvasGestureController,
  isWithinSlidesCanvasEdgeMoveBand,
  resolveSlidesCanvasPointerIntent,
  resolveSlidesCanvasDragTarget,
  slidesCanvasInteractionCore,
} from "./canvas-interactions";
import ImageOverlay from "./ImageOverlay";
import {
  detectSlideListKind,
  toggleSlideList,
  type SlideListKind,
} from "./list-editing";
import {
  applyInlineTextStyle,
  getInlineTextStyleSnapshot,
  getInlineTextStyleSnapshotForRange,
  restoreEditableTextRange,
  snapshotEditableTextRange,
  type InlineTextStylePatch,
  type InlineTextStyleSnapshot,
} from "./rich-text-selection";
import {
  createSelectionOverlayAutofitKey,
  createSelectionOverlayMeasurementKey,
  currentSelectionOverlayRect,
  isSelectionOverlayAutofitSettled,
  isSelectionOverlayOnActiveSlide,
  type SelectionOverlayMeasurement,
} from "./selection-overlay-measurement";
import { decideSlideEscape } from "./slide-escape-arbiter";
import {
  applySlideObjectMoveDelta,
  buildPastedSlideObjects,
  clientPointToSlideCoordinates,
  cloneSlideObject,
  collectMovableSlideObjects,
  copySlideObjects,
  computeSlideObjectZOrder,
  createSlidesSelectionState,
  ensureSlideObjectId,
  ensureSlideTextBoxCanvas,
  findSlideObjectById,
  freezeSlideElementForFreeform,
  getSlideTextBoxDefaultColor,
  getSlideSelectionIdentity,
  getSlideSelectionMode,
  findPersistedImageObject,
  isDeletableFlowImage,
  removeSlideObjectAndLayoutSpacer,
  resolveSlideObjectContainingBlock,
  type CopiedSlideObjects,
  type ResizeHandle,
  type SlideObjectGeometry,
  type SlideObjectZOrderTarget,
  type SlidesSelectionMode,
  type SlidesSelectionState as BaseSlidesSelectionState,
  type SlidesSelectionTool,
} from "./slide-object-interactions";
import { getPassiveSlidePresenceUsers } from "./slide-presence";
import { type SlideStylePatch, type SlideStyleSnapshot } from "./slide-style";
import {
  findSmartBlock,
  isInlineTextElement,
  isTextLeaf,
  shouldStampBuilderId,
} from "./slide-text-targets";
import { SlideContextToolbar } from "./SlideContextToolbar";
import { SlideOverflowWarning } from "./SlideOverflowWarning";
import { SpeakerNotesPanel } from "./SpeakerNotesPanel";

function ExcalidrawExitButton(props: { onExit: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 z-20 h-8 w-8 cursor-pointer border border-border bg-popover/95 shadow-lg"
          onClick={props.onExit}
          aria-label={props.label}
        >
          <IconX className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  );
}

let builderIdCounter = 0;
const CANVAS_ZOOM_PRESETS = [10, 25, 50, 75, 100, 125, 150, 200] as const;

/**
 * Object operations are intentionally narrower than ordinary canvas
 * selection. A flow-layout node may be selectable for inspection, but must
 * never be copied, reordered, deleted, or moved as though it were a canvas
 * object.
 */
function isPersistedFreeformObject(element: HTMLElement): boolean {
  return (
    Boolean(element.getAttribute("data-slide-object-id")) &&
    window.getComputedStyle(element).position === "absolute"
  );
}

function isSlideCanvasShell(element: HTMLElement): boolean {
  return (
    element.classList.contains("fmd-slide") ||
    element.classList.contains("fmd-autofit-scale") ||
    element.hasAttribute("data-fmd-autofit-content") ||
    element.hasAttribute("data-slide-canvas")
  );
}

function ensureBuilderId(element: HTMLElement): string {
  const existing = element.getAttribute("data-builder-id");
  if (existing) return existing;
  const id = `b-${++builderIdCounter}`;
  element.setAttribute("data-builder-id", id);
  return id;
}

/** Stamp selectable elements inside a container with transient builder ids. */
function stampBuilderIds(container: HTMLElement) {
  const elements = container.querySelectorAll("*");
  elements.forEach((el) => {
    const element = el as HTMLElement;
    if (!shouldStampBuilderId(element)) {
      element.removeAttribute("data-builder-id");
      return;
    }
    ensureBuilderId(element);
  });
}

/** Get the unique selector for an element using its data-builder-id */
function getBuilderSelector(el: HTMLElement): string | null {
  const id = el.getAttribute("data-builder-id");
  if (id) return `[data-builder-id="${id}"]`;
  return null;
}

/** Block tags that can hold rich multi-paragraph content */
const RICH_BLOCK_TAGS = new Set(["P", "DIV", "BLOCKQUOTE", "LI", "UL", "OL"]);

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
    const stripRoot = doc.querySelector("[data-strip-root]");
    if (stripRoot) stripPlaceholderZws(stripRoot);
    cleaned = stripRoot?.innerHTML ?? doc.body.innerHTML;
  }

  return (
    cleaned
      .replace(/\s*data-builder-id="[^"]*"/g, "")
      // An active inline edit marks its host element. Serializing mid-edit —
      // which the list toggles and the draft capture both do — would otherwise
      // bake the editing state into saved slide content.
      .replace(/\s*contenteditable="[^"]*"/gi, "")
      .replace(/\s*data-editing-block="[^"]*"/g, "")
  );
}

/**
 * Remove zero-width-space characters used only as caret placeholders, while
 * preserving a lone ZWS that is the sole content of an element — that ZWS keeps
 * an empty bullet's text span from collapsing, so it retains its font. Stripping
 * every ZWS (as a blanket regex did) drops that anchor and makes the next typed
 * character fall back to the container's base font.
 */
function stripPlaceholderZws(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text);
  }
  for (const textNode of textNodes) {
    if (!textNode.data.includes(ZERO_WIDTH_SPACE)) continue;
    const withoutZws = textNode.data.replaceAll(ZERO_WIDTH_SPACE, "");
    if (withoutZws.length > 0) {
      textNode.data = withoutZws;
    } else if (textNode.parentNode?.childNodes.length !== 1) {
      textNode.remove();
    }
  }
}

function cssPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedColor(value: string): string {
  return value === "rgba(0, 0, 0, 0)" ? "transparent" : value;
}

function normalizedFontWeight(value: string): string {
  if (value === "normal") return "400";
  if (value === "bold") return "700";
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return "400";
  if (parsed >= 700) return "700";
  if (parsed >= 600) return "600";
  if (parsed >= 500) return "500";
  return "400";
}

function normalizedTextAlign(value: string): string {
  if (value === "start") return "left";
  if (value === "end") return "right";
  return ["left", "center", "right", "justify"].includes(value)
    ? value
    : "left";
}

function stylePropertyName(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const INLINE_INSPECTOR_STYLE_KEYS = [
  "color",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecoration",
] as const satisfies readonly (keyof SlideStylePatch)[];

function inlineInspectorStylePatch(
  patch: SlideStylePatch,
): InlineTextStylePatch {
  return Object.fromEntries(
    INLINE_INSPECTOR_STYLE_KEYS.flatMap((key) => {
      const value = patch[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function applyDescendantTextStyle(
  element: HTMLElement,
  patch: InlineTextStylePatch,
) {
  for (const descendant of Array.from(
    element.querySelectorAll<HTMLElement>("*"),
  )) {
    for (const [property, value] of Object.entries(patch)) {
      if (value !== undefined) {
        descendant.style.setProperty(stylePropertyName(property), value);
      }
    }
  }
}

function elementPathFromRoot(
  root: HTMLElement,
  element: HTMLElement,
): number[] {
  const path: number[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return [];
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return path;
}

function resolveElementPath(
  root: HTMLElement | null,
  path: number[],
): HTMLElement | null {
  let current: Element | null = root;
  for (const index of path) {
    if (!current?.children[index]) return null;
    current = current.children[index];
  }
  return current instanceof HTMLElement ? current : null;
}

function buildStyleSnapshot(
  element: HTMLElement,
  selector: string,
  inlineTextStyle?: InlineTextStyleSnapshot,
): SlideStyleSnapshot {
  const computed = window.getComputedStyle(element);
  const fmdSlide = element.closest(".fmd-slide") as HTMLElement | null;
  const isAbsolute = computed.position === "absolute";
  const slideWidth = fmdSlide?.offsetWidth ?? 0;
  const slideHeight = fmdSlide?.offsetHeight ?? 0;
  const matrix = new DOMMatrixReadOnly(computed.transform);
  const rotation =
    computed.transform === "none"
      ? 0
      : Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
  const textPreview = (element.textContent ?? "").trim().slice(0, 80);
  const blockFontSize = cssPx(computed.fontSize);
  const rawLineHeight = cssPx(computed.lineHeight);
  const lineHeight =
    rawLineHeight > 0 && blockFontSize > 0
      ? Number((rawLineHeight / blockFontSize).toFixed(2))
      : 1.2;
  const paddingLeft = cssPx(computed.paddingLeft);
  const paddingRight = cssPx(computed.paddingRight);
  const paddingTop = cssPx(computed.paddingTop);
  const paddingBottom = cssPx(computed.paddingBottom);
  const parsedZIndex = Number(computed.zIndex);
  const zIndex = Number.isFinite(parsedZIndex) ? parsedZIndex : 0;

  const selectedTextStyle =
    inlineTextStyle?.scope === "selection" ? inlineTextStyle : null;
  const selectedColor = selectedTextStyle?.values.color;
  const selectedFontSize = selectedTextStyle?.values.fontSize;
  const selectedFontWeight = selectedTextStyle?.values.fontWeight;
  const selectedFontStyle = selectedTextStyle?.values.fontStyle;
  const selectedTextDecoration = selectedTextStyle?.values.textDecoration;

  return {
    selector,
    label: element.getAttribute("aria-label") || element.tagName.toLowerCase(),
    tagName: element.tagName.toLowerCase(),
    textPreview,
    isText:
      element.tagName !== "IMG" &&
      (!!textPreview || element.classList.contains("fmd-text-box")),
    isImage: element.tagName === "IMG",
    color:
      selectedColor === null || selectedColor === undefined
        ? normalizedColor(computed.color)
        : normalizedColor(selectedColor),
    backgroundColor: normalizedColor(computed.backgroundColor),
    fontSize:
      selectedFontSize === null || selectedFontSize === undefined
        ? blockFontSize
        : cssPx(selectedFontSize),
    fontWeight:
      selectedFontWeight === null || selectedFontWeight === undefined
        ? normalizedFontWeight(computed.fontWeight)
        : normalizedFontWeight(selectedFontWeight),
    fontStyle: selectedFontStyle ?? computed.fontStyle,
    textDecoration: selectedTextDecoration ?? computed.textDecorationLine,
    lineHeight,
    textAlign: normalizedTextAlign(computed.textAlign),
    opacity: Math.round(Number(computed.opacity || 1) * 100),
    borderRadius: cssPx(computed.borderTopLeftRadius),
    borderWidth: cssPx(computed.borderTopWidth),
    borderColor: normalizedColor(computed.borderTopColor),
    paddingX: Math.round((paddingLeft + paddingRight) / 2),
    paddingY: Math.round((paddingTop + paddingBottom) / 2),
    zIndex,
    listKind: detectSlideListKind(element),
    textStyleScope: inlineTextStyle?.scope ?? "block",
    mixedTextStyles: selectedTextStyle?.mixed ?? [],
    isAbsolute,
    x: Math.round(element.offsetLeft),
    y: Math.round(element.offsetTop),
    width: Math.round(element.offsetWidth),
    height: Math.round(element.offsetHeight),
    rotation,
    slideWidth,
    slideHeight,
  };
}

interface SlideSelectionItem {
  selector: string;
  runtimeSelector?: string;
  objectId?: string;
  text?: string;
  kind?: string;
  tagName?: string;
  imageSrc?: string;
  style?: Partial<SlideStyleSnapshot>;
}

type SlidesSelectionState = BaseSlidesSelectionState<SlideSelectionItem>;

function selectionItemForElement(
  element: HTMLElement,
  runtimeSelector: string,
  snapshot?: SlideStyleSnapshot,
): SlideSelectionItem {
  const identity = getSlideSelectionIdentity(element, runtimeSelector);
  return {
    ...identity,
    kind: snapshot?.isImage
      ? "image"
      : element.tagName === "IMG"
        ? "image"
        : "element",
    tagName: snapshot?.tagName ?? element.tagName.toLowerCase(),
    text:
      snapshot?.textPreview ?? (element.textContent || "").trim().slice(0, 200),
    imageSrc:
      element instanceof HTMLImageElement
        ? (element.getAttribute("src") ?? undefined)
        : undefined,
    style: snapshot ? { ...snapshot, selector: identity.selector } : undefined,
  };
}

function syncSelectionToAppState(state: SlidesSelectionState | null) {
  const slidesKeys = [
    appStateKeyForBrowserTab("slides-selection", TAB_ID),
    "slides-selection",
  ];
  const genericKeys = [
    appStateKeyForBrowserTab("selection", TAB_ID),
    "selection",
  ];
  for (const key of slidesKeys) {
    setClientAppState(key, state, {
      keepalive: true,
      requestSource: TAB_ID,
    }).catch(() => {});
  }
  const generic = state ? { items: state.items } : null;
  for (const key of genericKeys) {
    setClientAppState(key, generic, {
      keepalive: true,
      requestSource: TAB_ID,
    }).catch(() => {});
  }
}

interface SlideEditorProps {
  slide: Slide;
  onUpdateSlide: (
    updates: Partial<Omit<Slide, "id">>,
    slideIdOverride?: string,
    options?: UpdateSlideOptions,
  ) => void;
  /** When true, all inline-edit affordances are disabled — the slide is
   *  navigable but contentEditable / image overlays don't activate.
   *  Mirrors Google Slides' viewer experience. */
  readOnly?: boolean;
  /** Full-width host for the contextual style toolbar, rendered by the editor
   *  shell above the slide rail. Selection state lives here, so the toolbar is
   *  portaled out rather than lifted. Falls back to rendering in place. */
  contextToolbarSlot?: HTMLElement | null;
  /** Wide editor-shell host for the toolbar's top-row placement. */
  wideContextToolbarSlot?: HTMLElement | null;
  /** Selection-independent actions for the head of the contextual toolbar. */
  contextToolbarLeading?: ReactNode;
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
  /** Fired when an image is dragged from elsewhere in the app (e.g. a
   *  generated-image preview in the agent chat panel) and dropped on the
   *  slide canvas, instead of a native OS file drop. */
  onDropImageUrl?: (
    replaceSrc: string | null,
    url: string,
    position?: { x: number; y: number },
  ) => void;
  onToggleObjectFit: (imgSrc: string, newFit: string) => void;
  /** Current user display info for cursor caret */
  collabUser?: { name: string; color: string };
  /** True briefly when AI agent is making edits */
  agentActive?: boolean;
  /** Lingering recent edits (e.g. agent edits) to highlight over the canvas
   *  when they target the currently-active slide. */
  recentEdits?: AttributedRecentEdit[];
  /** Called when the user selects text and clicks the comment button */
  onComment?: (quotedText: string) => void;
  /** Zero-based index of the current slide */
  slideIndex?: number;
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
  /** Whether the "add text box" tool is active — the next click on the slide
   *  places a new text box there instead of selecting/marquee-selecting */
  textBoxMode?: boolean;
  /** Called after a text box is placed (or the tool should otherwise exit) */
  onExitTextBoxMode?: () => void;
  /** Slide id for pin mode contextId — falls back to slide.id if omitted */
  slideId?: string;
  /** Slide title for pin mode contextLabel */
  slideTitle?: string;
  /** Owning deck id — surfaced in the slide-fit-check app-state payload so
   *  `_await-fit-check` can build correct `update-slide --deckId=<id>`
   *  agent retry commands. */
  deckId?: string;
  /**
   * Called the moment the user enters contentEditable inline edit mode.
   * The parent should call `markDeckDirty(deckId)` here so the SSE/poll
   * reconcile path knows not to replace the deck under an active in-progress
   * edit, even before a `content` update has been flushed.
   */
  onInlineEditStart?: () => void;
  /** Other users (besides the current user) currently viewing/editing THIS
   *  slide. Drives the soft same-slide-edit indicator on the canvas so a user
   *  knows before they clobber someone else's last-writer-wins text edit. */
  presentUsers?: CollabUser[];
}

/**
 * Soft same-slide presence indicator. Renders a small stacked-avatar chip on
 * the canvas when another user is on the SAME slide the current user is
 * editing — a non-blocking heads-up so people don't unknowingly clobber each
 * other's edits (sync is last-writer-wins at deck granularity). No hard lock:
 * it only warns. Reuses the avatar + tooltip pattern from the sidebar.
 */
function SamePresenceAvatar({ user }: { user: CollabUser }) {
  const avatarUrl = useAvatarUrl(user.email);
  const initial = (user.name || user.email).slice(0, 1).toUpperCase();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="-ml-1.5 flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ring-2 ring-popover first:ml-0"
          style={{
            backgroundColor: avatarUrl ? undefined : user.color,
            fontSize: 9,
          }}
          aria-label={`${user.name} is on this slide`}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user.name}
              className="h-full w-full object-cover"
            />
          ) : (
            initial
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {user.name} ({user.email}) is on this slide
      </TooltipContent>
    </Tooltip>
  );
}

function SameSlidePresenceIndicator({ users }: { users: CollabUser[] }) {
  if (users.length === 0) return null;
  const visible = users.slice(0, 3);
  const overflow = users.length - visible.length;
  const label =
    users.length === 1
      ? `${users[0].name} is here`
      : `${users.length} others here`;
  return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-popover/95 py-1 pl-1 pr-2.5 text-xs text-popover-foreground shadow-lg">
      <div className="flex items-center">
        {visible.map((u) => (
          <SamePresenceAvatar key={u.email} user={u} />
        ))}
        {overflow > 0 && (
          <span className="-ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-medium leading-none text-muted-foreground ring-2 ring-popover">
            +{overflow}
          </span>
        )}
      </div>
      <span className="font-medium leading-none">{label}</span>
    </div>
  );
}

/** Selection outline rendered over a selected image */
function SelectionOverlayPortal({
  viewportRect,
  zIndex,
  children,
}: {
  viewportRect: DOMRect | null;
  zIndex: number;
  children: ReactNode;
}) {
  if (!viewportRect) return null;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const top = Math.max(0, Math.min(viewportHeight, viewportRect.top));
  const right = Math.max(
    0,
    Math.min(viewportWidth, viewportWidth - viewportRect.right),
  );
  const bottom = Math.max(
    0,
    Math.min(viewportHeight, viewportHeight - viewportRect.bottom),
  );
  const left = Math.max(0, Math.min(viewportWidth, viewportRect.left));

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex,
        // Selection rects use viewport coordinates, so keep the portal for
        // accurate zoom/scroll tracking while clipping it to the canvas
        // viewport. This prevents outlines from painting over either sidebar.
        clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)`,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function ImageSelectionOutline({
  rect,
  viewportRect,
}: {
  rect: DOMRect;
  viewportRect: DOMRect | null;
}) {
  const pad = 2;
  return (
    <SelectionOverlayPortal viewportRect={viewportRect} zIndex={50}>
      <div
        data-slide-selection-outline="true"
        style={{
          position: "absolute",
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          pointerEvents: "none",
          border: "2px solid #609FF8",
          borderRadius: 2,
        }}
      />
    </SelectionOverlayPortal>
  );
}

function ElementSelectionOutline({
  rect,
  viewportRect,
  onResizeStart,
}: {
  rect: DOMRect;
  viewportRect: DOMRect | null;
  onResizeStart?: (handle: ResizeHandle, e: React.PointerEvent) => void;
}) {
  const pad = 2;
  const handleClass = "absolute touch-none rounded-sm";
  const edgeHandleClass =
    "absolute flex touch-none items-center justify-center bg-transparent p-0";
  const edgeBarClass = "rounded-sm";
  return (
    <SelectionOverlayPortal viewportRect={viewportRect} zIndex={51}>
      <div
        data-slide-selection-outline="true"
        data-slide-selection-chrome="true"
        style={{
          position: "absolute",
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          pointerEvents: "none",
          border: "1px solid #609FF8",
          borderRadius: 3,
          boxShadow: "0 0 0 1px rgba(96, 159, 248, 0.2)",
        }}
      >
        <span
          data-slide-resize-handle="nw"
          onPointerDown={(e) => onResizeStart?.("nw", e)}
          className={handleClass}
          style={{
            pointerEvents: "auto",
            cursor: "nwse-resize",
            zIndex: 2,
          }}
        />
        <span
          data-slide-resize-handle="ne"
          onPointerDown={(e) => onResizeStart?.("ne", e)}
          className={handleClass}
          style={{
            pointerEvents: "auto",
            cursor: "nesw-resize",
            zIndex: 2,
          }}
        />
        <span
          data-slide-resize-handle="sw"
          onPointerDown={(e) => onResizeStart?.("sw", e)}
          className={handleClass}
          style={{
            pointerEvents: "auto",
            cursor: "nesw-resize",
            zIndex: 2,
          }}
        />
        <span
          data-slide-resize-handle="se"
          onPointerDown={(e) => onResizeStart?.("se", e)}
          className={handleClass}
          style={{
            pointerEvents: "auto",
            cursor: "nwse-resize",
            zIndex: 2,
          }}
        />
        <span
          data-slide-resize-handle="n"
          onPointerDown={(e) => onResizeStart?.("n", e)}
          className={edgeHandleClass}
          style={{
            pointerEvents: "auto",
            cursor: "ns-resize",
            zIndex: 1,
          }}
        >
          <span data-slide-resize-handle-bar="true" className={edgeBarClass} />
        </span>
        <span
          data-slide-resize-handle="e"
          onPointerDown={(e) => onResizeStart?.("e", e)}
          className={edgeHandleClass}
          style={{
            pointerEvents: "auto",
            cursor: "ew-resize",
            zIndex: 1,
          }}
        >
          <span data-slide-resize-handle-bar="true" className={edgeBarClass} />
        </span>
        <span
          data-slide-resize-handle="s"
          onPointerDown={(e) => onResizeStart?.("s", e)}
          className={edgeHandleClass}
          style={{
            pointerEvents: "auto",
            cursor: "ns-resize",
            zIndex: 1,
          }}
        >
          <span data-slide-resize-handle-bar="true" className={edgeBarClass} />
        </span>
        <span
          data-slide-resize-handle="w"
          onPointerDown={(e) => onResizeStart?.("w", e)}
          className={edgeHandleClass}
          style={{
            pointerEvents: "auto",
            cursor: "ew-resize",
            zIndex: 1,
          }}
        >
          <span data-slide-resize-handle-bar="true" className={edgeBarClass} />
        </span>
      </div>
    </SelectionOverlayPortal>
  );
}

/** Outline rendered around a multi-select element */
function MultiSelectOutline({
  rect,
  viewportRect,
}: {
  rect: DOMRect;
  viewportRect: DOMRect | null;
}) {
  const pad = 1;
  return (
    <SelectionOverlayPortal viewportRect={viewportRect} zIndex={49}>
      <div
        style={{
          position: "absolute",
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          pointerEvents: "none",
          border: "2px solid #609FF8",
          borderRadius: 2,
          boxShadow: "0 0 0 1px rgba(96, 159, 248, 0.25)",
        }}
      />
    </SelectionOverlayPortal>
  );
}

/** Translucent rectangle drawn while marquee-dragging */
function MarqueeRect({
  rect,
  viewportRect,
}: {
  rect: { x: number; y: number; w: number; h: number };
  viewportRect: DOMRect | null;
}) {
  return (
    <SelectionOverlayPortal viewportRect={viewportRect} zIndex={48}>
      <div
        style={{
          position: "absolute",
          top: rect.y,
          left: rect.x,
          width: rect.w,
          height: rect.h,
          pointerEvents: "none",
          background: "rgba(96, 159, 248, 0.12)",
          border: "1px solid #609FF8",
          borderRadius: 1,
        }}
      />
    </SelectionOverlayPortal>
  );
}

/** True if two DOMRect-like rectangles intersect */
function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right || // i18n-ignore geometry comparison
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

/**
 * Push the current slide's vertical-fit measurement to application_state.
 * Browser-tab requests read the tab-scoped key; the legacy global key stays
 * available for CLI/headless runs. Always written, even when the slide fits —
 * the `add-slide` / `update-slide` actions poll this key and use the
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
    contentHash: string;
    contentHeight: number;
    contentWidth: number;
    viewportHeight: number;
    viewportWidth: number;
    verticalOverflow: number;
    horizontalOverflow: number;
  } | null,
) {
  const keys = Array.from(
    new Set([
      appStateKeyForBrowserTab("slide-fit-check", TAB_ID),
      "slide-fit-check",
    ]),
  );
  if (!payload) {
    for (const key of keys) {
      fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
        method: "DELETE",
        keepalive: true,
        headers: { "X-Request-Source": TAB_ID },
      }).catch(() => {});
    }
    return;
  }
  const body = JSON.stringify({ ...payload, measuredAt: Date.now() });
  for (const key of keys) {
    fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
      method: "PUT",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": TAB_ID,
      },
      body,
    }).catch(() => {});
  }
}

export default function SlideEditor({
  slide,
  onUpdateSlide,
  readOnly = false,
  contextToolbarSlot,
  wideContextToolbarSlot,
  contextToolbarLeading,
  onGenerateImage,
  onOpenAssetLibrary,
  onUploadImage,
  onSearchImage,
  onLogoSearch,
  onDropImage,
  onDropImageUrl,
  onToggleObjectFit,
  agentActive,
  slideIndex = 0,
  designSystem,
  aspectRatio,
  drawMode,
  onExitDrawMode,
  pinMode,
  onExitPinMode,
  textBoxMode,
  onExitTextBoxMode,
  slideId,
  slideTitle,
  deckId,
  onInlineEditStart,
  presentUsers = [],
  recentEdits = [],
}: SlideEditorProps) {
  const t = useT();
  const content = typeof slide.content === "string" ? slide.content : "";
  const isHtmlSlide =
    content.includes('class="fmd-slide"') ||
    ["blank", "section", "statement", "full-image"].includes(slide.layout);

  const [canvasZoom, setCanvasZoom] = useState(100);
  const [imageOverlay, setImageOverlay] = useState<{
    rect: DOMRect;
    src: string;
    objectFit: "cover" | "contain";
  } | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [selectionViewportRect, setSelectionViewportRect] =
    useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Wraps the rendered slide; used as the positioning container for the
  // lingering "AI edited" ring when the active slide was just edited.
  const slideCanvasRef = useRef<HTMLDivElement>(null);

  // Recent edits (usually the agent's) that target THIS slide. The ring is
  // drawn around the whole canvas since a slide-level `slides.<id>` descriptor
  // refers to the entire slide.
  const activeSlideId = slideId || slide.id;
  const activeSlideEdits = recentEdits.filter((edit) => {
    const d = edit.descriptor;
    return (
      d.kind === "paths" &&
      Array.isArray(d.paths) &&
      d.paths.some((p) => p === `slides.${activeSlideId}`)
    );
  });
  const passivePresentUsers = getPassiveSlidePresenceUsers(
    presentUsers,
    agentActive,
  );
  const resolveCanvasRect = useCallback(
    (): DOMRect | null =>
      slideCanvasRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  // --- Multi-select state ---
  /** Set of data-builder-id values currently in the multi-select */
  const [multiSelection, setMultiSelection] = useState<Set<string>>(
    () => new Set(),
  );
  /** Cached client rects + text per selected id (kept in sync on resize/scroll) */
  const [multiSelectionRects, setMultiSelectionRects] = useState<
    Map<string, { rect: DOMRect; text: string; selector: string }>
  >(() => new Map());
  const copiedObjectClipboardRef = useRef<{
    copied: CopiedSlideObjects;
    deckId?: string;
    slideId: string;
    sourceObjectId: string;
  } | null>(null);
  const [selectedElementPath, setSelectedElementPath] = useState<
    number[] | null
  >(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedElementSlideId, setSelectedElementSlideId] = useState<
    string | null
  >(null);
  const [selectedElementSelector, setSelectedElementSelector] = useState<
    string | null
  >(null);
  const [selectedElementMeasurement, setSelectedElementMeasurement] =
    useState<SelectionOverlayMeasurement | null>(null);
  const [selectionMeasurementRevision, setSelectionMeasurementRevision] =
    useState(0);
  const canvasAutofitKey = createSelectionOverlayAutofitKey(slide.id, content);
  const [settledAutofitKey, setSettledAutofitKey] = useState<string | null>(
    null,
  );
  const [selectedStyleSnapshot, setSelectedStyleSnapshot] =
    useState<SlideStyleSnapshot | null>(null);
  const selectionOverlayMeasurementKey = createSelectionOverlayMeasurementKey({
    slideId: slide.id,
    content,
    objectId: selectedObjectId,
    selector: selectedElementSelector,
    path: selectedElementPath,
    canvasZoom,
    revision: selectionMeasurementRevision,
  });
  const selectedElementRect = currentSelectionOverlayRect(
    selectedElementMeasurement,
    selectionOverlayMeasurementKey,
  );
  const invalidateSelectionOverlayMeasurement = useCallback(() => {
    setSelectedElementMeasurement(null);
    setSelectionMeasurementRevision((revision) => revision + 1);
  }, []);
  const handleAutofitSettled = useCallback(() => {
    setSettledAutofitKey(canvasAutofitKey);
  }, [canvasAutofitKey]);
  /** Anchor rect for the floating chip (the slide canvas) */
  const [chipAnchorRect, setChipAnchorRect] = useState<DOMRect | null>(null);
  /** Active marquee rectangle (viewport coords). null = not dragging. */
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  /** Content overflow for the current slide (both axes 0 = fits). Reported by the
   *  renderer so we can prompt the agent to rewrite the slide HTML instead of
   *  silently scaling it down (which created unbalanced right/bottom margins
   *  on slides whose content was too tall for the canvas). */
  const [overflowInfo, setOverflowInfo] = useState<SlideOverflowInfo | null>(
    null,
  );
  const [isAskingAgentToFix, setIsAskingAgentToFix] = useState(false);
  const repairRequestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [isOverflowWarningDismissed, setIsOverflowWarningDismissed] =
    useState(false);
  const dims = getAspectRatioDims(aspectRatio);
  const [fitCanvasZoom, setFitCanvasZoom] = useState(100);
  const userSetCanvasZoomRef = useRef(false);
  const canvasWidth = Math.round(dims.width * (canvasZoom / 100));
  const canvasTrackRef = useRef<HTMLDivElement>(null);
  const setManualCanvasZoom = useCallback((next: number) => {
    userSetCanvasZoomRef.current = true;
    setCanvasZoom(Math.round(next));
  }, []);
  const canvasZoomIn = useCallback(() => {
    const next = CANVAS_ZOOM_PRESETS.find((preset) => preset > canvasZoom);
    setManualCanvasZoom(
      next ?? CANVAS_ZOOM_PRESETS[CANVAS_ZOOM_PRESETS.length - 1],
    );
  }, [canvasZoom, setManualCanvasZoom]);
  const canvasZoomOut = useCallback(() => {
    const previous = [...CANVAS_ZOOM_PRESETS]
      .reverse()
      .find((preset) => preset < canvasZoom);
    setManualCanvasZoom(previous ?? CANVAS_ZOOM_PRESETS[0]);
  }, [canvasZoom, setManualCanvasZoom]);
  const fitCanvasToScreen = useCallback(() => {
    userSetCanvasZoomRef.current = false;
    setCanvasZoom(fitCanvasZoom);
  }, [fitCanvasZoom]);

  usePinchZoom({
    containerRef: scrollContainerRef,
    zoom: canvasZoom,
    setZoom: setManualCanvasZoom,
    min: MIN_CANVAS_ZOOM,
    max: MAX_CANVAS_ZOOM,
  });

  // Selection outlines are portaled to the document so their viewport
  // coordinates stay aligned with the zoomed/scrolling slide. Keep a live
  // viewport rect so that portal can clip itself to the central canvas when
  // either sidebar or the style inspector changes the available width.
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const updateViewportRect = () => {
      setSelectionViewportRect(scrollContainer.getBoundingClientRect());
    };

    updateViewportRect();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateViewportRect);
    observer?.observe(scrollContainer);
    window.addEventListener("resize", updateViewportRect);
    window.addEventListener("scroll", updateViewportRect, true);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateViewportRect);
      window.removeEventListener("scroll", updateViewportRect, true);
    };
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let raf = 0;

    const updateFitZoom = () => {
      const track = canvasTrackRef.current;
      const trackStyle = track ? window.getComputedStyle(track) : null;
      const horizontalPadding =
        (parseFloat(trackStyle?.paddingLeft ?? "0") || 0) +
        (parseFloat(trackStyle?.paddingRight ?? "0") || 0);
      const verticalPadding =
        (parseFloat(trackStyle?.paddingTop ?? "0") || 0) +
        (parseFloat(trackStyle?.paddingBottom ?? "0") || 0);
      const nextFitZoom = computeCanvasFitZoom({
        viewportWidth: scrollContainer.clientWidth,
        viewportHeight: scrollContainer.clientHeight,
        canvasWidth: dims.width,
        canvasHeight: dims.height,
        horizontalPadding,
        verticalPadding,
      });

      setFitCanvasZoom(nextFitZoom);
      if (!userSetCanvasZoomRef.current) {
        setCanvasZoom(nextFitZoom);
      }
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateFitZoom);
    };

    updateFitZoom();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    observer?.observe(scrollContainer);
    if (canvasTrackRef.current) observer?.observe(canvasTrackRef.current);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [dims.width]);

  // Reset overflow state whenever the slide changes — the renderer will
  // report the next measurement (or stay null if the new slide fits).
  useEffect(() => {
    if (repairRequestTimerRef.current) {
      clearTimeout(repairRequestTimerRef.current);
      repairRequestTimerRef.current = null;
    }
    setOverflowInfo(null);
    setIsAskingAgentToFix(false);
    setIsOverflowWarningDismissed(false);
    syncOverflowToAppState(null);
  }, [slide.id, slide.content]);

  // Clear the app-state overflow key when this editor unmounts, so a stale
  // measurement never leaks into a different deck/slide context.
  useEffect(() => {
    return () => {
      if (repairRequestTimerRef.current) {
        clearTimeout(repairRequestTimerRef.current);
        repairRequestTimerRef.current = null;
      }
      syncOverflowToAppState(null);
    };
  }, []);

  const handleOverflowChange = useCallback(
    (info: SlideOverflowInfo) => {
      const overflowing =
        info.verticalOverflow > 0 || info.horizontalOverflow > 0 ? info : null;
      // Dedup the React state update — the renderer fires on every
      // measurement (so the action can confirm freshness via the app-state
      // `measuredAt` timestamp), but most measurements report the same
      // value and shouldn't churn the badge UI.
      setOverflowInfo((prev) => {
        if (
          prev?.verticalOverflow === overflowing?.verticalOverflow &&
          prev?.horizontalOverflow === overflowing?.horizontalOverflow
        ) {
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
        contentHash: hashSlideContent(slide.content),
        contentHeight: info.contentHeight,
        contentWidth: info.contentWidth,
        viewportHeight: info.viewportHeight,
        viewportWidth: info.viewportWidth,
        verticalOverflow: info.verticalOverflow,
        horizontalOverflow: info.horizontalOverflow,
      });
    },
    [slide.id, deckId],
  );

  const handleAskAgentToFixLayout = useCallback(() => {
    if (
      !overflowInfo ||
      (overflowInfo.verticalOverflow <= 0 &&
        overflowInfo.horizontalOverflow <= 0)
    ) {
      return;
    }
    const slideHeading = (() => {
      if (typeof document === "undefined") return null;
      const main = document.querySelector("[data-main-slide-canvas]");
      const heading = main?.querySelector("h1, h2, h3, [class*='heading']");
      return heading?.textContent?.trim()?.slice(0, 80) || null;
    })();
    const dimsW = dims.width;
    const dimsH = dims.height;
    setIsAskingAgentToFix(true);
    if (repairRequestTimerRef.current) {
      clearTimeout(repairRequestTimerRef.current);
    }
    // Delivery only proves that the prompt reached chat, not that an action
    // changed this slide. Release the control after one bounded repair window
    // so a stalled or no-op agent run cannot strand the warning UI.
    repairRequestTimerRef.current = setTimeout(() => {
      repairRequestTimerRef.current = null;
      setIsAskingAgentToFix(false);
    }, 30_000);
    void sendToAgentChatAndConfirm({
      message: [
        `The current slide's content overflows the canvas${overflowInfo.verticalOverflow > 0 ? ` vertically by ${overflowInfo.verticalOverflow}px` : ""}${overflowInfo.horizontalOverflow > 0 ? ` horizontally by ${overflowInfo.horizontalOverflow}px` : ""} and needs to be rewritten to fit.`,
        ``,
        `Slide id: \`${slide.id}\``,
        slideHeading ? `Slide heading: "${slideHeading}"` : null,
        `Canvas size: ${dimsW}x${dimsH}px (native render).`,
        `Available content area inside the slide's padding: ${overflowInfo.viewportWidth}x${overflowInfo.viewportHeight}px.`,
        `Natural rendered content: ${overflowInfo.contentWidth}x${overflowInfo.contentHeight}px inside a ${overflowInfo.viewportWidth}x${overflowInfo.viewportHeight}px content area.`,
        ``,
        `Please use \`view-screen\` to read the current slide HTML, then make one bounded \`update-slide --fullContent\` repair so its rendered content fits within ${overflowInfo.viewportWidth}x${overflowInfo.viewportHeight}px. Options to shrink the layout, in order of preference:`,
        `1. Tighten copy — shorten headings/body, drop low-value bullets, replace prose with terse phrases.`,
        `2. Reduce vertical density — fewer stacked cards, smaller gaps, smaller body font (don't go below 16px), shorter labels.`,
        `3. Reduce slide padding (e.g. 40px top/bottom instead of 60-80px) if the layout is genuinely tight.`,
        `4. If the content really can't be compressed without losing meaning, split it across two slides.`,
        ``,
        `Do NOT solve this by adding zoom, \`transform: scale()\`, clipping, or \`overflow: scroll\`. Preserve existing manually positioned absolute objects, including text boxes; rewrite only the overflowing flow layout so the HTML itself fits ${dimsW}x${dimsH}. After the write, verify the result with \`view-screen\`; do not repeat repairs in a loop.`,
      ]
        .filter(Boolean)
        .join("\n"),
      submit: true,
      chatTarget: "local",
    }).then((delivery) => {
      if (!delivery.delivered) {
        // A missing or delayed chat handoff must not leave the only repair
        // control permanently disabled with no visible mutation to wait for.
        setIsAskingAgentToFix(false);
      }
    });
  }, [overflowInfo, slide.id, dims.width, dims.height]);
  /** Marquee origin (viewport coords). Set on pointerdown. */
  const marqueeOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** Set right before placing a text box so the click event that follows the
   *  placing pointerdown doesn't fall through to click-to-select/deselect
   *  logic and steal focus back off the freshly created box. */
  const suppressNextClickRef = useRef(false);
  const activeGestureCancelRef = useRef<(() => void) | null>(null);
  /**
   * If the user pressed shift/cmd before starting a marquee, additive mode
   * preserves the existing selection on pointerup.
   */
  const marqueeAdditiveRef = useRef(false);
  /** Selection at marquee start — used for additive mode */
  const marqueePrevSelectionRef = useRef<Set<string>>(new Set());
  /** Currently-edited smart block (leaf or group). State, not ref, so menu re-renders. */
  const [editingEl, setEditingEl] = useState<HTMLElement | null>(null);
  /**
   * Mirror of `editingEl` readable outside render. Exit paths must not read it
   * through a `setEditingEl` updater: updaters run during the render phase, so
   * the parent's `onUpdateSlide` would update DeckProvider mid-render.
   */
  const editingElRef = useRef<HTMLElement | null>(null);
  const richTextSelectionRef = useRef<Range | null>(null);
  /** Latest onUpdateSlide in a ref so blur handlers always see the current version */
  const onUpdateSlideRef = useRef(onUpdateSlide);
  useEffect(() => {
    onUpdateSlideRef.current = onUpdateSlide;
  }, [onUpdateSlide]);
  const inlineEditDraftRef = useRef<{
    slideId: string;
    content: string;
  } | null>(null);
  const previousSlideIdRef = useRef(slide.id);

  const readCurrentSlideContentHtml = useCallback(() => {
    const slideContent = containerRef.current?.querySelector(
      ".slide-content",
    ) as HTMLElement | null;
    if (!slideContent) return null;
    // SlideRenderer swaps each `<div class="mermaid">` for a
    // `data-mermaid-index` placeholder and renders the diagram as SVG via
    // MermaidRenderer — the live DOM never contains the original mermaid
    // syntax. Serializing it as-is here would permanently bake the rendered
    // SVG into slide.content and turn a diagram edited or moved alongside
    // (e.g. another text block on the same slide) into inert markup that can
    // never be resized, edited, or re-rendered again. Restore the original
    // `<div class="mermaid">` markup from slide.content — the untouched
    // source of truth — before saving.
    const clone = slideContent.cloneNode(true) as HTMLElement;
    const placeholders = clone.querySelectorAll("[data-mermaid-index]");
    // Look up source blocks by index before touching the DOM. If slide.content
    // changed since this placeholder last rendered (e.g. a concurrent update),
    // its index may no longer have a matching block — leave that placeholder's
    // node untouched rather than swapping in a marker with nothing to restore
    // it, which would otherwise persist as inert marker text.
    const { blocks } = extractMermaidBlocks(slide.content);
    // Swap each rendered node for a plain-text marker now, and splice the
    // real `<div class="mermaid">` markup back in as a raw string AFTER
    // stripBuilderIds() below. stripBuilderIds round-trips through
    // DOMParser + innerHTML, which HTML-escapes `>` in text nodes (mangling
    // `A --> B` into `A --&gt; B`) — the same reason SlideRenderer extracts
    // mermaid blocks before its own sanitization pass. Doing the real
    // substitution as a plain string replace, after all DOM round-trips,
    // avoids that entirely.
    const nonce = Math.random().toString(36).slice(2);
    const markerFor = (idx: number) => `__mermaid_${nonce}_${idx}__`;
    const restorable = new Map<number, string>();
    placeholders.forEach((placeholder) => {
      const idx = Number(placeholder.getAttribute("data-mermaid-index"));
      const definition = blocks[idx];
      if (definition === undefined) return;
      restorable.set(idx, definition);
      placeholder.replaceWith(
        clone.ownerDocument.createTextNode(markerFor(idx)),
      );
    });
    let html = stripBuilderIds(clone.innerHTML);
    restorable.forEach((definition, idx) => {
      html = html.replace(
        markerFor(idx),
        `<div class="mermaid">${definition}</div>`,
      );
    });
    return html;
  }, [slide.content]);

  const captureInlineEditDraft = useCallback(
    (slideId = slide.id) => {
      const html = readCurrentSlideContentHtml();
      if (html !== null) {
        inlineEditDraftRef.current = { slideId, content: html };
      }
    },
    [readCurrentSlideContentHtml, slide.id],
  );

  /** Resolve the slide-content root element (where selectable items live) */
  const getSlideContent = useCallback((): HTMLElement | null => {
    return (
      (containerRef.current?.querySelector(
        ".slide-content",
      ) as HTMLElement | null) || null
    );
  }, []);

  /**
   * Turn a normal layout block into a freeform object at its current visual
   * coordinates. A hidden same-size sibling retains the flex/grid slot, so
   * the rest of the slide does not reflow when Escape selects the block.
   */
  const freezeElementForFreeformSelection = useCallback(
    (
      element: HTMLElement,
    ): { element: HTMLElement; restoreMarkdownTree?: () => void } | null => {
      if (window.getComputedStyle(element).position === "absolute") {
        ensureSlideObjectId(element);
        return { element };
      }

      // Markdown slides normally render directly into their AutoFit root. Take
      // the visual snapshot before promotion, then use the same fmd canvas as
      // manually placed text boxes. Persisting a bare absolute Markdown node
      // would switch the renderer to raw HTML without its coordinate root.
      const originalRect = element.getBoundingClientRect();
      const originalComputed = window.getComputedStyle(element);
      let fmdSlide = element.closest(".fmd-slide") as HTMLElement | null;
      let positioningLayer: HTMLElement | null = null;
      let restoreMarkdownTree: (() => void) | undefined;
      if (fmdSlide) {
        positioningLayer =
          Array.from(fmdSlide.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement &&
              child.hasAttribute("data-fmd-autofit-content"),
          ) ?? fmdSlide;
      } else {
        const markdownRoot = element.closest(".slide-content");
        const originalChildren = markdownRoot
          ? Array.from(markdownRoot.childNodes)
          : [];
        const originalClassName = element.className;
        const originalStyle = element.getAttribute("style");
        const originalContentEditable = element.getAttribute("contenteditable");
        const originalEditingBlock = element.getAttribute("data-editing-block");
        const promoted = containerRef.current
          ? ensureSlideTextBoxCanvas(containerRef.current)
          : null;
        // Two-column Markdown has independent AutoFit roots. Do not save one
        // column as raw HTML and silently discard the other one.
        if (!promoted) return null;
        fmdSlide = promoted.fmdSlide;
        positioningLayer = promoted.positioningLayer;
        // The promotion moves ReactMarkdown's live child nodes. Restore its
        // original tree after serializing the raw fmd HTML and before the
        // parent state write, otherwise React tries to delete a child that we
        // already moved and the Markdown-to-raw rerender can fail.
        restoreMarkdownTree = () => {
          if (!markdownRoot) return;
          for (const child of originalChildren) markdownRoot.append(child);
          fmdSlide?.remove();
          element.className = originalClassName;
          if (originalStyle === null) element.removeAttribute("style");
          else element.setAttribute("style", originalStyle);
          if (originalContentEditable === null) {
            element.removeAttribute("contenteditable");
          } else {
            element.setAttribute("contenteditable", originalContentEditable);
          }
          if (originalEditingBlock === null) {
            element.removeAttribute("data-editing-block");
          } else {
            element.setAttribute("data-editing-block", originalEditingBlock);
          }
        };
      }

      // Markdown blocks become persisted raw HTML when Escape makes them
      // freeform, so their renderer canvas is the initial positioning layer.
      if (!positioningLayer) return { element };

      const containingBlock = resolveSlideObjectContainingBlock(
        element,
        positioningLayer,
      );
      const elementRect = originalRect;
      const layerRect = containingBlock.getBoundingClientRect();
      if (
        !elementRect.width ||
        !elementRect.height ||
        !layerRect.width ||
        !layerRect.height ||
        !containingBlock.offsetWidth ||
        !containingBlock.offsetHeight
      ) {
        return { element, restoreMarkdownTree };
      }

      const { x, y } = clientPointToSlideCoordinates(
        elementRect.left,
        elementRect.top,
        layerRect,
        containingBlock.offsetWidth,
        containingBlock.offsetHeight,
      );
      const scaleX = containingBlock.offsetWidth / layerRect.width;
      const scaleY = containingBlock.offsetHeight / layerRect.height;
      freezeSlideElementForFreeform(
        element,
        {
          x,
          y,
          width: Math.round(elementRect.width * scaleX),
          height: Math.round(elementRect.height * scaleY),
        },
        {
          display: originalComputed.display,
          flexGrow: originalComputed.flexGrow,
          flexShrink: originalComputed.flexShrink,
          flexBasis: originalComputed.flexBasis,
          alignSelf: originalComputed.alignSelf,
        },
        {
          color: originalComputed.color,
          direction: originalComputed.direction,
          fontFamily: originalComputed.fontFamily,
          fontSize: originalComputed.fontSize,
          fontStyle: originalComputed.fontStyle,
          fontWeight: originalComputed.fontWeight,
          letterSpacing: originalComputed.letterSpacing,
          lineHeight: originalComputed.lineHeight,
          textAlign: originalComputed.textAlign,
          textDecoration: originalComputed.textDecoration,
          textShadow: originalComputed.textShadow,
          textTransform: originalComputed.textTransform,
          whiteSpace: originalComputed.whiteSpace,
          wordSpacing: originalComputed.wordSpacing,
        },
      );
      return { element, restoreMarkdownTree };
    },
    [],
  );

  const resolveSelectedElement = useCallback((): HTMLElement | null => {
    const slideContent = getSlideContent();
    if (!slideContent) return null;
    if (selectedObjectId) {
      const object = findSlideObjectById(slideContent, selectedObjectId);
      if (object) return object;
    }
    if (!selectedElementPath) return null;
    return resolveElementPath(slideContent, selectedElementPath);
  }, [getSlideContent, selectedElementPath, selectedObjectId]);

  const buildSelectionState = useCallback(
    (
      mode: SlidesSelectionMode,
      items: SlideSelectionItem[],
      activeTool?: SlidesSelectionTool,
    ): SlidesSelectionState =>
      createSlidesSelectionState({
        deckId,
        slideId: slide.id,
        slideIndex,
        mode,
        items,
        drawMode: Boolean(drawMode),
        pinMode: Boolean(pinMode),
        textBoxMode: Boolean(textBoxMode),
        activeTool,
      }),
    [deckId, drawMode, pinMode, slide.id, slideIndex, textBoxMode],
  );

  const clearSelectedElement = useCallback(() => {
    richTextSelectionRef.current = null;
    setSelectedElementPath(null);
    setSelectedObjectId(null);
    setSelectedElementSlideId(null);
    setSelectedElementSelector(null);
    setSelectedElementMeasurement(null);
    setSelectedStyleSnapshot(null);
  }, []);

  // `slide.background` paints the canvas wrapper, but a generated `.fmd-slide`
  // root usually carries its own inline background that covers the whole
  // canvas. Writing only the field would leave the picker looking broken on
  // exactly the slides the agent produces, so repaint the root as well when it
  // declares one.
  const applySlideBackground = useCallback(
    (background: string) => {
      const updates: Partial<Omit<Slide, "id">> = { background };
      const root = getSlideContent()?.querySelector(
        ".fmd-slide",
      ) as HTMLElement | null;
      if (root && (root.style.background || root.style.backgroundColor)) {
        root.style.background = background;
        const html = readCurrentSlideContentHtml();
        if (html !== null) updates.content = html;
      }
      onUpdateSlideRef.current(updates);
    },
    [getSlideContent, readCurrentSlideContentHtml],
  );

  const selectElementForStyling = useCallback(
    (
      element: HTMLElement,
      selector: string,
      selectionMode?: SlidesSelectionMode,
    ) => {
      const slideContent = getSlideContent();
      if (!slideContent) return;
      const path = elementPathFromRoot(slideContent, element);
      if (path.length === 0) return;
      const snapshot = buildStyleSnapshot(element, selector);
      setSelectedElementPath(path);
      setSelectedObjectId(element.getAttribute("data-slide-object-id"));
      setSelectedElementSlideId(slide.id);
      setSelectedElementSelector(selector);
      // Geometry can be invalidated by an async slide-content commit or
      // AutoFit transform. Reveal the portal only after the layout effect
      // measures this exact rendered selection.
      invalidateSelectionOverlayMeasurement();
      setSelectedStyleSnapshot(snapshot);
      syncSelectionToAppState(
        buildSelectionState(getSlideSelectionMode(snapshot, selectionMode), [
          selectionItemForElement(element, selector, snapshot),
        ]),
      );
    },
    [
      buildSelectionState,
      getSlideContent,
      invalidateSelectionOverlayMeasurement,
      slide.id,
    ],
  );

  /** Exit edit mode, saving changes to slide.content */
  const exitInlineEdit = useCallback(() => {
    const el = editingElRef.current;
    if (!el) return;
    editingElRef.current = null;
    richTextSelectionRef.current = null;
    el.contentEditable = "false";
    el.removeAttribute("data-editing-block");

    const frozen = freezeElementForFreeformSelection(el);
    const selected = frozen?.element ?? null;
    const selector = selected ? getBuilderSelector(selected) : null;

    const html = selected ? readCurrentSlideContentHtml() : null;
    frozen?.restoreMarkdownTree?.();
    if (html !== null) {
      onUpdateSlideRef.current({ content: html });
    }
    inlineEditDraftRef.current = null;
    const escape = slidesCanvasInteractionCore.escape({
      editingObjectId: "inline-editing",
      selectedObjectIds: resolveSelectedElement() ? ["selected"] : [],
    });
    setEditingEl(null);
    if (escape.action === "select-object" && selected && selector) {
      selectElementForStyling(selected, selector);
    } else if (escape.action === "clear-selection") {
      clearSelectedElement();
      syncSelectionToAppState(null);
    } else {
      syncSelectionToAppState(null);
    }
  }, [
    readCurrentSlideContentHtml,
    resolveSelectedElement,
    selectElementForStyling,
    freezeElementForFreeformSelection,
    clearSelectedElement,
    syncSelectionToAppState,
  ]);

  /** Enter edit mode on a smart block (text leaf or smart group) */
  const enterInlineEdit = useCallback(
    (el: HTMLElement) => {
      const selector = getBuilderSelector(el);
      el.contentEditable = "true";
      el.setAttribute("data-editing-block", "true");
      // Keep the inspector selection mounted while text is being edited. The
      // inspector is a stable dock, so clearing it here would make the canvas
      // resize and auto-fit again on the second click.
      setSelectedElementMeasurement(null);
      captureInlineEditDraft(slide.id);
      // Mark the deck dirty immediately so SSE/poll refreshes do not replace
      // the deck under an active contentEditable edit, even before the user
      // types and triggers an onUpdateSlide flush.
      onInlineEditStart?.();
      // Don't override the selection. The browser's native double-click
      // word-select (or single-click caret) is already on the element from the
      // user's gesture; re-selecting from JS clobbers it. focus() on an
      // element that already contains the selection preserves it in modern
      // browsers, so it's safe to keep for keyboard delivery.
      el.focus({ preventScroll: true });
      editingElRef.current = el;
      setEditingEl(el);
      if (selector) {
        const item = selectionItemForElement(el, selector);
        syncSelectionToAppState(
          buildSelectionState("editing", [{ ...item, kind: "text" }]),
        );
      }
    },
    [buildSelectionState, captureInlineEditDraft, onInlineEditStart, slide.id],
  );

  // Exit edit mode when switching slides — save pending content first so
  // typing isn't lost when the user clicks a different slide in the sidebar.
  useEffect(() => {
    const previousSlideId = previousSlideIdRef.current;
    if (previousSlideId === slide.id) return;

    const draft = inlineEditDraftRef.current;
    const editing = editingElRef.current;
    if (editing) {
      editing.contentEditable = "false";
      editing.removeAttribute("data-editing-block");
    }
    editingElRef.current = null;
    richTextSelectionRef.current = null;
    setEditingEl(null);

    if (draft?.slideId === previousSlideId) {
      onUpdateSlideRef.current({ content: draft.content }, previousSlideId);
      inlineEditDraftRef.current = null;
    }

    previousSlideIdRef.current = slide.id;
  }, [slide.id]);

  useEffect(() => {
    if (!editingEl) return;
    const editingSlideId = slide.id;
    const handleInput = () => {
      // Markdown-style "- "/"* " at the start of a plain text block converts
      // it into a styled bullet row, so it's recognized as a list and Enter
      // can extend it — contentEditable has no native concept of these
      // styled (non-<ul>) bullet lists.
      convertMarkdownPrefixToBullet(editingEl);
      captureInlineEditDraft(editingSlideId);
    };
    editingEl.addEventListener("input", handleInput);
    return () => editingEl.removeEventListener("input", handleInput);
  }, [captureInlineEditDraft, editingEl, slide.id]);

  useEffect(() => {
    if (!editingEl) return;

    const updateInspectorTextStyle = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount !== 1) return;
      const range = selection.getRangeAt(0);
      if (
        !editingEl.contains(range.startContainer) ||
        !editingEl.contains(range.endContainer)
      ) {
        // Inspector and portalled picker interactions move browser focus away
        // from the slide. Retain the last valid range until the user places a
        // new caret or selection inside this editable.
        return;
      }

      richTextSelectionRef.current = snapshotEditableTextRange(
        editingEl,
        selection,
      );
      const selector = selectedElementSelector ?? getBuilderSelector(editingEl);
      if (!selector) return;
      setSelectedStyleSnapshot(
        buildStyleSnapshot(
          editingEl,
          selector,
          getInlineTextStyleSnapshot(editingEl, selection),
        ),
      );
    };

    updateInspectorTextStyle();
    document.addEventListener("selectionchange", updateInspectorTextStyle);
    return () =>
      document.removeEventListener("selectionchange", updateInspectorTextStyle);
  }, [editingEl, selectedElementSelector]);

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
      (isTextLeaf(editingEl) && RICH_BLOCK_TAGS.has(editingEl.tagName)) ||
      isBulletList(editingEl);
    const onKey = (e: KeyboardEvent) => {
      // Ignore keys from outside the slide (e.g. the style dock's font-size
      // input). Guard against the LIVE slide content, not `editingEl`, which a
      // re-render may have detached — a stale ref would wrongly bail here and
      // let native Enter run.
      const slideContent = getSlideContent();
      if (
        e.target instanceof Node &&
        slideContent &&
        !slideContent.contains(e.target)
      ) {
        return;
      }
      if (e.key === "Enter") {
        // Smart Enter:
        //  - Shift+Enter always inserts a <br>.
        //  - Inside a styled bullet list, Enter clones the current row so a
        //    new bullet (marker + empty text) appears — contentEditable's
        //    native split can't recreate the marker glyph.
        //  - A single <p> or <div> leaf is multi-line capable — Enter
        //    creates a new line via contentEditable's default behavior.
        //  - Headings, inline leaves, and smart groups commit on Enter
        //    so the slide layout can never be broken by a stray new node.
        if (e.shiftKey) return;

        // Re-derive the list from the LIVE caret so a re-render that swapped
        // the edited node can't drop us into native Enter.
        const sel = window.getSelection();
        const anchor = sel?.anchorNode ?? null;
        const anchorEl = anchor
          ? anchor.nodeType === Node.TEXT_NODE
            ? anchor.parentElement
            : (anchor as HTMLElement)
          : null;
        const liveList =
          anchorEl && slideContent && slideContent.contains(anchorEl)
            ? findEnclosingList(anchorEl, slideContent)
            : null;
        if (liveList && insertBulletAfterCaret(liveList)) {
          e.preventDefault();
          captureInlineEditDraft(slide.id);
          return;
        }

        if (!isMultiLineLeaf) {
          e.preventDefault();
          exitInlineEdit();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    exitInlineEdit,
    editingEl,
    captureInlineEditDraft,
    slide.id,
    getSlideContent,
  ]);

  // Click-outside: exit inline edit mode
  useEffect(() => {
    if (!editingEl) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (editingEl.contains(target)) return;
      // Inspector controls and their popovers deliberately preserve the live
      // edit session so a saved text range can receive the chosen formatting.
      if (
        (target as HTMLElement).closest?.(
          "[data-block-bubble-menu], [data-slide-style-trigger], [data-slide-style-dock], [data-slide-inline-edit-surface]",
        )
      ) {
        return;
      }
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

  useLayoutEffect(() => {
    if (
      !selectedElementPath ||
      !selectedElementSelector ||
      !isSelectionOverlayOnActiveSlide(selectedElementSlideId, slide.id)
    ) {
      return;
    }
    if (
      !isSelectionOverlayAutofitSettled(settledAutofitKey, canvasAutofitKey)
    ) {
      // AutoFit changes the element's viewport rect in a rAF. Do not publish
      // pre-fit coordinates into the portal while the renderer is settling.
      setSelectedElementMeasurement(null);
      return;
    }
    let observedElement: HTMLElement | null = null;
    const update = () => {
      const element = resolveSelectedElement();
      if (!element) {
        clearSelectedElement();
        syncSelectionToAppState(null);
        return;
      }
      const inlineTextStyle =
        editingElRef.current === element
          ? getInlineTextStyleSnapshotForRange(
              element,
              richTextSelectionRef.current,
            )
          : undefined;
      const snapshot = buildStyleSnapshot(
        element,
        selectedElementSelector,
        inlineTextStyle,
      );
      setSelectedElementMeasurement({
        key: selectionOverlayMeasurementKey,
        rect: element.getBoundingClientRect(),
      });
      setSelectedStyleSnapshot(snapshot);
      syncSelectionToAppState(
        buildSelectionState(getSlideSelectionMode(snapshot), [
          selectionItemForElement(element, selectedElementSelector, snapshot),
        ]),
      );
    };
    update();

    observedElement = resolveSelectedElement();
    const positioningLayer = observedElement?.closest(
      "[data-fmd-autofit-content], .fmd-slide",
    ) as HTMLElement | null;
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observedElement) resizeObserver?.observe(observedElement);
    if (positioningLayer) resizeObserver?.observe(positioningLayer);
    // Auto-fit writes transform custom properties directly on the layer. Those
    // mutations do not resize the element's CSS box, but they do change its
    // viewport rect, so selection chrome must follow the transformed DOM.
    const mutationObserver =
      typeof MutationObserver === "undefined" || !positioningLayer
        ? null
        : new MutationObserver(() => {
            // The transform has already changed. Drop the old viewport rect
            // before publishing a fresh one so portal chrome cannot paint at
            // the element's pre-AutoFit coordinates.
            setSelectedElementMeasurement(null);
            update();
          });
    if (mutationObserver && positioningLayer) {
      mutationObserver.observe(positioningLayer, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [
    buildSelectionState,
    clearSelectedElement,
    resolveSelectedElement,
    selectedElementPath,
    selectedElementSlideId,
    selectedElementSelector,
    canvasAutofitKey,
    settledAutofitKey,
    selectionOverlayMeasurementKey,
    slide.content,
  ]);

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
      const items: SlideSelectionItem[] = [];
      if (slideContent) {
        ids.forEach((id) => {
          const el = slideContent.querySelector(
            `[data-builder-id="${id}"]`,
          ) as HTMLElement | null;
          if (!el) return;
          const selector = `[data-builder-id="${id}"]`;
          const text = (el.textContent || "").trim().slice(0, 200);
          rects.set(id, { rect: el.getBoundingClientRect(), text, selector });
          items.push(selectionItemForElement(el, selector));
        });
      }
      setMultiSelection(ids);
      setMultiSelectionRects(rects);
      if (ids.size > 0) clearSelectedElement();
      // Anchor the chip to the slide canvas (clickable wrapper)
      const canvas = containerRef.current?.querySelector(
        ".slide-image-clickable",
      ) as HTMLElement | null;
      setChipAnchorRect(canvas?.getBoundingClientRect() || null);
      syncSelectionToAppState(
        items.length > 0 ? buildSelectionState("multi", items) : null,
      );
    },
    [buildSelectionState, clearSelectedElement, getSlideContent],
  );

  const clearMultiSelection = useCallback(() => {
    if (multiSelection.size === 0) return;
    applyMultiSelection(new Set());
  }, [applyMultiSelection, multiSelection.size]);

  /**
   * A group move/paste writes new slide content, which replaces the live DOM
   * (the saved HTML has no data-builder-id attributes — see stripBuilderIds).
   * `multiSelection` is keyed by those transient ids, so it goes stale the
   * instant the content commits. Stash the durable data-slide-object-ids here
   * and re-derive the (freshly stamped) builder ids once the new content has
   * actually rendered, so the on-canvas selection survives its own commit.
   */
  const pendingMultiSelectionResyncRef = useRef<string[] | null>(null);

  const commitMultiObjectChange = useCallback(
    (objectIds: string[]) => {
      pendingMultiSelectionResyncRef.current = objectIds;
      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
    },
    [readCurrentSlideContentHtml],
  );

  useEffect(() => {
    const objectIds = pendingMultiSelectionResyncRef.current;
    pendingMultiSelectionResyncRef.current = null;
    if (!objectIds) {
      // Undo/redo, agent reconciliation, and external updates replace the DOM
      // without preserving transient builder ids. Never leave stale ids in a
      // multi-selection that could later target unrelated newly-stamped nodes.
      applyMultiSelection(new Set());
      return;
    }
    const slideContent = getSlideContent();
    if (!slideContent) return;
    stampBuilderIds(slideContent);
    const ids = new Set<string>();
    for (const objectId of objectIds) {
      const element = findSlideObjectById(slideContent, objectId);
      const builderId = element?.getAttribute("data-builder-id");
      if (builderId) ids.add(builderId);
    }
    applyMultiSelection(ids);
  }, [slide.content, getSlideContent, applyMultiSelection]);

  // One Escape owner for the HTML editor. Radix dialogs/popovers and native
  // form controls retain their own Escape behavior before we arbitrate canvas
  // state. Gesture cancellation is deliberately ahead of selection clearing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target instanceof Element ? e.target : null;
      const editing = editingElRef.current;
      const overlayOwnsEscape = Boolean(
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"]), [role="listbox"]:not([data-state="closed"]), [data-radix-popper-content-wrapper]:not([data-state="closed"])',
        ),
      );
      const targetOwnsEscape = Boolean(
        target?.closest(
          '[role="dialog"], [data-radix-popper-content-wrapper], [data-radix-menu-content]',
        ) ||
        ((target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable)) &&
          !editing?.contains(target)),
      );
      const action = decideSlideEscape({
        editing: Boolean(editing),
        activeGesture: activeGestureCancelRef.current !== null,
        activeMode: Boolean(drawMode || pinMode || textBoxMode),
        multiSelection: multiSelection.size > 0,
        singleSelection: Boolean(selectedElementSelector),
        targetOwnsEscape,
        overlayOwnsEscape,
      });
      if (action === "none" || action === "canvas") return;

      e.preventDefault();
      e.stopImmediatePropagation();
      if (action === "edit") {
        exitInlineEdit();
      } else if (action === "gesture") {
        activeGestureCancelRef.current?.();
      } else if (action === "mode") {
        if (drawMode) onExitDrawMode?.();
        else if (pinMode) onExitPinMode?.();
        else onExitTextBoxMode?.();
      } else if (action === "multi-selection") {
        clearMultiSelection();
      } else {
        clearSelectedElement();
        syncSelectionToAppState(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    clearMultiSelection,
    clearSelectedElement,
    drawMode,
    exitInlineEdit,
    multiSelection.size,
    onExitDrawMode,
    onExitPinMode,
    onExitTextBoxMode,
    pinMode,
    selectedElementSelector,
    textBoxMode,
  ]);

  // Tool state is useful even before the user places an object. This keeps
  // `view-screen` truthful while the text tool is armed and after it exits.
  useEffect(() => {
    if (editingEl || multiSelection.size > 0 || selectedElementSelector) {
      return;
    }
    if (drawMode || pinMode || textBoxMode) {
      syncSelectionToAppState(buildSelectionState("canvas", []));
    } else {
      syncSelectionToAppState(null);
    }
  }, [
    buildSelectionState,
    drawMode,
    editingEl,
    multiSelection.size,
    pinMode,
    selectedElementSelector,
    textBoxMode,
  ]);

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

  const refreshMultiSelectionRects = useCallback(
    (ids: Set<string>) => {
      const slideContent = getSlideContent();
      if (!slideContent) return;
      const next = new Map<
        string,
        { rect: DOMRect; text: string; selector: string }
      >();
      ids.forEach((id) => {
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
    },
    [getSlideContent],
  );

  // Keep cached rects fresh on scroll/resize so outlines + chip stay aligned.
  // Group drag calls the same helper every pointer move so its outlines do not
  // lag behind the objects until the next scroll or resize.
  useEffect(() => {
    if (multiSelection.size === 0) return;
    const update = () => {
      refreshMultiSelectionRects(multiSelection);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [multiSelection, refreshMultiSelectionRects]);

  // Clear multi-selection when slide changes (and clear app state too)
  useLayoutEffect(() => {
    setMultiSelection(new Set());
    setMultiSelectionRects(new Map());
    setChipAnchorRect(null);
    clearSelectedElement();
    syncSelectionToAppState(null);
  }, [clearSelectedElement, slide.id]);

  // Delete/Backspace removes the selected shape/text box (single or
  // multi-select) from the slide. Only active when something is selected for
  // styling (not while inline-editing text, where Backspace should delete a
  // character) and not while the browser focus is in an unrelated input.
  useEffect(() => {
    if (editingEl) return;
    if (multiSelection.size === 0 && !selectedElementSelector) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (active instanceof HTMLElement && active.isContentEditable) return;

      const slideContent = getSlideContent();
      if (!slideContent) return;

      if (multiSelection.size > 0) {
        const selected = Array.from(multiSelection)
          .map(
            (id) =>
              slideContent.querySelector(
                `[data-builder-id="${id}"]`,
              ) as HTMLElement | null,
          )
          .filter((element): element is HTMLElement => element !== null);
        const roots = selected.filter(
          (element) =>
            !selected.some(
              (candidate) =>
                candidate !== element && candidate.contains(element),
            ),
        );
        if (
          roots.length === 0 ||
          roots.some((element) => !isPersistedFreeformObject(element))
        ) {
          return;
        }
        e.preventDefault();
        for (const element of roots) {
          removeSlideObjectAndLayoutSpacer(element);
        }
        clearMultiSelection();
      } else {
        const element = resolveSelectedElement();
        if (!element) return;
        if (isPersistedFreeformObject(element)) {
          e.preventDefault();
          removeSlideObjectAndLayoutSpacer(element);
        } else if (isDeletableFlowImage(element)) {
          e.preventDefault();
          // An imported PPTX/PDF image is an <img> (or placeholder) nested in
          // an absolutely positioned wrapper that carries the persisted object
          // id. Removing only the inner node would leave that wrapper and its
          // durable metadata behind as an invisible ghost object.
          const owner = findPersistedImageObject(element, slideContent);
          if (owner) removeSlideObjectAndLayoutSpacer(owner);
          else element.remove();
          setSelectedImg(null);
          setImageOverlay(null);
        } else {
          return;
        }
        clearSelectedElement();
      }

      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
      syncSelectionToAppState(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    editingEl,
    multiSelection,
    selectedElementSelector,
    getSlideContent,
    clearMultiSelection,
    resolveSelectedElement,
    clearSelectedElement,
    readCurrentSlideContentHtml,
    removeSlideObjectAndLayoutSpacer,
    syncSelectionToAppState,
  ]);

  /**
   * Find the nearest meaningful element for multi-select from a click target.
   * Inline text markup is presentation only, so walk through it to the
   * containing block. The slide-content root itself starts a marquee instead.
   */
  const findSelectableId = useCallback(
    (target: HTMLElement, slideContent: HTMLElement): string | null => {
      let el: HTMLElement | null = target;
      while (el && slideContent.contains(el) && el !== slideContent) {
        if (el.classList.contains("fmd-layout-spacer")) return null;
        if (isInlineTextElement(el)) {
          el = el.parentElement;
          continue;
        }
        const id = el.getAttribute("data-builder-id");
        if (id) return id;
        el = el.parentElement;
      }
      return null;
    },
    [],
  );

  const findSelectableElement = useCallback(
    (target: HTMLElement, slideContent: HTMLElement): HTMLElement | null => {
      let el: HTMLElement | null = target;
      while (el && slideContent.contains(el) && el !== slideContent) {
        if (el.classList.contains("fmd-layout-spacer")) return null;
        if (isInlineTextElement(el)) {
          el = el.parentElement;
          continue;
        }
        if (el.getAttribute("data-builder-id")) return el;
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
      // the slide-content element, OR it's one of the renderer's structural
      // shells. Those shells are not user objects and must remain marquee
      // surfaces rather than becoming draggable freeform objects.
      if (target === slideContent || isSlideCanvasShell(target)) return true;
      return false;
    },
    [],
  );

  /**
   * Return the current selection only when every selected root is a persisted
   * canvas object in one coordinate space. This deliberately refuses mixed
   * flow/freeform and cross-container selections: pretending their local
   * left/top values share a coordinate system would silently corrupt layout.
   */
  const getObjectOperationSelection = useCallback(() => {
    const slideContent = getSlideContent();
    if (!slideContent) return null;

    const selectedElements =
      multiSelection.size > 0
        ? Array.from(multiSelection)
            .map(
              (id) =>
                slideContent.querySelector(
                  `[data-builder-id="${id}"]`,
                ) as HTMLElement | null,
            )
            .filter((element): element is HTMLElement => element !== null)
        : (() => {
            const element = resolveSelectedElement();
            return element ? [element] : [];
          })();
    if (selectedElements.length === 0) return null;

    const roots = selectedElements.filter(
      (element) =>
        !selectedElements.some(
          (candidate) => candidate !== element && candidate.contains(element),
        ),
    );
    if (
      roots.length === 0 ||
      roots.some((element) => !isPersistedFreeformObject(element))
    ) {
      return null;
    }

    const fmdSlide = roots[0].closest(".fmd-slide") as HTMLElement | null;
    if (
      !fmdSlide ||
      roots.some((element) => element.closest(".fmd-slide") !== fmdSlide)
    ) {
      return null;
    }
    const positioningLayer =
      Array.from(fmdSlide.children).find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.hasAttribute("data-fmd-autofit-content"),
      ) ?? fmdSlide;
    const containingBlock = resolveSlideObjectContainingBlock(
      roots[0],
      positioningLayer,
    );
    if (
      roots.some(
        (element) =>
          resolveSlideObjectContainingBlock(element, positioningLayer) !==
          containingBlock,
      )
    ) {
      return null;
    }

    return { elements: roots, positioningLayer, containingBlock };
  }, [getSlideContent, multiSelection, resolveSelectedElement]);

  /**
   * Paste (or duplicate-via-copy+paste) `copied` into the slide, anchored to
   * the same containing block as `anchorElement` (the object that was
   * selected when the shortcut fired) rather than always the slide root, so
   * an object nested inside a positioned group pastes back into that group.
   */
  const pasteSlideObjects = useCallback(
    (copied: CopiedSlideObjects, anchorElement: HTMLElement) => {
      const fmdSlide = containerRef.current?.querySelector(
        ".fmd-slide",
      ) as HTMLElement | null;
      if (!fmdSlide) return;
      const positioningLayer =
        Array.from(fmdSlide.children).find(
          (child): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.hasAttribute("data-fmd-autofit-content"),
        ) ?? fmdSlide;
      const containingBlock = resolveSlideObjectContainingBlock(
        anchorElement,
        positioningLayer,
      );

      const pasted = buildPastedSlideObjects(copied, document);
      if (pasted.length === 0) return;

      const objectIds: string[] = [];
      for (const element of pasted) {
        containingBlock.appendChild(element);
        ensureBuilderId(element);
        stampBuilderIds(element);
        objectIds.push(ensureSlideObjectId(element));
      }

      // A single pasted object gets the richer single-selection treatment
      // (resize handles, style inspector) instead of the multi-select outline.
      if (pasted.length === 1) {
        const selector = getBuilderSelector(pasted[0]);
        if (selector) selectElementForStyling(pasted[0], selector);
        const html = readCurrentSlideContentHtml();
        if (html !== null) onUpdateSlideRef.current({ content: html });
        return;
      }

      const ids = new Set<string>();
      for (const element of pasted) {
        const builderId = element.getAttribute("data-builder-id");
        if (builderId) ids.add(builderId);
      }
      applyMultiSelection(ids);
      commitMultiObjectChange(objectIds);
    },
    [
      applyMultiSelection,
      commitMultiObjectChange,
      readCurrentSlideContentHtml,
      selectElementForStyling,
    ],
  );

  // Object clipboard contents are editor-local. It intentionally does not
  // survive a deck switch, unlike the browser's native text clipboard.
  useEffect(() => {
    copiedObjectClipboardRef.current = null;
  }, [deckId]);

  // One window listener for object copy/paste/duplicate. Native text
  // copy/paste must always win: bail the instant a text edit is active or
  // focus is on any form control, BEFORE touching the clipboard or selection,
  // so ordinary Cmd/Ctrl+C/V/D typing is never hijacked.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v" && key !== "d") return;

      const active = document.activeElement;
      const isTextSurface =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (editingEl || isTextSurface) return;

      const selection = getObjectOperationSelection();
      // Only claim the shortcut for persisted freeform roots which share a
      // containing block. Everything else remains native browser behavior.
      if (!selection) return;

      const copySelection = () => {
        const copied = copySlideObjects(selection.elements);
        const sourceObjectId = selection.elements[0].getAttribute(
          "data-slide-object-id",
        );
        if (!sourceObjectId) return null;
        copiedObjectClipboardRef.current = {
          copied,
          deckId,
          slideId: slide.id,
          sourceObjectId,
        };
        return copiedObjectClipboardRef.current;
      };

      if (key === "c") {
        e.preventDefault();
        copySelection();
        return;
      }

      if (key === "v") {
        const clipboard = copiedObjectClipboardRef.current;
        if (
          !clipboard ||
          clipboard.deckId !== deckId ||
          clipboard.slideId !== slide.id
        ) {
          return;
        }
        const slideContent = getSlideContent();
        const source =
          slideContent &&
          findSlideObjectById(slideContent, clipboard.sourceObjectId);
        if (
          !source ||
          resolveSlideObjectContainingBlock(
            source,
            selection.positioningLayer,
          ) !== selection.containingBlock
        ) {
          return;
        }
        e.preventDefault();
        pasteSlideObjects(clipboard.copied, selection.elements[0]);
        return;
      }

      // Duplicate re-copies the live selection so it duplicates what's
      // currently selected regardless of what's on the clipboard.
      e.preventDefault();
      const clipboard = copySelection();
      if (clipboard) pasteSlideObjects(clipboard.copied, selection.elements[0]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    deckId,
    editingEl,
    getSlideContent,
    getObjectOperationSelection,
    pasteSlideObjects,
    readOnly,
    slide.id,
  ]);

  const placeTextBoxAt = useCallback(
    (clientX: number, clientY: number, target: HTMLElement | null) => {
      const canvas = containerRef.current
        ? ensureSlideTextBoxCanvas(containerRef.current)
        : null;
      if (!canvas) return;
      const { fmdSlide, positioningLayer } = canvas;
      const rect = positioningLayer.getBoundingClientRect();
      const { x, y } = clientPointToSlideCoordinates(
        clientX,
        clientY,
        rect,
        positioningLayer.offsetWidth,
        positioningLayer.offsetHeight,
      );

      if (getComputedStyle(fmdSlide).position === "static") {
        fmdSlide.style.position = "relative";
      }

      const box = document.createElement("div");
      box.className = "fmd-text-box";
      ensureSlideObjectId(box);
      ensureBuilderId(box);
      box.style.position = "absolute";
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = "320px";
      box.style.fontSize = "24px";
      box.style.color = getSlideTextBoxDefaultColor(target, positioningLayer);
      box.style.fontFamily = "'Poppins', sans-serif";
      box.style.lineHeight = "1.3";
      box.textContent = ZERO_WIDTH_SPACE;
      positioningLayer.appendChild(box);

      enterInlineEdit(box);

      // el.focus() alone doesn't reliably place the caret inside a freshly
      // created contentEditable node across browsers — set it explicitly on
      // the placeholder text so typing lands immediately.
      const textNode = box.firstChild;
      if (textNode) {
        const range = document.createRange();
        range.setStart(textNode, textNode.textContent?.length ?? 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    },
    [enterInlineEdit],
  );

  const getObjectGeometry = useCallback(
    (element: HTMLElement): SlideObjectGeometry => ({
      x: element.offsetLeft,
      y: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    }),
    [],
  );

  const applyObjectGeometry = useCallback(
    (element: HTMLElement, geometry: SlideObjectGeometry) => {
      element.style.left = `${geometry.x}px`;
      element.style.top = `${geometry.y}px`;
      element.style.width = `${geometry.width}px`;
      element.style.height = `${geometry.height}px`;
    },
    [],
  );

  const startElementDrag = useCallback(
    (
      e: React.PointerEvent,
      element: HTMLElement,
      {
        preserveClickWithoutMove = false,
      }: { preserveClickWithoutMove?: boolean } = {},
    ) => {
      if (readOnly) return;
      const slideCanvas = element.closest(
        ".fmd-slide, [data-slide-canvas]",
      ) as HTMLElement | null;
      if (!slideCanvas) return;

      const slideRect = slideCanvas.getBoundingClientRect();
      const slideWidth = slideCanvas.offsetWidth;
      const slideHeight = slideCanvas.offsetHeight;
      if (
        !slideRect.width ||
        !slideRect.height ||
        !slideWidth ||
        !slideHeight
      ) {
        return;
      }

      // Pointer-down on the selection perimeter is a move gesture, never a
      // text caret placement. A selected object's body, however, has to keep
      // an unmoved click available for inline editing. In that case wait until
      // movement crosses the drag threshold before consuming its click.
      if (!preserveClickWithoutMove) {
        e.preventDefault();
        e.stopPropagation();
        suppressNextClickRef.current = true;
      }

      const initiallyAbsolute =
        getComputedStyle(element).position === "absolute";
      let origin = initiallyAbsolute ? getObjectGeometry(element) : null;
      const originalObjectId = element.getAttribute("data-slide-object-id");
      const originalClassName = element.className;
      const originalStyle = element.getAttribute("style");
      const originalContentEditable = element.getAttribute("contenteditable");
      const originalEditingBlock = element.getAttribute("data-editing-block");
      let activeElement = element;
      let clone: HTMLElement | null = null;
      let restoreMarkdownTree: (() => void) | undefined;
      let promotedToFreeform = false;

      const promoteForDrag = () => {
        if (origin) return true;
        const frozen = freezeElementForFreeformSelection(element);
        if (!frozen) {
          return false;
        }
        restoreMarkdownTree = frozen.restoreMarkdownTree;
        if (getComputedStyle(element).position !== "absolute") {
          restoreMarkdownTree?.();
          restoreMarkdownTree = undefined;
          return false;
        }
        promotedToFreeform = true;
        origin = getObjectGeometry(element);
        return true;
      };

      const removeFreeformLayoutSpacer = () => {
        const objectId = element.getAttribute("data-slide-object-id");
        if (!objectId) return;
        const spacer = Array.from(
          element.parentElement?.querySelectorAll<HTMLElement>(
            "[data-slide-layout-spacer-for]",
          ) ?? [],
        ).find(
          (candidate) =>
            candidate.getAttribute("data-slide-layout-spacer-for") === objectId,
        );
        spacer?.remove();
      };

      const restorePromotedElement = () => {
        removeFreeformLayoutSpacer();
        restoreMarkdownTree?.();
        if (!restoreMarkdownTree) {
          element.className = originalClassName;
          if (originalStyle === null) element.removeAttribute("style");
          else element.setAttribute("style", originalStyle);
          if (originalContentEditable === null) {
            element.removeAttribute("contenteditable");
          } else {
            element.setAttribute("contenteditable", originalContentEditable);
          }
          if (originalEditingBlock === null) {
            element.removeAttribute("data-editing-block");
          } else {
            element.setAttribute("data-editing-block", originalEditingBlock);
          }
        }
        if (originalObjectId) {
          element.setAttribute("data-slide-object-id", originalObjectId);
        } else {
          element.removeAttribute("data-slide-object-id");
        }
      };

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (activeGestureCancelRef.current === onCancel) {
          activeGestureCancelRef.current = null;
        }
      };

      const restore = () => {
        if (clone) {
          clone.remove();
        }
        if (promotedToFreeform) {
          restorePromotedElement();
        } else {
          if (!clone && origin) applyObjectGeometry(element, origin);
          if (originalObjectId) {
            element.setAttribute("data-slide-object-id", originalObjectId);
          } else {
            element.removeAttribute("data-slide-object-id");
          }
        }
        const selector = getBuilderSelector(element);
        if (selector) selectElementForStyling(element, selector);
      };

      const controller = createSlidesCanvasGestureController({
        preview: (gesture) => {
          if (!promoteForDrag()) {
            return { handled: false, reason: "unhandled" };
          }
          const dragOrigin = origin;
          if (!dragOrigin) {
            return { handled: false, reason: "unhandled" };
          }
          // React still receives a click after a pointer drag. Suppress that
          // trailing click so a moved text box does not immediately reopen
          // inline editing.
          suppressNextClickRef.current = true;
          ensureSlideObjectId(element);
          if (!clone && gesture.duplicate) {
            clone = cloneSlideObject(element);
            element.after(clone);
            ensureBuilderId(clone);
            stampBuilderIds(clone);
            activeElement = clone;
          }
          applyObjectGeometry(activeElement, {
            ...dragOrigin,
            x: dragOrigin.x + gesture.canvasDelta.x,
            y: dragOrigin.y + gesture.canvasDelta.y,
          });
          const selector = getBuilderSelector(activeElement);
          if (selector) selectElementForStyling(activeElement, selector);
          return { handled: true };
        },
        commit: (gesture) => {
          if (!origin) {
            restore();
            return { handled: false, reason: "unhandled" };
          }
          // Keeping Option pressed is the explicit duplicate commit. If it
          // was released before drop, turn the gesture back into a normal move.
          if (clone && !gesture.duplicate) {
            applyObjectGeometry(element, getObjectGeometry(clone));
            clone.remove();
            activeElement = element;
          }
          const html = readCurrentSlideContentHtml();
          // Markdown slides temporarily move their ReactMarkdown children into
          // an fmd canvas during promotion. Restore that live tree after
          // serialization and before the state write so React can reconcile
          // the switch to persisted raw HTML cleanly.
          if (restoreMarkdownTree) {
            removeFreeformLayoutSpacer();
            restoreMarkdownTree();
            restoreMarkdownTree = undefined;
          }
          if (html !== null) {
            onUpdateSlideRef.current({ content: html }, undefined, {
              persistence: "immediate",
            });
          }
          const selector = getBuilderSelector(activeElement);
          if (selector) selectElementForStyling(activeElement, selector);
          return { handled: true };
        },
        cancel: () => {
          restore();
          return { handled: true };
        },
      });
      controller.pointerDown({
        kind: "move",
        objectIds: [originalObjectId ?? getBuilderSelector(element) ?? ""],
        pointer: {
          x: e.clientX,
          y: e.clientY,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        },
        viewport: slideRect,
        canvas: { width: slideWidth, height: slideHeight },
      });

      const onMove = (moveEvent: PointerEvent) => {
        const update = controller.pointerMove({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          shiftKey: moveEvent.shiftKey,
          altKey: moveEvent.altKey,
          metaKey: moveEvent.metaKey,
          ctrlKey: moveEvent.ctrlKey,
        });
        if (update.phase !== "active") return;
        moveEvent.preventDefault();
      };

      const onUp = (upEvent: PointerEvent) => {
        stop();
        const result = controller.pointerUp({
          x: upEvent.clientX,
          y: upEvent.clientY,
          shiftKey: upEvent.shiftKey,
          altKey: upEvent.altKey,
          metaKey: upEvent.metaKey,
          ctrlKey: upEvent.ctrlKey,
        });
        if (!result.committed) {
          if (preserveClickWithoutMove) return;
          // Pointer-up can occur outside the canvas, where React will not see
          // the click that normally clears this flag.
          window.setTimeout(function clearEdgeClickSuppression() {
            suppressNextClickRef.current = false;
          }, 0);
          return;
        }
        // A drag does not always produce a click (for example when released
        // outside the canvas), so do not leave the one-click suppression
        // armed for the user's next unrelated action.
        window.setTimeout(function clearDragClickSuppression() {
          suppressNextClickRef.current = false;
        }, 0);
      };

      const onCancel = () => {
        stop();
        suppressNextClickRef.current = false;
        controller.cancel();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      activeGestureCancelRef.current = onCancel;
    },
    [
      applyObjectGeometry,
      getObjectGeometry,
      readCurrentSlideContentHtml,
      readOnly,
      selectElementForStyling,
    ],
  );

  const startElementResize = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (readOnly) return;
      const element = resolveSelectedElement();
      const slideCanvas = element?.closest(
        ".fmd-slide, [data-slide-canvas]",
      ) as HTMLElement | null;
      if (
        !element ||
        !slideCanvas ||
        getComputedStyle(element).position !== "absolute"
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const slideRect = slideCanvas.getBoundingClientRect();
      const slideWidth = slideCanvas.offsetWidth;
      const slideHeight = slideCanvas.offsetHeight;
      if (
        !slideRect.width ||
        !slideRect.height ||
        !slideWidth ||
        !slideHeight
      ) {
        return;
      }

      const origin = getObjectGeometry(element);
      const originalObjectId = element.getAttribute("data-slide-object-id");
      const selector = getBuilderSelector(element);
      if (selector) selectElementForStyling(element, selector, "resizing");

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (activeGestureCancelRef.current === onCancel) {
          activeGestureCancelRef.current = null;
        }
      };

      const controller = createSlidesCanvasGestureController({
        preview: (gesture) => {
          if (gesture.kind !== "resize")
            return { handled: false, reason: "unhandled" };
          ensureSlideObjectId(element);
          applyObjectGeometry(element, gesture.rect);
          const currentSelector = getBuilderSelector(element);
          if (currentSelector) {
            selectElementForStyling(element, currentSelector, "resizing");
          }
          return { handled: true };
        },
        commit: () => {
          const currentSelector = getBuilderSelector(element);
          if (currentSelector)
            selectElementForStyling(element, currentSelector);
          const html = readCurrentSlideContentHtml();
          if (html !== null) {
            onUpdateSlideRef.current({ content: html }, undefined, {
              persistence: "immediate",
            });
          }
          return { handled: true };
        },
        cancel: () => {
          applyObjectGeometry(element, origin);
          if (originalObjectId) {
            element.setAttribute("data-slide-object-id", originalObjectId);
          } else {
            element.removeAttribute("data-slide-object-id");
          }
          const currentSelector = getBuilderSelector(element);
          if (currentSelector)
            selectElementForStyling(element, currentSelector);
          return { handled: true };
        },
      });
      controller.pointerDown({
        kind: "resize",
        objectIds: [originalObjectId ?? selector ?? ""],
        pointer: {
          x: e.clientX,
          y: e.clientY,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        },
        viewport: slideRect,
        canvas: { width: slideWidth, height: slideHeight },
        handle,
        rect: origin,
      });

      const onMove = (moveEvent: PointerEvent) => {
        const update = controller.pointerMove({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          shiftKey: moveEvent.shiftKey,
          altKey: moveEvent.altKey,
          metaKey: moveEvent.metaKey,
          ctrlKey: moveEvent.ctrlKey,
        });
        if (update.phase === "active") moveEvent.preventDefault();
      };

      const onUp = (upEvent: PointerEvent) => {
        stop();
        const result = controller.pointerUp({
          x: upEvent.clientX,
          y: upEvent.clientY,
          shiftKey: upEvent.shiftKey,
          altKey: upEvent.altKey,
          metaKey: upEvent.metaKey,
          ctrlKey: upEvent.ctrlKey,
        });
        const currentSelector = getBuilderSelector(element);
        if (currentSelector) selectElementForStyling(element, currentSelector);
        if (!result.committed) return;
      };

      const onCancel = () => {
        stop();
        controller.cancel();
        const currentSelector = getBuilderSelector(element);
        if (currentSelector) selectElementForStyling(element, currentSelector);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      activeGestureCancelRef.current = onCancel;
    },
    [
      applyObjectGeometry,
      getObjectGeometry,
      readCurrentSlideContentHtml,
      readOnly,
      resolveSelectedElement,
      selectElementForStyling,
    ],
  );

  /**
   * Same gesture shape as startElementDrag (2px threshold, Shift axis lock,
   * commit-once-on-pointerup, Escape-cancel restore), but moves every
   * absolutely-positioned member of the multi-selection by one shared delta
   * instead of a single element.
   */
  const startGroupDrag = useCallback(
    (e: React.PointerEvent, ids: Set<string>) => {
      if (readOnly) return;
      const slideContent = getSlideContent();
      if (!slideContent) return;
      const elements = Array.from(ids)
        .map(
          (id) =>
            slideContent.querySelector(
              `[data-builder-id="${id}"]`,
            ) as HTMLElement | null,
        )
        .filter((el): el is HTMLElement => el !== null);
      if (elements.some((element) => !isPersistedFreeformObject(element))) {
        return;
      }
      const members = collectMovableSlideObjects(elements, getObjectGeometry);
      if (members.length === 0) return;

      // Resolve the slide from a member, the way startElementDrag does.
      // `.fmd-slide` is a DESCENDANT of `.slide-content`, so walking up from
      // the container never finds it and the whole gesture aborts silently.
      const fmdSlide = members[0].element.closest(
        ".fmd-slide",
      ) as HTMLElement | null;
      if (!fmdSlide) return;
      const positioningLayer =
        Array.from(fmdSlide.children).find(
          (child): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.hasAttribute("data-fmd-autofit-content"),
        ) ?? fmdSlide;
      const containingBlock = resolveSlideObjectContainingBlock(
        members[0].element,
        positioningLayer,
      );
      if (
        members.some(
          (member) =>
            member.element.closest(".fmd-slide") !== fmdSlide ||
            resolveSlideObjectContainingBlock(
              member.element,
              positioningLayer,
            ) !== containingBlock,
        )
      ) {
        return;
      }
      const slideRect = fmdSlide.getBoundingClientRect();
      const slideWidth = fmdSlide.offsetWidth;
      const slideHeight = fmdSlide.offsetHeight;
      if (
        !slideRect.width ||
        !slideRect.height ||
        !slideWidth ||
        !slideHeight
      ) {
        return;
      }

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (activeGestureCancelRef.current === onCancel) {
          activeGestureCancelRef.current = null;
        }
      };

      const controller = createSlidesCanvasGestureController({
        preview: (gesture) => {
          // Claim the click only once a real drag starts, so a click without
          // movement on a multi-selected object remains normal editor input.
          suppressNextClickRef.current = true;
          applySlideObjectMoveDelta(
            members,
            gesture.canvasDelta.x,
            gesture.canvasDelta.y,
            applyObjectGeometry,
          );
          refreshMultiSelectionRects(ids);
          return { handled: true };
        },
        commit: () => {
          commitMultiObjectChange(members.map((member) => member.objectId));
          return { handled: true };
        },
        cancel: () => {
          applySlideObjectMoveDelta(members, 0, 0, applyObjectGeometry);
          refreshMultiSelectionRects(ids);
          return { handled: true };
        },
      });
      controller.pointerDown({
        kind: "move",
        objectIds: members.map((member) => member.objectId),
        pointer: {
          x: e.clientX,
          y: e.clientY,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        },
        viewport: slideRect,
        canvas: { width: slideWidth, height: slideHeight },
      });

      const onMove = (moveEvent: PointerEvent) => {
        const update = controller.pointerMove({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          shiftKey: moveEvent.shiftKey,
          altKey: moveEvent.altKey,
          metaKey: moveEvent.metaKey,
          ctrlKey: moveEvent.ctrlKey,
        });
        if (update.phase === "active") moveEvent.preventDefault();
      };

      const onUp = (upEvent: PointerEvent) => {
        stop();
        const result = controller.pointerUp({
          x: upEvent.clientX,
          y: upEvent.clientY,
          shiftKey: upEvent.shiftKey,
          altKey: upEvent.altKey,
          metaKey: upEvent.metaKey,
          ctrlKey: upEvent.ctrlKey,
        });
        if (!result.committed) {
          window.setTimeout(function clearEdgeClickSuppression() {
            suppressNextClickRef.current = false;
          }, 0);
          return;
        }
        window.setTimeout(function clearDragClickSuppression() {
          suppressNextClickRef.current = false;
        }, 0);
      };

      const onCancel = () => {
        stop();
        suppressNextClickRef.current = false;
        controller.cancel();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      activeGestureCancelRef.current = onCancel;
    },
    [
      applyObjectGeometry,
      commitMultiObjectChange,
      refreshMultiSelectionRects,
      getObjectGeometry,
      getSlideContent,
      readOnly,
    ],
  );

  useEffect(() => {
    if (readOnly || editingEl) return;
    if (multiSelection.size === 0 && !selectedElementSelector) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Arrow")) return;
      const active = document.activeElement;
      if (
        active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        active?.tagName === "SELECT" ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      const nudge = slidesCanvasInteractionCore.nudge(e);
      if (!nudge) return;
      const { x: dx, y: dy } = nudge.delta;

      if (multiSelection.size > 0) {
        const slideContent = getSlideContent();
        if (!slideContent) return;
        const elements = Array.from(multiSelection)
          .map(
            (id) =>
              slideContent.querySelector(
                `[data-builder-id="${id}"]`,
              ) as HTMLElement | null,
          )
          .filter((el): el is HTMLElement => el !== null);
        if (elements.some((element) => !isPersistedFreeformObject(element))) {
          return;
        }
        const members = collectMovableSlideObjects(elements, getObjectGeometry);
        if (members.length === 0) return;
        const fmdSlide = members[0].element.closest(
          ".fmd-slide",
        ) as HTMLElement | null;
        if (!fmdSlide) return;
        const positioningLayer =
          Array.from(fmdSlide.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement &&
              child.hasAttribute("data-fmd-autofit-content"),
          ) ?? fmdSlide;
        const containingBlock = resolveSlideObjectContainingBlock(
          members[0].element,
          positioningLayer,
        );
        if (
          members.some(
            (member) =>
              member.element.closest(".fmd-slide") !== fmdSlide ||
              resolveSlideObjectContainingBlock(
                member.element,
                positioningLayer,
              ) !== containingBlock,
          )
        ) {
          return;
        }
        e.preventDefault();
        applySlideObjectMoveDelta(members, dx, dy, applyObjectGeometry);
        refreshMultiSelectionRects(multiSelection);
        commitMultiObjectChange(members.map((member) => member.objectId));
        return;
      }

      const element = resolveSelectedElement();
      if (!element || !isPersistedFreeformObject(element)) return;
      e.preventDefault();
      const geometry = getObjectGeometry(element);
      geometry.x += dx;
      geometry.y += dy;
      applyObjectGeometry(element, geometry);
      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
      const selector = getBuilderSelector(element);
      if (selector) selectElementForStyling(element, selector);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    applyObjectGeometry,
    commitMultiObjectChange,
    editingEl,
    getObjectGeometry,
    getSlideContent,
    multiSelection,
    readCurrentSlideContentHtml,
    readOnly,
    refreshMultiSelectionRects,
    resolveSelectedElement,
    selectElementForStyling,
    selectedElementSelector,
  ]);

  // --- Marquee drag handlers (attached to slide-content via React props) ---

  const clearEdgeMoveCursor = useCallback(() => {
    if (slideCanvasRef.current) slideCanvasRef.current.style.cursor = "";
  }, []);

  const handleSlidePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (editingEl || readOnly) {
        clearEdgeMoveCursor();
        return;
      }
      const selected = resolveSelectedElement();
      const shouldShowMoveCursor =
        selected !== null &&
        !isSlideCanvasShell(selected) &&
        isWithinSlidesCanvasEdgeMoveBand(
          selected.getBoundingClientRect(),
          e.clientX,
          e.clientY,
        );
      if (slideCanvasRef.current) {
        slideCanvasRef.current.style.cursor = shouldShowMoveCursor
          ? "move"
          : "";
      }
    },
    [clearEdgeMoveCursor, editingEl, readOnly, resolveSelectedElement],
  );

  const handleSlidePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // left click only
      const slideContent = getSlideContent();
      if (!slideContent) return;
      const target = e.target as HTMLElement;

      if (textBoxMode) {
        // Unlike the marquee/select flow below, the text-box tool places a
        // box on the very next click no matter what it lands on (mirroring
        // Google Slides / PowerPoint). Gating this on "whitespace" left the
        // tool silently stuck on when a click landed on existing text —
        // editing that text worked, but the tool state never cleared, so an
        // unrelated later click would unexpectedly drop a new box.
        e.preventDefault();
        if (editingEl) exitInlineEdit();
        suppressNextClickRef.current = true;
        placeTextBoxAt(e.clientX, e.clientY, target);
        onExitTextBoxMode?.();
        return;
      }
      if (editingEl) return; // avoid interfering with an active inline edit

      // Pointer-down on a member of the current multi-selection drags the
      // whole group instead of the single-object flow below.
      if (multiSelection.size > 0) {
        const id = findSelectableId(target, slideContent);
        if (id && multiSelection.has(id)) {
          startGroupDrag(e, multiSelection);
          return;
        }
      }

      const selected = resolveSelectedElement();
      const clicked = findSelectableElement(target, slideContent);
      const dragTarget = resolveSlidesCanvasDragTarget(
        selected && !isSlideCanvasShell(selected) ? selected : null,
        clicked && !isSlideCanvasShell(clicked) ? clicked : null,
      );
      const pointerIntent = resolveSlidesCanvasPointerIntent({
        hasSelectedObject: dragTarget !== null,
        targetWithinSelectedObject: dragTarget?.contains(target) ?? false,
        targetContainsSelectedObject: dragTarget
          ? target.contains(dragTarget)
          : false,
        pointerWithinMoveBand:
          dragTarget !== null &&
          isWithinSlidesCanvasEdgeMoveBand(
            dragTarget.getBoundingClientRect(),
            e.clientX,
            e.clientY,
          ),
        targetIsEditableText: Boolean(findSmartBlock(target, slideContent)),
      });
      if (
        dragTarget &&
        (pointerIntent === "move-object-body" ||
          pointerIntent === "move-object-perimeter")
      ) {
        startElementDrag(e, dragTarget, {
          preserveClickWithoutMove: pointerIntent === "move-object-body",
        });
        return;
      }

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
      if (!marqueeAdditiveRef.current) {
        clearSelectedElement();
        syncSelectionToAppState(null);
        if (multiSelection.size > 0) {
          applyMultiSelection(new Set());
        }
      }
    },
    [
      editingEl,
      findSelectableId,
      getSlideContent,
      isSlideWhitespaceTarget,
      multiSelection,
      applyMultiSelection,
      clearSelectedElement,
      textBoxMode,
      exitInlineEdit,
      placeTextBoxAt,
      onExitTextBoxMode,
      resolveSelectedElement,
      startElementDrag,
      startGroupDrag,
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
        if (el.classList.contains("fmd-layout-spacer")) return;
        if (isInlineTextElement(el)) return;
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

  // Browsers put the dragged element's outerHTML on the "text/html" data
  // type. Sniffing specifically for an <img> tag there (rather than trusting
  // any URL on text/uri-list or text/plain) matters because those same types
  // are also populated when dragging a plain link — e.g. a citation or CTA
  // button in the agent chat panel — and that URL is not an image. Without
  // this check, dragging any link onto a slide would replace/insert a broken
  // image.
  const extractDraggedImageUrl = useCallback(
    (dataTransfer: DataTransfer): string | null => {
      const html = dataTransfer.getData("text/html");
      if (!html) return null;
      // Parse instead of regex-matching the raw src attribute text: the
      // browser HTML-entity-escapes "&" (and other characters) when
      // serializing outerHTML for the drag payload, so a signed CDN URL like
      // "...?format=webp&width=800&height=1200" would come through as
      // "...&amp;width=..." if read verbatim. getAttribute() returns the
      // already-decoded value.
      const img = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("img");
      const url = img?.getAttribute("src") || null;
      return url && /^https?:\/\//i.test(url) ? url : null;
    },
    [],
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
      ) ||
      // Dragging a rendered <img> (e.g. a generated-image preview in the
      // agent chat panel) rather than a native OS file. dragover can't read
      // getData() payloads (only types) in most browsers, so this is a
      // best-effort signal; the drop handler does the real <img> check.
      (types.includes("text/html") && types.includes("text/uri-list"));
    if (!hasImage) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleSlideDrop = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files ?? []);
      const file = files.find(imageFileLooksSupported);
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        if (!file) return;
        onDropImage?.(
          getImageReplacementTarget(e.target as HTMLElement),
          file,
          { x: e.clientX, y: e.clientY },
        );
        return;
      }
      // No native file — check for a dragged <img> instead (e.g. one dragged
      // out of the agent chat panel's generated-image preview).
      const url = extractDraggedImageUrl(e.dataTransfer);
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      onDropImageUrl?.(
        getImageReplacementTarget(e.target as HTMLElement),
        url,
        {
          x: e.clientX,
          y: e.clientY,
        },
      );
    },
    [
      extractDraggedImageUrl,
      getImageReplacementTarget,
      onDropImage,
      onDropImageUrl,
    ],
  );

  const clearCanvasSelection = useCallback(() => {
    if (editingEl) exitInlineEdit();
    if (multiSelection.size > 0) clearMultiSelection();
    setSelectedImg(null);
    setImageOverlay(null);
    clearSelectedElement();
    syncSelectionToAppState(null);
  }, [
    clearMultiSelection,
    clearSelectedElement,
    editingEl,
    exitInlineEdit,
    multiSelection.size,
  ]);

  const handleSlideClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

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
        clearCanvasSelection();
        return;
      }

      // --- Plain click on an element → drop multi-selection back to single,
      // then run the existing single-select / style-editing flow.
      if (multiSelection.size > 0) clearMultiSelection();

      showImageOverlay(target);

      // For editable text, a single click edits the whole smart block (a text
      // leaf, or an entire bullet list) — not the individual line — so typing,
      // highlighting, shortcuts, and Enter-to-add-bullet all work, and the
      // style dock targets the same block being edited.
      if (!readOnly && slideContent) {
        const block = findSmartBlock(target, slideContent);
        if (
          block &&
          slidesCanvasInteractionCore.textActivation({
            clickCount: 1,
            textEditable: true,
          }) === "edit"
        ) {
          const blockSelector = getBuilderSelector(block);
          if (blockSelector) {
            selectElementForStyling(block, blockSelector);
            enterSelectionMode("agentNative.enterStyleEditing", {
              selector: blockSelector,
            });
          }
          enterInlineEdit(block);
          return;
        }
      }

      // Non-text elements (images, shapes, …): select the clicked element for
      // styling.
      const selectableEl = slideContent
        ? findSelectableElement(target, slideContent)
        : null;
      const selector = selectableEl ? getBuilderSelector(selectableEl) : null;
      if (selector && selectableEl) {
        selectElementForStyling(selectableEl, selector);
        enterSelectionMode("agentNative.enterStyleEditing", { selector });
      }
    },
    [
      showImageOverlay,
      editingEl,
      getSlideContent,
      findSelectableId,
      findSelectableElement,
      isSlideWhitespaceTarget,
      multiSelection,
      applyMultiSelection,
      clearMultiSelection,
      clearCanvasSelection,
      selectElementForStyling,
      readOnly,
      isHtmlSlide,
      enterInlineEdit,
    ],
  );

  const handleCanvasBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && slideCanvasRef.current?.contains(target)) return;
      clearCanvasSelection();
    },
    [clearCanvasSelection],
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

  const preserveRichTextSelection = useCallback(() => {
    const editing = editingElRef.current;
    const selection = window.getSelection();
    if (!editing || !selection || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    if (
      editing.contains(range.startContainer) &&
      editing.contains(range.endContainer)
    ) {
      richTextSelectionRef.current = snapshotEditableTextRange(
        editing,
        selection,
      );
    }
  }, []);

  const applySelectedStylePatch = useCallback(
    (patch: SlideStylePatch) => {
      const editing = editingElRef.current;
      const element = editing ?? resolveSelectedElement();
      if (!element || !selectedElementSelector) return;

      const inlinePatch = inlineInspectorStylePatch(patch);
      const inlineKeys = INLINE_INSPECTOR_STYLE_KEYS.filter(
        (key) => patch[key] !== undefined,
      );
      let styledRange = false;
      const savedRange =
        richTextSelectionRef.current ??
        (editing ? snapshotEditableTextRange(editing) : null);
      if (
        editing &&
        inlineKeys.length > 0 &&
        restoreEditableTextRange(editing, savedRange)
      ) {
        const result = applyInlineTextStyle(editing, inlinePatch);
        if (result.scope === "selection" && result.range) {
          richTextSelectionRef.current = result.range.cloneRange();
          styledRange = true;
        }
      }

      if (!styledRange && inlineKeys.length > 0) {
        applyDescendantTextStyle(element, inlinePatch);
      }

      for (const [property, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (
          styledRange &&
          INLINE_INSPECTOR_STYLE_KEYS.includes(
            property as (typeof INLINE_INSPECTOR_STYLE_KEYS)[number],
          )
        ) {
          continue;
        }
        element.style.setProperty(stylePropertyName(property), value);
      }

      if (
        patch.borderWidth &&
        patch.borderWidth !== "0" &&
        patch.borderWidth !== "0px" &&
        window.getComputedStyle(element).borderStyle === "none"
      ) {
        element.style.borderStyle = "solid";
      }

      if (editing) {
        captureInlineEditDraft(slide.id);
      } else {
        const html = readCurrentSlideContentHtml();
        if (html !== null) {
          onUpdateSlideRef.current({ content: html });
        }
      }

      const inlineTextStyle = editing
        ? getInlineTextStyleSnapshotForRange(
            editing,
            richTextSelectionRef.current,
          )
        : undefined;
      const snapshot = buildStyleSnapshot(
        element,
        selectedElementSelector,
        inlineTextStyle,
      );
      if (!editing) {
        invalidateSelectionOverlayMeasurement();
      }
      setSelectedStyleSnapshot(snapshot);
      if (!editing) {
        syncSelectionToAppState(
          buildSelectionState(getSlideSelectionMode(snapshot), [
            selectionItemForElement(element, selectedElementSelector, snapshot),
          ]),
        );
      }
    },
    [
      buildSelectionState,
      captureInlineEditDraft,
      invalidateSelectionOverlayMeasurement,
      readCurrentSlideContentHtml,
      resolveSelectedElement,
      selectedElementSelector,
      slide.id,
    ],
  );

  /** Bring-to-front / send-to-back for the selected freeform object. */
  const handleArrangeSelected = useCallback(
    (target: SlideObjectZOrderTarget) => {
      const element = resolveSelectedElement();
      if (!element) return;
      const fmdSlide = element.closest(".fmd-slide") as HTMLElement | null;
      const positioningLayer = fmdSlide
        ? (Array.from(fmdSlide.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement &&
              child.hasAttribute("data-fmd-autofit-content"),
          ) ?? fmdSlide)
        : null;
      if (!positioningLayer) return;

      const containingBlock = resolveSlideObjectContainingBlock(
        element,
        positioningLayer,
      );
      const change = computeSlideObjectZOrder(element, containingBlock, target);
      if (!change) return;

      element.style.zIndex = String(change.value);
      for (const shift of change.shiftPeers) {
        shift.element.style.zIndex = String(shift.value);
      }

      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
      const selector = getBuilderSelector(element);
      if (selector) selectElementForStyling(element, selector);
    },
    [
      readCurrentSlideContentHtml,
      resolveSelectedElement,
      selectElementForStyling,
    ],
  );

  /** Bullet / numbered list toggle for the selected text object. */
  const handleToggleList = useCallback(
    (kind: SlideListKind) => {
      const target = editingElRef.current ?? resolveSelectedElement();
      if (!target) return;
      // Editing one item still means "this list". Converting the LI itself
      // would build a second list inside it instead of toggling the one it
      // already belongs to.
      const parentList =
        target.tagName === "LI" ? target.closest("ul, ol") : null;
      const element = (parentList as HTMLElement | null) ?? target;

      const editing = editingElRef.current;
      const converted = toggleSlideList(element, kind);
      if (!converted) return;

      // Conversions retag and replace nodes, so an active edit can be left
      // pointing at a node that is no longer in the page. Move it onto the
      // element that replaced it rather than silently writing into nothing.
      if (editing && !editing.isConnected) {
        converted.contentEditable = "true";
        converted.setAttribute("data-editing-block", "true");
        editingElRef.current = converted;
        setEditingEl(converted);
        converted.focus({ preventScroll: true });
      }

      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
      const selector = getBuilderSelector(converted);
      if (selector) selectElementForStyling(converted, selector);
    },
    [
      readCurrentSlideContentHtml,
      resolveSelectedElement,
      selectElementForStyling,
    ],
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

  const slideElementSelected =
    !!selectedImg || !!editingEl || !!selectedStyleSnapshot;

  // Resize handles are only offered for elements with position: absolute.
  // Flow objects become absolute only after a real drag crosses the gesture
  // threshold, so a stationary click keeps its existing edit/select behavior.
  const selectedForDrag =
    selectedElementRect && !editingEl ? resolveSelectedElement() : null;
  const isSelectedElementDraggable = selectedForDrag
    ? getComputedStyle(selectedForDrag).position === "absolute"
    : false;
  // Excalidraw slides have no selectable slide content, so the row collapses
  // to its slide-level state — but that state owns the background picker, and
  // SlideRenderer paints `slide.background` behind the drawing, so the row has
  // to stay mounted or that background becomes uneditable.
  const contextToolbar = !readOnly ? (
    <div
      className="shrink-0"
      // Snapshotting the range is only half the job: without this marker the
      // click-outside handler exits the edit and clears the snapshot before
      // the button's onClick runs, so partial-text formatting would silently
      // apply to the whole object.
      data-slide-inline-edit-surface="true"
      data-slide-context-toolbar-placement="row"
      onPointerDownCapture={preserveRichTextSelection}
    >
      <SlideContextToolbar
        snapshot={selectedStyleSnapshot}
        background={slide.background}
        designSystem={designSystem}
        leading={contextToolbarLeading}
        onChange={applySelectedStylePatch}
        onBackgroundChange={applySlideBackground}
        onArrange={handleArrangeSelected}
        onToggleList={handleToggleList}
      />
    </div>
  ) : null;

  const wideContextToolbar = !readOnly ? (
    <div
      className="shrink-0"
      data-slide-inline-edit-surface="true"
      data-slide-context-toolbar-placement="top"
      onPointerDownCapture={preserveRichTextSelection}
    >
      <SlideContextToolbar
        snapshot={selectedStyleSnapshot}
        background={slide.background}
        designSystem={designSystem}
        leading={contextToolbarLeading}
        onChange={applySelectedStylePatch}
        onBackgroundChange={applySlideBackground}
        onArrange={handleArrangeSelected}
        onToggleList={handleToggleList}
        className="slide-context-toolbar--top-row"
      />
    </div>
  ) : null;

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[var(--slides-editor-surface)]"
      data-slide-element-selected={slideElementSelected ? "true" : undefined}
    >
      {!readOnly && wideContextToolbarSlot
        ? createPortal(wideContextToolbar, wideContextToolbarSlot)
        : null}
      {contextToolbarSlot
        ? createPortal(contextToolbar, contextToolbarSlot)
        : contextToolbar}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          {slide.excalidrawData ? (
            <div className="relative h-full bg-[var(--slides-editor-surface)]">
              {!readOnly && (
                <ExcalidrawExitButton
                  // JSON.stringify drops `undefined` properties before the patch
                  // reaches the network request, so the server's
                  // `fields.excalidrawData !== undefined` merge check never sees
                  // the clear — the canvas would reappear after reload. "" is a
                  // serializable value that survives the round trip and is
                  // already treated as "no data" everywhere excalidrawData is read.
                  onExit={() => onUpdateSlide({ excalidrawData: "" })}
                  label={t("raw.exitExcalidrawCanvas")}
                />
              )}
              <ExcalidrawSlide
                initialData={slide.excalidrawData}
                onChange={(data) => onUpdateSlide({ excalidrawData: data })}
                readOnly={readOnly}
              />
            </div>
          ) : (
            <div className="relative h-full bg-[var(--slides-editor-surface)]">
              <div className="absolute right-3 top-3 z-20 flex h-8 items-center gap-0.5 rounded-md border border-border bg-popover/95 px-1 shadow-lg">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 cursor-pointer"
                      onClick={canvasZoomOut}
                      disabled={canvasZoom <= MIN_CANVAS_ZOOM}
                      aria-label={t("raw.zoomOut")}
                    >
                      <IconZoomOut className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("raw.zoomOut")}</TooltipContent>
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
                      aria-label={t("raw.zoomIn")}
                    >
                      <IconZoomIn className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("raw.zoomIn")}</TooltipContent>
                </Tooltip>
                <div className="mx-0.5 h-4 w-px bg-border" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 cursor-pointer"
                      onClick={fitCanvasToScreen}
                      aria-label={t("raw.fitSlideToScreen")}
                    >
                      <IconMaximize className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("raw.fitToScreen")}</TooltipContent>
                </Tooltip>
              </div>
              <div
                ref={scrollContainerRef}
                className={`h-full overflow-auto ${
                  drawMode ? "pb-24 sm:pb-28" : ""
                }`}
              >
                <div
                  ref={canvasTrackRef}
                  className="flex min-h-full w-max min-w-full items-center justify-center p-2 pt-14 sm:p-4 sm:pt-14 md:p-8 md:pt-16"
                  onPointerDown={handleCanvasBackgroundPointerDown}
                >
                  <div
                    ref={containerRef}
                    data-main-slide-canvas="true"
                    className="shrink-0"
                    style={{ width: canvasWidth, maxWidth: canvasWidth }}
                  >
                    <div
                      ref={slideCanvasRef}
                      className="slide-image-clickable relative"
                      data-editable={!readOnly ? "true" : undefined}
                      onClick={handleSlideClick}
                      onContextMenu={handleSlideContextMenu}
                      onDoubleClick={handleSlideDoubleClick}
                      onPointerDown={handleSlidePointerDown}
                      onPointerMove={handleSlidePointerMove}
                      onPointerLeave={clearEdgeMoveCursor}
                      onDragStart={(event) => event.preventDefault()}
                      onDragOver={handleSlideDragOver}
                      onDrop={handleSlideDrop}
                    >
                      <SlideRenderer
                        slide={slide}
                        className="shadow-2xl shadow-black/40"
                        designSystem={designSystem}
                        aspectRatio={aspectRatio}
                        onOverflowChange={handleOverflowChange}
                        onAutofitSettled={handleAutofitSettled}
                      />
                      {/* Fading "AI edited" ring around the canvas when the
                          agent just edited THIS slide (component handles fade). */}
                      {activeSlideEdits.length > 0 && (
                        <RecentEditHighlights
                          edits={activeSlideEdits}
                          resolveRect={resolveCanvasRect}
                          containerRef={slideCanvasRef}
                          outlineOnly
                        />
                      )}
                      {(agentActive || passivePresentUsers.length > 0) && (
                        <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                          <AgentPresenceChip active={Boolean(agentActive)} />
                          {passivePresentUsers.length > 0 && (
                            <SameSlidePresenceIndicator
                              users={passivePresentUsers}
                            />
                          )}
                        </div>
                      )}
                      {overflowInfo &&
                        !readOnly &&
                        !agentActive &&
                        !isOverflowWarningDismissed && (
                          <SlideOverflowWarning
                            verticalOverflow={overflowInfo.verticalOverflow}
                            horizontalOverflow={overflowInfo.horizontalOverflow}
                            isAskingAgentToFix={isAskingAgentToFix}
                            dismissLabel={t("deckEditor.dismissLayoutWarning")}
                            onFix={handleAskAgentToFixLayout}
                            onDismiss={() =>
                              setIsOverflowWarningDismissed(true)
                            }
                          />
                        )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <SpeakerNotesPanel
        notes={slide.notes}
        onChange={(notes) => onUpdateSlide({ notes })}
        readOnly={readOnly}
      />

      {selectionRect && (
        <ImageSelectionOutline
          rect={selectionRect}
          viewportRect={selectionViewportRect}
        />
      )}
      {selectedElementRect && !editingEl && (
        <ElementSelectionOutline
          rect={selectedElementRect}
          viewportRect={selectionViewportRect}
          onResizeStart={
            !readOnly && isSelectedElementDraggable
              ? startElementResize
              : undefined
          }
        />
      )}

      {/* Multi-select outlines */}
      {Array.from(multiSelectionRects.entries()).map(([id, v]) => (
        <MultiSelectOutline
          key={id}
          rect={v.rect}
          viewportRect={selectionViewportRect}
        />
      ))}

      {/* Active marquee rectangle */}
      {marquee && (marquee.w > 1 || marquee.h > 1) && (
        <MarqueeRect rect={marquee} viewportRect={selectionViewportRect} />
      )}

      {/* Floating "N selected" chip */}
      <MultiSelectChip
        count={multiSelection.size}
        anchorRect={chipAnchorRect}
        onClear={clearMultiSelection}
        onSendToAgent={sendSelectionToAgent}
      />

      <BlockBubbleMenu
        editingEl={editingEl}
        slideId={slide.id}
        deckId={deckId}
        onCommitInlineEdit={exitInlineEdit}
      />

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
        scopeKey={slideId || slide.id}
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
