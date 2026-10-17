import { IconCheck, IconLink } from "@tabler/icons-react";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";

import { ButtonGroup } from "../ui/button-group.js";
import { Button } from "../ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../utils.js";

export interface JoinedShareControlProps {
  trigger: ReactNode;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => Promise<boolean | void> | boolean | void;
  size?: "default" | "sm";
  disabled?: boolean;
  blocked?: boolean;
  className?: string;
}

/** A joined share trigger and quick-copy action. Wrap with a popover anchor when needed. */
export const JoinedShareControl = forwardRef<
  HTMLDivElement,
  JoinedShareControlProps
>(function JoinedShareControl(
  {
    trigger,
    copyLabel,
    copiedLabel,
    onCopy,
    size = "default",
    disabled,
    blocked,
    className,
  },
  ref,
) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    if (disabled) return;
    const result = await onCopy();
    if (result === false) return;
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1_400);
  };

  const label = copied ? copiedLabel : copyLabel;
  const segmentHeightClass =
    size === "sm"
      ? "[&>*:not([data-slot=button-group-separator]):not([data-button-group-ignore]):not(select[aria-hidden=true])]:!h-8"
      : "[&>*:not([data-slot=button-group-separator]):not([data-button-group-ignore]):not(select[aria-hidden=true])]:!h-9";
  return (
    <ButtonGroup
      ref={ref}
      className={cn(
        "shrink-0 [&>*:not([data-slot=button-group-separator]):not([data-button-group-ignore]):not(select[aria-hidden=true]):not(:first-child)]:border-primary-foreground/20",
        segmentHeightClass,
        className,
      )}
    >
      {trigger}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="default"
            className={cn(
              "w-8 shrink-0 px-0 shadow-none",
              blocked && "opacity-50",
            )}
            aria-label={label}
            disabled={disabled}
            data-blocked={blocked ? "" : undefined}
            onClick={() => void copy()}
          >
            {copied ? (
              <IconCheck aria-hidden="true" />
            ) : (
              <IconLink aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </ButtonGroup>
  );
});
JoinedShareControl.displayName = "JoinedShareControl";

export interface ShareModeTab {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface ShareTabListProps {
  tabs: Pick<ShareModeTab, "value" | "label" | "disabled">[];
  className?: string;
  "aria-label"?: string;
}

/** The underline tab strip every share surface uses. Render inside `Tabs`. */
export function ShareTabList({
  tabs,
  className,
  "aria-label": ariaLabel,
}: ShareTabListProps) {
  return (
    <TabsList
      aria-label={ariaLabel}
      className={cn(
        "h-8 w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-0 py-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map((tab) => (
        <TabsTrigger
          key={tab.value}
          value={tab.value}
          disabled={tab.disabled}
          className="relative h-8 min-w-0 flex-none rounded-none bg-transparent px-2 py-0 text-sm font-normal shadow-none after:absolute after:bottom-0 after:inset-x-2 after:h-0.5 after:bg-foreground after:opacity-0 focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:shadow-none data-[state=active]:after:opacity-100"
        >
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

export interface ShareTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: ShareModeTab[];
  listLabel?: string;
  className?: string;
  listClassName?: string;
}

/** Underline tabs for a share surface; each tab owns its panel. */
export function ShareTabs({
  value,
  onValueChange,
  tabs,
  listLabel,
  className,
  listClassName,
}: ShareTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className={cn("flex flex-col gap-3", className)}
    >
      <ShareTabList
        tabs={tabs}
        aria-label={listLabel}
        className={listClassName}
      />
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="m-0">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export interface ShareModeTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  peopleLabel: ReactNode;
  agentsLabel: ReactNode;
  people: ReactNode;
  agents: ReactNode;
  extraTabs?: ShareModeTab[];
  listLabel?: string;
  className?: string;
}

/** The compact People/Agents sharing navigation, with optional app-owned tabs. */
export function ShareModeTabs({
  value,
  onValueChange,
  peopleLabel,
  agentsLabel,
  people,
  agents,
  extraTabs = [],
  listLabel,
  className,
}: ShareModeTabsProps) {
  return (
    <ShareTabs
      value={value}
      onValueChange={onValueChange}
      listLabel={listLabel}
      className={className}
      tabs={[
        { value: "people", label: peopleLabel, content: people },
        { value: "agents", label: agentsLabel, content: agents },
        ...extraTabs,
      ]}
    />
  );
}

export type AgentShareDestination = "claude" | "claude-code" | "codex";

export interface AgentDestinationActionsProps {
  labels: {
    copy: ReactNode;
    claude: ReactNode;
    claudeCode: ReactNode;
    codex: ReactNode;
  };
  icons?: Partial<Record<AgentShareDestination, ReactNode>>;
  disabled?: boolean;
  onCopy: () => Promise<boolean | void> | boolean | void;
  onOpen: (destination: AgentShareDestination) => void;
  className?: string;
}

/** Copy and agent destination rows; apps own the link and destination handlers. */
export function AgentDestinationActions({
  labels,
  icons,
  disabled,
  onCopy,
  onOpen,
  className,
}: AgentDestinationActionsProps) {
  const destinations: {
    destination: AgentShareDestination;
    label: ReactNode;
  }[] = [
    { destination: "claude", label: labels.claude },
    { destination: "claude-code", label: labels.claudeCode },
    { destination: "codex", label: labels.codex },
  ];
  return (
    <div className={cn("-mx-1.5 flex flex-col gap-0.5", className)}>
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full justify-start gap-2 px-1.5 text-sm font-normal"
        disabled={disabled}
        onClick={() => void onCopy()}
      >
        <IconLink aria-hidden="true" className="size-4 text-muted-foreground" />
        {labels.copy}
      </Button>
      <div className="my-1 border-t border-border" />
      {destinations.map(({ destination, label }) => (
        <Button
          key={destination}
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-1.5 text-sm font-normal"
          disabled={disabled}
          onClick={() => onOpen(destination)}
        >
          {icons?.[destination] ? (
            <span aria-hidden="true" className="size-4 text-muted-foreground">
              {icons[destination]}
            </span>
          ) : null}
          {label}
        </Button>
      ))}
    </div>
  );
}
