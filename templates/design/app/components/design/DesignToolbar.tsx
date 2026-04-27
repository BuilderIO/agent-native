import { useState } from "react";
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
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ShareButton } from "@agent-native/core/client";
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
}

const MODE_ITEMS: {
  mode: EditorMode;
  icon: typeof IconMessage;
  label: string;
}[] = [
  { mode: "comment", icon: IconMessage, label: "Comment" },
  { mode: "edit", icon: IconPointer, label: "Edit" },
  { mode: "draw", icon: IconPencil, label: "Draw" },
];

const EXPORT_FORMATS = [
  { value: "zip", label: "Download ZIP" },
  { value: "pdf", label: "Export PDF" },
  { value: "html", label: "Export HTML" },
  { value: "handoff", label: "Handoff to Claude Code" },
  { value: "copy-prompt", label: "Copy prompt" },
];

const PRESENT_MODES = [
  { value: "tab", label: "In this tab" },
  { value: "fullscreen", label: "Fullscreen" },
  { value: "new-tab", label: "New tab" },
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
}: DesignToolbarProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);

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

      {/* Tweaks toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8", tweaksVisible && "bg-muted text-foreground")}
        onClick={onTweaksToggle}
      >
        <IconAdjustments className="h-4 w-4" />
      </Button>

      {/* Mode switcher */}
      <div className="flex overflow-hidden rounded-md border border-border">
        {MODE_ITEMS.map(({ mode: m, icon: Icon, label }) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            title={label}
            className={cn(
              "cursor-pointer px-2 py-1.5",
              mode === m
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
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
        <span className="min-w-[3rem] text-center text-xs text-muted-foreground">
          {zoom}%
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
              {pm.label}
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
              {fmt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
