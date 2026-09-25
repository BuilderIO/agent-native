import type { IconValue } from "@agent-native/core/icons";
import { IconFileText } from "@tabler/icons-react";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";

import { ContentIcon } from "@/components/icons/ContentIcon";
import { cn } from "@/lib/utils";

/**
 * The one row treatment for sidebar navigation. Active rows carry a filled
 * background so the current page reads before hover does; hover stays lighter.
 */
export function sidebarRowClassName(active = false) {
  return cn(
    "flex h-7 min-w-0 items-center gap-1.5 rounded pe-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      : "hover:bg-sidebar-accent/60",
  );
}

/**
 * "Show more" / "Show less" keep row height and put the chevron in the icon
 * column; callers supply the grid columns for their depth.
 */
export const sidebarShowMoreClassName =
  "grid h-7 w-full items-center gap-0 rounded p-0 pe-1.5 text-start text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Bring a newly active row into view unless the sidebar already shows the
 * current page somewhere (Recent, Pinned), so navigation never yanks the list
 * away from a visible match.
 */
export function revealActiveSidebarRow(row: HTMLElement | null) {
  const viewport = row?.closest<HTMLElement>(
    "[data-radix-scroll-area-viewport]",
  );
  if (!row || !viewport) return;
  const bounds = viewport.getBoundingClientRect();
  const alreadyVisible = Array.from(
    viewport.querySelectorAll<HTMLElement>('[aria-current="page"]'),
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  });
  if (!alreadyVisible) row.scrollIntoView({ block: "nearest" });
}

/** A fixed 16px slot so emoji and glyph icons share one column. */
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
