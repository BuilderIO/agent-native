import { IconBlendMode, IconContrast } from "@tabler/icons-react";
import { Fragment, type ElementType } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  BLEND_MODE_GROUPS,
  BLEND_MODE_OPTIONS,
} from "./color-picker-paint-types";

const ICON_BUTTON =
  "flex size-6 cursor-pointer items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95";
const ICON_IDLE =
  "text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground";
const ICON_ACTIVE = "bg-accent text-accent-foreground ring-1 ring-primary/60";

export interface PaintRowEntry {
  id: string;
  label: string;
  Icon: ElementType<{ className?: string }>;
  active: boolean;
  onSelect: () => void;
}

/**
 * The picker's 40px paint row: the paint types on the left, and on the right
 * Blend (a menu that reads pressed unless the mode is Normal) and, for text,
 * the Contrast toggle.
 */
export function PaintRow({
  paints,
  blend,
  contrast,
  disabled,
  onTooltipEscape,
}: {
  paints: PaintRowEntry[];
  blend?: { label: string; value: string; onChange: (mode: string) => void };
  contrast?: { label: string; pressed: boolean; onToggle: () => void };
  disabled: boolean;
  onTooltipEscape: () => void;
}) {
  return (
    <div className="flex h-10 items-center gap-1 border-b border-border/70 px-2">
      {paints.map(({ id, label, Icon, active, onSelect }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-pressed={active}
              disabled={disabled}
              onClick={onSelect}
              className={cn(
                ICON_BUTTON,
                active ? ICON_ACTIVE : ICON_IDLE,
                disabled && "pointer-events-none opacity-40",
              )}
            >
              <Icon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="text-[10px]"
            onEscapeKeyDown={onTooltipEscape}
          >
            {label}
          </TooltipContent>
        </Tooltip>
      ))}
      <div className="ms-auto flex items-center gap-1">
        {blend ? (
          <BlendMenu
            {...blend}
            disabled={disabled}
            onTooltipEscape={onTooltipEscape}
          />
        ) : null}
        {contrast ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={contrast.label}
                aria-pressed={contrast.pressed}
                disabled={disabled}
                onClick={contrast.onToggle}
                className={cn(
                  ICON_BUTTON,
                  contrast.pressed ? ICON_ACTIVE : ICON_IDLE,
                  disabled && "pointer-events-none opacity-40",
                )}
              >
                <IconContrast className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="text-[10px]"
              onEscapeKeyDown={onTooltipEscape}
            >
              {contrast.label}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function BlendMenu({
  label,
  value,
  onChange,
  disabled,
  onTooltipEscape,
}: {
  label: string;
  value: string;
  onChange: (mode: string) => void;
  disabled: boolean;
  onTooltipEscape: () => void;
}) {
  const current = BLEND_MODE_OPTIONS.some((option) => option.value === value)
    ? value
    : "normal";
  const pressed = current !== "normal";
  const labelFor = (mode: string) =>
    BLEND_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-pressed={pressed}
              disabled={disabled}
              className={cn(
                ICON_BUTTON,
                pressed ? ICON_ACTIVE : ICON_IDLE,
                disabled && "pointer-events-none opacity-40",
              )}
            >
              <IconBlendMode className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="text-[10px]"
          onEscapeKeyDown={onTooltipEscape}
        >
          {pressed ? `${label}: ${labelFor(current)}` : label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-40 overflow-y-auto"
      >
        <DropdownMenuRadioGroup value={current} onValueChange={onChange}>
          {BLEND_MODE_GROUPS.map((group, index) => (
            <Fragment key={group[0]}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              {group.map((mode) => (
                <DropdownMenuRadioItem
                  key={mode}
                  value={mode}
                  indicator="check"
                  className="h-7 !text-[11px]"
                >
                  {labelFor(mode)}
                </DropdownMenuRadioItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
