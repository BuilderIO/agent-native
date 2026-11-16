import { IconChevronRight } from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";

import { useUntilFoundContent } from "./disclosure-content.js";

/** Omitted status is finished work. */
export type TraceStatus = "running" | "error" | "pending";

function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function Trace({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="trace"
      className={classes("agentkit-trace", className)}
      {...props}
    />
  );
}

/** Status shows only as color and motion; the title must say it too. */
export function TraceLine({
  className,
  status,
  ...props
}: ComponentProps<"span"> & { status?: TraceStatus | undefined }) {
  return (
    <span
      data-slot="trace-line"
      // Not data-status: rows already carry the protocol status there.
      data-trace-status={status}
      className={classes("agentkit-trace-line", className)}
      {...props}
    />
  );
}

/** A fixed 1rem column, so titles align down the trace. */
export function TraceIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={classes("agentkit-disclosure-icon-slot", className)}
      {...props}
    />
  );
}

/** The accessible name of the step. Truncates; shimmers while running. */
export function TraceTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-title"
      className={classes("agentkit-trace-title", className)}
      {...props}
    />
  );
}

/** A duration or diff stat; never truncates. */
export function TraceDescription({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-description"
      className={classes("agentkit-trace-description", className)}
      {...props}
    />
  );
}

interface TraceCollapsibleState {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
  contentRendered: boolean;
  setContentRendered: (rendered: boolean) => void;
}

const TraceCollapsibleContext = createContext<TraceCollapsibleState | null>(
  null,
);

function useTraceCollapsibleState(part: string): TraceCollapsibleState {
  const state = useContext(TraceCollapsibleContext);
  if (!state) throw new Error(`${part} must be inside TraceCollapsible.`);
  return state;
}

export type TraceCollapsibleOpenProps =
  | { open?: undefined; onOpenChange?: (open: boolean) => void }
  | { open: boolean; onOpenChange: (open: boolean) => void };

export function TraceCollapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  ...props
}: Omit<ComponentProps<"div">, "onToggle"> &
  TraceCollapsibleOpenProps & { defaultOpen?: boolean | undefined }) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const [contentRendered, setContentRendered] = useState(false);
  const contentId = useId();
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const state = useMemo(
    () => ({ open, setOpen, contentId, contentRendered, setContentRendered }),
    [open, setOpen, contentId, contentRendered],
  );
  return (
    <TraceCollapsibleContext.Provider value={state}>
      <div
        data-slot="trace-collapsible"
        data-state={open ? "open" : "closed"}
        className={classes("agentkit-trace-collapsible", className)}
        {...props}
      />
    </TraceCollapsibleContext.Provider>
  );
}

/** Wrap a `TraceLine`; adds the chevron. */
export function TraceCollapsibleTrigger({
  className,
  children,
  onClick,
  ...props
}: Omit<ComponentProps<"button">, "type">) {
  const { open, setOpen, contentId, contentRendered } =
    useTraceCollapsibleState("TraceCollapsibleTrigger");
  return (
    <button
      type="button"
      data-slot="trace-collapsible-trigger"
      data-expandable="true"
      aria-expanded={open}
      aria-controls={contentRendered ? contentId : undefined}
      className={classes("agentkit-disclosure-summary", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
      {...props}
    >
      {children}
      <IconChevronRight
        aria-hidden="true"
        className="agentkit-icon agentkit-disclosure-chevron"
        data-open={open ? "true" : "false"}
      />
    </button>
  );
}

/** `keepMounted` hides closed content until found, so find-in-page opens it. */
export function TraceCollapsibleContent({
  keepMounted = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "id" | "hidden"> & { keepMounted?: boolean }) {
  const { open, setOpen, contentId, setContentRendered } =
    useTraceCollapsibleState("TraceCollapsibleContent");
  const rendered = open || keepMounted;
  useLayoutEffect(() => {
    setContentRendered(rendered);
    return () => setContentRendered(false);
  }, [rendered, setContentRendered]);
  if (keepMounted) {
    return (
      <KeptTraceContent
        open={open}
        onReveal={() => setOpen(true)}
        id={contentId}
        className={className}
        {...props}
      >
        {children}
      </KeptTraceContent>
    );
  }
  return open ? (
    <div
      id={contentId}
      data-slot="trace-collapsible-content"
      data-state="open"
      className={classes("agentkit-trace-content", className)}
      {...props}
    >
      {children}
    </div>
  ) : null;
}

function KeptTraceContent({
  open,
  onReveal,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "hidden"> & {
  open: boolean;
  onReveal: () => void;
}) {
  const { ref, mounted } = useUntilFoundContent(open, onReveal);
  return (
    <div
      ref={ref}
      data-slot="trace-collapsible-content"
      data-state={open ? "open" : "closed"}
      hidden={!open}
      className={classes("agentkit-trace-content", className)}
      {...props}
    >
      {mounted ? children : null}
    </div>
  );
}
