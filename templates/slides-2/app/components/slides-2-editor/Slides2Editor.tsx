import {
  compareAndSetClientAppState,
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import {
  useActionQuery,
  useActionMutation,
  useChangeVersion,
  useDbSync,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { useT as useTranslator } from "@agent-native/core/client/i18n";
import { parse } from "@babel/parser";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { appStateKey, appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import {
  completeSlideEditorCommand,
  isSlideEditorOperationAvailable,
  slideEditorCommandMatchesEditorState,
  slideEditorCommandSchema,
  slideEditorStatusSchema,
  SLIDE_EDITOR_COMMAND_KEY,
  SLIDE_EDITOR_STATUS_KEY,
  type SlideEditorCommand,
} from "@shared/editor-control";
import { overviewFocusNavigationIndex } from "@shared/overview-navigation";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  currentSlideTextRangeSelection,
  MAX_SLIDE_TEXT_RANGE_EXPECTED_TEXT_LENGTH,
} from "@shared/slide-text-range-selection";
import type { SlideTextRangeSelection } from "@shared/slide-text-range-selection";
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconClipboardText,
  IconCrop,
  IconPlayerPlay,
  IconPlus,
  IconArrowDown,
  IconArrowUp,
  IconPhoto,
  IconCopy,
  IconLink,
  IconMessageCircle,
  IconPalette,
  IconTrash,
  IconEye,
  IconPencil,
  IconLayoutGrid,
  IconLayoutSidebarRightExpand,
  IconNotes,
  IconX,
  IconScissors,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Slides2AgentConnectionBadge } from "@/components/slides-2-editor/Slides2AgentConnectionBadge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AspectRatio } from "@/lib/aspect-ratios";
import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorForRegion,
} from "@/lib/slide-comment-anchor";
import { TAB_ID } from "@/lib/tab-id";

import {
  SLIDES_2_CANVAS_HEIGHT,
  SLIDES_2_CANVAS_WIDTH,
} from "../slides-2-runtime/constants";
import type {
  SlideDesignTokens,
  SlideFrameNavigationInput,
  SlideRenderArtifact,
  SlideFrameTextRangeStyle,
} from "../slides-2-runtime/protocol";
import {
  SandboxedSlide,
  type FrameKeyboard,
  type FramePointer,
  type SlideFrameController,
} from "../slides-2-runtime/SandboxedSlide";
import { Slides2Canvas } from "../slides-2-runtime/Slides2Canvas";
import { currentAgentTextRangeSelection } from "./agent-text-selection";
import type {
  CrossSlideHistorySelection,
  CrossSlideSourceCommitEntry,
  CrossSlideSourceRestoreRequest,
} from "./cross-slide-edit-history";
import {
  getEditorActionErrorCode,
  getEditorActionErrorTranslationKey,
} from "./editor-action-errors";
import {
  alignRects,
  constrainMoveDelta,
  distributeRects,
  SLIDES_2_BOUNDS,
  rectContains,
  rectsIntersect,
  resizeRect,
  snapMove,
  snapRotationTo15Degrees,
  solveResizeDimensions,
  unionRects,
  type Alignment,
  type Point,
  type Rect,
  type ResizeHandle,
} from "./geometry";
import {
  imageCropStyleEdits,
  objectViewBoxToCropRect,
} from "./image-crop-style";
import { InlineTextEditor } from "./inline-text-editor";
import {
  getSlides2EditorShortcut,
  shouldIgnoreModifiedArrowNavigation,
} from "./keyboard-shortcuts";
import {
  insertSourceObject,
  getDefaultComponentRootRange,
  type Slides2ObjectKind,
} from "./object-insertion";
import { getPreviewPatches } from "./preview-patches";
import { Slides2AssetBrowser } from "./Slides2AssetBrowser";
import { Slides2CommandMenu } from "./Slides2CommandMenu";
import { Slides2Comments } from "./Slides2Comments";
import { Slides2DesignTokens } from "./Slides2DesignTokens";
import {
  Slides2ExportMenu,
  type Slides2ExportFormat,
  type Slides2ExportMenuHandle,
} from "./Slides2ExportMenu";
import Slides2HistoryPanel from "./Slides2HistoryPanel";
import {
  Slides2ImageCropControls,
  type Slides2ImageCropResult,
} from "./Slides2ImageCropControls";
import { Slides2Inspector } from "./Slides2Inspector";
import { Slides2MotionPanel } from "./Slides2MotionPanel";
import {
  deleteSourceElement,
  duplicateSourceElement,
  getParentSourceSelection,
  getSelectedAssetId,
  insertAssetOnCanvas,
  staticPositionZOrderEdits,
  type SourceSelection,
} from "./source-structure";
import type {
  ElementSnapshot,
  SlideSource,
  SourceEdit,
  SourceEditOp,
} from "./types";

type Translate = ReturnType<typeof useTranslator>;
export type Slides2InspectorPanel = "format" | "design" | "notes" | "motion";
export type Slides2EditorMode = "edit" | "preview";

type PreviewStepState = {
  artifactKey: string | null;
  stepCount: number | null;
  revealedSteps: number;
};

type SourceVersion = Pick<SlideSource, "revision" | "sourceHash">;

const activeSlideEditorCommands = new Set<string>();
const completedSlideEditorCommands = new Map<string, SlideEditorCommand>();
const slideEditorCommandAckRetryAttempts = new Map<string, number>();

type SlideSummary = {
  id: string;
  slideNumber: number;
  textPreview?: string;
  isBlank?: boolean;
};

type Props = {
  deckId: string;
  title: string;
  onTitleChange?: (title: string) => Promise<void>;
  canPasteSlide?: boolean;
  clipboardSourceSlideId?: string | null;
  clipboardOperation?: "copy" | "cut" | null;
  slides: SlideSummary[];
  activeIndex: number;
  source: SlideSource;
  notes: string;
  artifact: SlideRenderArtifact | null;
  designTokens: SlideDesignTokens | null;
  savingDesignTokens: boolean;
  savingNotes: boolean;
  loading: boolean;
  loadingError?: string | null;
  saving: boolean;
  sourceConflict: boolean;
  structuralSaving: boolean;
  structuralError?: string | null;
  canEdit: boolean;
  canComment: boolean;
  backHref: string;
  presentHref: string;
  aspectRatio?: AspectRatio;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  slideRailWidth?: number;
  onSlideRailWidthChange?: (width: number) => void;
  activePanel?: Slides2InspectorPanel;
  previousPanel?: Slides2InspectorPanel;
  onActivePanelChange?: (panel: Slides2InspectorPanel) => void;
  inspectorOpen?: boolean;
  onInspectorOpenChange?: (open: boolean) => void;
  inspectorBeforePreview?: boolean | null;
  onInspectorBeforePreviewChange?: (open: boolean | null) => void;
  inspectorToggledInPreview?: boolean;
  onInspectorToggledInPreviewChange?: (toggled: boolean) => void;
  overviewOpen?: boolean;
  onOverviewOpenChange?: (open: boolean) => void;
  t?: Translate;
  onSelectSlide: (index: number) => void;
  onPresent: (mode?: "fullscreen" | "windowed") => void;
  onRequestFullscreen?: () => boolean | Promise<boolean>;
  onOpenPresenter?: () => void;
  onShare?: () => void;
  onVersionRestored?: () => Promise<void> | void;
  onSave: (
    edits: SourceEdit[],
  ) => Promise<Pick<SlideSource, "sourceTsx" | "revision" | "sourceHash">>;
  onReloadSource: () => Promise<SlideSource>;
  onRestore: (
    sourceTsx: string,
    expected?: SourceVersion,
  ) => Promise<Pick<SlideSource, "sourceTsx" | "revision" | "sourceHash">>;
  onSaveDesignTokens: (tokens: SlideDesignTokens) => Promise<void>;
  onSaveNotes: (notes: string) => Promise<void>;
  onSelectionChange: (
    selected: ElementSnapshot[],
    textRange: SlideTextRangeSelection | null,
  ) => void;
  editorMode?: Slides2EditorMode;
  onPanelChange?: (panel: Slides2InspectorPanel | null) => void;
  onEditorModeChange?: (mode: Slides2EditorMode) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (index: number) => void;
  onCopySlide?: (slideId: string) => Promise<void> | void;
  onCutSlide?: (slideId: string) => Promise<void> | void;
  onPasteSlide?: (afterSlideId?: string) => Promise<void> | void;
  onDeleteSlide: (index: number) => void;
  onMoveSlide: (from: number, to: number) => void;
  crossSlideHistory?: {
    editBatches: SourceEdit[][];
    historyIndex: number;
    canUndo: boolean;
    canRedo: boolean;
    append: (edits: SourceEdit[]) => void;
    undo: () => boolean | Promise<boolean>;
    redo: () => boolean | Promise<boolean>;
    commit: (entry: Omit<CrossSlideSourceCommitEntry, "type">) => void;
    clear: () => void;
    selection?: CrossSlideHistorySelection | null;
    onSelectionApplied: (requestId: string) => void;
    restoreRequest?: CrossSlideSourceRestoreRequest | null;
    onSourceRestoreComplete?: (
      requestId: string,
      source: Pick<SlideSource, "revision" | "sourceHash"> | null,
    ) => void;
  };
};

type EditBatch = SourceEdit[];
export const SLIDE_RAIL_WIDTH_STATE_KEY = appStateKey(
  "slides-2-editor-rail-width",
);
export const DEFAULT_SLIDE_RAIL_WIDTH = 264;
const MIN_SLIDE_RAIL_WIDTH = 200;
const MAX_SLIDE_RAIL_WIDTH = 480;

function clampSlideRailWidth(width: number): number {
  return Math.min(
    MAX_SLIDE_RAIL_WIDTH,
    Math.max(MIN_SLIDE_RAIL_WIDTH, Math.round(width)),
  );
}

export function readSlideRailWidth(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const width = (value as { width?: unknown }).width;
  return typeof width === "number" && Number.isFinite(width)
    ? clampSlideRailWidth(width)
    : null;
}

type DragMode = "move" | "marquee" | "resize" | "rotate";
type DragState = {
  mode: DragMode;
  pointerId: number;
  start: Point;
  moved: boolean;
  nodeIds: string[];
  initial: ElementSnapshot[];
  handle?: ResizeHandle;
  initialRect?: Rect;
  initialRotation?: number;
  marquee?: Rect;
  additive?: boolean;
  initialSelection?: string[];
  guides?: ReturnType<typeof snapMove>["guides"];
};

const EDIT_HISTORY_LIMIT = 50;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const RESIZE_HANDLES: Array<{ key: ResizeHandle; cursor: string }> = [
  { key: "nw", cursor: "nwse-resize" },
  { key: "n", cursor: "ns-resize" },
  { key: "ne", cursor: "nesw-resize" },
  { key: "e", cursor: "ew-resize" },
  { key: "se", cursor: "nwse-resize" },
  { key: "s", cursor: "ns-resize" },
  { key: "sw", cursor: "nesw-resize" },
  { key: "w", cursor: "ew-resize" },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function transformHandleShortcuts(handle: ResizeHandle | "rotate"): string {
  const keys =
    handle === "rotate"
      ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]
      : [
          ...(handle.includes("w") || handle.includes("e")
            ? ["ArrowLeft", "ArrowRight"]
            : []),
          ...(handle.includes("n") || handle.includes("s")
            ? ["ArrowUp", "ArrowDown"]
            : []),
        ];
  return [...keys, ...keys.map((key) => `Shift+${key}`)].join(" ");
}

function isFullSlideBounds(bounds: Rect): boolean {
  return (
    Math.abs(bounds.x) < 1 &&
    Math.abs(bounds.y) < 1 &&
    bounds.width >= SLIDES_2_CANVAS_WIDTH - 1 &&
    bounds.height >= SLIDES_2_CANVAS_HEIGHT - 1
  );
}

function elementAtPoint(
  nodes: ElementSnapshot[],
  point: Point,
): ElementSnapshot | null {
  let target: ElementSnapshot | null = null;
  let targetArea = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    const bounds = node.bounds;
    if (
      isFullSlideBounds(bounds) ||
      point.x < bounds.x ||
      point.y < bounds.y ||
      point.x >= bounds.x + bounds.width ||
      point.y >= bounds.y + bounds.height
    ) {
      continue;
    }

    const area = bounds.width * bounds.height;
    if (area <= targetArea) {
      target = node;
      targetArea = area;
    }
  }

  return target;
}

function preferredPointerTarget(pointer: FramePointer) {
  const reportedTarget = pointer.target;
  const pointTarget = pointer.hitTarget;
  if (
    (!reportedTarget || isFullSlideBounds(reportedTarget.snapshot.bounds)) &&
    pointTarget &&
    !isFullSlideBounds(pointTarget.snapshot.bounds)
  ) {
    return pointTarget;
  }
  return reportedTarget;
}

