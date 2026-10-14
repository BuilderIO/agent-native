import { useT } from "@agent-native/core/client/i18n";
import { IconPlayerPlay, IconTransitionRight } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";

import {
  SLIDE_TRANSITION_SPEED,
  SLIDE_TRANSITION_TYPES,
  clampTransitionSpeed,
  isSlideTransitionType,
  normalizeSlideTransition,
  transitionDurationMs,
  type SlideTransitionType,
} from "../../../shared/slide-transitions";

export type SlideTransitionPatch = {
  transition?: SlideTransitionType;
  transitionSpeed?: number;
};

export const SLIDE_TRANSITION_LABEL_KEYS = {
  none: "editorToolbar.transition_none",
  dissolve: "editorToolbar.transition_dissolve",
  fade: "editorToolbar.transition_fade",
  "slide-from-right": "editorToolbar.transition_slide_from_right",
  "slide-from-left": "editorToolbar.transition_slide_from_left",
  flip: "editorToolbar.transition_flip",
  cube: "editorToolbar.transition_cube",
  gallery: "editorToolbar.transition_gallery",
} as const satisfies Record<SlideTransitionType, string>;

export function SlideTransitionControl({
  currentSlide,
  currentSlideIndex,
  canEdit,
  onChange,
  onApplyToAll,
  onPlay,
}: {
  currentSlide?: Slide;
  currentSlideIndex: number;
  canEdit: boolean;
  onChange: (patch: SlideTransitionPatch) => void;
  onApplyToAll: (patch: SlideTransitionPatch) => void;
  onPlay?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // The slider previews the dragged value locally and writes once on release,
  // so a drag is one save rather than one save per step.
  const [draftSpeed, setDraftSpeed] = useState<number | null>(null);

  const editable = canEdit && currentSlide !== undefined;
  const transition = normalizeSlideTransition(currentSlide?.transition);
  const persistedSpeed = clampTransitionSpeed(currentSlide?.transitionSpeed);
  const speed = draftSpeed ?? persistedSpeed;

  const commitSpeed = (value: number) => {
    setDraftSpeed(null);
    if (value !== persistedSpeed) onChange({ transitionSpeed: value });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("editorToolbar.transition_panel")}
              className="inline-flex size-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/70"
            >
              <IconTransitionRight className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("editorToolbar.transition_panel")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 space-y-4 p-3">
        <Select
          value={transition}
          disabled={!editable}
          onValueChange={(value) => {
            if (isSlideTransitionType(value)) onChange({ transition: value });
          }}
        >
          <SelectTrigger
            aria-label={t("editorToolbar.transition")}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLIDE_TRANSITION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(SLIDE_TRANSITION_LABEL_KEYS[type])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div
          role="group"
          aria-label={t("editorToolbar.transition_speed")}
          className="space-y-2"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("editorToolbar.transition_speed")}</span>
            <span className="tabular-nums">
              {t("editorToolbar.transition_seconds", {
                seconds: (transitionDurationMs(speed) / 1000).toFixed(1),
              })}
            </span>
          </div>
          <Slider
            min={SLIDE_TRANSITION_SPEED.min}
            max={SLIDE_TRANSITION_SPEED.max}
            step={1}
            value={[speed]}
            disabled={!editable}
            onValueChange={([value]) => setDraftSpeed(value)}
            onValueCommit={([value]) => commitSpeed(value)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("editorToolbar.transition_slow")}</span>
            <span>{t("editorToolbar.transition_fast")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 w-full whitespace-normal"
            disabled={!editable}
            onClick={() => onApplyToAll({ transition, transitionSpeed: speed })}
          >
            <span className="min-w-0 text-center">
              {t("editorToolbar.transition_apply_all")}
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-auto min-h-8 w-full whitespace-normal"
            disabled={!onPlay || currentSlideIndex <= 0}
            onClick={() => {
              setOpen(false);
              onPlay?.();
            }}
          >
            <IconPlayerPlay className="size-3.5" />
            <span className="min-w-0 text-center">
              {t("editorToolbar.transition_play")}
            </span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
