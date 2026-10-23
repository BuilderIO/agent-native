import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrowser,
  IconChevronDown,
  IconDeviceDesktop,
  IconNotes,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildPresentUrl,
  type PresentMode,
  type PresentRequest,
} from "@/lib/deck-present-url";

export function PresentMenu({
  deckId,
  currentSlideIndex,
  hasSlides,
  onPresent,
}: {
  deckId: string;
  currentSlideIndex: number;
  hasSlides: boolean;
  onPresent?: (request?: PresentRequest) => boolean | void;
}) {
  const t = useT();

  // A plain click saves first and then navigates in the app; a modified or
  // middle click keeps the browser's own new-tab behavior.
  const handleLinkClick = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    mode: PresentMode,
  ) => {
    if (event.button !== 0 && event.button !== 1) return;
    const preserveNativeNavigation =
      event.button === 1 ||
      (event.button === 0 &&
        (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey));
    if (preserveNativeNavigation) {
      if (onPresent?.({ preserveNativeNavigation: true, mode }) === true) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    onPresent?.({ mode });
  };

  const presentLink = (mode: PresentMode, label: string, icon: ReactNode) => (
    <DropdownMenuItem asChild className="cursor-pointer">
      <Link
        to={buildPresentUrl(deckId, currentSlideIndex, mode)}
        onClick={
          onPresent ? (event) => handleLinkClick(event, mode) : undefined
        }
        onAuxClick={
          onPresent ? (event) => handleLinkClick(event, mode) : undefined
        }
      >
        {icon}
        {label}
      </Link>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              disabled={!hasSlides}
              className="flex-shrink-0 gap-1 px-2.5"
              aria-label={t("editorToolbar.present")}
            >
              <IconPlayerPlay aria-hidden="true" />
              <IconChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("editorToolbar.present")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        {presentLink(
          "window",
          t("editorToolbar.presentInTab"),
          <IconBrowser className="size-4" />,
        )}
        {presentLink(
          "fullscreen",
          t("editorToolbar.presentFullScreen"),
          <IconDeviceDesktop className="size-4" />,
        )}
        <DropdownMenuItem
          className="cursor-pointer items-start gap-2"
          onSelect={() => onPresent?.({ mode: "presenter" })}
        >
          <IconNotes className="mt-0.5 size-4" />
          <span className="flex flex-col">
            <span>{t("editorToolbar.presentPresenterView")}</span>
            <span className="text-xs text-muted-foreground">
              {t("editorToolbar.presentPresenterViewDescription")}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
