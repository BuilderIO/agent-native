import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
} from "@shared/shader-presets";
import { IconTrash } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import { ShaderControls } from "./ShaderControls";

export interface ShaderEffectRowProps {
  descriptor: ShaderDescriptor;
  onChange: (descriptor: ShaderDescriptor) => void;
  onRemove: () => void;
  className?: string;
}

export function ShaderEffectRow({
  descriptor,
  onChange,
  onRemove,
  className,
}: ShaderEffectRowProps) {
  const preset = SHADER_PRESET_MAP[descriptor.preset];

  // Resolve swatch color: first color in the palette, or preset default, or gray
  const swatchColor =
    descriptor.colors?.[0] ??
    preset?.defaultColors?.[0] ??
    preset?.defaultColorBack ??
    "#888888";

  const label = preset?.label ?? descriptor.preset;

  return (
    <div
      className={cn(
        "flex h-8 items-center gap-2 rounded px-1 hover:bg-accent/50",
        className,
      )}
    >
      {/* Color swatch */}
      <div
        className="size-4 shrink-0 rounded-sm border border-border/40"
        style={{ background: swatchColor }}
        aria-hidden="true"
      />

      {/* Preset label — click to open controls popover */}
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex-1 truncate text-left text-xs text-foreground hover:text-foreground/80 focus:outline-none"
              >
                {label}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {preset?.description ? (
            <TooltipContent>{preset.description}</TooltipContent>
          ) : null}
        </Tooltip>
        <PopoverContent
          side="left"
          align="start"
          className="w-72 p-0"
          sideOffset={8}
        >
          <ShaderControls descriptor={descriptor} onChange={onChange} />
        </PopoverContent>
      </Popover>

      {/* Remove button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={"Remove shader effect" /* i18n-ignore shader tooltip */}
          >
            <IconTrash className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {"Remove shader effect" /* i18n-ignore shader tooltip */}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
