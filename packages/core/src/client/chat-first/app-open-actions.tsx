import { cn } from "@agent-native/toolkit";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  IconAppWindow,
  IconChevronDown,
  IconExternalLink,
  IconPlus,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

export const APP_ACTION_MENU_CONTENT_CLASS = "w-48";

export interface AppOpenActionLabels {
  addApp: string;
  openApp: string;
  openInline: string;
  openInNewTab: string;
}

export interface AppOpenActionMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

const DEFAULT_LABELS: AppOpenActionLabels = {
  addApp: "Add app",
  openApp: "Open app",
  openInline: "Open inline",
  openInNewTab: "Open in new tab",
};

export function AppOpenActions({
  name,
  href,
  target,
  rel,
  labels: labelOverrides,
  onAddApp,
  onOpen,
  onOpenInline,
  showInlineOption = false,
  showNewTabOption = false,
  menuItems,
  className,
}: {
  name: string;
  href?: string | null;
  target?: "_blank";
  rel?: string;
  labels?: Partial<AppOpenActionLabels>;
  onAddApp?: () => void;
  onOpen?: () => void;
  onOpenInline?: () => void;
  showInlineOption?: boolean;
  showNewTabOption?: boolean;
  menuItems?: readonly AppOpenActionMenuItem[];
  className?: string;
}) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const primaryUsesHref = Boolean(href) && !onOpen;
  const canOfferNewTab = Boolean(href) && showNewTabOption;
  const hasMenu =
    Boolean(onAddApp) ||
    (Boolean(href) && (Boolean(onOpenInline) || canOfferNewTab)) ||
    Boolean(menuItems?.length);
  const canOpen = primaryUsesHref || Boolean(onOpen);

  if (!canOpen && !hasMenu) {
    return (
      <Button size="sm" variant="outline" disabled>
        {labels.openApp}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "app-open-actions flex shrink-0 overflow-hidden rounded-md border border-border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        className,
      )}
    >
      <Button
        asChild={primaryUsesHref}
        size="sm"
        variant="outline"
        className="app-open-actions__primary h-7 rounded-none border-0 border-e border-border px-0 pe-2 ps-3 text-xs"
        disabled={!canOpen}
        onClick={onOpen}
        type={primaryUsesHref ? undefined : "button"}
        aria-label={!primaryUsesHref ? `Open ${name}` : undefined}
      >
        {primaryUsesHref ? (
          <a href={href ?? undefined} target={target} rel={rel}>
            {labels.openApp}
          </a>
        ) : (
          <span>{labels.openApp}</span>
        )}
      </Button>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="app-open-actions__menu size-7 rounded-none border-0 p-0 text-xs"
              aria-label={`Open options for ${name}`}
            >
              <IconChevronDown size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={APP_ACTION_MENU_CONTENT_CLASS}
          >
            {onAddApp ? (
              <DropdownMenuItem onSelect={onAddApp}>
                <IconPlus size={14} aria-hidden="true" />
                {labels.addApp}
              </DropdownMenuItem>
            ) : null}
            {showInlineOption && href && onOpenInline ? (
              <DropdownMenuItem onSelect={onOpenInline}>
                <IconAppWindow size={14} aria-hidden="true" />
                {labels.openInline}
              </DropdownMenuItem>
            ) : null}
            {canOfferNewTab && href ? (
              <DropdownMenuItem asChild>
                <a href={href ?? undefined} target="_blank" rel="noreferrer">
                  <IconExternalLink size={14} aria-hidden="true" />
                  {labels.openInNewTab}
                </a>
              </DropdownMenuItem>
            ) : null}
            {menuItems?.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={item.onSelect}>
                {item.icon ? (
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                  >
                    {item.icon}
                  </span>
                ) : null}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
