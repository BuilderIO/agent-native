import {
  IconCheck,
  IconChevronDown,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { cn } from "../utils.js";

export interface AgentInputCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function AgentInputCard({
  title,
  subtitle,
  icon,
  children,
  footer,
  className,
}: AgentInputCardProps) {
  return (
    <div
      className={cn(
        "agent-input-card mt-2 w-full max-w-[30rem] overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        {icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-semibold leading-5 text-foreground">
            {title}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="border-t border-border/70 px-3.5 py-3">{children}</div>
      ) : null}
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-muted/25 px-3.5 py-2.5">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export interface AgentApprovalCardProps {
  toolName: string;
  question: string;
  approveLabel: string;
  denyLabel: string;
  moreOptionsLabel: string;
  alwaysAllowLabel: string;
  alwaysAllowHint?: string;
  saveFailedLabel?: string;
  isAlwaysAllowing?: boolean;
  onApprove?: () => void;
  onDeny: () => void;
  onAlwaysAllow?: () => void | Promise<void>;
}

export function AgentApprovalCard({
  toolName,
  question,
  approveLabel,
  denyLabel,
  moreOptionsLabel,
  alwaysAllowLabel,
  alwaysAllowHint,
  saveFailedLabel,
  isAlwaysAllowing = false,
  onApprove,
  onDeny,
  onAlwaysAllow,
}: AgentApprovalCardProps) {
  return (
    <AgentInputCard
      title={question}
      subtitle={toolName}
      icon={<IconShieldCheck className="size-4" />}
      className="agent-approval-card"
      footer={
        <>
          {onApprove ? (
            <div className="order-1 inline-flex items-stretch">
              <button
                type="button"
                disabled={isAlwaysAllowing}
                onClick={onApprove}
                className={cn(
                  "inline-flex shrink-0 h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
                  onAlwaysAllow && "rounded-e-none",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <IconCheck className="size-3.5" />
                {approveLabel}
              </button>
              {onAlwaysAllow ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isAlwaysAllowing}
                      aria-label={moreOptionsLabel}
                      title={moreOptionsLabel}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-s-none rounded-e-md border-s border-background/25 bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <IconChevronDown className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => void onAlwaysAllow()}
                      title={alwaysAllowHint}
                    >
                      <IconShieldCheck className="size-4" />
                      {alwaysAllowLabel}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            disabled={isAlwaysAllowing}
            onClick={onDeny}
            className="order-2 inline-flex shrink-0 h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconX className="size-3.5" />
            {denyLabel}
          </button>
          {saveFailedLabel ? (
            <span role="alert" className="basis-full text-xs text-destructive">
              {saveFailedLabel}
            </span>
          ) : null}
        </>
      }
    />
  );
}

export interface AgentChoiceOption {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AgentChoiceCardProps {
  question: string;
  options: AgentChoiceOption[];
  multiSelect?: boolean;
  submitLabel: string;
  skipLabel?: string;
  onSubmit: (values: string[]) => void;
  onSkip?: () => void;
}

export function AgentChoiceCard({
  question,
  options,
  multiSelect = false,
  submitLabel,
  skipLabel,
  onSubmit,
  onSkip,
}: AgentChoiceCardProps) {
  const [selected, setSelected] = React.useState<string[]>([]);

  const toggle = (value: string) => {
    setSelected((current) => {
      if (multiSelect) {
        return current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value];
      }
      return [value];
    });
  };

  return (
    <AgentInputCard
      title={question}
      icon={<IconCheck className="size-4" />}
      className="agent-choice-card"
      footer={
        <>
          {skipLabel && onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="order-1 inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {skipLabel}
            </button>
          ) : null}
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => onSubmit(selected)}
            className="order-2 inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:pointer-events-none disabled:opacity-45"
          >
            <IconCheck className="size-3.5" />
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggle(option.value)}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                  multiSelect ? "rounded" : "rounded-full",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {isSelected ? <IconCheck className="size-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {option.label}
                  {option.recommended ? (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      Recommended
                    </span>
                  ) : null}
                </span>
                {option.description ? (
                  <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </AgentInputCard>
  );
}
