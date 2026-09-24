import { IconFileText } from "@tabler/icons-react";
import type { ComponentProps } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

export function SidebarNavigationRow({
  icon,
  hideIconOnHover = false,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  icon: string | null | undefined;
  hideIconOnHover?: boolean;
}) {
  return (
    <Link
      {...props}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded pe-1.5 text-sm text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center",
          hideIconOnHover &&
            "group-hover:opacity-0 group-focus-within:opacity-0",
        )}
        aria-hidden="true"
      >
        {icon ? (
          <span className="text-sm leading-none">{icon}</span>
        ) : (
          <IconFileText className="size-3.5 text-muted-foreground" />
        )}
      </span>
      {children}
    </Link>
  );
}
