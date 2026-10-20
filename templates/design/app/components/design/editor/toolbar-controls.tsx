import { IconChevronDown } from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DesignToolbarOption = {
  key: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  /** The variant the group's main button currently arms. */
  active?: boolean;
  disabled?: boolean;
  /**
   * Looks unavailable but still takes the click, for an item whose click is the
   * way to make it available (Image/video asking to connect storage).
   */
  dimmed?: boolean;
  /** Draw a divider above this item. */
  separatorBefore?: boolean;
  onSelect: () => void;
};

export function DesignPenToolIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
      <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
      <path d="m2.3 2.3 7.286 7.286" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

/**
 * One toolbar group as a split button: the 32px tool, a 1px seam and a 16px
 * chevron that opens the group's menu. A group with a single item has no
 * chevron. The tool fills with the accent while it is armed.
 */
export function DesignToolbarTool({
  groupId,
  active,
  label,
  icon,
  optionsLabel,
  options,
  onPrimary,
  primaryShortcut,
}: {
  groupId: string;
  active: boolean;
  label: string;
  icon: ReactNode;
  /** Accessible name of the chevron; the group's name, not the armed variant's. */
  optionsLabel: string;
  options: DesignToolbarOption[];
  onPrimary: () => void;
  /** Shown in the tooltip beside the label. */
  primaryShortcut?: string;
}) {
  const hasOptionsMenu = options.length > 1;
  return (
    <div
      data-design-toolbar-group={groupId}
      className="flex h-8 items-center gap-px"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
              "flex size-8 cursor-pointer items-center justify-center rounded-lg text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-[var(--design-editor-accent-color)] text-[var(--design-editor-accent-contrast-color)] hover:bg-[var(--design-editor-accent-hover-color)]"
                : // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
                  "hover:bg-white/10",
            )}
            onClick={onPrimary}
            aria-label={label}
            aria-pressed={active}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2">
          <span>{label}</span>
          {primaryShortcut ? (
            <span className="text-muted-foreground">{primaryShortcut}</span>
          ) : null}
        </TooltipContent>
      </Tooltip>

      {hasOptionsMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
                "flex h-8 w-4 cursor-pointer items-center justify-center rounded-md text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/15 data-[state=open]:text-white",
              )}
              aria-label={optionsLabel}
            >
              <IconChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="center"
            sideOffset={12}
            className="min-w-[151px] rounded-[10px] border-border bg-popover p-0 text-popover-foreground shadow-md"
          >
            {options.map((option) => (
              <Fragment key={option.key}>
                {option.separatorBefore ? (
                  <DropdownMenuSeparator className="mx-0 my-0" />
                ) : null}
                <DropdownMenuItem
                  disabled={option.disabled}
                  aria-disabled={option.dimmed ? true : undefined}
                  aria-current={option.active ? "true" : undefined}
                  data-option={option.key}
                  onSelect={option.onSelect}
                  className={cn(
                    "h-7 gap-2 rounded-lg px-2 py-1 text-sm text-popover-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:text-muted-foreground",
                    option.dimmed && "opacity-50",
                  )}
                >
                  <span className="flex w-5 shrink-0 items-center justify-center p-0.5">
                    {option.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {option.shortcut ? (
                    <DropdownMenuShortcut className="ms-3 text-xs tracking-normal text-muted-foreground opacity-100">
                      {option.shortcut}
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function DesignModeTab({
  active,
  disabled,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
            "flex size-8 cursor-pointer items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40",
            active &&
              // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
              "bg-neutral-950/70 text-[#38bdf8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_18px_-12px_rgba(0,0,0,0.95)] hover:bg-neutral-950/70 hover:text-[#38bdf8]",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
