import { type ReactNode } from "react";
import { IconInfoCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useSetPageTitle } from "./HeaderActions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function PageShell({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  useSetPageTitle(
    <div className="flex min-w-0 items-center gap-2">
      <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      {description ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-pointer text-muted-foreground/60 hover:text-foreground"
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

  return (
    <div className={cn("mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6", className)}>
      {children}
    </div>
  );
}