function uniqueByLocator(nodes: ElementSnapshot[]): ElementSnapshot[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = `${node.line}:${node.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceLocatorKey(node: Pick<ElementSnapshot, "line" | "column">) {
  return `${node.line}:${node.column}`;
}

function isSourceAncestor(
  ancestor: ElementSnapshot,
  descendant: ElementSnapshot,
): boolean | null {
  const locators = descendant.ancestorLocators;
  if (!Array.isArray(locators)) return null;
  if (locators?.includes(sourceLocatorKey(ancestor))) return true;
  return descendant.ancestorLocatorsComplete === true ? false : null;
}

function selectionRelation(
  first: ElementSnapshot,
  second: ElementSnapshot,
): "same" | "related" | "independent" | "unknown" {
  if (first.nodeId === second.nodeId) return "same";
  const firstIsAncestor = isSourceAncestor(first, second);
  const secondIsAncestor = isSourceAncestor(second, first);
  if (firstIsAncestor === true || secondIsAncestor === true) return "related";
  if (firstIsAncestor === false && secondIsAncestor === false)
    return "independent";
  return "unknown";
}

function hasTransformableBounds(node: ElementSnapshot): boolean {
  const { x, y, width, height } = node.bounds;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

function independentTransformTargets(
  nodes: ElementSnapshot[],
): ElementSnapshot[] {
  const candidates = uniqueByLocator(nodes).filter(
    (node) => hasTransformableBounds(node) && !isFullSlideBounds(node.bounds),
  );
  const candidateLocators = new Set(candidates.map(sourceLocatorKey));
  return candidates.filter((node) => {
    if (
      node.ancestorLocatorsComplete !== true ||
      !Array.isArray(node.ancestorLocators)
    ) {
      return false;
    }
    return !node.ancestorLocators?.some((ancestor) =>
      candidateLocators.has(ancestor),
    );
  });
}

function marqueeTransformTargets(
  rect: Rect,
  nodes: ElementSnapshot[],
): ElementSnapshot[] {
  const hits = nodes.filter(
    (node) =>
      hasTransformableBounds(node) &&
      !isFullSlideBounds(node.bounds) &&
      rectsIntersect(rect, node.bounds),
  );
  const preferredHits = hits.filter(
    (node) =>
      rectContains(rect, node.bounds) ||
      !hits.some(
        (other) =>
          other.nodeId !== node.nodeId &&
          isSourceAncestor(node, other) === true,
      ),
  );
  return independentTransformTargets(preferredHits);
}

function marqueeSelectionIds(
  rect: Rect,
  nodes: ElementSnapshot[],
  initialSelection: string[] = [],
): string[] {
  const existing = initialSelection.flatMap((id) =>
    nodes.filter((node) => node.nodeId === id),
  );
  return independentTransformTargets([
    ...existing,
    ...marqueeTransformTargets(rect, nodes),
  ]).map((node) => node.nodeId);
}

function removeRelatedSelectionIds(
  ids: string[],
  target: ElementSnapshot,
  nodes: ElementSnapshot[],
): string[] | null {
  const next: string[] = [];
  for (const id of ids) {
    const selected = nodes.find((node) => node.nodeId === id);
    if (!selected) return null;
    const relation = selectionRelation(selected, target);
    if (relation === "unknown") return null;
    if (relation === "independent") next.push(id);
  }
  return next;
}

function isBareDesignPanelShortcut(
  keyboard: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">,
): boolean {
  return (
    import.meta.env.DEV &&
    keyboard.key.toLowerCase() === "d" &&
    !keyboard.altKey &&
    !keyboard.ctrlKey &&
    !keyboard.metaKey
  );
}

function localTranslateForBounds(
  node: ElementSnapshot,
  x: number,
  y: number,
): string {
  const transform = node.transform;
  const basis = transform?.basis ?? { a: 1, b: 0, c: 0, d: 1 };
  const translate = transform?.translate ?? { x: 0, y: 0 };
  const determinant = basis.a * basis.d - basis.b * basis.c;
  const dx = x - node.bounds.x;
  const dy = y - node.bounds.y;
  const local =
    Math.abs(determinant) < 0.000001
      ? { x: dx, y: dy }
      : {
          x: (basis.d * dx - basis.c * dy) / determinant,
          y: (basis.a * dy - basis.b * dx) / determinant,
        };
  return `${round(translate.x + local.x)}px ${round(translate.y + local.y)}px`;
}

function resizeDimensionsForBounds(
  node: ElementSnapshot,
  size: Pick<Rect, "width" | "height">,
  initialBounds: Rect,
  nextBounds: Rect,
): Pick<Rect, "width" | "height"> {
  const basis = node.transform?.basis ?? { a: 1, b: 0, c: 0, d: 1 };
  return solveResizeDimensions(
    size,
    {
      a: Math.abs(basis.a),
      b: Math.abs(basis.b),
      c: Math.abs(basis.c),
      d: Math.abs(basis.d),
    },
    {
      x: nextBounds.width - initialBounds.width,
      y: nextBounds.height - initialBounds.height,
    },
  );
}

function editFor(node: ElementSnapshot, ops: SourceEditOp[]): SourceEdit {
  return { line: node.line, column: node.column, ops };
}

function sourceString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

type SourceJsxElement = {
  type?: string;
  loc?: { start?: { line?: number; column?: number } };
  openingElement?: { attributes?: unknown[] };
  children?: unknown[];
  [key: string]: unknown;
};

function sourceJsxElements(sourceTsx: string): SourceJsxElement[] {
  const ast = parse(sourceTsx, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  const elements: SourceJsxElement[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const node = value as SourceJsxElement;
    if (node.type === "JSXElement") elements.push(node);
    for (const child of Object.values(node)) visit(child);
  };
  visit(ast);
  return elements;
}

function sourceJsxAttributeText(
  element: SourceJsxElement,
  name: string,
): string | null {
  const attributes = element.openingElement?.attributes;
  if (!attributes) return null;
  const attribute = attributes.find((value) => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as {
      type?: string;
      name?: { name?: string };
    };
    return candidate.type === "JSXAttribute" && candidate.name?.name === name;
  }) as
    | {
        value?: {
          type?: string;
          value?: unknown;
          expression?: { type?: string; value?: unknown };
        } | null;
      }
    | undefined;
  if (attribute?.value?.type === "StringLiteral") {
    return typeof attribute.value.value === "string"
      ? attribute.value.value
      : null;
  }
  if (
    attribute?.value?.type === "JSXExpressionContainer" &&
    attribute.value.expression?.type === "StringLiteral"
  ) {
    return typeof attribute.value.expression.value === "string"
      ? attribute.value.expression.value
      : null;
  }
  return null;
}

function sourceSelectionForElement(
  element: SourceJsxElement,
): SourceSelection | null {
  const line = element.loc?.start?.line;
  const column = element.loc?.start?.column;
  return Number.isInteger(line) && Number.isInteger(column)
    ? { line: line as number, column: column as number }
    : null;
}

function sourceGroupChildIds(
  sourceTsx: string,
  target: SourceSelection,
): string[] | null {
  const elements = sourceJsxElements(sourceTsx);
  const group = elements.find((element) => {
    const selection = sourceSelectionForElement(element);
    return (
      selection?.line === target.line && selection.column === target.column
    );
  });
  if (
    !group ||
    sourceJsxAttributeText(group, "data-slide-group") !== "true" ||
    !(sourceJsxAttributeText(group, "className") ?? "")
      .split(/\s+/)
      .includes("fmd-slide-group")
  ) {
    return null;
  }
  const children = group.children ?? [];
  if (
    children.some((child) => {
      if (!child || typeof child !== "object") return true;
      const node = child as { type?: string; value?: unknown };
      return !(
        node.type === "JSXElement" ||
        (node.type === "JSXText" &&
          typeof node.value === "string" &&
          node.value.trim() === "")
      );
    })
  ) {
    return null;
  }
  const childElements = children.filter(
    (child): child is SourceJsxElement =>
      Boolean(child) &&
      typeof child === "object" &&
      (child as SourceJsxElement).type === "JSXElement",
  );
  const childIds = childElements.map((child) =>
    sourceJsxAttributeText(child, "data-slide-object-id"),
  );
  return childIds.length >= 2 &&
    childIds.every((id) => typeof id === "string" && id.trim().length > 0)
    ? (childIds as string[])
    : null;
}

function sourceSelectionForObjectId(
  sourceTsx: string,
  objectId: string,
): SourceSelection | null {
  const element = sourceJsxElements(sourceTsx).find(
    (candidate) =>
      sourceJsxAttributeText(candidate, "data-slide-object-id") === objectId,
  );
  return element ? sourceSelectionForElement(element) : null;
}

function insertVideoAssetOnCanvas(
  sourceTsx: string,
  assetId: string,
  filename: string,
): { sourceTsx: string; selection?: SourceSelection } | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(assetId)) return null;
  const rootRange = getDefaultComponentRootRange(sourceTsx);
  if (!rootRange) return null;
  const rawRoot = sourceTsx.slice(rootRange.start, rootRange.end);
  const newline = sourceTsx.includes("\r\n") ? "\r\n" : "\n";
  const indentedRoot = rawRoot
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join(newline);
  const video = `<video src={${sourceString(`asset://${assetId}`)}} aria-label={${sourceString(filename)}} controls playsInline preload="metadata" style={{ position: "absolute", left: "760px", top: "390px", width: "400px", height: "300px", objectFit: "contain" }} />`;
  const wrapper = `<div style={{ position: "relative", width: "${SLIDES_2_BOUNDS.width}px", height: "${SLIDES_2_BOUNDS.height}px", boxSizing: "border-box", overflow: "hidden" }}>${newline}${indentedRoot}${newline}  ${video}${newline}</div>`;
  const nextSource =
    sourceTsx.slice(0, rootRange.start) +
    wrapper +
    sourceTsx.slice(rootRange.end);
  const start = rootRange.start + wrapper.lastIndexOf(video);
  const ast = parse(nextSource, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  let selection: SourceSelection | undefined;
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const node = value as {
      type?: string;
      start?: number | null;
      loc?: { start?: { line?: number; column?: number } };
      [key: string]: unknown;
    };
    if (node.type === "JSXElement" && node.start === start) {
      const line = node.loc?.start?.line;
      const column = node.loc?.start?.column;
      if (Number.isInteger(line) && Number.isInteger(column)) {
        selection = { line: line as number, column: column as number };
      }
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(ast);
  return selection ? { sourceTsx: nextSource, selection } : null;
}

function replaceVideoAssetSource(
  sourceTsx: string,
  target: SourceSelection,
  assetId: string,
): string | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(assetId)) return null;
  const ast = parse(sourceTsx, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  let nextSource: string | null = null;
  const visit = (value: unknown) => {
    if (nextSource || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const node = value as {
      type?: string;
      loc?: { start?: { line?: number; column?: number } };
      openingElement?: {
        name?: { name?: string };
        attributes?: Array<{
          type?: string;
          name?: { name?: string };
          start?: number | null;
          end?: number | null;
        }>;
      };
      [key: string]: unknown;
    };
    if (
      node.type === "JSXElement" &&
      node.loc?.start?.line === target.line &&
      node.loc.start.column === target.column
    ) {
      if (node.openingElement?.name?.name !== "video") return;
      const src = node.openingElement.attributes?.find(
        (attribute) =>
          attribute.type === "JSXAttribute" && attribute.name?.name === "src",
      );
      if (
        typeof src?.start !== "number" ||
        typeof src.end !== "number" ||
        src.end <= src.start
      ) {
        return;
      }
      nextSource =
        sourceTsx.slice(0, src.start) +
        `src={${sourceString(`asset://${assetId}`)}}` +
        sourceTsx.slice(src.end);
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(ast);
  return nextSource;
}

function isImagePlaceholder(node: ElementSnapshot, sourceTsx: string): boolean {
  if (node.tagName.toLowerCase() === "img") return true;
  const line = sourceTsx.split(/\r?\n/)[node.line - 1];
  if (!line || node.column > line.length) return false;
  return /^<ImagePlaceholder(?=[\s/>]|$)/.test(line.slice(node.column));
}

function cropImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (!URL.canParse(value, window.location.origin)) return null;
  const url = new URL(value, window.location.origin);
  return !url.username &&
    !url.password &&
    (url.protocol === "https:" || url.origin === window.location.origin)
    ? url.toString()
    : null;
}

function objectPositionPercent(value: string | undefined): {
  x: number;
  y: number;
} {
  const tokens = (value ?? "50% 50%").trim().split(/\s+/);
  const read = (token: string | undefined) => {
    if (!token) return 50;
    if (token.endsWith("%")) {
      const parsed = Number.parseFloat(token);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
    }
    if (token === "left" || token === "top") return 0;
    if (token === "right" || token === "bottom") return 100;
    return 50;
  };
  return {
    x: read(tokens[0]),
    y: read(tokens[1] ?? "center"),
  };
}

function SlideThumbnail({
  deckId,
  slide,
  slideIndex,
  selected,
  cut,
  dragDisabled,
  onSelect,
  onNavigate,
}: {
  deckId: string;
  slide: SlideSummary;
  slideIndex: number;
  selected: boolean;
  cut: boolean;
  dragDisabled: boolean;
  onSelect: () => void;
  onNavigate: (direction: -1 | 1) => void;
}) {
  const t = useT();
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: slide.id, disabled: dragDisabled });
  const frameRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const render = useActionQuery(
    "get-slide-render",
    { deckId, slideId: slide.id },
    { enabled: visible },
  );

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={setNodeRef}
      className={`group flex min-w-0 w-full items-start gap-2 rounded-md ps-2 pe-0.5 py-1.5 ${selected ? "bg-accent/60" : "hover:bg-accent/50"} ${cut ? "opacity-50" : ""}`}
      data-slide-thumbnail-row="true"
      data-slides-2-cut={cut ? "true" : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: dragDisabled ? undefined : "none",
        opacity: isDragging ? 0.6 : undefined,
      }}
    >
      <span
        data-slide-thumbnail-number="true"
        className={`w-7 shrink-0 pt-1 text-right font-mono text-xs tabular-nums ${selected ? "text-destructive" : "text-muted-foreground"}`}
      >
        {String(slide.slideNumber).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="block h-auto w-full p-0"
          onClick={onSelect}
          {...attributes}
          {...listeners}
          onKeyDown={(event) => {
            listeners?.onKeyDown?.(event);
            if (
              event.defaultPrevented ||
              isDragging ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            ) {
              return;
            }
            if (
              event.key === "ArrowUp" ||
              event.key === "ArrowLeft" ||
              event.key === "ArrowDown" ||
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              event.stopPropagation();
              onNavigate(
                event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1,
              );
            }
          }}
          data-slides-2-thumbnail-index={slideIndex}
          aria-label={t("editorSidebar.selectSlide", {
            number: slide.slideNumber,
          })}
          aria-current={selected ? "true" : undefined}
        >
          <span
            ref={frameRef}
            className={`relative block aspect-video w-full max-w-[184px] overflow-hidden rounded border bg-muted ${selected ? "border-destructive" : "border-border/70"}`}
          >
            {visible && render.data ? (
              <Slides2Canvas flat blockInteractions>
                <SandboxedSlide
                  artifact={render.data}
                  title={t("slides2Presenter.slideLabel", {
                    index: slide.slideNumber,
                  })}
                  onNodes={() => {}}
                  onPointer={() => {}}
                />
              </Slides2Canvas>
            ) : (
              <span className="absolute inset-0 flex items-center justify-center bg-muted/40 px-3 text-center text-[10px] text-muted-foreground">
                {slide.textPreview || ""}
              </span>
            )}
          </span>
        </Button>
      </span>
    </div>
  );
}

function SlideOverviewThumbnail({
  deckId,
  slide,
  index,
  selected,
  focused,
  total,
  onSelect,
  onFocus,
}: {
  deckId: string;
  slide: SlideSummary;
  index: number;
  selected: boolean;
  focused: boolean;
  total: number;
  onSelect: () => void;
  onFocus: (index: number) => void;
}) {
  const t = useT();
  const frameRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const render = useActionQuery(
    "get-slide-render",
    { deckId, slideId: slide.id },
    { enabled: visible },
  );

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={`group flex h-[216px] w-full min-w-0 flex-col gap-1.5 rounded-md p-1 text-start font-normal outline-none transition-colors active:scale-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ${focused ? "bg-accent ring-2 ring-primary" : selected ? "bg-accent" : ""}`}
    >
      <button
        type="button"
        autoFocus={selected}
        data-slide-overview-index={index}
        data-slide-overview-active={selected ? "true" : undefined}
        aria-label={t("slides2Presenter.slideLabel", {
          index: slide.slideNumber,
        })}
        aria-current={selected ? "true" : undefined}
        onFocus={() => onFocus(index)}
        onClick={onSelect}
      >
        <span
          ref={frameRef}
          className="pointer-events-none relative block aspect-video w-full overflow-hidden rounded border border-border bg-muted"
        >
          {visible && render.data ? (
            <Slides2Canvas flat>
              <SandboxedSlide
                artifact={render.data}
                title={t("slides2Presenter.slideLabel", {
                  index: slide.slideNumber,
                })}
                onNodes={() => {}}
                onPointer={() => {}}
              />
            </Slides2Canvas>
          ) : (
            <span className="absolute inset-0 grid place-items-center bg-muted/40 text-2xl font-semibold text-muted-foreground">
              {slide.slideNumber}
            </span>
          )}
          {selected ? (
            <span
              aria-hidden="true"
              className="absolute right-2 top-2 rounded-sm bg-destructive px-2 py-0.5 text-[10px] leading-4 font-semibold tracking-wide text-destructive-foreground"
            >
              {t("slides2Editor.now")}
            </span>
          ) : null}
        </span>
        <span className="px-1 text-xs text-muted-foreground">
          {t("slides2Presenter.position", {
            index: slide.slideNumber,
            total,
          })}
        </span>
      </button>
    </Button>
  );
}

function handlePoint(rect: Rect, handle: ResizeHandle): Point {
  return {
    x: handle.includes("w")
      ? rect.x
      : handle.includes("e")
        ? rect.x + rect.width
        : rect.x + rect.width / 2,
    y: handle.includes("n")
      ? rect.y
      : handle.includes("s")
        ? rect.y + rect.height
        : rect.y + rect.height / 2,
  };
}

function applyTranslate(
  node: ElementSnapshot,
  dx: number,
  dy: number,
): SourceEdit {
  return editFor(node, [
    {
      kind: "set-style",
      key: "translate",
      value: localTranslateForBounds(
        node,
        node.bounds.x + dx,
        node.bounds.y + dy,
      ),
      ...(node.text ? { prevText: node.text } : {}),
    },
  ]);
}

function hasUniqueRenderedInstances(
  targets: Array<Pick<SourceSelection, "line" | "column">>,
  nodes: ElementSnapshot[],
): boolean {
  const uniqueTargets = new Map(
    targets.map((target) => [`${target.line}:${target.column}`, target]),
  );
  if (uniqueTargets.size === 0) return false;
  return [...uniqueTargets.values()].every((target) => {
    const matches = nodes.filter(
      (node) => node.line === target.line && node.column === target.column,
    );
    return (
      matches.length === 1 &&
      matches[0]?.instanceIndex === 0 &&
      matches[0]?.instanceCount === 1
    );
  });
}

export function Slides2Editor({
  deckId,
  title,
  onTitleChange,
  canPasteSlide = false,
  clipboardSourceSlideId,
  clipboardOperation,
  slides,
  activeIndex,
  source,
  notes,
  artifact,
  designTokens,
  savingDesignTokens,
  savingNotes,
  loading,
  loadingError,
  saving,
  sourceConflict,
  structuralSaving,
  structuralError,
  canEdit: hasEditPermission,
  canComment,
  backHref,
  presentHref,
  aspectRatio,
  zoom: suppliedZoom,
  onZoomChange,
  slideRailWidth: suppliedSlideRailWidth,
  onSlideRailWidthChange,
  activePanel: suppliedActivePanel,
  previousPanel: suppliedPreviousPanel,
  onActivePanelChange,
  inspectorOpen: suppliedInspectorOpen,
  onInspectorOpenChange,
  inspectorBeforePreview: suppliedInspectorBeforePreview,
  onInspectorBeforePreviewChange,
  inspectorToggledInPreview: suppliedInspectorToggledInPreview,
  onInspectorToggledInPreviewChange,
  overviewOpen: suppliedOverviewOpen,
  onOverviewOpenChange,
  t: suppliedT,
  onSelectSlide,
  onRequestFullscreen,
  onPresent,
  onOpenPresenter,
  onShare,
  onVersionRestored,
  onSave,
  onReloadSource,
  onRestore,
  onSaveDesignTokens,
  onSaveNotes,
  onSelectionChange,
  editorMode: suppliedEditorMode,
  onPanelChange,
  onEditorModeChange,
  onAddSlide,
  onDuplicateSlide,
  onCopySlide,
  onCutSlide,
  onPasteSlide,
  onDeleteSlide,
  onMoveSlide,
  crossSlideHistory,
}: Props) {
  const defaultT = useT();
  const t = suppliedT ?? defaultT;
  const formatters = useFormatters();
  const transformSlideObjects = useActionMutation<
    Pick<SlideSource, "sourceTsx" | "revision" | "sourceHash"> & {
      createdObjectId?: string;
      createdLocator?: SourceSelection;
    }
  >("transform-slide-objects");
  const editorCommandKey = appStateKeyForBrowserTab(
    appStateKey(SLIDE_EDITOR_COMMAND_KEY),
    TAB_ID,
  );
  const editorCommandVersion = useChangeVersion(
    `app-state:${appStateKey(SLIDE_EDITOR_COMMAND_KEY)}`,
  );
  useDbSync({
    ignoreSource: TAB_ID,
    pauseWhenHidden: false,
  });
  const [localZoom, setLocalZoom] = useState(1);
  const zoom = suppliedZoom ?? localZoom;
  const setZoom = useCallback(
    (update: number | ((value: number) => number)) => {
      const nextZoom = typeof update === "function" ? update(zoom) : update;
      if (suppliedZoom === undefined) setLocalZoom(nextZoom);
      onZoomChange?.(nextZoom);
    },
    [onZoomChange, suppliedZoom, zoom],
  );
  const [fitScale, setFitScale] = useState(1);
  const [localSlideRailWidth, setLocalSlideRailWidth] = useState(
    DEFAULT_SLIDE_RAIL_WIDTH,
  );
  const slideRailWidth = suppliedSlideRailWidth ?? localSlideRailWidth;
  const slideRailWidthRef = useRef(slideRailWidth);
  slideRailWidthRef.current = slideRailWidth;
  const slideRailTouchedRef = useRef(false);
  const slideRailResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const slideRailListRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<ElementSnapshot[]>([]);
  const [hoveredTarget, setHoveredTarget] = useState<{
    slideId: string;
    nodeId: string;
  } | null>(null);
  const [textRangeStyleSnapshot, setTextRangeStyleSnapshot] =
    useState<SlideFrameTextRangeStyle | null>(null);
  const [selectedTextRange, setSelectedTextRange] =
    useState<SlideTextRangeSelection | null>(null);
  const [inlineNode, setInlineNode] = useState<ElementSnapshot | null>(null);
  const [inlineTextPoint, setInlineTextPoint] = useState<Point | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [gestureSelectionIds, setGestureSelectionIds] = useState<
    string[] | null
  >(null);
  const [guideLines, setGuideLines] = useState<
    ReturnType<typeof snapMove>["guides"]
  >([]);
  const [smartGuidesEnabled, setSmartGuidesEnabled] = useState(true);
  const [alignToSlide, setAlignToSlide] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [editBatches, setEditBatches] = useState<EditBatch[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const currentEditBatches = crossSlideHistory?.editBatches ?? editBatches;
  const currentHistoryIndex = crossSlideHistory?.historyIndex ?? historyIndex;
  const [committedSource, setCommittedSource] = useState(() => ({
    sourceTsx: source.sourceTsx,
    revision: source.revision,
    sourceHash: source.sourceHash,
  }));
  const committedSourceRef = useRef(committedSource);
  const [committedHistory, setCommittedHistory] = useState<string[]>([
    source.sourceTsx,
  ]);
  const committedHistoryRef = useRef(committedHistory);
  const [committedHistoryIndex, setCommittedHistoryIndex] = useState(0);
  const committedHistoryIndexRef = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyVersionRef = useRef(0);
  const editorSessionIdRef = useRef<string | null>(null);
  if (editorSessionIdRef.current === null) {
    editorSessionIdRef.current = nanoid();
  }
  const [pendingSourceSelection, setPendingSourceSelection] = useState<{
    revision: number;
    selections: SourceSelection[];
  } | null>(null);
  const appliedHistorySelectionRef = useRef<string | null>(null);
  const processingHistoryRestoreRef = useRef<string | null>(null);
  const [localActivePanel, setLocalActivePanel] =
    useState<Slides2InspectorPanel>("format");
  const activePanel = suppliedActivePanel ?? localActivePanel;
  const setActivePanel = useCallback(
    (
      update:
        | Slides2InspectorPanel
        | ((panel: Slides2InspectorPanel) => Slides2InspectorPanel),
    ) => {
      const nextPanel =
        typeof update === "function" ? update(activePanel) : update;
      if (suppliedActivePanel === undefined) setLocalActivePanel(nextPanel);
      onActivePanelChange?.(nextPanel);
    },
    [activePanel, onActivePanelChange, suppliedActivePanel],
  );
  const [localInspectorOpen, setLocalInspectorOpen] = useState(
    suppliedEditorMode !== "preview",
  );
  const inspectorOpen = suppliedInspectorOpen ?? localInspectorOpen;
  const setInspectorOpen = useCallback(
    (update: boolean | ((open: boolean) => boolean)) => {
      const nextOpen =
        typeof update === "function" ? update(inspectorOpen) : update;
      if (suppliedInspectorOpen === undefined) setLocalInspectorOpen(nextOpen);
      onInspectorOpenChange?.(nextOpen);
    },
    [inspectorOpen, onInspectorOpenChange, suppliedInspectorOpen],
  );
  const [localEditorMode, setLocalEditorMode] =
    useState<Slides2EditorMode>("edit");
  const previewMode = (suppliedEditorMode ?? localEditorMode) === "preview";
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;
  const [previewStepState, setPreviewStepState] = useState<PreviewStepState>({
    artifactKey: null,
    stepCount: null,
    revealedSteps: 0,
  });
  const previewStepStateRef = useRef(previewStepState);
  previewStepStateRef.current = previewStepState;
  const previewWheelRef = useRef({
    accumulated: 0,
    lastAt: 0,
    lastNavigationAt: 0,
  });
  const inspectorBeforePreviewRef = useRef<boolean | null>(
    suppliedInspectorBeforePreview ?? null,
  );
  const inspectorToggledInPreviewRef = useRef(
    suppliedInspectorToggledInPreview ?? false,
  );
  const previewArtifactKey = artifact
    ? `${artifact.deckId}:${artifact.slideId}:${artifact.revision}:${artifact.sourceHash}`
    : null;
  const previousPanelRef = useRef<Slides2InspectorPanel>(
    suppliedPreviousPanel ??
      (suppliedActivePanel === "design"
        ? "format"
        : (suppliedActivePanel ?? "format")),
  );
  useEffect(() => {
    if (activePanel !== "design") previousPanelRef.current = activePanel;
  }, [activePanel]);
  const toggleInspector = useCallback(() => {
    if (previewModeRef.current) {
      inspectorToggledInPreviewRef.current = true;
      onInspectorToggledInPreviewChange?.(true);
    }
    setInspectorOpen((open) => !open);
  }, [onInspectorToggledInPreviewChange, setInspectorOpen]);
  const showInspectorPanel = useCallback(
    (panel: Slides2InspectorPanel) => {
      setActivePanel(panel);
      if (!inspectorOpen) toggleInspector();
    },
    [inspectorOpen, setActivePanel, toggleInspector],
  );
  const toggleDesignPanel = useCallback(() => {
    if (!inspectorOpen) {
      showInspectorPanel("design");
      return;
    }
    setActivePanel((panel) =>
      panel === "design" ? previousPanelRef.current : "design",
    );
  }, [inspectorOpen, setActivePanel, showInspectorPanel]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const renderIdentity = `${source.id}:${source.revision}:${source.sourceHash}`;
  const [renderFailure, setRenderFailure] = useState<{
    identity: string;
    message: string;
  } | null>(null);
  const renderError =
    renderFailure?.identity === renderIdentity ? renderFailure.message : null;
  const reportRenderError = useCallback(
    (message: string) =>
      setRenderFailure({ identity: renderIdentity, message }),
    [renderIdentity],
  );
  const clearRenderError = useCallback(
    () =>
      setRenderFailure((failure) =>
        failure?.identity === renderIdentity ? null : failure,
      ),
    [renderIdentity],
  );
  const [titleDraft, setTitleDraft] = useState(title);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleCommitInFlightRef = useRef(false);
  const [titleInputWidth, setTitleInputWidth] = useState(96);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const discardTitleDraftOnBlurRef = useRef(false);
  useEffect(() => {
    if (!titleEditing) setTitleDraft(title);
  }, [title, titleEditing]);
  useEffect(() => {
    if (!titleEditing) return;
    queueMicrotask(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [titleEditing]);
  useLayoutEffect(() => {
    const measuredWidth =
      titleMeasureRef.current?.getBoundingClientRect().width;
    if (typeof measuredWidth !== "number" || !Number.isFinite(measuredWidth)) {
      return;
    }
    setTitleInputWidth(
      Math.min(768, Math.max(96, Math.ceil(measuredWidth) + 16)),
    );
  }, [titleDraft]);
  const [reloadingSource, setReloadingSource] = useState(false);
  const pendingSourceRestore =
    crossSlideHistory?.restoreRequest?.deckId === deckId;
  const canEdit = hasEditPermission && !sourceConflict && !pendingSourceRestore;
  const commitTitle = useCallback(
    async (value: string) => {
      const nextTitle = value.trim();
      if (
        !canEdit ||
        !onTitleChange ||
        structuralSaving ||
        !nextTitle ||
        nextTitle === title.trim()
      ) {
        setTitleDraft(title);
        return;
      }
      setSaveError(null);
      try {
        await onTitleChange(nextTitle);
        setTitleDraft(nextTitle);
      } catch (error) {
        setSaveError(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
        setTitleDraft(title);
      }
    },
    [canEdit, onTitleChange, structuralSaving, t, title],
  );
  const finishTitleEdit = useCallback(
    async (value: string) => {
      if (titleCommitInFlightRef.current) return;
      if (!canEdit || !onTitleChange || structuralSaving) {
        setTitleDraft(title);
        setTitleEditing(false);
        return;
      }
      titleCommitInFlightRef.current = true;
      setTitleSaving(true);
      try {
        await commitTitle(value);
      } finally {
        titleCommitInFlightRef.current = false;
        setTitleSaving(false);
        setTitleEditing(false);
      }
    },
    [canEdit, commitTitle, onTitleChange, structuralSaving, title],
  );
  const handleTitleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        discardTitleDraftOnBlurRef.current = true;
        setTitleDraft(title);
        setTitleEditing(false);
        event.currentTarget.blur();
      }
    },
    [title],
  );
  const [notesDraft, setNotesDraft] = useState(notes);
  const [assetBrowserOpen, setAssetBrowserOpen] = useState(false);
  const [imageCropOpen, setImageCropOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [localOverviewOpen, setLocalOverviewOpen] = useState(false);
  const overviewOpen = suppliedOverviewOpen ?? localOverviewOpen;
  const setOverviewOpen = useCallback(
    (update: boolean | ((open: boolean) => boolean)) => {
      const nextOpen =
        typeof update === "function" ? update(overviewOpen) : update;
      if (suppliedOverviewOpen === undefined) setLocalOverviewOpen(nextOpen);
      onOverviewOpenChange?.(nextOpen);
    },
    [onOverviewOpenChange, overviewOpen, suppliedOverviewOpen],
  );
  const [focusedOverviewIndex, setFocusedOverviewIndex] = useState(activeIndex);
  const [commentMode, setCommentMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentDraftAnchor, setCommentDraftAnchor] =
    useState<SlideCommentAnchor | null>(null);
  const exportMenuRef = useRef<Slides2ExportMenuHandle>(null);
  const controllerRef = useRef<SlideFrameController | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overviewGridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const commentGestureRef = useRef<{
    pointerId: number;
    start: Point;
    moved: boolean;
    target: ElementSnapshot | null;
  } | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const editorCommandHandlerRef = useRef<
    (operation: SlideEditorCommand["operation"]) => Promise<boolean>
  >(async () => false);
  const editorCommandPollRetryAttemptsRef = useRef(0);
  const editorCommandPollActiveRef = useRef(false);
  const editorCommandPollRequestedRef = useRef(false);
  const editorCommandPollRef = useRef<(() => Promise<void>) | null>(null);
  const bumpHistoryVersion = useCallback(() => {
    const nextVersion = historyVersionRef.current + 1;
    historyVersionRef.current = nextVersion;
    setHistoryVersion(nextVersion);
  }, []);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (overviewOpen) setFocusedOverviewIndex(activeIndex);
  }, [activeIndex, overviewOpen]);

  useEffect(() => {
    if (!overviewOpen) return;
    const button = overviewGridRef.current?.querySelector<HTMLButtonElement>(
      `[data-slide-overview-index="${focusedOverviewIndex}"]`,
    );
    button?.focus();
    button?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [focusedOverviewIndex, overviewOpen]);

  useEffect(() => {
    setTextRangeStyleSnapshot(null);
    setSelectedTextRange(null);
  }, [source.id, source.revision, source.sourceHash]);

  useEffect(() => {
    if (suppliedSlideRailWidth !== undefined) return;
    let cancelled = false;
    void readClientAppState<unknown>(SLIDE_RAIL_WIDTH_STATE_KEY)
      .then((savedState) => {
        if (cancelled || slideRailTouchedRef.current) return;
        if (savedState === null) return;
        const savedWidth = readSlideRailWidth(savedState);
        if (savedWidth === null) {
          console.error("The saved slide rail width preference is invalid.");
          return;
        }
        slideRailWidthRef.current = savedWidth;
        setLocalSlideRailWidth(savedWidth);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(
            "Could not read the slide rail width preference.",
            error,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [suppliedSlideRailWidth]);

  const updateSlideRailWidth = useCallback(
    (width: number) => {
      const nextWidth = clampSlideRailWidth(width);
      slideRailTouchedRef.current = true;
      slideRailWidthRef.current = nextWidth;
      if (suppliedSlideRailWidth === undefined)
        setLocalSlideRailWidth(nextWidth);
      onSlideRailWidthChange?.(nextWidth);
      return nextWidth;
    },
    [onSlideRailWidthChange, suppliedSlideRailWidth],
  );

  const persistSlideRailWidth = useCallback((width: number) => {
    void writeClientAppState(
      SLIDE_RAIL_WIDTH_STATE_KEY,
      { width },
      { keepalive: true, requestSource: TAB_ID },
    ).catch((error) => {
      console.error("Could not save the slide rail width preference.", error);
    });
  }, []);

  const handleSlideRailResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      slideRailTouchedRef.current = true;
      slideRailResizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: slideRailWidthRef.current,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handleSlideRailResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resize = slideRailResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      updateSlideRailWidth(resize.startWidth + event.clientX - resize.startX);
    },
    [updateSlideRailWidth],
  );

  const finishSlideRailResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resize = slideRailResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      slideRailResizeRef.current = null;
      const width = slideRailWidthRef.current;
      if (width !== resize.startWidth) persistSlideRailWidth(width);
    },
    [persistSlideRailWidth],
  );

  const handleSlideRailResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(event.key)
      ) {
        return;
      }
      event.stopPropagation();
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        return;
      }
      const step = event.shiftKey ? 32 : 8;
      let nextWidth: number | null = null;
      if (event.key === "ArrowLeft") {
        nextWidth = slideRailWidthRef.current - step;
      } else if (event.key === "ArrowRight") {
        nextWidth = slideRailWidthRef.current + step;
      } else if (event.key === "Home") {
        nextWidth = MIN_SLIDE_RAIL_WIDTH;
      } else if (event.key === "End") {
        nextWidth = MAX_SLIDE_RAIL_WIDTH;
      }
      if (nextWidth === null) return;
      event.preventDefault();
      event.stopPropagation();
      const previousWidth = slideRailWidthRef.current;
      const width = updateSlideRailWidth(nextWidth);
      if (width !== previousWidth) persistSlideRailWidth(width);
    },
    [persistSlideRailWidth, updateSlideRailWidth],
  );

  const selected = useMemo(
    () =>
      selectedIds.flatMap((id) => nodes.filter((node) => node.nodeId === id)),
    [nodes, selectedIds],
  );
  const overlaySelected = useMemo(
    () =>
      (gestureSelectionIds ?? selectedIds).flatMap((id) =>
        nodes.filter((node) => node.nodeId === id),
      ),
    [gestureSelectionIds, nodes, selectedIds],
  );
  const distinctSelected = useMemo(() => uniqueByLocator(selected), [selected]);
  const rejectUnsafeRenderedTargets = useCallback(
    (targets: Array<Pick<SourceSelection, "line" | "column">>) => {
      if (hasUniqueRenderedInstances(targets, nodes)) return false;
      toast.error(t("slides2Editor.objectStructureUnsupported"));
      return true;
    },
    [nodes, t],
  );
  const selectedGroupChildIds = useMemo(() => {
    if (distinctSelected.length !== 1) return null;
    const target = distinctSelected[0];
    return target
      ? sourceGroupChildIds(committedSource.sourceTsx, target)
      : null;
  }, [committedSource.sourceTsx, distinctSelected]);
  const inspectSelectedTextRange = useCallback(
    (range: { start: number; end: number; expectedText: string } | null) => {
      if (!range) {
        setSelectedTextRange(null);
        setTextRangeStyleSnapshot(null);
        return;
      }
      const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
      if (
        !target ||
        range.expectedText.length > MAX_SLIDE_TEXT_RANGE_EXPECTED_TEXT_LENGTH ||
        !Number.isInteger(range.start) ||
        !Number.isInteger(range.end) ||
        range.start < 0 ||
        range.end <= range.start ||
        range.end > range.expectedText.length
      ) {
        setSelectedTextRange(null);
        setTextRangeStyleSnapshot(null);
        return;
      }
      const nextRange = {
        slideId: source.id,
        sourceLine: target.line,
        sourceColumn: target.column,
        sourceRevision: source.revision,
        sourceHash: source.sourceHash,
        ...range,
      };
      if (
        !currentSlideTextRangeSelection(
          nextRange,
          {
            slideId: source.id,
            revision: source.revision,
            sourceHash: source.sourceHash,
          },
          { line: target.line, column: target.column },
        )
      ) {
        setSelectedTextRange(null);
        setTextRangeStyleSnapshot(null);
        return;
      }
      setSelectedTextRange(nextRange);
      controllerRef.current?.send({
        type: "inspect-text-range",
        target: {
          line: target.line,
          column: target.column,
          nodeId: target.nodeId,
        },
        ...range,
      });
    },
    [distinctSelected, source.id, source.revision, source.sourceHash],
  );
  const selectedParentNode = useMemo(() => {
    if (distinctSelected.length !== 1) return null;
    const parent = getParentSourceSelection(
      committedSource.sourceTsx,
      distinctSelected[0]!,
    );
    return parent
      ? (nodes.find(
          (node) => node.line === parent.line && node.column === parent.column,
        ) ?? null)
      : null;
  }, [committedSource.sourceTsx, distinctSelected, nodes]);
  const selectedImage =
    distinctSelected.length === 1 &&
    distinctSelected[0]?.tagName.toLowerCase() === "img"
      ? distinctSelected[0]
      : null;
  const selectedImageAssetId = useMemo(
    () =>
      selectedImage
        ? getSelectedAssetId(source.sourceTsx, selectedImage)
        : null,
    [selectedImage, source.sourceTsx],
  );
  const imageAssetsQuery = useActionQuery(
    "list-assets",
    { scope: "deck", deckId },
    { enabled: Boolean(selectedImageAssetId) },
  );
  const selectedImageAsset = imageAssetsQuery.data?.find(
    (asset) => asset.id === selectedImageAssetId,
  );
  const selectedImageSrc =
    cropImageUrl(selectedImageAsset?.url) ??
    cropImageUrl(selectedImage?.imageSrc);
  const selectionBounds = useMemo(
    () => unionRects(selected.map((node) => node.bounds)),
    [selected],
  );
  const overlaySelectionBounds = useMemo(
    () => unionRects(overlaySelected.map((node) => node.bounds)),
    [overlaySelected],
  );
  const hasUnsavedEdits = currentHistoryIndex > 0;
  const hasUnsavedEditsRef = useRef(hasUnsavedEdits);
  hasUnsavedEditsRef.current = hasUnsavedEdits;
  const inspectSavedTextRange = useCallback(
    (range: { start: number; end: number; expectedText: string } | null) => {
      if (hasUnsavedEditsRef.current) {
        setSelectedTextRange(null);
        return;
      }
      inspectSelectedTextRange(range);
    },
    [inspectSelectedTextRange],
  );
  const hasPendingUndo = crossSlideHistory
    ? crossSlideHistory.canUndo
    : currentHistoryIndex > 0;
  const hasPendingRedo = crossSlideHistory
    ? crossSlideHistory.canRedo
    : currentHistoryIndex < currentEditBatches.length;
  const canUndo = crossSlideHistory
    ? crossSlideHistory.canUndo
    : hasPendingUndo || (!hasUnsavedEdits && committedHistoryIndex > 0);
  const canRedo = crossSlideHistory
    ? crossSlideHistory.canRedo
    : hasPendingRedo ||
      (!hasUnsavedEdits && committedHistoryIndex < committedHistory.length - 1);
  const activeEdits = useMemo(
    () => currentEditBatches.slice(0, currentHistoryIndex).flat(),
    [currentEditBatches, currentHistoryIndex],
  );
  const restoreActivePreview = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const patches = getPreviewPatches(activeEdits);
    if (patches.length) controller.send({ type: "preview", patches });
    else controller.send({ type: "clear-preview" });
  }, [activeEdits]);
  const activeSlide = slides[activeIndex];
  const canEditSelectedText =
    canEdit &&
    !commentMode &&
    !inlineNode &&
    !commandMenuOpen &&
    !assetBrowserOpen &&
    !imageCropOpen &&
    !overviewOpen &&
    distinctSelected.length === 1 &&
    Boolean(distinctSelected[0]?.text.trim());
  const assetTarget =
    distinctSelected.length === 1 ? distinctSelected[0] : null;
  const hasImageTarget =
    assetTarget !== null && isImagePlaceholder(assetTarget, source.sourceTsx);

  const editorStatus = useMemo(
    () =>
      slideEditorStatusSchema.parse({
        protocolVersion: 1,
        deckId,
        slideId: source.id,
        editorSessionId: editorSessionIdRef.current,
        historyVersion,
        sourceRevision: committedSource.revision,
        sourceHash: committedSource.sourceHash,
        hasPendingEdits: hasUnsavedEdits,
        canUndo:
          canUndo &&
          canEdit &&
          !saving &&
          !structuralSaving &&
          !reloadingSource,
        canRedo:
          canRedo &&
          canEdit &&
          !saving &&
          !structuralSaving &&
          !reloadingSource,
        canSave:
          hasUnsavedEdits &&
          canEdit &&
          !saving &&
          !structuralSaving &&
          !reloadingSource,
      }),
    [
      canEdit,
      canRedo,
      canUndo,
      committedSource.revision,
      committedSource.sourceHash,
      deckId,
      hasUnsavedEdits,
      historyVersion,
      reloadingSource,
      saving,
      source.id,
      structuralSaving,
    ],
  );
  const editorStatusRef = useRef(editorStatus);
  editorStatusRef.current = editorStatus;
  useEffect(() => {
    const key = appStateKeyForBrowserTab(
      appStateKey(SLIDE_EDITOR_STATUS_KEY),
      TAB_ID,
    );
    void writeClientAppState(key, editorStatus, {
      requestSource: TAB_ID,
    }).catch((error) =>
      console.error("Could not update the slide editor status.", error),
    );
  }, [editorStatus]);

  const selectParent = useCallback(() => {
    if (selectedParentNode) setSelectedIds([selectedParentNode.nodeId]);
  }, [selectedParentNode]);

  const recordCommittedSource = useCallback(
    (
      nextSource: Pick<SlideSource, "sourceTsx" | "revision" | "sourceHash">,
      addToHistory = true,
    ) => {
      bumpHistoryVersion();
      const previous = committedSourceRef.current;
      const next = { ...previous, ...nextSource };
      committedSourceRef.current = next;
      setCommittedSource(next);
      if (addToHistory) {
        if (crossSlideHistory) {
          crossSlideHistory.commit({
            slideId: source.id,
            beforeSourceTsx: previous.sourceTsx,
            beforeSourceHash: previous.sourceHash,
            afterSourceTsx: next.sourceTsx,
            afterSourceHash: next.sourceHash,
            selection: null,
          });
        } else {
          const history = [
            ...committedHistoryRef.current.slice(
              0,
              committedHistoryIndexRef.current + 1,
            ),
            next.sourceTsx,
          ].slice(-EDIT_HISTORY_LIMIT);
          committedHistoryRef.current = history;
          committedHistoryIndexRef.current = history.length - 1;
          setCommittedHistory(history);
          setCommittedHistoryIndex(history.length - 1);
        }
      }
    },
    [bumpHistoryVersion, crossSlideHistory, source.id],
  );

  useEffect(() => {
    const request = crossSlideHistory?.restoreRequest;
    if (
      !request ||
      request.deckId !== deckId ||
      request.slideId !== source.id
    ) {
      if (!request || request.deckId !== deckId) {
        processingHistoryRestoreRef.current = null;
      }
      return;
    }
    if (processingHistoryRestoreRef.current === request.requestId) return;
    processingHistoryRestoreRef.current = request.requestId;

    const restoreSource = async () => {
      if (source.sourceHash !== request.expectedSourceHash) {
        setSaveError(t("editorErrors.slideChanged"));
        crossSlideHistory?.onSourceRestoreComplete?.(request.requestId, null);
        return;
      }
      bumpHistoryVersion();
      setSaveError(null);
      try {
        const result = await onRestore(request.sourceTsx, {
          revision: source.revision,
          sourceHash: source.sourceHash,
        });
        recordCommittedSource(result, false);
        setEditBatches([]);
        setHistoryIndex(0);
        selectedIdsRef.current = [];
        setSelectedIds([]);
        controllerRef.current?.send({ type: "clear-preview" });
        crossSlideHistory?.onSourceRestoreComplete?.(request.requestId, {
          revision: result.revision,
          sourceHash: result.sourceHash,
        });
      } catch (error) {
        setSaveError(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
        crossSlideHistory?.onSourceRestoreComplete?.(request.requestId, null);
      }
    };

    void restoreSource();
  }, [
    bumpHistoryVersion,
    crossSlideHistory,
    deckId,
    onRestore,
    recordCommittedSource,
    source,
    t,
  ]);

  const reloadConflictedSource = useCallback(async () => {
    if (!sourceConflict || reloadingSource) return;
    setReloadingSource(true);
    try {
      const latest = await onReloadSource();
      bumpHistoryVersion();
      const committed = {
        sourceTsx: latest.sourceTsx,
        revision: latest.revision,
        sourceHash: latest.sourceHash,
      };
      committedSourceRef.current = committed;
      setCommittedSource(committed);
      const history = [latest.sourceTsx];
      committedHistoryRef.current = history;
      committedHistoryIndexRef.current = 0;
      setCommittedHistory(history);
      setCommittedHistoryIndex(0);
      setEditBatches([]);
      setHistoryIndex(0);
      crossSlideHistory?.clear();
      selectedIdsRef.current = [];
      setSelectedIds([]);
      setNodes([]);
      setTextRangeStyleSnapshot(null);
      setInlineNode(null);
      setPendingSourceSelection(null);
      controllerRef.current?.send({ type: "clear-preview" });
      setSaveError(null);
    } catch (error) {
      setSaveError(
        t(
          getEditorActionErrorTranslationKey(error) ??
            "editorErrors.deckDataUnavailable",
        ),
      );
    } finally {
      setReloadingSource(false);
    }
  }, [
    bumpHistoryVersion,
    crossSlideHistory,
    onReloadSource,
    reloadingSource,
    sourceConflict,
    t,
  ]);

  useEffect(() => setNotesDraft(notes), [notes]);

  const handleThumbnailNavigate = useCallback(
    (index: number, direction: -1 | 1) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= slides.length) return;
      slideRailListRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-slides-2-thumbnail-index="${nextIndex}"]`,
        )
        ?.focus();
      onSelectSlide(nextIndex);
    },
    [onSelectSlide, slides.length],
  );

  const handleThumbnailDragStart = useCallback(
    (event: DragStartEvent) => {
      const index = slides.findIndex((slide) => slide.id === event.active.id);
      if (index >= 0) onSelectSlide(index);
    },
    [onSelectSlide, slides],
  );

  const handleThumbnailDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!event.over || event.active.id === event.over.id) return;
      const from = slides.findIndex((slide) => slide.id === event.active.id);
      const to = slides.findIndex((slide) => slide.id === event.over?.id);
      if (from >= 0 && to >= 0) onMoveSlide(from, to);
    },
    [onMoveSlide, slides],
  );

  useEffect(() => {
    if (source.revision < committedSource.revision) return;
    if (source.sourceHash === committedSource.sourceHash || hasUnsavedEdits)
      return;
    bumpHistoryVersion();
    const history = [...committedHistoryRef.current, source.sourceTsx].slice(
      -EDIT_HISTORY_LIMIT,
    );
    setCommittedSource({
      sourceTsx: source.sourceTsx,
      revision: source.revision,
      sourceHash: source.sourceHash,
    });
    committedSourceRef.current = {
      sourceTsx: source.sourceTsx,
      revision: source.revision,
      sourceHash: source.sourceHash,
    };
    committedHistoryRef.current = history;
    committedHistoryIndexRef.current = history.length - 1;
    setCommittedHistory(history);
    setCommittedHistoryIndex(history.length - 1);
    setEditBatches([]);
    setHistoryIndex(0);
    crossSlideHistory?.clear();
    selectedIdsRef.current = [];
    setSelectedIds([]);
  }, [
    committedHistory,
    committedSource.revision,
    committedSource.sourceHash,
    hasUnsavedEdits,
    source.revision,
    source.sourceHash,
    source.sourceTsx,
    bumpHistoryVersion,
    crossSlideHistory,
  ]);

  useEffect(() => {
    if (hasUnsavedEdits) setSelectedTextRange(null);
  }, [hasUnsavedEdits]);

  useEffect(() => {
    const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
    const textRange = currentAgentTextRangeSelection(
      selectedTextRange,
      {
        slideId: source.id,
        revision: source.revision,
        sourceHash: source.sourceHash,
      },
      target ? { line: target.line, column: target.column } : null,
      hasUnsavedEdits,
    );
    onSelectionChange(selected, textRange);
  }, [
    distinctSelected,
    hasUnsavedEdits,
    onSelectionChange,
    selected,
    selectedTextRange,
    source.id,
    source.revision,
    source.sourceHash,
  ]);

  useEffect(() => {
    onPanelChange?.(inspectorOpen ? activePanel : null);
  }, [activePanel, inspectorOpen, onPanelChange]);

  useEffect(() => {
    if (!pendingSourceSelection) return;
    if (artifact?.revision !== pendingSourceSelection.revision) {
      if (
        typeof artifact?.revision === "number" &&
        artifact.revision > pendingSourceSelection.revision
      ) {
        setPendingSourceSelection(null);
      }
      return;
    }
    const targets = pendingSourceSelection.selections.map((selection) =>
      nodes.find(
        (node) =>
          node.line === selection.line && node.column === selection.column,
      ),
    );
    if (targets.some((target) => !target)) return;
    const resolvedTargets = targets as ElementSnapshot[];
    const nextSelectedIds = resolvedTargets.map((target) => target.nodeId);
    selectedIdsRef.current = nextSelectedIds;
    setSelectedIds(nextSelectedIds);
    controllerRef.current?.send({
      type: "inspect",
      targets: resolvedTargets.map((target) => ({
        line: target.line,
        column: target.column,
        nodeId: target.nodeId,
      })),
    });
    setPendingSourceSelection(null);
  }, [artifact?.revision, nodes, pendingSourceSelection]);

  useEffect(() => {
    const request = crossSlideHistory?.selection;
    if (!request || request.slideId !== source.id) return;
    if (appliedHistorySelectionRef.current === request.requestId) return;
    if (
      request.sourceRevision !== source.revision ||
      request.sourceHash !== source.sourceHash
    ) {
      appliedHistorySelectionRef.current = request.requestId;
      crossSlideHistory.onSelectionApplied(request.requestId);
      return;
    }
    if (
      artifact?.revision !== request.sourceRevision ||
      artifact?.sourceHash !== request.sourceHash
    ) {
      return;
    }
    const target = nodes.find(
      (node) => node.line === request.line && node.column === request.column,
    );
    if (!target) return;
    appliedHistorySelectionRef.current = request.requestId;
    selectedIdsRef.current = [target.nodeId];
    setSelectedIds([target.nodeId]);
    setSelectedTextRange(null);
    controllerRef.current?.send({
      type: "inspect",
      targets: [
        { line: target.line, column: target.column, nodeId: target.nodeId },
      ],
    });
    crossSlideHistory.onSelectionApplied(request.requestId);
  }, [
    artifact?.revision,
    artifact?.sourceHash,
    crossSlideHistory,
    nodes,
    source,
  ]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const patches = getPreviewPatches(activeEdits);
    if (patches.length) controller.send({ type: "preview", patches });
    else controller.send({ type: "clear-preview" });
  }, [activeEdits, artifact?.sourceHash]);

  const handleDesignTokenPreview = useCallback((tokens: SlideDesignTokens) => {
    controllerRef.current?.send({ type: "set-design-tokens", tokens });
  }, []);

  const appendEdits = useCallback(
    (edits: SourceEdit[]) => {
      if (!edits.length) return;
      if (rejectUnsafeRenderedTargets(edits)) return;
      bumpHistoryVersion();
      setSaveError(null);
      if (crossSlideHistory) {
        crossSlideHistory.append(edits);
      } else {
        const bounded = [...editBatches.slice(0, historyIndex), edits].slice(
          -EDIT_HISTORY_LIMIT,
        );
        setEditBatches(bounded);
        setHistoryIndex(bounded.length);
      }
    },
    [
      bumpHistoryVersion,
      crossSlideHistory,
      editBatches,
      historyIndex,
      rejectUnsafeRenderedTargets,
    ],
  );

  const applyImageCrop = useCallback(
    (result: Slides2ImageCropResult) => {
      const node = selectedImage;
      if (!node) return;
      const ops: SourceEditOp[] = imageCropStyleEdits(result).map(
        ({ key, value }) => ({
          kind: "set-style" as const,
          key,
          value,
          ...(node.text ? { prevText: node.text } : {}),
        }),
      );
      appendEdits([editFor(node, ops)]);
      setImageCropOpen(false);
    },
    [appendEdits, selectedImage],
  );

  const inspect = useCallback(
    (ids: string[]) => {
      const targets = ids.flatMap((nodeId) => {
        const node = nodes.find((entry) => entry.nodeId === nodeId);
        return node ? [{ line: node.line, column: node.column, nodeId }] : [];
      });
      if (targets.length)
        controllerRef.current?.send({ type: "inspect", targets });
    },
    [nodes],
  );

  const openInlineTextEditor = useCallback(
    (target: ElementSnapshot | null | undefined, point?: Point) => {
      if (!canEdit || !target?.text.trim()) return;
      setHoveredTarget(null);
      const ids = [target.nodeId];
      selectedIdsRef.current = ids;
      setSelectedIds(ids);
      setNodes((current) => [
        ...current.filter((node) => node.nodeId !== target.nodeId),
        target,
      ]);
      setGuideLines([]);
      setInlineNode(target);
      setInlineTextPoint(point ?? null);
      controllerRef.current?.send({
        type: "inspect",
        targets: [
          { line: target.line, column: target.column, nodeId: target.nodeId },
        ],
      });
    },
    [canEdit],
  );

  const openImageCrop = useCallback(
    (target: ElementSnapshot | null | undefined) => {
      if (!canEdit || target?.tagName.toLowerCase() !== "img") return;
      setHoveredTarget(null);
      const ids = [target.nodeId];
      selectedIdsRef.current = ids;
      setSelectedIds(ids);
      setNodes((current) => [
        ...current.filter((node) => node.nodeId !== target.nodeId),
        target,
      ]);
      setGuideLines([]);
      setInlineNode(null);
      setImageCropOpen(true);
      controllerRef.current?.send({
        type: "inspect",
        targets: [
          { line: target.line, column: target.column, nodeId: target.nodeId },
        ],
      });
    },
    [canEdit],
  );

  const handleNodes = useCallback((nextNodes: ElementSnapshot[]) => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.nodeId, node]));
      const nextById = new Map(nextNodes.map((node) => [node.nodeId, node]));
      for (const node of nextNodes) {
        const previous = currentById.get(node.nodeId);
        if (!previous) continue;
        const keepTransform = Boolean(previous.transform && !node.transform);
        const keepImageSrc = Boolean(previous.imageSrc && !node.imageSrc);
        if (keepTransform || keepImageSrc) {
          nextById.set(node.nodeId, {
            ...node,
            ...(keepTransform ? { transform: previous.transform } : {}),
            ...(keepImageSrc ? { imageSrc: previous.imageSrc } : {}),
          });
        }
      }
      return [...nextById.values()];
    });
  }, []);

  const setHoveredNode = useCallback(
    (nodeId: string | null) => {
      setHoveredTarget((current) => {
        if (nodeId === null) return current === null ? current : null;
        if (current?.slideId === source.id && current.nodeId === nodeId) {
          return current;
        }
        return { slideId: source.id, nodeId };
      });
    },
    [source.id],
  );

  useEffect(() => {
    if (commentMode) setHoveredNode(null);
  }, [commentMode, setHoveredNode]);

  const selectionNodes = useCallback(
    (ids: string[]) =>
      uniqueByLocator(
        ids.flatMap((id) => nodes.filter((node) => node.nodeId === id)),
      ),
    [nodes],
  );

  const updatePreviewForMove = useCallback(
    (
      initial: ElementSnapshot[],
      dx: number,
      dy: number,
      snap = true,
      lockAxis = false,
    ) => {
      const primary = initial[0];
      if (!primary)
        return { dx, dy, guides: [] as ReturnType<typeof snapMove>["guides"] };
      const horizontal = lockAxis && Math.abs(dx) >= Math.abs(dy);
      const vertical = lockAxis && !horizontal;
      const delta = constrainMoveDelta({ x: dx, y: dy }, lockAxis);
      const movingBounds =
        unionRects(initial.map((node) => node.bounds)) ?? primary.bounds;
      const otherRects = nodes
        .filter(
          (node) => !initial.some((entry) => entry.nodeId === node.nodeId),
        )
        .map((node) => node.bounds);
      const targets = [...otherRects, SLIDES_2_BOUNDS];
      const stageWidth = stageRef.current?.getBoundingClientRect().width;
      const canvasScale = stageWidth ? stageWidth / 1920 : 1;
      const result = snap
        ? snapMove(movingBounds, delta, targets, 6 / canvasScale)
        : { delta, guides: [] };
      const snappedDelta = {
        x: vertical ? 0 : result.delta.x,
        y: horizontal ? 0 : result.delta.y,
      };
      const guides = result.guides.filter(
        (guide) =>
          !(horizontal && guide.axis === "y") &&
          !(vertical && guide.axis === "x"),
      );
      setGuideLines(guides);
      const patches = uniqueByLocator(initial).map((node) => {
        const edit = applyTranslate(node, snappedDelta.x, snappedDelta.y);
        return {
          line: edit.line,
          column: edit.column,
          styles: {
            translate:
              edit.ops[0]?.kind === "set-style" ? edit.ops[0].value : null,
          },
        };
      });
      controllerRef.current?.send({ type: "preview", patches });
      return { dx: snappedDelta.x, dy: snappedDelta.y, guides };
    },
    [nodes],
  );

  const beginPointerInteraction = useCallback(
    (pointer: FramePointer) => {
      if (pointer.phase !== "down" || pointer.button !== 0) return;
      const hitTarget = preferredPointerTarget(pointer)?.snapshot;
      const target =
        hitTarget &&
        isFullSlideBounds(hitTarget.bounds) &&
        !selectedIdsRef.current.includes(hitTarget.nodeId)
          ? null
          : hitTarget;
      if (!target) {
        setGestureSelectionIds(
          pointer.shiftKey ? [...selectedIdsRef.current] : [],
        );
        dragRef.current = {
          mode: "marquee",
          pointerId: pointer.pointerId,
          start: { x: pointer.x, y: pointer.y },
          moved: false,
          nodeIds: [],
          initial: [],
          additive: pointer.shiftKey,
          ...(pointer.shiftKey
            ? { initialSelection: [...selectedIdsRef.current] }
            : {}),
          marquee: { x: pointer.x, y: pointer.y, width: 0, height: 0 },
        };
        return;
      }

      const previousIds = selectedIdsRef.current;
      const previousNodes = previousIds.flatMap((id) => {
        const node =
          id === target.nodeId
            ? target
            : nodes.find((candidate) => candidate.nodeId === id);
        return node ? [node] : [];
      });
      const selectedAncestor = previousNodes.find(
        (node) => isSourceAncestor(node, target) === true,
      );
      const wasSelected = previousIds.includes(target.nodeId);
      const commandModifier = pointer.ctrlKey || pointer.metaKey;
      const hasUnprovenRelation = previousIds.some((id) => {
        if (id === target.nodeId) return false;
        const node = previousNodes.find((candidate) => candidate.nodeId === id);
        return !node || selectionRelation(node, target) === "unknown";
      });
      if (hasUnprovenRelation && !wasSelected) {
        dragRef.current = null;
        return;
      }
      let nextIds: string[];
      if (pointer.shiftKey && wasSelected) {
        nextIds = previousIds.filter((id) => id !== target.nodeId);
      } else if (pointer.shiftKey || (commandModifier && selectedAncestor)) {
        const independentIds = removeRelatedSelectionIds(
          previousIds.filter((id) => id !== target.nodeId),
          target,
          [...nodes, target],
        );
        if (independentIds === null) {
          dragRef.current = null;
          return;
        }
        nextIds = [...independentIds, target.nodeId];
      } else if (selectedAncestor || wasSelected) {
        nextIds = previousIds;
      } else {
        nextIds = [target.nodeId];
      }
      selectedIdsRef.current = nextIds;
      setSelectedIds(nextIds);
      setNodes((current) => {
        const exists = current.some((node) => node.nodeId === target.nodeId);
        return exists
          ? current.map((node) =>
              node.nodeId === target.nodeId ? target : node,
            )
          : [...current, target];
      });
      if (!canEdit) {
        dragRef.current = null;
        window.requestAnimationFrame(() => inspect(nextIds));
        return;
      }
      const dragIds = pointer.shiftKey && wasSelected ? previousIds : nextIds;
      const selectedBase = selectionNodes(dragIds).map((node) =>
        node.nodeId === target.nodeId ? target : node,
      );
      if (
        nextIds.includes(target.nodeId) &&
        !selectedBase.some((node) => node.nodeId === target.nodeId)
      ) {
        selectedBase.push(target);
      }
      dragRef.current = {
        mode: "move",
        pointerId: pointer.pointerId,
        start: { x: pointer.x, y: pointer.y },
        moved: false,
        nodeIds: dragIds,
        initial: selectedBase,
      };
      window.requestAnimationFrame(() => inspect(nextIds));
    },
    [canEdit, inspect, selectionNodes],
  );

  const handleFramePointer = useCallback(
    (pointer: FramePointer) => {
      if (commentMode) {
        if (pointer.phase === "down" && pointer.button === 0) {
          commentGestureRef.current = {
            pointerId: pointer.pointerId,
            start: { x: pointer.x, y: pointer.y },
            moved: false,
            target: preferredPointerTarget(pointer)?.snapshot ?? null,
          };
          return;
        }
        const gesture = commentGestureRef.current;
        if (!gesture || gesture.pointerId !== pointer.pointerId) return;
        if (pointer.phase === "move") {
          gesture.moved ||=
            Math.hypot(
              pointer.x - gesture.start.x,
              pointer.y - gesture.start.y,
            ) > 4;
          return;
        }
        if (pointer.phase === "up" || pointer.phase === "cancel") {
          commentGestureRef.current = null;
          if (pointer.phase !== "up") return;

          const target =
            preferredPointerTarget(pointer)?.snapshot ?? gesture.target;
          const slideRect = { left: 0, top: 0, width: 1920, height: 1080 };
          void (async () => {
            let sourceHash =
              artifact?.sourceHash === committedSource.sourceHash
                ? committedSource.sourceHash
                : null;
            if (hasUnsavedEdits) {
              if (!(await saveRef.current())) return;
              sourceHash = committedSourceRef.current.sourceHash;
            }

            if (gesture.moved) {
              if (!sourceHash) return;
              const left = Math.min(gesture.start.x, pointer.x);
              const top = Math.min(gesture.start.y, pointer.y);
              const right = Math.max(gesture.start.x, pointer.x);
              const bottom = Math.max(gesture.start.y, pointer.y);
              const regionTarget =
                nodes
                  .filter(
                    (node) =>
                      node.bounds.x <= left &&
                      node.bounds.y <= top &&
                      node.bounds.x + node.bounds.width >= right &&
                      node.bounds.y + node.bounds.height >= bottom,
                  )
                  .sort(
                    (a, b) =>
                      a.bounds.width * a.bounds.height -
                      b.bounds.width * b.bounds.height,
                  )[0] ??
                nodes
                  .slice()
                  .sort(
                    (a, b) =>
                      b.bounds.width * b.bounds.height -
                      a.bounds.width * a.bounds.height,
                  )[0];
              setCommentDraftAnchor(
                slideCommentAnchorForRegion({
                  start: gesture.start,
                  end: { x: pointer.x, y: pointer.y },
                  slideRect,
                  sourceHash,
                  ...(regionTarget
                    ? {
                        sourceLocator: {
                          line: regionTarget.line,
                          column: regionTarget.column,
                        },
                      }
                    : {}),
                }),
              );
              return;
            }

            setCommentDraftAnchor(
              slideCommentAnchorAtPoint({
                clientX: pointer.x,
                clientY: pointer.y,
                slideRect,
                objectRect: target
                  ? {
                      left: target.bounds.x,
                      top: target.bounds.y,
                      width: target.bounds.width,
                      height: target.bounds.height,
                    }
                  : undefined,
                sourceHash: sourceHash ?? undefined,
                sourceLocator:
                  sourceHash && target
                    ? { line: target.line, column: target.column }
                    : undefined,
              }),
            );
          })();
        }
        return;
      }
      if (pointer.phase === "double-click") {
        const target = preferredPointerTarget(pointer)?.snapshot;
        if (target?.tagName.toLowerCase() === "img") {
          openImageCrop(target);
        } else {
          openInlineTextEditor(target, { x: pointer.x, y: pointer.y });
        }
        return;
      }
      if (inlineNode) return;
      if (pointer.phase === "down") {
        const pointerTarget = preferredPointerTarget(pointer);
        setHoveredNode(
          pointer.pointerType === "touch"
            ? null
            : (pointerTarget?.nodeId ?? null),
        );
        beginPointerInteraction(pointer);
        return;
      }
      const drag = dragRef.current;
      if (!drag) {
        if (pointer.phase === "move") {
          setHoveredNode(
            pointer.pointerType === "touch"
              ? null
              : (elementAtPoint(nodes, { x: pointer.x, y: pointer.y })
                  ?.nodeId ?? null),
          );
        }
        return;
      }
      if (drag.pointerId !== pointer.pointerId) return;
      if (pointer.phase === "move") {
        const dx = pointer.x - drag.start.x;
        const dy = pointer.y - drag.start.y;
        drag.moved ||= Math.hypot(dx, dy) * fitScale >= 3;
        if (!drag.moved) return;
        if (drag.mode === "move") {
          const snapped = updatePreviewForMove(
            drag.initial,
            dx,
            dy,
            smartGuidesEnabled && !pointer.altKey,
            pointer.shiftKey,
          );
          drag.guides = snapped.guides;
        } else if (drag.mode === "marquee") {
          const nextRect = {
            x: Math.min(drag.start.x, pointer.x),
            y: Math.min(drag.start.y, pointer.y),
            width: Math.abs(pointer.x - drag.start.x),
            height: Math.abs(pointer.y - drag.start.y),
          };
          drag.marquee = nextRect;
          setMarquee(nextRect);
          setGestureSelectionIds(
            marqueeSelectionIds(
              nextRect,
              nodes,
              drag.additive ? (drag.initialSelection ?? []) : [],
            ),
          );
        }
        return;
      }
      if (pointer.phase !== "up" && pointer.phase !== "cancel") return;

      if (pointer.phase === "up") {
        const nextRect = {
          x: Math.min(drag.start.x, pointer.x),
          y: Math.min(drag.start.y, pointer.y),
          width: Math.abs(pointer.x - drag.start.x),
          height: Math.abs(pointer.y - drag.start.y),
        };
        drag.moved ||=
          Math.hypot(pointer.x - drag.start.x, pointer.y - drag.start.y) *
            fitScale >=
          3;
        if (drag.mode === "marquee" && drag.moved) {
          drag.marquee = nextRect;
          setMarquee(nextRect);
          setGestureSelectionIds(
            marqueeSelectionIds(
              nextRect,
              nodes,
              drag.additive ? (drag.initialSelection ?? []) : [],
            ),
          );
        }
      }

      if (pointer.phase === "cancel" && drag.mode === "move" && drag.moved) {
        restoreActivePreview();
      }

      if (drag.mode === "move" && drag.moved && pointer.phase === "up") {
        const dx = pointer.x - drag.start.x;
        const dy = pointer.y - drag.start.y;
        const final = updatePreviewForMove(
          drag.initial,
          dx,
          dy,
          smartGuidesEnabled && !pointer.altKey,
          pointer.shiftKey,
        );
        appendEdits(
          uniqueByLocator(drag.initial).map((node) =>
            applyTranslate(node, final.dx, final.dy),
          ),
        );
        selectedIdsRef.current = drag.nodeIds;
        setSelectedIds(drag.nodeIds);
        window.requestAnimationFrame(() => inspect(drag.nodeIds));
      } else if (
        drag.mode === "marquee" &&
        drag.moved &&
        drag.marquee &&
        pointer.phase === "up"
      ) {
        const nextIds = marqueeSelectionIds(
          drag.marquee,
          nodes,
          drag.additive ? (drag.initialSelection ?? []) : [],
        );
        selectedIdsRef.current = nextIds;
        setSelectedIds(nextIds);
        inspect(nextIds);
      } else if (
        drag.mode === "marquee" &&
        !drag.moved &&
        pointer.phase === "up"
      ) {
        const reportedTarget = pointer.target?.snapshot;
        const pointTarget = preferredPointerTarget(pointer)?.snapshot;
        const hasCanvasTarget =
          reportedTarget && isFullSlideBounds(reportedTarget.bounds);
        const clickTarget =
          pointTarget && !isFullSlideBounds(pointTarget.bounds)
            ? pointTarget
            : !reportedTarget ||
                (hasCanvasTarget &&
                  !selectedIdsRef.current.includes(reportedTarget.nodeId))
              ? elementAtPoint(nodes, { x: pointer.x, y: pointer.y })
              : reportedTarget;
        if (clickTarget) {
          beginPointerInteraction({
            ...pointer,
            phase: "down",
            target: {
              line: clickTarget.line,
              column: clickTarget.column,
              nodeId: clickTarget.nodeId,
              snapshot: clickTarget,
            },
          });
          dragRef.current = null;
        } else if (!drag.additive) {
          selectedIdsRef.current = [];
          setSelectedIds([]);
          inspect([]);
        }
      }
      if (drag.mode === "marquee") setGestureSelectionIds(null);
      dragRef.current = null;
      setMarquee(null);
      setGuideLines([]);
      setHoveredNode(
        pointer.pointerType === "touch"
          ? null
          : (pointer.target?.nodeId ?? null),
      );
    },
    [
      appendEdits,
      beginPointerInteraction,
      canEdit,
      artifact?.sourceHash,
      committedSource.sourceHash,
      commentMode,
      hasUnsavedEdits,
      inspect,
      inlineNode,
      nodes,
      openInlineTextEditor,
      openImageCrop,
      restoreActivePreview,
      setCommentDraftAnchor,
      setCommentMode,
      setHoveredNode,
      updatePreviewForMove,
      smartGuidesEnabled,
      fitScale,
    ],
  );

  const eventPoint = (event: ReactPointerEvent<HTMLElement>): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    const scale = rect?.width ? rect.width / 1920 : 1;
    return {
      x: (event.clientX - (rect?.left ?? 0)) / scale,
      y: (event.clientY - (rect?.top ?? 0)) / scale,
    };
  };

  const startHandle = (
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: ResizeHandle | "rotate",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = selectionBounds;
    const node = selected[0];
    if (!bounds || !node || selected.length !== 1) return;
    const start = eventPoint(event);
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    dragRef.current = {
      mode: handle === "rotate" ? "rotate" : "resize",
      pointerId: event.pointerId,
      start,
      moved: false,
      nodeIds: [node.nodeId],
      initial: [node],
      ...(handle === "rotate" ? {} : { handle }),
      initialRect: bounds,
      initialRotation: node.transform?.rotation ?? 0,
      ...(handle === "rotate"
        ? {
            marquee: {
              x: Math.atan2(start.y - center.y, start.x - center.x),
              y: 0,
              width: 0,
              height: 0,
            },
          }
        : {}),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleTransformKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    handle: ResizeHandle | "rotate",
  ) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      ) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const node = selected[0];
    const bounds = selectionBounds;
    if (
      !canEdit ||
      commentMode ||
      saving ||
      structuralSaving ||
      selected.length !== 1 ||
      !node ||
      !bounds
    ) {
      return;
    }

    if (handle === "rotate") {
      const direction =
        event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
      const rotation =
        node.transform?.rotation ??
        Number.parseFloat(node.styles.rotate ?? "0");
      const currentRotation = Number.isFinite(rotation) ? rotation : 0;
      const nextRotation = event.shiftKey
        ? direction > 0
          ? (Math.floor(currentRotation / 15) + 1) * 15
          : (Math.ceil(currentRotation / 15) - 1) * 15
        : currentRotation + direction;
      appendEdits([
        editFor(node, [
          {
            kind: "set-style",
            key: "rotate",
            value: `${round(nextRotation)}deg`,
            ...(node.text ? { prevText: node.text } : {}),
          },
        ]),
      ]);
      return;
    }

    const horizontal = handle.includes("w") || handle.includes("e");
    const vertical = handle.includes("n") || handle.includes("s");
    const delta = event.shiftKey ? 10 : 1;
    const movement = {
      x:
        event.key === "ArrowLeft"
          ? -delta
          : event.key === "ArrowRight"
            ? delta
            : 0,
      y:
        event.key === "ArrowUp"
          ? -delta
          : event.key === "ArrowDown"
            ? delta
            : 0,
    };
    if ((movement.x !== 0 && !horizontal) || (movement.y !== 0 && !vertical)) {
      return;
    }

    const next = resizeRect(bounds, handle, movement, event.shiftKey);
    if (
      next.x === bounds.x &&
      next.y === bounds.y &&
      next.width === bounds.width &&
      next.height === bounds.height
    ) {
      return;
    }
    const initialSize = {
      width: node.transform?.width ?? node.bounds.width,
      height: node.transform?.height ?? node.bounds.height,
    };
    const solved = resizeDimensionsForBounds(node, initialSize, bounds, next);
    appendEdits([
      editFor(node, [
        {
          kind: "set-style",
          key: "width",
          value: `${Math.max(8, round(solved.width))}px`,
          ...(node.text ? { prevText: node.text } : {}),
        },
        {
          kind: "set-style",
          key: "height",
          value: `${Math.max(8, round(solved.height))}px`,
          ...(node.text ? { prevText: node.text } : {}),
        },
        {
          kind: "set-style",
          key: "translate",
          value: localTranslateForBounds(node, next.x, next.y),
          ...(node.text ? { prevText: node.text } : {}),
        },
      ]),
    ]);
  };

  const handleOverlayPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragRef.current;
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.mode === "move" ||
      drag.mode === "marquee"
    )
      return;
    const point = eventPoint(event);
    const node = drag.initial[0];
    if (!node || !drag.initialRect) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    drag.moved ||= Math.hypot(dx, dy) * fitScale >= 3;
    if (!drag.moved) return;
    if (drag.mode === "rotate") {
      const bounds = drag.initialRect;
      const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      const startAngle = drag.marquee?.x ?? 0;
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      const rotation = snapRotationTo15Degrees(
        (drag.initialRotation ?? 0) + ((angle - startAngle) * 180) / Math.PI,
        event.shiftKey,
      );
      controllerRef.current?.send({
        type: "preview",
        patches: [
          {
            line: node.line,
            column: node.column,
            styles: { rotate: `${round(rotation)}deg` },
          },
        ],
      });
    } else {
      const handle = drag.handle ?? "se";
      const initialSize = {
        width: node.transform?.width ?? node.bounds.width,
        height: node.transform?.height ?? node.bounds.height,
      };
      const next = resizeRect(
        drag.initialRect,
        handle,
        { x: dx, y: dy },
        event.shiftKey,
      );
      const solved = resizeDimensionsForBounds(
        node,
        initialSize,
        drag.initialRect,
        next,
      );
      const patches = [
        {
          line: node.line,
          column: node.column,
          styles: {
            width: `${Math.max(8, round(solved.width))}px`,
            height: `${Math.max(8, round(solved.height))}px`,
            translate: localTranslateForBounds(node, next.x, next.y),
          },
        },
      ];
      controllerRef.current?.send({ type: "preview", patches });
    }
  };

  const finishOverlayPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.mode === "move" ||
      drag.mode === "marquee"
    )
      return;
    if (event.type === "pointercancel") {
      restoreActivePreview();
      dragRef.current = null;
      setGuideLines([]);
      return;
    }
    const point = eventPoint(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    drag.moved ||= Math.hypot(dx, dy) * fitScale >= 3;
    if (drag.moved) {
      const node = drag.initial[0];
      if (node && drag.mode === "rotate") {
        const bounds = drag.initialRect;
        if (bounds) {
          const center = {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
          };
          const startAngle = drag.marquee?.x ?? 0;
          const angle = Math.atan2(point.y - center.y, point.x - center.x);
          const rotation = snapRotationTo15Degrees(
            (drag.initialRotation ?? 0) +
              ((angle - startAngle) * 180) / Math.PI,
            event.shiftKey,
          );
          appendEdits([
            editFor(node, [
              {
                kind: "set-style",
                key: "rotate",
                value: `${round(rotation)}deg`,
                ...(node.text ? { prevText: node.text } : {}),
              },
            ]),
          ]);
        }
      } else if (node && drag.initialRect) {
        const handle = drag.handle ?? "se";
        const initialSize = {
          width: node.transform?.width ?? node.bounds.width,
          height: node.transform?.height ?? node.bounds.height,
        };
        const next = resizeRect(
          drag.initialRect,
          handle,
          { x: dx, y: dy },
          event.shiftKey,
        );
        const solved = resizeDimensionsForBounds(
          node,
          initialSize,
          drag.initialRect,
          next,
        );
        appendEdits([
          editFor(node, [
            {
              kind: "set-style",
              key: "width",
              value: `${Math.max(8, round(solved.width))}px`,
              ...(node.text ? { prevText: node.text } : {}),
            },
            {
              kind: "set-style",
              key: "height",
              value: `${Math.max(8, round(solved.height))}px`,
              ...(node.text ? { prevText: node.text } : {}),
            },
            {
              kind: "set-style",
              key: "translate",
              value: localTranslateForBounds(node, next.x, next.y),
              ...(node.text ? { prevText: node.text } : {}),
            },
          ]),
        ]);
      }
    }
    dragRef.current = null;
  };

  const editSelected = (ops: SourceEditOp[]) => {
    const node = selected[0];
    if (!node) return;
    appendEdits([editFor(node, ops)]);
  };

  const alignSelection = (alignment: Alignment, toSlide: boolean) => {
    const rects = distinctSelected.map((node) => node.bounds);
    const deltas = alignRects(
      rects,
      alignment,
      toSlide || rects.length === 1 ? SLIDES_2_BOUNDS : undefined,
    );
    appendEdits(
      distinctSelected.map((node, index) =>
        applyTranslate(node, deltas[index]?.x ?? 0, deltas[index]?.y ?? 0),
      ),
    );
  };

  const distributeSelection = (axis: "x" | "y") => {
    const deltas = distributeRects(
      distinctSelected.map((node) => node.bounds),
      axis,
    );
    appendEdits(
      distinctSelected.map((node, index) =>
        applyTranslate(node, deltas[index]?.x ?? 0, deltas[index]?.y ?? 0),
      ),
    );
  };

  const arrangeSelection = (
    direction: "front" | "forward" | "backward" | "back",
  ) => {
    if (!distinctSelected.length) return;
    const locator = (node: ElementSnapshot) => `${node.line}:${node.column}`;
    const selectedLocators = new Set(distinctSelected.map(locator));
    const zIndex = (node: ElementSnapshot) => {
      const value = Number.parseFloat(node.styles.zIndex ?? "0");
      return Number.isFinite(value) ? value : 0;
    };
    const selectedLevels = distinctSelected.map(zIndex);
    const otherLevels = uniqueByLocator(nodes)
      .filter((node) => !selectedLocators.has(locator(node)))
      .map(zIndex);
    let delta = 0;
    if (direction === "forward") delta = 1;
    else if (direction === "backward") delta = -1;
    else if (direction === "front") {
      delta = Math.max(0, ...otherLevels) + 1 - Math.max(...selectedLevels);
    } else {
      delta = Math.min(0, ...otherLevels) - 1 - Math.min(...selectedLevels);
    }
    if (!delta) return;
    const positionEdits = staticPositionZOrderEdits(
      committedSourceRef.current.sourceTsx,
      distinctSelected,
      nodes,
    );
    if (!positionEdits) {
      toast.error(t("slides2Editor.objectStructureUnsupported"));
      return;
    }
    const editsByLocator = new Map(
      positionEdits.map((edit) => [`${edit.line}:${edit.column}`, edit]),
    );
    for (const node of distinctSelected) {
      const key = locator(node);
      const edit = editsByLocator.get(key);
      const zIndexOp: SourceEditOp = {
        kind: "set-style",
        key: "zIndex",
        value: String(zIndex(node) + delta),
        ...(node.text ? { prevText: node.text } : {}),
      };
      if (edit) edit.ops.push(zIndexOp);
      else editsByLocator.set(key, editFor(node, [zIndexOp]));
    }
    appendEdits([...editsByLocator.values()]);
  };

  const persistEdits = async (edits: SourceEdit[]): Promise<boolean> => {
    if (!edits.length) return true;
    if (saving || !canEdit) return false;
    if (rejectUnsafeRenderedTargets(edits)) return false;
    bumpHistoryVersion();
    setSaveError(null);
    try {
      const result = await onSave(edits);
      recordCommittedSource(result);
      setEditBatches([]);
      setHistoryIndex(0);
      return true;
    } catch (error) {
      setSaveError(
        t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
      );
      return false;
    }
  };

  const save = async (): Promise<boolean> => {
    if (!hasUnsavedEdits) return true;
    return persistEdits(activeEdits);
  };
  saveRef.current = save;

  const commitInlineEdits = async (edits: SourceEdit[]): Promise<boolean> => {
    if (saving || !canEdit) return false;
    const offset = activeEdits.length;
    return persistEdits([
      ...activeEdits,
      ...edits.map((edit) =>
        edit.dependsOn === undefined
          ? edit
          : { ...edit, dependsOn: edit.dependsOn + offset },
      ),
    ]);
  };

  const acceptSourceReplacement = (
    result: Pick<SlideSource, "sourceTsx" | "revision" | "sourceHash">,
    selections: SourceSelection[] = [],
  ) => {
    recordCommittedSource(result);
    setEditBatches([]);
    setHistoryIndex(0);
    selectedIdsRef.current = [];
    setSelectedIds([]);
    setNodes([]);
    setPendingSourceSelection(
      selections.length ? { revision: result.revision, selections } : null,
    );
    controllerRef.current?.send({ type: "clear-preview" });
  };

  const commitSourceReplacement = async (
    sourceTsx: string,
    selection?: SourceSelection,
    editedTargets: SourceSelection[] = [],
  ): Promise<boolean> => {
    if (!canEdit || saving) return false;
    if (editedTargets.length && rejectUnsafeRenderedTargets(editedTargets)) {
      return false;
    }
    if (hasUnsavedEdits) {
      setSaveError(t("slides2Editor.saveBeforeStructureEdit"));
      return false;
    }
    bumpHistoryVersion();
    setSaveError(null);
    try {
      const result = await onRestore(sourceTsx, committedSourceRef.current);
      acceptSourceReplacement(result, selection ? [selection] : []);
      return true;
    } catch (error) {
      setSaveError(
        t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
      );
      return false;
    }
  };

  const transformErrorMessage = (error: unknown) => {
    const errorCode = getEditorActionErrorCode(error);
    const messageKey =
      errorCode === "slide_transform_unsupported" ||
      errorCode === "slide_transform_selection_required"
        ? "slides2Editor.objectStructureUnsupported"
        : (getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed");
    setSaveError(t(messageKey));
  };

  const writeCurrentSelectionForTransform = async (
    targets: ElementSnapshot[],
    currentSource: Pick<SlideSource, "revision" | "sourceHash">,
  ): Promise<boolean> => {
    if (rejectUnsafeRenderedTargets(targets)) return false;
    if (
      !artifact ||
      artifact.deckId !== deckId ||
      artifact.slideId !== source.id ||
      artifact.revision !== currentSource.revision ||
      artifact.sourceHash !== currentSource.sourceHash
    ) {
      toast.error(t("slides2Editor.objectStructureUnsupported"));
      return false;
    }
    await writeClientAppState(
      appStateKeyForBrowserTab(appStateKey("slides-selection"), TAB_ID),
      {
        deckId,
        slideId: source.id,
        slideIndex: activeIndex,
        slideNumber: activeIndex + 1,
        sourceRevision: currentSource.revision,
        sourceHash: currentSource.sourceHash,
        items: targets.map((node) => ({
          sourceLine: node.line,
          sourceColumn: node.column,
          ...(typeof node.instanceIndex === "number"
            ? { instanceIndex: node.instanceIndex }
            : {}),
          ...(typeof node.instanceCount === "number"
            ? { instanceCount: node.instanceCount }
            : {}),
          sourceTag: node.tagName,
          sourceText: node.text.slice(0, 300),
          sourceStyle: node.styles,
        })),
      },
      { keepalive: true, requestSource: TAB_ID },
    );
    return true;
  };

  const groupObjects = async () => {
    if (
      !canEdit ||
      saving ||
      structuralSaving ||
      transformSlideObjects.isPending ||
      distinctSelected.length < 2
    ) {
      return;
    }
    if (hasUnsavedEdits) {
      setSaveError(t("slides2Editor.saveBeforeStructureEdit"));
      return;
    }
    setSaveError(null);
    const currentSource = committedSourceRef.current;
    try {
      if (
        !(await writeCurrentSelectionForTransform(
          distinctSelected,
          currentSource,
        ))
      ) {
        return;
      }
      const result = await transformSlideObjects.mutateAsync({
        deckId,
        slideId: source.id,
        expectedRevision: currentSource.revision,
        expectedSourceHash: currentSource.sourceHash,
        operation: {
          op: "group",
          targets: distinctSelected.map(({ line, column }) => ({
            line,
            column,
          })),
        },
      });
      const selection =
        result.createdLocator ??
        (result.createdObjectId
          ? sourceSelectionForObjectId(result.sourceTsx, result.createdObjectId)
          : null);
      acceptSourceReplacement(result, selection ? [selection] : []);
    } catch (error) {
      transformErrorMessage(error);
    }
  };

  const ungroupObjects = async () => {
    const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
    if (
      !canEdit ||
      saving ||
      structuralSaving ||
      transformSlideObjects.isPending ||
      !target ||
      !selectedGroupChildIds
    ) {
      return;
    }
    if (hasUnsavedEdits) {
      setSaveError(t("slides2Editor.saveBeforeStructureEdit"));
      return;
    }
    setSaveError(null);
    const currentSource = committedSourceRef.current;
    try {
      if (!(await writeCurrentSelectionForTransform([target], currentSource))) {
        return;
      }
      const result = await transformSlideObjects.mutateAsync({
        deckId,
        slideId: source.id,
        expectedRevision: currentSource.revision,
        expectedSourceHash: currentSource.sourceHash,
        operation: {
          op: "ungroup",
          target: { line: target.line, column: target.column },
        },
      });
      const selections = selectedGroupChildIds
        .map((objectId) =>
          sourceSelectionForObjectId(result.sourceTsx, objectId),
        )
        .filter(
          (selection): selection is SourceSelection => selection !== null,
        );
      acceptSourceReplacement(
        result,
        selections.length === selectedGroupChildIds.length ? selections : [],
      );
    } catch (error) {
      transformErrorMessage(error);
    }
  };

  const duplicateObject = async () => {
    const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
    if (!canEdit || saving || !target) return;
    if (rejectUnsafeRenderedTargets([target])) return;
    if (hasUnsavedEdits) {
      setSaveError(t("slides2Editor.saveBeforeStructureEdit"));
      return;
    }
    const result = duplicateSourceElement(
      committedSourceRef.current.sourceTsx,
      {
        line: target.line,
        column: target.column,
      },
    );
    if (!result) {
      setSaveError(t("slides2Editor.objectStructureUnsupported"));
      return;
    }
    await commitSourceReplacement(result.sourceTsx, result.selection, [target]);
  };

  const deleteObject = async () => {
    const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
    if (!canEdit || saving || !target) return;
    if (rejectUnsafeRenderedTargets([target])) return;
    if (hasUnsavedEdits) {
      setSaveError(t("slides2Editor.saveBeforeStructureEdit"));
      return;
    }
    const result = deleteSourceElement(committedSourceRef.current.sourceTsx, {
      line: target.line,
      column: target.column,
    });
    if (!result) {
      setSaveError(t("slides2Editor.objectStructureUnsupported"));
      return;
    }
    await commitSourceReplacement(result.sourceTsx, undefined, [target]);
  };

  const insertAsset = async (
    assetId: string,
    filename: string,
    type: string,
  ): Promise<string | null> => {
    const isVideo = type === "video/mp4" || type === "video/webm";
    const failureKey = isVideo
      ? "slides2Editor.videoInsertFailed"
      : "slides2Editor.imageInsertFailed";
    if (!canEdit || saving) return t(failureKey);
    if (hasUnsavedEdits) return t("slides2Editor.saveBeforeStructureEdit");
    if (isVideo && assetTarget?.tagName.toLowerCase() === "video") {
      const sourceTsx = replaceVideoAssetSource(
        committedSourceRef.current.sourceTsx,
        { line: assetTarget.line, column: assetTarget.column },
        assetId,
      );
      if (!sourceTsx) return t(failureKey);
      const saved = await commitSourceReplacement(
        sourceTsx,
        {
          line: assetTarget.line,
          column: assetTarget.column,
        },
        [assetTarget],
      );
      return saved ? null : t(failureKey);
    }
    if (type.startsWith("video/") && !isVideo) return t(failureKey);
    if (isVideo) {
      const result = insertVideoAssetOnCanvas(
        committedSourceRef.current.sourceTsx,
        assetId,
        filename,
      );
      if (!result) return t("slides2Editor.objectStructureUnsupported");
      const saved = await commitSourceReplacement(
        result.sourceTsx,
        result.selection,
      );
      return saved ? null : t(failureKey);
    }
    if (assetTarget && hasImageTarget) {
      const op: SourceEditOp =
        assetTarget.tagName.toLowerCase() === "img"
          ? { kind: "set-attr-asset", attr: "src", assetId }
          : { kind: "replace-placeholder-with-image", assetId };
      const saved = await commitInlineEdits([editFor(assetTarget, [op])]);
      return saved ? null : t(failureKey);
    }
    const result = insertAssetOnCanvas(
      committedSourceRef.current.sourceTsx,
      assetId,
      filename,
    );
    if (!result) return t("slides2Editor.objectStructureUnsupported");
    const saved = await commitSourceReplacement(
      result.sourceTsx,
      result.selection,
    );
    return saved ? null : t(failureKey);
  };

  const insertObject = async (kind: Slides2ObjectKind) => {
    if (!canEdit || saving || structuralSaving) return;
    if (hasUnsavedEdits) {
      setSaveError(t("slides2Editor.saveBeforeStructureEdit"));
      return;
    }
    const result = insertSourceObject(committedSourceRef.current.sourceTsx, {
      kind,
      ...(kind === "text" ? { text: t("slides2Editor.newTextObject") } : {}),
    });
    if (!result) {
      setSaveError(t("slides2Editor.objectStructureUnsupported"));
      return;
    }
    await commitSourceReplacement(result.sourceTsx, result.selection);
  };

  const restoreCommittedHistory = useCallback(
    async (index: number): Promise<boolean> => {
      const target = committedHistory[index];
      if (typeof target !== "string" || saving || !canEdit) return false;
      bumpHistoryVersion();
      setSaveError(null);
      try {
        const result = await onRestore(target, committedSourceRef.current);
        recordCommittedSource(result, false);
        committedHistoryIndexRef.current = index;
        setCommittedHistoryIndex(index);
        return true;
      } catch (error) {
        setSaveError(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
        return false;
      }
    },
    [
      bumpHistoryVersion,
      canEdit,
      committedHistory,
      onRestore,
      recordCommittedSource,
      saving,
      t,
    ],
  );

  const present = async (mode: "fullscreen" | "windowed" = "fullscreen") => {
    let fullscreenRequest: Promise<boolean> | undefined;
    if (mode === "fullscreen" && onRequestFullscreen) {
      try {
        fullscreenRequest = Promise.resolve(onRequestFullscreen()).catch(
          () => false,
        );
      } catch {
        fullscreenRequest = Promise.resolve(false);
      }
    }

    if (hasUnsavedEdits && !(await save())) {
      if ((await fullscreenRequest) && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      return;
    }
    if (fullscreenRequest) await fullscreenRequest;
    onPresent(mode);
  };

  const changePreviewRevealedSteps = useCallback(
    (revealedSteps: number) => {
      const current = previewStepStateRef.current;
      if (
        current.artifactKey !== previewArtifactKey ||
        current.stepCount === null
      ) {
        return;
      }
      const nextRevealedSteps = Math.max(
        0,
        Math.min(current.stepCount, revealedSteps),
      );
      if (nextRevealedSteps === current.revealedSteps) return;
      const next = { ...current, revealedSteps: nextRevealedSteps };
      previewStepStateRef.current = next;
      setPreviewStepState(next);
      controllerRef.current?.send({
        type: "set-revealed-steps",
        revealedSteps: nextRevealedSteps,
      });
    },
    [previewArtifactKey],
  );

  const goPreviewNext = useCallback(() => {
    const current = previewStepStateRef.current;
    if (
      current.artifactKey !== previewArtifactKey ||
      current.stepCount === null
    ) {
      return;
    }
    if (current.revealedSteps < current.stepCount) {
      changePreviewRevealedSteps(current.revealedSteps + 1);
    } else if (activeIndex < slides.length - 1) {
      onSelectSlide(activeIndex + 1);
    }
  }, [
    activeIndex,
    changePreviewRevealedSteps,
    onSelectSlide,
    previewArtifactKey,
    slides.length,
  ]);

  const goPreviewPrevious = useCallback(() => {
    const current = previewStepStateRef.current;
    if (
      current.artifactKey !== previewArtifactKey ||
      current.stepCount === null
    ) {
      return;
    }
    if (current.revealedSteps > 0) {
      changePreviewRevealedSteps(current.revealedSteps - 1);
    } else if (activeIndex > 0) {
      onSelectSlide(activeIndex - 1);
    }
  }, [
    activeIndex,
    changePreviewRevealedSteps,
    onSelectSlide,
    previewArtifactKey,
  ]);

  const handlePreviewStepCount = useCallback(
    (stepCount: number) => {
      if (!previewArtifactKey) return;
      const current = previewStepStateRef.current;
      const revealedSteps = previewModeRef.current
        ? current.artifactKey === previewArtifactKey
          ? Math.min(current.revealedSteps, stepCount)
          : 0
        : stepCount;
      const next = {
        artifactKey: previewArtifactKey,
        stepCount,
        revealedSteps,
      };
      previewStepStateRef.current = next;
      setPreviewStepState(next);
    },
    [previewArtifactKey],
  );

  const handlePreviewNavigationInput = useCallback(
    (input: SlideFrameNavigationInput) => {
      if (!previewMode) return;
      if (input.type === "click") {
        if (
          input.button === 0 &&
          !input.defaultPrevented &&
          !input.interactive &&
          !input.hasSelection
        ) {
          goPreviewNext();
        }
        return;
      }
      if (input.ctrlKey) return;
      const delta =
        input.deltaMode === 1
          ? input.deltaY * 16
          : input.deltaMode === 2
            ? input.deltaY * 800
            : input.deltaY;
      const now = performance.now();
      const wheel = previewWheelRef.current;
      if (now - wheel.lastAt > 400) wheel.accumulated = 0;
      wheel.lastAt = now;
      if (now - wheel.lastNavigationAt < 450) return;
      wheel.accumulated += delta;
      if (Math.abs(wheel.accumulated) < 80) return;
      const direction = Math.sign(wheel.accumulated);
      wheel.accumulated = 0;
      wheel.lastNavigationAt = now;
      if (direction > 0) goPreviewNext();
      else goPreviewPrevious();
    },
    [goPreviewNext, goPreviewPrevious, previewMode],
  );

  const togglePreviewMode = useCallback(() => {
    const nextPreviewMode = !previewMode;
    if (nextPreviewMode) {
      inspectorBeforePreviewRef.current = inspectorOpen;
      inspectorToggledInPreviewRef.current = false;
      onInspectorBeforePreviewChange?.(inspectorOpen);
      onInspectorToggledInPreviewChange?.(false);
      setInspectorOpen(false);
      setCommentMode(false);
      selectedIdsRef.current = [];
      setSelectedIds([]);
      setSelectedTextRange(null);
      setGuideLines([]);
      setMarquee(null);
      const current = previewStepStateRef.current;
      const next = {
        artifactKey: previewArtifactKey,
        stepCount:
          current.artifactKey === previewArtifactKey ? current.stepCount : null,
        revealedSteps: 0,
      };
      previewStepStateRef.current = next;
      setPreviewStepState(next);
    } else if (!inspectorToggledInPreviewRef.current) {
      setInspectorOpen(inspectorBeforePreviewRef.current ?? true);
    }
    if (!nextPreviewMode) {
      inspectorBeforePreviewRef.current = null;
      inspectorToggledInPreviewRef.current = false;
      onInspectorBeforePreviewChange?.(null);
      onInspectorToggledInPreviewChange?.(false);
    }
    if (onEditorModeChange) {
      onEditorModeChange(nextPreviewMode ? "preview" : "edit");
    } else {
      setLocalEditorMode(nextPreviewMode ? "preview" : "edit");
    }
  }, [
    inspectorOpen,
    onEditorModeChange,
    onInspectorBeforePreviewChange,
    onInspectorToggledInPreviewChange,
    previewArtifactKey,
    previewMode,
    setInspectorOpen,
  ]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("share.copied"));
    } catch {
      toast.error(t("slides2Editor.copyLinkFailed"));
    }
  };

  const selectAllElements = () => {
    const ids = independentTransformTargets(nodes).map((node) => node.nodeId);
    selectedIdsRef.current = ids;
    setSelectedIds(ids);
    setGuideLines([]);
    if (ids.length) window.requestAnimationFrame(() => inspect(ids));
  };

  const dispatchEditorShortcut = (action: string, delta?: Point) => {
    switch (action) {
      case "select-all":
        if (
          overviewOpen ||
          commandMenuOpen ||
          assetBrowserOpen ||
          imageCropOpen ||
          commentMode
        )
          return;
        selectAllElements();
        break;
      case "save":
        void saveRef.current();
        break;
      case "toggle-overview":
        setOverviewOpen((open) => !open);
        break;
      case "toggle-inspector":
        toggleInspector();
        break;
      case "preview-mode":
        if (!previewMode) togglePreviewMode();
        break;
      case "edit-mode":
        if (previewMode) togglePreviewMode();
        break;
      case "toggle-comment-mode":
        if (!canComment) return;
        if (previewMode) togglePreviewMode();
        commentGestureRef.current = null;
        setCommentMode((value) => !value);
        break;
      case "present-fullscreen":
        void present("fullscreen");
        break;
      case "present-windowed":
        void present("windowed");
        break;
      case "open-presenter-view":
        onOpenPresenter?.();
        void present("windowed");
        break;
      case "edit-selected-text":
        openInlineTextEditor(selectionNodes(selectedIdsRef.current)[0]);
        break;
      case "delete-selected-object":
        void deleteObject();
        break;
      case "nudge-selected-object": {
        if (!delta) return;
        const targets = selectionNodes(selectedIdsRef.current);
        if (!targets.length) return;
        appendEdits(
          targets.map((node) => applyTranslate(node, delta.x, delta.y)),
        );
        break;
      }
      case "previous-slide":
        onSelectSlide(Math.max(0, activeIndex - 1));
        break;
      case "next-slide":
        onSelectSlide(Math.min(slides.length - 1, activeIndex + 1));
        break;
    }
  };

  const undo = useCallback((): boolean | Promise<boolean> => {
    if (crossSlideHistory) {
      return crossSlideHistory.canUndo ? crossSlideHistory.undo() : false;
    }
    if (historyIndex > 0) {
      bumpHistoryVersion();
      setHistoryIndex((index) => Math.max(0, index - 1));
      return true;
    } else if (!hasUnsavedEdits && committedHistoryIndex > 0) {
      return restoreCommittedHistory(committedHistoryIndex - 1);
    }
    return false;
  }, [
    bumpHistoryVersion,
    committedHistoryIndex,
    crossSlideHistory,
    hasUnsavedEdits,
    historyIndex,
    restoreCommittedHistory,
  ]);
  const redo = useCallback((): boolean | Promise<boolean> => {
    if (crossSlideHistory) {
      return crossSlideHistory.canRedo ? crossSlideHistory.redo() : false;
    }
    if (historyIndex < editBatches.length) {
      bumpHistoryVersion();
      setHistoryIndex((index) => Math.min(editBatches.length, index + 1));
      return true;
    } else if (
      !hasUnsavedEdits &&
      committedHistoryIndex < committedHistory.length - 1
    ) {
      return restoreCommittedHistory(committedHistoryIndex + 1);
    }
    return false;
  }, [
    bumpHistoryVersion,
    committedHistory.length,
    committedHistoryIndex,
    crossSlideHistory,
    editBatches.length,
    hasUnsavedEdits,
    historyIndex,
    restoreCommittedHistory,
  ]);

  editorCommandHandlerRef.current = async (operation) => {
    if (operation === "undo") return await undo();
    if (operation === "redo") return await redo();
    return saveRef.current();
  };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const retryDelay = (attempt: number) =>
      Math.min(250 * 2 ** Math.min(attempt - 1, 7), 30_000);
    const clearRetryTimer = () => {
      if (retryTimer === null) return;
      clearTimeout(retryTimer);
      retryTimer = null;
    };
    const schedulePollRetry = (commandId?: string) => {
      if (cancelled || retryTimer !== null) return;
      let attempt: number;
      if (commandId) {
        const retryKey = `${editorCommandKey}:${commandId}`;
        attempt = (slideEditorCommandAckRetryAttempts.get(retryKey) ?? 0) + 1;
        slideEditorCommandAckRetryAttempts.set(retryKey, attempt);
        const attempts = slideEditorCommandAckRetryAttempts;
        if (attempts.size > 16) {
          const oldestCommandId = attempts.keys().next().value;
          if (oldestCommandId) attempts.delete(oldestCommandId);
        }
      } else {
        attempt = ++editorCommandPollRetryAttemptsRef.current;
      }
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void editorCommandPollRef.current?.();
      }, retryDelay(attempt));
    };
    const clearCommandRetry = (commandId: string) => {
      const retryKey = `${editorCommandKey}:${commandId}`;
      completedSlideEditorCommands.delete(retryKey);
      slideEditorCommandAckRetryAttempts.delete(retryKey);
      clearRetryTimer();
    };
    const commandExecutionKey = (commandId: string) =>
      `${editorCommandKey}:${commandId}`;
    const commandStateMatches = (
      value: unknown,
      expected: SlideEditorCommand,
    ) => {
      const parsed = slideEditorCommandSchema.safeParse(value);
      return (
        parsed.success &&
        JSON.stringify(parsed.data) === JSON.stringify(expected)
      );
    };
    const commandIdentityMatches = (
      left: SlideEditorCommand,
      right: SlideEditorCommand,
    ) =>
      left.protocolVersion === right.protocolVersion &&
      left.commandId === right.commandId &&
      left.operation === right.operation &&
      left.deckId === right.deckId &&
      left.slideId === right.slideId &&
      left.editorSessionId === right.editorSessionId &&
      left.historyVersion === right.historyVersion &&
      left.sourceRevision === right.sourceRevision &&
      left.sourceHash === right.sourceHash;
    const acknowledge = async (
      pending: SlideEditorCommand,
      terminal: SlideEditorCommand,
      expectedPending: Record<string, unknown>,
    ) => {
      const key = commandExecutionKey(pending.commandId);
      completedSlideEditorCommands.set(key, terminal);
      const ordered = [...completedSlideEditorCommands.entries()];
      if (ordered.length > 16) {
        completedSlideEditorCommands.delete(ordered[0]![0]);
      }
      try {
        const changed = await compareAndSetClientAppState(
          editorCommandKey,
          expectedPending,
          terminal as unknown as Record<string, unknown>,
          { requestSource: TAB_ID },
        );
        if (changed) {
          clearCommandRetry(pending.commandId);
          return;
        }
        const current = await readClientAppState<unknown>(editorCommandKey);
        if (commandStateMatches(current, terminal)) {
          clearCommandRetry(pending.commandId);
        } else if (commandStateMatches(current, pending)) {
          schedulePollRetry(pending.commandId);
        } else {
          clearCommandRetry(pending.commandId);
        }
      } catch (error) {
        console.error("Could not acknowledge the slide editor command.", error);
        schedulePollRetry(pending.commandId);
      }
    };
    const poll = async () => {
      if (cancelled) return;
      if (editorCommandPollActiveRef.current) {
        editorCommandPollRequestedRef.current = true;
        return;
      }
      editorCommandPollActiveRef.current = true;
      try {
        const state = await readClientAppState<unknown>(editorCommandKey);
        if (cancelled) return;
        const parsed = slideEditorCommandSchema.safeParse(state);
        if (!parsed.success) return;
        if (parsed.data.status !== "pending") {
          clearCommandRetry(parsed.data.commandId);
          return;
        }
        editorCommandPollRetryAttemptsRef.current = 0;
        const pending = parsed.data;
        const executionKey = commandExecutionKey(pending.commandId);
        if (activeSlideEditorCommands.has(executionKey)) {
          schedulePollRetry();
          return;
        }
        const previousResult = completedSlideEditorCommands.get(executionKey);
        if (previousResult) {
          if (commandIdentityMatches(pending, previousResult)) {
            await acknowledge(
              pending,
              previousResult,
              state as Record<string, unknown>,
            );
            return;
          }
          completedSlideEditorCommands.delete(executionKey);
        }

        const status = editorStatusRef.current;
        const editorState = {
          deckId,
          slideId: source.id,
          editorSessionId: editorSessionIdRef.current ?? "",
          historyVersion: historyVersionRef.current,
          sourceRevision: committedSourceRef.current.revision,
          sourceHash: committedSourceRef.current.sourceHash,
        };
        let outcome:
          | { status: "applied" }
          | {
              status: "rejected";
              failureCode: NonNullable<SlideEditorCommand["failureCode"]>;
            };
        if (
          !slideEditorCommandMatchesEditorState(pending, status, editorState)
        ) {
          outcome = {
            status: "rejected",
            failureCode: "stale_editor_state",
          };
        } else if (
          !isSlideEditorOperationAvailable(status, pending.operation)
        ) {
          outcome = {
            status: "rejected",
            failureCode: "command_unavailable",
          };
        } else {
          activeSlideEditorCommands.add(executionKey);
          try {
            try {
              outcome = (await editorCommandHandlerRef.current(
                pending.operation,
              ))
                ? { status: "applied" }
                : {
                    status: "rejected",
                    failureCode: "command_failed",
                  };
            } catch (error) {
              console.error("Could not apply the slide editor command.", error);
              outcome = {
                status: "rejected",
                failureCode: "command_failed",
              };
            }
            await acknowledge(
              pending,
              completeSlideEditorCommand(pending, outcome),
              state as Record<string, unknown>,
            );
          } finally {
            activeSlideEditorCommands.delete(executionKey);
          }
          return;
        }
        await acknowledge(
          pending,
          completeSlideEditorCommand(pending, outcome),
          state as Record<string, unknown>,
        );
      } catch (error) {
        console.error("Could not read the slide editor command.", error);
        schedulePollRetry();
      } finally {
        editorCommandPollActiveRef.current = false;
        if (editorCommandPollRequestedRef.current) {
          editorCommandPollRequestedRef.current = false;
          queueMicrotask(() => void editorCommandPollRef.current?.());
        }
      }
    };
    editorCommandPollRef.current = poll;
    void poll();
    return () => {
      cancelled = true;
      clearRetryTimer();
    };
  }, [deckId, editorCommandKey, editorCommandVersion, source.id]);

  const keyCommand = useCallback(
    (
      key: string,
      modifiers: {
        shiftKey: boolean;
        altKey: boolean;
        ctrlKey: boolean;
        metaKey: boolean;
      },
    ) => {
      const command = modifiers.ctrlKey || modifiers.metaKey;
      if (shouldIgnoreModifiedArrowNavigation(key, modifiers)) return;
      if (!modifiers.altKey && command && key.toLowerCase() === "z") {
        if (modifiers.shiftKey) redo();
        else undo();
        return;
      }
      if (!modifiers.altKey && modifiers.ctrlKey && key.toLowerCase() === "y") {
        redo();
        return;
      }
      if (key === "Escape") {
        if (dragRef.current) {
          if (dragRef.current.moved) restoreActivePreview();
          dragRef.current = null;
          setMarquee(null);
          setGestureSelectionIds(null);
          setGuideLines([]);
          return;
        }
        selectedIdsRef.current = [];
        setSelectedIds([]);
        setGestureSelectionIds(null);
        setGuideLines([]);
        return;
      }
      if (key === "PageDown" || key === "ArrowRight" || key === " ") {
        if (activeIndex < slides.length - 1) onSelectSlide(activeIndex + 1);
        return;
      }
      if (key === "PageUp" || key === "ArrowLeft") {
        if (activeIndex > 0) onSelectSlide(activeIndex - 1);
        return;
      }
      if (key === "Home") onSelectSlide(0);
      if (key === "End") onSelectSlide(Math.max(0, slides.length - 1));
    },
    [
      activeIndex,
      appendEdits,
      canEdit,
      commentMode,
      onSelectSlide,
      redo,
      restoreActivePreview,
      selectionNodes,
      slides.length,
      undo,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
        return;

      const eventTarget = event.target;
      const typingTarget =
        eventTarget instanceof HTMLElement &&
        (eventTarget.isContentEditable ||
          eventTarget.matches("input, textarea"));
      if (
        !typingTarget &&
        !event.altKey &&
        !event.shiftKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setCommandMenuOpen(true);
        return;
      }

      const shortcut = getSlides2EditorShortcut(event, {
        overviewOpen,
        hasSelectedText: canEditSelectedText,
        hasSelectedObject:
          canEdit &&
          !saving &&
          !structuralSaving &&
          !previewMode &&
          !commentMode &&
          !assetBrowserOpen &&
          !imageCropOpen &&
          !commandMenuOpen &&
          distinctSelected.length > 0,
        canComment,
      });
      if (shortcut) {
        if (shortcut.preventDefault) event.preventDefault();
        if (previewMode && shortcut.action === "previous-slide") {
          goPreviewPrevious();
        } else if (previewMode && shortcut.action === "next-slide") {
          goPreviewNext();
        } else {
          dispatchEditorShortcut(shortcut.action, shortcut.delta);
        }
        return;
      }
      if (previewMode) {
        const target = event.target;
        if (
          target instanceof Element &&
          ((target instanceof HTMLElement && target.isContentEditable) ||
            target.closest(
              "input, textarea, select, button, a, [role='dialog'], [role='menu'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='listbox'], [role='option'], [role='tablist'], [data-inspector-ui], [data-design-ui]",
            ))
        ) {
          return;
        }
        if (
          overviewOpen ||
          commandMenuOpen ||
          assetBrowserOpen ||
          imageCropOpen
        )
          return;
        if (shouldIgnoreModifiedArrowNavigation(event.key, event)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          togglePreviewMode();
        } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
          event.preventDefault();
          goPreviewPrevious();
        } else if (
          event.key === "ArrowRight" ||
          event.key === "PageDown" ||
          event.key === " "
        ) {
          event.preventDefault();
          goPreviewNext();
        } else if (event.key === "Home") {
          event.preventDefault();
          onSelectSlide(0);
        } else if (event.key === "End") {
          event.preventDefault();
          onSelectSlide(Math.max(0, slides.length - 1));
        }
        return;
      }
      if (overviewOpen || commandMenuOpen || assetBrowserOpen || imageCropOpen)
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        ((target instanceof HTMLElement && target.isContentEditable) ||
          target.closest(
            "input, textarea, select, button, a, [role='dialog'], [role='menu'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='listbox'], [role='option'], [role='tablist'], [data-inspector-ui], [data-design-ui]",
          ))
      )
        return;
      if (shouldIgnoreModifiedArrowNavigation(event.key, event)) return;
      if (
        !event.isComposing &&
        event.keyCode !== 229 &&
        !event.defaultPrevented &&
        isBareDesignPanelShortcut(event)
      ) {
        toggleDesignPanel();
        return;
      }
      if (event.key === "Escape" && commentMode) {
        event.preventDefault();
        commentGestureRef.current = null;
        setCommentMode(false);
        return;
      }
      const command = !event.altKey && (event.ctrlKey || event.metaKey);
      const key = event.key.toLowerCase();
      if (
        event.key === "Escape" ||
        event.key === "PageDown" ||
        event.key === "PageUp" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "Home" ||
        event.key === "End" ||
        event.key === " " ||
        (command && key === "z") ||
        (!event.altKey && event.ctrlKey && key === "y")
      ) {
        event.preventDefault();
        keyCommand(event.key, event);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    assetBrowserOpen,
    commentMode,
    commandMenuOpen,
    canEdit,
    canEditSelectedText,
    dispatchEditorShortcut,
    goPreviewNext,
    goPreviewPrevious,
    imageCropOpen,
    keyCommand,
    onSelectSlide,
    overviewOpen,
    previewMode,
    slides.length,
    togglePreviewMode,
    toggleDesignPanel,
  ]);

  const handlePreviewFrameKeyboard = useCallback(
    (keyboard: FrameKeyboard) => {
      if (
        keyboard.isTypingTarget ||
        keyboard.isControlTarget ||
        keyboard.isComposing ||
        keyboard.keyCode === 229
      ) {
        return;
      }
      const shortcut = getSlides2EditorShortcut(
        new KeyboardEvent("keydown", keyboard),
        {
          overviewOpen,
          isTypingTarget: keyboard.isTypingTarget,
          isControlTarget: keyboard.isControlTarget,
          isComposing: keyboard.isComposing,
          keyCode: keyboard.keyCode,
        },
      );
      if (shortcut) {
        if (shortcut.action === "previous-slide") goPreviewPrevious();
        else if (shortcut.action === "next-slide") goPreviewNext();
        else dispatchEditorShortcut(shortcut.action, shortcut.delta);
        return;
      }
      if (shouldIgnoreModifiedArrowNavigation(keyboard.key, keyboard)) return;
      if (keyboard.key === "Escape") togglePreviewMode();
      else if (keyboard.key === "ArrowLeft" || keyboard.key === "PageUp")
        goPreviewPrevious();
      else if (
        keyboard.key === "ArrowRight" ||
        keyboard.key === "PageDown" ||
        keyboard.key === " "
      )
        goPreviewNext();
      else if (keyboard.key === "Home") onSelectSlide(0);
      else if (keyboard.key === "End")
        onSelectSlide(Math.max(0, slides.length - 1));
    },
    [
      dispatchEditorShortcut,
      goPreviewNext,
      goPreviewPrevious,
      onSelectSlide,
      overviewOpen,
      slides.length,
      togglePreviewMode,
    ],
  );

  const handleFrameKeyboard = useCallback(
    (keyboard: FrameKeyboard) => {
      if (previewMode) {
        handlePreviewFrameKeyboard(keyboard);
        return;
      }
      const shortcut = getSlides2EditorShortcut(
        new KeyboardEvent("keydown", keyboard),
        {
          overviewOpen,
          hasSelectedText: canEditSelectedText,
          hasSelectedObject:
            canEdit &&
            !saving &&
            !structuralSaving &&
            !commentMode &&
            !assetBrowserOpen &&
            !imageCropOpen &&
            !commandMenuOpen &&
            distinctSelected.length > 0,
          canComment,
          isTypingTarget: keyboard.isTypingTarget,
          isControlTarget: keyboard.isControlTarget,
          isComposing: keyboard.isComposing,
          keyCode: keyboard.keyCode,
        },
      );
      if (shortcut) {
        dispatchEditorShortcut(shortcut.action, shortcut.delta);
        return;
      }
      if (
        keyboard.isTypingTarget ||
        keyboard.isControlTarget ||
        keyboard.isComposing ||
        keyboard.keyCode === 229
      )
        return;
      if (keyboard.key === "Escape" && commentMode) {
        commentGestureRef.current = null;
        setCommentMode(false);
        return;
      }
      if (overviewOpen || commandMenuOpen || assetBrowserOpen || imageCropOpen)
        return;
      if (isBareDesignPanelShortcut(keyboard)) {
        toggleDesignPanel();
        return;
      }
      keyCommand(keyboard.key, keyboard);
    },
    [
      assetBrowserOpen,
      canEdit,
      canEditSelectedText,
      commentMode,
      commandMenuOpen,
      distinctSelected.length,
      dispatchEditorShortcut,
      handlePreviewFrameKeyboard,
      imageCropOpen,
      keyCommand,
      overviewOpen,
      previewMode,
      saving,
      structuralSaving,
      toggleDesignPanel,
    ],
  );

  const setFrameController = useCallback(
    (controller: SlideFrameController | null) => {
      controllerRef.current = controller;
      if (controller) {
        const patches = getPreviewPatches(activeEdits);
        if (patches.length) controller.send({ type: "preview", patches });
        if (designTokens)
          controller.send({ type: "set-design-tokens", tokens: designTokens });
      }
    },
    [activeEdits, designTokens],
  );
  const handleOverviewKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        ![
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(event.key) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof HTMLElement) ||
        !event.target.closest("[data-slide-overview-index]")
      ) {
        return;
      }
      const focusedButton = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-slide-overview-index]",
      );
      const focusedIndex = Number(focusedButton?.dataset.slideOverviewIndex);
      if (!Number.isInteger(focusedIndex)) return;
      event.preventDefault();
      event.stopPropagation();
      const grid = overviewGridRef.current;
      const columns = grid
        ? Math.max(
            1,
            getComputedStyle(grid)
              .gridTemplateColumns.split(" ")
              .filter(Boolean).length,
          )
        : 1;
      const nextIndex = overviewFocusNavigationIndex(
        focusedIndex,
        slides.length,
        event.key,
        columns,
      );
      if (nextIndex === null) return;
      setFocusedOverviewIndex(nextIndex);
      window.requestAnimationFrame(() => {
        const button =
          overviewGridRef.current?.querySelector<HTMLButtonElement>(
            `[data-slide-overview-index="${nextIndex}"]`,
          );
        button?.focus();
        button?.scrollIntoView({ block: "nearest", behavior: "auto" });
      });
    },
    [slides.length],
  );

  const selectedRect = overlaySelectionBounds;
  const hoveredNode =
    hoveredTarget?.slideId === source.id
      ? (nodes.find((node) => node.nodeId === hoveredTarget.nodeId) ?? null)
      : null;
  const canvasScale = fitScale > 0 ? fitScale : 1;
  const handleSize = 12 / canvasScale;
  const rotateHandleTop = -28 / canvasScale;
  const rotateStemLength = 16 / canvasScale;
  const sliderPosition = activeSlide?.slideNumber ?? activeIndex + 1;
  const fitToScreen = () => setZoom(1);
  const inspectorTitle =
    activePanel === "format"
      ? t("slides2Editor.format")
      : activePanel === "design"
        ? t("slides2Editor.design")
        : activePanel === "motion"
          ? t("slides2Editor.motion")
          : t("presentation.speakerNotes");

  return (
    <div
      data-slides2-editor
      className="@container/editor-header flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <header className="grid min-h-11 shrink-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto] items-center gap-x-2 gap-y-1 border-b border-[hsl(var(--sidebar-border))] bg-[hsl(var(--surface))] px-3 py-1 @min-[72rem]/editor-header:h-12 @min-[72rem]/editor-header:grid-cols-[auto_minmax(0,1fr)_auto] @min-[72rem]/editor-header:grid-rows-1 @min-[72rem]/editor-header:gap-2 @min-[72rem]/editor-header:gap-y-0 @min-[72rem]/editor-header:py-0">
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
          <Button
            asChild
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
          >
            <Link to={backHref} aria-label={t("editorToolbar.backToDecks")}>
              <IconArrowLeft className="size-4" />
            </Link>
          </Button>
          <Separator orientation="vertical" className="mx-0.5 h-5" />
          <div
            role="group"
            aria-label={t("header.slides")}
            className="inline-flex items-center rounded-md border border-border/70 bg-muted/20 p-0.5"
          >
            <span
              aria-current="page"
              className="inline-flex h-6 items-center rounded-sm bg-accent px-2.5 text-xs font-medium text-foreground"
            >
              {t("header.slides")}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="px-2.5"
              onClick={() => setAssetBrowserOpen(true)}
              aria-label={t("editorToolbar.assets")}
              title={t("editorToolbar.assets")}
            >
              {t("editorToolbar.assets")}
            </Button>
          </div>
          <Slides2AgentConnectionBadge />
          <span
            ref={titleMeasureRef}
            aria-hidden="true"
            data-slides2-title-measure
            className="pointer-events-none fixed -left-[9999px] whitespace-pre font-heading text-[13.5px] font-semibold tracking-[-0.01em] opacity-0"
          >
            {titleDraft || " "}
          </span>
        </div>
        {titleEditing ? (
          <Input
            ref={titleInputRef}
            aria-label={t("deckCard.rename")}
            className="col-span-2 row-start-2 h-8 min-w-0 w-full max-w-full justify-self-center rounded-[5px] border border-foreground/30 bg-card px-2 py-0.5 text-center font-heading text-[13.5px] md:text-[13.5px] font-semibold tracking-[-0.01em] outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-100 @min-[72rem]/editor-header:col-span-1 @min-[72rem]/editor-header:col-start-2 @min-[72rem]/editor-header:row-start-1 @min-[72rem]/editor-header:max-w-[min(40vw,48rem)] @min-[72rem]/editor-header:justify-self-center"
            disabled={structuralSaving || titleSaving}
            maxLength={80}
            onBlur={(event) => {
              if (discardTitleDraftOnBlurRef.current) {
                discardTitleDraftOnBlurRef.current = false;
                return;
              }
              void finishTitleEdit(event.currentTarget.value);
            }}
            onChange={(event) => setTitleDraft(event.currentTarget.value)}
            onKeyDown={handleTitleKeyDown}
            readOnly={!canEdit || !onTitleChange}
            spellCheck={false}
            style={{ width: `${titleInputWidth}px` }}
            title={titleDraft}
            value={titleDraft}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("deckCard.rename")}
            className="col-span-2 row-start-2 flex h-8 min-w-0 w-full max-w-full items-center justify-center justify-self-center rounded-[5px] border border-transparent bg-transparent px-2 py-0.5 text-center font-heading text-[13.5px] font-semibold tracking-[-0.01em] transition-colors duration-100 active:scale-100 hover:border-foreground/30 hover:bg-card focus-visible:border-foreground/30 focus-visible:bg-card focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-100 disabled:hover:border-transparent disabled:hover:bg-transparent @min-[72rem]/editor-header:col-span-1 @min-[72rem]/editor-header:col-start-2 @min-[72rem]/editor-header:row-start-1 @min-[72rem]/editor-header:max-w-[min(40vw,48rem)] @min-[72rem]/editor-header:justify-self-center"
            disabled={!canEdit || !onTitleChange || structuralSaving}
            onClick={() => setTitleEditing(true)}
            style={{ width: `${titleInputWidth}px` }}
            title={titleDraft}
          >
            <h1 className="truncate">{titleDraft}</h1>
          </Button>
        )}
        <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center justify-end gap-1 @min-[72rem]/editor-header:flex-nowrap @min-[72rem]/editor-header:col-start-3 @min-[72rem]/editor-header:row-start-1">
          <div
            role="group"
            aria-label={t("editorToolbar.preview")}
            className="inline-flex h-8 items-center rounded-lg border border-border/70 bg-muted/70 p-0.5"
          >
            <Button
              type="button"
              variant={previewMode ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-full w-8"
              aria-label={t("slides2Editor.preview")}
              aria-pressed={previewMode}
              title={t("slides2Editor.preview")}
              onClick={() => {
                if (!previewMode) togglePreviewMode();
              }}
            >
              <IconEye className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={previewMode ? "ghost" : "secondary"}
              size="icon-sm"
              className="h-full w-8"
              aria-label={t("slides2Editor.edit")}
              aria-pressed={!previewMode}
              title={t("slides2Editor.edit")}
              onClick={() => {
                if (previewMode) togglePreviewMode();
              }}
            >
              <IconPencil className="size-3.5" aria-hidden="true" />
            </Button>
            {canComment ? (
              <Button
                type="button"
                variant={commentMode ? "secondary" : "ghost"}
                size="icon-sm"
                className="h-full w-8"
                aria-label={t("comments.addComment")}
                aria-pressed={commentMode}
                title={t("comments.clickToAddComment")}
                onClick={() => {
                  commentGestureRef.current = null;
                  setCommentMode((value) => !value);
                }}
              >
                <IconMessageCircle className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <Separator
            orientation="vertical"
            className="mx-0.5 hidden h-5 md:block"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void copyLink()}
            aria-label={t("share.copyLink")}
            title={t("share.copyLink")}
          >
            <IconLink aria-hidden="true" />
          </Button>
          {onShare ? (
            <Button type="button" variant="ghost" size="sm" onClick={onShare}>
              {t("share.title")}
            </Button>
          ) : null}
          <div className={previewMode ? "hidden" : "flex items-center gap-1"}>
            <Slides2ExportMenu
              ref={exportMenuRef}
              deckId={deckId}
              title={title}
              slides={slides}
              aspectRatio={aspectRatio}
              onBeforeExport={save}
            />
            {hasUnsavedEdits ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void save()}
                disabled={saving || !canEdit}
              >
                <IconCheck className="me-1 size-4" />
                {saving
                  ? t("designSystemSetup.saving")
                  : t("designSystemSetup.saveChanges")}
              </Button>
            ) : null}
          </div>
          <div
            role="group"
            aria-label={t("header.tool")}
            className="inline-flex items-center rounded-md border border-border/70 bg-muted/20 p-0.5"
          >
            <Button
              type="button"
              variant={
                inspectorOpen && activePanel === "design"
                  ? "secondary"
                  : "ghost"
              }
              size="xs"
              aria-pressed={inspectorOpen && activePanel === "design"}
              onClick={() => showInspectorPanel("design")}
            >
              <IconPalette className="size-4" aria-hidden="true" />
              {t("slides2Editor.design")}
              {import.meta.env.DEV ? (
                <kbd
                  aria-hidden="true"
                  className="ms-1 rounded-sm border border-border/70 bg-muted/40 px-1 text-[10px] leading-4 text-muted-foreground"
                >
                  D
                </kbd>
              ) : null}
            </Button>
            <Button
              type="button"
              variant={
                inspectorOpen && activePanel === "format"
                  ? "secondary"
                  : "ghost"
              }
              size="xs"
              aria-pressed={inspectorOpen && activePanel === "format"}
              onClick={() => showInspectorPanel("format")}
            >
              <IconLayoutSidebarRightExpand
                className="size-4"
                aria-hidden="true"
              />
              {t("slides2Editor.format")}
            </Button>
          </div>
          <Separator
            orientation="vertical"
            className="mx-0.5 hidden h-5 md:block"
          />
          <DropdownMenu>
            <div className="inline-flex items-center">
              {hasUnsavedEdits ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-7 rounded-e-none px-2.5"
                  data-slides2-present="true"
                  onClick={() => void present()}
                  disabled={slides.length === 0 || saving}
                >
                  <IconPlayerPlay aria-hidden="true" />
                  {t("editorToolbar.present")}
                </Button>
              ) : slides.length > 0 ? (
                <Button
                  asChild
                  variant="destructive"
                  size="sm"
                  className="h-7 rounded-e-none px-2.5"
                  data-slides2-present="true"
                >
                  <Link
                    to={presentHref}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      ) {
                        return;
                      }
                      event.preventDefault();
                      void present();
                    }}
                  >
                    <IconPlayerPlay aria-hidden="true" />
                    {t("editorToolbar.present")}
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 rounded-e-none px-2.5"
                  data-slides2-present="true"
                  disabled
                >
                  <IconPlayerPlay aria-hidden="true" />
                  {t("editorToolbar.present")}
                </Button>
              )}
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-sm"
                  className="h-7 w-6 rounded-s-none border-s border-destructive-foreground/25 p-0"
                  data-slides2-present="true"
                  disabled={slides.length === 0}
                  aria-label={t("editorToolbar.more")}
                  title={t("editorToolbar.more")}
                >
                  <IconChevronDown className="size-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void present("windowed")}>
                {t("slides2Editor.presentInWindow")}
              </DropdownMenuItem>
              {onOpenPresenter ? (
                <DropdownMenuItem
                  onSelect={() => {
                    onOpenPresenter();
                    void present("windowed");
                  }}
                >
                  {t("presentation.presenterView")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className={`relative flex min-h-0 shrink-0 flex-col bg-[hsl(var(--surface))] ${previewMode ? "hidden" : ""}`}
          style={{ width: slideRailWidth }}
        >
          <div
            ref={slideRailListRef}
            id="slides-2-slide-list"
            className="min-h-0 flex-1 overflow-y-auto border-e border-[hsl(var(--sidebar-border))] px-3 pt-0 pb-2"
          >
            <div className="mb-2 flex min-h-8 items-center justify-between gap-2 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("editorSidebar.pages")}
              </span>
              <div className="flex items-center gap-2">
                <span
                  data-slide-rail-count="true"
                  className="font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {String(slides.length).padStart(2, "0")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("slides2Presenter.overview")}
                  title={t("slides2Presenter.overview")}
                  onClick={() => setOverviewOpen(true)}
                >
                  <IconLayoutGrid className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragStart={handleThumbnailDragStart}
              onDragEnd={handleThumbnailDragEnd}
            >
              <SortableContext
                items={slides.map((slide) => slide.id)}
                strategy={verticalListSortingStrategy}
              >
                {slides.map((slide, index) => (
                  <ContextMenu key={slide.id}>
                    <ContextMenuTrigger
                      className="mb-2 block w-full"
                      onContextMenu={() => onSelectSlide(index)}
                    >
                      <SlideThumbnail
                        deckId={deckId}
                        slide={slide}
                        slideIndex={index}
                        selected={index === activeIndex}
                        cut={
                          clipboardOperation === "cut" &&
                          clipboardSourceSlideId === slide.id
                        }
                        dragDisabled={!canEdit || structuralSaving || saving}
                        onSelect={() => onSelectSlide(index)}
                        onNavigate={(direction) =>
                          handleThumbnailNavigate(index, direction)
                        }
                      />
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      {onCopySlide ? (
                        <ContextMenuItem
                          disabled={!canEdit || structuralSaving || saving}
                          onSelect={() => void onCopySlide(slide.id)}
                        >
                          <IconCopy className="me-2 size-4" />
                          {t("editorSidebar.copy")}
                        </ContextMenuItem>
                      ) : null}
                      {onCutSlide ? (
                        <ContextMenuItem
                          disabled={
                            !canEdit ||
                            structuralSaving ||
                            saving ||
                            slides.length <= 1
                          }
                          onSelect={() => void onCutSlide(slide.id)}
                        >
                          <IconScissors className="me-2 size-4" />
                          {t("editorSidebar.cut")}
                        </ContextMenuItem>
                      ) : null}
                      {onPasteSlide ? (
                        <ContextMenuItem
                          disabled={
                            !canEdit ||
                            !canPasteSlide ||
                            (clipboardOperation === "cut" &&
                              clipboardSourceSlideId === slide.id) ||
                            structuralSaving ||
                            saving
                          }
                          onSelect={() => void onPasteSlide(slide.id)}
                        >
                          <IconClipboardText className="me-2 size-4" />
                          {t("editorSidebar.paste")}
                        </ContextMenuItem>
                      ) : null}
                      {onCopySlide || onCutSlide || onPasteSlide ? (
                        <ContextMenuSeparator />
                      ) : null}
                      <ContextMenuItem
                        disabled={!canEdit || structuralSaving || saving}
                        onSelect={() => onDuplicateSlide(index)}
                      >
                        <IconCopy className="me-2 size-4" />
                        {t("editorSidebar.duplicateSlide")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        disabled={
                          !canEdit || structuralSaving || saving || index === 0
                        }
                        onSelect={() => onMoveSlide(index, index - 1)}
                      >
                        <IconArrowUp className="me-2 size-4" />
                        {t("editorSidebar.moveSlideUp")}
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={
                          !canEdit ||
                          structuralSaving ||
                          saving ||
                          index === slides.length - 1
                        }
                        onSelect={() => onMoveSlide(index, index + 1)}
                      >
                        <IconArrowDown className="me-2 size-4" />
                        {t("editorSidebar.moveSlideDown")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        disabled={
                          !canEdit ||
                          structuralSaving ||
                          saving ||
                          slides.length <= 1
                        }
                        onSelect={() => onDeleteSlide(index)}
                        className="text-destructive focus:text-destructive"
                      >
                        <IconTrash className="me-2 size-4" />
                        {t("editorSidebar.deleteSlide")}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <div
            role="separator"
            aria-label={t("editorToolbar.resizeSlideList")}
            aria-orientation="vertical"
            aria-controls="slides-2-slide-list"
            aria-valuemin={MIN_SLIDE_RAIL_WIDTH}
            aria-valuemax={MAX_SLIDE_RAIL_WIDTH}
            aria-valuenow={slideRailWidth}
            tabIndex={0}
            className="absolute inset-y-0 end-[-3px] z-20 w-[6px] cursor-col-resize touch-none bg-transparent hover:bg-primary/10 focus-visible:bg-primary/10"
            onPointerDown={handleSlideRailResizeStart}
            onPointerMove={handleSlideRailResizeMove}
            onPointerUp={finishSlideRailResize}
            onPointerCancel={finishSlideRailResize}
            onLostPointerCapture={finishSlideRailResize}
            onKeyDown={handleSlideRailResizeKeyDown}
          />
        </aside>
        <main className="relative mb-2 flex min-w-0 flex-1 flex-col bg-[hsl(var(--surface))] ps-2 pe-2">
          <div
            data-slides-2-stage-surface
            className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-[hsl(var(--slides2-stage-backdrop))]"
          >
            <div
              data-slides-2-stage-viewport
              className="relative min-h-0 flex-1 ps-8 pe-10 py-5 lg:ps-10 lg:pe-10 lg:pt-5"
            >
              {loading ? (
                <div className="absolute inset-x-10 inset-y-5 flex items-center justify-center">
                  <Skeleton className="aspect-video w-full max-w-5xl" />
                </div>
              ) : artifact ? (
                <Slides2Canvas zoom={zoom} onScaleChange={setFitScale}>
                  <div
                    ref={stageRef}
                    className="absolute left-0 top-0 h-[1080px] w-[1920px]"
                    data-slides-2-stage-inner
                    onPointerLeave={() => setHoveredNode(null)}
                  >
                    <SandboxedSlide
                      artifact={artifact}
                      title={title}
                      onNodes={handleNodes}
                      onPointer={previewMode ? () => {} : handleFramePointer}
                      onKeyboard={handleFrameKeyboard}
                      onController={setFrameController}
                      onNavigationInput={handlePreviewNavigationInput}
                      onStepCount={handlePreviewStepCount}
                      initialRevealedSteps={previewMode ? 0 : null}
                      onTextRangeStyle={setTextRangeStyleSnapshot}
                      onReady={clearRenderError}
                      onError={reportRenderError}
                      className="absolute inset-0"
                    />
                    {renderError ? (
                      <div className="pointer-events-none absolute inset-x-16 bottom-16 z-30 flex justify-center">
                        <div
                          role="alert"
                          className="max-w-full rounded-md border border-destructive/30 bg-background px-4 py-2 text-sm text-destructive shadow-sm"
                        >
                          {renderError}
                        </div>
                      </div>
                    ) : null}
                    <Slides2Comments
                      deckId={deckId}
                      slideId={source.id}
                      canComment={canComment}
                      canEdit={hasEditPermission}
                      active={!previewMode && commentMode}
                      sourceHash={hasUnsavedEdits ? null : source.sourceHash}
                      sourceNodes={nodes}
                      draftAnchor={commentDraftAnchor}
                      onDraftDone={() => setCommentDraftAnchor(null)}
                    />
                    <div
                      className={`absolute inset-0 pointer-events-none ${previewMode ? "hidden" : ""}`}
                      onPointerMove={handleOverlayPointerMove}
                      onPointerUp={finishOverlayPointer}
                      onPointerCancel={finishOverlayPointer}
                    >
                      {hoveredNode &&
                      !overlaySelected.some(
                        (node) => node.nodeId === hoveredNode.nodeId,
                      ) &&
                      !commentMode &&
                      !inlineNode &&
                      !dragRef.current ? (
                        <div
                          className="absolute border border-dashed border-primary/70"
                          style={{
                            left: hoveredNode.bounds.x,
                            top: hoveredNode.bounds.y,
                            width: hoveredNode.bounds.width,
                            height: hoveredNode.bounds.height,
                          }}
                        />
                      ) : null}
                      {overlaySelected.map((node) => (
                        <div
                          key={node.nodeId}
                          data-slide-selection-outline="true"
                          className="absolute border-[3px] slides2-selection-outline"
                          style={{
                            left: node.bounds.x,
                            top: node.bounds.y,
                            width: node.bounds.width,
                            height: node.bounds.height,
                          }}
                        />
                      ))}
                      {selectedRect && overlaySelected.length === 1 ? (
                        <div
                          className="absolute"
                          style={{
                            left: selectedRect.x,
                            top: selectedRect.y,
                            width: selectedRect.width,
                            height: selectedRect.height,
                          }}
                        >
                          {RESIZE_HANDLES.map(({ key, cursor }) => {
                            const point = handlePoint(selectedRect, key);
                            return (
                              <button
                                key={key}
                                type="button"
                                data-slide-resize-handle={key}
                                disabled={
                                  !canEdit || saving || structuralSaving
                                }
                                aria-label={t("styleInspector.resizeHandle", {
                                  handle: key,
                                })}
                                aria-keyshortcuts={transformHandleShortcuts(
                                  key,
                                )}
                                onKeyDown={(event) =>
                                  handleTransformKeyDown(event, key)
                                }
                                onPointerDown={(event) =>
                                  startHandle(event, key)
                                }
                                className="pointer-events-auto absolute rounded-[5px] border-[3px] slides2-selection-handle shadow-sm focus-visible:outline-2 focus-visible:outline-primary"
                                style={{
                                  left:
                                    point.x - selectedRect.x - handleSize / 2,
                                  top:
                                    point.y - selectedRect.y - handleSize / 2,
                                  width: handleSize,
                                  height: handleSize,
                                  cursor,
                                }}
                              />
                            );
                          })}
                          <span
                            aria-hidden="true"
                            data-slide-rotate-stem="true"
                            className="pointer-events-none absolute left-1/2 -translate-x-1/2 slides2-selection-rotate-stem"
                            style={{
                              top: -rotateStemLength,
                              width: 1 / canvasScale,
                              height: rotateStemLength,
                            }}
                          />
                          <button
                            type="button"
                            data-slide-rotate-handle="true"
                            disabled={!canEdit || saving || structuralSaving}
                            aria-label={t("styleInspector.rotateHandle")}
                            aria-keyshortcuts={transformHandleShortcuts(
                              "rotate",
                            )}
                            onKeyDown={(event) =>
                              handleTransformKeyDown(event, "rotate")
                            }
                            onPointerDown={(event) =>
                              startHandle(event, "rotate")
                            }
                            className="pointer-events-auto absolute left-1/2 -translate-x-1/2 cursor-grab rounded-full border-[3px] slides2-selection-handle shadow-sm focus-visible:outline-2 focus-visible:outline-primary"
                            style={{
                              top: rotateHandleTop,
                              width: handleSize,
                              height: handleSize,
                            }}
                          />
                        </div>
                      ) : null}
                      {selectedRect && overlaySelected.length > 1 ? (
                        <div
                          className="absolute border border-primary"
                          style={{
                            left: selectedRect.x,
                            top: selectedRect.y,
                            width: selectedRect.width,
                            height: selectedRect.height,
                          }}
                        />
                      ) : null}
                      {selectedRect &&
                      selected.length === 1 &&
                      hasImageTarget &&
                      !dragRef.current ? (
                        <div
                          className="pointer-events-auto absolute z-10 flex rounded-md border border-border bg-popover p-1 shadow-md"
                          style={{
                            left: selectedRect.x + selectedRect.width / 2,
                            top:
                              selectedRect.y +
                              selectedRect.height +
                              10 / canvasScale,
                            gap: 4 / canvasScale,
                            padding: 4 / canvasScale,
                            transform: "translateX(-50%)",
                          }}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            disabled={!canEdit || saving || structuralSaving}
                            aria-label={t("contextToolbar.replaceImage")}
                            title={t("contextToolbar.replaceImage")}
                            onClick={() => setAssetBrowserOpen(true)}
                            style={{
                              width: 28 / canvasScale,
                              height: 28 / canvasScale,
                            }}
                          >
                            <IconPhoto
                              aria-hidden="true"
                              style={{
                                width: 14 / canvasScale,
                                height: 14 / canvasScale,
                              }}
                            />
                          </Button>
                          {selectedImage ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              disabled={
                                !canEdit ||
                                saving ||
                                structuralSaving ||
                                !selectedImageSrc
                              }
                              aria-label={t("editorToolbar.cropImage")}
                              title={t("editorToolbar.cropImage")}
                              onClick={() => setImageCropOpen(true)}
                              style={{
                                width: 28 / canvasScale,
                                height: 28 / canvasScale,
                              }}
                            >
                              <IconCrop
                                aria-hidden="true"
                                style={{
                                  width: 14 / canvasScale,
                                  height: 14 / canvasScale,
                                }}
                              />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {guideLines.map((guide, index) => (
                        <div
                          key={`${guide.axis}:${guide.position}:${index}`}
                          className="absolute border-primary"
                          style={
                            guide.axis === "x"
                              ? {
                                  left: guide.position,
                                  top: guide.start,
                                  height: guide.end - guide.start,
                                  borderLeftWidth: 1,
                                }
                              : {
                                  top: guide.position,
                                  left: guide.start,
                                  width: guide.end - guide.start,
                                  borderTopWidth: 1,
                                }
                          }
                        />
                      ))}
                      {marquee ? (
                        <div
                          className="absolute border border-primary bg-primary/10"
                          style={{
                            left: marquee.x,
                            top: marquee.y,
                            width: marquee.width,
                            height: marquee.height,
                          }}
                        />
                      ) : null}
                      {inlineNode ? (
                        <InlineTextEditor
                          key={inlineNode.nodeId}
                          node={inlineNode}
                          initialPoint={inlineTextPoint ?? undefined}
                          disabled={!canEdit || saving}
                          t={t}
                          onCommit={commitInlineEdits}
                          onCancel={() => setInlineNode(null)}
                          onUndo={() => void undo()}
                          onRedo={() => void redo()}
                        />
                      ) : null}
                    </div>
                  </div>
                </Slides2Canvas>
              ) : (
                <div className="absolute inset-0 grid place-items-center p-8 text-sm text-muted-foreground">
                  {loadingError ?? t("presentation.loadFailed")}
                </div>
              )}
            </div>
          </div>
        </main>
        {inspectorOpen ? (
          <aside className="flex h-full w-80 shrink-0 flex-col border-s border-border bg-background">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 ps-5 pe-3">
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                <IconPalette
                  className="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
                {inspectorTitle}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("slides2Editor.hideInspector")}
                title={t("slides2Editor.hideInspector")}
                onClick={toggleInspector}
              >
                <IconX aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {activePanel === "format" ? (
                <Slides2Inspector
                  selected={
                    distinctSelected.length === 1
                      ? (distinctSelected[0] ?? null)
                      : null
                  }
                  rangeStyleSnapshot={textRangeStyleSnapshot}
                  selectionCount={distinctSelected.length}
                  disabled={
                    !canEdit ||
                    saving ||
                    structuralSaving ||
                    transformSlideObjects.isPending
                  }
                  t={t}
                  onInspectTextRange={inspectSavedTextRange}
                  onEditOnSlide={() => {
                    if (distinctSelected.length === 1) {
                      openInlineTextEditor(distinctSelected[0]);
                    }
                  }}
                  onEdit={editSelected}
                  onAlign={alignSelection}
                  alignToSlide={alignToSlide}
                  onAlignToSlideChange={setAlignToSlide}
                  smartGuidesEnabled={smartGuidesEnabled}
                  onSmartGuidesChange={(enabled) => {
                    setSmartGuidesEnabled(enabled);
                    if (!enabled) setGuideLines([]);
                  }}
                  onDistribute={distributeSelection}
                  onArrange={arrangeSelection}
                  onGroup={() => void groupObjects()}
                  onUngroup={() => void ungroupObjects()}
                  canUngroup={selectedGroupChildIds !== null}
                  onDuplicateObject={() => void duplicateObject()}
                  onDeleteObject={() => void deleteObject()}
                  canSelectParent={Boolean(selectedParentNode)}
                  onSelectParent={selectParent}
                />
              ) : activePanel === "design" ? (
                <Slides2DesignTokens
                  tokens={designTokens}
                  disabled={!canEdit}
                  saving={savingDesignTokens}
                  onPreview={handleDesignTokenPreview}
                  onSave={onSaveDesignTokens}
                />
              ) : activePanel === "motion" ? (
                <Slides2MotionPanel
                  key={activeSlide?.id}
                  sourceTsx={committedSourceRef.current.sourceTsx}
                  transition={artifact?.runtime?.transition}
                  selection={
                    distinctSelected.length === 1 &&
                    hasUniqueRenderedInstances(distinctSelected, nodes)
                      ? {
                          line: distinctSelected[0]!.line,
                          column: distinctSelected[0]!.column,
                        }
                      : null
                  }
                  disabled={
                    !canEdit || saving || structuralSaving || hasUnsavedEdits
                  }
                  t={t}
                  onCommit={commitSourceReplacement}
                />
              ) : (
                <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3 p-4">
                  <Textarea
                    value={notesDraft}
                    disabled={!canEdit || savingNotes}
                    aria-label={t("presentation.speakerNotes")}
                    placeholder={t("presentation.noNotesForSlide")}
                    onChange={(event) =>
                      setNotesDraft(event.currentTarget.value)
                    }
                    className="min-h-0 resize-none text-foreground"
                  />
                  <Button
                    type="button"
                    disabled={!canEdit || savingNotes || notesDraft === notes}
                    onClick={() => void onSaveNotes(notesDraft)}
                  >
                    {savingNotes
                      ? t("designSystemSetup.saving")
                      : t("designSystemSetup.saveChanges")}
                  </Button>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
      <footer className="flex h-9 shrink-0 items-center justify-between ps-0 pe-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 justify-start px-1 text-xs text-muted-foreground"
            aria-label={t("presentation.speakerNotes")}
            aria-pressed={inspectorOpen && activePanel === "notes"}
            title={t("presentation.speakerNotes")}
            onClick={() => showInspectorPanel("notes")}
          >
            <IconNotes aria-hidden="true" />
            <span>{t("slides2Editor.footerNotes")}</span>
            <span className="ms-1 tabular-nums">
              {t("slides2Editor.footerPage", {
                current: formatters.formatNumber(sliderPosition),
                total: formatters.formatNumber(slides.length),
              })}
            </span>
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground"
          aria-label={
            inspectorOpen
              ? t("slides2Editor.hideInspector")
              : t("slides2Editor.showInspector")
          }
          title={
            inspectorOpen
              ? t("slides2Editor.hideInspector")
              : t("slides2Editor.showInspector")
          }
          onClick={toggleInspector}
        >
          {inspectorOpen ? (
            <IconChevronUp aria-hidden="true" />
          ) : (
            <IconChevronDown aria-hidden="true" />
          )}
        </Button>
      </footer>
      <Slides2AssetBrowser
        deckId={deckId}
        slideId={activeSlide?.id ?? ""}
        open={assetBrowserOpen}
        onOpenChange={setAssetBrowserOpen}
        canInsert={canEdit && !saving && !structuralSaving}
        onInsert={insertAsset}
      />
      <Slides2HistoryPanel
        deckId={deckId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canRestore={canEdit}
        restoreDisabled={saving || structuralSaving}
        onBeforeRestore={async () => {
          if (!(await save())) {
            throw new Error(t("slides2Editor.saveBeforeStructureEdit"));
          }
        }}
        onRestored={async () => {
          await onVersionRestored?.();
        }}
      />
      {imageCropOpen && selectedImage && selectedImageSrc ? (
        <Slides2ImageCropControls
          src={selectedImageSrc}
          targetWidth={Math.max(1, selectedImage.bounds.width)}
          targetHeight={Math.max(1, selectedImage.bounds.height)}
          initialFit={
            selectedImage.styles.objectFit === "contain" ? "contain" : "cover"
          }
          initialPosition={objectPositionPercent(
            selectedImage.styles.objectPosition,
          )}
          initialRect={objectViewBoxToCropRect(
            selectedImage.styles.objectViewBox,
          )}
          labels={{
            title: t("editorToolbar.cropImage"),
            description: t("slides2Editor.cropDescription"),
            fitMode: t("slides2Editor.cropFitMode"),
            fitCover: t("contextToolbar.fitCover"),
            fitContain: t("contextToolbar.fitContain"),
            cropRegion: t("slides2Editor.cropRegion"),
            close: t("comments.close"),
            cancel: t("slideTextMenu.cancel"),
            apply: t("slideTextMenu.apply"),
          }}
          onClose={() => setImageCropOpen(false)}
          onApply={applyImageCrop}
        />
      ) : null}
      <Dialog open={overviewOpen} onOpenChange={setOverviewOpen}>
        <DialogContent
          closeLabel={t("comments.close")}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => {
              document
                .querySelector<HTMLButtonElement>(
                  "[data-slide-overview-active='true']",
                )
                ?.focus();
            });
          }}
          overlayClassName="top-12 bg-popover/95 backdrop-blur-none"
          className="inset-x-0 bottom-0 left-0 top-12 flex h-auto max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-popover/95 p-0 shadow-none"
        >
          <DialogHeader className="flex h-[60px] shrink-0 flex-row items-center justify-between border-b border-border/60 px-6">
            <DialogTitle className="text-xs font-semibold uppercase tracking-widest">
              {`${t("slides2Presenter.overview")} ${String(activeIndex + 1).padStart(2, "0")} · ${slides.length}`}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-0">
            <div
              ref={overviewGridRef}
              onKeyDown={handleOverviewKeyDown}
              className="mx-auto grid w-full max-w-[1000px] grid-cols-1 content-start gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {slides.map((slide, index) => (
                <SlideOverviewThumbnail
                  key={slide.id}
                  deckId={deckId}
                  slide={slide}
                  index={index}
                  selected={index === activeIndex}
                  focused={index === focusedOverviewIndex}
                  total={slides.length}
                  onFocus={setFocusedOverviewIndex}
                  onSelect={() => {
                    onSelectSlide(index);
                    setOverviewOpen(false);
                  }}
                />
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Slides2CommandMenu
        open={commandMenuOpen}
        onOpenChange={setCommandMenuOpen}
        backHref={backHref}
        slides={slides}
        activeIndex={activeIndex}
        canEdit={canEdit && !saving && !structuralSaving}
        canComment={canComment}
        canUndo={canUndo && !saving}
        canRedo={canRedo && !saving}
        onSelectSlide={onSelectSlide}
        onAddSlide={onAddSlide}
        onInsertObject={insertObject}
        onDuplicateSlide={onDuplicateSlide}
        onDeleteSlide={onDeleteSlide}
        onUndo={undo}
        onRedo={redo}
        onPresent={(mode) => void present(mode)}
        onOpenPresenter={() => {
          onOpenPresenter?.();
          void present("windowed");
        }}
        onOpenOverview={() => setOverviewOpen(true)}
        onToggleDesignPanel={toggleDesignPanel}
        onOpenMotionPanel={() => showInspectorPanel("motion")}
        onSetZoom={(action) => {
          if (action === "fit") {
            fitToScreen();
            return;
          }
          setZoom((value) =>
            action === "out"
              ? Math.max(MIN_ZOOM, round(value - ZOOM_STEP))
              : Math.min(MAX_ZOOM, round(value + ZOOM_STEP)),
          );
        }}
        onToggleCommentMode={() => {
          commentGestureRef.current = null;
          setCommentMode((value) => !value);
        }}
        onCopyLink={() => void copyLink()}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenAssets={() => setAssetBrowserOpen(true)}
        onExport={(format: Slides2ExportFormat) =>
          exportMenuRef.current?.run(format)
        }
      />
    </div>
  );
}
