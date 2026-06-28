import {
  useActionQuery,
  useActionMutation,
  useSession,
  useCollaborativeDoc,
  isReconcileLeadClient,
  generateTabId,
  emailToColor,
  emailToName,
  PresenceBar,
  AgentToggleButton,
  NotificationsBell,
  ShareButton,
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
  type CollabUser,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import {
  resolveTweaksToCssVars,
  type TweakSelections,
} from "@shared/resolve-tweaks";
import {
  IconArrowLeft,
  IconPencil,
  IconMessage,
  IconBrush,
  IconAdjustmentsHorizontal,
  IconZoomIn,
  IconZoomOut,
  IconDeviceDesktop,
  IconDeviceTablet,
  IconDeviceMobile,
  IconViewportWide,
  IconPlus,
  IconLayoutGrid,
  IconX,
  IconPin,
  IconCode,
  IconArchive,
  IconPhoto,
  IconRefresh,
  IconMenu2,
  IconChevronDown,
  IconCheck,
  IconDotsVertical,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPointer,
  IconTypography,
  IconHandStop,
  IconSquare,
  IconVectorBezier,
  IconScale,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { useParams, useNavigate, Link } from "react-router";
import { toast } from "sonner";
import * as Y from "yjs";

import { CanvasContextMenu } from "@/components/design/CanvasContextMenu";
import { DesignCanvas } from "@/components/design/DesignCanvas";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import { EditPanel } from "@/components/design/EditPanel";
import type { ExportSettingsValue } from "@/components/design/inspector";
import {
  LayersPanel,
  type LayersPanelFile,
  type LayersPanelNode,
} from "@/components/design/LayersPanel";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { TweaksPanel } from "@/components/design/TweaksPanel";
import type {
  ElementInfo,
  DeviceFrameType,
  ViewportTab,
} from "@/components/design/types";
import { ZOOM_PRESETS } from "@/components/design/types";
import { VariantGrid } from "@/components/design/VariantGrid";
import { VariantHandoffCard } from "@/components/design/VariantHandoffCard";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useOpenMobileSidebar } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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

type EditorMode = "comment" | "edit" | "draw";
type DesignTool =
  | "move"
  | "frame"
  | "rect"
  | "text"
  | "pen"
  | "hand"
  | "comment"
  | "draw"
  | "scale"
  | "overview";

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

interface CanvasFrameGeometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  z?: number;
}

type CanvasFrameGeometryById = Record<string, CanvasFrameGeometry>;

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
    const element = doc.querySelector(selector) as HTMLElement | null;
    if (!element) return null;
    Object.entries(styles).forEach(([property, value]) => {
      (element.style as any)[property] = value;
    });
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
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

function nextFrameFilename(files: DesignFile[]): string {
  const existing = new Set(files.map((file) => file.filename));
  let index = 1;
  while (true) {
    const filename = index === 1 ? "frame.html" : `frame-${index}.html`;
    if (!existing.has(filename)) return filename;
    index += 1;
  }
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function createFrameHtml(title: string): string {
  const safeTitle = escapeHtmlText(title);
  return `<!doctype html>
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
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #ffffff;
      color: #111827;
    }
    [data-agent-native-node-id="frame-root"] {
      min-height: 100vh;
      position: relative;
      padding: 64px;
    }
  </style>
</head>
<body>
  <main data-agent-native-node-id="frame-root"></main>
</body>
</html>`;
}

function insertTextLayer(
  content: string,
  label: string,
  position: { x: number; y: number },
): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `text-${crypto.randomUUID()}`
      : `text-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const layer = `<div data-agent-native-node-id="${id}" style="position:absolute;left:${Math.max(
    24,
    Math.round(position.x),
  )}px;top:${Math.max(
    24,
    Math.round(position.y),
  )}px;z-index:10;padding:4px 6px;font:600 32px/1.15 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;color:#111827;background:transparent;">${escapeHtmlText(
    label,
  )}</div>`;
  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `${layer}\n</body>`);
  }
  return `${content}\n${layer}`;
}

function insertRectLayer(
  content: string,
  position: { x: number; y: number },
): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `rect-${crypto.randomUUID()}`
      : `rect-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const layer = `<div data-agent-native-node-id="${id}" style="position:absolute;left:${Math.max(
    24,
    Math.round(position.x),
  )}px;top:${Math.max(
    24,
    Math.round(position.y),
  )}px;width:160px;height:104px;z-index:9;border-radius:16px;background:#e5e7eb;border:1px solid rgba(17,24,39,0.12);"></div>`;
  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `${layer}\n</body>`);
  }
  return `${content}\n${layer}`;
}

function insertPenLayer(
  content: string,
  position: { x: number; y: number },
): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `path-${crypto.randomUUID()}`
      : `path-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const layer = `<svg data-agent-native-node-id="${id}" viewBox="0 0 160 96" style="position:absolute;left:${Math.max(
    24,
    Math.round(position.x),
  )}px;top:${Math.max(
    24,
    Math.round(position.y),
  )}px;width:160px;height:96px;z-index:10;overflow:visible;"><path d="M12 72 C44 8 90 8 148 72" fill="none" stroke="#111827" stroke-width="8" stroke-linecap="round"/></svg>`;
  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `${layer}\n</body>`);
  }
  return `${content}\n${layer}`;
}

function uniqueLayerId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    clone.setAttribute("data-agent-native-node-id", uniqueLayerId("copy"));
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

