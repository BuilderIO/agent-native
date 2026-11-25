import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconFileText } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const LOADING_ROWS = 3;

export function CitedInMenu({ dashboardId }: { dashboardId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const returningFocus = useRef(false);
  const { data, isError } = useActionQuery(
    "list-dashboard-citations",
    { dashboardId },
    { enabled: open, staleTime: 60_000, retry: 1 },
  );
  const label = t("citedIn.menu");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip
        open={tooltipOpen}
        onOpenChange={(next) => setTooltipOpen(next && !returningFocus.current)}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              aria-label={label}
            >
              <IconFileText className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{label}</span>
              <IconChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("citedIn.menuTooltip")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
        onCloseAutoFocus={() => {
          returningFocus.current = true;
          queueMicrotask(() => {
            returningFocus.current = false;
          });
        }}
      >
        {isError || data?.status === "unavailable" ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {t("citedIn.unavailable")}
          </p>
        ) : !data ? (
          <div aria-busy="true" className="p-1">
            {Array.from({ length: LOADING_ROWS }, (_, index) => (
              <div
                key={index}
                data-testid="cited-in-loading-row"
                className="flex items-center gap-2 px-2 py-1.5"
              >
                <Skeleton className="h-4 w-4 shrink-0 rounded" />
                <Skeleton className="h-3.5 flex-1" />
              </div>
            ))}
          </div>
        ) : data.pages.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {data.more ? t("citedIn.more") : t("citedIn.empty")}
          </p>
        ) : (
          <>
            {data.pages.map((page) => (
              <DropdownMenuItem key={page.id} asChild>
                <a href={page.url} target="_blank" rel="noopener noreferrer">
                  <IconFileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    {page.title.trim() || t("citedIn.untitledPage")}
                  </span>
                </a>
              </DropdownMenuItem>
            ))}
            {data.more ? (
              <p className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
                {t("citedIn.more")}
              </p>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
