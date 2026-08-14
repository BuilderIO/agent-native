import { useT } from "@agent-native/core/client/i18n";
import {
  IconPlus,
  IconTextSize,
  IconTransitionRight,
} from "@tabler/icons-react";

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
import type { Slide } from "@/context/DeckContext";
import { cn } from "@/lib/utils";

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
 * Selection-independent actions pinned to the head of the contextual
 * toolbar: add-slide, add-text-box, and the slide transition picker.
 * Rendered both as the `leading` slot of the element-controls row and as a
 * fallback directly in the deck toolbar for when that row is hidden (narrow
 * viewports) or never mounts (no current slide, e.g. an empty deck).
 */
export function EditorActionCluster({
  textBoxMode,
  onToggleTextBoxMode,
  onAddEmptySlide,
  addSlideGenerating,
  currentSlideId,
  slideTransition,
  onChangeSlideTransition,
  className,
}: {
  textBoxMode?: boolean;
  onToggleTextBoxMode?: () => void;
  onAddEmptySlide?: () => void;
  addSlideGenerating?: boolean;
  currentSlideId?: string;
  slideTransition?: Slide["transition"];
  onChangeSlideTransition?: (transition: SlideTransition) => void;
  className?: string;
}) {
  const t = useT();
  // "none" is a legacy alias the presentation view already treats as instant.
  const activeTransition: SlideTransition =
    !slideTransition || slideTransition === "none"
      ? "instant"
      : slideTransition;

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
