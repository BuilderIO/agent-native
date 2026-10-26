import { useT } from "@agent-native/core/client/i18n";
import { IconMenu2 } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MobileAppBarProps {
  onOpenNavigation: () => void;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * The one 48px bar above a route. The menu button only shows below md, where
 * the sidebar lives in a sheet.
 */
export function MobileAppBar({
  onOpenNavigation,
  title,
  actions,
  className,
}: MobileAppBarProps) {
  const t = useT();

  return (
    <header
      data-mobile-app-bar=""
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={onOpenNavigation}
        aria-label={t("navigation.openNavigation")}
      >
        <IconMenu2 className="size-4" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center truncate text-sm font-medium">
        {title}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}
