import { ShareButton, useT } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconBrush,
  IconDownload,
  IconLayoutGrid,
  IconMessage,
  IconMinus,
  IconPin,
  IconPlus,
  IconPointer,
  IconPresentation,
  IconTypography,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ViewportTab } from "./types";

export type EditorMode = "comment" | "edit" | "draw";

interface DesignToolbarProps {
  title: string;
  designId: string;
  onTitleChange: (title: string) => void;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  tweaksVisible: boolean;
  onTweaksToggle: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onExport: (format: string) => void;
  onPresent: (mode: string) => void;
  onBack: () => void;
  tabs?: ViewportTab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  onFrameTool?: () => void;
  onTextTool?: () => void;
  /** Whether draw-on-canvas mode is active. */
  drawMode?: boolean;
  /** Toggle draw-on-canvas mode. */
  onToggleDrawMode?: () => void;
  /** Whether comment-pin drop mode is active. */
  pinMode?: boolean;
  /** Toggle comment-pin drop mode. */
  onTogglePinMode?: () => void;
}

const EXPORT_FORMATS = [
  { value: "zip", labelKey: "designEditor.downloadZip" },
  { value: "svg", labelKey: "designEditor.downloadSvg" },
  { value: "pdf", labelKey: "designEditor.exportPdf" },
  { value: "html", labelKey: "designEditor.exportHtml" },
  { value: "coding-handoff", labelKey: "designEditor.copyCodingHandoff" },
];

const PRESENT_MODES = [
  { value: "tab", labelKey: "designEditor.presentInThisTab" },
  { value: "fullscreen", labelKey: "designEditor.presentFullscreen" },
  { value: "new-tab", labelKey: "designEditor.presentNewTab" },
];

function ToolbarIconButton({
  label,
  active,
  onClick,
  children,
  dataToolbarDrawButton,
  dataToolbarPinButton,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  dataToolbarDrawButton?: boolean;
  dataToolbarPinButton?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          aria-pressed={Boolean(active)}
          data-toolbar-draw-button={dataToolbarDrawButton || undefined}
          data-toolbar-pin-button={dataToolbarPinButton || undefined}
          className={cn(
            "size-8 cursor-pointer rounded-md text-muted-foreground hover:bg-background hover:text-foreground",
            active && "bg-background text-foreground shadow-sm",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function DesignToolbar({
  title,
  onTitleChange,
  mode,
  onModeChange,
  zoom,
  onZoomChange,
  onExport,
  onPresent,
  onBack,
  designId,
  tabs,
  activeTabId,
  onTabChange,
  onFrameTool,
  onTextTool,
  drawMode,
  onToggleDrawMode,
  pinMode,
  onTogglePinMode,
}: DesignToolbarProps) {
  const t = useT();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [activeDesignTool, setActiveDesignTool] = useState<
    "move" | "frame" | "text" | "comment" | "draw"
  >("move");
  const zoomLabel = `${Math.round(zoom)}%`;

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft !== title) {
      onTitleChange(titleDraft.trim());
    } else {
      setTitleDraft(title);
    }
  };

  const activateMove = () => {
    setActiveDesignTool("move");
    onModeChange("edit");
  };
  const activateFrame = () => {
    setActiveDesignTool("frame");
    onModeChange("edit");
    onFrameTool?.();
  };
  const activateText = () => {
    setActiveDesignTool("text");
    onModeChange("edit");
    onTextTool?.();
  };
  const activateComment = () => {
    setActiveDesignTool("comment");
    if (mode === "comment" && onTogglePinMode) {
      onTogglePinMode();
      return;
    }
    onModeChange("comment");
  };
  const activateDraw = () => {
    setActiveDesignTool("draw");
    if (mode === "draw" && !drawMode && onToggleDrawMode) {
      onToggleDrawMode();
      return;
    }
    onModeChange("draw");
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer"
              onClick={onBack}
              aria-label={t("designEditor.backToDesigns")}
            >
              <IconArrowLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("designEditor.backToDesigns")}</TooltipContent>
        </Tooltip>

        {editingTitle ? (
          <Input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(title);
                setEditingTitle(false);
              }
            }}
            className="h-7 w-44 text-sm"
            autoFocus
          />
        ) : (
          <button
            onClick={() => {
              setTitleDraft(title);
              setEditingTitle(true);
            }}
            title={t("designEditor.clickToRename")}
            className="max-w-48 cursor-text truncate rounded px-1.5 py-1 text-left text-sm font-medium text-foreground hover:bg-muted"
          >
            {title}
          </button>
        )}

        {tabs && tabs.length > 0 ? (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <div
              className="flex min-w-0 items-center gap-0.5 overflow-hidden"
              aria-label={t("designEditor.fileTabs")}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.filename}
                  onClick={() => onTabChange?.(tab.id)}
                  className={cn(
                    "h-8 max-w-32 cursor-pointer truncate border-b-2 border-transparent px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    activeTabId === tab.id && "border-primary text-foreground",
                  )}
                >
                  {tab.filename}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/35 p-0.5">
        <ToolbarIconButton
          label={t("designEditor.tools.move")}
          active={mode === "edit" && activeDesignTool === "move"}
          onClick={activateMove}
        >
          <IconPointer className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={t("designEditor.tools.frame")}
          active={mode === "edit" && activeDesignTool === "frame"}
          onClick={activateFrame}
        >
          <IconLayoutGrid className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={t("designEditor.tools.text")}
          active={mode === "edit" && activeDesignTool === "text"}
          onClick={activateText}
        >
          <IconTypography className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={t("designEditor.modes.comment")}
          active={
            activeDesignTool === "comment" || mode === "comment" || pinMode
          }
          onClick={activateComment}
          dataToolbarPinButton
        >
          {pinMode ? (
            <IconPin className="size-4" />
          ) : (
            <IconMessage className="size-4" />
          )}
        </ToolbarIconButton>
        <ToolbarIconButton
          label={t("designEditor.modes.draw")}
          active={activeDesignTool === "draw" || mode === "draw" || drawMode}
          onClick={activateDraw}
          dataToolbarDrawButton
        >
          <IconBrush className="size-4" />
        </ToolbarIconButton>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/25 p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 cursor-pointer"
                onClick={() => onZoomChange(Math.max(25, zoom - 25))}
                aria-label={t("designEditor.zoomOut")}
              >
                <IconMinus className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("designEditor.zoomOut")}</TooltipContent>
          </Tooltip>
          <span className="min-w-12 px-1 text-center text-xs tabular-nums text-muted-foreground">
            {zoomLabel}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 cursor-pointer"
                onClick={() => onZoomChange(Math.min(400, zoom + 25))}
                aria-label={t("designEditor.zoomIn")}
              >
                <IconPlus className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("designEditor.zoomIn")}</TooltipContent>
          </Tooltip>
        </div>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 cursor-pointer"
                  aria-label={t("designEditor.presentMode")}
                >
                  <IconPresentation className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("designEditor.presentMode")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {PRESENT_MODES.map((pm) => (
              <DropdownMenuItem
                key={pm.value}
                onClick={() => onPresent(pm.value)}
              >
                {t(pm.labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ShareButton resourceType="design" resourceId={designId} />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 cursor-pointer"
                  aria-label={t("designEditor.export")}
                >
                  <IconDownload className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("designEditor.export")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {EXPORT_FORMATS.map((fmt) => (
              <DropdownMenuItem
                key={fmt.value}
                onClick={() => onExport(fmt.value)}
              >
                {t(fmt.labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
