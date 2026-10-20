import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowBigRight,
  IconChevronDown,
  IconCircle,
  IconLine,
  IconPhoto,
  IconPlus,
  IconPolygon,
  IconShape,
  IconSquare,
  IconStar,
  IconTextSize,
  IconTriangle,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { preloadAddSlidePopover } from "@/lib/deferred-editor-surfaces";
import { cn } from "@/lib/utils";

const BUTTON_CLASS =
  "inline-flex h-8 flex-shrink-0 items-center justify-center gap-0.5 rounded-md px-2 transition-colors";
const IDLE_CLASS =
  "text-muted-foreground hover:bg-accent hover:text-foreground/70";
const ACTIVE_CLASS = "bg-accent text-foreground";
const DIVIDER_CLASS = "mx-1 h-4 w-px shrink-0 bg-border";

export type SlideShapeType =
  | "line"
  | "arrow"
  | "rectangle"
  | "circle"
  | "triangle"
  | "star"
  | "polygon";

export const SLIDE_SHAPE_LABEL_KEYS = {
  rectangle: "editorToolbar.shapeRectangle",
  circle: "editorToolbar.shapeCircle",
  arrow: "editorToolbar.shapeArrow",
  triangle: "editorToolbar.shapeTriangle",
  line: "editorToolbar.shapeLine",
  star: "editorToolbar.shapeStar",
  polygon: "editorToolbar.shapePolygon",
} as const;

const SHAPES = [
  { value: "line" as const, icon: IconLine },
  { value: "arrow" as const, icon: IconArrowBigRight },
  { value: "rectangle" as const, icon: IconSquare },
  { value: "circle" as const, icon: IconCircle },
  { value: "triangle" as const, icon: IconTriangle },
  { value: "star" as const, icon: IconStar },
  { value: "polygon" as const, icon: IconPolygon },
].map((shape) => ({
  ...shape,
  labelKey: SLIDE_SHAPE_LABEL_KEYS[shape.value],
}));

export function EditorActionCluster({
  textBoxMode,
  onToggleTextBoxMode,
  onInsertMedia,
  onAddEmptySlide,
  addSlideGenerating,
  shapeType,
  onSelectShape,
  className,
}: {
  textBoxMode?: boolean;
  onToggleTextBoxMode?: () => void;
  /** With this, the text tool becomes an insert menu (text, image/video). */
  onInsertMedia?: () => void;
  onAddEmptySlide?: () => void;
  addSlideGenerating?: boolean;
  shapeType?: SlideShapeType | null;
  onSelectShape?: (shape: SlideShapeType) => void;
  className?: string;
}) {
  const t = useT();
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
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
            onPointerEnter={preloadAddSlidePopover}
            onFocus={preloadAddSlidePopover}
            onClick={() => {
              preloadAddSlidePopover();
              onAddEmptySlide();
            }}
            disabled={addSlideGenerating}
          >
            <IconPlus className="size-3.5" />
            {t("editorSidebar.newSlide")}
          </Button>
          {onToggleTextBoxMode && <div className={DIVIDER_CLASS} />}
        </>
      )}
      {onToggleTextBoxMode && onInsertMedia && (
        <DropdownMenu open={insertMenuOpen} onOpenChange={setInsertMenuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-toolbar-textbox-button
                  aria-label={t("contextToolbar.insert")}
                  aria-pressed={textBoxMode}
                  aria-keyshortcuts="T"
                  className={cn(
                    BUTTON_CLASS,
                    insertMenuOpen || textBoxMode ? ACTIVE_CLASS : IDLE_CLASS,
                  )}
                >
                  <IconTextSize className="size-4" />
                  <IconChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("contextToolbar.insert")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem
              aria-keyshortcuts="T"
              onSelect={onToggleTextBoxMode}
            >
              <IconTextSize className="size-4" />
              {t("contextToolbar.insertText")}
              <span className="ml-auto text-xs text-muted-foreground">T</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onInsertMedia}>
              <IconPhoto className="size-4" />
              {t("contextToolbar.insertMedia")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {onToggleTextBoxMode && !onInsertMedia && (
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
        <DropdownMenu open={shapeMenuOpen} onOpenChange={setShapeMenuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("editorToolbar.shapes")}
                  className={cn(
                    BUTTON_CLASS,
                    shapeMenuOpen || shapeType ? ACTIVE_CLASS : IDLE_CLASS,
                  )}
                >
                  <IconShape className="size-4" />
                  <IconChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("editorToolbar.shapes")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-40">
            {SHAPES.map(({ value, labelKey, icon: ShapeIcon }) => (
              <DropdownMenuItem
                key={value}
                className={cn(shapeType === value && "bg-accent")}
                onSelect={() => onSelectShape(value)}
              >
                <ShapeIcon className="size-4" aria-hidden="true" />
                {t(labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
