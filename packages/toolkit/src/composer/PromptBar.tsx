import { IconMessage } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "../ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { cn } from "../utils.js";
import { PromptComposer, type PromptComposerProps } from "./PromptComposer.js";
import type { AgentComposerLayoutVariant } from "./types.js";

export interface PromptBarSection {
  id: string;
  label?: ReactNode;
  icon?: ReactNode;
  content: ReactNode;
  visible?: boolean;
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
  onSubmit?: PromptComposerProps["onSubmit"];
  mode?: "inline" | "popover";
  trigger?: ReactNode;
  triggerLabel?: string;
  children?: ReactNode;
  sections?: PromptBarSection[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  layoutVariant?: AgentComposerLayoutVariant;
}

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
