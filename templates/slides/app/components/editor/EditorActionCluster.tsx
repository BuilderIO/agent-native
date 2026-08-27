import { useT } from "@agent-native/core/client/i18n";
import {
  IconCircle,
  IconPlus,
  IconShape2,
  IconSquare,
  IconTextSize,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const BUTTON_CLASS =
  "inline-flex size-7 flex-shrink-0 items-center justify-center rounded-md transition-colors";
const IDLE_CLASS =
  "text-muted-foreground hover:bg-accent hover:text-foreground/70";
const ACTIVE_CLASS = "bg-accent text-foreground";
const DIVIDER_CLASS = "mx-1 h-4 w-px shrink-0 bg-border";

export type SlideShapeType = "rectangle" | "circle";

const SHAPES = [
  {
    value: "rectangle" as const,
    labelKey: "editorToolbar.shapeRectangle",
    icon: IconSquare,
  },
  {
    value: "circle" as const,
    labelKey: "editorToolbar.shapeCircle",
    icon: IconCircle,
  },
];

/**
 * Selection-independent actions pinned to the head of the contextual
 * toolbar: add-slide, add-text-box, and the shape picker.
 * Rendered both as the `leading` slot of the element-controls row and as a
 * fallback directly in the deck toolbar for when that row is hidden (narrow
 * viewports) or never mounts (no current slide, e.g. an empty deck).
 */
export function EditorActionCluster({
  textBoxMode,
  onToggleTextBoxMode,
  onAddEmptySlide,
  addSlideGenerating,
  shapeType,
  onSelectShape,
  className,
}: {
  textBoxMode?: boolean;
  onToggleTextBoxMode?: () => void;
  onAddEmptySlide?: () => void;
  addSlideGenerating?: boolean;
  shapeType?: SlideShapeType | null;
  onSelectShape?: (shape: SlideShapeType) => void;
  className?: string;
}) {
  const t = useT();
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  if (!onToggleTextBoxMode && !onAddEmptySlide && !onSelectShape) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {onAddEmptySlide && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onAddEmptySlide}
            disabled={addSlideGenerating}
          >
            <IconPlus className="size-3.5" />
            {t("editorSidebar.newSlide")}
          </Button>
          {onToggleTextBoxMode && <div className={DIVIDER_CLASS} />}
        </>
      )}
      {onToggleTextBoxMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleTextBoxMode}
              data-toolbar-textbox-button
              aria-label={t("editorToolbar.addTextBox")}
              aria-pressed={textBoxMode}
              aria-keyshortcuts="T"
              className={cn(
                BUTTON_CLASS,
                textBoxMode ? ACTIVE_CLASS : IDLE_CLASS,
              )}
            >
              <IconTextSize className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("editorToolbar.addTextBox")} (T)</TooltipContent>
        </Tooltip>
      )}
      {onSelectShape && (
        <>
          {onToggleTextBoxMode && <div className={DIVIDER_CLASS} />}
          <Popover open={shapeMenuOpen} onOpenChange={setShapeMenuOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("editorToolbar.shapes")}
                    aria-expanded={shapeMenuOpen}
                    className={cn(
                      BUTTON_CLASS,
                      shapeMenuOpen || shapeType ? ACTIVE_CLASS : IDLE_CLASS,
                    )}
                  >
                    <IconShape2 className="size-4" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("editorToolbar.shapes")}</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="w-44 p-1.5">
              <div className="grid grid-cols-2 gap-1" role="menu">
                {SHAPES.map(({ value, labelKey, icon: ShapeIcon }) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitem"
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      shapeType === value && "bg-accent text-foreground",
                    )}
                    onClick={() => {
                      onSelectShape(value);
                      setShapeMenuOpen(false);
                    }}
                  >
                    <ShapeIcon className="size-5" />
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
