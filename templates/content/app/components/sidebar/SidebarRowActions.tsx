import { useT } from "@agent-native/core/client/i18n";
import { IconDots, IconPin } from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Fade a row's title under its revealed actions instead of re-truncating it,
 * so the text never shifts under the pointer. Keyed by how many 24px action
 * buttons the row reveals.
 */
export function sidebarRowTitleFadeClassName(actionCount: 1 | 2) {
  return actionCount === 1
    ? "group-hover:[mask-image:linear-gradient(to_left,transparent_1.5rem,#000_2.5rem)] group-focus-within:[mask-image:linear-gradient(to_left,transparent_1.5rem,#000_2.5rem)]"
    : "group-hover:[mask-image:linear-gradient(to_left,transparent_3rem,#000_4rem)] group-focus-within:[mask-image:linear-gradient(to_left,transparent_3rem,#000_4rem)]";
}

export const sidebarRowActionButtonClassName =
  "flex size-6 items-center justify-center rounded text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Row actions pinned to the end of a `group relative` sidebar row. They appear
 * on hover or focus and stay put while one of their menus is open.
 */
export function SidebarRowActions({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute end-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 px-0.5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100">
      {children}
    </div>
  );
}

/** A row's "…" menu; each section decides which items it offers. */
export function SidebarRowMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={sidebarRowActionButtonClassName}
          aria-label={t("sidebar.moreActionsFor", { label })}
        >
          <IconDots size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarPinMenuItem({
  pinned,
  onSelect,
}: {
  pinned: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <IconPin className="me-2 size-4" strokeWidth={pinned ? 2.2 : 1.7} />
      {pinned ? t("sidebar.unpinFromSidebar") : t("sidebar.pinToSidebar")}
    </DropdownMenuItem>
  );
}
