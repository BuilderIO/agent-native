import { ShareButton, useT } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconAdjustments,
  IconMessage,
  IconPointer,
  IconPencil,
  IconPresentation,
  IconDownload,
  IconMinus,
  IconPlus,
  IconPencilPlus,
  IconPin,
  IconWand,
} from "@tabler/icons-react";
import { useState } from "react";

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
  /** Whether draw-on-canvas mode is active. */
  drawMode?: boolean;
  /** Toggle draw-on-canvas mode. */
  onToggleDrawMode?: () => void;
  /** Whether comment-pin drop mode is active. */
  pinMode?: boolean;
  /** Toggle comment-pin drop mode. */
  onTogglePinMode?: () => void;
}

const MODE_ITEMS: {
  mode: EditorMode;
  icon: typeof IconMessage;
  labelKey: string;
}[] = [
  {
    mode: "comment",
    icon: IconMessage,
    labelKey: "designEditor.modes.comment",
  },
  { mode: "edit", icon: IconPointer, labelKey: "designEditor.modes.edit" },
  { mode: "draw", icon: IconPencil, labelKey: "designEditor.modes.draw" },
];

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

export function DesignToolbar({
  title,
  onTitleChange,
  mode,
  onModeChange,
  tweaksVisible,
  onTweaksToggle,
  zoom,
  onZoomChange,
  onExport,
  onPresent,
  onBack,
  designId,
  tabs,
  activeTabId,
  onTabChange,
  drawMode,
  onToggleDrawMode,
  pinMode,
  onTogglePinMode,
}: DesignToolbarProps) {
  const t = useT();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const zoomLabel = `${Math.round(zoom)}%`;

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft !== title) {
      onTitleChange(titleDraft.trim());
    } else {
      setTitleDraft(title);
    }
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
      {/* Back */}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
        <IconArrowLeft className="h-4 w-4" />
      </Button>

      {/* Title */}
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
          className="h-7 w-48 text-sm"
          autoFocus
        />
      ) : (
        <button
          onClick={() => {
            setTitleDraft(title);
            setEditingTitle(true);
          }}
          className="cursor-pointer rounded px-2 py-1 text-sm font-medium text-foreground hover:bg-muted"
        >
          {title}
        </button>
      )}

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* File tabs */}
      {tabs && tabs.length > 0 && (
        <>
          <div className="flex gap-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={cn(
                  "cursor-pointer rounded px-2.5 py-1 text-xs",
                  activeTabId === tab.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {tab.filename}
              </button>
            ))}
          </div>
          <Separator orientation="vertical" className="mx-1 h-5" />
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Tools — Tweaks / Draw / Pin consolidated so the bar isn't a wall of icons.
          The dot indicator lights up when any of the modes is active. */}
      {(() => {
        const anyToolActive = Boolean(tweaksVisible || drawMode || pinMode);
        return (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "relative h-8 w-8",
                      anyToolActive && "bg-muted text-foreground",
                    )}
                    aria-label={t("designEditor.designTools")}
                  >
                    <IconWand className="h-4 w-4" />
                    {anyToolActive && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("designEditor.designTools")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={onTweaksToggle}
                className={cn(tweaksVisible && "bg-accent/50")}
              >
                <IconAdjustments className="h-4 w-4 mr-2" />
                {t("designEditor.tweaks")}
              </DropdownMenuItem>
              {onToggleDrawMode && (
                <DropdownMenuItem
                  data-toolbar-draw-button
                  onClick={onToggleDrawMode}
                  className={cn(drawMode && "bg-accent/50")}
                >
                  <IconPencilPlus className="h-4 w-4 mr-2" />
                  {t("designEditor.drawOnCanvas")}
                </DropdownMenuItem>
              )}
              {onTogglePinMode && (
                <DropdownMenuItem
                  data-toolbar-pin-button
                  onClick={onTogglePinMode}
                  className={cn(pinMode && "bg-accent/50")}
                >
                  <IconPin className="h-4 w-4 mr-2" />
                  {t("designEditor.dropCommentPin")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })()}

      {/* Mode switcher */}
      <div className="flex overflow-hidden rounded-md border border-border">
        {MODE_ITEMS.map(({ mode: m, icon: Icon, labelKey }) => (
          <Tooltip key={m}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onModeChange(m)}
                className={cn(
                  "cursor-pointer px-2 py-1.5",
                  mode === m
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t(labelKey)}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onZoomChange(Math.max(25, zoom - 25))}
        >
          <IconMinus className="h-3 w-3" />
        </Button>
        <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
          {zoomLabel}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onZoomChange(Math.min(400, zoom + 25))}
        >
          <IconPlus className="h-3 w-3" />
        </Button>
      </div>

      {/* Present */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <IconPresentation className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
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

      {/* Share */}
      <ShareButton resourceType="design" resourceId={designId} />

      {/* Export */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <IconDownload className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
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
  );
}
