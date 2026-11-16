import { Item } from "@agent-native/toolkit/ui/item";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";

import { cn } from "../lib/utils";

type AppListLayout = "list" | "grid";

const AppListLayoutContext = createContext<AppListLayout>("list");

/**
 * `grid` is the two-column app list on Home, New chat, All apps and the
 * catalogs; its rows are shadcn `Item`s. `list` is a bordered, divided list.
 */
export function AppList({
  children,
  className,
  layout = "list",
}: {
  children: ReactNode;
  className?: string;
  layout?: AppListLayout;
}) {
  return (
    <AppListLayoutContext.Provider value={layout}>
      <div
        className={cn(
          layout === "grid"
            ? "grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
            : "overflow-hidden rounded-2xl",
          className,
        )}
      >
        {children}
      </div>
    </AppListLayoutContext.Provider>
  );
}

/** One app in a grid app list. */
export function AppGridItem({
  className,
  ...props
}: ComponentProps<typeof Item>) {
  return (
    <Item
      variant="muted"
      size="sm"
      className={cn(
        "group min-w-0 flex-nowrap focus-within:border-ring/50",
        className,
      )}
      {...props}
    />
  );
}

export function AppListRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const layout = useContext(AppListLayoutContext);
  if (layout === "grid") {
    return <AppGridItem className={className}>{children}</AppGridItem>;
  }
  return (
    <div
      className={cn(
        "group flex min-w-0 items-center gap-3 border-b px-4 py-3.5 last:border-b-0 transition-[background-color,border-color] focus-within:bg-muted/30",
        className,
      )}
    >
      {children}
    </div>
  );
}
