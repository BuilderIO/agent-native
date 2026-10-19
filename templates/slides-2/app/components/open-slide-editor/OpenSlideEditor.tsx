import {
  compareAndSetClientAppState,
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import {
  useActionQuery,
  useChangeVersion,
  useDbSync,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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
  IconCheck,
  IconPlayerPlay,
  IconMinus,
  IconPlus,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowDown,
  IconArrowUp,
  IconPhoto,
  IconCopy,
  IconMessageCircle,
  IconSearch,
  IconTrash,
  IconEye,
  IconPencil,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AspectRatio } from "@/lib/aspect-ratios";
import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorForRegion,
} from "@/lib/slide-comment-anchor";
import { TAB_ID } from "@/lib/tab-id";

import { OpenSlideCanvas } from "../open-slide-runtime/OpenSlideCanvas";
import type {
  SlideDesignTokens,
  SlideFrameNavigationInput,
  SlideRenderArtifact,
  SlideFrameTextRangeStyle,
} from "../open-slide-runtime/protocol";
import {
  SandboxedSlide,
  type FrameKeyboard,
  type FramePointer,
  type SlideFrameController,
} from "../open-slide-runtime/SandboxedSlide";
import { getEditorActionErrorTranslationKey } from "./editor-action-errors";
import {
  alignRects,
  constrainMoveDelta,
  distributeRects,
  OPEN_SLIDE_BOUNDS,
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
import { getOpenSlideEditorShortcut } from "./keyboard-shortcuts";
import {
  insertSourceObject,
  getDefaultComponentRootRange,
  type OpenSlideObjectKind,
} from "./object-insertion";
import { OpenSlideAssetBrowser } from "./OpenSlideAssetBrowser";
import { OpenSlideCommandMenu } from "./OpenSlideCommandMenu";
import { OpenSlideComments } from "./OpenSlideComments";
import { OpenSlideDesignTokens } from "./OpenSlideDesignTokens";
import {
  OpenSlideExportMenu,
  type OpenSlideExportFormat,
  type OpenSlideExportMenuHandle,
} from "./OpenSlideExportMenu";
import {
  OpenSlideImageCropControls,
  type OpenSlideImageCropResult,
} from "./OpenSlideImageCropControls";
import { OpenSlideInspector } from "./OpenSlideInspector";
import { getPreviewPatches } from "./preview-patches";
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
export type OpenSlideInspectorPanel = "format" | "design" | "notes";
export type OpenSlideEditorMode = "edit" | "preview";

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
  t?: Translate;
  onSelectSlide: (index: number) => void;
  onPresent: (mode?: "fullscreen" | "windowed") => void;
  onOpenPresenter?: () => void;
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
  editorMode?: OpenSlideEditorMode;
  onPanelChange?: (panel: OpenSlideInspectorPanel | null) => void;
  onEditorModeChange?: (mode: OpenSlideEditorMode) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (index: number) => void;
  onDeleteSlide: (index: number) => void;
  onMoveSlide: (from: number, to: number) => void;
};

type EditBatch = SourceEdit[];
const SLIDE_RAIL_WIDTH_STATE_KEY = appStateKey("open-slide-editor-rail-width");
const DEFAULT_SLIDE_RAIL_WIDTH = 264;
const MIN_SLIDE_RAIL_WIDTH = 200;
const MAX_SLIDE_RAIL_WIDTH = 480;

function clampSlideRailWidth(width: number): number {
  return Math.min(
    MAX_SLIDE_RAIL_WIDTH,
    Math.max(MIN_SLIDE_RAIL_WIDTH, Math.round(width)),
  );
}

