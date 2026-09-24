import { IconMessage } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "../ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { cn } from "../utils.js";
import { PromptComposer, type PromptComposerProps } from "./PromptComposer.js";
import type { AgentComposerLayoutVariant } from "./types.js";

export interface PromptBarSection {
  /** Stable identifier used for DOM hooks and host-level analytics. */
  id: string;
  /** Optional compact section label, such as Commands or Skills. */
  label?: ReactNode;
  /** Optional leading icon for the section label. */
  icon?: ReactNode;
  /** Section content, typically a list of selectable command/tool rows. */
  content: ReactNode;
  /** Hide this section without changing the host's registration order. */
  visible?: boolean;
  /** Optional ordering value; lower values render first. */
  order?: number;
  className?: string;
}

export interface PromptBarProps extends Omit<
  PromptComposerProps,
  | "onSubmit"
  | "className"
  | "rootClassName"
  | "rootStyle"
  | "style"
  | "layoutVariant"
> {
  /** Submission handler shared with the underlying PromptComposer. */
  onSubmit?: PromptComposerProps["onSubmit"];
  /** Render as the shared inline boundary used by full chat surfaces. */
  mode?: "inline" | "popover";
  /** Custom trigger. Defaults to a compact Ask-agent button. */
  trigger?: ReactNode;
  /** Label for the default trigger. */
  triggerLabel?: string;
  /** Optional menu/content rendered directly above the composer. */
  children?: ReactNode;
  /** Registered menu sections rendered above the composer in one shared surface. */
  sections?: PromptBarSection[];
  /** Controlled popover state for hosts that coordinate surrounding layout. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Trigger class, used when the default trigger is rendered. */
  className?: string;
  /** Popover content classes, useful for compact and wide host surfaces. */
  contentClassName?: string;
  /** Popover alignment relative to the trigger. */
  align?: "start" | "center" | "end";
  /** Composer density inside the bar. Defaults to the compact popover fit. */
  layoutVariant?: AgentComposerLayoutVariant;
}

/**
 * Composable prompt surface for small contextual agent entry points.
 *
 * The popover owns only placement and shared chrome. Commands, sources, tool
 * access, and other agent affordances belong in registered `sections` (or the
 * compatibility `children` slot), so hosts can add them without forking the
 * composer or its submit behavior.
 */
export function PromptBar({
  mode = "popover",
  trigger,
  triggerLabel = "Ask the agent",
  children,
  sections,
  open: controlledOpen,
  onOpenChange,
  className,
  contentClassName,
  align = "end",
  layoutVariant = "compact",
  onSubmit,
  ...composerProps
}: PromptBarProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const submit =
    onSubmit ??
    (() => {
      throw new Error("PromptBar requires an onSubmit handler");
    });

  if (mode === "inline") {
    return (
      <div data-agent-prompt-bar="inline" className={cn("contents", className)}>
        {children ?? (
          <PromptComposer
            {...composerProps}
            layoutVariant={layoutVariant}
            onSubmit={submit}
          />
        )}
      </div>
    );
  }

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const visibleSections = [...(sections ?? [])]
    .filter((section) => section.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const hasMenuContent = visibleSections.length > 0 || children != null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={className}
          >
            <IconMessage aria-hidden="true" />
            {triggerLabel}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          "z-[260] w-[min(560px,calc(100vw-24px))] border-0 bg-transparent p-0 shadow-none",
          contentClassName,
        )}
      >
        <div className="flex flex-col gap-2">
          {hasMenuContent ? (
            <div className="max-h-[min(360px,45vh)] overflow-y-auto rounded-xl border border-border/80 bg-popover p-2 shadow-lg">
              {visibleSections.map((section) => (
                <div
                  key={section.id}
                  data-prompt-bar-section={section.id}
                  className={section.className}
                >
                  {section.label ? (
                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {section.icon}
                      {section.label}
                    </div>
                  ) : null}
                  {section.content}
                </div>
              ))}
              {children}
            </div>
          ) : null}
          <div className="rounded-xl">
            <PromptComposer
              {...composerProps}
              layoutVariant={layoutVariant}
              onSubmit={submit}
              className="py-1"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