function getElementOuterHtml(content: string, selector: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    return doc.querySelector(selector)?.outerHTML ?? null;
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
    const element = doc.querySelector(selector);
    if (!element) return null;
    element.remove();
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

function elementLayerId(element: ElementInfo | null): string | null {
  if (!element) return null;
  return `element:${element.sourceId ?? element.selector ?? element.id ?? element.tagName}`;
}

const DESIGN_TEXT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "strong",
  "em",
  "label",
  "li",
]);

function layerTypeForElement(element: ElementInfo): LayersPanelNode["type"] {
  const tagName = element.tagName.toLowerCase();
  if (DESIGN_TEXT_TAGS.has(tagName)) return "text";
  if (tagName === "img" || tagName === "picture") return "image";
  if (tagName === "svg" || tagName === "path") return "shape";
  if (
    tagName === "button" ||
    element.classes?.some((item) => item.includes("card"))
  ) {
    return "component";
  }
  return "element";
}

function PatchProofCard({
  proof,
  onRollback,
  onDismiss,
}: {
  proof: PatchProofState;
  onRollback: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const isApplied = proof.status === "applied";
  const isFailed = proof.status === "failed";
  const isRolledBack = proof.status === "rolledBack";
  const canRollback = !!proof.previousContent && !isRolledBack;

  return (
    <div className="absolute bottom-4 left-4 z-[70] w-[320px] rounded-md border border-border bg-background/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-sm",
              isFailed
                ? "bg-destructive/15 text-destructive"
                : isApplied
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                  : "bg-primary/15 text-primary",
            )}
          >
            {isApplied ? (
              <IconCheck className="size-3.5" />
            ) : (
              <IconCode className="size-3.5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {t("designEditor.patchProof.title")}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {t(`designEditor.patchProof.status.${proof.status}`)}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 cursor-pointer"
          onClick={onDismiss}
          aria-label={t("designEditor.close")}
        >
          <IconX className="size-3.5" />
        </Button>
      </div>
      <div className="space-y-2 px-3 py-2 text-[11px]">
        <div className="rounded-sm bg-muted/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          <span className="text-foreground">{proof.property}</span>
          <span>:</span> <span>{proof.previousValue || "unset"}</span>
          <span>{" -> "}</span>
          <span className="text-foreground">{proof.nextValue}</span>
        </div>
        <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-muted-foreground">
          <span>{t("designEditor.patchProof.file")}</span>
          <span className="truncate text-foreground">{proof.filename}</span>
          <span>{t("designEditor.patchProof.source")}</span>
          <span className="truncate text-foreground">
            {proof.sourceId || proof.selector}
          </span>
          <span>{t("designEditor.patchProof.capability")}</span>
          <span className="truncate text-foreground">
            {t(`designEditor.capabilities.${proof.capability}`)}
            {typeof proof.confidence === "number"
              ? ` · ${Math.round(proof.confidence * 100)}%`
              : ""}
          </span>
        </div>
        {proof.error ? (
          <p className="text-[11px] text-destructive">{proof.error}</p>
        ) : null}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[10px] text-muted-foreground">
            {isApplied
              ? t("designEditor.patchProof.verified")
              : t("designEditor.patchProof.pending")}
          </span>
          <div className="flex items-center gap-1">
            {canRollback ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 cursor-pointer px-2 text-[11px]"
                onClick={onRollback}
              >
                <IconRefresh className="size-3.5" />
                {t("designEditor.patchProof.rollback")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 cursor-pointer px-2 text-[11px]"
              onClick={onDismiss}
            >
              {t("designEditor.patchProof.keep")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FigmaToolRail({
  mode,
  pinMode,
  drawMode,
  overviewActive,
  activeTool,
  onMove,
  onFrame,
  onRect,
  onText,
  onPen,
  onHand,
  onDraw,
  onScale,
  onCommentPin,
  onOverviewToggle,
}: {
  mode: EditorMode;
  pinMode: boolean;
  drawMode: boolean;
  overviewActive: boolean;
  activeTool: DesignTool;
  onMove: () => void;
  onFrame: () => void;
  onRect: () => void;
  onText: () => void;
  onPen: () => void;
  onHand: () => void;
  onDraw: () => void;
  onScale: () => void;
  onCommentPin: () => void;
  onOverviewToggle: () => void;
}) {
  const t = useT();
  const tools: Array<{
    key: string;
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
  }> = [
    {
      key: "move",
      active: activeTool === "move" && mode === "edit",
      label: t("designEditor.tools.move"),
      icon: <IconPointer className="size-4" />,
      onClick: onMove,
    },
    {
      key: "frame",
      active: activeTool === "frame",
      label: t("designEditor.tools.frame"),
      icon: <IconLayoutGrid className="size-4" />,
      onClick: onFrame,
    },
    {
      key: "rect",
      active: activeTool === "rect",
      label: t("designEditor.tools.rect"),
      icon: <IconSquare className="size-4" />,
      onClick: onRect,
    },
    {
      key: "text",
      active: activeTool === "text",
      label: t("designEditor.tools.text"),
      icon: <IconTypography className="size-4" />,
      onClick: onText,
    },
    {
      key: "pen",
      active: activeTool === "pen",
      label: t("designEditor.tools.pen"),
      icon: <IconVectorBezier className="size-4" />,
      onClick: onPen,
    },
    {
      key: "hand",
      active: activeTool === "hand",
      label: t("designEditor.tools.hand"),
      icon: <IconHandStop className="size-4" />,
      onClick: onHand,
    },
    {
      key: "comment",
      active: activeTool === "comment" && mode === "comment" && pinMode,
      label: t("designEditor.pinComment"),
      icon: <IconMessage className="size-4" />,
      onClick: onCommentPin,
    },
    {
      key: "draw",
      active: activeTool === "draw" && drawMode,
      label: t("designEditor.modes.draw"),
      icon: <IconBrush className="size-4" />,
      onClick: onDraw,
    },
    {
      key: "scale",
      active: activeTool === "scale",
      label: t("designEditor.tools.scale"),
      icon: <IconScale className="size-4" />,
      onClick: onScale,
    },
    {
      key: "overview",
      active: overviewActive,
      label: t("designEditor.screenOverview"),
      icon: <IconLayoutGrid className="size-4" />,
      onClick: onOverviewToggle,
    },
  ];

  return (
    <div className="absolute left-3 top-3 z-[70] flex flex-col overflow-hidden rounded-md border border-border bg-background/95 p-1 shadow-lg backdrop-blur">
      {tools.map((tool) => (
        <Tooltip key={tool.key}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                tool.active && "bg-accent text-foreground",
              )}
              onClick={tool.onClick}
              aria-label={tool.label}
            >
              {tool.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{tool.label}</TooltipContent>
        </Tooltip>
      ))}
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

function getCanvasFrameGeometry(
  data: Record<string, unknown>,
): CanvasFrameGeometryById {
  const frames = data.canvasFrames;
  if (!frames || typeof frames !== "object" || Array.isArray(frames)) return {};
  return Object.fromEntries(
    Object.entries(frames as Record<string, unknown>)
      .map(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return null;
        }
        const raw = value as Record<string, unknown>;
        const frame: CanvasFrameGeometry = {};
        (["x", "y", "width", "height", "rotation", "z"] as const).forEach(
          (key) => {
            if (typeof raw[key] === "number" && Number.isFinite(raw[key])) {
              frame[key] = raw[key];
            }
          },
        );
        return [id, frame] as const;
      })
      .filter((entry): entry is readonly [string, CanvasFrameGeometry] =>
        Boolean(entry),
      ),
  );
}

export default function DesignEditor() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openMobileSidebar = useOpenMobileSidebar();
  const embedded = isEmbedAuthActive();

  // Editor state
  const [mode, setMode] = useState<EditorMode>("comment");
  const [activeTool, setActiveTool] = useState<DesignTool>("comment");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [zoom, setZoom] = useState(100);
  const [deviceFrame, setDeviceFrame] = useState<DeviceFrameType>("none");
  const [viewMode, setViewMode] = useState<"single" | "overview">("single");
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null,
  );
  const [hoveredElement, setHoveredElement] = useState<ElementInfo | null>(
    null,
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [tweaksVisible, setTweaksVisible] = useState(false);
  const [layersSearchQuery, setLayersSearchQuery] = useState("");
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const [lockedLayerIds, setLockedLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [overviewSelectAllRequest, setOverviewSelectAllRequest] = useState(0);
  const [hasCanvasClipboard, setHasCanvasClipboard] = useState(false);
  const [hasPropsClipboard, setHasPropsClipboard] = useState(false);
  const copiedLayerHtmlRef = useRef<string | null>(null);
  const copiedStylePropsRef = useRef<Record<string, string> | null>(null);
  // Undo/redo state driven by Y.UndoManager
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const persistedSelectionStateRef = useRef<string | null>(null);
  const designSelectionOwnerIdRef = useRef(`${TAB_ID}:${generateTabId()}`);
  const frameGeometrySaveTimerRef = useRef<number | null>(null);
  const [tweakSaveActive, setTweakSaveActive] = useState(false);
  // Shared visual-editor modes (overlays the iframe). drawMode toggles the
  // pencil overlay, pinMode lets the user drop comment pins. They're
  // mutually exclusive — turning one on turns the other off.
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTweakPrompt, setShowTweakPrompt] = useState(false);
  const [svgExporting, setSvgExporting] = useState(false);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const promptAnchorRef = useRef<HTMLElement | null>(null);
  const tweakPromptAnchorRef = useRef<HTMLElement | null>(null);
  promptAnchorRef.current = generateBtnRef.current;
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
  const generationCompleteTimerRef = useRef<number | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
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
      setGenerationChatTabId(tabId);
      setHasPendingGeneration(true);
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

  // Current user info for collaborative presence
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
      }
    : undefined;

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
    }
  }, [id, markGenerationStale, trackAgentGeneration]);

  const pendingGenerationActive =
    hasPendingGeneration && !!readPendingGeneration(id);

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
  const [patchProof, setPatchProof] = useState<PatchProofState | null>(null);
  const pendingFileSaveRef = useRef<{ id: string; content: string } | null>(
    null,
  );
  const fileSaveTimerRef = useRef<number | null>(null);

  const queueFileContentSave = useCallback(
    (fileId: string, content: string) => {
      pendingFileSaveRef.current = { id: fileId, content };
      if (fileSaveTimerRef.current) {
        window.clearTimeout(fileSaveTimerRef.current);
      }
      fileSaveTimerRef.current = window.setTimeout(() => {
        const pending = pendingFileSaveRef.current;
        pendingFileSaveRef.current = null;
        fileSaveTimerRef.current = null;
        if (!pending) return;
        updateFileMutation.mutate(
          {
            id: pending.id,
            content: pending.content,
          } as any,
          {
            onSuccess: () => {
              setPatchProof((prev) =>
                prev && prev.fileId === pending.id && prev.status === "queued"
                  ? { ...prev, status: "applied" }
                  : prev,
              );
            },
            onError: (error) => {
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
            },
          },
        );
      }, 400);
    },
    [t, updateFileMutation],
  );

  useEffect(() => {
    return () => {
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
    setTweaksVisible(true);
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

  generationOutputReadyRef.current =
    files.length > 0 ||
    (pendingQuestions?.length ?? 0) > 0 ||
    !!pendingVariants;

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
              setActiveTool("overview");
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
      // Y.Doc snapshots are a render seed, not the SQL source of truth; the
      // reconcile effect below advances the updatedAt watermark only after it
      // confirms or applies the current DB content.
      setCollabContent(text);
    }
  }, [ydoc, isSynced, activeFileId]);

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
          try {
            const iframe = document.querySelector<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            );
            const doc = iframe?.contentDocument;
            if (doc && (!prev.selector || !doc.querySelector(prev.selector))) {
              return null;
            }
          } catch {
            // iframe not accessible yet — clear defensively
            return null;
          }
          return prev;
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          try {
            const iframe = document.querySelector<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            );
            const doc = iframe?.contentDocument;
            if (doc && (!prev.selector || !doc.querySelector(prev.selector))) {
              return null;
            }
          } catch {
            return null;
          }
          return prev;
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
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const ytext = ydoc.getText("content");
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
      captureTimeout: 800,
    });

    const syncState = () => {
      setCanUndo(um.canUndo());
      setCanRedo(um.canRedo());
    };
    um.on("stack-item-added", syncState);
    um.on("stack-item-updated", syncState);
    um.on("stack-item-popped", syncState);
    um.on("stack-cleared", syncState);

    undoManagerRef.current = um;
    syncState();

    return () => {
      um.destroy();
      undoManagerRef.current = null;
      setCanUndo(false);
      setCanRedo(false);
    };
  }, [ydoc, isSynced]);

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

  // Resolve the content to render: prefer collab content, fall back to DB
  const activeContent = collabContent ?? activeFile?.content ?? "";
  const pageStyles = useMemo(
    () => getBodyInlineStyles(activeContent),
    [activeContent],
  );

  const applyLocalContentUpdate = useCallback(
    (nextContent: string) => {
      if (!activeFile) return;
      setCollabContent(nextContent);
      lastLocalContentRef.current = nextContent;
      if (ydoc && isSynced) {
        const ytext = ydoc.getText("content");
        if (ytext.toString() !== nextContent) {
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, nextContent);
          }, LOCAL_EDIT_ORIGIN);
        }
      }
      queueFileContentSave(activeFile.id, nextContent);
    },
    [activeFile, isSynced, queueFileContentSave, ydoc],
  );

  const handleMoveTool = useCallback(() => {
    setActiveTool("move");
    setViewMode("single");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setTweaksVisible(false);
  }, []);

  const handleFrameTool = useCallback(() => {
    if (!id) return;
    setActiveTool("frame");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setViewMode("overview");

    const title = `${t("designEditor.tools.frame")} ${files.length + 1}`;
    createFileMutation.mutate(
      {
        designId: id,
        filename: nextFrameFilename(files),
        content: createFrameHtml(title),
        fileType: "html",
      } as any,
      {
        onSuccess: (result: any) => {
          const nextId = typeof result?.id === "string" ? result.id : null;
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          if (nextId) setActiveFileId(nextId);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : t("common.genericError"),
          );
        },
      },
    );
  }, [createFileMutation, files, id, queryClient, t]);

  const handleTextTool = useCallback(() => {
    if (!activeFile) return;
    setActiveTool("text");
    setViewMode("single");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
    applyLocalContentUpdate(
      insertTextLayer(activeContent, t("designEditor.tools.text"), {
        x: 96,
        y: 96,
      }),
    );
  }, [activeContent, activeFile, applyLocalContentUpdate, t]);

  const handleRectTool = useCallback(() => {
    if (!activeFile) return;
    setActiveTool("rect");
    setViewMode("single");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
    applyLocalContentUpdate(
      insertRectLayer(activeContent, {
        x: 112,
        y: 112,
      }),
    );
  }, [activeContent, activeFile, applyLocalContentUpdate]);

  const handlePenTool = useCallback(() => {
    if (!activeFile) return;
    setActiveTool("pen");
    setViewMode("single");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setSelectedElement(null);
    applyLocalContentUpdate(
      insertPenLayer(activeContent, {
        x: 128,
        y: 128,
      }),
    );
  }, [activeContent, activeFile, applyLocalContentUpdate]);

  const handleHandTool = useCallback(() => {
    setActiveTool("hand");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setTweaksVisible(false);
    setViewMode("overview");
  }, []);

  const handleScaleTool = useCallback(() => {
    if (!activeFile) return;
    setActiveTool("scale");
    setViewMode("single");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    setTweaksVisible(false);
  }, [activeFile]);

  const handleDrawTool = useCallback(() => {
    if (!activeFile || viewMode === "overview") return;
    setActiveTool("draw");
    setMode("draw");
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
      selectedElement,
      hoveredElement,
      mode,
      activeTool,
    };
    (window as any).__designSelection = selection;
    const persistedSelection = {
      designId: selection.designId,
      designTitle: selection.designTitle,
      activeFileId: selection.activeFileId,
      activeFilename: selection.activeFilename,
      selectedElement: selection.selectedElement,
      mode: selection.mode,
      activeTool: selection.activeTool,
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
    return () => {
      delete (window as any).__designSelection;
      delete el.dataset.designId;
      delete el.dataset.fileId;
    };
  }, [
    id,
    design,
    activeFile,
    selectedElement,
    hoveredElement,
    mode,
    activeTool,
  ]);

  const handleElementSelect = useCallback((info: ElementInfo) => {
    setSelectedElement(info);
  }, []);

  const handleElementHover = useCallback((info: ElementInfo) => {
    setHoveredElement(info);
  }, []);

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
      if (!nextContent) {
        setPatchProof((prev) =>
          prev?.id === proofId
            ? {
                ...prev,
                status: "failed",
                error: t("designEditor.patchProof.selectorMissing"),
              }
            : prev,
        );
        return;
      }

      setCollabContent(nextContent);
      setPatchProof((prev) =>
        prev?.id === proofId ? { ...prev, status: "queued" } : prev,
      );
      // Mark as our own write so the get-design reconcile + Yjs observe don't
      // treat the echo as an external edit and fight the live value.
      lastLocalContentRef.current = nextContent;
      // Write the edit into the shared Y.Doc so other open clients see it live
      // through Yjs (not only via the slower update-file → applyText round-trip).
      // Use LOCAL_EDIT_ORIGIN so the UndoManager captures this transaction.
      if (ydoc && isSynced) {
        const ytext = ydoc.getText("content");
        if (ytext.toString() !== nextContent) {
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, nextContent);
          }, LOCAL_EDIT_ORIGIN);
        }
      }
      queueFileContentSave(activeFile.id, nextContent);
      setSelectedElement((prev) =>
        options.elementInfo
          ? options.elementInfo
          : prev
            ? {
                ...prev,
                computedStyles: {
                  ...prev.computedStyles,
                  ...Object.fromEntries(entries),
                },
              }
            : prev,
      );
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
      commitVisualStyles(selector, { [property]: value });
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

  const handleCopySelection = useCallback(async () => {
    const html = selectedElement?.selector
      ? getElementOuterHtml(activeContent, selectedElement.selector)
      : activeContent;
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

  const handleDeleteSelection = useCallback(() => {
    if (selectedElement?.selector) {
      const nextContent = removeElementFromHtml(
        activeContent,
        selectedElement.selector,
      );
      if (!nextContent) return;
      applyLocalContentUpdate(nextContent);
      setSelectedElement(null);
      toast.success(t("designEditor.toasts.deleted"));
      return;
    }

    if (!activeFile || files.length <= 1) return;
    const nextActiveFile = files.find((file) => file.id !== activeFile.id);
    deleteFileMutation.mutate({ id: activeFile.id } as any, {
      onSuccess: () => {
        if (nextActiveFile) setActiveFileId(nextActiveFile.id);
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
        toast.success(t("designEditor.toasts.deleted"));
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : t("common.genericError"),
        );
      },
    });
  }, [
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    deleteFileMutation,
    files,
    queryClient,
    selectedElement,
    t,
  ]);

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

  const handleRollbackPatch = useCallback(() => {
    if (!patchProof?.previousContent || !activeFile) return;
    setCollabContent(patchProof.previousContent);
    lastLocalContentRef.current = patchProof.previousContent;
    if (ydoc && isSynced) {
      const ytext = ydoc.getText("content");
      if (ytext.toString() !== patchProof.previousContent) {
        ydoc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, patchProof.previousContent ?? "");
        }, LOCAL_EDIT_ORIGIN);
      }
    }
    queueFileContentSave(activeFile.id, patchProof.previousContent);
    setPatchProof((prev) =>
      prev?.id === patchProof.id ? { ...prev, status: "rolledBack" } : prev,
    );
  }, [activeFile, isSynced, patchProof, queueFileContentSave, ydoc]);

  // Handle undo: pop from UndoManager, then queue SQL persist.
  // The Y.Text observer already calls setCollabContent when the doc changes,
  // but undo/redo transactions use the UndoManager as origin so we must also
  // advance lastLocalContentRef and trigger the debounced save here.
  const handleUndo = useCallback(() => {
    const um = undoManagerRef.current;
    if (!um || !um.canUndo()) return;
    um.undo();
    if (ydoc && activeFile) {
      const next = ydoc.getText("content").toString();
      lastLocalContentRef.current = next;
      queueFileContentSave(activeFile.id, next);
    }
  }, [ydoc, activeFile, queueFileContentSave]);

  const handleRedo = useCallback(() => {
    const um = undoManagerRef.current;
    if (!um || !um.canRedo()) return;
    um.redo();
    if (ydoc && activeFile) {
      const next = ydoc.getText("content").toString();
      lastLocalContentRef.current = next;
      queueFileContentSave(activeFile.id, next);
    }
  }, [ydoc, activeFile, queueFileContentSave]);

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

  const handleModeChange = useCallback(
    (next: EditorMode) => {
      if (next === "draw" && (!activeFile || viewMode === "overview")) return;

      setMode(next);
      setSelectedElement(null);

      if (next === "draw") {
        setActiveTool("draw");
        setDrawMode(true);
        setPinMode(false);
      } else if (next === "comment") {
        setActiveTool("comment");
        setDrawMode(false);
        setPinMode(Boolean(activeFile && viewMode !== "overview"));
      } else {
        setActiveTool("move");
        setDrawMode(false);
        if (next === "edit") setPinMode(false);
      }
    },
    [activeFile, viewMode],
  );

  useEffect(() => {
    if (
      embedded ||
      mode !== "comment" ||
      !activeFile ||
      viewMode === "overview"
    ) {
      return;
    }
    setPinMode(true);
  }, [activeFile?.id, embedded, mode, viewMode]);

  const handleCommentTabClick = useCallback(() => {
    if (mode !== "comment" || !activeFile || viewMode === "overview") return;
    setActiveTool("comment");
    setPinMode(true);
    setDrawMode(false);
  }, [activeFile, mode, viewMode]);

  const handleViewModeToggle = useCallback(() => {
    setDrawMode(false);
    setPinMode(false);
    if (viewMode === "single") setMode("comment");
    setActiveTool(viewMode === "single" ? "overview" : "comment");
    setViewMode((current) => {
      return current === "overview" ? "single" : "overview";
    });
  }, [viewMode]);

  const handlePinToolToggle = useCallback(() => {
    if (!activeFile || viewMode === "overview") return;
    if (pinMode) {
      setPinMode(false);
      return;
    }
    setActiveTool("comment");
    setMode("comment");
    setPinMode(true);
    setDrawMode(false);
  }, [activeFile, pinMode, viewMode]);

  const handleEscapeHotkey = useCallback(() => {
    if (selectedElement) {
      setSelectedElement(null);
      return;
    }
    setDrawMode(false);
    setPinMode(false);
    setActiveTool("move");
    setMode("edit");
  }, [selectedElement]);

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
    setActiveTool("overview");
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
    onDuplicate: () => {
      if (activeFile) handleDuplicateScreen(activeFile.id);
    },
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
      setActiveTool("overview");
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

  const selectedElementLayerId = elementLayerId(selectedElement);
  const selectedElementLayer = useMemo<LayersPanelNode | null>(() => {
    if (!selectedElementLayerId || !selectedElement) return null;
    const textPreview = selectedElement.textContent
      ?.replace(/\s+/g, " ")
      .trim();
    return {
      id: selectedElementLayerId,
      name:
        textPreview ||
        selectedElement.sourceId ||
        selectedElement.id ||
        `<${selectedElement.tagName}>`,
      type: layerTypeForElement(selectedElement),
      detail: selectedElement.selector,
      badge: selectedElement.confidence
        ? `${Math.round(selectedElement.confidence * 100)}%`
        : undefined,
      locked: lockedLayerIds.has(selectedElementLayerId),
      hidden: hiddenLayerIds.has(selectedElementLayerId),
      lockable: true,
      hideable: true,
      renamable: false,
    };
  }, [hiddenLayerIds, lockedLayerIds, selectedElement, selectedElementLayerId]);

  const layerPanelFiles = useMemo<LayersPanelFile[]>(
    () =>
      files.map((file) => ({
        id: file.id,
        name: prettyScreenName(file.filename),
        filename: file.filename,
        fileType: file.fileType,
        detail: file.filename,
        badge: file.id === activeFile?.id ? "active" : undefined,
        locked: lockedLayerIds.has(file.id),
        hidden: hiddenLayerIds.has(file.id),
        lockable: true,
        hideable: true,
        renamable: true,
        layers:
          file.id === activeFile?.id && selectedElementLayer
            ? [selectedElementLayer]
            : [],
      })),
    [
      activeFile?.id,
      files,
      hiddenLayerIds,
      lockedLayerIds,
      selectedElementLayer,
    ],
  );

  const codeLayerNodes = useMemo<LayersPanelNode[]>(
    () =>
      activeFile
        ? [
            {
              id: `code:${activeFile.id}`,
              name: activeFile.filename,
              type: "code",
              detail: `${activeFile.fileType} · ${activeContent.length.toLocaleString()} chars`,
              selectable: true,
              renamable: false,
              lockable: false,
              hideable: false,
            },
          ]
        : [],
    [activeContent.length, activeFile],
  );

  const selectedLayerIds = useMemo(
    () =>
      [selectedElementLayerId ?? activeFile?.id].filter(Boolean) as string[],
    [activeFile?.id, selectedElementLayerId],
  );

  const overviewScreens = useMemo(
    () =>
      files.map((file) => ({
        id: file.id,
        filename: file.filename,
        content: file.content,
      })),
    [files],
  );

  const activeLayerId = selectedElementLayerId ?? activeFile?.id ?? "";
  const activeLayerLocked = Boolean(
    activeLayerId && lockedLayerIds.has(activeLayerId),
  );
  const activeLayerHidden = Boolean(
    activeLayerId && hiddenLayerIds.has(activeLayerId),
  );

  const handleLayerSelectionChange = useCallback(
    (ids: string[]) => {
      const selectedId = ids[ids.length - 1];
      if (!selectedId) {
        setSelectedElement(null);
        return;
      }
      if (selectedId.startsWith("element:")) return;
      const fileId = selectedId.startsWith("code:")
        ? selectedId.slice("code:".length)
        : selectedId;
      if (files.some((file) => file.id === fileId)) {
        setActiveFileId(fileId);
        setSelectedElement(null);
        setActiveTool("move");
        setMode("edit");
        setViewMode("single");
      }
    },
    [files],
  );

  const handleLayerRename = useCallback(
    (layerId: string, name: string) => {
      if (!files.some((file) => file.id === layerId)) return;
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
    },
    [files, queryClient, t, updateFileMutation],
  );

  const handleToggleLayerLocked = useCallback(
    (layerId: string, locked: boolean) => {
      setLockedLayerIds((current) => {
        const next = new Set(current);
        if (locked) next.add(layerId);
        else next.delete(layerId);
        return next;
      });
    },
    [],
  );

  const handleToggleLayerHidden = useCallback(
    (layerId: string, hidden: boolean) => {
      setHiddenLayerIds((current) => {
        const next = new Set(current);
        if (hidden) next.add(layerId);
        else next.delete(layerId);
        return next;
      });
    },
    [],
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

  const viewportTabs: ViewportTab[] = files.map((f) => ({
    id: f.id,
    filename: f.filename,
  }));
  const hideEmbeddedVariantToolbar = embedded && !!pendingVariants;

  return (
    // h-full not flex-1: the parent <main> uses overflow-y-auto, not flex,
    // so flex-1 on the child doesn't resolve to the available height. h-full
    // works because main itself has a definite height (flex-1 inside a
    // flex-col page shell). Without this the canvas collapses to ~150px.
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <header
        className={cn(
          "shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          embedded ? "h-10" : "h-12",
          hideEmbeddedVariantToolbar && "hidden",
        )}
      >
        <div className="flex h-full min-w-max w-full items-center gap-2 px-3">
          {openMobileSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 cursor-pointer md:hidden"
              onClick={openMobileSidebar}
              aria-label={t("navigation.openNavigation")}
            >
              <IconMenu2 className="w-4 h-4" />
            </Button>
          )}
          <Link
            to="/"
            className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground/90"
          >
            <IconArrowLeft className="w-4 h-4" />
          </Link>
          {titleEditing ? (
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
              className="h-7 w-40 text-sm sm:w-[240px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTitleDraft(design.title);
                setTitleEditing(true);
              }}
              title={t("designEditor.clickToRename")}
              className="max-w-[38vw] cursor-text truncate rounded px-1 -mx-1 text-left text-sm font-medium text-foreground/90 hover:bg-accent/50 sm:max-w-[240px]"
            >
              {design.title}
            </button>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
            {!embedded && (
              <>
                {/* Mode switcher */}
                <Tabs
                  value={mode}
                  onValueChange={(v) => handleModeChange(v as EditorMode)}
                >
                  <TabsList className="h-8">
                    <TabsTrigger
                      value="comment"
                      className="h-6 px-2 text-xs gap-1"
                      onClick={handleCommentTabClick}
                    >
                      <IconMessage className="w-3 h-3" />
                      {t("designEditor.modes.comment")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="edit"
                      className="h-6 px-2 text-xs gap-1"
                    >
                      <IconPencil className="w-3 h-3" />
                      {t("designEditor.modes.edit")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="draw"
                      className="h-6 px-2 text-xs gap-1"
                      disabled={!activeFile || viewMode === "overview"}
                    >
                      <IconBrush className="w-3 h-3" />
                      {t("designEditor.modes.draw")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {/* Undo / redo */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={handleUndo}
                      disabled={!canUndo}
                      aria-label={t("designEditor.undo")}
                    >
                      <IconArrowBackUp className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("designEditor.undoShortcut")}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={handleRedo}
                      disabled={!canRedo}
                      aria-label={t("designEditor.redo")}
                    >
                      <IconArrowForwardUp className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("designEditor.redoShortcut")}
                  </TooltipContent>
                </Tooltip>

                <div className="w-px h-5 bg-accent mx-1" />
              </>
            )}

            {/* Overview / single-screen toggle. Clicking Overview shows every
              file in the design as a Figma-style pannable lineup. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "overview" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={handleViewModeToggle}
                  aria-label={
                    viewMode === "overview"
                      ? t("designEditor.returnToCurrentScreen")
                      : t("designEditor.openScreenOverview")
                  }
                >
                  <IconLayoutGrid className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "overview"
                  ? t("designEditor.currentScreen")
                  : t("designEditor.screenOverview")}
              </TooltipContent>
            </Tooltip>

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
              <ShareButton
                resourceType="design"
                resourceId={id}
                resourceTitle={design.title}
              />
            )}

            {/* More: comment pin + export (progressive disclosure). */}
            {!embedded && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative h-7 w-7 cursor-pointer"
                      >
                        <IconDotsVertical className="w-3.5 h-3.5" />
                        {pinMode && (
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("designEditor.more")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={handlePinToolToggle}
                    disabled={!activeFile || viewMode === "overview"}
                  >
                    <IconPin className="mr-2 h-4 w-4" />
                    {pinMode
                      ? t("designEditor.stopPinningComments")
                      : t("designEditor.pinComment")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {t("designEditor.export")}
                  </DropdownMenuLabel>
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
                  <DropdownMenuItem
                    onClick={handleCopyCodingHandoff}
                    disabled={
                      !activeFile || createCodingHandoffMutation.isPending
                    }
                  >
                    <IconCode className="mr-2 h-4 w-4" />
                    {t("designEditor.copyCodingHandoff")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {!embedded && (
              <>
                <PresenceBar
                  activeUsers={activeUsers}
                  agentActive={agentActive}
                  currentUserEmail={session?.email}
                  onAvatarClick={handleAvatarClick}
                  followingEmail={followingEmail}
                />
                <NotificationsBell />
                <AgentToggleButton />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Viewport tabs. Filenames map to friendly screen names — designers
          shouldn't see "mobile.html" in the chrome of their canvas. The
          full filename is still the title attribute for power users + a11y. */}
      {viewportTabs.length > 1 && (
        <div className="h-8 shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex h-full min-w-max items-center gap-1 px-3">
            {viewportTabs.map((tab) => (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveFileId(tab.id)}
                    className={`shrink-0 cursor-pointer rounded px-2.5 py-1 text-xs ${
                      tab.id === activeFileId
                        ? "bg-accent text-foreground/90"
                        : "text-muted-foreground hover:text-muted-foreground"
                    }`}
                  >
                    {prettyScreenName(tab.filename)}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{tab.filename}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {/* Main canvas area */}
      <div className="flex-1 flex overflow-hidden relative">
        {!embedded && !pendingVariants ? (
          <div className="hidden w-64 shrink-0 lg:block">
            <LayersPanel
              files={layerPanelFiles}
              codeLayers={codeLayerNodes}
              selectedIds={selectedLayerIds}
              expandedIds={expandedLayerIds}
              searchQuery={layersSearchQuery}
              onSearchQueryChange={setLayersSearchQuery}
              onExpandedIdsChange={setExpandedLayerIds}
              onSelectionChange={handleLayerSelectionChange}
              onRename={handleLayerRename}
              onToggleLocked={handleToggleLayerLocked}
              onToggleHidden={handleToggleLayerHidden}
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

        {!embedded &&
          activeFile &&
          !pendingVariants &&
          !(pendingQuestions && pendingQuestions.length > 0) && (
            <FigmaToolRail
              mode={mode}
              pinMode={pinMode}
              drawMode={drawMode}
              overviewActive={viewMode === "overview"}
              activeTool={activeTool}
              onMove={handleMoveTool}
              onFrame={handleFrameTool}
              onRect={handleRectTool}
              onText={handleTextTool}
              onPen={handlePenTool}
              onHand={handleHandTool}
              onDraw={handleDrawTool}
              onScale={handleScaleTool}
              onCommentPin={handlePinToolToggle}
              onOverviewToggle={handleViewModeToggle}
            />
          )}

        {/* Canvas */}
        {!pendingVariants && (
          <CanvasContextMenu
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
              setActiveTool("overview");
              setZoom(100);
            }}
            onZoomToSelection={() => setZoom(150)}
            onCopy={handleCopySelection}
            onPaste={() => handlePasteSelection()}
            onPasteOver={() => handlePasteSelection()}
            onDuplicate={() => {
              if (activeFile) handleDuplicateScreen(activeFile.id);
            }}
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
                className="relative h-full min-w-0 flex-1 overflow-hidden"
                onPointerMove={handleCanvasPointerMove}
              >
                {viewMode === "overview" ? (
                  <MultiScreenCanvas
                    screens={overviewScreens}
                    zoom={zoom}
                    onZoomChange={setZoom}
                    activeId={activeFileId}
                    selectAllRequest={overviewSelectAllRequest}
                    geometryById={canvasFrameGeometryById}
                    onGeometryChange={queueFrameGeometrySave}
                    onPick={(id) => {
                      setActiveFileId(id);
                      setActiveTool("move");
                      setMode("edit");
                      setViewMode("single");
                    }}
                    onDuplicate={handleDuplicateScreen}
                  />
                ) : (
                  <>
                    <DesignCanvas
                      content={activeContent}
                      zoom={zoom}
                      onZoomChange={setZoom}
                      deviceFrame={deviceFrame}
                      editMode={mode === "edit"}
                      onElementSelect={handleElementSelect}
                      onElementHover={handleElementHover}
                      onVisualStyleChange={handleVisualStyleChange}
                      tweakValues={cssVarValues}
                      drawMode={drawMode}
                      onExitDrawMode={() => {
                        setDrawMode(false);
                        setMode("comment");
                      }}
                      pinMode={pinMode}
                      onExitPinMode={() => setPinMode(false)}
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

        {!pendingVariants && activeFile && viewMode === "single" && (
          <>
            {patchProof ? (
              <PatchProofCard
                proof={patchProof}
                onRollback={handleRollbackPatch}
                onDismiss={() => setPatchProof(null)}
              />
            ) : null}
          </>
        )}

        {!pendingVariants && activeFile && viewMode === "single" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={tweaksVisible ? "secondary" : "outline"}
                size="icon"
                className="absolute bottom-4 right-4 z-[70] size-9 cursor-pointer rounded-full bg-background/95 shadow-lg backdrop-blur"
                onClick={() => setTweaksVisible((visible) => !visible)}
                aria-label={
                  tweaksVisible
                    ? t("designEditor.hideTweaks")
                    : t("designEditor.showTweaks")
                }
              >
                <IconAdjustmentsHorizontal className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {t("designEditor.tweaks")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Edit panel (right side) */}
        {mode === "edit" && (
          <EditPanel
            selectedElement={selectedElement}
            pageStyles={pageStyles}
            onStyleChange={handleStyleChange}
            onExport={handleInspectorExport}
            exporting={svgExporting}
          />
        )}

        {/* Tweaks panel (floating, draggable). Renders agent-defined knobs
            (color swatches, segments, sliders, toggles) bound to CSS custom
            properties in the design. Empty state when the design has no
            tweak definitions. */}
        {tweaksVisible && (
          <TweaksPanel
            tweaks={tweaks}
            values={tweakSelections}
            onChange={(tweakId, value) =>
              setTweakSelections((prev) => {
                const next = { ...prev, [tweakId]: value };
                queueTweakSave(next);
                return next;
              })
            }
            onClose={() => setTweaksVisible(false)}
            onRequestTweaks={handleRequestTweaks}
            visible
          />
        )}
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
