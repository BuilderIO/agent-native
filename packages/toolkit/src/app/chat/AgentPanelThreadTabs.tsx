import { useT } from "@agent-native/core/client/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrailing,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { cn } from "@agent-native/toolkit/utils";
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** Below this panel width the tab strip becomes one thread switcher. */
export const AGENT_PANEL_TABS_MIN_PANEL_WIDTH = 384;

export type AgentPanelTabLayout = "tabs" | "switcher";

export function resolveAgentPanelTabLayout(
  panelWidth: number | null,
): AgentPanelTabLayout {
  // A panel without layout (hidden, or not yet laid out) has no width to
  // decide from; it keeps the strip until a real width arrives.
  if (panelWidth === null) return "tabs";
  return panelWidth < AGENT_PANEL_TABS_MIN_PANEL_WIDTH ? "switcher" : "tabs";
}

/**
 * The element's own layout width, or `null` while it has none. Uses
 * `offsetWidth` so view-transition and drawer transforms never read as a
 * narrower panel.
 */
export function useElementInlineSize(
  ref: RefObject<HTMLElement | null>,
): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      setWidth(null);
      return;
    }
    const read = () => {
      const next = element.offsetWidth;
      setWidth(next > 0 ? next : null);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function moveTabFocus(event: React.KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  );
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  if (current === -1 || tabs.length === 0) return;
  event.preventDefault();
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === forward ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[next]?.focus();
}

export const AgentPanelTabList = React.forwardRef<
  HTMLDivElement,
  {
    label: string;
    className?: string;
    children: React.ReactNode;
  } & Omit<React.HTMLAttributes<HTMLDivElement>, "role" | "aria-label">
>(function AgentPanelTabList({ label, className, children, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={moveTabFocus}
      className={cn(
        "agent-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto",
        className,
      )}
    >
      {children}
    </div>
  );
});

/** Delete or Backspace on a focused tab closes it. */
export function closeAgentPanelTabOnKey(
  event: React.KeyboardEvent<HTMLElement>,
  onClose: (() => void) | undefined,
) {
  if (!onClose || (event.key !== "Delete" && event.key !== "Backspace")) {
    return;
  }
  event.preventDefault();
  onClose();
}

/**
 * The pointer control that closes a tab. A tablist may own only tabs, so it
 * stays out of the accessibility tree and out of the tab order; Delete on the
 * tab (announced through aria-keyshortcuts) is the keyboard and screen reader
 * path.
 */
export function AgentPanelTabCloseButton({
  label,
  onClose,
  className,
}: {
  label: string;
  onClose: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      className={className}
    >
      <IconX size={16} aria-hidden="true" />
    </button>
  );
}

function RunningDot() {
  return (
    <span
      aria-hidden="true"
      className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse motion-reduce:animate-none"
    />
  );
}

