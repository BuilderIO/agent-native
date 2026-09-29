import type { IconValue } from "@agent-native/core/icons";
import { IconFileText } from "@tabler/icons-react";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";

import { ContentIcon } from "@/components/icons/ContentIcon";
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
