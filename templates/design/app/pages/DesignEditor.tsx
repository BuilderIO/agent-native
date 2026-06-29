import {
  useActionQuery,
  useActionMutation,
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
  useAgentChatContext,
  useAvatarUrl,
  type CollabUser,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import {
  parseCanvasFrameGeometryById,
  type CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  ensureCodeLayerNodeIdsInHtml,
  removeCodeLayerNodeFromHtml,
  type CodeLayerNode,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import { shouldUseLiveFileContent } from "@shared/html-content";
import {
  resolveTweaksToCssVars,
  type TweakSelections,
} from "@shared/resolve-tweaks";
import {
  IconArrowLeft,
  IconArrowUpRight,
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
  IconVectorBezier,
  IconScale,
  IconScribble,
  IconHandClick,
  IconTransformPoint,
  IconDownload,
  IconFileExport,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
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
} from "@/components/design/DesignCanvas";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import type { DesignExtensionSlotContext } from "@/components/design/DesignExtensionsPanel";
import { EditPanel, type InspectorTab } from "@/components/design/EditPanel";
import type { ExportSettingsValue } from "@/components/design/inspector";
import {
  LayersPanel,
  type LayersPanelFile,
  type LayersPanelMoveIntent,
  type LayersPanelNode,
} from "@/components/design/LayersPanel";
import {
  MultiScreenCanvas,
  type CanvasPrimitiveInsert,
} from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import type { ElementInfo, DeviceFrameType } from "@/components/design/types";
import { ZOOM_PRESETS } from "@/components/design/types";
import { VariantGrid } from "@/components/design/VariantGrid";
import { VariantHandoffCard } from "@/components/design/VariantHandoffCard";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  DESIGN_VARIANT_PICKED_EVENT,
  useVariantFlow,
} from "@/hooks/use-variant-flow";
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
// Higher than the toolbar presets so overview zooming still feels like canvas
// work; trackpad/pinch zooming past this commits to editing that screen.
const OVERVIEW_EDIT_ZOOM_THRESHOLD = 250;

interface FileContentSaveRequest {
  id: string;
  content: string;
  syncCollab: boolean;
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
  files: DesignFile[];
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
    "If the user asked to explore variations, call `present-design-variants` with 2-5 complete HTML directions and wait for their pick before calling generate-design. Otherwise generate one polished first direction.",
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
  const zoom = Number(searchParams.get("zoom"));
  if (
    editorView !== "overview" &&
    editorView !== "single" &&
    inspector !== "design" &&
    inspector !== "tweaks" &&
    inspector !== "extensions" &&
    !screen
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
    const nodeId = uniqueLayerId(primitive.kind);
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
      element.style.borderRadius = "9999px";
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
      const style = (clone as HTMLElement | SVGElement).getAttribute("style");
      const prefix = `position:absolute;left:${Math.max(
        0,
        Math.round(position.x),
      )}px;top:${Math.max(0, Math.round(position.y))}px;`;
      (clone as HTMLElement | SVGElement).setAttribute(
        "style",
        style ? `${prefix}${style}` : prefix,
      );
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
  return selector
    .trim()
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s+/g, " ");
}

function codeLayerSelectorMatches(
  node: CodeLayerNode | null | undefined,
  selector: string | undefined,
): boolean {
  if (!node || !selector) return false;
  const target = normalizeCodeLayerSelector(selector);
  const targetHasDirectPath = target.includes(" > ");
  return codeLayerSelectorAliases(node).some((candidate) => {
    const normalized = normalizeCodeLayerSelector(candidate);
    return (
      normalized === target ||
      normalized.endsWith(` > ${target}`) ||
      (targetHasDirectPath &&
        normalized.includes(" > ") &&
        target.endsWith(` > ${normalized}`))
    );
  });
}

function codeLayerTreeToPanelNodes(
  nodes: CodeLayerTreeNode[],
  lockedIds: Set<string>,
  hiddenIds: Set<string>,
  inheritedLocked = false,
  inheritedHidden = false,
): LayersPanelNode[] {
  return nodes.map((node) => {
    const selfLocked = lockedIds.has(node.id);
    const selfHidden = hiddenIds.has(node.id);
    const locked = inheritedLocked || selfLocked;
    const hidden = inheritedHidden || selfHidden;
    return {
      id: node.id,
      name: node.name,
      type: layerTypeForCodeLayer(node),
      layout: node.layout,
      detail: node.detail,
      badge: node.badge,
      selectable: !locked && !hidden,
      renamable: node.renamable,
      lockable: true,
      hideable: true,
      locked: selfLocked,
      hidden: selfHidden,
      children: codeLayerTreeToPanelNodes(
        node.children,
        lockedIds,
        hiddenIds,
        locked,
        hidden,
      ),
    };
  });
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

type FigmaToolbarOption = {
  key: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

function FigmaToolbarTool({
  active,
  label,
  icon,
  options,
  onPrimary,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  options: FigmaToolbarOption[];
  onPrimary: () => void;
}) {
  const hasOptionsMenu = options.length > 1;
  return (
    <div
      className={cn(
        "flex h-8 items-center overflow-hidden rounded-md text-neutral-200 transition-colors",
        active
          ? "bg-[#0d99ff] text-white"
          : "hover:bg-white/10 hover:text-white",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex size-8 cursor-pointer items-center justify-center"
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
                "flex h-8 w-4 cursor-pointer items-center justify-center rounded-r-md transition-colors",
                active ? "hover:bg-white/15" : "hover:bg-white/10",
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
            className="w-56 rounded-2xl border-white/10 bg-neutral-950 p-2 text-neutral-50 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9)]"
          >
            {options.map((option) => (
              <DropdownMenuItem
                key={option.key}
                disabled={option.disabled}
                onSelect={option.onSelect}
                className="h-10 rounded-lg text-sm text-neutral-100 focus:bg-white/10 focus:text-white disabled:text-neutral-500"
              >
                <span className="mr-2 flex size-5 items-center justify-center text-neutral-100">
                  {option.active ? (
                    <IconCheck className="size-4" />
                  ) : (
                    option.icon
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.shortcut && (
                  <DropdownMenuShortcut className="ml-3 text-neutral-400">
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

function FigmaModeTab({
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

function FigmaBottomToolbar({
  mode,
  pinMode,
  drawMode,
  activeTool,
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
  const shapeOptions: FigmaToolbarOption[] = [
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
    options: FigmaToolbarOption[];
  }> = [
    {
      key: "move",
      active: activeTool === "move" && mode === "edit",
      label: t("designEditor.tools.move"),
      icon: <IconPointer className="size-[18px]" />,
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
      icon: <IconVectorBezier className="size-[18px]" />,
      onClick: onPen,
      options: [
        {
          key: "pen",
          label: t("designEditor.tools.pen"),
          icon: <IconVectorBezier className="size-4" />,
          shortcut: "P",
          active: activeTool === "pen",
          onSelect: onPen,
        },
        {
          key: "draw",
          label: t("designEditor.modes.draw"),
          icon: <IconBrush className="size-4" />,
          active: activeTool === "draw" && mode === "annotate" && drawMode,
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
          onSelect: onCommentPin,
        },
        {
          key: "draw",
          label: t("designEditor.modes.draw"),
          icon: <IconBrush className="size-4" />,
          active: activeTool === "draw" && mode === "annotate" && drawMode,
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
    <div className="absolute bottom-4 left-1/2 z-[70] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 overflow-hidden rounded-xl border border-white/10 bg-[#2c2c2c]/95 p-1.5 text-neutral-100 shadow-[0_22px_55px_-24px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="flex min-w-0 items-center gap-0.5">
        {tools.map((tool) => (
          <FigmaToolbarTool
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
          <FigmaModeTab
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

export default function DesignEditor() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
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
  const [zoom, setZoom] = useState(100);
  const [deviceFrame, setDeviceFrame] = useState<DeviceFrameType>("none");
  const [viewMode, setViewMode] = useState<"single" | "overview">("overview");
  const viewModeRef = useRef<"single" | "overview">("overview");
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
  const copiedStylePropsRef = useRef<Record<string, string> | null>(null);
  const spaceHandPreviousToolRef = useRef<DesignTool | null>(null);
  const { set: setAgentChatContextItem, remove: removeAgentChatContextItem } =
    useAgentChatContext();
  const hasSelectedElement = Boolean(selectedElement);

  useEffect(() => {
    if (!isBuilderDesignEmbed) return;
    // Announce ready to Builder
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
  const [svgExporting, setSvgExporting] = useState(false);
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

  // Question flow + variant flow — full-canvas overlays driven by the agent.
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
  const {
    state: pendingVariants,
    useVariant: handleVariantChoice,
    dismiss: handleVariantsDismiss,
    standalonePick,
    dismissStandalonePick,
  } = useVariantFlow(id);
  const pendingQuestionsVisible = Boolean(
    pendingQuestions && pendingQuestions.length > 0 && !pendingVariants,
  );

  const { session } = useSession();
  const pendingVariantKey = useMemo(
    () =>
      pendingVariants
        ? `${pendingVariants.designId}:${pendingVariants.variants
            .map((variant) => variant.id)
            .join(",")}`
        : "",
    [pendingVariants],
  );
  const [selectedVariantId, setSelectedVariantId] = useState<
    string | undefined
  >();
  const initialVariantId = pendingVariants?.variants[0]?.id;

  useEffect(() => {
    setSelectedVariantId(initialVariantId);
  }, [initialVariantId, pendingVariantKey]);

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
  const createCodingHandoffMutation = useActionMutation(
    "export-coding-handoff",
  );
  const exportHtmlMutation = useActionMutation("export-html");
  const exportZipMutation = useActionMutation("export-zip");
  const [, setPatchProof] = useState<PatchProofState | null>(null);
  const pendingFileSaveRef = useRef<{
    id: string;
    content: string;
    syncCollab: boolean;
  } | null>(null);
  const fileSaveChainsRef = useRef<Record<string, Promise<void>>>({});
  const latestFileSaveForUnloadRef = useRef<
    Record<string, FileContentSaveRequest>
  >({});
  const fileSaveTimerRef = useRef<number | null>(null);

  const saveFileContent = useCallback(
    (pending: FileContentSaveRequest) => {
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
      const pending = {
        id: fileId,
        content,
        syncCollab: options.syncCollab ?? true,
      };
      latestFileSaveForUnloadRef.current[fileId] = pending;
      if (options.immediate) {
        if (fileSaveTimerRef.current) {
          window.clearTimeout(fileSaveTimerRef.current);
          fileSaveTimerRef.current = null;
        }
        pendingFileSaveRef.current = null;
        saveFileContent(pending);
        return;
      }
      pendingFileSaveRef.current = pending;
      if (fileSaveTimerRef.current) {
        window.clearTimeout(fileSaveTimerRef.current);
      }
      fileSaveTimerRef.current = window.setTimeout(() => {
        const pending = pendingFileSaveRef.current;
        pendingFileSaveRef.current = null;
        fileSaveTimerRef.current = null;
        if (!pending) return;
        saveFileContent(pending);
      }, 400);
    },
    [saveFileContent],
  );

  useEffect(() => {
    const handlePageHide = () => {
      if (pendingFileSaveRef.current) {
        latestFileSaveForUnloadRef.current[pendingFileSaveRef.current.id] =
          pendingFileSaveRef.current;
      }
      Object.values(latestFileSaveForUnloadRef.current).forEach(
        sendFileContentSaveKeepalive,
      );
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      if (fileSaveTimerRef.current) {
        window.clearTimeout(fileSaveTimerRef.current);
      }
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
      if (!id) return;
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

  const design = isDesignData(designResult) ? designResult : null;
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems();

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
      setShowPrompt(open);
      if (open) {
        setPromptDesignSystemId(resolvePromptDesignSystemId());
      } else {
        setPromptDesignSystemId(undefined);
      }
    },
    [resolvePromptDesignSystemId],
  );

  const handleTweakPromptOpenChange = useCallback((open: boolean) => {
    setShowTweakPrompt(open);
    if (!open) {
      tweakPromptAnchorRef.current = null;
    }
  }, []);

  const handleRequestTweaks = useCallback((anchor: HTMLElement) => {
    tweakPromptAnchorRef.current = anchor;
    setActiveInspectorTab("tweaks");
    setShowTweakPrompt(true);
  }, []);

  const persistPromptDesignSystem = useCallback(
    (designSystemId: string | null) => {
      if (!id || design?.designSystemId === designSystemId) return;
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
    [design?.designSystemId, id, queryClient, updateDesignMutation],
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
    if (!id) return;
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
  }, [id, titleDraft, design?.title, updateDesignMutation, queryClient]);

  const files = design?.files ?? [];
  const designDataJson = useMemo(
    () => parseDesignDataJson(design?.data),
    [design?.data],
  );
  const canvasFrameGeometryById = useMemo(
    () => getCanvasFrameGeometry(designDataJson),
    [designDataJson],
  );
  const queueFrameGeometrySave = useCallback(
    (geometryById: CanvasFrameGeometryById) => {
      if (!id) return;
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
      }
      frameGeometrySaveTimerRef.current = window.setTimeout(() => {
        frameGeometrySaveTimerRef.current = null;
        const nextData = {
          ...designDataJson,
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
    [designDataJson, id, queryClient, updateDesignMutation],
  );

  const writeFrameGeometrySnapshot = useCallback(
    (geometryById: CanvasFrameGeometryById) => {
      if (!id) return;
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
        frameGeometrySaveTimerRef.current = null;
      }
      const snapshot = cloneCanvasFrameGeometry(geometryById);
      const nextData = {
        ...designDataJson,
        canvasFrames: snapshot,
      };
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
    [designDataJson, id, queryClient, updateDesignMutation],
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
      syncUndoRedoState();
    },
    [syncUndoRedoState],
  );

  generationOutputReadyRef.current = files.length > 0 || !!pendingVariants;

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
    return () => clearPendingGeneration(id);
  }, [id]);

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
      if (target && !targetFile && files.length === 0) return false;

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

      if (targetFile) {
        setActiveFileId(targetFile.id);
      }

      if (typeof command.zoom === "number" && Number.isFinite(command.zoom)) {
        setZoom(Math.min(400, Math.max(10, command.zoom)));
      }

      if (editorView === "overview") {
        viewModeRef.current = "overview";
        setDrawMode(false);
        setPinMode(false);
        setMode("edit");
        setSelectedElement(null);
        setActiveTool("move");
        setViewMode("overview");
      } else if (editorView === "single") {
        viewModeRef.current = "single";
        setDrawMode(false);
        setPinMode(false);
        setMode("edit");
        setSelectedElement(null);
        setActiveTool("move");
        if (
          typeof command.zoom !== "number" ||
          !Number.isFinite(command.zoom)
        ) {
          setZoom((currentZoom) => Math.max(currentZoom, FOCUSED_SCREEN_ZOOM));
        }
        setViewMode("single");
      }

      return true;
    },
    [files, id],
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
      if (!id) return;
      const source = files.find((file) => file.id === screenId);
      if (!source) return;
      const filename = nextDuplicatedFilename(files, source.filename);

      createFileMutation.mutate(
        {
          designId: id,
          filename,
          content: source.content,
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
    if (!id) return;
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
            setActiveFileId(nextId);
            setSelectedElement(null);
            setSelectedLayerIdsState([nextId]);
            setActiveTool("move");
            setMode("edit");
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
  }, [createFileMutation, files, id, queryClient, t]);

  const handleCreateScreenFrame = useCallback(
    (geometry: { x: number; y: number; width: number; height: number }) => {
      if (!id) return;
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
              setActiveFileId(nextId);
              setSelectedElement(null);
              setSelectedLayerIdsState([nextId]);
              setActiveTool("move");
              setMode("edit");
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
      docId: activeFileId,
      requestSource: TAB_ID,
      user: currentUser,
    });

  // Track collab-sourced content for the active file.
  // When Y.Doc is synced and has content, use it as the source of truth
  // instead of the DB-fetched content so live remote edits appear instantly.
  const [collabContent, setCollabContent] = useState<string | null>(null);
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
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
      clearStaleAgentCollabRecovery();
    }
  }, [activeFileId, clearStaleAgentCollabRecovery]);

  useEffect(() => {
    return clearStaleAgentCollabRecovery;
  }, [clearStaleAgentCollabRecovery]);

  // Seed collab content from Y.Doc once synced
  useEffect(() => {
    if (!ydoc || !isSynced || !activeFileId) return;
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
  }, [collabContent]);

  // Observe Y.Text changes for live updates from remote editors (peers + the
  // agent's in-process applyText). This is the instant peer-to-peer path.
  useEffect(() => {
    if (!ydoc || !isSynced) return;
    const ytext = ydoc.getText("content");
    const handler = (_event: unknown, transaction?: { origin?: unknown }) => {
      const next = ytext.toString();
      setCollabContent(next);
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
  }, [ydoc, isSynced]);

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
    if (
      typeof collabContent === "string" &&
      !shouldUseLiveFileContent({
        liveContent: collabContent,
        storedContent: dbContent,
        fileType: activeFile.fileType,
      })
    ) {
      clearStaleAgentCollabRecovery();
      setCollabContent(dbContent);
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
      collabContent === dbContent ||
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
      lastLocalContentRef.current !== collabContent;
    if (!externalNewer) {
      if (staleAgentEchoPossible) {
        if (staleAgentCollabRecoveryTimerRef.current === null) {
          const expectedContent = dbContent;
          const expectedUpdatedAt = dbUpdatedAt;
          staleAgentCollabRecoveryTimerRef.current = window.setTimeout(() => {
            staleAgentCollabRecoveryTimerRef.current = null;
            const currentCollab = collabContentRef.current;
            if (documentFileUpdatedAtRef.current !== expectedUpdatedAt) return;
            if (documentFileContentRef.current !== expectedContent) return;
            if (currentCollab === expectedContent) return;
            if (lastLocalContentRef.current === currentCollab) return;

            setCollabContent(expectedContent);
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
    isSynced,
    isLeadClient,
    ydoc,
  ]);

  useEffect(() => {
    const handleVariantPicked = (event: Event) => {
      const detail = (
        event as CustomEvent<{ designId?: string; content?: string }>
      ).detail;
      if (detail?.designId !== id || typeof detail.content !== "string") {
        return;
      }
      setCollabContent(detail.content);
      lastLocalContentRef.current = detail.content;
      setContentRenderRevision((revision) => revision + 1);
    };
    window.addEventListener(DESIGN_VARIANT_PICKED_EVENT, handleVariantPicked);
    return () => {
      window.removeEventListener(
        DESIGN_VARIANT_PICKED_EVENT,
        handleVariantPicked,
      );
    };
  }, [id]);

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

  // Resolve the content to render: prefer collab content, fall back to DB
  const activeContent = collabContent ?? activeFile?.content ?? "";
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
    return resolveCodeLayerNodeFromBridge(
      activeCodeLayerProjection,
      selectedElement.selector,
      selectedElement.sourceId ?? selectedElement.id,
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
  const hoveredCodeLayerNode = useMemo(() => {
    if (!hoveredElement) return null;
    return resolveCodeLayerNodeFromBridge(
      activeCodeLayerProjection,
      hoveredElement.selector,
      hoveredElement.sourceId ?? hoveredElement.id,
    );
  }, [activeCodeLayerProjection, hoveredElement]);
  const hoveredCanvasSelectorCandidates = useMemo(() => {
    if (hoveredCodeLayerNode) {
      return codeLayerSelectorAliases(hoveredCodeLayerNode);
    }
    return hoveredElement?.selector ? [hoveredElement.selector] : [];
  }, [hoveredCodeLayerNode, hoveredElement?.selector]);
  const hoveredCanvasSelector = hoveredCanvasSelectorCandidates[0] ?? null;

  const replacePreviewContent = useCallback(
    (nextContent: string, selector?: string | null) => {
      const replaceContent = (window as any).__designCanvasReplaceContent;
      if (typeof replaceContent !== "function") return false;
      return Boolean(
        replaceContent(
          nextContent,
          selector ?? selectedCanvasSelector,
          selectedCanvasSelectorCandidates,
        ),
      );
    },
    [selectedCanvasSelector, selectedCanvasSelectorCandidates],
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
      if (!activeFile) return;
      setCollabContent(nextContent);
      lastLocalContentRef.current = nextContent;
      if (id) {
        const optimisticUpdatedAt = new Date().toISOString();
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
                  ? {
                      ...file,
                      content: nextContent,
                      updatedAt: optimisticUpdatedAt,
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
      const targetFile = files.find((file) => file.id === screenId);
      if (!targetFile) return false;
      const baseContent =
        targetFile.id === activeFile?.id
          ? ydoc && isSynced
            ? ydoc.getText("content").toString()
            : (collabContentRef.current ?? activeContent)
          : targetFile.content;
      const nextContent = appendCanvasPrimitiveToHtml(baseContent, primitive);
      if (!nextContent) {
        toast.error(t("designEditor.toasts.primitiveInsertFailed"));
        return false;
      }

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

      return true;
    },
    [
      activeContent,
      activeFile?.id,
      applyLocalContentUpdate,
      files,
      id,
      isSynced,
      queryClient,
      saveFileContent,
      t,
      ydoc,
    ],
  );

  const handleMoveTool = useCallback(() => {
    setActiveTool("move");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
  }, []);

  const handleFrameTool = useCallback(() => {
    setActiveTool("frame");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
    setViewMode("overview");
  }, []);

  const handleTextTool = useCallback(() => {
    setActiveTool("text");
    setViewMode("overview");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
  }, []);

  const handleShapeTool = useCallback((tool: ShapeTool) => {
    setActiveTool(tool);
    setViewMode("overview");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
  }, []);

  const handleRectTool = useCallback(() => {
    handleShapeTool("rect");
  }, [handleShapeTool]);

  const handlePenTool = useCallback(() => {
    setActiveTool("pen");
    setViewMode("overview");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
  }, []);

  const handleHandTool = useCallback(() => {
    setActiveTool("hand");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setViewMode("overview");
  }, []);

  const handleScaleTool = useCallback(() => {
    if (!activeFile) return;
    setActiveTool("scale");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
  }, [activeFile]);

  const handleDrawTool = useCallback(() => {
    if (!activeFile || viewMode === "overview") return;
    setActiveTool("draw");
    setMode("annotate");
    setSelectedElement(null);
    setDrawMode(true);
    setPinMode(false);
  }, [activeFile, viewMode]);

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
      selectedScreenIds:
        viewMode === "overview" && activeFile?.id ? [activeFile.id] : [],
      selectedElement,
      hoveredElement,
      mode,
      activeTool,
      inspectorTab: activeInspectorTab,
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
    selectedElement,
    hoveredElement,
    mode,
    activeTool,
    activeInspectorTab,
    viewMode,
    zoom,
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
  }, [
    activeFile,
    design?.title,
    id,
    removeAgentChatContextItem,
    selectedCodeLayerNode,
    selectedElement,
    setAgentChatContextItem,
  ]);

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
      selectedScreenIds:
        viewMode === "overview" && activeFile?.id ? [activeFile.id] : [],
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
      selectedElement,
      tweakSelections,
      viewMode,
      zoom,
    ],
  );

  const handleElementSelect = useCallback(
    (info: ElementInfo) => {
      setSelectedElement(info);
      focusDesignInspectorForSelection();
    },
    [focusDesignInspectorForSelection],
  );

  const handleElementHover = useCallback((info: ElementInfo) => {
    setHoveredElement(info);
  }, []);

  const handleIframeHotkey = useCallback((payload: IframeHotkeyPayload) => {
    if (!payload.key) return;
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: payload.key,
        code: payload.code,
        metaKey: payload.metaKey,
        ctrlKey: payload.ctrlKey,
        shiftKey: payload.shiftKey,
        altKey: payload.altKey,
        repeat: payload.repeat,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

  const handleIframeContextMenu = useCallback(
    (payload: IframeContextMenuPayload) => {
      const container = canvasContainerRef.current;
      const menu = canvasContextMenuRef.current;
      if (!container || !menu) return;
      if (payload.info) {
        flushSync(() => {
          setSelectedElement(payload.info ?? null);
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
    [focusDesignInspectorForSelection],
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
      if (!activeFile) return;
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return;
      const [firstProperty, firstValue] = entries[0];
      const capability =
        selectedElement?.editCapabilities?.find((item) =>
          item.kind.startsWith("deterministic"),
        ) ?? selectedElement?.editCapabilities?.[0];
      const proofId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
        previousContent: activeContent,
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

      const nextContent = applyInlineStylesToHtml(activeContent, selector, {
        ...Object.fromEntries(entries),
      });
      const projection = buildCodeLayerProjection(activeContent);
      const targetNode = resolveCodeLayerNodeFromBridge(
        projection,
        selector,
        options.elementInfo?.sourceId ?? selectedElement?.sourceId,
      );
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
              failed:
                patch.result.message ??
                t("designEditor.patchProof.selectorMissing"),
            };
          }
          return { content: patch.content, failed: null };
        },
        { content: activeContent, failed: null },
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
      if (!activeFile) return false;
      const projection = buildCodeLayerProjection(activeContent);
      const resolveBridgeNode = (targetSelector: string, sourceId?: string) =>
        resolveCodeLayerNodeFromBridge(projection, targetSelector, sourceId);
      const targetNode = resolveBridgeNode(
        selector,
        details?.sourceId ?? elementInfo?.sourceId,
      );
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
          patch.result.message ?? t("designEditor.toasts.layerMoveFailed"),
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
    [activeContent, activeFile, applyLocalContentUpdate, t],
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
      if (!activeFile) return false;
      const projection = buildCodeLayerProjection(activeContent);
      const targetNode = resolveCodeLayerNodeFromBridge(
        projection,
        selector,
        details?.sourceId ?? elementInfo?.sourceId,
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
        toast.error(t("designEditor.toasts.layerMoveFailed"));
        return false;
      }
      applyLocalContentUpdate(nextContent, { refreshPreview: false });
      const nextProjection = buildCodeLayerProjection(nextContent);
      const nextNode = elementInfo
        ? resolveCodeLayerNodeFromBridge(
            nextProjection,
            elementInfo.selector,
            elementInfo.sourceId,
          )
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
    [activeContent, activeFile, applyLocalContentUpdate, t],
  );

  const handleTextContentChange = useCallback(
    (
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: { html?: string },
    ) => {
      if (!activeFile) return;
      const projection = buildCodeLayerProjection(activeContent);
      const targetNode = resolveCodeLayerNodeFromBridge(
        projection,
        selector,
        elementInfo?.sourceId,
      );
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
          patch?.result.message ?? t("designEditor.patchProof.selectorMissing"),
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
    [activeContent, activeFile, applyLocalContentUpdate, t],
  );

  const handleCopySelection = useCallback(async () => {
    if (!selectedElement?.selector) return;
    const html = getElementOuterHtml(activeContent, selectedElement.selector);
    if (!html) return;
    copiedLayerHtmlRef.current = html;
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
      if (!activeFile || !copiedLayerHtmlRef.current) return;
      const nextContent = cloneHtmlLayerAtPosition(
        activeContent,
        copiedLayerHtmlRef.current,
        position ?? { x: 120, y: 120 },
      );
      if (!nextContent) return;
      applyLocalContentUpdate(nextContent);
      toast.success(t("designEditor.toasts.pasted"));
    },
    [activeContent, activeFile, applyLocalContentUpdate, t],
  );

  const handleDuplicateSelection = useCallback(() => {
    if (selectedElement?.selector) {
      const html = getElementOuterHtml(activeContent, selectedElement.selector);
      if (html) {
        const rect = selectedElement.boundingRect;
        const nextContent = cloneHtmlLayerAtPosition(activeContent, html, {
          x: rect.x + 16,
          y: rect.y + 16,
        });
        if (nextContent) {
          applyLocalContentUpdate(nextContent);
          return;
        }
      }
    }
    if (activeFile) handleDuplicateScreen(activeFile.id);
  }, [
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    handleDuplicateScreen,
    selectedElement,
  ]);

  const handleDeleteSelection = useCallback(() => {
    if (!selectedElement?.selector) return;
    const projection = buildCodeLayerProjection(activeContent);
    const targetNode = resolveCodeLayerNodeFromBridge(
      projection,
      selectedElement.selector,
      selectedElement.sourceId ?? selectedElement.id,
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
    deleteRuntimeElement,
    selectedElement,
  ]);

  const handleDeleteOverviewSelection = useCallback(
    (selectedIds: string[]) => {
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
    if (!selectedElement?.selector || !copiedStylePropsRef.current) return;
    const styles = Object.fromEntries(
      Object.entries(copiedStylePropsRef.current).filter(([, value]) =>
        Boolean(value),
      ),
    );
    commitVisualStyles(selectedElement.selector, styles);
    toast.success(t("designEditor.toasts.propsPasted"));
  }, [commitVisualStyles, selectedElement, t]);

  const changeSelectedZIndex = useCallback(
    (mode: "forward" | "front" | "backward" | "back") => {
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
    [commitVisualStyles, selectedElement],
  );

  const handleNudgeSelection = useCallback(
    (direction: "up" | "right" | "down" | "left", largeStep: boolean) => {
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
    [commitVisualStyles, selectedElement],
  );

  // Handle undo: pop from UndoManager, then queue SQL persist.
  // The Y.Text observer already calls setCollabContent when the doc changes,
  // but undo/redo transactions use the UndoManager as origin so we must also
  // advance lastLocalContentRef and trigger the debounced save here.
  const handleUndo = useCallback(() => {
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
      writeFrameGeometrySnapshot(entry.before);
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
    isSynced,
    queueFileContentSave,
    replacePreviewContent,
    syncUndoRedoState,
    writeFrameGeometrySnapshot,
  ]);

  const handleRedo = useCallback(() => {
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
      writeFrameGeometrySnapshot(entry.after);
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
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => {
      const prev = [...ZOOM_PRESETS].reverse().find((p) => p < z);
      return prev ?? z;
    });
  }, []);

  const runEditorViewTransition = useCallback((update: () => void) => {
    if (typeof document === "undefined") {
      update();
      return;
    }

    const startViewTransition = (
      document as Document & {
        startViewTransition?: (callback: () => void) => void;
      }
    ).startViewTransition;

    if (typeof startViewTransition !== "function") {
      update();
      return;
    }

    startViewTransition.call(document, () => {
      flushSync(update);
    });
  }, []);

  const enterOverviewFromZoom = useCallback(() => {
    if (viewModeRef.current === "overview") return;
    viewModeRef.current = "overview";
    runEditorViewTransition(() => {
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setSelectedElement(null);
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
        return;
      }
      viewModeRef.current = "single";
      runEditorViewTransition(() => {
        if (fileId) setActiveFileId(fileId);
        setDrawMode(false);
        setPinMode(false);
        setMode("edit");
        setSelectedElement(null);
        setActiveTool("move");
        setZoom((currentZoom) => Math.max(currentZoom, FOCUSED_SCREEN_ZOOM));
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
      if ((next === "annotate" || next === "interact") && !activeFile) {
        return;
      }

      if (activeFile && viewMode === "overview") {
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
    [activeFile, viewMode],
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
    setDrawMode(true);
  }, [activeFile?.id, embedded, mode, viewMode]);

  const handleViewModeToggle = useCallback(() => {
    if (viewModeRef.current === "overview") {
      enterSingleScreen(activeFileId);
      return;
    }
    enterOverviewFromZoom();
  }, [activeFileId, enterOverviewFromZoom, enterSingleScreen]);

  const handlePinToolToggle = useCallback(() => {
    if (!activeFile || viewMode === "overview") return;
    if (pinMode) {
      setPinMode(false);
      if (mode === "annotate") {
        setActiveTool("draw");
        setDrawMode(true);
      }
      return;
    }
    setActiveTool("comment");
    setMode("annotate");
    setPinMode(true);
    setDrawMode(true);
  }, [activeFile, mode, pinMode, viewMode]);

  const handleEscapeHotkey = useCallback(() => {
    setSelectedElement(null);
    setHoveredElement(null);
    setOverviewClearSelectionRequest((request) => request + 1);
    setDrawMode(false);
    setPinMode(false);
    setActiveTool("move");
    setMode("edit");
  }, []);

  useEffect(() => {
    if (
      embedded ||
      pendingVariants ||
      (pendingQuestions && pendingQuestions.length > 0)
    ) {
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

    window.addEventListener("keydown", handleSpaceHandTool);
    window.addEventListener("keyup", handleSpaceHandRelease);
    return () => {
      window.removeEventListener("keydown", handleSpaceHandTool);
      window.removeEventListener("keyup", handleSpaceHandRelease);
    };
  }, [activeTool, embedded, pendingQuestions, pendingVariants]);

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
    setViewMode("overview");
    setOverviewSelectAllRequest((request) => request + 1);
  }, [files.length]);

  useDesignHotkeys({
    enabled:
      !embedded &&
      !pendingVariants &&
      !(pendingQuestions && pendingQuestions.length > 0),
    onMoveTool: handleMoveTool,
    onFrameTool: handleFrameTool,
    onRectangleTool: handleRectTool,
    onTextTool: handleTextTool,
    onPenTool: handlePenTool,
    onHandTool: handleHandTool,
    onCommentTool: handlePinToolToggle,
    onScaleTool: handleScaleTool,
    onCopy: handleCopySelection,
    onPaste: () => handlePasteSelection(),
    onPasteOver: () => handlePasteSelection(),
    onCopyProps: handleCopyProps,
    onPasteProps: handlePasteProps,
    onCopyAsCode: handleCopySelection,
    onDuplicate: handleDuplicateSelection,
    onDelete: handleDeleteSelection,
    onRename: () => {
      setTitleDraft(design?.title ?? "");
      setTitleEditing(true);
    },
    onSelectAll: handleSelectAllFrames,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onBringForward: () => changeSelectedZIndex("forward"),
    onBringToFront: () => changeSelectedZIndex("front"),
    onSendBackward: () => changeSelectedZIndex("backward"),
    onSendToBack: () => changeSelectedZIndex("back"),
    onEscape: handleEscapeHotkey,
    onTab: ({ backwards }) => handleCycleFile(backwards),
    onNudge: ({ direction, largeStep }) =>
      handleNudgeSelection(direction, largeStep),
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: () => setZoom(100),
    onZoomToFit: () => {
      setViewMode("overview");
      setActiveTool("move");
      setZoom(100);
    },
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
      if (!id || !design) return;
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
        startedAt: Date.now(),
      });
      setHasPendingGeneration(true);
      setRetryablePrompt(null);
    },
    [
      id,
      design,
      agentSubmit,
      clearAutoRetryTimer,
      clearGenerationCompleteTimer,
    ],
  );

  const handleRetryGeneration = useCallback(() => {
    if (!retryablePrompt) return;
    startRetryGeneration(
      retryablePrompt,
      (retryablePrompt.attempt ?? 1) + 1,
      "manual",
    );
  }, [retryablePrompt, startRetryGeneration]);

  useEffect(() => {
    clearAutoRetryTimer();
    if (
      !retryablePrompt ||
      !generationIssue ||
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
    retryablePrompt,
    generationIssue,
    generating,
    pendingGenerationActive,
    startRetryGeneration,
    clearAutoRetryTimer,
  ]);

  const handleCopyCodingHandoff = useCallback(() => {
    if (!id) return;
    createCodingHandoffMutation.mutate(
      {
        id,
        origin: window.location.origin,
        format: "markdown",
      } as any,
      {
        onSuccess: async (result: any) => {
          const text =
            typeof result?.clipboardText === "string"
              ? result.clipboardText
              : typeof result?.prompt === "string"
                ? result.prompt
                : "";
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
        },
        onError: (error) => {
          toast.error(
            error.message || t("designEditor.toasts.codingHandoffError"),
          );
        },
      },
    );
  }, [createCodingHandoffMutation, id, t]);

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
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const doc = iframe?.contentDocument;
      if (!doc?.documentElement) {
        toast.error(t("designEditor.toasts.openScreenPng"));
        return;
      }
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
          backgroundColor: null,
        });
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
            console.error("PNG export failed during download:", callbackError);
            toast.error(
              callbackError instanceof Error
                ? callbackError.message
                : t("designEditor.toasts.pngSaveError"),
            );
          }
        }, "image/png");
      } catch (error) {
        console.error("PNG export failed:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : t("designEditor.toasts.pngExportError"),
        );
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
    (settings: ExportSettingsValue) => {
      if (settings.format === "svg") {
        void handleDownloadSvg(settings);
        return;
      }
      void handleDownloadPng(settings);
    },
    [handleDownloadPng, handleDownloadSvg],
  );

  useEffect(() => {
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
  }, [activeContent, activeFile, applyLocalContentUpdate, id]);
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
    if (selectedElementLayerId) validIds.add(selectedElementLayerId);
    files.forEach((file) => validIds.add(file.id));
    const filtered = selectedLayerIdsState.filter((layerId) =>
      validIds.has(layerId),
    );
    if (selectedElementLayerId && !filtered.includes(selectedElementLayerId)) {
      return [selectedElementLayerId];
    }
    return filtered;
  }, [
    activeCodeLayerProjection.nodes,
    codeLayerModelsByFile,
    files,
    selectedElementLayerId,
    selectedLayerIdsState,
    viewMode,
  ]);

  useEffect(() => {
    setSelectedLayerIdsState((current) => {
      if (!selectedElementLayerId) {
        return current.length === 0 ? current : [];
      }
      if (current.includes(selectedElementLayerId)) return current;
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
    const activeFileBlocked =
      activeFile?.id &&
      (lockedLayerIds.has(activeFile.id) || hiddenLayerIds.has(activeFile.id));
    const selectionBlocked =
      Boolean(activeFileBlocked) ||
      selectedPathIds.some(
        (layerId) => lockedLayerIds.has(layerId) || hiddenLayerIds.has(layerId),
      );
    if (!selectionBlocked) return;
    setSelectedElement(null);
    setSelectedLayerIdsState((current) =>
      current.length === 0 ? current : [],
    );
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerOwnerByNodeId,
    hiddenLayerIds,
    lockedLayerIds,
    selectedElementLayerId,
  ]);

  const overviewScreens = useMemo(() => {
    const metadataByFileId = getDesignDataRecord(
      designDataJson,
      "screenMetadata",
    );
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
      };
    });
  }, [designDataJson, files]);

  const activeScreenPreviewUrl = useMemo(() => {
    if (builderPreviewUrl) return builderPreviewUrl;
    const screen = overviewScreens.find((item) => item.id === activeFile?.id);
    return (
      screen?.url ||
      screen?.previewUrl ||
      externalPreviewUrlForContent(activeContent)
    );
  }, [activeContent, activeFile?.id, builderPreviewUrl, overviewScreens]);

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
    activeLayerId && lockedLayerIds.has(activeLayerId),
  );
  const activeLayerHidden = Boolean(
    activeLayerId && hiddenLayerIds.has(activeLayerId),
  );

  const handleLayerMove = useCallback(
    (intent: LayersPanelMoveIntent) => {
      const targetOwner = codeLayerOwnerByNodeId.get(intent.targetId);
      if (!targetOwner) return;
      if (
        lockedLayerIds.has(intent.targetId) ||
        hiddenLayerIds.has(intent.targetId)
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
          lockedLayerIds.has(draggedId) ||
          hiddenLayerIds.has(draggedId)
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
            patch.result.message ?? t("designEditor.toasts.layerMoveFailed"),
          );
          continue;
        }
        nextContent = patch.content;
        moved = true;
      }
      if (!moved || nextContent === sourceContent) return;
      applyFileContentUpdate(targetOwner.fileId, nextContent, {
        refreshPreview: targetOwner.fileId === activeFile?.id,
      });
    },
    [
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      codeLayerOwnerByNodeId,
      files,
      hiddenLayerIds,
      lockedLayerIds,
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
    (ids: string[]) => {
      setSelectedLayerIdsState(
        ids.filter((layerId) => !layerId.startsWith("__")),
      );
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
        setActiveFileId(fileId);
        setSelectedElement(null);
        setSelectedLayerIdsState([fileId]);
        setActiveTool("move");
        setMode("edit");
        setViewMode("overview");
      }
    },
    [
      activeFile?.id,
      codeLayerOwnerByNodeId,
      files,
      focusDesignInspectorForSelection,
    ],
  );

  const handleLayerRename = useCallback(
    (layerId: string, name: string) => {
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
      codeLayerOwnerByNodeId,
      files,
      queryClient,
      t,
      updateFileMutation,
    ],
  );

  const handleToggleLayerLocked = useCallback(
    (layerId: string, locked: boolean) => {
      setLockedLayerIds((current) => {
        const next = new Set(current);
        if (locked) next.add(layerId);
        else next.delete(layerId);
        return next;
      });
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
      if (nextContent && nextContent !== sourceContent) {
        applyFileContentUpdate(owner.fileId, nextContent, {
          refreshPreview: false,
        });
      }
    },
    [
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      codeLayerOwnerByNodeId,
      files,
    ],
  );

  const handleToggleLayerHidden = useCallback(
    (layerId: string, hidden: boolean) => {
      setHiddenLayerIds((current) => {
        const next = new Set(current);
        if (hidden) next.add(layerId);
        else next.delete(layerId);
        return next;
      });
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
      if (nextContent && nextContent !== sourceContent) {
        applyFileContentUpdate(owner.fileId, nextContent, {
          refreshPreview: false,
        });
      }
    },
    [
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      codeLayerOwnerByNodeId,
      files,
    ],
  );

  const getContextCanvasPoint = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 120, y: 120 };
      return {
        x: Math.max(0, clientX - rect.left),
        y: Math.max(0, clientY - rect.top),
      };
    },
    [],
  );

  const zoomLabel = `${Math.round(zoom)}%`;

  if (!id) {
    navigate("/");
    return null;
  }

  if (designLoading || (!design && pendingGenerationActive)) {
    return <DesignEditorSkeleton embedded={embedded} />;
  }

  if (!design) {
    return (
      <div className="flex-1 bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t("designEditor.notFound")}</p>
        <Button
          variant="outline"
          onClick={() => navigate("/")}
          className="cursor-pointer"
        >
          <IconArrowLeft className="w-4 h-4" />
          {t("designEditor.backToDesigns")}
        </Button>
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
              className="h-7 shrink-0 gap-0.5 px-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
              disabled={viewMode === "overview"}
            >
              {deviceFrameIcon}
              <IconChevronDown className="size-2.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.devicePreview")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
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
              disabled={!activeFile}
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
              disabled={!activeFile || createCodingHandoffMutation.isPending}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const projectTitleControl = titleEditing ? (
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
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            setTitleDraft(design.title);
            setTitleEditing(true);
          }}
          className="-mx-1 min-w-0 flex-1 cursor-text truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90 hover:bg-accent/50"
        >
          {design.title}
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("designEditor.clickToRename")}</TooltipContent>
    </Tooltip>
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

  const rightSidebarActions = (
    <div className="shrink-0 border-b border-border bg-[var(--design-editor-panel-bg)] px-2 py-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <DesignCollaboratorsMenu
          collaborators={designCollaborators}
          followingEmail={followingEmail}
          label={t("designEditor.collaborators")}
          onAvatarClick={handleAvatarClick}
        />

        <div className="ml-auto flex shrink-0 items-center gap-1">
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

          <ShareButton
            resourceType="design"
            resourceId={id}
            resourceTitle={design.title}
            hideTriggerIcon
            triggerClassName="h-8 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
          />

          <AgentToggleButton />
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
                window.parent.postMessage({ type: "design:close" }, "*");
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
                    disabled={!activeFile}
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
                    disabled={
                      !activeFile || createCodingHandoffMutation.isPending
                    }
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
                disabled={!activeFile || viewMode === "overview"}
              >
                <IconPin className="mr-2 h-4 w-4" />
                {pinMode
                  ? t("designEditor.stopPinningComments")
                  : t("designEditor.pinComment")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {titleEditing ? (
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
          ) : (
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
          )}
          {!embedded && (
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
                          disabled={viewMode === "overview"}
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

            {!embedded && (
              <PresenceBar
                activeUsers={activeUsers}
                agentActive={agentActive}
                currentUserEmail={session?.email}
                onAvatarClick={handleAvatarClick}
                followingEmail={followingEmail}
              />
            )}

            {!embedded && (
              <ShareButton
                resourceType="design"
                resourceId={id}
                resourceTitle={design.title}
                hideTriggerIcon
                triggerClassName="h-8 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
              />
            )}

            {!embedded && <AgentToggleButton />}
          </div>
        </div>
      </header>

      {/* Main canvas area */}
      <div className="flex-1 flex overflow-hidden relative">
        {!embedded && !pendingVariants ? (
          <div
            className="relative flex min-h-0 shrink-0 flex-col bg-[var(--design-editor-panel-bg)]"
            style={{ width: leftSidebarWidth }}
          >
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
              {projectMenu}
              {projectTitleControl}
              {deviceFrameControl}
            </div>
            <div className="min-h-0 flex-1">
              <LayersPanel
                screens={layerPanelFiles}
                activeScreenId={activeFileId ?? undefined}
                files={
                  viewMode === "overview" ? overviewLayerPanelFiles : undefined
                }
                layers={
                  viewMode === "overview" ? undefined : activeLayerPanelNodes
                }
                selectedIds={selectedLayerIds}
                expandedIds={expandedLayerIds}
                searchQuery={layersSearchQuery}
                onScreenSelect={(screenId) => {
                  setActiveFileId(screenId);
                  setViewMode("overview");
                  setActiveTool("move");
                  setMode("edit");
                  setSelectedElement(null);
                  setSelectedLayerIdsState([screenId]);
                }}
                onScreenOverview={() => {
                  setViewMode("overview");
                  setActiveTool("move");
                  setMode("edit");
                }}
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

        {/* Question flow overlay — full canvas takeover, blocks editing while
            the user answers. Closes itself on submit/skip.
            Variants take precedence: when both states are set (rare race when
            the agent hasn't cleared the question flow before opening variants),
            we hide questions so the user only sees the most recent step. */}
        {pendingQuestions &&
          pendingQuestions.length > 0 &&
          !pendingVariants && (
            <div className="absolute inset-0 z-40 bg-background">
              <QuestionFlow
                questions={pendingQuestions}
                onSubmit={handleQuestionsSubmit}
                onSkip={handleQuestionsSkip}
                title={pendingQuestionsTitle}
                description={pendingQuestionsDescription}
                skipLabel={pendingQuestionsSkipLabel}
                submitLabel={pendingQuestionsSubmitLabel}
              />
            </div>
          )}

        {/* Variant grid overlay — full canvas takeover with 2-5 candidate
            designs. "Use this direction" persists the chosen content as index.html. */}
        {pendingVariants && (
          <div className="absolute inset-0 z-40 flex flex-col bg-background">
            <div
              className={`flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 ${
                embedded ? "h-10" : "h-12"
              }`}
            >
              <div className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground/90">
                  {pendingVariants.prompt ?? t("designEditor.pickDirection")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("designEditor.variations", {
                    count: pendingVariants.variants.length,
                  })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                onClick={handleVariantsDismiss}
              >
                <IconX className="w-3.5 h-3.5" />
                {t("designEditor.close")}
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VariantGrid
                variants={pendingVariants.variants}
                selectedId={selectedVariantId}
                onSelect={setSelectedVariantId}
                onUse={handleVariantChoice}
                compact={embedded}
              />
            </div>
          </div>
        )}

        {/* Link-only (CLI / Codex / Claude Code) paste-back: after a pick there
            is no chat bridge, so surface a copyable summary to continue. */}
        {standalonePick && (
          <VariantHandoffCard
            pick={standalonePick}
            onDismiss={dismissStandalonePick}
          />
        )}

        {!embedded && activeFile && !pendingVariants && !questionFlowActive && (
          <FigmaBottomToolbar
            mode={mode}
            pinMode={pinMode}
            drawMode={drawMode}
            activeTool={activeTool}
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
        {!pendingVariants && (
          <CanvasContextMenu
            ref={canvasContextMenuRef}
            selectedCount={activeFile ? 1 : 0}
            hasClipboard={hasCanvasClipboard}
            hasPropsClipboard={hasPropsClipboard}
            isLocked={activeLayerLocked}
            isHidden={activeLayerHidden}
            canPasteHere={hasCanvasClipboard && Boolean(activeFile)}
            canSelectAll={files.length > 0}
            canZoomToFit={Boolean(activeFile)}
            canZoomToSelection={Boolean(activeFile)}
            canCopy={Boolean(activeFile)}
            canPaste={hasCanvasClipboard && Boolean(activeFile)}
            canPasteOver={hasCanvasClipboard && Boolean(activeFile)}
            canDuplicate={Boolean(activeFile)}
            canDelete={Boolean(
              selectedElement || (activeFile && files.length > 1),
            )}
            canReorder={Boolean(selectedElement)}
            canRename={false}
            canToggleLocked={Boolean(activeLayerId)}
            canToggleHidden={Boolean(activeLayerId)}
            canCopyProps={Boolean(selectedElement)}
            canPasteProps={hasPropsClipboard && Boolean(selectedElement)}
            canCopyAsCode={Boolean(activeFile)}
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
            onZoomToFit={() => {
              setViewMode("overview");
              setActiveTool("move");
              setZoom(100);
            }}
            onZoomToSelection={() => setZoom(150)}
            onCopy={handleCopySelection}
            onPaste={() => handlePasteSelection()}
            onPasteOver={() => handlePasteSelection()}
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
                {viewMode === "overview" ? (
                  <MultiScreenCanvas
                    screens={overviewScreens}
                    zoom={zoom}
                    onZoomChange={setZoom}
                    activeId={activeFileId}
                    activeTool={activeTool}
                    onActiveToolChange={(tool) =>
                      setActiveTool(tool === "rectangle" ? "rect" : tool)
                    }
                    selectAllRequest={overviewSelectAllRequest}
                    clearSelectionRequest={overviewClearSelectionRequest}
                    geometryById={canvasFrameGeometryById}
                    onGeometryChange={queueFrameGeometrySave}
                    onGeometryCommit={handleGeometryCommit}
                    onCreatePrimitive={handleCreatePrimitive}
                    onCreateScreenFrame={handleCreateScreenFrame}
                    onDeleteSelection={handleDeleteOverviewSelection}
                    onPick={(id) => {
                      setSelectedElement(null);
                      setSelectedLayerIdsState([id]);
                      setActiveFileId(id);
                      setActiveTool("move");
                      setMode("edit");
                    }}
                    onEdit={enterSingleScreen}
                    onZoomToEdit={enterSingleScreen}
                    zoomToEditThreshold={OVERVIEW_EDIT_ZOOM_THRESHOLD}
                    onDuplicate={handleDuplicateScreen}
                    renderScreenContent={(screen, metadata, geometry) =>
                      screen.id === activeFile?.id ? (
                        <DesignCanvas
                          content={activeContent}
                          contentKey={`${activeFile.id}:${contentRenderRevision}`}
                          zoom={100}
                          deviceFrame="none"
                          embeddedFrame={{
                            viewportWidth: metadata.width,
                            viewportHeight: metadata.height,
                            displayWidth: geometry.width,
                            displayHeight: geometry.height,
                          }}
                          editMode={mode === "edit"}
                          interactMode={false}
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
                          onIframeHotkey={handleIframeHotkey}
                          onIframeContextMenu={handleIframeContextMenu}
                          onVisualStyleChange={handleVisualStyleChange}
                          onVisualStructureChange={handleVisualStructureChange}
                          onVisualDuplicateChange={handleVisualDuplicateChange}
                          onTextContentChange={handleTextContentChange}
                          onTextEditingStateChange={setTextEditingState}
                          tweakValues={cssVarValues}
                          drawMode={false}
                          pinMode={false}
                          designId={id}
                          designTitle={design?.title}
                          commentContextId={`${id}:${activeFile.id}`}
                          commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(activeFile.filename)}`}
                        />
                      ) : undefined
                    }
                  />
                ) : (
                  <>
                    <DesignCanvas
                      content={activeContent}
                      contentKey={`${activeFile.id}:${contentRenderRevision}`}
                      zoom={zoom}
                      onZoomChange={setZoom}
                      deviceFrame={deviceFrame}
                      editMode={mode === "edit"}
                      interactMode={mode === "interact"}
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
                      onIframeHotkey={handleIframeHotkey}
                      onIframeContextMenu={handleIframeContextMenu}
                      onVisualStyleChange={handleVisualStyleChange}
                      onVisualStructureChange={handleVisualStructureChange}
                      onVisualDuplicateChange={handleVisualDuplicateChange}
                      onTextContentChange={handleTextContentChange}
                      onTextEditingStateChange={setTextEditingState}
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
        {!embedded && !pendingVariants ? (
          <div
            className="relative flex h-full min-h-0 shrink-0 flex-col bg-[var(--design-editor-panel-bg)]"
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
                  onTweakChange={(tweakId, value) =>
                    setTweakSelections((prev) => {
                      const next = { ...prev, [tweakId]: value };
                      queueTweakSave(next);
                      return next;
                    })
                  }
                  onRequestTweaks={handleRequestTweaks}
                  onStyleChange={handleStyleChange}
                  onStylesChange={handleStylesChange}
                  onExport={handleInspectorExport}
                  exporting={svgExporting}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </div>
        ) : null}
      </div>

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
              "*",
            );
            handlePromptOpenChange(false);
            return;
          }
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
            startedAt: Date.now(),
          });
          setHasPendingGeneration(true);
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
        anchorRef={tweakPromptAnchorRef}
      />
    </div>
  );
}
