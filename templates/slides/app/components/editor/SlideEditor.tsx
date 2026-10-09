import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { captureError } from "@agent-native/core/client/analytics";
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
import { useLabState } from "@agent-native/core/client/labs";
import { useIsMcpAppWidgetEmbed } from "@agent-native/core/client/mcp-app-host";
import { hasCrossedCanvasDragThreshold } from "@agent-native/toolkit/canvas-interactions";
import { RecentEditHighlights } from "@agent-native/toolkit/collab-ui";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { SLIDES_LAYOUT_OVERFLOW_WARNING } from "@shared/labs";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import { hashSlideContent } from "@shared/slide-fit";
import type { SlidePosition } from "@shared/slide-number";
import { IconX } from "@tabler/icons-react";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { toast } from "sonner";

import { SlideCommentPins } from "@/components/comments/SlideCommentPins";
import {
  ExcalidrawSlide,
  parseExcalidrawData,
} from "@/components/deck/ExcalidrawSlide";
import SlideRenderer, {
  applyRemoteSlideContentUnderEdit,
  getRenderedSlideSource,
  isRawHtmlSlide,
  noteSlideEditDraft,
  SLIDE_CONTENT_REPLACE_EVENT,
  type SlideContentReplaceDetail,
} from "@/components/deck/SlideRenderer";
import type { SlideOverflowInfo } from "@/components/deck/SlideRenderer";
import {
  bulletRowCount,
  findEnclosingList,
  ZERO_WIDTH_SPACE,
} from "@/components/editor/bullet-editing";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DrawOverlay, MultiSelectChip } from "@/components/visual-editor";
import {
  flushPendingSaves,
  type Slide,
  type UpdateSlideOptions,
} from "@/context/DeckContext";
import type { CommentThread } from "@/hooks/use-slide-comments";
import { getAspectRatioDims, type AspectRatio } from "@/lib/aspect-ratios";
import {
  computeCanvasFitZoom,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from "@/lib/canvas-zoom";
import {
  buildDrawingHandoffPrompt,
  buildSelectionHandoffPrompt,
  sendEditorPromptToAgent,
} from "@/lib/editor-agent-handoff";
import { downloadImage } from "@/lib/image-download";
import {
  registerInlineEditRemoteApplier,
  requestInlineEditRemoteRetry,
} from "@/lib/inline-edit-remote";
import { publishSlidesSelection } from "@/lib/slide-agent-context";
import {
  getElementPreview,
  getPersistedElementPath,
  resolveElementPath,
  type SelectedAnimationTarget,
} from "@/lib/slide-animation-elements";
import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorFromRange,
  slideCommentThreadAtPoint,
} from "@/lib/slide-comment-anchor";
import {
  createPlaceholderImageTarget,
  imageFileLooksSupported,
  imageOccurrenceInRenderedSlide,
  normalizeImageObjectPosition,
  serializeWithRestoredCropTransitionInlineOverrides,
  type ImageObjectPosition,
  type SlideImageDropPosition,
} from "@/lib/slide-image-replacement";
import {
  mergeRenderedEdits,
  rebaseSlideEdit,
  storedFormOf,
  type RenderedSlideSource,
} from "@/lib/slide-source-map";
import {
  applyVideoPlaybackSettings,
  videoFileLooksLikeVideo,
  videoPlaybackSettingsFor,
  type VideoPlaybackSettings,
} from "@/lib/slide-video";
import { TAB_ID } from "@/lib/tab-id";
import type { UndoSelectionRequest } from "@/lib/undo-reveal";
import { shortcutLabel } from "@/lib/utils";
import { enterSelectionMode } from "@/root";

import type { DesignSystemData } from "../../../shared/api";
import {
  AlignmentGuides,
  type AlignmentGuideViewport,
} from "./AlignmentGuides";
import { BlockBubbleMenu } from "./BlockBubbleMenu";
import {
  createSlidesCanvasGestureController,
  resolveSlidesCanvasNudge,
  resolveSlidesCanvasRotation,
  resolveSlidesCanvasTargetIntent,
  SLIDES_CANVAS_DRAG_THRESHOLD,
  slidesCanvasInteractionCore,
} from "./canvas-interactions";
import {
  SLIDE_SHAPE_LABEL_KEYS,
  type SlideShapeType,
} from "./EditorActionCluster";
import { hasInlineHeight } from "./fit-text-object";
import { FollowingSlideStack } from "./FollowingSlideStack";
import ImageCropOverlay, {
  writeImageCropPercentGeometry,
} from "./ImageCropOverlay";
import ImageOverlay from "./ImageOverlay";
import {
  startInPlaceTextSession,
  stripFreeformReservation,
  type InPlaceTextSession,
} from "./in-place-text-session";
import {
  inlineEditDraftNeedsPersistence,
  shouldPersistInlineEditContent,
  type InlineEditContentSnapshot,
} from "./inline-edit-session";
import {
  activeSlideListKind,
  toggleSlideList,
  type SlideListKind,
} from "./list-editing";
import {
  applyInlineTextStyle,
  getInlineTextStyleSnapshot,
  getInlineTextStyleSnapshotForRange,
  normalizeSlideClipboardHtml,
  restoreEditableTextRange,
  selectAllEditableText,
  snapshotEditableTextRange,
  type InlineTextStylePatch,
  type InlineTextStyleSnapshot,
} from "./rich-text-selection";
import {
  createSelectionOverlayAutofitKey,
  createSelectionOverlayMeasurementKey,
  currentSelectionOverlayFrame,
  currentSelectionOverlayRect,
  isSameSelectedContainer,
  isSameSelectionMeasurement,
  isSelectionOverlayAutofitSettled,
  isSelectionOverlayOnActiveSlide,
  type SelectionOverlayMeasurement,
} from "./selection-overlay-measurement";
import { decideSlideEscape } from "./slide-escape-arbiter";
import {
  alignSlideObjectMembers,
  applySlideObjectMoveDelta,
  arrangeSlideLayerInParent,
  buildPastedSlideObjects,
  canDropSlideLayerAdjacent,
  canDropSlideLayerInside,
  clampSlideObjectPlacementPosition,
  clientPointToSlideCoordinates,
  clientRectToContainingBlockBox,
  cloneSlideObject,
  collectMovableSlideObjects,
  copySlideObjects,
  duplicateSlideObjectMembers,
  computeSlideObjectZOrder,
  computeSlideObjectZOrderForSelection,
  createSlideLinePlacementGeometry,
  createSlideObjectId,
  createSlideObjectPlacementGeometry,
  createSlidesSelectionState,
  ensureSlideObjectId,
  ensureSlideTextBoxCanvas,
  findSlideObjectById,
  freezeSlideElementForFreeform,
  distributeSlideObjectMembers,
  groupSlideObjects,
  getSlideTextBoxDefaultColor,
  getSlideSelectionIdentity,
  getSlideSelectionMode,
  findPersistedImageObject,
  hasFitTextMinHeight,
  isAutoHeightTextResize,
  isFitTextObject,
  isDeletableFlowImage,
  isDeletableSlideElement,
  isLayoutSpacer,
  isSlideObjectGroup,
  isSlideTableStructureElement,
  resolveSelectionOwner,
  resolveSelectionOwnerId,
  isValidSlideClipboardRoot,
  readSlideObjectSelectionFrame,
  captureSlideObjectAnimationState,
  restoreSlideObjectAnimationState,
  readEditableSlideObjectRotation,
  readSlideObjectClipboardId,
  readSlideObjectRotation,
  readSlideObjectTransformSnapshot,
  resolveSlideObjectRotationDelta,
  removeSlideObjectAndLayoutSpacer,
  preserveSlideObjectLayoutSpacer,
  persistSlideObjectZOrderFromDom,
  planSlideObjectGeometry,
  readSlideObjectZIndex,
  resolveFitTextBoxResize,
  resolveFreeformSizing,
  resolveSelectionIdentity,
  hasRotatedAncestor,
  probeScreenBasis,
  resolveSlideObjectContainingBlock,
  resolveSlideObjectGroupRoot,
  resolveSlideObjectInsertionContainingBlock,
  resolveSlideObjectMoveRoots,
  resizeSlideObjectMembers,
  resizeTransformedSlideObject,
  scaleSlideObjectGroupMembers,
  rotateSlideObjectMembers,
  screenDeltaToLocal,
  resolveSlideClipboardElement,
  resolveSlideSelectionAnchor,
  restoreSlideObjectStyle,
  restoreSlideObjectDomSnapshot,
  restoreSlideObjectTransformSnapshots,
  keepAbsoluteDescendantsInPlace,
  MIN_SLIDE_OBJECT_SIZE,
  releaseSlideObjectFromLeftBoxes,
  removeSlideObjectLayoutSpacer,
  setSlideObjectDimension,
  setSlideObjectRotation,
  slideObjectPaintsRotation,
  SLIDE_OBJECT_PASTE_OFFSET,
  snapSlideObjectMove,
  stripTransientSlideLayoutSpacers,
  unionSlideObjectGeometries,
  wrapImageInCropFrame,
  wrapSlideObjectRotation,
  writeSlideObjectClipboard,
  type CopiedSlideObjects,
  type SlideAlignmentGuide,
  type SlideObjectAlignment,
  type SlideObjectDistribution,
  type ResizeHandle,
  type SlideObjectGeometry,
  type SlideObjectGeometryPlan,
  type SlideObjectAnimationSnapshot,
  type SlideObjectGroupResizeMember,
  type SlideObjectRotationMember,
  type SlideObjectZOrderTarget,
  type SlidesSelectionMode,
  type SlidesSelectionState as BaseSlidesSelectionState,
  type SlidesSelectionTool,
  ungroupSlideObject,
} from "./slide-object-interactions";
import {
  clampSelectionToTextRoot,
  firstTextLeaf,
  resolveSlidePointerTarget,
} from "./slide-pointer-target";
import { getPassiveSlidePresenceUsers } from "./slide-presence";
import {
  haveSameSlideStyleControls,
  mergeSlideStyleSnapshots,
  type SlideStylePatch,
  type SlideStyleSnapshot,
} from "./slide-style";
import {
  findSlideShapeOwner,
  findSmartBlock,
  holdsPaintedTextBox,
  getSlideCanvasTraversalElements as getSlideCanvasTraversalRoots,
  preventSlideLinkNavigation,
  isInlineTextElement,
  isRichTextBlock,
  isSlideCanvasShell,
  isSmartGroup,
  isSlideCanvasShortcutTarget,
  isSlideTextEditingTarget,
  isTransparentLayoutWrapper,
  resolveSlideTextSelectionTarget,
  shouldStampBuilderId,
  shouldTraverseSlideLayerChildren,
} from "./slide-text-targets";
import { SlideContextToolbar } from "./SlideContextToolbar";
import { SlideOverflowWarning } from "./SlideOverflowWarning";
import { SlideSlashCommandMenu } from "./SlideSlashCommandMenu";
import {
  SlidesLayersPanel,
  type SlidesLayerKind,
  type SlidesLayerNode,
  type SlidesLayerPlacement,
} from "./SlidesLayersPanel";
import { SpeakerNotesPanel } from "./SpeakerNotesPanel";
import {
  copiedElementStyleFromSnapshot,
  getCopiedElementStyle,
  setCopiedElementStyle,
} from "./style-clipboard";

function ExcalidrawExitButton(props: { onExit: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-3 top-3 z-20 cursor-pointer border border-border bg-popover/95 shadow-lg"
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

/** The slide element being edited in place; see in-place-text-session. */
type TextEditSession = {
  slideId: string;
  /**
   * The `.slide-content` root the element was edited in. An editor unmount
   * detaches it whole, so it still serializes after the canvas is gone.
   */
  slideContent: HTMLElement;
  text: InPlaceTextSession;
};

const CANVAS_ZOOM_PRESETS = [10, 25, 50, 75, 100, 125, 150, 200] as const;
const SLIDE_SHAPE_DEFAULT_SIZES = {
  rectangle: { width: 192, height: 144 },
  circle: { width: 144, height: 144 },
  arrow: { width: 192, height: 144 },
  triangle: { width: 144, height: 144 },
  line: { width: 240, height: 4 },
} satisfies Record<
  SlideShapeType,
  Pick<SlideObjectGeometry, "width" | "height">
>;

/**
 * Operations that require an already-persisted freeform object are narrower
 * than ordinary canvas selection. A flow-layout node can still be promoted by
 * a thresholded drag, but it is not eligible for copy or arrange beforehand.
 */
function isPersistedFreeformObject(element: HTMLElement): boolean {
  return (
    Boolean(element.getAttribute("data-slide-object-id")) &&
    window.getComputedStyle(element).position === "absolute"
  );
}

/** Longest a cancelled gesture's release may take before its click is real. */
const CANCEL_CLICK_SUPPRESSION_TIMEOUT_MS = 2000;

function resolveSlidePositioningLayer(
  element: HTMLElement,
): HTMLElement | null {
  const fmdSlide = element.closest<HTMLElement>(".fmd-slide");
  if (fmdSlide) {
    return (
      Array.from(fmdSlide.children).find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.hasAttribute("data-fmd-autofit-content"),
      ) ?? fmdSlide
    );
  }
  return element.closest<HTMLElement>("[data-slide-canvas]");
}

/**
 * `left`/`top` resolve against the containing block, and AutoFit scales that
 * layer independently of the canvas root, so pointer deltas must convert
 * through it. Markdown slides have no fmd layer yet and keep the canvas root.
 * Inside a rotated block the block's bounding rect is not its size, so the
 * basis is probed and `toLocalDelta` maps the screen delta instead; snapping
 * is off there because its guides are drawn from that bounding rect.
 */
function readGestureViewport(
  element: HTMLElement,
  slideCanvas: HTMLElement,
): {
  rect: DOMRect;
  canvas: { width: number; height: number };
  toLocalDelta?: (delta: { x: number; y: number }) => { x: number; y: number };
} | null {
  const layer = element.closest(".fmd-slide")
    ? resolveSlidePositioningLayer(element)
    : null;
  const space = layer
    ? resolveSlideObjectContainingBlock(element, layer)
    : slideCanvas;
  const rect = space.getBoundingClientRect();
  const canvas = { width: space.offsetWidth, height: space.offsetHeight };
  if (!rect.width || !rect.height || !canvas.width || !canvas.height) {
    return null;
  }
  if (!hasRotatedAncestor(space, slideCanvas)) return { rect, canvas };
  const basis = probeScreenBasis(space);
  if (!basis) return null;
  return {
    rect: new DOMRect(rect.left, rect.top, canvas.width, canvas.height),
    canvas,
    toLocalDelta: (delta) => screenDeltaToLocal(basis, delta),
  };
}

/** Screen px per slide unit, so snapping keeps a screen-constant radius. */
function readScreenScale(space: HTMLElement): number | undefined {
  const width = space.getBoundingClientRect().width;
  return space.offsetWidth > 0 && width > 0
    ? width / space.offsetWidth
    : undefined;
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
  const visit = (element: HTMLElement) => {
    // An element under edit belongs to its text session: its undo snapshots
    // and no-op check compare markup, so nothing else may rewrite it.
    if (element.getAttribute("contenteditable") === "true") return;
    if (!shouldStampBuilderId(element)) {
      element.removeAttribute("data-builder-id");
      element.removeAttribute("data-slide-text-block");
      return;
    }
    ensureBuilderId(element);
    if (isRichTextBlock(element) && !isSmartGroup(element)) {
      for (const descendant of Array.from(
        element.querySelectorAll<HTMLElement>("[data-slide-text-block]"),
      )) {
        descendant.removeAttribute("data-slide-text-block");
      }
      element.setAttribute("data-slide-text-block", "true");
      return;
    }
    element.removeAttribute("data-slide-text-block");
    for (const child of Array.from(element.children)) {
      visit(child as HTMLElement);
    }
  };

  for (const child of Array.from(container.children)) {
    visit(child as HTMLElement);
  }
}

function layerLabel(element: HTMLElement, index: number): string {
  const explicit =
    element.getAttribute("aria-label") || element.getAttribute("alt");
  const text = (explicit || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 48) || `${element.tagName.toLowerCase()} ${index + 1}`;
}

function layerKindForElement(
  element: HTMLElement,
  hasChildren: boolean,
): SlidesLayerKind {
  if (isRichTextBlock(element)) return "text";
  if (
    element.tagName === "VIDEO" ||
    element.classList.contains("fmd-video-upload-placeholder")
  )
    return "video";
  if (
    element.tagName === "IMG" ||
    element.classList.contains("fmd-img-placeholder") ||
    element.querySelector("img")
  ) {
    return "image";
  }
  if (element.tagName === "SVG" || element.querySelector("svg")) {
    return "vector";
  }
  if (element.tagName === "PRE" || element.tagName === "CODE") return "code";
  return hasChildren ? "container" : "shape";
}

function isZIndexedSlideLayer(element: HTMLElement): boolean {
  if (isPersistedFreeformObject(element)) return true;
  const zIndex = element.style.zIndex;
  if (!zIndex || zIndex === "auto") return false;
  const position = window.getComputedStyle(element).position;
  if (position !== "static") return true;
  const parentDisplay = element.parentElement
    ? window.getComputedStyle(element.parentElement).display
    : "";
  return parentDisplay === "flex" || parentDisplay === "grid";
}

function sortSlideLayerElements(elements: HTMLElement[]): HTMLElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((left, right) => {
      const leftZIndexed = isZIndexedSlideLayer(left.element);
      const rightZIndexed = isZIndexedSlideLayer(right.element);
      const leftBucket = leftZIndexed
        ? readSlideObjectZIndex(left.element) < 0
          ? -1
          : 1
        : 0;
      const rightBucket = rightZIndexed
        ? readSlideObjectZIndex(right.element) < 0
          ? -1
          : 1
        : 0;
      if (leftBucket !== rightBucket) return leftBucket - rightBucket;
      if (leftZIndexed && rightZIndexed) {
        return (
          readSlideObjectZIndex(left.element) -
            readSlideObjectZIndex(right.element) || left.index - right.index
        );
      }
      return left.index - right.index;
    })
    .map(({ element }) => element);
}

function buildSlidesLayerTree(root: HTMLElement | null): SlidesLayerNode[] {
  if (!root) return [];
  stampBuilderIds(root);
  const fmdSlide = root.querySelector<HTMLElement>(".fmd-slide") ?? root;
  const positioningLayer =
    Array.from(fmdSlide.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.hasAttribute("data-fmd-autofit-content"),
    ) ?? fmdSlide;

  const visit = (
    element: HTMLElement,
    index: number,
  ): SlidesLayerNode | null => {
    if (
      !shouldStampBuilderId(element) ||
      isLayoutSpacer(element) ||
      isSlideCanvasShell(element)
    ) {
      return null;
    }
    if (element.tagName === "IMG" && findPersistedImageObject(element, root)) {
      return null;
    }
    // Rich text is one layer: its blocks are structure, not rows of their own.
    // Smart groups are layout containers, so their text leaves stay visible.
    const children = shouldTraverseSlideLayerChildren(element)
      ? sortSlideLayerElements(Array.from(element.children) as HTMLElement[])
          .map((child, childIndex) => visit(child as HTMLElement, childIndex))
          .filter((child): child is SlidesLayerNode => child !== null)
      : [];
    return {
      id: ensureBuilderId(element),
      label: layerLabel(element, index),
      kind: layerKindForElement(element, children.length > 0),
      ...(children.length > 0 ? { children } : {}),
    };
  };

  return sortSlideLayerElements(
    Array.from(positioningLayer.children) as HTMLElement[],
  )
    .map((element, index) => visit(element as HTMLElement, index))
    .filter((node): node is SlidesLayerNode => node !== null);
}

function unionDomRects(rects: readonly DOMRect[]): DOMRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Get the unique selector for an element using its data-builder-id */
function getBuilderSelector(el: HTMLElement): string | null {
  const id = el.getAttribute("data-builder-id");
  if (id) return `[data-builder-id="${id}"]`;
  return null;
}

const PASTED_TEXT_STYLE_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-decoration",
] as const;

function applyPastedTextPresentation(box: HTMLElement): void {
  const source = Array.from(
    box.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, p, li"),
  ).find((element) => element.textContent?.trim());
  if (!source) return;
  for (const property of PASTED_TEXT_STYLE_PROPERTIES) {
    const value = source.style.getPropertyValue(property);
    if (value) box.style.setProperty(property, value);
  }
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
    const stripRoot = doc.querySelector("[data-strip-root]");
    if (stripRoot) {
      stripPlaceholderZws(stripRoot);
      // Transient spacers only keep an in-flow element's slot stable while a
      // drag is live. A preserved gap is durable slide layout state.
      stripTransientSlideLayoutSpacers(stripRoot);
    }
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
      .replace(/\s*data-slide-text-block="[^"]*"/g, "")
      .replace(/\s*data-src-i="[^"]*"/g, "")
  );
}

/**
 * Editor-only spacers, removed before live and base are compared. Caret
 * placeholders are the text session's to remove: a blanket strip of
 * zero-width spaces would also delete an author's own.
 */
function prepareSerializationRoot(root: ParentNode): void {
  root.querySelectorAll("[data-slide-crop-overlay]").forEach((overlay) => {
    overlay.remove();
  });
  for (const child of Array.from(root.children)) {
    stripTransientSlideLayoutSpacers(child);
  }
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
    const withoutZws = textNode.data.split(ZERO_WIDTH_SPACE).join("");
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
  "fontFamily",
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

// The in-place layout reservation keeps an edited in-flow block at its
// pre-edit offsetHeight while the text grows, so its outline reads the content
// height. A fixed-height block keeps its authored frame, like a shape, whether
// or not it is positioned: overflowing text must not stretch the outline over
// its neighbours.
function readEditedFrameOptions(
  element: HTMLElement,
): { contentHeight: "scroll" } | undefined {
  return hasInlineHeight(element) ? undefined : { contentHeight: "scroll" };
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
  const angle = readSlideObjectRotation(element);
  const rotation =
    angle === null ? null : wrapSlideObjectRotation(Math.round(angle));
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
  const isImage =
    element.tagName === "IMG" ||
    element.classList.contains("fmd-pptx-image") ||
    element.getAttribute("data-pptx-element-kind") === "image";
  const objectFit =
    element.tagName === "IMG"
      ? computed.objectFit === "contain"
        ? "contain"
        : "cover"
      : undefined;
  const objectPosition =
    element.tagName === "IMG"
      ? normalizeImageObjectPosition(
          element.style.objectPosition || computed.objectPosition,
        )
      : undefined;

  const selectedTextStyle =
    inlineTextStyle?.scope === "selection" ? inlineTextStyle : null;
  const selectedColor = selectedTextStyle?.values.color;
  const selectedFontFamily = selectedTextStyle?.values.fontFamily;
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
    isImage,
    objectFit,
    objectPosition,
    color:
      selectedColor === null || selectedColor === undefined
        ? normalizedColor(computed.color)
        : normalizedColor(selectedColor),
    fontFamily: selectedFontFamily ?? computed.fontFamily,
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
    listKind: activeSlideListKind(element),
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
  selectedText?: string;
  textTruncated?: boolean;
  kind?: string;
  tagName?: string;
  imageSrc?: string;
  videoSrc?: string;
  style?: Partial<SlideStyleSnapshot>;
}

type SlidesSelectionState = BaseSlidesSelectionState<SlideSelectionItem>;

function selectionItemForElement(
  element: HTMLElement,
  runtimeSelector: string,
  snapshot?: SlideStyleSnapshot,
  imageStyle?: Pick<SlideStyleSnapshot, "objectFit" | "objectPosition">,
  selectedText?: string,
): SlideSelectionItem {
  const identity = getSlideSelectionIdentity(element, runtimeSelector);
  const fullText = (element.textContent || "").trim();
  const textLimit = snapshot ? 80 : 200;
  return {
    ...identity,
    kind:
      element.tagName === "VIDEO"
        ? "video"
        : snapshot?.isImage || element.tagName === "IMG"
          ? "image"
          : "element",
    tagName: snapshot?.tagName ?? element.tagName.toLowerCase(),
    text: snapshot?.textPreview ?? fullText.slice(0, 200),
    selectedText: selectedText?.trim() ? selectedText : undefined,
    textTruncated: fullText.length > textLimit,
    imageSrc:
      element instanceof HTMLImageElement
        ? (element.getAttribute("src") ?? undefined)
        : (element.querySelector("img")?.getAttribute("src") ?? undefined),
    videoSrc:
      element instanceof HTMLVideoElement
        ? (element.getAttribute("src") ??
          element.querySelector("source")?.getAttribute("src") ??
          undefined)
        : undefined,
    style: snapshot
      ? { ...snapshot, ...imageStyle, selector: identity.selector }
      : undefined,
  };
}

/** Re-applies a measured height after a reparent: fit text keeps none, a card keeps a minimum. */
function writeReparentedHeight(element: HTMLElement, height: number) {
  const sizing = resolveFreeformSizing(element);
  if (sizing === "fit") return;
  element.style.setProperty(
    sizing === "min" ? "min-height" : "height",
    `${height}px`,
  );
}

const SELECTION_SYNC_DEBOUNCE_MS = 250;
let pendingSelectionWrite: {
  timer: ReturnType<typeof setTimeout>;
  owner: object;
} | null = null;

/**
 * Publishes the selection locally and writes it to application state. Typing
 * fires this per keystroke, so `debounce` (with the editor instance that owns
 * the write) leaves one write per pause; any immediate sync (the end of the
 * edit session included) supersedes the pending one, so the last state always
 * lands.
 */
function syncSelectionToAppState(
  state: SlidesSelectionState | null,
  { debounce }: { debounce?: object } = {},
) {
  if (pendingSelectionWrite) {
    clearTimeout(pendingSelectionWrite.timer);
    pendingSelectionWrite = null;
  }
  publishSlidesSelection(state);
  if (!debounce) {
    writeSelectionToAppState(state);
    return;
  }
  pendingSelectionWrite = {
    owner: debounce,
    timer: setTimeout(() => {
      pendingSelectionWrite = null;
      writeSelectionToAppState(state);
    }, SELECTION_SYNC_DEBOUNCE_MS),
  };
}

/** An unmounted editor must not publish its selection after its successor wrote its own. */
function cancelPendingSelectionWrite(owner: object) {
  if (pendingSelectionWrite?.owner !== owner) return;
  clearTimeout(pendingSelectionWrite.timer);
  pendingSelectionWrite = null;
}

function writeSelectionToAppState(state: SlidesSelectionState | null) {
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
  const generic = state
    ? {
        deckId: state.deckId,
        slideId: state.slideId,
        slideIndex: state.slideIndex,
        slideNumber: state.slideNumber,
        items: state.items,
      }
    : null;
  for (const key of genericKeys) {
    setClientAppState(key, generic, {
      keepalive: true,
      requestSource: TAB_ID,
    }).catch(() => {});
  }
}

interface SlideEditorProps {
  slide: Slide;
  slidePosition?: SlidePosition;
  onUpdateSlide: (
    updates: Partial<Omit<Slide, "id">>,
    slideIdOverride?: string,
    options?: UpdateSlideOptions,
  ) => string | undefined;
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
  /** Parent-shell host so Layers sits beside the canvas like Transitions. */
  layersPanelSlot?: HTMLElement | null;
  /** Selection-independent actions for the head of the contextual toolbar. */
  contextToolbarLeading?: ReactNode;
  onGenerateImage: () => void;
  onOpenAssetLibrary: (replaceSrc: string) => void;
  onUploadImage: (replaceSrc: string) => void;
  onDropImage?: (
    replaceSrc: string | null,
    file: File,
    position?: SlideImageDropPosition,
  ) => void;
  onDropVideo?: (file: File, position?: SlideImageDropPosition) => void;
  /** Fired when an image is dragged from elsewhere in the app (e.g. a
   *  generated-image preview in the agent chat panel) and dropped on the
   *  slide canvas, instead of a native OS file drop. */
  onDropImageUrl?: (
    replaceSrc: string | null,
    url: string,
    position?: SlideImageDropPosition,
  ) => void;
  onToggleObjectFit: (
    imgSrc: string,
    newFit: "cover" | "contain",
    imageOccurrence?: number,
  ) => void;
  onChangeObjectPosition: (
    imgSrc: string,
    objectPosition: ImageObjectPosition,
    imageOccurrence?: number,
  ) => void;
  /** Current user display info for cursor caret */
  collabUser?: { name: string; color: string };
  /** True briefly when AI agent is making edits */
  agentActive?: boolean;
  /** Lingering recent edits (e.g. agent edits) to highlight over the canvas
   *  when they target the currently-active slide. */
  recentEdits?: AttributedRecentEdit[];
  /** Called when the user selects text and clicks the comment button */
  onComment?: (quotedText: string, anchor?: SlideCommentAnchor) => void;
  /** Existing persisted threads used to render slide-positioned markers. */
  comments?: CommentThread[];
  /** Opens the thread anchored to text the user clicked on the canvas. */
  onSelectCommentThread?: (threadId: string) => void;
  /** MCP App widget only: every slide in the deck. The ones after this one are
   *  stacked below it at the same width so a slide shorter than the pane is
   *  followed by the next ones instead of an empty band. */
  deckSlides?: readonly Slide[];
  /** Makes a clicked following slide the current slide. */
  onSelectFollowingSlide?: (slideId: string) => void;
  /** Objects the last Undo/Redo changed; selected once the slide shows them. */
  undoSelection?: UndoSelectionRequest | null;
  /** The editor is done with `undoSelection` (applied or not applicable). */
  onUndoSelectionConsumed?: () => void;
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
  /** Whether the current viewer can create and reply to comments. */
  canComment?: boolean;
  /** Current authenticated user email used to scope comment actions. */
  currentUserEmail?: string | null;
  /** Called when pin mode should exit */
  onExitPinMode?: () => void;
  /** Whether the "add text box" tool is active — drag on the slide to size a
   *  new text box instead of selecting/marquee-selecting. */
  textBoxMode?: boolean;
  /** Called after a text box is placed (or the tool should otherwise exit) */
  onExitTextBoxMode?: () => void;
  /** Whether the shape picker has armed a shape for drag-to-place on canvas. */
  shapeType?: SlideShapeType | null;
  /** Called after a shape is placed (or the tool should otherwise exit). */
  onExitShapeMode?: () => void;
  /** Whether the selected-element transitions panel is open. */
  animationsOpen?: boolean;
  /** Whether the document layers panel is open. */
  layersOpen?: boolean;
  /** Close the document layers panel. */
  onCloseLayers?: () => void;
  /** Open transitions for the currently selected canvas element. */
  onOpenAnimations?: (target: SelectedAnimationTarget) => void;
  /** Keep the parent in sync with the current canvas selection. */
  onSelectedAnimationTargetChange?: (
    target: SelectedAnimationTarget | null,
  ) => void;
  /** Slide id for pin mode contextId — falls back to slide.id if omitted */
  slideId?: string;
  /** Owning deck id, included in fit measurements for later hash-keyed checks. */
  deckId?: string;
  /**
   * Called the moment the user enters contentEditable inline edit mode.
   * The parent should mark the slide as actively edited so the SSE/poll
   * reconcile path knows not to replace it before a `content` update is queued.
   */
  onInlineEditStart?: (slideId: string) => void;
  /** Called after inline edit mode exits and its draft has been handed off.
   *  Always receives the slide that was actually being edited — the slide
   *  prop may have already advanced to a new slide by the time this fires
   *  (see the slide-switch effect), so callers must not substitute their own
   *  "current slide" state for this argument. */
  onInlineEditEnd?: (slideId: string) => void;
  /** Wait for an inline-edit write to reach the server before an agent uses it. */
  onFlushInlineEdit?: () => Promise<void>;
  /** Called by the editor shell before a navigation that must persist the
   *  current contentEditable draft. Returns true when a draft was active. */
  flushInlineEditRef?: { current: (() => boolean) | null };
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
          // guard:allow-raw-color -- white initials preserve contrast on arbitrary collaborator colors
          className="-ml-1.5 flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ring-1 ring-popover first:ml-0"
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
  const agentIsPresent = users.some(
    (user) => user.email.trim().toLowerCase() === "agent@system",
  );
  const label =
    agentIsPresent && users.length === 1
      ? "AI editing"
      : users.length === 1
        ? `${users[0].name} is here`
        : `${users.length} others here`;
  return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-popover/95 py-1 pl-1 pr-2.5 text-xs text-popover-foreground shadow-lg">
      <div className="flex items-center">
        {visible.map((u) => (
          <SamePresenceAvatar key={u.email} user={u} />
        ))}
        {overflow > 0 && (
          <span className="-ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-medium leading-none text-muted-foreground ring-1 ring-popover">
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
        data-slide-selection-chrome="true"
        style={{
          position: "absolute",
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          pointerEvents: "none",
        }}
      />
    </SelectionOverlayPortal>
  );
}

function ElementSelectionOutline({
  rect,
  frame,
  viewportRect,
  onResizeStart,
  onMoveStart,
  allowBodyMove = true,
  onRotateStart,
  parent = false,
  resizable = true,
}: {
  rect: DOMRect;
  frame?: SelectionOverlayMeasurement["frame"];
  viewportRect: DOMRect | null;
  onResizeStart?: (handle: ResizeHandle, e: React.PointerEvent) => void;
  onMoveStart?: (e: React.PointerEvent) => void;
  allowBodyMove?: boolean;
  onRotateStart?: (e: React.PointerEvent) => void;
  /** The group of the selected member: same frame, drawn gray, no gestures. */
  parent?: boolean;
  /** False for a table cell or row: it is styled in place, never resized. */
  resizable?: boolean;
}) {
  const pad = 2;
  const left = frame?.left ?? rect.left;
  const top = frame?.top ?? rect.top;
  const width = frame?.width ?? rect.width;
  const height = frame?.height ?? rect.height;
  const handleClass = "absolute touch-none rounded-sm";
  const edgeHandleClass =
    "absolute flex touch-none items-center justify-center bg-transparent p-0";
  const edgeBarClass = "rounded-sm";
  const moveHandleStyles = [
    ["n", { top: -4, left: 7, right: 7, height: 8 }],
    ["e", { top: 7, right: -4, bottom: 7, width: 8 }],
    ["s", { right: 7, bottom: -4, left: 7, height: 8 }],
    ["w", { bottom: 7, left: -4, top: 7, width: 8 }],
  ] as const;
  return (
    <SelectionOverlayPortal viewportRect={viewportRect} zIndex={51}>
      <div
        data-slide-selection-outline="true"
        data-slide-selection-chrome="true"
        data-slide-selection-chrome-parent={parent ? "true" : undefined}
        style={{
          position: "absolute",
          top: top - pad,
          left: left - pad,
          width: width + pad * 2,
          height: height + pad * 2,
          pointerEvents: "none",
          transform: frame?.transform,
          transformOrigin: frame
            ? `${frame.transformOrigin.x + pad}px ${frame.transformOrigin.y + pad}px`
            : undefined,
        }}
      >
        {onMoveStart &&
          moveHandleStyles.map(([edge, style]) => (
            <span
              key={edge}
              data-slide-move-handle={edge}
              onPointerDown={onMoveStart}
              className="absolute touch-none"
              style={{
                ...style,
                pointerEvents: "auto",
                cursor: "move",
                zIndex: 0,
              }}
            />
          ))}
        {onMoveStart && allowBodyMove && (
          <span
            data-slide-group-move-handle="true"
            onPointerDown={onMoveStart}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "auto",
              cursor: "move",
              zIndex: 0,
            }}
          />
        )}
        {(onRotateStart || parent) && (
          <>
            <span
              aria-hidden="true"
              className="absolute left-1/2 -translate-x-1/2"
              style={{ pointerEvents: "none", zIndex: 2 }}
            />
            <span
              data-slide-rotate-handle="true"
              onPointerDown={onRotateStart}
              className="absolute left-1/2 -translate-x-1/2 touch-none rounded-full"
              style={{ pointerEvents: "auto", cursor: "grab", zIndex: 3 }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute rounded-full"
              />
            </span>
          </>
        )}
        {resizable && (
          <>
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
              <span
                data-slide-resize-handle-bar="true"
                className={edgeBarClass}
              />
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
              <span
                data-slide-resize-handle-bar="true"
                className={edgeBarClass}
              />
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
              <span
                data-slide-resize-handle-bar="true"
                className={edgeBarClass}
              />
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
              <span
                data-slide-resize-handle-bar="true"
                className={edgeBarClass}
              />
            </span>
          </>
        )}
      </div>
    </SelectionOverlayPortal>
  );
}

function ElementHoverOutline({
  rect,
  frame,
  viewportRect,
  container = false,
}: {
  rect: DOMRect;
  frame?: SelectionOverlayMeasurement["frame"];
  viewportRect: DOMRect | null;
  container?: boolean;
}) {
  const pad = 2;
  const left = frame?.left ?? rect.left;
  const top = frame?.top ?? rect.top;
  const width = frame?.width ?? rect.width;
  const height = frame?.height ?? rect.height;

  return (
    <SelectionOverlayPortal viewportRect={viewportRect} zIndex={49}>
      <div
        data-slide-layer-hover-outline={container ? undefined : "true"}
        data-slide-container-outline={container ? "true" : undefined}
        style={{
          position: "absolute",
          top: top - pad,
          left: left - pad,
          width: width + pad * 2,
          height: height + pad * 2,
          pointerEvents: "none",
          transform: frame?.transform,
          transformOrigin: frame
            ? `${frame.transformOrigin.x + pad}px ${frame.transformOrigin.y + pad}px`
            : undefined,
        }}
      />
    </SelectionOverlayPortal>
  );
}

/** Translucent rectangle drawn while marquee-dragging */
type MarqueeSelectionRect = { x: number; y: number; w: number; h: number };

type SlidePlacementGesture = {
  start: { x: number; y: number };
  current: { x: number; y: number };
  target: HTMLElement | null;
  shapeType: SlideShapeType | null;
};

function MarqueeRect({
  rect,
  viewportRect,
}: {
  rect: MarqueeSelectionRect;
  viewportRect: DOMRect | null;
}) {
  return (
    <SelectionOverlayPortal viewportRect={viewportRect} zIndex={48}>
      <div
        data-slide-marquee="true"
        style={{
          position: "absolute",
          top: rect.y,
          left: rect.x,
          width: rect.w,
          height: rect.h,
          pointerEvents: "none",
        }}
      />
    </SelectionOverlayPortal>
  );
}

/** True if two DOMRect-like rectangles overlap by at least a pixel each way */
function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) >= 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >= 1
  );
}

