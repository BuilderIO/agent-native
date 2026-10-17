import type { IconValue } from "@agent-native/core/icons";
import { IconFileText } from "@tabler/icons-react";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";

import { ContentIcon } from "@/components/icons/ContentIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function sidebarRowClassName(active = false) {
  return cn(
    "flex h-7 min-w-0 items-center gap-1.5 rounded pe-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      : "hover:bg-sidebar-accent/60",
  );
}

export const sidebarShowMoreClassName =
  "grid h-7 w-full items-center gap-0 rounded p-0 pe-1.5 text-start text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

const SIDEBAR_ROW_PLACEHOLDER = "[data-sidebar-row-placeholder]";

// The open page scrolls into view in Files unless another section already
// shows it. Rows still loading may be that section, or may push the row once
// they arrive, so the check waits until the sidebar has no placeholder rows.
// Returns a cleanup that stops a check still waiting.
export function revealActiveSidebarRow(
  row: HTMLElement | null,
): (() => void) | undefined {
  const viewport = row?.closest<HTMLElement>(
    "[data-radix-scroll-area-viewport]",
  );
  if (!row || !viewport) return undefined;
  const reveal = () => {
    const bounds = viewport.getBoundingClientRect();
    const alreadyVisible = Array.from(
      viewport.querySelectorAll<HTMLElement>('[aria-current="page"]'),
    ).some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    if (!alreadyVisible) row.scrollIntoView({ block: "nearest" });
  };
  if (!viewport.querySelector(SIDEBAR_ROW_PLACEHOLDER)) {
    reveal();
    return undefined;
  }
  const observer = new MutationObserver(() => {
    if (viewport.querySelector(SIDEBAR_ROW_PLACEHOLDER)) return;
    observer.disconnect();
    if (row.isConnected) reveal();
  });
  observer.observe(viewport, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function SidebarRowIcon({ icon }: { icon: ReactNode }) {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center text-[15px] leading-4"
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

export function SidebarNavigationRow({
  icon,
  hideIconOnHover = false,
  active = false,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  icon: IconValue | string | null | undefined;
  hideIconOnHover?: boolean;
  active?: boolean;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      {...props}
      className={cn(sidebarRowClassName(active), className)}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center",
          hideIconOnHover &&
            "group-hover:opacity-0 group-focus-within:opacity-0",
        )}
        aria-hidden="true"
      >
        <SidebarRowIcon
          icon={
            <ContentIcon
              value={icon}
              size={14}
              fallback={
                <IconFileText className="size-3.5 text-muted-foreground" />
              }
            />
          }
        />
      </span>
      {children}
    </Link>
  );
}

const SKELETON_ROW_WIDTHS = [70, 55, 85, 60, 45];

// Placeholder rows in a sidebar list's own geometry: 28px rows 2px apart, and
// a 28px "Show more" row when `more` is set. `framed` adds the list's own
// padding, for a placeholder that stands in for the whole list; without it the
// rows sit inside a list that is already drawn.
export function SidebarRowsSkeleton({
  rows,
  more = false,
  framed = true,
  firstRowProps,
}: {
  rows: number;
  more?: boolean;
  framed?: boolean;
  firstRowProps?: Record<string, string>;
}) {
  const rowList = Array.from({ length: rows }, (_, index) => (
    <div
      key={index}
      aria-hidden="true"
      data-sidebar-row-placeholder=""
      {...(index === 0 ? firstRowProps : {})}
      className="flex h-7 items-center gap-1.5 px-1.5"
    >
      <Skeleton className="size-3.5 shrink-0 rounded-sm bg-sidebar-foreground/12 dark:bg-sidebar-foreground/10" />
      <Skeleton
        className="h-3 rounded bg-sidebar-foreground/12 dark:bg-sidebar-foreground/10"
        style={{
          width: `${SKELETON_ROW_WIDTHS[index % SKELETON_ROW_WIDTHS.length]}%`,
        }}
      />
    </div>
  ));
  const moreRow = more ? (
    <div aria-hidden="true" data-sidebar-row-placeholder="" className="h-7" />
  ) : null;
  if (!framed) {
    return (
      <>
        {rowList}
        {moreRow}
      </>
    );
  }
  return (
    <>
      <div
        aria-hidden="true"
        className="grid min-w-0 gap-0.5 overflow-x-hidden py-1 ps-1"
      >
        {rowList}
      </div>
      {moreRow}
    </>
  );
}
