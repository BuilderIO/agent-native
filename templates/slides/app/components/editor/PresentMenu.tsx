import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconPlayerPlay } from "@tabler/icons-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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
import { isMacPlatform } from "@/lib/utils";

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
    request: Omit<PresentRequest, "preserveNativeNavigation">,
  ) => {
    if (event.button !== 0 && event.button !== 1) return;
    const preserveNativeNavigation =
      event.button === 1 ||
      (event.button === 0 &&
        (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey));
    if (preserveNativeNavigation) {
      if (
        onPresent?.({ ...request, preserveNativeNavigation: true }) === true
      ) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    onPresent?.(request);
  };

  const presentLink = (
    request: { mode: PresentMode; fromBeginning?: true },
    label: string,
  ) => (
    <DropdownMenuItem asChild className="cursor-pointer">
      <Link
        to={buildPresentUrl(
          deckId,
          request.fromBeginning ? 0 : currentSlideIndex,
          request.mode,
        )}
        onClick={
          onPresent ? (event) => handleLinkClick(event, request) : undefined
        }
        onAuxClick={
          onPresent ? (event) => handleLinkClick(event, request) : undefined
        }
      >
        {label}
      </Link>
    </DropdownMenuItem>
  );

  // Play presents at once, the way every deck tool does; the chevron holds
  // the other ways to present.
  const fullscreenUrl = buildPresentUrl(
    deckId,
    currentSlideIndex,
    "fullscreen",
  );

  return (
    <ButtonGroup className="flex-shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          {hasSlides ? (
            <Button asChild size="sm" className="px-2.5">
              <Link
                to={fullscreenUrl}
                aria-label={t("editorToolbar.present")}
                onClick={
                  onPresent
                    ? (event) => handleLinkClick(event, { mode: "fullscreen" })
                    : undefined
                }
                onAuxClick={
                  onPresent
                    ? (event) => handleLinkClick(event, { mode: "fullscreen" })
                    : undefined
                }
              >
                <IconPlayerPlay aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled
              className="px-2.5"
              aria-label={t("editorToolbar.present")}
            >
              <IconPlayerPlay aria-hidden="true" />
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent>
          {t("editorToolbar.presentWithShortcut", {
            shortcut: isMacPlatform() ? "\u2318\u21b5" : "Ctrl+Enter",
          })}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                disabled={!hasSlides}
                className="px-1.5"
                aria-label={t("editorToolbar.presentOptions")}
              >
                <IconChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("editorToolbar.presentOptions")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-60">
          {presentLink(
            { mode: "fullscreen" },
            t("editorToolbar.presentFullScreen"),
          )}
          {presentLink(
            { mode: "fullscreen", fromBeginning: true },
            t("editorToolbar.presentFromBeginning"),
          )}
          {presentLink({ mode: "window" }, t("editorToolbar.presentInTab"))}
          <DropdownMenuItem
            className="cursor-pointer flex-col items-start gap-0"
            onSelect={() => onPresent?.({ mode: "presenter" })}
          >
            <span>{t("editorToolbar.presentPresenterView")}</span>
            <span className="text-xs text-muted-foreground">
              {t("editorToolbar.presentPresenterViewDescription")}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
