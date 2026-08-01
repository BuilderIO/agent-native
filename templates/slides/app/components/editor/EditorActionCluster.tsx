import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconLetterT,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDecks } from "@/context/DeckContext";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { cn, shortcutLabel } from "@/lib/utils";

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
  const { undo, redo, canUndo, canRedo } = useDecks();
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const [addSlideOpen, setAddSlideOpen] = useState(false);
  const addSlideRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!generating) onAddSlideGeneratingChange?.(false);
  }, [generating, onAddSlideGeneratingChange]);

  // The Cmd+Z handler deliberately ignores typing so the text editor keeps its
  // own history (DeckContext). A button has no such escape hatch, so commit the
  // in-progress edit first — otherwise the click would undo the previous deck
  // op and silently discard what the user just typed.
  const commitThenRun = (run: () => void) => {
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA")
    ) {
      active.blur();
      requestAnimationFrame(run);
      return;
    }
    run();
  };

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

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => commitThenRun(undo)}
            disabled={!canUndo}
            className={cn(BUTTON_CLASS, IDLE_CLASS, "disabled:opacity-40")}
            aria-label={t("editorToolbar.undo")}
            aria-keyshortcuts="Meta+Z Control+Z"
          >
            <IconArrowBackUp className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {t("editorToolbar.undoWithShortcut", {
            shortcut: shortcutLabel("Cmd+Z"),
          })}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => commitThenRun(redo)}
            disabled={!canRedo}
            className={cn(BUTTON_CLASS, IDLE_CLASS, "disabled:opacity-40")}
            aria-label={t("editorToolbar.redo")}
            aria-keyshortcuts="Shift+Meta+Z Control+Y"
          >
            <IconArrowForwardUp className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {t("editorToolbar.redoWithShortcut", {
            shortcut: shortcutLabel("Cmd+Shift+Z"),
          })}
        </TooltipContent>
      </Tooltip>

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
                <IconLetterT className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editorToolbar.addTextBox")} (T)</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
