import {
  useActionQuery,
  useActionMutation,
  callAction,
  useSession,
  useCollaborativeDoc,
  isReconcileLeadClient,
  generateTabId,
  dedupeCollabUsersByEmail,
  emailToColor,
  emailToName,
  PresenceBar,
  AgentChatSurface,
  ShareButton,
  agentNativePath,
  appBasePath,
  ensureEmbedAuthFetchInterceptor,
  isEmbedAuthActive,
  getBrowserTabId,
  readClientAppState,
  setClientAppState,
  useReconciledState,
  usePresence,
  useFollowUser,
  LiveCursorOverlay,
  useT,
  useChangeVersion,
  setAgentChatContextItem,
  removeAgentChatContextItem,
  useAvatarUrl,
  type CollabUser,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import { isBoardFile } from "@shared/board-file";
import {
  parseCanvasFrameGeometryById,
  type CanvasFrameGeometry,
  type CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import { resolveSourceCapabilities } from "@shared/capability-resolver";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  ensureCodeLayerNodeIdsInHtml,
  moveNodeBetweenDocuments,
  removeCodeLayerNodeFromHtml,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import { componentNameFor, isComponentInstance } from "@shared/component-model";
import type { A11yFinding } from "@shared/design-review";
import {
  DESIGN_CAPABILITY_NAMES,
  hasCapability,
} from "@shared/design-source-capabilities";
import { shouldUseLiveFileContent } from "@shared/html-content";
import {
  compile as compileMotionTimeline,
  injectManagedMotionCss,
} from "@shared/motion-compiler";
import type { MotionTrack } from "@shared/motion-timeline";
import {
  resolveTweaksToCssVars,
  type TweakSelections,
} from "@shared/resolve-tweaks";
import { utilityStem, widthToPrefix } from "@shared/responsive-classes";
import { normalizeDesignSourceType } from "@shared/source-mode";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconPencil,
  IconMessage,
  IconBrush,
  IconDeviceDesktop,
  IconDeviceTablet,
  IconDeviceMobile,
  IconViewportWide,
  IconPlus,
  IconLayoutGrid,
  IconFrame,
  IconX,
  IconPin,
  IconAssembly,
  IconCode,
  IconArchive,
  IconFile,
  IconPhoto,
  IconRefresh,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconPointer,
  IconTypography,
  IconHandStop,
  IconSquare,
  IconLine,
  IconCircle,
  IconTriangle,
  IconStar,
  IconPhotoVideo,
  IconScale,
  IconScribble,
  IconHandClick,
  IconTransformPoint,
  IconDownload,
  IconClipboard,
  IconFileExport,
  IconPlayerPlay,
  IconDeviceFloppy,
  IconRocket,
  IconExternalLink,
  IconCircleCheck,
  IconTerminal2,
  IconLink,
  IconLock,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import {
  useParams,
  useNavigate,
  Link,
  useLocation,
  useBlocker,
  useBeforeUnload,
} from "react-router";
import { toast } from "sonner";
import * as Y from "yjs";

import { canvasPrimitiveVisual } from "@/components/design/canvas-primitive-style";
import {
  CanvasContextMenu,
  type CanvasContextMenuHandle,
} from "@/components/design/CanvasContextMenu";
import {
  DesignCanvas,
  type IframeContextMenuPayload,
  type IframeHotkeyPayload,
  type MotionTrackWire,
} from "@/components/design/DesignCanvas";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import {
  AssetLibraryPanel,
  DesignExtensionsPanel,
  type DesignExtensionSlotContext,
} from "@/components/design/DesignExtensionsPanel";
import {
  EditPanel,
  type InspectCodeData,
  type InspectorTab,
} from "@/components/design/EditPanel";
import type { ExportSettingsValue } from "@/components/design/inspector";
import { InspectorAiActions } from "@/components/design/inspector/InspectorAiActions";
import {
  LayersPanel,
  type LayersPanelFile,
  type LayersPanelMoveIntent,
  type LayersPanelNode,
} from "@/components/design/LayersPanel";
import {
  LocalhostWriteConsentDialog,
  type LocalhostWriteConsentPayload,
} from "@/components/design/LocalhostWriteConsentDialog";
import {
  MotionDock,
  type MotionDockTrack,
} from "@/components/design/MotionDock";
import {
  MultiScreenCanvas,
  OVERVIEW_FRAME_WIDTH,
  type CanvasLayerMarqueeSelection,
  type CanvasPrimitiveInsert,
  type FrameGeometry,
} from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import type { ReviewPanelProps } from "@/components/design/ReviewPanel";
import { TokensPanel } from "@/components/design/TokensPanel";
import type {
  ElementInfo,
  ElementSelectionIntent,
  DeviceFrameType,
  PortableStyleSnapshot,
  PortableStyleSnapshotNode,
} from "@/components/design/types";
import {
  DEVICE_FRAME_VIEWPORTS,
  ZOOM_PRESETS,
} from "@/components/design/types";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystems } from "@/hooks/use-design-systems";
import {
  designEditorCommandKey,
  type DesignEditorCommand,
} from "@/hooks/use-navigation-state";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import {
  isDesignHotkeyEditableTarget,
  useDesignHotkeys,
} from "@/hooks/useDesignHotkeys";
import {
  DESIGN_CHAT_STORAGE_KEY,
  sendToDesignAgentChat,
} from "@/lib/agent-chat";
import {
  clearPendingGeneration,
  hasFreshPendingGeneration,
  isPendingGenerationStale,
  patchPendingGeneration,
  PENDING_GENERATION_STALE_MS,
  readPendingGeneration,
} from "@/lib/pending-generation";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

const TAB_ID = generateTabId();

// Selection is tab-scoped (like navigation) so a second editor tab cannot
// overwrite this tab's selection context. The global key is mirrored as a
// fallback for CLI/external agents that do not send a browser tab id.
function designSelectionStateKeys(): string[] {
  const tabId = getBrowserTabId();
  return tabId
    ? [`design-selection:${tabId}`, "design-selection"]
    : ["design-selection"];
}
// Stable symbol used as the Yjs transaction origin for all local user edits.
// The UndoManager tracks only this origin so remote peers' and the agent's
// edits are never undone by this user's Cmd+Z.
const LOCAL_EDIT_ORIGIN = TAB_ID + ":local";
const MAX_GENERATION_ATTEMPTS = 3;
const AUTO_RETRY_DELAY_MS = 1200;
const STORED_RUN_LIVENESS_GRACE_MS = 20_000;
const MAX_DESIGN_UNDO_STACK = 50;
const OVERVIEW_ZOOM_THRESHOLD = 60;
const MOTION_DOCK_TRANSITION_MS = 200;
const MOTION_DOCK_EXIT_SETTLE_MS = 80;
const MOTION_DOCK_EXIT_FALLBACK_MS = MOTION_DOCK_TRANSITION_MS * 2 + 600;
const MOTION_AUTOSAVE_DELAY_MS = 500;
const BOARD_SURFACE_SIZE = 131_072;
/** Extensions that the localhost bridge allows to be written back to source. */
const LOCALHOST_WRITE_EXTENSIONS = new Set([".html", ".htm", ".css"]);
const NO_LOCALHOST_WRITE_CONTENT_MESSAGE =
  "No content to write. Open the screen first." /* i18n-ignore */;
const TWEAK_CONTROLS_EDIT_ACCESS_MESSAGE =
  "You need edit access to add tweak controls." /* i18n-ignore */;
const FOCUSED_SCREEN_ZOOM = 100;
export const DEFAULT_OVERVIEW_ZOOM = 60;
const KEEPALIVE_FILE_SAVE_MAX_BYTES = 60_000;
const UNSUPPORTED_HTML2CANVAS_COLOR_RE =
  /\b(?:color|color-mix|oklch|oklab|lab|lch)\(/i;
const HTML2CANVAS_COLOR_PROPERTIES = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
] as const;
const HTML2CANVAS_SHADOW_PROPERTIES = ["box-shadow", "text-shadow"] as const;
const HTML2CANVAS_UNSUPPORTED_VALUE_PROPERTIES = [
  "background-image",
  "border-image-source",
  "list-style-image",
] as const;

function blurActiveDesignEditableTarget() {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && isDesignHotkeyEditableTarget(active)) {
    active.blur();
  }
}

function getContentSignature(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

function dedupeStringIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function sameStringIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function isScreenRootElementInfo(info: ElementInfo | null | undefined) {
  const tagName = info?.tagName?.toUpperCase();
  return tagName === "BODY" || tagName === "HTML";
}

export function shouldMirrorSelectedElementToAgentChat(
  info: ElementInfo | null | undefined,
): info is ElementInfo {
  if (!info || isScreenRootElementInfo(info)) return false;
  const text = info.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return true;
  const labelText = text.replace(/^[^A-Za-z0-9]+/, "").toLowerCase();
  return !labelText.startsWith("nothing here yet");
}

export function shouldIgnoreOverviewLayerCreationEcho(args: {
  pendingLayerId: string | null | undefined;
  pendingScreenId: string | null | undefined;
  screenId: string;
  info?: ElementInfo | null;
  event: "select" | "clear";
}) {
  if (!args.pendingLayerId) return false;
  if (args.pendingScreenId && args.pendingScreenId !== args.screenId) {
    return false;
  }
  return args.event === "clear" || isScreenRootElementInfo(args.info);
}

export function getSelectedScreenIdsForEditorState(args: {
  activeFileId: string | null | undefined;
  overviewSelectedScreenIds: string[];
  viewMode: "single" | "overview";
}) {
  const { activeFileId, overviewSelectedScreenIds, viewMode } = args;
  if (viewMode === "overview") {
    return overviewSelectedScreenIds.length
      ? overviewSelectedScreenIds
      : activeFileId
        ? [activeFileId]
        : [];
  }
  return activeFileId ? [activeFileId] : [];
}

function fileIdFromLayerSelectionId(
  layerId: string,
  fileIds: Set<string>,
): string | null {
  const normalized = layerId.startsWith("code:")
    ? layerId.slice("code:".length)
    : layerId;
  return fileIds.has(normalized) ? normalized : null;
}

export function getOverviewScreenIdsFromLayerSelection(args: {
  fileIds: string[];
  layerIds: string[];
}) {
  const fileIds = new Set(args.fileIds);
  const seen = new Set<string>();
  const selectedScreenIds: string[] = [];
  args.layerIds.forEach((layerId) => {
    const fileId = fileIdFromLayerSelectionId(layerId, fileIds);
    if (!fileId || seen.has(fileId)) return;
    seen.add(fileId);
    selectedScreenIds.push(fileId);
  });
  return selectedScreenIds;
}

export function getOverviewEnterTarget(args: {
  activeFileId: string | null | undefined;
  overviewSelectedScreenIds: string[];
}) {
  const { activeFileId, overviewSelectedScreenIds } = args;
  if (overviewSelectedScreenIds.length === 0) {
    return activeFileId ?? null;
  }
  if (activeFileId && overviewSelectedScreenIds.includes(activeFileId)) {
    return activeFileId;
  }
  return (
    overviewSelectedScreenIds[overviewSelectedScreenIds.length - 1] ?? null
  );
}

export function getSidebarCodeLayerSelectionState(args: {
  currentViewMode: "single" | "overview";
  ownerFileId?: string | null;
  overviewSelectedScreenIds: string[];
  screenFileIds?: string[];
}) {
  const {
    currentViewMode,
    ownerFileId,
    overviewSelectedScreenIds,
    screenFileIds,
  } = args;
  const ownerScreenId =
    ownerFileId && (!screenFileIds || screenFileIds.includes(ownerFileId))
      ? ownerFileId
      : null;
  return {
    viewMode: currentViewMode,
    overviewSelectedScreenIds:
      currentViewMode === "overview" && ownerScreenId
        ? [ownerScreenId]
        : currentViewMode === "overview" && ownerFileId
          ? []
          : overviewSelectedScreenIds,
  };
}

export function getOverviewZoomScale(args: {
  frameWidth: number | null | undefined;
  sourceWidth: number | null | undefined;
}) {
  const frameWidth =
    typeof args.frameWidth === "number" && args.frameWidth > 0
      ? args.frameWidth
      : OVERVIEW_FRAME_WIDTH;
  const sourceWidth =
    typeof args.sourceWidth === "number" && args.sourceWidth > 0
      ? args.sourceWidth
      : 1280;
  return frameWidth / sourceWidth;
}

export function getOverviewDisplayZoom(
  canvasZoom: number,
  overviewZoomScale: number,
) {
  const scale = overviewZoomScale > 0 ? overviewZoomScale : 1;
  return canvasZoom * scale;
}

export function getOverviewCanvasZoom(
  displayZoom: number,
  overviewZoomScale: number,
) {
  const scale = overviewZoomScale > 0 ? overviewZoomScale : 1;
  return displayZoom / scale;
}

export function getDefaultOverviewCanvasZoom(overviewZoomScale: number) {
  return getOverviewCanvasZoom(DEFAULT_OVERVIEW_ZOOM, overviewZoomScale);
}

export function getDesignEditorShareUrl(
  id: string,
  origin: string,
  basePath = "",
) {
  const normalizedBasePath = basePath.replace(/\/+$/, "");
  const pathname = normalizedBasePath
    ? `${normalizedBasePath}/design/${encodeURIComponent(id)}`
    : `/design/${encodeURIComponent(id)}`;
  return new URL(pathname, origin).toString();
}

function formatDesignEditorUrlZoom(zoom: number): string {
  const rounded = Math.round(zoom * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function getDesignEditorStateUrlSearch(args: {
  currentSearch: string;
  viewMode: "single" | "overview";
  screenId?: string | null;
  selectionId?: string | null;
  zoom?: number | null;
}) {
  const params = new URLSearchParams(args.currentSearch);
  params.set("view", args.viewMode);
  if (args.screenId) {
    params.set("screen", args.screenId);
  } else {
    params.delete("screen");
  }
  params.delete("fileId");
  params.delete("filename");
  if (args.selectionId) {
    params.set("selection", args.selectionId);
  } else {
    params.delete("selection");
  }
  if (typeof args.zoom === "number" && Number.isFinite(args.zoom)) {
    params.set("zoom", formatDesignEditorUrlZoom(args.zoom));
  } else {
    params.delete("zoom");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getLocalhostRouteSourceFile(args: {
  sourceFile?: string;
  source?: string;
}): string | undefined {
  if (args.sourceFile?.trim()) return args.sourceFile;
  const raw = args.source;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "file" in parsed &&
      typeof (parsed as Record<string, unknown>).file === "string"
    ) {
      return (parsed as Record<string, string>).file;
    }
  } catch {
    if (raw.length > 0) return raw;
  }
  return undefined;
}

export function getLayerMoveSourceContent(args: {
  sourceFileId: string;
  activeFileId?: string | null;
  activeContent: string;
  sourceFileContent?: string;
  sourceContentMap: ReadonlyMap<string, string>;
}) {
  return (
    args.sourceContentMap.get(args.sourceFileId) ??
    (args.sourceFileId === args.activeFileId
      ? args.activeContent
      : args.sourceFileContent) ??
    ""
  );
}

export function getFreshActiveFileContent(args: {
  activeContent: string;
  latestContent?: string | null;
  lastLocalContent?: string | null;
}) {
  return args.latestContent ?? args.lastLocalContent ?? args.activeContent;
}

export function getFreshScreenContent(args: {
  screenId: string;
  activeFileId?: string | null;
  freshActiveContentFileId?: string | null;
  freshActiveContent: string;
  fileContentById: ReadonlyMap<string, string>;
}) {
  const freshActiveContentFileId =
    args.freshActiveContentFileId ?? args.activeFileId;
  return args.screenId === args.activeFileId &&
    args.screenId === freshActiveContentFileId
    ? args.freshActiveContent
    : (args.fileContentById.get(args.screenId) ?? "");
}

export function shouldReplacePreviewAfterVisualStyleCommit(args: {
  runtimeApplied?: boolean;
  runtimeStyleApplied: boolean;
}) {
  return !args.runtimeApplied && !args.runtimeStyleApplied;
}

export function getLayerMoveIterationOrder<T>(
  orderedIds: readonly T[],
  placement: "before" | "after" | "inside",
): T[] {
  return placement === "after" ? [...orderedIds].reverse() : [...orderedIds];
}

export function removeUndoRedoOrderKind<T extends string>(
  order: readonly T[],
  kind: T,
): T[] {
  return order.filter((entry) => entry !== kind);
}

export type UndoRedoOrderKind = "content" | "file-content" | "geometry";

export function getUndoRedoPriorityOrder(
  preferred: UndoRedoOrderKind | undefined,
): UndoRedoOrderKind[] {
  if (preferred === "geometry") return ["geometry", "content", "file-content"];
  if (preferred === "file-content")
    return ["file-content", "content", "geometry"];
  return ["content", "file-content", "geometry"];
}

function resolveZoomUpdate(update: SetStateAction<number>, current: number) {
  return typeof update === "function" ? update(current) : update;
}

export function shouldLimitEditorChromeUntilContentReady(args: {
  fileCount: number;
  hasActiveCanvasContent: boolean;
  generating: boolean;
  pendingGenerationActive: boolean;
}) {
  const {
    fileCount,
    generating,
    hasActiveCanvasContent,
    pendingGenerationActive,
  } = args;
  return (
    (fileCount === 0 || !hasActiveCanvasContent) &&
    (generating || pendingGenerationActive)
  );
}

export function shouldEscapeToOverview(args: {
  activeTool: DesignTool;
  drawMode: boolean;
  mode: EditorMode;
  pinMode: boolean;
  selectedElement: ElementInfo | null;
  viewMode: "single" | "overview";
}) {
  const { activeTool, drawMode, mode, pinMode, selectedElement, viewMode } =
    args;
  return (
    viewMode === "single" &&
    !selectedElement &&
    !drawMode &&
    !pinMode &&
    mode === "edit" &&
    activeTool === "move"
  );
}

/**
 * Build the set of all node ids (both projection ids and data-agent-native-node-id
 * attribute values) that exist in the given projection. Used by handleGroupSelection
 * and handleUngroupSelection to filter selectedLayerIdsState to the active file's
 * nodes before passing them to wrapNodes / unwrap, preventing cross-file stale ids
 * from causing spurious "conflict" errors.
 *
 * Exported for unit testing.
 */
export function buildActiveFileNodeIdSet(
  projection: CodeLayerProjection,
): Set<string> {
  const ids = new Set<string>();
  for (const n of projection.nodes) {
    ids.add(n.id);
    const attrId = n.dataAttributes["data-agent-native-node-id"];
    if (attrId) ids.add(attrId);
  }
  return ids;
}

let html2CanvasColorContext: CanvasRenderingContext2D | null | undefined;

interface FileContentSaveRequest {
  id: string;
  content: string;
  syncCollab: boolean;
}

function getHtml2CanvasColorContext(): CanvasRenderingContext2D | null {
  if (html2CanvasColorContext !== undefined) return html2CanvasColorContext;
  if (typeof document === "undefined") {
    html2CanvasColorContext = null;
    return html2CanvasColorContext;
  }
  html2CanvasColorContext = document.createElement("canvas").getContext("2d");
  return html2CanvasColorContext;
}

function parseColorFunctionComponent(component: string): number {
  const trimmed = component.trim();
  if (trimmed.endsWith("%")) {
    return (Number(trimmed.slice(0, -1)) / 100) * 255;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) <= 1 ? value * 255 : value;
}

function parseColorFunctionAlpha(alpha: string | undefined): number {
  if (!alpha) return 1;
  const trimmed = alpha.trim();
  if (trimmed.endsWith("%")) return Number(trimmed.slice(0, -1)) / 100;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 1;
}

function parseRgbLikeColorFunction(value: string): string | null {
  const match = value.match(/color\(\s*[\w-]+\s+([^)]+)\)/i);
  if (!match) return null;
  const [componentsPart, alphaPart] = match[1].split("/");
  const channels = componentsPart.trim().split(/\s+/).slice(0, 3);
  if (channels.length < 3) return null;
  const [red, green, blue] = channels
    .map(parseColorFunctionComponent)
    .map((channel) => Math.round(Math.max(0, Math.min(255, channel))));
  const alpha = Math.max(0, Math.min(1, parseColorFunctionAlpha(alphaPart)));
  return alpha < 1
    ? `rgba(${red}, ${green}, ${blue}, ${alpha})`
    : `rgb(${red}, ${green}, ${blue})`;
}

function normalizeHtml2CanvasColor(value: string): string {
  if (!UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) return value;
  const context = getHtml2CanvasColorContext();
  if (context) {
    try {
      context.fillStyle = "#000";
      context.fillStyle = value;
      const normalized = String(context.fillStyle);
      if (normalized && !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(normalized)) {
        return normalized;
      }
    } catch {
      // Fall back to small parser below.
    }
  }
  return parseRgbLikeColorFunction(value) ?? "rgb(0, 0, 0)";
}

function elementInlineStyle(
  element: Element | undefined,
): CSSStyleDeclaration | null {
  if (!element) return null;
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  return style && typeof style.setProperty === "function" ? style : null;
}

function sanitizeHtml2CanvasClone(
  sourceDocument: Document,
  clonedDocument: Document,
) {
  const sourceView = sourceDocument.defaultView;
  if (!sourceView) return;
  const sourceElements = [
    sourceDocument.documentElement,
    ...Array.from(sourceDocument.documentElement.querySelectorAll("*")),
  ];
  const clonedElements = [
    clonedDocument.documentElement,
    ...Array.from(clonedDocument.documentElement.querySelectorAll("*")),
  ];
  sourceElements.forEach((sourceElement, index) => {
    const clonedStyle = elementInlineStyle(clonedElements[index]);
    if (!clonedStyle) return;
    const computed = sourceView.getComputedStyle(sourceElement);
    for (const property of HTML2CANVAS_COLOR_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (!value || !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) continue;
      clonedStyle.setProperty(
        property,
        normalizeHtml2CanvasColor(value),
        "important",
      );
    }
    for (const property of HTML2CANVAS_SHADOW_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (!value || !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) continue;
      clonedStyle.setProperty(property, "none", "important");
    }
    for (const property of HTML2CANVAS_UNSUPPORTED_VALUE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (!value || !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) continue;
      clonedStyle.setProperty(property, "none", "important");
    }
  });
}

/**
 * Editor-chrome overlays that editor-chrome.bridge.ts appends inside the preview
 * iframe (the selection outline + resize handles, hover highlight, marquee,
 * spacing/measurement guides, and badges). They live in the iframe DOM, so image
 * exports must strip them from the clone — otherwise a download captures the
 * editor's selection outline instead of just the design. Keep this in sync with
 * the data-agent-native-* markers set in editor-chrome.bridge.ts.
 */
export const EDITOR_CHROME_OVERLAY_SELECTOR = [
  "[data-agent-native-edit-overlay]",
  "[data-agent-native-edit-handle]",
  "[data-agent-native-edge-handle]",
  "[data-agent-native-rotate-handle]",
  "[data-agent-native-transform-badge]",
  "[data-agent-native-spacing-badge]",
  "[data-agent-native-spacing-overlay]",
  "[data-agent-native-spacing-line]",
  "[data-agent-native-spacing-region]",
  "[data-agent-native-insertion-guide]",
  "[data-agent-native-measurement-overlay]",
].join(",");

/**
 * Remove editor-chrome overlays from a cloned document/element before it is
 * rasterized (PNG) or serialized (SVG) for export.
 */
function removeEditorChromeOverlays(root: ParentNode): void {
  root
    .querySelectorAll(EDITOR_CHROME_OVERLAY_SELECTOR)
    .forEach((element) => element.remove());
}

function sanitizeSerializedXmlForSvg(value: string): string {
  // SVG opened as XML only knows the five predefined entities. HTML serializers
  // can leave named entities or bare ampersands in foreignObject content; escape
  // those so the downloaded SVG parses cleanly in browsers and editors.
  return value.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g,
    "&amp;",
  );
}

/**
 * Resolve the document-space rect of the currently selected element inside the
 * preview iframe so image exports (PNG/SVG) can crop to just that frame instead
 * of the whole screen. Returns null — meaning "export the whole screen" — when
 * there is no element selection, when the selection is the screen root
 * (BODY/HTML, which is the whole screen anyway), or when the element can no
 * longer be resolved in the live document.
 */
function resolveExportCropRect(
  doc: Document,
  selected: ElementInfo | null | undefined,
): { x: number; y: number; width: number; height: number } | null {
  if (!selected || isScreenRootElementInfo(selected)) return null;
  const view = doc.defaultView;
  if (!view) return null;
  let element: Element | null = null;
  if (selected.sourceId) {
    try {
      element = doc.querySelector(
        `[data-agent-native-node-id="${CSS.escape(selected.sourceId)}"]`,
      );
    } catch {
      element = null;
    }
  }
  if (!element && selected.selector) {
    try {
      element = doc.querySelector(selected.selector);
    } catch {
      element = null;
    }
  }
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // getBoundingClientRect is viewport-relative; add the iframe scroll offset so
  // coordinates match the full-document render (which starts at the page top).
  return {
    x: rect.left + (view.scrollX ?? 0),
    y: rect.top + (view.scrollY ?? 0),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Map a document-space rect onto pixel coordinates within a rendered canvas of
 * the given size, clamped to stay inside the canvas. `scale` must match the
 * scale passed to html2canvas. Returns null when the crop would be empty or
 * lands fully outside the canvas, so callers can fall back to the full render.
 */
export function computeExportCropBox(
  sourceWidth: number,
  sourceHeight: number,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(sourceWidth - sx, Math.round(rect.width * scale));
  const sh = Math.min(sourceHeight - sy, Math.round(rect.height * scale));
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}

/**
 * Crop a rendered html2canvas canvas down to a document-space rect so image
 * exports capture just the selected frame. Returns null when the crop is empty,
 * so callers can fall back to the full render.
 */
function cropCanvasToRect(
  source: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
): HTMLCanvasElement | null {
  const box = computeExportCropBox(source.width, source.height, rect, scale);
  if (!box) return null;
  const cropped = document.createElement("canvas");
  cropped.width = box.sw;
  cropped.height = box.sh;
  const context = cropped.getContext("2d");
  if (!context) return null;
  context.drawImage(
    source,
    box.sx,
    box.sy,
    box.sw,
    box.sh,
    0,
    0,
    box.sw,
    box.sh,
  );
  return cropped;
}

function byteLength(value: string): number {
  if (typeof TextEncoder === "undefined") return value.length;
  return new TextEncoder().encode(value).length;
}

function sendFileContentSaveKeepalive(pending: FileContentSaveRequest): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    id: pending.id,
    content: pending.content,
    syncCollab: pending.syncCollab,
  });
  if (byteLength(body) > KEEPALIVE_FILE_SAVE_MAX_BYTES) return;
  ensureEmbedAuthFetchInterceptor();
  void fetch(agentNativePath("/_agent-native/actions/update-file"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-Frontend": "1",
    },
    body,
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});
}

type EditorMode = "annotate" | "edit" | "interact";
type DesignTool =
  | "move"
  | "frame"
  | "rect"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "pen"
  | "hand"
  | "comment"
  | "draw"
  | "scale";
type ShapeTool = "rect" | "line" | "arrow" | "ellipse" | "polygon" | "star";

const DESIGN_EDITOR_TOOLS = new Set<DesignTool>([
  "move",
  "frame",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
  "text",
  "pen",
  "hand",
  "comment",
  "draw",
  "scale",
]);

function normalizeDesignTool(value: unknown): DesignTool | null {
  return typeof value === "string" &&
    DESIGN_EDITOR_TOOLS.has(value as DesignTool)
    ? (value as DesignTool)
    : null;
}

function isSingleScreenAnnotationTool(tool: DesignTool): boolean {
  return tool === "draw" || tool === "comment";
}

interface DesignFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface LiveScreenSnapshot {
  url: string;
  html: string;
  status?: number;
  contentType?: string;
}

export interface PendingVisualStyleEdit {
  screenId: string;
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  tagName?: string | null;
  classes: string[];
  styles: Record<string, string>;
  updatedAt: number;
}

function pendingVisualStyleEditKey(edit: PendingVisualStyleEdit): string {
  return [
    edit.screenId,
    edit.sourceId?.trim() || edit.selector.trim() || "unknown",
  ].join("::");
}

export function mergePendingVisualStyleEdit(
  edits: readonly PendingVisualStyleEdit[],
  nextEdit: PendingVisualStyleEdit,
): PendingVisualStyleEdit[] {
  const nextKey = pendingVisualStyleEditKey(nextEdit);
  let merged = false;
  const next = edits.map((edit) => {
    if (pendingVisualStyleEditKey(edit) !== nextKey) return edit;
    merged = true;
    return {
      ...edit,
      ...nextEdit,
      classes: nextEdit.classes.length > 0 ? nextEdit.classes : edit.classes,
      styles: { ...edit.styles, ...nextEdit.styles },
    };
  });
  return merged ? next : [...edits, nextEdit];
}

export function getPendingVisualStylePropertyCount(
  edits: readonly PendingVisualStyleEdit[],
): number {
  return edits.reduce(
    (count, edit) => count + Object.keys(edit.styles).length,
    0,
  );
}

export function shouldBlockPendingVisualStyleNavigation(args: {
  hasPendingVisualStyleEdits: boolean;
  currentPathname: string;
  nextPathname: string;
}): boolean {
  return (
    args.hasPendingVisualStyleEdits &&
    args.currentPathname !== args.nextPathname
  );
}

export function formatPendingVisualStylePrompt(args: {
  designId?: string | null;
  designTitle?: string | null;
  activeFileId?: string | null;
  activeFilename?: string | null;
  edits: readonly PendingVisualStyleEdit[];
}): string {
  const title = args.designTitle?.trim();
  const editPayload = args.edits.map((edit) => ({
    screenId: edit.screenId,
    filename: edit.filename,
    screenName: edit.screenName,
    selector: edit.selector,
    sourceId: edit.sourceId ?? null,
    tagName: edit.tagName ?? null,
    classes: edit.classes,
    styles: edit.styles,
  }));

  return [
    `Apply these pending visual style edits${title ? ` to "${title}"` : ""}.`,
    args.designId ? `Design id: "${args.designId}".` : "",
    args.activeFileId
      ? `Active screen: "${args.activeFilename ?? args.activeFileId}" (${args.activeFileId}).`
      : "",
    "",
    "Use the Design source tools to make the source match the current live canvas preview. Read each target screen, resolve source ids/selectors through the code-layer projection, then apply the style changes with focused source edits. Preserve layout, behavior, and unrelated styling.",
    "",
    "Pending style edits:",
    JSON.stringify(editPayload, null, 2),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function shouldShowPendingVisualStyleApply(args: {
  edits: readonly PendingVisualStyleEdit[];
  screenSourceTypes: ReadonlyMap<string, unknown>;
  fallbackSourceType?: unknown;
}): boolean {
  return (
    args.edits.length > 0 &&
    args.edits.every(
      (edit) =>
        normalizeDesignSourceType(
          args.screenSourceTypes.get(edit.screenId) ?? args.fallbackSourceType,
        ) === "localhost",
    )
  );
}

interface DesignData {
  id: string;
  title: string;
  description?: string;
  projectType: string;
  designSystemId?: string | null;
  data?: string | null;
  accessRole?: DesignAccessRole;
  files: DesignFile[];
}

type DesignAccessRole = "owner" | "admin" | "editor" | "viewer";
type PostAuthDesignIntent = "save" | "share";
type ShareExportFormat = "html" | "png" | "svg" | "zip";

interface CodingHandoffResult {
  clipboardText?: string;
  prompt?: string;
  rawUrl?: string;
  zipUrl?: string;
  fileCount?: number;
}

interface CanvasLayerClipboardEntry {
  html: string;
  rootNodeId?: string;
  sourceFileId: string;
  portableStyleSnapshot?: PortableStyleSnapshot;
}

interface SelectedCanvasLayerSnapshot extends CanvasLayerClipboardEntry {
  node: CodeLayerNode;
  sourceIndex: number;
  tree: CodeLayerTreeNode[];
}

export interface MotionTimelineRow {
  id: string | null;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: unknown;
  durationMs: number;
  defaultEase: string;
  compiledHash: string | null;
  cssHash?: string | null;
  source?: "stored" | "recovered-css" | "stored-css-drift";
  createdAt: string | null;
  updatedAt: string | null;
}

interface MotionTimelineQueryResult {
  designId: string;
  timelines: MotionTimelineRow[];
  count: number;
}

function isMotionTrack(value: unknown): value is MotionTrack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    targetNodeId?: unknown;
    property?: unknown;
    keyframes?: unknown;
  };
  return (
    typeof candidate.targetNodeId === "string" &&
    typeof candidate.property === "string" &&
    Array.isArray(candidate.keyframes)
  );
}

function normalizeMotionTracks(value: unknown): MotionTrack[] {
  return Array.isArray(value) ? value.filter(isMotionTrack) : [];
}

function labelForMotionTrack(
  track: MotionTrack,
  projection: CodeLayerProjection,
): string {
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] ===
        track.targetNodeId || candidate.id === track.targetNodeId,
  );
  return node?.layerName || node?.tag || track.targetNodeId;
}

export function hydrateMotionDockTracks(
  tracks: unknown,
  projection: CodeLayerProjection,
): MotionDockTrack[] {
  return normalizeMotionTracks(tracks).map((track) => ({
    ...track,
    label: labelForMotionTrack(track, projection),
  }));
}

const MOTION_KEYFRAME_TIME_EPSILON = 0.002;

function motionCssPropertyName(property: string): string | null {
  const trimmed = property.trim();
  if (!trimmed || trimmed.startsWith("--")) return null;
  const cssName = trimmed
    .replace(/^css/, "")
    .replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    .toLowerCase();
  return /^-?[a-z][a-z0-9-]*$/i.test(cssName) ? cssName : null;
}

function camelStyleProperty(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function computedMotionStyleValue(
  computedStyles: Record<string, string> | undefined,
  property: string,
): string | undefined {
  if (!computedStyles) return undefined;
  return (
    computedStyles[property] ??
    computedStyles[camelStyleProperty(property)] ??
    computedStyles[
      property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    ]
  );
}

function defaultMotionBaseValue(property: string, nextValue: string): string {
  if (property === "opacity") return "1";
  if (property === "transform" || property === "filter") return "none";
  return nextValue;
}

export function upsertMotionStyleKeyframes(args: {
  tracks: MotionDockTrack[];
  targetNodeId: string;
  label: string;
  styles: Record<string, string>;
  computedStyles?: Record<string, string>;
  playhead: number;
  defaultEase?: string;
}): MotionDockTrack[] {
  const t = Math.max(0, Math.min(1, args.playhead));
  const ease = args.defaultEase ?? "ease";
  let nextTracks = args.tracks;

  for (const [rawProperty, rawValue] of Object.entries(args.styles)) {
    if (rawValue === undefined) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    const property = motionCssPropertyName(rawProperty);
    if (!property) continue;

    const existingIndex = nextTracks.findIndex(
      (track) =>
        track.targetNodeId === args.targetNodeId && track.property === property,
    );

    if (existingIndex >= 0) {
      nextTracks = nextTracks.map((track, index) => {
        if (index !== existingIndex) return track;
        const withoutCurrentTime = track.keyframes.filter(
          (keyframe) => Math.abs(keyframe.t - t) > MOTION_KEYFRAME_TIME_EPSILON,
        );
        return {
          ...track,
          label: track.label || args.label,
          keyframes: [...withoutCurrentTime, { t, value, ease }].sort(
            (a, b) => a.t - b.t,
          ),
        };
      });
      continue;
    }

    const baseValue =
      computedMotionStyleValue(args.computedStyles, property) ??
      computedMotionStyleValue(args.computedStyles, rawProperty) ??
      defaultMotionBaseValue(property, value);
    const keyframes =
      t <= MOTION_KEYFRAME_TIME_EPSILON
        ? [
            { t: 0, value, ease },
            { t: 1, value: baseValue, ease },
          ]
        : t >= 1 - MOTION_KEYFRAME_TIME_EPSILON
          ? [
              { t: 0, value: baseValue, ease },
              { t: 1, value, ease },
            ]
          : [
              { t: 0, value: baseValue, ease },
              { t, value, ease },
              { t: 1, value: baseValue, ease },
            ];
    nextTracks = [
      ...nextTracks,
      {
        targetNodeId: args.targetNodeId,
        property,
        keyframes,
        label: args.label,
      },
    ];
  }

  return nextTracks;
}

export function motionTimelineFingerprint(
  fileId: string,
  timeline: MotionTimelineRow | null | undefined,
): string {
  if (!timeline) return `${fileId}:empty`;
  return [
    fileId,
    timeline.id ?? "css",
    timeline.updatedAt ?? "no-updated-at",
    timeline.compiledHash ?? "no-compiled-hash",
    timeline.cssHash ?? "no-css-hash",
    timeline.source ?? "stored",
    JSON.stringify(timeline.tracks),
  ].join(":");
}

function buildSignInHrefForDesignIntent(intent: PostAuthDesignIntent): string {
  const base = agentNativePath("/_agent-native/sign-in");
  if (typeof window === "undefined") return base;

  const returnUrl = new URL(window.location.href);
  returnUrl.search = "";
  returnUrl.hash = "";
  returnUrl.searchParams.set("intent", intent);
  const ret = returnUrl.pathname + returnUrl.search + returnUrl.hash;
  return `${base}?return=${encodeURIComponent(ret)}`;
}

interface GeometryHistoryEntry {
  before: CanvasFrameGeometryById;
  after: CanvasFrameGeometryById;
}

function geometryHistoryEntryTouchesFrameIds(
  entry: GeometryHistoryEntry,
  frameIds: Set<string>,
) {
  for (const frameId of frameIds) {
    if (entry.before[frameId] || entry.after[frameId]) return true;
  }
  return false;
}

function removeRecentUndoRedoOrderKinds<T extends string>(
  order: T[],
  kind: T,
  count: number,
): T[] {
  if (count <= 0) return order;
  const next = [...order];
  let remaining = count;
  for (let index = next.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (next[index] !== kind) continue;
    next.splice(index, 1);
    remaining -= 1;
  }
  return next;
}

export interface ContentHistoryChange {
  fileId: string;
  before: string;
  after: string;
}

export interface ContentHistoryGroup {
  changes: ContentHistoryChange[];
}

export type ContentHistoryEntry = ContentHistoryChange | ContentHistoryGroup;

export function getContentHistoryChanges(
  entry: ContentHistoryEntry,
): ContentHistoryChange[] {
  return "changes" in entry ? entry.changes : [entry];
}

export function getAvailableContentHistoryChanges(
  entry: ContentHistoryEntry,
  availableFileIds: Iterable<string>,
  activeFileId?: string | null,
): ContentHistoryChange[] {
  const fileIds = new Set(availableFileIds);
  const activeFileIsAvailable = !!activeFileId && fileIds.has(activeFileId);
  return getContentHistoryChanges(entry).filter(
    (change) =>
      fileIds.has(change.fileId) ||
      (activeFileIsAvailable && change.fileId === activeFileId),
  );
}

function findLastContentHistoryChangeIndex(
  stack: ContentHistoryChange[],
  fileId?: string | null,
) {
  if (!fileId) return -1;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.fileId === fileId) return index;
  }
  return -1;
}

type PatchProofStatus =
  | "runtime"
  | "queued"
  | "applied"
  | "failed"
  | "rolledBack";

interface PatchProofState {
  id: string;
  fileId: string;
  filename: string;
  selector: string;
  sourceId?: string;
  property: string;
  previousValue?: string;
  nextValue: string;
  previousContent?: string;
  capability: string;
  confidence?: number;
  status: PatchProofStatus;
  error?: string;
  createdAt: number;
}

function formatUploadedFileContext(files: UploadedFile[]): string {
  if (files.length === 0) return "";

  const lines: string[] = [
    "",
    `The user uploaded ${files.length} file(s) for context:`,
  ];

  files.forEach((file, index) => {
    lines.push(
      `${index + 1}. ${file.originalName} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) at path: ${file.path}`,
    );
    const text = file.textContent?.trim();
    if (text) {
      lines.push(
        `Extracted text${file.textTruncated ? " (truncated)" : ""}:\n${text}`,
      );
    }
  });

  return lines.join("\n");
}

function imageAttachmentsFromUploadedFiles(files: UploadedFile[]): string[] {
  return files
    .map((file) => file.dataUrl)
    .filter((dataUrl): dataUrl is string => !!dataUrl?.trim());
}

function formatTweakDefinitionsContext(tweaks: TweakDefinition[]): string {
  if (tweaks.length === 0) return "None yet.";
  return JSON.stringify(
    tweaks.map((tweak) => ({
      id: tweak.id,
      label: tweak.label,
      type: tweak.type,
      cssVar: tweak.cssVar,
      defaultValue: tweak.defaultValue,
      options: tweak.options,
      min: tweak.min,
      max: tweak.max,
      step: tweak.step,
    })),
    null,
    2,
  );
}

function designSystemGenerationDirectives(
  designSystemId?: string | null,
): string[] {
  if (!designSystemId) return [];
  return [
    `Use design system id "${designSystemId}" for this generation.`,
    "Before generating visual code, call `get-design-system` for that id and follow its tokens, assets, and custom instructions.",
    `When calling \`generate-design\`, pass \`designSystemId: "${designSystemId}"\` so the design remains linked.`,
  ];
}

function designIntakeQuestionDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `This is a new UI-started design for design id "${designId}". The design shell already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    "First, call `show-design-questions` with 4-6 tailored questions and then stop. Do NOT call generate-design or present-design-variants until the user submits or skips the questions.",
    "Make the questions feel like Claude Design intake: form factor, aesthetic direction, important features/content, special interactions/polish, and whether to explore variations. Omit or rephrase anything the user's prompt already answered.",
    "Use concise option chips with `allowOther: true`; include a practical `Decide for me` option where useful. Use `multiSelect: true` for feature/interactions questions.",
    "Set a specific title like `Quick questions about your todo app` and a short description. After `show-design-questions` succeeds, wait for the user's answers.",
  ];
}

function promptRequestsVariantExploration(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const asksForVariants =
    /\b(variant|variants|variation|variations|direction|directions|option|options|concept|concepts|exploration|explorations)\b/.test(
      normalized,
    );
  if (!asksForVariants) return false;
  return (
    /\b(2|3|4|5|two|three|four|five|multiple|several|distinct|different|choose|compare|side[-\s]?by[-\s]?side)\b/.test(
      normalized,
    ) || /\bto choose from\b/.test(normalized)
  );
}

function designVariantGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `Use the \`present-design-variants --designId="${designId}"\` action first. The design already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    "The user's prompt already asks to explore multiple directions, so DO NOT call `show-design-questions` first and DO NOT call `generate-design` first.",
    "Call `present-design-variants` with 2-5 concise directions (3 when unspecified). Prefer label, description, accentColor, and feature bullets; omit large content HTML when needed because the action can render compact representative screens.",
    'Wait for the user\'s chat pick, delete each unchosen variant screen at most once, call `get-design-snapshot` exactly once with `fileId` for the kept screen, then call `edit-design` exactly once on that same `fileId` in a bounded pass. Use `mode: "replace-file"` when expanding the representative placeholder into the full chosen direction. Do not repeat delete/snapshot cycles. Do not call `generate-design` after a variant pick. Stop after the first successful `edit-design` save.',
  ];
}

function designGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `Use the \`generate-design --designId="${designId}"\` action with exactly one complete, renderable \`index.html\` file first. The design already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    'If the user asked to explore variations, call `present-design-variants` with 2-5 concise directions. Prefer label, description, accentColor, and feature bullets; omit large content HTML when needed because the action can render compact representative screens. Wait for their chat pick, delete each unchosen variant screen at most once, call `get-design-snapshot` exactly once with `fileId` for the kept screen, then call `edit-design` exactly once on that same `fileId` in a bounded pass. Use `mode: "replace-file"` when expanding the representative placeholder into the full chosen direction. Do not repeat delete/snapshot cycles. Do not call `generate-design` after a variant pick. Stop after the first successful `edit-design` save. Otherwise generate one polished first direction.',
    "Keep the first pass bounded enough to finish quickly: one self-contained Alpine.js + Tailwind CDN HTML document, polished but concise. Add 3-6 tweaks only when they naturally fit the design.",
    "After generate-design succeeds, stop and summarize what was created.",
  ];
}

function normalizeScreenTarget(value: string): string {
  return value
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\.html?$/i, "")
    .toLowerCase();
}

function findDesignFileByScreenTarget(
  files: DesignFile[],
  target: string | null | undefined,
): DesignFile | null {
  const trimmed = target?.trim();
  if (!trimmed) return null;
  const normalized = normalizeScreenTarget(trimmed);
  return (
    files.find((file) => file.id === trimmed) ??
    files.find((file) => file.filename === trimmed) ??
    files.find((file) => normalizeScreenTarget(file.filename) === normalized) ??
    null
  );
}

function designEditorCommandFromSearchParams(
  designId: string,
  searchParams: URLSearchParams,
): DesignEditorCommand | null {
  const editorView = searchParams.get("view");
  const inspector = searchParams.get("inspector");
  const leftPanel = normalizeDesignLeftPanel(searchParams.get("panel"));
  const screen =
    searchParams.get("screen") ??
    searchParams.get("fileId") ??
    searchParams.get("filename");
  const selection = searchParams.get("selection");
  const rawZoom = searchParams.get("zoom");
  const zoom = rawZoom !== null ? Number(rawZoom) : NaN;
  const tool = normalizeDesignTool(searchParams.get("tool"));
  if (
    editorView !== "overview" &&
    editorView !== "single" &&
    inspector !== "design" &&
    inspector !== "tweaks" &&
    inspector !== "extensions" &&
    !leftPanel &&
    !screen &&
    !selection &&
    !tool
  ) {
    return null;
  }
  const command: DesignEditorCommand = {
    designId,
    issuedAt: 0,
  };
  if (editorView === "overview" || editorView === "single") {
    command.editorView = editorView;
  }
  if (
    inspector === "design" ||
    inspector === "tweaks" ||
    inspector === "extensions"
  ) {
    command.inspectorTab = inspector;
  }
  if (leftPanel) command.leftPanel = leftPanel;
  if (screen) command.screen = screen;
  if (selection) command.selection = selection;
  if (Number.isFinite(zoom)) {
    command.zoom = zoom;
  } else if (editorView === "single") {
    command.zoom = FOCUSED_SCREEN_ZOOM;
  }
  if (tool) command.tool = tool;
  return command;
}

function applyInlineStyleToHtml(
  content: string,
  selector: string,
  property: string,
  value: string,
): string | null {
  return applyInlineStylesToHtml(content, selector, { [property]: value });
}

function applyInlineStylesToHtml(
  content: string,
  selector: string,
  styles: Record<string, string>,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, selector) as HTMLElement | null;
    if (!element) return null;
    Object.entries(styles).forEach(([property, value]) => {
      (element.style as any)[property] = value;
    });
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

const CSS_PROPERTY_UTILITY_STEMS: Record<string, string[]> = {
  color: ["text-color"],
  "background-color": ["background-color"],
  background: ["background-color", "background-image"],
  "font-size": ["font-size"],
  "font-weight": ["font-weight"],
  "font-family": ["font-family"],
  "text-align": ["text-align"],
  display: ["display"],
  position: ["position"],
  width: ["w"],
  height: ["h"],
  opacity: ["opacity"],
  "border-radius": ["rounded"],
  padding: ["p"],
  "padding-left": ["px", "pl"],
  "padding-right": ["px", "pr"],
  "padding-top": ["py", "pt"],
  "padding-bottom": ["py", "pb"],
  margin: ["m"],
  "margin-left": ["mx", "ml"],
  "margin-right": ["mx", "mr"],
  "margin-top": ["my", "mt"],
  "margin-bottom": ["my", "mb"],
  gap: ["gap"],
  "column-gap": ["gap-x"],
  "row-gap": ["gap-y"],
};

const DEFAULT_STATES_PANEL_BREAKPOINTS = [
  { id: "bp-mobile", label: "Mobile", widthPx: 390 },
  { id: "bp-tablet", label: "Tablet", widthPx: 768 },
  { id: "bp-desktop", label: "Desktop", widthPx: 1280 },
] as const;

function normalizeCssPropertyName(property: string): string {
  return property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function looksLikeTailwindUtility(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/[;{}]/.test(trimmed) || /\/\*/.test(trimmed)) return false;
  if (/^(?:#|rgb\(|rgba\(|hsl\(|hsla\(|var\(|calc\()/i.test(trimmed)) {
    return false;
  }
  if (trimmed.includes(":")) return false;
  return /^[!-]?[a-z0-9][a-z0-9[\]()./%_-]*$/i.test(trimmed);
}

function responsiveUtilityMatchesStyleProperty(
  property: string,
  value: string,
): boolean {
  if (!looksLikeTailwindUtility(value)) return false;
  const normalizedProperty = normalizeCssPropertyName(property);
  const stem = utilityStem(value.trim());
  const allowed = CSS_PROPERTY_UTILITY_STEMS[normalizedProperty];
  return allowed ? allowed.includes(stem) : stem === normalizedProperty;
}

interface DesignStatePreviewRow {
  captureData?: Record<string, unknown> | null;
  fixtureData?: Record<string, unknown> | null;
}

const STATE_PREVIEW_HTML_KEYS = [
  "domHtml",
  "domSnapshot",
  "documentHtml",
  "html",
  "content",
  "markup",
] as const;

function looksLikePreviewHtml(value: string): boolean {
  return /<!doctype|<html\b|<body\b|<[a-zA-Z][\s>]/i.test(value);
}

function findStatePreviewHtml(value: unknown, depth = 0): string | null {
  if (typeof value === "string") {
    return looksLikePreviewHtml(value) ? value : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2)
    return null;
  const record = value as Record<string, unknown>;
  for (const key of STATE_PREVIEW_HTML_KEYS) {
    const hit = findStatePreviewHtml(record[key], depth + 1);
    if (hit) return hit;
  }
  for (const entry of Object.values(record)) {
    const hit = findStatePreviewHtml(entry, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function designStatePreviewHtml(
  row: DesignStatePreviewRow | undefined,
): string | null {
  if (!row) return null;
  return (
    findStatePreviewHtml(row.captureData) ??
    findStatePreviewHtml(row.fixtureData)
  );
}

function escapeHtmlAttributeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const ABS_POSITION_PROPS = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
] as const;

/**
 * Remove absolute-positioning style properties from the element identified by
 * `data-agent-native-node-id` so that it becomes a flow child after being
 * reparented into a container. Returns the updated HTML, or the original HTML
 * if the node cannot be found or parsing is unavailable.
 *
 * Uses DOMParser + CSSStyleDeclaration.removeProperty() rather than
 * applyVisualEdit({kind:"style",value:""}) because the substrate rejects
 * empty-string values in isSafeStyleValue, making that approach a silent no-op.
 */
function removeAbsolutePositioningFromNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    for (const prop of ABS_POSITION_PROPS) {
      element.style.removeProperty(prop);
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

function setAbsolutePositioningForNodeInHtml(
  content: string,
  nodeAttrId: string,
  point: { x: number; y: number },
  pointerOffset?: { x: number; y: number },
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    element.style.position = "absolute";
    element.style.left = `${Math.round(point.x - (pointerOffset?.x ?? 0))}px`;
    element.style.top = `${Math.round(point.y - (pointerOffset?.y ?? 0))}px`;
    element.style.removeProperty("right");
    element.style.removeProperty("bottom");
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

function getAbsolutePositioningForNodeInHtml(
  content: string,
  nodeAttrId: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return null;
    return {
      x: Number.parseFloat(element.style.left || "0") || 0,
      y: Number.parseFloat(element.style.top || "0") || 0,
    };
  } catch {
    return null;
  }
}

function elementAtPortableStylePath(
  root: Element,
  node: PortableStyleSnapshotNode,
): Element | null {
  let current: Element | null = root;
  for (const index of node.path) {
    if (!current || !Number.isInteger(index) || index < 0) return null;
    current = current.children.item(index);
  }
  return current;
}

function applyPortableStyles(
  element: Element | null,
  styles: Record<string, string>,
) {
  if (!element) return;
  const host = styleHost(element);
  if (!host) return;
  Object.entries(styles).forEach(([property, value]) => {
    if (!value) return;
    if (property.startsWith("--") || property.includes("-")) {
      host.style.setProperty(property, value);
      return;
    }
    (host.style as any)[property] = value;
  });
}

function applyPortableStyleSnapshotToHtml(
  content: string,
  nodeAttrId: string,
  snapshot?: PortableStyleSnapshot,
): string {
  if (typeof window === "undefined" || !snapshot?.nodes?.length) {
    return content;
  }
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const root = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    );
    if (!root) return content;
    root.setAttribute("data-agent-native-preserve-styles", "true");
    snapshot.nodes.forEach((node) => {
      const target = elementAtPortableStylePath(root, node);
      if (target) applyPortableStyles(target, node.styles);
    });
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

function isAbsoluteCodeLayerNode(node: CodeLayerNode | null | undefined) {
  const position = String(node?.style.position ?? "").toLowerCase();
  return position === "absolute" || position === "fixed";
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setCodeLayerAttributeInHtml(
  content: string,
  node: CodeLayerNode,
  name: string,
  value: string | null,
): string | null {
  if (!node.source) return null;
  const openStart = node.source.openStart;
  const openEnd = node.source.openEnd;
  if (openStart < 0 || openEnd <= openStart || openEnd > content.length) {
    return null;
  }

  const openTag = content.slice(openStart, openEnd);
  const attrPattern = new RegExp(
    `\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>]+))?`,
    "i",
  );
  const replacement =
    value === null || value === ""
      ? ""
      : ` ${name}="${escapeHtmlAttributeValue(value)}"`;

  if (attrPattern.test(openTag)) {
    const nextOpenTag = openTag.replace(attrPattern, replacement);
    return `${content.slice(0, openStart)}${nextOpenTag}${content.slice(openEnd)}`;
  }

  if (value === null || value === "") return content;
  const insertAt = openTag.endsWith("/>") ? openEnd - 2 : openEnd - 1;
  return `${content.slice(0, insertAt)}${replacement}${content.slice(insertAt)}`;
}

function getBodyInlineStyles(content: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const body = doc.body;
    if (!body) return {};
    return {
      backgroundColor: body.style.backgroundColor,
      backgroundImage: body.style.backgroundImage,
      backgroundPosition: body.style.backgroundPosition,
      backgroundRepeat: body.style.backgroundRepeat,
      backgroundSize: body.style.backgroundSize,
      fontFamily: body.style.fontFamily,
      fontSize: body.style.fontSize,
    };
  } catch {
    return {};
  }
}

function nextDuplicatedFilename(files: DesignFile[], filename: string): string {
  const existing = new Set(files.map((file) => file.filename));
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : "";
  let candidate = `${base}-copy${extension}`;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-copy-${index}${extension}`;
    index += 1;
  }
  return candidate;
}

function normalizedDesignFileType(
  fileType: string,
): "html" | "css" | "jsx" | "asset" {
  return fileType === "css" ||
    fileType === "jsx" ||
    fileType === "asset" ||
    fileType === "html"
    ? fileType
    : "html";
}

function nextBlankScreenFilename(files: DesignFile[]): string {
  const existing = new Set(files.map((file) => file.filename));
  const screenCount = files.filter(
    (file) =>
      normalizedDesignFileType(file.fileType) === "html" &&
      !isBoardFile(file.filename),
  ).length;
  let index = screenCount + 1;
  let candidate = `screen-${index}.html`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `screen-${index}.html`;
  }
  return candidate;
}

function blankScreenHtml(title: string): string {
  const safeTitle = escapeHtmlText(title);
  const safeTitleAttribute = escapeHtmlAttributeValue(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--color-bg, #ffffff);
      color: var(--color-text, #111827);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 48px;
    }
  </style>
</head>
<body>
  <main data-agent-native-layer-name="${safeTitleAttribute}">
  </main>
</body>
</html>`;
}

function uniqueLayerId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Re-stamp every `data-agent-native-node-id` in duplicated screen content with a
 * fresh unique id. Without this, a duplicated screen carries the SAME node ids as
 * its source, which collapses the cross-file layer-owner map (selecting a layer
 * in one screen resolves to the other) and can produce a malformed aggregate
 * projection.
 */
function reassignDuplicatedNodeIds(content: string): string {
  return content.replace(
    /data-agent-native-node-id="[^"]*"/g,
    () => `data-agent-native-node-id="${uniqueLayerId("copy")}"`,
  );
}

function primitiveLayerName(primitive: CanvasPrimitiveInsert): string {
  switch (primitive.kind) {
    case "frame":
      return "Frame";
    case "line":
      return "Line";
    case "arrow":
      return "Arrow";
    case "ellipse":
      return "Ellipse";
    case "polygon":
      return "Polygon";
    case "star":
      return "Star";
    case "path":
      return "Vector";
    case "text":
      return primitive.text?.trim() || "Text";
    case "rectangle":
    default:
      return "Rectangle";
  }
}

function appendCanvasPrimitiveToHtml(
  content: string,
  primitive: CanvasPrimitiveInsert,
  options?: { preserveNegativePosition?: boolean },
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const geometry = primitive.geometry;
    const left = options?.preserveNegativePosition
      ? Math.round(geometry.x)
      : Math.max(0, Math.round(geometry.x));
    const top = options?.preserveNegativePosition
      ? Math.round(geometry.y)
      : Math.max(0, Math.round(geometry.y));
    const width = Math.max(1, Math.round(geometry.width));
    const height = Math.max(1, Math.round(geometry.height));
    const nodeId = primitive.nodeId ?? uniqueLayerId(primitive.kind);
    const layerName = primitiveLayerName(primitive);

    if (
      primitive.kind === "path" ||
      primitive.kind === "line" ||
      primitive.kind === "arrow"
    ) {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      const markerId = `${nodeId}-arrow`;
      const explicitPathData = primitive.pathData?.trim()
        ? primitive.pathData
        : null;
      const pathViewBoxLeft = options?.preserveNegativePosition
        ? geometry.x
        : Math.max(0, geometry.x);
      const pathViewBoxTop = options?.preserveNegativePosition
        ? geometry.y
        : Math.max(0, geometry.y);
      const pathViewBoxWidth = Math.max(1, geometry.width);
      const pathViewBoxHeight = Math.max(1, geometry.height);
      const points = primitive.points?.length
        ? primitive.points
        : [
            { x: left, y: top + height / 2 },
            { x: left + width, y: top + height / 2 },
          ];
      const originX = Math.min(...points.map((point) => point.x));
      const originY = Math.min(...points.map((point) => point.y));
      path.setAttribute(
        "d",
        explicitPathData ??
          points
            .map((point, index) => {
              const command = index === 0 ? "M" : "L";
              return `${command} ${Math.round(point.x - originX)} ${Math.round(
                point.y - originY,
              )}`;
            })
            .join(" "),
      );
      path.setAttribute("fill", "none");
      path.setAttribute(
        "stroke",
        primitive.stroke ?? "var(--primary, #2563eb)",
      );
      path.setAttribute("stroke-width", String(primitive.strokeWidth ?? 3));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      if (primitive.kind === "arrow") {
        const defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = doc.createElementNS(
          "http://www.w3.org/2000/svg",
          "marker",
        );
        const arrowHead = doc.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        marker.setAttribute("id", markerId);
        marker.setAttribute("markerWidth", "10");
        marker.setAttribute("markerHeight", "10");
        marker.setAttribute("refX", "8");
        marker.setAttribute("refY", "5");
        marker.setAttribute("orient", "auto");
        marker.setAttribute("markerUnits", "strokeWidth");
        arrowHead.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
        arrowHead.setAttribute(
          "fill",
          primitive.stroke ?? "var(--primary, #2563eb)",
        );
        marker.appendChild(arrowHead);
        defs.appendChild(marker);
        svg.appendChild(defs);
        path.setAttribute("marker-end", `url(#${markerId})`);
      }
      svg.setAttribute("data-agent-native-node-id", nodeId);
      svg.setAttribute("data-agent-native-layer-name", layerName);
      // Kind marker so the layers panel shows a true vector/line/arrow icon for
      // this SVG primitive instead of falling through to the rectangle glyph.
      // Read by treeTypeForNode in shared/code-layer.ts.
      svg.setAttribute("data-an-primitive", primitive.kind);
      svg.setAttribute(
        "viewBox",
        explicitPathData
          ? `${pathViewBoxLeft} ${pathViewBoxTop} ${pathViewBoxWidth} ${pathViewBoxHeight}`
          : `0 0 ${width} ${height}`,
      );
      svg.setAttribute(
        "style",
        [
          "position:absolute",
          `left:${left}px`,
          `top:${top}px`,
          `width:${width}px`,
          `height:${height}px`,
          "overflow:visible",
          geometry.rotation ? `transform:rotate(${geometry.rotation}deg)` : "",
        ]
          .filter(Boolean)
          .join(";"),
      );
      svg.appendChild(path);
      doc.body.appendChild(svg);
      return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    }

    if (primitive.kind === "polygon" || primitive.kind === "star") {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      const polygon = doc.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon",
      );
      polygon.setAttribute(
        "points",
        polygonPointsForHtmlShape(primitive.kind, width, height),
      );
      polygon.setAttribute("fill", primitive.fill ?? "rgba(37, 99, 235, 0.16)");
      polygon.setAttribute("stroke", primitive.stroke ?? "rgb(37, 99, 235)");
      polygon.setAttribute(
        "stroke-width",
        String(primitive.strokeWidth ?? 1.5),
      );
      polygon.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("data-agent-native-node-id", nodeId);
      svg.setAttribute("data-agent-native-layer-name", layerName);
      // Kind marker so the layers panel shows a true polygon/star icon for this
      // SVG primitive instead of falling through to the rectangle glyph.
      // Read by treeTypeForNode in shared/code-layer.ts.
      svg.setAttribute("data-an-primitive", primitive.kind);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute(
        "style",
        [
          "position:absolute",
          `left:${left}px`,
          `top:${top}px`,
          `width:${width}px`,
          `height:${height}px`,
          "overflow:visible",
          geometry.rotation ? `transform:rotate(${geometry.rotation}deg)` : "",
        ]
          .filter(Boolean)
          .join(";"),
      );
      svg.appendChild(polygon);
      doc.body.appendChild(svg);
      return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    }

    const element = doc.createElement("div");
    element.setAttribute("data-agent-native-node-id", nodeId);
    element.setAttribute("data-agent-native-layer-name", layerName);
    // Kind marker so the layers panel shows a shape/text/frame icon for this
    // primitive (rectangle/ellipse/text/frame) instead of the generic code
    // glyph. Read by treeTypeForNode in shared/code-layer.ts.
    element.setAttribute("data-an-primitive", primitive.kind);
    element.style.position = "absolute";
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    if (!(primitive.kind === "text" && primitive.autoSize)) {
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    if (geometry.rotation) {
      element.style.transform = `rotate(${geometry.rotation}deg)`;
    }

    // Use the shared canvas-primitive-style module so committed output is
    // pixel-identical to the draft preview (fixes B5 color jump, B6 ellipse
    // radius jump).  User-supplied fill/stroke/strokeWidth override the
    // canonical defaults so hand-chosen colours are preserved.
    const canonical = canvasPrimitiveVisual(
      primitive.kind === "rectangle" ? "rect" : primitive.kind,
    );
    if (primitive.kind === "frame") {
      element.style.background = primitive.fill ?? canonical.background;
      element.style.border =
        primitive.stroke !== undefined || primitive.strokeWidth !== undefined
          ? `${primitive.strokeWidth ?? 1}px dashed ${primitive.stroke ?? canonical.border.split(" ").slice(2).join(" ")}`
          : canonical.border;
      element.style.borderRadius = canonical.borderRadius;
      element.style.overflow = "hidden";
    } else if (primitive.kind === "text") {
      element.textContent = primitive.text ?? "";
      element.style.display = primitive.autoSize ? "inline-block" : "flex";
      if (!primitive.autoSize) {
        element.style.alignItems = "center";
      }
      element.style.color = primitive.fill ?? "currentColor";
      element.style.fontSize = "16px";
      element.style.lineHeight = "1.2";
      element.style.whiteSpace = "pre-wrap";
      element.style.border = canonical.border;
      element.style.borderRadius = canonical.borderRadius;
    } else if (primitive.kind === "ellipse") {
      element.style.background = primitive.fill ?? canonical.background;
      element.style.border =
        primitive.stroke !== undefined || primitive.strokeWidth !== undefined
          ? `${primitive.strokeWidth ?? 1}px solid ${primitive.stroke ?? canonical.border.split(" ").slice(2).join(" ")}`
          : canonical.border;
      element.style.borderRadius = canonical.borderRadius; // "50%"
    } else {
      // rect / rectangle / frame fallthrough
      element.style.background = primitive.fill ?? canonical.background;
      element.style.border =
        primitive.stroke !== undefined || primitive.strokeWidth !== undefined
          ? `${primitive.strokeWidth ?? 1}px solid ${primitive.stroke ?? canonical.border.split(" ").slice(2).join(" ")}`
          : canonical.border;
      element.style.borderRadius = canonical.borderRadius;
    }

    doc.body.appendChild(element);
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

function polygonPointsForHtmlShape(
  kind: "polygon" | "star",
  width: number,
  height: number,
): string {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const cx = safeWidth / 2;
  const cy = safeHeight / 2;
  const radius = Math.max(1, Math.min(safeWidth, safeHeight) / 2);
  const points: Array<{ x: number; y: number }> = [];

  if (kind === "polygon") {
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 3;
      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
  } else {
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const pointRadius = index % 2 === 0 ? radius : radius * 0.45;
      points.push({
        x: cx + Math.cos(angle) * pointRadius,
        y: cy + Math.sin(angle) * pointRadius,
      });
    }
  }

  return points
    .map(
      (point) =>
        `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`,
    )
    .join(" ");
}

function cloneHtmlLayerAtPosition(
  content: string,
  layerHtml: string,
  position: { x: number; y: number },
): string | null {
  return (
    insertClonedHtmlLayers(content, [layerHtml], {
      positions: [position],
    })?.content ?? null
  );
}

function styleHost(element: Element): (HTMLElement | SVGElement) | null {
  return element instanceof HTMLElement || element instanceof SVGElement
    ? element
    : null;
}

function clearRootLayerPosition(element: Element) {
  const host = styleHost(element);
  if (!host) return;
  host.style.position = "";
  host.style.left = "";
  host.style.top = "";
  host.style.right = "";
  host.style.bottom = "";
}

function setRootLayerPosition(
  element: Element,
  position: { x: number; y: number },
) {
  const host = styleHost(element);
  if (!host) return;
  // Use explicit style property assignments rather than prepending a raw
  // string. Prepending creates duplicate CSS properties in the same style
  // attribute, and in CSS the LAST occurrence wins, so existing left/top
  // values from the cloned element would override the new position.
  host.style.position = "absolute";
  host.style.left = `${Math.max(0, Math.round(position.x))}px`;
  host.style.top = `${Math.max(0, Math.round(position.y))}px`;
  host.style.right = "";
  host.style.bottom = "";
}

function prepareClonedHtmlLayer(
  doc: Document,
  layerHtml: string,
  styleSnapshot?: PortableStyleSnapshot,
): { element: Element; rootNodeId: string } | null {
  const layerDoc = new DOMParser().parseFromString(
    `<template>${layerHtml}</template>`,
    "text/html",
  );
  const source =
    layerDoc.querySelector("template")?.content.firstElementChild ??
    layerDoc.body.firstElementChild;
  if (!source) return null;
  const clone = doc.importNode(source, true) as Element;
  if (styleSnapshot) {
    clone.setAttribute("data-agent-native-preserve-styles", "true");
    styleSnapshot.nodes.forEach((node) => {
      const target = elementAtPortableStylePath(clone, node);
      if (target) applyPortableStyles(target, node.styles);
    });
  }
  const rootNodeId = uniqueLayerId("copy");
  clone.setAttribute("data-agent-native-node-id", rootNodeId);
  Array.from(clone.querySelectorAll("[data-agent-native-node-id]")).forEach(
    (node) => {
      node.setAttribute(
        "data-agent-native-node-id",
        uniqueLayerId("copy-child"),
      );
    },
  );
  return { element: clone, rootNodeId };
}

function insertClonedHtmlLayers(
  content: string,
  layerHtmls: string[],
  options: {
    targetSelectors?: string[];
    anchorSelectors?: string[];
    placement?: "before" | "after" | "inside";
    stripRootPosition?: boolean;
    positions?: Array<{ x: number; y: number } | null | undefined>;
    styleSnapshots?: Array<PortableStyleSnapshot | null | undefined>;
  } = {},
): { content: string; rootNodeIds: string[] } | null {
  if (typeof window === "undefined" || layerHtmls.length === 0) return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const fragment = doc.createDocumentFragment();
    const rootNodeIds: string[] = [];
    layerHtmls.forEach((layerHtml, index) => {
      const prepared = prepareClonedHtmlLayer(
        doc,
        layerHtml,
        options.styleSnapshots?.[index] ?? undefined,
      );
      if (!prepared) return;
      const position = options.positions?.[index];
      if (position) {
        setRootLayerPosition(prepared.element, position);
      } else if (options.stripRootPosition) {
        clearRootLayerPosition(prepared.element);
      }
      rootNodeIds.push(prepared.rootNodeId);
      fragment.appendChild(prepared.element);
    });
    if (rootNodeIds.length === 0) return null;

    const target = queryFirstSelector(doc, options.targetSelectors ?? []);
    const anchor =
      queryFirstSelector(doc, options.anchorSelectors ?? []) ?? target;
    const placement = options.placement ?? "after";
    if (!anchor) {
      doc.body.appendChild(fragment);
    } else if (placement === "inside") {
      anchor.appendChild(fragment);
    } else if (placement === "before") {
      if (anchor.parentElement)
        anchor.parentElement.insertBefore(fragment, anchor);
      else doc.body.appendChild(fragment);
    } else {
      if (anchor.parentElement) {
        anchor.parentElement.insertBefore(fragment, anchor.nextSibling);
      } else {
        doc.body.appendChild(fragment);
      }
    }
    return {
      content: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
      rootNodeIds,
    };
  } catch {
    return null;
  }
}

function queryFirstSelector(
  root: ParentNode,
  selectors: Array<string | undefined>,
): Element | null {
  for (const selector of selectors) {
    if (!selector) continue;
    try {
      const match = root.querySelector(selector);
      if (match) return match;
    } catch {
      // Ignore bridge selectors that are valid in the runtime but not in this
      // DOMParser pass; later aliases may still resolve.
    }
  }
  return null;
}

function queryUniqueSelector(
  root: ParentNode,
  selector: string,
): Element | null {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  } catch {
    return null;
  }
}

function insertClonedHtmlLayer(
  content: string,
  cloneHtml: string,
  options: {
    targetSelectors: string[];
    anchorSelectors?: string[];
    placement?: "before" | "after" | "inside";
  },
): string | null {
  return (
    insertClonedHtmlLayers(content, [cloneHtml], {
      targetSelectors: options.targetSelectors,
      anchorSelectors: options.anchorSelectors,
      placement: options.placement,
    })?.content ?? null
  );
}

function getElementOuterHtml(content: string, selector: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    return queryUniqueSelector(doc, selector)?.outerHTML ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract the absolute position declared in the outerHTML of a layer element.
 * Used to position a pasted element near its source so the paste lands inside
 * the same design area instead of at an arbitrary canvas coordinate.
 * Returns null if the position cannot be parsed (e.g. non-absolute element).
 */
function extractLayerPosition(
  layerHtml: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const layerDoc = new DOMParser().parseFromString(
      `<template>${layerHtml}</template>`,
      "text/html",
    );
    const source =
      (layerDoc.querySelector("template")?.content
        .firstElementChild as HTMLElement | null) ??
      (layerDoc.body.firstElementChild as HTMLElement | null);
    if (!source) return null;
    const left = parseFloat(source.style.left);
    const top = parseFloat(source.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { x: left, y: top };
  } catch {
    return null;
  }
}

function postBeginTextEditToPreviewIframes(
  screenId: string | null,
  nodeId: string,
): "active" | "done" | false {
  if (typeof document === "undefined" || !nodeId) return false;
  const iframes = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    ),
  );
  const targetIframes = iframes.filter(
    (iframe) => screenId && iframe.dataset.screenIframeId === screenId,
  );
  const orderedIframes = targetIframes.length > 0 ? targetIframes : iframes;
  const selector = `[data-agent-native-node-id="${nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"][data-agent-native-text-editing]`;
  for (const iframe of orderedIframes) {
    try {
      const doc = iframe.contentDocument;
      const node = doc?.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
      );
      const editing = doc?.querySelector(selector);
      if (editing && doc?.activeElement === editing) return "active";
      if (node && (node.textContent ?? "").trim().length > 0) return "done";
    } catch {
      // Keep retrying other iframes.
    }
  }
  orderedIframes.forEach((iframe) => {
    iframe.contentWindow?.postMessage(
      { type: "begin-text-edit", nodeId, force: true },
      "*",
    );
  });
  return false;
}

function scheduleBeginTextEditForScreen(
  screenId: string | null,
  nodeId: string,
) {
  if (typeof window === "undefined") return;
  let finished = false;
  [180, 300, 600, 900, 1200, 1800, 2400, 3200, 4200].forEach((delay) => {
    window.setTimeout(() => {
      if (finished) return;
      finished = postBeginTextEditToPreviewIframes(screenId, nodeId) === "done";
    }, delay);
  });
}

function postShaderFillPreviewClearToPreviewIframes() {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
    .forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          { type: "shader-fill-preview-clear" },
          "*",
        );
      } catch {
        // Ignore inaccessible iframe windows; same-origin previews handle this.
      }
    });
}

function removeElementFromHtml(
  content: string,
  selector: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, selector);
    if (!element) return null;
    element.remove();
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

function sanitizeEditableInnerHtml(html: string): string {
  if (typeof window === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(
      `<template>${html}</template>`,
      "text/html",
    );
    const fragment = doc.querySelector("template")?.content;
    if (!fragment) return html;
    fragment
      .querySelectorAll("script,style,iframe,object,embed,link,meta,base")
      .forEach((node) => node.remove());
    const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode() as Element | null;
    while (current) {
      for (const attr of Array.from(current.attributes)) {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value.trim().toLowerCase();
        if (
          attrName.startsWith("on") ||
          ((attrName === "href" ||
            attrName === "src" ||
            attrName === "xlink:href") &&
            attrValue.startsWith("javascript:"))
        ) {
          current.removeAttribute(attr.name);
        }
      }
      current = walker.nextNode() as Element | null;
    }
    return Array.from(fragment.childNodes)
      .map((node) =>
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element).outerHTML
          : (node.textContent ?? ""),
      )
      .join("");
  } catch {
    return html;
  }
}

function updateElementContentInHtml(
  content: string,
  selector: string,
  text: string,
  html?: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, selector);
    if (!element) return null;
    if (html !== undefined) {
      element.innerHTML = sanitizeEditableInnerHtml(html);
    } else {
      element.textContent = text;
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

function layerTypeForCodeLayer(
  node: CodeLayerTreeNode,
): LayersPanelNode["type"] {
  if (node.type === "group") return "group";
  if (node.type === "component") return "component";
  if (node.type === "ellipse") return "ellipse";
  if (node.type === "shape") return "shape";
  if (node.type === "vector") return "vector";
  if (node.type === "line") return "line";
  if (node.type === "arrow") return "arrow";
  if (node.type === "polygon") return "polygon";
  if (node.type === "star") return "star";
  if (node.type === "text") return "text";
  if (node.type === "image") return "image";
  return "element";
}

function codeLayerNodeLooksLikeComponent(
  node: CodeLayerNode | null | undefined,
): boolean {
  if (!node) return false;
  if (isComponentInstance(node)) return true;
  const tag = node.tag.toLowerCase();
  if (
    tag === "button" ||
    tag === "input" ||
    tag === "select" ||
    tag === "textarea"
  ) {
    return true;
  }
  if (/component|card|button|control/i.test(node.layerName)) return true;
  return node.classes.some((item) =>
    /component|card|button|control/i.test(item),
  );
}

function preferredCodeLayerSelector(node: CodeLayerNode): string {
  return (
    node.selectors.find((selector) =>
      /^\[data-(agent-native-node-id|code-layer-id|layer-id|builder-id|loc)=/.test(
        selector,
      ),
    ) ??
    node.path ??
    node.selector
  );
}

function codeLayerSelectorAliases(
  node: CodeLayerNode | null | undefined,
): string[] {
  if (!node) return [];
  return Array.from(
    new Set(
      [
        preferredCodeLayerSelector(node),
        node.selector,
        node.path,
        ...node.selectors,
      ]
        .map((selector) => selector.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeCodeLayerSelector(selector: string): string {
  return (
    selector
      .trim()
      .replace(/\s*>\s*/g, " > ")
      .replace(/\s+/g, " ")
      // Bridge emits :nth-of-type(1) for first siblings when multiple share a
      // tag; the projection omits the suffix for first occurrences. Strip it so
      // both forms round-trip to the same normalized string.
      .replace(/:nth-of-type\(1\)/g, "")
  );
}

function codeLayerSelectorPartTag(selectorPart: string): string | null {
  const match = selectorPart.trim().match(/^([A-Za-z][A-Za-z0-9:-]*)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function stripLeadingDocumentRootSelectorParts(selector: string): string {
  const parts = normalizeCodeLayerSelector(selector)
    .split(" > ")
    .map((part) => part.trim())
    .filter(Boolean);
  while (
    parts.length > 0 &&
    ["html", "body"].includes(codeLayerSelectorPartTag(parts[0] ?? "") ?? "")
  ) {
    parts.shift();
  }
  return parts.join(" > ");
}

function codeLayerSelectorMatchTargets(selector: string): string[] {
  return Array.from(
    new Set(
      [
        normalizeCodeLayerSelector(selector),
        stripLeadingDocumentRootSelectorParts(selector),
      ]
        .map((target) => target.trim())
        .filter(Boolean),
    ),
  );
}

function codeLayerSelectorMatches(
  node: CodeLayerNode | null | undefined,
  selector: string | undefined,
): boolean {
  if (!node || !selector) return false;
  const targets = codeLayerSelectorMatchTargets(selector);
  return codeLayerSelectorAliases(node).some((candidate) => {
    const normalized = normalizeCodeLayerSelector(candidate);
    return targets.some((target) => {
      const targetHasDirectPath = target.includes(" > ");
      return (
        normalized === target ||
        (targetHasDirectPath &&
          normalized.includes(" > ") &&
          (normalized.endsWith(` > ${target}`) ||
            target.endsWith(` > ${normalized}`)))
      );
    });
  });
}

const GENERIC_TAG_DISPLAY_NAMES: Record<string, string> = {
  html: "Document",
  head: "Head",
  canvas: "Canvas",
  table: "Table",
  thead: "Table Head",
  tbody: "Table Body",
  tr: "Table Row",
  td: "Table Cell",
  th: "Table Header",
  dl: "Description List",
  dt: "Description Term",
  dd: "Description",
  blockquote: "Quote",
  pre: "Preformatted",
  code: "Code",
  input: "Input",
  select: "Select",
  textarea: "Textarea",
  video: "Video",
  audio: "Audio",
  iframe: "Embed",
  details: "Details",
  summary: "Summary",
};

function resolvedLayerName(node: CodeLayerTreeNode): string {
  // layerNameSource "tag" means the projection fell back to the raw tag name.
  // For unrecognised tags fallbackTagLayerName() returns tag.toUpperCase(),
  // which is not user-friendly. Override those with a friendlier label while
  // leaving explicit semantic/text/attribute names unchanged.
  if (
    node.name === node.tag.toUpperCase() ||
    node.name === node.tag.toLowerCase()
  ) {
    return GENERIC_TAG_DISPLAY_NAMES[node.tag] ?? node.name;
  }
  return node.name;
}

function codeLayerTreeToPanelNodes(
  nodes: CodeLayerTreeNode[],
  lockedIds: Set<string>,
  hiddenIds: Set<string>,
  inheritedLocked = false,
  inheritedHidden = false,
  // Ancestor-path ids guarding against a cyclic projection (e.g. duplicate or
  // empty node ids like "an-" that make a node its own descendant) recursing
  // forever and crashing the whole editor with a stack overflow.
  ancestors: Set<string> = new Set(),
): LayersPanelNode[] {
  return nodes.map((node) => {
    const selfLocked = lockedIds.has(node.id);
    const selfHidden = hiddenIds.has(node.id);
    const locked = inheritedLocked || selfLocked;
    const hidden = inheritedHidden || selfHidden;
    let children: LayersPanelNode[] = [];
    if (!ancestors.has(node.id)) {
      ancestors.add(node.id);
      children = codeLayerTreeToPanelNodes(
        node.children,
        lockedIds,
        hiddenIds,
        locked,
        hidden,
        ancestors,
      );
      ancestors.delete(node.id);
    }
    return {
      id: node.id,
      name: resolvedLayerName(node),
      type: layerTypeForCodeLayer(node),
      tagName: node.tag,
      layout: node.layout,
      detail: node.detail,
      badge: node.badge,
      selectable: true,
      renamable: node.renamable,
      lockable: true,
      hideable: true,
      locked,
      hidden,
      children,
    };
  });
}

interface EffectiveCodeLayerState {
  lockedIds: Set<string>;
  hiddenIds: Set<string>;
}

interface SelectedLayerTarget {
  layerId: string;
  fileId: string;
  node: CodeLayerNode;
  tree: CodeLayerTreeNode[];
  elementInfo: ElementInfo;
}

function collectEffectiveCodeLayerState(
  nodes: CodeLayerTreeNode[],
  lockedIds: Set<string>,
  hiddenIds: Set<string>,
  inheritedLocked: boolean,
  inheritedHidden: boolean,
  state: EffectiveCodeLayerState,
  // Ids on the current ancestor path — guards against a malformed/cyclic
  // projection (e.g. a node that appears as its own descendant from duplicate
  // node ids) recursing forever and crashing the whole editor with a stack
  // overflow. A true cycle is skipped; duplicate ids in disjoint subtrees are
  // still visited.
  ancestors: Set<string> = new Set(),
): EffectiveCodeLayerState {
  nodes.forEach((node) => {
    if (ancestors.has(node.id)) return;
    const locked = inheritedLocked || lockedIds.has(node.id);
    const hidden = inheritedHidden || hiddenIds.has(node.id);
    if (locked) state.lockedIds.add(node.id);
    if (hidden) state.hiddenIds.add(node.id);
    ancestors.add(node.id);
    collectEffectiveCodeLayerState(
      node.children,
      lockedIds,
      hiddenIds,
      locked,
      hidden,
      state,
      ancestors,
    );
    ancestors.delete(node.id);
  });
  return state;
}

function bridgeSourceIdForCodeLayerNode(node: CodeLayerNode): string {
  return (
    node.dataAttributes["data-agent-native-node-id"] ??
    node.dataAttributes["data-code-layer-id"] ??
    node.dataAttributes["data-layer-id"] ??
    node.dataAttributes["data-builder-id"] ??
    node.dataAttributes["data-loc"] ??
    (typeof node.attributes.id === "string" ? node.attributes.id : undefined) ??
    node.id
  );
}

function elementInfoFromCodeLayerNode(node: CodeLayerNode): ElementInfo {
  return {
    tagName: node.tag,
    id: typeof node.attributes.id === "string" ? node.attributes.id : undefined,
    sourceId: bridgeSourceIdForCodeLayerNode(node),
    selector: preferredCodeLayerSelector(node),
    classes: node.classes,
    computedStyles: Object.fromEntries(
      Object.entries(node.style).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    textContent: node.textSnippet ?? undefined,
    childElementCount: node.children.length,
    isFlexChild: node.layout.parentDisplay?.includes("flex") ? true : false,
    isFlexContainer: node.layout.isFlexContainer,
    parentDisplay: node.layout.parentDisplay,
    confidence: node.confidence,
  };
}

function camelCaseCssProperty(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function cssStyleAliases(
  styles: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [property, value] of Object.entries(styles)) {
    result[property] = value;
    if (property.includes("-")) {
      result[camelCaseCssProperty(property)] = value;
    }
  }
  return result;
}

function refreshedComputedStyles(
  info: ElementInfo,
  sourceStyles: Record<string, string>,
  sourceClasses: readonly string[],
): Record<string, string> {
  const sourceWithAliases = cssStyleAliases(sourceStyles);
  return sourceClasses.length > 0
    ? { ...info.computedStyles, ...sourceWithAliases }
    : sourceWithAliases;
}

function codeLayerNodeMatchesBridgeTarget(
  node: CodeLayerNode,
  selector?: string,
  sourceId?: string,
): boolean {
  if (sourceId) {
    if (node.id === sourceId) return true;
    if (
      node.dataAttributes["data-agent-native-node-id"] === sourceId ||
      node.dataAttributes["data-code-layer-id"] === sourceId ||
      node.dataAttributes["data-layer-id"] === sourceId ||
      node.dataAttributes["data-builder-id"] === sourceId ||
      node.dataAttributes["data-loc"] === sourceId ||
      node.attributes.id === sourceId
    ) {
      return true;
    }
  }
  return codeLayerSelectorMatches(node, selector);
}

function resolveCodeLayerNodeFromBridge(
  projection: { nodes: CodeLayerNode[] },
  selector?: string,
  sourceId?: string,
): CodeLayerNode | null {
  return (
    projection.nodes.find((node) =>
      codeLayerNodeMatchesBridgeTarget(node, selector, sourceId),
    ) ?? null
  );
}

function collapsedElementText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function resolveCodeLayerNodeFromElementInfo(
  projection: { nodes: CodeLayerNode[] },
  info: ElementInfo | null | undefined,
): CodeLayerNode | null {
  if (!info) return null;
  const direct = resolveCodeLayerNodeFromBridge(
    projection,
    info.selector,
    info.sourceId ?? info.id,
  );
  if (direct) return direct;

  const tagName = info.tagName.toLowerCase();
  const text = collapsedElementText(info.textContent);
  const classes = new Set(info.classes);
  const scored = projection.nodes
    .filter((node) => node.tag === tagName)
    .map((node) => {
      let score = 0;
      const nodeText = collapsedElementText(node.textSnippet);
      if (text && nodeText) {
        if (nodeText === text) score += 8;
        else if (nodeText.includes(text) || text.includes(nodeText)) score += 4;
      }
      if (classes.size > 0) {
        const matchingClasses = node.classes.filter((className) =>
          classes.has(className),
        ).length;
        if (matchingClasses === classes.size) score += 4;
        else if (matchingClasses > 0) score += matchingClasses;
      }
      if (info.id && node.attributes.id === info.id) score += 6;
      return { node, score };
    })
    .filter((candidate) => candidate.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const [best, next] = scored;
  if (!best) return null;
  if (next && next.score === best.score) return null;
  return best.node;
}

function canonicalElementInfoForCodeLayerNode(
  info: ElementInfo,
  node: CodeLayerNode,
): ElementInfo {
  return {
    ...info,
    sourceId: bridgeSourceIdForCodeLayerNode(node),
    selector: preferredCodeLayerSelector(node),
    classes: node.classes,
    confidence: node.confidence,
    childElementCount: node.children.length,
    editCapabilities: info.editCapabilities?.some((capability) =>
      capability.kind.startsWith("deterministic"),
    )
      ? info.editCapabilities
      : [
          {
            kind: "deterministic-style-edit",
            label: "deterministic-style-edit",
            confidence: 0.88,
            reason: "Selection resolved to a unique source code layer.",
          },
        ],
  };
}

function canonicalizeElementInfoFromProjection(
  projection: { nodes: CodeLayerNode[] },
  info: ElementInfo,
): ElementInfo {
  const node = resolveCodeLayerNodeFromElementInfo(projection, info);
  return node ? canonicalElementInfoForCodeLayerNode(info, node) : info;
}

function elementInfoIsRuntimeOnly(
  info: ElementInfo | null | undefined,
): boolean {
  return Boolean(
    info?.editCapabilities?.some(
      (capability) => capability.kind === "unsupported",
    ),
  );
}

function codeLayerPatchMessage(
  message: string | null | undefined,
  fallback: string,
): string {
  if (!message) return fallback;
  return message.includes("did not match a code layer node")
    ? fallback
    : message;
}

export function refreshElementInfoFromContent(
  content: string,
  info: ElementInfo | null,
): ElementInfo | null {
  if (!info) return null;
  const projection = buildCodeLayerProjection(content);
  const node =
    resolveCodeLayerNodeFromElementInfo(projection, info) ??
    resolveCodeLayerNodeFromBridge(
      projection,
      info.selector,
      info.sourceId ?? info.id,
    );
  if (node) {
    const sourceInfo = elementInfoFromCodeLayerNode(node);
    return {
      ...canonicalElementInfoForCodeLayerNode(info, node),
      computedStyles: refreshedComputedStyles(
        info,
        sourceInfo.computedStyles,
        sourceInfo.classes,
      ),
      textContent: sourceInfo.textContent,
      childElementCount: sourceInfo.childElementCount,
      isFlexChild: sourceInfo.isFlexChild,
      isFlexContainer: sourceInfo.isFlexContainer,
      parentDisplay: sourceInfo.parentDisplay,
    };
  }
  if (!info.selector || typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, info.selector);
    if (!element) return null;
    const classes = Array.from(element.classList);
    return {
      ...info,
      classes,
      computedStyles: refreshedComputedStyles(
        info,
        parseInlineStyleAttribute(element.getAttribute("style")),
        classes,
      ),
      textContent: element.textContent?.slice(0, 200) ?? info.textContent,
      childElementCount: element.children.length,
    };
  } catch {
    return null;
  }
}

function collectCodeLayerAncestors(
  nodes: CodeLayerTreeNode[],
  targetId: string,
  ancestors: string[] = [],
): string[] {
  for (const node of nodes) {
    if (node.id === targetId) return ancestors;
    const match = collectCodeLayerAncestors(node.children, targetId, [
      ...ancestors,
      node.id,
    ]);
    if (match.length > 0) return match;
  }
  return [];
}

export function sortCodeLayerIdsByTreeOrder(
  ids: readonly string[],
  tree: readonly CodeLayerTreeNode[],
): string[] {
  const treeOrder = new Map<string, number>();
  let index = 0;
  const visit = (nodes: readonly CodeLayerTreeNode[]) => {
    for (const node of nodes) {
      treeOrder.set(node.id, index);
      index += 1;
      visit(node.children);
    }
  };
  visit(tree);

  const originalOrder = new Map(
    ids.map((id, originalIndex) => [id, originalIndex]),
  );
  return [...ids].sort((a, b) => {
    const aOrder = treeOrder.get(a);
    const bOrder = treeOrder.get(b);
    if (aOrder === undefined && bOrder === undefined) {
      return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
    }
    if (aOrder === undefined) return 1;
    if (bOrder === undefined) return -1;
    return aOrder - bOrder;
  });
}

function findCodeLayerNodeInProjection(
  projection: CodeLayerProjection,
  previousNode: CodeLayerNode,
): CodeLayerNode | null {
  const stableSourceIds = [
    previousNode.dataAttributes["data-agent-native-node-id"],
    previousNode.dataAttributes["data-code-layer-id"],
    previousNode.dataAttributes["data-layer-id"],
    previousNode.dataAttributes["data-builder-id"],
    previousNode.dataAttributes["data-loc"],
    typeof previousNode.attributes.id === "string"
      ? previousNode.attributes.id
      : undefined,
  ].filter((id): id is string => Boolean(id));

  for (const sourceId of stableSourceIds) {
    const stableMatch = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === sourceId ||
        node.dataAttributes["data-code-layer-id"] === sourceId ||
        node.dataAttributes["data-layer-id"] === sourceId ||
        node.dataAttributes["data-builder-id"] === sourceId ||
        node.dataAttributes["data-loc"] === sourceId ||
        node.attributes.id === sourceId,
    );
    if (stableMatch) return stableMatch;
  }

  const exactMatch = projection.nodes.find(
    (node) => node.id === previousNode.id,
  );
  if (exactMatch) return exactMatch;

  const fallbackMatches = projection.nodes.filter(
    (node) =>
      node.tag === previousNode.tag &&
      node.layerName === previousNode.layerName &&
      (node.textSnippet ?? "") === (previousNode.textSnippet ?? ""),
  );
  return fallbackMatches.length === 1 ? (fallbackMatches[0] ?? null) : null;
}

export function findMovedCodeLayerNodeInProjection(
  projection: CodeLayerProjection,
  previousNode: CodeLayerNode,
  movedNodeId?: string | null,
): CodeLayerNode | null {
  if (movedNodeId) {
    const movedMatch = projection.nodes.find(
      (node) =>
        node.id === movedNodeId ||
        node.dataAttributes["data-agent-native-node-id"] === movedNodeId ||
        node.dataAttributes["data-code-layer-id"] === movedNodeId ||
        node.dataAttributes["data-layer-id"] === movedNodeId ||
        node.dataAttributes["data-builder-id"] === movedNodeId ||
        node.dataAttributes["data-loc"] === movedNodeId ||
        node.attributes.id === movedNodeId,
    );
    if (movedMatch) return movedMatch;
  }
  return findCodeLayerNodeInProjection(projection, previousNode);
}

export function parseInlineStyleAttribute(
  style: string | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const declaration of (style ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator <= 0) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (property && value) result[property] = value;
  }
  return result;
}

function AgentNativeMenuMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-5 -5 145 88"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M29.0771 77.8838H2.5L18.9 48.9L43.2 6.6C44 5.2 45.9 5.2 46.7 6.6L69.1 44.2C69.9 45.5 69 46.7305 67.5 46.7305H48.3C47.6 46.7305 46.9 47.1 46.6 47.7L30.8 76.9C30.45 77.5 29.8 77.8838 29.0771 77.8838Z"
        stroke="currentColor"
        strokeWidth="10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M105.927 0H132.5C134 0 134.9 1.6 134.15 2.9L91.5 76.9C91.15 77.5 90.5 77.8853 89.8 77.8853H63.8C62.3 77.8853 61.4 76.3 62.15 75L104.2 1C104.55 0.38 105.2 0 105.927 0Z"
        stroke="currentColor"
        strokeWidth="10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type DesignLeftPanel = "file" | "agent" | "assets" | "tools" | "tokens";

const INITIAL_GENERATION_DISABLED_LEFT_PANELS = new Set<DesignLeftPanel>([
  "file",
  "assets",
  "tools",
  "tokens",
]);

function normalizeDesignLeftPanel(value: unknown): DesignLeftPanel | undefined {
  if (value === "extensions") return "tools";
  return value === "file" ||
    value === "agent" ||
    value === "assets" ||
    value === "tools" ||
    value === "tokens"
    ? value
    : undefined;
}

function DesignWorkspaceRail({
  activePanel,
  disabledPanels,
  motionOpen,
  motionDisabled,
  projectMenu,
  onMotionToggle,
  onPanelChange,
}: {
  activePanel: DesignLeftPanel;
  disabledPanels?: ReadonlySet<DesignLeftPanel>;
  motionOpen?: boolean;
  motionDisabled?: boolean;
  projectMenu: ReactNode;
  onMotionToggle?: () => void;
  onPanelChange: (panel: DesignLeftPanel) => void;
}) {
  const t = useT();
  const items: Array<{
    panel: DesignLeftPanel;
    label: string;
    icon: ReactNode;
  }> = [
    {
      panel: "file",
      label: t("designEditor.leftRail.file"),
      icon: <IconFile className="size-[15px]" />,
    },
    {
      panel: "agent",
      label: t("designEditor.leftRail.agent"),
      icon: <IconMessage className="size-[15px]" />,
    },
    {
      panel: "assets",
      label: t("designEditor.leftRail.assets"),
      icon: <IconPhoto className="size-[15px]" />,
    },
    {
      panel: "tools",
      label: t("designEditor.leftRail.tools"),
      icon: <IconTerminal2 className="size-[15px]" />,
    },
    {
      panel: "tokens",
      label: t("designEditor.leftRail.tokens"),
      icon: <IconAssembly className="size-[15px]" />,
    },
  ];

  return (
    <nav
      aria-label={t("designEditor.leftRail.label")}
      className="flex w-[52px] shrink-0 flex-col items-center border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] py-3"
    >
      <div className="mb-3 flex h-8 items-center justify-center">
        {projectMenu}
      </div>
      <div className="mb-5 h-px w-8 bg-border/70" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4">
        {items.map((item) => {
          const active = item.panel === activePanel;
          const disabled = disabledPanels?.has(item.panel) ?? false;
          return (
            <Tooltip key={item.panel}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-disabled={disabled || undefined}
                  aria-current={active ? "page" : undefined}
                  tabIndex={disabled ? -1 : undefined}
                  onClick={(event) => {
                    if (disabled) {
                      event.preventDefault();
                      return;
                    }
                    onPanelChange(item.panel);
                  }}
                  className={cn(
                    "group flex w-12 cursor-pointer flex-col items-center justify-start gap-1 rounded-none text-[10px] font-[450] leading-none text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                    disabled &&
                      "cursor-default opacity-35 hover:text-muted-foreground",
                    active && "text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg transition-colors",
                      active
                        ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)]"
                        : "text-muted-foreground group-hover:bg-[var(--design-editor-layer-hover-color)] group-hover:text-foreground",
                      disabled &&
                        "group-hover:bg-transparent group-hover:text-muted-foreground",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="max-w-full truncate leading-none">
                    {item.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {onMotionToggle ? (
        <div className="mt-4 flex w-full flex-col items-center border-t border-border/70 pt-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={"Motion" /* i18n-ignore */}
                aria-disabled={motionDisabled || undefined}
                aria-pressed={motionOpen || undefined}
                tabIndex={motionDisabled ? -1 : undefined}
                onClick={(event) => {
                  if (motionDisabled) {
                    event.preventDefault();
                    return;
                  }
                  onMotionToggle();
                }}
                className={cn(
                  "group flex w-12 cursor-pointer flex-col items-center justify-start gap-1 rounded-none !text-[10px] font-[450] leading-none text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  motionDisabled &&
                    "cursor-default opacity-35 hover:text-muted-foreground",
                  motionOpen && "text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-colors",
                    motionOpen
                      ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)]"
                      : "text-muted-foreground group-hover:bg-[var(--design-editor-layer-hover-color)] group-hover:text-foreground",
                    motionDisabled &&
                      "group-hover:bg-transparent group-hover:text-muted-foreground",
                  )}
                >
                  {motionOpen ? (
                    <IconChevronDown className="size-[15px]" />
                  ) : (
                    <IconChevronUp className="size-[15px]" />
                  )}
                </span>
                <span className="max-w-full truncate leading-none">
                  {"Motion" /* i18n-ignore */}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {"Motion" /* i18n-ignore */}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </nav>
  );
}

interface DesignCollaborator {
  user: CollabUser;
  image?: string;
  isCurrent?: boolean;
}

function userInitial(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

function userColor(user: CollabUser): string {
  return user.color || emailToColor(user.email);
}

function DesignCollaboratorAvatar({
  collaborator,
  className,
}: {
  collaborator: DesignCollaborator;
  className?: string;
}) {
  const label = collaborator.user.name || emailToName(collaborator.user.email);
  const storedAvatarUrl = useAvatarUrl(collaborator.user.email);
  const avatarUrl = storedAvatarUrl ?? collaborator.image;

  return (
    <Avatar
      className={cn(
        "size-7 border-2 border-[var(--design-editor-panel-bg)] shadow-sm",
        className,
      )}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={label} /> : null}
      <AvatarFallback
        className="text-[10px] font-semibold text-white"
        style={{ backgroundColor: userColor(collaborator.user) }}
      >
        {userInitial(label || collaborator.user.email)}
      </AvatarFallback>
    </Avatar>
  );
}

function DesignCollaboratorsMenu({
  collaborators,
  followingEmail,
  label,
  onAvatarClick,
}: {
  collaborators: DesignCollaborator[];
  followingEmail?: string | null;
  label: string;
  onAvatarClick?: (user: CollabUser | null) => void;
}) {
  if (collaborators.length === 0) return null;

  const visibleCollaborators = collaborators.slice(0, 3);
  const hasMultipleCollaborators = collaborators.length > 1;
  const followingLower = followingEmail?.trim().toLowerCase() ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 cursor-pointer items-center rounded-md pr-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          aria-label={label}
        >
          <span className="flex items-center">
            {visibleCollaborators.map((collaborator, index) => (
              <DesignCollaboratorAvatar
                key={`${collaborator.user.email}:${index}`}
                collaborator={collaborator}
                className={index === 0 ? undefined : "-ml-2"}
              />
            ))}
          </span>
          {hasMultipleCollaborators ? (
            <IconChevronDown className="ml-0.5 size-3 opacity-70" />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {collaborators.map((collaborator) => {
          const user = collaborator.user;
          const email = user.email.trim().toLowerCase();
          const isFollowing =
            followingLower != null && email === followingLower;
          const name = user.name || emailToName(user.email);

          return (
            <DropdownMenuItem
              key={user.email}
              onSelect={(event) => {
                if (collaborator.isCurrent) {
                  event.preventDefault();
                  return;
                }
                onAvatarClick?.(user);
              }}
              className={cn(
                "gap-2",
                collaborator.isCurrent && "cursor-default",
              )}
            >
              <DesignCollaboratorAvatar collaborator={collaborator} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </span>
              {collaborator.isCurrent ? (
                <span className="text-xs text-muted-foreground">
                  {"You" /* i18n-ignore collaborator row */}
                </span>
              ) : isFollowing ? (
                <IconCheck className="size-3.5 text-[var(--design-editor-accent-color)]" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {"Follow" /* i18n-ignore collaborator row */}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReadOnlyEditorPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <IconLock className="size-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-56 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function externalPreviewUrlForContent(content: string): string | null {
  const trimmed = content.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function fullPreviewHtml(content: string): string {
  const trimmed = content.trim();
  if (/<!doctype html|<html[\s>]/i.test(trimmed)) return content;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${content}</body></html>`;
}

type DesignToolbarOption = {
  key: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

function DesignPenToolIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
      <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
      <path d="m2.3 2.3 7.286 7.286" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

function DesignToolbarTool({
  active,
  label,
  icon,
  options,
  onPrimary,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  options: DesignToolbarOption[];
  onPrimary: () => void;
}) {
  const hasOptionsMenu = options.length > 1;
  return (
    <div className="flex h-8 items-center text-neutral-200">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors",
              active
                ? "bg-[var(--design-editor-accent-color)] text-white"
                : "hover:bg-white/10 hover:text-white",
            )}
            onClick={(event) => {
              if (event.detail === 0) onPrimary();
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              onPrimary();
            }}
            aria-label={label}
            aria-pressed={active}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>

      {hasOptionsMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-8 w-4 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-white/10 hover:text-white",
                active && "text-neutral-200",
              )}
              aria-label={`${label} options`}
            >
              <IconChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="center"
            sideOffset={12}
            className="w-56 rounded-2xl border-border bg-popover p-2 text-popover-foreground shadow-md"
          >
            {options.map((option) => (
              <DropdownMenuItem
                key={option.key}
                disabled={option.disabled}
                onSelect={option.onSelect}
                className="h-10 rounded-lg text-sm text-popover-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:text-muted-foreground"
              >
                <span className="mr-2 flex size-5 items-center justify-center text-popover-foreground">
                  {option.active ? (
                    <IconCheck className="size-4" />
                  ) : (
                    option.icon
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.shortcut && (
                  <DropdownMenuShortcut className="ml-3 text-muted-foreground">
                    {option.shortcut}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function DesignModeTab({
  active,
  disabled,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "flex size-8 cursor-pointer items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40",
            active &&
              "bg-neutral-950/70 text-[#38bdf8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_18px_-12px_rgba(0,0,0,0.95)] hover:bg-neutral-950/70 hover:text-[#38bdf8]",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function DesignBottomToolbar({
  mode,
  pinMode,
  drawMode,
  activeTool,
  isOverview,
  hasActiveFile,
  onMove,
  onFrame,
  onShape,
  onText,
  onPen,
  onHand,
  onDraw,
  onScale,
  onCommentPin,
  onModeChange,
}: {
  mode: EditorMode;
  pinMode: boolean;
  drawMode: boolean;
  activeTool: DesignTool;
  isOverview: boolean;
  hasActiveFile: boolean;
  onMove: () => void;
  onFrame: () => void;
  onShape: (tool: ShapeTool) => void;
  onText: () => void;
  onPen: () => void;
  onHand: () => void;
  onDraw: () => void;
  onScale: () => void;
  onCommentPin: () => void;
  onModeChange: (mode: EditorMode) => void;
}) {
  const t = useT();
  const shapeTools = new Set<DesignTool>([
    "rect",
    "line",
    "arrow",
    "ellipse",
    "polygon",
    "star",
  ]);
  const activeShape = shapeTools.has(activeTool)
    ? (activeTool as ShapeTool)
    : "rect";
  const shapeIcon = (tool: ShapeTool, className: string) => {
    switch (tool) {
      case "line":
        return <IconLine className={className} />;
      case "arrow":
        return <IconArrowUpRight className={className} />;
      case "ellipse":
        return <IconCircle className={className} />;
      case "polygon":
        return <IconTriangle className={className} />;
      case "star":
        return <IconStar className={className} />;
      case "rect":
      default:
        return <IconSquare className={className} />;
    }
  };
  const shapeOptions: DesignToolbarOption[] = [
    {
      key: "rect",
      label: t("designEditor.tools.rect"),
      icon: shapeIcon("rect", "size-4"),
      shortcut: "R",
      active: activeTool === "rect",
      onSelect: () => onShape("rect"),
    },
    {
      key: "line",
      label: t("designEditor.tools.line"),
      icon: shapeIcon("line", "size-4"),
      shortcut: "L",
      active: activeTool === "line",
      onSelect: () => onShape("line"),
    },
    {
      key: "arrow",
      label: t("designEditor.tools.arrow"),
      icon: shapeIcon("arrow", "size-4"),
      shortcut: "⇧L",
      active: activeTool === "arrow",
      onSelect: () => onShape("arrow"),
    },
    {
      key: "ellipse",
      label: t("designEditor.tools.ellipse"),
      icon: shapeIcon("ellipse", "size-4"),
      shortcut: "O",
      active: activeTool === "ellipse",
      onSelect: () => onShape("ellipse"),
    },
    {
      key: "polygon",
      label: t("designEditor.tools.polygon"),
      icon: shapeIcon("polygon", "size-4"),
      active: activeTool === "polygon",
      onSelect: () => onShape("polygon"),
    },
    {
      key: "star",
      label: t("designEditor.tools.star"),
      icon: shapeIcon("star", "size-4"),
      active: activeTool === "star",
      onSelect: () => onShape("star"),
    },
    {
      key: "image-video",
      label: t("designEditor.tools.imageVideo"),
      icon: <IconPhotoVideo className="size-4" />,
      shortcut: "⇧⌘K",
      disabled: true,
      onSelect: () => {},
    },
  ];
  const activeShapeOption =
    shapeOptions.find((option) => option.key === activeShape) ??
    shapeOptions[0]!;
  const tools: Array<{
    key: string;
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    options: DesignToolbarOption[];
  }> = [
    {
      key: "move",
      // Parent button is active whenever any of the move-group sub-tools is
      // selected so the toolbar visually reflects hand and scale modes too.
      active:
        (activeTool === "move" && mode === "edit") ||
        activeTool === "hand" ||
        activeTool === "scale",
      label: t("designEditor.tools.move"),
      // Mirror the active sub-tool icon so the parent button is always
      // informative about the currently selected move-group tool.
      icon:
        activeTool === "hand" ? (
          <IconHandStop className="size-[18px]" />
        ) : activeTool === "scale" ? (
          <IconScale className="size-[18px]" />
        ) : (
          <IconPointer className="size-[18px]" />
        ),
      onClick: onMove,
      options: [
        {
          key: "move",
          label: t("designEditor.tools.move"),
          icon: <IconPointer className="size-4" />,
          shortcut: "V",
          active: activeTool === "move" && mode === "edit",
          onSelect: onMove,
        },
        {
          key: "hand",
          label: t("designEditor.tools.hand"),
          icon: <IconHandStop className="size-4" />,
          shortcut: "H",
          active: activeTool === "hand",
          onSelect: onHand,
        },
        {
          key: "scale",
          label: t("designEditor.tools.scale"),
          icon: <IconScale className="size-4" />,
          shortcut: "K",
          active: activeTool === "scale",
          onSelect: onScale,
        },
      ],
    },
    {
      key: "frame",
      active: activeTool === "frame",
      label: t("designEditor.tools.frame"),
      icon: <IconFrame className="size-[18px]" />,
      onClick: onFrame,
      options: [
        {
          key: "frame",
          label: t("designEditor.tools.frame"),
          icon: <IconFrame className="size-4" />,
          shortcut: "F",
          active: activeTool === "frame",
          onSelect: onFrame,
        },
      ],
    },
    {
      key: "shape",
      active: shapeTools.has(activeTool),
      label: activeShapeOption.label,
      icon: shapeIcon(activeShape, "size-[18px]"),
      onClick: () => onShape(activeShape),
      options: shapeOptions,
    },
    {
      key: "text",
      active: activeTool === "text",
      label: t("designEditor.tools.text"),
      icon: <IconTypography className="size-[18px]" />,
      onClick: onText,
      options: [
        {
          key: "text",
          label: t("designEditor.tools.text"),
          icon: <IconTypography className="size-4" />,
          shortcut: "T",
          active: activeTool === "text",
          onSelect: onText,
        },
      ],
    },
    {
      key: "pen",
      active: activeTool === "pen",
      label: t("designEditor.tools.pen"),
      icon: <DesignPenToolIcon className="size-[18px]" />,
      onClick: onPen,
      options: [
        {
          key: "pen",
          label: t("designEditor.tools.pen"),
          icon: <DesignPenToolIcon className="size-4" />,
          shortcut: "P",
          active: activeTool === "pen",
          onSelect: onPen,
        },
        {
          key: "draw",
          label: t("designEditor.modes.draw"),
          icon: <IconBrush className="size-4" />,
          active: activeTool === "draw" && mode === "annotate" && drawMode,
          disabled: !hasActiveFile || isOverview,
          onSelect: onDraw,
        },
      ],
    },
    {
      key: "comment",
      active: activeTool === "comment" && mode === "annotate" && pinMode,
      label: t("designEditor.pinComment"),
      icon: <IconMessage className="size-[18px]" />,
      onClick: onCommentPin,
      options: [
        {
          key: "comment",
          label: t("designEditor.pinComment"),
          icon: <IconMessage className="size-4" />,
          shortcut: "C",
          active: activeTool === "comment" && mode === "annotate" && pinMode,
          disabled: !hasActiveFile || isOverview,
          onSelect: onCommentPin,
        },
        {
          key: "draw",
          label: t("designEditor.modes.draw"),
          icon: <IconBrush className="size-4" />,
          active: activeTool === "draw" && mode === "annotate" && drawMode,
          disabled: !hasActiveFile || isOverview,
          onSelect: onDraw,
        },
      ],
    },
  ];

  const modes: Array<{
    key: EditorMode;
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
  }> = [
    {
      key: "annotate",
      active: mode === "annotate",
      label: t("designEditor.modes.annotate"),
      icon: <IconScribble className="size-[18px]" />,
      onClick: () => onModeChange("annotate"),
    },
    {
      key: "edit",
      active: mode === "edit",
      label: t("designEditor.modes.edit"),
      icon: <IconTransformPoint className="size-[18px]" />,
      onClick: () => onModeChange("edit"),
    },
    {
      key: "interact",
      active: mode === "interact",
      label: t("designEditor.modes.interact"),
      icon: <IconHandClick className="size-[18px]" />,
      onClick: () => onModeChange("interact"),
    },
  ];

  return (
    <div className="absolute bottom-4 left-1/2 z-[70] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/10 bg-[#2c2c2c]/95 p-1.5 text-neutral-100 shadow-[0_22px_55px_-24px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="flex min-w-0 items-center gap-0.5">
        {tools.map((tool) => (
          <DesignToolbarTool
            key={tool.key}
            active={tool.active}
            label={tool.label}
            icon={tool.icon}
            options={tool.options}
            onPrimary={tool.onClick}
          />
        ))}
      </div>

      <div className="h-9 w-px shrink-0 bg-white/15" />

      <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-white/10 p-0.5">
        {modes.map((item) => (
          <DesignModeTab
            key={item.key}
            active={item.active}
            label={item.label}
            icon={item.icon}
            onClick={item.onClick}
          />
        ))}
      </div>
    </div>
  );
}

function isDesignData(
  data: DesignData | string | undefined,
): data is DesignData {
  return !!data && typeof data === "object" && Array.isArray(data.files);
}

function areTweakSelectionsEqual(
  a: TweakSelections,
  b: TweakSelections,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

function buildAuthoritativeTweakSelections(
  tweaks: TweakDefinition[],
  persistedSelections: TweakSelections,
): TweakSelections {
  const selections: TweakSelections = {};
  for (const tweak of tweaks) {
    selections[tweak.id] =
      persistedSelections[tweak.id] !== undefined
        ? persistedSelections[tweak.id]
        : tweak.defaultValue;
  }
  for (const [key, value] of Object.entries(persistedSelections)) {
    if (/^--[-_a-zA-Z0-9]+$/.test(key)) {
      selections[key] = value;
    }
  }
  return selections;
}

function parseDesignDataJson(data?: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function getDesignDataRecord(
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = data[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getCanvasFrameGeometry(
  data: Record<string, unknown>,
): CanvasFrameGeometryById {
  return parseCanvasFrameGeometryById(data.canvasFrames);
}

function cloneCanvasFrameGeometry(
  geometryById: CanvasFrameGeometryById,
): CanvasFrameGeometryById {
  return Object.fromEntries(
    Object.entries(geometryById).map(([frameId, geometry]) => [
      frameId,
      { ...geometry },
    ]),
  );
}

function viewportSizeFromFrameGeometry(
  geometry: CanvasFrameGeometry | undefined,
) {
  if (
    typeof geometry?.width !== "number" ||
    !Number.isFinite(geometry.width) ||
    typeof geometry.height !== "number" ||
    !Number.isFinite(geometry.height)
  ) {
    return null;
  }
  return {
    width: Math.max(1, Math.round(geometry.width)),
    height: Math.max(1, Math.round(geometry.height)),
  };
}

function viewportChangedFrameIds(
  before: CanvasFrameGeometryById,
  after: CanvasFrameGeometryById,
) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].filter((frameId) => {
    const beforeSize = viewportSizeFromFrameGeometry(before[frameId]);
    const afterSize = viewportSizeFromFrameGeometry(after[frameId]);
    if (!beforeSize || !afterSize) return false;
    return (
      beforeSize.width !== afterSize.width ||
      beforeSize.height !== afterSize.height
    );
  });
}

function withSyncedScreenMetadataViewports(
  data: Record<string, unknown>,
  geometryById: CanvasFrameGeometryById,
  frameIds: string[],
): Record<string, unknown> {
  const uniqueFrameIds = [...new Set(frameIds)];
  if (uniqueFrameIds.length === 0) return data;

  const previousMetadata = getDesignDataRecord(data, "screenMetadata");
  const nextMetadata = { ...previousMetadata };
  let metadataChanged = false;

  for (const frameId of uniqueFrameIds) {
    const viewport = viewportSizeFromFrameGeometry(geometryById[frameId]);
    if (!viewport) continue;
    const previousEntry = getDesignDataRecord(previousMetadata, frameId);
    if (
      previousEntry.width === viewport.width &&
      previousEntry.height === viewport.height
    ) {
      continue;
    }
    nextMetadata[frameId] = {
      ...previousEntry,
      width: viewport.width,
      height: viewport.height,
    };
    metadataChanged = true;
  }

  if (!metadataChanged) return data;

  const nextData: Record<string, unknown> = {
    ...data,
    screenMetadata: nextMetadata,
  };
  const previousLocalhostScreens = getDesignDataRecord(
    data,
    "localhostScreens",
  );
  let localhostScreensChanged = false;
  const nextLocalhostScreens = { ...previousLocalhostScreens };
  for (const frameId of uniqueFrameIds) {
    const previousEntry = getDesignDataRecord(
      previousLocalhostScreens,
      frameId,
    );
    if (Object.keys(previousEntry).length === 0) continue;
    const viewport = viewportSizeFromFrameGeometry(geometryById[frameId]);
    if (!viewport) continue;
    nextLocalhostScreens[frameId] = {
      ...previousEntry,
      width: viewport.width,
      height: viewport.height,
    };
    localhostScreensChanged = true;
  }
  if (localhostScreensChanged) {
    nextData.localhostScreens = nextLocalhostScreens;
  }
  return nextData;
}

export default function DesignEditor() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialEditorUrlRef = useRef<{
    designId: string | undefined;
    searchParams: URLSearchParams;
  } | null>(null);
  if (
    !initialEditorUrlRef.current ||
    initialEditorUrlRef.current.designId !== id
  ) {
    initialEditorUrlRef.current = {
      designId: id,
      searchParams: new URLSearchParams(location.search),
    };
  }
  const initialSearchParams = initialEditorUrlRef.current.searchParams;
  const initialRouteScreenTarget =
    initialSearchParams.get("screen") ??
    initialSearchParams.get("fileId") ??
    initialSearchParams.get("filename");
  const initialRouteSelectionId = initialSearchParams.get("selection") || null;
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const postAuthIntent = useMemo<PostAuthDesignIntent | null>(() => {
    const value = searchParams.get("intent");
    return value === "save" || value === "share" ? value : null;
  }, [searchParams]);
  const queryClient = useQueryClient();
  const appStateVersion = useChangeVersion("app-state");
  const browserTabId = getBrowserTabId();
  const embedded = isEmbedAuthActive();
  const designChatScope = useMemo(
    () => (id ? ({ type: "design" as const, id } as const) : null),
    [id],
  );

  const isBuilderDesignEmbed = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      new URLSearchParams(window.location.search).get("design_host") ===
      "builder"
    );
  }, []);
  const [builderPreviewUrl, setBuilderPreviewUrl] = useState<string | null>(
    null,
  );

  // Editor state
  const [mode, setMode] = useState<EditorMode>("edit");
  const [activeTool, setActiveTool] = useState<DesignTool>("move");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [screenZoom, setScreenZoom] = useState(FOCUSED_SCREEN_ZOOM);
  const [explicitOverviewCanvasZoom, setExplicitOverviewCanvasZoom] = useState<
    number | null
  >(null);
  const [deviceFrame, setDeviceFrame] = useState<DeviceFrameType>("none");
  const [viewMode, setViewMode] = useState<"single" | "overview">("overview");
  const viewModeRef = useRef<"single" | "overview">("overview");
  // Trusted parent origin captured from the first validated inbound message.
  // Used to restrict outgoing postMessage calls that carry user data so they
  // are never broadcast to an arbitrary embedding page.
  const parentOriginRef = useRef<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null,
  );
  const [pendingVisualStyleEdits, setPendingVisualStyleEdits] = useState<
    PendingVisualStyleEdit[]
  >([]);
  const [textEditingState, setTextEditingState] = useState<{
    active: boolean;
    selector?: string;
    hasRange?: boolean;
  }>({ active: false });
  const [hoveredElement, setHoveredElement] = useState<ElementInfo | null>(
    null,
  );
  const [hoveredElementScreenId, setHoveredElementScreenId] = useState<
    string | null
  >(null);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [contentRenderRevision, setContentRenderRevision] = useState(0);
  const [activeInspectorTab, setActiveInspectorTab] =
    useState<InspectorTab>("design");
  const [activeLeftPanel, setActiveLeftPanel] =
    useState<DesignLeftPanel>("file");
  const initialSearchCommandAppliedForIdRef = useRef<string | null>(null);
  const initialUrlSelectionHydratedForIdRef = useRef<string | null>(null);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(256);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(256);
  const [layersSearchQuery, setLayersSearchQuery] = useState("");
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const [selectedLayerIdsState, setSelectedLayerIdsState] = useState<string[]>(
    [],
  );
  const selectedLayerTargetsRef = useRef<SelectedLayerTarget[]>([]);
  const effectiveCodeLayerStateRef = useRef<EffectiveCodeLayerState>({
    lockedIds: new Set(),
    hiddenIds: new Set(),
  });
  const [overviewSelectedScreenIds, setOverviewSelectedScreenIds] = useState<
    string[]
  >([]);
  const [createdOverviewLayerSelection, setCreatedOverviewLayerSelection] =
    useState<{ screenId: string; layerId: string } | null>(null);
  const pendingOverviewScreenSelectionRef = useRef<string | null>(null);
  const pendingOverviewLayerSelectionRef = useRef<string | null>(null);
  const lastOverviewSelectedScreenIdsRef = useRef<string[]>([]);
  // Tracks the nodeId of the most recently created TEXT primitive across one
  // handleCreatePrimitive → handlePrimitiveCreated round-trip. Cleared after
  // use. Lets handlePrimitiveCreated trigger begin-text-edit without needing
  // the primitive kind in its signature.
  const pendingTextEditNodeIdRef = useRef<string | null>(null);
  const pendingOverviewLayerSelectionClearTimerRef = useRef<number | null>(
    null,
  );

  useEffect(() => {
    const focusAgentComposer = () => {
      requestAnimationFrame(() => {
        const panel = document.querySelector("[data-design-agent-panel]");
        const prosemirror = panel?.querySelector(
          ".ProseMirror",
        ) as HTMLElement | null;
        if (prosemirror) {
          prosemirror.focus();
          return;
        }
        const textarea = panel?.querySelector("textarea") as HTMLElement | null;
        textarea?.focus();
      });
    };
    const openAgentPanel = () => {
      setActiveLeftPanel("agent");
      focusAgentComposer();
    };
    const toggleAgentPanel = () =>
      setActiveLeftPanel((current) => {
        const next = current === "agent" ? "file" : "agent";
        if (next === "agent") focusAgentComposer();
        return next;
      });
    window.addEventListener("agent-panel:open", openAgentPanel);
    window.addEventListener("agent-panel:toggle", toggleAgentPanel);
    return () => {
      window.removeEventListener("agent-panel:open", openAgentPanel);
      window.removeEventListener("agent-panel:toggle", toggleAgentPanel);
    };
  }, []);

  const clearPendingOverviewLayerSelectionTimer = useCallback(() => {
    if (pendingOverviewLayerSelectionClearTimerRef.current === null) return;
    window.clearTimeout(pendingOverviewLayerSelectionClearTimerRef.current);
    pendingOverviewLayerSelectionClearTimerRef.current = null;
  }, []);
  const schedulePendingOverviewLayerSelectionClear = useCallback(
    (layerId: string) => {
      clearPendingOverviewLayerSelectionTimer();
      pendingOverviewLayerSelectionClearTimerRef.current = window.setTimeout(
        () => {
          if (pendingOverviewLayerSelectionRef.current === layerId) {
            pendingOverviewLayerSelectionRef.current = null;
          }
          setCreatedOverviewLayerSelection((current) =>
            current?.layerId === layerId ? null : current,
          );
          pendingOverviewLayerSelectionClearTimerRef.current = null;
        },
        1800,
      );
    },
    [clearPendingOverviewLayerSelectionTimer],
  );
  useEffect(
    () => clearPendingOverviewLayerSelectionTimer,
    [clearPendingOverviewLayerSelectionTimer],
  );
  const [lockedLayerIds, setLockedLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const layerStateOverridesRef = useRef<
    Map<string, { hidden?: boolean; locked?: boolean }>
  >(new Map());
  const [overviewSelectAllRequest, setOverviewSelectAllRequest] = useState(0);
  const [overviewClearSelectionRequest, setOverviewClearSelectionRequest] =
    useState(0);
  const [hasCanvasClipboard, setHasCanvasClipboard] = useState(false);
  const [hasPropsClipboard, setHasPropsClipboard] = useState(false);
  const copiedLayerEntriesRef = useRef<CanvasLayerClipboardEntry[]>([]);
  const copiedLayerHtmlRef = useRef<string | null>(null);
  // Cascade offset for repeated keyboard pastes so successive clones don't stack
  // pixel-perfectly on top of each other. Reset on each fresh copy/cut.
  const pasteCascadeRef = useRef(0);
  const copiedStylePropsRef = useRef<Record<string, string> | null>(null);
  const spaceHandPreviousToolRef = useRef<DesignTool | null>(null);
  const hasSelectedElement = Boolean(selectedElement);

  // ── Motion dock state (§6.3) ────────────────────────────────────────────────
  // The MotionDock is mounted below the canvas and shown when motionDockOpen.
  // Tracks and durationMs are local state; edits autosave via applyMotionEdit.
  const [motionDockOpen, setMotionDockOpen] = useState(false);
  const [motionDockMounted, setMotionDockMounted] = useState(false);
  const motionDockUnmountTimerRef = useRef<number | null>(null);
  const [motionTimelineId, setMotionTimelineId] = useState<string | null>(null);
  const [motionTracks, setMotionTracks] = useState<MotionDockTrack[]>([]);
  const [motionDurationMs, setMotionDurationMs] = useState(1000);
  const [motionPlayhead, setMotionPlayhead] = useState(0);
  const [motionAutoKeyframeEnabled, setMotionAutoKeyframeEnabled] =
    useState(false);
  const [motionTracksDirty, setMotionTracksDirty] = useState(false);
  const [motionAutosaveRevision, setMotionAutosaveRevision] = useState(0);
  const [motionHydrationFingerprint, setMotionHydrationFingerprint] = useState<
    string | null
  >(null);
  const motionAutosaveRevisionRef = useRef(0);
  const motionAutosaveFailedRevisionRef = useRef<number | null>(null);
  const motionAutosaveTimerRef = useRef<number | null>(null);
  const lastScheduledMotionAutosaveRevisionRef = useRef(0);
  const previousMotionFileIdRef = useRef<string | null>(null);
  const clearMotionDockUnmountTimer = useCallback(() => {
    if (motionDockUnmountTimerRef.current === null) return;
    window.clearTimeout(motionDockUnmountTimerRef.current);
    motionDockUnmountTimerRef.current = null;
  }, []);
  const clearMotionAutosaveTimer = useCallback(() => {
    if (motionAutosaveTimerRef.current === null) return;
    window.clearTimeout(motionAutosaveTimerRef.current);
    motionAutosaveTimerRef.current = null;
  }, []);
  const setMotionDockOpenAnimated = useCallback(
    (open: boolean) => {
      clearMotionDockUnmountTimer();
      if (open) {
        setMotionDockMounted(true);
        if (typeof window === "undefined") {
          setMotionDockOpen(true);
          return;
        }
        window.requestAnimationFrame(() => setMotionDockOpen(true));
        return;
      }

      setMotionDockOpen(false);
      if (typeof window === "undefined") {
        setMotionDockMounted(false);
        return;
      }
      motionDockUnmountTimerRef.current = window.setTimeout(() => {
        setMotionDockMounted(false);
        motionDockUnmountTimerRef.current = null;
      }, MOTION_DOCK_EXIT_FALLBACK_MS);
    },
    [clearMotionDockUnmountTimer],
  );
  const handleMotionDockExitComplete = useCallback(() => {
    if (motionDockOpen) return;
    clearMotionDockUnmountTimer();
    if (typeof window === "undefined") {
      setMotionDockMounted(false);
      return;
    }
    motionDockUnmountTimerRef.current = window.setTimeout(() => {
      setMotionDockMounted(false);
      motionDockUnmountTimerRef.current = null;
    }, MOTION_DOCK_EXIT_SETTLE_MS);
  }, [clearMotionDockUnmountTimer, motionDockOpen]);
  useEffect(
    () => () => clearMotionDockUnmountTimer(),
    [clearMotionDockUnmountTimer],
  );
  useEffect(() => () => clearMotionAutosaveTimer(), [clearMotionAutosaveTimer]);
  const [shaderFillPreview, setShaderFillPreview] = useState<{
    selector?: string;
    nodeId?: string;
    css: string;
  } | null>(null);
  const clearShaderFillPreview = useCallback(() => {
    setShaderFillPreview(null);
    postShaderFillPreviewClearToPreviewIframes();
  }, []);

  // ── Breakpoint preview state (§6.4) ─────────────────────────────────────────
  // Active breakpoint width for the current design (pixels). Controls which
  // side-by-side frame is focused. undefined = no frame selected (overview mode).
  const [activeBreakpointWidthState, setActiveBreakpointWidthState] = useState<
    number | undefined
  >(undefined);

  // ── Design state selection (§6.4 / §8) ───────────────────────────────────────
  // null = Default (live) view; a string id = one of the design_state rows.
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [reviewFileId, setReviewFileId] = useState<string | null>(null);
  const [reviewFindings, setReviewFindings] = useState<A11yFinding[]>([]);
  const [reviewAuditLoading, setReviewAuditLoading] = useState(false);
  const [reviewAuditedAt, setReviewAuditedAt] = useState<string | null>(null);
  const [reviewAuditError, setReviewAuditError] = useState<string | null>(null);

  useEffect(() => {
    if (!isBuilderDesignEmbed) return;
    // Announce ready to Builder. The trusted origin is not yet known at this
    // point so we use "*" — this message carries no user data.
    window.parent.postMessage({ type: "agentNative.appReady" }, "*");

    function handleDesignHostMessage(event: MessageEvent) {
      // Only accept messages from builder.io origins
      const origin = event.origin ?? "";
      try {
        const hostname = new URL(origin).hostname.toLowerCase();
        const trusted =
          hostname === "builder.io" ||
          hostname.endsWith(".builder.io") ||
          hostname === "builder.my" ||
          hostname.endsWith(".builder.my") ||
          hostname === "localhost" ||
          hostname === "127.0.0.1";
        if (!trusted) return;
      } catch {
        return;
      }

      const data = event.data;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "design:init") {
        // Capture the trusted parent origin on the first validated message so
        // outgoing postMessage calls that carry user data can restrict the
        // target instead of broadcasting to "*".
        if (!parentOriginRef.current) {
          parentOriginRef.current = origin;
        }
        const { previewUrl, themeVars } = data.data ?? {};
        // Apply theme vars
        if (themeVars && typeof themeVars === "object") {
          const root = document.documentElement;
          for (const [key, value] of Object.entries(
            themeVars as Record<string, string>,
          )) {
            if (typeof value === "string") {
              root.style.setProperty(key, value);
            }
          }
        }
        if (typeof previewUrl === "string" && previewUrl) {
          setBuilderPreviewUrl(previewUrl);
        }
      }
    }

    window.addEventListener("message", handleDesignHostMessage);
    return () => window.removeEventListener("message", handleDesignHostMessage);
  }, [isBuilderDesignEmbed]);

  const focusDesignInspectorForSelection = useCallback(() => {
    setActiveInspectorTab("design");
  }, []);

  useEffect(() => {
    if (hasSelectedElement) focusDesignInspectorForSelection();
  }, [focusDesignInspectorForSelection, hasSelectedElement]);

  useEffect(() => {
    if (hasSelectedElement) return;
    setActiveInspectorTab("tweaks");
  }, [hasSelectedElement]);

  const startSidebarResize = useCallback(
    (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      const startWidth = side === "left" ? leftSidebarWidth : rightSidebarWidth;
      const setWidth =
        side === "left" ? setLeftSidebarWidth : setRightSidebarWidth;
      const minWidth = side === "left" ? 220 : 240;
      const maxWidth = side === "left" ? 420 : 390;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      const dragShield = document.createElement("div");
      dragShield.setAttribute("data-design-sidebar-resize-shield", side);
      dragShield.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;cursor:col-resize;background:transparent;pointer-events:auto;";
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.appendChild(dragShield);

      const handleMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const delta =
          side === "left"
            ? moveEvent.clientX - startX
            : startX - moveEvent.clientX;
        const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
        setWidth(next);
      };
      const cleanup = () => {
        dragShield.removeEventListener("pointermove", handleMove);
        dragShield.removeEventListener("pointerup", cleanup);
        dragShield.removeEventListener("pointercancel", cleanup);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        dragShield.remove();
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
      };

      dragShield.addEventListener("pointermove", handleMove);
      dragShield.addEventListener("pointerup", cleanup);
      dragShield.addEventListener("pointercancel", cleanup);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [leftSidebarWidth, rightSidebarWidth],
  );
  // Undo/redo state driven by Y.UndoManager
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const contentUndoStackRef = useRef<ContentHistoryEntry[]>([]);
  const contentRedoStackRef = useRef<ContentHistoryEntry[]>([]);
  const localContentUndoStackRef = useRef<ContentHistoryChange[]>([]);
  const localContentRedoStackRef = useRef<ContentHistoryChange[]>([]);
  const activeFileIdForUndoRef = useRef<string | null>(null);
  const suppressContentHistoryRef = useRef(false);
  const geometryUndoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const geometryRedoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const historyOrderRef = useRef<UndoRedoOrderKind[]>([]);
  const redoOrderRef = useRef<UndoRedoOrderKind[]>([]);
  const clearRedoStacks = useCallback(() => {
    contentRedoStackRef.current = [];
    localContentRedoStackRef.current = [];
    geometryRedoStackRef.current = [];
    redoOrderRef.current = [];
    undoManagerRef.current?.clear(false, true);
  }, []);
  const syncUndoRedoState = useCallback(() => {
    const undoManager = undoManagerRef.current;
    const canUseOverviewHistory = viewModeRef.current === "overview";
    const activeHistoryFileId = activeFileIdForUndoRef.current;
    const hasLocalUndo =
      !canUseOverviewHistory &&
      findLastContentHistoryChangeIndex(
        localContentUndoStackRef.current,
        activeHistoryFileId,
      ) !== -1;
    const hasLocalRedo =
      !canUseOverviewHistory &&
      findLastContentHistoryChangeIndex(
        localContentRedoStackRef.current,
        activeHistoryFileId,
      ) !== -1;
    setCanUndo(
      Boolean(undoManager?.canUndo()) ||
        hasLocalUndo ||
        (canUseOverviewHistory &&
          (contentUndoStackRef.current.length > 0 ||
            geometryUndoStackRef.current.length > 0)),
    );
    setCanRedo(
      Boolean(undoManager?.canRedo()) ||
        hasLocalRedo ||
        (canUseOverviewHistory &&
          (contentRedoStackRef.current.length > 0 ||
            geometryRedoStackRef.current.length > 0)),
    );
  }, []);
  const recordContentHistoryEntry = useCallback(
    (entry: ContentHistoryEntry) => {
      const changes = getContentHistoryChanges(entry).filter(
        (change) => change.before !== change.after,
      );
      if (changes.length === 0) return;
      const activeHistoryFileId = activeFileIdForUndoRef.current;
      if (
        activeHistoryFileId &&
        changes.some((change) => change.fileId === activeHistoryFileId)
      ) {
        undoManagerRef.current?.clear(true, false);
        localContentUndoStackRef.current =
          localContentUndoStackRef.current.filter(
            (change) => change.fileId !== activeHistoryFileId,
          );
        localContentRedoStackRef.current =
          localContentRedoStackRef.current.filter(
            (change) => change.fileId !== activeHistoryFileId,
          );
        historyOrderRef.current = removeUndoRedoOrderKind(
          historyOrderRef.current,
          "content",
        );
        redoOrderRef.current = removeUndoRedoOrderKind(
          redoOrderRef.current,
          "content",
        );
      }
      contentUndoStackRef.current = [
        ...contentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        changes.length === 1 ? changes[0] : { changes },
      ];
      clearRedoStacks();
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-content",
      ];
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  const recordLocalContentHistoryEntry = useCallback(
    (change: ContentHistoryChange) => {
      if (change.before === change.after) return;
      localContentUndoStackRef.current = [
        ...localContentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        change,
      ];
      clearRedoStacks();
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  const clearLocalUndoRedoStacks = useCallback(() => {
    contentUndoStackRef.current = [];
    contentRedoStackRef.current = [];
    localContentUndoStackRef.current = [];
    localContentRedoStackRef.current = [];
    geometryUndoStackRef.current = [];
    geometryRedoStackRef.current = [];
    historyOrderRef.current = [];
    redoOrderRef.current = [];
  }, []);
  const persistedSelectionStateRef = useRef<string | null>(null);
  const designSelectionOwnerIdRef = useRef(`${TAB_ID}:${generateTabId()}`);
  const frameGeometrySaveTimerRef = useRef<number | null>(null);
  const [tweakSaveActive, setTweakSaveActive] = useState(false);
  // Localhost write-consent dialog state. When the agent wants to write a local
  // file and no valid grant exists for the active connection, we show the dialog
  // with a pending payload; the user clicks "Allow writes" to mint a grant.
  const [localhostWriteConsentOpen, setLocalhostWriteConsentOpen] =
    useState(false);
  const [localhostWriteConsentPayload, setLocalhostWriteConsentPayload] =
    useState<LocalhostWriteConsentPayload | null>(null);
  // Active localhost connection id for the consent dialog.
  const [localhostConsentConnectionId, setLocalhostConsentConnectionId] =
    useState<string>("");
  // Tracks whether an "Apply to source" write is in progress.
  const [applyToSourcePending, setApplyToSourcePending] = useState(false);
  // Shared visual-editor annotate overlays. drawMode owns the send toolbar,
  // while pinMode temporarily routes canvas clicks to comment pins that queue
  // into the same agent submission.
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTweakPrompt, setShowTweakPrompt] = useState(false);
  const [pngExporting, setPngExporting] = useState(false);
  const [svgExporting, setSvgExporting] = useState(false);
  const pngExportingRef = useRef(false);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const promptAnchorRef = useRef<HTMLElement | null>(null);
  const tweakPromptAnchorRef = useRef<HTMLElement | null>(null);
  promptAnchorRef.current = generateBtnRef.current;

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "overview" || overviewSelectedScreenIds.length === 0) {
      return;
    }
    lastOverviewSelectedScreenIdsRef.current = [...overviewSelectedScreenIds];
  }, [overviewSelectedScreenIds, viewMode]);
  const [hasPendingGeneration, setHasPendingGeneration] = useState(() =>
    hasFreshPendingGeneration(id),
  );
  const [generationChatTabId, setGenerationChatTabId] = useState<string | null>(
    null,
  );
  const [generationIssue, setGenerationIssue] = useState<string | null>(null);
  const [promptDesignSystemId, setPromptDesignSystemId] = useState<
    string | null | undefined
  >(undefined);

  useEffect(() => {
    return () => {
      void (async () => {
        const keys = designSelectionStateKeys();
        const current = await readClientAppState(keys[0]).catch(() => null);
        const ownerId =
          current && typeof current === "object"
            ? (current as { ownerId?: unknown }).ownerId
            : undefined;
        if (ownerId !== designSelectionOwnerIdRef.current) return;
        persistedSelectionStateRef.current = null;
        for (const key of designSelectionStateKeys()) {
          await setClientAppState(key, null, {
            keepalive: true,
          }).catch(() => {});
        }
      })();
    };
  }, []);
  // When generation stalls we keep the original prompt + files around so the
  // user can retry with one click instead of re-typing. Cleared as soon as the
  // user kicks off a new run (retry or fresh prompt).
  const [retryablePrompt, setRetryablePrompt] = useState<{
    prompt: string;
    files: UploadedFile[];
    model?: PromptComposerSubmitOptions["model"];
    engine?: PromptComposerSubmitOptions["engine"];
    effort?: PromptComposerSubmitOptions["effort"];
    designSystemId?: string | null;
    attempt?: number;
  } | null>(null);
  const generationOutputReadyRef = useRef(false);
  const pendingQuestionsVisibleRef = useRef(false);
  const generationRunConfirmedRef = useRef(false);
  const generationCompleteTimerRef = useRef<number | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
  const storedRunLivenessTimerRef = useRef<number | null>(null);
  const clearGenerationCompleteTimer = useCallback(() => {
    if (generationCompleteTimerRef.current !== null) {
      window.clearTimeout(generationCompleteTimerRef.current);
      generationCompleteTimerRef.current = null;
    }
  }, []);
  const clearAutoRetryTimer = useCallback(() => {
    if (autoRetryTimerRef.current !== null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
  }, []);
  const clearStoredRunLivenessTimer = useCallback(() => {
    if (storedRunLivenessTimerRef.current !== null) {
      window.clearTimeout(storedRunLivenessTimerRef.current);
      storedRunLivenessTimerRef.current = null;
    }
  }, []);
  const staleToastShownRef = useRef(false);
  const rememberPendingGenerationForRetry = useCallback(() => {
    const pending = readPendingGeneration(id);
    if (pending?.prompt) {
      setRetryablePrompt({
        prompt: pending.prompt,
        files: Array.isArray(pending.files) ? pending.files : [],
        model: pending.model,
        engine: pending.engine,
        effort: pending.effort,
        designSystemId: pending.designSystemId,
        attempt: pending.attempt ?? 1,
      });
      return true;
    }
    return false;
  }, [id]);
  const markGenerationStale = useCallback(() => {
    clearGenerationCompleteTimer();
    // Capture the original prompt before clearing so the user can retry without
    // re-typing it. The full pending payload (model/engine/effort) is preserved
    // so the retry runs with identical settings.
    rememberPendingGenerationForRetry();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(t("designEditor.generationMayHaveStopped"));
    if (!staleToastShownRef.current) {
      staleToastShownRef.current = true;
      toast.info(t("designEditor.generationMayHaveStoppedToast"));
    }
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const handleGenerationComplete = useCallback(() => {
    clearGenerationCompleteTimer();
    generationCompleteTimerRef.current = window.setTimeout(() => {
      generationCompleteTimerRef.current = null;
      if (pendingQuestionsVisibleRef.current) {
        setHasPendingGeneration(false);
        staleToastShownRef.current = false;
        setGenerationIssue(null);
        return;
      }
      const hasOutput = generationOutputReadyRef.current;
      const preservedForRetry = hasOutput
        ? false
        : rememberPendingGenerationForRetry();
      clearPendingGeneration(id);
      setHasPendingGeneration(false);
      staleToastShownRef.current = false;
      setGenerationIssue(
        hasOutput
          ? null
          : preservedForRetry
            ? t("designEditor.generationStoppedRetry")
            : t("designEditor.generationStoppedCheckAgent"),
      );
    }, 4000);
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const scheduleStoredRunLivenessCheck = useCallback(
    (runTabId: string) => {
      clearStoredRunLivenessTimer();
      generationRunConfirmedRef.current = false;
      storedRunLivenessTimerRef.current = window.setTimeout(() => {
        storedRunLivenessTimerRef.current = null;
        if (generationRunConfirmedRef.current) return;
        if (
          generationOutputReadyRef.current ||
          pendingQuestionsVisibleRef.current
        ) {
          return;
        }
        const pending = readPendingGeneration(id);
        if (!pending || pending.runTabId !== runTabId) return;
        rememberPendingGenerationForRetry();
        clearPendingGeneration(id);
        setHasPendingGeneration(false);
        setGenerationIssue(t("designEditor.generationStoppedRetry"));
      }, STORED_RUN_LIVENESS_GRACE_MS);
    },
    [clearStoredRunLivenessTimer, id, rememberPendingGenerationForRetry, t],
  );
  const {
    generating,
    submit: agentSubmit,
    reset: resetAgentGenerating,
    track: trackAgentGeneration,
  } = useAgentGenerating({
    onComplete: handleGenerationComplete,
    onStale: markGenerationStale,
    shouldAdoptRunningTab: () =>
      Boolean(id) &&
      !generationOutputReadyRef.current &&
      hasFreshPendingGeneration(id),
    onAdoptRunningTab: (tabId) => {
      generationRunConfirmedRef.current = true;
      setGenerationChatTabId(tabId);
      setHasPendingGeneration(true);
    },
    onRunning: () => {
      generationRunConfirmedRef.current = true;
      clearStoredRunLivenessTimer();
    },
  });
  const handleQuestionFlowContinue = useCallback(
    (runTabId: string) => {
      clearGenerationCompleteTimer();
      setGenerationIssue(null);
      setRetryablePrompt(null);
      setGenerationChatTabId(runTabId);
      const pending = readPendingGeneration(id, { allowUntimestamped: true });
      patchPendingGeneration(id, {
        prompt: pending?.prompt ?? "Continue from answered design questions.",
        files: pending?.files ?? [],
        title: pending?.title,
        designSystemId: pending?.designSystemId,
        model: pending?.model,
        engine: pending?.engine,
        effort: pending?.effort,
        runTabId,
        attempt: pending?.attempt ?? 1,
        startedAt: Date.now(),
      });
      setHasPendingGeneration(true);
      trackAgentGeneration(runTabId);
    },
    [clearGenerationCompleteTimer, id, trackAgentGeneration],
  );

  // Question flow — full-canvas overlays driven by the agent.
  const {
    questions: pendingQuestions,
    title: pendingQuestionsTitle,
    description: pendingQuestionsDescription,
    skipLabel: pendingQuestionsSkipLabel,
    submitLabel: pendingQuestionsSubmitLabel,
    handleSubmit: handleQuestionsSubmit,
    handleSkip: handleQuestionsSkip,
  } = useQuestionFlow(id, {
    continuationTabId: generationChatTabId,
    onContinue: handleQuestionFlowContinue,
  });
  const pendingQuestionsVisible = Boolean(
    pendingQuestions && pendingQuestions.length > 0,
  );

  const { session, isLoading: sessionLoading } = useSession();
  const isSignedIn = Boolean(session?.email);
  const sessionResolved = !sessionLoading;

  useEffect(() => {
    return () => clearGenerationCompleteTimer();
  }, [clearGenerationCompleteTimer]);
  useEffect(() => {
    return () => clearAutoRetryTimer();
  }, [clearAutoRetryTimer]);
  useEffect(() => {
    return () => clearStoredRunLivenessTimer();
  }, [clearStoredRunLivenessTimer]);
  useEffect(() => {
    pendingQuestionsVisibleRef.current = pendingQuestionsVisible;
    if (!pendingQuestionsVisible || !hasPendingGeneration || generating) return;
    clearGenerationCompleteTimer();
    clearStoredRunLivenessTimer();
    setHasPendingGeneration(false);
    setGenerationIssue(null);
  }, [
    clearGenerationCompleteTimer,
    clearStoredRunLivenessTimer,
    generating,
    hasPendingGeneration,
    pendingQuestionsVisible,
  ]);

  // Current user info for collaborative presence
  const currentUser: CollabUser | undefined = useMemo(
    () =>
      session?.email
        ? {
            name: session.name?.trim() || emailToName(session.email),
            email: session.email,
            color: emailToColor(session.email),
          }
        : undefined,
    [session?.email, session?.name],
  );
  const signInToSaveHref = buildSignInHrefForDesignIntent("save");
  const signInToShareHref = buildSignInHrefForDesignIntent("share");
  const handleSignInToSave = useCallback(() => {
    window.location.href = buildSignInHrefForDesignIntent("save");
  }, []);

  // Data fetching
  useEffect(() => {
    if (!id) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }
    setHasPendingGeneration(true);
    if (pending.runTabId) {
      setGenerationChatTabId(pending.runTabId);
      trackAgentGeneration(pending.runTabId);
      scheduleStoredRunLivenessCheck(pending.runTabId);
    }
  }, [
    id,
    markGenerationStale,
    scheduleStoredRunLivenessCheck,
    trackAgentGeneration,
  ]);

  const pendingGenerationActive =
    hasPendingGeneration &&
    !!readPendingGeneration(id) &&
    !pendingQuestionsVisible;

  const { data: designResult, isLoading: designLoading } = useActionQuery<
    DesignData | string
  >(
    "get-design",
    { id: id! },
    {
      refetchInterval: pendingGenerationActive || generating ? 1000 : false,
    },
  );

  const design = isDesignData(designResult) ? designResult : null;
  const designAccessRole = design?.accessRole;
  const canShareDesign =
    designAccessRole === "owner" || designAccessRole === "admin";
  const canEditDesign = canShareDesign || designAccessRole === "editor";
  const canRenderAuthenticatedShare = isSignedIn || canEditDesign;
  const canEditDesignRef = useRef(canEditDesign);
  const pendingLocalFileContentsRef = useRef<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >(new Map());
  const [
    pendingLocalFileContentsRevision,
    setPendingLocalFileContentsRevision,
  ] = useState(0);

  const markPendingLocalFileContent = useCallback(
    (fileId: string, content: string, baseUpdatedAt?: string | null) => {
      const current = pendingLocalFileContentsRef.current.get(fileId);
      if (current?.content === content) {
        if (
          baseUpdatedAt !== undefined &&
          current.baseUpdatedAt === undefined
        ) {
          pendingLocalFileContentsRef.current.set(fileId, {
            ...current,
            baseUpdatedAt,
          });
          setPendingLocalFileContentsRevision((revision) => revision + 1);
        }
        return;
      }
      pendingLocalFileContentsRef.current.set(fileId, {
        content,
        startedAt: Date.now(),
        baseUpdatedAt,
      });
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    },
    [],
  );

  const clearPendingLocalFileContent = useCallback(
    (fileId: string, expectedContent?: string) => {
      const current = pendingLocalFileContentsRef.current.get(fileId);
      if (!current) return;
      if (
        expectedContent !== undefined &&
        current.content !== expectedContent
      ) {
        return;
      }
      pendingLocalFileContentsRef.current.delete(fileId);
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    },
    [],
  );

  useEffect(() => {
    canEditDesignRef.current = canEditDesign;
  }, [canEditDesign]);

  useEffect(() => {
    if (!id || !hasPendingGeneration) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }

    const timestamp = pending.startedAt ?? pending.createdAt ?? Date.now();
    const remaining = Math.max(
      0,
      PENDING_GENERATION_STALE_MS - (Date.now() - timestamp),
    );
    const timer = window.setTimeout(() => {
      const latest = readPendingGeneration(id);
      if (isPendingGenerationStale(latest)) {
        markGenerationStale();
      }
    }, remaining + 250);

    return () => window.clearTimeout(timer);
  }, [id, hasPendingGeneration, markGenerationStale]);

  const updateFileMutation = useActionMutation("update-file");
  const createFileMutation = useActionMutation("create-file");
  const deleteFileMutation = useActionMutation("delete-file");
  const updateDesignMutation = useActionMutation("update-design");
  const applyTweaksMutation = useActionMutation("apply-tweaks");
  const duplicateDesignMutation = useActionMutation("duplicate-design");
  const exportHtmlMutation = useActionMutation("export-html");
  const exportZipMutation = useActionMutation("export-zip");
  const applyMotionEditMutation = useActionMutation("apply-motion-edit");
  const applyMotionEdit = applyMotionEditMutation.mutate;
  const motionAutosavePending = applyMotionEditMutation.isPending;
  // §6.4 breakpoint mutations — wired to MultiScreenCanvas + affordance
  const addBreakpointMutation = useActionMutation("add-breakpoint");
  const setActiveBreakpointMutation = useActionMutation(
    "set-active-breakpoint",
  );

  // §6.1 — promote a selection into a reusable component instance.
  const createComponentMutation = useActionMutation("create-component");
  // §6.1 — jump to a component instance's source (selects the root + navigates).
  const openComponentSourceMutation = useActionMutation(
    "open-component-source",
  );

  // Board file migration — lazy, idempotent, triggers on design open when
  // designs.data.boardFileId is absent.
  const migrateBoardObjectsMutation = useActionMutation(
    "migrate-board-objects-to-file",
  );

  // §6.6 — "Make it real" migration flow (migrate-inline-design-to-app).
  // The mutation stays unconditional; the dialog gates on isSignedIn.
  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  // Dialog open/close state for the "Make this a real app" flow.
  const [makeRealDialogOpen, setMakeRealDialogOpen] = useState(false);
  const [publishWaitlistPopoverOpen, setPublishWaitlistPopoverOpen] =
    useState(false);
  const [publishWaitlistPopoverView, setPublishWaitlistPopoverView] = useState<
    "actions" | "waitlist"
  >("actions");
  const [publishWaitlistJoined, setPublishWaitlistJoined] = useState(false);
  const [joiningPublishWaitlist, setJoiningPublishWaitlist] = useState(false);
  const [publishWaitlistError, setPublishWaitlistError] = useState<
    string | null
  >(null);

  // Result payload returned by migrate-inline-design-to-app on success.
  // `null` = not yet migrated; populated once the Builder agent accepts the job.
  const [migrationResult, setMigrationResult] = useState<{
    branchName?: string;
    url?: string;
    versionId?: string;
    seedFileCount?: number;
    status?: string;
    projectId?: string;
    cta?: {
      kind: string;
      label: string;
      description: string;
      connectUrl?: string;
      primaryAction: string;
    };
  } | null>(null);

  const [shareExportFormat, setShareExportFormat] =
    useState<ShareExportFormat>("html");
  const [codingHandoffResult, setCodingHandoffResult] =
    useState<CodingHandoffResult | null>(null);
  const [codingHandoffError, setCodingHandoffError] = useState<string | null>(
    null,
  );
  const [codingHandoffLoading, setCodingHandoffLoading] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const shareLinkCopiedResetRef = useRef<number | null>(null);
  const [, setPatchProof] = useState<PatchProofState | null>(null);
  const pendingFileSavesRef = useRef<Record<string, FileContentSaveRequest>>(
    {},
  );
  const fileSaveChainsRef = useRef<Record<string, Promise<void>>>({});
  const latestFileSaveForUnloadRef = useRef<
    Record<string, FileContentSaveRequest>
  >({});
  const fileSaveTimersRef = useRef<Record<string, number>>({});
  const postAuthSaveRef = useRef<string | null>(null);

  const cancelQueuedFileContentSave = useCallback((fileId: string) => {
    const timer = fileSaveTimersRef.current[fileId];
    if (timer) {
      window.clearTimeout(timer);
      delete fileSaveTimersRef.current[fileId];
    }
    delete pendingFileSavesRef.current[fileId];
    delete latestFileSaveForUnloadRef.current[fileId];
  }, []);

  const saveFileContent = useCallback(
    (pending: FileContentSaveRequest) => {
      if (!canEditDesignRef.current) return;
      markPendingLocalFileContent(pending.id, pending.content);
      latestFileSaveForUnloadRef.current[pending.id] = pending;
      const previous =
        fileSaveChainsRef.current[pending.id] ?? Promise.resolve();
      const current = previous
        .catch(() => {})
        .then(async () => {
          try {
            await updateFileMutation.mutateAsync({
              id: pending.id,
              content: pending.content,
              syncCollab: pending.syncCollab,
            } as any);
            setPatchProof((prev) =>
              prev && prev.fileId === pending.id && prev.status === "queued"
                ? { ...prev, status: "applied" }
                : prev,
            );
          } catch (error) {
            clearPendingLocalFileContent(pending.id, pending.content);
            setPatchProof((prev) =>
              prev && prev.fileId === pending.id && prev.status === "queued"
                ? {
                    ...prev,
                    status: "failed",
                    error:
                      error instanceof Error
                        ? error.message
                        : t("common.genericError"),
                  }
                : prev,
            );
          }
        });
      fileSaveChainsRef.current[pending.id] = current;
      void current.finally(() => {
        if (fileSaveChainsRef.current[pending.id] === current) {
          delete fileSaveChainsRef.current[pending.id];
        }
      });
    },
    [
      clearPendingLocalFileContent,
      markPendingLocalFileContent,
      t,
      updateFileMutation,
    ],
  );

  const queueFileContentSave = useCallback(
    (
      fileId: string,
      content: string,
      options: { syncCollab?: boolean; immediate?: boolean } = {},
    ) => {
      if (!canEditDesignRef.current) return;
      const pending = {
        id: fileId,
        content,
        syncCollab: options.syncCollab ?? true,
      };
      markPendingLocalFileContent(fileId, content);
      latestFileSaveForUnloadRef.current[fileId] = pending;
      if (options.immediate) {
        const timer = fileSaveTimersRef.current[fileId];
        if (timer) {
          window.clearTimeout(timer);
          delete fileSaveTimersRef.current[fileId];
        }
        delete pendingFileSavesRef.current[fileId];
        saveFileContent(pending);
        return;
      }
      pendingFileSavesRef.current[fileId] = pending;
      const timer = fileSaveTimersRef.current[fileId];
      if (timer) {
        window.clearTimeout(timer);
      }
      fileSaveTimersRef.current[fileId] = window.setTimeout(() => {
        const pending = pendingFileSavesRef.current[fileId];
        delete pendingFileSavesRef.current[fileId];
        delete fileSaveTimersRef.current[fileId];
        if (!pending) return;
        saveFileContent(pending);
      }, 400);
    },
    [markPendingLocalFileContent, saveFileContent],
  );

  useEffect(() => {
    const sendPendingKeepaliveSaves = () => {
      if (!canEditDesignRef.current) return;
      for (const pending of Object.values(pendingFileSavesRef.current)) {
        latestFileSaveForUnloadRef.current[pending.id] = pending;
      }
      Object.values(latestFileSaveForUnloadRef.current).forEach(
        sendFileContentSaveKeepalive,
      );
    };
    const handlePageHide = () => {
      sendPendingKeepaliveSaves();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      sendPendingKeepaliveSaves();
      for (const timer of Object.values(fileSaveTimersRef.current)) {
        window.clearTimeout(timer);
      }
      fileSaveTimersRef.current = {};
      pendingFileSavesRef.current = {};
    };
  }, []);

  // Debounced persistence of the user's live tweak knob values into
  // designs.data.tweakSelections (additive JSON merge, server-side). This is
  // what makes the visual-tune survive reload and feeds the snapshot/handoff
  // round-trip so external agents continue from the *tuned* design.
  const pendingTweakSaveRef = useRef<{
    selections: TweakSelections;
    revision: number;
  } | null>(null);
  const tweakSaveTimerRef = useRef<number | null>(null);
  const tweakSaveRevisionRef = useRef(0);
  const queueTweakSave = useCallback(
    (selections: TweakSelections) => {
      if (!id || !canEditDesignRef.current) return;
      const revision = tweakSaveRevisionRef.current + 1;
      tweakSaveRevisionRef.current = revision;
      setTweakSaveActive(true);
      pendingTweakSaveRef.current = { selections, revision };
      if (tweakSaveTimerRef.current) {
        window.clearTimeout(tweakSaveTimerRef.current);
      }
      tweakSaveTimerRef.current = window.setTimeout(() => {
        const pending = pendingTweakSaveRef.current;
        pendingTweakSaveRef.current = null;
        tweakSaveTimerRef.current = null;
        if (!pending) return;
        applyTweaksMutation.mutate(
          {
            designId: id,
            selections: pending.selections,
          } as any,
          {
            onSettled: () => {
              if (tweakSaveRevisionRef.current === pending.revision) {
                setTweakSaveActive(false);
              }
            },
          },
        );
      }, 600);
    },
    [id, applyTweaksMutation],
  );

  useEffect(() => {
    return () => {
      if (tweakSaveTimerRef.current) {
        window.clearTimeout(tweakSaveTimerRef.current);
      }
    };
  }, []);

  const shouldOpenShare = postAuthIntent === "share" && canShareDesign;
  const editorShareUrl = useMemo(() => {
    if (!id || typeof window === "undefined") return undefined;
    return getDesignEditorShareUrl(id, window.location.origin, appBasePath());
  }, [id]);
  useEffect(() => {
    return () => {
      if (shareLinkCopiedResetRef.current !== null) {
        window.clearTimeout(shareLinkCopiedResetRef.current);
      }
    };
  }, []);
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems();

  useEffect(() => {
    if (!id || !design || !isSignedIn || !postAuthIntent) return;

    const shouldDuplicate =
      postAuthIntent === "share" ? !canShareDesign : !canEditDesign;
    if (!shouldDuplicate) return;

    const key = `${postAuthIntent}:${id}`;
    if (postAuthSaveRef.current === key) return;
    postAuthSaveRef.current = key;

    duplicateDesignMutation
      .mutateAsync({ id, title: design.title } as any)
      .then((result: any) => {
        if (!result?.id) throw new Error("Missing copied design id");
        const nextSearch = postAuthIntent === "share" ? "?intent=share" : "";
        navigate(`/design/${result.id}${nextSearch}`, { replace: true });
      })
      .catch(() => {
        postAuthSaveRef.current = null;
        toast.error(t("designEditor.toasts.saveCopyError"));
      });
  }, [
    canEditDesign,
    canShareDesign,
    design,
    duplicateDesignMutation,
    id,
    isSignedIn,
    navigate,
    postAuthIntent,
    t,
  ]);

  const resolvePromptDesignSystemId = useCallback(
    () =>
      design?.designSystemId ??
      defaultSystem?.id ??
      designSystems[0]?.id ??
      null,
    [defaultSystem?.id, design?.designSystemId, designSystems],
  );

  const selectedPromptDesignSystemId =
    promptDesignSystemId === undefined
      ? resolvePromptDesignSystemId()
      : promptDesignSystemId;

  const handlePromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && !canEditDesign) return;
      setShowPrompt(open);
      if (open) {
        setPromptDesignSystemId(resolvePromptDesignSystemId());
      } else {
        setPromptDesignSystemId(undefined);
      }
    },
    [canEditDesign, resolvePromptDesignSystemId],
  );

  const handleTweakPromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && !canEditDesign) return;
      setShowTweakPrompt(open);
      if (!open) {
        tweakPromptAnchorRef.current = null;
      }
    },
    [canEditDesign],
  );

  const handleRequestTweaks = useCallback(
    (anchor: HTMLElement) => {
      if (!canEditDesign) return;
      tweakPromptAnchorRef.current = anchor;
      setActiveInspectorTab("tweaks");
      setShowTweakPrompt(true);
    },
    [canEditDesign],
  );

  const persistPromptDesignSystem = useCallback(
    (designSystemId: string | null) => {
      if (!id || !canEditDesign || design?.designSystemId === designSystemId) {
        return;
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, designSystemId };
      });
      updateDesignMutation.mutate({ id, designSystemId } as any, {
        onError: () => {
          queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
        },
      });
    },
    [
      canEditDesign,
      design?.designSystemId,
      id,
      queryClient,
      updateDesignMutation,
    ],
  );

  useEffect(() => {
    if (!design?.title) return;
    const nextTitle = `${design.title} — Design`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) {
        document.title = previousTitle;
      }
    };
  }, [design?.title]);

  const commitTitleEdit = useCallback(() => {
    setTitleEditing(false);
    if (!id || !canEditDesign) return;
    const next = titleDraft.trim();
    if (!next || next === design?.title) return;

    const designQueryKey = ["action", "get-design", { id }];
    const previousDesign = queryClient.getQueryData(designQueryKey);
    const previousListDesignsQueries = queryClient.getQueriesData({
      queryKey: ["action", "list-designs"],
    });
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object") return old;
      return { ...old, title: next };
    });
    queryClient.setQueriesData(
      { queryKey: ["action", "list-designs"] },
      (old: any) => {
        if (!old) return old;
        return {
          ...old,
          designs: (old.designs ?? []).map((d: any) =>
            d.id === id ? { ...d, title: next } : d,
          ),
        };
      },
    );

    updateDesignMutation.mutate({ id, title: next } as any, {
      onError: () => {
        queryClient.setQueryData(designQueryKey, previousDesign);
        for (const [queryKey, data] of previousListDesignsQueries) {
          queryClient.setQueryData(queryKey, data);
        }
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
        queryClient.invalidateQueries({ queryKey: ["action", "list-designs"] });
      },
    });
  }, [
    canEditDesign,
    design?.title,
    id,
    queryClient,
    titleDraft,
    updateDesignMutation,
  ]);

  const serverFiles = design?.files ?? [];
  useEffect(() => {
    if (pendingLocalFileContentsRef.current.size === 0) return;
    let changed = false;
    for (const file of serverFiles) {
      const pending = pendingLocalFileContentsRef.current.get(file.id);
      if (pending && (file.content ?? "") === pending.content) {
        if (
          pending.baseUpdatedAt !== undefined &&
          file.updatedAt === pending.baseUpdatedAt
        ) {
          continue;
        }
        pendingLocalFileContentsRef.current.delete(file.id);
        changed = true;
      }
    }
    if (changed) {
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    }
  }, [serverFiles]);
  const pendingLocalFileContentsSnapshot = useMemo(
    () => new Map(pendingLocalFileContentsRef.current),
    [pendingLocalFileContentsRevision],
  );
  const files = useMemo(() => {
    if (pendingLocalFileContentsSnapshot.size === 0) return serverFiles;
    return serverFiles.map((file) => {
      const pending = pendingLocalFileContentsSnapshot.get(file.id);
      return pending ? { ...file, content: pending.content } : file;
    });
  }, [pendingLocalFileContentsSnapshot, serverFiles]);
  const [liveScreenSnapshotsById, setLiveScreenSnapshotsById] = useState<
    Record<string, LiveScreenSnapshot>
  >({});
  useEffect(() => {
    const liveFileIds = new Set(serverFiles.map((file) => file.id));
    setLiveScreenSnapshotsById((current) => {
      let changed = false;
      const next: Record<string, LiveScreenSnapshot> = {};
      Object.entries(current).forEach(([fileId, snapshot]) => {
        if (!liveFileIds.has(fileId)) {
          changed = true;
          return;
        }
        next[fileId] = snapshot;
      });
      return changed ? next : current;
    });
  }, [serverFiles]);
  const designDataJson = useMemo(
    () => parseDesignDataJson(design?.data),
    [design?.data],
  );
  // Keep a ref in sync so debounced timer callbacks can read the freshest
  // designDataJson without closing over a stale snapshot from render time.
  const designDataJsonRef = useRef(designDataJson);
  useEffect(() => {
    designDataJsonRef.current = designDataJson;
  }, [designDataJson]);
  const canvasFrameGeometryById = useMemo(
    () => getCanvasFrameGeometry(designDataJson),
    [designDataJson],
  );

  // ── Board file ─────────────────────────────────────────────────────────────
  // The board is a reserved design_file (filename "__board__.html") whose id is
  // stored in designs.data.boardFileId.  On design open, if boardFileId is absent,
  // we trigger migrate-board-objects-to-file (lazy + idempotent) which creates
  // the board file and migrates any legacy boardObjects.
  const boardFileId = useMemo(() => {
    const raw = (designDataJson as Record<string, unknown>).boardFileId;
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }, [designDataJson]);

  // Trigger migration on design open when boardFileId is absent.
  const migrateBoardTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !canEditDesign) return;
    if (boardFileId) return; // already migrated
    if (migrateBoardTriggeredRef.current === id) return;
    migrateBoardTriggeredRef.current = id;
    migrateBoardObjectsMutation.mutate({ designId: id } as any, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design", { id }],
        });
      },
    });
  }, [
    boardFileId,
    canEditDesign,
    id,
    migrateBoardObjectsMutation,
    queryClient,
  ]);

  const overviewScreens = useMemo(() => {
    const metadataByFileId = getDesignDataRecord(
      designDataJson,
      "screenMetadata",
    );
    // §6.4 — breakpoint set stored in designs.data.breakpointSet as a
    // BreakpointSet { id, breakpoints: BreakpointDefinition[] }.
    // Each BreakpointDefinition has { id, label, widthPx, prefix }.
    const breakpointSet = (() => {
      try {
        const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
        if (
          raw &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          Array.isArray((raw as Record<string, unknown>).breakpoints)
        ) {
          return raw as {
            id: string;
            breakpoints: Array<{
              id: string;
              widthPx: number;
              label?: string;
              prefix?: string;
            }>;
          };
        }
      } catch {
        // ignore
      }
      return undefined;
    })();
    const bpWidths =
      breakpointSet && breakpointSet.breakpoints.length > 0
        ? breakpointSet.breakpoints.map((bp) => bp.widthPx)
        : undefined;

    // Exclude the board file — it is rendered by its own DesignCanvas instance
    // in MultiScreenCanvas and must not appear as a screen frame.  Support files
    // such as CSS are editable files, not visual screens.
    return files
      .filter(
        (file) =>
          normalizedDesignFileType(file.fileType) === "html" &&
          !isBoardFile(file.filename),
      )
      .map((file) => {
        const metadata = getDesignDataRecord(metadataByFileId, file.id);
        const stringValue = (key: string) =>
          typeof metadata[key] === "string"
            ? (metadata[key] as string)
            : undefined;
        const numberValue = (key: string) =>
          typeof metadata[key] === "number" && Number.isFinite(metadata[key])
            ? (metadata[key] as number)
            : undefined;
        return {
          id: file.id,
          filename: file.filename,
          content: file.content,
          updatedAt: file.updatedAt,
          sourceType: stringValue("sourceType"),
          source: stringValue("source"),
          sourceFile: stringValue("sourceFile"),
          connectionId: stringValue("connectionId"),
          lod: stringValue("lod"),
          previewState: stringValue("previewState"),
          status: stringValue("status"),
          title: stringValue("title"),
          width: numberValue("width"),
          height: numberValue("height"),
          url: stringValue("url"),
          previewUrl: stringValue("previewUrl"),
          bridgeUrl: stringValue("bridgeUrl"),
          // Breakpoint preview widths (§6.4). When non-empty, MultiScreenCanvas
          // renders one iframe per width to the right of the primary frame.
          breakpointWidths: bpWidths,
          // Active breakpoint width tracked in component state; shared across all
          // screens (a design has one active breakpoint set at a time in v1).
          activeBreakpointWidth: bpWidths?.includes(
            activeBreakpointWidthState ?? -1,
          )
            ? activeBreakpointWidthState
            : undefined,
        };
      });
  }, [designDataJson, files, activeBreakpointWidthState, boardFileId]);

  // The board file's current HTML content — sourced from the files array (which
  // includes pending local writes).  undefined when boardFileId is not yet set.
  const boardFileContent = useMemo(() => {
    if (!boardFileId) return undefined;
    const boardFile = files.find((file) => file.id === boardFileId);
    return typeof boardFile?.content === "string" ? boardFile.content : "";
  }, [boardFileId, files]);

  // Logical canvas-space bounding box of the board iframe. The board is an
  // invisible editing layer behind screen frames, not a finite artboard, so keep
  // it at the canvas-safe maximum instead of clipping it to the screen union.
  const boardFrameGeometry = useMemo((): FrameGeometry | undefined => {
    if (!boardFileId) return undefined;
    const origin = -BOARD_SURFACE_SIZE / 2;
    return {
      x: origin,
      y: origin,
      width: BOARD_SURFACE_SIZE,
      height: BOARD_SURFACE_SIZE,
    };
  }, [boardFileId]);

  const queueFrameGeometrySave = useCallback(
    (geometryById: CanvasFrameGeometryById) => {
      if (!id || !canEditDesignRef.current) return;
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
      }
      frameGeometrySaveTimerRef.current = window.setTimeout(() => {
        frameGeometrySaveTimerRef.current = null;
        if (!canEditDesignRef.current) return;
        // Read the freshest designDataJson from the ref so any concurrent
        // server writes (e.g. apply-tweaks) that arrived during the 500 ms
        // debounce window are not overwritten with stale closure data.
        const nextData = {
          ...designDataJsonRef.current,
          canvasFrames: geometryById,
        };
        updateDesignMutation.mutate(
          {
            id,
            data: JSON.stringify(nextData),
          } as any,
          {
            onError: () => {
              queryClient.invalidateQueries({
                queryKey: ["action", "get-design"],
              });
            },
          },
        );
      }, 500);
    },
    [id, queryClient, updateDesignMutation],
  );

  const writeFrameGeometrySnapshot = useCallback(
    (
      geometryById: CanvasFrameGeometryById,
      options?: { syncViewportFrameIds?: string[] },
    ) => {
      if (!id || !canEditDesignRef.current) return;
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
        frameGeometrySaveTimerRef.current = null;
      }
      const snapshot = cloneCanvasFrameGeometry(geometryById);
      const baseData = {
        ...designDataJsonRef.current,
        canvasFrames: snapshot,
      };
      const nextData = options?.syncViewportFrameIds?.length
        ? withSyncedScreenMetadataViewports(
            baseData,
            snapshot,
            options.syncViewportFrameIds,
          )
        : baseData;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, data: JSON.stringify(nextData) };
      });
      updateDesignMutation.mutate(
        {
          id,
          data: JSON.stringify(nextData),
        } as any,
        {
          onError: () => {
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
          },
        },
      );
    },
    [id, queryClient, updateDesignMutation],
  );

  const handleGeometryCommit = useCallback(
    (before: CanvasFrameGeometryById, after: CanvasFrameGeometryById) => {
      const beforeSnapshot = cloneCanvasFrameGeometry(before);
      const afterSnapshot = cloneCanvasFrameGeometry(after);
      if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) {
        return;
      }
      geometryUndoStackRef.current = [
        ...geometryUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        {
          before: beforeSnapshot,
          after: afterSnapshot,
        },
      ];
      clearRedoStacks();
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "geometry",
      ];
      const resizedFrameIds = viewportChangedFrameIds(
        beforeSnapshot,
        afterSnapshot,
      );
      writeFrameGeometrySnapshot(
        afterSnapshot,
        resizedFrameIds.length > 0
          ? { syncViewportFrameIds: resizedFrameIds }
          : undefined,
      );
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState, writeFrameGeometrySnapshot],
  );

  // §6.6 — "Make this a real app" handler.
  // Opens the dialog; actual migration fires when the user confirms.
  const handleOpenMakeReal = useCallback(() => {
    setMigrationResult(null);
    setMakeRealDialogOpen(true);
  }, []);

  // Fires when the user clicks "Start migration" in the dialog.
  // Calls migrate-inline-design-to-app, then on success flips sourceType to
  // "fusion" in the design data blob so gated panels light up.
  const handleConfirmMakeReal = useCallback(async () => {
    if (!id) return;
    try {
      const result = await migrateMutation.mutateAsync({ designId: id } as any);
      const r = result as any;
      setMigrationResult({
        branchName: r?.branchName,
        url: r?.url,
        versionId: r?.versionId,
        seedFileCount: r?.seedFileCount,
        status: r?.status,
        projectId: r?.projectId,
        cta: r?.cta,
      });

      // When the Builder agent accepted the job (status = "processing"),
      // flip the design data to sourceType "fusion" so capability-gated
      // panels (branches, deploy) light up on refresh.
      if (r?.status === "processing" && r?.url) {
        const nextData = {
          ...designDataJsonRef.current,
          sourceType: "fusion",
          fusionBranchName: r.branchName,
          fusionUrl: r.url,
          fusionProjectId: r.projectId,
        };
        updateDesignMutation.mutate(
          { id, data: JSON.stringify(nextData) } as any,
          {
            onSuccess: () => {
              queryClient.invalidateQueries({
                queryKey: ["action", "get-design"],
              });
            },
          },
        );
      } else if (r?.status === "not-configured") {
        // Builder not connected — leave dialog open to show the CTA.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Migration failed";
      toast.error(message);
    }
  }, [id, migrateMutation, updateDesignMutation, queryClient]);

  generationOutputReadyRef.current = files.length > 0;

  useEffect(() => {
    if (!id || files.length === 0) return;
    clearGenerationCompleteTimer();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(null);
    setRetryablePrompt(null);
    staleToastShownRef.current = false;
  }, [clearGenerationCompleteTimer, id, files.length]);

  useEffect(() => {
    if (!id || !design || files.length > 0) return;

    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }

    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }

    if (pending.runTabId) {
      setGenerationIssue(null);
      setHasPendingGeneration(true);
      setGenerationChatTabId(pending.runTabId);
      trackAgentGeneration(pending.runTabId);
      return;
    }

    const prompt =
      pending.prompt?.trim() || `Create an initial design for ${design.title}.`;
    const uploadedFiles = Array.isArray(pending.files) ? pending.files : [];
    const fileContext = formatUploadedFileContext(uploadedFiles);
    const images = imageAttachmentsFromUploadedFiles(uploadedFiles);
    const sourceContext = pending.source
      ? `The user picked the "${pending.source}" template.`
      : "The user just created a new empty design.";
    const pendingDesignSystemId =
      pending.designSystemId === undefined
        ? design.designSystemId
        : pending.designSystemId;

    if (pending.autoGenerate === false) {
      setGenerationIssue(null);
      setHasPendingGeneration(true);
      return;
    }

    const shouldExploreVariants = promptRequestsVariantExploration(prompt);
    const shouldSkipQuestions =
      pending.skipQuestions === true || shouldExploreVariants;
    const context = [
      sourceContext,
      `Design id: "${id}"`,
      `Design title: "${design.title}"`,
      `User request: "${prompt}"`,
      pendingDesignSystemId
        ? `Design system id: "${pendingDesignSystemId}"`
        : "",
      fileContext,
      "",
      ...(shouldExploreVariants
        ? designVariantGenerationDirectives(id, pendingDesignSystemId)
        : shouldSkipQuestions
          ? designGenerationDirectives(id, pendingDesignSystemId)
          : designIntakeQuestionDirectives(id, pendingDesignSystemId)),
    ].join("\n");

    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    const runTabId = agentSubmit(
      shouldSkipQuestions
        ? `Generate design for "${design.title}": ${prompt}`
        : `Create design: ${prompt}`,
      context,
      {
        model: pending.model,
        engine: pending.engine,
        effort: pending.effort,
        newTab: true,
        images,
      },
    );
    setGenerationChatTabId(runTabId);
    patchPendingGeneration(id, {
      runTabId,
      attempt: pending.attempt ?? 1,
      designSystemId: pendingDesignSystemId,
      startedAt: Date.now(),
    });
    setHasPendingGeneration(true);
  }, [
    id,
    design,
    files.length,
    agentSubmit,
    markGenerationStale,
    trackAgentGeneration,
    clearGenerationCompleteTimer,
  ]);

  useEffect(() => {
    return () => {
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
      }
    };
  }, []);

  const defaultActiveFile =
    files.find(
      (file) =>
        normalizedDesignFileType(file.fileType) === "html" &&
        !isBoardFile(file.filename) &&
        file.filename.toLowerCase() === "index.html",
    ) ??
    files.find(
      (file) =>
        normalizedDesignFileType(file.fileType) === "html" &&
        !isBoardFile(file.filename),
    ) ??
    files[0];

  // Set active file to the primary screen when data loads.
  useEffect(() => {
    if (defaultActiveFile && !activeFileId) {
      setActiveFileId(defaultActiveFile.id);
    }
  }, [activeFileId, defaultActiveFile]);

  const activeFile =
    files.find((f) => f.id === activeFileId) ?? defaultActiveFile;
  activeFileIdForUndoRef.current = activeFile?.id ?? null;
  const motionTimelineQueryParams =
    id && activeFile?.id
      ? { designId: id, sourceRef: activeFile.id }
      : { designId: "", sourceRef: "" };
  const { data: motionTimelineResult } =
    useActionQuery<MotionTimelineQueryResult>(
      "get-motion-timeline",
      motionTimelineQueryParams,
      {
        enabled: Boolean(id && activeFile?.id),
        refetchOnMount: "always",
      },
    );
  useEffect(() => {
    if (activeFile && !embedded) return;
    clearMotionDockUnmountTimer();
    setMotionDockOpen(false);
    setMotionDockMounted(false);
  }, [activeFile, clearMotionDockUnmountTimer, embedded]);
  useEffect(() => {
    if (!reviewFileId || reviewFileId === activeFile?.id) return;
    setReviewFileId(null);
    setReviewFindings([]);
    setReviewAuditedAt(null);
    setReviewAuditError(null);
    setReviewAuditLoading(false);
  }, [activeFile?.id, reviewFileId]);

  const selectedScreenIds = useMemo(
    () =>
      getSelectedScreenIdsForEditorState({
        activeFileId: activeFile?.id ?? activeFileId,
        overviewSelectedScreenIds,
        viewMode,
      }),
    [activeFile?.id, activeFileId, overviewSelectedScreenIds, viewMode],
  );
  const activeOverviewScreenId =
    activeFile?.id ?? activeFileId ?? overviewScreens[0]?.id ?? null;
  const activeOverviewScreen = useMemo(
    () =>
      activeOverviewScreenId
        ? overviewScreens.find((screen) => screen.id === activeOverviewScreenId)
        : undefined,
    [activeOverviewScreenId, overviewScreens],
  );
  const activeScreenBridgeUrl = activeOverviewScreen?.bridgeUrl;
  const activeScreenExternalSnapshotHtml = activeFile?.id
    ? liveScreenSnapshotsById[activeFile.id]?.html
    : undefined;
  const activeOverviewSourceWidth =
    deviceFrame === "none"
      ? activeOverviewScreen?.width
      : DEVICE_FRAME_VIEWPORTS[deviceFrame].width;
  const activeOverviewFrameWidth = activeOverviewScreenId
    ? canvasFrameGeometryById[activeOverviewScreenId]?.width
    : undefined;
  const overviewZoomScale = getOverviewZoomScale({
    frameWidth: activeOverviewFrameWidth,
    sourceWidth: activeOverviewSourceWidth,
  });
  const overviewZoomScaleRef = useRef(overviewZoomScale);

  useEffect(() => {
    overviewZoomScaleRef.current = overviewZoomScale;
  }, [overviewZoomScale]);

  const overviewCanvasZoom =
    explicitOverviewCanvasZoom ??
    getDefaultOverviewCanvasZoom(overviewZoomScale);
  const overviewZoom = getOverviewDisplayZoom(
    overviewCanvasZoom,
    overviewZoomScale,
  );
  const zoom = viewMode === "overview" ? overviewZoom : screenZoom;
  const setZoomForView = useCallback(
    (targetView: "single" | "overview", update: SetStateAction<number>) => {
      if (targetView === "overview") {
        setExplicitOverviewCanvasZoom((currentCanvasZoom) => {
          const scale = overviewZoomScaleRef.current;
          const resolvedCanvasZoom =
            currentCanvasZoom ?? getDefaultOverviewCanvasZoom(scale);
          const currentDisplayZoom = getOverviewDisplayZoom(
            resolvedCanvasZoom,
            scale,
          );
          const nextDisplayZoom = resolveZoomUpdate(update, currentDisplayZoom);
          return Number.isFinite(nextDisplayZoom)
            ? getOverviewCanvasZoom(nextDisplayZoom, scale)
            : currentCanvasZoom;
        });
        return;
      }
      setScreenZoom((currentZoom) => {
        const nextZoom = resolveZoomUpdate(update, currentZoom);
        return Number.isFinite(nextZoom) ? nextZoom : currentZoom;
      });
    },
    [],
  );
  const setZoom = useCallback(
    (update: SetStateAction<number>) => {
      setZoomForView(viewModeRef.current, update);
    },
    [setZoomForView],
  );

  const applyDesignEditorCommand = useCallback(
    (command: DesignEditorCommand | Record<string, unknown>) => {
      if (!id || command.designId !== id) return true;
      const commandRecord = command as Record<string, unknown>;
      const editorView =
        command.editorView === "overview" || command.editorView === "single"
          ? command.editorView
          : command.viewMode === "overview" || command.viewMode === "single"
            ? command.viewMode
            : undefined;
      const target =
        typeof command.fileId === "string"
          ? command.fileId
          : typeof command.screenId === "string"
            ? command.screenId
            : typeof command.filename === "string"
              ? command.filename
              : typeof command.screen === "string"
                ? command.screen
                : null;
      const selectionId =
        typeof command.selection === "string"
          ? command.selection
          : typeof commandRecord.nodeId === "string"
            ? commandRecord.nodeId
            : typeof commandRecord.layerId === "string"
              ? commandRecord.layerId
              : null;
      const targetFile = findDesignFileByScreenTarget(files, target);
      // A navigate command can name a screen the agent just created that the
      // get-design query hasn't refetched yet. Treat any unresolved named target
      // as not-yet-applied (return false) so the app-state key is preserved and
      // re-applied on the next tick once the file loads — not just when there are
      // zero files. Otherwise the navigate is silently consumed and dropped.
      if (target && !targetFile) return false;

      const inspectorTab =
        command.inspectorTab === "design" ||
        command.inspectorTab === "tweaks" ||
        command.inspectorTab === "extensions"
          ? command.inspectorTab
          : command.inspector === "design" ||
              command.inspector === "tweaks" ||
              command.inspector === "extensions"
            ? command.inspector
            : undefined;
      if (inspectorTab) setActiveInspectorTab(inspectorTab);
      const leftPanel =
        normalizeDesignLeftPanel(command.leftPanel) ??
        normalizeDesignLeftPanel(command.panel) ??
        normalizeDesignLeftPanel(command.inspectorTab) ??
        normalizeDesignLeftPanel(command.inspector);
      if (leftPanel) setActiveLeftPanel(leftPanel);

      const commandTool = normalizeDesignTool(command.tool);
      const effectiveCommandTool =
        editorView === "overview" &&
        commandTool &&
        isSingleScreenAnnotationTool(commandTool)
          ? "move"
          : commandTool;
      const applyCommandTool = (fallback: DesignTool) => {
        if (!canEditDesign) return;
        const nextTool = effectiveCommandTool ?? fallback;
        setActiveTool(nextTool);
        if (isSingleScreenAnnotationTool(nextTool)) {
          setMode("annotate");
          setDrawMode(true);
          setPinMode(nextTool === "comment");
          return;
        }
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
      };

      if (targetFile) {
        setActiveFileId(targetFile.id);
      }
      if (selectionId) {
        setSelectedLayerIdsState([selectionId]);
      }

      const commandZoom =
        typeof command.zoom === "number" && Number.isFinite(command.zoom)
          ? Math.min(400, Math.max(10, command.zoom))
          : null;
      if (commandZoom !== null) {
        setZoomForView(editorView ?? viewModeRef.current, commandZoom);
      }

      if (editorView === "overview") {
        viewModeRef.current = "overview";
        if (!selectionId) setSelectedElement(null);
        applyCommandTool("move");
        setViewMode("overview");
      } else if (editorView === "single") {
        viewModeRef.current = "single";
        if (!selectionId) setSelectedElement(null);
        applyCommandTool("move");
        if (commandZoom === null) {
          setScreenZoom(FOCUSED_SCREEN_ZOOM);
        }
        setViewMode("single");
      } else if (effectiveCommandTool) {
        applyCommandTool("move");
      }

      return true;
    },
    [canEditDesign, files, id, setZoomForView],
  );

  useEffect(() => {
    if (!id) return;
    if (initialSearchCommandAppliedForIdRef.current === id) return;
    const command = designEditorCommandFromSearchParams(
      id,
      initialSearchParams,
    );
    if (!command) {
      initialSearchCommandAppliedForIdRef.current = id;
      return;
    }
    const applied = applyDesignEditorCommand(command);
    if (applied) {
      initialSearchCommandAppliedForIdRef.current = id;
    }
  }, [applyDesignEditorCommand, id, initialSearchParams]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const keys = browserTabId
      ? [designEditorCommandKey(browserTabId), designEditorCommandKey()]
      : [designEditorCommandKey()];

    void (async () => {
      for (const key of keys) {
        const command = await readClientAppState<DesignEditorCommand>(
          key,
        ).catch(() => null);
        if (cancelled || !command || command.designId !== id) continue;
        const applied = applyDesignEditorCommand(command);
        if (!applied) return;
        await setClientAppState(key, null).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appStateVersion, applyDesignEditorCommand, browserTabId, id]);

  const handleDuplicateScreen = useCallback(
    (
      screenId: string,
      request?: {
        canvasPosition?: { x: number; y: number };
      },
    ) => {
      if (!id || !canEditDesign) return;
      const source = files.find((file) => file.id === screenId);
      if (!source) return;
      const filename = nextDuplicatedFilename(files, source.filename);

      createFileMutation.mutate(
        {
          designId: id,
          filename,
          content: reassignDuplicatedNodeIds(source.content),
          fileType: normalizedDesignFileType(source.fileType),
        } as any,
        {
          onSuccess: (result: any) => {
            const nextId = typeof result?.id === "string" ? result.id : null;
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            if (nextId) {
              setActiveFileId(nextId);
              setActiveTool("move");
              viewModeRef.current = "overview";
              setViewMode("overview");
              if (request?.canvasPosition) {
                queueFrameGeometrySave({
                  ...canvasFrameGeometryById,
                  [nextId]: {
                    ...canvasFrameGeometryById[screenId],
                    x: request.canvasPosition.x,
                    y: request.canvasPosition.y,
                  },
                });
              }
            }
            toast.success(t("designEditor.toasts.screenDuplicated"));
          },
          onError: (error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : t("designEditor.toasts.screenDuplicateError"),
            );
          },
        },
      );
    },
    [
      canEditDesign,
      canvasFrameGeometryById,
      createFileMutation,
      files,
      id,
      queryClient,
      queueFrameGeometrySave,
      t,
    ],
  );

  const handleAddScreen = useCallback(() => {
    if (!id || !canEditDesign) return;
    const filename = nextBlankScreenFilename(files);
    const content = blankScreenHtml(prettyScreenName(filename));
    createFileMutation.mutate(
      {
        designId: id,
        filename,
        content,
        fileType: "html",
      } as any,
      {
        onSuccess: (result: any) => {
          const nextId = typeof result?.id === "string" ? result.id : null;
          if (nextId) {
            const now = new Date().toISOString();
            queryClient.setQueryData(
              ["action", "get-design", { id }],
              (old: any) => {
                if (
                  !old ||
                  typeof old !== "object" ||
                  !Array.isArray(old.files)
                ) {
                  return old;
                }
                const optimisticFile: DesignFile = {
                  id: nextId,
                  filename,
                  fileType: "html",
                  content,
                  createdAt:
                    typeof result?.createdAt === "string"
                      ? result.createdAt
                      : now,
                  updatedAt:
                    typeof result?.updatedAt === "string"
                      ? result.updatedAt
                      : now,
                };
                return {
                  ...old,
                  files: old.files.some(
                    (file: DesignFile) => file.id === nextId,
                  )
                    ? old.files.map((file: DesignFile) =>
                        file.id === nextId ? optimisticFile : file,
                      )
                    : [...old.files, optimisticFile],
                };
              },
            );
            pendingOverviewScreenSelectionRef.current = nextId;
            pendingOverviewLayerSelectionRef.current = null;
            clearPendingOverviewLayerSelectionTimer();
            setCreatedOverviewLayerSelection(null);
            setActiveFileId(nextId);
            setSelectedElement(null);
            setSelectedLayerIdsState([nextId]);
            setOverviewSelectedScreenIds([nextId]);
            setActiveTool("move");
            setMode("edit");
            viewModeRef.current = "overview";
            setViewMode("overview");
          }
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t("designEditor.toasts.screenDuplicateError"),
          );
        },
      },
    );
  }, [
    canEditDesign,
    clearPendingOverviewLayerSelectionTimer,
    createFileMutation,
    files,
    id,
    queryClient,
    t,
  ]);

  const handleCreateScreenFrame = useCallback(
    (geometry: { x: number; y: number; width: number; height: number }) => {
      if (!id || !canEditDesign) return;
      const filename = nextBlankScreenFilename(files);
      const content = blankScreenHtml(prettyScreenName(filename));
      const nextGeometry = {
        x: Math.round(geometry.x),
        y: Math.round(geometry.y),
        width: Math.max(64, Math.round(geometry.width)),
        height: Math.max(64, Math.round(geometry.height)),
      };
      createFileMutation.mutate(
        {
          designId: id,
          filename,
          content,
          fileType: "html",
        } as any,
        {
          onSuccess: (result: any) => {
            const nextId = typeof result?.id === "string" ? result.id : null;
            if (nextId) {
              const now = new Date().toISOString();
              queryClient.setQueryData(
                ["action", "get-design", { id }],
                (old: any) => {
                  if (
                    !old ||
                    typeof old !== "object" ||
                    !Array.isArray(old.files)
                  ) {
                    return old;
                  }
                  const optimisticFile: DesignFile = {
                    id: nextId,
                    filename,
                    fileType: "html",
                    content,
                    createdAt:
                      typeof result?.createdAt === "string"
                        ? result.createdAt
                        : now,
                    updatedAt:
                      typeof result?.updatedAt === "string"
                        ? result.updatedAt
                        : now,
                  };
                  return {
                    ...old,
                    files: old.files.some(
                      (file: DesignFile) => file.id === nextId,
                    )
                      ? old.files.map((file: DesignFile) =>
                          file.id === nextId ? optimisticFile : file,
                        )
                      : [...old.files, optimisticFile],
                  };
                },
              );
              pendingOverviewScreenSelectionRef.current = nextId;
              pendingOverviewLayerSelectionRef.current = null;
              clearPendingOverviewLayerSelectionTimer();
              setCreatedOverviewLayerSelection(null);
              setActiveFileId(nextId);
              setSelectedElement(null);
              setSelectedLayerIdsState([nextId]);
              setOverviewSelectedScreenIds([nextId]);
              setActiveTool("move");
              setMode("edit");
              viewModeRef.current = "overview";
              setViewMode("overview");
              writeFrameGeometrySnapshot({
                ...canvasFrameGeometryById,
                [nextId]: nextGeometry,
              });
            }
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
          },
          onError: (error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : t("designEditor.toasts.screenDuplicateError"),
            );
          },
        },
      );
    },
    [
      canEditDesign,
      canvasFrameGeometryById,
      clearPendingOverviewLayerSelectionTimer,
      createFileMutation,
      files,
      id,
      queryClient,
      t,
      writeFrameGeometrySnapshot,
    ],
  );

  // Collaborative editing for the active file
  const { ydoc, awareness, isSynced, activeUsers, agentActive } =
    useCollaborativeDoc({
      docId:
        isSignedIn && canEditDesign && viewMode === "single"
          ? activeFileId
          : null,
      requestSource: TAB_ID,
      user: currentUser,
    });

  // Track collab-sourced content for the active file.
  // When Y.Doc is synced and has content, use it as the source of truth
  // instead of the DB-fetched content so live remote edits appear instantly.
  const [collabContent, setCollabContent] = useState<string | null>(null);
  const [collabContentFileId, setCollabContentFileId] = useState<string | null>(
    null,
  );
  const previousDesignIdForHistoryRef = useRef<string | null>(null);
  const prevActiveFileIdRef = useRef<string | null>(null);
  // `updatedAt` of the DB content this preview currently reflects. A poll that
  // returns an older-or-equal value is a stale snapshot and is ignored; a newer
  // one is a genuine external edit (agent / peer-via-SQL) and is reconciled in.
  // Mirrors the content template's VisualEditor `lastAppliedUpdatedAt` gate.
  const lastAppliedFileUpdatedAtRef = useRef<string | null>(null);
  // The last content this client itself wrote into the Y.Doc (inline-style
  // edits) — so the reconcile/observe doesn't treat our own echo as external.
  const lastLocalContentRef = useRef<string | null>(null);
  const latestActiveContentRef = useRef<string | null>(null);
  // Freshest known DB `updatedAt` for the active file, kept in a ref so the
  // Yjs observe handler can advance the reconcile watermark without re-subscribing.
  const documentFileUpdatedAtRef = useRef<string | null>(null);
  const documentFileContentRef = useRef<string | null>(null);
  const collabContentRef = useRef<string | null>(null);
  const collabContentFileIdRef = useRef<string | null>(null);
  const staleAgentCollabRecoveryTimerRef = useRef<number | null>(null);
  const clearStaleAgentCollabRecovery = useCallback(() => {
    if (staleAgentCollabRecoveryTimerRef.current !== null) {
      window.clearTimeout(staleAgentCollabRecoveryTimerRef.current);
      staleAgentCollabRecoveryTimerRef.current = null;
    }
  }, []);

  // Whether this client applies authoritative external snapshots into the
  // shared Y.Doc. Exactly one client (the lead) does, so an agent/peer edit
  // that arrives via the get-design refetch isn't diffed into the CRDT by every
  // open client and duplicated. Re-elected on awareness / visibility changes.
  const [isLeadClient, setIsLeadClient] = useState(true);
  useEffect(() => {
    if (!awareness || !ydoc) {
      setIsLeadClient(true);
      return;
    }
    const update = () =>
      setIsLeadClient(isReconcileLeadClient(awareness, ydoc.clientID));
    update();
    awareness.on("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      awareness.off("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [awareness, ydoc]);

  useEffect(() => {
    if (previousDesignIdForHistoryRef.current === id) return;
    previousDesignIdForHistoryRef.current = id ?? null;
    clearLocalUndoRedoStacks();
    syncUndoRedoState();
  }, [clearLocalUndoRedoStacks, id, syncUndoRedoState]);

  // Reset per-file reconcile state when switching files.
  // Keep undo/redo content + geometry stacks intact: overview mode needs one
  // chronological history across all screens, board edits, and frame geometry.
  useEffect(() => {
    if (viewMode === "overview") {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
      return;
    }
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
    }
  }, [activeFileId, clearStaleAgentCollabRecovery, viewMode]);

  useEffect(() => {
    return clearStaleAgentCollabRecovery;
  }, [clearStaleAgentCollabRecovery]);

  // Seed collab content from Y.Doc once synced
  useEffect(() => {
    if (!ydoc || !isSynced || !activeFileId) return;
    const fileId = activeFileId;
    const ytext = ydoc.getText("content");
    const text = ytext.toString();
    const pendingLocalContent =
      pendingLocalFileContentsRef.current.get(fileId)?.content;
    if (pendingLocalContent && text !== pendingLocalContent) {
      setCollabContent(pendingLocalContent);
      setCollabContentFileId(fileId);
      lastLocalContentRef.current = pendingLocalContent;
      latestActiveContentRef.current = pendingLocalContent;
      setContentRenderRevision((revision) => revision + 1);
      ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, pendingLocalContent);
      }, TAB_ID);
      return;
    }
    if (text.length > 0) {
      const storedContent = activeFile?.content ?? "";
      if (
        !shouldUseLiveFileContent({
          liveContent: text,
          storedContent,
          fileType: activeFile?.fileType ?? "html",
        })
      ) {
        setCollabContent(storedContent);
        setCollabContentFileId(fileId);
        lastLocalContentRef.current = storedContent;
        latestActiveContentRef.current = storedContent;
        setContentRenderRevision((revision) => revision + 1);
        ydoc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, storedContent);
        }, TAB_ID);
        return;
      }
      // Y.Doc snapshots are a render seed, not the SQL source of truth; the
      // reconcile effect below advances the updatedAt watermark only after it
      // confirms or applies the current DB content.
      setCollabContent(text);
      setCollabContentFileId(fileId);
      latestActiveContentRef.current = text;
      setContentRenderRevision((revision) => revision + 1);
    }
  }, [
    ydoc,
    isSynced,
    activeFileId,
    activeFile?.content,
    activeFile?.fileType,
    pendingLocalFileContentsRevision,
  ]);

  // Keep the freshest DB `updatedAt` in a ref the observe handler can read.
  useEffect(() => {
    documentFileUpdatedAtRef.current = activeFile?.updatedAt ?? null;
    documentFileContentRef.current = activeFile?.content ?? null;
  }, [activeFile?.content, activeFile?.updatedAt]);

  useEffect(() => {
    collabContentRef.current = collabContent;
    collabContentFileIdRef.current = collabContentFileId;
  }, [collabContent, collabContentFileId]);

  // Observe Y.Text changes for live updates from remote editors (peers + the
  // agent's in-process applyText). This is the instant peer-to-peer path.
  useEffect(() => {
    if (!ydoc || !isSynced || !activeFileId) return;
    const fileId = activeFileId;
    const ytext = ydoc.getText("content");
    const handler = (_event: unknown, transaction?: { origin?: unknown }) => {
      const next = ytext.toString();
      // UndoManager fires with itself as the origin; treat those as local too
      // so the reconcile watermark and stale-selection fix are consistent.
      const isLocalEdit =
        transaction?.origin === TAB_ID ||
        transaction?.origin === LOCAL_EDIT_ORIGIN ||
        transaction?.origin === undoManagerRef.current;
      const pendingLocalContent =
        pendingLocalFileContentsRef.current.get(fileId)?.content;
      if (pendingLocalContent && next !== pendingLocalContent && !isLocalEdit) {
        setCollabContent(pendingLocalContent);
        setCollabContentFileId(fileId);
        lastLocalContentRef.current = pendingLocalContent;
        latestActiveContentRef.current = pendingLocalContent;
        setContentRenderRevision((revision) => revision + 1);
        ydoc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, pendingLocalContent);
        }, TAB_ID);
        return;
      }
      setCollabContent(next);
      setCollabContentFileId(fileId);
      latestActiveContentRef.current = next;
      if (isLocalEdit) {
        lastLocalContentRef.current = next;
      } else {
        setContentRenderRevision((revision) => revision + 1);
      }
      // Only advance the DB reconcile watermark when the live CRDT text
      // actually matches the current SQL snapshot. Otherwise an intermediate
      // or malformed Yjs update can shadow valid saved HTML until reload.
      if (next === documentFileContentRef.current) {
        lastAppliedFileUpdatedAtRef.current =
          documentFileUpdatedAtRef.current ??
          lastAppliedFileUpdatedAtRef.current;
      }
      // Stale-selection fix: when a remote/agent edit changes the document,
      // verify the selected element still exists in the new DOM. If not, clear
      // selection and hover so the Edit panel doesn't operate on a ghost element.
      if (!isLocalEdit) {
        setSelectedElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev);
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev);
        });
      }
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [activeFileId, ydoc, isSynced]);

  // Create / recreate the UndoManager whenever the active file's ydoc changes.
  // Tracks only LOCAL_EDIT_ORIGIN so remote peers' and agent edits are never
  // undone by this user's Cmd+Z. captureTimeout=800ms coalesces rapid slider
  // drags into a single undo step.
  useEffect(() => {
    if (!ydoc || !isSynced) {
      undoManagerRef.current?.destroy();
      undoManagerRef.current = null;
      historyOrderRef.current = removeUndoRedoOrderKind(
        historyOrderRef.current,
        "content",
      );
      redoOrderRef.current = removeUndoRedoOrderKind(
        redoOrderRef.current,
        "content",
      );
      syncUndoRedoState();
      return;
    }
    const ytext = ydoc.getText("content");
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
      captureTimeout: 800,
    });

    const syncState = () => syncUndoRedoState();
    const handleStackItemAdded = (event: {
      origin?: unknown;
      type?: "undo" | "redo";
    }) => {
      if (event.origin !== LOCAL_EDIT_ORIGIN || event.type !== "undo") {
        syncUndoRedoState();
        return;
      }
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      clearRedoStacks();
      syncUndoRedoState();
    };
    um.on("stack-item-added", handleStackItemAdded);
    um.on("stack-item-updated", syncState);
    um.on("stack-item-popped", syncState);
    um.on("stack-cleared", syncState);

    undoManagerRef.current = um;
    syncState();

    return () => {
      um.off("stack-item-added", handleStackItemAdded);
      um.off("stack-item-updated", syncState);
      um.off("stack-item-popped", syncState);
      um.off("stack-cleared", syncState);
      um.destroy();
      undoManagerRef.current = null;
      historyOrderRef.current = removeUndoRedoOrderKind(
        historyOrderRef.current,
        "content",
      );
      redoOrderRef.current = removeUndoRedoOrderKind(
        redoOrderRef.current,
        "content",
      );
      syncUndoRedoState();
    };
  }, [clearRedoStacks, ydoc, isSynced, syncUndoRedoState]);

  // Reconcile authoritative external DB content (agent edit / peer-via-SQL) into
  // the live preview. This is the robustness fallback the Yjs observe path can't
  // guarantee on its own: a collab poll can be missed or paused (e.g. the tab
  // was backgrounded, or refetchInterval is off for a normal agent edit), but
  // get-design still refetches via the action-change invalidate. Driven by
  // `updatedAt`: only content genuinely newer than what the preview reflects is
  // adopted, so a lagging poll can never revert live edits. The lead client also
  // writes it into the Y.Doc so peers receive it and it persists.
  useEffect(() => {
    if (!activeFile || !isSynced) return;
    const dbContent = activeFile.content ?? "";
    const dbUpdatedAt = activeFile.updatedAt ?? null;
    const activeScopedCollabContent =
      collabContentFileId === activeFile.id ? collabContent : null;
    if (
      typeof activeScopedCollabContent === "string" &&
      !shouldUseLiveFileContent({
        liveContent: activeScopedCollabContent,
        storedContent: dbContent,
        fileType: activeFile.fileType,
      })
    ) {
      clearStaleAgentCollabRecovery();
      setCollabContent(dbContent);
      setCollabContentFileId(activeFile.id);
      lastLocalContentRef.current = dbContent;
      latestActiveContentRef.current = dbContent;
      if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
      setContentRenderRevision((revision) => revision + 1);

      if (isLeadClient && ydoc) {
        const ytext = ydoc.getText("content");
        if (ytext.toString() !== dbContent) {
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, dbContent);
          }, TAB_ID);
        }
      }
      return;
    }

    // Already reflecting this exact content (our own echo or Yjs already
    // delivered it) — just advance the watermark and stop.
    if (
      activeScopedCollabContent === dbContent ||
      lastLocalContentRef.current === dbContent
    ) {
      if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
      return;
    }

    // Only adopt genuinely newer content. No baseline yet (fresh file load)
    // always adopts so a stale persisted Y.Doc can't shadow newer SQL.
    const applied = lastAppliedFileUpdatedAtRef.current;
    const externalNewer = !applied || (!!dbUpdatedAt && dbUpdatedAt > applied);
    const staleAgentEchoPossible =
      agentActive &&
      !!applied &&
      !!dbUpdatedAt &&
      dbUpdatedAt === applied &&
      lastLocalContentRef.current !== activeScopedCollabContent;
    if (!externalNewer) {
      if (staleAgentEchoPossible) {
        if (staleAgentCollabRecoveryTimerRef.current === null) {
          const expectedContent = dbContent;
          const expectedUpdatedAt = dbUpdatedAt;
          const expectedFileId = activeFile.id;
          staleAgentCollabRecoveryTimerRef.current = window.setTimeout(() => {
            staleAgentCollabRecoveryTimerRef.current = null;
            const currentCollab = collabContentRef.current;
            if (collabContentFileIdRef.current !== expectedFileId) return;
            if (documentFileUpdatedAtRef.current !== expectedUpdatedAt) return;
            if (documentFileContentRef.current !== expectedContent) return;
            if (currentCollab === expectedContent) return;
            if (lastLocalContentRef.current === currentCollab) return;

            setCollabContent(expectedContent);
            setCollabContentFileId(expectedFileId);
            lastLocalContentRef.current = expectedContent;
            latestActiveContentRef.current = expectedContent;
            lastAppliedFileUpdatedAtRef.current = expectedUpdatedAt;
            setContentRenderRevision((revision) => revision + 1);

            if (isLeadClient && ydoc) {
              const ytext = ydoc.getText("content");
              if (ytext.toString() !== expectedContent) {
                ydoc.transact(() => {
                  ytext.delete(0, ytext.length);
                  ytext.insert(0, expectedContent);
                }, TAB_ID);
              }
            }
          }, 1200);
        }
      } else {
        clearStaleAgentCollabRecovery();
      }
      return;
    }
    clearStaleAgentCollabRecovery();

    // Render the newer content immediately so the preview is never stale.
    setCollabContent(dbContent);
    setCollabContentFileId(activeFile.id);
    lastLocalContentRef.current = dbContent;
    latestActiveContentRef.current = dbContent;
    if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
    setContentRenderRevision((revision) => revision + 1);

    // Lead client mirrors it into the shared Y.Doc so other open clients
    // receive it through Yjs and the durable collab state stays in step. The
    // agent's update-file/generate-design already wrote the Y.Doc in-process,
    // so in the common case this is a no-op diff; it only does real work when
    // the Yjs update was missed (the failure this fallback exists to cover).
    if (isLeadClient && ydoc) {
      const ytext = ydoc.getText("content");
      if (ytext.toString() !== dbContent) {
        ydoc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, dbContent);
        }, TAB_ID);
      }
    }
  }, [
    activeFile,
    agentActive,
    clearStaleAgentCollabRecovery,
    collabContent,
    collabContentFileId,
    isSynced,
    isLeadClient,
    ydoc,
  ]);

  // Set awareness local state to include which file the user is viewing
  useEffect(() => {
    if (awareness && activeFileId) {
      awareness.setLocalStateField("activeFileId", activeFileId);
    }
  }, [awareness, activeFileId]);

  // Presence kit — others + setPresence for cursor/selection broadcasting.
  const { others, setPresence } = usePresence(
    awareness,
    ydoc?.clientID ?? null,
  );

  // Canvas container ref for cursor overlay coordinate mapping.
  const canvasContextMenuRef = useRef<CanvasContextMenuHandle | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const activeEditorDragRef = useRef(false);

  // Live handle to the active DesignCanvas preview iframe. DesignCanvas owns the
  // <iframe> internally (tagged data-design-preview-iframe) and does not forward
  // its ref, so we resolve the element lazily from the DOM at read time. The
  // MotionDock reads `.current` only when scrubbing, so this always returns the
  // currently-mounted iframe even after content swaps recreate the element.
  const canvasIframeRef = useMemo<React.RefObject<HTMLIFrameElement | null>>(
    () => ({
      get current() {
        const iframes = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        );
        if (!activeFile?.id) return iframes[0] ?? null;
        return (
          iframes.find(
            (iframe) => iframe.dataset.screenIframeId === activeFile.id,
          ) ??
          iframes[0] ??
          null
        );
      },
    }),
    [activeFile?.id],
  );

  const handleEditorDragStateChange = useCallback((active: boolean) => {
    activeEditorDragRef.current = active;
  }, []);

  const cancelActiveEditorDrag = useCallback(() => {
    if (!activeEditorDragRef.current) return false;
    activeEditorDragRef.current = false;
    if (typeof document === "undefined") return true;
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
      .forEach((iframe) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:cancel-active-drag" },
          "*",
        );
      });
    return true;
  }, []);

  const handleRunDesignAudit = useCallback(async () => {
    if (!id || !activeFile?.id) return;
    const auditFileId = activeFile.id;
    setReviewFileId(auditFileId);
    setReviewAuditLoading(true);
    setReviewAuditError(null);
    try {
      const result = await callAction<{
        findings: A11yFinding[];
        auditedAt: string;
      }>("run-design-audit", {
        designId: id,
        fileId: auditFileId,
      } as any);
      setReviewFileId(auditFileId);
      setReviewFindings(Array.isArray(result.findings) ? result.findings : []);
      setReviewAuditedAt(result.auditedAt ?? new Date().toISOString());
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.auditRunFailed");
      setReviewAuditError(message);
      toast.error(message);
    } finally {
      setReviewAuditLoading(false);
    }
  }, [activeFile?.id, id, t]);

  const handleReviewFindingClick = useCallback(
    (finding: A11yFinding) => {
      const selector =
        finding.selector ??
        (finding.nodeId
          ? `[data-agent-native-node-id="${finding.nodeId.replace(/"/g, '\\"')}"]`
          : null);
      if (!selector) return;
      canvasIframeRef.current?.contentWindow?.postMessage(
        {
          type: "select-element",
          selector,
          nodeId: finding.nodeId ?? undefined,
        },
        "*",
      );
      if (finding.nodeId) setSelectedLayerIdsState([finding.nodeId]);
    },
    [canvasIframeRef],
  );

  // Broadcast pointer position (normalized to canvas container) and
  // selected element selector so peers can see where the user is working.
  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = canvasContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setPresence({
        cursor: {
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        },
      });
    },
    [setPresence],
  );

  // Block canvas pointer events while any Radix popover is open over the editor.
  // Portaled Radix popovers render into document.body and visually overlap the
  // canvas iframe, but the iframe has its own event context so it still receives
  // pointer events that pass through the popover layer. This shield prevents
  // unintended drag/style edits triggered by clicks intended for the inspector.
  const [inspectorPopoverOpen, setInspectorPopoverOpen] = useState(false);
  useEffect(() => {
    const ATTR = "data-radix-popper-content-wrapper";
    const update = () => {
      setInspectorPopoverOpen(
        document.body.querySelector(`[${ATTR}]`) !== null,
      );
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: false });
    update();
    return () => observer.disconnect();
  }, []);

  // Broadcast selected element selector via presence so peers can render a ring.
  useEffect(() => {
    setPresence({ selection: selectedElement?.selector ?? null });
  }, [selectedElement?.selector, setPresence]);

  // Broadcast viewport (active file + zoom) via presence for follow mode.
  useEffect(() => {
    setPresence({
      viewport: { fileId: activeFileId ?? undefined, zoom },
    });
  }, [activeFileId, zoom, setPresence]);

  // Follow mode — clicking an avatar in the toolbar follows that participant.
  const [followingEmail, setFollowingEmail] = useState<string | null>(null);
  const followingId = useMemo(() => {
    if (!followingEmail) return null;
    const lc = followingEmail.trim().toLowerCase();
    const match = others.find((o) => o.user.email.trim().toLowerCase() === lc);
    return match?.clientId ?? null;
  }, [followingEmail, others]);

  const { stopFollowing } = useFollowUser({
    others,
    followingId,
    viewportKey: "viewport",
    onViewport: (vp) => {
      if (vp.fileId && vp.fileId !== activeFileId) {
        setActiveFileId(vp.fileId);
      }
      if (typeof vp.zoom === "number") {
        setZoom(vp.zoom);
      }
    },
  });

  const handleAvatarClick = useCallback(
    (user: CollabUser | null) => {
      const email = user?.email ?? "agent@system";
      const lc = email.trim().toLowerCase();
      if (followingEmail?.trim().toLowerCase() === lc) {
        // Already following — stop.
        setFollowingEmail(null);
        stopFollowing();
      } else {
        setFollowingEmail(email);
      }
    },
    [followingEmail, stopFollowing],
  );

  const designCollaborators = useMemo<DesignCollaborator[]>(() => {
    const currentEmail = currentUser?.email.trim().toLowerCase() ?? null;
    const humans = dedupeCollabUsersByEmail([
      ...(currentUser ? [currentUser] : []),
      ...activeUsers,
    ]).filter((user) => user.email.trim().toLowerCase() !== "agent@system");
    const otherHumans = humans.filter(
      (user) => user.email.trim().toLowerCase() !== currentEmail,
    );
    const collaborators = otherHumans.map((user) => ({ user }));

    if (!currentUser) return collaborators;

    return [
      {
        user: currentUser,
        image: session?.image,
        isCurrent: true,
      },
      ...collaborators,
    ];
  }, [activeUsers, currentUser, session?.image]);

  // Resolve the content to render: prefer collab content only after the
  // per-file reconcile state has reset for the current active file. Otherwise a
  // file switch can render one frame with the previous file's Yjs text.
  // Always resolve to a string — a non-string source (e.g. a collab value that
  // is not yet a plain string, or a not-yet-loaded file) must never reach the
  // many `content.trim()` / projection callers below, which would crash render.
  const activeCollabFileReady =
    viewMode === "single" && activeFileId === prevActiveFileIdRef.current;
  const pendingActiveFileContent = activeFile?.id
    ? pendingLocalFileContentsSnapshot.get(activeFile.id)?.content
    : undefined;
  const activeContentSource =
    pendingActiveFileContent ??
    (activeCollabFileReady &&
    collabContentFileId === activeFile?.id &&
    collabContent !== null
      ? collabContent
      : (activeFile?.content ?? ""));
  const activeContent =
    typeof activeContentSource === "string" ? activeContentSource : "";
  const initialGenerationChromeLimited =
    shouldLimitEditorChromeUntilContentReady({
      fileCount: files.length,
      generating,
      hasActiveCanvasContent: Boolean(activeFile && activeContent.trim()),
      pendingGenerationActive,
    });
  useLayoutEffect(() => {
    latestActiveContentRef.current = activeContent;
  }, [activeContent]);
  useEffect(() => {
    if (!initialGenerationChromeLimited || activeLeftPanel === "agent") return;
    setActiveLeftPanel("agent");
  }, [activeLeftPanel, initialGenerationChromeLimited]);
  const fileContentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) {
      map.set(file.id, typeof file.content === "string" ? file.content : "");
    }
    return map;
  }, [files]);
  const getScreenContent = useCallback(
    (screenId: string) =>
      getFreshScreenContent({
        screenId,
        activeFileId: activeFile?.id,
        freshActiveContentFileId: activeFile?.id,
        freshActiveContent: activeContent,
        fileContentById,
      }),
    [activeContent, activeFile?.id, fileContentById],
  );
  const getProjectionContentForScreen = useCallback(
    (screenId: string) =>
      liveScreenSnapshotsById[screenId]?.html ?? getScreenContent(screenId),
    [getScreenContent, liveScreenSnapshotsById],
  );
  const handleScreenExternalContentSnapshot = useCallback(
    (screenId: string, snapshot: LiveScreenSnapshot) => {
      setLiveScreenSnapshotsById((current) => {
        const existing = current[screenId];
        if (
          existing?.url === snapshot.url &&
          existing.html === snapshot.html &&
          existing.status === snapshot.status &&
          existing.contentType === snapshot.contentType
        ) {
          return current;
        }
        return { ...current, [screenId]: snapshot };
      });
    },
    [],
  );
  const updateLiveScreenSnapshotContent = useCallback(
    (screenId: string, html: string) => {
      const existing = liveScreenSnapshotsById[screenId];
      if (!existing) return false;
      if (existing.html === html) return true;
      setLiveScreenSnapshotsById((current) => ({
        ...current,
        [screenId]: { ...existing, html },
      }));
      return true;
    },
    [liveScreenSnapshotsById],
  );
  const recordPendingVisualStyleEdit = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
    ) => {
      if (!canEditDesign) return;
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return;
      const stylePatch = Object.fromEntries(entries);
      const screen = files.find((file) => file.id === screenId);
      const fallbackName = screen?.filename ?? screenId;
      const sourceId =
        elementInfo?.sourceId ??
        (screenId === activeFile?.id ? selectedElement?.sourceId : null);
      const proofId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const [firstProperty, firstValue] = entries[0];

      setPendingVisualStyleEdits((current) =>
        mergePendingVisualStyleEdit(current, {
          screenId,
          filename: fallbackName,
          screenName: prettyScreenName(fallbackName),
          selector,
          sourceId,
          tagName: elementInfo?.tagName ?? null,
          classes: elementInfo?.classes ?? [],
          styles: stylePatch,
          updatedAt: Date.now(),
        }),
      );
      setPatchProof({
        id: proofId,
        fileId: screenId,
        filename: fallbackName,
        selector,
        sourceId: sourceId ?? undefined,
        property:
          entries.length === 1
            ? firstProperty
            : entries.map(([property]) => property).join(", "),
        previousValue:
          elementInfo?.computedStyles?.[firstProperty] ??
          (screenId === activeFile?.id
            ? selectedElement?.computedStyles?.[firstProperty]
            : undefined),
        nextValue:
          entries.length === 1
            ? firstValue
            : entries
                .map(([property, value]) => `${property}: ${value}`)
                .join("; "),
        previousContent: getProjectionContentForScreen(screenId),
        capability: "deterministic-style-edit",
        confidence: 0.92,
        status: "runtime",
        createdAt: Date.now(),
      });

      if (screenId !== activeFile?.id) return;
      setSelectedElement((prev) => {
        const base = elementInfo ?? prev;
        if (!base) return prev;
        return {
          ...base,
          sourceId: sourceId ?? base.sourceId,
          selector: selector || base.selector,
          computedStyles: {
            ...base.computedStyles,
            ...stylePatch,
          },
        };
      });
      if (sourceId) {
        setSelectedLayerIdsState([sourceId]);
      }
    },
    [
      activeFile?.id,
      canEditDesign,
      files,
      getProjectionContentForScreen,
      selectedElement?.computedStyles,
      selectedElement?.sourceId,
    ],
  );
  const activeProjectionContent =
    activeFile?.id !== undefined
      ? getProjectionContentForScreen(activeFile.id)
      : activeContent;
  const pageStyles = useMemo(
    () => getBodyInlineStyles(activeContent),
    [activeContent],
  );
  const activeCodeLayerProjection = useMemo(
    () => buildCodeLayerProjection(activeProjectionContent),
    [activeProjectionContent],
  );
  const activeMotionTimeline = motionTimelineResult?.timelines?.[0] ?? null;
  const activeMotionHydrationFingerprint = activeFile?.id
    ? motionTimelineFingerprint(activeFile.id, activeMotionTimeline)
    : null;
  const activeMotionProjectionFingerprint = activeMotionHydrationFingerprint
    ? activeMotionHydrationFingerprint
    : null;

  useEffect(() => {
    const fileId = activeFile?.id ?? null;
    if (previousMotionFileIdRef.current === fileId) return;
    previousMotionFileIdRef.current = fileId;
    clearMotionAutosaveTimer();
    motionAutosaveRevisionRef.current = 0;
    motionAutosaveFailedRevisionRef.current = null;
    lastScheduledMotionAutosaveRevisionRef.current = 0;
    setMotionTimelineId(null);
    setMotionTracks([]);
    setMotionDurationMs(1000);
    setMotionPlayhead(0);
    setMotionAutoKeyframeEnabled(false);
    setMotionTracksDirty(false);
    setMotionAutosaveRevision(0);
    setMotionHydrationFingerprint(null);
  }, [activeFile?.id, clearMotionAutosaveTimer]);

  useEffect(() => {
    if (!activeFile?.id || !activeMotionProjectionFingerprint) return;
    if (motionTracksDirty) return;
    if (motionHydrationFingerprint === activeMotionProjectionFingerprint)
      return;

    const hydratedTracks = activeMotionTimeline
      ? hydrateMotionDockTracks(
          activeMotionTimeline.tracks,
          activeCodeLayerProjection,
        )
      : [];

    setMotionTimelineId(activeMotionTimeline?.id ?? null);
    setMotionTracks(hydratedTracks);
    setMotionDurationMs(activeMotionTimeline?.durationMs ?? 1000);
    setMotionHydrationFingerprint(activeMotionProjectionFingerprint);
  }, [
    activeCodeLayerProjection,
    activeFile?.id,
    activeMotionProjectionFingerprint,
    activeMotionTimeline,
    motionHydrationFingerprint,
    motionTracksDirty,
  ]);

  const selectedCodeLayerNode = useMemo(() => {
    if (!selectedElement) return null;
    return resolveCodeLayerNodeFromElementInfo(
      activeCodeLayerProjection,
      selectedElement,
    );
  }, [activeCodeLayerProjection, selectedElement]);
  const selectedElementLayerId = selectedCodeLayerNode?.id ?? null;
  const selectedCanvasSelectorCandidates = useMemo(() => {
    if (selectedCodeLayerNode) {
      return codeLayerSelectorAliases(selectedCodeLayerNode);
    }
    return selectedElement?.selector ? [selectedElement.selector] : [];
  }, [selectedCodeLayerNode, selectedElement?.selector]);
  const selectedCanvasSelector = selectedCanvasSelectorCandidates[0] ?? null;

  const handleDesignStateSelect = useCallback(
    (stateId: string | null, row?: DesignStatePreviewRow) => {
      setSelectedStateId(stateId);
      const win = canvasIframeRef.current?.contentWindow;
      if (!win) return;

      if (stateId === null) {
        win.postMessage(
          {
            type: "replace-document-content",
            content: activeContent,
            forceFullDocument: true,
          },
          "*",
        );
        return;
      }

      const html = designStatePreviewHtml(row);
      if (!html) return;
      win.postMessage(
        {
          type: "replace-document-content",
          content: html,
          forceFullDocument: true,
        },
        "*",
      );
    },
    [activeContent, canvasIframeRef],
  );

  // ── Inspector header quick actions (Create component / Inspect code) ───────
  // Resolve the design-level source type + capability map so the inspector can
  // gate the real-app affordances (jump-to-source, prop write-back).
  const designSourceType = useMemo(
    () =>
      normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
      normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
      "inline",
    [designDataJson.sourceMode, designDataJson.sourceType],
  );
  const activeCanvasSourceType =
    normalizeDesignSourceType(activeOverviewScreen?.sourceType) ??
    designSourceType;
  const sourceCapabilities = useMemo(() => {
    const caps = resolveSourceCapabilities(designSourceType);
    return DESIGN_CAPABILITY_NAMES.filter((name) => hasCapability(caps, name));
  }, [designSourceType]);

  // Builder-hosted preview URL for fusion-source designs, written into the
  // design data blob by the "Make it real" migration. Threaded into DesignCanvas
  // so the fusion preview renders (and so the bridge trust check can validate
  // the frame's origin against it).
  const designFusionUrl = useMemo(() => {
    const raw = (designDataJson as { fusionUrl?: unknown }).fusionUrl;
    return typeof raw === "string" && raw ? raw : undefined;
  }, [designDataJson]);

  // §6.1 — open a component instance's source. open-component-source selects the
  // component root in the editor and emits a navigate app-state; for real-app
  // (localhost / fusion) sources it also resolves the external file location.
  const handleComponentSourceJump = useCallback(
    ({ nodeId }: { nodeId: string; componentName: string }) => {
      if (!id || !nodeId) return;
      openComponentSourceMutation.mutate(
        { designId: id, nodeId, fileId: activeFileId ?? undefined } as any,
        {
          onError: () => {
            toast.error(
              "Could not open component source" /* i18n-ignore edge-case jump failure */,
            );
          },
        },
      );
    },
    [id, activeFileId, openComponentSourceMutation],
  );

  // The selected node id, when it already is a recognised component instance —
  // unlocks the contextual Component section at the top of the Design tab.
  const selectedComponentNodeId = useMemo(() => {
    if (!selectedCodeLayerNode) return undefined;
    return isComponentInstance(selectedCodeLayerNode)
      ? bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode)
      : undefined;
  }, [selectedCodeLayerNode]);
  const selectedElementAlreadyComponent = useMemo(() => {
    if (!selectedElement) return false;
    if (selectedElement.componentName?.trim()) return true;
    return codeLayerNodeLooksLikeComponent(selectedCodeLayerNode);
  }, [selectedCodeLayerNode, selectedElement]);

  useEffect(() => {
    clearShaderFillPreview();
  }, [
    activeFile?.id,
    clearShaderFillPreview,
    selectedElement?.selector,
    selectedElement?.sourceId,
  ]);
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const urlKeepsExtensionsInspector =
      urlParams.get("inspector") === "extensions" ||
      urlParams.get("inspectorTab") === "extensions";
    if (activeInspectorTab === "extensions" && urlKeepsExtensionsInspector) {
      return;
    }
    clearShaderFillPreview();
  }, [
    activeInspectorTab,
    clearShaderFillPreview,
    location.pathname,
    location.search,
  ]);
  useEffect(() => {
    window.addEventListener("pagehide", clearShaderFillPreview);
    window.addEventListener("beforeunload", clearShaderFillPreview);
    return () => {
      window.removeEventListener("pagehide", clearShaderFillPreview);
      window.removeEventListener("beforeunload", clearShaderFillPreview);
    };
  }, [clearShaderFillPreview]);

  // A friendly default name for the create-component dialog, derived from the
  // selected element's layer name / tag.
  const defaultComponentName = useMemo(() => {
    if (selectedCodeLayerNode?.layerName)
      return selectedCodeLayerNode.layerName;
    if (selectedElement?.tagName) {
      const tag = selectedElement.tagName;
      return tag.charAt(0).toUpperCase() + tag.slice(1);
    }
    return "Component";
  }, [selectedCodeLayerNode?.layerName, selectedElement?.tagName]);

  // Outer HTML of the selection — backs the inline/Alpine "Inspect code" view.
  const selectedElementOuterHtml = useMemo(() => {
    if (!selectedElement?.selector) return null;
    return getElementOuterHtml(activeContent, selectedElement.selector);
  }, [activeContent, selectedElement?.selector]);

  // §6.3 — the motion-dock target: the selected element's literal
  // `data-agent-native-node-id` (the value the motion compiler + preview bridge
  // match on, NOT the hashed projection id) plus a friendly label. Single-screen
  // mode auto-stamps every selectable node with this attribute (see the
  // ensureCodeLayerNodeIdsInHtml effect), so a selection reliably resolves to a
  // stable node id here. `null` when nothing animatable is selected — the dock
  // then disables its "Add track" affordance.
  const motionSelectedTarget = useMemo<{
    nodeId: string;
    label: string;
  } | null>(() => {
    if (!selectedCodeLayerNode) return null;
    const nodeId =
      selectedCodeLayerNode.dataAttributes["data-agent-native-node-id"]?.trim();
    if (!nodeId) return null;
    const label =
      selectedCodeLayerNode.layerName ||
      selectedElement?.tagName ||
      "Selected element";
    return { nodeId, label };
  }, [selectedCodeLayerNode, selectedElement?.tagName]);

  const markMotionTracksDirty = useCallback(() => {
    setMotionTracksDirty(true);
    setMotionAutosaveRevision((revision) => {
      const next = revision + 1;
      motionAutosaveRevisionRef.current = next;
      motionAutosaveFailedRevisionRef.current = null;
      return next;
    });
  }, []);

  const handleMotionTracksChange = useCallback(
    (tracks: MotionDockTrack[]) => {
      setMotionTracks(tracks);
      markMotionTracksDirty();
    },
    [markMotionTracksDirty],
  );

  const handleMotionDurationChange = useCallback(
    (durationMs: number) => {
      setMotionDurationMs(durationMs);
      markMotionTracksDirty();
    },
    [markMotionTracksDirty],
  );

  // Serialisable subset of the dock's tracks for the DesignCanvas motion-preview
  // bridge. Strips the UI-only `label` field. Only populated while the dock is
  // open so a closed dock never leaves preview overrides on the canvas; an empty
  // array makes DesignCanvas send `motion-preview-clear`. Scrubbing previews
  // these tracks live in the iframe; autosave only runs for track/duration edits.
  const motionTracksWire = useMemo<MotionTrackWire[]>(() => {
    if (!motionDockOpen || motionTracks.length === 0) return [];
    return motionTracks.map(({ label: _label, ...track }) => track);
  }, [motionDockOpen, motionTracks]);

  const upsertMotionKeyframesFromStyles = useCallback(
    (
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      selector?: string,
    ) => {
      if (!motionDockOpen || !motionAutoKeyframeEnabled) return;
      const info = elementInfo ?? selectedElement ?? undefined;
      const targetNode = info
        ? resolveCodeLayerNodeFromElementInfo(activeCodeLayerProjection, info)
        : selector
          ? resolveCodeLayerNodeFromBridge(activeCodeLayerProjection, selector)
          : selectedCodeLayerNode;
      const targetNodeId =
        targetNode?.dataAttributes["data-agent-native-node-id"]?.trim() ??
        info?.sourceId ??
        selectedCodeLayerNode?.dataAttributes[
          "data-agent-native-node-id"
        ]?.trim();
      if (!targetNodeId) return;

      const label =
        targetNode?.layerName ||
        selectedCodeLayerNode?.layerName ||
        info?.tagName ||
        "Selected element";
      setMotionTracks((current) => {
        return upsertMotionStyleKeyframes({
          tracks: current,
          targetNodeId,
          label,
          styles,
          computedStyles:
            info?.computedStyles ?? selectedElement?.computedStyles,
          playhead: motionPlayhead,
        });
      });
      markMotionTracksDirty();
    },
    [
      activeCodeLayerProjection,
      markMotionTracksDirty,
      motionAutoKeyframeEnabled,
      motionDockOpen,
      motionPlayhead,
      selectedCodeLayerNode,
      selectedElement,
    ],
  );

  const inspectCodeData = useMemo<InspectCodeData | undefined>(() => {
    if (!selectedElement) return undefined;
    // Inline/Alpine: the design HTML is the source — show the element's HTML.
    // Real-app source resolution (vscode:// deep link) requires the
    // resolveNodeToFile bridge op, which is wired through open-component-source
    // when an external file path is available; until that round-trip is hooked
    // up here the popover shows the projected HTML for all source types.
    return {
      html: selectedElementOuterHtml,
      tagName: selectedElement.tagName,
      id: selectedElement.id,
      classes: selectedElement.classes,
      sourceLocation: null,
    };
  }, [selectedElement, selectedElementOuterHtml]);

  const handleCreateComponent = useCallback(
    (name: string) => {
      if (!id || !selectedElement) return;
      const nodeId = selectedElementLayerId ?? undefined;
      const selector = selectedCanvasSelector ?? selectedElement.selector;
      createComponentMutation.mutate(
        { designId: id, nodeId, selector, name } as any,
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            toast.success(t("designEditor.toasts.componentCreated"));
          },
          onError: () => {
            toast.error(t("designEditor.toasts.componentCreateFailed"));
          },
        },
      );

      // Follow-up: ask the Design agent to extract props and replace repeated
      // instances with this component. The deterministic annotate above is the
      // core; this is an enhancement that runs in the agent chat.
      sendToDesignAgentChat({
        message: `Extract props for the "${name}" component and replace repeated instances on this design with it.`,
        context: [
          `Design id: "${id}".`,
          selectedElement.selector
            ? `Component root selector: ${selectedElement.selector}.`
            : "",
          nodeId ? `Component root node id: ${nodeId}.` : "",
          `The element was just annotated with data-agent-native-component="${name}".`,
          "Call view-screen first, then use get-code-layer-projection to find repeated instances, and apply-visual-edit / apply-component-prop-edit to converge them on this component with data-agent-native-prop-* props.",
        ]
          .filter(Boolean)
          .join("\n"),
        submit: true,
        openSidebar: true,
      });
    },
    [
      id,
      selectedElement,
      selectedElementLayerId,
      selectedCanvasSelector,
      createComponentMutation,
      queryClient,
      t,
    ],
  );

  const hoveredCodeLayerNode = useMemo(() => {
    if (!hoveredElement) return null;
    if (isScreenRootElementInfo(hoveredElement)) return null;
    return resolveCodeLayerNodeFromElementInfo(
      activeCodeLayerProjection,
      hoveredElement,
    );
  }, [activeCodeLayerProjection, hoveredElement]);
  const hoveredCanvasSelectorCandidates = useMemo(() => {
    if (isScreenRootElementInfo(hoveredElement)) return [];
    if (hoveredCodeLayerNode) {
      return codeLayerSelectorAliases(hoveredCodeLayerNode);
    }
    return hoveredElement?.selector ? [hoveredElement.selector] : [];
  }, [hoveredCodeLayerNode, hoveredElement]);
  const hoveredCanvasSelector = hoveredCanvasSelectorCandidates[0] ?? null;
  const hoveredElementIsScreenRoot = isScreenRootElementInfo(hoveredElement);
  const hoveredScreenRootId = hoveredElementIsScreenRoot
    ? hoveredElementScreenId
    : null;
  const hoveredChildScreenId = hoveredElementIsScreenRoot
    ? null
    : hoveredElementScreenId;
  const getCodeLayerProjectionForScreen = useCallback(
    (screenId: string) => {
      if (screenId === activeFile?.id) return activeCodeLayerProjection;
      if (!fileContentById.has(screenId)) return null;
      return buildCodeLayerProjection(getProjectionContentForScreen(screenId));
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      fileContentById,
      getProjectionContentForScreen,
    ],
  );

  const replacePreviewContent = useCallback(
    (
      nextContent: string,
      selector?: string | null,
      options: { forceFullDocument?: boolean } = {},
    ) => {
      const replaceContent = (window as any).__designCanvasReplaceContent;
      if (typeof replaceContent !== "function") return false;
      return Boolean(
        replaceContent(
          nextContent,
          selector ?? selectedCanvasSelector,
          selectedCanvasSelectorCandidates,
          {
            forceFullDocument: options.forceFullDocument === true,
          },
        ),
      );
    },
    [selectedCanvasSelector, selectedCanvasSelectorCandidates, selectedElement],
  );

  const deleteRuntimeElement = useCallback(
    (selector?: string | null) => {
      const deleteElement = (window as any).__designCanvasDeleteElement;
      if (typeof deleteElement !== "function") return false;
      return Boolean(
        deleteElement(
          selector ?? selectedCanvasSelector,
          selectedCanvasSelectorCandidates,
        ),
      );
    },
    [selectedCanvasSelector, selectedCanvasSelectorCandidates],
  );

  const applyLocalContentUpdate = useCallback(
    (
      nextContent: string,
      options: {
        refreshPreview?: boolean;
        skipPreview?: boolean;
        forcePreviewFullDocument?: boolean;
        immediateSave?: boolean;
        persist?: boolean;
        recordHistory?: boolean;
        historyBeforeContent?: string;
        updatedAt?: string;
      } = {},
    ) => {
      if (!activeFile || !canEditDesignRef.current) return;
      const shouldRecordHistory =
        options.recordHistory !== false && !options.updatedAt;
      const previousContent =
        typeof options.historyBeforeContent === "string"
          ? options.historyBeforeContent
          : collabContentFileIdRef.current === activeFile.id &&
              typeof collabContentRef.current === "string"
            ? collabContentRef.current
            : (activeFile.content ?? "");
      const yjsHistoryAvailable = Boolean(
        shouldRecordHistory &&
        viewModeRef.current !== "overview" &&
        ydoc &&
        isSynced &&
        undoManagerRef.current,
      );
      if (
        !suppressContentHistoryRef.current &&
        shouldRecordHistory &&
        !yjsHistoryAvailable &&
        previousContent !== nextContent
      ) {
        const change = {
          fileId: activeFile.id,
          before: previousContent,
          after: nextContent,
        };
        if (viewModeRef.current === "overview") {
          recordContentHistoryEntry(change);
        } else {
          recordLocalContentHistoryEntry(change);
        }
      }
      if (options.updatedAt) {
        clearPendingLocalFileContent(activeFile.id);
      } else {
        markPendingLocalFileContent(
          activeFile.id,
          nextContent,
          activeFile.updatedAt,
        );
      }
      setCollabContent(nextContent);
      setCollabContentFileId(activeFile.id);
      lastLocalContentRef.current = nextContent;
      latestActiveContentRef.current = nextContent;
      if (id) {
        queryClient.setQueryData(
          ["action", "get-design", { id }],
          (old: any) => {
            if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
              return old;
            }
            return {
              ...old,
              files: old.files.map((file: DesignFile) =>
                file.id === activeFile.id
                  ? // Update content optimistically but keep the file's prior
                    // (server-clock) updatedAt. Seeding the reconcile watermark
                    // from a client-clock timestamp can, under clock skew, make a
                    // later server-authored agent edit look "older" and get
                    // dropped by the watermark gate (agent edit silently lost).
                    {
                      ...file,
                      content: nextContent,
                      ...(options.updatedAt
                        ? { updatedAt: options.updatedAt }
                        : {}),
                    }
                  : file,
              ),
            };
          },
        );
      }
      const forceRefresh = options.refreshPreview === true;
      const replacedPreview = options.skipPreview
        ? true
        : forceRefresh
          ? false
          : replacePreviewContent(
              nextContent,
              null,
              options.forcePreviewFullDocument
                ? { forceFullDocument: true }
                : undefined,
            );
      if (
        forceRefresh ||
        options.forcePreviewFullDocument ||
        !replacedPreview
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
      if (ydoc && isSynced) {
        const ytext = ydoc.getText("content");
        if (ytext.toString() !== nextContent) {
          ydoc.transact(
            () => {
              ytext.delete(0, ytext.length);
              ytext.insert(0, nextContent);
            },
            yjsHistoryAvailable ? LOCAL_EDIT_ORIGIN : TAB_ID,
          );
        }
      }
      if (options.persist === false) {
        cancelQueuedFileContentSave(activeFile.id);
      } else {
        queueFileContentSave(activeFile.id, nextContent, {
          syncCollab: !(ydoc && isSynced),
          immediate: options.immediateSave,
        });
      }
    },
    [
      activeFile,
      cancelQueuedFileContentSave,
      clearPendingLocalFileContent,
      id,
      isSynced,
      markPendingLocalFileContent,
      queryClient,
      queueFileContentSave,
      replacePreviewContent,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      syncUndoRedoState,
      ydoc,
    ],
  );

  const applyFileContentUpdate = useCallback(
    (
      fileId: string,
      nextContent: string,
      options: {
        refreshPreview?: boolean;
        skipPreview?: boolean;
        forcePreviewFullDocument?: boolean;
        persist?: boolean;
        recordHistory?: boolean;
        updatedAt?: string;
      } = {},
    ) => {
      if (!canEditDesignRef.current) return;
      if (fileId === activeFile?.id) {
        applyLocalContentUpdate(nextContent, options);
        return;
      }
      const previousFile = files.find((file) => file.id === fileId);
      const previousContent =
        getScreenContent(fileId) ?? previousFile?.content ?? "";
      const shouldRecordHistory =
        options.recordHistory !== false && !options.updatedAt;
      if (
        !suppressContentHistoryRef.current &&
        shouldRecordHistory &&
        previousContent !== nextContent
      ) {
        recordContentHistoryEntry({
          fileId,
          before: previousContent,
          after: nextContent,
        });
      }
      if (options.updatedAt) {
        clearPendingLocalFileContent(fileId);
      } else {
        markPendingLocalFileContent(
          fileId,
          nextContent,
          previousFile?.updatedAt,
        );
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
          return old;
        }
        return {
          ...old,
          files: old.files.map((file: DesignFile) =>
            file.id === fileId
              ? {
                  ...file,
                  content: nextContent,
                  ...(options.updatedAt
                    ? { updatedAt: options.updatedAt }
                    : {}),
                }
              : file,
          ),
        };
      });
      if (options.persist === false) {
        cancelQueuedFileContentSave(fileId);
      } else {
        saveFileContent({
          id: fileId,
          content: nextContent,
          syncCollab: true,
        });
      }
    },
    [
      activeFile?.id,
      applyLocalContentUpdate,
      cancelQueuedFileContentSave,
      clearPendingLocalFileContent,
      files,
      getScreenContent,
      id,
      markPendingLocalFileContent,
      queryClient,
      recordContentHistoryEntry,
      saveFileContent,
    ],
  );

  useEffect(() => {
    if (!id || !activeFile?.id || !motionTracksDirty) return;
    if (motionTracks.length === 0) return;
    if (motionAutosavePending) return;
    if (motionAutosaveFailedRevisionRef.current === motionAutosaveRevision)
      return;
    if (
      lastScheduledMotionAutosaveRevisionRef.current ===
        motionAutosaveRevision &&
      motionAutosaveTimerRef.current !== null
    ) {
      return;
    }

    const revisionAtSchedule = motionAutosaveRevision;
    lastScheduledMotionAutosaveRevisionRef.current = revisionAtSchedule;
    clearMotionAutosaveTimer();
    motionAutosaveTimerRef.current = window.setTimeout(() => {
      motionAutosaveTimerRef.current = null;
      if (motionAutosaveRevisionRef.current !== revisionAtSchedule) return;
      const tracksForSave = motionTracks.map(
        ({ label: _label, ...track }) => track,
      );
      const currentContent = getFreshActiveFileContent({
        activeContent,
        latestContent: latestActiveContentRef.current,
        lastLocalContent: lastLocalContentRef.current,
      });
      const localMotionCss = compileMotionTimeline({
        id: motionTimelineId ?? "",
        designId: id,
        sourceRef: activeFile.id,
        filePath: null,
        tracks: tracksForSave,
        durationMs: motionDurationMs,
        defaultEase: "ease",
        compiledHash: null,
        createdAt: "",
        updatedAt: "",
      }).css;
      const localPatchedContent = injectManagedMotionCss(
        currentContent,
        localMotionCss,
      );
      applyMotionEdit(
        {
          designId: id,
          fileId: activeFile.id,
          timelineId: motionTimelineId ?? undefined,
          sourceRef: activeFile.id,
          tracks: tracksForSave,
          durationMs: motionDurationMs,
          currentContent,
          includeContent: false,
        },
        {
          onSuccess: (result) => {
            const response = result as {
              fileId?: unknown;
              timelineId?: unknown;
              updatedAt?: unknown;
              contentPatched?: unknown;
            };
            if (typeof response.timelineId === "string") {
              setMotionTimelineId(response.timelineId);
            }
            if (motionAutosaveRevisionRef.current === revisionAtSchedule) {
              setMotionTracksDirty(false);
              setMotionHydrationFingerprint(null);
              lastScheduledMotionAutosaveRevisionRef.current = 0;
            }
            if (
              typeof response.fileId === "string" &&
              response.fileId === activeFile.id &&
              response.contentPatched !== false
            ) {
              applyFileContentUpdate(response.fileId, localPatchedContent, {
                refreshPreview: true,
                persist: false,
                ...(typeof response.updatedAt === "string"
                  ? { updatedAt: response.updatedAt }
                  : {}),
              });
            }
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-motion-timeline"],
            });
          },
          onError: (error) => {
            if (motionAutosaveRevisionRef.current === revisionAtSchedule) {
              motionAutosaveFailedRevisionRef.current = revisionAtSchedule;
              lastScheduledMotionAutosaveRevisionRef.current = 0;
            }
            toast.error(
              error instanceof Error
                ? error.message
                : // i18n-ignore: fallback toast for motion autosave failure.
                  "Motion changes could not be saved.",
            );
          },
        },
      );
    }, MOTION_AUTOSAVE_DELAY_MS);
  }, [
    activeFile?.id,
    activeContent,
    applyFileContentUpdate,
    applyMotionEdit,
    clearMotionAutosaveTimer,
    id,
    motionAutosaveRevision,
    motionAutosavePending,
    motionDurationMs,
    motionTimelineId,
    motionTracks,
    motionTracksDirty,
    queryClient,
  ]);

  const handleComponentPropApplied = useCallback(
    (fileId: string, nextContent: string, updatedAt?: string) => {
      applyFileContentUpdate(fileId, nextContent, {
        refreshPreview: fileId === activeFile?.id,
        persist: false,
        updatedAt,
      });
    },
    [activeFile?.id, applyFileContentUpdate],
  );

  const handleReviewFixApplied = useCallback(
    (
      _finding: A11yFinding,
      result?: { fileId?: string; patchedContent?: string },
    ) => {
      setReviewFindings((prev) =>
        prev.filter((finding) => finding.id !== _finding.id),
      );
      if (
        typeof result?.fileId === "string" &&
        typeof result.patchedContent === "string"
      ) {
        applyFileContentUpdate(result.fileId, result.patchedContent, {
          refreshPreview: result.fileId === activeFile?.id,
          persist: false,
        });
      }
      void handleRunDesignAudit();
    },
    [activeFile?.id, applyFileContentUpdate, handleRunDesignAudit],
  );

  const resolvedReviewPanelProps = useMemo<
    Omit<ReviewPanelProps, "className"> | undefined
  >(() => {
    if (!id || !activeFile) return undefined;
    const reviewMatchesActiveFile = reviewFileId === activeFile.id;
    return {
      findings: reviewMatchesActiveFile ? reviewFindings : [],
      auditLoading: reviewMatchesActiveFile ? reviewAuditLoading : false,
      auditedAt: reviewMatchesActiveFile ? reviewAuditedAt : null,
      auditError: reviewMatchesActiveFile ? reviewAuditError : null,
      onRunAudit: handleRunDesignAudit,
      onFindingClick: handleReviewFindingClick,
      fixSource: {
        designId: id,
        fileId: activeFile.id,
        filename: activeFile.filename,
      },
      onFixApplied: handleReviewFixApplied,
    };
  }, [
    activeFile,
    handleReviewFindingClick,
    handleReviewFixApplied,
    handleRunDesignAudit,
    id,
    reviewAuditError,
    reviewAuditLoading,
    reviewAuditedAt,
    reviewFileId,
    reviewFindings,
  ]);

  const handleCreatePrimitive = useCallback(
    (screenId: string, primitive: CanvasPrimitiveInsert) => {
      if (!canEditDesign) return false;
      const targetFile = files.find((file) => file.id === screenId);
      if (!targetFile) return false;
      const pendingContent = pendingLocalFileContentsRef.current.get(
        targetFile.id,
      )?.content;
      const storedContent = targetFile.content ?? "";
      const baseContent =
        pendingContent ??
        (targetFile.id === activeFile?.id
          ? (() => {
              const liveContent =
                ydoc && isSynced
                  ? ydoc.getText("content").toString()
                  : ((collabContentFileIdRef.current === activeFile.id
                      ? collabContentRef.current
                      : null) ?? activeContent);
              return shouldUseLiveFileContent({
                liveContent,
                storedContent,
                fileType: targetFile.fileType,
              })
                ? liveContent
                : storedContent;
            })()
          : storedContent);
      const nextContent = appendCanvasPrimitiveToHtml(baseContent, primitive, {
        preserveNegativePosition: targetFile.id === boardFileId,
      });
      if (!nextContent) {
        toast.error(t("designEditor.toasts.primitiveInsertFailed"));
        return false;
      }
      const projectedNodeId = primitive.nodeId
        ? buildCodeLayerProjection(nextContent).nodes.find(
            (node) =>
              node.dataAttributes["data-agent-native-node-id"] ===
              primitive.nodeId,
          )?.id
        : null;

      if (targetFile.id === activeFile?.id) {
        applyLocalContentUpdate(nextContent, {
          forcePreviewFullDocument: true,
          historyBeforeContent: baseContent,
          immediateSave: true,
        });
      } else {
        recordContentHistoryEntry({
          fileId: targetFile.id,
          before: baseContent,
          after: nextContent,
        });
        queryClient.setQueryData(
          ["action", "get-design", { id }],
          (old: any) => {
            if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
              return old;
            }
            return {
              ...old,
              files: old.files.map((file: DesignFile) =>
                file.id === targetFile.id
                  ? { ...file, content: nextContent }
                  : file,
              ),
            };
          },
        );
        saveFileContent({
          id: targetFile.id,
          content: nextContent,
          syncCollab: true,
        });
      }

      const result = projectedNodeId ?? primitive.nodeId ?? true;

      // Record the nodeId when a TEXT primitive is created so the next
      // handlePrimitiveCreated (or handleBoardDrawPrimitive) can immediately
      // enter text-edit mode — fixing the "click to add text should let me
      // type immediately" bug. The ref is read once and cleared.
      if (primitive.kind === "text") {
        pendingTextEditNodeIdRef.current = primitive.nodeId ?? null;
      } else {
        pendingTextEditNodeIdRef.current = null;
      }

      return result;
    },
    [
      activeContent,
      activeFile?.id,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      files,
      id,
      isSynced,
      queryClient,
      recordContentHistoryEntry,
      saveFileContent,
      t,
      ydoc,
    ],
  );

  const handlePrimitiveCreated = useCallback(
    (
      screenId: string,
      nodeId: string,
      options?: { selectFrame?: boolean; nextTool?: "move" | "pen" },
    ) => {
      // B2/B4 fix: stay in overview mode after drawing a primitive.  The user
      // drew a shape on the board — they should remain on the board with the
      // new primitive selected, matching Figma behaviour.  We activate the
      // target screen (so the layers panel shows its content) and select the
      // new node, but do NOT switch to single/full view.
      pendingOverviewScreenSelectionRef.current =
        options?.selectFrame === false ? null : screenId;
      pendingOverviewLayerSelectionRef.current = nodeId;
      clearPendingOverviewLayerSelectionTimer();
      flushSync(() => {
        setCreatedOverviewLayerSelection({ screenId, layerId: nodeId });
        setActiveFileId(screenId);
        setSelectedElement(null);
        setHoveredElement(null);
        setSelectedLayerIdsState([nodeId]);
        setOverviewSelectedScreenIds(
          options?.selectFrame === false ? [] : [screenId],
        );
        setActiveTool(options?.nextTool ?? "move");
        setMode("edit");
      });
      // viewMode stays at "overview" — no setViewMode("single") call here.

      // Immediately enter text-editing for newly created TEXT primitives. In
      // overview mode the target iframe may become active and receive the
      // inserted HTML over separate renders, so post directly to the target
      // iframe with a few short retries instead of relying on a single global
      // bridge callback.
      const textNodeId = pendingTextEditNodeIdRef.current;
      pendingTextEditNodeIdRef.current = null;
      if (textNodeId) {
        scheduleBeginTextEditForScreen(screenId, textNodeId);
      }
    },
    [clearPendingOverviewLayerSelectionTimer, scheduleBeginTextEditForScreen],
  );

  /**
   * Called by MultiScreenCanvas when a draft primitive is committed in empty
   * canvas space (outside all screen frames).  Appends the primitive to the
   * board file content via the shared handleCreatePrimitive path so the bridge
   * engine handles persistence identically to in-screen elements.
   */
  const handleBoardDrawPrimitive = useCallback(
    (primitive: CanvasPrimitiveInsert) => {
      if (!boardFileId || !canEditDesign) return false;
      const result = handleCreatePrimitive(boardFileId, primitive);
      if (!result) return false;
      const nodeId = typeof result === "string" ? result : primitive.nodeId;
      if (nodeId) {
        handlePrimitiveCreated(boardFileId, nodeId, { selectFrame: false });
      }

      return result;
    },
    [boardFileId, canEditDesign, handleCreatePrimitive, handlePrimitiveCreated],
  );

  const handleOverviewScreenSelectionChange = useCallback(
    (ids: string[]) => {
      const pendingId = pendingOverviewScreenSelectionRef.current;
      const fileIds = new Set(
        files.filter((file) => file.id !== boardFileId).map((file) => file.id),
      );
      const nextIds = ids.filter((layerId) => fileIds.has(layerId));
      if (pendingId && ids.length === 0) return;
      if (pendingId && ids.includes(pendingId)) {
        setOverviewSelectedScreenIds((current) =>
          sameStringIds(current, nextIds) ? current : nextIds,
        );
        if (fileIds.has(pendingId)) {
          pendingOverviewScreenSelectionRef.current = null;
        }
        return;
      }
      if (pendingId) {
        pendingOverviewScreenSelectionRef.current = null;
        pendingOverviewLayerSelectionRef.current = null;
        clearPendingOverviewLayerSelectionTimer();
        setCreatedOverviewLayerSelection(null);
      }
      setOverviewSelectedScreenIds((current) =>
        sameStringIds(current, nextIds) ? current : nextIds,
      );
    },
    [boardFileId, clearPendingOverviewLayerSelectionTimer, files],
  );

  const shouldPreserveBlockedOverviewLayerSelectionRef = useRef<
    (screenId: string) => boolean
  >(() => false);

  const handleMoveTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    setActiveTool("move");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
  }, [canEditDesign]);

  const handleFrameTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("frame");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
      viewModeRef.current = "overview";
      setViewMode("overview");
    });
  }, [canEditDesign]);

  const handleTextTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("text");
      viewModeRef.current = "overview";
      setViewMode("overview");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
    });
  }, [canEditDesign]);

  const handleShapeTool = useCallback(
    (tool: ShapeTool) => {
      if (!canEditDesign) return;
      blurActiveDesignEditableTarget();
      flushSync(() => {
        setActiveTool(tool);
        viewModeRef.current = "overview";
        setViewMode("overview");
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
      });
    },
    [canEditDesign],
  );

  const handleRectTool = useCallback(() => {
    handleShapeTool("rect");
  }, [handleShapeTool]);

  const handlePenTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("pen");
      viewModeRef.current = "overview";
      setViewMode("overview");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
    });
  }, [canEditDesign]);

  const handleHandTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    setActiveTool("hand");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    viewModeRef.current = "overview";
    setViewMode("overview");
  }, [canEditDesign]);

  const handleScaleTool = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
    blurActiveDesignEditableTarget();
    setActiveTool("scale");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
  }, [activeFile, canEditDesign]);

  const handleDrawTool = useCallback(() => {
    if (!activeFile || !canEditDesign || viewMode === "overview") return;
    setActiveTool("draw");
    setMode("annotate");
    setSelectedElement(null);
    setDrawMode(true);
    setPinMode(false);
  }, [activeFile, canEditDesign, viewMode]);

  useEffect(() => {
    if (files.length > 0) resetAgentGenerating();
  }, [files.length, resetAgentGenerating]);

  // Parse design.data for agent-supplied tweaks. The agent writes a JSON blob
  // to designs.data containing { tweaks: TweakDefinition[], ... }; we surface
  // the tweaks as live controls bound to the design's CSS custom properties.
  const tweaks: TweakDefinition[] = useMemo(() => {
    if (!design?.data) return [];
    try {
      const parsed = JSON.parse(design.data);
      if (Array.isArray(parsed?.tweaks)) return parsed.tweaks;
      return [];
    } catch {
      return [];
    }
  }, [design?.data]);

  // Persisted user knob values live in designs.data.tweakSelections (written by
  // the apply-tweaks action). Restoring them on load is what makes the
  // visual-tune round-trip survive a refresh and feed the snapshot/handoff.
  const persistedSelections: TweakSelections = useMemo(() => {
    if (!design?.data) return {};
    try {
      const parsed = JSON.parse(design.data);
      const sel = parsed?.tweakSelections;
      return sel && typeof sel === "object" && !Array.isArray(sel) ? sel : {};
    } catch {
      return {};
    }
  }, [design?.data]);

  // Tweak values are keyed by tweak id while in the panel, then mapped to
  // CSS-var -> value for the iframe so the design's :root block picks them up.
  // Persisted selections are authoritative for agent edits; a local queued
  // save temporarily pauses adoption so stale refetches don't clobber a drag.
  const authoritativeTweakSelections = useMemo(
    () => buildAuthoritativeTweakSelections(tweaks, persistedSelections),
    [tweaks, persistedSelections],
  );
  const [tweakSelections, setTweakSelections] = useReconciledState(
    authoritativeTweakSelections,
    {
      active: tweakSaveActive,
      equals: areTweakSelectionsEqual,
    },
  );

  // Map tweak selections (id -> value) to CSS-var assignments (--var -> value)
  // for the iframe bridge. Shared with the snapshot/handoff actions via
  // `@shared/resolve-tweaks` so the UI and external agents resolve identically.
  const cssVarValues = useMemo(
    () => resolveTweaksToCssVars(tweaks, tweakSelections),
    [tweaks, tweakSelections],
  );

  const handleTweakPromptSubmit = useCallback(
    (
      prompt: string,
      files: UploadedFile[],
      options: PromptComposerSubmitOptions,
    ) => {
      if (!canEditDesign) {
        toast.error(TWEAK_CONTROLS_EDIT_ACCESS_MESSAGE);
        return;
      }
      if (!design) return;
      const trimmed = prompt.trim();
      if (!trimmed) return;
      const fileContext = formatUploadedFileContext(files);
      const images = imageAttachmentsFromUploadedFiles(files);
      const currentSelections =
        Object.keys(tweakSelections).length > 0
          ? JSON.stringify(tweakSelections, null, 2)
          : "None yet.";
      const context = [
        `The user is in the Design editor tweaks panel for design id "${id}" (title: "${design.title}").`,
        activeFile
          ? `Active file: "${activeFile.filename}" (file id: "${activeFile.id}").`
          : "There is no active file yet.",
        `User request: "${trimmed}"`,
        "",
        "Existing tweak definitions:",
        formatTweakDefinitionsContext(tweaks),
        "",
        "Current selected tweak values:",
        currentSelections,
        fileContext,
        "",
        "Add or update live tweak controls for this design. Keep existing useful tweak controls unless the user explicitly asks to replace them.",
        "If a requested control needs a new CSS custom property, first read the live design with `get-design-snapshot`, update the relevant HTML/CSS so the property is used, then persist the complete updated tweak definition list through `generate-design`.",
        "For tiny source changes, prefer `edit-design`, but make sure the tweak definitions are saved so the Tweaks panel updates.",
      ].join("\n");

      sendToDesignAgentChat({
        message: `Add tweak controls to "${design.title}": ${trimmed}`,
        context,
        submit: true,
        openSidebar: true,
        newTab: true,
        model: options.model,
        engine: options.engine,
        effort: options.effort,
        images,
      });
      handleTweakPromptOpenChange(false);
    },
    [
      activeFile,
      canEditDesign,
      design,
      handleTweakPromptOpenChange,
      id,
      tweakSelections,
      tweaks,
    ],
  );

  // Expose selection state for agent context
  useEffect(() => {
    if (!id) return;
    const selection = {
      designId: id,
      designTitle: design?.title ?? null,
      activeFileId: activeFile?.id ?? null,
      activeFilename: activeFile?.filename ?? null,
      viewMode,
      zoom,
      screens: files.map((file) => ({
        id: file.id,
        filename: file.filename,
        fileType: file.fileType,
      })),
      selectedScreenIds,
      selectedElement,
      hoveredElement,
      mode,
      activeTool,
      inspectorTab: activeInspectorTab,
      leftPanel: activeLeftPanel,
      // §8 DesignNavigationState additions — dock + breakpoint context
      dock: { kind: "motion" as const, open: motionDockOpen },
      motion: {
        previewing: false,
        playheadMs: 0,
        timelineId: undefined as string | undefined,
        selectedTrackId: undefined as string | undefined,
        selectedKeyframeId: undefined as string | undefined,
      },
      // §8 breakpoint fields — "auto" = no specific breakpoint focused.
      breakpoint: (activeBreakpointWidthState != null
        ? activeBreakpointWidthState < 500
          ? "mobile"
          : activeBreakpointWidthState < 1024
            ? "tablet"
            : "desktop"
        : "auto") as "auto" | "mobile" | "tablet" | "desktop",
      activeBreakpointId: (() => {
        if (activeBreakpointWidthState == null) return undefined;
        try {
          const raw = (designDataJson as Record<string, unknown>)
            ?.breakpointSet;
          if (
            raw &&
            typeof raw === "object" &&
            Array.isArray((raw as Record<string, unknown>).breakpoints)
          ) {
            const bps = (
              raw as { breakpoints: Array<{ id: string; widthPx: number }> }
            ).breakpoints;
            return bps.find((b) => b.widthPx === activeBreakpointWidthState)
              ?.id;
          }
        } catch {
          // ignore
        }
        return undefined;
      })(),
      breakpointSetId: (() => {
        try {
          const raw = (designDataJson as Record<string, unknown>)
            ?.breakpointSet;
          if (raw && typeof raw === "object") {
            return (raw as Record<string, unknown>).id as string | undefined;
          }
        } catch {
          // ignore
        }
        return undefined;
      })(),
      // §8 — active design state (null = Default / live view)
      selectedStateId,
    };
    (window as any).__designSelection = selection;
    const persistedSelection = {
      designId: selection.designId,
      designTitle: selection.designTitle,
      activeFileId: selection.activeFileId,
      activeFilename: selection.activeFilename,
      viewMode: selection.viewMode,
      zoom: selection.zoom,
      screens: selection.screens,
      selectedScreenIds: selection.selectedScreenIds,
      selectedElement: selection.selectedElement,
      mode: selection.mode,
      activeTool: selection.activeTool,
      inspectorTab: selection.inspectorTab,
      leftPanel: selection.leftPanel,
      dock: selection.dock,
      motion: selection.motion,
      breakpoint: selection.breakpoint,
      activeBreakpointId: selection.activeBreakpointId,
      breakpointSetId: selection.breakpointSetId,
      selectedStateId: selection.selectedStateId,
      ownerId: designSelectionOwnerIdRef.current,
    };
    const persistedKey = JSON.stringify(persistedSelection);
    if (persistedSelectionStateRef.current !== persistedKey) {
      persistedSelectionStateRef.current = persistedKey;
      for (const key of designSelectionStateKeys()) {
        setClientAppState(key, persistedSelection, {
          keepalive: true,
        }).catch(() => {});
      }
    }
    const el = document.documentElement;
    el.dataset.designId = id;
    if (activeFile?.id) el.dataset.fileId = activeFile.id;
    el.dataset.viewMode = viewMode;
    el.dataset.zoom = String(zoom);
    return () => {
      delete (window as any).__designSelection;
      delete el.dataset.designId;
      delete el.dataset.fileId;
      delete el.dataset.viewMode;
      delete el.dataset.zoom;
    };
  }, [
    id,
    design,
    activeFile,
    files,
    selectedScreenIds,
    selectedElement,
    hoveredElement,
    mode,
    activeTool,
    activeInspectorTab,
    activeLeftPanel,
    overviewSelectedScreenIds,
    viewMode,
    zoom,
    motionDockOpen,
    activeBreakpointWidthState,
    designDataJson,
    selectedStateId,
  ]);

  useEffect(() => {
    const key = "design:selected-element";
    if (!id || !shouldMirrorSelectedElementToAgentChat(selectedElement)) {
      removeAgentChatContextItem(key);
      return;
    }

    const labelSource =
      selectedElement.textContent?.trim() ||
      selectedCodeLayerNode?.layerName ||
      selectedElement.id ||
      selectedElement.tagName.toLowerCase();
    const shortLabel =
      labelSource.length > 28 ? `${labelSource.slice(0, 25)}...` : labelSource;
    const contextLines = [
      `Selected design element in design "${design?.title ?? id}".`,
      activeFile
        ? `Active screen: ${activeFile.filename} (${activeFile.id}).`
        : "",
      `Element: <${selectedElement.tagName.toLowerCase()}> ${shortLabel}`,
      `Selector: ${selectedElement.selector}`,
      selectedElement.sourceId ? `Source id: ${selectedElement.sourceId}` : "",
      selectedCodeLayerNode ? `Code layer id: ${selectedCodeLayerNode.id}` : "",
      selectedElement.classes.length
        ? `Classes: ${selectedElement.classes.join(" ")}`
        : "",
      selectedElement.textContent?.trim()
        ? `Text: ${selectedElement.textContent.trim()}`
        : "",
    ].filter(Boolean);

    setAgentChatContextItem({
      key,
      title: shortLabel,
      context: contextLines.join("\n"),
      openSidebar: false,
      // Mirror the selection into chat context without stealing focus: this
      // effect re-fires on every selection change and on each get-design poll
      // during an agent run, and focusing the composer here would blur (and
      // tear down) an in-progress inline text edit on the canvas.
      focus: false,
    });
  }, [activeFile, design?.title, id, selectedCodeLayerNode, selectedElement]);

  const handleAssetInserted = useCallback(
    (selection: {
      fileId?: string;
      nodeId?: string;
      selector?: string;
      title?: string;
    }) => {
      if (selection.fileId) {
        setActiveFileId(selection.fileId);
        if (viewModeRef.current === "overview") {
          setOverviewSelectedScreenIds([selection.fileId]);
        }
      }
      if (selection.nodeId) {
        setSelectedLayerIdsState([selection.nodeId]);
      }
      if (selection.selector || selection.nodeId) {
        setSelectedElement({
          tagName: "section",
          sourceId: selection.nodeId,
          selector:
            selection.selector ??
            `[data-agent-native-node-id="${selection.nodeId}"]`,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 0, height: 0 },
          textContent: selection.title,
          isFlexChild: false,
          isFlexContainer: false,
        });
      }
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setActiveTool("move");
      setMode("edit");
    },
    [],
  );

  const designExtensionContext = useMemo<DesignExtensionSlotContext>(
    () => ({
      designId: id ?? "",
      designTitle: design?.title ?? null,
      activeFileId: activeFile?.id ?? null,
      activeFilename: activeFile?.filename ?? null,
      activeFileUpdatedAt: activeFile?.updatedAt ?? null,
      activeContent,
      viewMode,
      zoom,
      screens: files.map((file) => ({
        id: file.id,
        filename: file.filename,
        fileType: file.fileType,
      })),
      selectedScreenIds,
      selectedElement,
      mode,
      activeTool,
      tweakValues: tweakSelections,
      onShaderFillPreview: (_descriptor, css) => {
        setShaderFillPreview({
          selector: selectedElement?.selector ?? undefined,
          nodeId:
            selectedElement?.sourceId ?? selectedCodeLayerNode?.id ?? undefined,
          css,
        });
      },
      onShaderFillPreviewClear: clearShaderFillPreview,
      onShaderFillApplied: (fileId, content, updatedAt) => {
        applyFileContentUpdate(fileId, content, {
          refreshPreview: fileId === activeFile?.id,
          persist: false,
          updatedAt,
        });
      },
      onAssetInserted: handleAssetInserted,
    }),
    [
      activeContent,
      activeFile?.filename,
      activeFile?.fileType,
      activeFile?.id,
      activeFile?.updatedAt,
      activeTool,
      applyFileContentUpdate,
      clearShaderFillPreview,
      design?.title,
      files,
      handleAssetInserted,
      id,
      mode,
      overviewSelectedScreenIds,
      selectedElement,
      selectedCodeLayerNode?.id,
      selectedScreenIds,
      tweakSelections,
      viewMode,
      zoom,
    ],
  );

  const handleScreenElementSelect = useCallback(
    (screenId: string, info: ElementInfo, intent?: ElementSelectionIntent) => {
      const pendingLayerId = pendingOverviewLayerSelectionRef.current;
      const pendingScreenId = pendingOverviewScreenSelectionRef.current;
      if (
        shouldIgnoreOverviewLayerCreationEcho({
          pendingLayerId,
          pendingScreenId,
          screenId,
          info,
          event: "select",
        })
      ) {
        return;
      }
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      const projection = getCodeLayerProjectionForScreen(screenId);
      const canonical = projection
        ? canonicalizeElementInfoFromProjection(projection, info)
        : info;
      const node = projection
        ? resolveCodeLayerNodeFromElementInfo(projection, canonical)
        : null;
      if (
        shouldPreserveBlockedOverviewLayerSelectionRef.current(screenId) &&
        (isScreenRootElementInfo(canonical) ||
          !node ||
          selectedLayerIdsState.includes(node.id))
      ) {
        return;
      }
      const additiveSelection = Boolean(
        node &&
        (intent?.additive ||
          intent?.range ||
          intent?.shiftKey ||
          intent?.metaKey ||
          intent?.ctrlKey),
      );
      setActiveFileId(screenId);
      setSelectedElement(canonical);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      if (node && additiveSelection) {
        setSelectedLayerIdsState((current) => {
          const removeExisting =
            Boolean(intent?.metaKey || intent?.ctrlKey) &&
            !intent?.shiftKey &&
            current.includes(node.id);
          if (removeExisting) {
            const next = current.filter((layerId) => layerId !== node.id);
            return next.length > 0 ? next : [node.id];
          }
          return dedupeStringIds([...current, node.id]);
        });
      } else {
        setSelectedLayerIdsState(node ? [node.id] : []);
      }
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      setActiveTool("move");
      setMode("edit");
      focusDesignInspectorForSelection();
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
      selectedLayerIdsState,
    ],
  );

  const handleScreenElementClear = useCallback(
    (screenId: string) => {
      const pendingLayerId = pendingOverviewLayerSelectionRef.current;
      const pendingScreenId = pendingOverviewScreenSelectionRef.current;
      if (
        shouldIgnoreOverviewLayerCreationEcho({
          pendingLayerId,
          pendingScreenId,
          screenId,
          event: "clear",
        })
      ) {
        return;
      }
      if (shouldPreserveBlockedOverviewLayerSelectionRef.current(screenId)) {
        return;
      }
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setActiveFileId(screenId);
      setSelectedElement(null);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState([]);
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      setActiveTool("move");
      setMode("edit");
    },
    [clearPendingOverviewLayerSelectionTimer],
  );

  const handleElementSelect = useCallback(
    (info: ElementInfo, intent?: ElementSelectionIntent) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementSelect(screenId, info, intent);
        return;
      }
      setSelectedElement(
        canonicalizeElementInfoFromProjection(activeCodeLayerProjection, info),
      );
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      focusDesignInspectorForSelection();
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      focusDesignInspectorForSelection,
      handleScreenElementSelect,
    ],
  );

  const handleScreenElementDblClickText = useCallback(
    (screenId: string, info: ElementInfo) => {
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      const projection = getCodeLayerProjectionForScreen(screenId);
      const canonical = projection
        ? canonicalizeElementInfoFromProjection(projection, info)
        : info;
      const node = projection
        ? resolveCodeLayerNodeFromElementInfo(projection, canonical)
        : null;
      setActiveFileId(screenId);
      setSelectedElement(canonical);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState(node ? [node.id] : []);
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      setMode("edit");
      focusDesignInspectorForSelection();
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      createdOverviewLayerSelection,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
    ],
  );

  const handleElementDblClickText = useCallback(
    (info: ElementInfo) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementDblClickText(screenId, info);
        return;
      }
      setSelectedElement(
        canonicalizeElementInfoFromProjection(activeCodeLayerProjection, info),
      );
      setMode("edit");
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      handleScreenElementDblClickText,
    ],
  );

  const handleScreenElementHover = useCallback(
    (screenId: string, info: ElementInfo | null) => {
      const projection = getCodeLayerProjectionForScreen(screenId);
      setHoveredElement(
        info
          ? projection
            ? canonicalizeElementInfoFromProjection(projection, info)
            : info
          : null,
      );
      setHoveredElementScreenId(info ? screenId : null);
    },
    [getCodeLayerProjectionForScreen],
  );

  const handleElementHover = useCallback(
    (info: ElementInfo | null) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementHover(screenId, info);
        return;
      }
      setHoveredElement(
        info
          ? canonicalizeElementInfoFromProjection(
              activeCodeLayerProjection,
              info,
            )
          : null,
      );
      setHoveredElementScreenId(info ? screenId : null);
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      handleScreenElementHover,
    ],
  );

  const handleIframeHotkey = useCallback((payload: IframeHotkeyPayload) => {
    if (!payload.key) return;
    const event = new KeyboardEvent("keydown", {
      key: payload.key,
      code: payload.code,
      metaKey: payload.metaKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      altKey: payload.altKey,
      repeat: payload.repeat,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "__agentNativeIframeHotkey", {
      value: true,
    });
    window.dispatchEvent(event);
  }, []);

  const handleIframeContextMenu = useCallback(
    (payload: IframeContextMenuPayload) => {
      const container = canvasContainerRef.current;
      const menu = canvasContextMenuRef.current;
      if (!container || !menu) return;
      if (payload.info) {
        flushSync(() => {
          setSelectedElement(
            payload.info
              ? canonicalizeElementInfoFromProjection(
                  activeCodeLayerProjection,
                  payload.info,
                )
              : null,
          );
        });
        focusDesignInspectorForSelection();
      }
      const clientX =
        typeof payload.viewportClientX === "number"
          ? payload.viewportClientX
          : payload.clientX;
      const clientY =
        typeof payload.viewportClientY === "number"
          ? payload.viewportClientY
          : payload.clientY;
      menu.openAt({ clientX, clientY });
    },
    [activeCodeLayerProjection, focusDesignInspectorForSelection],
  );

  const commitVisualStyles = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      options: {
        runtimeApplied?: boolean;
        elementInfo?: ElementInfo;
      } = {},
    ) => {
      if (!activeFile || !canEditDesign) return;
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return;
      upsertMotionKeyframesFromStyles(styles, options.elementInfo, selector);
      // Base every patch off the freshest known content, not the closed-over
      // render value. Handlers that fire several onStyleChange calls in one
      // synchronous user action (e.g. fixed-size text → width+height+whiteSpace,
      // constraints center → both axes, linked padding → 4 sides) would
      // otherwise each read the same pre-render `activeContent` and clobber one
      // another, so only the last property survived in the saved HTML. Since we
      // advance lastLocalContentRef.current to resolvedNextContent below, the
      // next synchronous call reads the previous call's result and the patches
      // compose. Falls back to activeContent when the ref is unset (file switch).
      const activeLiveSnapshot = activeFile
        ? liveScreenSnapshotsById[activeFile.id]
        : undefined;
      const baseContent =
        activeLiveSnapshot?.html ??
        latestActiveContentRef.current ??
        lastLocalContentRef.current ??
        activeContent;
      const [firstProperty, firstValue] = entries[0];
      const projection = buildCodeLayerProjection(baseContent);
      const targetInfo = options.elementInfo ?? selectedElement;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveCodeLayerNodeFromBridge(projection, selector);
      const capability =
        selectedElement?.editCapabilities?.find((item) =>
          item.kind.startsWith("deterministic"),
        ) ?? selectedElement?.editCapabilities?.[0];
      const proofId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (!targetNode && elementInfoIsRuntimeOnly(targetInfo)) {
        setPatchProof({
          id: proofId,
          fileId: activeFile.id,
          filename: activeFile.filename,
          selector,
          sourceId: targetInfo?.sourceId,
          property:
            entries.length === 1
              ? firstProperty
              : entries.map(([property]) => property).join(", "),
          previousValue: targetInfo?.computedStyles?.[firstProperty],
          nextValue:
            entries.length === 1
              ? firstValue
              : entries
                  .map(([property, value]) => `${property}: ${value}`)
                  .join("; "),
          previousContent: baseContent,
          capability: "unsupported",
          confidence: 0.3,
          status: "failed",
          error: t("designEditor.patchProof.selectorMissing"),
          createdAt: Date.now(),
        });
        return;
      }
      setPatchProof({
        id: proofId,
        fileId: activeFile.id,
        filename: activeFile.filename,
        selector,
        sourceId: selectedElement?.sourceId,
        property:
          entries.length === 1
            ? firstProperty
            : entries.map(([property]) => property).join(", "),
        previousValue: selectedElement?.computedStyles?.[firstProperty],
        nextValue:
          entries.length === 1
            ? firstValue
            : entries
                .map(([property, value]) => `${property}: ${value}`)
                .join("; "),
        previousContent: baseContent,
        capability: capability?.kind ?? "deterministic-style-edit",
        confidence: capability?.confidence ?? 0.92,
        status: "runtime",
        createdAt: Date.now(),
      });
      const sendStyleChange = (window as any).__designCanvasSendStyle;
      const runtimeStyleApplied =
        !options.runtimeApplied && typeof sendStyleChange === "function";
      if (runtimeStyleApplied) {
        const selectorCandidates = targetNode
          ? codeLayerSelectorAliases(targetNode)
          : selector
            ? [selector]
            : [];
        const nodeId = targetNode
          ? bridgeSourceIdForCodeLayerNode(targetNode)
          : targetInfo?.sourceId;
        entries.forEach(([property, value]) => {
          sendStyleChange(selector, property, value, {
            selectorCandidates,
            nodeId,
          });
        });
      }

      const nextContent = applyInlineStylesToHtml(baseContent, selector, {
        ...Object.fromEntries(entries),
      });
      // §6.4 — Breakpoint-scoped class editing. Reuses the `projection` and
      // `targetNode` resolved above for the patch-proof block (same baseContent).
      // When an active non-base breakpoint frame is set, attempt to route class
      // edits through `kind: "responsive-class"` so the write targets only that
      // breakpoint prefix (e.g. "md:text-lg" instead of "text-lg").  This fires
      // when the element has a `responsive-class` EditCapability, which signals
      // that its values come from Tailwind class tokens and can carry a prefix.
      // Falls back to `kind: "style"` (inline attribute) for any entry that
      // fails the responsive path (e.g. raw CSS values with no Tailwind utility).
      const activeBreakpointPrefix =
        activeBreakpointWidthState != null
          ? widthToPrefix(activeBreakpointWidthState)
          : null;
      // `responsive-class` is a code-layer EditCapability kind not yet reflected
      // in the ElementInfo type union (types.ts); cast to string for the check.
      const hasResponsiveCapability =
        activeBreakpointPrefix != null &&
        activeBreakpointPrefix !== "base" &&
        selectedElement?.editCapabilities?.some(
          (cap) => (cap.kind as string) === "responsive-class",
        );
      const stylePatch = entries.reduce<{
        content: string;
        failed: string | null;
      }>(
        (current, [property, value]) => {
          if (current.failed) return current;
          // Try responsive-class path first when appropriate.
          if (hasResponsiveCapability && activeBreakpointPrefix) {
            const utility = value.trim();
            if (responsiveUtilityMatchesStyleProperty(property, utility)) {
              const rcPatch = applyVisualEdit(current.content, {
                kind: "responsive-class",
                target: targetNode ? { nodeId: targetNode.id } : { selector },
                prefix: activeBreakpointPrefix,
                operation: "replace",
                utility,
                stem: utilityStem(utility),
              });
              if (rcPatch.result.status === "applied") {
                return { content: rcPatch.content, failed: null };
              }
            }
            // Responsive-class path didn't apply (e.g. value is a raw CSS value,
            // not a Tailwind utility); fall through to the inline-style path.
          }
          const patch = applyVisualEdit(current.content, {
            kind: "style",
            target: targetNode ? { nodeId: targetNode.id } : { selector },
            property,
            value,
          });
          if (patch.result.status !== "applied") {
            return {
              content: current.content,
              failed: codeLayerPatchMessage(
                patch.result.message,
                t("designEditor.patchProof.selectorMissing"),
              ),
            };
          }
          return { content: patch.content, failed: null };
        },
        { content: baseContent, failed: null },
      );
      const resolvedNextContent = stylePatch.failed
        ? nextContent
        : stylePatch.content;
      if (!resolvedNextContent) {
        setPatchProof((prev) =>
          prev?.id === proofId
            ? {
                ...prev,
                status: "failed",
                error:
                  stylePatch.failed ??
                  t("designEditor.patchProof.selectorMissing"),
              }
            : prev,
        );
        return;
      }

      const nextProjection = buildCodeLayerProjection(resolvedNextContent);
      const resolvedNode = selectedElement
        ? nextProjection.nodes.find((node) => {
            const aliases = codeLayerSelectorAliases(node);
            return (
              (selectedElement.sourceId &&
                (node.id === selectedElement.sourceId ||
                  node.dataAttributes["data-agent-native-node-id"] ===
                    selectedElement.sourceId ||
                  node.dataAttributes["data-code-layer-id"] ===
                    selectedElement.sourceId ||
                  node.dataAttributes["data-layer-id"] ===
                    selectedElement.sourceId ||
                  node.dataAttributes["data-builder-id"] ===
                    selectedElement.sourceId ||
                  node.dataAttributes["data-loc"] ===
                    selectedElement.sourceId ||
                  node.attributes.id === selectedElement.sourceId)) ||
              aliases.includes(selector) ||
              codeLayerSelectorMatches(node, selector)
            );
          })
        : null;
      const liveSnapshotUpdated = activeLiveSnapshot
        ? updateLiveScreenSnapshotContent(activeFile.id, resolvedNextContent)
        : false;
      if (liveSnapshotUpdated) {
        setPatchProof((prev) =>
          prev?.id === proofId ? { ...prev, status: "queued" } : prev,
        );
        if (!runtimeStyleApplied) {
          setContentRenderRevision((revision) => revision + 1);
        }
      } else {
        const yjsHistoryAvailable = Boolean(
          viewModeRef.current !== "overview" &&
          ydoc &&
          isSynced &&
          undoManagerRef.current,
        );
        if (
          !yjsHistoryAvailable &&
          !suppressContentHistoryRef.current &&
          baseContent !== resolvedNextContent
        ) {
          const change = {
            fileId: activeFile.id,
            before: baseContent,
            after: resolvedNextContent,
          };
          if (viewModeRef.current === "overview") {
            recordContentHistoryEntry(change);
          } else {
            recordLocalContentHistoryEntry(change);
          }
        }

        setCollabContent(resolvedNextContent);
        setCollabContentFileId(activeFile.id);
        setPatchProof((prev) =>
          prev?.id === proofId ? { ...prev, status: "queued" } : prev,
        );
        // Mark as our own write so the get-design reconcile + Yjs observe don't
        // treat the echo as an external edit and fight the live value.
        lastLocalContentRef.current = resolvedNextContent;
        latestActiveContentRef.current = resolvedNextContent;
        // Write the edit into the shared Y.Doc so other open clients see it live
        // through Yjs (not only via the slower update-file → applyText round-trip).
        // Single-screen edits use the active-file UndoManager. Overview edits are
        // tracked in the global file-content stack so all screens share one order.
        if (ydoc && isSynced) {
          const ytext = ydoc.getText("content");
          if (ytext.toString() !== resolvedNextContent) {
            ydoc.transact(
              () => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, resolvedNextContent);
              },
              yjsHistoryAvailable ? LOCAL_EDIT_ORIGIN : TAB_ID,
            );
          }
        }
        queueFileContentSave(activeFile.id, resolvedNextContent, {
          syncCollab: !(ydoc && isSynced),
        });
        if (
          shouldReplacePreviewAfterVisualStyleCommit({
            runtimeApplied: options.runtimeApplied,
            runtimeStyleApplied,
          }) &&
          !replacePreviewContent(resolvedNextContent, selector)
        ) {
          setContentRenderRevision((revision) => revision + 1);
        }
      }
      if (resolvedNode) setSelectedLayerIdsState([resolvedNode.id]);
      setSelectedElement((prev) => {
        if (options.elementInfo) return options.elementInfo;
        if (!prev) return prev;
        const stablePatch = resolvedNode
          ? {
              sourceId: bridgeSourceIdForCodeLayerNode(resolvedNode),
              selector: preferredCodeLayerSelector(resolvedNode),
              classes: resolvedNode.classes,
            }
          : {};
        return {
          ...prev,
          ...stablePatch,
          computedStyles: {
            ...prev.computedStyles,
            ...Object.fromEntries(entries),
          },
        };
      });
    },
    [
      activeContent,
      activeFile,
      activeBreakpointWidthState,
      canEditDesign,
      liveScreenSnapshotsById,
      queueFileContentSave,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      replacePreviewContent,
      selectedElement,
      t,
      updateLiveScreenSnapshotContent,
      upsertMotionKeyframesFromStyles,
      ydoc,
      isSynced,
    ],
  );

  const commitStylesToSelectedLayers = useCallback(
    (styles: Record<string, string>) => {
      if (!canEditDesign) return false;
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return false;
      const effectiveLayerState = effectiveCodeLayerStateRef.current;
      const targets = selectedLayerTargetsRef.current.filter(
        (target) =>
          !effectiveLayerState.lockedIds.has(target.fileId) &&
          !effectiveLayerState.hiddenIds.has(target.fileId) &&
          !effectiveLayerState.lockedIds.has(target.layerId) &&
          !effectiveLayerState.hiddenIds.has(target.layerId),
      );
      if (targets.length <= 1) return false;

      const targetsByFile = new Map<string, SelectedLayerTarget[]>();
      targets.forEach((target) => {
        targetsByFile.set(target.fileId, [
          ...(targetsByFile.get(target.fileId) ?? []),
          target,
        ]);
      });

      let appliedAny = false;
      targetsByFile.forEach((fileTargets, fileId) => {
        const baseContent =
          fileId === activeFile?.id
            ? getFreshActiveFileContent({
                activeContent,
                latestContent: latestActiveContentRef.current,
                lastLocalContent: lastLocalContentRef.current,
              })
            : getScreenContent(fileId);
        if (!baseContent) return;
        let nextContent = baseContent;
        let projection = buildCodeLayerProjection(nextContent);
        fileTargets.forEach((target) => {
          const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
          const selector = preferredCodeLayerSelector(target.node);
          const node =
            projection.nodes.find((candidate) =>
              codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
            ) ??
            projection.nodes.find(
              (candidate) => candidate.id === target.node.id,
            );
          if (!node) return;

          entries.forEach(([property, value]) => {
            const patch = applyVisualEdit(nextContent, {
              kind: "style",
              target: { nodeId: node.id },
              property,
              value,
            });
            if (patch.result.status !== "applied") return;
            nextContent = patch.content;
            projection = patch.projection;
          });
        });
        if (nextContent === baseContent) return;
        appliedAny = true;
        applyFileContentUpdate(fileId, nextContent, {
          refreshPreview: fileId === activeFile?.id,
        });
      });

      if (appliedAny) {
        const stylePatch = Object.fromEntries(entries);
        const primaryTarget = targets[targets.length - 1];
        if (primaryTarget) {
          setSelectedElement((previous) => {
            const previousMatches =
              previous &&
              codeLayerNodeMatchesBridgeTarget(
                primaryTarget.node,
                previous.selector,
                previous.sourceId ?? previous.id,
              );
            const base = previousMatches
              ? canonicalElementInfoForCodeLayerNode(
                  previous,
                  primaryTarget.node,
                )
              : primaryTarget.elementInfo;
            return {
              ...base,
              computedStyles: {
                ...base.computedStyles,
                ...stylePatch,
              },
            };
          });
        }
      }

      return true;
    },
    [
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
    ],
  );

  const handleStyleChange = useCallback(
    (property: string, value: string) => {
      const selector = selectedElement?.selector ?? "body";
      if (
        textEditingState.active &&
        textEditingState.hasRange &&
        textEditingState.selector === selector
      ) {
        const sendStyleChange = (window as any).__designCanvasSendStyle;
        if (typeof sendStyleChange === "function") {
          sendStyleChange(selector, property, value, {
            selectorCandidates: selectedCanvasSelectorCandidates,
            nodeId: selectedElement?.sourceId,
          });
          return;
        }
      }
      if (commitStylesToSelectedLayers({ [property]: value })) return;
      commitVisualStyles(selector, { [property]: value });
    },
    [
      commitStylesToSelectedLayers,
      commitVisualStyles,
      selectedElement?.selector,
      selectedElement?.sourceId,
      selectedCanvasSelectorCandidates,
      textEditingState.active,
      textEditingState.hasRange,
      textEditingState.selector,
    ],
  );

  const handleStylesChange = useCallback(
    (styles: Record<string, string>) => {
      const selector = selectedElement?.selector ?? "body";
      const entries = Object.entries(styles).filter(([, value]) =>
        Boolean(value),
      );
      if (entries.length === 0) return;
      if (commitStylesToSelectedLayers(Object.fromEntries(entries))) return;
      commitVisualStyles(selector, Object.fromEntries(entries));
    },
    [
      commitStylesToSelectedLayers,
      commitVisualStyles,
      selectedElement?.selector,
    ],
  );

  const getFreshActiveContent = useCallback(
    () =>
      getFreshActiveFileContent({
        activeContent,
        latestContent: latestActiveContentRef.current,
        lastLocalContent: lastLocalContentRef.current,
      }),
    [activeContent],
  );

  const handleVisualStyleChange = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
    ) => {
      if (!activeFile?.id) return;
      recordPendingVisualStyleEdit(
        activeFile.id,
        selector,
        styles,
        elementInfo,
      );
      upsertMotionKeyframesFromStyles(styles, elementInfo, selector);
    },
    [
      activeFile?.id,
      recordPendingVisualStyleEdit,
      upsertMotionKeyframesFromStyles,
    ],
  );

  const handleVisualStructureChange = useCallback(
    (
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        requestId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
      },
    ) => {
      if (!canEditDesign) return false;
      if (!activeFile) return false;
      const baseContent = getFreshActiveContent();
      const projection = buildCodeLayerProjection(baseContent);
      const resolveBridgeNode = (targetSelector: string, sourceId?: string) =>
        resolveCodeLayerNodeFromBridge(projection, targetSelector, sourceId);
      const targetInfo = elementInfo
        ? {
            ...elementInfo,
            selector,
            sourceId: details?.sourceId ?? elementInfo.sourceId,
          }
        : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveBridgeNode(selector, details?.sourceId);
      const anchorNode = resolveBridgeNode(
        anchorSelector,
        details?.anchorSourceId,
      );
      const patch = applyVisualEdit(baseContent, {
        kind: "moveNode",
        target: targetNode ? { nodeId: targetNode.id } : { selector },
        anchor: anchorNode
          ? { nodeId: anchorNode.id }
          : { selector: anchorSelector },
        placement,
      });
      if (patch.result.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            patch.result.message,
            t("designEditor.toasts.layerMoveFailed"),
          ),
          { duration: 4000 },
        );
        return false;
      }
      const movedNodeAttrId =
        targetNode?.dataAttributes["data-agent-native-node-id"] ??
        details?.sourceId ??
        elementInfo?.sourceId ??
        (patch.result.after?.nodeId
          ? patch.projection.nodes.find(
              (node) => node.id === patch.result.after?.nodeId,
            )?.dataAttributes["data-agent-native-node-id"]
          : undefined);
      const absoluteContainerOffset =
        details?.dropMode === "absolute-container" &&
        details.sourceRect &&
        details.anchorRect
          ? {
              x: details.sourceRect.x - details.anchorRect.x,
              y: details.sourceRect.y - details.anchorRect.y,
            }
          : null;
      const nextContent =
        isAbsoluteCodeLayerNode(targetNode) && movedNodeAttrId
          ? details?.dropMode === "absolute-container"
            ? absoluteContainerOffset
              ? setAbsolutePositioningForNodeInHtml(
                  patch.content,
                  movedNodeAttrId,
                  absoluteContainerOffset,
                )
              : patch.content
            : removeAbsolutePositioningFromNodeInHtml(
                patch.content,
                movedNodeAttrId,
              )
          : patch.content;
      const nextProjection = buildCodeLayerProjection(nextContent);
      const movedNode =
        (movedNodeAttrId
          ? nextProjection.nodes.find(
              (node) =>
                node.dataAttributes["data-agent-native-node-id"] ===
                movedNodeAttrId,
            )
          : null) ??
        (patch.result.after?.nodeId
          ? nextProjection.nodes.find(
              (node) => node.id === patch.result.after?.nodeId,
            )
          : null) ??
        resolveCodeLayerNodeFromBridge(
          nextProjection,
          selector,
          details?.sourceId ??
            elementInfo?.sourceId ??
            (targetNode
              ? bridgeSourceIdForCodeLayerNode(targetNode)
              : undefined),
        );
      applyLocalContentUpdate(nextContent, { skipPreview: true });
      if (movedNode) setSelectedLayerIdsState([movedNode.id]);
      if (elementInfo) {
        setSelectedElement({
          ...elementInfo,
          sourceId: movedNode
            ? bridgeSourceIdForCodeLayerNode(movedNode)
            : elementInfo.sourceId,
          selector: movedNode
            ? preferredCodeLayerSelector(movedNode)
            : elementInfo.selector,
        });
      }
      return true;
    },
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      getFreshActiveContent,
      t,
    ],
  );

  const handleVisualDuplicateChange = useCallback(
    (
      selector: string,
      cloneHtml: string,
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSelector?: string;
        anchorSourceId?: string;
        placement?: "before" | "after" | "inside";
      },
    ) => {
      if (!canEditDesign) return false;
      if (!activeFile) return false;
      const baseContent = getFreshActiveContent();
      const projection = buildCodeLayerProjection(baseContent);
      const targetInfo = elementInfo
        ? {
            ...elementInfo,
            selector,
            sourceId: details?.sourceId ?? elementInfo.sourceId,
          }
        : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveCodeLayerNodeFromBridge(
            projection,
            selector,
            details?.sourceId,
          );
      const anchorNode = resolveCodeLayerNodeFromBridge(
        projection,
        details?.anchorSelector,
        details?.anchorSourceId,
      );
      const nextContent = insertClonedHtmlLayer(baseContent, cloneHtml, {
        targetSelectors: targetNode
          ? codeLayerSelectorAliases(targetNode)
          : [selector],
        anchorSelectors: anchorNode
          ? codeLayerSelectorAliases(anchorNode)
          : details?.anchorSelector
            ? [details.anchorSelector]
            : undefined,
        placement: details?.placement ?? "after",
      });
      if (!nextContent) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return false;
      }
      applyLocalContentUpdate(nextContent, { refreshPreview: false });
      const nextProjection = buildCodeLayerProjection(nextContent);
      const nextNode = elementInfo
        ? resolveCodeLayerNodeFromElementInfo(nextProjection, elementInfo)
        : null;
      if (nextNode) {
        setSelectedLayerIdsState([nextNode.id]);
        setSelectedElement({
          ...(elementInfo ?? elementInfoFromCodeLayerNode(nextNode)),
          sourceId: bridgeSourceIdForCodeLayerNode(nextNode),
          selector: preferredCodeLayerSelector(nextNode),
        });
      } else if (elementInfo) {
        setSelectedElement(elementInfo);
      }
      return true;
    },
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      getFreshActiveContent,
      t,
    ],
  );

  const handleTextContentChange = useCallback(
    (
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: { html?: string },
    ) => {
      if (!canEditDesign) return;
      if (!activeFile) return;
      const activeLiveSnapshot = liveScreenSnapshotsById[activeFile.id];
      const baseContent = activeLiveSnapshot?.html ?? getFreshActiveContent();
      const projection = buildCodeLayerProjection(baseContent);
      const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveCodeLayerNodeFromBridge(projection, selector);
      const isEmpty = value.trim().length === 0;
      const removedContent =
        isEmpty && targetNode
          ? removeCodeLayerNodeFromHtml(baseContent, targetNode)
          : null;
      const patch = !removedContent
        ? applyVisualEdit(baseContent, {
            kind: "textContent",
            target: targetNode ? { nodeId: targetNode.id } : { selector },
            value,
            html: details?.html,
          })
        : null;
      const nextContent =
        removedContent ??
        (patch?.result.status === "applied" ? patch.content : null) ??
        updateElementContentInHtml(baseContent, selector, value, details?.html);
      if (!nextContent) {
        toast.error(
          codeLayerPatchMessage(
            patch?.result.message,
            t("designEditor.patchProof.selectorMissing"),
          ),
          { duration: 4000 },
        );
        return;
      }
      if (activeLiveSnapshot) {
        updateLiveScreenSnapshotContent(activeFile.id, nextContent);
      } else {
        applyLocalContentUpdate(nextContent, { skipPreview: true });
      }
      setActiveTool("text");
      setMode("edit");
      if (removedContent) {
        setSelectedElement(null);
        setSelectedLayerIdsState([]);
        return;
      }
      const nextProjection = buildCodeLayerProjection(nextContent);
      const nextNode = targetNode
        ? nextProjection.nodes.find((node) =>
            codeLayerNodeMatchesBridgeTarget(
              node,
              selector,
              bridgeSourceIdForCodeLayerNode(targetNode),
            ),
          )
        : null;
      if (nextNode) setSelectedLayerIdsState([nextNode.id]);
      setSelectedElement((previous) => {
        const base =
          elementInfo ??
          (previous?.selector === selector ? previous : undefined);
        return base
          ? {
              ...base,
              sourceId: nextNode
                ? bridgeSourceIdForCodeLayerNode(nextNode)
                : base.sourceId,
              selector: nextNode
                ? preferredCodeLayerSelector(nextNode)
                : selector,
              textContent: value.slice(0, 200),
              htmlContent: details?.html,
            }
          : previous;
      });
    },
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      getFreshActiveContent,
      liveScreenSnapshotsById,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const handleScreenVisualStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
    ) => {
      recordPendingVisualStyleEdit(screenId, selector, styles, elementInfo);
      if (screenId === activeFile?.id) {
        upsertMotionKeyframesFromStyles(styles, elementInfo, selector);
      }
    },
    [
      activeFile?.id,
      recordPendingVisualStyleEdit,
      upsertMotionKeyframesFromStyles,
    ],
  );

  const handleScreenVisualStructureChange = useCallback(
    (
      screenId: string,
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        requestId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
      },
    ) => {
      if (screenId === activeFile?.id) {
        return (
          handleVisualStructureChange(
            selector,
            anchorSelector,
            placement,
            elementInfo,
            details,
          ) !== false
        );
      }
      if (!canEditDesign) return false;
      const baseContent = getScreenContent(screenId);
      const projection = buildCodeLayerProjection(baseContent);
      const resolveBridgeNode = (targetSelector: string, sourceId?: string) =>
        resolveCodeLayerNodeFromBridge(projection, targetSelector, sourceId);
      const targetInfo = elementInfo
        ? {
            ...elementInfo,
            selector,
            sourceId: details?.sourceId ?? elementInfo.sourceId,
          }
        : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveBridgeNode(selector, details?.sourceId);
      const anchorNode = resolveBridgeNode(
        anchorSelector,
        details?.anchorSourceId,
      );
      const patch = applyVisualEdit(baseContent, {
        kind: "moveNode",
        target: targetNode ? { nodeId: targetNode.id } : { selector },
        anchor: anchorNode
          ? { nodeId: anchorNode.id }
          : { selector: anchorSelector },
        placement,
      });
      if (patch.result.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            patch.result.message,
            t("designEditor.toasts.layerMoveFailed"),
          ),
          { duration: 4000 },
        );
        return false;
      }
      const movedNodeAttrId =
        targetNode?.dataAttributes["data-agent-native-node-id"] ??
        details?.sourceId ??
        elementInfo?.sourceId ??
        (patch.result.after?.nodeId
          ? patch.projection.nodes.find(
              (node) => node.id === patch.result.after?.nodeId,
            )?.dataAttributes["data-agent-native-node-id"]
          : undefined);
      const absoluteContainerOffset =
        details?.dropMode === "absolute-container" &&
        details.sourceRect &&
        details.anchorRect
          ? {
              x: details.sourceRect.x - details.anchorRect.x,
              y: details.sourceRect.y - details.anchorRect.y,
            }
          : null;
      const nextContent =
        isAbsoluteCodeLayerNode(targetNode) && movedNodeAttrId
          ? details?.dropMode === "absolute-container"
            ? absoluteContainerOffset
              ? setAbsolutePositioningForNodeInHtml(
                  patch.content,
                  movedNodeAttrId,
                  absoluteContainerOffset,
                )
              : patch.content
            : removeAbsolutePositioningFromNodeInHtml(
                patch.content,
                movedNodeAttrId,
              )
          : patch.content;
      const nextProjection = buildCodeLayerProjection(nextContent);
      applyFileContentUpdate(screenId, nextContent, { skipPreview: true });
      const movedNode =
        (movedNodeAttrId
          ? nextProjection.nodes.find(
              (node) =>
                node.dataAttributes["data-agent-native-node-id"] ===
                movedNodeAttrId,
            )
          : null) ??
        resolveCodeLayerNodeFromBridge(
          nextProjection,
          selector,
          details?.sourceId ??
            elementInfo?.sourceId ??
            (targetNode
              ? bridgeSourceIdForCodeLayerNode(targetNode)
              : undefined),
        );
      if (movedNode) {
        setActiveFileId(screenId);
        setSelectedLayerIdsState([movedNode.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(movedNode));
      } else {
        setSelectedElement(null);
      }
      return true;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
      handleVisualStructureChange,
      t,
    ],
  );

  const handleScreenVisualDuplicateChange = useCallback(
    (
      screenId: string,
      selector: string,
      cloneHtml: string,
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSelector?: string;
        anchorSourceId?: string;
        placement?: "before" | "after" | "inside";
      },
    ) => {
      if (screenId === activeFile?.id) {
        return (
          handleVisualDuplicateChange(
            selector,
            cloneHtml,
            elementInfo,
            details,
          ) !== false
        );
      }
      if (!canEditDesign) return false;
      const baseContent = getScreenContent(screenId);
      const projection = buildCodeLayerProjection(baseContent);
      const targetInfo = elementInfo
        ? {
            ...elementInfo,
            selector,
            sourceId: details?.sourceId ?? elementInfo.sourceId,
          }
        : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveCodeLayerNodeFromBridge(
            projection,
            selector,
            details?.sourceId,
          );
      const anchorNode = resolveCodeLayerNodeFromBridge(
        projection,
        details?.anchorSelector,
        details?.anchorSourceId,
      );
      const nextContent = insertClonedHtmlLayer(baseContent, cloneHtml, {
        targetSelectors: targetNode
          ? codeLayerSelectorAliases(targetNode)
          : [selector],
        anchorSelectors: anchorNode
          ? codeLayerSelectorAliases(anchorNode)
          : details?.anchorSelector
            ? [details.anchorSelector]
            : undefined,
        placement: details?.placement ?? "after",
      });
      if (!nextContent) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return false;
      }
      applyFileContentUpdate(screenId, nextContent, { skipPreview: true });
      return true;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
      handleVisualDuplicateChange,
      t,
    ],
  );

  const handleScreenTextContentChange = useCallback(
    (
      screenId: string,
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: { html?: string },
    ) => {
      if (screenId === activeFile?.id) {
        handleTextContentChange(selector, value, elementInfo, details);
        return;
      }
      if (!canEditDesign) return;
      const liveSnapshot = liveScreenSnapshotsById[screenId];
      const baseContent = liveSnapshot?.html ?? getScreenContent(screenId);
      const projection = buildCodeLayerProjection(baseContent);
      const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveCodeLayerNodeFromBridge(projection, selector);
      const isEmpty = value.trim().length === 0;
      const removedContent =
        isEmpty && targetNode
          ? removeCodeLayerNodeFromHtml(baseContent, targetNode)
          : null;
      const patch = !removedContent
        ? applyVisualEdit(baseContent, {
            kind: "textContent",
            target: targetNode ? { nodeId: targetNode.id } : { selector },
            value,
            html: details?.html,
          })
        : null;
      const nextContent =
        removedContent ??
        (patch?.result.status === "applied" ? patch.content : null) ??
        updateElementContentInHtml(baseContent, selector, value, details?.html);
      if (!nextContent) {
        toast.error(
          codeLayerPatchMessage(
            patch?.result.message,
            t("designEditor.patchProof.selectorMissing"),
          ),
          { duration: 4000 },
        );
        return;
      }
      if (liveSnapshot) {
        updateLiveScreenSnapshotContent(screenId, nextContent);
      } else {
        applyFileContentUpdate(screenId, nextContent, { skipPreview: true });
      }
      setActiveFileId(screenId);
      setActiveTool("text");
      setMode("edit");
      if (removedContent) {
        setSelectedElement(null);
        setSelectedLayerIdsState([]);
        return;
      }
      const nextProjection = buildCodeLayerProjection(nextContent);
      const nextNode = targetNode
        ? nextProjection.nodes.find((node) =>
            codeLayerNodeMatchesBridgeTarget(
              node,
              selector,
              bridgeSourceIdForCodeLayerNode(targetNode),
            ),
          )
        : null;
      if (nextNode) setSelectedLayerIdsState([nextNode.id]);
      setSelectedElement((previous) => {
        const base =
          elementInfo ??
          (previous?.selector === selector ? previous : undefined);
        return base
          ? {
              ...base,
              sourceId: nextNode
                ? bridgeSourceIdForCodeLayerNode(nextNode)
                : base.sourceId,
              selector: nextNode
                ? preferredCodeLayerSelector(nextNode)
                : selector,
              textContent: value.slice(0, 200),
              htmlContent: details?.html,
            }
          : previous;
      });
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
      handleTextContentChange,
      liveScreenSnapshotsById,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const getSelectedLayerSnapshots = useCallback(() => {
    const fileIds = new Set(files.map((file) => file.id));
    const candidateIds = selectedLayerIdsState.filter(
      (layerId) =>
        layerId && !layerId.startsWith("__") && !fileIds.has(layerId),
    );
    if (
      selectedElementLayerId &&
      !candidateIds.includes(selectedElementLayerId)
    ) {
      candidateIds.push(selectedElementLayerId);
    }

    const snapshots: SelectedCanvasLayerSnapshot[] = [];
    for (const file of files) {
      const content = getScreenContent(file.id);
      if (!content) continue;
      const projection = buildCodeLayerProjection(content);
      const tree = buildCodeLayerTree(projection);
      for (const layerId of candidateIds) {
        const node = projection.nodes.find(
          (candidate) =>
            candidate.id === layerId ||
            candidate.dataAttributes["data-agent-native-node-id"] === layerId,
        );
        if (!node?.source) continue;
        const portableStyleSnapshot =
          selectedElementLayerId &&
          node.id === selectedElementLayerId &&
          selectedElement?.portableStyleSnapshot
            ? selectedElement.portableStyleSnapshot
            : undefined;
        snapshots.push({
          html: content.slice(node.source.start, node.source.end),
          rootNodeId:
            node.dataAttributes["data-agent-native-node-id"] ?? node.id,
          sourceFileId: file.id,
          portableStyleSnapshot,
          node,
          sourceIndex: node.source.start,
          tree,
        });
      }
    }

    if (snapshots.length === 0 && activeFile && selectedElement?.selector) {
      const content = getFreshActiveContent();
      const projection = buildCodeLayerProjection(content);
      const tree = buildCodeLayerTree(projection);
      const node = resolveCodeLayerNodeFromElementInfo(
        projection,
        selectedElement,
      );
      const html = node?.source
        ? content.slice(node.source.start, node.source.end)
        : getElementOuterHtml(content, selectedElement.selector);
      if (html && node) {
        snapshots.push({
          html,
          rootNodeId:
            node.dataAttributes["data-agent-native-node-id"] ??
            selectedElement.sourceId ??
            selectedElement.id,
          sourceFileId: activeFile.id,
          portableStyleSnapshot: selectedElement.portableStyleSnapshot,
          node,
          sourceIndex: node.source?.start ?? Number.MAX_SAFE_INTEGER,
          tree,
        });
      }
    }

    const selectedKeys = new Set(
      snapshots.map(
        (snapshot) => `${snapshot.sourceFileId}:${snapshot.node.id}`,
      ),
    );
    const topLevelSnapshots = snapshots.filter(
      (snapshot) =>
        !collectCodeLayerAncestors(snapshot.tree, snapshot.node.id).some(
          (ancestorId) =>
            selectedKeys.has(`${snapshot.sourceFileId}:${ancestorId}`),
        ),
    );
    const fileOrder = new Map(files.map((file, index) => [file.id, index]));
    return topLevelSnapshots.sort((a, b) => {
      const fileDelta =
        (fileOrder.get(a.sourceFileId) ?? 0) -
        (fileOrder.get(b.sourceFileId) ?? 0);
      if (fileDelta !== 0) return fileDelta;
      return a.sourceIndex - b.sourceIndex;
    });
  }, [
    activeFile,
    files,
    getFreshActiveContent,
    getScreenContent,
    selectedElement,
    selectedElementLayerId,
    selectedLayerIdsState,
  ]);

  const getCanvasClipboardEntries = useCallback(() => {
    if (copiedLayerEntriesRef.current.length > 0) {
      return copiedLayerEntriesRef.current;
    }
    return copiedLayerHtmlRef.current
      ? [
          {
            html: copiedLayerHtmlRef.current,
            sourceFileId: activeFile?.id ?? "",
          },
        ]
      : [];
  }, [activeFile?.id]);

  const selectInsertedLayers = useCallback(
    (screenId: string, content: string, rootNodeIds: string[]) => {
      const projection = buildCodeLayerProjection(content);
      const insertedNodes = rootNodeIds
        .map((rootNodeId) =>
          projection.nodes.find(
            (node) =>
              node.id === rootNodeId ||
              node.dataAttributes["data-agent-native-node-id"] === rootNodeId,
          ),
        )
        .filter((node): node is CodeLayerNode => Boolean(node));
      if (insertedNodes.length === 0) return;
      const lastNode = insertedNodes[insertedNodes.length - 1];
      if (lastNode) {
        pendingOverviewScreenSelectionRef.current =
          screenId === boardFileId ? null : screenId;
        pendingOverviewLayerSelectionRef.current = lastNode.id;
        clearPendingOverviewLayerSelectionTimer();
        setCreatedOverviewLayerSelection({
          screenId,
          layerId: lastNode.id,
        });
      }
      setActiveFileId(screenId);
      setSelectedLayerIdsState(insertedNodes.map((node) => node.id));
      setSelectedElement(
        lastNode ? elementInfoFromCodeLayerNode(lastNode) : null,
      );
      setActiveTool("move");
      setMode("edit");
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds(
          screenId === boardFileId ? [] : [screenId],
        );
      }
    },
    [boardFileId, clearPendingOverviewLayerSelectionTimer],
  );

  const handleCopySelection = useCallback(async () => {
    const entries = getSelectedLayerSnapshots().map((snapshot) => ({
      html: snapshot.html,
      rootNodeId: snapshot.rootNodeId,
      sourceFileId: snapshot.sourceFileId,
      portableStyleSnapshot: snapshot.portableStyleSnapshot,
    }));
    if (entries.length === 0) return;
    const clipboardText = entries.map((entry) => entry.html).join("\n");
    copiedLayerEntriesRef.current = entries;
    copiedLayerHtmlRef.current = clipboardText;
    pasteCascadeRef.current = 0;
    setHasCanvasClipboard(true);
    try {
      await navigator.clipboard.writeText(clipboardText);
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [getSelectedLayerSnapshots, t]);

  const handlePasteSelection = useCallback(
    (position?: { x: number; y: number }) => {
      const entries = getCanvasClipboardEntries();
      const targetFileId =
        viewModeRef.current === "overview" && position && boardFileId
          ? boardFileId
          : activeFile?.id;
      if (!targetFileId || !canEditDesign || entries.length === 0) return;
      const baseContent =
        targetFileId === activeFile?.id
          ? getFreshActiveContent()
          : (getScreenContent(targetFileId) ?? "");
      if (!baseContent && targetFileId !== boardFileId) return;
      const layerHtmls = entries.map((entry) => entry.html);
      const styleSnapshots = entries.map(
        (entry) => entry.portableStyleSnapshot,
      );
      const applyPasteContentUpdate = (nextContent: string) => {
        if (targetFileId === activeFile?.id) {
          applyLocalContentUpdate(nextContent, {
            forcePreviewFullDocument: true,
          });
          return;
        }
        applyFileContentUpdate(targetFileId, nextContent, {
          forcePreviewFullDocument: true,
        });
      };

      // B7 fix: when an element is selected and no explicit canvas position was
      // given, insert the clone as an in-flow sibling right AFTER the selected
      // element.  Strip any position/left/top from the clone so it participates
      // in normal document flow instead of being an absolutely-positioned body
      // child.  Fall back to the old position-based clone when nothing is
      // selected or a "Paste here" position is provided.
      if (
        !position &&
        targetFileId !== boardFileId &&
        selectedElement?.selector
      ) {
        const selector = selectedCanvasSelector ?? selectedElement.selector;
        const result = insertClonedHtmlLayers(baseContent, layerHtmls, {
          targetSelectors: [selector],
          placement: "after",
          stripRootPosition: true,
          styleSnapshots,
        });
        if (result) {
          pasteCascadeRef.current += 1;
          applyPasteContentUpdate(result.content);
          selectInsertedLayers(
            targetFileId,
            result.content,
            result.rootNodeIds,
          );
          return;
        }
        // Fall through to position-based clone if insert failed.
      }

      // Explicit positions (e.g. "Paste here" at the cursor) are honored as-is.
      // Keyboard pastes land near the source layer and cascade so repeats don't
      // stack exactly.
      const sourcePositions = entries.map((entry) =>
        extractLayerPosition(entry.html),
      );
      const positionedSources = sourcePositions.filter(
        (source): source is { x: number; y: number } => Boolean(source),
      );
      const minSourceX = positionedSources.length
        ? Math.min(...positionedSources.map((source) => source.x))
        : 0;
      const minSourceY = positionedSources.length
        ? Math.min(...positionedSources.map((source) => source.y))
        : 0;
      const cascadeOffset = pasteCascadeRef.current * 16;
      const positions = entries.map((_, index) => {
        const source = sourcePositions[index];
        if (position) {
          return source && positionedSources.length
            ? {
                x: position.x + source.x - minSourceX,
                y: position.y + source.y - minSourceY,
              }
            : { x: position.x + index * 16, y: position.y + index * 16 };
        }
        return source
          ? {
              x: source.x + 10 + cascadeOffset,
              y: source.y + 10 + cascadeOffset,
            }
          : {
              x: 120 + cascadeOffset + index * 16,
              y: 120 + cascadeOffset + index * 16,
            };
      });
      const result = insertClonedHtmlLayers(baseContent, layerHtmls, {
        positions,
        styleSnapshots,
      });
      if (!result) return;
      if (!position) pasteCascadeRef.current += 1;
      applyPasteContentUpdate(result.content);
      selectInsertedLayers(targetFileId, result.content, result.rootNodeIds);
    },
    [
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      getCanvasClipboardEntries,
      getFreshActiveContent,
      getScreenContent,
      selectInsertedLayers,
      selectedCanvasSelector,
      selectedElement,
    ],
  );

  const handlePasteOverSelection = useCallback(() => {
    const entries = getCanvasClipboardEntries();
    if (!activeFile || entries.length === 0) return;
    const baseContent = getFreshActiveContent();
    if (selectedElement?.boundingRect) {
      const { x, y } = selectedElement.boundingRect;
      const result = insertClonedHtmlLayers(
        baseContent,
        entries.map((entry) => entry.html),
        {
          positions: entries.map((_, index) => ({
            x: x + index * 16,
            y: y + index * 16,
          })),
          styleSnapshots: entries.map((entry) => entry.portableStyleSnapshot),
        },
      );
      if (!result) return;
      applyLocalContentUpdate(result.content, {
        forcePreviewFullDocument: true,
      });
      selectInsertedLayers(activeFile.id, result.content, result.rootNodeIds);
    } else {
      handlePasteSelection();
    }
  }, [
    activeFile,
    applyLocalContentUpdate,
    boardFileId,
    getCanvasClipboardEntries,
    getFreshActiveContent,
    handlePasteSelection,
    selectInsertedLayers,
    selectedElement,
  ]);

  const handleDuplicateSelection = useCallback(() => {
    if (!canEditDesign) return;
    const snapshots = getSelectedLayerSnapshots();
    if (snapshots.length > 0) {
      const selectedIds: string[] = [];
      const selectedScreenIds: string[] = [];
      let lastActiveNode: CodeLayerNode | null = null;

      for (const file of files) {
        const group = snapshots.filter(
          (snapshot) => snapshot.sourceFileId === file.id,
        );
        if (group.length === 0) continue;
        let content = getScreenContent(file.id);
        const insertedRootNodeIds: string[] = [];
        for (const snapshot of [...group].sort(
          (a, b) => b.sourceIndex - a.sourceIndex,
        )) {
          const projection = buildCodeLayerProjection(content);
          const anchorNode =
            projection.nodes.find(
              (node) =>
                node.id === snapshot.node.id ||
                node.dataAttributes["data-agent-native-node-id"] ===
                  snapshot.rootNodeId,
            ) ?? snapshot.node;
          const result = insertClonedHtmlLayers(content, [snapshot.html], {
            targetSelectors: codeLayerSelectorAliases(anchorNode),
            placement: "after",
            stripRootPosition: true,
          });
          if (!result) continue;
          content = result.content;
          insertedRootNodeIds.unshift(...result.rootNodeIds);
        }
        if (insertedRootNodeIds.length === 0) continue;
        applyFileContentUpdate(file.id, content, {
          forcePreviewFullDocument: true,
          refreshPreview: false,
        });
        selectedScreenIds.push(file.id);
        const finalProjection = buildCodeLayerProjection(content);
        insertedRootNodeIds.forEach((rootNodeId) => {
          const insertedNode = finalProjection.nodes.find(
            (node) =>
              node.id === rootNodeId ||
              node.dataAttributes["data-agent-native-node-id"] === rootNodeId,
          );
          if (!insertedNode) return;
          selectedIds.push(insertedNode.id);
          if (file.id === activeFile?.id) lastActiveNode = insertedNode;
        });
      }

      if (selectedIds.length > 0) {
        setSelectedLayerIdsState(selectedIds);
        setSelectedElement(
          lastActiveNode ? elementInfoFromCodeLayerNode(lastActiveNode) : null,
        );
        if (viewModeRef.current === "overview") {
          setOverviewSelectedScreenIds(selectedScreenIds);
        }
        return;
      }
    }

    if (selectedElement?.selector) {
      const baseContent = getFreshActiveContent();
      const html = getElementOuterHtml(baseContent, selectedElement.selector);
      if (!html) {
        toast.error(t("designEditor.toasts.duplicateElementFailed"));
        return;
      }
      // B7 fix: duplicate inserts the clone as an in-flow sibling right AFTER
      // the original — not as an absolutely-positioned body child.  Strip
      // position/left/top so it joins normal document flow.
      const selector = selectedCanvasSelector ?? selectedElement.selector;
      const strippedHtml = (() => {
        try {
          const parser = new DOMParser();
          const tmp = parser.parseFromString(
            `<template>${html}</template>`,
            "text/html",
          );
          const root =
            tmp.querySelector("template")?.content.firstElementChild ??
            tmp.body.firstElementChild;
          if (root && root instanceof HTMLElement) {
            root.style.position = "";
            root.style.left = "";
            root.style.top = "";
            root.style.right = "";
            root.style.bottom = "";
          }
          return root?.outerHTML ?? html;
        } catch {
          return html;
        }
      })();
      const nextContent = insertClonedHtmlLayer(baseContent, strippedHtml, {
        targetSelectors: [selector],
        placement: "after",
      });
      if (nextContent) {
        applyLocalContentUpdate(nextContent, {
          forcePreviewFullDocument: true,
        });
      } else {
        toast.error(t("designEditor.toasts.duplicateElementFailed"));
      }
      return;
    }
    if (activeFile) handleDuplicateScreen(activeFile.id);
  }, [
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    canEditDesign,
    files,
    getFreshActiveContent,
    getScreenContent,
    getSelectedLayerSnapshots,
    handleDuplicateScreen,
    selectedCanvasSelector,
    selectedElement,
    t,
  ]);

  const handleDeleteSelection = useCallback(() => {
    if (!canEditDesign) return;
    const snapshots = getSelectedLayerSnapshots();
    if (snapshots.length > 0) {
      const activeRuntimeSelectors: string[] = [];
      let didDelete = false;
      for (const file of files) {
        const group = snapshots.filter(
          (snapshot) => snapshot.sourceFileId === file.id,
        );
        if (group.length === 0) continue;
        const originalContent = getScreenContent(file.id);
        let content = originalContent;
        const projection = buildCodeLayerProjection(content);
        const tree = buildCodeLayerTree(projection);
        const selectedNodeIds = new Set(
          group.map((snapshot) => snapshot.node.id),
        );
        const nodes = group
          .map((snapshot) =>
            projection.nodes.find(
              (node) =>
                node.id === snapshot.node.id ||
                node.dataAttributes["data-agent-native-node-id"] ===
                  snapshot.rootNodeId,
            ),
          )
          .filter((node): node is CodeLayerNode => Boolean(node?.source))
          .filter(
            (node) =>
              !collectCodeLayerAncestors(tree, node.id).some((ancestorId) =>
                selectedNodeIds.has(ancestorId),
              ),
          )
          .sort((a, b) => (b.source?.start ?? 0) - (a.source?.start ?? 0));
        if (nodes.length === 0) continue;
        const removedSelectors: string[] = [];
        for (const node of nodes) {
          const next = removeCodeLayerNodeFromHtml(content, node);
          if (!next) continue;
          const selector = preferredCodeLayerSelector(node);
          if (selector) removedSelectors.push(selector);
          content = next;
        }
        if (content === originalContent) continue;
        if (file.id === activeFile?.id) {
          activeRuntimeSelectors.push(...removedSelectors);
        }
        didDelete = true;
        applyFileContentUpdate(file.id, content, { refreshPreview: false });
      }
      if (!didDelete) return;
      activeRuntimeSelectors.forEach((selector) =>
        deleteRuntimeElement(selector),
      );
      setSelectedElement(null);
      setSelectedLayerIdsState([]);
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      return;
    }

    if (!selectedElement?.selector) return;
    const baseContent = getFreshActiveContent();
    const nextContent = removeElementFromHtml(
      baseContent,
      selectedElement.selector,
    );
    if (!nextContent) return;
    deleteRuntimeElement(selectedElement.selector);
    applyLocalContentUpdate(nextContent, { refreshPreview: false });
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
  }, [
    activeFile?.id,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    canEditDesign,
    deleteRuntimeElement,
    files,
    getFreshActiveContent,
    getScreenContent,
    getSelectedLayerSnapshots,
    selectedElement,
  ]);

  // Wrap the current multi-layer selection into a new group container.
  const handleGroupSelection = useCallback(() => {
    if (!canEditDesign || !activeFile) return;
    const baseContent = getFreshActiveContent();
    // Collect the DOM-node layer ids that belong to the active screen.
    // Build a set of ids present in the active content so stale ids from
    // other files (which can persist in selectedLayerIdsState after a
    // cross-screen layers-panel selection) are excluded before wrapNodes
    // runs against activeContent. Without this filter, cross-file ids
    // cause wrapNodes to return "conflict" even for a valid same-file
    // selection.
    const fileIds = new Set(files.map((f) => f.id));
    const activeNodeIdSet = buildActiveFileNodeIdSet(
      buildCodeLayerProjection(baseContent),
    );
    const nodeIds = selectedLayerIdsState.filter(
      (id) =>
        !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
    );
    if (nodeIds.length < 2) return;
    const patch = applyVisualEdit(baseContent, {
      kind: "wrapNodes",
      targetIds: nodeIds,
      autoLayout: false,
    });
    if (patch.result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          patch.result.message,
          t("designEditor.toasts.layerMoveFailed"),
        ),
        { duration: 4000 },
      );
      return;
    }
    applyLocalContentUpdate(patch.content, { skipPreview: true });
    // Select the new wrapper node if the substrate reported its id.
    const wrapperId = patch.result.wrapperNodeId;
    if (wrapperId) {
      // Find the projection node whose data-agent-native-node-id matches.
      const wrapperNode = patch.projection.nodes.find(
        (n) => n.dataAttributes["data-agent-native-node-id"] === wrapperId,
      );
      if (wrapperNode) {
        setSelectedLayerIdsState([wrapperNode.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
      }
    }
  }, [
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    files,
    getFreshActiveContent,
    selectedLayerIdsState,
    t,
  ]);

  // Unwrap the currently selected single-container layer.
  const handleUngroupSelection = useCallback(() => {
    if (!canEditDesign || !activeFile) return;
    const baseContent = getFreshActiveContent();
    // Filter to active-file nodes only (mirrors handleGroupSelection fix).
    // A stale id from another file must not be passed to unwrap or it will
    // fail with "conflict" even though the actual selection is valid.
    const fileIds = new Set(files.map((f) => f.id));
    const activeNodeIdSet = buildActiveFileNodeIdSet(
      buildCodeLayerProjection(baseContent),
    );
    const nodeIds = selectedLayerIdsState.filter(
      (id) =>
        !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
    );
    const targetId = nodeIds[0];
    if (!targetId) return;
    const patch = applyVisualEdit(baseContent, {
      kind: "unwrap",
      targetId,
    });
    if (patch.result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          patch.result.message,
          t("designEditor.toasts.layerMoveFailed"),
        ),
        { duration: 4000 },
      );
      return;
    }
    applyLocalContentUpdate(patch.content, { skipPreview: true });
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
  }, [
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    files,
    getFreshActiveContent,
    selectedLayerIdsState,
    t,
  ]);

  /**
   * Handle a primitive being drag-dropped onto another primitive in the
   * MultiScreenCanvas overview (CONTRACT: onPrimitiveReparent prop).
   *
   * Same-screen: applies a moveNode intent then rebases the moved node's
   * absolute coordinates relative to the target rectangle. Cross-screen uses
   * moveNodeBetweenDocuments and persists both files.
   */
  const handleOverviewPrimitiveReparent = useCallback(
    ({
      sourceNodeId,
      sourceScreenId,
      targetNodeId,
      targetScreenId,
    }: {
      sourceNodeId: string;
      sourceScreenId: string;
      targetNodeId: string;
      targetScreenId: string;
      placement: "inside";
    }) => {
      if (!canEditDesign) return;

      if (sourceScreenId === targetScreenId) {
        // --- Same-screen reparent ---
        const baseContent = getScreenContent(sourceScreenId);
        if (!baseContent) return;

        // 1. Move the node inside the target container.
        const movePatch = applyVisualEdit(baseContent, {
          kind: "moveNode",
          target: { nodeId: sourceNodeId },
          anchor: { nodeId: targetNodeId },
          placement: "inside",
        });
        if (movePatch.result.status !== "applied") {
          toast.error(
            codeLayerPatchMessage(
              movePatch.result.message,
              t("designEditor.toasts.layerMoveFailed"),
            ),
            { duration: 4000 },
          );
          return;
        }

        const movedNodeAttrId =
          movePatch.projection.nodes.find(
            (n) =>
              n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
              n.id === sourceNodeId,
          )?.dataAttributes["data-agent-native-node-id"] ?? sourceNodeId;
        const sourcePosition = getAbsolutePositioningForNodeInHtml(
          baseContent,
          sourceNodeId,
        );
        const targetPosition = getAbsolutePositioningForNodeInHtml(
          baseContent,
          targetNodeId,
        );
        const nextContent =
          sourcePosition && targetPosition
            ? setAbsolutePositioningForNodeInHtml(
                movePatch.content,
                movedNodeAttrId,
                {
                  x: sourcePosition.x - targetPosition.x,
                  y: sourcePosition.y - targetPosition.y,
                },
              )
            : movePatch.content;

        applyFileContentUpdate(sourceScreenId, nextContent, {
          skipPreview: true,
        });

        // Re-select the moved node.
        const nextProjection = buildCodeLayerProjection(nextContent);
        const movedNodeAfter = nextProjection.nodes.find(
          (n) =>
            n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
            n.id === sourceNodeId,
        );
        if (movedNodeAfter) {
          setSelectedLayerIdsState([movedNodeAfter.id]);
          setSelectedElement(elementInfoFromCodeLayerNode(movedNodeAfter));
        }
        return;
      }

      // --- Cross-screen reparent ---
      const sourceContent = getScreenContent(sourceScreenId);
      const destContent = getScreenContent(targetScreenId);
      if (!sourceContent || !destContent) return;

      // Resolve data-agent-native-node-id attributes for moveNodeBetweenDocuments.
      const sourceProjection = buildCodeLayerProjection(sourceContent);
      const destProjection = buildCodeLayerProjection(destContent);
      const sourceNode = sourceProjection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
          n.id === sourceNodeId,
      );
      const anchorNode = destProjection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] === targetNodeId ||
          n.id === targetNodeId,
      );
      const nodeAttrId =
        sourceNode?.dataAttributes["data-agent-native-node-id"] ?? sourceNodeId;
      const anchorAttrId =
        anchorNode?.dataAttributes["data-agent-native-node-id"] ?? targetNodeId;

      const result = moveNodeBetweenDocuments(sourceContent, destContent, {
        nodeId: nodeAttrId,
        anchorNodeId: anchorAttrId,
        placement: "inside",
      });
      if (result.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            result.message,
            t("designEditor.toasts.layerMoveFailed"),
          ),
          { duration: 4000 },
        );
        return;
      }

      const destNodeAttrId = result.movedNodeId ?? nodeAttrId;
      const sourcePosition = getAbsolutePositioningForNodeInHtml(
        sourceContent,
        nodeAttrId,
      );
      const targetPosition = getAbsolutePositioningForNodeInHtml(
        destContent,
        anchorAttrId,
      );
      const nextDestContent =
        sourcePosition && targetPosition
          ? setAbsolutePositioningForNodeInHtml(
              result.destHtml,
              destNodeAttrId,
              {
                x: sourcePosition.x - targetPosition.x,
                y: sourcePosition.y - targetPosition.y,
              },
            )
          : result.destHtml;

      recordContentHistoryEntry({
        changes: [
          {
            fileId: sourceScreenId,
            before: sourceContent,
            after: result.sourceHtml,
          },
          {
            fileId: targetScreenId,
            before: destContent,
            after: nextDestContent,
          },
        ],
      });

      applyFileContentUpdate(sourceScreenId, result.sourceHtml, {
        recordHistory: false,
        refreshPreview: true,
      });
      applyFileContentUpdate(targetScreenId, nextDestContent, {
        recordHistory: false,
        refreshPreview: true,
      });

      // Re-select the moved node in the destination.
      const finalProjection = buildCodeLayerProjection(nextDestContent);
      const movedNodeFinal = finalProjection.nodes.find(
        (n) => n.dataAttributes["data-agent-native-node-id"] === destNodeAttrId,
      );
      if (movedNodeFinal) {
        setSelectedLayerIdsState([movedNodeFinal.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(movedNodeFinal));
      }
    },
    [
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
      recordContentHistoryEntry,
      t,
    ],
  );

  /**
   * Cross-screen element drag-drop handler (CONTRACT: onCrossScreenElementDrop
   * prop on MultiScreenCanvas).
   *
   * The bridge in the source screen's iframe posts phase:"end" with the
   * selector / sourceNodeId of the dragged element.  MultiScreenCanvas maps
   * the board point to a target screen, optionally runs a hit-test in the
   * target iframe to resolve an anchorNodeId and placement, then calls this
   * handler.  We resolve both screens' content, identify the node by its
   * data-agent-native-node-id (falling back to a projection lookup by selector
   * when only the selector is available), call moveNodeBetweenDocuments with
   * the anchor from the hit-test (or top-level "inside" fallback), persist
   * both files, switch the active screen to the target, and select the moved
   * node — keeping viewMode "overview" throughout.
   */
  const handleCrossScreenElementDrop = useCallback(
    ({
      sourceSelector,
      sourceNodeId,
      sourceScreenId,
      targetScreenId,
      targetAnchorNodeId,
      targetAnchorPlacement,
      targetDropMode,
      targetAnchorRect,
      targetLocalPoint,
      sourcePointerOffset,
      styleSnapshot,
    }: {
      sourceSelector: string;
      sourceNodeId?: string;
      sourceScreenId: string;
      targetScreenId: string;
      targetAnchorNodeId?: string;
      targetAnchorPlacement?: "before" | "after" | "inside";
      targetDropMode?: "flow-insert" | "absolute-container";
      targetAnchorRect?: {
        left: number;
        top: number;
        width: number;
        height: number;
      };
      targetCanvasPoint?: { x: number; y: number };
      targetLocalPoint?: { x: number; y: number };
      sourcePointerOffset?: { x: number; y: number };
      styleSnapshot?: PortableStyleSnapshot;
    }) => {
      if (!canEditDesign) return;
      if (sourceScreenId === targetScreenId) return;

      const sourceContent = getScreenContent(sourceScreenId);
      const destContent = getScreenContent(targetScreenId);
      if (!sourceContent || !destContent) return;

      // Resolve the data-agent-native-node-id that moveNodeBetweenDocuments
      // uses as a stable key.  Prefer the bridge-supplied sourceNodeId when it
      // looks like a node-attr id; otherwise look up via selector projection.
      const sourceProjection = buildCodeLayerProjection(sourceContent);
      const resolvedSourceNode = sourceNodeId
        ? (sourceProjection.nodes.find(
            (n) =>
              n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
              n.id === sourceNodeId,
          ) ??
          resolveCodeLayerNodeFromBridge(
            sourceProjection,
            sourceSelector,
            sourceNodeId,
          ))
        : resolveCodeLayerNodeFromBridge(sourceProjection, sourceSelector);
      const nodeAttrId =
        resolvedSourceNode?.dataAttributes["data-agent-native-node-id"] ??
        sourceNodeId ??
        sourceSelector;
      const destProjection = buildCodeLayerProjection(destContent);
      const resolvedTargetAnchor = targetAnchorNodeId
        ? resolveCodeLayerNodeFromBridge(
            destProjection,
            undefined,
            targetAnchorNodeId,
          )
        : null;
      const targetAnchorAttrId =
        resolvedTargetAnchor?.dataAttributes["data-agent-native-node-id"];

      // Use hit-test anchor when the canvas supplied one; fall back to
      // top-level body append ("inside" with no anchor = existing behaviour).
      const result = moveNodeBetweenDocuments(sourceContent, destContent, {
        nodeId: nodeAttrId,
        ...(targetAnchorAttrId
          ? {
              anchorNodeId: targetAnchorAttrId,
              placement: targetAnchorPlacement ?? "inside",
            }
          : { placement: "inside" }),
      });
      if (result.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            result.message,
            t("designEditor.toasts.layerMoveFailed"),
          ),
          { duration: 4000 },
        );
        return;
      }

      // Hit-test anchors are emitted only for auto-layout insertion targets. If
      // there is no anchor, preserve absolute mode and rebase left/top to the
      // release point so screen↔board moves behave like Figma absolute layers.
      const destNodeAttrId = result.movedNodeId ?? nodeAttrId;
      const stylePreservedDest = applyPortableStyleSnapshotToHtml(
        result.destHtml,
        destNodeAttrId,
        styleSnapshot,
      );
      const nextDestContent = targetAnchorAttrId
        ? targetDropMode === "absolute-container"
          ? targetLocalPoint && targetAnchorRect
            ? setAbsolutePositioningForNodeInHtml(
                stylePreservedDest,
                destNodeAttrId,
                {
                  x: targetLocalPoint.x - targetAnchorRect.left,
                  y: targetLocalPoint.y - targetAnchorRect.top,
                },
                sourcePointerOffset,
              )
            : stylePreservedDest
          : removeAbsolutePositioningFromNodeInHtml(
              stylePreservedDest,
              destNodeAttrId,
            )
        : targetLocalPoint
          ? setAbsolutePositioningForNodeInHtml(
              stylePreservedDest,
              destNodeAttrId,
              targetLocalPoint,
              sourcePointerOffset,
            )
          : stylePreservedDest;

      recordContentHistoryEntry({
        changes: [
          {
            fileId: sourceScreenId,
            before: sourceContent,
            after: result.sourceHtml,
          },
          {
            fileId: targetScreenId,
            before: destContent,
            after: nextDestContent,
          },
        ],
      });

      applyFileContentUpdate(sourceScreenId, result.sourceHtml, {
        recordHistory: false,
        refreshPreview: true,
      });
      applyFileContentUpdate(targetScreenId, nextDestContent, {
        recordHistory: false,
        refreshPreview: true,
      });

      // Switch active screen to the target and select the moved node; viewMode
      // stays "overview" (no setViewMode call).
      pendingOverviewScreenSelectionRef.current =
        targetScreenId === boardFileId ? null : targetScreenId;
      pendingOverviewLayerSelectionRef.current = destNodeAttrId;
      clearPendingOverviewLayerSelectionTimer();
      setActiveFileId(targetScreenId);
      const finalProjection = buildCodeLayerProjection(nextDestContent);
      const movedNodeFinal = finalProjection.nodes.find(
        (n) => n.dataAttributes["data-agent-native-node-id"] === destNodeAttrId,
      );
      if (movedNodeFinal) {
        setCreatedOverviewLayerSelection({
          screenId: targetScreenId,
          layerId: movedNodeFinal.id,
        });
        setSelectedLayerIdsState([movedNodeFinal.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(movedNodeFinal));
        if (viewModeRef.current === "overview") {
          setOverviewSelectedScreenIds(
            targetScreenId === boardFileId ? [] : [targetScreenId],
          );
        }
      }
    },
    [
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      clearPendingOverviewLayerSelectionTimer,
      getScreenContent,
      recordContentHistoryEntry,
      t,
    ],
  );

  const handleCutSelection = useCallback(async () => {
    if (!selectedElement?.selector) return;
    // Copy first (populates the internal clipboard ref even if the async
    // navigator.clipboard write is blocked — handleCopySelection swallows that
    // error) then remove the element so a subsequent paste can re-insert it.
    await handleCopySelection();
    handleDeleteSelection();
  }, [handleCopySelection, handleDeleteSelection, selectedElement]);

  const handleDeleteOverviewSelection = useCallback(
    (selectedIds: string[]) => {
      if (!canEditDesign) return false;
      if (!selectedIds.length || files.length <= 1) return false;

      const selectedIdSet = new Set(selectedIds);
      const selectedFiles = files.filter((file) => selectedIdSet.has(file.id));
      if (!selectedFiles.length) return false;

      const maxDeleteCount =
        selectedFiles.length >= files.length
          ? Math.max(0, files.length - 1)
          : selectedFiles.length;
      const filesToDelete = selectedFiles.slice(0, maxDeleteCount);
      if (!filesToDelete.length) return false;

      const deleteIds = new Set(filesToDelete.map((file) => file.id));
      const nextActiveFile = files.find((file) => !deleteIds.has(file.id));
      const nextGeometry = cloneCanvasFrameGeometry(canvasFrameGeometryById);
      filesToDelete.forEach((file) => {
        delete nextGeometry[file.id];
      });

      const nextGeometryUndoStack: GeometryHistoryEntry[] = [];
      let removedGeometryUndoEntries = 0;
      geometryUndoStackRef.current.forEach((entry) => {
        if (geometryHistoryEntryTouchesFrameIds(entry, deleteIds)) {
          removedGeometryUndoEntries += 1;
          return;
        }
        nextGeometryUndoStack.push(entry);
      });
      geometryUndoStackRef.current = nextGeometryUndoStack;
      historyOrderRef.current = removeRecentUndoRedoOrderKinds(
        historyOrderRef.current,
        "geometry",
        removedGeometryUndoEntries,
      );

      const nextGeometryRedoStack: GeometryHistoryEntry[] = [];
      let removedGeometryRedoEntries = 0;
      geometryRedoStackRef.current.forEach((entry) => {
        if (geometryHistoryEntryTouchesFrameIds(entry, deleteIds)) {
          removedGeometryRedoEntries += 1;
          return;
        }
        nextGeometryRedoStack.push(entry);
      });
      geometryRedoStackRef.current = nextGeometryRedoStack;
      redoOrderRef.current = removeRecentUndoRedoOrderKinds(
        redoOrderRef.current,
        "geometry",
        removedGeometryRedoEntries,
      );

      const nextContentUndoStack: ContentHistoryEntry[] = [];
      let removedContentUndoEntries = 0;
      contentUndoStackRef.current.forEach((entry) => {
        const remainingChanges = getContentHistoryChanges(entry).filter(
          (change) => !deleteIds.has(change.fileId),
        );
        if (remainingChanges.length === 0) {
          removedContentUndoEntries += 1;
          return;
        }
        nextContentUndoStack.push(
          remainingChanges.length === 1
            ? remainingChanges[0]
            : { changes: remainingChanges },
        );
      });
      contentUndoStackRef.current = nextContentUndoStack;
      historyOrderRef.current = removeRecentUndoRedoOrderKinds(
        historyOrderRef.current,
        "file-content",
        removedContentUndoEntries,
      );
      const nextContentRedoStack: ContentHistoryEntry[] = [];
      let removedContentRedoEntries = 0;
      contentRedoStackRef.current.forEach((entry) => {
        const remainingChanges = getContentHistoryChanges(entry).filter(
          (change) => !deleteIds.has(change.fileId),
        );
        if (remainingChanges.length === 0) {
          removedContentRedoEntries += 1;
          return;
        }
        nextContentRedoStack.push(
          remainingChanges.length === 1
            ? remainingChanges[0]
            : { changes: remainingChanges },
        );
      });
      contentRedoStackRef.current = nextContentRedoStack;
      redoOrderRef.current = removeRecentUndoRedoOrderKinds(
        redoOrderRef.current,
        "file-content",
        removedContentRedoEntries,
      );
      localContentUndoStackRef.current =
        localContentUndoStackRef.current.filter(
          (change) => !deleteIds.has(change.fileId),
        );
      localContentRedoStackRef.current =
        localContentRedoStackRef.current.filter(
          (change) => !deleteIds.has(change.fileId),
        );

      writeFrameGeometrySnapshot(nextGeometry);
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
          return old;
        }
        return {
          ...old,
          files: old.files.filter(
            (file: DesignFile) => !deleteIds.has(file.id),
          ),
        };
      });

      if (activeFile && deleteIds.has(activeFile.id) && nextActiveFile) {
        setActiveFileId(nextActiveFile.id);
      }
      setSelectedElement(null);
      setSelectedLayerIdsState([]);

      filesToDelete.forEach((file) => {
        deleteFileMutation.mutate({ id: file.id } as any, {
          onError: (error) => {
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            toast.error(
              error instanceof Error ? error.message : t("common.genericError"),
            );
          },
        });
      });

      // File-backed screen deletion is not a geometry-only edit. The screen rows
      // are hard-deleted, so suppress MultiScreenCanvas' local frame-history
      // entry; otherwise undo would restore geometry for files that no longer
      // exist.
      syncUndoRedoState();
      return false;
    },
    [
      activeFile,
      canEditDesign,
      canvasFrameGeometryById,
      deleteFileMutation,
      files,
      id,
      queryClient,
      syncUndoRedoState,
      t,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleCopyProps = useCallback(() => {
    if (!selectedElement) return;
    copiedStylePropsRef.current = {
      color: selectedElement.computedStyles.color,
      backgroundColor: selectedElement.computedStyles.backgroundColor,
      borderColor: selectedElement.computedStyles.borderColor,
      borderStyle: selectedElement.computedStyles.borderStyle,
      borderWidth: selectedElement.computedStyles.borderWidth,
      borderRadius: selectedElement.computedStyles.borderRadius,
      boxShadow: selectedElement.computedStyles.boxShadow,
      opacity: selectedElement.computedStyles.opacity,
      fontFamily: selectedElement.computedStyles.fontFamily,
      fontSize: selectedElement.computedStyles.fontSize,
      fontWeight: selectedElement.computedStyles.fontWeight,
      lineHeight: selectedElement.computedStyles.lineHeight,
      letterSpacing: selectedElement.computedStyles.letterSpacing,
      textAlign: selectedElement.computedStyles.textAlign,
    };
    setHasPropsClipboard(true);
  }, [selectedElement]);

  const handlePasteProps = useCallback(() => {
    if (!canEditDesign) return;
    if (!selectedElement?.selector || !copiedStylePropsRef.current) return;
    const styles = Object.fromEntries(
      Object.entries(copiedStylePropsRef.current).filter(([, value]) =>
        Boolean(value),
      ),
    );
    commitVisualStyles(selectedElement.selector, styles);
  }, [canEditDesign, commitVisualStyles, selectedElement]);

  const changeSelectedZIndex = useCallback(
    (mode: "forward" | "front" | "backward" | "back") => {
      if (!canEditDesign) return;
      if (!selectedElement?.selector) return;
      const current = Number.parseInt(
        selectedElement.computedStyles.zIndex || "0",
        10,
      );
      const base = Number.isFinite(current) ? current : 0;
      const next =
        mode === "front"
          ? 999
          : mode === "back"
            ? 0
            : mode === "forward"
              ? base + 1
              : Math.max(0, base - 1);
      commitVisualStyles(selectedElement.selector, {
        position:
          selectedElement.computedStyles.position === "static"
            ? "relative"
            : selectedElement.computedStyles.position || "relative",
        zIndex: String(next),
      });
    },
    [canEditDesign, commitVisualStyles, selectedElement],
  );

  const handleNudgeSelection = useCallback(
    (direction: "up" | "right" | "down" | "left", largeStep: boolean) => {
      if (!canEditDesign) return;
      if (!selectedElement?.selector) return;
      const step = largeStep ? 10 : 1;
      const left = parseFloat(selectedElement.computedStyles.left || "0") || 0;
      const top = parseFloat(selectedElement.computedStyles.top || "0") || 0;
      const dx =
        direction === "left" ? -step : direction === "right" ? step : 0;
      const dy = direction === "up" ? -step : direction === "down" ? step : 0;
      commitVisualStyles(selectedElement.selector, {
        position:
          selectedElement.computedStyles.position === "static"
            ? "relative"
            : selectedElement.computedStyles.position || "relative",
        left: `${Math.round(left + dx)}px`,
        top: `${Math.round(top + dy)}px`,
      });
    },
    [canEditDesign, commitVisualStyles, selectedElement],
  );

  // Handle undo: pop from UndoManager, then queue SQL persist.
  // The Y.Text observer already calls setCollabContent when the doc changes,
  // but undo/redo transactions use the UndoManager as origin so we must also
  // advance lastLocalContentRef and trigger the debounced save here.
  const handleUndo = useCallback(() => {
    if (!canEditDesign) return;
    const um = undoManagerRef.current;
    const canUseOverviewHistory = viewModeRef.current === "overview";
    let prunedUndoHistory = 0;
    const undoContent = (scope: "any" | "local" | "global" = "any") => {
      if (scope !== "global" && um?.canUndo()) {
        um.undo();
        if (ydoc && activeFile) {
          const next = ydoc.getText("content").toString();
          markPendingLocalFileContent(
            activeFile.id,
            next,
            activeFile.updatedAt,
          );
          lastLocalContentRef.current = next;
          queueFileContentSave(activeFile.id, next, {
            syncCollab: !(ydoc && isSynced),
          });
          replacePreviewContent(next, null, { forceFullDocument: true });
          setContentRenderRevision((revision) => revision + 1);
          // Clear stale selection if the undo removed the selected element.
          setSelectedElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(next, prev);
          });
          setHoveredElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(next, prev);
          });
        }
        redoOrderRef.current = [
          ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "content",
        ];
        return true;
      }

      if (!canUseOverviewHistory && scope !== "global" && activeFile?.id) {
        const localIndex = findLastContentHistoryChangeIndex(
          localContentUndoStackRef.current,
          activeFile.id,
        );
        if (localIndex !== -1) {
          const [entry] = localContentUndoStackRef.current.splice(
            localIndex,
            1,
          );
          if (entry) {
            localContentRedoStackRef.current = [
              ...localContentRedoStackRef.current.slice(
                -(MAX_DESIGN_UNDO_STACK - 1),
              ),
              entry,
            ];
            applyLocalContentUpdate(entry.before, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              immediateSave: true,
              recordHistory: false,
            });
            setSelectedElement((prev) => {
              if (!prev) return prev;
              return refreshElementInfoFromContent(entry.before, prev);
            });
            setHoveredElement((prev) => {
              if (!prev) return prev;
              return refreshElementInfoFromContent(entry.before, prev);
            });
            return true;
          }
        }
      }

      if (scope === "local") return false;
      if (!canUseOverviewHistory) return false;
      const entry =
        contentUndoStackRef.current[contentUndoStackRef.current.length - 1];
      if (!entry) return false;
      const changes = getAvailableContentHistoryChanges(
        entry,
        files.map((file) => file.id),
        activeFile?.id,
      );
      if (changes.length === 0) {
        contentUndoStackRef.current.pop();
        prunedUndoHistory += 1;
        return false;
      }
      contentUndoStackRef.current.pop();
      contentRedoStackRef.current = [
        ...contentRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        entry,
      ];
      redoOrderRef.current = [
        ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-content",
      ];
      suppressContentHistoryRef.current = true;
      try {
        for (const change of changes) {
          if (change.fileId === activeFile?.id) {
            applyLocalContentUpdate(change.before, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              immediateSave: true,
              recordHistory: false,
            });
          } else {
            applyFileContentUpdate(change.fileId, change.before, {
              recordHistory: false,
              refreshPreview: false,
            });
          }
        }
      } finally {
        suppressContentHistoryRef.current = false;
      }
      const activeChange = changes.find(
        (change) => change.fileId === activeFile?.id,
      );
      if (activeChange) {
        setSelectedElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(activeChange.before, prev);
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(activeChange.before, prev);
        });
      }
      return true;
    };
    const undoGeometry = () => {
      if (!canUseOverviewHistory) return false;
      const entry = geometryUndoStackRef.current.pop();
      if (!entry) return false;
      geometryRedoStackRef.current = [
        ...geometryRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        entry,
      ];
      redoOrderRef.current = [
        ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "geometry",
      ];
      writeFrameGeometrySnapshot(entry.before, {
        syncViewportFrameIds: viewportChangedFrameIds(
          entry.after,
          entry.before,
        ),
      });
      return true;
    };

    const undoByOrder = (preferred?: UndoRedoOrderKind) => {
      if (preferred === "geometry") return undoGeometry() || undoContent();
      if (preferred === "file-content") {
        const prunedBefore = prunedUndoHistory;
        if (undoContent("global")) return true;
        if (prunedUndoHistory > prunedBefore) return false;
        return undoGeometry();
      }
      if (preferred === "content") {
        const prunedBefore = prunedUndoHistory;
        return (
          undoContent("local") ||
          undoContent("global") ||
          (prunedUndoHistory > prunedBefore ? false : undoGeometry())
        );
      }
      return undoContent() || undoGeometry();
    };
    let didUndo = false;
    if (canUseOverviewHistory) {
      while (!didUndo) {
        const preferred = historyOrderRef.current.pop();
        didUndo = undoByOrder(preferred);
        if (didUndo || preferred === undefined) break;
      }
    } else {
      didUndo = undoContent("local");
    }
    if (didUndo || prunedUndoHistory > 0) {
      syncUndoRedoState();
    }
  }, [
    ydoc,
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    canEditDesign,
    files,
    isSynced,
    markPendingLocalFileContent,
    queueFileContentSave,
    replacePreviewContent,
    syncUndoRedoState,
    writeFrameGeometrySnapshot,
  ]);

  const handleRedo = useCallback(() => {
    if (!canEditDesign) return;
    const um = undoManagerRef.current;
    const canUseOverviewHistory = viewModeRef.current === "overview";
    let prunedRedoHistory = 0;
    const redoContent = (scope: "any" | "local" | "global" = "any") => {
      if (scope !== "global" && um?.canRedo()) {
        um.redo();
        if (ydoc && activeFile) {
          const next = ydoc.getText("content").toString();
          markPendingLocalFileContent(
            activeFile.id,
            next,
            activeFile.updatedAt,
          );
          lastLocalContentRef.current = next;
          queueFileContentSave(activeFile.id, next, {
            syncCollab: !(ydoc && isSynced),
          });
          replacePreviewContent(next, null, { forceFullDocument: true });
          setContentRenderRevision((revision) => revision + 1);
          // Clear stale selection if the redo removed the selected element.
          setSelectedElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(next, prev);
          });
          setHoveredElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(next, prev);
          });
        }
        historyOrderRef.current = [
          ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "content",
        ];
        return true;
      }

      if (!canUseOverviewHistory && scope !== "global" && activeFile?.id) {
        const localIndex = findLastContentHistoryChangeIndex(
          localContentRedoStackRef.current,
          activeFile.id,
        );
        if (localIndex !== -1) {
          const [entry] = localContentRedoStackRef.current.splice(
            localIndex,
            1,
          );
          if (entry) {
            localContentUndoStackRef.current = [
              ...localContentUndoStackRef.current.slice(
                -(MAX_DESIGN_UNDO_STACK - 1),
              ),
              entry,
            ];
            applyLocalContentUpdate(entry.after, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              immediateSave: true,
              recordHistory: false,
            });
            setSelectedElement((prev) => {
              if (!prev) return prev;
              return refreshElementInfoFromContent(entry.after, prev);
            });
            setHoveredElement((prev) => {
              if (!prev) return prev;
              return refreshElementInfoFromContent(entry.after, prev);
            });
            return true;
          }
        }
      }

      if (scope === "local") return false;
      if (!canUseOverviewHistory) return false;
      const entry =
        contentRedoStackRef.current[contentRedoStackRef.current.length - 1];
      if (!entry) return false;
      const changes = getAvailableContentHistoryChanges(
        entry,
        files.map((file) => file.id),
        activeFile?.id,
      );
      if (changes.length === 0) {
        contentRedoStackRef.current.pop();
        prunedRedoHistory += 1;
        return false;
      }
      contentRedoStackRef.current.pop();
      contentUndoStackRef.current = [
        ...contentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        entry,
      ];
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-content",
      ];
      suppressContentHistoryRef.current = true;
      try {
        for (const change of changes) {
          if (change.fileId === activeFile?.id) {
            applyLocalContentUpdate(change.after, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              immediateSave: true,
              recordHistory: false,
            });
          } else {
            applyFileContentUpdate(change.fileId, change.after, {
              recordHistory: false,
              refreshPreview: false,
            });
          }
        }
      } finally {
        suppressContentHistoryRef.current = false;
      }
      const activeChange = changes.find(
        (change) => change.fileId === activeFile?.id,
      );
      if (activeChange) {
        setSelectedElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(activeChange.after, prev);
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(activeChange.after, prev);
        });
      }
      return true;
    };
    const redoGeometry = () => {
      if (!canUseOverviewHistory) return false;
      const entry = geometryRedoStackRef.current.pop();
      if (!entry) return false;
      geometryUndoStackRef.current = [
        ...geometryUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        entry,
      ];
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "geometry",
      ];
      writeFrameGeometrySnapshot(entry.after, {
        syncViewportFrameIds: viewportChangedFrameIds(
          entry.before,
          entry.after,
        ),
      });
      return true;
    };

    const redoByOrder = (preferred?: UndoRedoOrderKind) => {
      if (preferred === "geometry") return redoGeometry() || redoContent();
      if (preferred === "file-content") {
        const prunedBefore = prunedRedoHistory;
        if (redoContent("global")) return true;
        if (prunedRedoHistory > prunedBefore) return false;
        return redoGeometry();
      }
      if (preferred === "content") {
        const prunedBefore = prunedRedoHistory;
        return (
          redoContent("local") ||
          redoContent("global") ||
          (prunedRedoHistory > prunedBefore ? false : redoGeometry())
        );
      }
      return redoContent() || redoGeometry();
    };
    let didRedo = false;
    if (canUseOverviewHistory) {
      while (!didRedo) {
        const preferred = redoOrderRef.current.pop();
        didRedo = redoByOrder(preferred);
        if (didRedo || preferred === undefined) break;
      }
    } else {
      didRedo = redoContent("local");
    }
    if (didRedo || prunedRedoHistory > 0) {
      syncUndoRedoState();
    }
  }, [
    ydoc,
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    canEditDesign,
    files,
    isSynced,
    markPendingLocalFileContent,
    queueFileContentSave,
    replacePreviewContent,
    syncUndoRedoState,
    writeFrameGeometrySnapshot,
  ]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => {
      const next = ZOOM_PRESETS.find((p) => p > z);
      return next ?? z;
    });
  }, [setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => {
      const prev = [...ZOOM_PRESETS].reverse().find((p) => p < z);
      return prev ?? z;
    });
  }, [setZoom]);

  const handleZoomToFit = useCallback(() => {
    viewModeRef.current = "overview";
    setViewMode("overview");
    setActiveTool("move");
    setExplicitOverviewCanvasZoom(100);
  }, []);

  const runEditorViewTransition = useCallback((update: () => void) => {
    if (typeof document === "undefined") {
      update();
      return;
    }

    const startViewTransition = (
      document as Document & {
        startViewTransition?: (callback: () => void) => unknown;
      }
    ).startViewTransition;

    if (typeof startViewTransition !== "function") {
      update();
      return;
    }

    let transition:
      | {
          ready?: Promise<unknown>;
          finished?: Promise<unknown>;
          updateCallbackDone?: Promise<unknown>;
        }
      | undefined;
    try {
      transition = startViewTransition.call(document, () => {
        flushSync(update);
      }) as typeof transition;
    } catch {
      // Some engines throw synchronously; fall back to an immediate update.
      update();
      return;
    }
    // A second transition started before the previous one settles aborts the
    // first, rejecting these promises with InvalidStateError. Swallow them so
    // rapid interactions (selection, mode switches) don't spam the console with
    // unhandled rejections.
    transition?.ready?.catch(() => {});
    transition?.finished?.catch(() => {});
    transition?.updateCallbackDone?.catch(() => {});
  }, []);

  const getRestoredOverviewSelection = useCallback(() => {
    const fileIds = new Set(files.map((file) => file.id));
    const restored = lastOverviewSelectedScreenIdsRef.current.filter((id) =>
      fileIds.has(id),
    );
    if (restored.length > 0) return restored;
    return activeFileId && fileIds.has(activeFileId) ? [activeFileId] : [];
  }, [activeFileId, files]);

  const enterOverviewFromZoom = useCallback(() => {
    if (viewModeRef.current === "overview") return;
    viewModeRef.current = "overview";
    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    const restoredOverviewSelection = getRestoredOverviewSelection();
    runEditorViewTransition(() => {
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool("move");
      setOverviewSelectedScreenIds(restoredOverviewSelection);
      setSelectedLayerIdsState(restoredOverviewSelection);
      setViewMode("overview");
    });
  }, [
    clearPendingOverviewLayerSelectionTimer,
    getRestoredOverviewSelection,
    runEditorViewTransition,
  ]);

  const enterSingleScreen = useCallback(
    (fileId?: string | null) => {
      if (
        viewModeRef.current === "single" &&
        (!fileId || fileId === activeFileId)
      ) {
        if (fileId && fileId === activeFileId) {
          setScreenZoom(FOCUSED_SCREEN_ZOOM);
        }
        return;
      }
      viewModeRef.current = "single";
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      runEditorViewTransition(() => {
        if (fileId) setActiveFileId(fileId);
        setDrawMode(false);
        setPinMode(false);
        setMode("edit");
        setSelectedElement(null);
        setHoveredElement(null);
        setActiveTool("move");
        setScreenZoom(FOCUSED_SCREEN_ZOOM);
        setViewMode("single");
      });
    },
    [
      activeFileId,
      clearPendingOverviewLayerSelectionTimer,
      runEditorViewTransition,
    ],
  );

  useEffect(() => {
    if (
      !activeFile ||
      viewMode !== "single" ||
      mode !== "edit" ||
      zoom >= OVERVIEW_ZOOM_THRESHOLD
    ) {
      return;
    }

    enterOverviewFromZoom();
  }, [activeFile, enterOverviewFromZoom, mode, viewMode, zoom]);

  const handleModeChange = useCallback(
    (next: EditorMode) => {
      if (!canEditDesign && next === "annotate") return;
      if ((next === "annotate" || next === "interact") && !activeFile) {
        return;
      }

      if (activeFile && viewMode === "overview") {
        viewModeRef.current = "single";
        setScreenZoom(FOCUSED_SCREEN_ZOOM);
        setViewMode("single");
      }
      setMode(next);
      setSelectedElement(null);

      if (next === "annotate") {
        setActiveTool("draw");
        setDrawMode(true);
        setPinMode(false);
      } else if (next === "interact") {
        setActiveTool("move");
        setDrawMode(false);
        setPinMode(false);
      } else {
        setActiveTool("move");
        setDrawMode(false);
        setPinMode(false);
      }
    },
    [activeFile, canEditDesign, viewMode],
  );

  useEffect(() => {
    if (
      embedded ||
      mode !== "annotate" ||
      !activeFile ||
      viewMode === "overview"
    ) {
      return;
    }
    if (!canEditDesign) return;
    setDrawMode(true);
  }, [activeFile?.id, canEditDesign, embedded, mode, viewMode]);

  const handleViewModeToggle = useCallback(() => {
    if (viewModeRef.current === "overview") {
      enterSingleScreen(activeFileId);
      return;
    }
    enterOverviewFromZoom();
  }, [activeFileId, enterOverviewFromZoom, enterSingleScreen]);

  const handleSidebarScreenSelect = useCallback(
    (screenId: string) => {
      if (
        viewModeRef.current === "overview" &&
        overviewSelectedScreenIds.length > 0
      ) {
        lastOverviewSelectedScreenIdsRef.current = [
          ...overviewSelectedScreenIds,
        ];
      }
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setOverviewSelectedScreenIds([]);
      setSelectedLayerIdsState([]);
      enterSingleScreen(screenId);
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      enterSingleScreen,
      overviewSelectedScreenIds,
    ],
  );

  const handleSidebarScreenOverview = useCallback(() => {
    const restoredOverviewSelection = getRestoredOverviewSelection();
    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    setOverviewSelectedScreenIds(restoredOverviewSelection);
    setSelectedLayerIdsState(restoredOverviewSelection);
    if (viewModeRef.current === "overview") {
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool("move");
      return;
    }
    enterOverviewFromZoom();
  }, [
    clearPendingOverviewLayerSelectionTimer,
    enterOverviewFromZoom,
    getRestoredOverviewSelection,
  ]);

  const handlePinToolToggle = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
    if (pinMode) {
      setPinMode(false);
      if (mode === "annotate") {
        setActiveTool("draw");
        setDrawMode(true);
      }
      return;
    }
    // Comments are placed on a single screen, not the overview. If we're in the
    // overview, enter the active screen AND arm pin mode in the SAME view
    // transition — calling enterSingleScreen() separately would reset pinMode to
    // false inside its own (async) transition, which is why the comment tool
    // used to feel inert from overview.
    if (viewMode === "overview") {
      viewModeRef.current = "single";
      runEditorViewTransition(() => {
        setActiveFileId(activeFile.id);
        setScreenZoom(FOCUSED_SCREEN_ZOOM);
        setViewMode("single");
        setSelectedElement(null);
        setHoveredElement(null);
        setActiveTool("comment");
        setMode("annotate");
        setPinMode(true);
        setDrawMode(false);
      });
      return;
    }
    // Pin and draw are mutually exclusive: entering pin mode turns off draw mode
    // so the pin click-overlay keeps its z-index and clicks place pins correctly.
    setActiveTool("comment");
    setMode("annotate");
    setPinMode(true);
    setDrawMode(false);
  }, [
    activeFile,
    canEditDesign,
    mode,
    pinMode,
    viewMode,
    runEditorViewTransition,
  ]);

  const handleEscapeHotkey = useCallback(() => {
    if (cancelActiveEditorDrag()) return;
    if (
      shouldEscapeToOverview({
        activeTool,
        drawMode,
        mode,
        pinMode,
        selectedElement,
        viewMode,
      })
    ) {
      enterOverviewFromZoom();
      return;
    }
    setSelectedElement(null);
    setHoveredElement(null);
    setOverviewSelectedScreenIds([]);
    setOverviewClearSelectionRequest((request) => request + 1);
    setDrawMode(false);
    setPinMode(false);
    setActiveTool("move");
    setMode("edit");
  }, [
    activeTool,
    cancelActiveEditorDrag,
    drawMode,
    enterOverviewFromZoom,
    mode,
    pinMode,
    selectedElement,
    viewMode,
  ]);

  const handleEnterHotkey = useCallback(() => {
    if (viewMode !== "overview") return;
    const target = getOverviewEnterTarget({
      activeFileId: activeFile?.id ?? activeFileId,
      overviewSelectedScreenIds,
    });
    if (!target) return;
    enterSingleScreen(target);
  }, [
    activeFile?.id,
    activeFileId,
    enterSingleScreen,
    overviewSelectedScreenIds,
    viewMode,
  ]);

  useEffect(() => {
    if (embedded || (pendingQuestions && pendingQuestions.length > 0)) {
      return;
    }

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          [
            "input",
            "textarea",
            "select",
            "[contenteditable]",
            '[role="textbox"]',
            '[data-hotkeys-scope="text"]',
          ].join(","),
        ),
      );

    const handleSpaceHandTool = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key !== " ") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (!spaceHandPreviousToolRef.current) {
        spaceHandPreviousToolRef.current = activeTool;
      }
      setActiveTool("hand");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
    };

    const handleSpaceHandRelease = (event: KeyboardEvent) => {
      if (event.key !== " ") return;
      if (isTypingTarget(event.target)) return;
      const previous = spaceHandPreviousToolRef.current;
      if (!previous) return;
      event.preventDefault();
      spaceHandPreviousToolRef.current = null;
      setActiveTool(previous);
    };

    // Capture phase so we intercept Space before focused Radix triggers (e.g.
    // the zoom DropdownMenuTrigger) open their menus on Space.
    window.addEventListener("keydown", handleSpaceHandTool, true);
    window.addEventListener("keyup", handleSpaceHandRelease);
    return () => {
      window.removeEventListener("keydown", handleSpaceHandTool, true);
      window.removeEventListener("keyup", handleSpaceHandRelease);
    };
  }, [activeTool, embedded, pendingQuestions]);

  // Fix: while any Radix popover/dropdown from the inspector panel is open, the
  // design preview iframe underneath must not receive pointer events — otherwise
  // clicks inside the picker pass through to the canvas and corrupt element fills.
  useEffect(() => {
    const getPreviewIframe = () =>
      document.querySelector(
        // i18n-ignore: DOM selector helper.
        "iframe[data-design-preview-iframe]",
      ) as HTMLIFrameElement | null;

    const updateIframePointerEvents = () => {
      const iframe = getPreviewIframe();
      if (!iframe) return;
      const hasOpenOverlay = Boolean(
        document.querySelector(
          [
            "[data-radix-popper-content-wrapper]",
            "[data-radix-portal] [data-state='open']",
          ].join(","),
        ),
      );
      iframe.style.pointerEvents = hasOpenOverlay ? "none" : "";
    };

    const observer = new MutationObserver(updateIframePointerEvents);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    return () => {
      observer.disconnect();
      // Restore pointer events on unmount in case a popover was left open.
      const iframe = getPreviewIframe();
      if (iframe) iframe.style.pointerEvents = "";
    };
  }, []);

  const handleCycleFile = useCallback(
    (backwards: boolean) => {
      if (!files.length || !activeFile) return;
      const currentIndex = Math.max(
        0,
        files.findIndex((file) => file.id === activeFile.id),
      );
      const nextIndex =
        (currentIndex + (backwards ? -1 : 1) + files.length) % files.length;
      setActiveFileId(files[nextIndex]?.id ?? activeFile.id);
      setSelectedElement(null);
    },
    [activeFile, files],
  );

  const handleSelectAllFrames = useCallback(() => {
    if (!files.length) return;
    setDrawMode(false);
    setPinMode(false);
    setMode("edit");
    setActiveTool("move");
    viewModeRef.current = "overview";
    setViewMode("overview");
    setOverviewSelectedScreenIds(files.map((file) => file.id));
    setOverviewSelectAllRequest((request) => request + 1);
  }, [files]);

  useDesignHotkeys({
    enabled: !embedded && !(pendingQuestions && pendingQuestions.length > 0),
    onMoveTool: canEditDesign ? handleMoveTool : undefined,
    onFrameTool: canEditDesign ? handleFrameTool : undefined,
    onRectangleTool: canEditDesign ? handleRectTool : undefined,
    onTextTool: canEditDesign ? handleTextTool : undefined,
    onPenTool: canEditDesign ? handlePenTool : undefined,
    onHandTool: canEditDesign ? handleHandTool : undefined,
    onCommentTool: canEditDesign ? handlePinToolToggle : undefined,
    onScaleTool: canEditDesign ? handleScaleTool : undefined,
    onCopy: handleCopySelection,
    onPaste: canEditDesign ? () => handlePasteSelection() : undefined,
    onCut: canEditDesign ? handleCutSelection : undefined,
    onPasteOver: canEditDesign ? handlePasteOverSelection : undefined,
    onCopyProps: canEditDesign ? handleCopyProps : undefined,
    onPasteProps: canEditDesign ? handlePasteProps : undefined,
    onCopyAsCode: handleCopySelection,
    onDuplicate: canEditDesign ? handleDuplicateSelection : undefined,
    onDelete: canEditDesign ? handleDeleteSelection : undefined,
    onRename: () => {
      if (!canEditDesign) return;
      setTitleDraft(design?.title ?? "");
      setTitleEditing(true);
    },
    onGroup: canEditDesign ? handleGroupSelection : undefined,
    onUngroup: canEditDesign ? handleUngroupSelection : undefined,
    onSelectAll: handleSelectAllFrames,
    onUndo: canEditDesign ? handleUndo : undefined,
    onRedo: canEditDesign ? handleRedo : undefined,
    onBringForward: canEditDesign
      ? () => changeSelectedZIndex("forward")
      : undefined,
    onBringToFront: canEditDesign
      ? () => changeSelectedZIndex("front")
      : undefined,
    onSendBackward: canEditDesign
      ? () => changeSelectedZIndex("backward")
      : undefined,
    onSendToBack: canEditDesign
      ? () => changeSelectedZIndex("back")
      : undefined,
    onEscape: handleEscapeHotkey,
    onEnter: handleEnterHotkey,
    onTab: ({ backwards }) => handleCycleFile(backwards),
    onNudge: ({ direction, largeStep }) =>
      handleNudgeSelection(direction, largeStep),
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: () => setZoom(100),
    onZoomToFit: handleZoomToFit,
    onZoomToSelection: () => {
      if (selectedElement || viewMode === "overview") setZoom(150);
    },
  });

  const startRetryGeneration = useCallback(
    (
      promptState: NonNullable<typeof retryablePrompt>,
      attempt: number,
      mode: "manual" | "auto",
    ) => {
      if (!id || !design || !canEditDesign) return;
      clearAutoRetryTimer();
      const fileContext = formatUploadedFileContext(promptState.files);
      const images = imageAttachmentsFromUploadedFiles(promptState.files);
      const retryLine =
        mode === "auto"
          ? `(Automatically retrying attempt ${attempt} of ${MAX_GENERATION_ATTEMPTS} — the previous attempt did not complete.)`
          : "(Retrying — the previous attempt did not complete.)";
      const context = [
        `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
        `User request: "${promptState.prompt}"`,
        promptState.designSystemId
          ? `Design system id: "${promptState.designSystemId}"`
          : "",
        fileContext,
        "",
        retryLine,
        ...designGenerationDirectives(id, promptState.designSystemId),
      ].join("\n");
      clearGenerationCompleteTimer();
      setGenerationIssue(null);
      const startedAt = Date.now();
      patchPendingGeneration(id, {
        prompt: promptState.prompt,
        files: promptState.files,
        title: design.title,
        designSystemId: promptState.designSystemId,
        model: promptState.model,
        engine: promptState.engine,
        effort: promptState.effort,
        attempt,
        startedAt,
      });
      setHasPendingGeneration(true);
      setRetryablePrompt(null);
      const runTabId = agentSubmit(
        `Generate design for "${design.title}": ${promptState.prompt}`,
        context,
        {
          model: promptState.model,
          engine: promptState.engine,
          effort: promptState.effort,
          images,
        },
      );
      setGenerationChatTabId(runTabId);
      patchPendingGeneration(id, {
        prompt: promptState.prompt,
        files: promptState.files,
        title: design.title,
        designSystemId: promptState.designSystemId,
        model: promptState.model,
        engine: promptState.engine,
        effort: promptState.effort,
        attempt,
        runTabId,
        startedAt,
      });
    },
    [
      agentSubmit,
      canEditDesign,
      clearAutoRetryTimer,
      clearGenerationCompleteTimer,
      design,
      id,
    ],
  );

  const handleRetryGeneration = useCallback(() => {
    if (!retryablePrompt || !canEditDesign) return;
    startRetryGeneration(
      retryablePrompt,
      (retryablePrompt.attempt ?? 1) + 1,
      "manual",
    );
  }, [canEditDesign, retryablePrompt, startRetryGeneration]);

  useEffect(() => {
    clearAutoRetryTimer();
    if (
      !retryablePrompt ||
      !generationIssue ||
      !canEditDesign ||
      generating ||
      pendingGenerationActive
    ) {
      return;
    }
    const completedAttempt = retryablePrompt.attempt ?? 1;
    if (completedAttempt >= MAX_GENERATION_ATTEMPTS) return;

    autoRetryTimerRef.current = window.setTimeout(() => {
      autoRetryTimerRef.current = null;
      startRetryGeneration(retryablePrompt, completedAttempt + 1, "auto");
    }, AUTO_RETRY_DELAY_MS);

    return clearAutoRetryTimer;
  }, [
    canEditDesign,
    retryablePrompt,
    generationIssue,
    generating,
    pendingGenerationActive,
    startRetryGeneration,
    clearAutoRetryTimer,
  ]);

  const ensureCodingHandoff = useCallback(
    async (options?: { refresh?: boolean; silent?: boolean }) => {
      if (!id) return null;
      if (!options?.refresh && codingHandoffResult) return codingHandoffResult;
      try {
        setCodingHandoffError(null);
        setCodingHandoffLoading(true);
        const result = await callAction<CodingHandoffResult>(
          "export-coding-handoff",
          {
            id,
            origin: window.location.origin,
            format: "markdown",
          } as any,
        );
        setCodingHandoffResult(result);
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("designEditor.toasts.codingHandoffError");
        setCodingHandoffError(message);
        if (!options?.silent) toast.error(message);
        return null;
      } finally {
        setCodingHandoffLoading(false);
      }
    },
    [codingHandoffResult, id, t],
  );

  const getCodingHandoffClipboardText = useCallback(
    (result: CodingHandoffResult | null) => {
      return typeof result?.clipboardText === "string"
        ? result.clipboardText
        : typeof result?.prompt === "string"
          ? result.prompt
          : "";
    },
    [],
  );

  const handleCopyCodingHandoff = useCallback(async () => {
    const result = await ensureCodingHandoff({ refresh: true });
    const text = getCodingHandoffClipboardText(result);
    if (!text) {
      toast.error(t("designEditor.toasts.codingHandoffError"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("designEditor.toasts.codingHandoffCopied"));
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [ensureCodingHandoff, getCodingHandoffClipboardText, t]);

  const handleCopyShareLink = useCallback(async () => {
    if (!editorShareUrl) return;
    try {
      await navigator.clipboard.writeText(editorShareUrl);
      setShareLinkCopied(true);
      if (shareLinkCopiedResetRef.current !== null) {
        window.clearTimeout(shareLinkCopiedResetRef.current);
      }
      shareLinkCopiedResetRef.current = window.setTimeout(() => {
        setShareLinkCopied(false);
        shareLinkCopiedResetRef.current = null;
      }, 1400);
      toast.success("Share link copied" /* i18n-ignore share copy toast */);
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [editorShareUrl, t]);

  const hasPendingVisualStyleEdits = pendingVisualStyleEdits.length > 0;
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (!hasPendingVisualStyleEdits) return;
        event.preventDefault();
        event.returnValue = "";
      },
      [hasPendingVisualStyleEdits],
    ),
    { capture: true },
  );
  const pendingVisualStyleNavigationBlocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        shouldBlockPendingVisualStyleNavigation({
          hasPendingVisualStyleEdits,
          currentPathname: currentLocation.pathname,
          nextPathname: nextLocation.pathname,
        }),
      [hasPendingVisualStyleEdits],
    ),
  );
  const pendingVisualStyleWarningOpen =
    pendingVisualStyleNavigationBlocker.state === "blocked";
  const handleStayOnPendingVisualStyleNavigation = useCallback(() => {
    if (pendingVisualStyleNavigationBlocker.state !== "blocked") return;
    pendingVisualStyleNavigationBlocker.reset();
  }, [pendingVisualStyleNavigationBlocker]);
  const handleDiscardPendingVisualStylesAndNavigate = useCallback(() => {
    if (pendingVisualStyleNavigationBlocker.state !== "blocked") return;
    setPendingVisualStyleEdits([]);
    pendingVisualStyleNavigationBlocker.proceed();
  }, [pendingVisualStyleNavigationBlocker]);

  const pendingVisualStylePropertyCount = useMemo(
    () => getPendingVisualStylePropertyCount(pendingVisualStyleEdits),
    [pendingVisualStyleEdits],
  );
  const pendingVisualStyleScreenSourceTypes = useMemo(
    () =>
      new Map<string, unknown>(
        overviewScreens.map((screen) => [
          screen.id,
          screen.sourceType ?? designSourceType,
        ]),
      ),
    [designSourceType, overviewScreens],
  );
  const showPendingVisualStyleApply = useMemo(
    () =>
      shouldShowPendingVisualStyleApply({
        edits: pendingVisualStyleEdits,
        screenSourceTypes: pendingVisualStyleScreenSourceTypes,
        fallbackSourceType: designSourceType,
      }),
    [
      designSourceType,
      pendingVisualStyleEdits,
      pendingVisualStyleScreenSourceTypes,
    ],
  );
  const pendingVisualStylePrompt = useMemo(
    () =>
      formatPendingVisualStylePrompt({
        designId: id,
        designTitle: design?.title,
        activeFileId: activeFile?.id,
        activeFilename: activeFile?.filename,
        edits: pendingVisualStyleEdits,
      }),
    [
      activeFile?.filename,
      activeFile?.id,
      design?.title,
      id,
      pendingVisualStyleEdits,
    ],
  );
  const handleApplyPendingVisualStylesWithAgent = useCallback(() => {
    if (pendingVisualStyleEdits.length === 0) return;
    sendToDesignAgentChat({
      message: t("designEditor.pendingVisualStyles.agentMessage"),
      context: pendingVisualStylePrompt,
      submit: true,
      openSidebar: true,
    });
    setPendingVisualStyleEdits([]);
    setActiveLeftPanel("agent");
    toast.success(t("designEditor.pendingVisualStyles.sentToast"));
  }, [pendingVisualStyleEdits.length, pendingVisualStylePrompt, t]);
  const handleCopyPendingVisualStylePrompt = useCallback(async () => {
    if (pendingVisualStyleEdits.length === 0) return;
    try {
      await navigator.clipboard.writeText(pendingVisualStylePrompt);
      toast.success(t("designEditor.pendingVisualStyles.copiedToast"));
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [pendingVisualStyleEdits.length, pendingVisualStylePrompt, t]);

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);

  const fallbackExportName = useCallback(
    (extension: string, suffix = "") => {
      const safeTitle =
        design?.title?.replace(/[^a-zA-Z0-9_-]/g, "-") || "design";
      const safeSuffix = suffix.trim().replace(/[^a-zA-Z0-9@._-]/g, "-");
      return `${safeTitle}${safeSuffix ? `-${safeSuffix}` : ""}.${extension}`;
    },
    [design?.title],
  );

  const handleDownloadHtml = useCallback(() => {
    if (!id) return;
    exportHtmlMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.html !== "string") {
          toast.error(t("designEditor.toasts.htmlCreateError"));
          return;
        }
        triggerBlobDownload(
          new Blob([result.html], { type: "text/html;charset=utf-8" }),
          result.filename || fallbackExportName("html"),
        );
        toast.success(t("designEditor.toasts.htmlDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.htmlExportError"));
      },
    });
  }, [exportHtmlMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const handleDownloadZip = useCallback(() => {
    if (!id) return;
    exportZipMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.zipBase64 !== "string") {
          toast.error(t("designEditor.toasts.zipCreateError"));
          return;
        }
        const binary = window.atob(result.zipBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        triggerBlobDownload(
          new Blob([bytes], { type: "application/zip" }),
          result.filename || fallbackExportName("zip"),
        );
        toast.success(t("designEditor.toasts.zipDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.zipExportError"));
      },
    });
  }, [exportZipMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const handleDownloadPng = useCallback(
    async (settings?: Partial<ExportSettingsValue>) => {
      if (pngExportingRef.current) return;
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const doc = iframe?.contentDocument;
      if (!doc?.documentElement) {
        toast.error(t("designEditor.toasts.openScreenPng"));
        return;
      }
      pngExportingRef.current = true;
      setPngExporting(true);
      try {
        const html2canvas = (await import("html2canvas")).default;
        const width = Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth ?? 0,
          iframe?.clientWidth ?? 0,
        );
        const height = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0,
          iframe?.clientHeight ?? 0,
        );
        const exportScale = Math.max(
          0.1,
          Math.min(
            4,
            settings?.scale ?? Math.min(2, window.devicePixelRatio || 1),
          ),
        );
        // When an element is selected, crop the export to just that frame.
        const cropRect = resolveExportCropRect(doc, selectedElement);
        let canvas: HTMLCanvasElement;
        try {
          canvas = await html2canvas(doc.documentElement, {
            width,
            height,
            windowWidth: width,
            windowHeight: height,
            scale: exportScale,
            useCORS: true,
            foreignObjectRendering: true,
            backgroundColor: null,
            onclone: (clonedDocument) => {
              // Sanitize colors first: it aligns source/clone elements by index,
              // so remove the editor-chrome overlays only afterwards.
              sanitizeHtml2CanvasClone(doc, clonedDocument);
              removeEditorChromeOverlays(clonedDocument);
            },
          });
        } catch (primaryError) {
          console.warn(
            "PNG export failed with foreignObjectRendering; retrying canvas renderer:",
            primaryError,
          );
          canvas = await html2canvas(doc.documentElement, {
            width,
            height,
            windowWidth: width,
            windowHeight: height,
            scale: exportScale,
            useCORS: true,
            foreignObjectRendering: false,
            backgroundColor: null,
            onclone: (clonedDocument) => {
              sanitizeHtml2CanvasClone(doc, clonedDocument);
              removeEditorChromeOverlays(clonedDocument);
            },
          });
        }
        // Render the whole page first, then crop, so ancestor backgrounds show
        // through the selected frame exactly as they do on screen.
        const outputCanvas = cropRect
          ? (cropCanvasToRect(canvas, cropRect, exportScale) ?? canvas)
          : canvas;
        await new Promise<void>((resolve) => {
          outputCanvas.toBlob((blob) => {
            try {
              if (!blob) {
                toast.error(t("designEditor.toasts.pngCreateError"));
                return;
              }
              triggerBlobDownload(
                blob,
                fallbackExportName("png", settings?.suffix),
              );
              toast.success(t("designEditor.toasts.pngDownloaded"));
            } catch (callbackError) {
              // `triggerBlobDownload` does DOM mutation + `URL.createObjectURL`,
              // either of which can throw inside this async callback — outside
              // the outer try/catch. Surface the failure instead of silently
              // dropping it.
              console.error(
                "PNG export failed during download:",
                callbackError,
              );
              toast.error(
                callbackError instanceof Error
                  ? callbackError.message
                  : t("designEditor.toasts.pngSaveError"),
              );
            } finally {
              resolve();
            }
          }, "image/png");
        });
      } catch (error) {
        console.error("PNG export failed:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : t("designEditor.toasts.pngExportError"),
        );
      } finally {
        pngExportingRef.current = false;
        setPngExporting(false);
      }
    },
    [fallbackExportName, selectedElement, t, triggerBlobDownload],
  );

  const handleDownloadSvg = useCallback(
    async (settings?: Partial<ExportSettingsValue>) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const doc = iframe?.contentDocument;
      if (!doc?.documentElement) {
        toast.error(t("designEditor.toasts.openScreenSvg"));
        return;
      }

      setSvgExporting(true);
      try {
        const width = Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth ?? 0,
          iframe?.clientWidth ?? 0,
        );
        const height = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0,
          iframe?.clientHeight ?? 0,
        );
        const clone = doc.documentElement.cloneNode(true) as HTMLElement;
        clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        const stylesheetLinks = Array.from(
          doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
        );
        const clonedStylesheetLinks = Array.from(
          clone.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
        );
        const stylesheets = Array.from(doc.styleSheets);

        stylesheetLinks.forEach((link, index) => {
          const sheet = stylesheets.find(
            (candidate) =>
              (candidate as StyleSheet & { ownerNode?: Node | null })
                .ownerNode === link,
          ) as CSSStyleSheet | undefined;
          let cssText = "";
          try {
            cssText = Array.from(sheet?.cssRules ?? [])
              .map((rule) => rule.cssText)
              .join("\n");
          } catch {
            // Cross-origin stylesheets cannot be read. Leave the original link in
            // place instead of failing the whole export.
            return;
          }
          if (!cssText.trim()) return;
          const style = doc.createElement("style");
          style.setAttribute(
            "data-agent-native-inlined-stylesheet",
            link.getAttribute("href") ?? "",
          );
          style.textContent = cssText;
          clonedStylesheetLinks[index]?.replaceWith(style);
        });
        clone.querySelectorAll("script").forEach((node) => node.remove());
        // Strip the editor's selection outline / handles so the SVG shows only
        // the design, not the editor chrome.
        removeEditorChromeOverlays(clone);
        clone.style.width = `${width}px`;
        clone.style.minHeight = `${height}px`;

        const body = clone.querySelector("body") as HTMLElement | null;
        if (body) {
          body.style.margin = body.style.margin || "0";
          body.style.width = `${width}px`;
          body.style.minHeight = `${height}px`;
        }

        const serializedHtml = sanitizeSerializedXmlForSvg(
          new XMLSerializer().serializeToString(clone),
        );
        const safeTitle =
          design?.title
            ?.replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;") || t("designEditor.designExport");
        const exportScale = Math.max(0.1, Math.min(4, settings?.scale ?? 1));
        // When an element is selected, crop to just that frame by narrowing the
        // SVG viewBox to its document-space rect. The foreignObject still holds
        // the full document so layout and inherited styles stay intact; the
        // viewBox clips the visible region to the selection.
        const cropRect = resolveExportCropRect(doc, selectedElement);
        const viewX = cropRect?.x ?? 0;
        const viewY = cropRect?.y ?? 0;
        const viewWidth = cropRect?.width ?? width;
        const viewHeight = cropRect?.height ?? height;
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth * exportScale}" height="${viewHeight * exportScale}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" role="img" aria-label="${safeTitle}">
  <title>${safeTitle}</title>
  <foreignObject width="${width}" height="${height}">
${serializedHtml}
  </foreignObject>
</svg>`;

        triggerBlobDownload(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
          fallbackExportName("svg", settings?.suffix),
        );
        toast.success(t("designEditor.toasts.svgDownloaded"));
      } catch (error) {
        console.error("SVG export failed:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : t("designEditor.toasts.svgExportError"),
        );
      } finally {
        setSvgExporting(false);
      }
    },
    [
      design?.title,
      fallbackExportName,
      selectedElement,
      t,
      triggerBlobDownload,
    ],
  );

  const handleInspectorExport = useCallback(
    (settingsList: ExportSettingsValue[]) => {
      for (const settings of settingsList) {
        if (settings.format === "svg") {
          void handleDownloadSvg(settings);
        } else {
          void handleDownloadPng(settings);
        }
      }
    },
    [handleDownloadPng, handleDownloadSvg],
  );

  const shareExportOptions: Array<{
    value: ShareExportFormat;
    title: string;
    extension: string;
    description: string;
    Icon: typeof IconCode;
    disabled: boolean;
    onDownload: () => void;
  }> = [
    {
      value: "html",
      title: "Standalone HTML" /* i18n-ignore share export format */,
      extension: ".html",
      description:
        // i18n-ignore share export description
        "One self-contained file that works offline.",
      Icon: IconCode,
      disabled: !activeFile || exportHtmlMutation.isPending,
      onDownload: handleDownloadHtml,
    },
    {
      value: "png",
      title: "PNG image" /* i18n-ignore share export format */,
      extension: ".png",
      description:
        // i18n-ignore share export description
        "Snapshot of the current screen.",
      Icon: IconPhoto,
      disabled: !activeFile || pngExporting,
      onDownload: () => void handleDownloadPng(),
    },
    {
      value: "svg",
      title: "SVG image" /* i18n-ignore share export format */,
      extension: ".svg",
      description:
        // i18n-ignore share export description
        "Scalable snapshot of the current screen.",
      Icon: IconCode,
      disabled: !activeFile || svgExporting,
      onDownload: () => void handleDownloadSvg(),
    },
    {
      value: "zip",
      title: "Project archive" /* i18n-ignore share export format */,
      extension: ".zip",
      description:
        // i18n-ignore share export description
        "Every file in this design, zipped.",
      Icon: IconArchive,
      disabled: !activeFile || exportZipMutation.isPending,
      onDownload: handleDownloadZip,
    },
  ];
  const selectedShareExportOption =
    shareExportOptions.find((option) => option.value === shareExportFormat) ??
    shareExportOptions[0];
  const codingHandoffPreviewFallback = [
    "Copy this prompt into your agent to import this design:",
    editorShareUrl,
    "",
    `Implement: ${activeFile?.filename ?? design?.title ?? "current design"}`,
  ].join("\n");
  const codingHandoffPreviewText =
    getCodingHandoffClipboardText(codingHandoffResult) ||
    (codingHandoffError
      ? `Unable to create agent prompt: ${codingHandoffError}`
      : codingHandoffLoading
        ? "Preparing agent prompt..."
        : codingHandoffPreviewFallback);
  const shareExportTab = (
    <div className="space-y-3">
      <div className="!text-[11px] font-semibold uppercase text-muted-foreground">
        {"Format" /* i18n-ignore share export section label */}
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {shareExportOptions.map((option) => {
          const selected = option.value === shareExportFormat;
          const ExportIcon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setShareExportFormat(option.value)}
              className={cn(
                "relative flex min-h-[76px] items-start gap-2.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-2.5 text-left transition-colors hover:bg-[var(--design-editor-panel-raised-bg)]",
                selected
                  ? "bg-[var(--design-editor-panel-raised-bg)] ring-1 ring-[var(--design-editor-accent-color)]"
                  : "",
              )}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--design-editor-panel-raised-bg)] text-muted-foreground">
                <ExportIcon className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-foreground">
                  {option.title}{" "}
                  <span className="!text-[11px] font-medium text-muted-foreground">
                    {option.extension}
                  </span>
                </span>
                <span className="mt-0.5 block !text-[11px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "absolute right-2.5 top-2.5 inline-flex size-4 items-center justify-center rounded-full border",
                  selected
                    ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] text-[var(--design-editor-accent-contrast-color)]"
                    : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)]",
                )}
              >
                {selected ? <IconCheck className="size-3" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--design-editor-panel-divider-color)] pt-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">
            {selectedShareExportOption.title}
          </div>
          <div className="!text-[11px] text-muted-foreground">
            {selectedShareExportOption.description}
          </div>
        </div>
        <Button
          type="button"
          onClick={selectedShareExportOption.onDownload}
          disabled={selectedShareExportOption.disabled}
          className="h-8 gap-1.5 rounded-md bg-[var(--design-editor-accent-color)] px-3 text-[12px] text-[var(--design-editor-accent-contrast-color)] shadow-none hover:bg-[var(--design-editor-accent-hover-color)] hover:text-[var(--design-editor-accent-contrast-color)] disabled:bg-muted disabled:text-muted-foreground"
        >
          <IconDownload className="size-3.5" />
          {"Download" /* i18n-ignore share export action */}
        </Button>
      </div>
    </div>
  );
  const shareSendToTab = (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 shadow-sm">
        <div className="flex h-8 items-center border-b border-neutral-800 px-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-red-500" />
            <span className="size-2.5 rounded-full bg-yellow-400" />
            <span className="size-2.5 rounded-full bg-green-500" />
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-[12px] font-medium text-neutral-400">
            {"Your agent" /* i18n-ignore terminal title */}
          </div>
          <IconTerminal2 className="size-3.5 text-neutral-500" />
        </div>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[12px] leading-5 text-neutral-100">
          {`> ${codingHandoffPreviewText}`}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void handleCopyCodingHandoff()}
          disabled={codingHandoffLoading}
          className="h-8 gap-1.5 rounded-md px-3 text-[12px]"
        >
          <IconClipboard className="size-3.5" />
          {"Copy agent prompt" /* i18n-ignore share send action */}
        </Button>
      </div>
    </div>
  );
  const shareLinkFooter = (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--design-editor-panel-divider-color)] pt-3">
      <Button
        type="button"
        onClick={() => void handleCopyShareLink()}
        disabled={!editorShareUrl}
        className="h-8 min-w-[8.75rem] gap-1.5 rounded-md px-3 text-[12px]"
      >
        {shareLinkCopied ? (
          <IconCheck className="size-3.5" />
        ) : (
          <IconClipboard className="size-3.5" />
        )}
        {
          shareLinkCopied
            ? "Copied" /* i18n-ignore share copy action copied */
            : "Copy share link" /* i18n-ignore share copy action */
        }
      </Button>
    </div>
  );
  const designShareTabLabelClassName =
    "inline-flex items-center justify-center gap-1.5";
  const designSharePopoverClassName =
    "z-[100010] !w-[min(620px,calc(100vw-32px))] !p-3 " +
    "[&_[role=tablist]]:!inline-flex [&_[role=tablist]]:!w-fit [&_[role=tablist]]:!self-start [&_[role=tablist]]:justify-start [&_[role=tablist]]:gap-1 [&_[role=tablist]]:rounded-lg [&_[role=tablist]]:border [&_[role=tablist]]:border-[var(--design-editor-panel-divider-color)] [&_[role=tablist]]:bg-[var(--design-editor-panel-raised-bg)] [&_[role=tablist]]:p-1 " +
    "[&_[role=tab]]:!h-8 [&_[role=tab]]:!flex-none [&_[role=tab]]:rounded-md [&_[role=tab]]:px-3 [&_[role=tab]]:!text-[12px] [&_[role=tab]]:font-semibold [&_[role=tab]]:shadow-none [&_[role=tab]]:ring-0 " +
    "[&_[role=tab]:hover]:bg-white/70 dark:[&_[role=tab]:hover]:bg-[var(--design-editor-control-bg)] [&_[role=tab]:hover]:text-foreground " +
    "[&_[role=tab][aria-selected=true]]:bg-white dark:[&_[role=tab][aria-selected=true]]:bg-[var(--design-editor-control-bg)] [&_[role=tab][aria-selected=true]]:text-foreground [&_[role=tab][aria-selected=true]]:shadow-sm [&_[role=tab][aria-selected=true]]:ring-1 [&_[role=tab][aria-selected=true]]:ring-[var(--design-editor-control-border)]";
  const designShareTabs = {
    shareLabel: (
      <span className={designShareTabLabelClassName}>
        <IconLink className="size-3.5" />
        {"Share link" /* i18n-ignore share tab label */}
      </span>
    ),
    defaultValue: "share",
    tabs: [
      {
        value: "export",
        label: (
          <span className={designShareTabLabelClassName}>
            <IconFileExport className="size-3.5" />
            {t("designEditor.export")}
          </span>
        ),
        content: shareExportTab,
      },
      {
        value: "send",
        label: (
          <span className={designShareTabLabelClassName}>
            <IconTerminal2 className="size-3.5" />
            {"Send to agent" /* i18n-ignore share tab label */}
          </span>
        ),
        content: shareSendToTab,
      },
    ],
  };

  useEffect(() => {
    if (viewMode === "overview" && !motionDockOpen) return;
    if (!activeFile || !activeContent.trim()) return;
    const stamped = ensureCodeLayerNodeIdsInHtml(activeContent, {
      source: {
        kind: "design-file",
        designId: id,
        fileId: activeFile.id,
        filename: activeFile.filename,
      },
    });
    if (!stamped.changed || stamped.content === activeContent) return;
    applyLocalContentUpdate(stamped.content, { recordHistory: false });
  }, [
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    id,
    motionDockOpen,
    viewMode,
  ]);
  const activeCodeLayerTree = useMemo(
    () => buildCodeLayerTree(activeCodeLayerProjection),
    [activeCodeLayerProjection],
  );
  const activeCodeLayerNodeById = useMemo(
    () =>
      new Map(activeCodeLayerProjection.nodes.map((node) => [node.id, node])),
    [activeCodeLayerProjection],
  );
  const codeLayerModelsByFile = useMemo(
    () =>
      files.map((file) => {
        const content =
          file.id === activeFile?.id
            ? activeProjectionContent
            : getProjectionContentForScreen(file.id);
        const projection =
          file.id === activeFile?.id
            ? activeCodeLayerProjection
            : buildCodeLayerProjection(content);
        const tree =
          file.id === activeFile?.id
            ? activeCodeLayerTree
            : buildCodeLayerTree(projection);
        return {
          fileId: file.id,
          projection,
          tree,
          nodeById: new Map(projection.nodes.map((node) => [node.id, node])),
        };
      }),
    [
      activeCodeLayerProjection,
      activeCodeLayerTree,
      activeProjectionContent,
      activeFile?.id,
      files,
      getProjectionContentForScreen,
    ],
  );
  const codeLayerModelByFileId = useMemo(
    () => new Map(codeLayerModelsByFile.map((model) => [model.fileId, model])),
    [codeLayerModelsByFile],
  );
  const codeLayerOwnerByNodeId = useMemo(() => {
    const owners = new Map<
      string,
      { fileId: string; node: CodeLayerNode; tree: CodeLayerTreeNode[] }
    >();
    codeLayerModelsByFile.forEach((model) => {
      model.projection.nodes.forEach((node) => {
        owners.set(node.id, {
          fileId: model.fileId,
          node,
          tree: model.tree,
        });
      });
    });
    return owners;
  }, [codeLayerModelsByFile]);
  const effectiveCodeLayerState = useMemo(() => {
    const state: EffectiveCodeLayerState = {
      lockedIds: new Set(),
      hiddenIds: new Set(),
    };
    codeLayerModelsByFile.forEach((model) => {
      const fileLocked = lockedLayerIds.has(model.fileId);
      const fileHidden = hiddenLayerIds.has(model.fileId);
      if (fileLocked) state.lockedIds.add(model.fileId);
      if (fileHidden) state.hiddenIds.add(model.fileId);
      collectEffectiveCodeLayerState(
        model.tree,
        lockedLayerIds,
        hiddenLayerIds,
        fileLocked,
        fileHidden,
        state,
      );
    });
    return state;
  }, [codeLayerModelsByFile, hiddenLayerIds, lockedLayerIds]);
  effectiveCodeLayerStateRef.current = effectiveCodeLayerState;
  useEffect(() => {
    shouldPreserveBlockedOverviewLayerSelectionRef.current = (
      screenId: string,
    ) => {
      if (viewModeRef.current !== "overview") return false;
      return selectedLayerIdsState.some((layerId) => {
        const owner = codeLayerOwnerByNodeId.get(layerId);
        if (!owner || owner.fileId !== screenId) return false;
        return (
          effectiveCodeLayerState.lockedIds.has(screenId) ||
          effectiveCodeLayerState.hiddenIds.has(screenId) ||
          effectiveCodeLayerState.lockedIds.has(layerId) ||
          effectiveCodeLayerState.hiddenIds.has(layerId)
        );
      });
    };
  }, [codeLayerOwnerByNodeId, effectiveCodeLayerState, selectedLayerIdsState]);
  useEffect(() => {
    const fileIds = new Set(files.map((file) => file.id));
    const allCodeLayerNodes = codeLayerModelsByFile.flatMap(
      (model) => model.projection.nodes,
    );
    const lockedFromSource = new Set(
      allCodeLayerNodes
        .filter(
          (node) => node.dataAttributes["data-agent-native-locked"] === "true",
        )
        .map((node) => node.id),
    );
    const hiddenFromSource = new Set(
      allCodeLayerNodes
        .filter(
          (node) => node.dataAttributes["data-agent-native-hidden"] === "true",
        )
        .map((node) => node.id),
    );
    const allLayerIds = new Set([
      ...fileIds,
      ...allCodeLayerNodes.map((node) => node.id),
    ]);
    const reconcile = (
      current: Set<string>,
      sourceIds: Set<string>,
      kind: "hidden" | "locked",
    ): Set<string> => {
      const next = new Set(sourceIds);
      current.forEach((id) => {
        if (fileIds.has(id)) next.add(id);
      });
      layerStateOverridesRef.current.forEach((override, id) => {
        if (!allLayerIds.has(id)) {
          layerStateOverridesRef.current.delete(id);
          return;
        }
        const value = override[kind];
        if (value === undefined) return;
        if (value) next.add(id);
        else next.delete(id);
      });
      if (
        next.size === current.size &&
        Array.from(next).every((id) => current.has(id))
      ) {
        return current;
      }
      return next;
    };

    setLockedLayerIds((current) =>
      reconcile(current, lockedFromSource, "locked"),
    );
    setHiddenLayerIds((current) =>
      reconcile(current, hiddenFromSource, "hidden"),
    );
  }, [codeLayerModelsByFile, files]);
  const lockedLayerSelectors = useMemo(() => {
    const selectors = Array.from(lockedLayerIds)
      .flatMap((layerId) =>
        codeLayerSelectorAliases(activeCodeLayerNodeById.get(layerId)),
      )
      .filter(Boolean);
    if (activeFile?.id && lockedLayerIds.has(activeFile.id)) {
      selectors.push("body");
    }
    return Array.from(new Set(selectors));
  }, [activeCodeLayerNodeById, activeFile?.id, lockedLayerIds]);
  const hiddenLayerSelectors = useMemo(() => {
    const selectors = Array.from(hiddenLayerIds)
      .flatMap((layerId) =>
        codeLayerSelectorAliases(activeCodeLayerNodeById.get(layerId)),
      )
      .filter(Boolean);
    if (activeFile?.id && hiddenLayerIds.has(activeFile.id)) {
      selectors.push("body");
    }
    return Array.from(new Set(selectors));
  }, [activeCodeLayerNodeById, activeFile?.id, hiddenLayerIds]);
  const getLayerSelectorsForFile = useCallback(
    (fileId: string, layerIds: Set<string>) => {
      const model = codeLayerModelByFileId.get(fileId);
      const selectors = Array.from(layerIds)
        .flatMap((layerId) =>
          codeLayerSelectorAliases(model?.nodeById.get(layerId)),
        )
        .filter(Boolean);
      if (layerIds.has(fileId)) selectors.push("body");
      return Array.from(new Set(selectors));
    },
    [codeLayerModelByFileId],
  );
  const activeCodeLayerPanelNodes = useMemo(
    () =>
      codeLayerTreeToPanelNodes(
        activeCodeLayerTree,
        lockedLayerIds,
        hiddenLayerIds,
      ),
    [activeCodeLayerTree, hiddenLayerIds, lockedLayerIds],
  );

  const layerPanelFiles = useMemo<LayersPanelFile[]>(
    () =>
      files
        .filter((file) => !isBoardFile(file.filename))
        .map((file) => ({
          id: file.id,
          name: prettyScreenName(file.filename),
          filename: file.filename,
          fileType: file.fileType,
          detail: file.filename,
          locked: lockedLayerIds.has(file.id),
          hidden: hiddenLayerIds.has(file.id),
          lockable: true,
          hideable: true,
          renamable: true,
        })),
    [files, hiddenLayerIds, lockedLayerIds],
  );
  const overviewLayerPanelFiles = useMemo<LayersPanelFile[]>(
    () =>
      files
        .filter((file) => !isBoardFile(file.filename))
        .map((file) => {
          const model = codeLayerModelByFileId.get(file.id);
          return {
            id: file.id,
            name: prettyScreenName(file.filename),
            filename: file.filename,
            fileType: file.fileType,
            detail: file.filename,
            locked: lockedLayerIds.has(file.id),
            hidden: hiddenLayerIds.has(file.id),
            lockable: true,
            hideable: true,
            renamable: true,
            layers: codeLayerTreeToPanelNodes(
              model?.tree ?? [],
              lockedLayerIds,
              hiddenLayerIds,
            ),
          };
        }),
    [codeLayerModelByFileId, files, hiddenLayerIds, lockedLayerIds],
  );

  // Board objects shown as top-level peer rows in the layers panel, right
  // alongside the screen frames. Derived from the same code-layer model that
  // feeds codeLayerOwnerByNodeId so a layer-row click resolves to the board
  // file (sets it active + selects the element). buildCodeLayerProjection was
  // the wrong source here: it produced different node ids that the owner map
  // could not route, and returned no roots for the migrated board fragments.
  const boardElements = useMemo<LayersPanelNode[] | undefined>(() => {
    if (!boardFileId) return undefined;
    const model = codeLayerModelByFileId.get(boardFileId);
    if (!model?.tree?.length) return undefined;
    const nodes = codeLayerTreeToPanelNodes(
      model.tree,
      lockedLayerIds,
      hiddenLayerIds,
    );
    return nodes.length > 0 ? nodes : undefined;
  }, [boardFileId, codeLayerModelByFileId, lockedLayerIds, hiddenLayerIds]);

  const activeLayerPanelNodes = useMemo<LayersPanelNode[]>(
    () => activeCodeLayerPanelNodes,
    [activeCodeLayerPanelNodes],
  );

  const selectedLayerIds = useMemo(() => {
    const validIds = new Set(
      (viewMode === "overview"
        ? codeLayerModelsByFile.flatMap((model) => model.projection.nodes)
        : activeCodeLayerProjection.nodes
      ).map((node) => node.id),
    );
    const fileIds = new Set(files.map((file) => file.id));
    const pendingOverviewScreenId = pendingOverviewScreenSelectionRef.current;
    const pendingOverviewLayerId = pendingOverviewLayerSelectionRef.current;
    if (pendingOverviewScreenId) {
      validIds.add(pendingOverviewScreenId);
      fileIds.add(pendingOverviewScreenId);
    }
    if (pendingOverviewLayerId) {
      validIds.add(pendingOverviewLayerId);
    }
    if (createdOverviewLayerSelection) {
      validIds.add(createdOverviewLayerSelection.layerId);
    }
    if (selectedElementLayerId) validIds.add(selectedElementLayerId);
    files.forEach((file) => validIds.add(file.id));
    const selectedStateIds = selectedLayerIdsState.filter((layerId) =>
      validIds.has(layerId),
    );
    const hasOverviewCodeLayerSelection =
      viewMode === "overview" &&
      selectedStateIds.some((layerId) => !fileIds.has(layerId));
    const hasOverviewFileSelection =
      viewMode === "overview" &&
      selectedStateIds.some((layerId) => fileIds.has(layerId));
    const baseSelection =
      viewMode === "overview" && createdOverviewLayerSelection
        ? [createdOverviewLayerSelection.layerId]
        : viewMode === "overview" && !hasOverviewCodeLayerSelection
          ? overviewSelectedScreenIds.length > 0 || !hasOverviewFileSelection
            ? overviewSelectedScreenIds
            : selectedLayerIdsState
          : selectedLayerIdsState;
    const filtered = baseSelection.filter((layerId) => validIds.has(layerId));
    if (selectedElementLayerId && !filtered.includes(selectedElementLayerId)) {
      if (filtered.length > 1) return [...filtered, selectedElementLayerId];
      return [selectedElementLayerId];
    }
    return filtered;
  }, [
    activeCodeLayerProjection.nodes,
    codeLayerModelsByFile,
    createdOverviewLayerSelection,
    files,
    overviewSelectedScreenIds,
    selectedElementLayerId,
    selectedLayerIdsState,
    viewMode,
  ]);
  const selectedUrlSelectionId = useMemo(
    () =>
      selectedElementLayerId ??
      [...selectedLayerIds]
        .reverse()
        .find((layerId) => codeLayerOwnerByNodeId.has(layerId)) ??
      null,
    [codeLayerOwnerByNodeId, selectedElementLayerId, selectedLayerIds],
  );
  const selectedLayerIdsRef = useRef<string[]>(selectedLayerIds);

  useLayoutEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds;
  }, [selectedLayerIds]);

  useEffect(() => {
    if (!id) return;
    if (initialUrlSelectionHydratedForIdRef.current === id) return;
    if (!initialRouteSelectionId) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    if (
      selectedUrlSelectionId &&
      selectedUrlSelectionId !== initialRouteSelectionId
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    const owner = codeLayerOwnerByNodeId.get(initialRouteSelectionId);
    if (!owner) return;
    const selectionBlocked =
      effectiveCodeLayerState.lockedIds.has(owner.fileId) ||
      effectiveCodeLayerState.hiddenIds.has(owner.fileId) ||
      effectiveCodeLayerState.lockedIds.has(initialRouteSelectionId) ||
      effectiveCodeLayerState.hiddenIds.has(initialRouteSelectionId);
    if (
      activeFileId === owner.fileId &&
      selectedLayerIds.includes(initialRouteSelectionId) &&
      (selectionBlocked || selectedElementLayerId === initialRouteSelectionId)
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }

    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    setActiveFileId(owner.fileId);
    setSelectedLayerIdsState([initialRouteSelectionId]);
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds([]);
    }
    setSelectedElement(
      selectionBlocked ? null : elementInfoFromCodeLayerNode(owner.node),
    );
    setHoveredElement(null);
    setHoveredElementScreenId(null);
    setActiveTool("move");
    setMode("edit");
    if (!selectionBlocked) {
      focusDesignInspectorForSelection();
    }
    initialUrlSelectionHydratedForIdRef.current = id;
  }, [
    activeFileId,
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    focusDesignInspectorForSelection,
    id,
    initialRouteSelectionId,
    selectedElementLayerId,
    selectedLayerIds,
    selectedUrlSelectionId,
  ]);

  useEffect(() => {
    if (!id || files.length === 0) return;
    if (
      initialRouteScreenTarget &&
      !findDesignFileByScreenTarget(files, initialRouteScreenTarget) &&
      !activeFileId
    ) {
      return;
    }
    const preserveInitialRouteSelection = Boolean(
      initialRouteSelectionId &&
      initialUrlSelectionHydratedForIdRef.current !== id &&
      initialRouteSelectionId !== selectedUrlSelectionId &&
      codeLayerOwnerByNodeId.size === 0,
    );
    const nextSearch = getDesignEditorStateUrlSearch({
      currentSearch: location.search,
      viewMode,
      screenId: activeFile?.id ?? activeFileId,
      selectionId:
        selectedUrlSelectionId ??
        (preserveInitialRouteSelection ? initialRouteSelectionId : null),
      zoom,
    });
    if (nextSearch === location.search) return;
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch,
        hash: location.hash,
      },
      { replace: true, preventScrollReset: true },
    );
  }, [
    activeFile?.id,
    activeFileId,
    codeLayerOwnerByNodeId.size,
    files,
    id,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    initialRouteScreenTarget,
    initialRouteSelectionId,
    selectedUrlSelectionId,
    viewMode,
    zoom,
  ]);

  const selectedLayerTargets = useMemo<SelectedLayerTarget[]>(
    () =>
      selectedLayerIds
        .map((layerId) => {
          const owner = codeLayerOwnerByNodeId.get(layerId);
          if (!owner) return null;
          const selectedMatches =
            selectedElement &&
            codeLayerNodeMatchesBridgeTarget(
              owner.node,
              selectedElement.selector,
              selectedElement.sourceId ?? selectedElement.id,
            );
          return {
            layerId,
            fileId: owner.fileId,
            node: owner.node,
            tree: owner.tree,
            elementInfo: selectedMatches
              ? canonicalElementInfoForCodeLayerNode(
                  selectedElement,
                  owner.node,
                )
              : elementInfoFromCodeLayerNode(owner.node),
          };
        })
        .filter((target): target is SelectedLayerTarget => Boolean(target)),
    [codeLayerOwnerByNodeId, selectedElement, selectedLayerIds],
  );

  useLayoutEffect(() => {
    selectedLayerTargetsRef.current = selectedLayerTargets;
  }, [selectedLayerTargets]);

  const selectedLayerSelectorGroupsByScreen = useMemo(() => {
    const groupsByScreen: Record<string, string[][]> = {};
    selectedLayerTargets.forEach((target) => {
      const selectorGroup = codeLayerSelectorAliases(target.node);
      if (selectorGroup.length === 0) return;
      groupsByScreen[target.fileId] = [
        ...(groupsByScreen[target.fileId] ?? []),
        selectorGroup,
      ];
    });
    return groupsByScreen;
  }, [selectedLayerTargets]);

  const selectedInspectorElements = useMemo(
    () =>
      selectedLayerTargets.length > 0
        ? selectedLayerTargets.map((target) => target.elementInfo)
        : selectedElement
          ? [selectedElement]
          : [],
    [selectedElement, selectedLayerTargets],
  );

  const layerPanelSelectedIds = useMemo(
    () =>
      viewMode === "overview" && createdOverviewLayerSelection
        ? [createdOverviewLayerSelection.layerId]
        : selectedLayerIds,
    [createdOverviewLayerSelection, selectedLayerIds, viewMode],
  );

  const layerPanelExpandedIds = useMemo(() => {
    if (viewMode !== "overview" || !createdOverviewLayerSelection) {
      return expandedLayerIds;
    }
    const next = new Set(expandedLayerIds);
    next.add(createdOverviewLayerSelection.screenId);
    return Array.from(next);
  }, [createdOverviewLayerSelection, expandedLayerIds, viewMode]);

  useEffect(() => {
    const pendingLayerId = pendingOverviewLayerSelectionRef.current;
    if (!pendingLayerId) return;
    if (!selectedLayerIdsState.includes(pendingLayerId)) {
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      return;
    }
    const owner = codeLayerOwnerByNodeId.get(pendingLayerId);
    if (!owner) return;
    schedulePendingOverviewLayerSelectionClear(pendingLayerId);
    setActiveFileId(owner.fileId);
    setSelectedElement(elementInfoFromCodeLayerNode(owner.node));
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      next.add(owner.fileId);
      collectCodeLayerAncestors(owner.tree, pendingLayerId).forEach((id) =>
        next.add(id),
      );
      return next.size === current.length ? current : Array.from(next);
    });
  }, [
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    schedulePendingOverviewLayerSelectionClear,
    selectedLayerIdsState,
  ]);

  useEffect(() => {
    const pendingScreenId = pendingOverviewScreenSelectionRef.current;
    if (!pendingScreenId) return;
    if (files.some((file) => file.id === pendingScreenId)) {
      pendingOverviewScreenSelectionRef.current = null;
    }
  }, [files]);

  useEffect(() => {
    setSelectedLayerIdsState((current) => {
      if (!selectedElementLayerId) {
        return current;
      }
      if (current.includes(selectedElementLayerId)) return current;
      if (current.length > 1) return [...current, selectedElementLayerId];
      return [selectedElementLayerId];
    });
  }, [selectedElementLayerId]);

  useEffect(() => {
    if (!selectedElementLayerId) return;
    const owner = codeLayerOwnerByNodeId.get(selectedElementLayerId);
    const ancestorIds = collectCodeLayerAncestors(
      owner?.tree ?? activeCodeLayerTree,
      selectedElementLayerId,
    );
    if (ancestorIds.length === 0) return;
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      if (owner?.fileId) next.add(owner.fileId);
      ancestorIds.forEach((ancestorId) => next.add(ancestorId));
      return next.size === current.length ? current : Array.from(next);
    });
  }, [activeCodeLayerTree, codeLayerOwnerByNodeId, selectedElementLayerId]);

  useEffect(() => {
    const selectedCodeLayerIds = selectedLayerIds.filter((layerId) =>
      codeLayerOwnerByNodeId.has(layerId),
    );
    if (selectedCodeLayerIds.length === 0) return;
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      selectedCodeLayerIds.forEach((layerId) => {
        const owner = codeLayerOwnerByNodeId.get(layerId);
        if (!owner) return;
        next.add(owner.fileId);
        collectCodeLayerAncestors(owner.tree, layerId).forEach((ancestorId) =>
          next.add(ancestorId),
        );
      });
      return next.size === current.length ? current : Array.from(next);
    });
  }, [codeLayerOwnerByNodeId, selectedLayerIds]);

  useEffect(() => {
    if (!selectedElementLayerId) return;
    const owner = codeLayerOwnerByNodeId.get(selectedElementLayerId);
    const selectedPathIds = [
      ...collectCodeLayerAncestors(
        owner?.tree ?? activeCodeLayerTree,
        selectedElementLayerId,
      ),
      selectedElementLayerId,
    ];
    // Only clear selection when the element (or its file) becomes LOCKED.
    // Hidden layers keep their selection so the layer panel still shows it,
    // and unlocking a layer must not accidentally deselect it.
    const activeFileLocked =
      activeFile?.id && effectiveCodeLayerState.lockedIds.has(activeFile.id);
    const selectionBlocked =
      Boolean(activeFileLocked) ||
      selectedPathIds.some((layerId) =>
        effectiveCodeLayerState.lockedIds.has(layerId),
      );
    if (!selectionBlocked) return;
    setSelectedElement(null);
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    selectedElementLayerId,
  ]);

  const activeScreenPreviewUrl = useMemo(() => {
    if (builderPreviewUrl) return builderPreviewUrl;
    const screen = overviewScreens.find((item) => item.id === activeFile?.id);
    return (
      screen?.url ||
      screen?.previewUrl ||
      externalPreviewUrlForContent(activeContent)
    );
  }, [activeContent, activeFile?.id, builderPreviewUrl, overviewScreens]);

  // §6.4 / §8 — Breakpoints list for the StatesPanel, derived from
  // designs.data.breakpointSet. Returns a stable empty array when none are set.
  const statesPanelBreakpoints = useMemo<
    Array<{ id: string; label: string; widthPx: number }>
  >(() => {
    try {
      const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Array.isArray((raw as Record<string, unknown>).breakpoints)
      ) {
        const bps = (
          raw as {
            breakpoints: Array<{
              id: string;
              widthPx: number;
              label?: string;
            }>;
          }
        ).breakpoints;
        return bps.map((bp) => ({
          id: bp.id,
          widthPx: bp.widthPx,
          label:
            bp.label ??
            (bp.widthPx >= 1024
              ? "Desktop"
              : bp.widthPx >= 600
                ? "Tablet"
                : "Mobile"),
        }));
      }
    } catch {
      // ignore
    }
    return [];
  }, [designDataJson]);

  // Active breakpoint id for the StatesPanel — "auto" when no frame is focused.
  const statesPanelActiveBreakpointId = useMemo<string>(() => {
    if (activeBreakpointWidthState == null) return "auto";
    const match = statesPanelBreakpoints.find(
      (bp) => bp.widthPx === activeBreakpointWidthState,
    );
    if (match) return match.id;
    const defaultMatch = DEFAULT_STATES_PANEL_BREAKPOINTS.find(
      (bp) => bp.widthPx === activeBreakpointWidthState,
    );
    return defaultMatch?.id ?? "auto";
  }, [activeBreakpointWidthState, statesPanelBreakpoints]);

  const publishDesignTitle = design?.title?.trim() || "Untitled design";

  const handleOpenDesignPreview = useCallback(() => {
    if (activeScreenPreviewUrl) {
      window.open(activeScreenPreviewUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const content = activeContent.trim();
    if (!content) return;

    const blobUrl = URL.createObjectURL(
      new Blob([fullPreviewHtml(activeContent)], { type: "text/html" }),
    );
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }, [activeContent, activeScreenPreviewUrl]);

  const handleJoinPublishWaitlist = useCallback(async () => {
    if (!isSignedIn) {
      handleSignInToSave();
      return;
    }

    setJoiningPublishWaitlist(true);
    setPublishWaitlistError(null);

    try {
      const res = await fetch(
        new URL(
          agentNativePath("/_agent-native/builder/branch-waitlist"),
          window.location.origin,
        ).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageUrl: window.location.href,
            prompt: `Publish design "${publishDesignTitle}" as an app.`,
            source: "design_editor_publish_app_menu",
            useCase: "design_publish_app",
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Request failed (${res.status})`,
        );
      }

      setPublishWaitlistJoined(true);
    } catch (err) {
      setPublishWaitlistError(
        err instanceof Error
          ? err.message
          : "Couldn't join the waitlist. Please try again.",
      );
    } finally {
      setJoiningPublishWaitlist(false);
    }
  }, [handleSignInToSave, isSignedIn, publishDesignTitle]);

  const activeLayerId =
    selectedLayerIds[selectedLayerIds.length - 1] ??
    selectedElementLayerId ??
    activeFile?.id ??
    "";
  const selectedElementFullViewScreenId =
    viewMode === "overview" && selectedElement
      ? selectedElementLayerId
        ? (codeLayerOwnerByNodeId.get(selectedElementLayerId)?.fileId ??
          activeFileId)
        : activeFileId
      : null;
  const fullViewScreenIds = selectedElementFullViewScreenId
    ? [selectedElementFullViewScreenId]
    : [];
  const activeLayerLocked = Boolean(
    activeLayerId && effectiveCodeLayerState.lockedIds.has(activeLayerId),
  );
  const activeLayerHidden = Boolean(
    activeLayerId && effectiveCodeLayerState.hiddenIds.has(activeLayerId),
  );

  // Detect if the active screen is a localhost/local source so we can show a banner.
  const activeScreenIsLocalSource =
    Boolean(activeFile) && activeOverviewScreen?.sourceType === "localhost";
  const activeScreenRouteSourceFile = activeScreenIsLocalSource
    ? getLocalhostRouteSourceFile({
        sourceFile: activeOverviewScreen?.sourceFile,
        source: activeOverviewScreen?.source,
      })
    : undefined;
  // Connection id for the active localhost screen — needed to mint write grants.
  const activeLocalhostConnectionId = activeScreenIsLocalSource
    ? ((activeOverviewScreen as { connectionId?: string } | undefined)
        ?.connectionId ?? "")
    : "";

  /**
   * Request consent to write a local file for the active localhost screen.
   * If no valid grant exists, opens the consent dialog; once granted the
   * caller should proceed to call write-local-file via the action surface.
   *
   * Only works when the active screen is localhost-backed and the current user
   * has editor access. For non-localhost screens use the normal Ask-AI path.
   *
   * The files parameter is for display in the consent dialog only; the actual
   * write must be performed by the caller via the write-local-file action.
   */
  const requestLocalhostWrite = useCallback(
    (opts: {
      files: string[];
      onGranted: LocalhostWriteConsentPayload["onGranted"];
      onCancel?: () => void;
    }) => {
      if (!id || !canEditDesign || !activeLocalhostConnectionId) return;

      const rootPath =
        activeScreenRouteSourceFile ?? activeLocalhostConnectionId;

      setLocalhostConsentConnectionId(activeLocalhostConnectionId);
      setLocalhostWriteConsentPayload({
        rootPath,
        files: opts.files,
        onGranted: opts.onGranted,
        onCancel: opts.onCancel ?? (() => {}),
      });
      setLocalhostWriteConsentOpen(true);
    },
    [
      activeLocalhostConnectionId,
      activeScreenRouteSourceFile,
      canEditDesign,
      id,
    ],
  );
  // requestLocalhostWrite is consumed via the component instance or by
  // connected inspector components; not all render paths call it directly.
  void requestLocalhostWrite;

  /**
   * Derive a relative file path from the active localhost screen.
   * Prefers `sourceFile` (the build-output relative path recorded at connect
   * time) over the URL pathname so the path maps to the actual file on disk.
   * Returns undefined when no usable path can be determined.
   */
  const activeLocalhostRelPath = useMemo<string | undefined>(() => {
    if (!activeScreenIsLocalSource) return undefined;
    // Prefer the explicit sourceFile (e.g. "src/index.html").
    const sf = activeScreenRouteSourceFile;
    if (sf?.trim()) return sf.trim();
    // Fall back to URL pathname (e.g. "/page.html" → "page.html").
    const url = activeOverviewScreen?.url;
    if (!url) return undefined;
    try {
      const pathname = new URL(url).pathname.replace(/^\//, "");
      return pathname || undefined;
    } catch {
      return undefined;
    }
  }, [
    activeScreenIsLocalSource,
    activeScreenRouteSourceFile,
    activeOverviewScreen?.url,
  ]);

  /** True when the active localhost screen maps to an HTML/CSS file we can write. */
  const activeLocalhostRouteIsWritable =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_WRITE_EXTENSIONS.has(
      (activeLocalhostRelPath?.match(/\.[^.]+$/) ?? [])[0]?.toLowerCase() ?? "",
    );

  /**
   * Strip editor-only node-id attributes from HTML source so they are not
   * written back to the user's local file.
   *
   * Kept attributes (intentional user content):
   *   - data-agent-native-layer-name  (human-readable display name)
   *   - data-screen="…"               (prototype navigation)
   *   - any other data-* not listed below
   *
   * Stripped attributes (editor plumbing only):
   *   - data-agent-native-node-id     (stable selection id stamped by the editor)
   *   - data-code-layer-id            (alternative layer id for localhost components)
   */
  function stripEditorOnlyAttributes(html: string): string {
    if (typeof window === "undefined") return html;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const STRIP_ATTRS = [
        "data-agent-native-node-id",
        "data-code-layer-id",
      ] as const;
      for (const attr of STRIP_ATTRS) {
        doc.querySelectorAll(`[${attr}]`).forEach((el) => {
          el.removeAttribute(attr);
        });
      }
      // Serialise back.  Use outerHTML of <html> to preserve doctype-less
      // fragments; for full documents prefer innerHTML wrapping.
      const doctype = doc.doctype
        ? new XMLSerializer().serializeToString(doc.doctype) + "\n"
        : "";
      const htmlEl = doc.documentElement;
      return doctype + htmlEl.outerHTML;
    } catch {
      // If DOMParser fails (e.g. malformed HTML) fall back to the raw content.
      return html;
    }
  }

  /**
   * "Apply to source" — write the current editor content back to the local
   * file via the bridge. Opens the consent dialog if no grant exists yet, then
   * calls write-local-file with a clean version of the editor content (editor-
   * only attribute stamps stripped).
   *
   * Only operates on HTML/CSS routes (gated by activeLocalhostRouteIsWritable).
   * For non-HTML routes (React/JSX/TS), keep routing to the agent chat instead.
   */
  const handleApplyToSource = useCallback(() => {
    if (
      !id ||
      !canEditDesign ||
      !activeLocalhostConnectionId ||
      !activeLocalhostRelPath
    )
      return;
    const relPath = activeLocalhostRelPath;
    const connectionId = activeLocalhostConnectionId;
    // Snapshot current editor content at call time.
    const rawContent = latestActiveContentRef.current;
    if (!rawContent) {
      toast.error(NO_LOCALHOST_WRITE_CONTENT_MESSAGE);
      return;
    }
    // Strip editor-only attributes before writing so the on-disk file stays
    // clean.  Only strip for HTML routes; CSS files have no DOM attributes.
    const ext = (relPath.match(/\.[^.]+$/) ?? [])[0]?.toLowerCase() ?? "";
    const content =
      ext === ".html" || ext === ".htm"
        ? stripEditorOnlyAttributes(rawContent)
        : rawContent;

    requestLocalhostWrite({
      files: [relPath],
      onGranted: ({ bridgeToken, rootPath: grantedRootPath, grantId }) => {
        void (async () => {
          setApplyToSourcePending(true);
          try {
            await callAction("write-local-file", {
              designId: id,
              connectionId,
              relPath,
              content,
            });
            toast.success(
              `Written to ${relPath} (grant ${grantId.slice(0, 6)}…, root ${grantedRootPath})`,
            );
          } catch (err) {
            toast.error(
              `Write failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            setApplyToSourcePending(false);
          }
          // Suppress unused-var warning; bridgeToken is checked by the bridge
          // internally via the X-Bridge-Token header (set in write-local-file).
          void bridgeToken;
        })();
      },
      onCancel: () => {
        setApplyToSourcePending(false);
      },
    });
  }, [
    id,
    canEditDesign,
    activeLocalhostConnectionId,
    activeLocalhostRelPath,
    requestLocalhostWrite,
  ]);

  // canGroup: 2+ DOM-node layers selected in the active screen (not file rows).
  const fileIdSet = new Set(files.map((f) => f.id));
  const selectedDomLayerIds = selectedLayerIds.filter(
    (id) => !id.startsWith("__") && !fileIdSet.has(id),
  );
  const canGroup =
    canEditDesign &&
    viewMode === "single" &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length >= 2;
  // canUngroup: exactly one DOM-node layer selected.
  const canUngroup =
    canEditDesign &&
    viewMode === "single" &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length === 1;

  const canMoveLayer = useCallback(
    (intent: LayersPanelMoveIntent) => {
      const targetOwner = codeLayerOwnerByNodeId.get(intent.targetId);
      if (
        !targetOwner ||
        effectiveCodeLayerState.lockedIds.has(intent.targetId) ||
        effectiveCodeLayerState.hiddenIds.has(intent.targetId)
      ) {
        return false;
      }
      return intent.draggedIds.some((draggedId) => {
        const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
        if (
          draggedId === intent.targetId ||
          !draggedOwner ||
          effectiveCodeLayerState.lockedIds.has(draggedId) ||
          effectiveCodeLayerState.hiddenIds.has(draggedId)
        ) {
          return false;
        }
        // Same-file move: also exclude ancestor drags (would orphan the node).
        if (draggedOwner.fileId === targetOwner.fileId) {
          return !collectCodeLayerAncestors(
            targetOwner.tree,
            intent.targetId,
          ).includes(draggedId);
        }
        // Cross-file move: allowed as long as neither side is locked/hidden
        // (already checked above). File-row ids are excluded by the owner check.
        return true;
      });
    },
    [codeLayerOwnerByNodeId, effectiveCodeLayerState],
  );

  const handleLayerMove = useCallback(
    (intent: LayersPanelMoveIntent) => {
      if (!canEditDesign) return;
      if (!canMoveLayer(intent)) return;
      const targetOwner = codeLayerOwnerByNodeId.get(intent.targetId);
      if (!targetOwner) return;
      if (
        effectiveCodeLayerState.lockedIds.has(intent.targetId) ||
        effectiveCodeLayerState.hiddenIds.has(intent.targetId)
      ) {
        return;
      }
      const freshActiveContent = getFreshActiveContent();
      const destFile = files.find((file) => file.id === targetOwner.fileId);
      const destContent =
        targetOwner.fileId === activeFile?.id
          ? freshActiveContent
          : (destFile?.content ?? "");
      if (!destContent) return;

      // Group dragged ids by source file so we can handle same-file and
      // cross-file moves independently.
      const sameFileDragIds: string[] = [];
      const crossFileDrags: Array<{ draggedId: string; sourceFileId: string }> =
        [];
      const movedNodeSnapshots = new Map<string, CodeLayerNode>();
      for (const draggedId of intent.draggedIds) {
        const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
        if (
          draggedId === intent.targetId ||
          !draggedOwner ||
          effectiveCodeLayerState.lockedIds.has(draggedId) ||
          effectiveCodeLayerState.hiddenIds.has(draggedId)
        ) {
          continue;
        }
        movedNodeSnapshots.set(draggedId, draggedOwner.node);
        if (draggedOwner.fileId === targetOwner.fileId) {
          sameFileDragIds.push(draggedId);
        } else {
          crossFileDrags.push({
            draggedId,
            sourceFileId: draggedOwner.fileId,
          });
        }
      }

      const targetTreeForMove =
        targetOwner.fileId === activeFile?.id
          ? buildCodeLayerTree(buildCodeLayerProjection(freshActiveContent))
          : targetOwner.tree;
      const orderedSameFileDragIds = sortCodeLayerIdsByTreeOrder(
        sameFileDragIds,
        targetTreeForMove,
      );
      const movedIdOrder = [
        ...orderedSameFileDragIds,
        ...crossFileDrags.map((drag) => drag.draggedId),
      ];

      // --- Same-file moves (existing path) ---
      let nextDestContent = destContent;
      let moved = false;
      for (const draggedId of getLayerMoveIterationOrder(
        orderedSameFileDragIds,
        intent.placement,
      )) {
        const patch = applyVisualEdit(nextDestContent, {
          kind: "moveNode",
          target: { nodeId: draggedId },
          anchor: { nodeId: intent.targetId },
          placement: intent.placement,
        });
        if (patch.result.status !== "applied") {
          toast.error(
            codeLayerPatchMessage(
              patch.result.message,
              t("designEditor.toasts.layerMoveFailed"),
            ),
            { duration: 4000 },
          );
          continue;
        }
        nextDestContent = patch.content;
        moved = true;
      }

      // --- Cross-file moves: use moveNodeBetweenDocuments ---
      // Group by source file so multiple nodes from the same source are
      // applied sequentially against the running source content.
      const sourceContentMap = new Map<string, string>();
      const sourceOriginalContentMap = new Map<string, string>();
      const movedNodeIdByDraggedId = new Map<string, string>();
      for (const { draggedId, sourceFileId } of getLayerMoveIterationOrder(
        crossFileDrags,
        intent.placement,
      )) {
        const srcFile = files.find((f) => f.id === sourceFileId);
        if (!srcFile) continue;
        const currentSourceContent = getLayerMoveSourceContent({
          sourceFileId,
          activeFileId: activeFile?.id,
          activeContent: freshActiveContent,
          sourceFileContent: srcFile.content,
          sourceContentMap,
        });
        if (!sourceOriginalContentMap.has(sourceFileId)) {
          sourceOriginalContentMap.set(sourceFileId, currentSourceContent);
        }

        // The dragged node's data-agent-native-node-id is the node id tracked
        // by code-layer. Look up the actual attribute value from the owner.
        const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
        const nodeAttrId =
          draggedOwner?.node.dataAttributes["data-agent-native-node-id"] ??
          draggedId;
        const anchorAttrId =
          codeLayerOwnerByNodeId.get(intent.targetId)?.node.dataAttributes[
            "data-agent-native-node-id"
          ] ?? intent.targetId;

        const result = moveNodeBetweenDocuments(
          currentSourceContent,
          nextDestContent,
          {
            nodeId: nodeAttrId,
            anchorNodeId: anchorAttrId,
            placement: intent.placement,
          },
        );
        if (result.status !== "applied") {
          toast.error(
            codeLayerPatchMessage(
              result.message,
              t("designEditor.toasts.layerMoveFailed"),
            ),
            { duration: 4000 },
          );
          continue;
        }
        sourceContentMap.set(sourceFileId, result.sourceHtml);
        nextDestContent = result.destHtml;
        movedNodeIdByDraggedId.set(draggedId, result.movedNodeId ?? nodeAttrId);
        moved = true;
      }

      if (!moved) return;

      const finalDestProjection =
        nextDestContent !== destContent
          ? buildCodeLayerProjection(nextDestContent)
          : null;
      const finalDestTree = finalDestProjection
        ? buildCodeLayerTree(finalDestProjection)
        : [];
      const movedNodesAfterMove = movedIdOrder
        .map((draggedId) => {
          const node = movedNodeSnapshots.get(draggedId);
          return node && finalDestProjection
            ? findMovedCodeLayerNodeInProjection(
                finalDestProjection,
                node,
                movedNodeIdByDraggedId.get(draggedId),
              )
            : null;
        })
        .filter((node): node is CodeLayerNode => Boolean(node));

      if (movedNodesAfterMove.length > 0) {
        setSelectedLayerIdsState(movedNodesAfterMove.map((node) => node.id));
        const lastMovedNode =
          movedNodesAfterMove[movedNodesAfterMove.length - 1];
        if (lastMovedNode && targetOwner.fileId === activeFile?.id) {
          setSelectedElement(elementInfoFromCodeLayerNode(lastMovedNode));
        }
        const movedAncestorIds = movedNodesAfterMove.flatMap((node) =>
          collectCodeLayerAncestors(finalDestTree, node.id),
        );
        setExpandedLayerIds((current) => {
          const next = new Set(current);
          next.add(targetOwner.fileId);
          movedAncestorIds.forEach((ancestorId) => next.add(ancestorId));
          return next.size === current.length ? current : Array.from(next);
        });
      }

      const hasCrossFileMoves = sourceContentMap.size > 0;
      if (hasCrossFileMoves) {
        recordContentHistoryEntry({
          changes: [
            ...Array.from(sourceContentMap.entries()).map(
              ([sourceFileId, newSourceContent]) => ({
                fileId: sourceFileId,
                before:
                  sourceOriginalContentMap.get(sourceFileId) ??
                  files.find((file) => file.id === sourceFileId)?.content ??
                  "",
                after: newSourceContent,
              }),
            ),
            ...(nextDestContent !== destContent
              ? [
                  {
                    fileId: targetOwner.fileId,
                    before: destContent,
                    after: nextDestContent,
                  },
                ]
              : []),
          ],
        });
      }

      // Persist source files that changed.
      for (const [sourceFileId, newSourceContent] of sourceContentMap) {
        applyFileContentUpdate(sourceFileId, newSourceContent, {
          recordHistory: !hasCrossFileMoves,
          refreshPreview: false,
        });
      }

      // Persist dest file (which may also be the active file).
      if (nextDestContent !== destContent) {
        applyFileContentUpdate(targetOwner.fileId, nextDestContent, {
          recordHistory: !hasCrossFileMoves,
          refreshPreview: false,
        });
      }
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canMoveLayer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      getFreshActiveContent,
      recordContentHistoryEntry,
      t,
    ],
  );

  const handleLayerHover = useCallback(
    (layerId: string) => {
      const owner = codeLayerOwnerByNodeId.get(layerId);
      if (!owner || owner.fileId !== activeFile?.id) return;
      setHoveredElement(elementInfoFromCodeLayerNode(owner.node));
    },
    [activeFile?.id, codeLayerOwnerByNodeId],
  );

  const handleLayerLeave = useCallback((_layerId: string) => {
    setHoveredElement(null);
  }, []);

  const handleLayerSelectionChange = useCallback(
    (
      ids: string[],
      _intent: {
        additive: boolean;
        currentSelectedIds?: string[];
        id: string;
        range: boolean;
      },
    ) => {
      const nextLayerIds = ids.filter((layerId) => !layerId.startsWith("__"));
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setSelectedLayerIdsState(nextLayerIds);
      const screenFileIds = files
        .filter((file) => !isBoardFile(file.filename))
        .map((file) => file.id);
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds(
          getOverviewScreenIdsFromLayerSelection({
            fileIds: screenFileIds,
            layerIds: nextLayerIds,
          }),
        );
      }
      const selectedId = nextLayerIds[nextLayerIds.length - 1];
      if (!selectedId) {
        setSelectedElement(null);
        return;
      }
      const codeLayerOwner = codeLayerOwnerByNodeId.get(selectedId);
      if (codeLayerOwner) {
        const ownerIsScreenFile = screenFileIds.includes(codeLayerOwner.fileId);
        if (viewModeRef.current === "overview") {
          pendingOverviewScreenSelectionRef.current = ownerIsScreenFile
            ? codeLayerOwner.fileId
            : null;
          pendingOverviewLayerSelectionRef.current = selectedId;
        }
        if (codeLayerOwner.fileId !== activeFile?.id) {
          setActiveFileId(codeLayerOwner.fileId);
        }
        const nextSelectionState = getSidebarCodeLayerSelectionState({
          currentViewMode: viewModeRef.current,
          ownerFileId: codeLayerOwner.fileId,
          overviewSelectedScreenIds,
          screenFileIds,
        });
        viewModeRef.current = nextSelectionState.viewMode;
        setViewMode(nextSelectionState.viewMode);
        if (nextSelectionState.viewMode === "overview") {
          setOverviewSelectedScreenIds(
            nextSelectionState.overviewSelectedScreenIds,
          );
        }
        const layerCanvasBlocked =
          effectiveCodeLayerState.lockedIds.has(codeLayerOwner.fileId) ||
          effectiveCodeLayerState.hiddenIds.has(codeLayerOwner.fileId) ||
          effectiveCodeLayerState.lockedIds.has(selectedId) ||
          effectiveCodeLayerState.hiddenIds.has(selectedId);
        if (layerCanvasBlocked) {
          setSelectedElement(null);
          focusDesignInspectorForSelection();
          setActiveTool("move");
          setMode("edit");
          return;
        }
        setSelectedElement(elementInfoFromCodeLayerNode(codeLayerOwner.node));
        focusDesignInspectorForSelection();
        setActiveTool("move");
        setMode("edit");
        return;
      }
      if (selectedId.startsWith("element:")) return;
      const fileId = selectedId.startsWith("code:")
        ? selectedId.slice("code:".length)
        : selectedId;
      if (
        files.some((file) => file.id === fileId && !isBoardFile(file.filename))
      ) {
        setOverviewSelectedScreenIds([fileId]);
        setActiveFileId(fileId);
        setSelectedElement(null);
        setSelectedLayerIdsState(
          nextLayerIds.some((layerId) =>
            files.some((file) => file.id === layerId),
          )
            ? nextLayerIds
            : [fileId],
        );
        setActiveTool("move");
        setMode("edit");
        viewModeRef.current = "overview";
        setViewMode("overview");
      }
    },
    [
      activeFile?.id,
      clearPendingOverviewLayerSelectionTimer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      focusDesignInspectorForSelection,
      overviewSelectedScreenIds,
    ],
  );

  const handleLayerMarqueeSelectionChange = useCallback(
    (
      selection: CanvasLayerMarqueeSelection[],
      intent: ElementSelectionIntent,
    ) => {
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);

      const resolved = selection
        .map((item) => {
          const projection = getCodeLayerProjectionForScreen(item.screenId);
          if (!projection) return null;
          const canonical = canonicalizeElementInfoFromProjection(
            projection,
            item.info,
          );
          const node = resolveCodeLayerNodeFromElementInfo(
            projection,
            canonical,
          );
          if (!node || isScreenRootElementInfo(canonical)) return null;
          return {
            screenId: item.screenId,
            node,
            elementInfo: canonical,
          };
        })
        .filter(
          (
            item,
          ): item is {
            screenId: string;
            node: CodeLayerNode;
            elementInfo: ElementInfo;
          } => Boolean(item),
        );

      const hitLayerIds = dedupeStringIds(resolved.map((item) => item.node.id));
      setSelectedLayerIdsState((current) =>
        intent.additive
          ? dedupeStringIds([
              ...current.filter((layerId) => !layerId.startsWith("__")),
              ...hitLayerIds,
            ])
          : hitLayerIds,
      );
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }

      const primary = resolved[resolved.length - 1];
      if (primary) {
        setActiveFileId(primary.screenId);
        setSelectedElement(primary.elementInfo);
        focusDesignInspectorForSelection();
      } else if (!intent.additive) {
        setSelectedElement(null);
      }

      setActiveTool("move");
      setMode("edit");
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
    ],
  );

  const handleScreenElementMarqueeSelect = useCallback(
    (
      screenId: string,
      infos: ElementInfo[],
      intent?: ElementSelectionIntent,
    ) => {
      handleLayerMarqueeSelectionChange(
        infos.map((info) => ({ screenId, info })),
        {
          additive: Boolean(
            intent?.additive ||
            intent?.range ||
            intent?.shiftKey ||
            intent?.metaKey ||
            intent?.ctrlKey,
          ),
          range: Boolean(intent?.range || intent?.shiftKey),
          source: "marquee",
          shiftKey: Boolean(intent?.shiftKey),
          metaKey: Boolean(intent?.metaKey),
          ctrlKey: Boolean(intent?.ctrlKey),
        },
      );
    },
    [handleLayerMarqueeSelectionChange],
  );

  const handleElementMarqueeSelect = useCallback(
    (infos: ElementInfo[], intent?: ElementSelectionIntent) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (!screenId) return;
      handleScreenElementMarqueeSelect(screenId, infos, intent);
    },
    [activeFile?.id, activeFileId, handleScreenElementMarqueeSelect],
  );

  const handleLayerRename = useCallback(
    (layerId: string, name: string) => {
      if (!canEditDesign) return;
      if (files.some((file) => file.id === layerId)) {
        updateFileMutation.mutate({ id: layerId, filename: name } as any, {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
          },
          onError: (error) => {
            toast.error(
              error instanceof Error ? error.message : t("common.genericError"),
            );
          },
        });
        return;
      }

      const owner = codeLayerOwnerByNodeId.get(layerId);
      const node = owner?.node;
      if (!owner || !node) return;
      const sourceFile = files.find((file) => file.id === owner.fileId);
      const sourceContent =
        owner.fileId === activeFile?.id
          ? getFreshActiveContent()
          : (sourceFile?.content ?? "");
      if (!sourceContent) return;
      const nextContent = setCodeLayerAttributeInHtml(
        sourceContent,
        node,
        "data-agent-native-layer-name",
        name,
      );
      if (!nextContent || nextContent === sourceContent) return;
      applyFileContentUpdate(owner.fileId, nextContent, {
        refreshPreview: false,
      });
      setSelectedLayerIdsState([layerId]);
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerOwnerByNodeId,
      files,
      getFreshActiveContent,
      queryClient,
      t,
      updateFileMutation,
    ],
  );

  const handleToggleLayerLocked = useCallback(
    (layerId: string, locked: boolean) => {
      if (!canEditDesign) return;
      layerStateOverridesRef.current.set(layerId, {
        ...layerStateOverridesRef.current.get(layerId),
        locked,
      });
      const applyLockedState = () => {
        setLockedLayerIds((current) => {
          const next = new Set(current);
          if (locked) next.add(layerId);
          else next.delete(layerId);
          return next;
        });
      };
      if (files.some((file) => file.id === layerId)) {
        applyLockedState();
        return;
      }
      const owner = codeLayerOwnerByNodeId.get(layerId);
      const node = owner?.node;
      if (!owner || !node) {
        applyLockedState();
        return;
      }
      const sourceFile = files.find((file) => file.id === owner.fileId);
      const sourceContent =
        owner.fileId === activeFile?.id
          ? getFreshActiveContent()
          : (sourceFile?.content ?? "");
      if (sourceContent) {
        const nextContent = setCodeLayerAttributeInHtml(
          sourceContent,
          node,
          "data-agent-native-locked",
          locked ? "true" : null,
        );
        if (nextContent && nextContent !== sourceContent) {
          applyFileContentUpdate(owner.fileId, nextContent, {
            refreshPreview: false,
          });
        }
      }
      applyLockedState();
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerOwnerByNodeId,
      files,
      getFreshActiveContent,
    ],
  );

  const handleToggleLayerHidden = useCallback(
    (layerId: string, hidden: boolean) => {
      if (!canEditDesign) return;
      layerStateOverridesRef.current.set(layerId, {
        ...layerStateOverridesRef.current.get(layerId),
        hidden,
      });
      const applyHiddenState = () => {
        setHiddenLayerIds((current) => {
          const next = new Set(current);
          if (hidden) next.add(layerId);
          else next.delete(layerId);
          return next;
        });
      };
      if (files.some((file) => file.id === layerId)) {
        applyHiddenState();
        return;
      }
      const owner = codeLayerOwnerByNodeId.get(layerId);
      const node = owner?.node;
      if (!owner || !node) {
        applyHiddenState();
        return;
      }
      const sourceFile = files.find((file) => file.id === owner.fileId);
      const sourceContent =
        owner.fileId === activeFile?.id
          ? getFreshActiveContent()
          : (sourceFile?.content ?? "");
      if (sourceContent) {
        const nextContent = setCodeLayerAttributeInHtml(
          sourceContent,
          node,
          "data-agent-native-hidden",
          hidden ? "true" : null,
        );
        if (nextContent && nextContent !== sourceContent) {
          applyFileContentUpdate(owner.fileId, nextContent, {
            refreshPreview: false,
          });
        }
      }
      applyHiddenState();
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerOwnerByNodeId,
      files,
      getFreshActiveContent,
    ],
  );

  const getContextCanvasPoint = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      // In single-screen mode the iframe is inside a scale(zoom/100) wrapper
      // that also centers the content. Using the iframe's own
      // getBoundingClientRect() already incorporates centering/pan because the
      // rect is measured in screen space after the CSS transform. Dividing by
      // the zoom factor converts from post-scale screen-pixels back to the
      // document coordinate space written into left/top by cloneHtmlLayerAtPosition.
      if (viewMode === "single") {
        const iframe = canvasContainerRef.current?.querySelector<HTMLElement>(
          "[data-design-preview-iframe]",
        );
        if (iframe) {
          const iframeRect = iframe.getBoundingClientRect();
          const factor = zoom / 100;
          return {
            x: Math.max(0, (clientX - iframeRect.left) / factor),
            y: Math.max(0, (clientY - iframeRect.top) / factor),
          };
        }
      }
      // Overview mode: fall back to container-relative coords (overview uses its
      // own coordinate mapping for paste; this value is a best-effort fallback).
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 120, y: 120 };
      return {
        x: Math.max(0, clientX - rect.left),
        y: Math.max(0, clientY - rect.top),
      };
    },
    [zoom, viewMode],
  );

  const zoomLabel = `${Math.round(zoom)}%`;
  const [openZoomControl, setOpenZoomControl] = useState<
    "toolbar" | "inspector" | null
  >(null);
  const [zoomInputValue, setZoomInputValue] = useState(zoomLabel);
  useEffect(() => {
    if (!openZoomControl) setZoomInputValue(zoomLabel);
  }, [zoomLabel, openZoomControl]);
  const commitZoomInput = useCallback(() => {
    const next = Number(zoomInputValue.replace("%", "").trim());
    if (!Number.isFinite(next)) {
      setZoomInputValue(zoomLabel);
      return;
    }
    setZoom(Math.max(10, Math.min(500, next)));
    setOpenZoomControl(null);
  }, [setZoom, zoomInputValue, zoomLabel]);

  const handleTokensApplied = useCallback(
    (resolvedCssVars: Record<string, string>) => {
      if (!canEditDesign || !id) return;
      setTweakSelections((prev) => ({
        ...prev,
        ...resolvedCssVars,
      }));
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        let currentData: Record<string, unknown> = {};
        if (typeof old.data === "string" && old.data) {
          try {
            const parsed = JSON.parse(old.data);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              currentData = parsed;
            }
          } catch {
            currentData = {};
          }
        }
        const currentSelections =
          currentData.tweakSelections &&
          typeof currentData.tweakSelections === "object" &&
          !Array.isArray(currentData.tweakSelections)
            ? currentData.tweakSelections
            : {};
        return {
          ...old,
          data: JSON.stringify({
            ...currentData,
            tweakSelections: {
              ...currentSelections,
              ...resolvedCssVars,
            },
          }),
        };
      });
    },
    [canEditDesign, id, queryClient],
  );

  // Hooks must not be called conditionally; keep navigate as an effect so the
  // render phase stays pure. This branch is unreachable in practice because the
  // design.$id.tsx route always supplies an id param.
  useEffect(() => {
    if (!id) navigate("/");
  }, [id, navigate]);

  if (!id) return null;

  if (designLoading || (!design && pendingGenerationActive)) {
    return (
      <DesignEditorSkeleton
        embedded={embedded}
        pendingGeneration={pendingGenerationActive}
      />
    );
  }

  if (!design) {
    return (
      <div className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden bg-[var(--design-editor-canvas-bg)] px-6 py-12">
        <div
          aria-hidden="true"
          className="design-editor-not-found-grid absolute inset-0 opacity-60"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-[var(--design-editor-panel-divider-color)]"
        />
        <div className="relative flex w-full max-w-sm flex-col items-center text-center">
          <div className="mb-2 !text-[11px] font-medium uppercase text-muted-foreground">
            404
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {t("designEditor.notFound")}
          </h1>
          <Button
            variant="default"
            onClick={() => navigate("/")}
            className="mt-7 h-9 cursor-pointer gap-2 rounded-md border border-foreground bg-foreground px-3.5 text-background shadow-sm hover:border-foreground/90 hover:bg-foreground/90 hover:text-background focus-visible:ring-foreground"
          >
            <IconArrowLeft className="size-4 rtl:-scale-x-100" />
            {t("designEditor.backToDesigns")}
          </Button>
        </div>
      </div>
    );
  }

  const deviceFrameIcon =
    deviceFrame === "desktop" ? (
      <IconDeviceDesktop className="size-3" />
    ) : deviceFrame === "tablet" ? (
      <IconDeviceTablet className="size-3" />
    ) : deviceFrame === "mobile" ? (
      <IconDeviceMobile className="size-3" />
    ) : (
      <IconViewportWide className="size-3" />
    );
  const questionFlowActive = pendingQuestionsVisible;

  const deviceFrameControl = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="ml-1 h-8 shrink-0 cursor-pointer gap-0.5 rounded-md px-0 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("designEditor.devicePreview")}
            >
              {deviceFrameIcon}
              <IconChevronDown className="size-2.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.devicePreview")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={deviceFrame}
          onValueChange={(v) => setDeviceFrame(v as DeviceFrameType)}
        >
          <DropdownMenuRadioItem value="none">
            <IconViewportWide className="mr-2 h-4 w-4" />
            {t("designEditor.devices.responsive")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desktop">
            <IconDeviceDesktop className="mr-2 h-4 w-4" />
            {t("designEditor.devices.desktop")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="tablet">
            <IconDeviceTablet className="mr-2 h-4 w-4" />
            {t("designEditor.devices.tablet")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="mobile">
            <IconDeviceMobile className="mr-2 h-4 w-4" />
            {t("designEditor.devices.mobile")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const projectMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[calc(var(--spacing)*5.5)]"
          aria-label={t("designEditor.more")}
        >
          <AgentNativeMenuMark className="size-[calc(var(--spacing)*5.5)] text-foreground dark:text-white" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="design-editor-app-menu-content w-64"
      >
        <DropdownMenuItem asChild>
          <Link to="/">
            <IconArrowLeft className="mr-2 h-4 w-4" />
            {t("designEditor.backToDesigns")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconFileExport className="mr-2 h-4 w-4" />
            {t("designEditor.export")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-56">
            <DropdownMenuItem
              onClick={handleDownloadHtml}
              disabled={!activeFile || exportHtmlMutation.isPending}
            >
              <IconCode className="mr-2 h-4 w-4" />
              {t("designEditor.downloadHtml")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void handleDownloadPng()}
              disabled={!activeFile || pngExporting}
            >
              <IconPhoto className="mr-2 h-4 w-4" />
              {t("designEditor.downloadPng")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void handleDownloadSvg()}
              disabled={!activeFile || svgExporting}
            >
              <IconCode className="mr-2 h-4 w-4" />
              {t("designEditor.downloadSvg")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDownloadZip}
              disabled={!activeFile || exportZipMutation.isPending}
            >
              <IconArchive className="mr-2 h-4 w-4" />
              {t("designEditor.downloadZip")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleCopyCodingHandoff}
              disabled={!activeFile || codingHandoffLoading}
            >
              <IconDownload className="mr-2 h-4 w-4" />
              {t("designEditor.copyCodingHandoff")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconPencil className="mr-2 h-4 w-4" />
            {t("designEditor.modes.edit")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
            <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}>
              {t("designEditor.undo")}
              <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}>
              {t("designEditor.redo")}
              <DropdownMenuShortcut>
                {"⇧⌘Z" /* i18n-ignore keyboard shortcut */}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDuplicateSelection}
              disabled={!activeFile}
            >
              {"Duplicate" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDeleteSelection}
              disabled={!selectedElement && (!activeFile || files.length <= 1)}
            >
              {"Delete" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconLayoutGrid className="mr-2 h-4 w-4" />
            {"View" /* i18n-ignore design menu section */}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
            <DropdownMenuItem onClick={handleViewModeToggle}>
              {viewMode === "overview"
                ? t("designEditor.currentScreen")
                : t("designEditor.screenOverview")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleZoomOut}>
              {t("designEditor.zoomOut")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleZoomIn}>
              {t("designEditor.zoomIn")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onClick={handlePinToolToggle}
          disabled={!activeFile || viewMode === "overview"}
        >
          <IconPin className="mr-2 h-4 w-4" />
          {pinMode
            ? t("designEditor.stopPinningComments")
            : t("designEditor.pinComment")}
        </DropdownMenuItem>
        {isSignedIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                handleOpenMakeReal();
              }}
            >
              <IconRocket className="mr-2 h-4 w-4" />
              {"Make this a real app" /* i18n-ignore */}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const projectTitleControl =
    titleEditing && canEditDesign ? (
      <Input
        autoFocus
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitleEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitTitleEdit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setTitleEditing(false);
          }
        }}
        className="-mx-1 h-7 min-w-0 flex-1 border-transparent bg-[var(--design-editor-panel-raised-bg)] px-1 py-0 text-[13px] font-medium text-foreground shadow-none ring-offset-0 focus-visible:border-[var(--design-editor-control-border)] focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0"
      />
    ) : canEditDesign ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              if (!canEditDesign) return;
              setTitleDraft(design.title);
              setTitleEditing(true);
            }}
            disabled={!canEditDesign}
            className="-mx-1 min-w-0 flex-1 cursor-text truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90 hover:bg-accent/50"
          >
            {design.title}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.clickToRename")}</TooltipContent>
      </Tooltip>
    ) : (
      <span className="-mx-1 min-w-0 flex-1 truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90">
        {design.title}
      </span>
    );

  const renderZoomControl = (controlId: "toolbar" | "inspector") => (
    <DropdownMenu
      open={openZoomControl === controlId}
      onOpenChange={(open) => {
        if (open) {
          setZoomInputValue(zoomLabel);
          setOpenZoomControl(controlId);
          return;
        }
        setOpenZoomControl((current) =>
          current === controlId ? null : current,
        );
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-0.5 px-1 text-[10px] tabular-nums text-muted-foreground cursor-pointer hover:text-foreground"
            >
              {zoomLabel}
              <IconChevronDown className="size-2.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.zoom")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-72 overflow-hidden rounded-xl border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-0 shadow-2xl"
      >
        <div className="p-3">
          <Input
            autoFocus
            value={zoomInputValue}
            onChange={(event) => setZoomInputValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitZoomInput();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setZoomInputValue(zoomLabel);
                setOpenZoomControl(null);
              }
            }}
            className="h-10 rounded-md border-[var(--design-editor-accent-color)] bg-[var(--design-editor-control-bg)] px-3 text-base font-medium tabular-nums text-foreground shadow-none focus-visible:ring-2 focus-visible:ring-[var(--design-editor-accent-color)]"
            aria-label={"Zoom percentage" /* i18n-ignore zoom field */}
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleZoomIn}
          className="h-12 px-12 text-[15px]"
        >
          <span className="flex-1">{"Zoom in" /* i18n-ignore */}</span>
          <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomOut}
          className="h-12 px-12 text-[15px]"
        >
          <span className="flex-1">{"Zoom out" /* i18n-ignore */}</span>
          <DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomToFit}
          className="h-12 px-12 text-[15px]"
        >
          <span className="flex-1">{"Zoom to fit" /* i18n-ignore */}</span>
          <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
        </DropdownMenuItem>
        {[50, 100, 200].map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => setZoom(preset)}
            className="h-12 px-12 text-[15px]"
          >
            <span className="flex-1">
              {"Zoom to " /* i18n-ignore */}
              {preset}%
            </span>
            {preset === 100 ? (
              <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const signedOutPersistenceActions = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 cursor-pointer gap-1.5 rounded-md bg-[var(--design-editor-panel-raised-bg)] px-3 text-sm shadow-none"
            aria-label={t("designEditor.signUpToSave")}
          >
            <a href={signInToSaveHref} role="button">
              <span>{t("designEditor.signUpToSave")}</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.signUpToSave")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="default"
            size="sm"
            className="h-8 cursor-pointer gap-1.5 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)]"
            aria-label={t("designEditor.share")}
          >
            <a href={signInToShareHref} role="button">
              <span>{t("designEditor.share")}</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.signUpToShare")}</TooltipContent>
      </Tooltip>
    </>
  );

  const rightSidebarActions = (
    <div className="shrink-0 border-b border-border bg-[var(--design-editor-panel-bg)] px-2 py-1.5">
      <div className="flex min-h-8 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <DesignCollaboratorsMenu
            collaborators={designCollaborators}
            followingEmail={followingEmail}
            label={t("designEditor.collaborators")}
            onAvatarClick={handleAvatarClick}
          />
          {deviceFrameControl}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Popover
            open={publishWaitlistPopoverOpen}
            onOpenChange={(open) => {
              setPublishWaitlistPopoverOpen(open);
              setPublishWaitlistPopoverView("actions");
              if (open) {
                setPublishWaitlistError(null);
              }
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 cursor-pointer gap-1 rounded-md px-2 text-foreground hover:bg-accent hover:text-foreground"
                    aria-label={"Preview or publish app" /* i18n-ignore */}
                  >
                    <IconPlayerPlay className="size-5" />
                    <IconChevronDown className="size-3 opacity-70" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {"Preview or publish app" /* i18n-ignore */}
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="z-[100010] w-72 space-y-3 p-3"
            >
              {publishWaitlistPopoverView === "actions" ? (
                <div className="space-y-1">
                  <Button
                    variant="ghost"
                    className="h-9 w-full justify-start gap-2 px-2 text-sm"
                    onClick={() => {
                      handleOpenDesignPreview();
                      setPublishWaitlistPopoverOpen(false);
                    }}
                    disabled={!activeScreenPreviewUrl && !activeContent.trim()}
                  >
                    <IconPlayerPlay className="size-4" />
                    {t("designEditor.designPreview")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-9 w-full justify-start gap-2 px-2 text-sm"
                    onClick={() => setPublishWaitlistPopoverView("waitlist")}
                  >
                    <IconArrowUpRight className="size-4" />
                    {"Publish app" /* i18n-ignore */}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {
                        publishWaitlistJoined
                          ? "You're on the waitlist" /* i18n-ignore */
                          : "Publish app" /* i18n-ignore */
                      }
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {
                        publishWaitlistJoined
                          ? "We'll follow up when app publishing is ready for your workspace." /* i18n-ignore */
                          : isSignedIn
                            ? "Publish directly from Design is opening soon. Want early access?" /* i18n-ignore */
                            : "Publish directly from Design is opening soon. Sign in to join the waitlist." /* i18n-ignore */
                      }
                    </p>
                  </div>
                  {publishWaitlistError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {publishWaitlistError}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 cursor-pointer"
                      onClick={() => setPublishWaitlistPopoverOpen(false)}
                    >
                      {
                        publishWaitlistJoined
                          ? "Done" /* i18n-ignore */
                          : "Not now" /* i18n-ignore */
                      }
                    </Button>
                    {!publishWaitlistJoined && (
                      <Button
                        size="sm"
                        className="h-8 cursor-pointer"
                        onClick={() => void handleJoinPublishWaitlist()}
                        disabled={joiningPublishWaitlist}
                      >
                        {joiningPublishWaitlist ? (
                          <>
                            <Spinner className="mr-1.5 size-3.5" />
                            {"Joining" /* i18n-ignore */}
                          </>
                        ) : isSignedIn ? (
                          "Add me to waitlist" /* i18n-ignore */
                        ) : (
                          "Sign in to join" /* i18n-ignore */
                        )}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>

          {canRenderAuthenticatedShare ? (
            <ShareButton
              resourceType="design"
              resourceId={id}
              resourceTitle={design.title}
              hideTriggerIcon
              defaultOpen={shouldOpenShare}
              shareUrl={editorShareUrl}
              shareUrlLabel={t("designEditor.shareEditorLink")}
              shareUrlDescription={t("designEditor.shareEditorLinkDescription")}
              showShareLinks={false}
              showDoneButton={false}
              shareFooterContent={shareLinkFooter}
              shareTabs={designShareTabs}
              popoverClassName={designSharePopoverClassName}
              triggerClassName="h-8 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
            />
          ) : sessionResolved ? (
            signedOutPersistenceActions
          ) : null}
        </div>
      </div>
    </div>
  );

  const leftContentWidth = Math.max(leftSidebarWidth, 320);
  return (
    // h-full not flex-1: the parent <main> uses overflow-y-auto, not flex,
    // so flex-1 on the child doesn't resolve to the available height. h-full
    // works because main itself has a definite height (flex-1 inside a
    // flex-col page shell). Without this the canvas collapses to ~150px.
    <div className="h-full flex flex-col overflow-hidden bg-[var(--design-editor-canvas-bg)]">
      {isBuilderDesignEmbed && builderPreviewUrl && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--design-editor-canvas-bg)]">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
            <span className="flex-1 truncate text-sm font-medium text-foreground">
              {t("designEditor.designPreview")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer"
              onClick={() => {
                window.parent.postMessage(
                  { type: "design:close" },
                  parentOriginRef.current ?? window.location.origin,
                );
              }}
            >
              <IconX className="size-4" />
            </Button>
          </div>
          <iframe
            className="min-h-0 flex-1 border-0"
            src={builderPreviewUrl}
            title={t("designEditor.designPreview")}
            allow="fullscreen"
          />
        </div>
      )}
      {/* Toolbar */}
      <header className="hidden">
        <div className="relative flex h-full min-w-max w-full items-center gap-2 px-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[calc(var(--spacing)*6.4)]"
                aria-label={t("designEditor.more")}
              >
                <AgentNativeMenuMark className="size-[calc(var(--spacing)*6.4)] text-foreground dark:text-white" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="design-editor-app-menu-content w-64"
            >
              <DropdownMenuItem asChild>
                <Link to="/">
                  <IconArrowLeft className="mr-2 h-4 w-4" />
                  {t("designEditor.backToDesigns")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <IconFileExport className="mr-2 h-4 w-4" />
                  {t("designEditor.export")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="design-editor-app-menu-content w-56">
                  <DropdownMenuItem
                    onClick={handleDownloadHtml}
                    disabled={!activeFile || exportHtmlMutation.isPending}
                  >
                    <IconCode className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadHtml")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleDownloadPng()}
                    disabled={!activeFile || pngExporting}
                  >
                    <IconPhoto className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadPng")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleDownloadSvg()}
                    disabled={!activeFile || svgExporting}
                  >
                    <IconCode className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadSvg")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDownloadZip}
                    disabled={!activeFile || exportZipMutation.isPending}
                  >
                    <IconArchive className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadZip")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleCopyCodingHandoff}
                    disabled={!activeFile || codingHandoffLoading}
                  >
                    <IconDownload className="mr-2 h-4 w-4" />
                    {t("designEditor.copyCodingHandoff")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <IconPencil className="mr-2 h-4 w-4" />
                  {t("designEditor.modes.edit")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
                  <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}>
                    {t("designEditor.undo")}
                    <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}>
                    {t("designEditor.redo")}
                    <DropdownMenuShortcut>
                      {"⇧⌘Z" /* i18n-ignore keyboard shortcut */}
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleDuplicateSelection}
                    disabled={!activeFile}
                  >
                    {"Duplicate" /* i18n-ignore design menu command */}
                    <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDeleteSelection}
                    disabled={
                      !selectedElement && (!activeFile || files.length <= 1)
                    }
                  >
                    {"Delete" /* i18n-ignore design menu command */}
                    <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <IconLayoutGrid className="mr-2 h-4 w-4" />
                  {"View" /* i18n-ignore design menu section */}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
                  <DropdownMenuItem onClick={handleViewModeToggle}>
                    {viewMode === "overview"
                      ? t("designEditor.currentScreen")
                      : t("designEditor.screenOverview")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleZoomOut}>
                    {t("designEditor.zoomOut")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleZoomIn}>
                    {t("designEditor.zoomIn")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                onClick={handlePinToolToggle}
                disabled={
                  !canEditDesign || !activeFile || viewMode === "overview"
                }
              >
                <IconPin className="mr-2 h-4 w-4" />
                {pinMode
                  ? t("designEditor.stopPinningComments")
                  : t("designEditor.pinComment")}
              </DropdownMenuItem>
              {isSignedIn && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      handleOpenMakeReal();
                    }}
                  >
                    <IconRocket className="mr-2 h-4 w-4" />
                    {"Make this a real app" /* i18n-ignore */}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {titleEditing && canEditDesign ? (
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitleEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setTitleEditing(false);
                }
              }}
              className="h-7 w-40 text-sm sm:w-[240px]"
            />
          ) : canEditDesign ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(design.title);
                    setTitleEditing(true);
                  }}
                  className="max-w-[38vw] cursor-text truncate rounded px-1 -mx-1 text-left text-sm font-medium text-foreground/90 hover:bg-accent/50 sm:max-w-[240px]"
                >
                  {design.title}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("designEditor.clickToRename")}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="max-w-[38vw] truncate rounded px-1 -mx-1 text-left text-sm font-medium text-foreground/90 sm:max-w-[240px]">
              {design.title}
            </span>
          )}
          {!embedded && canEditDesign && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <Tabs
                value={mode}
                onValueChange={(v) => handleModeChange(v as EditorMode)}
              >
                <TabsList className="pointer-events-auto h-8">
                  <TabsTrigger value="edit" className="h-6 gap-1 px-2 text-xs">
                    {mode === "edit" && (
                      <IconTransformPoint className="h-3 w-3" />
                    )}
                    {t("designEditor.modes.edit")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="interact"
                    className="h-6 gap-1 px-2 text-xs"
                    disabled={!activeFile || viewMode === "overview"}
                  >
                    {mode === "interact" && (
                      <IconHandClick className="h-3 w-3" />
                    )}
                    {t("designEditor.modes.interact")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="annotate"
                    className="h-6 gap-1 px-2 text-xs"
                    disabled={!activeFile || viewMode === "overview"}
                  >
                    {mode === "annotate" && <IconBrush className="h-3 w-3" />}
                    {t("designEditor.modes.annotate")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
            {!embedded && (
              <>
                {/* Device preview — collapsed into a single menu. */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 cursor-pointer"
                          aria-label={t("designEditor.devicePreview")}
                        >
                          {deviceFrame === "desktop" ? (
                            <IconDeviceDesktop className="w-3.5 h-3.5" />
                          ) : deviceFrame === "tablet" ? (
                            <IconDeviceTablet className="w-3.5 h-3.5" />
                          ) : deviceFrame === "mobile" ? (
                            <IconDeviceMobile className="w-3.5 h-3.5" />
                          ) : (
                            <IconViewportWide className="w-3.5 h-3.5" />
                          )}
                          <IconChevronDown className="w-3 h-3 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("designEditor.devicePreview")}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuRadioGroup
                      value={deviceFrame}
                      onValueChange={(v) =>
                        setDeviceFrame(v as DeviceFrameType)
                      }
                    >
                      <DropdownMenuRadioItem value="none">
                        <IconViewportWide className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.responsive")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="desktop">
                        <IconDeviceDesktop className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.desktop")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="tablet">
                        <IconDeviceTablet className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.tablet")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="mobile">
                        <IconDeviceMobile className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.mobile")}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                {renderZoomControl("toolbar")}

                <div className="mx-1 h-5 w-px bg-border" />
              </>
            )}

            {!embedded && isSignedIn && (
              <PresenceBar
                activeUsers={activeUsers}
                agentActive={agentActive}
                currentUserEmail={session?.email}
                onAvatarClick={handleAvatarClick}
                followingEmail={followingEmail}
              />
            )}

            {!embedded && canRenderAuthenticatedShare ? (
              <ShareButton
                resourceType="design"
                resourceId={id}
                resourceTitle={design.title}
                hideTriggerIcon
                shareUrl={editorShareUrl}
                shareUrlLabel={t("designEditor.shareEditorLink")}
                shareUrlDescription={t(
                  "designEditor.shareEditorLinkDescription",
                )}
                showShareLinks={false}
                showDoneButton={false}
                shareFooterContent={shareLinkFooter}
                shareTabs={designShareTabs}
                popoverClassName={designSharePopoverClassName}
                triggerClassName="h-8 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
              />
            ) : !embedded && sessionResolved ? (
              signedOutPersistenceActions
            ) : null}
          </div>
        </div>
      </header>

      {/* Main canvas area */}
      <div className="flex-1 flex overflow-hidden relative">
        {!embedded ? (
          <div className="relative flex min-h-0 shrink-0 border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)]">
            <DesignWorkspaceRail
              activePanel={activeLeftPanel}
              disabledPanels={
                initialGenerationChromeLimited
                  ? INITIAL_GENERATION_DISABLED_LEFT_PANELS
                  : undefined
              }
              motionOpen={motionDockOpen}
              motionDisabled={!activeFile}
              projectMenu={projectMenu}
              onMotionToggle={() => setMotionDockOpenAnimated(!motionDockOpen)}
              onPanelChange={setActiveLeftPanel}
            />
            <div
              className="flex min-h-0 shrink-0 flex-col bg-[var(--design-editor-panel-bg)] transition-[width] duration-150 ease-out"
              style={{ width: leftContentWidth }}
            >
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "file" ? "flex" : "hidden",
                )}
              >
                <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3">
                  {projectTitleControl}
                </div>
                <div className="min-h-0 flex-1">
                  <LayersPanel
                    screens={layerPanelFiles}
                    activeScreenId={activeFileId ?? undefined}
                    screenOverviewActive={viewMode === "overview"}
                    files={
                      viewMode === "overview"
                        ? overviewLayerPanelFiles
                        : undefined
                    }
                    layers={
                      viewMode === "overview"
                        ? undefined
                        : activeLayerPanelNodes
                    }
                    selectedIds={layerPanelSelectedIds}
                    expandedIds={layerPanelExpandedIds}
                    searchQuery={layersSearchQuery}
                    onScreenSelect={handleSidebarScreenSelect}
                    onScreenOverview={handleSidebarScreenOverview}
                    onAddScreen={handleAddScreen}
                    onSearchQueryChange={setLayersSearchQuery}
                    onExpandedIdsChange={setExpandedLayerIds}
                    onSelectionChange={handleLayerSelectionChange}
                    onRename={handleLayerRename}
                    onToggleLocked={handleToggleLayerLocked}
                    onToggleHidden={handleToggleLayerHidden}
                    onHoverLayer={handleLayerHover}
                    onLeaveLayer={handleLayerLeave}
                    onMoveLayer={handleLayerMove}
                    canMoveLayer={canMoveLayer}
                    boardElements={
                      viewMode === "overview" ? boardElements : undefined
                    }
                  />
                </div>
              </div>
              <div
                data-design-agent-panel
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "agent" ? "flex" : "hidden",
                )}
              >
                {canEditDesign ? (
                  <AgentChatSurface
                    mode="panel"
                    className="min-h-0 flex-1 border-0 bg-transparent shadow-none"
                    storageKey={DESIGN_CHAT_STORAGE_KEY}
                    emptyStateText={t("chat.emptyState")}
                    suggestions={[
                      t("chat.suggestionLandingPage"),
                      t("chat.suggestionBrandMatch"),
                      t("chat.suggestionMobile"),
                    ]}
                    scope={designChatScope}
                    showScopeBadge={false}
                    browserTabId={browserTabId}
                  />
                ) : (
                  <ReadOnlyEditorPanel
                    title={
                      "Agent chat requires editor access" /* i18n-ignore */
                    }
                    description={
                      "Ask an owner for edit access before using the agent to change this design." /* i18n-ignore */
                    }
                  />
                )}
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "assets" ? "flex" : "hidden",
                )}
              >
                <div className="flex min-h-8 shrink-0 items-center border-b border-border/60 px-3">
                  <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                    {t("designEditor.leftRail.assets")}
                  </h3>
                </div>
                {canEditDesign ? (
                  <AssetLibraryPanel context={designExtensionContext} />
                ) : (
                  <ReadOnlyEditorPanel
                    title={"Assets require editor access" /* i18n-ignore */}
                    description={
                      "Ask an owner for edit access before inserting assets into this design." /* i18n-ignore */
                    }
                  />
                )}
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "tools" ? "flex" : "hidden",
                )}
              >
                {canEditDesign ? (
                  <DesignExtensionsPanel
                    context={designExtensionContext}
                    hideAssetLibrary
                    title={t("designEditor.leftRail.tools")}
                  />
                ) : (
                  <ReadOnlyEditorPanel
                    title={"Tools require editor access" /* i18n-ignore */}
                    description={
                      "Ask an owner for edit access before running tools or creating extensions for this design." /* i18n-ignore */
                    }
                  />
                )}
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "tokens" ? "flex" : "hidden",
                )}
              >
                {id && canEditDesign ? (
                  <>
                    <div className="flex min-h-8 shrink-0 items-center border-b border-border/60 px-3">
                      <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                        {t("designEditor.tokens.title")}
                      </h3>
                    </div>
                    <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                      <TokensPanel
                        designId={id}
                        onTokensApplied={handleTokensApplied}
                      />
                    </div>
                  </>
                ) : (
                  <ReadOnlyEditorPanel
                    title={"Tokens require editor access" /* i18n-ignore */}
                    description={
                      "Ask an owner for edit access before importing, creating, or applying tokens." /* i18n-ignore */
                    }
                  />
                )}
              </div>
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("layersPanel.title")}
              className="absolute right-[-2px] top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--design-editor-selection-color)]"
              onPointerDown={(event) => startSidebarResize("left", event)}
            />
          </div>
        ) : null}

        {!embedded && canEditDesign && activeFile && !questionFlowActive && (
          <DesignBottomToolbar
            mode={mode}
            pinMode={pinMode}
            drawMode={drawMode}
            activeTool={activeTool}
            isOverview={viewMode === "overview"}
            hasActiveFile={Boolean(activeFile)}
            onMove={handleMoveTool}
            onFrame={handleFrameTool}
            onShape={handleShapeTool}
            onText={handleTextTool}
            onPen={handlePenTool}
            onHand={handleHandTool}
            onDraw={handleDrawTool}
            onScale={handleScaleTool}
            onCommentPin={handlePinToolToggle}
            onModeChange={handleModeChange}
          />
        )}

        {/* Canvas */}
        {questionFlowActive ? (
          <div className="relative mx-1 h-full min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--design-editor-canvas-bg)]">
            <QuestionFlow
              questions={pendingQuestions ?? []}
              onSubmit={handleQuestionsSubmit}
              onSkip={handleQuestionsSkip}
              title={pendingQuestionsTitle}
              description={pendingQuestionsDescription}
              skipLabel={pendingQuestionsSkipLabel}
              submitLabel={pendingQuestionsSubmitLabel}
            />
          </div>
        ) : (
          <CanvasContextMenu
            ref={canvasContextMenuRef}
            selectedCount={selectedElement ? 1 : selectedScreenIds.length}
            hasClipboard={hasCanvasClipboard}
            hasPropsClipboard={hasPropsClipboard}
            isLocked={activeLayerLocked}
            isHidden={activeLayerHidden}
            canPasteHere={
              canEditDesign && hasCanvasClipboard && Boolean(activeFile)
            }
            canSelectAll={files.length > 0}
            canZoomToFit={Boolean(activeFile)}
            canZoomToSelection={Boolean(
              selectedElement || selectedScreenIds.length > 0,
            )}
            canCopy={Boolean(selectedElement?.selector)}
            canPaste={
              canEditDesign && hasCanvasClipboard && Boolean(activeFile)
            }
            canPasteOver={
              canEditDesign && hasCanvasClipboard && Boolean(activeFile)
            }
            canDuplicate={canEditDesign && Boolean(activeFile)}
            canDelete={Boolean(
              canEditDesign &&
              (selectedElement ||
                (selectedScreenIds.length > 0 && files.length > 1)),
            )}
            canReorder={canEditDesign && Boolean(selectedElement)}
            canRename={false}
            canToggleLocked={canEditDesign && Boolean(activeLayerId)}
            canToggleHidden={canEditDesign && Boolean(activeLayerId)}
            canCopyProps={Boolean(selectedElement)}
            canPasteProps={
              canEditDesign && hasPropsClipboard && Boolean(selectedElement)
            }
            canCopyAsCode={Boolean(selectedElement?.selector)}
            canGroup={canGroup}
            canUngroup={canUngroup}
            hiddenActions={["rename"]}
            getCanvasPoint={getContextCanvasPoint}
            onPasteHere={(details) =>
              handlePasteSelection(
                details.point?.canvasX !== undefined &&
                  details.point.canvasY !== undefined
                  ? { x: details.point.canvasX, y: details.point.canvasY }
                  : undefined,
              )
            }
            onSelectAll={handleSelectAllFrames}
            onZoomToFit={handleZoomToFit}
            onZoomToSelection={() => setZoom(150)}
            onCopy={handleCopySelection}
            onPaste={() => handlePasteSelection()}
            onPasteOver={handlePasteOverSelection}
            onDuplicate={handleDuplicateSelection}
            onDelete={handleDeleteSelection}
            onBringForward={() => changeSelectedZIndex("forward")}
            onBringToFront={() => changeSelectedZIndex("front")}
            onSendBackward={() => changeSelectedZIndex("backward")}
            onSendToBack={() => changeSelectedZIndex("back")}
            onToggleLocked={() => {
              if (activeLayerId) {
                handleToggleLayerLocked(activeLayerId, !activeLayerLocked);
              }
            }}
            onToggleHidden={() => {
              if (activeLayerId) {
                handleToggleLayerHidden(activeLayerId, !activeLayerHidden);
              }
            }}
            onGroup={canGroup ? handleGroupSelection : undefined}
            onUngroup={canUngroup ? handleUngroupSelection : undefined}
            onCopyProps={handleCopyProps}
            onPasteProps={handlePasteProps}
            onCopyAsCode={handleCopySelection}
          >
            {activeFile ? (
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {/* "Apply to source" affordance: write the current editor
                    content back to the local HTML/CSS file via the bridge.
                    Only shown for localhost-backed screens where the route
                    maps to an .html/.htm/.css file and the user has editor
                    access. Opens the consent dialog on first use. */}
                {activeLocalhostRouteIsWritable && canEditDesign && id && (
                  <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 gap-1.5 px-2 !text-[11px]"
                      disabled={applyToSourcePending}
                      onClick={handleApplyToSource}
                    >
                      <IconDeviceFloppy className="size-3 shrink-0" />
                      {applyToSourcePending
                        ? t("designEditor.writingToSource")
                        : activeLocalhostRelPath
                          ? t("designEditor.applyToSourcePath", {
                              path: activeLocalhostRelPath,
                            })
                          : t("designEditor.applyToSource")}
                    </Button>
                  </div>
                )}
                <div
                  ref={canvasContainerRef}
                  className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-canvas-bg)]"
                  onPointerMove={handleCanvasPointerMove}
                >
                  {/* Transparent shield that blocks pointer events reaching the
                    iframe when a portaled Radix popover (e.g. color picker) is
                    open. The iframe has its own event context so it receives
                    pointer events even when visually covered by the popover. */}
                  {inspectorPopoverOpen && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 10,
                        pointerEvents: "auto",
                      }}
                    />
                  )}
                  {showPendingVisualStyleApply ? (
                    <div className="pointer-events-none absolute bottom-5 right-5 z-[70] flex items-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            className="pointer-events-auto h-11 cursor-pointer rounded-md bg-blue-500 px-4 text-sm font-semibold text-white shadow-[0_18px_40px_-20px_rgba(37,99,235,0.9)] hover:bg-blue-400 focus-visible:ring-blue-400"
                            aria-label={t(
                              "designEditor.pendingVisualStyles.applyAria",
                            )}
                          >
                            <IconBrush className="h-4 w-4" />
                            {t("designEditor.pendingVisualStyles.applyButton")}
                            <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-semibold text-white">
                              {pendingVisualStylePropertyCount}
                            </span>
                            <IconChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="design-editor-app-menu-content w-64"
                        >
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            {t("designEditor.pendingVisualStyles.previewLabel")}
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={handleApplyPendingVisualStylesWithAgent}
                          >
                            <IconMessage className="mr-2 h-4 w-4" />
                            {t(
                              "designEditor.pendingVisualStyles.applyWithAgent",
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={handleCopyPendingVisualStylePrompt}
                          >
                            <IconClipboard className="mr-2 h-4 w-4" />
                            {t("designEditor.pendingVisualStyles.copyPrompt")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : null}
                  {viewMode === "overview" ? (
                    <MultiScreenCanvas
                      screens={overviewScreens}
                      zoom={overviewCanvasZoom}
                      onZoomChange={setExplicitOverviewCanvasZoom}
                      activeId={activeFileId}
                      selectedScreenIds={overviewSelectedScreenIds}
                      fullViewScreenIds={fullViewScreenIds}
                      activeScreenHasHoveredChild={
                        Boolean(hoveredElement) &&
                        !hoveredElementIsScreenRoot &&
                        hoveredElementScreenId === activeFileId
                      }
                      hoveredChildScreenId={hoveredChildScreenId}
                      directlyHoveredScreenId={hoveredScreenRootId}
                      previewDeviceFrame={deviceFrame}
                      activeTool={activeTool}
                      onActiveToolChange={(tool) =>
                        setActiveTool(tool === "rectangle" ? "rect" : tool)
                      }
                      selectAllRequest={overviewSelectAllRequest}
                      clearSelectionRequest={overviewClearSelectionRequest}
                      onScreenSelectionChange={
                        handleOverviewScreenSelectionChange
                      }
                      geometryById={canvasFrameGeometryById}
                      onGeometryChange={queueFrameGeometrySave}
                      onGeometryCommit={handleGeometryCommit}
                      onCreatePrimitive={handleCreatePrimitive}
                      onPrimitiveCreated={handlePrimitiveCreated}
                      onPrimitiveReparent={handleOverviewPrimitiveReparent}
                      onCrossScreenElementDrop={handleCrossScreenElementDrop}
                      boardFileId={boardFileId}
                      boardIsActive={activeFileId === boardFileId}
                      boardFileContent={boardFileContent}
                      boardFrameGeometry={boardFrameGeometry}
                      boardClearSelectionRequest={overviewClearSelectionRequest}
                      boardSelectedSelector={
                        activeFileId === boardFileId
                          ? selectedCanvasSelector
                          : null
                      }
                      boardSelectedSelectorCandidates={
                        activeFileId === boardFileId
                          ? selectedCanvasSelectorCandidates
                          : []
                      }
                      boardHoveredSelector={
                        hoveredElementScreenId === boardFileId
                          ? hoveredCanvasSelector
                          : null
                      }
                      boardHoveredSelectorCandidates={
                        hoveredElementScreenId === boardFileId
                          ? hoveredCanvasSelectorCandidates
                          : []
                      }
                      boardLockedSelectors={
                        boardFileId
                          ? getLayerSelectorsForFile(
                              boardFileId,
                              lockedLayerIds,
                            )
                          : []
                      }
                      boardHiddenSelectors={
                        boardFileId
                          ? getLayerSelectorsForFile(
                              boardFileId,
                              hiddenLayerIds,
                            )
                          : []
                      }
                      onBoardDrawPrimitive={
                        canEditDesign ? handleBoardDrawPrimitive : undefined
                      }
                      boardEditMode={canEditDesign}
                      onBoardElementSelect={
                        boardFileId
                          ? (info, intent) =>
                              handleScreenElementSelect(
                                boardFileId,
                                info,
                                intent,
                              )
                          : undefined
                      }
                      onBoardElementMarqueeSelect={
                        boardFileId
                          ? (infos, intent) =>
                              handleScreenElementMarqueeSelect(
                                boardFileId,
                                infos,
                                intent,
                              )
                          : undefined
                      }
                      onBoardElementHover={
                        boardFileId
                          ? (info) =>
                              handleScreenElementHover(boardFileId, info)
                          : undefined
                      }
                      onBoardElementClear={
                        boardFileId
                          ? () => handleScreenElementClear(boardFileId)
                          : undefined
                      }
                      onBoardIframeHotkey={handleIframeHotkey}
                      onBoardIframeContextMenu={handleIframeContextMenu}
                      onBoardTextEditingStateChange={setTextEditingState}
                      onBoardElementDblClickText={
                        boardFileId
                          ? (info) =>
                              handleScreenElementDblClickText(boardFileId, info)
                          : undefined
                      }
                      onBoardVisualStyleChange={
                        boardFileId
                          ? (selector, styles, info) =>
                              handleScreenVisualStyleChange(
                                boardFileId,
                                selector,
                                styles,
                                info,
                              )
                          : undefined
                      }
                      onBoardVisualStructureChange={
                        boardFileId
                          ? (
                              selector,
                              anchorSelector,
                              placement,
                              info,
                              details,
                            ) =>
                              handleScreenVisualStructureChange(
                                boardFileId,
                                selector,
                                anchorSelector,
                                placement,
                                info,
                                details,
                              )
                          : undefined
                      }
                      onBoardVisualDuplicateChange={
                        boardFileId
                          ? (selector, cloneHtml, info, details) =>
                              handleScreenVisualDuplicateChange(
                                boardFileId,
                                selector,
                                cloneHtml,
                                info,
                                details,
                              )
                          : undefined
                      }
                      onBoardTextContentChange={
                        boardFileId
                          ? (selector, value, info, details) =>
                              handleScreenTextContentChange(
                                boardFileId,
                                selector,
                                value,
                                info,
                                details,
                              )
                          : undefined
                      }
                      onCreateScreenFrame={handleCreateScreenFrame}
                      onDeleteSelection={handleDeleteOverviewSelection}
                      onSelectionChange={handleOverviewScreenSelectionChange}
                      onLayerMarqueeSelectionChange={
                        handleLayerMarqueeSelectionChange
                      }
                      selectedLayerSelectorGroupsByScreen={
                        selectedLayerSelectorGroupsByScreen
                      }
                      onPick={(id) => {
                        pendingOverviewScreenSelectionRef.current = null;
                        pendingOverviewLayerSelectionRef.current = null;
                        clearPendingOverviewLayerSelectionTimer();
                        setCreatedOverviewLayerSelection(null);
                        setSelectedElement(null);
                        setHoveredElement(null);
                        setSelectedLayerIdsState([id]);
                        setActiveFileId(id);
                        setActiveTool("move");
                        setMode("edit");
                      }}
                      onEdit={enterSingleScreen}
                      onDuplicate={handleDuplicateScreen}
                      onAddBreakpoint={(screenId, widthPx) => {
                        if (!id) return;
                        const breakpointLabel =
                          widthPx <= 480
                            ? "Mobile"
                            : widthPx <= 1024
                              ? "Tablet"
                              : "Desktop";
                        void addBreakpointMutation.mutateAsync({
                          designId: id,
                          label: breakpointLabel,
                          widthPx,
                        });
                      }}
                      onActiveBreakpointChange={(_screenId, widthPx) => {
                        setActiveBreakpointWidthState(widthPx);
                        if (!id) return;
                        const bpSet = (() => {
                          try {
                            const raw = (
                              designDataJson as Record<string, unknown>
                            )?.breakpointSet;
                            if (
                              raw &&
                              typeof raw === "object" &&
                              Array.isArray(
                                (raw as Record<string, unknown>).breakpoints,
                              )
                            ) {
                              return raw as {
                                breakpoints: Array<{
                                  id: string;
                                  widthPx: number;
                                }>;
                              };
                            }
                          } catch {
                            // Ignore malformed design data; the mutation below
                            // can still clear back to auto.
                          }
                          return null;
                        })();
                        const bp = bpSet?.breakpoints.find(
                          (b) => b.widthPx === widthPx,
                        );
                        void setActiveBreakpointMutation.mutateAsync({
                          designId: id,
                          breakpointId:
                            widthPx !== undefined && bp ? bp.id : "auto",
                        });
                      }}
                      renderScreenContent={(screen, metadata, geometry) => {
                        const screenIsActive = screen.id === activeFile?.id;
                        const screenContent = getScreenContent(screen.id);
                        const screenSourceType =
                          normalizeDesignSourceType(screen.sourceType) ??
                          metadata.source ??
                          designSourceType;
                        const screenBridgeUrl = screen.bridgeUrl;
                        const screenSnapshot =
                          liveScreenSnapshotsById[screen.id]?.html;
                        const screenContentKey = screenIsActive
                          ? [screen.id, contentRenderRevision].join(":")
                          : [
                              screen.id,
                              screen.updatedAt ?? "",
                              getContentSignature(screenContent),
                              0,
                            ].join(":");

                        return (
                          <DesignCanvas
                            content={screenContent}
                            contentKey={screenContentKey}
                            screenId={screen.id}
                            zoom={100}
                            deviceFrame="none"
                            sourceType={screenSourceType}
                            bridgeUrl={screenBridgeUrl}
                            externalSnapshotHtml={screenSnapshot}
                            onExternalContentSnapshot={(snapshot) =>
                              handleScreenExternalContentSnapshot(
                                screen.id,
                                snapshot,
                              )
                            }
                            fusionUrl={designFusionUrl}
                            onComponentSourceJump={handleComponentSourceJump}
                            motionTracks={
                              screenIsActive ? motionTracksWire : []
                            }
                            embeddedFrame={{
                              viewportWidth: Math.max(
                                1,
                                Math.round(geometry.width),
                              ),
                              viewportHeight: Math.max(
                                1,
                                Math.round(geometry.height),
                              ),
                              displayWidth: Math.max(
                                1,
                                Math.round(geometry.width),
                              ),
                              displayHeight: Math.max(
                                1,
                                Math.round(geometry.height),
                              ),
                              fluid: true,
                            }}
                            editorChromeScaleX={overviewCanvasZoom / 100}
                            editorChromeScaleY={overviewCanvasZoom / 100}
                            editMode={mode === "edit"}
                            interactMode={false}
                            readOnly={!canEditDesign}
                            scaleMode={screenIsActive && activeTool === "scale"}
                            clearSelectionRequest={
                              overviewClearSelectionRequest
                            }
                            registerRuntimeBridge={screenIsActive}
                            selectedSelector={
                              screenIsActive ? selectedCanvasSelector : null
                            }
                            selectedSelectorCandidates={
                              screenIsActive
                                ? selectedCanvasSelectorCandidates
                                : []
                            }
                            selectedSelectorGroups={
                              selectedLayerSelectorGroupsByScreen[screen.id] ??
                              []
                            }
                            hoveredSelector={
                              hoveredElementScreenId === screen.id
                                ? hoveredCanvasSelector
                                : null
                            }
                            hoveredSelectorCandidates={
                              hoveredElementScreenId === screen.id
                                ? hoveredCanvasSelectorCandidates
                                : []
                            }
                            lockedSelectors={getLayerSelectorsForFile(
                              screen.id,
                              lockedLayerIds,
                            )}
                            hiddenSelectors={getLayerSelectorsForFile(
                              screen.id,
                              hiddenLayerIds,
                            )}
                            onElementSelect={(info, intent) =>
                              handleScreenElementSelect(screen.id, info, intent)
                            }
                            onElementMarqueeSelect={(infos, intent) =>
                              handleScreenElementMarqueeSelect(
                                screen.id,
                                infos,
                                intent,
                              )
                            }
                            onElementHover={(info) =>
                              handleScreenElementHover(screen.id, info)
                            }
                            onEditorDragStateChange={
                              handleEditorDragStateChange
                            }
                            onClearSelection={() =>
                              handleScreenElementClear(screen.id)
                            }
                            onIframeHotkey={handleIframeHotkey}
                            onIframeContextMenu={handleIframeContextMenu}
                            onVisualStyleChange={(selector, styles, info) =>
                              handleScreenVisualStyleChange(
                                screen.id,
                                selector,
                                styles,
                                info,
                              )
                            }
                            onVisualStructureChange={(
                              selector,
                              anchorSelector,
                              placement,
                              info,
                              details,
                            ) =>
                              handleScreenVisualStructureChange(
                                screen.id,
                                selector,
                                anchorSelector,
                                placement,
                                info,
                                details,
                              )
                            }
                            onVisualDuplicateChange={(
                              selector,
                              cloneHtml,
                              info,
                              details,
                            ) =>
                              handleScreenVisualDuplicateChange(
                                screen.id,
                                selector,
                                cloneHtml,
                                info,
                                details,
                              )
                            }
                            onTextContentChange={(
                              selector,
                              value,
                              info,
                              details,
                            ) =>
                              handleScreenTextContentChange(
                                screen.id,
                                selector,
                                value,
                                info,
                                details,
                              )
                            }
                            onTextEditingStateChange={setTextEditingState}
                            onElementDblClickText={(info) =>
                              handleScreenElementDblClickText(screen.id, info)
                            }
                            tweakValues={cssVarValues}
                            drawMode={false}
                            pinMode={false}
                            designId={id}
                            designTitle={design?.title}
                            commentContextId={`${id}:${screen.id}`}
                            commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(screen.filename)}`}
                          />
                        );
                      }}
                    />
                  ) : (
                    <>
                      <DesignCanvas
                        content={activeContent}
                        contentKey={`${activeFile.id}:${contentRenderRevision}`}
                        zoom={zoom}
                        onZoomChange={setZoom}
                        deviceFrame={deviceFrame}
                        sourceType={activeCanvasSourceType}
                        bridgeUrl={activeScreenBridgeUrl}
                        externalSnapshotHtml={activeScreenExternalSnapshotHtml}
                        onExternalContentSnapshot={(snapshot) => {
                          if (!activeFile?.id) return;
                          handleScreenExternalContentSnapshot(
                            activeFile.id,
                            snapshot,
                          );
                        }}
                        fusionUrl={designFusionUrl}
                        previewWidthPx={activeBreakpointWidthState}
                        shaderFillPreview={shaderFillPreview}
                        onComponentSourceJump={handleComponentSourceJump}
                        motionTracks={motionTracksWire}
                        editMode={mode === "edit"}
                        interactMode={mode === "interact"}
                        readOnly={!canEditDesign}
                        scaleMode={activeTool === "scale"}
                        clearSelectionRequest={overviewClearSelectionRequest}
                        selectedSelector={selectedCanvasSelector}
                        selectedSelectorCandidates={
                          selectedCanvasSelectorCandidates
                        }
                        selectedSelectorGroups={
                          activeFile
                            ? (selectedLayerSelectorGroupsByScreen[
                                activeFile.id
                              ] ?? [])
                            : []
                        }
                        hoveredSelector={hoveredCanvasSelector}
                        hoveredSelectorCandidates={
                          hoveredCanvasSelectorCandidates
                        }
                        lockedSelectors={lockedLayerSelectors}
                        hiddenSelectors={hiddenLayerSelectors}
                        onElementSelect={handleElementSelect}
                        onElementMarqueeSelect={handleElementMarqueeSelect}
                        onElementHover={handleElementHover}
                        onEditorDragStateChange={handleEditorDragStateChange}
                        onClearSelection={() => {
                          setSelectedElement(null);
                          setHoveredElement(null);
                          setHoveredElementScreenId(null);
                          setSelectedLayerIdsState([]);
                        }}
                        onIframeHotkey={handleIframeHotkey}
                        onIframeContextMenu={handleIframeContextMenu}
                        onVisualStyleChange={handleVisualStyleChange}
                        onVisualStructureChange={handleVisualStructureChange}
                        onVisualDuplicateChange={handleVisualDuplicateChange}
                        onTextContentChange={handleTextContentChange}
                        onTextEditingStateChange={setTextEditingState}
                        onElementDblClickText={handleElementDblClickText}
                        tweakValues={cssVarValues}
                        drawMode={drawMode}
                        onExitDrawMode={() => {
                          setDrawMode(false);
                          setPinMode(false);
                          setActiveTool("move");
                          setMode("edit");
                        }}
                        pinMode={pinMode}
                        onExitPinMode={() => {
                          setPinMode(false);
                          if (mode === "annotate") {
                            setActiveTool("draw");
                          }
                        }}
                        designId={id}
                        designTitle={design?.title}
                        commentContextId={`${id}:${activeFile.id}`}
                        commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(activeFile.filename)}`}
                        onPrototypeNavigate={(screen) => {
                          if (!screen) return;
                          const norm = (s: string) =>
                            s
                              .replace(/^\.?\//, "")
                              .replace(/\.html?$/i, "")
                              .toLowerCase();
                          const target = norm(screen);
                          if (!target) return;
                          // Exact (normalized) filename match only — a substring match
                          // could send "board" to "dashboard.html".
                          const match = files.find(
                            (f) => norm(f.filename) === target,
                          );
                          if (match) {
                            viewModeRef.current = "single";
                            setScreenZoom(FOCUSED_SCREEN_ZOOM);
                            setViewMode("single");
                            setActiveFileId(match.id);
                          }
                        }}
                      />
                      {/* Presence: live cursor overlay for remote participants */}
                      {others.length > 0 && (
                        <LiveCursorOverlay
                          others={others}
                          containerRef={canvasContainerRef}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
                <div className="flex w-full max-w-md flex-col items-center text-center">
                  {generating || pendingGenerationActive ? (
                    <>
                      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] shadow-[0_18px_50px_-34px_rgba(0,0,0,0.8)]">
                        <Spinner className="size-5 text-foreground/40" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t("designEditor.generating")}
                      </p>
                    </>
                  ) : (
                    <>
                      <div
                        aria-hidden="true"
                        className="mb-5 w-full max-w-sm rounded-xl bg-[#f7f8fb] p-3 dark:bg-[#f4f6f8]"
                      >
                        <div className="flex h-7 items-center justify-between px-1 pb-2">
                          <div className="flex gap-1.5">
                            <span className="size-2 rounded-full bg-slate-950/[0.12]" />
                            <span className="size-2 rounded-full bg-slate-950/[0.1]" />
                            <span className="size-2 rounded-full bg-slate-950/[0.08]" />
                          </div>
                          <span className="h-2 w-16 rounded bg-slate-950/[0.08]" />
                        </div>
                        <div className="space-y-3 pt-4">
                          <span className="block h-5 w-2/3 rounded bg-slate-950/[0.085]" />
                          <span className="block h-4 w-1/2 rounded bg-slate-950/[0.07]" />
                          <div className="grid grid-cols-3 gap-2 pt-2">
                            <span className="h-12 rounded-md bg-slate-950/[0.07]" />
                            <span className="h-12 rounded-md bg-slate-950/[0.07]" />
                            <span className="h-12 rounded-md bg-slate-950/[0.07]" />
                          </div>
                          <span className="block h-20 rounded-lg bg-slate-950/[0.07]" />
                        </div>
                      </div>
                      <p className="mb-3 text-sm font-medium text-foreground/85">
                        {generationIssue ?? t("designEditor.noFiles")}
                      </p>
                      {retryablePrompt ? (
                        <p className="mx-auto mb-4 max-w-sm text-xs italic text-muted-foreground/70">
                          {`"${retryablePrompt.prompt}"`}
                        </p>
                      ) : null}
                      <div className="flex items-center justify-center gap-2">
                        {retryablePrompt ? (
                          <Button
                            size="sm"
                            className="h-8 cursor-pointer rounded-md"
                            onClick={handleRetryGeneration}
                          >
                            <IconRefresh className="h-3.5 w-3.5" />
                            {t("designEditor.tryAgain")}
                          </Button>
                        ) : null}
                        <Button
                          ref={generateBtnRef}
                          variant={retryablePrompt ? "ghost" : "outline"}
                          size="sm"
                          className="h-8 cursor-pointer rounded-md"
                          onClick={() => {
                            setRetryablePrompt(null);
                            handlePromptOpenChange(true);
                          }}
                        >
                          <IconPlus className="h-3.5 w-3.5" />
                          {retryablePrompt
                            ? t("designEditor.newPrompt")
                            : t("designEditor.generateDesign")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </CanvasContextMenu>
        )}

        {/* Right rail */}
        {!embedded && !initialGenerationChromeLimited ? (
          <div
            className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)]"
            style={{ width: rightSidebarWidth }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("editPanel.properties")}
              className="absolute left-[-2px] top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--design-editor-selection-color)]"
              onPointerDown={(event) => startSidebarResize("right", event)}
            />
            {rightSidebarActions}
            {mode === "edit" ? (
              <div className="min-h-0 flex-1">
                <EditPanel
                  selectedElement={selectedElement}
                  selectedElements={selectedInspectorElements}
                  pageStyles={pageStyles}
                  zoom={zoom}
                  headerTrailing={renderZoomControl("inspector")}
                  width={rightSidebarWidth}
                  activeTab={activeInspectorTab}
                  onActiveTabChange={setActiveInspectorTab}
                  tweaks={tweaks}
                  tweakValues={tweakSelections}
                  activeContent={activeContent}
                  activeFileUpdatedAt={activeFile?.updatedAt ?? null}
                  onComponentPropApplied={handleComponentPropApplied}
                  onTweakChange={(tweakId, value) =>
                    setTweakSelections((prev) => {
                      if (!canEditDesign) return prev;
                      const next = { ...prev, [tweakId]: value };
                      queueTweakSave(next);
                      return next;
                    })
                  }
                  onRequestTweaks={handleRequestTweaks}
                  extensionsPanel={
                    <DesignExtensionsPanel
                      context={designExtensionContext}
                      hideAssetLibrary
                      title={t("designEditor.extensions")}
                    />
                  }
                  onStyleChange={handleStyleChange}
                  onStylesChange={handleStylesChange}
                  onExport={handleInspectorExport}
                  exporting={pngExporting || svgExporting}
                  designId={id}
                  fileId={activeFile?.id}
                  componentNodeId={selectedComponentNodeId}
                  sourceCapabilities={sourceCapabilities}
                  selectedElementAlreadyComponent={
                    selectedElementAlreadyComponent
                  }
                  onCreateComponent={
                    id && selectedElement && !selectedElementAlreadyComponent
                      ? handleCreateComponent
                      : undefined
                  }
                  defaultComponentName={defaultComponentName}
                  inspectCode={inspectCodeData}
                  aiActions={
                    selectedElement && selectedInspectorElements.length <= 1 ? (
                      <InspectorAiActions
                        selector={
                          selectedCanvasSelector ?? selectedElement.selector
                        }
                        sourceId={selectedElement.sourceId}
                        fileId={activeFile?.id}
                        filename={activeFile?.filename}
                        routeSourceFile={activeScreenRouteSourceFile}
                        designId={id}
                        canEdit={canEditDesign}
                      />
                    ) : undefined
                  }
                  statesPanelProps={
                    id
                      ? {
                          // §6.4 / §8 — active state and breakpoint wired into
                          // the StatesPanel so selection is agent-visible.
                          activeStateId: selectedStateId,
                          activeBreakpointId: statesPanelActiveBreakpointId,
                          breakpoints: statesPanelBreakpoints,
                          onStateSelect: handleDesignStateSelect,
                          onBreakpointSelect: (breakpointId) => {
                            // "auto" = clear the active breakpoint (overview).
                            if (breakpointId === "auto") {
                              setActiveBreakpointWidthState(undefined);
                              if (id) {
                                void setActiveBreakpointMutation.mutateAsync({
                                  designId: id,
                                  breakpointId: "auto",
                                });
                              }
                              return;
                            }
                            const bp =
                              statesPanelBreakpoints.find(
                                (b) => b.id === breakpointId,
                              ) ??
                              DEFAULT_STATES_PANEL_BREAKPOINTS.find(
                                (b) => b.id === breakpointId,
                              );
                            if (!bp) return;
                            setActiveBreakpointWidthState(bp.widthPx);
                            if (id) {
                              void setActiveBreakpointMutation.mutateAsync({
                                designId: id,
                                breakpointId,
                              });
                            }
                          },
                          onAddBreakpoint: () => {
                            // Delegate to the MultiScreenCanvas affordance by
                            // navigating to overview where the "+" button lives.
                            if (viewMode !== "overview") {
                              setViewMode("overview");
                            }
                          },
                        }
                      : undefined
                  }
                  reviewPanelProps={resolvedReviewPanelProps}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </div>
        ) : null}
      </div>

      <AlertDialog open={pendingVisualStyleWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("designEditor.pendingVisualStyles.leaveTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                pendingVisualStylePropertyCount === 1
                  ? "designEditor.pendingVisualStyles.leaveDescriptionOne"
                  : "designEditor.pendingVisualStyles.leaveDescriptionOther",
                { count: pendingVisualStylePropertyCount },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleStayOnPendingVisualStyleNavigation}
            >
              {t("designEditor.pendingVisualStyles.stay")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDiscardPendingVisualStylesAndNavigate}
            >
              {t("designEditor.pendingVisualStyles.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Motion dock (§6.3) — bottom timeline mounted while opening, open, or
          closing. Canvas remains visible above.
          Preview-only scrubbing fires a motion-preview postMessage to the
          canvas iframe; track/duration edits autosave through apply-motion-edit. */}
      {!embedded && activeFile && motionDockMounted ? (
        <MotionDock
          tracks={motionTracks}
          durationMs={motionDurationMs}
          open={motionDockOpen}
          onOpenChange={setMotionDockOpenAnimated}
          onExitComplete={handleMotionDockExitComplete}
          onTracksChange={handleMotionTracksChange}
          onDurationChange={handleMotionDurationChange}
          canvasIframeRef={canvasIframeRef}
          autoKeyframe={motionAutoKeyframeEnabled}
          onAutoKeyframeChange={setMotionAutoKeyframeEnabled}
          playhead={motionPlayhead}
          onPlayheadChange={setMotionPlayhead}
          selectedTarget={motionSelectedTarget}
          applying={motionAutosavePending}
        />
      ) : null}

      <PromptPopover
        open={showPrompt}
        onOpenChange={handlePromptOpenChange}
        title={t("designEditor.generateDesign")}
        placeholder={t("designEditor.generatePlaceholder")}
        onSubmit={(
          prompt: string,
          files: UploadedFile[],
          options: PromptComposerSubmitOptions,
        ) => {
          if (isBuilderDesignEmbed) {
            window.parent.postMessage(
              {
                type: "agentNative.submitChat",
                data: { message: prompt, submit: true },
              },
              parentOriginRef.current ?? window.location.origin,
            );
            handlePromptOpenChange(false);
            return;
          }
          if (!canEditDesign) return;
          const designSystemId = selectedPromptDesignSystemId;
          persistPromptDesignSystem(designSystemId);
          const fileContext = formatUploadedFileContext(files);
          const images = imageAttachmentsFromUploadedFiles(files);
          const shouldExploreVariants =
            promptRequestsVariantExploration(prompt);
          const shouldSkipQuestions = shouldExploreVariants;
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            designSystemId ? `Design system id: "${designSystemId}"` : "",
            fileContext,
            "",
            ...(shouldExploreVariants
              ? designVariantGenerationDirectives(id, designSystemId)
              : shouldSkipQuestions
                ? designGenerationDirectives(id, designSystemId)
                : designIntakeQuestionDirectives(id, designSystemId)),
          ].join("\n");
          clearGenerationCompleteTimer();
          setGenerationIssue(null);
          const startedAt = Date.now();
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            designSystemId,
            ...options,
            attempt: 1,
            startedAt,
          });
          setHasPendingGeneration(true);
          const runTabId = agentSubmit(
            shouldSkipQuestions
              ? `Generate design for "${design.title}": ${prompt}`
              : `Prepare design questions for "${design.title}": ${prompt}`,
            context,
            { ...options, newTab: true, images },
          );
          setGenerationChatTabId(runTabId);
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            designSystemId,
            ...options,
            runTabId,
            attempt: 1,
            startedAt,
          });
          handlePromptOpenChange(false);
        }}
        loading={generating}
        anchorRef={promptAnchorRef}
        designSystems={designSystems}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={selectedPromptDesignSystemId}
        onDesignSystemChange={setPromptDesignSystemId}
        onCreateDesignSystem={() => {
          handlePromptOpenChange(false);
          navigate("/design-systems/setup");
        }}
      />
      <PromptPopover
        open={showTweakPrompt}
        onOpenChange={handleTweakPromptOpenChange}
        title={t("designEditor.tweaksPromptTitle")}
        placeholder={t("designEditor.tweaksPlaceholder")}
        onSubmit={handleTweakPromptSubmit}
        loading={false}
        anchorRef={tweakPromptAnchorRef}
      />

      {/* §6.6 — "Make this a real app" dialog.
          Three states:
          1. Idle — confirm prompt with description of what will happen.
          2. Migrating — spinner while the Builder cloud agent accepts the job.
          3. Success — branchName + url; sourceType already flipped to fusion.
          4. Not-configured — CTA to connect Builder.io.
      */}
      <Dialog
        open={makeRealDialogOpen}
        onOpenChange={(open) => {
          if (!migrateMutation.isPending) setMakeRealDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {/* Not-configured: Builder not connected or no project ID */}
          {migrationResult?.status === "not-configured" &&
          migrationResult.cta ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <IconRocket className="size-5 text-muted-foreground" />
                  {migrationResult.cta.label}
                </DialogTitle>
                <DialogDescription>
                  {migrationResult.cta.description}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => setMakeRealDialogOpen(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                {migrationResult.cta.connectUrl ? (
                  <Button asChild className="cursor-pointer">
                    <a
                      href={migrationResult.cta.connectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {migrationResult.cta.primaryAction}
                      <IconExternalLink className="ml-1.5 size-3.5" />
                    </a>
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : migrationResult?.status === "processing" ? (
            /* Success: Builder accepted the migration job */
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <IconCircleCheck className="size-5 text-green-500" />
                  {"Migration started" /* i18n-ignore */}
                </DialogTitle>
                <DialogDescription>
                  {
                    "Builder is generating a React app branch from your design. The original inline design is preserved and recoverable." /* i18n-ignore */
                  }
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {migrationResult.branchName && (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      {"Branch: " /* i18n-ignore */}
                    </span>
                    <span className="font-mono font-medium">
                      {migrationResult.branchName}
                    </span>
                  </div>
                )}
                {migrationResult.url && (
                  <a
                    href={migrationResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-[var(--design-editor-accent-color)] hover:underline"
                  >
                    {"Open in Builder" /* i18n-ignore */}
                    <IconExternalLink className="size-3.5" />
                  </a>
                )}
                {migrationResult.seedFileCount !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    {
                      `${migrationResult.seedFileCount} design file${migrationResult.seedFileCount === 1 ? "" : "s"} included in migration seed.` /* i18n-ignore */
                    }
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={() => setMakeRealDialogOpen(false)}
                  className="cursor-pointer"
                >
                  {"Done" /* i18n-ignore */}
                </Button>
              </DialogFooter>
            </>
          ) : (
            /* Idle or migrating */
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <IconRocket className="size-5" />
                  {"Make this a real app" /* i18n-ignore */}
                </DialogTitle>
                <DialogDescription>
                  {
                    "Connect Builder.io to convert this design into a React + Tailwind app with real components, props, branches, and deploys. Your current inline design is preserved as a snapshot you can restore at any time." /* i18n-ignore */
                  }
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-1 text-sm text-muted-foreground">
                <p>{"What happens:" /* i18n-ignore */}</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    {
                      "Your design HTML and tokens are sent to the Builder cloud agent" /* i18n-ignore */
                    }
                  </li>
                  <li>
                    {
                      "A React + Tailwind branch is generated in Builder" /* i18n-ignore */
                    }
                  </li>
                  <li>
                    {
                      "The editor switches to fusion source mode — gated panels light up" /* i18n-ignore */
                    }
                  </li>
                  <li>
                    {
                      "The original inline design is saved as a restorable snapshot" /* i18n-ignore */
                    }
                  </li>
                </ul>
                <p className="pt-1 text-xs">
                  {
                    "Requires Builder.io to be connected with a branch project configured." /* i18n-ignore */
                  }
                </p>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => setMakeRealDialogOpen(false)}
                  disabled={migrateMutation.isPending}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleConfirmMakeReal()}
                  disabled={migrateMutation.isPending}
                  className="cursor-pointer"
                >
                  {
                    migrateMutation.isPending ? (
                      <>
                        <Spinner className="mr-2 size-3.5" />
                        {"Starting migration…" /* i18n-ignore */}
                      </>
                    ) : (
                      "Start migration"
                    ) /* i18n-ignore */
                  }
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Localhost write-consent dialog: shown when the agent or editor wants to
          persist an edit to a local HTML/CSS source file and no valid grant
          exists for the active connection yet. */}
      {id && activeLocalhostConnectionId && (
        <LocalhostWriteConsentDialog
          open={localhostWriteConsentOpen}
          onOpenChange={(next) => {
            if (!next) {
              localhostWriteConsentPayload?.onCancel();
              setLocalhostWriteConsentPayload(null);
            }
            setLocalhostWriteConsentOpen(next);
          }}
          designId={id}
          connectionId={localhostConsentConnectionId}
          payload={localhostWriteConsentPayload}
        />
      )}
    </div>
  );
}
