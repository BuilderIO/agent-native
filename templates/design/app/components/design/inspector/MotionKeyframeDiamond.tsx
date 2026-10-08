import { useT } from "@agent-native/core/client/i18n";
import { IconDiamond, IconDiamondFilled } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type MotionKeyframeCssProperty =
  | "translate"
  | "scale"
  | "rotate"
  | "opacity"
  | "border-radius"
  | "background-color"
  | "border-color"
  | "border-width"
  | "box-shadow";

export interface MotionKeyframeDiamondProps {
  cssProperty: MotionKeyframeCssProperty;
  hasKeyframe: boolean;
  onToggle: () => void;
  className?: string;
}

export function MotionKeyframeDiamond({
  cssProperty,
  hasKeyframe,
  onToggle,
  className,
}: MotionKeyframeDiamondProps) {
  const t = useT();
  const label = hasKeyframe
    ? t("editPanel.motionKeyframe.removeTooltip")
    : t("editPanel.motionKeyframe.addTooltip");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={hasKeyframe}
          aria-label={label}
          data-motion-css-property={cssProperty}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/50 transition-colors",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
            hasKeyframe &&
              "text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
            className,
          )}
        >
          {hasKeyframe ? (
            <IconDiamondFilled className="size-2.5 shrink-0" />
          ) : (
            <IconDiamond className="size-2.5 shrink-0" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function motionPropertyHasKeyframe(
  keyframedProperties: readonly string[] | undefined,
  cssProperty: MotionKeyframeCssProperty,
): boolean {
  return keyframedProperties?.includes(cssProperty) ?? false;
}
