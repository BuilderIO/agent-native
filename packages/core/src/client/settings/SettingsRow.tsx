import type { ReactNode } from "react";

import { cn } from "../utils.js";

export interface SettingsGroupProps {
  /** Anchor target so a settings search hit can scroll the whole group. */
  id?: string;
  title?: string;
  description?: string;
  /** Use a soft card surface when separators would add unnecessary chrome. */
  variant?: "default" | "soft";
  className?: string;
  children: ReactNode;
}

/**
 * A bordered card holding several one-line settings instead of one card per
 * control. Copy is passed in already translated — core components do not
 * resolve an app's i18n keys.
 */
export function SettingsGroup({
  id,
  title,
  description,
  variant = "default",
  className,
  children,
}: SettingsGroupProps) {
  return (
    <section id={id} className={cn("scroll-mt-16", className)}>
      {(title || description) && (
        <header className="mb-2.5">
          {title && (
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          )}
          {description && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </header>
      )}
      <div
        className={cn(
          "text-card-foreground",
          variant === "soft"
            ? "rounded-xl bg-card p-1 shadow-sm"
            : "overflow-hidden rounded-xl border border-border/70 bg-card",
        )}
      >
        <div
          className={
            variant === "soft" ? "grid gap-1" : "divide-y divide-border/60"
          }
        >
          {children}
        </div>
      </div>
    </section>
  );
}

export interface SettingsRowProps {
  /**
   * Anchor target. Rows keep the ids their former standalone cards used, so
   * existing settings-search hashes still resolve after a card collapses into
   * a row.
   */
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Badge or pill rendered beside the label. */
  status?: ReactNode;
  /** The input itself: switch, select, button, link. */
  control?: ReactNode;
  /** Extra content below the row, e.g. a disclosure panel. */
  children?: ReactNode;
  className?: string;
}

/** One setting: label and description on the start side, control on the end. */
export function SettingsRow({
  id,
  label,
  description,
  icon,
  status,
  control,
  children,
  className,
}: SettingsRowProps) {
  return (
    <div
      id={id}
      className={cn(
        "agent-native-settings-row scroll-mt-16 px-5 py-4 sm:px-6",
        className,
      )}
    >
      <div className="agent-native-settings-row__layout flex flex-col gap-3">
        <div className="agent-native-settings-row__main flex min-w-0 flex-1 gap-3">
          {icon && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground [&>svg]:size-[18px]">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {label}
              </span>
              {status}
            </div>
            {description && (
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {control && (
          <div className="agent-native-settings-row__control max-w-full shrink-0">
            {control}
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
