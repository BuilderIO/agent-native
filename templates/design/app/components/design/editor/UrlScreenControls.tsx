import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink, IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UrlScreen } from "@/pages/design-editor/derive/url-screen";

import {
  TOP_BAR_ICON_BUTTON_CLASS,
  TopBarIconAction,
  TopBarRouteLabel,
  TopBarStatusDot,
} from "./top-bar-controls";

/**
 * The top bar's centre while a URL screen is active in Design: the screen's
 * name and route, Reload, and Open in browser. It is a reading, not a picker:
 * switching screens from here has no Design-mode path today.
 */
export function UrlScreenControls({
  screen,
  onReload,
  className,
}: {
  screen: UrlScreen;
  onReload: () => void;
  className?: string;
}) {
  const t = useT();
  const openLabel = t("designEditor.topBar.openInBrowser");
  return (
    <div
      data-design-url-screen-controls
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <span
        data-design-url-screen-route
        title={screen.url}
        className="flex h-6 w-66 min-w-24 max-w-full shrink items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-foreground"
      >
        <TopBarStatusDot />
        <TopBarRouteLabel title={screen.title} route={screen.route} />
      </span>
      <div className="hidden shrink-0 items-center sm:flex">
        <TopBarIconAction
          label={t("designEditor.responsiveInteract.reload")}
          onClick={onReload}
        >
          <IconRefresh className="size-4" />
        </TopBarIconAction>
        <Tooltip>
          <TooltipTrigger asChild>
            {screen.openUrl ? (
              <Button
                asChild
                type="button"
                variant="ghost"
                size="icon"
                className={TOP_BAR_ICON_BUTTON_CLASS}
              >
                <a
                  data-design-url-screen-open
                  href={screen.openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={openLabel}
                >
                  <IconExternalLink className="size-4" />
                </a>
              </Button>
            ) : (
              <span tabIndex={0} className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled
                  aria-label={openLabel}
                  className={TOP_BAR_ICON_BUTTON_CLASS}
                >
                  <IconExternalLink className="size-4" />
                </Button>
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom">{openLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
