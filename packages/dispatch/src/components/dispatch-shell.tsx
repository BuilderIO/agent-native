import { useT } from "@agent-native/core/client";
import { IconInfoCircle } from "@tabler/icons-react";
import { type ReactNode } from "react";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * DispatchShell renders the per-page title (with an optional click-to-open
 * description popover) into the global header via the HeaderActions store.
 * The actual chrome (sidebar, AgentSidebar, header bar with AgentToggleButton)
 * is provided by `Layout` mounted in `root.tsx`.
 */
export function DispatchShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const t = useT();
  useSetPageTitle(
    <div className="flex items-center gap-2 min-w-0">
      <h1 className="text-lg font-semibold tracking-tight truncate text-foreground">
        {title}
      </h1>
      {description ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground cursor-pointer"
              aria-label={t("dispatch.sidebar.aboutPage", { title })}
            >
              <IconInfoCircle className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            className="max-w-72 text-xs leading-relaxed"
          >
            {description}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>,
  );

  return <>{children}</>;
}
