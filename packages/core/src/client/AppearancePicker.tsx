import { IconCheck } from "@tabler/icons-react";
import {
  APPEARANCE_PRESETS,
  applyAppearance,
  useAppearance,
  type AppearancePresetId,
} from "./appearance.js";
import { cn } from "./utils.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";

export interface AppearancePickerProps {
  className?: string;
  /**
   * Called after a preset is applied (e.g. to persist server-side via
   * the `change-appearance` action so the choice survives across devices).
   */
  onChange?: (preset: AppearancePresetId) => void;
}

export function AppearancePicker({
  className,
  onChange,
}: AppearancePickerProps) {
  const current = useAppearance();
  return (
    <TooltipProvider delayDuration={250}>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className={cn("flex flex-wrap items-center gap-2", className)}
      >
        {APPEARANCE_PRESETS.map((preset) => {
          const active = current === preset.id;
          return (
            <Tooltip key={preset.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={preset.label}
                  onClick={() => {
                    applyAppearance(preset.id);
                    onChange?.(preset.id);
                  }}
                  className={cn(
                    "relative flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background transition-colors hover:border-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring",
                    active && "border-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-5 w-5 rounded-full"
                    style={{ background: preset.swatch }}
                  />
                  {active && (
                    <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background">
                      <IconCheck
                        className="h-3 w-3 text-foreground"
                        stroke={3}
                      />
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{preset.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
