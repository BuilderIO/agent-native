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
  AgentToggleButton,
  ShareButton,
  agentNativePath,
  appBasePath,
  ensureEmbedAuthFetchInterceptor,
  isEmbedAuthActive,
  sendToAgentChat,
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
  removeCodeLayerNodeFromHtml,
  type CodeLayerNode,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import { componentNameFor, isComponentInstance } from "@shared/component-model";
import {
  DESIGN_CAPABILITY_NAMES,
  hasCapability,
} from "@shared/design-source-capabilities";
import { shouldUseLiveFileContent } from "@shared/html-content";
import {
  resolveTweaksToCssVars,
  type TweakSelections,
} from "@shared/resolve-tweaks";
import { widthToPrefix } from "@shared/responsive-classes";
import { normalizeDesignSourceType } from "@shared/source-mode";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconArrowsMaximize,
  IconPencil,
  IconMessage,
  IconBrush,
  IconZoomIn,
  IconZoomOut,
  IconDeviceDesktop,
  IconDeviceTablet,
  IconDeviceMobile,
  IconViewportWide,
  IconPlus,
  IconLayoutGrid,
  IconFrame,
  IconX,
  IconPin,
  IconCode,
  IconArchive,
  IconPhoto,
  IconRefresh,
  IconChevronDown,
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
import { useParams, useNavigate, Link, useLocation } from "react-router";
import { toast } from "sonner";
import * as Y from "yjs";

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
import type { DesignExtensionSlotContext } from "@/components/design/DesignExtensionsPanel";
import {
  EditPanel,
  type InspectCodeData,
  type InspectorTab,
} from "@/components/design/EditPanel";
import type { ExportSettingsValue } from "@/components/design/inspector";
import {
  LayersPanel,
  type LayersPanelFile,
  type LayersPanelMoveIntent,
  type LayersPanelNode,
} from "@/components/design/LayersPanel";
import {
  MotionDock,
  type MotionDockTrack,
} from "@/components/design/MotionDock";
import {
  MultiScreenCanvas,
  OVERVIEW_FRAME_WIDTH,
  type CanvasPrimitiveInsert,
} from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import type { ElementInfo, DeviceFrameType } from "@/components/design/types";
import {
  DEVICE_FRAME_VIEWPORTS,
  ZOOM_PRESETS,
} from "@/components/design/types";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import { useDesignHotkeys } from "@/hooks/useDesignHotkeys";
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
const FOCUSED_SCREEN_ZOOM = 100;
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

