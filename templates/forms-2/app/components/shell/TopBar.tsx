import { useT } from "@agent-native/core/client/i18n";
import { IconMenu2 } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { LogoMark } from "./LogoMark";

export const OPEN_NAV_EVENT = "forms:open-navigation";

export function TopBar({
  crumbs,
  children,
}: {
  crumbs: { label: string; to?: string }[];
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="flex h-[var(--forms-topbar-height)] shrink-0 items-center gap-2 bg-background pr-3.5 pl-2">
      <button
        type="button"
        aria-label={t("forms.shell.openNavigation")}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
        onClick={() => window.dispatchEvent(new Event(OPEN_NAV_EVENT))}
      >
        <IconMenu2 className="size-4" />
      </button>
      <Link
        to="/"
        aria-label={t("forms.shell.home")}
        className="relative hidden size-5 items-center justify-center gap-[4.55px] overflow-hidden rounded-[5px] text-center text-foreground md:flex"
      >
        <i className="flex size-[14px] gap-[4.9px] text-muted-foreground">
          <LogoMark />
        </i>
      </Link>
      <nav
        aria-label={t("forms.shell.breadcrumb")}
        className="flex min-w-0 items-center gap-1"
      >
        {crumbs.map((crumb, index) => (
          <span key={index} className="flex min-w-0 items-center gap-1">
            <span className="text-xs text-muted-foreground">/</span>
            {crumb.to ? (
              <Link
                to={crumb.to}
                className="truncate rounded-md px-1 py-0.5 text-[13px] font-semibold text-muted-foreground hover:bg-accent"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate px-1 py-0.5 text-[13px] font-semibold text-muted-foreground">
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2 [&>a]:text-center [&>button]:text-center [&>a]:h-7 [&>a]:rounded-[7px] [&>a]:px-[9.8px] [&>a]:leading-[14px] [&>button]:h-7 [&>button]:rounded-[7px] [&>button]:px-[9.8px] [&>button]:leading-[14px]">
        {children}
      </div>
    </header>
  );
}