/**
 * Push the current slide's vertical-fit measurement to application_state.
 * Browser-tab requests read the tab-scoped key; the legacy global key stays
 * available for CLI/headless runs. Always written, even when the slide fits,
 * so a later `get-layout-overflows` call can match the `contentHash` after an
 * asynchronous write. The warning stays local to the editor and does not
 * block persistence.
 *
 * `view-screen` and the editor badge also read this key so the agent can
 * see fit status without browser access of its own.
 */
function syncOverflowToAppState(
  payload: {
    slideId: string;
    deckId?: string;
    contentHash: string;
    layoutFitRevision?: string;
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

type ActiveImageCrop = {
  slideId: string;
  content: string;
  frame: HTMLElement;
  viewport: HTMLElement;
  image: HTMLImageElement;
  frozen: { restoreMarkdownTree?: () => void };
  publishSelection: (element: HTMLElement) => void;
  restorePreviewStyles: () => void;
  restoreChrome: () => void;
  resumeAnimations: () => void;
  restoreTransitions: () => void;
  cancelCopiedTransitions: (preserveOn?: HTMLElement) => void;
  resumeCopiedTransitionOverrides: (element: HTMLElement) => void;
  serializeWithoutCopiedTransitionOverrides: (
    serialize: () => string | null,
  ) => string | null;
  restoreAnimations: () => void;
  hasChanges: () => boolean;
  cancel: () => HTMLElement | null;
};

export default function SlideEditor({
  slide,
  slidePosition,
  onUpdateSlide,
  readOnly = false,
  contextToolbarSlot,
  wideContextToolbarSlot,
  layersPanelSlot,
  contextToolbarLeading,
  onGenerateImage,
  onOpenAssetLibrary,
  onUploadImage,
  onDropImage,
  onDropVideo,
  onDropImageUrl,
  onToggleObjectFit,
  onChangeObjectPosition,
  agentActive,
  deckSlides,
  onSelectFollowingSlide,
  undoSelection,
  onUndoSelectionConsumed,
  slideIndex = 0,
  designSystem,
  aspectRatio,
  drawMode,
  onExitDrawMode,
  pinMode,
  canComment = false,
  currentUserEmail,
  onExitPinMode,
  textBoxMode,
  onExitTextBoxMode,
  shapeType,
  onExitShapeMode,
  animationsOpen = false,
  layersOpen = false,
  onCloseLayers,
  onOpenAnimations,
  onSelectedAnimationTargetChange,
  slideId,
  comments = [],
  onSelectCommentThread,
  deckId,
  onInlineEditStart,
  onInlineEditEnd,
  onFlushInlineEdit,
  flushInlineEditRef,
  presentUsers = [],
  recentEdits = [],
  onComment,
}: SlideEditorProps) {
  const t = useT();
  // The host pane owns every surface around the slide, so the widget shows the
  // slide alone: top-aligned, filling the width, with no toolbar rows or notes.
  const widgetEmbed = useIsMcpAppWidgetEmbed();
  const layoutOverflowWarningEnabled = useLabState(
    SLIDES_LAYOUT_OVERFLOW_WARNING.key,
  ).enabled;
  const content = typeof slide.content === "string" ? slide.content : "";
  const isHtmlSlide = isRawHtmlSlide(slide);

  const [canvasZoom, setCanvasZoom] = useState(100);
  const [imageOverlay, setImageOverlay] = useState<{
    rect: DOMRect;
    src: string;
    objectFit: "cover" | "contain";
    objectPosition: ImageObjectPosition;
    imageOccurrence: number;
  } | null>(null);
  const [imageCrop, setImageCrop] = useState<ActiveImageCrop | null>(null);
  const imageCropRef = useRef<ActiveImageCrop | null>(null);
  const lastImageClickRef = useRef<{
    image: HTMLImageElement;
    timestamp: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const pendingImageDoubleClickRef = useRef<{
    image: HTMLImageElement;
    pointerId: number;
    timestamp: number;
    clientX: number;
    clientY: number;
    isDoubleClick: boolean;
  } | null>(null);
  const selectedImageForCropRef = useRef<HTMLImageElement | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [selectedVideoPlayback, setSelectedVideoPlayback] =
    useState<VideoPlaybackSettings | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [selectionViewportRect, setSelectionViewportRect] =
    useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Mounted for Excalidraw and HTML slides alike, so the once-run listener
  // effect below finds it whichever kind of slide the editor opened on.
  const contentReplaceBoundaryRef = useRef<HTMLDivElement>(null);
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
  const [layerNodes, setLayerNodes] = useState<SlidesLayerNode[]>([]);
  const copiedObjectClipboardRef = useRef<{
    copied: CopiedSlideObjects;
    clipboardId: string;
    nativeClipboardMode: "pending" | "rich" | "text-only" | "failed";
    copySequence: number;
    copySessionId: number;
    deckId?: string;
    slideId: string;
    sourceRect?: Pick<DOMRect, "left" | "top" | "width" | "height">;
  } | null>(null);
  const copiedObjectCopySequenceRef = useRef(0);
  const copiedObjectClipboardSessionRef = useRef(0);
  const overlappingNativeClipboardIdsRef = useRef(new Map<string, string>());
  const [hasCopiedObject, setHasCopiedObject] = useState(false);
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
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [hoveredLayerMeasurement, setHoveredLayerMeasurement] = useState<{
    id: string;
    rect: DOMRect;
    frame: SelectionOverlayMeasurement["frame"];
  } | null>(null);
  const [selectionMeasurementRevision, setSelectionMeasurementRevision] =
    useState(0);
  // Google Slides outlines the object a click would grab, and dashes the box
  // around a selected child, so boxes read as boxes even when dark on dark.
  const [canvasHover, setCanvasHover] = useState<{
    rect: DOMRect;
    frame: SelectionOverlayMeasurement["frame"];
  } | null>(null);
  const canvasHoverElementRef = useRef<HTMLElement | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<{
    rect: DOMRect;
    frame: SelectionOverlayMeasurement["frame"];
    group: boolean;
  } | null>(null);
  const selectedContainerRef = useRef(selectedContainer);
  selectedContainerRef.current = selectedContainer;
  const canvasAutofitKey = createSelectionOverlayAutofitKey(slide.id, content);
  const [settledAutofitKey, setSettledAutofitKey] = useState<string | null>(
    null,
  );
  const [selectedStyleSnapshot, setSelectedStyleSnapshot] =
    useState<SlideStyleSnapshot | null>(null);
  const [hasCopiedElementStyle, setHasCopiedElementStyle] = useState(
    () => getCopiedElementStyle() !== null,
  );
  const contextMenuTargetRef = useRef<HTMLElement | null>(null);
  const contextMenuTableCellRef = useRef<HTMLTableCellElement | null>(null);
  const [contextMenuTableInfo, setContextMenuTableInfo] = useState<{
    rowCount: number;
    colCount: number;
  } | null>(null);
  const selectionOverlayMeasurementKey = createSelectionOverlayMeasurementKey({
    slideId: slide.id,
    content,
    objectId: selectedObjectId,
    selector: selectedElementSelector,
    path: selectedElementPath,
    canvasZoom,
    revision: selectionMeasurementRevision,
  });
  const selectionOverlayMeasurementKeyRef = useRef(
    selectionOverlayMeasurementKey,
  );
  selectionOverlayMeasurementKeyRef.current = selectionOverlayMeasurementKey;
  const selectedElementRect = currentSelectionOverlayRect(
    selectedElementMeasurement,
    selectionOverlayMeasurementKey,
  );
  const selectedElementFrame = currentSelectionOverlayFrame(
    selectedElementMeasurement,
    selectionOverlayMeasurementKey,
  );
  const selectedElementMeasurementRef = useRef(selectedElementMeasurement);
  selectedElementMeasurementRef.current = selectedElementMeasurement;
  const invalidateSelectionOverlayMeasurement = useCallback(() => {
    setSelectedElementMeasurement(null);
    setSelectionMeasurementRevision((revision) => revision + 1);
  }, []);
  // The measurement effect publishes its geometry remeasure here so typing can
  // re-read the edited frame without tearing down the observers per keystroke.
  const remeasureSelectionRef = useRef<(() => void) | null>(null);
  const handleAutofitSettled = useCallback(() => {
    setSettledAutofitKey(canvasAutofitKey);
  }, [canvasAutofitKey]);
  /** Anchor rect for the floating chip (the slide canvas) */
  const [chipAnchorRect, setChipAnchorRect] = useState<DOMRect | null>(null);
  /** Active marquee rectangle (viewport coords). null = not dragging. */
  const [marquee, setMarquee] = useState<MarqueeSelectionRect | null>(null);
  /** Preview rectangle while a shape or text box is being placed. */
  const [placementRect, setPlacementRect] =
    useState<MarqueeSelectionRect | null>(null);
  const [activeAlignmentGuides, setActiveAlignmentGuides] = useState<{
    guides: SlideAlignmentGuide[];
    viewport: AlignmentGuideViewport;
  } | null>(null);
  const activeAlignmentGuidesRef = useRef<{
    guides: SlideAlignmentGuide[];
    viewport: AlignmentGuideViewport;
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
  const [overflowWarningDismissed, setOverflowWarningDismissed] = useState(() =>
    Boolean(slide.layoutWarningDismissed),
  );
  useEffect(() => {
    setOverflowWarningDismissed(Boolean(slide.layoutWarningDismissed));
  }, [slide.id, slide.layoutWarningDismissed]);
  const warningVisible = !overflowWarningDismissed;
  const dismissWarning = useCallback(() => {
    setOverflowWarningDismissed(true);
    onUpdateSlide({ layoutWarningDismissed: true }, slide.id, {
      persistence: "immediate",
    });
  }, [onUpdateSlide, slide.id]);
  const dims = getAspectRatioDims(aspectRatio);
  const [, setFitCanvasZoom] = useState(100);
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
        fillViewport: widgetEmbed,
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
  }, [dims.width, dims.height, widgetEmbed]);

  // The widget scrolls through the slides that follow this one, so a newly
  // selected slide starts at the top of the pane.
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (widgetEmbed && scrollContainer) scrollContainer.scrollTop = 0;
  }, [slide.id, widgetEmbed]);

  // Reset overflow state whenever the slide changes — the renderer will
  // report the next measurement (or stay null if the new slide fits). The
  // warning dismissal itself is persisted on the slide and is cleared by
  // agent layout writes, not by ordinary human edits.
  useEffect(() => {
    if (repairRequestTimerRef.current) {
      clearTimeout(repairRequestTimerRef.current);
      repairRequestTimerRef.current = null;
    }
    setOverflowInfo(null);
    setIsAskingAgentToFix(false);
    syncOverflowToAppState(null);
  }, [slide.id, slide.content, slide.layoutFitRevision]);

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
        ...(slide.layoutFitRevision
          ? { layoutFitRevision: slide.layoutFitRevision }
          : {}),
        contentHeight: info.contentHeight,
        contentWidth: info.contentWidth,
        viewportHeight: info.viewportHeight,
        viewportWidth: info.viewportWidth,
        verticalOverflow: info.verticalOverflow,
        horizontalOverflow: info.horizontalOverflow,
      });
    },
    [slide.id, slide.content, slide.layoutFitRevision, deckId],
  );

  useEffect(() => {
    const hasRenderedExcalidraw = Boolean(
      slide.excalidrawData &&
      parseExcalidrawData(slide.excalidrawData)?.elements?.length,
    );
    if (!hasRenderedExcalidraw) return;
    // Excalidraw is a fixed-size canvas rather than flow content, so it has no
    // AutoFitContent measurement callback of its own. Publish its finite canvas
    // geometry so changed drawings can complete the async fit check.
    handleOverflowChange({
      contentHeight: dims.height,
      contentWidth: dims.width,
      viewportHeight: dims.height,
      viewportWidth: dims.width,
      verticalOverflow: 0,
      horizontalOverflow: 0,
    });
    handleAutofitSettled();
  }, [
    dims.height,
    dims.width,
    handleAutofitSettled,
    handleOverflowChange,
    slide.excalidrawData,
    slide.id,
    slide.layoutFitRevision,
  ]);

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
        `Please use \`view-screen\` to confirm the overflow, then call \`get-deck\` with slideId \`${slide.id}\` to read the complete current HTML and contentHash. Make one bounded \`update-slide --fullContent\` repair with that contentHash as \`baseContentHash\` so its rendered content fits within ${overflowInfo.viewportWidth}x${overflowInfo.viewportHeight}px. Options to shrink the layout, in order of preference:`,
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
  /** Latest marquee geometry, readable by the stable window pointer handlers. */
  const marqueeRef = useRef<MarqueeSelectionRect | null>(null);
  const placementRef = useRef<SlidePlacementGesture | null>(null);
  /** Set right before placing a text box so the click event that follows the
   *  placing pointerdown doesn't fall through to click-to-select/deselect
   *  logic and steal focus back off the freshly created box. */
  const suppressNextClickRef = useRef(false);
  /**
   * The presses whose drag Escape cancelled and whose button is still down, by
   * pointer. Each entry ends that hold; the pointer's release click must not
   * select the object the press started on.
   */
  const cancelledPressesRef = useRef(new Map<number, () => void>());
  useEffect(
    () => () => {
      for (const end of cancelledPressesRef.current.values()) end();
    },
    [],
  );
  // The click that ends a press finishes what the press resolved. It cannot
  // re-resolve: a press selects, which changes what the pointer resolves to,
  // and a drag across text leaves clicks on their common ancestor.
  const pointerPressRef = useRef<{
    object: HTMLElement;
    hit: "text" | "body";
    textRoot: HTMLElement | null;
    x: number;
    y: number;
    groupWasSelected: boolean;
  } | null>(null);
  /** Detaches the live selection clamp of a text press that is still down. */
  const textPressClampStopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => textPressClampStopRef.current?.(), []);
  const commentThreadPressRef = useRef<{
    threadId: string;
    x: number;
    y: number;
  } | null>(null);
  /** The cancellable gesture in flight and the pointer whose press began it. */
  const activeGestureRef = useRef<{
    cancel: () => void;
    pointerId: number;
  } | null>(null);
  /**
   * If the user pressed shift/cmd before starting a marquee, additive mode
   * preserves the existing selection on pointerup.
   */
  const marqueeAdditiveRef = useRef(false);
  /** Selection at marquee start — used for additive mode */
  const marqueePrevSelectionRef = useRef<Set<string>>(new Set());
  /** Currently-edited smart block (leaf or group). State, not ref, so menu re-renders. */
  const [editingEl, setEditingEl] = useState<HTMLElement | null>(null);
  const [keyboardLinkRequest, setKeyboardLinkRequest] = useState<{
    editingEl: HTMLElement;
    range: Range;
  } | null>(null);
  /**
   * Mirror of `editingEl` readable outside render. Exit paths must not read it
   * through a `setEditingEl` updater: updaters run during the render phase, so
   * the parent's `onUpdateSlide` would update DeckProvider mid-render.
   */
  const editingElRef = useRef<HTMLElement | null>(null);
  const richTextSelectionRef = useRef<Range | null>(null);
  /** Latest onUpdateSlide, for inline-edit drafts written mid-session. */
  const rawOnUpdateSlideRef = useRef(onUpdateSlide);
  useEffect(() => {
    rawOnUpdateSlideRef.current = onUpdateSlide;
  }, [onUpdateSlide]);
  const textSessionRef = useRef<TextEditSession | null>(null);
  const exitInlineEditRef = useRef<
    (
      newer?: SlideContentReplaceDetail,
      clearSelectionAfterExit?: boolean,
    ) => string | undefined
  >(() => undefined);
  /**
   * Every other content write commits an open text edit first. The write
   * re-renders the slide from stored HTML, which must not happen under the
   * live edited DOM (the renderer refuses to), and the edit's text belongs
   * in the stored HTML before anything else is layered on it.
   */
  const onUpdateSlideRef = useRef<typeof onUpdateSlide>((...args) => {
    if (textSessionRef.current) exitInlineEditRef.current();
    return rawOnUpdateSlideRef.current(...args);
  });
  /** Latest onInlineEditEnd in a ref so the unmount cleanup below (which must
   *  run with a stable, empty dependency array) always calls the current
   *  version instead of whatever was passed on the very first render. */
  const onInlineEditEndRef = useRef(onInlineEditEnd);
  useEffect(() => {
    onInlineEditEndRef.current = onInlineEditEnd;
  }, [onInlineEditEnd]);
  const inlineEditDraftRef = useRef<InlineEditContentSnapshot | null>(null);
  const inlineEditInitialContentRef = useRef<InlineEditContentSnapshot | null>(
    null,
  );
  const previousSlideIdRef = useRef(slide.id);
  const inlineEditDraftCaptureTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const currentSlideIdRef = useRef(slide.id);

  const getRichTextEditorSurface = useCallback(
    () => textSessionRef.current?.text.element ?? editingElRef.current,
    [],
  );

  useLayoutEffect(() => {
    currentSlideIdRef.current = slide.id;
    if (inlineEditDraftCaptureTimerRef.current !== null) {
      clearTimeout(inlineEditDraftCaptureTimerRef.current);
      inlineEditDraftCaptureTimerRef.current = null;
    }
  }, [slide.id]);

  /**
   * The slide HTML to store for the canvas DOM under `slideContent`: the
   * stored source with the DOM's changes merged in, never the rendered DOM
   * itself. `null` when the canvas has no source map to merge against.
   */
  const serializeSlideContentHtml = useCallback(
    (
      slideContent: HTMLElement,
      source: RenderedSlideSource | undefined,
    ): string | null => {
      const text = textSessionRef.current?.text;
      const clone =
        text?.isActive && slideContent.contains(text.element)
          ? text.cloneWithoutPlaceholders(slideContent)
          : (slideContent.cloneNode(true) as HTMLElement);
      if (source) {
        return mergeRenderedEdits({
          stored: source.stored,
          ranges: source.ranges,
          base: source.base,
          live: clone,
          nonce: source.nonce,
          prepare: prepareSerializationRoot,
        }).html;
      }
      // Markdown layouts render through React, with no stored HTML to merge
      // into; the only writes that reach here are explicit conversions of the
      // slide to HTML (a text box, a freeform move), which store the DOM.
      if (slideContent.hasAttribute("data-slide-autofit-root")) {
        prepareSerializationRoot(clone);
        return stripBuilderIds(clone.innerHTML);
      }
      console.error(
        "[slides] refusing to save: the slide canvas has no source map to merge edits into",
      );
      return null;
    },
    [],
  );

  const readCurrentSlideContentHtml = useCallback(() => {
    const slideContent = containerRef.current?.querySelector(
      ".slide-content",
    ) as HTMLElement | null;
    if (!slideContent) return null;
    return serializeSlideContentHtml(
      slideContent,
      getRenderedSlideSource(slideContent),
    );
  }, [serializeSlideContentHtml]);

  const readCurrentSlideContentHtmlRef = useRef(readCurrentSlideContentHtml);
  useEffect(() => {
    readCurrentSlideContentHtmlRef.current = readCurrentSlideContentHtml;
  }, [readCurrentSlideContentHtml]);

  const finishImageCrop = useCallback((commit: boolean, changed?: boolean) => {
    const crop = imageCropRef.current;
    if (!crop) return;
    const cropChanged = changed ?? crop.hasChanges();
    crop.restorePreviewStyles();
    imageCropRef.current = null;
    setImageCrop(null);
    if (commit && cropChanged) {
      crop.restoreChrome();
      writeImageCropPercentGeometry(crop.image, crop.viewport);
      preserveSlideObjectLayoutSpacer(crop.frame);
      crop.resumeAnimations();
      crop.restoreTransitions();
      const html = crop.serializeWithoutCopiedTransitionOverrides(() =>
        readCurrentSlideContentHtmlRef.current(),
      );
      if (html !== null) {
        if (crop.frozen.restoreMarkdownTree) {
          removeSlideObjectLayoutSpacer(crop.frame);
          crop.frozen.restoreMarkdownTree();
        }
        onUpdateSlideRef.current({ content: html }, undefined, {
          persistence: "immediate",
        });
      } else {
        crop.cancel();
      }
      return;
    }
    const restored = crop.cancel();
    if (commit && restored) {
      const image =
        restored.tagName === "IMG"
          ? (restored as HTMLImageElement)
          : restored.querySelector<HTMLImageElement>("img");
      if (image) setSelectedImg(image);
      if (image) crop.publishSelection(restored);
      setImageOverlay(null);
      return;
    }
    setSelectedImg(null);
    setImageOverlay(null);
    syncSelectionToAppState(null);
  }, []);

  useEffect(() => {
    const onCropKeyDown = (event: KeyboardEvent) => {
      const crop = imageCropRef.current;
      if (!crop || event.key === "Escape") return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-crop-handle]") &&
        ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)
      ) {
        return;
      }
      if (event.key === "Tab") {
        const handles = Array.from(
          crop.frame.querySelectorAll<HTMLButtonElement>("[data-crop-handle]"),
        );
        if (handles.length === 0) return;
        const currentIndex = handles.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const nextIndex =
          currentIndex < 0
            ? event.shiftKey
              ? handles.length - 1
              : 0
            : (currentIndex + (event.shiftKey ? -1 : 1) + handles.length) %
              handles.length;
        event.preventDefault();
        event.stopImmediatePropagation();
        handles[nextIndex]?.focus();
        return;
      }
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "Spacebar"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishImageCrop(true);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onCropKeyDown, true);
    return () => window.removeEventListener("keydown", onCropKeyDown, true);
  }, [finishImageCrop]);

  const persistInlineEditDraft = useCallback(
    (slideId: string, content: string) => {
      const next = { slideId, content };
      const previous = inlineEditDraftRef.current;
      const initial = inlineEditInitialContentRef.current;
      const initialForComparison =
        initial?.slideId === slideId ? initial : next;
      if (!initial || initial.slideId !== slideId) {
        inlineEditInitialContentRef.current = next;
      }
      if (
        inlineEditDraftNeedsPersistence(previous, next, initialForComparison)
      ) {
        const slideContent =
          containerRef.current?.querySelector<HTMLElement>(".slide-content");
        const source = slideContent && getRenderedSlideSource(slideContent);
        if (slideContent && source?.nonce.endsWith(`.${slideId}`)) {
          noteSlideEditDraft(slideContent, source.nonce, content);
        }
        rawOnUpdateSlideRef.current({ content }, slideId, {
          preserveLocalState: true,
        });
      }
      inlineEditDraftRef.current = next;
    },
    [],
  );

  const captureInlineEditDraft = useCallback(
    (slideId = slide.id) => {
      if (inlineEditDraftCaptureTimerRef.current !== null) {
        clearTimeout(inlineEditDraftCaptureTimerRef.current);
        inlineEditDraftCaptureTimerRef.current = null;
      }
      // Typing that nets out (a character typed and deleted) is no edit, even
      // after Chrome's native typing dropped collapsed source whitespace.
      const initial = inlineEditInitialContentRef.current;
      const html =
        textSessionRef.current &&
        !textSessionRef.current.text.changed &&
        initial?.slideId === slideId
          ? initial.content
          : readCurrentSlideContentHtml();
      if (html !== null) persistInlineEditDraft(slideId, html);
    },
    [persistInlineEditDraft, readCurrentSlideContentHtml, slide.id],
  );

  const scheduleInlineEditDraftCapture = useCallback(
    (slideId: string) => {
      if (inlineEditDraftCaptureTimerRef.current !== null) {
        clearTimeout(inlineEditDraftCaptureTimerRef.current);
      }
      inlineEditDraftCaptureTimerRef.current = setTimeout(() => {
        inlineEditDraftCaptureTimerRef.current = null;
        const session = textSessionRef.current;
        if (
          currentSlideIdRef.current !== slideId ||
          session?.slideId !== slideId
        ) {
          return;
        }
        captureInlineEditDraft(slideId);
      }, 250);
    },
    [captureInlineEditDraft],
  );

  /**
   * Ends the open text session and queues the edited slide as a draft. The
   * element is edited in place, so the live canvas under it is serialized.
   * With `newer`, a newer version of the slide is replacing the canvas: the
   * edit is saved on top of it, and dropped, loudly, when it changed the
   * edited text too.
   */
  const endTextSession = useCallback(
    (newer?: SlideContentReplaceDetail) => {
      if (inlineEditDraftCaptureTimerRef.current !== null) {
        clearTimeout(inlineEditDraftCaptureTimerRef.current);
        inlineEditDraftCaptureTimerRef.current = null;
      }
      const session = textSessionRef.current;
      if (!session) return null;
      textSessionRef.current = null;
      setKeyboardLinkRequest(null);
      session.text.end();
      const element = session.text.element;
      const { slideContent } = session;
      let content: string | null = null;
      if (slideContent.contains(element)) {
        const source = getRenderedSlideSource(slideContent);
        content = serializeSlideContentHtml(slideContent, source);
        if (content !== null && newer) {
          const rebased = source
            ? rebaseSlideEdit(
                source.stored,
                source.ranges,
                content,
                newer.content,
              )
            : null;
          if (rebased === null) {
            const error = new Error(
              "[slides] a newer version of the slide changed the text being edited; the edit was not saved",
            );
            console.error(error);
            captureError(error, {
              tags: { area: "slides-save-boundary" },
              extra: { slideId: session.slideId },
            });
            toast.error(t("deckEditor.textEditConflictNotSaved"));
          }
          content = rebased ?? newer.content;
          // The newer version is what is stored now: the baseline a no-op
          // compares against, and what a queued draft settles back to.
          inlineEditInitialContentRef.current = {
            slideId: session.slideId,
            content: newer.content,
          };
        }
      } else {
        const error = new Error(
          "[slides] the edited text left the slide before its edit was saved",
        );
        console.error(error);
        captureError(error, {
          tags: { area: "slides-save-boundary" },
          extra: { slideId: session.slideId },
        });
      }
      if (content !== null) persistInlineEditDraft(session.slideId, content);
      return { content, element, slideId: session.slideId };
    },
    [persistInlineEditDraft, serializeSlideContentHtml, t],
  );

  const flushInlineEditDraft = useCallback(() => {
    const activeSlideId = textSessionRef.current?.slideId;
    if (activeSlideId === slide.id) captureInlineEditDraft(activeSlideId);
    const draft = inlineEditDraftRef.current;
    if (!draft) return false;
    if (activeSlideId !== slide.id && draft.slideId === slide.id) {
      captureInlineEditDraft(draft.slideId);
    }
    flushPendingSaves();
    return true;
  }, [captureInlineEditDraft, slide.id]);

  useEffect(() => {
    if (!flushInlineEditRef) return;
    flushInlineEditRef.current = flushInlineEditDraft;
    return () => {
      if (flushInlineEditRef.current === flushInlineEditDraft) {
        flushInlineEditRef.current = null;
      }
    };
  }, [flushInlineEditDraft, flushInlineEditRef]);

  // Inline editing keeps its latest HTML in the DOM until blur so React does
  // not rerender the contentEditable on every keystroke. Hand that draft to
  // the keepalive queue before browser teardown.
  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushInlineEditDraft();
    };

    window.addEventListener("beforeunload", flushInlineEditDraft, {
      capture: true,
    });
    window.addEventListener("pagehide", flushInlineEditDraft, {
      capture: true,
    });
    document.addEventListener("visibilitychange", flushWhenHidden, {
      capture: true,
    });
    return () => {
      window.removeEventListener("beforeunload", flushInlineEditDraft, {
        capture: true,
      });
      window.removeEventListener("pagehide", flushInlineEditDraft, {
        capture: true,
      });
      document.removeEventListener("visibilitychange", flushWhenHidden, {
        capture: true,
      });
    };
  }, [flushInlineEditDraft]);

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
   * coordinates once the user starts moving it. A hidden same-size sibling
   * retains the flex/grid slot, so the rest of the slide does not reflow.
   */
  const freezeElementForFreeformSelection = useCallback(
    (
      element: HTMLElement,
    ): {
      element: HTMLElement;
      restoreMarkdownTree?: () => void;
      restoreDescendants?: () => void;
    } | null => {
      // Freezing a cell or row would pull it out of its table.
      if (isSlideTableStructureElement(element)) return null;
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
      const sizing = resolveFreeformSizing(element);
      let fmdSlide = element.closest(".fmd-slide") as HTMLElement | null;
      // Only a promoted Markdown node changes parents and so needs its
      // inherited text styles pinned. Pinning them in place would also turn an
      // inherited unitless line-height into px for every nested text size.
      const changesParent = !fmdSlide;
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

      const box = clientRectToContainingBlockBox(
        elementRect,
        element,
        containingBlock,
        fmdSlide,
      );
      if (!box) return { element, restoreMarkdownTree };
      const restoreDescendants = keepAbsoluteDescendantsInPlace(element, () =>
        freezeSlideElementForFreeform(
          element,
          box,
          {
            display: originalComputed.display,
            flexGrow: originalComputed.flexGrow,
            flexShrink: originalComputed.flexShrink,
            flexBasis: originalComputed.flexBasis,
            alignSelf: originalComputed.alignSelf,
          },
          changesParent
            ? {
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
              }
            : undefined,
          { sizing },
        ),
      );
      return { element, restoreMarkdownTree, restoreDescendants };
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
    return resolveSlideSelectionAnchor(slideContent, {
      objectId: null,
      path: selectedElementPath,
    });
  }, [getSlideContent, selectedElementPath, selectedObjectId]);

  const ensureCommentObjectId = useCallback(
    (target: HTMLElement) => {
      const hadObjectId = target.hasAttribute("data-slide-object-id");
      const objectId = ensureSlideObjectId(target);
      if (!hadObjectId) {
        const html = readCurrentSlideContentHtml();
        if (html !== null) {
          onUpdateSlideRef.current({ content: html }, undefined, {
            persistence: "immediate",
          });
        }
      }
      return objectId;
    },
    [readCurrentSlideContentHtml],
  );

  const getSelectedAnimationTarget =
    useCallback((): SelectedAnimationTarget | null => {
      const element = selectedImg ?? resolveSelectedElement();
      const root = element?.closest<HTMLElement>(".fmd-slide");
      if (!element || !root) return null;
      const elementPath = getPersistedElementPath(root, element);
      if (!elementPath || elementPath.length === 0) return null;
      const elementIndex = elementPath[elementPath.length - 1] ?? 0;
      return {
        elementIndex,
        elementPath,
        preview: getElementPreview(element, `Element ${elementIndex + 1}`),
      };
    }, [resolveSelectedElement, selectedImg]);

  const commentOnSelectedElement = useCallback(() => {
    const target = selectedImg ?? resolveSelectedElement();
    const canvas =
      slideCanvasRef.current?.closest<HTMLElement>(
        "[data-main-slide-canvas='true']",
      ) ?? null;
    if (!target || !canvas || !onComment) return;

    const objectId = ensureCommentObjectId(target);
    const rect = target.getBoundingClientRect();
    const anchor = slideCommentAnchorAtPoint({
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      slideRect: canvas.getBoundingClientRect(),
      objectId,
      objectRect: rect,
      targetText: target.textContent?.replace(/\s+/g, " ").trim(),
    });
    onComment("", anchor);
  }, [ensureCommentObjectId, onComment, resolveSelectedElement, selectedImg]);

  useEffect(() => {
    onSelectedAnimationTargetChange?.(getSelectedAnimationTarget());
  }, [getSelectedAnimationTarget, onSelectedAnimationTargetChange]);

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
        shapeMode: Boolean(shapeType),
        activeTool,
      }),
    [deckId, drawMode, pinMode, shapeType, slide.id, slideIndex, textBoxMode],
  );

  const clearSelectedElement = useCallback(() => {
    richTextSelectionRef.current = null;
    setSelectedElementPath(null);
    setSelectedObjectId(null);
    setSelectedElementSlideId(null);
    setSelectedElementSelector(null);
    setSelectedElementMeasurement(null);
    setSelectedStyleSnapshot(null);
    setSelectedVideoPlayback(null);
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
      const { objectId, path } = resolveSelectionIdentity(
        element,
        slideContent,
      );
      if (path.length === 0) return;
      const snapshot = buildStyleSnapshot(element, selector);
      setSelectedVideoPlayback(
        element.tagName === "VIDEO"
          ? videoPlaybackSettingsFor(element as HTMLVideoElement)
          : null,
      );
      setSelectedElementPath(path);
      setSelectedObjectId(objectId);
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

  const updateSelectedVideoPlayback = useCallback(
    (settings: VideoPlaybackSettings) => {
      const selected = resolveSelectedElement();
      if (!selected || selected.tagName !== "VIDEO") return;
      applyVideoPlaybackSettings(selected as HTMLVideoElement, settings);
      setSelectedVideoPlayback(settings);
      const html = readCurrentSlideContentHtml();
      if (html !== null) {
        onUpdateSlideRef.current({ content: html }, slide.id, {
          persistence: "immediate",
        });
      }
    },
    [readCurrentSlideContentHtml, resolveSelectedElement, slide.id],
  );

  /** Exit edit mode, saving changed content without changing its layout. */
  const exitInlineEdit = useCallback(
    (
      newer?: SlideContentReplaceDetail,
      clearSelectionAfterExit = false,
    ): string | undefined => {
      const el = editingElRef.current;
      if (!el) return;

      // Selection and freeform promotion are separate operations. Merely ending
      // text editing must not turn a flow-layout block into an absolutely
      // positioned object, because that changes its available wrapping width.
      const slideContent = getSlideContent();

      const ended = endTextSession(newer);
      const slideId = ended?.slideId ?? slide.id;
      const html = ended ? ended.content : readCurrentSlideContentHtml();
      const selected = ended?.element ?? el;
      const selectionTarget = slideContent
        ? resolveSlideTextSelectionTarget(selected, slideContent)
        : selected;
      const selector = getBuilderSelector(selectionTarget);
      editingElRef.current = null;
      (ended?.element ?? el).blur();
      richTextSelectionRef.current = null;
      window.getSelection()?.removeAllRanges();
      const initial = inlineEditInitialContentRef.current;
      let normalizedContentHash: string | undefined;
      if (html !== null) {
        const current = { slideId, content: html };
        if (shouldPersistInlineEditContent(initial, current)) {
          const latestDraft = inlineEditDraftRef.current;
          normalizedContentHash = rawOnUpdateSlideRef.current(
            { content: html },
            slideId,
            shouldPersistInlineEditContent(latestDraft, current)
              ? undefined
              : { recordUndoOnly: true },
          );
        }
      }
      onInlineEditEnd?.(slideId);
      inlineEditDraftRef.current = null;
      inlineEditInitialContentRef.current = null;
      const escape = slidesCanvasInteractionCore.escape({
        editingObjectId: "inline-editing",
        selectedObjectIds: resolveSelectedElement() ? ["selected"] : [],
      });
      setEditingEl(null);
      if (clearSelectionAfterExit || escape.action === "clear-selection") {
        clearSelectedElement();
        syncSelectionToAppState(null);
      } else if (
        escape.action === "select-object" &&
        selectionTarget &&
        selector
      ) {
        selectElementForStyling(selectionTarget, selector);
      } else {
        syncSelectionToAppState(null);
      }
      return (
        normalizedContentHash ??
        (html === null ? undefined : hashSlideContent(html))
      );
    },
    [
      getSlideContent,
      readCurrentSlideContentHtml,
      endTextSession,
      resolveSelectedElement,
      selectElementForStyling,
      slide.id,
      clearSelectedElement,
      onInlineEditEnd,
    ],
  );
  exitInlineEditRef.current = exitInlineEdit;

  const commitInlineEditForAgent = useCallback(async () => {
    const contentHash = exitInlineEdit();
    await onFlushInlineEdit?.();
    return contentHash;
  }, [exitInlineEdit, onFlushInlineEdit]);

  /** Enter edit mode on a smart block (text leaf or smart group) */
  const enterInlineEdit = useCallback(
    (
      block: HTMLElement,
      point?: { x: number; y: number },
      selectWord = false,
    ) => {
      const slideContent = getSlideContent();
      if (!slideContent || !slideContent.contains(block)) return;
      // A bullet is edited as part of its list: the list is the edit root, so
      // Enter adds a bullet beside the row and an empty last one is removed.
      const list = findEnclosingList(block, slideContent);
      const el =
        list &&
        (isRichTextBlock(list) || bulletRowCount(list) >= 2) &&
        !holdsPaintedTextBox(list, slideContent)
          ? list
          : block;
      const activeSession = textSessionRef.current;
      if (activeSession?.text.element === el) return;
      if (activeSession) exitInlineEdit();
      const selectionTarget = resolveSlideTextSelectionTarget(el, slideContent);
      const selector = getBuilderSelector(selectionTarget);
      if (selector) {
        selectElementForStyling(selectionTarget, selector, "editing");
      }
      const nativeSelection = window.getSelection();
      const nativeRange =
        nativeSelection?.rangeCount === 1
          ? nativeSelection.getRangeAt(0)
          : null;
      const initialSelectedText =
        nativeRange &&
        !nativeRange.collapsed &&
        el.contains(nativeRange.startContainer) &&
        el.contains(nativeRange.endContainer)
          ? nativeRange.toString()
          : undefined;
      // The no-change baseline is what the canvas saves before any typing:
      // the stored string itself for a stored element (a merge with no edit
      // returns it exactly), or the content with a just-placed text box, which
      // a Markdown canvas or an abandoned empty box must not write.
      inlineEditDraftRef.current = null;
      const entryContent = readCurrentSlideContentHtml();
      inlineEditInitialContentRef.current =
        entryContent === null
          ? null
          : { slideId: slide.id, content: entryContent };
      const slideId = slide.id;
      // The element itself becomes editable: no copy, overlay, or restyle, so
      // entering edit changes nothing on the slide. The caret lands at the
      // click or double-click: a press in an object's move band is prevented,
      // so the browser places no native selection or word there.
      const text = startInPlaceTextSession(el, {
        caretPoint: point,
        selectWord,
        onRequestLink: (range) => {
          const currentEl = textSessionRef.current?.text.element;
          if (currentEl)
            setKeyboardLinkRequest({ editingEl: currentEl, range });
        },
        onInput: () => {
          if (textSessionRef.current?.text !== text) return;
          // A list toggle or its undo can retag the edited element.
          if (text.element !== editingElRef.current) {
            editingElRef.current = text.element;
            setEditingEl(text.element);
          }
          scheduleInlineEditDraftCapture(slideId);
          remeasureSelectionRef.current?.();
        },
      });
      textSessionRef.current = { slideId, slideContent, text };
      // Keep the inspector selection mounted while text is being edited. The
      // inspector is a stable dock, so clearing it here would make the canvas
      // resize and auto-fit again on the second click.
      setSelectedElementMeasurement(null);
      editingElRef.current = el;
      setEditingEl(el);
      // Mark the slide active immediately so SSE/poll refreshes do not replace
      // the live DOM under an active contentEditable edit, even before the
      // user types and triggers an onUpdateSlide flush.
      onInlineEditStart?.(slideId);
      if (selector) {
        const item = selectionItemForElement(
          selectionTarget,
          selector,
          undefined,
          undefined,
          initialSelectedText,
        );
        syncSelectionToAppState(
          buildSelectionState("editing", [{ ...item, kind: "text" }]),
        );
      }
    },
    [
      buildSelectionState,
      exitInlineEdit,
      getSlideContent,
      onInlineEditStart,
      readCurrentSlideContentHtml,
      scheduleInlineEditDraftCapture,
      selectElementForStyling,
      slide.id,
    ],
  );

  // Exit edit mode when switching slides — save pending content first so
  // typing isn't lost when the user clicks a different slide in the sidebar.
  useEffect(() => {
    const previousSlideId = previousSlideIdRef.current;
    if (previousSlideId === slide.id) return;

    if (textSessionRef.current) endTextSession();
    const draft = inlineEditDraftRef.current;
    const editing = editingElRef.current;
    if (editing) {
      editing.contentEditable = "false";
      editing.removeAttribute("data-editing-block");
    }
    editingElRef.current = null;
    richTextSelectionRef.current = null;
    setEditingEl(null);

    const initial = inlineEditInitialContentRef.current;
    if (
      draft?.slideId === previousSlideId &&
      shouldPersistInlineEditContent(initial, draft)
    ) {
      onUpdateSlideRef.current({ content: draft.content }, previousSlideId, {
        recordUndoOnly: true,
      });
    }
    if (editing || draft) onInlineEditEnd?.(previousSlideId);
    inlineEditDraftRef.current = null;
    inlineEditInitialContentRef.current = null;

    previousSlideIdRef.current = slide.id;
  }, [endTextSession, onInlineEditEnd, slide.id]);

  // Editor unmount (navigating away, closing the deck) skips the slide-switch
  // effect above entirely, so an active edit's "mid-edit" marker would
  // otherwise never clear and permanently block live sync for that slide.
  useEffect(() => {
    return () => {
      if (textSessionRef.current) endTextSession();
      const draft = inlineEditDraftRef.current;
      const initial = inlineEditInitialContentRef.current;
      if (shouldPersistInlineEditContent(initial, draft) && draft) {
        onUpdateSlideRef.current({ content: draft.content }, draft.slideId, {
          recordUndoOnly: true,
        });
      }
      if (editingElRef.current || draft) {
        onInlineEditEndRef.current?.(
          draft?.slideId ?? previousSlideIdRef.current,
        );
      }
      inlineEditDraftRef.current = null;
      inlineEditInitialContentRef.current = null;
    };
  }, [endTextSession]);

  // Another slide's HTML is about to replace the canvas under an open edit
  // (the agent navigated, or a slide switch rendered before the effect above
  // ran). Save the edit while its DOM still exists.
  useEffect(() => {
    const boundary = contentReplaceBoundaryRef.current;
    if (!boundary) return;
    const commit = (event: Event) => {
      const newer = (event as CustomEvent<SlideContentReplaceDetail | null>)
        .detail;
      if (textSessionRef.current) exitInlineEditRef.current(newer ?? undefined);
    };
    boundary.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    return () =>
      boundary.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
  }, []);

  // Another writer's saved edit to this slide is shown around the open text
  // edit instead of waiting for it to end. The edited element is never
  // replaced, so the caret, selection and IME composition stay where they are.
  useEffect(() => {
    if (!editingEl || !deckId) return;
    const slideId = slide.id;
    let composing = false;
    const onCompositionStart = () => {
      composing = true;
    };
    const onCompositionEnd = () => {
      composing = false;
      requestInlineEditRemoteRetry(deckId);
    };
    editingEl.addEventListener("compositionstart", onCompositionStart);
    editingEl.addEventListener("compositionend", onCompositionEnd);
    const unregister = registerInlineEditRemoteApplier(
      deckId,
      slideId,
      (confirmed, remote) => {
        const session = textSessionRef.current;
        if (!session || session.slideId !== slideId) return "held";
        if (composing) return "later";
        const result = applyRemoteSlideContentUnderEdit(
          session.slideContent,
          confirmed,
          remote,
        );
        if (result !== "applied") return "held";
        // The no-change baseline is the stored copy the edit started from.
        // Once that copy moved on, a stale one would be saved over the other
        // writer's change when the typing nets out, so only an exact match is
        // carried forward; otherwise the live canvas is serialized instead.
        const initial = inlineEditInitialContentRef.current;
        inlineEditInitialContentRef.current =
          initial?.slideId === slideId && initial.content === confirmed
            ? { slideId, content: remote }
            : null;
        return "applied";
      },
    );
    return () => {
      unregister();
      editingEl.removeEventListener("compositionstart", onCompositionStart);
      editingEl.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [deckId, editingEl, slide.id]);

  const [selectionWriteOwner] = useState(() => ({}));
  useEffect(
    () => () => cancelPendingSelectionWrite(selectionWriteOwner),
    [selectionWriteOwner],
  );

  // Keep canvas gesture handlers from stealing the browser's native text
  // selection stream once an inline edit has started.
  useEffect(() => {
    if (!editingEl) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0) event.stopPropagation();
    };
    editingEl.addEventListener("pointerdown", onPointerDown);
    return () => editingEl.removeEventListener("pointerdown", onPointerDown);
  }, [editingEl]);

  useEffect(() => {
    if (!editingEl) return;

    const updateInspectorTextStyle = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount !== 1) return;
      const editingSurface = getRichTextEditorSurface();
      if (!editingSurface) return;
      const range = selection.getRangeAt(0);
      if (
        !editingSurface.contains(range.startContainer) ||
        !editingSurface.contains(range.endContainer)
      ) {
        // Inspector and portalled picker interactions move browser focus away
        // from the slide. Retain the last valid range until the user places a
        // new caret or selection inside this editable.
        return;
      }

      richTextSelectionRef.current = snapshotEditableTextRange(
        editingSurface,
        selection,
      );
      const slideContent = getSlideContent();
      const selectionTarget = slideContent
        ? resolveSlideTextSelectionTarget(editingEl, slideContent)
        : editingEl;
      const selector =
        selectedElementSelector ?? getBuilderSelector(selectionTarget);
      if (!selector) return;
      const snapshot = buildStyleSnapshot(
        editingEl,
        selector,
        getInlineTextStyleSnapshot(editingSurface, selection),
      );
      setSelectedStyleSnapshot((current) =>
        haveSameSlideStyleControls(current, snapshot) ? current : snapshot,
      );
      syncSelectionToAppState(
        buildSelectionState("editing", [
          selectionItemForElement(
            selectionTarget,
            selector,
            snapshot,
            undefined,
            richTextSelectionRef.current?.toString(),
          ),
        ]),
        { debounce: selectionWriteOwner },
      );
    };

    updateInspectorTextStyle();
    document.addEventListener("selectionchange", updateInspectorTextStyle);
    return () =>
      document.removeEventListener("selectionchange", updateInspectorTextStyle);
  }, [
    editingEl,
    getRichTextEditorSurface,
    getSlideContent,
    selectedElementSelector,
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
      !editingEl &&
      !isSelectionOverlayAutofitSettled(settledAutofitKey, canvasAutofitKey)
    ) {
      // AutoFit changes the element's viewport rect in a rAF. Do not publish
      // pre-fit coordinates into the portal while the renderer is settling.
      // It never measures while text is edited, so each draft capture would
      // otherwise leave the key unsettled and hide the outline until the edit
      // ends.
      setSelectedElementMeasurement(null);
      return;
    }
    let observedElement: HTMLElement | null = null;
    // Geometry alone: the outline has to land in the frame the box changed
    // in, so this never builds the style snapshot or touches app state.
    // `flush` commits before paint for callers that run after layout.
    const measureGeometry = (flush: boolean): HTMLElement | null => {
      const element = resolveSelectedElement();
      if (!element) return null;
      const editingElement = editingElRef.current;
      const slideContent = editingElement ? getSlideContent() : null;
      const resolvedEditingElement =
        editingElement && slideContent
          ? resolveSlideTextSelectionTarget(editingElement, slideContent)
          : editingElement;
      const rect = element.getBoundingClientRect();
      const measurement: SelectionOverlayMeasurement = {
        key: selectionOverlayMeasurementKey,
        rect,
        frame: readSlideObjectSelectionFrame(
          element,
          rect,
          editingElement && resolvedEditingElement === element
            ? readEditedFrameOptions(element)
            : undefined,
        ),
      };
      const selectionRoot = getSlideContent();
      const parentGroup =
        selectionRoot && element.parentElement
          ? resolveSlideObjectGroupRoot(element.parentElement, selectionRoot)
          : null;
      const container =
        parentGroup ??
        (selectionRoot
          ? findSlideShapeOwner(element.parentElement, selectionRoot)
          : null);
      const containerRect = container?.getBoundingClientRect();
      const nextContainer =
        container && containerRect
          ? {
              rect: containerRect,
              frame: readSlideObjectSelectionFrame(container, containerRect),
              group: parentGroup !== null,
            }
          : null;
      if (
        isSameSelectionMeasurement(
          selectedElementMeasurementRef.current,
          measurement,
        ) &&
        isSameSelectedContainer(selectedContainerRef.current, nextContainer)
      ) {
        return element;
      }
      const publish = () => {
        setSelectedElementMeasurement(measurement);
        setSelectedContainer(nextContainer);
      };
      if (flush) flushSync(publish);
      else publish();
      return element;
    };
    const syncStyleAndSelection = (element: HTMLElement) => {
      const editingElement = editingElRef.current;
      const editingSurface = getRichTextEditorSurface();
      const slideContent = editingElement ? getSlideContent() : null;
      const resolvedEditingElement =
        editingElement && slideContent
          ? resolveSlideTextSelectionTarget(editingElement, slideContent)
          : editingElement;
      const inlineTextStyle =
        editingElement && resolvedEditingElement === element
          ? getInlineTextStyleSnapshotForRange(
              editingSurface ?? editingElement,
              richTextSelectionRef.current,
            )
          : undefined;
      const snapshot = buildStyleSnapshot(
        element,
        selectedElementSelector,
        inlineTextStyle,
      );
      const selectedText =
        editingElement && resolvedEditingElement === element
          ? richTextSelectionRef.current?.toString()
          : undefined;
      setSelectedStyleSnapshot(snapshot);
      syncSelectionToAppState(
        buildSelectionState(getSlideSelectionMode(snapshot), [
          selectionItemForElement(
            element,
            selectedElementSelector,
            snapshot,
            undefined,
            selectedText,
          ),
        ]),
      );
    };
    const update = () => {
      const element = measureGeometry(false);
      if (!element) {
        clearSelectedElement();
        syncSelectionToAppState(null);
        return;
      }
      syncStyleAndSelection(element);
    };
    // A resize or scroll moves geometry now and the style readout and app
    // state once the burst settles.
    let styleSyncTimer: ReturnType<typeof setTimeout> | undefined;
    const followGeometry = (flush: boolean) => {
      if (!measureGeometry(flush)) {
        clearSelectedElement();
        syncSelectionToAppState(null);
        return;
      }
      clearTimeout(styleSyncTimer);
      styleSyncTimer = setTimeout(() => {
        const element = resolveSelectedElement();
        if (element) syncStyleAndSelection(element);
      }, SELECTION_SYNC_DEBOUNCE_MS);
    };
    const onResizeObserved = () => followGeometry(true);
    const onViewportChange = () => followGeometry(false);
    update();
    // Typing remeasures in the input event, before the frame is painted.
    const remeasureGeometry = () => {
      measureGeometry(true);
    };
    remeasureSelectionRef.current = remeasureGeometry;

    observedElement = resolveSelectedElement();
    const positioningLayer = observedElement?.closest(
      "[data-fmd-autofit-content], .fmd-slide",
    ) as HTMLElement | null;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResizeObserved);
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
            selectedElementMeasurementRef.current = null;
            update();
          });
    if (mutationObserver && positioningLayer) {
      mutationObserver.observe(positioningLayer, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      if (remeasureSelectionRef.current === remeasureGeometry) {
        remeasureSelectionRef.current = null;
      }
      clearTimeout(styleSyncTimer);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [
    buildSelectionState,
    clearSelectedElement,
    getRichTextEditorSurface,
    getSlideContent,
    resolveSelectedElement,
    selectedElementPath,
    selectedElementSlideId,
    selectedElementSelector,
    canvasAutofitKey,
    settledAutofitKey,
    selectionOverlayMeasurementKey,
    editingEl,
    slide.content,
    slide.id,
  ]);

  useLayoutEffect(() => {
    if (!layersOpen || !hoveredLayerId) {
      setHoveredLayerMeasurement(null);
      return;
    }

    const update = () => {
      const slideContent = getSlideContent();
      const element = slideContent?.querySelector<HTMLElement>(
        `[data-builder-id="${hoveredLayerId}"]`,
      );
      if (!element) {
        setHoveredLayerMeasurement(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      setHoveredLayerMeasurement({
        id: hoveredLayerId,
        rect,
        frame: readSlideObjectSelectionFrame(element, rect),
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [canvasZoom, getSlideContent, hoveredLayerId, layersOpen, slide.content]);

  useEffect(() => {
    if (!layersOpen) setHoveredLayerId(null);
  }, [layersOpen]);

  // Deselect when clicking outside
  useEffect(() => {
    if (!selectedImg) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".image-overlay-menu") ||
        target.closest("[data-slide-selection-chrome]")
      ) {
        return;
      }
      if (imageCropRef.current) {
        if (imageCropRef.current.frame.contains(target)) return;
        finishImageCrop(true);
        return;
      }
      if (target.tagName === "IMG" && containerRef.current?.contains(target))
        return;
      setSelectedImg(null);
      setImageOverlay(null);
      syncSelectionToAppState(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [finishImageCrop, selectedImg]);

  // Clear selection when slide changes
  useEffect(() => {
    if (imageCropRef.current) finishImageCrop(false);
    setSelectedImg(null);
    setImageOverlay(null);
    syncSelectionToAppState(buildSelectionState("canvas", []));
  }, [buildSelectionState, finishImageCrop, slide.id]);

  useEffect(() => {
    const crop = imageCropRef.current;
    if (
      crop &&
      (crop.slideId !== slide.id ||
        crop.content !== slide.content ||
        !crop.frame.isConnected)
    ) {
      finishImageCrop(false);
    }
  }, [finishImageCrop, slide.content, slide.id]);

  // Content reconciliation can replace the DOM node behind an open overlay.
  useEffect(() => {
    if (!imageOverlay) return;
    const target = selectedImg;
    const targetIsLive = Boolean(
      target &&
      target.isConnected &&
      containerRef.current?.contains(target) &&
      (target.tagName !== "IMG" ||
        target.getAttribute("src") === imageOverlay.src),
    );
    if (targetIsLive) return;
    setSelectedImg(null);
    setImageOverlay(null);
    syncSelectionToAppState(null);
  }, [imageOverlay, selectedImg, slide.content]);

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
      // A canvas selection supersedes native text selection. Keep every entry
      // point (shift-click, marquee, layer panel, and restored selection) in
      // the same object-selection mode.
      if (ids.size > 0 && editingElRef.current) exitInlineEdit();
      const slideContent = getSlideContent();
      const members = new Set<string>();
      for (const id of ids) {
        const element = slideContent?.querySelector<HTMLElement>(
          `[data-builder-id="${id}"]`,
        );
        const ownerId =
          element && slideContent
            ? resolveSelectionOwnerId(element, slideContent)
            : id;
        if (ownerId) members.add(ownerId);
      }
      const rects = new Map<
        string,
        { rect: DOMRect; text: string; selector: string }
      >();
      const items: SlideSelectionItem[] = [];
      const styleSnapshots: SlideStyleSnapshot[] = [];
      if (slideContent) {
        members.forEach((id) => {
          const el = slideContent.querySelector(
            `[data-builder-id="${id}"]`,
          ) as HTMLElement | null;
          if (!el) return;
          const runtimeSelector = `[data-builder-id="${id}"]`;
          const text = (el.textContent || "").trim().slice(0, 200);
          const identity = getSlideSelectionIdentity(el, runtimeSelector);
          rects.set(id, {
            rect: el.getBoundingClientRect(),
            text,
            selector: identity.selector,
          });
          styleSnapshots.push(buildStyleSnapshot(el, identity.selector));
          items.push(selectionItemForElement(el, runtimeSelector));
        });
      }
      setMultiSelection(members);
      setMultiSelectionRects(rects);
      if (members.size > 0) {
        clearSelectedElement();
        setSelectedStyleSnapshot(mergeSlideStyleSnapshots(styleSnapshots));
        setSelectedImg(null);
        setImageOverlay(null);
      }
      // Anchor the chip to the slide canvas (clickable wrapper)
      const canvas = containerRef.current?.querySelector(
        ".slide-image-clickable",
      ) as HTMLElement | null;
      setChipAnchorRect(canvas?.getBoundingClientRect() || null);
      syncSelectionToAppState(
        items.length > 0 ? buildSelectionState("multi", items) : null,
      );
    },
    [
      buildSelectionState,
      clearSelectedElement,
      exitInlineEdit,
      getSlideContent,
    ],
  );

  // Reconciliation is keyed to the persisted slide content, not to the
  // selection callback's closure. Keep the latest callback available without
  // making the content effect interpret a selection-only rerender as a DOM
  // replacement.
  const applyMultiSelectionRef = useRef(applyMultiSelection);
  useEffect(() => {
    applyMultiSelectionRef.current = applyMultiSelection;
  }, [applyMultiSelection]);

  const clearMultiSelection = useCallback(() => {
    if (multiSelection.size === 0) return;
    applyMultiSelection(new Set());
  }, [applyMultiSelection, multiSelection.size]);

  /** Durable ids or pre-commit paths used to restore a multi-selection. */
  const pendingMultiSelectionResyncRef = useRef<{
    objectIds: Array<string | null>;
    paths: number[][];
  } | null>(null);

  const preserveMultiSelectionForUpdate = useCallback(
    (elements: readonly HTMLElement[]) => {
      const slideContent = getSlideContent();
      pendingMultiSelectionResyncRef.current = {
        objectIds: elements.map((element) =>
          element.getAttribute("data-slide-object-id"),
        ),
        paths: slideContent
          ? elements.map(
              (element) => resolveSelectionIdentity(element, slideContent).path,
            )
          : [],
      };
    },
    [getSlideContent],
  );

  const refreshLayerNodes = useCallback(() => {
    setLayerNodes(buildSlidesLayerTree(getSlideContent()));
  }, [getSlideContent]);

  useLayoutEffect(() => {
    if (layersOpen) refreshLayerNodes();
    else setLayerNodes([]);
  }, [layersOpen, refreshLayerNodes, slide.content]);

  const selectLayerFromPanel = useCallback(
    (id: string, additive: boolean) => {
      const slideContent = getSlideContent();
      const element = slideContent?.querySelector<HTMLElement>(
        `[data-builder-id="${id}"]`,
      );
      if (!slideContent || !element) return;

      if (additive) {
        const ownerId = resolveSelectionOwnerId(element, slideContent);
        if (!ownerId) return;
        const next = new Set(multiSelection);
        if (next.size === 0) {
          const selected = resolveSlideClipboardElement(
            resolveSelectedElement(),
            selectedImg,
            slideContent,
          );
          const selectedId = selected
            ? resolveSelectionOwnerId(selected, slideContent)
            : null;
          if (selectedId && selectedId !== ownerId) next.add(selectedId);
        }
        if (next.has(ownerId)) next.delete(ownerId);
        else next.add(ownerId);
        if (next.size === 0) clearMultiSelection();
        else applyMultiSelection(next);
        return;
      }

      if (multiSelection.size > 0) clearMultiSelection();
      setSelectedImg(null);
      setImageOverlay(null);
      const selector = getBuilderSelector(element);
      if (selector) selectElementForStyling(element, selector);
    },
    [
      applyMultiSelection,
      clearMultiSelection,
      getSlideContent,
      multiSelection,
      resolveSelectedElement,
      selectedImg,
      selectElementForStyling,
    ],
  );

  const moveLayerFromPanel = useCallback(
    (sourceId: string, targetId: string, placement: SlidesLayerPlacement) => {
      if (readOnly || sourceId === targetId) return;
      const slideContent = getSlideContent();
      const source = slideContent?.querySelector<HTMLElement>(
        `[data-builder-id="${sourceId}"]`,
      );
      const target = slideContent?.querySelector<HTMLElement>(
        `[data-builder-id="${targetId}"]`,
      );
      if (!source || !target || source.contains(target)) return;
      if (placement === "inside" && !canDropSlideLayerInside(target, source)) {
        return;
      }
      if (
        placement !== "inside" &&
        !canDropSlideLayerAdjacent(source, target)
      ) {
        return;
      }

      const originalParent = source.parentElement;
      const sourceWasFreeform = isPersistedFreeformObject(source);
      const nextParent = placement === "inside" ? target : target.parentElement;
      if (!sourceWasFreeform && nextParent !== originalParent) return;
      const selectedSingleElement =
        multiSelection.size === 0 ? resolveSelectedElement() : null;
      const selectedSingleSelector = selectedSingleElement
        ? (getBuilderSelector(selectedSingleElement) ?? selectedElementSelector)
        : null;
      const originalRect = source.getBoundingClientRect();
      const absoluteDescendantRects = Array.from(
        source.querySelectorAll<HTMLElement>("*"),
      )
        .filter(
          (element) => window.getComputedStyle(element).position === "absolute",
        )
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
        }));
      if (placement === "inside") {
        if (window.getComputedStyle(target).position === "static") {
          target.style.position = "relative";
        }
        target.appendChild(source);
      } else if (target.parentNode) {
        target.parentNode.insertBefore(
          source,
          placement === "before" ? target : target.nextSibling,
        );
      }

      if (source.parentElement !== originalParent) {
        const fallbackPositioningLayer = source.parentElement;
        if (!fallbackPositioningLayer) return;
        const positioningLayer =
          resolveSlidePositioningLayer(source) ?? fallbackPositioningLayer;
        const containingBlock = resolveSlideObjectContainingBlock(
          source,
          positioningLayer,
        );
        const rect = containingBlock?.getBoundingClientRect();
        if (
          containingBlock &&
          rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          containingBlock.offsetWidth > 0 &&
          containingBlock.offsetHeight > 0
        ) {
          const scaleX = containingBlock.offsetWidth / rect.width;
          const scaleY = containingBlock.offsetHeight / rect.height;
          source.style.position = "absolute";
          source.style.left = `${Math.round((originalRect.left - rect.left) * scaleX)}px`;
          source.style.top = `${Math.round((originalRect.top - rect.top) * scaleY)}px`;
          source.style.width = `${Math.round(originalRect.width * scaleX)}px`;
          writeReparentedHeight(
            source,
            Math.round(originalRect.height * scaleY),
          );

          for (const {
            element,
            rect: originalChildRect,
          } of absoluteDescendantRects) {
            const childContainingBlock = resolveSlideObjectContainingBlock(
              element,
              positioningLayer,
            );
            const childRect = childContainingBlock.getBoundingClientRect();
            if (
              childRect.width <= 0 ||
              childRect.height <= 0 ||
              childContainingBlock.offsetWidth <= 0 ||
              childContainingBlock.offsetHeight <= 0
            ) {
              continue;
            }
            const childScaleX =
              childContainingBlock.offsetWidth / childRect.width;
            const childScaleY =
              childContainingBlock.offsetHeight / childRect.height;
            element.style.left = `${Math.round((originalChildRect.left - childRect.left) * childScaleX)}px`;
            element.style.top = `${Math.round((originalChildRect.top - childRect.top) * childScaleY)}px`;
            element.style.width = `${Math.round(originalChildRect.width * childScaleX)}px`;
            writeReparentedHeight(
              element,
              Math.round(originalChildRect.height * childScaleY),
            );
          }
        }
      }

      if (sourceWasFreeform) {
        const positioningLayer = resolveSlidePositioningLayer(source);
        if (positioningLayer) {
          const containingBlock = resolveSlideObjectContainingBlock(
            source,
            positioningLayer,
          );
          persistSlideObjectZOrderFromDom(source, containingBlock);
        }
      }

      const html = readCurrentSlideContentHtml();
      if (html === null) return;
      if (selectedSingleElement?.isConnected && selectedSingleSelector) {
        selectElementForStyling(selectedSingleElement, selectedSingleSelector);
      }
      if (multiSelection.size > 0) {
        pendingMultiSelectionResyncRef.current = {
          objectIds: Array.from(multiSelection).map((id) => {
            const element = slideContent?.querySelector(
              `[data-builder-id="${id}"]`,
            ) as HTMLElement | null;
            return element?.getAttribute("data-slide-object-id") ?? null;
          }),
          paths: [],
        };
      }
      refreshLayerNodes();
      onUpdateSlideRef.current({ content: html }, undefined, {
        persistence: "immediate",
      });
    },
    [
      getSlideContent,
      getBuilderSelector,
      multiSelection,
      readCurrentSlideContentHtml,
      readOnly,
      resolveSelectedElement,
      refreshLayerNodes,
      selectedElementSelector,
      selectElementForStyling,
    ],
  );

  const commitMultiObjectChange = useCallback(
    (
      objectIds: string[],
      serializedContent?: string,
      options?: UpdateSlideOptions,
    ) => {
      pendingMultiSelectionResyncRef.current = { objectIds, paths: [] };
      const html = serializedContent ?? readCurrentSlideContentHtml();
      if (html !== null) {
        onUpdateSlideRef.current({ content: html }, undefined, options);
      }
    },
    [readCurrentSlideContentHtml],
  );

  useEffect(() => {
    const pending = pendingMultiSelectionResyncRef.current;
    pendingMultiSelectionResyncRef.current = null;
    if (!pending) {
      // Undo/redo, agent reconciliation, and external updates replace the DOM
      // without preserving transient builder ids. Never leave stale ids in a
      // multi-selection that could later target unrelated newly-stamped nodes.
      applyMultiSelectionRef.current(new Set());
      return;
    }
    const slideContent = getSlideContent();
    if (!slideContent) return;
    stampBuilderIds(slideContent);
    const ids = new Set<string>();
    for (const [index, objectId] of pending.objectIds.entries()) {
      const element =
        (objectId && findSlideObjectById(slideContent, objectId)) ||
        resolveSlideSelectionAnchor(slideContent, {
          objectId: null,
          path: pending.paths[index] ?? [],
        });
      const builderId = element?.getAttribute("data-builder-id");
      if (builderId) ids.add(builderId);
    }
    applyMultiSelectionRef.current(ids);
  }, [slide.content, getSlideContent]);

  // Undo/redo leaves the objects the step changed selected, like Google
  // Slides. This runs after the content effect above, which drops the old
  // selection because the DOM was replaced.
  const appliedUndoSelectionRef = useRef(0);
  useEffect(() => {
    // A request for another slide waits for the slide switch; every other
    // bail drops it so a later content change cannot apply stale paths.
    if (!undoSelection || undoSelection.slideId !== slide.id) return;
    const slideContent = getSlideContent();
    if (
      !slideContent ||
      undoSelection.sequence <= appliedUndoSelectionRef.current ||
      !undoSelection.targets ||
      editingElRef.current
    ) {
      onUndoSelectionConsumed?.();
      return;
    }
    appliedUndoSelectionRef.current = undoSelection.sequence;
    onUndoSelectionConsumed?.();
    const root = slideContent.querySelector(".fmd-slide");
    const elements = undoSelection.targets
      .map(
        (target) =>
          (target.objectId &&
            findSlideObjectById(slideContent, target.objectId)) ||
          (root && resolveElementPath(root, target.path)),
      )
      .filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
    stampBuilderIds(slideContent);
    const selectable = elements.filter((element) =>
      element.hasAttribute("data-builder-id"),
    );
    if (selectable.length > 1) {
      applyMultiSelectionRef.current(
        new Set(
          selectable.map((element) => element.getAttribute("data-builder-id")!),
        ),
      );
    } else if (selectable[0]) {
      applyMultiSelectionRef.current(new Set());
      selectElementForStyling(
        selectable[0],
        `[data-builder-id="${selectable[0].getAttribute("data-builder-id")}"]`,
      );
    } else if (!resolveSelectedElement()) {
      applyMultiSelectionRef.current(new Set());
      clearSelectedElement();
    }
  }, [
    clearSelectedElement,
    getSlideContent,
    resolveSelectedElement,
    selectElementForStyling,
    slide.content,
    slide.id,
    undoSelection,
    onUndoSelectionConsumed,
  ]);

  /**
   * Keeps the release click of an Escape-cancelled press from click-selecting
   * the object the press started on. The release can be lost (mouseup outside
   * the window, alt-tab), so a hold also ends when its pointer presses again,
   * when the window loses focus, and once the timeout has passed with no
   * button down. Only the held pointer's events speak for its hold.
   */
  const holdCancelledPress = useCallback((pointerId: number) => {
    const holds = cancelledPressesRef.current;
    holds.get(pointerId)?.();
    const ownsPress = (pointerEvent: PointerEvent) =>
      pointerEvent.pointerId === pointerId;
    let buttonDown = true;
    let timedOut = false;
    const drop = () => {
      if (holds.get(pointerId) === onLost) holds.delete(pointerId);
    };
    const settle = (afterClick: boolean) => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("blur", onLost);
      window.clearTimeout(timer);
      // The click that ends the press arrives after its release.
      if (afterClick) window.setTimeout(drop, 0);
      else drop();
    };
    const onRelease = (releaseEvent: PointerEvent) => {
      if (ownsPress(releaseEvent)) settle(true);
    };
    const onPress = (pressEvent: PointerEvent) => {
      if (ownsPress(pressEvent)) settle(false);
    };
    const onLost = () => settle(false);
    const onMove = (moveEvent: PointerEvent) => {
      if (!ownsPress(moveEvent)) return;
      buttonDown = moveEvent.buttons !== 0;
      if (timedOut && !buttonDown) onLost();
    };
    const timer = window.setTimeout(() => {
      timedOut = true;
      if (!buttonDown) onLost();
    }, CANCEL_CLICK_SUPPRESSION_TIMEOUT_MS);
    holds.set(pointerId, onLost);
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("blur", onLost);
  }, []);

  // One Escape owner for the HTML editor. Radix dialogs/popovers and native
  // form controls retain their own Escape behavior before we arbitrate canvas
  // state. Gesture cancellation is deliberately ahead of selection clearing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== "Escape") return;
      if (imageCropRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finishImageCrop(true);
        return;
      }
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
      const held = activeGestureRef.current;
      const action = decideSlideEscape({
        editing: Boolean(editing),
        activeGesture: held !== null,
        activeMode: Boolean(drawMode || pinMode || textBoxMode || shapeType),
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
        slideCanvasRef.current?.focus({ preventScroll: true });
      } else if (action === "gesture" && held) {
        // The cancel restores the selection the gesture started with; Escape
        // then clears it, as in Google Slides.
        held.cancel();
        clearMultiSelection();
        clearSelectedElement();
        syncSelectionToAppState(null);
        pointerPressRef.current = null;
        holdCancelledPress(held.pointerId);
      } else if (action === "mode") {
        if (drawMode) onExitDrawMode?.();
        else if (pinMode) onExitPinMode?.();
        else if (shapeType) onExitShapeMode?.();
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
    finishImageCrop,
    holdCancelledPress,
    multiSelection.size,
    onExitDrawMode,
    onExitPinMode,
    onExitShapeMode,
    onExitTextBoxMode,
    pinMode,
    selectedElementSelector,
    shapeType,
    textBoxMode,
  ]);

  // Tool state is useful even before the user places an object. This keeps
  // `view-screen` truthful while the text tool is armed and after it exits.
  useEffect(() => {
    if (editingEl || multiSelection.size > 0 || selectedElementSelector) {
      return;
    }
    syncSelectionToAppState(buildSelectionState("canvas", []));
  }, [
    buildSelectionState,
    editingEl,
    multiSelection.size,
    selectedElementSelector,
  ]);

  const getPlaceholderTarget = useCallback(
    (placeholder: HTMLElement): string => {
      const placeholders = containerRef.current
        ? Array.from(
            containerRef.current.querySelectorAll<HTMLElement>(
              ".slide-content .fmd-img-placeholder",
            ),
          )
        : [];
      const index = Math.max(0, placeholders.indexOf(placeholder));
      return createPlaceholderImageTarget(
        index,
        placeholder.textContent?.trim() || "image",
      );
    },
    [],
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
          selector: getSlideSelectionIdentity(el, `[data-builder-id="${id}"]`)
            .selector,
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
  const multiSelectionRefreshFrameRef = useRef<number | null>(null);
  const scheduledMultiSelectionIdsRef = useRef<Set<string> | null>(null);
  const scheduleMultiSelectionRects = useCallback(
    (ids: Set<string>) => {
      scheduledMultiSelectionIdsRef.current = ids;
      if (multiSelectionRefreshFrameRef.current !== null) return;
      multiSelectionRefreshFrameRef.current = requestAnimationFrame(() => {
        multiSelectionRefreshFrameRef.current = null;
        const scheduledIds = scheduledMultiSelectionIdsRef.current;
        scheduledMultiSelectionIdsRef.current = null;
        if (scheduledIds) refreshMultiSelectionRects(scheduledIds);
      });
    },
    [refreshMultiSelectionRects],
  );

  // Ids the selection chrome follows while an Alt-drag copy exists; the
  // originals' ids (`multiSelection`) are stale until the copies are committed.
  const copyDragRectIdsRef = useRef<Set<string> | null>(null);
  const cancelScheduledMultiSelectionRects = useCallback(() => {
    if (multiSelectionRefreshFrameRef.current !== null) {
      cancelAnimationFrame(multiSelectionRefreshFrameRef.current);
      multiSelectionRefreshFrameRef.current = null;
    }
    scheduledMultiSelectionIdsRef.current = null;
  }, []);

  useEffect(
    () => cancelScheduledMultiSelectionRects,
    [cancelScheduledMultiSelectionRects],
  );

  // Portal selection chrome uses viewport coordinates, so a flex layout change
  // can move the canvas without resizing the selected element. Re-measure the
  // active selection when the editor layout changes, not only on canvas input.
  useLayoutEffect(() => {
    if (
      !selectedImg &&
      multiSelection.size === 0 &&
      (!selectedElementPath || !selectedElementSelector)
    ) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const update = () => {
      setSelectionViewportRect(scrollContainer.getBoundingClientRect());
      if (selectedImg) setSelectionRect(selectedImg.getBoundingClientRect());
      if (multiSelection.size > 0) {
        refreshMultiSelectionRects(
          copyDragRectIdsRef.current ?? multiSelection,
        );
      }
      if (selectedElementPath && selectedElementSelector) {
        invalidateSelectionOverlayMeasurement();
      }
    };

    update();
    const layoutRoot = scrollContainer.closest(".deck-editor-workspace");
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    for (const element of [
      layoutRoot,
      scrollContainer,
      canvasTrackRef.current,
      containerRef.current,
      slideCanvasRef.current,
      selectedImg,
    ]) {
      if (element) resizeObserver?.observe(element);
    }
    const mutationObserver =
      typeof MutationObserver === "undefined" || !layoutRoot
        ? null
        : new MutationObserver(update);
    if (mutationObserver && layoutRoot) {
      mutationObserver.observe(layoutRoot, { childList: true });
    }
    layoutRoot?.addEventListener("animationend", update);
    layoutRoot?.addEventListener("transitionend", update);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      layoutRoot?.removeEventListener("animationend", update);
      layoutRoot?.removeEventListener("transitionend", update);
    };
  }, [
    animationsOpen,
    invalidateSelectionOverlayMeasurement,
    layersOpen,
    multiSelection,
    refreshMultiSelectionRects,
    selectedElementPath,
    selectedElementSelector,
    selectedImg,
  ]);

  // Keep cached rects fresh on scroll/resize so outlines + chip stay aligned.
  // Group drag calls the same helper every pointer move so its outlines do not
  // lag behind the objects until the next scroll or resize.
  useEffect(() => {
    if (multiSelection.size === 0) return;
    const update = () => {
      refreshMultiSelectionRects(copyDragRectIdsRef.current ?? multiSelection);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [multiSelection, refreshMultiSelectionRects]);

  // Clear multi-selection when slide changes, but keep the new slide as the
  // agent's target even when no element is selected. Keyed on the slide alone:
  // buildSelectionState changes identity when a tool mode ends, and the box a
  // tool just placed is selected before that happens.
  const buildSelectionStateRef = useRef(buildSelectionState);
  buildSelectionStateRef.current = buildSelectionState;
  useLayoutEffect(() => {
    setMultiSelection(new Set());
    setMultiSelectionRects(new Map());
    setChipAnchorRect(null);
    clearSelectedElement();
    syncSelectionToAppState(buildSelectionStateRef.current("canvas", []));
  }, [clearSelectedElement, slide.id]);

  const deleteSelectedElements = useCallback(
    (resolvedSelection?: readonly HTMLElement[]) => {
      const slideContent = getSlideContent();
      if (!slideContent) return false;

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
          roots.some((element) => !isDeletableSlideElement(element))
        ) {
          return false;
        }
        for (const element of roots) {
          removeSlideObjectAndLayoutSpacer(element, {
            preserveLayoutSlot: true,
          });
        }
        clearMultiSelection();
      } else {
        const element =
          resolvedSelection?.[0] ??
          resolveSlideClipboardElement(
            resolveSelectedElement(),
            selectedImg,
            slideContent,
          );
        if (!element) return false;
        if (!isDeletableSlideElement(element)) {
          return false;
        }
        if (isDeletableFlowImage(element)) {
          // Imported images can be nested inside an absolutely-positioned owner;
          // remove that owner so its persisted metadata cannot become a ghost.
          const owner = findPersistedImageObject(element, slideContent);
          if (owner) removeSlideObjectAndLayoutSpacer(owner);
          else {
            removeSlideObjectAndLayoutSpacer(element, {
              preserveLayoutSlot: true,
            });
          }
          setSelectedImg(null);
          setImageOverlay(null);
        } else {
          removeSlideObjectAndLayoutSpacer(element, {
            preserveLayoutSlot: true,
          });
        }
        clearSelectedElement();
      }

      const html = readCurrentSlideContentHtml();
      if (html !== null) {
        onUpdateSlideRef.current({ content: html, animations: [] }, undefined, {
          clearMissingImagePreviews: true,
        });
      }
      syncSelectionToAppState(null);
      return true;
    },
    [
      clearMultiSelection,
      clearSelectedElement,
      getSlideContent,
      multiSelection,
      readCurrentSlideContentHtml,
      resolveSelectedElement,
      selectedImg,
    ],
  );

  const commitTableMutation = useCallback(() => {
    const html = readCurrentSlideContentHtml();
    if (html !== null) onUpdateSlideRef.current({ content: html });
  }, [readCurrentSlideContentHtml]);

  /** Row/column ops below index cells by position, which only holds for a
   *  regular grid. `colspan`/`rowspan` are valid on imported tables
   *  (sanitize-slide-html allows them), so every op bails here rather than
   *  silently touching the wrong cell. */
  const tableHasMergedCells = useCallback((table: HTMLTableElement) => {
    return Array.from(table.rows).some((row) =>
      Array.from(row.cells).some((c) => c.colSpan > 1 || c.rowSpan > 1),
    );
  }, []);

  /** Column ops change cell count per row but not col tracks. A colgroup
   *  (imported decks can carry one — sanitize-slide-html allows it)
   *  positionally maps each col element to a column, so an unsynced insert
   *  or delete leaves too few/many tracks and visually misaligns columns.
   *  Row ops don't touch columns, so this only guards column ops. */
  const tableHasColgroup = useCallback((table: HTMLTableElement) => {
    return table.querySelector("colgroup") !== null;
  }, []);

  const insertTableRow = useCallback(
    (cell: HTMLTableCellElement, position: "above" | "below") => {
      const row = cell.closest("tr");
      const table = row?.closest("table");
      if (!row || !table || tableHasMergedCells(table)) return;
      const newRow = row.cloneNode(true) as HTMLTableRowElement;
      Array.from(newRow.cells).forEach((c) => {
        c.innerHTML = "";
      });
      row.insertAdjacentElement(
        position === "above" ? "beforebegin" : "afterend",
        newRow,
      );
      commitTableMutation();
    },
    [commitTableMutation, tableHasMergedCells],
  );

  const deleteTableRow = useCallback(
    (cell: HTMLTableCellElement) => {
      const row = cell.closest("tr");
      const table = row?.closest("table");
      if (
        !row ||
        !table ||
        table.rows.length <= 1 ||
        tableHasMergedCells(table)
      ) {
        return;
      }
      row.remove();
      commitTableMutation();
    },
    [commitTableMutation, tableHasMergedCells],
  );

  const insertTableColumn = useCallback(
    (cell: HTMLTableCellElement, position: "left" | "right") => {
      const table = cell.closest("table");
      if (!table) return;
      const columnIndex = cell.cellIndex;
      Array.from(table.rows).forEach((row) => {
        const refCell = row.cells[columnIndex];
        if (!refCell) return;
        if (tableHasMergedCells(table) || tableHasColgroup(table)) return;
        const newCell = document.createElement(
          refCell.tagName,
        ) as HTMLTableCellElement;
        newCell.className = refCell.className;
        const style = refCell.getAttribute("style");
        if (style) newCell.setAttribute("style", style);
        refCell.insertAdjacentElement(
          position === "left" ? "beforebegin" : "afterend",
          newCell,
        );
      });
      commitTableMutation();
    },
    [commitTableMutation, tableHasMergedCells, tableHasColgroup],
  );

  const deleteTableColumn = useCallback(
    (cell: HTMLTableCellElement) => {
      const table = cell.closest("table");
      if (!table) return;
      const columnIndex = cell.cellIndex;
      const firstRow = table.rows[0];
      if (!firstRow || firstRow.cells.length <= 1) return;
      Array.from(table.rows).forEach((row) => {
        if (tableHasMergedCells(table) || tableHasColgroup(table)) return;
        row.cells[columnIndex]?.remove();
      });
      commitTableMutation();
    },
    [commitTableMutation, tableHasMergedCells, tableHasColgroup],
  );

  // Delete/Backspace removes the selected slide content (single or
  // multi-select). Only active when something is selected for styling (not
  // while inline-editing text, where Backspace should delete a character) and
  // not while the browser focus is in an unrelated input.
  useEffect(() => {
    if (editingEl) return;
    if (multiSelection.size === 0 && !selectedElementSelector) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (active instanceof HTMLElement && active.isContentEditable) return;
      if (
        active instanceof HTMLElement &&
        active.closest("[data-slide-thumbnail-id]")
      )
        return;
      if (deleteSelectedElements()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    deleteSelectedElements,
    editingEl,
    multiSelection,
    selectedElementSelector,
  ]);

  const findTableCell = useCallback(
    (
      target: HTMLElement,
      slideContent: HTMLElement,
    ): HTMLTableCellElement | null => {
      let el: HTMLElement | null = target;
      while (el && slideContent.contains(el) && el !== slideContent) {
        if (el.tagName === "TD" || el.tagName === "TH") {
          return el as HTMLTableCellElement;
        }
        el = el.parentElement;
      }
      return null;
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
            const element =
              resolveSelectedElement() ??
              (selectedImg
                ? (findPersistedImageObject(selectedImg, slideContent) ??
                  selectedImg)
                : null);
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
  }, [getSlideContent, multiSelection, resolveSelectedElement, selectedImg]);

  /**
   * Paste (or duplicate-via-copy+paste) `copied` into the slide, anchored to
   * the same containing block as `anchorElement` (the object that was
   * selected when the shortcut fired) rather than always the slide root, so
   * an object nested inside a positioned group pastes back into that group.
   */
  const pasteSlideObjects = useCallback(
    (
      copied: CopiedSlideObjects,
      anchorElement: HTMLElement | null,
      anchorRectOverride?: Pick<DOMRect, "left" | "top" | "width" | "height">,
    ) => {
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
      const containingBlock = anchorElement
        ? resolveSlideObjectContainingBlock(anchorElement, positioningLayer)
        : positioningLayer;
      const anchorRect =
        anchorElement?.getBoundingClientRect() ?? anchorRectOverride;
      const containingRect = containingBlock.getBoundingClientRect();
      const scaleX =
        containingBlock.offsetWidth > 0 && containingRect.width > 0
          ? containingBlock.offsetWidth / containingRect.width
          : 1;
      const scaleY =
        containingBlock.offsetHeight > 0 && containingRect.height > 0
          ? containingBlock.offsetHeight / containingRect.height
          : 1;

      const pasted = buildPastedSlideObjects(copied, document);
      if (pasted.length === 0) return;

      const objectIds: string[] = [];
      for (const element of pasted) {
        const promotedFromFlow =
          window.getComputedStyle(element).position !== "absolute";
        if (promotedFromFlow) {
          element.style.position = "absolute";
          if (anchorRect) {
            element.style.left = `${Math.round((anchorRect.left - containingRect.left) * scaleX) + SLIDE_OBJECT_PASTE_OFFSET}px`;
            element.style.top = `${Math.round((anchorRect.top - containingRect.top) * scaleY) + SLIDE_OBJECT_PASTE_OFFSET}px`;
            if (!element.style.width && anchorRect.width > 0) {
              element.style.width = `${Math.round(anchorRect.width * scaleX)}px`;
            }
          }
        }
        containingBlock.appendChild(element);
        if (promotedFromFlow && anchorRect) {
          // Same sizing rule as promoting a flow object: text sizes itself,
          // a card keeps a minimum, anything else is pinned. The height comes
          // from the pasted element, not from the anchor it is placed beside.
          const sizing = resolveFreeformSizing(element);
          const ownHeight = Math.round(element.offsetHeight);
          if (ownHeight > 0 && !element.style.height) {
            if (sizing === "min") element.style.minHeight = `${ownHeight}px`;
            else if (sizing === "fixed")
              element.style.height = `${ownHeight}px`;
          }
        }
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

  const getStyleTargets = useCallback((): HTMLElement[] => {
    const slideContent = getSlideContent();
    if (!slideContent) return [];
    if (multiSelection.size > 0) {
      return Array.from(multiSelection)
        .map(
          (id) =>
            slideContent.querySelector(
              `[data-builder-id="${id}"]`,
            ) as HTMLElement | null,
        )
        .filter((element): element is HTMLElement => element !== null);
    }
    if (contextMenuTargetRef.current) {
      return [contextMenuTargetRef.current];
    }
    const element = editingElRef.current ?? resolveSelectedElement();
    return element ? [element] : [];
  }, [getSlideContent, multiSelection, resolveSelectedElement]);

  const getClipboardSelection = useCallback((): HTMLElement[] | null => {
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
            const element = resolveSlideClipboardElement(
              resolveSelectedElement(),
              selectedImg,
              slideContent,
            );
            return element ? [element] : [];
          })();
    const roots = selectedElements.filter(
      (element) =>
        !selectedElements.some(
          (candidate) => candidate !== element && candidate.contains(element),
        ),
    );
    if (
      roots.length === 0 ||
      roots.some(
        (element) =>
          !isDeletableSlideElement(element) ||
          !isValidSlideClipboardRoot(element),
      )
    ) {
      return null;
    }
    const slideCanvas = roots[0].closest(".fmd-slide, [data-slide-canvas]");
    if (
      !slideCanvas ||
      !roots.every(
        (element) =>
          element.closest(".fmd-slide, [data-slide-canvas]") === slideCanvas,
      )
    ) {
      return null;
    }
    const positioningLayer = resolveSlidePositioningLayer(roots[0]);
    if (!positioningLayer) return null;
    const containingBlock = resolveSlideObjectContainingBlock(
      roots[0],
      positioningLayer,
    );
    return roots.every(
      (element) =>
        resolveSlideObjectContainingBlock(element, positioningLayer) ===
        containingBlock,
    )
      ? roots
      : null;
  }, [getSlideContent, multiSelection, resolveSelectedElement, selectedImg]);

  const styleSnapshotForElement = useCallback(
    (element: HTMLElement): SlideStyleSnapshot => {
      const selector =
        getBuilderSelector(element) ??
        selectedElementSelector ??
        element.tagName;
      const inlineTextStyle =
        editingElRef.current === element
          ? getInlineTextStyleSnapshotForRange(
              getRichTextEditorSurface() ?? element,
              richTextSelectionRef.current,
            )
          : undefined;
      return buildStyleSnapshot(element, selector, inlineTextStyle);
    },
    [getRichTextEditorSurface, selectedElementSelector],
  );

  const enableSelectedObjectPositioning = useCallback(() => {
    const slideContent = getSlideContent();
    const element =
      resolveSelectedElement() ??
      (selectedImg && slideContent
        ? (findPersistedImageObject(selectedImg, slideContent) ?? selectedImg)
        : selectedImg);
    if (!element || isPersistedFreeformObject(element)) return;

    const frozen = freezeElementForFreeformSelection(element);
    if (!frozen || !isPersistedFreeformObject(frozen.element)) {
      frozen?.restoreDescendants?.();
      frozen?.restoreMarkdownTree?.();
      return;
    }

    preserveSlideObjectLayoutSpacer(element);
    const positioningLayer = resolveSlidePositioningLayer(element);
    if (!frozen.restoreMarkdownTree && positioningLayer) {
      releaseSlideObjectFromLeftBoxes(element, positioningLayer);
    }
    const html = readCurrentSlideContentHtml();

    if (frozen.restoreMarkdownTree) {
      removeSlideObjectLayoutSpacer(element);
      frozen.restoreMarkdownTree();
    }
    if (html !== null) onUpdateSlideRef.current({ content: html });

    const selector = getBuilderSelector(element);
    if (selector) selectElementForStyling(element, selector);
  }, [
    freezeElementForFreeformSelection,
    getSlideContent,
    readCurrentSlideContentHtml,
    resolveSelectedElement,
    selectedImg,
    selectElementForStyling,
  ]);

  const applyStylePatchToElement = useCallback(
    (
      element: HTMLElement,
      { rotation, ...patch }: SlideStylePatch,
      range: Range | null = null,
    ): { styledRange: Range | null; rotationApplied: boolean } => {
      const inlinePatch = inlineInspectorStylePatch(patch);
      const hasInlinePatch = Object.keys(inlinePatch).length > 0;
      let styledRange: Range | null = null;
      const session =
        textSessionRef.current?.text.element === element
          ? textSessionRef.current.text
          : null;
      if (
        range &&
        hasInlinePatch &&
        !range.collapsed &&
        restoreEditableTextRange(element, range)
      ) {
        // The live session styles its own selection so the change is one
        // undo step inside the edit.
        const applied = session
          ? session.commands.textStyle(inlinePatch)
          : applyInlineTextStyle(element, inlinePatch).scope === "selection";
        const selection = window.getSelection();
        if (applied && selection && selection.rangeCount === 1) {
          styledRange = selection.getRangeAt(0).cloneRange();
        }
      }

      let rotationApplied = rotation === undefined;
      const applyToElement = () => {
        if (!styledRange && hasInlinePatch) {
          applyDescendantTextStyle(element, inlinePatch);
        }

        if (rotation !== undefined) {
          rotationApplied = setSlideObjectRotation(element, rotation);
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
          if (property === "width" || property === "height") {
            setSlideObjectDimension(element, property, value);
          } else {
            element.style.setProperty(stylePropertyName(property), value);
          }
        }

        if (
          patch.borderWidth &&
          patch.borderWidth !== "0" &&
          patch.borderWidth !== "0px" &&
          window.getComputedStyle(element).borderStyle === "none"
        ) {
          element.style.borderStyle = "solid";
        }
      };
      // Under an edit, a change to the element is its own undo step there.
      if (session) session.apply(applyToElement);
      else applyToElement();

      return { styledRange, rotationApplied };
    },
    [],
  );

  const copySelectedElementStyle = useCallback(() => {
    const source = getStyleTargets()[0];
    if (!source) return false;
    setCopiedElementStyle(
      copiedElementStyleFromSnapshot(styleSnapshotForElement(source)),
    );
    setHasCopiedElementStyle(true);
    return true;
  }, [getStyleTargets, styleSnapshotForElement]);

  const pasteCopiedElementStyle = useCallback(() => {
    const copied = getCopiedElementStyle();
    if (!copied) return false;
    const targets = getStyleTargets();
    if (targets.length === 0) return false;

    const editing = editingElRef.current;
    const editingSurface = editing ? getRichTextEditorSurface() : null;
    const savedRange = editing
      ? (richTextSelectionRef.current ??
        snapshotEditableTextRange(editingSurface ?? editing))
      : null;
    const nextRange = editing
      ? applyStylePatchToElement(editing, copied, savedRange).styledRange
      : null;
    if (editing && nextRange) richTextSelectionRef.current = nextRange;

    for (const target of editing ? targets.slice(1) : targets) {
      applyStylePatchToElement(target, copied);
    }

    if (editing) {
      captureInlineEditDraft(slide.id);
      const selector = selectedElementSelector ?? getBuilderSelector(editing);
      if (selector) {
        setSelectedStyleSnapshot(
          buildStyleSnapshot(
            editing,
            selector,
            getInlineTextStyleSnapshotForRange(
              editingSurface ?? editing,
              richTextSelectionRef.current,
            ),
          ),
        );
      }
    } else {
      const html = readCurrentSlideContentHtml();
      if (html !== null) {
        if (targets.length > 1) preserveMultiSelectionForUpdate(targets);
        onUpdateSlideRef.current({ content: html });
      }
      if (targets.length === 1) {
        const selector = getBuilderSelector(targets[0]);
        if (selector) selectElementForStyling(targets[0], selector);
      }
    }
    return true;
  }, [
    applyStylePatchToElement,
    captureInlineEditDraft,
    getRichTextEditorSurface,
    getStyleTargets,
    preserveMultiSelectionForUpdate,
    readCurrentSlideContentHtml,
    selectedElementSelector,
    selectElementForStyling,
    slide.id,
  ]);

  /** A copied object as stored, so a paste carries no rendered markup. */
  const storedFormOfCopy = useCallback(
    (copy: HTMLElement) => {
      const slideContent = getSlideContent();
      const source = slideContent && getRenderedSlideSource(slideContent);
      return source ? storedFormOf(source, copy) : null;
    },
    [getSlideContent],
  );

  const storeCopiedObjects = useCallback(
    (selection: HTMLElement[]) => {
      const copied = copySlideObjects(selection, storedFormOfCopy);
      const clipboard = {
        copied,
        clipboardId: createSlideObjectId(),
        nativeClipboardMode: "pending" as const,
        copySequence: copiedObjectCopySequenceRef.current++,
        copySessionId: copiedObjectClipboardSessionRef.current,
        deckId,
        slideId: slide.id,
        sourceRect: selection[0]?.getBoundingClientRect(),
      };
      copiedObjectClipboardRef.current = clipboard;
      overlappingNativeClipboardIdsRef.current.clear();
      setHasCopiedObject(true);
      const clipboardWrite = writeSlideObjectClipboard(
        clipboard.clipboardId,
        copied,
      );
      void clipboardWrite.then(
        (mode) => {
          const currentClipboard = copiedObjectClipboardRef.current;
          if (
            mode === "rich" &&
            currentClipboard &&
            currentClipboard.copySequence > clipboard.copySequence &&
            currentClipboard.copySessionId === clipboard.copySessionId
          ) {
            overlappingNativeClipboardIdsRef.current.set(
              clipboard.clipboardId,
              currentClipboard.clipboardId,
            );
          }
          if (currentClipboard?.clipboardId === clipboard.clipboardId) {
            currentClipboard.nativeClipboardMode = mode;
          }
        },
        () => {
          if (
            copiedObjectClipboardRef.current?.clipboardId ===
            clipboard.clipboardId
          ) {
            copiedObjectClipboardRef.current.nativeClipboardMode = "failed";
          }
        },
      );
      return clipboard;
    },
    [deckId, slide.id, storedFormOfCopy],
  );

  const copySelectedObjects = useCallback(() => {
    const selection = getClipboardSelection();
    if (!selection) return false;
    return Boolean(storeCopiedObjects(selection));
  }, [getClipboardSelection, storeCopiedObjects]);

  const pasteSelectedObjects = useCallback(() => {
    const clipboard = copiedObjectClipboardRef.current;
    const selection = getClipboardSelection();
    if (!clipboard || clipboard.deckId !== deckId) {
      return false;
    }
    pasteSlideObjects(
      clipboard.copied,
      selection?.[0] ?? null,
      clipboard.slideId === slide.id ? clipboard.sourceRect : undefined,
    );
    return true;
  }, [deckId, getClipboardSelection, pasteSlideObjects, slide.id]);

  const duplicateSelectedObjects = useCallback(() => {
    const selection = getClipboardSelection();
    if (!selection) return false;
    pasteSlideObjects(
      copySlideObjects(selection, storedFormOfCopy),
      selection[0],
    );
    return true;
  }, [getClipboardSelection, pasteSlideObjects, storedFormOfCopy]);

  const cutSelectedObjects = useCallback(() => {
    const selection = getClipboardSelection();
    if (!selection) return false;
    storeCopiedObjects(selection);
    return deleteSelectedElements(selection);
  }, [deleteSelectedElements, getClipboardSelection, storeCopiedObjects]);

  // The object payload stays editor-local, while its native marker makes the
  // latest in-app layer copy observable alongside external clipboard copies.
  // It intentionally does not survive a deck switch.
  useEffect(() => {
    const clearOverlappingClipboardIds = () => {
      overlappingNativeClipboardIdsRef.current.clear();
    };
    copiedObjectClipboardSessionRef.current += 1;
    copiedObjectClipboardRef.current = null;
    overlappingNativeClipboardIdsRef.current.clear();
    setHasCopiedObject(false);
    window.addEventListener("blur", clearOverlappingClipboardIds);
    return () =>
      window.removeEventListener("blur", clearOverlappingClipboardIds);
  }, [deckId]);

  // One window listener for object copy/paste/duplicate. Native text editing
  // must always win: bail the instant a text edit is active or focus is on any
  // form control, BEFORE touching the clipboard or selection, so ordinary
  // Cmd/Ctrl+C/V/D typing is never hijacked.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v" && key !== "x" && key !== "d") return;

      const active = document.activeElement;
      if (!isSlideCanvasShortcutTarget(active, slideCanvasRef.current)) return;
      const isTextSurface =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (editingEl || isTextSurface) return;

      if (key === "v") {
        return;
      }

      const selection = getClipboardSelection();
      if (!selection) return;

      if (key === "c") {
        e.preventDefault();
        storeCopiedObjects(selection);
        return;
      }

      if (key === "x") {
        if (!cutSelectedObjects()) return;
        e.preventDefault();
        return;
      }

      // Duplicate re-copies the live selection so it duplicates what's
      // currently selected regardless of what's on the clipboard.
      e.preventDefault();
      pasteSlideObjects(
        copySlideObjects(selection, storedFormOfCopy),
        selection[0],
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    deckId,
    cutSelectedObjects,
    editingEl,
    getClipboardSelection,
    pasteSlideObjects,
    readOnly,
    slide.id,
    storeCopiedObjects,
    storedFormOfCopy,
  ]);

  // The native paste event is authoritative: a matching layer marker means
  // the in-app copy is latest; otherwise current native content wins.
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      if (!isSlideCanvasShortcutTarget(active, slideCanvasRef.current)) return;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      if (
        Array.from(e.clipboardData?.items ?? []).some(
          (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
      ) {
        return;
      }
      const clipboard = copiedObjectClipboardRef.current;
      if (!clipboard || clipboard.deckId !== deckId) return;
      const nativeClipboardId = readSlideObjectClipboardId(
        e.clipboardData?.getData("text/html"),
        document,
      );
      const pasteLocalClipboard = () => {
        e.preventDefault();
        const selection = getClipboardSelection();
        pasteSlideObjects(
          clipboard.copied,
          selection?.[0] ?? null,
          clipboard.slideId === slide.id ? clipboard.sourceRect : undefined,
        );
      };
      if (nativeClipboardId === clipboard.clipboardId) {
        pasteLocalClipboard();
        return;
      }
      // An older rich write can settle after a newer copy. Remember only that
      // overlap, so clipboard-history markers are not remapped by default.
      if (
        nativeClipboardId &&
        overlappingNativeClipboardIdsRef.current.get(nativeClipboardId) ===
          clipboard.clipboardId
      ) {
        pasteLocalClipboard();
        return;
      }
      const hasNativeText = Array.from(e.clipboardData?.types ?? []).some(
        (type) =>
          type.startsWith("text/") &&
          Boolean(e.clipboardData?.getData(type)?.length),
      );
      if (hasNativeText) return;
      // Markerless text-only writes cannot prove ownership. Readable native
      // text stays authoritative above; only empty events use the local copy.
      // Pending or failed native writes have no trustworthy provenance, so
      // keep Cmd/Ctrl+V usable through the local copy when the event is empty.
      if (
        clipboard.nativeClipboardMode === "pending" ||
        clipboard.nativeClipboardMode === "failed"
      ) {
        pasteLocalClipboard();
        return;
      }
      pasteLocalClipboard();
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [deckId, getClipboardSelection, pasteSlideObjects, readOnly, slide.id]);

  // Appearance clipboard shortcuts are deliberately separate from object
  // copy/paste. The Alt modifier keeps Cmd/Ctrl+C/V available for duplicating
  // objects and for native text editing.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
      const key =
        e.code === "KeyC" ? "c" : e.code === "KeyV" ? "v" : e.key.toLowerCase();
      if (key !== "c" && key !== "v") return;

      const active = document.activeElement;
      if (!isSlideCanvasShortcutTarget(active, slideCanvasRef.current)) return;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      if (
        active instanceof HTMLElement &&
        active.isContentEditable &&
        !editingEl?.contains(active)
      ) {
        return;
      }
      if (getStyleTargets().length === 0) return;

      const handled =
        key === "c" ? copySelectedElementStyle() : pasteCopiedElementStyle();
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    copySelectedElementStyle,
    editingEl,
    getStyleTargets,
    pasteCopiedElementStyle,
    readOnly,
  ]);

  const placeTextBoxAt = useCallback(
    (
      geometry: SlideObjectGeometry,
      target: HTMLElement | null,
      dragSized: boolean,
      text = ZERO_WIDTH_SPACE,
      startEditing = true,
    ) => {
      const canvas = containerRef.current
        ? ensureSlideTextBoxCanvas(containerRef.current)
        : null;
      if (!canvas) return;
      const { fmdSlide, positioningLayer } = canvas;

      if (getComputedStyle(fmdSlide).position === "static") {
        fmdSlide.style.position = "relative";
      }

      const box = document.createElement("div");
      box.className = "fmd-text-box";
      ensureSlideObjectId(box);
      ensureBuilderId(box);
      box.style.position = "absolute";
      box.style.left = `${Math.max(0, geometry.x)}px`;
      box.style.top = `${Math.max(0, geometry.y)}px`;
      box.style.width = `${geometry.width}px`;
      if (dragSized) box.style.minHeight = `${geometry.height}px`;
      box.style.fontSize = "24px";
      box.style.color = getSlideTextBoxDefaultColor(target, positioningLayer);
      box.style.fontFamily =
        designSystem?.typography.bodyFont ?? "Inter, sans-serif";
      box.style.lineHeight = "1.3";
      if (text !== ZERO_WIDTH_SPACE) {
        box.style.whiteSpace = "pre-wrap";
        box.style.overflowWrap = "anywhere";
      }
      box.textContent = text === ZERO_WIDTH_SPACE ? "" : text;
      positioningLayer.appendChild(box);

      if (!startEditing) return box;
      // The outline must be up for the whole first session, so the box is
      // selected before the session starts rather than only by it. The entry
      // baseline enterInlineEdit reads already contains the box, so an
      // abandoned empty box still writes nothing.
      const selector = getBuilderSelector(box);
      if (selector) selectElementForStyling(box, selector, "editing");
      enterInlineEdit(box);
      return box;
    },
    [
      designSystem?.typography.bodyFont,
      enterInlineEdit,
      selectElementForStyling,
    ],
  );

  const pasteTextAsTextBox = useCallback(
    (text: string, richHtml?: string) => {
      const canvas = containerRef.current
        ? ensureSlideTextBoxCanvas(containerRef.current)
        : null;
      if (!canvas) return false;

      const { fmdSlide, positioningLayer } = canvas;
      if (getComputedStyle(fmdSlide).position === "static") {
        fmdSlide.style.position = "relative";
      }
      const containingBlock =
        resolveSlideObjectInsertionContainingBlock(positioningLayer);
      const target = resolveSelectedElement() ?? selectedImg;
      const anchorRect = target?.getBoundingClientRect();
      const layerRect = containingBlock.getBoundingClientRect();
      const width = 320;
      const height = 24;
      const scaleX =
        containingBlock.offsetWidth > 0 && layerRect.width > 0
          ? containingBlock.offsetWidth / layerRect.width
          : 1;
      const scaleY =
        containingBlock.offsetHeight > 0 && layerRect.height > 0
          ? containingBlock.offsetHeight / layerRect.height
          : 1;
      const maxX = Math.max(0, containingBlock.offsetWidth - width);
      const maxY = Math.max(0, containingBlock.offsetHeight - height);
      const x = anchorRect
        ? Math.min(
            maxX,
            Math.max(
              0,
              (anchorRect.left - layerRect.left) * scaleX +
                SLIDE_OBJECT_PASTE_OFFSET,
            ),
          )
        : maxX / 2;
      const y = anchorRect
        ? Math.min(
            maxY,
            Math.max(
              0,
              (anchorRect.top - layerRect.top) * scaleY +
                SLIDE_OBJECT_PASTE_OFFSET,
            ),
          )
        : maxY / 2;
      const box = placeTextBoxAt(
        { x, y, width, height },
        target,
        false,
        richHtml ? ZERO_WIDTH_SPACE : text,
        false,
      );
      if (!box) return false;

      if (richHtml) {
        box.innerHTML = richHtml;
        box.style.whiteSpace = "pre-wrap";
        box.style.overflowWrap = "anywhere";
        applyPastedTextPresentation(box);
      }

      const slideHeight = containingBlock.offsetHeight;
      if (slideHeight > 0 && box.offsetHeight > slideHeight) {
        box.style.maxHeight = `${slideHeight}px`;
        box.style.overflowY = "auto";
      }
      const renderedHeight = Math.max(height, box.offsetHeight);
      const renderedMaxY = Math.max(0, slideHeight - renderedHeight);
      if (y > renderedMaxY) box.style.top = `${renderedMaxY}px`;

      const selector = getBuilderSelector(box);
      if (selector) selectElementForStyling(box, selector);
      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
      return true;
    },
    [
      placeTextBoxAt,
      readCurrentSlideContentHtml,
      resolveSelectedElement,
      selectElementForStyling,
      selectedImg,
    ],
  );

  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      const target = e.target instanceof Element ? e.target : null;
      const isTextSurface = (element: Element | null) =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        (element instanceof HTMLElement && element.isContentEditable) ||
        Boolean(element?.closest("[contenteditable='true'], [role='textbox']"));
      if (isTextSurface(active) || isTextSurface(target)) return;
      if (
        Array.from(e.clipboardData?.items ?? []).some(
          (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
      ) {
        return;
      }

      const richHtml = e.clipboardData?.getData("text/html") ?? "";
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const normalizedRichHtml = richHtml
        ? normalizeSlideClipboardHtml(richHtml)
        : null;
      if (
        normalizedRichHtml &&
        !readSlideObjectClipboardId(richHtml, document) &&
        pasteTextAsTextBox(text, normalizedRichHtml)
      ) {
        e.preventDefault();
        return;
      }
      if (!text.trim() || !pasteTextAsTextBox(text)) return;
      e.preventDefault();
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [pasteTextAsTextBox, readOnly]);

  const placeShapeAt = useCallback(
    (
      geometry: SlideObjectGeometry,
      type: SlideShapeType,
      target: HTMLElement | null,
      lineRotationDeg?: number,
    ) => {
      const canvas = containerRef.current
        ? ensureSlideTextBoxCanvas(containerRef.current)
        : null;
      if (!canvas) return;
      const { fmdSlide, positioningLayer } = canvas;

      if (getComputedStyle(fmdSlide).position === "static") {
        fmdSlide.style.position = "relative";
      }
      const containingBlock =
        resolveSlideObjectInsertionContainingBlock(positioningLayer);

      const shape = document.createElement("div");
      const color = getSlideTextBoxDefaultColor(target, positioningLayer);
      shape.className = `fmd-shape fmd-shape-${type}`;
      shape.setAttribute("data-slide-shape", type);
      shape.setAttribute("aria-label", t(SLIDE_SHAPE_LABEL_KEYS[type]));
      ensureSlideObjectId(shape);
      ensureBuilderId(shape);
      shape.style.position = "absolute";
      const clampedPosition = clampSlideObjectPlacementPosition(
        geometry,
        containingBlock.offsetWidth,
        containingBlock.offsetHeight,
        lineRotationDeg,
      );
      shape.style.left = `${clampedPosition.x}px`;
      shape.style.top = `${clampedPosition.y}px`;
      shape.style.width = `${geometry.width}px`;
      shape.style.height = `${geometry.height}px`;
      shape.style.boxSizing = "border-box";
      shape.style.backgroundColor = color;
      shape.style.border =
        type === "rectangle" || type === "circle" ? `2px solid ${color}` : "0";
      shape.style.borderRadius =
        type === "circle" ? "50%" : type === "line" ? "999px" : "4px";
      if (type === "arrow") {
        shape.style.clipPath =
          "polygon(0% 30%, 55% 30%, 55% 0%, 100% 50%, 55% 100%, 55% 70%, 0% 70%)";
      } else if (type === "triangle") {
        shape.style.clipPath = "polygon(50% 0%, 100% 100%, 0% 100%)";
      }
      shape.style.opacity = "0.85";
      if (lineRotationDeg) setSlideObjectRotation(shape, lineRotationDeg);
      positioningLayer.appendChild(shape);

      const selector = getBuilderSelector(shape);
      if (selector) selectElementForStyling(shape, selector);
      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
    },
    [readCurrentSlideContentHtml, selectElementForStyling, t],
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
    (
      element: HTMLElement,
      geometry: SlideObjectGeometryPlan,
      {
        overrideSizeCaps = false,
        autoHeight = false,
        startHeight,
      }: {
        overrideSizeCaps?: boolean;
        autoHeight?: boolean;
        /** The height the gesture began with; only a resize passes it. */
        startHeight?: number;
      } = {},
    ) => {
      // Read before any write so the decision cannot depend on how the
      // width write reflows the text.
      const pinsHeight =
        geometry.height !== undefined &&
        (resolveFreeformSizing(element) === "fixed" ||
          (startHeight !== undefined && geometry.height !== startHeight));
      element.style.left = `${geometry.x}px`;
      element.style.top = `${geometry.y}px`;
      if (overrideSizeCaps) {
        setSlideObjectDimension(element, "width", `${geometry.width}px`);
      } else {
        element.style.width = `${geometry.width}px`;
      }
      if (autoHeight) {
        // No inline height at all means the box sizes to its content, same
        // as a freshly placed text box — leave it unset instead of "auto" so
        // a later manual resize sees a clean absent-vs-explicit height.
        element.style.removeProperty("height");
        return;
      }
      // A fit text object has no height to write (see planSlideObjectGeometry),
      // and a move re-sends the measured height of a card that sizes itself
      // with `min-height`; writing it back would pin that card.
      if (geometry.height === undefined || !pinsHeight) return;
      if (overrideSizeCaps) {
        setSlideObjectDimension(element, "height", `${geometry.height}px`);
      } else {
        element.style.height = `${geometry.height}px`;
      }
    },
    [],
  );

  const applyMultiObjectGeometryPlan = useCallback(
    (
      members: ReturnType<typeof collectMovableSlideObjects>,
      plan: Map<string, SlideObjectGeometryPlan>,
    ) => {
      if (
        members.length < 2 ||
        plan.size !== members.length ||
        members.some((member) => !plan.has(member.objectId))
      ) {
        return;
      }
      for (const member of members) {
        const geometry = plan.get(member.objectId);
        if (geometry) applyObjectGeometry(member.element, geometry);
      }
      const builderIds = new Set(
        members
          .map((member) => member.element.getAttribute("data-builder-id"))
          .filter((id): id is string => Boolean(id)),
      );
      refreshMultiSelectionRects(builderIds);
      commitMultiObjectChange(members.map((member) => member.objectId));
    },
    [applyObjectGeometry, commitMultiObjectChange, refreshMultiSelectionRects],
  );

  const handleGroupSelected = useCallback(() => {
    if (readOnly) return false;
    const selection = getObjectOperationSelection();
    if (!selection || selection.elements.length < 2) return false;
    const group = groupSlideObjects(
      selection.elements,
      getObjectGeometry,
      applyObjectGeometry,
    );
    if (!group) return false;

    ensureBuilderId(group);
    stampBuilderIds(group);
    const selector = getBuilderSelector(group);
    if (!selector) return false;
    clearMultiSelection();
    selectElementForStyling(group, selector);
    refreshLayerNodes();
    const html = readCurrentSlideContentHtml();
    if (html !== null) {
      onUpdateSlideRef.current({ content: html }, undefined, {
        persistence: "immediate",
      });
    }
    return true;
  }, [
    applyObjectGeometry,
    clearMultiSelection,
    getObjectGeometry,
    getObjectOperationSelection,
    readCurrentSlideContentHtml,
    readOnly,
    refreshLayerNodes,
    selectElementForStyling,
  ]);

  const handleUngroupSelected = useCallback(() => {
    if (readOnly) return false;
    const selection = getObjectOperationSelection();
    const group =
      selection?.elements.length === 1 ? selection.elements[0] : null;
    if (!group || !isSlideObjectGroup(group)) return false;
    const children = ungroupSlideObject(
      group,
      getObjectGeometry,
      applyObjectGeometry,
    );
    if (!children) return false;

    stampBuilderIds(group.parentElement ?? getSlideContent() ?? group);
    const builderIds = new Set(
      children
        .map((child) => child.getAttribute("data-builder-id"))
        .filter((id): id is string => Boolean(id)),
    );
    pendingMultiSelectionResyncRef.current = {
      objectIds: children.map((child) =>
        child.getAttribute("data-slide-object-id"),
      ),
      paths: [],
    };
    applyMultiSelection(builderIds);
    refreshLayerNodes();
    const html = readCurrentSlideContentHtml();
    if (html !== null) {
      onUpdateSlideRef.current({ content: html }, undefined, {
        persistence: "immediate",
      });
    }
    return true;
  }, [
    applyMultiSelection,
    applyObjectGeometry,
    getObjectGeometry,
    getObjectOperationSelection,
    getSlideContent,
    readCurrentSlideContentHtml,
    readOnly,
    refreshLayerNodes,
  ]);

  const handleAlignSelectedObjects = useCallback(
    (alignment: SlideObjectAlignment) => {
      const selection = getObjectOperationSelection();
      if (!selection || selection.elements.length < 2) return;
      const members = collectMovableSlideObjects(
        selection.elements,
        getObjectGeometry,
      );
      if (members.length !== selection.elements.length) return;
      applyMultiObjectGeometryPlan(
        members,
        alignSlideObjectMembers(members, alignment),
      );
    },
    [
      applyMultiObjectGeometryPlan,
      getObjectGeometry,
      getObjectOperationSelection,
    ],
  );

  const handleDistributeSelectedObjects = useCallback(
    (distribution: SlideObjectDistribution) => {
      const selection = getObjectOperationSelection();
      if (!selection || selection.elements.length < 3) return;
      const members = collectMovableSlideObjects(
        selection.elements,
        getObjectGeometry,
      );
      if (members.length !== selection.elements.length) return;
      applyMultiObjectGeometryPlan(
        members,
        distributeSlideObjectMembers(members, distribution),
      );
    },
    [
      applyMultiObjectGeometryPlan,
      getObjectGeometry,
      getObjectOperationSelection,
    ],
  );

  const updateAlignmentGuides = useCallback(
    (
      guides: readonly SlideAlignmentGuide[],
      coordinateRoot: HTMLElement,
      canvas: { width: number; height: number },
    ) => {
      if (guides.length === 0) {
        if (activeAlignmentGuidesRef.current !== null) {
          activeAlignmentGuidesRef.current = null;
          setActiveAlignmentGuides(null);
        }
        return;
      }
      const viewport = {
        rect: coordinateRoot.getBoundingClientRect(),
        canvas,
      };
      const previous = activeAlignmentGuidesRef.current;
      const guidesUnchanged =
        previous?.guides.length === guides.length &&
        previous.guides.every(
          (guide, index) =>
            guide.orientation === guides[index]?.orientation &&
            guide.position === guides[index]?.position &&
            guide.start === guides[index]?.start &&
            guide.end === guides[index]?.end &&
            guide.equalSpacing === guides[index]?.equalSpacing,
        );
      const viewportUnchanged =
        previous?.viewport.rect.left === viewport.rect.left &&
        previous.viewport.rect.top === viewport.rect.top &&
        previous.viewport.rect.width === viewport.rect.width &&
        previous.viewport.rect.height === viewport.rect.height &&
        previous.viewport.canvas.width === viewport.canvas.width &&
        previous.viewport.canvas.height === viewport.canvas.height;
      if (guidesUnchanged && viewportUnchanged) return;
      const next = {
        guides: [...guides],
        viewport,
      };
      activeAlignmentGuidesRef.current = next;
      setActiveAlignmentGuides(next);
    },
    [],
  );

  const clearAlignmentGuides = useCallback(() => {
    if (activeAlignmentGuidesRef.current !== null) {
      activeAlignmentGuidesRef.current = null;
      setActiveAlignmentGuides(null);
    }
  }, []);

  const getSnapPeerGeometries = useCallback(
    (movingElements: readonly HTMLElement[], positioningLayer: HTMLElement) => {
      const slideRoot =
        positioningLayer.closest<HTMLElement>(".fmd-slide") ??
        positioningLayer.closest<HTMLElement>("[data-slide-canvas]");
      if (!slideRoot || movingElements.length === 0) return [];

      const movingSet = new Set(movingElements);
      const containingBlock = resolveSlideObjectContainingBlock(
        movingElements[0],
        positioningLayer,
      );
      return Array.from(
        slideRoot.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
      )
        .filter(
          (element) =>
            !movingSet.has(element) &&
            !movingElements.some((moving) => moving.contains(element)) &&
            (element.closest<HTMLElement>(".fmd-slide") ??
              element.closest<HTMLElement>("[data-slide-canvas]")) ===
              slideRoot &&
            isPersistedFreeformObject(element) &&
            resolveSlideObjectContainingBlock(element, positioningLayer) ===
              containingBlock,
        )
        .map(getObjectGeometry);
    },
    [getObjectGeometry],
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
      // Handles stay live while text is edited, but the edited node sits
      // hidden under the floating rich-text editor. Commit the edit before any
      // transform so the gesture moves the real object, not the editor's mirror.
      if (editingElRef.current) exitInlineEdit();
      const slideCanvas = element.closest(
        ".fmd-slide, [data-slide-canvas]",
      ) as HTMLElement | null;
      if (!slideCanvas) return;

      const viewport = readGestureViewport(element, slideCanvas);
      if (!viewport) return;
      let positioningLayer =
        resolveSlidePositioningLayer(element) ?? slideCanvas;

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
      let restoreDescendants: (() => void) | undefined;
      let promotedToFreeform = false;

      const initialSelector = getBuilderSelector(element);
      if (initialSelector) {
        selectElementForStyling(element, initialSelector);
      }

      const promoteForDrag = () => {
        if (origin) return true;
        const frozen = freezeElementForFreeformSelection(element);
        if (!frozen) {
          return false;
        }
        restoreMarkdownTree = frozen.restoreMarkdownTree;
        restoreDescendants = frozen.restoreDescendants;
        if (getComputedStyle(element).position !== "absolute") {
          restoreMarkdownTree?.();
          restoreMarkdownTree = undefined;
          return false;
        }
        promotedToFreeform = true;
        origin = getObjectGeometry(element);
        // Promotion mints the object id and may reparent the element, which
        // moves its index path; the selection resolves by id from here on.
        setSelectedObjectId(ensureSlideObjectId(element));
        const promotedPositioningLayer = resolveSlidePositioningLayer(element);
        if (promotedPositioningLayer) {
          positioningLayer = promotedPositioningLayer;
        }
        return true;
      };

      const restorePromotedElement = () => {
        if (!promotedToFreeform) return;
        promotedToFreeform = false;
        removeSlideObjectLayoutSpacer(element);
        restoreDescendants?.();
        const restoreTree = restoreMarkdownTree;
        restoreMarkdownTree = undefined;
        restoreTree?.();
        if (!restoreTree) {
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
        clearAlignmentGuides();
        if (activeGestureRef.current?.cancel === onCancel) {
          activeGestureRef.current = null;
        }
      };

      const restore = () => {
        if (clone) {
          clone.remove();
        }
        if (promotedToFreeform) {
          restorePromotedElement();
        } else {
          if (!clone && origin) restoreSlideObjectStyle(element, originalStyle);
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
        toLocalDelta: viewport.toLocalDelta,
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
            // Appended, not inserted after the original: animations persist
            // child-index paths, so a mid-list insert retargets later siblings.
            element.parentElement!.appendChild(clone);
            ensureBuilderId(clone);
            stampBuilderIds(clone);
            activeElement = clone;
            const selector = getBuilderSelector(activeElement);
            if (selector) selectElementForStyling(activeElement, selector);
          }
          const containingBlock = resolveSlideObjectContainingBlock(
            activeElement,
            positioningLayer,
          );
          const snapCanvas = {
            width:
              containingBlock.offsetWidth ||
              positioningLayer.offsetWidth ||
              viewport.canvas.width,
            height:
              containingBlock.offsetHeight ||
              positioningLayer.offsetHeight ||
              viewport.canvas.height,
          };
          const snap = snapSlideObjectMove({
            moving: dragOrigin,
            deltaX: gesture.canvasDelta.x,
            deltaY: gesture.canvasDelta.y,
            peers: getSnapPeerGeometries([activeElement], positioningLayer),
            canvas: snapCanvas,
            scale: readScreenScale(containingBlock),
            bypass:
              gesture.pointer.metaKey ||
              gesture.pointer.ctrlKey ||
              Boolean(viewport.toLocalDelta),
          });
          applyObjectGeometry(
            activeElement,
            planSlideObjectGeometry(activeElement, {
              ...dragOrigin,
              x: dragOrigin.x + snap.deltaX,
              y: dragOrigin.y + snap.deltaY,
            }),
          );
          const rect = activeElement.getBoundingClientRect();
          setSelectedElementMeasurement({
            key: selectionOverlayMeasurementKeyRef.current,
            rect,
            frame: readSlideObjectSelectionFrame(activeElement, rect),
          });
          updateAlignmentGuides(snap.guides, containingBlock, snapCanvas);
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
            applyObjectGeometry(
              element,
              planSlideObjectGeometry(element, getObjectGeometry(clone)),
            );
            clone.remove();
            activeElement = element;
          }
          if (promotedToFreeform) preserveSlideObjectLayoutSpacer(element);
          if (!restoreMarkdownTree) {
            releaseSlideObjectFromLeftBoxes(activeElement, positioningLayer);
          }
          const html = readCurrentSlideContentHtml();
          // Markdown slides temporarily move their ReactMarkdown children into
          // an fmd canvas during promotion. Restore that live tree after
          // serialization and before the state write so React can reconcile
          // the switch to persisted raw HTML cleanly.
          if (restoreMarkdownTree) {
            removeSlideObjectLayoutSpacer(element);
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
        viewport: viewport.rect,
        canvas: viewport.canvas,
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
        if (preserveClickWithoutMove) window.getSelection()?.removeAllRanges();
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
      activeGestureRef.current = { cancel: onCancel, pointerId: e.pointerId };
    },
    [
      applyObjectGeometry,
      clearAlignmentGuides,
      exitInlineEdit,
      getSnapPeerGeometries,
      getObjectGeometry,
      readCurrentSlideContentHtml,
      readOnly,
      selectElementForStyling,
      updateAlignmentGuides,
    ],
  );

  const startElementResize = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (readOnly || e.button !== 0) return;
      if (editingElRef.current) exitInlineEdit();
      const element = resolveSelectedElement();
      const slideCanvas = element?.closest(
        ".fmd-slide, [data-slide-canvas]",
      ) as HTMLElement | null;
      if (
        !element ||
        !slideCanvas ||
        isSlideCanvasShell(element) ||
        isSlideTableStructureElement(element)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const viewport = readGestureViewport(element, slideCanvas);
      if (!viewport) return;

      const originalObjectId = element.getAttribute("data-slide-object-id");
      const originalClassName = element.className;
      const originalStyle = element.getAttribute("style");
      const originalContentEditable = element.getAttribute("contenteditable");
      const originalEditingBlock = element.getAttribute("data-editing-block");
      const selector = getBuilderSelector(element);
      const initiallyAbsolute =
        getComputedStyle(element).position === "absolute";
      let restoreMarkdownTree: (() => void) | undefined;
      let restoreDescendants: (() => void) | undefined;
      let promotedToFreeform = false;

      const restorePromotedElement = () => {
        if (!promotedToFreeform) return;
        promotedToFreeform = false;
        removeSlideObjectLayoutSpacer(element);
        restoreDescendants?.();
        const restoreTree = restoreMarkdownTree;
        restoreMarkdownTree = undefined;
        restoreTree?.();
        if (!restoreTree) {
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

      // A press on a handle is not a resize: nothing may be written, promoted
      // or reflowed until the pointer travels past the drag threshold. Until
      // then `resizeOrigin` only has to describe a valid, non-empty box.
      let resizeOrigin: SlideObjectGeometry = initiallyAbsolute
        ? getObjectGeometry(element)
        : {
            x: 0,
            y: 0,
            width: element.offsetWidth,
            height: element.offsetHeight,
          };
      let resizeTransform = readSlideObjectTransformSnapshot(element);
      const isResizable = (
        origin: SlideObjectGeometry,
        transform: ReturnType<typeof readSlideObjectTransformSnapshot>,
      ) =>
        origin.width > 0 &&
        origin.height > 0 &&
        resizeTransformedSlideObject(origin, transform, {
          handle,
          dx: 0,
          dy: 0,
          preserveAspectRatio: false,
        }) !== null;
      if (!isResizable(resizeOrigin, resizeTransform)) return;

      let groupResizeMembers: SlideObjectGroupResizeMember[] = [];
      let groupResizeOriginalStyles = new Map<HTMLElement, string | null>();
      let fitResize = false;
      let fitFloorHeight: number | undefined;
      let began: "pending" | "ready" | "failed" = "pending";

      const beginResize = () => {
        if (began !== "pending") return began === "ready";
        began = "failed";
        if (!initiallyAbsolute) {
          const frozen = freezeElementForFreeformSelection(element);
          if (!frozen || getComputedStyle(element).position !== "absolute") {
            frozen?.restoreMarkdownTree?.();
            return false;
          }
          restoreMarkdownTree = frozen.restoreMarkdownTree;
          restoreDescendants = frozen.restoreDescendants;
          promotedToFreeform = true;
          setSelectedObjectId(ensureSlideObjectId(element));
        }
        const origin = getObjectGeometry(element);
        const transform = readSlideObjectTransformSnapshot(element);
        if (!isResizable(origin, transform)) {
          restorePromotedElement();
          return false;
        }

        const members: SlideObjectGroupResizeMember[] = [];
        if (isSlideObjectGroup(element)) {
          const pendingGroups = [element];
          while (pendingGroups.length > 0) {
            const currentGroup = pendingGroups.pop();
            if (!currentGroup) continue;
            for (const child of Array.from(currentGroup.children)) {
              if (
                !(child instanceof HTMLElement) ||
                !child.hasAttribute("data-slide-object-id")
              ) {
                continue;
              }
              members.push({
                objectId: ensureSlideObjectId(child),
                element: child,
                start: getObjectGeometry(child),
                ...readSlideObjectTransformSnapshot(child),
              });
              if (isSlideObjectGroup(child)) pendingGroups.push(child);
            }
          }
          if (
            scaleSlideObjectGroupMembers(members, origin, origin).size !==
            members.length
          ) {
            restorePromotedElement();
            return false;
          }
        }

        fitResize = transform.transform === "none" && isFitTextObject(element);
        // A legacy `contain: size` would pin the box at its stale height, so
        // the resize would change nothing the user can see.
        if (fitResize) stripFreeformReservation(element);
        if (fitResize && hasFitTextMinHeight(element)) {
          // The box can never shrink under its text, so the text height is the
          // floor for a `min-height` edit; read it with the minimum lifted.
          const minHeight = element.style.getPropertyValue("min-height");
          element.style.setProperty("min-height", "0px");
          fitFloorHeight = element.offsetHeight;
          element.style.setProperty("min-height", minHeight);
        }
        resizeOrigin = origin;
        resizeTransform = transform;
        groupResizeMembers = members;
        groupResizeOriginalStyles = new Map(
          members.map((member) => [
            member.element,
            member.element.getAttribute("style"),
          ]),
        );
        began = "ready";
        return true;
      };

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (activeGestureRef.current?.cancel === onCancel) {
          activeGestureRef.current = null;
        }
      };

      const controller = createSlidesCanvasGestureController({
        toLocalDelta: viewport.toLocalDelta,
        preview: (gesture) => {
          if (gesture.kind !== "resize" || !beginResize()) {
            return { handled: false, reason: "unhandled" };
          }
          if (fitResize) {
            // A fit text box never gets a height: only its width and top
            // edge move, or `min-height` when it carries one.
            const next = resolveFitTextBoxResize({
              handle: gesture.handle,
              start: resizeOrigin,
              delta: { dx: gesture.canvasDelta.x, dy: gesture.canvasDelta.y },
              minWidth: MIN_SLIDE_OBJECT_SIZE,
              hasMinHeight: hasFitTextMinHeight(element),
              shift: Boolean(gesture.pointer.shiftKey),
              alt: Boolean(gesture.pointer.altKey),
              floorHeight: fitFloorHeight,
            });
            ensureSlideObjectId(element);
            applyObjectGeometry(
              element,
              { x: next.x, y: next.y, width: next.width },
              { overrideSizeCaps: true },
            );
            if (next.minHeight !== undefined) {
              element.style.minHeight = `${next.minHeight}px`;
            }
            const currentSelector = getBuilderSelector(element);
            if (currentSelector) {
              selectElementForStyling(element, currentSelector, "resizing");
            }
            return { handled: true };
          }
          const nextRect = resizeTransformedSlideObject(
            resizeOrigin,
            resizeTransform,
            {
              handle: gesture.handle,
              dx: gesture.canvasDelta.x,
              dy: gesture.canvasDelta.y,
              altKey: Boolean(gesture.pointer.altKey),
              preserveAspectRatio: Boolean(gesture.pointer.shiftKey),
              fitText: isFitTextObject(element),
            },
          );
          if (!nextRect) return { handled: false, reason: "unhandled" };
          const memberPlans =
            groupResizeMembers.length > 0
              ? scaleSlideObjectGroupMembers(
                  groupResizeMembers,
                  resizeOrigin,
                  nextRect,
                )
              : null;
          if (memberPlans && memberPlans.size !== groupResizeMembers.length) {
            return { handled: false, reason: "unhandled" };
          }
          ensureSlideObjectId(element);
          applyObjectGeometry(
            element,
            planSlideObjectGeometry(element, nextRect),
            {
              overrideSizeCaps: true,
              startHeight: resizeOrigin.height,
              autoHeight:
                isAutoHeightTextResize(
                  element,
                  gesture.handle,
                  Boolean(gesture.pointer.shiftKey),
                ) && resizeTransform.transform === "none",
            },
          );
          if (memberPlans) {
            for (const member of groupResizeMembers) {
              const plan = memberPlans.get(member.element);
              if (plan) {
                applyObjectGeometry(member.element, plan.geometry, {
                  overrideSizeCaps: true,
                  startHeight: member.start.height,
                });
                if (plan.transform !== undefined) {
                  member.element.style.setProperty(
                    "transform",
                    plan.transform,
                    member.element.style.getPropertyPriority("transform"),
                  );
                }
                if (plan.transformOrigin !== undefined) {
                  member.element.style.transformOrigin = plan.transformOrigin;
                }
              }
            }
          }
          const currentSelector = getBuilderSelector(element);
          if (currentSelector) {
            selectElementForStyling(element, currentSelector, "resizing");
          }
          return { handled: true };
        },
        commit: () => {
          if (began !== "ready") return { handled: false, reason: "unhandled" };
          const currentSelector = getBuilderSelector(element);
          if (currentSelector)
            selectElementForStyling(element, currentSelector);
          if (promotedToFreeform) preserveSlideObjectLayoutSpacer(element);
          const html = readCurrentSlideContentHtml();
          if (restoreMarkdownTree) {
            removeSlideObjectLayoutSpacer(element);
            restoreMarkdownTree();
            restoreMarkdownTree = undefined;
          }
          if (html !== null) {
            onUpdateSlideRef.current({ content: html }, undefined, {
              persistence: "immediate",
            });
          }
          return { handled: true };
        },
        cancel: () => {
          if (began !== "ready") return { handled: false, reason: "unhandled" };
          if (promotedToFreeform) restorePromotedElement();
          else {
            restoreSlideObjectStyle(element, originalStyle);
            for (const [member, style] of groupResizeOriginalStyles) {
              restoreSlideObjectStyle(member, style);
            }
            if (originalObjectId) {
              element.setAttribute("data-slide-object-id", originalObjectId);
            } else {
              element.removeAttribute("data-slide-object-id");
            }
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
        viewport: viewport.rect,
        canvas: viewport.canvas,
        handle,
        rect: resizeOrigin,
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
        if (began === "pending") return;
        const currentSelector = getBuilderSelector(element);
        if (currentSelector) selectElementForStyling(element, currentSelector);
        if (!result.committed) restorePromotedElement();
      };

      const onCancel = () => {
        stop();
        controller.cancel();
        if (began === "pending") return;
        restorePromotedElement();
        const currentSelector = getBuilderSelector(element);
        if (currentSelector) selectElementForStyling(element, currentSelector);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      activeGestureRef.current = { cancel: onCancel, pointerId: e.pointerId };
    },
    [
      applyObjectGeometry,
      exitInlineEdit,
      freezeElementForFreeformSelection,
      getObjectGeometry,
      readCurrentSlideContentHtml,
      readOnly,
      resolveSelectedElement,
      selectElementForStyling,
    ],
  );

  const startGroupResize = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (readOnly || e.button !== 0 || multiSelection.size === 0) return;
      const selection = getObjectOperationSelection();
      if (!selection) return;
      const members = collectMovableSlideObjects(
        selection.elements,
        getObjectGeometry,
      );
      const groupOrigin = unionSlideObjectGeometries(
        members.map((member) => member.start),
      );
      const slideCanvas = selection.elements[0]?.closest(
        ".fmd-slide, [data-slide-canvas]",
      ) as HTMLElement | null;
      if (
        !slideCanvas ||
        members.length !== selection.elements.length ||
        !groupOrigin
      ) {
        return;
      }

      const viewport = readGestureViewport(selection.elements[0], slideCanvas);
      if (!viewport) return;

      e.preventDefault();
      e.stopPropagation();
      const selectedIds = new Set(
        members
          .map((member) => member.element.getAttribute("data-builder-id"))
          .filter((id): id is string => Boolean(id)),
      );
      const originalStyles = new Map(
        members.map((member) => [
          member.objectId,
          member.element.getAttribute("style"),
        ]),
      );
      const applyPlan = (plan: Map<string, SlideObjectGeometryPlan>) => {
        for (const member of members) {
          const geometry = plan.get(member.objectId);
          if (geometry) {
            applyObjectGeometry(member.element, geometry, {
              overrideSizeCaps: true,
              startHeight: member.start.height,
            });
          }
        }
      };

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (activeGestureRef.current?.cancel === onCancel) {
          activeGestureRef.current = null;
        }
      };

      const controller = createSlidesCanvasGestureController({
        toLocalDelta: viewport.toLocalDelta,
        preview: (gesture) => {
          if (gesture.kind !== "resize") {
            return { handled: false, reason: "unhandled" };
          }
          suppressNextClickRef.current = true;
          applyPlan(
            resizeSlideObjectMembers(members, {
              handle,
              dx: gesture.canvasDelta.x,
              dy: gesture.canvasDelta.y,
              preserveAspectRatio: gesture.pointer.shiftKey,
            }),
          );
          scheduleMultiSelectionRects(selectedIds);
          return { handled: true };
        },
        commit: () => {
          const html = readCurrentSlideContentHtml();
          if (html !== null) {
            pendingMultiSelectionResyncRef.current = {
              objectIds: members.map((member) => member.objectId),
              paths: [],
            };
            onUpdateSlideRef.current({ content: html }, undefined, {
              persistence: "immediate",
            });
          }
          return { handled: true };
        },
        cancel: () => {
          applyPlan(
            new Map(members.map((member) => [member.objectId, member.start])),
          );
          for (const member of members) {
            restoreSlideObjectStyle(
              member.element,
              originalStyles.get(member.objectId) ?? null,
            );
          }
          refreshMultiSelectionRects(selectedIds);
          return { handled: true };
        },
      });
      controller.pointerDown({
        kind: "resize",
        objectIds: members.map((member) => member.objectId),
        pointer: {
          x: e.clientX,
          y: e.clientY,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        },
        viewport: viewport.rect,
        canvas: viewport.canvas,
        handle,
        rect: groupOrigin,
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
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
        if (!result.committed) return;
      };
      const onCancel = () => {
        stop();
        suppressNextClickRef.current = false;
        controller.cancel();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      activeGestureRef.current = { cancel: onCancel, pointerId: e.pointerId };
    },
    [
      applyObjectGeometry,
      getObjectGeometry,
      getObjectOperationSelection,
      multiSelection.size,
      readCurrentSlideContentHtml,
      readOnly,
      refreshMultiSelectionRects,
      scheduleMultiSelectionRects,
    ],
  );

  /**
   * Same gesture shape as startElementDrag (shared drag threshold, Shift axis lock,
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
      const roots = resolveSlideObjectMoveRoots(elements, ids, slideContent);
      if (roots.length === 0) return;

      // Capture the viewport before promotion. A normal-flow element becomes
      // an absolute child only after the drag threshold is crossed, so a
      // stationary click never mutates the slide's layout or HTML.
      const slideCanvas = roots[0].closest(
        ".fmd-slide, [data-slide-canvas]",
      ) as HTMLElement | null;
      if (!slideCanvas) return;
      const viewport = readGestureViewport(roots[0], slideCanvas);
      if (!viewport) return;
      const promotions: Array<{
        element: HTMLElement;
        originalClassName: string;
        originalStyle: string | null;
        originalObjectId: string | null;
        originalContentEditable: string | null;
        originalEditingBlock: string | null;
        restoreMarkdownTree?: () => void;
        restoreDescendants?: () => void;
      }> = [];
      let members: ReturnType<typeof collectMovableSlideObjects> = [];
      let prepared = false;
      let promotionsRestored = false;
      let groupPositioningLayer: HTMLElement | null = null;
      let groupContainingBlock: HTMLElement | null = null;
      // Alt-drag copies exist only while Alt is held: the originals stay put
      // and the copies take the delta. `rectIds` is what the selection chrome
      // follows, the copies while they exist.
      let clones: typeof members = [];
      let rectIds = ids;

      const removeClones = () => {
        for (const clone of clones) clone.element.remove();
        clones = [];
        rectIds = ids;
        copyDragRectIdsRef.current = null;
        // A queued frame still holds the removed copies' ids.
        cancelScheduledMultiSelectionRects();
      };

      const restoreGroupPromotions = () => {
        if (promotionsRestored) return;
        promotionsRestored = true;

        for (const promotion of promotions) {
          removeSlideObjectLayoutSpacer(promotion.element);
        }

        const restoredMarkdownTrees = new Set<() => void>();
        for (const promotion of promotions) {
          const restoreMarkdownTree = promotion.restoreMarkdownTree;
          if (
            restoreMarkdownTree &&
            !restoredMarkdownTrees.has(restoreMarkdownTree)
          ) {
            restoredMarkdownTrees.add(restoreMarkdownTree);
            restoreMarkdownTree();
          }
        }

        for (const promotion of promotions) {
          const {
            element,
            originalClassName,
            originalStyle,
            originalObjectId,
            originalContentEditable,
            originalEditingBlock,
          } = promotion;
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
          if (originalObjectId) {
            element.setAttribute("data-slide-object-id", originalObjectId);
          } else {
            element.removeAttribute("data-slide-object-id");
          }
          promotion.restoreDescendants?.();
        }
      };

      const prepareGroup = () => {
        if (prepared) return members.length > 0;
        prepared = true;

        for (const element of roots) {
          const originalClassName = element.className;
          const originalStyle = element.getAttribute("style");
          const originalObjectId = element.getAttribute("data-slide-object-id");
          const originalContentEditable =
            element.getAttribute("contenteditable");
          const originalEditingBlock =
            element.getAttribute("data-editing-block");
          const frozen = freezeElementForFreeformSelection(element);
          if (!frozen) {
            restoreGroupPromotions();
            return false;
          }
          promotions.push({
            element,
            originalClassName,
            originalStyle,
            originalObjectId,
            originalContentEditable,
            originalEditingBlock,
            restoreMarkdownTree: frozen.restoreMarkdownTree,
            restoreDescendants: frozen.restoreDescendants,
          });
        }

        const nextMembers = collectMovableSlideObjects(
          roots,
          getObjectGeometry,
        );
        if (nextMembers.length !== roots.length) {
          restoreGroupPromotions();
          return false;
        }

        const fmdSlide = nextMembers[0].element.closest(
          ".fmd-slide",
        ) as HTMLElement | null;
        if (!fmdSlide) {
          restoreGroupPromotions();
          return false;
        }
        const positioningLayer =
          Array.from(fmdSlide.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement &&
              child.hasAttribute("data-fmd-autofit-content"),
          ) ?? fmdSlide;
        const containingBlock = resolveSlideObjectContainingBlock(
          nextMembers[0].element,
          positioningLayer,
        );
        if (
          nextMembers.some(
            (member) =>
              member.element.closest(".fmd-slide") !== fmdSlide ||
              resolveSlideObjectContainingBlock(
                member.element,
                positioningLayer,
              ) !== containingBlock,
          )
        ) {
          restoreGroupPromotions();
          return false;
        }

        groupPositioningLayer = positioningLayer;
        groupContainingBlock = containingBlock;
        members = nextMembers;
        return true;
      };

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        clearAlignmentGuides();
        if (activeGestureRef.current?.cancel === onCancel) {
          activeGestureRef.current = null;
        }
      };

      const controller = createSlidesCanvasGestureController({
        toLocalDelta: viewport.toLocalDelta,
        preview: (gesture) => {
          if (!prepareGroup()) {
            return { handled: false, reason: "unhandled" };
          }
          // Claim the click only once a real drag starts, so a click without
          // movement on a multi-selected object remains normal editor input.
          suppressNextClickRef.current = true;
          if (clones.length > 0 && !gesture.duplicate) removeClones();
          if (clones.length === 0 && gesture.duplicate) {
            // The originals may have been moved while Alt was up.
            applySlideObjectMoveDelta(members, 0, 0, applyObjectGeometry);
            clones = duplicateSlideObjectMembers(members);
            for (const { element } of clones) {
              ensureBuilderId(element);
              stampBuilderIds(element);
            }
            rectIds = new Set(
              clones.map(({ element }) => ensureBuilderId(element)),
            );
            copyDragRectIdsRef.current = rectIds;
          }
          const dragged = clones.length > 0 ? clones : members;
          const moving = unionSlideObjectGeometries(
            members.map((member) => member.start),
          );
          const positioningLayer = groupPositioningLayer;
          const containingBlock = groupContainingBlock;
          if (!moving || !positioningLayer || !containingBlock) {
            return { handled: false, reason: "unhandled" };
          }
          const snapCanvas = {
            width:
              containingBlock.offsetWidth ||
              positioningLayer.offsetWidth ||
              viewport.canvas.width,
            height:
              containingBlock.offsetHeight ||
              positioningLayer.offsetHeight ||
              viewport.canvas.height,
          };
          const snap = snapSlideObjectMove({
            moving,
            deltaX: gesture.canvasDelta.x,
            deltaY: gesture.canvasDelta.y,
            peers: getSnapPeerGeometries(
              dragged.map((member) => member.element),
              positioningLayer,
            ),
            canvas: snapCanvas,
            scale: readScreenScale(containingBlock),
            bypass:
              gesture.pointer.metaKey ||
              gesture.pointer.ctrlKey ||
              Boolean(viewport.toLocalDelta),
          });
          applySlideObjectMoveDelta(
            dragged,
            snap.deltaX,
            snap.deltaY,
            applyObjectGeometry,
          );
          updateAlignmentGuides(snap.guides, containingBlock, snapCanvas);
          scheduleMultiSelectionRects(rectIds);
          return { handled: true };
        },
        commit: () => {
          if (members.length === 0) {
            return { handled: false, reason: "unhandled" };
          }
          // pointerUp re-runs preview whenever Alt changed, so clones that
          // reach commit belong to a gesture that is still duplicating.
          const committed = clones.length > 0 ? clones : members;
          copyDragRectIdsRef.current = null;
          cancelScheduledMultiSelectionRects();
          // Serialize while the promoted elements still live in their fmd
          // canvas. Markdown promotion restores the React tree below, but
          // the persisted HTML must retain the canvas and absolute geometry.
          for (const promotion of promotions) {
            preserveSlideObjectLayoutSpacer(promotion.element);
          }
          if (!promotions.some((promotion) => promotion.restoreMarkdownTree)) {
            for (const member of committed) {
              const layer = resolveSlidePositioningLayer(member.element);
              if (layer) releaseSlideObjectFromLeftBoxes(member.element, layer);
            }
          }
          const html = readCurrentSlideContentHtml();
          for (const promotion of promotions) {
            removeSlideObjectLayoutSpacer(promotion.element);
          }
          const restoredMarkdownTrees = new Set<() => void>();
          for (const promotion of promotions) {
            const restoreMarkdownTree = promotion.restoreMarkdownTree;
            if (
              restoreMarkdownTree &&
              !restoredMarkdownTrees.has(restoreMarkdownTree)
            ) {
              restoredMarkdownTrees.add(restoreMarkdownTree);
              restoreMarkdownTree();
            }
          }
          if (html !== null) {
            pendingMultiSelectionResyncRef.current = {
              objectIds: committed.map((member) => member.objectId),
              paths: [],
            };
            onUpdateSlideRef.current({ content: html }, undefined, {
              persistence: "immediate",
            });
          }
          return { handled: true };
        },
        cancel: () => {
          removeClones();
          if (members.length > 0) {
            applySlideObjectMoveDelta(members, 0, 0, applyObjectGeometry);
            refreshMultiSelectionRects(ids);
          }
          restoreGroupPromotions();
          return { handled: true };
        },
      });
      controller.pointerDown({
        kind: "move",
        objectIds: Array.from(ids),
        pointer: {
          x: e.clientX,
          y: e.clientY,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        },
        viewport: viewport.rect,
        canvas: viewport.canvas,
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
        window.getSelection()?.removeAllRanges();
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
      activeGestureRef.current = { cancel: onCancel, pointerId: e.pointerId };
    },
    [
      applyObjectGeometry,
      cancelScheduledMultiSelectionRects,
      clearAlignmentGuides,
      freezeElementForFreeformSelection,
      getSnapPeerGeometries,
      getObjectGeometry,
      getSlideContent,
      readCurrentSlideContentHtml,
      readOnly,
      refreshMultiSelectionRects,
      scheduleMultiSelectionRects,
      updateAlignmentGuides,
    ],
  );

  const rotateSelectedObjects = useCallback(
    (deltaDegrees: number) => {
      if (readOnly) return false;
      const selection = getObjectOperationSelection();
      if (!selection) return false;
      const movable = collectMovableSlideObjects(
        selection.elements,
        getObjectGeometry,
      );
      if (movable.length !== selection.elements.length) return false;
      const members: SlideObjectRotationMember[] = movable.map((member) => ({
        ...member,
        ...readSlideObjectTransformSnapshot(member.element),
        rotation: readEditableSlideObjectRotation(member.element),
      }));
      const plan = rotateSlideObjectMembers(members, deltaDegrees);
      if (plan.size !== members.length) return false;

      for (const member of members) {
        const next = plan.get(member.objectId);
        if (!next) continue;
        applyObjectGeometry(
          member.element,
          planSlideObjectGeometry(member.element, next.geometry),
        );
        member.element.style.setProperty(
          "transform",
          next.transform,
          member.element.style.getPropertyPriority("transform"),
        );
      }

      if (multiSelection.size > 0) {
        refreshMultiSelectionRects(
          new Set(
            members
              .map((member) => member.element.getAttribute("data-builder-id"))
              .filter((id): id is string => Boolean(id)),
          ),
        );
        pendingMultiSelectionResyncRef.current = {
          objectIds: members.map((member) => member.objectId),
          paths: [],
        };
      } else {
        const element = members[0]?.element;
        const selector = element && getBuilderSelector(element);
        if (element && selector) selectElementForStyling(element, selector);
      }
      const html = readCurrentSlideContentHtml();
      if (html !== null) {
        onUpdateSlideRef.current({ content: html }, undefined, {
          persistence: "immediate",
        });
      }
      return true;
    },
    [
      applyObjectGeometry,
      getObjectGeometry,
      getObjectOperationSelection,
      multiSelection.size,
      readCurrentSlideContentHtml,
      readOnly,
      refreshMultiSelectionRects,
      selectElementForStyling,
    ],
  );

  const startRotateSelection = useCallback(
    (e: React.PointerEvent, outlineRect: DOMRect) => {
      if (readOnly || e.button !== 0) return;
      if (editingElRef.current) exitInlineEdit();
      let promotion: {
        element: HTMLElement;
        snapshot: {
          className: string;
          style: string | null;
          objectId: string | null;
          contentEditable: string | null;
          editingBlock: string | null;
        };
        restoreMarkdownTree?: () => void;
        restoreDescendants?: () => void;
        wasFlow: boolean;
      } | null = null;
      const restorePromotion = () => {
        if (!promotion) return;
        removeSlideObjectLayoutSpacer(promotion.element);
        promotion.restoreDescendants?.();
        if (promotion.restoreMarkdownTree) {
          promotion.restoreMarkdownTree();
        } else {
          restoreSlideObjectDomSnapshot(promotion.element, promotion.snapshot);
        }
        if (promotion.snapshot.objectId) {
          promotion.element.setAttribute(
            "data-slide-object-id",
            promotion.snapshot.objectId,
          );
        } else {
          promotion.element.removeAttribute("data-slide-object-id");
        }
        promotion = null;
      };
      const selectedObjects = getObjectOperationSelection()?.elements;
      let promotionSource: HTMLElement | null = null;
      if (!selectedObjects) {
        if (multiSelection.size > 0) return;
        const slideContent = getSlideContent();
        promotionSource =
          resolveSelectedElement() ??
          (selectedImg && slideContent
            ? (findPersistedImageObject(selectedImg, slideContent) ??
              selectedImg)
            : null);
        if (!promotionSource || isSlideTableStructureElement(promotionSource)) {
          return;
        }
      }

      e.preventDefault();
      e.stopPropagation();
      // A press on the rotate handle is not a rotation: nothing is promoted
      // or written until the pointer travels past the drag threshold.
      let members: SlideObjectRotationMember[] = [];
      let originalStyles = new Map<string, string | null>();
      let originalTransforms: Array<{
        element: HTMLElement;
        value: string;
        priority: string;
      }> = [];
      let began: "pending" | "ready" | "failed" = "pending";
      const beginRotation = () => {
        if (began !== "pending") return began === "ready";
        began = "failed";
        let targets = selectedObjects ?? [];
        const inlineTransforms = new Map<
          HTMLElement,
          { value: string; priority: string }
        >();
        for (const target of targets) {
          inlineTransforms.set(target, {
            value: target.style.getPropertyValue("transform"),
            priority: target.style.getPropertyPriority("transform"),
          });
        }
        if (promotionSource) {
          const element = promotionSource;
          inlineTransforms.set(element, {
            value: element.style.getPropertyValue("transform"),
            priority: element.style.getPropertyPriority("transform"),
          });
          promotion = {
            element,
            snapshot: {
              className: element.className,
              style: element.getAttribute("style"),
              objectId: element.getAttribute("data-slide-object-id"),
              contentEditable: element.getAttribute("contenteditable"),
              editingBlock: element.getAttribute("data-editing-block"),
            },
            wasFlow: getComputedStyle(element).position !== "absolute",
          };
          const frozen = freezeElementForFreeformSelection(element);
          promotion.restoreMarkdownTree = frozen?.restoreMarkdownTree;
          promotion.restoreDescendants = frozen?.restoreDescendants;
          if (!frozen || !isPersistedFreeformObject(frozen.element)) {
            restorePromotion();
            return false;
          }
          setSelectedObjectId(ensureSlideObjectId(frozen.element));
          targets = [frozen.element];
        }
        const movable = collectMovableSlideObjects(targets, getObjectGeometry);
        if (targets.length === 0 || movable.length !== targets.length) {
          restorePromotion();
          return false;
        }
        members = movable.map((member) => ({
          ...member,
          ...readSlideObjectTransformSnapshot(member.element),
          rotation: readEditableSlideObjectRotation(member.element),
        }));
        originalStyles = new Map(
          members.map((member) => [
            member.objectId,
            member.element.getAttribute("style"),
          ]),
        );
        originalTransforms = members.map((member) => {
          const originalElement = promotionSource ?? member.element;
          const originalTransform = inlineTransforms.get(originalElement) ??
            inlineTransforms.get(member.element) ?? {
              value: member.element.style.getPropertyValue("transform"),
              priority: member.element.style.getPropertyPriority("transform"),
            };
          return { element: originalElement, ...originalTransform };
        });
        began = "ready";
        return true;
      };
      const center = {
        x: outlineRect.left + outlineRect.width / 2,
        y: outlineRect.top + outlineRect.height / 2,
      };
      const startPoint = { x: e.clientX, y: e.clientY };
      const startAngle =
        (Math.atan2(startPoint.y - center.y, startPoint.x - center.x) * 180) /
        Math.PI;
      let changed = false;

      const applyDelta = (deltaDegrees: number) => {
        const plan = rotateSlideObjectMembers(members, deltaDegrees);
        if (plan.size !== members.length) return;
        const transforms: Array<{
          element: HTMLElement;
          value: string;
          priority: string;
        }> = [];
        for (const member of members) {
          const next = plan.get(member.objectId);
          if (!next) continue;
          applyObjectGeometry(
            member.element,
            planSlideObjectGeometry(member.element, next.geometry),
          );
          transforms.push({
            element: member.element,
            value: next.transform,
            priority: member.element.style.getPropertyPriority("transform"),
          });
        }
        restoreSlideObjectTransformSnapshots(transforms);
        const everyRotationPainted = members.every((member) => {
          const expected = plan.get(member.objectId)?.rotation;
          const painted = readEditableSlideObjectRotation(member.element);
          if (expected === undefined || painted === null) return false;
          const difference = Math.abs(((painted - expected + 540) % 360) - 180);
          return difference <= 0.1;
        });
        if (!everyRotationPainted) {
          // A rule can begin matching the preview style and override the
          // transform after the initial editability check. Never persist a
          // rotation that the selected objects did not actually paint.
          changed = false;
          restore();
          stop();
          return;
        }
        changed = Math.abs(deltaDegrees) > 0.01;
        if (multiSelection.size > 0) {
          scheduleMultiSelectionRects(multiSelection);
        } else {
          const element = members[0]?.element;
          const rect = element?.getBoundingClientRect() ?? outlineRect;
          setSelectedElementMeasurement({
            key: selectionOverlayMeasurementKey,
            rect,
            frame: element
              ? readSlideObjectSelectionFrame(element, rect)
              : null,
          });
        }
      };

      const restore = () => {
        if (began === "pending") return;
        if (promotion) {
          restorePromotion();
        } else {
          for (const member of members) {
            const originalStyle = originalStyles.get(member.objectId);
            if (originalStyle === null || originalStyle === undefined) {
              member.element.removeAttribute("style");
            } else {
              member.element.setAttribute("style", originalStyle);
            }
          }
        }
        restoreSlideObjectTransformSnapshots(originalTransforms);
        if (multiSelection.size > 0) {
          refreshMultiSelectionRects(multiSelection);
        } else {
          const element = members[0]?.element;
          const selector = element && getBuilderSelector(element);
          if (element && selector) selectElementForStyling(element, selector);
          if (element) {
            const rect = element.getBoundingClientRect();
            setSelectedElementMeasurement({
              key: selectionOverlayMeasurementKey,
              rect,
              frame: readSlideObjectSelectionFrame(element, rect),
            });
          }
        }
      };

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (activeGestureRef.current?.cancel === onCancel) {
          activeGestureRef.current = null;
        }
      };

      const onMove = (moveEvent: PointerEvent) => {
        if (
          began === "pending" &&
          Math.hypot(
            moveEvent.clientX - startPoint.x,
            moveEvent.clientY - startPoint.y,
          ) < SLIDES_CANVAS_DRAG_THRESHOLD
        ) {
          return;
        }
        if (!beginRotation()) return;
        const delta = resolveSlideObjectRotationDelta(
          startAngle,
          center,
          { x: moveEvent.clientX, y: moveEvent.clientY },
          moveEvent.shiftKey,
        );
        applyDelta(delta);
        moveEvent.preventDefault();
      };

      const onUp = () => {
        stop();
        if (!changed) {
          restore();
          return;
        }
        if (multiSelection.size === 0) {
          const element = members[0]?.element;
          const selector = element && getBuilderSelector(element);
          if (element && selector) selectElementForStyling(element, selector);
        }
        if (promotion?.wasFlow) {
          preserveSlideObjectLayoutSpacer(promotion.element);
          if (!promotion.restoreMarkdownTree) {
            const positioningLayer = resolveSlidePositioningLayer(
              promotion.element,
            );
            if (positioningLayer) {
              releaseSlideObjectFromLeftBoxes(
                promotion.element,
                positioningLayer,
              );
            }
          }
        }
        const html = readCurrentSlideContentHtml();
        if (html === null) {
          restore();
          return;
        }
        if (promotion?.restoreMarkdownTree) {
          removeSlideObjectLayoutSpacer(promotion.element);
          promotion.restoreMarkdownTree();
        }
        if (multiSelection.size > 0) {
          pendingMultiSelectionResyncRef.current = {
            objectIds: members.map((member) => member.objectId),
            paths: [],
          };
        }
        promotion = null;
        onUpdateSlideRef.current({ content: html }, undefined, {
          persistence: "immediate",
        });
      };

      const onCancel = () => {
        stop();
        restore();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      activeGestureRef.current = { cancel: onCancel, pointerId: e.pointerId };
    },
    [
      applyObjectGeometry,
      exitInlineEdit,
      findPersistedImageObject,
      freezeElementForFreeformSelection,
      getObjectGeometry,
      getSlideContent,
      getObjectOperationSelection,
      multiSelection,
      onUpdateSlideRef,
      readCurrentSlideContentHtml,
      readOnly,
      releaseSlideObjectFromLeftBoxes,
      refreshMultiSelectionRects,
      resolveSelectedElement,
      selectedImg,
      scheduleMultiSelectionRects,
      selectElementForStyling,
      selectionOverlayMeasurementKey,
    ],
  );

  // Enter on a selected text object edits it with all of its text selected.
  useEffect(() => {
    if (readOnly || editingEl || !isHtmlSlide) return;
    if (multiSelection.size > 0 || !selectedElementSelector) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key !== "Enter" ||
        e.shiftKey ||
        e.altKey ||
        e.metaKey ||
        e.ctrlKey ||
        e.isComposing
      ) {
        return;
      }
      const active = document.activeElement;
      if (!isSlideCanvasShortcutTarget(active, slideCanvasRef.current)) return;
      if (isSlideTextEditingTarget(e.target, active, editingEl)) return;
      if (active instanceof HTMLButtonElement) return;
      const slideContent = getSlideContent();
      const selected = resolveSelectedElement();
      if (!slideContent || !selected) return;
      // A painted card with several leaves has no block of its own; Enter
      // edits its first leaf.
      const own = findSmartBlock(selected, slideContent);
      const block =
        own ??
        (isSlideObjectGroup(selected)
          ? null
          : firstTextLeaf(selected, slideContent));
      if (
        !block ||
        (own && resolveSlideTextSelectionTarget(own, slideContent) !== selected)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      selectAllEditableText(block);
      enterInlineEdit(block);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    editingEl,
    enterInlineEdit,
    getSlideContent,
    isHtmlSlide,
    multiSelection.size,
    readOnly,
    resolveSelectedElement,
    selectedElementSelector,
  ]);

  useEffect(() => {
    if (readOnly || editingEl) return;
    if (multiSelection.size === 0 && !selectedElementSelector && !selectedImg)
      return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Arrow")) return;
      const active = document.activeElement;
      if (!isSlideCanvasShortcutTarget(active, slideCanvasRef.current)) return;
      if (isSlideTextEditingTarget(e.target, active, editingEl)) return;
      if (
        active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        active?.tagName === "SELECT" ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      const nudge = resolveSlidesCanvasNudge(e);
      if (!nudge) return;
      const { x: dx, y: dy } = nudge.delta;

      if (multiSelection.size > 0 && !e.metaKey && !e.ctrlKey) {
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
        const roots = elements.filter(
          (element) =>
            !elements.some(
              (candidate) =>
                candidate !== element && candidate.contains(element),
            ),
        );
        if (roots.length === 0) return;

        const promotions: Array<{
          element: HTMLElement;
          originalClassName: string;
          originalStyle: string | null;
          originalObjectId: string | null;
          originalContentEditable: string | null;
          originalEditingBlock: string | null;
          restoreMarkdownTree?: () => void;
          restoreDescendants?: () => void;
        }> = [];
        let promotionsRestored = false;
        const restorePromotions = () => {
          if (promotionsRestored) return;
          promotionsRestored = true;
          for (const promotion of promotions) {
            removeSlideObjectLayoutSpacer(promotion.element);
          }
          const restoredMarkdownTrees = new Set<() => void>();
          for (const promotion of promotions) {
            const restoreMarkdownTree = promotion.restoreMarkdownTree;
            if (
              restoreMarkdownTree &&
              !restoredMarkdownTrees.has(restoreMarkdownTree)
            ) {
              restoredMarkdownTrees.add(restoreMarkdownTree);
              restoreMarkdownTree();
            }
          }
          for (const promotion of promotions) {
            restoreSlideObjectDomSnapshot(promotion.element, {
              className: promotion.originalClassName,
              style: promotion.originalStyle,
              objectId: promotion.originalObjectId,
              contentEditable: promotion.originalContentEditable,
              editingBlock: promotion.originalEditingBlock,
            });
            promotion.restoreDescendants?.();
          }
        };
        for (const element of roots) {
          const originalClassName = element.className;
          const originalStyle = element.getAttribute("style");
          const originalObjectId = element.getAttribute("data-slide-object-id");
          const originalContentEditable =
            element.getAttribute("contenteditable");
          const originalEditingBlock =
            element.getAttribute("data-editing-block");
          const frozen = freezeElementForFreeformSelection(element);
          if (!frozen) {
            restorePromotions();
            return;
          }
          promotions.push({
            element,
            originalClassName,
            originalStyle,
            originalObjectId,
            originalContentEditable,
            originalEditingBlock,
            restoreMarkdownTree: frozen.restoreMarkdownTree,
            restoreDescendants: frozen.restoreDescendants,
          });
          if (!isPersistedFreeformObject(frozen.element)) {
            restorePromotions();
            return;
          }
        }

        const members = collectMovableSlideObjects(roots, getObjectGeometry);
        if (members.length !== roots.length) {
          restorePromotions();
          return;
        }
        const fmdSlide = members[0].element.closest(
          ".fmd-slide",
        ) as HTMLElement | null;
        if (!fmdSlide) {
          restorePromotions();
          return;
        }
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
          restorePromotions();
          return;
        }
        e.preventDefault();
        applySlideObjectMoveDelta(members, dx, dy, applyObjectGeometry);
        for (const promotion of promotions) {
          preserveSlideObjectLayoutSpacer(promotion.element);
        }
        if (!promotions.some((promotion) => promotion.restoreMarkdownTree)) {
          for (const member of members) {
            releaseSlideObjectFromLeftBoxes(member.element, positioningLayer);
          }
        }
        const html = readCurrentSlideContentHtml();
        if (html === null) {
          restorePromotions();
          return;
        }
        for (const promotion of promotions) {
          removeSlideObjectLayoutSpacer(promotion.element);
        }
        const restoredMarkdownTrees = new Set<() => void>();
        for (const promotion of promotions) {
          const restoreMarkdownTree = promotion.restoreMarkdownTree;
          if (
            restoreMarkdownTree &&
            !restoredMarkdownTrees.has(restoreMarkdownTree)
          ) {
            restoredMarkdownTrees.add(restoreMarkdownTree);
            restoreMarkdownTree();
          }
        }
        for (const promotion of promotions) {
          restoreSlideObjectDomSnapshot(promotion.element, {
            className: promotion.originalClassName,
            style: promotion.originalStyle,
            objectId: promotion.originalObjectId,
            contentEditable: promotion.originalContentEditable,
            editingBlock: promotion.originalEditingBlock,
          });
        }
        refreshMultiSelectionRects(multiSelection);
        commitMultiObjectChange(
          members.map((member) => member.objectId),
          html,
          { separateUndo: true },
        );
        return;
      }

      const slideContent = getSlideContent();
      const element =
        resolveSelectedElement() ??
        (selectedImg && slideContent
          ? (findPersistedImageObject(selectedImg, slideContent) ?? selectedImg)
          : null);
      if (!element) return;

      // Arrow nudging is also a first-class way to move flow-layout text and
      // images. Promote those elements using the same reversible freeform
      // boundary as a real drag, then persist the exact resulting HTML.
      const frozen = isPersistedFreeformObject(element)
        ? { element }
        : freezeElementForFreeformSelection(element);
      if (!frozen || !isPersistedFreeformObject(frozen.element)) {
        frozen?.restoreMarkdownTree?.();
        return;
      }
      e.preventDefault();
      const geometry = getObjectGeometry(frozen.element);
      geometry.x += dx;
      geometry.y += dy;
      applyObjectGeometry(
        frozen.element,
        planSlideObjectGeometry(frozen.element, geometry),
      );
      preserveSlideObjectLayoutSpacer(frozen.element);
      const nudgeLayer = resolveSlidePositioningLayer(frozen.element);
      if (!frozen.restoreMarkdownTree && nudgeLayer) {
        releaseSlideObjectFromLeftBoxes(frozen.element, nudgeLayer);
      }
      const html = readCurrentSlideContentHtml();

      if (frozen.restoreMarkdownTree) {
        removeSlideObjectLayoutSpacer(frozen.element);
        frozen.restoreMarkdownTree();
      }
      if (html !== null) {
        onUpdateSlideRef.current({ content: html }, undefined, {
          separateUndo: true,
        });
      }
      const selector = getBuilderSelector(frozen.element);
      if (selector) selectElementForStyling(frozen.element, selector);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    applyObjectGeometry,
    commitMultiObjectChange,
    editingEl,
    freezeElementForFreeformSelection,
    getObjectGeometry,
    getSlideContent,
    multiSelection,
    readCurrentSlideContentHtml,
    readOnly,
    refreshMultiSelectionRects,
    resolveSelectedElement,
    selectElementForStyling,
    selectedImg,
    selectedElementSelector,
  ]);

  // --- Marquee drag handlers (attached to slide-content via React props) ---

  const handleSlidePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const placement = placementRef.current;
      if (!placement) return;

      placement.current = { x: e.clientX, y: e.clientY };

      placementRef.current = null;
      setPlacementRect(null);
      activeGestureRef.current = null;

      const canvas = containerRef.current
        ? ensureSlideTextBoxCanvas(containerRef.current)
        : null;
      if (!canvas) {
        suppressNextClickRef.current = false;
        return;
      }

      const { fmdSlide, positioningLayer } = canvas;
      if (getComputedStyle(fmdSlide).position === "static") {
        fmdSlide.style.position = "relative";
      }
      const containingBlock =
        resolveSlideObjectInsertionContainingBlock(positioningLayer);
      const rect = containingBlock.getBoundingClientRect();
      const start = clientPointToSlideCoordinates(
        placement.start.x,
        placement.start.y,
        rect,
        containingBlock.offsetWidth,
        containingBlock.offsetHeight,
      );
      const end = clientPointToSlideCoordinates(
        placement.current.x,
        placement.current.y,
        rect,
        containingBlock.offsetWidth,
        containingBlock.offsetHeight,
      );
      const dragSized =
        Math.abs(placement.current.x - placement.start.x) >= 4 ||
        Math.abs(placement.current.y - placement.start.y) >= 4;
      const defaultSize = placement.shapeType
        ? SLIDE_SHAPE_DEFAULT_SIZES[placement.shapeType]
        : { width: 320, height: 24 };
      const isLineDrag = dragSized && placement.shapeType === "line";
      const lineGeometry = isLineDrag
        ? createSlideLinePlacementGeometry(start, end)
        : null;
      const geometry = lineGeometry
        ? lineGeometry
        : dragSized
          ? createSlideObjectPlacementGeometry(start, end)
          : { x: start.x, y: start.y, ...defaultSize };

      if (placement.shapeType) {
        placeShapeAt(
          geometry,
          placement.shapeType,
          placement.target,
          lineGeometry?.rotation,
        );
        onExitShapeMode?.();
      } else {
        placeTextBoxAt(geometry, placement.target, dragSized);
        onExitTextBoxMode?.();
      }

      window.setTimeout(function clearPlacementClickSuppression() {
        suppressNextClickRef.current = false;
      }, 0);
    },
    [onExitShapeMode, onExitTextBoxMode, placeShapeAt, placeTextBoxAt],
  );

  const handleSlidePointerCancel = useCallback(() => {
    if (!placementRef.current) return;
    activeGestureRef.current?.cancel();
  }, []);

  const setCanvasHoverElement = useCallback((element: HTMLElement | null) => {
    if (!element) {
      if (canvasHoverElementRef.current) setCanvasHover(null);
      canvasHoverElementRef.current = null;
      return;
    }
    // AutoFit can rescale the slide under a still pointer, so re-measure on
    // every move and only publish a changed box.
    const rect = element.getBoundingClientRect();
    const unchanged = canvasHoverElementRef.current === element;
    canvasHoverElementRef.current = element;
    setCanvasHover((current) =>
      unchanged &&
      current &&
      current.rect.left === rect.left &&
      current.rect.top === rect.top &&
      current.rect.width === rect.width &&
      current.rect.height === rect.height
        ? current
        : { rect, frame: readSlideObjectSelectionFrame(element, rect) },
    );
  }, []);

  const clearCanvasHover = useCallback(() => {
    if (slideCanvasRef.current) slideCanvasRef.current.style.cursor = "";
    setCanvasHoverElement(null);
  }, [setCanvasHoverElement]);

  // A content write can replace the hovered node, and a resize or scroll moves
  // it; drop the stale outline until the pointer moves again.
  useEffect(() => {
    window.addEventListener("resize", clearCanvasHover);
    window.addEventListener("scroll", clearCanvasHover, true);
    return () => {
      window.removeEventListener("resize", clearCanvasHover);
      window.removeEventListener("scroll", clearCanvasHover, true);
      clearCanvasHover();
    };
  }, [clearCanvasHover, slide.content, slide.id]);

  /**
   * What is under the pointer. Hover, press, click, double-click and the
   * context menu all ask this, so the outline always names what a press takes.
   */
  const resolvePointerTarget = useCallback(
    (
      e: Pick<
        MouseEvent,
        "clientX" | "clientY" | "shiftKey" | "altKey" | "metaKey" | "ctrlKey"
      > & { target: EventTarget | null },
      slideContent: HTMLElement,
      {
        intoGroups = false,
        selected = resolveSelectedElement(),
      }: { intoGroups?: boolean; selected?: HTMLElement | null } = {},
    ) =>
      resolveSlidePointerTarget({
        root: slideContent,
        point: { x: e.clientX, y: e.clientY },
        stack: document.elementsFromPoint(e.clientX, e.clientY),
        target: e.target,
        modifiers: {
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        },
        selected,
        intoGroups,
      }),
    [resolveSelectedElement],
  );

  const handleSlidePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const placement = placementRef.current;
      if (placement) {
        placement.current = { x: e.clientX, y: e.clientY };
        setPlacementRect({
          x: Math.min(placement.start.x, e.clientX),
          y: Math.min(placement.start.y, e.clientY),
          w: Math.abs(e.clientX - placement.start.x),
          h: Math.abs(e.clientY - placement.start.y),
        });
        return;
      }
      const slideContent = getSlideContent();
      if (
        editingEl ||
        readOnly ||
        e.buttons !== 0 ||
        activeGestureRef.current ||
        // An armed placement tool owns the cursor; the inline cursor below
        // would override its crosshair class.
        shapeType ||
        textBoxMode ||
        pinMode ||
        drawMode ||
        imageCropRef.current ||
        !slideContent
      ) {
        clearCanvasHover();
        return;
      }
      const hit = resolvePointerTarget(e, slideContent);
      setCanvasHoverElement(hit.kind === "object" ? hit.hoverOutline : null);
      if (slideCanvasRef.current) {
        slideCanvasRef.current.style.cursor =
          hit.kind === "object" ? hit.cursor : "";
      }
    },
    [
      clearCanvasHover,
      drawMode,
      editingEl,
      getSlideContent,
      pinMode,
      readOnly,
      shapeType,
      textBoxMode,
      resolvePointerTarget,
      setCanvasHoverElement,
    ],
  );

  const handleSlidePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // left click only
      if (imageCropRef.current) {
        e.preventDefault();
        return;
      }
      clearCanvasHover();
      const slideContent = getSlideContent();
      if (!slideContent) return;
      const target = e.target as HTMLElement;
      commentThreadPressRef.current = null;
      pointerPressRef.current = null;
      textPressClampStopRef.current?.();

      if (shapeType) {
        e.preventDefault();
        if (editingEl) exitInlineEdit();
        suppressNextClickRef.current = true;
        const placement: SlidePlacementGesture = {
          start: { x: e.clientX, y: e.clientY },
          current: { x: e.clientX, y: e.clientY },
          target,
          shapeType,
        };
        placementRef.current = placement;
        setPlacementRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
        const cancelPlacement = () => {
          if (placementRef.current !== placement) return;
          placementRef.current = null;
          setPlacementRect(null);
          suppressNextClickRef.current = false;
          if (activeGestureRef.current?.cancel === cancelPlacement) {
            activeGestureRef.current = null;
          }
        };
        activeGestureRef.current = {
          cancel: cancelPlacement,
          pointerId: e.pointerId,
        };
        if (e.pointerId >= 0) e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      if (textBoxMode) {
        e.preventDefault();
        if (editingEl) exitInlineEdit();
        suppressNextClickRef.current = true;
        const placement: SlidePlacementGesture = {
          start: { x: e.clientX, y: e.clientY },
          current: { x: e.clientX, y: e.clientY },
          target,
          shapeType: null,
        };
        placementRef.current = placement;
        setPlacementRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
        const cancelPlacement = () => {
          if (placementRef.current !== placement) return;
          placementRef.current = null;
          setPlacementRect(null);
          suppressNextClickRef.current = false;
          if (activeGestureRef.current?.cancel === cancelPlacement) {
            activeGestureRef.current = null;
          }
        };
        activeGestureRef.current = {
          cancel: cancelPlacement,
          pointerId: e.pointerId,
        };
        if (e.pointerId >= 0) e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const targetIsEditingBlock =
        editingEl?.contains(e.target as Node) ?? false;
      if (editingEl) {
        if (targetIsEditingBlock && !additive && multiSelection.size === 0) {
          return;
        }
        exitInlineEdit();
      } else if (
        isSlideTextEditingTarget(e.target, document.activeElement, editingEl)
      ) {
        return;
      }
      // A modifier press is multi-select, never an open-thread press.
      if (!editingEl && !pinMode && !drawMode && !additive) {
        const threadId = slideCommentThreadAtPoint(
          comments,
          slideContent,
          e.clientX,
          e.clientY,
        );
        if (threadId) {
          commentThreadPressRef.current = {
            threadId,
            x: e.clientX,
            y: e.clientY,
          };
        }
      }
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.focus({ preventScroll: true });
      }
      // Overlays inside the canvas (warnings, presence) are not the slide.
      if (!slideContent.contains(target)) return;

      // The renderer stamps builder ids after paint; a first press can arrive
      // before that and would have no selector to select.
      stampBuilderIds(slideContent);
      // A selected group is dragged whole from any member; the click that
      // follows is what drills into the member.
      const selected = resolveSelectedElement();
      const groupWasSelected = Boolean(
        selected && isSlideObjectGroup(selected),
      );
      const hit = resolvePointerTarget(e, slideContent, {
        selected: groupWasSelected ? null : selected,
      });

      // Pointer-down on a member of the current multi-selection drags the
      // whole group instead of the single-object flow below.
      if (multiSelection.size > 0 && hit.kind === "object") {
        const id = resolveSelectionOwnerId(hit.object, slideContent);
        if (id && multiSelection.has(id)) {
          // An additive press may still toggle on click; the click is
          // delivered either way, so only the native text selection is held.
          if (!additive) e.preventDefault();
          startGroupDrag(e, multiSelection);
          return;
        }
      }

      if (hit.kind === "object") {
        pointerPressRef.current = {
          object: hit.object,
          hit: hit.hit,
          textRoot: hit.textRoot,
          x: e.clientX,
          y: e.clientY,
          groupWasSelected: groupWasSelected && selected === hit.object,
        };
        const intent = resolveSlidesCanvasTargetIntent(hit);
        // Shift/Cmd-click toggles membership in the click handler. Selecting
        // here first would drop the object it is being added to.
        if (intent === "none") {
          e.preventDefault();
          return;
        }
        // Text bounds keep the browser's caret and text selection; the click
        // finishes the press. Everything else of an object selects and moves.
        if (intent === "edit-text" && hit.textRoot) {
          // The native drag highlight must not leave this object; the
          // release-time clamp in the click handler only fixes the end state.
          const textRoot = hit.textRoot;
          const clampSelection = () => {
            const selection = window.getSelection();
            if (selection) clampSelectionToTextRoot(selection, textRoot);
          };
          const stopClamp = () => {
            document.removeEventListener("selectionchange", clampSelection);
            window.removeEventListener("pointerup", stopClamp);
            window.removeEventListener("pointercancel", stopClamp);
            window.removeEventListener("blur", stopClamp);
            if (textPressClampStopRef.current === stopClamp) {
              textPressClampStopRef.current = null;
            }
          };
          document.addEventListener("selectionchange", clampSelection);
          window.addEventListener("pointerup", stopClamp);
          window.addEventListener("pointercancel", stopClamp);
          window.addEventListener("blur", stopClamp);
          textPressClampStopRef.current = stopClamp;
          return;
        }
        e.preventDefault();
        // A cell is selected and styled in place; freezing it would pull it
        // out of its table.
        if (isSlideTableStructureElement(hit.object)) return;
        startElementDrag(e, hit.object, { preserveClickWithoutMove: true });
        return;
      }

      e.preventDefault();
      marqueeOriginRef.current = { x: e.clientX, y: e.clientY };
      marqueeAdditiveRef.current = e.shiftKey || e.metaKey || e.ctrlKey;
      marqueePrevSelectionRef.current = new Set(multiSelection);
      const initialMarquee = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
      marqueeRef.current = initialMarquee;
      setMarquee(initialMarquee);
      if (e.pointerId >= 0) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }

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
      clearCanvasHover,
      comments,
      drawMode,
      editingEl,
      getSlideContent,
      multiSelection,
      applyMultiSelection,
      clearSelectedElement,
      textBoxMode,
      pinMode,
      shapeType,
      exitInlineEdit,
      resolvePointerTarget,
      resolveSelectedElement,
      startElementDrag,
      startGroupDrag,
    ],
  );

  // Keep these listeners stable while React re-renders the marquee overlay.
  // Re-attaching them whenever marquee state changes can lose a fast
  // pointermove/pointerup between the effect cleanup and re-install.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const origin = marqueeOriginRef.current;
      if (!origin || !marqueeRef.current) return;
      const x = Math.min(origin.x, e.clientX);
      const y = Math.min(origin.y, e.clientY);
      const w = Math.abs(e.clientX - origin.x);
      const h = Math.abs(e.clientY - origin.y);
      const nextMarquee = { x, y, w, h };
      marqueeRef.current = nextMarquee;
      setMarquee(nextMarquee);
    };
    const finish = (cancelled: boolean) => {
      const origin = marqueeOriginRef.current;
      const current = marqueeRef.current;
      marqueeOriginRef.current = null;
      marqueeRef.current = null;
      setMarquee(null);
      if (cancelled || !origin || !current) return;

      const slideContent = getSlideContent();
      if (!slideContent) return;
      stampBuilderIds(slideContent);

      // Tiny drag = treat as a "click on whitespace" → just clear selection
      // (already handled on pointerdown); do nothing here.
      if (current.w < 4 && current.h < 4) return;

      // The browser emits a click after a completed pointer gesture. Without
      // consuming it, the blank-canvas click handler clears the selection we
      // just computed from the marquee.
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);

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
        if (isLayoutSpacer(el)) return;
        if (isSlideCanvasShell(el)) return;
        if (isInlineTextElement(el)) return;
        if (isTransparentLayoutWrapper(el, { root: slideContent })) return;
        const selectable =
          el.tagName === "IMG" || el.classList.contains("fmd-img-placeholder")
            ? (findPersistedImageObject(el, slideContent) ?? el)
            : el;
        // Groups, tables and painted boxes are the objects a click selects, so
        // the marquee selects them too instead of the text inside them.
        const owner = resolveSelectionOwner(selectable, slideContent);
        const region =
          owner !== selectable || isSlideObjectGroup(owner)
            ? owner
            : findSlideShapeOwner(selectable, slideContent);
        if (region) {
          const regionId = region.getAttribute("data-builder-id");
          if (
            regionId &&
            rectsIntersect(marqueeRect, region.getBoundingClientRect())
          ) {
            hits.add(regionId);
          }
          return;
        }
        const id = selectable.getAttribute("data-builder-id");
        if (!id) return;
        // Skip the slide-content root itself if it ever got stamped
        if (el === slideContent) return;
        // Don't include containers that have selectable descendants — pick
        // the leaves so the agent gets a precise list, not duplicated parents.
        if (el.querySelector("[data-builder-id]")) return;
        const r = selectable.getBoundingClientRect();
        if (rectsIntersect(marqueeRect, r)) hits.add(id);
      });

      applyMultiSelection(hits);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [getSlideContent, applyMultiSelection]);

  /** Send the current selection to the agent chat composer */
  const sendSelectionToAgent = useCallback(() => {
    if (multiSelection.size === 0) return;
    const prompt = buildSelectionHandoffPrompt({
      slideNumber: slideIndex + 1,
      slideId: slide.id,
      selectors: Array.from(multiSelectionRects.values()).map(
        (v) => v.selector,
      ),
    });
    if (!prompt) return;
    sendEditorPromptToAgent(prompt);
  }, [multiSelection.size, multiSelectionRects, slide.id, slideIndex]);

  const publishImageSelection = useCallback(
    (
      element: HTMLElement,
      imageStyle?: Pick<SlideStyleSnapshot, "objectFit" | "objectPosition">,
    ) => {
      const selector =
        getBuilderSelector(element) ??
        `[data-builder-id="${ensureBuilderId(element)}"]`;
      const snapshot = buildStyleSnapshot(element, selector);
      syncSelectionToAppState(
        buildSelectionState("image", [
          selectionItemForElement(
            element,
            selector,
            { ...snapshot, isImage: true },
            imageStyle,
          ),
        ]),
      );
    },
    [buildSelectionState],
  );

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
        const computedStyle = window.getComputedStyle(img);
        const position = normalizeImageObjectPosition(
          img.style.objectPosition || computedStyle.objectPosition,
        );
        const imageOccurrence = imageOccurrenceInRenderedSlide(
          containerRef.current,
          img,
        );
        setSelectedImg(img);
        setImageOverlay({
          rect,
          src,
          objectFit: fit,
          objectPosition: position,
          imageOccurrence,
        });
        publishImageSelection(img);
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
          objectPosition: "center center",
          imageOccurrence: 0,
        });
        publishImageSelection(placeholder);
      }
    },
    [getPlaceholderTarget, publishImageSelection],
  );

  const startImageCrop = useCallback(
    (target: HTMLImageElement) => {
      const slideContent = getSlideContent();
      // Keep Markdown crop gated until React-tree saves are browser-verified.
      if (
        readOnly ||
        !isHtmlSlide ||
        !slideContent ||
        !slideContent.contains(target)
      ) {
        return;
      }

      const existingFrame = findPersistedImageObject(target, slideContent);
      const frameIsPersistedImage = Boolean(
        existingFrame &&
        (existingFrame.classList.contains("fmd-pptx-image") ||
          existingFrame.getAttribute("data-pptx-element-kind") === "image"),
      );
      const originalFrame = frameIsPersistedImage
        ? (existingFrame!.cloneNode(true) as HTMLElement)
        : null;
      const originalImageAttributes = frameIsPersistedImage
        ? null
        : Array.from(
            target.attributes,
            ({ name, value }) => [name, value] as const,
          );
      const originalAnimationState: SlideObjectAnimationSnapshot =
        captureSlideObjectAnimationState(
          frameIsPersistedImage ? existingFrame! : target,
        );

      let frame: HTMLElement = frameIsPersistedImage ? existingFrame! : target;
      let resumeCropAnimations = () => {};
      let restoreCropTransitions = () => {};
      let cancelCropCopiedTransitions = (_preserveOn?: HTMLElement) => {};
      let resumeCropCopiedTransitionOverrides = (_element: HTMLElement) => {};
      let serializeWithoutCopiedTransitionOverrides = (
        serialize: () => string | null,
      ) => serialize();
      const frozen = freezeElementForFreeformSelection(frame);
      if (!frozen) return;

      let image: HTMLImageElement;
      let viewport = frame.querySelector<HTMLElement>(
        ".fmd-image-crop-viewport",
      );
      if (frameIsPersistedImage) {
        serializeWithoutCopiedTransitionOverrides = (serialize) =>
          serializeWithRestoredCropTransitionInlineOverrides(frame, serialize);
        image =
          viewport?.querySelector<HTMLImageElement>("img") ??
          frame.querySelector<HTMLImageElement>("img") ??
          target;
        if (!viewport) {
          const computed = window.getComputedStyle(frame);
          const clipPath = computed.clipPath;
          const borderRadius = computed.borderRadius;
          viewport = frame.ownerDocument.createElement("div");
          viewport.className = "fmd-image-crop-viewport";
          Object.assign(viewport.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            clipPath: clipPath === "none" ? "" : clipPath,
            borderRadius,
          });
          for (const child of Array.from(frame.childNodes)) {
            viewport.appendChild(child);
          }
          frame.appendChild(viewport);
          frame.style.clipPath = "none";
          frame.style.borderRadius = "0";
        }
        const imageLeft = image.offsetLeft;
        const imageTop = image.offsetTop;
        const imageWidth = image.offsetWidth;
        const imageHeight = image.offsetHeight;
        Object.assign(image.style, {
          position: "absolute",
          left: `${imageLeft}px`,
          top: `${imageTop}px`,
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          maxWidth: "none",
          maxHeight: "none",
          margin: "0",
        });
      } else {
        image = target;
        const wrapped = wrapImageInCropFrame(image);
        if (!wrapped) return;
        frame = wrapped.frame;
        viewport = wrapped.viewport;
        resumeCropAnimations = wrapped.resumeAnimations;
        restoreCropTransitions = wrapped.restoreTransitions;
        cancelCropCopiedTransitions = wrapped.cancelCopiedTransitions;
        resumeCropCopiedTransitionOverrides =
          wrapped.resumeCopiedTransitionOverrides;
        serializeWithoutCopiedTransitionOverrides =
          wrapped.serializeWithoutCopiedTransitionOverrides;
        frame.setAttribute("data-builder-id", ensureBuilderId(frame));
      }

      frame.classList.add("fmd-pptx-image");
      frame.setAttribute("data-pptx-element-kind", "image");
      frame.style.overflow = "visible";
      const originalZIndex = frame.style.zIndex;
      frame.style.zIndex = "2147483000";
      ensureSlideObjectId(frame);
      const cropStartGeometry = {
        frame: {
          x: frame.offsetLeft,
          y: frame.offsetTop,
          width: frame.offsetWidth,
          height: frame.offsetHeight,
        },
        image: {
          x: image.offsetLeft,
          y: image.offsetTop,
          width: image.offsetWidth,
          height: image.offsetHeight,
        },
      };
      const previewStyles = (
        [
          [frame, "box-sizing"],
          [frame, "clip-path"],
          [frame, "border-radius"],
          [viewport!, "overflow"],
          [viewport!, "clip-path"],
          [viewport!, "border-radius"],
        ] as const
      ).map(
        ([element, property]) =>
          [
            element,
            property,
            element.style.getPropertyValue(property),
            element.style.getPropertyPriority(property),
          ] as const,
      );
      frame.style.clipPath = "none";
      frame.style.borderRadius = "0";
      const restoreOriginalImageStyleAttribute = () => {
        if (!originalImageAttributes) return;
        const originalStyle = originalImageAttributes.find(
          ([name]) => name === "style",
        );
        if (originalStyle) image.setAttribute("style", originalStyle[1]);
        else image.removeAttribute("style");
      };
      const restoreOriginalImageStyleAndTransitions = () => {
        restoreOriginalImageStyleAttribute();
        image.style.setProperty("transition", "none", "important");
        window.getComputedStyle(image).getPropertyValue("transform");
        restoreCropTransitions();
        restoreOriginalImageStyleAttribute();
      };
      const activeCrop: ActiveImageCrop = {
        slideId: slide.id,
        content: slide.content,
        frame,
        viewport: viewport!,
        image,
        frozen: { restoreMarkdownTree: frozen.restoreMarkdownTree },
        publishSelection: publishImageSelection,
        restorePreviewStyles: () => {
          for (const [element, property, value, priority] of previewStyles) {
            if (value) element.style.setProperty(property, value, priority);
            else element.style.removeProperty(property);
          }
        },
        restoreChrome: () => {
          frame.style.overflow = "hidden";
          if (originalZIndex) frame.style.zIndex = originalZIndex;
          else frame.style.removeProperty("z-index");
        },
        resumeAnimations: resumeCropAnimations,
        restoreTransitions: restoreCropTransitions,
        cancelCopiedTransitions: cancelCropCopiedTransitions,
        resumeCopiedTransitionOverrides: resumeCropCopiedTransitionOverrides,
        serializeWithoutCopiedTransitionOverrides,
        restoreAnimations: () =>
          restoreSlideObjectAnimationState(
            frameIsPersistedImage ? originalFrame! : image,
            originalAnimationState,
          ),
        hasChanges: () =>
          [
            [frame.offsetLeft, cropStartGeometry.frame.x],
            [frame.offsetTop, cropStartGeometry.frame.y],
            [frame.offsetWidth, cropStartGeometry.frame.width],
            [frame.offsetHeight, cropStartGeometry.frame.height],
            [image.offsetLeft, cropStartGeometry.image.x],
            [image.offsetTop, cropStartGeometry.image.y],
            [image.offsetWidth, cropStartGeometry.image.width],
            [image.offsetHeight, cropStartGeometry.image.height],
          ].some(([current, initial]) => Math.abs(current! - initial!) >= 0.5),
        cancel: () => {
          activeCrop.cancelCopiedTransitions(image);
          removeSlideObjectLayoutSpacer(frame, slideContent);
          if (frozen.restoreMarkdownTree) {
            if (frameIsPersistedImage) frame.replaceWith(originalFrame!);
            else frame.replaceWith(image);
            if (!frameIsPersistedImage && originalImageAttributes) {
              for (const attribute of Array.from(image.attributes)) {
                image.removeAttribute(attribute.name);
              }
              for (const [name, value] of originalImageAttributes) {
                image.setAttribute(name, value);
              }
            }
            frozen.restoreMarkdownTree();
            restoreOriginalImageStyleAndTransitions();
            activeCrop.resumeCopiedTransitionOverrides(image);
            activeCrop.restoreAnimations();
            return frameIsPersistedImage ? originalFrame : image;
          }
          if (frameIsPersistedImage) {
            frame.replaceWith(originalFrame!);
            activeCrop.restoreAnimations();
            return originalFrame;
          }
          frame.replaceWith(image);
          if (originalImageAttributes) {
            for (const attribute of Array.from(image.attributes)) {
              image.removeAttribute(attribute.name);
            }
            for (const [name, value] of originalImageAttributes) {
              image.setAttribute(name, value);
            }
          }
          restoreOriginalImageStyleAndTransitions();
          activeCrop.resumeCopiedTransitionOverrides(image);
          activeCrop.restoreAnimations();
          return image;
        },
      };
      imageCropRef.current = activeCrop;
      setImageCrop(activeCrop);
      setImageOverlay(null);
      setSelectedImg(image);
      publishImageSelection(frame);
    },
    [
      freezeElementForFreeformSelection,
      getSlideContent,
      isHtmlSlide,
      publishImageSelection,
      readOnly,
      slide.content,
      slide.id,
    ],
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

  const getSlideDropPosition = useCallback(
    (clientX: number, clientY: number): SlideImageDropPosition | undefined => {
      const slideCanvas =
        slideCanvasRef.current?.querySelector<HTMLElement>(".fmd-slide") ??
        slideCanvasRef.current?.querySelector<HTMLElement>(
          "[data-slide-canvas]",
        );
      if (!slideCanvas) return undefined;
      const rect = slideCanvas.getBoundingClientRect();
      const width = slideCanvas.offsetWidth || rect.width;
      const height = slideCanvas.offsetHeight || rect.height;
      if (!rect.width || !rect.height || !width || !height) return undefined;
      return clientPointToSlideCoordinates(
        clientX,
        clientY,
        rect,
        width,
        height,
      );
    },
    [],
  );

  const handleSlideDragStart = useCallback((event: React.DragEvent) => {
    // Native image dragging is cancelled; selected text being edited drags.
    if (
      event.target instanceof Node &&
      textSessionRef.current?.text.element.contains(event.target)
    ) {
      return;
    }
    event.preventDefault();
  }, []);

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
    if (!hasImage && !types.includes("text/uri-list")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleSlideDrop = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files ?? []);
      const file = files.find(
        (candidate) =>
          imageFileLooksSupported(candidate) ||
          videoFileLooksLikeVideo(candidate),
      );
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        if (!file) return;
        if (textSessionRef.current) exitInlineEditRef.current();
        const position = getSlideDropPosition(e.clientX, e.clientY);
        if (videoFileLooksLikeVideo(file)) {
          onDropVideo?.(file, position);
        } else {
          onDropImage?.(
            getImageReplacementTarget(e.target as HTMLElement),
            file,
            position,
          );
        }
        return;
      }
      // No native file — check for a dragged <img> instead (e.g. one dragged
      // out of the agent chat panel's generated-image preview).
      const url = extractDraggedImageUrl(e.dataTransfer);
      if (!url) {
        const types = Array.from(e.dataTransfer.types ?? []);
        if (types.includes("text/uri-list")) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (textSessionRef.current) exitInlineEditRef.current();
      onDropImageUrl?.(
        getImageReplacementTarget(e.target as HTMLElement),
        url,
        getSlideDropPosition(e.clientX, e.clientY),
      );
    },
    [
      extractDraggedImageUrl,
      getImageReplacementTarget,
      getSlideDropPosition,
      onDropImage,
      onDropVideo,
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
      // The click is a PointerEvent naming the pointer that released. One that
      // names none (a MouseEvent) cannot be told apart, so it ends a hold.
      const { pointerId } = e.nativeEvent as Partial<PointerEvent>;
      const holds = cancelledPressesRef.current;
      const endHold =
        pointerId === undefined
          ? holds.values().next().value
          : holds.get(pointerId);
      if (endHold) {
        endHold();
        return;
      }
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      const commentPress = commentThreadPressRef.current;
      commentThreadPressRef.current = null;
      // Text editing owns clicks in its contenteditable block, including
      // clicks that happen to land on a comment highlight.
      if (editingEl?.contains(e.target as Node)) return;
      if (
        commentPress &&
        onSelectCommentThread &&
        Math.hypot(e.clientX - commentPress.x, e.clientY - commentPress.y) <= 4
      ) {
        e.preventDefault();
        e.stopPropagation();
        onSelectCommentThread(commentPress.threadId);
        return;
      }

      const slideContent = getSlideContent();
      const press = pointerPressRef.current;
      pointerPressRef.current = null;
      if (!slideContent) return;
      const pressedObject =
        press && slideContent.contains(press.object) ? press : null;

      // A drag that started on text selected text natively, possibly into
      // another leaf. The edit belongs to the leaf the press started in.
      if (
        pressedObject?.hit === "text" &&
        pressedObject.textRoot &&
        !readOnly &&
        isHtmlSlide &&
        hasCrossedCanvasDragThreshold(
          { x: pressedObject.x, y: pressedObject.y },
          { x: e.clientX, y: e.clientY },
          SLIDES_CANVAS_DRAG_THRESHOLD,
        )
      ) {
        const selection = window.getSelection();
        if (selection)
          clampSelectionToTextRoot(selection, pressedObject.textRoot);
        if (multiSelection.size > 0) clearMultiSelection();
        setSelectedImg(null);
        setImageOverlay(null);
        const selector = getBuilderSelector(pressedObject.object);
        if (selector) {
          enterSelectionMode("agentNative.enterStyleEditing", { selector });
        }
        enterInlineEdit(pressedObject.textRoot);
        return;
      }
      if (!slideContent.contains(e.target as Node)) return;

      stampBuilderIds(slideContent);
      let hit: {
        object: HTMLElement;
        hit: "text" | "body";
        textRoot: HTMLElement | null;
      } | null = pressedObject;
      // Pressing a selected group moved it whole; releasing is what drills.
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let drilled = false;
      if (!hit || (pressedObject?.groupWasSelected && !additive)) {
        const resolved = resolvePointerTarget(e, slideContent);
        hit = resolved.kind === "object" ? resolved : null;
        drilled = pressedObject !== null && hit !== null;
      }

      // --- Shift / Cmd / Ctrl click → toggle membership in the multi-selection
      if (additive) {
        const id = hit
          ? resolveSelectionOwnerId(hit.object, slideContent)
          : null;
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const next = new Set(multiSelection);
        if (next.size === 0) {
          const selected = resolveSlideClipboardElement(
            resolveSelectedElement(),
            selectedImg,
            slideContent,
          );
          const selectedId = selected
            ? resolveSelectionOwnerId(selected, slideContent)
            : null;
          if (selectedId && selectedId !== id) next.add(selectedId);
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        applyMultiSelection(next);
        return;
      }

      // --- Plain click on whitespace → clear multi-selection (the marquee
      // pointerdown already cleared it for non-additive drags, but a click
      // with zero movement won't trigger pointerup with a real rect).
      if (!hit) {
        clearCanvasSelection();
        return;
      }

      // A press on a member started a whole-selection drag; released without
      // travel it leaves the multi-selection as it was (GS 6.4).
      if (multiSelection.size > 0 && !pressedObject) {
        const memberId = resolveSelectionOwnerId(hit.object, slideContent);
        if (memberId && multiSelection.has(memberId)) return;
      }

      // Plain clicks only select; keep the action menu for intentional
      // double-clicks and discard any menu left by a previous image.
      setSelectedImg(null);
      setImageOverlay(null);

      // --- Plain click on an element → drop multi-selection back to single,
      // then run the existing single-select / style-editing flow.
      if (multiSelection.size > 0) clearMultiSelection();

      const selector = getBuilderSelector(hit.object);
      // Text bounds put the caret where the pointer is, in the whole smart
      // block (a text leaf, or an entire bullet list), so typing, shortcuts,
      // and Enter-to-add-bullet all work, and the style dock targets the same
      // block being edited. Drilling into a group member only selects it.
      // Markdown layouts are rendered by React and have no stored HTML to
      // save an edit into.
      if (
        hit.hit === "text" &&
        hit.textRoot &&
        !drilled &&
        !readOnly &&
        isHtmlSlide &&
        slidesCanvasInteractionCore.textActivation({
          clickCount: 1,
          textEditable: true,
        }) === "edit"
      ) {
        if (selector) {
          enterSelectionMode("agentNative.enterStyleEditing", { selector });
        }
        enterInlineEdit(hit.textRoot, { x: e.clientX, y: e.clientY });
        return;
      }

      if (selector) {
        selectElementForStyling(hit.object, selector);
        enterSelectionMode("agentNative.enterStyleEditing", { selector });
      }
    },
    [
      editingEl,
      getSlideContent,
      multiSelection,
      resolvePointerTarget,
      resolveSelectedElement,
      selectedImg,
      applyMultiSelection,
      clearMultiSelection,
      clearCanvasSelection,
      selectElementForStyling,
      readOnly,
      isHtmlSlide,
      enterInlineEdit,
      onSelectCommentThread,
    ],
  );

  const handleCanvasBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("[data-radix-menu-content]")) return;
      if (target && slideCanvasRef.current?.contains(target)) return;
      clearCanvasSelection();
    },
    [clearCanvasSelection],
  );

  const clearContextMenuState = useCallback(() => {
    contextMenuTargetRef.current = null;
    contextMenuTableCellRef.current = null;
    setContextMenuTableInfo(null);
  }, []);

  const selectContextMenuTarget = useCallback(
    (selectable: HTMLElement) => {
      const slideContent = getSlideContent();
      const ownerId = slideContent
        ? resolveSelectionOwnerId(selectable, slideContent)
        : null;
      const isMultiSelectionTarget = Boolean(
        ownerId && multiSelection.has(ownerId),
      );
      contextMenuTargetRef.current = isMultiSelectionTarget ? null : selectable;
      if (!isMultiSelectionTarget) {
        if (multiSelection.size > 0) clearMultiSelection();
        const selector = getBuilderSelector(selectable);
        if (selector) {
          selectElementForStyling(selectable, selector);
          enterSelectionMode("agentNative.enterStyleEditing", { selector });
        }
      }
    },
    [
      clearMultiSelection,
      getSlideContent,
      multiSelection,
      selectElementForStyling,
    ],
  );

  const handleLayerContextMenu = useCallback(
    (id: string) => {
      const slideContent = getSlideContent();
      const selectable = slideContent?.querySelector<HTMLElement>(
        `[data-builder-id="${id}"]`,
      );
      if (selectable) selectContextMenuTarget(selectable);
    },
    [getSlideContent, selectContextMenuTarget],
  );

  const handleSlideContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const slideContent = getSlideContent();
      if (!slideContent) {
        clearContextMenuState();
        return;
      }

      const tableCell = readOnly ? null : findTableCell(target, slideContent);
      contextMenuTableCellRef.current = tableCell;
      const table = tableCell?.closest("table") ?? null;
      setContextMenuTableInfo(
        table
          ? {
              rowCount: table.rows.length,
              colCount: tableCell
                ? (tableCell.parentElement?.childElementCount ?? 0)
                : 0,
            }
          : null,
      );

      stampBuilderIds(slideContent);
      const hit = resolvePointerTarget(e, slideContent);
      if (hit.kind === "whitespace") {
        contextMenuTargetRef.current = null;
        if (!tableCell) clearCanvasSelection();
        return;
      }

      selectContextMenuTarget(hit.object);
    },
    [
      clearContextMenuState,
      clearCanvasSelection,
      findTableCell,
      getSlideContent,
      readOnly,
      resolvePointerTarget,
      selectContextMenuTarget,
    ],
  );

  const preserveRichTextSelection = useCallback(() => {
    const editing = editingElRef.current;
    const editingSurface = editing ? getRichTextEditorSurface() : null;
    const selection = window.getSelection();
    if (!editing || !selection || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    if (
      editingSurface?.contains(range.startContainer) &&
      editingSurface.contains(range.endContainer)
    ) {
      richTextSelectionRef.current = snapshotEditableTextRange(
        editingSurface,
        selection,
      );
    }
  }, [getRichTextEditorSurface]);

  const applySelectedStylePatch = useCallback(
    (patch: SlideStylePatch) => {
      if (multiSelection.size > 0) {
        const targets = getStyleTargets();
        const currentSnapshot = mergeSlideStyleSnapshots(
          targets.map(styleSnapshotForElement),
        );
        if (!currentSnapshot) return;

        const originalTransforms =
          patch.rotation === undefined
            ? null
            : new Map(
                targets.map((target) => [
                  target,
                  [
                    target.style.getPropertyValue("transform"),
                    target.style.getPropertyPriority("transform"),
                  ] as const,
                ]),
              );
        let rotationApplied = true;
        for (const target of targets) {
          const result = applyStylePatchToElement(target, patch);
          rotationApplied &&= result.rotationApplied;
        }
        if (patch.rotation !== undefined) {
          rotationApplied &&= targets.every((target) =>
            slideObjectPaintsRotation(target, patch.rotation!),
          );
          if (!rotationApplied && originalTransforms) {
            restoreSlideObjectTransformSnapshots(
              [...originalTransforms].map(([element, [value, priority]]) => ({
                element,
                value,
                priority,
              })),
            );
          }
        }
        const html = readCurrentSlideContentHtml();
        if (html !== null) {
          preserveMultiSelectionForUpdate(targets);
          onUpdateSlideRef.current({ content: html });
        }
        invalidateSelectionOverlayMeasurement();
        setSelectedStyleSnapshot(
          mergeSlideStyleSnapshots(targets.map(styleSnapshotForElement)),
        );
        return rotationApplied;
      }

      const editing = editingElRef.current;
      const element = editing ?? resolveSelectedElement();
      // Inline edits entered without selectElementForStyling (the text-box
      // tool) leave selectedElementSelector null, so fall back the same way the
      // snapshot readers do rather than dropping the write.
      const selector =
        selectedElementSelector ??
        (editing ? getBuilderSelector(editing) : null);
      if (!element || !selector) return;

      const savedRange =
        richTextSelectionRef.current ??
        (editing
          ? snapshotEditableTextRange(getRichTextEditorSurface() ?? editing)
          : null);
      const result = applyStylePatchToElement(element, patch, savedRange);
      const nextRange = result.styledRange;
      if (editing && nextRange) {
        richTextSelectionRef.current = nextRange.cloneRange();
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
            getRichTextEditorSurface() ?? editing,
            richTextSelectionRef.current,
          )
        : undefined;
      const snapshot = buildStyleSnapshot(element, selector, inlineTextStyle);
      if (!editing) {
        invalidateSelectionOverlayMeasurement();
      }
      setSelectedStyleSnapshot(snapshot);
      if (!editing) {
        syncSelectionToAppState(
          buildSelectionState(getSlideSelectionMode(snapshot), [
            selectionItemForElement(element, selector, snapshot),
          ]),
        );
      }
      // A rotation the object cannot be made to paint is refused, and the
      // field that asked for it has to show what the object paints.
      return (
        patch.rotation === undefined ||
        (result.rotationApplied &&
          slideObjectPaintsRotation(element, patch.rotation))
      );
    },
    [
      buildSelectionState,
      applyStylePatchToElement,
      captureInlineEditDraft,
      getRichTextEditorSurface,
      getStyleTargets,
      invalidateSelectionOverlayMeasurement,
      multiSelection.size,
      preserveMultiSelectionForUpdate,
      readCurrentSlideContentHtml,
      resolveSelectedElement,
      selectedElementSelector,
      slide.id,
      styleSnapshotForElement,
    ],
  );

  /** Arrange one layer or a multi-selection without changing layout order. */
  const handleArrangeSelected = useCallback(
    (target: SlideObjectZOrderTarget) => {
      const contextMenuTarget = contextMenuTargetRef.current;
      const liveContextMenuTarget =
        contextMenuTarget && containerRef.current?.contains(contextMenuTarget)
          ? contextMenuTarget
          : null;
      const selection = getObjectOperationSelection();

      if (
        !liveContextMenuTarget &&
        multiSelection.size > 1 &&
        selection &&
        selection.elements.length === multiSelection.size
      ) {
        const changes = computeSlideObjectZOrderForSelection(
          selection.elements,
          selection.containingBlock,
          target,
        );
        if (!changes) return false;
        for (const [element, value] of changes) {
          element.style.zIndex = String(value);
        }
        pendingMultiSelectionResyncRef.current = {
          objectIds: selection.elements.map((element) =>
            element.getAttribute("data-slide-object-id"),
          ),
          paths: [],
        };
        refreshMultiSelectionRects(multiSelection);
        const html = readCurrentSlideContentHtml();
        if (html !== null) {
          onUpdateSlideRef.current({ content: html }, undefined, {
            persistence: "immediate",
          });
        }
        return true;
      }

      const element =
        liveContextMenuTarget ??
        selection?.elements[0] ??
        resolveSelectedElement();
      if (!element) return false;
      if (isSlideTableStructureElement(element)) return false;
      const selector = getBuilderSelector(element);
      if (!selector) return false;

      if (isPersistedFreeformObject(element)) {
        const positioningLayer = resolveSlidePositioningLayer(element);
        if (!positioningLayer) return false;
        const containingBlock = resolveSlideObjectContainingBlock(
          element,
          positioningLayer,
        );
        const change = computeSlideObjectZOrder(
          element,
          containingBlock,
          target,
        );
        if (!change) return false;
        element.style.zIndex = String(change.value);
        for (const shift of change.shiftPeers) {
          shift.element.style.zIndex = String(shift.value);
        }
      } else if (!arrangeSlideLayerInParent(element, target)) {
        return false;
      }

      selectElementForStyling(element, selector);
      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
      return true;
    },
    [
      getObjectOperationSelection,
      multiSelection,
      readCurrentSlideContentHtml,
      refreshMultiSelectionRects,
      resolveSelectedElement,
      selectElementForStyling,
    ],
  );

  useEffect(() => {
    if (readOnly) return;

    const onKey = (e: KeyboardEvent) => {
      const primary = e.metaKey || e.ctrlKey;
      const active = document.activeElement;
      if (
        isSlideTextEditingTarget(e.target, active, editingEl) ||
        active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        active?.tagName === "SELECT" ||
        (active instanceof HTMLElement && active.isContentEditable) ||
        Boolean(
          active?.closest(
            "[data-slide-thumbnail-id], [data-slide-context-toolbar], [data-radix-popper-content-wrapper], [role='dialog']",
          ),
        )
      ) {
        return;
      }

      const handleCommand = (handled: boolean) => {
        if (!handled) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      if (!isSlideCanvasShortcutTarget(active, slideCanvasRef.current)) return;

      if (primary && e.altKey && e.key.toLowerCase() === "g") {
        handleCommand(
          e.shiftKey ? handleUngroupSelected() : handleGroupSelected(),
        );
        return;
      }

      if (
        primary &&
        !e.altKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        handleCommand(
          handleArrangeSelected(
            e.shiftKey
              ? e.key === "ArrowUp"
                ? "front"
                : "back"
              : e.key === "ArrowUp"
                ? "forward"
                : "backward",
          ),
        );
        return;
      }

      const rotation = resolveSlidesCanvasRotation(e);
      if (rotation !== null) {
        handleCommand(rotateSelectedObjects(rotation));
        return;
      }

      if (primary && !e.altKey && e.key.toLowerCase() === "a") {
        const slideContent = getSlideContent();
        if (!slideContent) return;
        stampBuilderIds(slideContent);
        const elements = sortSlideLayerElements(
          getSlideCanvasTraversalRoots(slideContent),
        );
        if (elements.length === 0) return;
        const ids = new Set(
          elements
            .map((element) => element.getAttribute("data-builder-id"))
            .filter((id): id is string => Boolean(id)),
        );
        if (ids.size === 1) {
          clearMultiSelection();
          const element = elements[0];
          const selector = element && getBuilderSelector(element);
          if (element && selector) selectElementForStyling(element, selector);
        } else {
          applyMultiSelection(ids);
        }
        handleCommand(ids.size > 0);
        return;
      }

      if (!primary && !e.altKey && e.key === "Tab") {
        const slideContent = getSlideContent();
        if (!slideContent) return;
        stampBuilderIds(slideContent);
        const elements = sortSlideLayerElements(
          getSlideCanvasTraversalRoots(slideContent),
        );
        if (elements.length === 0) return;
        const selected = resolveSlideClipboardElement(
          resolveSelectedElement(),
          selectedImg,
          slideContent,
        );
        const currentIndex = selected ? elements.indexOf(selected) : -1;
        const nextIndex =
          currentIndex < 0
            ? e.shiftKey
              ? elements.length - 1
              : 0
            : (currentIndex + (e.shiftKey ? -1 : 1) + elements.length) %
              elements.length;
        const next = elements[nextIndex];
        const selector = next && getBuilderSelector(next);
        if (!next || !selector) return;
        if (multiSelection.size > 0) clearMultiSelection();
        setSelectedImg(null);
        setImageOverlay(null);
        selectElementForStyling(next, selector);
        enterSelectionMode("agentNative.enterStyleEditing", { selector });
        handleCommand(true);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    applyMultiSelection,
    clearMultiSelection,
    editingEl,
    getSlideContent,
    handleArrangeSelected,
    handleGroupSelected,
    handleUngroupSelected,
    multiSelection.size,
    readOnly,
    resolveSelectedElement,
    rotateSelectedObjects,
    selectedImg,
    selectElementForStyling,
  ]);

  /** Bullet / numbered list toggle for the selected text object. */
  const handleToggleList = useCallback(
    (kind: SlideListKind) => {
      if (multiSelection.size > 0) {
        const targets = getStyleTargets();
        if (
          targets.length === 0 ||
          targets.some((target) => !styleSnapshotForElement(target).isText)
        ) {
          return;
        }
        let changed = false;
        const listTargets = new Set<HTMLElement>();
        for (const target of targets) {
          const parentList =
            target.tagName === "LI" ? target.closest("ul, ol") : null;
          listTargets.add((parentList as HTMLElement | null) ?? target);
        }
        for (const target of listTargets) {
          changed = Boolean(toggleSlideList(target, kind)) || changed;
        }
        if (!changed) return;

        const html = readCurrentSlideContentHtml();
        if (html !== null) {
          preserveMultiSelectionForUpdate(targets);
          onUpdateSlideRef.current({ content: html });
        }
        invalidateSelectionOverlayMeasurement();
        setSelectedStyleSnapshot(
          mergeSlideStyleSnapshots(
            getStyleTargets().map(styleSnapshotForElement),
          ),
        );
        return;
      }

      const session = textSessionRef.current?.text;
      if (session) {
        restoreEditableTextRange(session.element, richTextSelectionRef.current);
        if (!session.commands.toggleList(kind)) return;
        const activeEditing = session.element;
        captureInlineEditDraft(slide.id);
        const selector =
          selectedElementSelector ?? getBuilderSelector(activeEditing);
        if (selector) {
          setSelectedStyleSnapshot(
            buildStyleSnapshot(
              activeEditing,
              selector,
              getInlineTextStyleSnapshotForRange(
                getRichTextEditorSurface() ?? activeEditing,
                richTextSelectionRef.current,
              ),
            ),
          );
        }
        return;
      }

      const target = resolveSelectedElement();
      if (!target) return;
      // Editing one item still means "this list". Converting the LI itself
      // would build a second list inside it instead of toggling the one it
      // already belongs to.
      const parentList =
        target.tagName === "LI" ? target.closest("ul, ol") : null;
      const element = (parentList as HTMLElement | null) ?? target;

      const converted = toggleSlideList(element, kind);
      if (!converted) return;

      const html = readCurrentSlideContentHtml();
      if (html !== null) onUpdateSlideRef.current({ content: html });
      const selector = getBuilderSelector(converted);
      if (selector) selectElementForStyling(converted, selector);
    },
    [
      captureInlineEditDraft,
      getRichTextEditorSurface,
      getStyleTargets,
      invalidateSelectionOverlayMeasurement,
      multiSelection.size,
      preserveMultiSelectionForUpdate,
      readCurrentSlideContentHtml,
      resolveSelectedElement,
      selectedElementSelector,
      selectElementForStyling,
      slide.id,
      styleSnapshotForElement,
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
    sendEditorPromptToAgent({
      message: "Apply the pending visual updates", // i18n-ignore agent prompt, not UI copy
      submit: true,
    });
  }, []);

  const handleSlideDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      // Viewers see the slide but can't enter edit mode — matches Google
      // Slides' viewer experience.
      if (readOnly || imageCropRef.current) return;

      const target = e.target as HTMLElement;
      const slideContent = containerRef.current?.querySelector(
        ".slide-content",
      ) as HTMLElement | null;
      if (slideContent) stampBuilderIds(slideContent);
      const resolved = slideContent
        ? resolvePointerTarget(e, slideContent, { intoGroups: true })
        : null;
      const hit = resolved?.kind === "object" ? resolved : null;
      const imageOwner =
        slideContent && hit
          ? findPersistedImageObject(hit.object, slideContent)
          : null;
      const imageTarget = target.closest("[data-slide-group-move-handle]")
        ? selectedImageForCropRef.current
        : hit?.object.tagName === "IMG"
          ? hit.object
          : imageOwner?.querySelector<HTMLElement>("img");
      const imagePlaceholder =
        hit?.object.closest<HTMLElement>(".fmd-img-placeholder") ?? null;

      if (imageTarget && isHtmlSlide) {
        e.preventDefault();
        e.stopPropagation();
        startImageCrop(imageTarget as HTMLImageElement);
        return;
      }

      if (imagePlaceholder) {
        e.preventDefault();
        e.stopPropagation();
        showImageOverlay(imagePlaceholder);
        return;
      }

      // Per-block inline editing only works for HTML-backed slides
      // (fmd-slide / raw HTML layouts). Markdown-rendered slides would
      // round-trip through React reconciliation and lose content.
      if (!isHtmlSlide) return;

      // An object with no text leaf (a group, a shape without text) has
      // nothing for a double-click to edit.
      if (!slideContent || !hit?.textRoot) return;
      // The browser owns word selection inside the live editing block.
      if (editingElRef.current?.contains(hit.textRoot)) return;
      // The browser owns word selection inside the live editing block.

      e.preventDefault();
      e.stopPropagation();
      if (hit.hit === "text") {
        enterInlineEdit(hit.textRoot, { x: e.clientX, y: e.clientY }, true);
        return;
      }
      // Padding or blank interior of a text object: caret at the start.
      const start = document.createRange();
      start.selectNodeContents(hit.textRoot);
      start.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(start);
      enterInlineEdit(hit.textRoot);
    },
    [
      startImageCrop,
      showImageOverlay,
      enterInlineEdit,
      isHtmlSlide,
      readOnly,
      resolvePointerTarget,
    ],
  );

  const slideElementSelected =
    !!selectedImg ||
    !!editingEl ||
    !!selectedElementSelector ||
    !!selectedStyleSnapshot ||
    multiSelection.size > 0;

  // Flow objects are promoted for the resize gesture and restored when a
  // press does not become a resize.
  const selectedForDrag = selectedElementRect ? resolveSelectedElement() : null;
  const selectedImageForCrop = selectedForDrag?.matches("img")
    ? (selectedForDrag as HTMLImageElement)
    : selectedForDrag &&
        (selectedForDrag.classList.contains("fmd-pptx-image") ||
          selectedForDrag.getAttribute("data-pptx-element-kind") === "image")
      ? selectedForDrag.querySelector<HTMLImageElement>("img")
      : null;
  const slideContentForImageCrop = getSlideContent();
  selectedImageForCropRef.current =
    selectedImageForCrop ??
    (selectedImg instanceof HTMLImageElement &&
    slideContentForImageCrop?.contains(selectedImg)
      ? selectedImg
      : null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (readOnly || !isHtmlSlide) {
        lastImageClickRef.current = null;
        pendingImageDoubleClickRef.current = null;
        return;
      }
      if (event.button !== 0) {
        lastImageClickRef.current = null;
        pendingImageDoubleClickRef.current = null;
        return;
      }
      const slideContent = getSlideContent();
      const image =
        target.tagName === "IMG" && slideContent?.contains(target)
          ? (target as HTMLImageElement)
          : target.closest("[data-slide-group-move-handle]")
            ? selectedImageForCropRef.current
            : null;
      if (!image) {
        lastImageClickRef.current = null;
        pendingImageDoubleClickRef.current = null;
        return;
      }
      const lastImageClick = lastImageClickRef.current;
      const timestamp = Date.now();
      const isDoubleClick = Boolean(
        lastImageClick?.image === image &&
        timestamp - lastImageClick.timestamp <= 500 &&
        Math.hypot(
          event.clientX - lastImageClick.clientX,
          event.clientY - lastImageClick.clientY,
        ) <= 5,
      );
      pendingImageDoubleClickRef.current = {
        image,
        pointerId: event.pointerId,
        timestamp,
        clientX: event.clientX,
        clientY: event.clientY,
        isDoubleClick,
      };
      lastImageClickRef.current = null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const pending = pendingImageDoubleClickRef.current;
      if (
        !pending ||
        pending.pointerId !== event.pointerId ||
        !hasCrossedCanvasDragThreshold(
          { x: pending.clientX, y: pending.clientY },
          { x: event.clientX, y: event.clientY },
        )
      ) {
        return;
      }
      pendingImageDoubleClickRef.current = null;
      lastImageClickRef.current = null;
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (pendingImageDoubleClickRef.current?.pointerId === event.pointerId) {
        pendingImageDoubleClickRef.current = null;
        lastImageClickRef.current = null;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const pending = pendingImageDoubleClickRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      pendingImageDoubleClickRef.current = null;
      if (
        Math.hypot(
          event.clientX - pending.clientX,
          event.clientY - pending.clientY,
        ) > 5
      ) {
        lastImageClickRef.current = null;
        return;
      }
      if (pending.isDoubleClick) {
        lastImageClickRef.current = null;
        requestAnimationFrame(() => {
          if (!imageCropRef.current) startImageCrop(pending.image);
        });
        return;
      }
      lastImageClickRef.current = {
        image: pending.image,
        timestamp: pending.timestamp,
        clientX: pending.clientX,
        clientY: pending.clientY,
      };
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("pointerup", onPointerUp, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [getSlideContent, isHtmlSlide, readOnly, startImageCrop]);
  const isSelectedElementDraggable = selectedForDrag
    ? !isSlideCanvasShell(selectedForDrag)
    : false;
  // A selected shape's body is handled by the canvas press, which keeps the
  // second click for text editing; the outline's body mover would swallow it.
  const selectionRoot = selectedForDrag ? getSlideContent() : null;
  const selectedIsShape = Boolean(
    selectedForDrag &&
    selectionRoot &&
    findSlideShapeOwner(selectedForDrag, selectionRoot) === selectedForDrag,
  );
  const selectedIsTableStructure = Boolean(
    selectedForDrag && isSlideTableStructureElement(selectedForDrag),
  );
  const objectOperationSelection = getObjectOperationSelection();
  const hasClipboardSelection = getClipboardSelection() !== null;
  const objectSelectionCount = objectOperationSelection?.elements.length ?? 0;
  const canGroupObjects = objectSelectionCount >= 2;
  const canUngroupObjects = Boolean(
    objectSelectionCount === 1 &&
    objectOperationSelection?.elements[0] &&
    isSlideObjectGroup(objectOperationSelection.elements[0]),
  );
  const selectedLayerIds = new Set(multiSelection);
  if (selectedLayerIds.size === 0) {
    const slideContent = getSlideContent();
    const selected =
      resolveSelectedElement() ??
      (selectedImg && slideContent
        ? (findPersistedImageObject(selectedImg, slideContent) ?? selectedImg)
        : selectedImg);
    const selectedId = selected?.getAttribute("data-builder-id");
    if (selectedId) selectedLayerIds.add(selectedId);
  }
  const multiSelectionBounds = unionDomRects(
    Array.from(multiSelectionRects.values()).map((value) => value.rect),
  );
  const canZoomOut = canvasZoom > MIN_CANVAS_ZOOM;
  const canZoomIn =
    canvasZoom < CANVAS_ZOOM_PRESETS[CANVAS_ZOOM_PRESETS.length - 1];
  const zoomControls = slide.excalidrawData
    ? undefined
    : {
        value: canvasZoom,
        onZoomOut: canvasZoomOut,
        onZoomIn: canvasZoomIn,
        canZoomOut,
        canZoomIn,
      };

  const contextImageTarget = (() => {
    const target = contextMenuTargetRef.current;
    return target?.matches("img")
      ? (target as HTMLImageElement)
      : (target?.querySelector<HTMLImageElement>("img") ?? null);
  })();

  const slideElementContextMenuContent = (
    <>
      {contextImageTarget && (
        <>
          <ContextMenuItem
            onSelect={() => showImageOverlay(contextImageTarget)}
          >
            {t("editorToolbar.imageOptions")}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        disabled={!hasClipboardSelection}
        onSelect={cutSelectedObjects}
      >
        {t("editorSidebar.cut")}
        <ContextMenuShortcut>{shortcutLabel("cmd+x")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasClipboardSelection}
        onSelect={copySelectedObjects}
      >
        {t("styleInspector.copy")}
        <ContextMenuShortcut>{shortcutLabel("cmd+c")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasCopiedObject}
        onSelect={pasteSelectedObjects}
      >
        {t("styleInspector.paste")}
        <ContextMenuShortcut>{shortcutLabel("cmd+v")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasClipboardSelection}
        onSelect={duplicateSelectedObjects}
      >
        {t("editorSidebar.duplicate")}
        <ContextMenuShortcut>{shortcutLabel("cmd+d")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasClipboardSelection}
        onSelect={() => deleteSelectedElements()}
      >
        {t("editorSidebar.delete")}
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={getStyleTargets().length === 0}
        onSelect={copySelectedElementStyle}
      >
        {t("styleInspector.copyStyle")}
        <ContextMenuShortcut>{shortcutLabel("cmd+alt+c")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasCopiedElementStyle || getStyleTargets().length === 0}
        onSelect={pasteCopiedElementStyle}
      >
        {t("styleInspector.pasteStyle")}
        <ContextMenuShortcut>{shortcutLabel("cmd+alt+v")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger
          disabled={!selectedElementSelector && !objectOperationSelection}
        >
          {t("styleInspector.order")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="z-[2147483647]">
          <ContextMenuItem
            disabled={!selectedElementSelector && !objectOperationSelection}
            onSelect={() => handleArrangeSelected("front")}
          >
            {t("styleInspector.bringToFront")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selectedElementSelector && !objectOperationSelection}
            onSelect={() => handleArrangeSelected("forward")}
          >
            {t("styleInspector.bringForward")}
            <ContextMenuShortcut>{shortcutLabel("cmd+up")}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selectedElementSelector && !objectOperationSelection}
            onSelect={() => handleArrangeSelected("backward")}
          >
            {t("styleInspector.sendBackward")}
            <ContextMenuShortcut>
              {shortcutLabel("cmd+down")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selectedElementSelector && !objectOperationSelection}
            onSelect={() => handleArrangeSelected("back")}
          >
            {t("styleInspector.sendToBack")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!canGroupObjects}
        onSelect={handleGroupSelected}
      >
        {t("styleInspector.group")}
        <ContextMenuShortcut>{shortcutLabel("cmd+alt+g")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!canUngroupObjects}
        onSelect={handleUngroupSelected}
      >
        {t("styleInspector.ungroup")}
        <ContextMenuShortcut>
          {shortcutLabel("cmd+alt+shift+g")}
        </ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );

  // Excalidraw slides have no selectable slide content, so the row collapses
  // to its slide-level state — but that state owns the background picker, and
  // SlideRenderer paints `slide.background` behind the drawing, so the row has
  // to stay mounted or that background becomes uneditable. The widget has no
  // toolbar row, so it never mounts these.
  const showContextToolbars = !readOnly && !widgetEmbed;
  const contextToolbar = showContextToolbars ? (
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
        hasSelectedElement={slideElementSelected}
        animationsOpen={animationsOpen}
        canComment={canComment}
        onComment={commentOnSelectedElement}
        onOpenAnimations={
          onOpenAnimations
            ? () => {
                const target = getSelectedAnimationTarget();
                if (target) onOpenAnimations(target);
              }
            : undefined
        }
        onChange={applySelectedStylePatch}
        onEnablePositioning={enableSelectedObjectPositioning}
        onBackgroundChange={applySlideBackground}
        onArrange={handleArrangeSelected}
        onGroup={handleGroupSelected}
        onUngroup={handleUngroupSelected}
        onToggleList={handleToggleList}
        objectSelectionCount={objectSelectionCount}
        canGroup={canGroupObjects}
        canUngroup={canUngroupObjects}
        onAlignObjects={handleAlignSelectedObjects}
        onDistributeObjects={handleDistributeSelectedObjects}
        videoPlayback={selectedVideoPlayback}
        onVideoPlaybackChange={updateSelectedVideoPlayback}
        zoomControls={zoomControls}
      />
    </div>
  ) : null;

  const wideContextToolbar = showContextToolbars ? (
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
        hasSelectedElement={slideElementSelected}
        animationsOpen={animationsOpen}
        canComment={canComment}
        onComment={commentOnSelectedElement}
        onOpenAnimations={
          onOpenAnimations
            ? () => {
                const target = getSelectedAnimationTarget();
                if (target) onOpenAnimations(target);
              }
            : undefined
        }
        onChange={applySelectedStylePatch}
        onEnablePositioning={enableSelectedObjectPositioning}
        onBackgroundChange={applySlideBackground}
        onArrange={handleArrangeSelected}
        onGroup={handleGroupSelected}
        onUngroup={handleUngroupSelected}
        onToggleList={handleToggleList}
        objectSelectionCount={objectSelectionCount}
        canGroup={canGroupObjects}
        canUngroup={canUngroupObjects}
        onAlignObjects={handleAlignSelectedObjects}
        onDistributeObjects={handleDistributeSelectedObjects}
        videoPlayback={selectedVideoPlayback}
        onVideoPlaybackChange={updateSelectedVideoPlayback}
        zoomControls={zoomControls}
        className="slide-context-toolbar--top-row"
      />
    </div>
  ) : null;

  const layersPanel = layersOpen ? (
    <SlidesLayersPanel
      layers={layerNodes}
      selectedIds={selectedLayerIds}
      onHoverLayer={setHoveredLayerId}
      onLeaveLayer={(id) =>
        setHoveredLayerId((current) => (current === id ? null : current))
      }
      contextMenuContent={readOnly ? undefined : slideElementContextMenuContent}
      onContextMenuLayer={readOnly ? undefined : handleLayerContextMenu}
      onContextMenuClose={clearContextMenuState}
      onSelectLayer={selectLayerFromPanel}
      onMoveLayer={moveLayerFromPanel}
      onClose={onCloseLayers ?? (() => {})}
      labels={{
        title: t("editorToolbar.layers"),
        close: t("editorToolbar.closeLayers"),
        expand: t("editorToolbar.expandLayer"),
        collapse: t("editorToolbar.collapseLayer"),
      }}
    />
  ) : null;

  return (
    <div
      className={`relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--slides-editor-surface)] ${
        widgetEmbed ? "" : "rounded-l-lg"
      } ${animationsOpen || layersOpen ? "rounded-r-lg" : ""}`}
      data-slide-element-selected={slideElementSelected ? "true" : undefined}
    >
      {!readOnly && wideContextToolbarSlot
        ? createPortal(wideContextToolbar, wideContextToolbarSlot)
        : null}
      {contextToolbarSlot
        ? createPortal(contextToolbar, contextToolbarSlot)
        : contextToolbar}

      <div
        ref={contentReplaceBoundaryRef}
        className="flex min-h-0 flex-1 overflow-hidden"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="min-w-0 flex-1 overflow-hidden">
          {slide.excalidrawData ? (
            <div
              data-main-slide-canvas="true"
              data-slide-canvas-focus="true"
              tabIndex={0}
              className="relative h-full bg-[var(--slides-editor-surface)] outline-none"
              onPointerDownCapture={(event) => {
                event.currentTarget.focus({ preventScroll: true });
              }}
            >
              <div className="slide-content relative h-full">
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
            </div>
          ) : (
            <div className="relative h-full bg-[var(--slides-editor-surface)]">
              <div
                ref={scrollContainerRef}
                className={`h-full overflow-auto ${
                  drawMode ? "pb-24 sm:pb-28" : ""
                }`}
              >
                <div
                  ref={canvasTrackRef}
                  className={`flex min-h-full w-max min-w-full justify-center ${
                    widgetEmbed
                      ? "flex-col items-center"
                      : "items-center p-2 pt-14 sm:p-4 sm:pt-14 md:p-8 md:pt-16"
                  }`}
                  onPointerDown={handleCanvasBackgroundPointerDown}
                >
                  <div
                    ref={containerRef}
                    data-main-slide-canvas="true"
                    className="shrink-0"
                    onClickCapture={
                      readOnly ? undefined : preventSlideLinkNavigation
                    }
                    onAuxClickCapture={
                      readOnly ? undefined : preventSlideLinkNavigation
                    }
                    style={{ width: canvasWidth, maxWidth: canvasWidth }}
                  >
                    <ContextMenu>
                      <ContextMenuTrigger asChild disabled={readOnly}>
                        <div
                          ref={slideCanvasRef}
                          className={`slide-image-clickable relative outline-none ${
                            pinMode || textBoxMode || shapeType
                              ? "cursor-crosshair"
                              : ""
                          }`}
                          data-slide-canvas-focus="true"
                          tabIndex={0}
                          data-editable={!readOnly ? "true" : undefined}
                          onClick={handleSlideClick}
                          onContextMenu={handleSlideContextMenu}
                          onDoubleClick={handleSlideDoubleClick}
                          onPointerDown={handleSlidePointerDown}
                          onPointerMove={handleSlidePointerMove}
                          onPointerUp={handleSlidePointerUp}
                          onPointerCancel={handleSlidePointerCancel}
                          onPointerLeave={clearCanvasHover}
                          onDragStart={handleSlideDragStart}
                          onDragOver={handleSlideDragOver}
                          onDrop={handleSlideDrop}
                        >
                          <SlideRenderer
                            slide={slide}
                            slidePosition={slidePosition}
                            className={
                              widgetEmbed
                                ? "rounded-none!"
                                : "shadow-2xl shadow-black/40"
                            }
                            designSystem={designSystem}
                            aspectRatio={aspectRatio}
                            onOverflowChange={handleOverflowChange}
                            onAutofitSettled={handleAutofitSettled}
                            stampSource
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
                          {passivePresentUsers.length > 0 && (
                            <div className="absolute right-2 top-2 z-10">
                              <SameSlidePresenceIndicator
                                users={passivePresentUsers}
                              />
                            </div>
                          )}
                          {layoutOverflowWarningEnabled &&
                            overflowInfo &&
                            !readOnly &&
                            !agentActive &&
                            warningVisible && (
                              <SlideOverflowWarning
                                verticalOverflow={overflowInfo.verticalOverflow}
                                horizontalOverflow={
                                  overflowInfo.horizontalOverflow
                                }
                                warningLabel={t(
                                  "deckEditor.layoutOverflowWarning",
                                )}
                                overflowDetails={[
                                  overflowInfo.verticalOverflow > 0
                                    ? t("deckEditor.layoutOverflowVertical", {
                                        pixels: overflowInfo.verticalOverflow,
                                      })
                                    : null,
                                  overflowInfo.horizontalOverflow > 0
                                    ? t("deckEditor.layoutOverflowHorizontal", {
                                        pixels: overflowInfo.horizontalOverflow,
                                      })
                                    : null,
                                ]
                                  .filter((detail): detail is string =>
                                    Boolean(detail),
                                  )
                                  .join(" · ")}
                                overflowDetailsLabel={t(
                                  "deckEditor.layoutOverflowDetails",
                                )}
                                isAskingAgentToFix={isAskingAgentToFix}
                                dismissLabel={t(
                                  "deckEditor.dismissLayoutWarning",
                                )}
                                onFix={handleAskAgentToFixLayout}
                                onDismiss={dismissWarning}
                              />
                            )}
                        </div>
                      </ContextMenuTrigger>
                      {/* Imported slide objects can carry authored z-indexes; keep this menu above the canvas. */}
                      <ContextMenuContent
                        className="z-[2147483647]"
                        onCloseAutoFocus={clearContextMenuState}
                      >
                        {contextMenuTableInfo && (
                          <>
                            <ContextMenuItem
                              onSelect={() => {
                                const cell = contextMenuTableCellRef.current;
                                if (cell) insertTableRow(cell, "above");
                              }}
                            >
                              {t("styleInspector.insertRowAbove")}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => {
                                const cell = contextMenuTableCellRef.current;
                                if (cell) insertTableRow(cell, "below");
                              }}
                            >
                              {t("styleInspector.insertRowBelow")}
                            </ContextMenuItem>
                            <ContextMenuItem
                              disabled={contextMenuTableInfo.rowCount <= 1}
                              onSelect={() => {
                                const cell = contextMenuTableCellRef.current;
                                if (cell) deleteTableRow(cell);
                              }}
                            >
                              {t("styleInspector.deleteRow")}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onSelect={() => {
                                const cell = contextMenuTableCellRef.current;
                                if (cell) insertTableColumn(cell, "left");
                              }}
                            >
                              {t("styleInspector.insertColumnLeft")}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => {
                                const cell = contextMenuTableCellRef.current;
                                if (cell) insertTableColumn(cell, "right");
                              }}
                            >
                              {t("styleInspector.insertColumnRight")}
                            </ContextMenuItem>
                            <ContextMenuItem
                              disabled={contextMenuTableInfo.colCount <= 1}
                              onSelect={() => {
                                const cell = contextMenuTableCellRef.current;
                                if (cell) deleteTableColumn(cell);
                              }}
                            >
                              {t("styleInspector.deleteColumn")}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                          </>
                        )}
                        {slideElementContextMenuContent}
                      </ContextMenuContent>
                    </ContextMenu>
                  </div>
                  {widgetEmbed && deckSlides && onSelectFollowingSlide ? (
                    <FollowingSlideStack
                      slides={deckSlides}
                      afterSlideId={slide.id}
                      width={canvasWidth}
                      aspectRatio={aspectRatio}
                      designSystem={designSystem}
                      onSelect={onSelectFollowingSlide}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
        {layersPanel
          ? layersPanelSlot
            ? createPortal(layersPanel, layersPanelSlot)
            : layersPanel
          : null}
      </div>

      {!widgetEmbed && (
        <SpeakerNotesPanel
          notes={slide.notes}
          onChange={(notes) => onUpdateSlide({ notes })}
          readOnly={readOnly}
        />
      )}

      {!imageCrop && selectionRect && !selectedElementSelector && (
        <ImageSelectionOutline
          rect={selectionRect}
          viewportRect={selectionViewportRect}
        />
      )}
      {hoveredLayerMeasurement &&
      !selectedLayerIds.has(hoveredLayerMeasurement.id) ? (
        <ElementHoverOutline
          rect={hoveredLayerMeasurement.rect}
          frame={hoveredLayerMeasurement.frame}
          viewportRect={selectionViewportRect}
        />
      ) : (
        canvasHover &&
        !editingEl && (
          <ElementHoverOutline
            rect={canvasHover.rect}
            frame={canvasHover.frame}
            viewportRect={selectionViewportRect}
          />
        )
      )}
      {!imageCrop &&
        selectedElementRect &&
        selectedContainer &&
        !multiSelectionBounds &&
        (selectedContainer.group ? (
          <ElementSelectionOutline
            parent
            rect={selectedContainer.rect}
            frame={selectedContainer.frame}
            viewportRect={selectionViewportRect}
          />
        ) : (
          <ElementHoverOutline
            container
            rect={selectedContainer.rect}
            frame={selectedContainer.frame}
            viewportRect={selectionViewportRect}
          />
        ))}
      {!imageCrop && selectedElementRect && !multiSelectionBounds && (
        <ElementSelectionOutline
          rect={selectedElementRect}
          frame={selectedElementFrame}
          viewportRect={selectionViewportRect}
          allowBodyMove={Boolean(
            selectedForDrag &&
            !isRichTextBlock(selectedForDrag) &&
            !selectedIsShape &&
            !isSlideObjectGroup(selectedForDrag),
          )}
          onMoveStart={
            !readOnly && isSelectedElementDraggable && selectedForDrag
              ? (e) => startElementDrag(e, selectedForDrag)
              : undefined
          }
          resizable={!selectedIsTableStructure}
          onResizeStart={
            !readOnly && isSelectedElementDraggable && selectedElementFrame
              ? startElementResize
              : undefined
          }
          onRotateStart={
            !readOnly && selectedElementFrame && !selectedIsTableStructure
              ? (e) => startRotateSelection(e, selectedElementRect)
              : undefined
          }
        />
      )}

      {multiSelectionBounds && multiSelection.size > 0 && (
        <ElementSelectionOutline
          rect={multiSelectionBounds}
          viewportRect={selectionViewportRect}
          allowBodyMove={false}
          onResizeStart={
            !readOnly && objectOperationSelection ? startGroupResize : undefined
          }
          onMoveStart={
            !readOnly ? (e) => startGroupDrag(e, multiSelection) : undefined
          }
          onRotateStart={
            !readOnly && objectOperationSelection
              ? (e) => startRotateSelection(e, multiSelectionBounds)
              : undefined
          }
        />
      )}

      {/* Active marquee rectangle */}
      {marquee && (marquee.w > 1 || marquee.h > 1) && (
        <MarqueeRect rect={marquee} viewportRect={selectionViewportRect} />
      )}
      {placementRect && (placementRect.w > 1 || placementRect.h > 1) && (
        <MarqueeRect
          rect={placementRect}
          viewportRect={selectionViewportRect}
        />
      )}

      {activeAlignmentGuides && (
        <AlignmentGuides
          guides={activeAlignmentGuides.guides}
          viewport={activeAlignmentGuides.viewport}
        />
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
        textSession={textSessionRef.current?.text ?? null}
        linkRequest={keyboardLinkRequest}
        slideId={slide.id}
        deckId={deckId}
        slideContentHash={hashSlideContent(slide.content)}
        onCommitInlineEdit={commitInlineEditForAgent}
        onComment={(quotedText, range, editingEl) => {
          const canvas = document.querySelector<HTMLElement>(
            "[data-main-slide-canvas='true']",
          );
          const target =
            editingEl.closest<HTMLElement>("[data-slide-object-id]") ??
            editingEl;
          const objectId = ensureCommentObjectId(target);
          const anchor = canvas
            ? slideCommentAnchorFromRange({
                range,
                slideRect: canvas.getBoundingClientRect(),
                objectId,
                objectRect: target.getBoundingClientRect(),
                objectElement: target,
                targetText: quotedText,
              })
            : undefined;
          onComment?.(quotedText, anchor);
        }}
      />
      <SlideSlashCommandMenu
        editingEl={editingEl}
        textSession={textSessionRef.current?.text ?? null}
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
          src={imageOverlay.src}
          objectFit={imageOverlay.objectFit}
          objectPosition={imageOverlay.objectPosition}
          onGenerate={() => {
            finishImageCrop(true);
            onGenerateImage();
          }}
          onLibrary={() => {
            finishImageCrop(true);
            onOpenAssetLibrary(imageOverlay.src);
          }}
          onUpload={() => {
            finishImageCrop(true);
            onUploadImage(imageOverlay.src);
          }}
          onDownload={() => {
            finishImageCrop(true);
            void downloadImage(imageOverlay.src);
          }}
          onToggleObjectFit={() => {
            finishImageCrop(true);
            const newFit =
              imageOverlay.objectFit === "cover" ? "contain" : "cover";
            onToggleObjectFit(
              imageOverlay.src,
              newFit,
              imageOverlay.imageOccurrence,
            );
            setImageOverlay({ ...imageOverlay, objectFit: newFit });
            if (selectedImg) {
              publishImageSelection(selectedImg, {
                objectFit: newFit,
                objectPosition: imageOverlay.objectPosition,
              });
            }
          }}
          onChangeObjectPosition={(objectPosition) => {
            finishImageCrop(true);
            onChangeObjectPosition(
              imageOverlay.src,
              objectPosition,
              imageOverlay.imageOccurrence,
            );
            setImageOverlay({ ...imageOverlay, objectPosition });
            if (selectedImg) {
              publishImageSelection(selectedImg, {
                objectFit: imageOverlay.objectFit,
                objectPosition,
              });
            }
          }}
          onClose={() => setImageOverlay(null)}
        />
      )}

      {imageCrop && (
        <ImageCropOverlay
          frame={imageCrop.frame}
          viewport={imageCrop.viewport}
          image={imageCrop.image}
          canvas={imageCrop.frame.closest<HTMLElement>(".slide-content")!}
          onFinish={finishImageCrop}
        />
      )}

      <DrawOverlay
        visible={!!drawMode}
        scopeKey={slideId || slide.id}
        onClose={() => onExitDrawMode?.()}
        onSend={(annotations, instruction, canvasSize) => {
          sendEditorPromptToAgent(
            buildDrawingHandoffPrompt({
              slideId: slide.id,
              annotations,
              instruction,
              canvasSize,
            }),
          );
          onExitDrawMode?.();
        }}
      />
      <SlideCommentPins
        key={slideId || slide.id}
        active={!!pinMode}
        canComment={canComment}
        canEdit={!readOnly}
        comments={comments}
        deckId={deckId ?? null}
        slideId={slideId || slide.id}
        canvasSelector="[data-main-slide-canvas='true']"
        currentUserEmail={currentUserEmail ?? null}
        onBeforeCommentSubmit={onFlushInlineEdit}
        onEnsureObjectId={ensureCommentObjectId}
        onSelectThread={onSelectCommentThread}
      />
    </div>
  );
}
