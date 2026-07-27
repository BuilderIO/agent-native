import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type TransitionEvent,
} from "react";

import { cn } from "../utils.js";

/**
 * Where a settings section is being rendered.
 *
 * - `sidebar`: the compact agent sidebar panel (dense, small type).
 * - `page`: the full-width settings page, styled as a polished card that
 *   matches the shadcn `Card` surface used by app-owned settings tabs.
 */
export type SettingsSurface = "sidebar" | "page";

const SettingsSurfaceContext = createContext<SettingsSurface>("sidebar");

export function SettingsSurfaceProvider({
  surface,
  children,
}: {
  surface: SettingsSurface;
  children: ReactNode;
}) {
  return (
    <SettingsSurfaceContext.Provider value={surface}>
      {children}
    </SettingsSurfaceContext.Provider>
  );
}

export function useSettingsSurface(): SettingsSurface {
  return useContext(SettingsSurfaceContext);
}

interface SettingsSectionProps {
  id?: string;
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
 * Collapsible settings section. Renders as a compact row in the agent sidebar
 * and as a polished, shadcn-style card on the full settings page (so the
 * framework tabs match app-owned General/Team cards). The visual surface is
 * read from `SettingsSurfaceContext`.
 */
export function SettingsSection(props: SettingsSectionProps) {
  const surface = useSettingsSurface();
  return surface === "page" ? (
    <PageSettingsSection {...props} />
  ) : (
    <SidebarSettingsSection {...props} />
  );
}

function ConnectedDot({ size }: { size: "sm" | "md" }) {
  const dim = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const stroke = size === "sm" ? 3 : 2.5;
  const glyph = size === "sm" ? 10 : 12;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-500",
        dim,
      )}
    >
      <IconCheck size={glyph} stroke={stroke} />
    </span>
  );
}

function StatusBadge({
  label,
  tone,
  size,
}: {
  label: string;
  tone: "muted" | "required";
  size: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full font-semibold uppercase tracking-wide",
        size === "sm" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
        tone === "required"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function SettingsSectionBody({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;

    // Fallback for reduced-motion and older transition engines that may not
    // emit a height transitionend event.
    const timeout = window.setTimeout(() => setPresent(false), 260);
    return () => window.clearTimeout(timeout);
  }, [open, present]);

  const handleTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (open) return;
      if (
        event.propertyName !== "height" &&
        event.propertyName !== "max-height"
      ) {
        return;
      }
      setPresent(false);
    },
    [open],
  );

  if (!present) return null;

  return (
    <div
      data-state={open ? "open" : "closed"}
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : true}
      className="agent-native-settings-section-body"
      onTransitionEnd={handleTransitionEnd}
    >
      {children}
    </div>
  );
}

function PageSettingsSection({
  id,
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
    <div
      id={id}
      className={cn(
        "scroll-mt-16 overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-colors",
        open ? "border-border" : "border-border/60",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-start transition-colors hover:bg-muted/40 sm:px-6 sm:py-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-[18px]">
            {icon}
          </span>
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold leading-none tracking-tight text-foreground">
                {title}
              </span>
              {connected && <ConnectedDot size="md" />}
              {required && !connected && (
                <StatusBadge label="Required" tone="required" size="md" />
              )}
              {badge && <StatusBadge label={badge} tone="muted" size="md" />}
            </span>
            {subtitle && (
              <span className="text-sm leading-snug text-muted-foreground">
                {subtitle}
              </span>
            )}
          </span>
        </div>
        <IconChevronDown
          size={18}
          className={cn(
            "mt-1 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <SettingsSectionBody open={open}>
        <div
          // `data-agent-native-settings-page` lets the shared stylesheet nudge
          // the smallest fixed type (authored dense for the compact sidebar) up
          // to a comfortable, consistent size on the full settings page so every
          // framework section body reads like the shadcn cards around it.
          data-agent-native-settings-page=""
          className="border-t border-border/60 px-5 pb-5 pt-5 sm:px-6 sm:pb-6"
        >
          {children}
        </div>
      </SettingsSectionBody>
    </div>
  );
}

function SidebarSettingsSection({
  id,
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
    <div id={id} className="rounded-lg border border-border bg-background/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-start rounded-lg hover:bg-accent/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <span className="text-[12px] font-medium text-foreground truncate">
            {title}
          </span>
          {connected && <ConnectedDot size="sm" />}
          {required && !connected && (
            <StatusBadge label="Required" tone="muted" size="sm" />
          )}
          {badge && <StatusBadge label={badge} tone="muted" size="sm" />}
        </div>
        <IconChevronDown
          size={12}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <SettingsSectionBody open={open}>
        <div className="border-t border-border px-3 pb-3 pt-2.5">
          {subtitle && (
            <p className="text-[10px] text-muted-foreground mb-2.5">
              {subtitle}
            </p>
          )}
          {children}
        </div>
      </SettingsSectionBody>
    </div>
  );
}
