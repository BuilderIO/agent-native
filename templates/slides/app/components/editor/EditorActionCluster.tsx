import { useT } from "@agent-native/core/client/i18n";
import {
  IconLoader2,
  IconPlus,
  IconTextSize,
  IconTransitionRight,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

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
import type { Slide } from "@/context/DeckContext";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { cn } from "@/lib/utils";

import { AddSlidePopover } from "./AddSlidePopover";

const BUTTON_CLASS =
  "inline-flex size-7 flex-shrink-0 items-center justify-center rounded-md transition-colors";
const IDLE_CLASS =
  "text-muted-foreground hover:bg-accent hover:text-foreground/70";
const ACTIVE_CLASS = "bg-accent text-foreground";
const DIVIDER_CLASS = "mx-1 h-4 w-px shrink-0 bg-border";

type SlideTransition = NonNullable<Slide["transition"]>;

const TRANSITIONS: { value: SlideTransition; labelKey: string }[] = [
  { value: "instant", labelKey: "editorToolbar.transition_instant" },
  { value: "fade", labelKey: "editorToolbar.transition_fade" },
  { value: "slide", labelKey: "editorToolbar.transition_slide" },
  { value: "zoom", labelKey: "editorToolbar.transition_zoom" },
];

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
  slideTransition,
  onChangeSlideTransition,
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
  slideTransition?: Slide["transition"];
  onChangeSlideTransition?: (transition: SlideTransition) => void;
  className?: string;
}) {
  const t = useT();
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const [addSlideOpen, setAddSlideOpen] = useState(false);
  const addSlideRef = useRef<HTMLButtonElement>(null);
  // "none" is a legacy alias the presentation view already treats as instant.
  const activeTransition: SlideTransition =
    !slideTransition || slideTransition === "none"
      ? "instant"
      : slideTransition;

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

      {onChangeSlideTransition && currentSlideId && (
        <>
          <div className={DIVIDER_CLASS} />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("editorToolbar.transition")}
                    className={cn(
                      BUTTON_CLASS,
                      activeTransition === "instant"
                        ? IDLE_CLASS
                        : ACTIVE_CLASS,
                    )}
                  >
                    <IconTransitionRight className="size-4" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("editorToolbar.transition")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-40">
              {TRANSITIONS.map((transition) => (
                <DropdownMenuItem
                  key={transition.value}
                  onSelect={() => onChangeSlideTransition(transition.value)}
                  className={
                    activeTransition === transition.value
                      ? "bg-accent text-accent-foreground"
                      : undefined
                  }
                >
                  {t(transition.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