export function AgentPanelTab({
  label,
  active,
  running = false,
  onSelect,
  onClose,
  closeLabel,
  tabRef,
  size = "default",
}: {
  label: string;
  active: boolean;
  running?: boolean | undefined;
  onSelect: () => void;
  onClose?: (() => void) | undefined;
  closeLabel: string;
  tabRef?: ((el: HTMLElement | null) => void) | undefined;
  /** `strip` tabs never squeeze below 112px; the strip scrolls instead. */
  size?: "default" | "compact" | "strip";
}) {
  return (
    <div
      className={cn(
        "agent-tab-group relative flex items-center",
        size === "strip"
          ? "min-w-28 max-w-[200px] shrink"
          : size === "compact"
            ? "min-w-12 max-w-36 shrink"
            : "min-w-14 max-w-40 shrink",
      )}
      data-active={active ? "" : undefined}
      data-agent-tab-item=""
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        aria-keyshortcuts={onClose ? "Delete Backspace" : undefined}
        ref={tabRef}
        onClick={onSelect}
        onKeyDown={(event) => closeAgentPanelTabOnKey(event, onClose)}
        className={cn(
          "agent-tab relative flex h-6 w-full min-w-0 items-center gap-1 rounded-md ps-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          onClose ? "pe-7" : "pe-2.5",
          size === "compact" && "ps-2",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        {running && <RunningDot />}
      </button>
      {onClose ? (
        <AgentPanelTabCloseButton
          label={closeLabel}
          onClose={onClose}
          className="agent-tab-close absolute end-0.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
        />
      ) : null}
    </div>
  );
}

export interface AgentPanelThreadItem {
  id: string;
  label: string;
  active: boolean;
  running?: boolean;
}

export interface AgentPanelThreadNavProps {
  items: AgentPanelThreadItem[];
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onNew?: () => void;
  newLabel: string;
  closeLabel: string;
  tabListLabel: string;
  activeTabRef?: (el: HTMLElement | null) => void;
}

function AgentPanelThreadMenuContent({
  items,
  onSelect,
  onClose,
  onNew,
  newLabel,
  closeLabel,
  align,
}: Omit<AgentPanelThreadNavProps, "tabListLabel" | "activeTabRef"> & {
  align: "start" | "end";
}) {
  const t = useT();
  return (
    <DropdownMenuContent
      align={align}
      sideOffset={6}
      aria-label={t("agentChat.tabs.openChats")}
      data-agent-thread-menu=""
      className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto"
    >
      {onNew ? (
        <>
          <DropdownMenuItem onSelect={onNew}>{newLabel}</DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          data-agent-thread-menu-item={item.id}
          aria-current={item.active ? "true" : undefined}
          onSelect={() => onSelect(item.id)}
          onKeyDown={(event) => {
            if (
              onClose &&
              (event.key === "Delete" || event.key === "Backspace")
            ) {
              event.preventDefault();
              onClose(item.id);
            }
          }}
          className={onClose ? "pe-1" : undefined}
        >
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.running ? <RunningDot /> : null}
          <DropdownMenuTrailing>
            {item.active ? <IconCheck aria-hidden="true" /> : null}
          </DropdownMenuTrailing>
          {onClose ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={closeLabel}
              data-agent-thread-menu-close=""
              // Radix selects an item on pointerup and click; the close
              // control must stop both or closing a chat also switches to it.
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClose(item.id);
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
            >
              <IconX size={16} aria-hidden="true" />
            </button>
          ) : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

export function AgentPanelThreadSwitcher(props: AgentPanelThreadNavProps) {
  const active = props.items.find((item) => item.active) ?? props.items.at(0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-agent-thread-switcher=""
          className="agent-thread-switcher flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md ps-2 pe-1 text-xs font-medium text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
        >
          <span className="truncate">{active?.label ?? props.newLabel}</span>
          {active?.running ? <RunningDot /> : null}
          <IconChevronDown
            size={16}
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <AgentPanelThreadMenuContent {...props} align="start" />
    </DropdownMenu>
  );
}

interface StripOverflow {
  start: boolean;
  end: boolean;
  hidden: number;
}

export function measureAgentPanelTabOverflow(
  scroller: HTMLElement,
): StripOverflow {
  const max = scroller.scrollWidth - scroller.clientWidth;
  if (max <= 1) return { start: false, end: false, hidden: 0 };
  const bounds = scroller.getBoundingClientRect();
  let hidden = 0;
  for (const tab of scroller.querySelectorAll<HTMLElement>(
    "[data-agent-tab-item]",
  )) {
    const rect = tab.getBoundingClientRect();
    if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) hidden++;
  }
  // RTL scrolls with a negative scrollLeft; distance from the start is the same.
  const scrolled = Math.abs(scroller.scrollLeft);
  return { start: scrolled > 1, end: scrolled < max - 1, hidden };
}

export function AgentPanelThreadTabStrip(props: AgentPanelThreadNavProps) {
  const t = useT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<StripOverflow>({
    start: false,
    end: false,
    hidden: 0,
  });
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = measureAgentPanelTabOverflow(scroller);
    setOverflow((prev) =>
      prev.start === next.start &&
      prev.end === next.end &&
      prev.hidden === next.hidden
        ? prev
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure]);

  const itemsKey = props.items
    .map((item) => `${item.id}:${item.label}:${item.active ? 1 : 0}`)
    .join("|");
  useLayoutEffect(() => {
    measure();
  }, [itemsKey, measure]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <AgentPanelTabList
        ref={scrollerRef}
        label={props.tabListLabel}
        data-overflow-start={overflow.start ? "" : undefined}
        data-overflow-end={overflow.end ? "" : undefined}
      >
        {props.items.map((item) => (
          <AgentPanelTab
            key={item.id}
            size="strip"
            label={item.label}
            active={item.active}
            running={item.running}
            tabRef={item.active ? props.activeTabRef : undefined}
            onSelect={() => props.onSelect(item.id)}
            onClose={props.onClose ? () => props.onClose?.(item.id) : undefined}
            closeLabel={props.closeLabel}
          />
        ))}
      </AgentPanelTabList>
      {overflow.hidden > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-agent-tabs-more=""
              className="flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              {t("agentChat.tabs.moreTabs", { count: overflow.hidden })}
            </button>
          </DropdownMenuTrigger>
          <AgentPanelThreadMenuContent {...props} align="end" />
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function AgentPanelThreadNav({
  layout,
  ...props
}: AgentPanelThreadNavProps & { layout: AgentPanelTabLayout }) {
  return layout === "switcher" ? (
    <AgentPanelThreadSwitcher {...props} />
  ) : (
    <AgentPanelThreadTabStrip {...props} />
  );
}
