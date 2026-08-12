import { useT } from "@agent-native/core/client/i18n";
import { IconTextSize } from "@tabler/icons-react";

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

/**
 * Add-text-box — stays put regardless of what is selected. Rendered at the
 * head of the contextual toolbar, and as a fallback in the deck toolbar
 * where that row is hidden. Adding a slide now lives in the slide rail
 * (EditorSidebar), not here.
 */
export function EditorActionCluster({
  textBoxMode,
  onToggleTextBoxMode,
  className,
}: {
  textBoxMode?: boolean;
  onToggleTextBoxMode?: () => void;
  className?: string;
}) {
  const t = useT();

  if (!onToggleTextBoxMode) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
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
    </div>
  );
}