function readSlideRailWidth(value: unknown): number | null {
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

function uniqueByLocator(nodes: ElementSnapshot[]): ElementSnapshot[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = `${node.line}:${node.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function editFor(node: ElementSnapshot, ops: SourceEditOp[]): SourceEdit {
  return { line: node.line, column: node.column, ops };
}

function sourceString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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
  const wrapper = `<div style={{ position: "relative", width: "${OPEN_SLIDE_BOUNDS.width}px", height: "${OPEN_SLIDE_BOUNDS.height}px", boxSizing: "border-box", overflow: "hidden" }}>${newline}${indentedRoot}${newline}  ${video}${newline}</div>`;
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
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.origin === window.location.origin
      ? url.toString()
      : null;
  } catch {
    // coercion-ok: malformed source URLs cannot provide a safe crop image and are omitted.
    return null;
  }
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
  dragDisabled,
  onSelect,
  onNavigate,
}: {
  deckId: string;
  slide: SlideSummary;
  slideIndex: number;
  selected: boolean;
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
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={`group grid h-auto w-full grid-cols-[28px_minmax(0,1fr)] items-start gap-2 rounded-md p-2 text-start font-normal transition-colors active:scale-100 ${selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
    >
      <button
        ref={setNodeRef}
        type="button"
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
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            onNavigate(event.key === "ArrowUp" ? -1 : 1);
          }
        }}
        data-open-slide-thumbnail-index={slideIndex}
        aria-label={t("editorSidebar.selectSlide", {
          number: slide.slideNumber,
        })}
        aria-current={selected ? "true" : undefined}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          touchAction: dragDisabled ? undefined : "none",
          opacity: isDragging ? 0.6 : undefined,
        }}
      >
        <span className="pt-1 text-xs tabular-nums text-muted-foreground">
          {slide.slideNumber}
        </span>
        <span className="min-w-0">
          <span
            ref={frameRef}
            className={
              /* guard:allow-raw-color — thumbnail previews render the fixed white slide canvas. */ `relative block aspect-video overflow-hidden rounded border bg-white ${selected ? "border-primary" : "border-border"}`
            }
          >
            {visible && render.data ? (
              <OpenSlideCanvas scale={0.085} flat>
                <SandboxedSlide
                  artifact={render.data}
                  title={t("openSlidePresenter.slideLabel", {
                    index: slide.slideNumber,
                  })}
                  onNodes={() => {}}
                  onPointer={() => {}}
                />
              </OpenSlideCanvas>
            ) : (
              <span className="absolute inset-0 flex items-center justify-center bg-muted/40 px-3 text-center text-[10px] text-muted-foreground">
                {slide.textPreview || ""}
              </span>
            )}
          </span>
          {slide.textPreview ? (
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">
              {slide.textPreview}
            </span>
          ) : null}
        </span>
      </button>
    </Button>
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
        aria-label={t("openSlidePresenter.slideLabel", {
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
            <OpenSlideCanvas flat>
              <SandboxedSlide
                artifact={render.data}
                title={t("openSlidePresenter.slideLabel", {
                  index: slide.slideNumber,
                })}
                onNodes={() => {}}
                onPointer={() => {}}
              />
            </OpenSlideCanvas>
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
              {t("openSlideEditor.now")}
            </span>
          ) : null}
        </span>
        <span className="px-1 text-xs text-muted-foreground">
          {t("openSlidePresenter.position", {
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

export function OpenSlideEditor({
  deckId,
  title,
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
  t: suppliedT,
  onSelectSlide,
  onPresent,
  onOpenPresenter,
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
  onDeleteSlide,
  onMoveSlide,
}: Props) {
  const defaultT = useT();
  const t = suppliedT ?? defaultT;
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
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [slideRailWidth, setSlideRailWidth] = useState(
    DEFAULT_SLIDE_RAIL_WIDTH,
  );
  const slideRailWidthRef = useRef(DEFAULT_SLIDE_RAIL_WIDTH);
  const slideRailTouchedRef = useRef(false);
  const slideRailResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const slideRailListRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<ElementSnapshot[]>([]);
  const [textRangeStyleSnapshot, setTextRangeStyleSnapshot] =
    useState<SlideFrameTextRangeStyle | null>(null);
  const [selectedTextRange, setSelectedTextRange] =
    useState<SlideTextRangeSelection | null>(null);
  const [inlineNode, setInlineNode] = useState<ElementSnapshot | null>(null);
  const [inlineTextPoint, setInlineTextPoint] = useState<Point | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [guideLines, setGuideLines] = useState<
    ReturnType<typeof snapMove>["guides"]
  >([]);
  const [smartGuidesEnabled, setSmartGuidesEnabled] = useState(true);
  const [alignToSlide, setAlignToSlide] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [editBatches, setEditBatches] = useState<EditBatch[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
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
    selection: SourceSelection;
  } | null>(null);
  const [activePanel, setActivePanel] =
    useState<OpenSlideInspectorPanel>("format");
  const [inspectorOpen, setInspectorOpen] = useState(
    suppliedEditorMode !== "preview",
  );
  const [localEditorMode, setLocalEditorMode] =
    useState<OpenSlideEditorMode>("edit");
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
  const inspectorBeforePreviewRef = useRef<boolean | null>(null);
  const inspectorToggledInPreviewRef = useRef(false);
  const previewArtifactKey = artifact
    ? `${artifact.deckId}:${artifact.slideId}:${artifact.revision}:${artifact.sourceHash}`
    : null;
  const activePreviewStepState =
    previewStepState.artifactKey === previewArtifactKey
      ? previewStepState
      : {
          artifactKey: previewArtifactKey,
          stepCount: null,
          revealedSteps: 0,
        };
  const previousPanelRef = useRef<OpenSlideInspectorPanel>("format");
  useEffect(() => {
    if (activePanel !== "design") previousPanelRef.current = activePanel;
  }, [activePanel]);
  const toggleDesignPanel = useCallback(() => {
    setActivePanel((panel) =>
      panel === "design" ? previousPanelRef.current : "design",
    );
  }, []);
  const toggleInspector = useCallback(() => {
    if (previewModeRef.current) inspectorToggledInPreviewRef.current = true;
    setInspectorOpen((open) => !open);
  }, []);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadingSource, setReloadingSource] = useState(false);
  const canEdit = hasEditPermission && !sourceConflict;
  const [notesDraft, setNotesDraft] = useState(notes);
  const [assetBrowserOpen, setAssetBrowserOpen] = useState(false);
  const [imageCropOpen, setImageCropOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [focusedOverviewIndex, setFocusedOverviewIndex] = useState(activeIndex);
  const [commentMode, setCommentMode] = useState(false);
  const [commentDraftAnchor, setCommentDraftAnchor] =
    useState<SlideCommentAnchor | null>(null);
  const exportMenuRef = useRef<OpenSlideExportMenuHandle>(null);
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
        setSlideRailWidth(savedWidth);
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
  }, []);

  const updateSlideRailWidth = useCallback((width: number) => {
    const nextWidth = clampSlideRailWidth(width);
    slideRailTouchedRef.current = true;
    slideRailWidthRef.current = nextWidth;
    setSlideRailWidth(nextWidth);
    return nextWidth;
  }, []);

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
  const distinctSelected = useMemo(() => uniqueByLocator(selected), [selected]);
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
  const selectedImageSrc = cropImageUrl(selectedImageAsset?.url);
  const selectionBounds = useMemo(
    () => unionRects(selected.map((node) => node.bounds)),
    [selected],
  );
  const hasUnsavedEdits = historyIndex > 0;
  const canUndo =
    historyIndex > 0 || (!hasUnsavedEdits && committedHistoryIndex > 0);
  const canRedo =
    historyIndex < editBatches.length ||
    (!hasUnsavedEdits && committedHistoryIndex < committedHistory.length - 1);
  const activeEdits = useMemo(
    () => editBatches.slice(0, historyIndex).flat(),
    [editBatches, historyIndex],
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
      const next = { ...committedSourceRef.current, ...nextSource };
      committedSourceRef.current = next;
      setCommittedSource(next);
      if (addToHistory) {
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
    },
    [bumpHistoryVersion],
  );

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
  }, [bumpHistoryVersion, onReloadSource, reloadingSource, sourceConflict, t]);

  useEffect(() => setNotesDraft(notes), [notes]);

  const handleThumbnailNavigate = useCallback(
    (index: number, direction: -1 | 1) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= slides.length) return;
      slideRailListRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-open-slide-thumbnail-index="${nextIndex}"]`,
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
    selectedIdsRef.current = [];
    setSelectedIds([]);
  }, [
    committedHistory,
    committedSource.sourceHash,
    hasUnsavedEdits,
    source.revision,
    source.sourceHash,
    source.sourceTsx,
    bumpHistoryVersion,
  ]);

  useEffect(() => {
    const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
    const textRange = currentSlideTextRangeSelection(
      selectedTextRange,
      {
        slideId: source.id,
        revision: source.revision,
        sourceHash: source.sourceHash,
      },
      target ? { line: target.line, column: target.column } : null,
    );
    onSelectionChange(selected, textRange);
  }, [
    distinctSelected,
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
    const target = nodes.find(
      (node) =>
        node.line === pendingSourceSelection.selection.line &&
        node.column === pendingSourceSelection.selection.column,
    );
    if (!target) return;
    selectedIdsRef.current = [target.nodeId];
    setSelectedIds([target.nodeId]);
    controllerRef.current?.send({
      type: "inspect",
      targets: [
        { line: target.line, column: target.column, nodeId: target.nodeId },
      ],
    });
    setPendingSourceSelection(null);
  }, [artifact?.revision, nodes, pendingSourceSelection]);

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
      bumpHistoryVersion();
      setSaveError(null);
      const bounded = [...editBatches.slice(0, historyIndex), edits].slice(
        -EDIT_HISTORY_LIMIT,
      );
      setEditBatches(bounded);
      setHistoryIndex(bounded.length);
    },
    [bumpHistoryVersion, editBatches, historyIndex],
  );

  const applyImageCrop = useCallback(
    (result: OpenSlideImageCropResult) => {
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

  const handleNodes = useCallback((nextNodes: ElementSnapshot[]) => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.nodeId, node]));
      const nextById = new Map(nextNodes.map((node) => [node.nodeId, node]));
      for (const node of nextNodes) {
        const previous = currentById.get(node.nodeId);
        if (previous?.transform && !node.transform)
          nextById.set(node.nodeId, { ...node, transform: previous.transform });
      }
      return [...nextById.values()];
    });
  }, []);

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
      const targets = [...otherRects, OPEN_SLIDE_BOUNDS];
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
      const target = pointer.target?.snapshot;
      if (!target) {
        dragRef.current = {
          mode: "marquee",
          pointerId: pointer.pointerId,
          start: { x: pointer.x, y: pointer.y },
          moved: false,
          nodeIds: [],
          initial: [],
          marquee: { x: pointer.x, y: pointer.y, width: 0, height: 0 },
        };
        return;
      }

      const previousIds = selectedIdsRef.current;
      const wasSelected = previousIds.includes(target.nodeId);
      const nextIds = pointer.shiftKey
        ? wasSelected
          ? previousIds.filter((id) => id !== target.nodeId)
          : [...previousIds, target.nodeId]
        : wasSelected
          ? previousIds
          : [target.nodeId];
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
      if (!selectedBase.some((node) => node.nodeId === target.nodeId)) {
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
            target: pointer.target?.snapshot ?? null,
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

          const target = pointer.target?.snapshot ?? gesture.target;
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
        openInlineTextEditor(pointer.target?.snapshot, {
          x: pointer.x,
          y: pointer.y,
        });
        return;
      }
      if (inlineNode) return;
      if (pointer.phase === "down") {
        beginPointerInteraction(pointer);
        return;
      }
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== pointer.pointerId) return;
      if (pointer.phase === "move") {
        const dx = pointer.x - drag.start.x;
        const dy = pointer.y - drag.start.y;
        drag.moved ||= Math.hypot(dx, dy) > 1.5;
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
        }
        return;
      }
      if (pointer.phase !== "up" && pointer.phase !== "cancel") return;

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
        const ids = nodes
          .filter((node) => rectsIntersect(drag.marquee as Rect, node.bounds))
          .map((node) => node.nodeId);
        selectedIdsRef.current = ids;
        setSelectedIds(ids);
        inspect(ids);
      } else if (
        drag.mode === "marquee" &&
        !drag.moved &&
        pointer.phase === "up"
      ) {
        selectedIdsRef.current = [];
        setSelectedIds([]);
        inspect([]);
      }
      dragRef.current = null;
      setMarquee(null);
      setGuideLines([]);
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
      restoreActivePreview,
      setCommentDraftAnchor,
      setCommentMode,
      updatePreviewForMove,
      smartGuidesEnabled,
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
    drag.moved ||= Math.hypot(dx, dy) > 1.5;
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
      const basis = node.transform?.basis ?? { a: 1, b: 0, c: 0, d: 1 };
      const initialSize = {
        width: node.transform?.width ?? node.bounds.width,
        height: node.transform?.height ?? node.bounds.height,
      };
      const solved = solveResizeDimensions(initialSize, basis, {
        x: dx,
        y: dy,
      });
      const next = resizeRect(
        drag.initialRect,
        handle,
        { x: dx, y: dy },
        event.shiftKey,
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
    if (drag.moved) {
      const node = drag.initial[0];
      const point = eventPoint(event);
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
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
        const solved = solveResizeDimensions(
          initialSize,
          node.transform?.basis ?? { a: 1, b: 0, c: 0, d: 1 },
          { x: dx, y: dy },
        );
        const next = resizeRect(
          drag.initialRect,
          handle,
          { x: dx, y: dy },
          event.shiftKey,
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
      toSlide || rects.length === 1 ? OPEN_SLIDE_BOUNDS : undefined,
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
      toast.error(t("openSlideEditor.objectStructureUnsupported"));
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

  const commitSourceReplacement = async (
    sourceTsx: string,
    selection?: SourceSelection,
  ): Promise<boolean> => {
    if (!canEdit || saving) return false;
    if (hasUnsavedEdits) {
      setSaveError(t("openSlideEditor.saveBeforeStructureEdit"));
      return false;
    }
    bumpHistoryVersion();
    setSaveError(null);
    try {
      const result = await onRestore(sourceTsx, committedSourceRef.current);
      recordCommittedSource(result);
      setEditBatches([]);
      setHistoryIndex(0);
      selectedIdsRef.current = [];
      setSelectedIds([]);
      setNodes([]);
      setPendingSourceSelection(
        selection ? { revision: result.revision, selection } : null,
      );
      controllerRef.current?.send({ type: "clear-preview" });
      return true;
    } catch (error) {
      setSaveError(
        t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
      );
      return false;
    }
  };

  const duplicateObject = async () => {
    const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
    if (!canEdit || saving || !target) return;
    if (hasUnsavedEdits) {
      setSaveError(t("openSlideEditor.saveBeforeStructureEdit"));
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
      setSaveError(t("openSlideEditor.objectStructureUnsupported"));
      return;
    }
    await commitSourceReplacement(result.sourceTsx, result.selection);
  };

  const deleteObject = async () => {
    const target = distinctSelected.length === 1 ? distinctSelected[0] : null;
    if (!canEdit || saving || !target) return;
    if (hasUnsavedEdits) {
      setSaveError(t("openSlideEditor.saveBeforeStructureEdit"));
      return;
    }
    const result = deleteSourceElement(committedSourceRef.current.sourceTsx, {
      line: target.line,
      column: target.column,
    });
    if (!result) {
      setSaveError(t("openSlideEditor.objectStructureUnsupported"));
      return;
    }
    await commitSourceReplacement(result.sourceTsx);
  };

  const insertAsset = async (
    assetId: string,
    filename: string,
    type: string,
  ): Promise<string | null> => {
    const isVideo = type === "video/mp4" || type === "video/webm";
    const failureKey = isVideo
      ? "openSlideEditor.videoInsertFailed"
      : "openSlideEditor.imageInsertFailed";
    if (!canEdit || saving) return t(failureKey);
    if (hasUnsavedEdits) return t("openSlideEditor.saveBeforeStructureEdit");
    if (isVideo && assetTarget?.tagName.toLowerCase() === "video") {
      const sourceTsx = replaceVideoAssetSource(
        committedSourceRef.current.sourceTsx,
        { line: assetTarget.line, column: assetTarget.column },
        assetId,
      );
      if (!sourceTsx) return t(failureKey);
      const saved = await commitSourceReplacement(sourceTsx, {
        line: assetTarget.line,
        column: assetTarget.column,
      });
      return saved ? null : t(failureKey);
    }
    if (type.startsWith("video/") && !isVideo) return t(failureKey);
    if (isVideo) {
      const result = insertVideoAssetOnCanvas(
        committedSourceRef.current.sourceTsx,
        assetId,
        filename,
      );
      if (!result) return t("openSlideEditor.objectStructureUnsupported");
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
    if (!result) return t("openSlideEditor.objectStructureUnsupported");
    const saved = await commitSourceReplacement(
      result.sourceTsx,
      result.selection,
    );
    return saved ? null : t(failureKey);
  };

  const insertObject = async (kind: OpenSlideObjectKind) => {
    if (!canEdit || saving || structuralSaving) return;
    if (hasUnsavedEdits) {
      setSaveError(t("openSlideEditor.saveBeforeStructureEdit"));
      return;
    }
    const result = insertSourceObject(committedSourceRef.current.sourceTsx, {
      kind,
      ...(kind === "text" ? { text: t("openSlideEditor.newTextObject") } : {}),
    });
    if (!result) {
      setSaveError(t("openSlideEditor.objectStructureUnsupported"));
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
    if (hasUnsavedEdits && !(await save())) return;
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
    if (onEditorModeChange) {
      onEditorModeChange(nextPreviewMode ? "preview" : "edit");
    } else {
      setLocalEditorMode(nextPreviewMode ? "preview" : "edit");
    }
  }, [inspectorOpen, onEditorModeChange, previewArtifactKey, previewMode]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("share.copied"));
    } catch {
      toast.error(t("openSlideEditor.copyLinkFailed"));
    }
  };

  const selectAllElements = () => {
    const ids = uniqueByLocator(nodes).map((node) => node.nodeId);
    selectedIdsRef.current = ids;
    setSelectedIds(ids);
    setGuideLines([]);
    if (ids.length) window.requestAnimationFrame(() => inspect(ids));
  };

  const dispatchEditorShortcut = (action: string) => {
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
      case "previous-slide":
        onSelectSlide(Math.max(0, activeIndex - 1));
        break;
      case "next-slide":
        onSelectSlide(Math.min(slides.length - 1, activeIndex + 1));
        break;
    }
  };

  const undo = useCallback((): boolean | Promise<boolean> => {
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
    hasUnsavedEdits,
    historyIndex,
    restoreCommittedHistory,
  ]);
  const redo = useCallback((): boolean | Promise<boolean> => {
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
      if (!modifiers.altKey && command && key.toLowerCase() === "z") {
        if (modifiers.shiftKey) redo();
        else undo();
        return;
      }
      if (!modifiers.altKey && command && key.toLowerCase() === "y") {
        redo();
        return;
      }
      if (key === "Escape") {
        if (dragRef.current) {
          if (dragRef.current.moved) restoreActivePreview();
          dragRef.current = null;
          setMarquee(null);
          setGuideLines([]);
          return;
        }
        selectedIdsRef.current = [];
        setSelectedIds([]);
        setGuideLines([]);
        return;
      }
      if (
        canEdit &&
        !commentMode &&
        selectedIdsRef.current.length &&
        !modifiers.altKey &&
        !modifiers.ctrlKey &&
        !modifiers.metaKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)
      ) {
        const delta = modifiers.shiftKey ? 10 : 1;
        const dx =
          key === "ArrowLeft" ? -delta : key === "ArrowRight" ? delta : 0;
        const dy = key === "ArrowUp" ? -delta : key === "ArrowDown" ? delta : 0;
        const selectedNodes = selectionNodes(selectedIdsRef.current);
        appendEdits(selectedNodes.map((node) => applyTranslate(node, dx, dy)));
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

      const selectedNudge =
        canEdit &&
        !commentMode &&
        selectedIdsRef.current.length > 0 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
      const shortcut = selectedNudge
        ? null
        : getOpenSlideEditorShortcut(event, {
            overviewOpen,
            hasSelectedText: canEditSelectedText,
          });
      if (shortcut) {
        if (shortcut.preventDefault) event.preventDefault();
        if (previewMode && shortcut.action === "previous-slide") {
          goPreviewPrevious();
        } else if (previewMode && shortcut.action === "next-slide") {
          goPreviewNext();
        } else {
          dispatchEditorShortcut(shortcut.action);
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
        (!event.altKey &&
          (event.ctrlKey || event.metaKey) &&
          ["z", "y"].includes(event.key.toLowerCase()))
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
      const shortcut = getOpenSlideEditorShortcut(
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
        else dispatchEditorShortcut(shortcut.action);
        return;
      }
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
      const selectedNudge =
        canEdit &&
        !commentMode &&
        selectedIdsRef.current.length > 0 &&
        !keyboard.isTypingTarget &&
        !keyboard.isControlTarget &&
        !keyboard.isComposing &&
        keyboard.keyCode !== 229 &&
        !keyboard.altKey &&
        !keyboard.ctrlKey &&
        !keyboard.metaKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          keyboard.key,
        );
      const shortcut = selectedNudge
        ? null
        : getOpenSlideEditorShortcut(new KeyboardEvent("keydown", keyboard), {
            overviewOpen,
            hasSelectedText: canEditSelectedText,
            isTypingTarget: keyboard.isTypingTarget,
            isControlTarget: keyboard.isControlTarget,
            isComposing: keyboard.isComposing,
            keyCode: keyboard.keyCode,
          });
      if (shortcut) {
        dispatchEditorShortcut(shortcut.action);
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
      dispatchEditorShortcut,
      handlePreviewFrameKeyboard,
      imageCropOpen,
      keyCommand,
      overviewOpen,
      previewMode,
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

  const selectedRect = selectionBounds;
  const sliderPosition = activeSlide?.slideNumber ?? activeIndex + 1;
  const fitToScreen = () => setZoom(1);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button asChild type="button" variant="ghost" size="icon">
          <Link to={backHref} aria-label={t("editorToolbar.backToDecks")}>
            <IconArrowLeft className="size-4" />
          </Link>
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </span>
        <div className="flex items-center gap-1">
          <div className={previewMode ? "hidden" : "flex items-center gap-1"}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={undo}
              disabled={!canUndo || saving}
              aria-label={t("editorToolbar.undo")}
            >
              <IconArrowBackUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={redo}
              disabled={!canRedo || saving}
              aria-label={t("editorToolbar.redo")}
            >
              <IconArrowForwardUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setAssetBrowserOpen(true)}
              aria-label={t("editorToolbar.assetLibrary")}
              title={t("editorToolbar.assetLibrary")}
            >
              <IconPhoto className="size-4" aria-hidden="true" />
            </Button>
            {canComment ? (
              <Button
                type="button"
                variant={commentMode ? "secondary" : "ghost"}
                size="icon"
                aria-label={t("comments.addComment")}
                aria-pressed={commentMode}
                title={t("comments.clickToAddComment")}
                onClick={() => {
                  commentGestureRef.current = null;
                  setCommentMode((value) => !value);
                }}
              >
                <IconMessageCircle className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canEdit || saving || structuralSaving}
                  aria-label={t("openSlideEditor.insertObjects")}
                  title={t("openSlideEditor.insertObjects")}
                >
                  <IconPlus className="me-1 size-4" aria-hidden="true" />
                  {t("openSlideEditor.insertObjects")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => void insertObject("text")}>
                  {t("openSlideEditor.insertTextBox")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void insertObject("rectangle")}
                >
                  {t("openSlideEditor.insertRectangle")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void insertObject("ellipse")}>
                  {t("openSlideEditor.insertEllipse")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void insertObject("line")}>
                  {t("openSlideEditor.insertLine")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setCommandMenuOpen(true)}
              aria-label={t("openSlideEditor.commands")}
              title={t("openSlideEditor.commandShortcutHint")}
            >
              <IconSearch className="size-4" aria-hidden="true" />
            </Button>
            <OpenSlideExportMenu
              ref={exportMenuRef}
              deckId={deckId}
              title={title}
              slides={slides}
              aspectRatio={aspectRatio}
              onBeforeExport={save}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void save()}
              disabled={!hasUnsavedEdits || saving || !canEdit}
            >
              <IconCheck className="me-1 size-4" />
              {saving
                ? t("designSystemSetup.saving")
                : t("designSystemSetup.saveChanges")}
            </Button>
          </div>
          {hasUnsavedEdits ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void present()}
              disabled={slides.length === 0 || saving}
            >
              <IconPlayerPlay className="me-1 size-4" />
              {t("editorToolbar.present")}
            </Button>
          ) : slides.length > 0 ? (
            <Button asChild size="sm">
              <Link to={presentHref}>
                <IconPlayerPlay className="me-1 size-4" />
                {t("editorToolbar.present")}
              </Link>
            </Button>
          ) : (
            <Button size="sm" disabled>
              <IconPlayerPlay className="me-1 size-4" />
              {t("editorToolbar.present")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t(
              inspectorOpen
                ? "openSlideEditor.hideInspector"
                : "openSlideEditor.showInspector",
            )}
            title={t(
              inspectorOpen
                ? "openSlideEditor.hideInspector"
                : "openSlideEditor.showInspector",
            )}
            aria-pressed={inspectorOpen}
            onClick={toggleInspector}
          >
            {inspectorOpen ? (
              <IconLayoutSidebarRightCollapse
                className="size-4"
                aria-hidden="true"
              />
            ) : (
              <IconLayoutSidebarRightExpand
                className="size-4"
                aria-hidden="true"
              />
            )}
          </Button>
          <Button
            type="button"
            variant={previewMode ? "secondary" : "outline"}
            size="sm"
            aria-label={t(
              previewMode ? "openSlideEditor.edit" : "openSlideEditor.preview",
            )}
            aria-pressed={previewMode}
            onClick={togglePreviewMode}
          >
            {previewMode ? (
              <IconPencil className="me-1 size-4" aria-hidden="true" />
            ) : (
              <IconEye className="me-1 size-4" aria-hidden="true" />
            )}
            {t(
              previewMode ? "openSlideEditor.edit" : "openSlideEditor.preview",
            )}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-2">
        <aside
          className={`relative shrink-0 bg-muted/20 ${previewMode ? "hidden" : ""}`}
          style={{ width: slideRailWidth }}
        >
          <div
            ref={slideRailListRef}
            id="open-slide-slide-list"
            className="h-full overflow-y-auto border-e border-border p-2"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-2 w-full"
              disabled={!canEdit || structuralSaving || saving}
              onClick={onAddSlide}
            >
              <IconPlus className="me-1 size-4" />
              {t("editorSidebar.addEmptySlide")}
            </Button>
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
                      asChild
                      onContextMenu={() => onSelectSlide(index)}
                    >
                      <SlideThumbnail
                        deckId={deckId}
                        slide={slide}
                        slideIndex={index}
                        selected={index === activeIndex}
                        dragDisabled={!canEdit || structuralSaving || saving}
                        onSelect={() => onSelectSlide(index)}
                        onNavigate={(direction) =>
                          handleThumbnailNavigate(index, direction)
                        }
                      />
                    </ContextMenuTrigger>
                    <ContextMenuContent>
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
            aria-controls="open-slide-slide-list"
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
        <main className="relative flex min-w-0 flex-1 flex-col bg-muted/40 pb-2">
          <div className="relative min-h-0 flex-1 px-10 py-5">
            {loading ? (
              <div className="absolute inset-x-10 inset-y-5 flex items-center justify-center">
                <Skeleton className="aspect-video w-full max-w-5xl" />
              </div>
            ) : artifact ? (
              <OpenSlideCanvas zoom={zoom} onScaleChange={setFitScale}>
                <div
                  ref={stageRef}
                  className="absolute left-0 top-0 h-[1080px] w-[1920px]"
                  data-open-slide-stage-inner
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
                    onError={setSaveError}
                    className="absolute inset-0"
                  />
                  <OpenSlideComments
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
                    {selected.map((node) => (
                      <div
                        key={node.nodeId}
                        className="absolute border-2 border-primary ring-1 ring-background"
                        style={{
                          left: node.bounds.x,
                          top: node.bounds.y,
                          width: node.bounds.width,
                          height: node.bounds.height,
                        }}
                      />
                    ))}
                    {selectedRect && selected.length === 1 ? (
                      <div
                        className="absolute"
                        style={{
                          left: selectedRect.x,
                          top: selectedRect.y,
                          width: selectedRect.width,
                          height: selectedRect.height,
                        }}
                      >
                        {/* guard:allow-raw-color — white handle centers stay visible over arbitrary slide backgrounds. */}
                        {RESIZE_HANDLES.map(({ key, cursor }) => {
                          const point = handlePoint(selectedRect, key);
                          return (
                            <button
                              key={key}
                              type="button"
                              disabled={!canEdit || saving || structuralSaving}
                              aria-label={t("styleInspector.resizeHandle", {
                                handle: key,
                              })}
                              onPointerDown={(event) => startHandle(event, key)}
                              className={
                                /* guard:allow-raw-color — resize handles stay visible over arbitrary slide fills. */ "pointer-events-auto absolute size-2.5 rounded-sm border border-primary bg-white shadow-sm focus-visible:outline-2 focus-visible:outline-primary"
                              }
                              style={{
                                left: point.x - selectedRect.x - 5,
                                top: point.y - selectedRect.y - 5,
                                cursor,
                              }}
                            />
                          );
                        })}
                        <button
                          type="button"
                          disabled={!canEdit || saving || structuralSaving}
                          aria-label={t("styleInspector.rotateHandle")}
                          onPointerDown={(event) =>
                            startHandle(event, "rotate")
                          }
                          className={
                            /* guard:allow-raw-color — rotate handle stays visible over arbitrary slide fills. */ "pointer-events-auto absolute left-1/2 top-0 size-3 -translate-x-1/2 -translate-y-6 cursor-grab rounded-full border border-primary bg-white shadow-sm focus-visible:outline-2 focus-visible:outline-primary"
                          }
                        />
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
                      />
                    ) : null}
                  </div>
                </div>
              </OpenSlideCanvas>
            ) : (
              <div className="absolute inset-0 grid place-items-center p-8 text-sm text-muted-foreground">
                {loadingError ?? t("presentation.loadFailed")}
              </div>
            )}
          </div>
        </main>
        {inspectorOpen ? (
          <aside className="h-full w-[320px] shrink-0 border-s border-border bg-background">
            <Tabs
              value={activePanel}
              onValueChange={(value) => {
                if (
                  value === "format" ||
                  value === "design" ||
                  value === "notes"
                )
                  setActivePanel(value);
              }}
              className="flex h-full flex-col"
            >
              <TabsList
                variant="line"
                className="h-9 w-full shrink-0 justify-start px-2"
              >
                <TabsTrigger value="format" className="px-2 text-xs">
                  {t("styleInspector.title")}
                </TabsTrigger>
                <TabsTrigger value="design" className="px-2 text-xs">
                  {t("openSlideDesignTokens.title")}
                </TabsTrigger>
                <TabsTrigger value="notes" className="px-2 text-xs">
                  {t("presentation.speakerNotes")}
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="format"
                className="mt-0 min-h-0 flex-1 overflow-hidden"
              >
                <OpenSlideInspector
                  selected={
                    distinctSelected.length === 1
                      ? (distinctSelected[0] ?? null)
                      : null
                  }
                  rangeStyleSnapshot={textRangeStyleSnapshot}
                  selectionCount={distinctSelected.length}
                  disabled={!canEdit || saving || structuralSaving}
                  t={t}
                  onInspectTextRange={inspectSelectedTextRange}
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
                  onDuplicateObject={() => void duplicateObject()}
                  onDeleteObject={() => void deleteObject()}
                  canSelectParent={Boolean(selectedParentNode)}
                  onSelectParent={selectParent}
                  canCropImage={Boolean(selectedImageSrc)}
                  onCropImage={() => setImageCropOpen(true)}
                  canReplaceImage={hasImageTarget}
                  onReplaceImage={() => setAssetBrowserOpen(true)}
                />
              </TabsContent>
              <TabsContent
                value="design"
                className="mt-0 min-h-0 flex-1 overflow-hidden"
              >
                <OpenSlideDesignTokens
                  tokens={designTokens}
                  disabled={!canEdit}
                  saving={savingDesignTokens}
                  onPreview={handleDesignTokenPreview}
                  onSave={onSaveDesignTokens}
                />
              </TabsContent>
              <TabsContent
                value="notes"
                className="mt-0 min-h-0 flex-1 overflow-hidden"
              >
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
              </TabsContent>
            </Tabs>
          </aside>
        ) : null}
      </div>
      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("presentation.previousSlide")}
            disabled={activeIndex <= 0}
            onClick={() => onSelectSlide(Math.max(0, activeIndex - 1))}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <span>
            {t("openSlidePresenter.position", {
              index: sliderPosition,
              total: slides.length,
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("presentation.nextSlide")}
            disabled={activeIndex >= slides.length - 1}
            onClick={() =>
              onSelectSlide(Math.min(slides.length - 1, activeIndex + 1))
            }
          >
            <IconChevronRight className="size-4" />
          </Button>
        </div>
        {structuralSaving ? (
          <span>{t("designSystemSetup.saving")}</span>
        ) : saveError || structuralError || loadingError ? (
          <div className="flex max-w-[55%] items-center gap-2">
            <span className="min-w-0 truncate text-destructive">
              {saveError ?? structuralError ?? loadingError}
            </span>
            {sourceConflict ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                disabled={reloadingSource}
                onClick={() => void reloadConflictedSource()}
              >
                {t("raw.reload")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("raw.zoomOut")}
            onClick={() =>
              setZoom((value) => Math.max(MIN_ZOOM, round(value - ZOOM_STEP)))
            }
          >
            <IconMinus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fitToScreen}
            className="h-auto min-w-12 rounded px-1 py-1 text-center text-xs font-normal text-muted-foreground transition-none hover:bg-accent hover:text-muted-foreground active:scale-100"
            aria-label={t("raw.fitSlideToScreen")}
          >
            {Math.round(fitScale * 100)}%
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("raw.zoomIn")}
            onClick={() =>
              setZoom((value) => Math.min(MAX_ZOOM, round(value + ZOOM_STEP)))
            }
          >
            <IconPlus className="size-3.5" />
          </Button>
        </div>
      </footer>
      <OpenSlideAssetBrowser
        deckId={deckId}
        slideId={activeSlide?.id ?? ""}
        open={assetBrowserOpen}
        onOpenChange={setAssetBrowserOpen}
        canInsert={canEdit && !saving && !structuralSaving}
        onInsert={insertAsset}
      />
      {imageCropOpen && selectedImage && selectedImageSrc ? (
        <OpenSlideImageCropControls
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
            description: t("openSlideEditor.cropDescription"),
            fitMode: t("openSlideEditor.cropFitMode"),
            fitCover: t("contextToolbar.fitCover"),
            fitContain: t("contextToolbar.fitContain"),
            cropRegion: t("openSlideEditor.cropRegion"),
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
              {`${t("openSlidePresenter.overview")} ${String(activeIndex + 1).padStart(2, "0")} · ${slides.length}`}
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
      <OpenSlideCommandMenu
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
        onToggleCommentMode={() => {
          commentGestureRef.current = null;
          setCommentMode((value) => !value);
        }}
        onCopyLink={() => void copyLink()}
        onOpenAssets={() => setAssetBrowserOpen(true)}
        onExport={(format: OpenSlideExportFormat) =>
          exportMenuRef.current?.run(format)
        }
      />
    </div>
  );
}
