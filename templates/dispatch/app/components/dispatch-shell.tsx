import { type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

/**
 * DispatchShell renders the per-page title (with optional description tooltip)
 * into the global header via the HeaderActions store. The actual chrome
 * (sidebar, AgentSidebar, header bar with AgentToggleButton) is provided by
 * `Layout` mounted in `root.tsx`.
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
  useSetPageTitle(
    <div className="flex items-center gap-2 min-w-0">
      <h1 className="text-lg font-semibold tracking-tight truncate text-foreground">
        {title}
      </h1>
      {description ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground/60 hover:text-foreground cursor-pointer"
              aria-label={`About ${title}`}
            >
              <IconInfoCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-72 text-xs leading-relaxed"
          >
            {description}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>,
  );

  return <>{children}</>;
}
