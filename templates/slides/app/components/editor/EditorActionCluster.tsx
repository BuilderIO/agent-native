import { useT } from "@agent-native/core/client/i18n";
import { IconPlus, IconTextSize } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
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

/**
 * Selection-independent actions pinned to the head of the contextual
 * toolbar: add-slide and add-text-box. Rendered both as the `leading` slot
 * of the element-controls row and as a fallback directly in the deck
 * toolbar for when that row is hidden (narrow viewports) or never mounts
 * (no current slide, e.g. an empty deck).
 */
export function EditorActionCluster({
  textBoxMode,
  onToggleTextBoxMode,
  onAddEmptySlide,
  addSlideGenerating,
  className,
}: {
  textBoxMode?: boolean;
  onToggleTextBoxMode?: () => void;
  onAddEmptySlide?: () => void;
  addSlideGenerating?: boolean;
  className?: string;
}) {
  const t = useT();

  if (!onToggleTextBoxMode && !onAddEmptySlide) return null;

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
    </div>
  );
}
