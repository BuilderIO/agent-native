import type { ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";

interface SettingsSectionProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  required?: boolean;
  connected?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

/**
 * Collapsible settings section card with icon, title, status dot, and optional badge.
 * Controlled via `open` / `onToggle` for accordion behaviour.
 */
export function SettingsSection({
  icon,
  title,
  subtitle,
  badge,
  required,
  connected,
  open = false,
  onToggle,
  children,
}: SettingsSectionProps) {
  return (
    <div className="rounded-lg border border-border bg-background/50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <span className="text-[12px] font-medium text-foreground truncate">
            {title}
          </span>
          {connected && (
            <span className="flex items-center gap-1 shrink-0 text-[9px] font-medium text-green-500">
              Connected
            </span>
          )}
          {required && !connected && (
            <span className="shrink-0 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-orange-500">
              Required
            </span>
          )}
          {badge && (
            <span className="shrink-0 rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <IconChevronDown
          size={12}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-3 pb-3 pt-2.5">
          {subtitle && (
            <p className="text-[10px] text-muted-foreground mb-2.5">
              {subtitle}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