function getContentSignature(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

export function isScreenRootElementInfo(info: ElementInfo | null | undefined) {
  const tagName = info?.tagName?.toUpperCase();
  return tagName === "BODY" || tagName === "HTML";
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
  overviewSelectedScreenIds: string[];
}) {
  const { currentViewMode, overviewSelectedScreenIds } = args;
  return {
    viewMode: currentViewMode,
    overviewSelectedScreenIds:
      currentViewMode === "overview" ? [] : overviewSelectedScreenIds,
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

function resolveZoomUpdate(update: SetStateAction<number>, current: number) {
  return typeof update === "function" ? update(current) : update;
}

export function shouldLockInspectorForInitialGeneration(args: {
  fileCount: number;
  generating: boolean;
  pendingGenerationActive: boolean;
}) {
  const { fileCount, generating, pendingGenerationActive } = args;
  return fileCount === 0 && (generating || pendingGenerationActive);
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

function buildSignInHrefForDesignIntent(intent: PostAuthDesignIntent): string {
  const base = agentNativePath("/_agent-native/sign-in");
  if (typeof window === "undefined") return base;

  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.set("intent", intent);
  const ret = returnUrl.pathname + returnUrl.search + returnUrl.hash;
  return `${base}?return=${encodeURIComponent(ret)}`;
}

interface GeometryHistoryEntry {
  before: CanvasFrameGeometryById;
  after: CanvasFrameGeometryById;
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

function designGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `Use the \`generate-design --designId="${designId}"\` action with exactly one complete, renderable \`index.html\` file first. The design already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    "If the user asked to explore variations, call `present-design-variants` with 2-5 complete HTML directions, wait for their chat pick, delete the unchosen variant screens, then continue from the kept screen. Otherwise generate one polished first direction.",
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
  const screen =
    searchParams.get("screen") ??
    searchParams.get("fileId") ??
    searchParams.get("filename");
  const rawZoom = searchParams.get("zoom");
  const zoom = rawZoom !== null ? Number(rawZoom) : NaN;
  const tool = normalizeDesignTool(searchParams.get("tool"));
  if (
    editorView !== "overview" &&
    editorView !== "single" &&
    inspector !== "design" &&
    inspector !== "tweaks" &&
    inspector !== "extensions" &&
    !screen &&
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
  if (screen) command.screen = screen;
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

function escapeHtmlAttributeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  let index = files.length + 1;
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
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const geometry = primitive.geometry;
    const left = Math.max(0, Math.round(geometry.x));
    const top = Math.max(0, Math.round(geometry.y));
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
        primitive.pathData ??
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

    if (primitive.kind === "frame") {
      element.style.background = primitive.fill ?? "rgba(255, 255, 255, 0.04)";
      element.style.border = `${primitive.strokeWidth ?? 1}px solid ${
        primitive.stroke ?? "rgba(148, 163, 184, 0.35)"
      }`;
      element.style.borderRadius = "2px";
      element.style.overflow = "hidden";
    } else if (primitive.kind === "text") {
      element.textContent = primitive.text ?? "Text";
      element.style.display = primitive.autoSize ? "inline-block" : "flex";
      if (!primitive.autoSize) {
        element.style.alignItems = "center";
      }
      element.style.color = primitive.fill ?? "currentColor";
      element.style.fontSize = "16px";
      element.style.lineHeight = "1.2";
      element.style.whiteSpace = "pre-wrap";
    } else if (primitive.kind === "ellipse") {
      element.style.background = primitive.fill ?? "rgba(37, 99, 235, 0.16)";
      element.style.border = `${primitive.strokeWidth ?? 1}px solid ${
        primitive.stroke ?? "rgb(37, 99, 235)"
      }`;
      element.style.borderRadius = "50%";
    } else {
      element.style.background = primitive.fill ?? "rgba(37, 99, 235, 0.16)";
      element.style.border = `${primitive.strokeWidth ?? 1}px solid ${
        primitive.stroke ?? "rgb(37, 99, 235)"
      }`;
      element.style.borderRadius = "2px";
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
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const layerDoc = new DOMParser().parseFromString(
      `<template>${layerHtml}</template>`,
      "text/html",
    );
    const source =
      layerDoc.querySelector("template")?.content.firstElementChild ??
      layerDoc.body.firstElementChild;
    if (!source || !doc.body) return null;
    const clone = doc.importNode(source, true) as HTMLElement | SVGElement;
    const clonedNodes = [
      clone,
      ...Array.from(clone.querySelectorAll("[data-agent-native-node-id]")),
    ] as Array<HTMLElement | SVGElement>;
    clonedNodes.forEach((node, index) => {
      node.setAttribute(
        "data-agent-native-node-id",
        uniqueLayerId(index === 0 ? "copy" : "copy-child"),
      );
    });
    if (clone instanceof HTMLElement || clone instanceof SVGElement) {
      // Use explicit style property assignments rather than prepending a raw
      // string. Prepending creates duplicate CSS properties in the same style
      // attribute, and in CSS the LAST occurrence wins, so existing left/top
      // values from the cloned element would override the new position.
      const cloneStyle = (clone as HTMLElement | SVGElement).style;
      cloneStyle.position = "absolute";
      cloneStyle.left = `${Math.max(0, Math.round(position.x))}px`;
      cloneStyle.top = `${Math.max(0, Math.round(position.y))}px`;
      // Clear conflicting properties that could shift the element away from
      // the intended position.
      cloneStyle.right = "";
      cloneStyle.bottom = "";
    }
    doc.body.appendChild(clone);
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
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
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const layerDoc = new DOMParser().parseFromString(
      `<template>${cloneHtml}</template>`,
      "text/html",
    );
    const source =
      layerDoc.querySelector("template")?.content.firstElementChild ??
      layerDoc.body.firstElementChild;
    if (!source || !doc.body) return null;
    const clone = doc.importNode(source, true) as HTMLElement | SVGElement;
    const clonedNodes = [
      clone,
      ...Array.from(clone.querySelectorAll("[data-agent-native-node-id]")),
    ] as Array<HTMLElement | SVGElement>;
    clonedNodes.forEach((node, index) => {
      node.setAttribute(
        "data-agent-native-node-id",
        uniqueLayerId(index === 0 ? "copy" : "copy-child"),
      );
    });

    const target = queryFirstSelector(doc, options.targetSelectors);
    const anchor =
      queryFirstSelector(doc, options.anchorSelectors ?? []) ?? target;
    const placement = options.placement ?? "after";
    if (!anchor) {
      doc.body.appendChild(clone);
    } else if (placement === "inside") {
      anchor.appendChild(clone);
    } else if (placement === "before") {
      if (anchor.parentElement)
        anchor.parentElement.insertBefore(clone, anchor);
      else doc.body.appendChild(clone);
    } else {
      if (anchor.parentElement) {
        anchor.parentElement.insertBefore(clone, anchor.nextSibling);
      } else {
        doc.body.appendChild(clone);
      }
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
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
  if (node.type === "shape") return "shape";
  if (node.type === "text") return "text";
  if (node.type === "image") return "image";
  return "element";
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
    isFlexChild: node.layout.parentDisplay?.includes("flex") ? true : false,
    isFlexContainer: node.layout.isFlexContainer,
    parentDisplay: node.layout.parentDisplay,
    confidence: node.confidence,
  };
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
    classes: node.classes.length > 0 ? node.classes : info.classes,
    confidence: node.confidence,
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

function elementInfoExistsInContent(
  content: string,
  info: ElementInfo | null,
): boolean {
  if (!info) return false;
  const projection = buildCodeLayerProjection(content);
  if (
    resolveCodeLayerNodeFromBridge(
      projection,
      info.selector,
      info.sourceId ?? info.id,
    )
  ) {
    return true;
  }
  if (!info.selector || typeof window === "undefined") return false;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    return Boolean(queryUniqueSelector(doc, info.selector));
  } catch {
    return false;
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
              onSelect={() => {
                if (!collaborator.isCurrent) onAvatarClick?.(user);
              }}
              className="gap-2"
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
              {isFollowing ? (
                <IconCheck className="size-3.5 text-[var(--design-editor-accent-color)]" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
            onClick={onPrimary}
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
  const [overviewCanvasZoom, setOverviewCanvasZoom] = useState(100);
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
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(256);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(256);
  const [layersSearchQuery, setLayersSearchQuery] = useState("");
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const [selectedLayerIdsState, setSelectedLayerIdsState] = useState<string[]>(
    [],
  );
  const [overviewSelectedScreenIds, setOverviewSelectedScreenIds] = useState<
    string[]
  >([]);
  const pendingOverviewScreenSelectionRef = useRef<string | null>(null);
  const [lockedLayerIds, setLockedLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [overviewSelectAllRequest, setOverviewSelectAllRequest] = useState(0);
  const [overviewClearSelectionRequest, setOverviewClearSelectionRequest] =
    useState(0);
  const [hasCanvasClipboard, setHasCanvasClipboard] = useState(false);
  const [hasPropsClipboard, setHasPropsClipboard] = useState(false);
  const copiedLayerHtmlRef = useRef<string | null>(null);
  // Cascade offset for repeated keyboard pastes so successive clones don't stack
  // pixel-perfectly on top of each other. Reset on each fresh copy/cut.
  const pasteCascadeRef = useRef(0);
  const copiedStylePropsRef = useRef<Record<string, string> | null>(null);
  const spaceHandPreviousToolRef = useRef<DesignTool | null>(null);
  const hasSelectedElement = Boolean(selectedElement);

  // ── Motion dock state (§6.3) ────────────────────────────────────────────────
  // The MotionDock is mounted below the canvas and shown when motionDockOpen.
  // Tracks and durationMs are local state; "Write to CSS" calls applyMotionEdit.
  const [motionDockOpen, setMotionDockOpen] = useState(false);
  const [motionTracks, setMotionTracks] = useState<MotionDockTrack[]>([]);
  const [motionDurationMs, setMotionDurationMs] = useState(1000);

  // ── Breakpoint preview state (§6.4) ─────────────────────────────────────────
  // Active breakpoint width for the current design (pixels). Controls which
  // side-by-side frame is focused. undefined = no frame selected (overview mode).
  const [activeBreakpointWidthState, setActiveBreakpointWidthState] = useState<
    number | undefined
  >(undefined);

  // ── Design state selection (§6.4 / §8) ───────────────────────────────────────
  // null = Default (live) view; a string id = one of the design_state rows.
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);

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
    setActiveInspectorTab((current) =>
      current === "extensions" ? current : "design",
    );
  }, []);

  useEffect(() => {
    if (hasSelectedElement) focusDesignInspectorForSelection();
  }, [focusDesignInspectorForSelection, hasSelectedElement]);

  useEffect(() => {
    if (hasSelectedElement) return;
    setActiveInspectorTab((current) =>
      current === "extensions" ? current : "tweaks",
    );
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
  const geometryUndoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const geometryRedoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const historyOrderRef = useRef<Array<"content" | "geometry">>([]);
  const redoOrderRef = useRef<Array<"content" | "geometry">>([]);
  const syncUndoRedoState = useCallback(() => {
    const undoManager = undoManagerRef.current;
    setCanUndo(
      Boolean(undoManager?.canUndo()) ||
        geometryUndoStackRef.current.length > 0,
    );
    setCanRedo(
      Boolean(undoManager?.canRedo()) ||
        geometryRedoStackRef.current.length > 0,
    );
  }, []);
  const persistedSelectionStateRef = useRef<string | null>(null);
  const designSelectionOwnerIdRef = useRef(`${TAB_ID}:${generateTabId()}`);
  const frameGeometrySaveTimerRef = useRef<number | null>(null);
  const [tweakSaveActive, setTweakSaveActive] = useState(false);
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
      Boolean(id) && !generationOutputReadyRef.current,
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

  const { session } = useSession();
  const isSignedIn = Boolean(session?.email);

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
  const handleSignInToSave = useCallback(() => {
    window.location.href = buildSignInHrefForDesignIntent("save");
  }, []);
  const handleSignInToShare = useCallback(() => {
    window.location.href = buildSignInHrefForDesignIntent("share");
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
  const canEditDesignRef = useRef(canEditDesign);

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

  // §6.6 — "Make it real" migration flow (migrate-inline-design-to-app).
  // The mutation stays unconditional; the dialog gates on isSignedIn.
  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  // Dialog open/close state for the "Make this a real app" flow.
  const [makeRealDialogOpen, setMakeRealDialogOpen] = useState(false);

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
  const [downloadZipInstead, setDownloadZipInstead] = useState(false);
  const [codingHandoffDetail, setCodingHandoffDetail] = useState("");
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

  const saveFileContent = useCallback(
    (pending: FileContentSaveRequest) => {
      if (!canEditDesignRef.current) return;
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
    [t, updateFileMutation],
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
    [saveFileContent],
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

    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object") return old;
      return { ...old, title: next };
    });
    queryClient.setQueryData(
      ["action", "list-designs", undefined],
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
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
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

  const files = design?.files ?? [];
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

    return files.map((file) => {
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
        lod: stringValue("lod"),
        previewState: stringValue("previewState"),
        status: stringValue("status"),
        title: stringValue("title"),
        width: numberValue("width"),
        height: numberValue("height"),
        url: stringValue("url"),
        previewUrl: stringValue("previewUrl"),
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
  }, [designDataJson, files, activeBreakpointWidthState]);
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
      geometryRedoStackRef.current = [];
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "geometry",
      ];
      redoOrderRef.current = [];
      const resizedFrameIds = viewportChangedFrameIds(
        beforeSnapshot,
        afterSnapshot,
      );
      if (resizedFrameIds.length > 0) {
        writeFrameGeometrySnapshot(afterSnapshot, {
          syncViewportFrameIds: resizedFrameIds,
        });
      }
      syncUndoRedoState();
    },
    [syncUndoRedoState, writeFrameGeometrySnapshot],
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
      ...designIntakeQuestionDirectives(id, pendingDesignSystemId),
    ].join("\n");

    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    const runTabId = agentSubmit(`Create design: ${prompt}`, context, {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
      newTab: true,
      images,
    });
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

  // Set active file to first file when data loads
  useEffect(() => {
    if (files.length > 0 && !activeFileId) {
      setActiveFileId(files[0].id);
    }
  }, [files, activeFileId]);

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0];
  const initialGenerationReadOnly = shouldLockInspectorForInitialGeneration({
    fileCount: files.length,
    generating,
    pendingGenerationActive,
  });
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

  const overviewZoom = getOverviewDisplayZoom(
    overviewCanvasZoom,
    overviewZoomScale,
  );
  const zoom = viewMode === "overview" ? overviewZoom : screenZoom;
  const setZoomForView = useCallback(
    (targetView: "single" | "overview", update: SetStateAction<number>) => {
      if (targetView === "overview") {
        setOverviewCanvasZoom((currentCanvasZoom) => {
          const scale = overviewZoomScaleRef.current;
          const currentDisplayZoom = getOverviewDisplayZoom(
            currentCanvasZoom,
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

      const commandZoom =
        typeof command.zoom === "number" && Number.isFinite(command.zoom)
          ? Math.min(400, Math.max(10, command.zoom))
          : null;
      if (commandZoom !== null) {
        setZoomForView(editorView ?? viewModeRef.current, commandZoom);
      }

      if (editorView === "overview") {
        viewModeRef.current = "overview";
        setSelectedElement(null);
        applyCommandTool("move");
        setViewMode("overview");
      } else if (editorView === "single") {
        viewModeRef.current = "single";
        setSelectedElement(null);
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
    const command = designEditorCommandFromSearchParams(id, searchParams);
    if (!command) return;
    applyDesignEditorCommand(command);
  }, [applyDesignEditorCommand, id, searchParams]);

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
    createFileMutation.mutate(
      {
        designId: id,
        filename,
        content: blankScreenHtml(prettyScreenName(filename)),
        fileType: "html",
      } as any,
      {
        onSuccess: (result: any) => {
          const nextId = typeof result?.id === "string" ? result.id : null;
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          if (nextId) {
            pendingOverviewScreenSelectionRef.current = nextId;
            setActiveFileId(nextId);
            setSelectedElement(null);
            setSelectedLayerIdsState([nextId]);
            setOverviewSelectedScreenIds([nextId]);
            setActiveTool("move");
            setMode("edit");
            viewModeRef.current = "overview";
            setViewMode("overview");
          }
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
  }, [canEditDesign, createFileMutation, files, id, queryClient, t]);

  const handleCreateScreenFrame = useCallback(
    (geometry: { x: number; y: number; width: number; height: number }) => {
      if (!id || !canEditDesign) return;
      const filename = nextBlankScreenFilename(files);
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
          content: blankScreenHtml(prettyScreenName(filename)),
          fileType: "html",
        } as any,
        {
          onSuccess: (result: any) => {
            const nextId = typeof result?.id === "string" ? result.id : null;
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            if (nextId) {
              pendingOverviewScreenSelectionRef.current = nextId;
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
  const prevActiveFileIdRef = useRef<string | null>(null);
  // `updatedAt` of the DB content this preview currently reflects. A poll that
  // returns an older-or-equal value is a stale snapshot and is ignored; a newer
  // one is a genuine external edit (agent / peer-via-SQL) and is reconciled in.
  // Mirrors the content template's VisualEditor `lastAppliedUpdatedAt` gate.
  const lastAppliedFileUpdatedAtRef = useRef<string | null>(null);
  // The last content this client itself wrote into the Y.Doc (inline-style
  // edits) — so the reconcile/observe doesn't treat our own echo as external.
  const lastLocalContentRef = useRef<string | null>(null);
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

  // Reset per-file reconcile state when switching files
  useEffect(() => {
    if (viewMode === "overview") {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
      clearStaleAgentCollabRecovery();
      return;
    }
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
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
      setContentRenderRevision((revision) => revision + 1);
    }
  }, [ydoc, isSynced, activeFileId, activeFile?.content, activeFile?.fileType]);

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
      setCollabContent(next);
      setCollabContentFileId(fileId);
      // UndoManager fires with itself as the origin; treat those as local too
      // so the reconcile watermark and stale-selection fix are consistent.
      const isLocalEdit =
        transaction?.origin === TAB_ID ||
        transaction?.origin === LOCAL_EDIT_ORIGIN ||
        transaction?.origin === undoManagerRef.current;
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
          return elementInfoExistsInContent(next, prev) ? prev : null;
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return elementInfoExistsInContent(next, prev) ? prev : null;
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
      syncUndoRedoState();
      return;
    }
    const ytext = ydoc.getText("content");
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
      captureTimeout: 800,
    });

    const syncState = () => syncUndoRedoState();
    const handleStackItemAdded = () => {
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      redoOrderRef.current = [];
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
      syncUndoRedoState();
    };
  }, [ydoc, isSynced, syncUndoRedoState]);

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

  // Live handle to the active DesignCanvas preview iframe. DesignCanvas owns the
  // <iframe> internally (tagged data-design-preview-iframe) and does not forward
  // its ref, so we resolve the element lazily from the DOM at read time. The
  // MotionDock reads `.current` only when scrubbing, so this always returns the
  // currently-mounted iframe even after content swaps recreate the element.
  const canvasIframeRef = useMemo<React.RefObject<HTMLIFrameElement | null>>(
    () => ({
      get current() {
        return document.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
      },
    }),
    [],
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
  const activeContentSource =
    activeCollabFileReady &&
    collabContentFileId === activeFile?.id &&
    collabContent !== null
      ? collabContent
      : activeFile?.content;
  const activeContent =
    typeof activeContentSource === "string" ? activeContentSource : "";
  const fileContentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) {
      map.set(file.id, typeof file.content === "string" ? file.content : "");
    }
    return map;
  }, [files]);
  const getScreenContent = useCallback(
    (screenId: string) =>
      screenId === activeFile?.id
        ? activeContent
        : (fileContentById.get(screenId) ?? ""),
    [activeContent, activeFile?.id, fileContentById],
  );
  const pageStyles = useMemo(
    () => getBodyInlineStyles(activeContent),
    [activeContent],
  );
  const activeCodeLayerProjection = useMemo(
    () => buildCodeLayerProjection(activeContent),
    [activeContent],
  );
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

  // ── Inspector header quick actions (Create component / Inspect code) ───────
  // Resolve the design-level source type + capability map so the inspector can
  // gate the real-app affordances (jump-to-source, prop write-back).
  const designSourceType = useMemo(
    () =>
      normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
      "inline",
    [designDataJson.sourceType],
  );
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
      ? selectedCodeLayerNode.id
      : undefined;
  }, [selectedCodeLayerNode]);

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
    return (
      selectedElement.htmlContent ??
      getElementOuterHtml(activeContent, selectedElement.selector)
    );
  }, [activeContent, selectedElement?.selector, selectedElement?.htmlContent]);

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

  // Serialisable subset of the dock's tracks for the DesignCanvas motion-preview
  // bridge. Strips the UI-only `label` field. Only populated while the dock is
  // open so a closed dock never leaves preview overrides on the canvas; an empty
  // array makes DesignCanvas send `motion-preview-clear`. Scrubbing previews
  // these tracks live in the iframe — it never writes (that is "Write to CSS").
  const motionTracksWire = useMemo<MotionTrackWire[]>(() => {
    if (!motionDockOpen || motionTracks.length === 0) return [];
    return motionTracks.map(({ label: _label, ...track }) => track);
  }, [motionDockOpen, motionTracks]);

  const inspectCodeData = useMemo<InspectCodeData | undefined>(() => {
    if (!selectedElement) return undefined;
    // Inline/Alpine: the design HTML is the source — show the element's HTML.
    // Real-app source resolution (vscode:// deep link) requires the
    // resolveNodeToFile bridge op, which is wired through open-component-source
    // when an external file path is available; until that round-trip is hooked
    // up here the popover shows the projected HTML for all source types.
    return { html: selectedElementOuterHtml, sourceLocation: null };
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
      sendToAgentChat({
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
      return buildCodeLayerProjection(getScreenContent(screenId));
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      fileContentById,
      getScreenContent,
    ],
  );

  const replacePreviewContent = useCallback(
    (nextContent: string, selector?: string | null) => {
      const replaceContent = (window as any).__designCanvasReplaceContent;
      if (typeof replaceContent !== "function") return false;
      return Boolean(
        replaceContent(
          nextContent,
          selector ?? selectedCanvasSelector,
          selectedCanvasSelectorCandidates,
          selectedElement?.sourceId ?? selectedElement?.id,
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
        immediateSave?: boolean;
      } = {},
    ) => {
      if (!activeFile || !canEditDesignRef.current) return;
      setCollabContent(nextContent);
      setCollabContentFileId(activeFile.id);
      lastLocalContentRef.current = nextContent;
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
                    { ...file, content: nextContent }
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
          : replacePreviewContent(nextContent);
      if (forceRefresh || !replacedPreview) {
        setContentRenderRevision((revision) => revision + 1);
      }
      if (ydoc && isSynced) {
        const ytext = ydoc.getText("content");
        if (ytext.toString() !== nextContent) {
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, nextContent);
          }, LOCAL_EDIT_ORIGIN);
        }
      }
      queueFileContentSave(activeFile.id, nextContent, {
        syncCollab: !(ydoc && isSynced),
        immediate: options.immediateSave,
      });
    },
    [
      activeFile,
      id,
      isSynced,
      queryClient,
      queueFileContentSave,
      replacePreviewContent,
      ydoc,
    ],
  );

  const applyFileContentUpdate = useCallback(
    (
      fileId: string,
      nextContent: string,
      options: { refreshPreview?: boolean; skipPreview?: boolean } = {},
    ) => {
      if (!canEditDesignRef.current) return;
      if (fileId === activeFile?.id) {
        applyLocalContentUpdate(nextContent, options);
        return;
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
          return old;
        }
        return {
          ...old,
          files: old.files.map((file: DesignFile) =>
            file.id === fileId ? { ...file, content: nextContent } : file,
          ),
        };
      });
      saveFileContent({
        id: fileId,
        content: nextContent,
        syncCollab: true,
      });
    },
    [activeFile?.id, applyLocalContentUpdate, id, queryClient, saveFileContent],
  );

  const handleCreatePrimitive = useCallback(
    (screenId: string, primitive: CanvasPrimitiveInsert) => {
      if (!canEditDesign) return false;
      const targetFile = files.find((file) => file.id === screenId);
      if (!targetFile) return false;
      const baseContent =
        targetFile.id === activeFile?.id
          ? ydoc && isSynced
            ? ydoc.getText("content").toString()
            : ((collabContentFileIdRef.current === activeFile.id
                ? collabContentRef.current
                : null) ?? activeContent)
          : targetFile.content;
      const nextContent = appendCanvasPrimitiveToHtml(baseContent, primitive);
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
        applyLocalContentUpdate(nextContent, { immediateSave: true });
      } else {
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

      return projectedNodeId ?? primitive.nodeId ?? true;
    },
    [
      activeContent,
      activeFile?.id,
      applyLocalContentUpdate,
      canEditDesign,
      files,
      id,
      isSynced,
      queryClient,
      saveFileContent,
      t,
      ydoc,
    ],
  );

  const handlePrimitiveCreated = useCallback(
    (screenId: string, nodeId: string) => {
      pendingOverviewScreenSelectionRef.current = null;
      viewModeRef.current = "single";
      setActiveFileId(screenId);
      setSelectedElement(null);
      setHoveredElement(null);
      setSelectedLayerIdsState([nodeId]);
      setOverviewSelectedScreenIds([]);
      setActiveTool("move");
      setMode("edit");
      setViewMode("single");
    },
    [],
  );

  const handleOverviewScreenSelectionChange = useCallback((ids: string[]) => {
    const pendingId = pendingOverviewScreenSelectionRef.current;
    if (pendingId && ids.length === 0) return;
    if (pendingId) pendingOverviewScreenSelectionRef.current = null;
    setOverviewSelectedScreenIds(ids);
  }, []);

  const handleMoveTool = useCallback(() => {
    if (!canEditDesign) return;
    setActiveTool("move");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
  }, [canEditDesign]);

  const handleFrameTool = useCallback(() => {
    if (!canEditDesign) return;
    setActiveTool("frame");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
    viewModeRef.current = "overview";
    setViewMode("overview");
  }, [canEditDesign]);

  const handleTextTool = useCallback(() => {
    if (!canEditDesign) return;
    setActiveTool("text");
    viewModeRef.current = "overview";
    setViewMode("overview");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
  }, [canEditDesign]);

  const handleShapeTool = useCallback(
    (tool: ShapeTool) => {
      if (!canEditDesign) return;
      setActiveTool(tool);
      viewModeRef.current = "overview";
      setViewMode("overview");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
    },
    [canEditDesign],
  );

  const handleRectTool = useCallback(() => {
    handleShapeTool("rect");
  }, [handleShapeTool]);

  const handlePenTool = useCallback(() => {
    if (!canEditDesign) return;
    setActiveTool("pen");
    viewModeRef.current = "overview";
    setViewMode("overview");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
  }, [canEditDesign]);

  const handleHandTool = useCallback(() => {
    if (!canEditDesign) return;
    setActiveTool("hand");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    viewModeRef.current = "overview";
    setViewMode("overview");
  }, [canEditDesign]);

  const handleScaleTool = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
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
      if (!canEditDesign || !design || generating || pendingGenerationActive)
        return;
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

      sendToAgentChat({
        message: `Add tweak controls to "${design.title}": ${trimmed}`,
        context,
        submit: true,
        openSidebar: true,
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
      generating,
      handleTweakPromptOpenChange,
      id,
      pendingGenerationActive,
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
    if (!id || !selectedElement) {
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
    });
  }, [activeFile, design?.title, id, selectedCodeLayerNode, selectedElement]);

  const designExtensionContext = useMemo<DesignExtensionSlotContext>(
    () => ({
      designId: id ?? "",
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
      mode,
      activeTool,
      tweakValues: tweakSelections,
    }),
    [
      activeFile?.filename,
      activeFile?.fileType,
      activeFile?.id,
      activeTool,
      design?.title,
      files,
      id,
      mode,
      overviewSelectedScreenIds,
      selectedElement,
      selectedScreenIds,
      tweakSelections,
      viewMode,
      zoom,
    ],
  );

  const handleScreenElementSelect = useCallback(
    (screenId: string, info: ElementInfo) => {
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
      setActiveTool("move");
      setMode("edit");
      focusDesignInspectorForSelection();
    },
    [focusDesignInspectorForSelection, getCodeLayerProjectionForScreen],
  );

  const handleScreenElementClear = useCallback((screenId: string) => {
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
  }, []);

  const handleElementSelect = useCallback(
    (info: ElementInfo) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementSelect(screenId, info);
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
    [focusDesignInspectorForSelection, getCodeLayerProjectionForScreen],
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
      // Base every patch off the freshest known content, not the closed-over
      // render value. Handlers that fire several onStyleChange calls in one
      // synchronous user action (e.g. fixed-size text → width+height+whiteSpace,
      // constraints center → both axes, linked padding → 4 sides) would
      // otherwise each read the same pre-render `activeContent` and clobber one
      // another, so only the last property survived in the saved HTML. Since we
      // advance lastLocalContentRef.current to resolvedNextContent below, the
      // next synchronous call reads the previous call's result and the patches
      // compose. Falls back to activeContent when the ref is unset (file switch).
      const baseContent = lastLocalContentRef.current ?? activeContent;
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
      if (!options.runtimeApplied && typeof sendStyleChange === "function") {
        entries.forEach(([property, value]) => {
          sendStyleChange(selector, property, value);
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
            const rcPatch = applyVisualEdit(current.content, {
              kind: "responsive-class",
              target: targetNode ? { nodeId: targetNode.id } : { selector },
              prefix: activeBreakpointPrefix,
              operation: "replace",
              utility: value,
              stem: property,
            });
            if (rcPatch.result.status === "applied") {
              return { content: rcPatch.content, failed: null };
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

      setCollabContent(resolvedNextContent);
      setCollabContentFileId(activeFile.id);
      setPatchProof((prev) =>
        prev?.id === proofId ? { ...prev, status: "queued" } : prev,
      );
      // Mark as our own write so the get-design reconcile + Yjs observe don't
      // treat the echo as an external edit and fight the live value.
      lastLocalContentRef.current = resolvedNextContent;
      // Write the edit into the shared Y.Doc so other open clients see it live
      // through Yjs (not only via the slower update-file → applyText round-trip).
      // Use LOCAL_EDIT_ORIGIN so the UndoManager captures this transaction.
      if (ydoc && isSynced) {
        const ytext = ydoc.getText("content");
        if (ytext.toString() !== resolvedNextContent) {
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, resolvedNextContent);
          }, LOCAL_EDIT_ORIGIN);
        }
      }
      queueFileContentSave(activeFile.id, resolvedNextContent, {
        syncCollab: !(ydoc && isSynced),
      });
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
      queueFileContentSave,
      selectedElement,
      t,
      ydoc,
      isSynced,
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
          sendStyleChange(selector, property, value);
          return;
        }
      }
      commitVisualStyles(selector, { [property]: value });
    },
    [
      commitVisualStyles,
      selectedElement?.selector,
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
      commitVisualStyles(selector, Object.fromEntries(entries));
    },
    [commitVisualStyles, selectedElement?.selector],
  );

  const handleVisualStyleChange = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
    ) => {
      commitVisualStyles(selector, styles, {
        runtimeApplied: true,
        elementInfo,
      });
    },
    [commitVisualStyles],
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
      },
    ) => {
      if (!canEditDesign) return false;
      if (!activeFile) return false;
      const projection = buildCodeLayerProjection(activeContent);
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
      const patch = applyVisualEdit(activeContent, {
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
      const movedNode =
        (patch.result.after?.nodeId
          ? patch.projection.nodes.find(
              (node) => node.id === patch.result.after?.nodeId,
            )
          : null) ??
        resolveCodeLayerNodeFromBridge(
          patch.projection,
          selector,
          details?.sourceId ??
            elementInfo?.sourceId ??
            (targetNode
              ? bridgeSourceIdForCodeLayerNode(targetNode)
              : undefined),
        );
      applyLocalContentUpdate(patch.content, { skipPreview: true });
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
    [activeContent, activeFile, applyLocalContentUpdate, canEditDesign, t],
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
      const projection = buildCodeLayerProjection(activeContent);
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
      const nextContent = insertClonedHtmlLayer(activeContent, cloneHtml, {
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
    [activeContent, activeFile, applyLocalContentUpdate, canEditDesign, t],
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
      const projection = buildCodeLayerProjection(activeContent);
      const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveCodeLayerNodeFromBridge(projection, selector);
      const isEmpty = value.trim().length === 0;
      const removedContent =
        isEmpty && targetNode
          ? removeCodeLayerNodeFromHtml(activeContent, targetNode)
          : null;
      const patch = !removedContent
        ? applyVisualEdit(activeContent, {
            kind: "textContent",
            target: targetNode ? { nodeId: targetNode.id } : { selector },
            value,
            html: details?.html,
          })
        : null;
      const nextContent =
        removedContent ??
        (patch?.result.status === "applied" ? patch.content : null) ??
        updateElementContentInHtml(
          activeContent,
          selector,
          value,
          details?.html,
        );
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
      applyLocalContentUpdate(nextContent, { skipPreview: true });
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
    [activeContent, activeFile, applyLocalContentUpdate, canEditDesign, t],
  );

  const handleScreenVisualStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
    ) => {
      if (screenId === activeFile?.id) {
        handleVisualStyleChange(selector, styles, elementInfo);
        return;
      }
      if (!canEditDesign) return;
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return;
      const baseContent = getScreenContent(screenId);
      const projection = buildCodeLayerProjection(baseContent);
      const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
      const targetNode = targetInfo
        ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
        : resolveCodeLayerNodeFromBridge(projection, selector);
      const fallbackContent = applyInlineStylesToHtml(baseContent, selector, {
        ...Object.fromEntries(entries),
      });
      const stylePatch = entries.reduce<{
        content: string;
        failed: string | null;
      }>(
        (current, [property, value]) => {
          if (current.failed) return current;
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
      const nextContent = stylePatch.failed
        ? fallbackContent
        : stylePatch.content;
      if (!nextContent) {
        toast.error(
          stylePatch.failed ?? t("designEditor.patchProof.selectorMissing"),
          { duration: 4000 },
        );
        return;
      }
      applyFileContentUpdate(screenId, nextContent, { skipPreview: true });
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
      handleVisualStyleChange,
      t,
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
      applyFileContentUpdate(screenId, patch.content, { skipPreview: true });
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
      const baseContent = getScreenContent(screenId);
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
      applyFileContentUpdate(screenId, nextContent, { skipPreview: true });
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
      t,
    ],
  );

  const handleCopySelection = useCallback(async () => {
    if (!selectedElement?.selector) return;
    const html = getElementOuterHtml(activeContent, selectedElement.selector);
    if (!html) return;
    copiedLayerHtmlRef.current = html;
    pasteCascadeRef.current = 0;
    setHasCanvasClipboard(true);
    try {
      await navigator.clipboard.writeText(html);
      toast.success(t("designEditor.toasts.copied"));
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [activeContent, selectedElement, t]);

  const handlePasteSelection = useCallback(
    (position?: { x: number; y: number }) => {
      if (!activeFile || !canEditDesign || !copiedLayerHtmlRef.current) return;
      // Explicit positions (e.g. "Paste here" at the cursor) are honored as-is.
      // Keyboard pastes land near the source layer and cascade so repeats don't
      // stack exactly.
      const targetPosition =
        position ??
        (() => {
          const src = extractLayerPosition(copiedLayerHtmlRef.current!);
          const offset = pasteCascadeRef.current * 16;
          return src
            ? { x: src.x + 10 + offset, y: src.y + 10 + offset }
            : { x: 120 + offset, y: 120 + offset };
        })();
      const nextContent = cloneHtmlLayerAtPosition(
        activeContent,
        copiedLayerHtmlRef.current,
        targetPosition,
      );
      if (!nextContent) return;
      if (!position) pasteCascadeRef.current += 1;
      applyLocalContentUpdate(nextContent);
      toast.success(t("designEditor.toasts.pasted"), { duration: 3000 });
    },
    [activeContent, activeFile, applyLocalContentUpdate, canEditDesign, t],
  );

  const handlePasteOverSelection = useCallback(() => {
    if (!activeFile || !copiedLayerHtmlRef.current) return;
    if (selectedElement?.boundingRect) {
      const { x, y } = selectedElement.boundingRect;
      const nextContent = cloneHtmlLayerAtPosition(
        activeContent,
        copiedLayerHtmlRef.current,
        { x, y },
      );
      if (!nextContent) return;
      applyLocalContentUpdate(nextContent);
      toast.success(t("designEditor.toasts.pasted"));
    } else {
      handlePasteSelection();
    }
  }, [
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    handlePasteSelection,
    selectedElement,
    t,
  ]);

  const handleDuplicateSelection = useCallback(() => {
    if (!canEditDesign) return;
    if (selectedElement?.selector) {
      const html = getElementOuterHtml(activeContent, selectedElement.selector);
      const rect = selectedElement.boundingRect;
      const nextContent = html
        ? cloneHtmlLayerAtPosition(activeContent, html, {
            x: rect.x + 16,
            y: rect.y + 16,
          })
        : null;
      if (nextContent) {
        applyLocalContentUpdate(nextContent);
      } else {
        toast.error(t("designEditor.toasts.duplicateElementFailed"));
      }
      return;
    }
    if (activeFile) handleDuplicateScreen(activeFile.id);
  }, [
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    handleDuplicateScreen,
    selectedElement,
  ]);

  const handleDeleteSelection = useCallback(() => {
    if (!canEditDesign) return;
    // Multi-select delete: when several DOM/code layers are selected in the
    // panel, remove all of them — not just the single focused element. Compose
    // the removals against the running content (re-projecting each pass) so
    // nested selections resolve correctly and earlier removals aren't clobbered.
    const candidateIds = selectedLayerIdsState.filter(
      (layerId) =>
        layerId &&
        !layerId.startsWith("__") &&
        !files.some((file) => file.id === layerId),
    );
    if (candidateIds.length > 1) {
      let content = activeContent;
      const removedSelectors: string[] = [];
      for (const layerId of candidateIds) {
        const projection = buildCodeLayerProjection(content);
        const node =
          projection.nodes.find((candidate) => candidate.id === layerId) ??
          resolveCodeLayerNodeFromBridge(projection, layerId, layerId);
        if (!node) continue;
        const next = removeCodeLayerNodeFromHtml(content, node);
        if (!next) continue;
        const selector = preferredCodeLayerSelector(node);
        if (selector) removedSelectors.push(selector);
        content = next;
      }
      if (content !== activeContent) {
        removedSelectors.forEach((selector) => deleteRuntimeElement(selector));
        applyLocalContentUpdate(content, { refreshPreview: false });
        setSelectedElement(null);
        setSelectedLayerIdsState([]);
        return;
      }
      // Nothing resolved (stale ids) — fall through to the single path.
    }

    if (!selectedElement?.selector) return;
    const projection = buildCodeLayerProjection(activeContent);
    const targetNode = resolveCodeLayerNodeFromElementInfo(
      projection,
      selectedElement,
    );
    const nextContent =
      (targetNode
        ? removeCodeLayerNodeFromHtml(activeContent, targetNode)
        : null) ??
      removeElementFromHtml(activeContent, selectedElement.selector);
    if (!nextContent) return;
    deleteRuntimeElement(selectedElement.selector);
    applyLocalContentUpdate(nextContent, { refreshPreview: false });
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
  }, [
    activeContent,
    applyLocalContentUpdate,
    canEditDesign,
    deleteRuntimeElement,
    files,
    selectedElement,
    selectedLayerIdsState,
  ]);

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

      return true;
    },
    [
      activeFile,
      canEditDesign,
      canvasFrameGeometryById,
      deleteFileMutation,
      files,
      id,
      queryClient,
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
    toast.success(t("designEditor.toasts.propsCopied"));
  }, [selectedElement, t]);

  const handlePasteProps = useCallback(() => {
    if (!canEditDesign) return;
    if (!selectedElement?.selector || !copiedStylePropsRef.current) return;
    const styles = Object.fromEntries(
      Object.entries(copiedStylePropsRef.current).filter(([, value]) =>
        Boolean(value),
      ),
    );
    commitVisualStyles(selectedElement.selector, styles);
    toast.success(t("designEditor.toasts.propsPasted"));
  }, [canEditDesign, commitVisualStyles, selectedElement, t]);

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
    const undoContent = () => {
      if (!um || !um.canUndo()) return false;
      um.undo();
      if (ydoc && activeFile) {
        const next = ydoc.getText("content").toString();
        lastLocalContentRef.current = next;
        queueFileContentSave(activeFile.id, next, {
          syncCollab: !(ydoc && isSynced),
        });
        if (!replacePreviewContent(next)) {
          setContentRenderRevision((revision) => revision + 1);
        }
        // Clear stale selection if the undo removed the selected element.
        setSelectedElement((prev) => {
          if (!prev) return prev;
          return elementInfoExistsInContent(next, prev) ? prev : null;
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return elementInfoExistsInContent(next, prev) ? prev : null;
        });
      }
      redoOrderRef.current = [
        ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      return true;
    };
    const undoGeometry = () => {
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

    const preferred = historyOrderRef.current.pop();
    const didUndo =
      preferred === "geometry"
        ? undoGeometry() || undoContent()
        : preferred === "content"
          ? undoContent() || undoGeometry()
          : undoContent() || undoGeometry();
    if (didUndo) {
      syncUndoRedoState();
    }
  }, [
    ydoc,
    activeFile,
    canEditDesign,
    isSynced,
    queueFileContentSave,
    replacePreviewContent,
    syncUndoRedoState,
    writeFrameGeometrySnapshot,
  ]);

  const handleRedo = useCallback(() => {
    if (!canEditDesign) return;
    const um = undoManagerRef.current;
    const redoContent = () => {
      if (!um || !um.canRedo()) return false;
      um.redo();
      if (ydoc && activeFile) {
        const next = ydoc.getText("content").toString();
        lastLocalContentRef.current = next;
        queueFileContentSave(activeFile.id, next, {
          syncCollab: !(ydoc && isSynced),
        });
        if (!replacePreviewContent(next)) {
          setContentRenderRevision((revision) => revision + 1);
        }
        // Clear stale selection if the redo removed the selected element.
        setSelectedElement((prev) => {
          if (!prev) return prev;
          return elementInfoExistsInContent(next, prev) ? prev : null;
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return elementInfoExistsInContent(next, prev) ? prev : null;
        });
      }
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      return true;
    };
    const redoGeometry = () => {
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

    const preferred = redoOrderRef.current.pop();
    const didRedo =
      preferred === "geometry"
        ? redoGeometry() || redoContent()
        : preferred === "content"
          ? redoContent() || redoGeometry()
          : redoContent() || redoGeometry();
    if (didRedo) {
      syncUndoRedoState();
    }
  }, [
    ydoc,
    activeFile,
    canEditDesign,
    isSynced,
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
    setOverviewCanvasZoom(100);
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

  const enterOverviewFromZoom = useCallback(() => {
    if (viewModeRef.current === "overview") return;
    viewModeRef.current = "overview";
    runEditorViewTransition(() => {
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool("move");
      setViewMode("overview");
    });
  }, [runEditorViewTransition]);

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
    [activeFileId, runEditorViewTransition],
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
      setOverviewSelectedScreenIds([]);
      setSelectedLayerIdsState([]);
      enterSingleScreen(screenId);
    },
    [enterSingleScreen],
  );

  const handleSidebarScreenOverview = useCallback(() => {
    setOverviewSelectedScreenIds([]);
    setSelectedLayerIdsState([]);
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
  }, [enterOverviewFromZoom]);

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
      const base =
        typeof result?.clipboardText === "string"
          ? result.clipboardText
          : typeof result?.prompt === "string"
            ? result.prompt
            : "";
      const detail = codingHandoffDetail.trim();
      if (!base || !detail) return base;
      return `${base}\n\nAdditional implementation detail:\n${detail}`;
    },
    [codingHandoffDetail],
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

  const handleDownloadHandoffZip = useCallback(async () => {
    const result = await ensureCodingHandoff();
    if (!result?.zipUrl) {
      toast.error(t("designEditor.toasts.zipCreateError"));
      return;
    }
    const a = document.createElement("a");
    a.href = result.zipUrl;
    a.download = fallbackExportName("zip", "agent-handoff");
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(t("designEditor.toasts.zipDownloaded"));
  }, [ensureCodingHandoff, fallbackExportName, t]);

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
        const canvas = await html2canvas(doc.documentElement, {
          width,
          height,
          windowWidth: width,
          windowHeight: height,
          scale: Math.max(
            0.1,
            Math.min(
              4,
              settings?.scale ?? Math.min(2, window.devicePixelRatio || 1),
            ),
          ),
          useCORS: true,
          foreignObjectRendering: true,
          backgroundColor: null,
          onclone: (clonedDocument) =>
            sanitizeHtml2CanvasClone(doc, clonedDocument),
        });
        await new Promise<void>((resolve) => {
          canvas.toBlob((blob) => {
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
    [fallbackExportName, t, triggerBlobDownload],
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
        clone.style.width = `${width}px`;
        clone.style.minHeight = `${height}px`;

        const body = clone.querySelector("body") as HTMLElement | null;
        if (body) {
          body.style.margin = body.style.margin || "0";
          body.style.width = `${width}px`;
          body.style.minHeight = `${height}px`;
        }

        const serializedHtml = new XMLSerializer().serializeToString(clone);
        const safeTitle =
          design?.title
            ?.replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;") || t("designEditor.designExport");
        const exportScale = Math.max(0.1, Math.min(4, settings?.scale ?? 1));
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width * exportScale}" height="${height * exportScale}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeTitle}">
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
    [design?.title, fallbackExportName, t, triggerBlobDownload],
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

  const handleSendToPrimaryAction = useCallback(() => {
    if (downloadZipInstead) {
      void handleDownloadHandoffZip();
      return;
    }
    void handleCopyCodingHandoff();
  }, [downloadZipInstead, handleCopyCodingHandoff, handleDownloadHandoffZip]);

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
    <div className="space-y-5">
      <div className="text-sm font-semibold text-muted-foreground">
        {"Format" /* i18n-ignore share export section label */}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shareExportOptions.map((option) => {
          const selected = option.value === shareExportFormat;
          const ExportIcon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setShareExportFormat(option.value)}
              className={cn(
                "relative min-h-32 rounded-xl border bg-background p-4 text-left transition-colors hover:bg-accent/35",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border",
              )}
            >
              <span className="mb-5 inline-flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <ExportIcon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="block text-base font-semibold text-foreground">
                {option.title}{" "}
                <span className="text-sm font-medium text-muted-foreground">
                  {option.extension}
                </span>
              </span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                {option.description}
              </span>
              <span
                aria-hidden
                className={cn(
                  "absolute right-4 top-4 inline-flex size-6 items-center justify-center rounded-full border",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background",
                )}
              >
                {selected ? <IconCheck className="size-4" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {selectedShareExportOption.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {selectedShareExportOption.description}
          </div>
        </div>
        <Button
          type="button"
          onClick={selectedShareExportOption.onDownload}
          disabled={selectedShareExportOption.disabled}
          className="h-10 gap-2 rounded-lg px-4"
        >
          <IconDownload className="size-4" />
          {"Download" /* i18n-ignore share export action */}
        </Button>
      </div>
    </div>
  );
  const shareSendToTab = (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-sm">
        <div className="flex h-11 items-center border-b border-neutral-800 px-4">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-red-500" />
            <span className="size-3 rounded-full bg-yellow-400" />
            <span className="size-3 rounded-full bg-green-500" />
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-sm font-medium text-neutral-400">
            {"Your agent" /* i18n-ignore terminal title */}
          </div>
          <IconTerminal2 className="size-4 text-neutral-500" />
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-sm leading-6 text-neutral-100">
          {`> ${codingHandoffPreviewText}`}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={handleSendToPrimaryAction}
          disabled={
            downloadZipInstead
              ? !activeFile || codingHandoffLoading
              : codingHandoffLoading
          }
          className="h-10 gap-2 rounded-lg px-4"
        >
          {downloadZipInstead ? (
            <IconArchive className="size-4" />
          ) : (
            <IconClipboard className="size-4" />
          )}
          {
            downloadZipInstead
              ? t("designEditor.downloadZip")
              : "Copy agent prompt" /* i18n-ignore share send action */
          }
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={downloadZipInstead}
            onCheckedChange={(checked) =>
              setDownloadZipInstead(checked === true)
            }
            className="mt-1"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {"Download zip instead" /* i18n-ignore share send option */}
            </div>
            <div className="mt-0.5 text-sm leading-5 text-muted-foreground">
              {
                "For agents without the Design connector, drop the bundle into your agent's chat manually." /* i18n-ignore share send option description */
              }
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {
              "Give the agent more detail on what to implement" /* i18n-ignore share send detail label */
            }{" "}
            <span className="font-normal text-muted-foreground">
              {"(optional)" /* i18n-ignore optional label */}
            </span>
          </label>
          <Textarea
            value={codingHandoffDetail}
            onChange={(event) => setCodingHandoffDetail(event.target.value)}
            placeholder={activeFile?.filename ?? "Add implementation notes..."}
            className="min-h-24 resize-none rounded-lg bg-background"
          />
        </div>
      </div>
    </div>
  );
  const designShareTabs = {
    shareLabel: "Share link" /* i18n-ignore share tab label */,
    defaultValue: "share",
    tabs: [
      {
        value: "export",
        label: t("designEditor.export"),
        content: shareExportTab,
      },
      {
        value: "send",
        label: "Send to agent" /* i18n-ignore share tab label */,
        content: shareSendToTab,
      },
    ],
  };

  useEffect(() => {
    if (viewMode === "overview") return;
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
    applyLocalContentUpdate(stamped.content);
  }, [activeContent, activeFile, applyLocalContentUpdate, id, viewMode]);
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
          file.id === activeFile?.id ? activeContent : (file.content ?? "");
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
      activeContent,
      activeFile?.id,
      files,
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
    const reconcile = (
      current: Set<string>,
      sourceIds: Set<string>,
    ): Set<string> => {
      const next = new Set(sourceIds);
      current.forEach((id) => {
        if (fileIds.has(id)) next.add(id);
      });
      if (
        next.size === current.size &&
        Array.from(next).every((id) => current.has(id))
      ) {
        return current;
      }
      return next;
    };

    setLockedLayerIds((current) => reconcile(current, lockedFromSource));
    setHiddenLayerIds((current) => reconcile(current, hiddenFromSource));
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
      files.map((file) => ({
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
      files.map((file) => {
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
      viewMode === "overview" && !hasOverviewCodeLayerSelection
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
    files,
    overviewSelectedScreenIds,
    selectedElementLayerId,
    selectedLayerIdsState,
    viewMode,
  ]);
  const selectedLayerIdsRef = useRef<string[]>(selectedLayerIds);

  useLayoutEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds;
  }, [selectedLayerIds]);

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
    return match?.id ?? "auto";
  }, [activeBreakpointWidthState, statesPanelBreakpoints]);

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

  const activeLayerId =
    selectedLayerIds[selectedLayerIds.length - 1] ??
    selectedElementLayerId ??
    activeFile?.id ??
    "";
  const activeLayerLocked = Boolean(
    activeLayerId && effectiveCodeLayerState.lockedIds.has(activeLayerId),
  );
  const activeLayerHidden = Boolean(
    activeLayerId && effectiveCodeLayerState.hiddenIds.has(activeLayerId),
  );

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
        return (
          draggedId !== intent.targetId &&
          !!draggedOwner &&
          draggedOwner.fileId === targetOwner.fileId &&
          !collectCodeLayerAncestors(
            targetOwner.tree,
            intent.targetId,
          ).includes(draggedId) &&
          !effectiveCodeLayerState.lockedIds.has(draggedId) &&
          !effectiveCodeLayerState.hiddenIds.has(draggedId)
        );
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
      const sourceFile = files.find((file) => file.id === targetOwner.fileId);
      const sourceContent =
        targetOwner.fileId === activeFile?.id
          ? activeContent
          : (sourceFile?.content ?? "");
      if (!sourceContent) return;
      let nextContent = sourceContent;
      let moved = false;
      for (const draggedId of intent.draggedIds) {
        const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
        if (
          draggedId === intent.targetId ||
          !draggedOwner ||
          draggedOwner.fileId !== targetOwner.fileId ||
          effectiveCodeLayerState.lockedIds.has(draggedId) ||
          effectiveCodeLayerState.hiddenIds.has(draggedId)
        ) {
          continue;
        }
        const patch = applyVisualEdit(nextContent, {
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
        nextContent = patch.content;
        moved = true;
      }
      if (!moved || nextContent === sourceContent) return;
      applyFileContentUpdate(targetOwner.fileId, nextContent, {
        refreshPreview: true,
      });
    },
    [
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canMoveLayer,
      codeLayerOwnerByNodeId,
      files,
      effectiveCodeLayerState,
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
      intent: {
        additive: boolean;
        currentSelectedIds?: string[];
        id: string;
        range: boolean;
      },
    ) => {
      const nextLayerIds = ids.filter((layerId) => !layerId.startsWith("__"));
      if (intent.additive && !intent.range) {
        const currentLayerIds = (
          intent.currentSelectedIds && intent.currentSelectedIds.length > 0
            ? intent.currentSelectedIds
            : selectedLayerIdsRef.current
        ).filter((layerId) => !layerId.startsWith("__"));
        const additiveLayerIds = currentLayerIds.includes(intent.id)
          ? currentLayerIds.filter((layerId) => layerId !== intent.id)
          : [...currentLayerIds, intent.id];
        setSelectedLayerIdsState(additiveLayerIds);
        if (viewModeRef.current === "overview") {
          const fileIds = files.map((file) => file.id);
          const selectedScreenIds = getOverviewScreenIdsFromLayerSelection({
            fileIds,
            layerIds: additiveLayerIds,
          });
          const toggledScreen =
            getOverviewScreenIdsFromLayerSelection({
              fileIds,
              layerIds: [intent.id],
            }).length > 0;
          if (toggledScreen || selectedScreenIds.length > 0) {
            setOverviewSelectedScreenIds(selectedScreenIds);
          }
        }
        setSelectedElement(null);
        focusDesignInspectorForSelection();
        setActiveTool("move");
        setMode("edit");
        return;
      }
      setSelectedLayerIdsState(nextLayerIds);
      const selectedId = ids[ids.length - 1];
      if (!selectedId) {
        setSelectedElement(null);
        return;
      }
      const codeLayerOwner = codeLayerOwnerByNodeId.get(selectedId);
      if (codeLayerOwner) {
        if (codeLayerOwner.fileId !== activeFile?.id) {
          setActiveFileId(codeLayerOwner.fileId);
        }
        const nextSelectionState = getSidebarCodeLayerSelectionState({
          currentViewMode: viewModeRef.current,
          overviewSelectedScreenIds,
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
      if (files.some((file) => file.id === fileId)) {
        setOverviewSelectedScreenIds([fileId]);
        setActiveFileId(fileId);
        setSelectedElement(null);
        setSelectedLayerIdsState([fileId]);
        setActiveTool("move");
        setMode("edit");
        viewModeRef.current = "overview";
        setViewMode("overview");
      }
    },
    [
      activeFile?.id,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      focusDesignInspectorForSelection,
      overviewSelectedScreenIds,
    ],
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
          ? activeContent
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
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerOwnerByNodeId,
      files,
      queryClient,
      t,
      updateFileMutation,
    ],
  );

  const handleToggleLayerLocked = useCallback(
    (layerId: string, locked: boolean) => {
      if (!canEditDesign) return;
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
      if (!owner || !node) return;
      const sourceFile = files.find((file) => file.id === owner.fileId);
      const sourceContent =
        owner.fileId === activeFile?.id
          ? activeContent
          : (sourceFile?.content ?? "");
      if (!sourceContent) return;
      const nextContent = setCodeLayerAttributeInHtml(
        sourceContent,
        node,
        "data-agent-native-locked",
        locked ? "true" : null,
      );
      if (!nextContent || nextContent === sourceContent) return;
      applyFileContentUpdate(owner.fileId, nextContent, {
        refreshPreview: false,
      });
      applyLockedState();
    },
    [
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerOwnerByNodeId,
      files,
    ],
  );

  const handleToggleLayerHidden = useCallback(
    (layerId: string, hidden: boolean) => {
      if (!canEditDesign) return;
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
      if (!owner || !node) return;
      const sourceFile = files.find((file) => file.id === owner.fileId);
      const sourceContent =
        owner.fileId === activeFile?.id
          ? activeContent
          : (sourceFile?.content ?? "");
      if (!sourceContent) return;
      const nextContent = setCodeLayerAttributeInHtml(
        sourceContent,
        node,
        "data-agent-native-hidden",
        hidden ? "true" : null,
      );
      if (!nextContent || nextContent === sourceContent) return;
      applyFileContentUpdate(owner.fileId, nextContent, {
        refreshPreview: false,
      });
      applyHiddenState();
    },
    [
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerOwnerByNodeId,
      files,
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

  // Hooks must not be called conditionally; keep navigate as an effect so the
  // render phase stays pure. This branch is unreachable in practice because the
  // design.$id.tsx route always supplies an id param.
  useEffect(() => {
    if (!id) navigate("/");
  }, [id, navigate]);

  if (!id) return null;

  if (designLoading || (!design && pendingGenerationActive)) {
    return <DesignEditorSkeleton embedded={embedded} />;
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
          <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">
            404
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {t("designEditor.notFound")}
          </h1>
          <Button
            variant="default"
            onClick={() => navigate("/")}
            className="mt-7 h-9 cursor-pointer gap-2 rounded-md border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] px-3.5 text-[var(--design-editor-accent-contrast-color)] shadow-sm hover:border-[var(--design-editor-accent-hover-color)] hover:bg-[var(--design-editor-accent-hover-color)] hover:text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)]"
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
              className="h-8 shrink-0 cursor-pointer gap-0.5 rounded-md px-0 text-muted-foreground hover:bg-accent hover:text-foreground"
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
          className="size-9 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[calc(var(--spacing)*6.4)]"
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

  const zoomControl = (
    <DropdownMenu>
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
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={handleZoomOut}>
          <IconZoomOut className="mr-2 h-4 w-4" />
          {t("designEditor.zoomOut")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleZoomIn}>
          <IconZoomIn className="mr-2 h-4 w-4" />
          {t("designEditor.zoomIn")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleZoomToFit}>
          <IconArrowsMaximize className="mr-2 h-4 w-4" />
          {"Fit to screen" /* i18n-ignore zoom option */}
          <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ZOOM_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => setZoom(preset)}
            className="justify-between"
          >
            <span>{preset}%</span>
            {Math.round(zoom) === preset && <IconCheck className="h-4 w-4" />}
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
            variant="outline"
            size="sm"
            onClick={handleSignInToSave}
            className="h-8 max-w-[13rem] cursor-pointer gap-1.5 truncate rounded-md bg-[var(--design-editor-panel-raised-bg)] px-2 text-xs shadow-none"
            aria-label={t("designEditor.signUpToSave")}
          >
            <IconDeviceFloppy className="size-4 shrink-0" />
            <span className="truncate">{t("designEditor.signUpToSave")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("designEditor.signUpToSaveDescription")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="default"
            size="sm"
            onClick={handleSignInToShare}
            className="h-8 cursor-pointer gap-1.5 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)]"
          >
            <span>{t("designEditor.share")}</span>
            <IconArrowUpRight className="size-4 shrink-0" />
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 cursor-pointer rounded-md text-foreground hover:bg-accent hover:text-foreground"
                onClick={handleOpenDesignPreview}
                disabled={!activeScreenPreviewUrl && !activeContent.trim()}
                aria-label={t("designEditor.designPreview")}
              >
                <IconPlayerPlay className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("designEditor.designPreview")}</TooltipContent>
          </Tooltip>

          {/* §6.6 — "Make this a real app" shortcut button (signed-in only).
              Surfaces the migration CTA without requiring the project menu. */}
          {isSignedIn && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={handleOpenMakeReal}
                  disabled={migrateMutation.isPending}
                  aria-label={"Make this a real app" /* i18n-ignore */}
                >
                  <IconRocket className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {"Make this a real app" /* i18n-ignore */}
              </TooltipContent>
            </Tooltip>
          )}

          {isSignedIn ? (
            <ShareButton
              resourceType="design"
              resourceId={id}
              resourceTitle={design.title}
              hideTriggerIcon
              defaultOpen={shouldOpenShare}
              shareUrl={editorShareUrl}
              shareUrlLabel={t("designEditor.shareEditorLink")}
              shareUrlDescription={t("designEditor.shareEditorLinkDescription")}
              shareTabs={designShareTabs}
              popoverClassName="z-[100010] w-[min(860px,92vw)] p-6"
              triggerClassName="h-8 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
            />
          ) : (
            signedOutPersistenceActions
          )}

          {isSignedIn && <AgentToggleButton />}
        </div>
      </div>
    </div>
  );

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

                {/* Zoom — collapsed into a single menu. */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs tabular-nums text-muted-foreground cursor-pointer"
                        >
                          {zoomLabel}
                          <IconChevronDown className="w-3 h-3 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{t("designEditor.zoom")}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={handleZoomOut}>
                      <IconZoomOut className="mr-2 h-4 w-4" />
                      {t("designEditor.zoomOut")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleZoomIn}>
                      <IconZoomIn className="mr-2 h-4 w-4" />
                      {t("designEditor.zoomIn")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleZoomToFit}>
                      <IconArrowsMaximize className="mr-2 h-4 w-4" />
                      {"Fit to screen" /* i18n-ignore zoom option */}
                      <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {ZOOM_PRESETS.map((preset) => (
                      <DropdownMenuItem
                        key={preset}
                        onClick={() => setZoom(preset)}
                        className="justify-between"
                      >
                        <span>{preset}%</span>
                        {Math.round(zoom) === preset && (
                          <IconCheck className="h-4 w-4" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

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

            {!embedded && isSignedIn ? (
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
                shareTabs={designShareTabs}
                popoverClassName="z-[100010] w-[min(860px,92vw)] p-6"
                triggerClassName="h-8 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
              />
            ) : !embedded ? (
              signedOutPersistenceActions
            ) : null}

            {!embedded && isSignedIn && <AgentToggleButton />}
          </div>
        </div>
      </header>

      {/* Main canvas area */}
      <div className="flex-1 flex overflow-hidden relative">
        {!embedded ? (
          <div
            className="relative flex min-h-0 shrink-0 flex-col border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)]"
            style={{ width: leftSidebarWidth }}
          >
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
              {projectMenu}
              {projectTitleControl}
            </div>
            <div className="min-h-0 flex-1">
              <LayersPanel
                screens={layerPanelFiles}
                activeScreenId={activeFileId ?? undefined}
                screenOverviewActive={viewMode === "overview"}
                files={
                  viewMode === "overview" ? overviewLayerPanelFiles : undefined
                }
                layers={
                  viewMode === "overview" ? undefined : activeLayerPanelNodes
                }
                selectedIds={selectedLayerIds}
                expandedIds={expandedLayerIds}
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
              />
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
            hiddenActions={["group", "ungroup", "rename"]}
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
            onCopyProps={handleCopyProps}
            onPasteProps={handlePasteProps}
            onCopyAsCode={handleCopySelection}
          >
            {activeFile ? (
              <div
                ref={canvasContainerRef}
                className="relative mx-1 h-full min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--design-editor-canvas-bg)]"
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
                {viewMode === "overview" ? (
                  <MultiScreenCanvas
                    screens={overviewScreens}
                    zoom={overviewCanvasZoom}
                    onZoomChange={setOverviewCanvasZoom}
                    activeId={activeFileId}
                    selectedScreenIds={overviewSelectedScreenIds}
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
                    onCreateScreenFrame={handleCreateScreenFrame}
                    onDeleteSelection={handleDeleteOverviewSelection}
                    onSelectionChange={setOverviewSelectedScreenIds}
                    onPick={(id) => {
                      pendingOverviewScreenSelectionRef.current = null;
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
                      // Optimistically update design data via add-breakpoint
                      // action (§6.4). The action stores into designs.data.breakpointSet.
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
                      // Update local display state immediately (optimistic).
                      setActiveBreakpointWidthState(widthPx);
                      if (!id) return;
                      // Look up the breakpoint id for widthPx from the stored set.
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
                          // ignore
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
                      const screenContentKey = [
                        screen.id,
                        screen.updatedAt ?? "",
                        getContentSignature(screenContent),
                        screenIsActive ? contentRenderRevision : 0,
                      ].join(":");

                      return (
                        <DesignCanvas
                          content={screenContent}
                          contentKey={screenContentKey}
                          zoom={100}
                          deviceFrame="none"
                          sourceType={designSourceType}
                          fusionUrl={designFusionUrl}
                          onComponentSourceJump={handleComponentSourceJump}
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
                          clearSelectionRequest={overviewClearSelectionRequest}
                          registerRuntimeBridge={screenIsActive}
                          selectedSelector={
                            screenIsActive ? selectedCanvasSelector : null
                          }
                          selectedSelectorCandidates={
                            screenIsActive
                              ? selectedCanvasSelectorCandidates
                              : []
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
                          onElementSelect={(info) =>
                            handleScreenElementSelect(screen.id, info)
                          }
                          onElementHover={(info) =>
                            handleScreenElementHover(screen.id, info)
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
                      sourceType={designSourceType}
                      fusionUrl={designFusionUrl}
                      previewWidthPx={activeBreakpointWidthState}
                      onComponentSourceJump={handleComponentSourceJump}
                      // Live motion preview: the dock's current tracks feed the
                      // iframe's motion-preview bridge so scrubbing the playhead
                      // interpolates these properties in place. Preview-only —
                      // "Write to CSS" (apply-motion-edit) is the commit path.
                      // shaderFillPreview stays unthreaded here (separate §6.7
                      // preview state not yet plumbed into this editor surface).
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
                      hoveredSelector={hoveredCanvasSelector}
                      hoveredSelectorCandidates={
                        hoveredCanvasSelectorCandidates
                      }
                      lockedSelectors={lockedLayerSelectors}
                      hiddenSelectors={hiddenLayerSelectors}
                      onElementSelect={handleElementSelect}
                      onElementHover={handleElementHover}
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
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  {generating || pendingGenerationActive ? (
                    <>
                      <Spinner className="mx-auto mb-3 size-6 text-foreground/30" />
                      <p className="text-sm text-muted-foreground">
                        {t("designEditor.generating")}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mb-3 text-sm text-muted-foreground">
                        {generationIssue ?? t("designEditor.noFiles")}
                      </p>
                      {retryablePrompt ? (
                        <p className="mx-auto mb-4 max-w-sm text-xs italic text-muted-foreground/70">
                          "{retryablePrompt.prompt}"
                        </p>
                      ) : null}
                      <div className="flex items-center justify-center gap-2">
                        {retryablePrompt ? (
                          <Button
                            size="sm"
                            className="cursor-pointer"
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
                          className="cursor-pointer"
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
        {!embedded ? (
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
                  pageStyles={pageStyles}
                  zoom={zoom}
                  headerTrailing={zoomControl}
                  width={rightSidebarWidth}
                  activeTab={activeInspectorTab}
                  onActiveTabChange={setActiveInspectorTab}
                  tweaks={tweaks}
                  tweakValues={tweakSelections}
                  extensionContext={designExtensionContext}
                  readOnly={initialGenerationReadOnly}
                  onTweakChange={(tweakId, value) =>
                    setTweakSelections((prev) => {
                      if (!canEditDesign) return prev;
                      const next = { ...prev, [tweakId]: value };
                      queueTweakSave(next);
                      return next;
                    })
                  }
                  onRequestTweaks={handleRequestTweaks}
                  onStyleChange={handleStyleChange}
                  onStylesChange={handleStylesChange}
                  onExport={handleInspectorExport}
                  exporting={pngExporting || svgExporting}
                  designId={id}
                  componentNodeId={selectedComponentNodeId}
                  sourceCapabilities={sourceCapabilities}
                  onCreateComponent={
                    id && selectedElement ? handleCreateComponent : undefined
                  }
                  defaultComponentName={defaultComponentName}
                  inspectCode={inspectCodeData}
                  statesPanelProps={
                    id
                      ? {
                          // §6.4 / §8 — active state and breakpoint wired into
                          // the StatesPanel so selection is agent-visible.
                          activeStateId: selectedStateId,
                          activeBreakpointId: statesPanelActiveBreakpointId,
                          breakpoints: statesPanelBreakpoints,
                          onStateSelect: (stateId) => {
                            setSelectedStateId(stateId);
                          },
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
                            const bp = statesPanelBreakpoints.find(
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
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </div>
        ) : null}
      </div>

      {/* Motion dock (§6.3) — collapsible bottom dock; visible when activeFile
          is open and the user has opened it. Canvas remains visible above.
          Preview-only scrubbing fires a motion-preview postMessage to the
          canvas iframe (via canvasIframeRef); "Write to CSS" fires
          apply-motion-edit. */}
      {!embedded && activeFile ? (
        <MotionDock
          tracks={motionTracks}
          durationMs={motionDurationMs}
          open={motionDockOpen}
          onOpenChange={setMotionDockOpen}
          onTracksChange={setMotionTracks}
          onDurationChange={setMotionDurationMs}
          canvasIframeRef={canvasIframeRef}
          selectedTarget={motionSelectedTarget}
          onApply={(tracks, durationMs) => {
            if (!id) return;
            applyMotionEditMutation.mutate({
              designId: id,
              fileId: activeFile.id,
              tracks: tracks.map(({ label: _label, ...t }) => t),
              durationMs,
            });
          }}
          applying={applyMotionEditMutation.isPending}
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
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            designSystemId ? `Design system id: "${designSystemId}"` : "",
            fileContext,
            "",
            ...designIntakeQuestionDirectives(id, designSystemId),
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
            `Prepare design questions for "${design.title}": ${prompt}`,
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
        loading={generating || pendingGenerationActive}
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
    </div>
  );
}
