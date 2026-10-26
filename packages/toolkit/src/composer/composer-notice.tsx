import { IconAlertCircle, IconAlertTriangle, IconX } from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "../utils.js";

/** `warning` is a recoverable failure; `danger` is reserved for unrecoverable outcomes. */
export type ComposerNoticeTone = "warning" | "danger";

/** A dismiss button is icon-only, so it never ships without its name. */
export type ComposerNoticeDismissProps =
  | { onDismiss: () => void; dismissLabel: string }
  | { onDismiss?: undefined; dismissLabel?: string };

export type ComposerNoticeProps = ComposerNoticeBaseProps &
  ComposerNoticeDismissProps;

interface ComposerNoticeBaseProps {
  tone?: ComposerNoticeTone;
  /** Short lead shown before the message, in the same line. */
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Defaults to `alert` for danger and `status` for warning. */
  role?: "alert" | "status";
  /** Stable hook for hosts and tests, rendered as data-notice. */
  noticeId?: string;
  className?: string;
  /** Render in place even when a composer notice slot is available. */
  inline?: boolean;
  /** Spread onto the root, e.g. a session-replay mask. */
  rootProps?: Record<string, string>;
}

interface ComposerNoticeScopeValue {
  target: HTMLElement | null;
  register: (element: HTMLElement) => () => void;
}

const ComposerNoticeScopeContext =
  createContext<ComposerNoticeScopeValue | null>(null);

function useNoticeScopeValue(): ComposerNoticeScopeValue {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const register = useCallback((element: HTMLElement) => {
    setTarget(element);
    return () => setTarget((current) => (current === element ? null : current));
  }, []);
  return useMemo(() => ({ target, register }), [register, target]);
}

/**
 * Collects every ComposerNotice below it into the notice slot of the one
 * composer that opts in with `noticeOutlet`. A nested scope defers to the
 * outer one, so a host and the chat it wraps share one slot.
 */
export function ComposerNoticeScope({ children }: { children: ReactNode }) {
  const outer = useContext(ComposerNoticeScopeContext);
  const own = useNoticeScopeValue();
  if (outer) return <>{children}</>;
  return (
    <ComposerNoticeScopeContext.Provider value={own}>
      {children}
    </ComposerNoticeScopeContext.Provider>
  );
}

/**
 * The slot rendered above the composer input. An outlet slot registers with
 * the surrounding scope; any other slot only collects its own composer's
 * notices, so a nested composer never steals the chat's notices.
 */
export function useComposerNoticeSlot(outlet: boolean) {
  const outer = useContext(ComposerNoticeScopeContext);
  const local = useNoticeScopeValue();
  const shared = outlet && outer ? outer : null;
  const register = (shared ?? local).register;
  const slotRef = useCallback(
    (element: HTMLDivElement | null) =>
      element ? register(element) : undefined,
    [register],
  );
  return { slotRef, scope: shared ?? local };
}

export function ComposerNoticeScopeProvider({
  value,
  children,
}: {
  value: ComposerNoticeScopeValue;
  children: ReactNode;
}) {
  return (
    <ComposerNoticeScopeContext.Provider value={value}>
      {children}
    </ComposerNoticeScopeContext.Provider>
  );
}

export function ComposerNotice({
  tone = "warning",
  title,
  children,
  actions,
  onDismiss,
  dismissLabel,
  role,
  noticeId,
  className,
  inline = false,
  rootProps,
}: ComposerNoticeProps) {
  const scope = useContext(ComposerNoticeScopeContext);
  const Icon = tone === "danger" ? IconAlertCircle : IconAlertTriangle;
  const notice = (
    <div
      {...rootProps}
      data-agent-composer-notice=""
      data-tone={tone}
      data-notice={noticeId}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "agent-composer-notice flex min-w-0 items-start gap-2 rounded-md border px-3 py-1.5 text-xs leading-5 text-foreground",
        tone === "danger"
          ? "border-destructive/30 bg-destructive/5"
          : "border-[hsl(var(--agent-kit-warning)/0.4)] bg-[hsl(var(--agent-kit-warning)/0.1)]",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-1 size-4 shrink-0",
          tone === "danger"
            ? "text-destructive"
            : "text-[hsl(var(--agent-kit-warning))]",
        )}
      />
      {/* Actions sit on the message's line and wrap below it when narrow. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <p className="m-0 min-w-0 flex-[1_1_12rem] break-words py-0.5">
          {title ? (
            <span className="me-1.5 font-medium text-foreground">{title}</span>
          ) : null}
          {title && children ? (
            <span className="text-muted-foreground">{children}</span>
          ) : (
            children
          )}
        </p>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
          className="-me-1.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconX aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  );
  if (inline || !scope?.target) return notice;
  return createPortal(notice, scope.target);
}
