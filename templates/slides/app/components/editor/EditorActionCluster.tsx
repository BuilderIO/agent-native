import { useT } from "@agent-native/core/client/i18n";
import { IconLoader2, IconPlus, IconTextSize } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { cn } from "@/lib/utils";

import { AddSlidePopover } from "./AddSlidePopover";

const BUTTON_CLASS =
  "inline-flex size-7 flex-shrink-0 items-center justify-center rounded-md transition-colors";
const IDLE_CLASS =
  "text-muted-foreground hover:bg-accent hover:text-foreground/70";
const ACTIVE_CLASS = "bg-accent text-foreground";
const DIVIDER_CLASS = "mx-1 h-4 w-px shrink-0 bg-border";

/**
 * Add slide, undo, redo, and add-text-box — the actions that stay put
 * regardless of what is selected. Rendered at the head of the contextual
 * toolbar, and as a fallback in the deck toolbar where that row is hidden.
 */
export function EditorActionCluster({
  deckId,
  deckTitle,
  currentSlideId,
  slideCount,
  currentSlideIndex,
  addSlideGenerating = false,
  onAddSlideGeneratingChange,
  onAddEmptySlide,
  onDuplicateCurrentSlide,
  textBoxMode,
  onToggleTextBoxMode,
  className,
}: {
  deckId: string;
  deckTitle: string;
  currentSlideId?: string;
  slideCount: number;
  currentSlideIndex: number;
  addSlideGenerating?: boolean;
  onAddSlideGeneratingChange?: (generating: boolean) => void;
  onAddEmptySlide?: () => void;
  onDuplicateCurrentSlide?: () => void;
  textBoxMode?: boolean;
  onToggleTextBoxMode?: () => void;
  className?: string;
}) {
  const t = useT();
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const [addSlideOpen, setAddSlideOpen] = useState(false);
  const addSlideRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!generating) onAddSlideGeneratingChange?.(false);
  }, [generating, onAddSlideGeneratingChange]);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={addSlideRef}
            type="button"
            onClick={() => setAddSlideOpen((open) => !open)}
            disabled={addSlideGenerating}
            className={cn(
              BUTTON_CLASS,
              addSlideOpen ? ACTIVE_CLASS : IDLE_CLASS,
            )}
            aria-label={t("editorSidebar.addSlides")}
          >
            {addSlideGenerating ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconPlus className="size-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("editorSidebar.addSlides")}</TooltipContent>
      </Tooltip>
      <AddSlidePopover
        open={addSlideOpen}
        onOpenChange={setAddSlideOpen}
        anchorRef={addSlideRef}
        deckId={deckId}
        deckTitle={deckTitle}
        activeSlideId={currentSlideId ?? ""}
        slideCount={slideCount}
        activeSlideIndex={currentSlideIndex}
        agentSubmit={(message, context) => {
          onAddSlideGeneratingChange?.(true);
          agentSubmit(message, context);
        }}
        onDuplicateCurrent={onDuplicateCurrentSlide}
        onAddEmpty={onAddEmptySlide}
      />

      {onToggleTextBoxMode && (
        <>
          <div className={DIVIDER_CLASS} />
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
        </>
      )}
    </div>
  );
}
