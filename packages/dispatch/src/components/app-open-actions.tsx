import { IconChevronDown, IconPlus } from "@tabler/icons-react";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export interface AppOpenActionLabels {
  addApp: string;
  openApp: string;
  openInline: string;
  openInNewTab: string;
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
  onOpenInline,
  showInlineOption = false,
  showNewTabOption = false,
}: {
  name: string;
  href: string | null;
  target?: "_blank";
  rel?: string;
  labels?: Partial<AppOpenActionLabels>;
  onAddApp?: () => void;
  onOpenInline?: () => void;
  showInlineOption?: boolean;
  showNewTabOption?: boolean;
}) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const hasMenu =
    Boolean(onAddApp) ||
    (Boolean(href) && (showInlineOption || showNewTabOption));

  if (!href && !hasMenu) {
    return (
      <Button size="sm" variant="outline" disabled>
        {labels.openApp}
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <Button
        asChild={Boolean(href)}
        size="sm"
        variant="outline"
        className="rounded-none border-0 border-e border-border"
        disabled={!href}
      >
        {href ? (
          <a href={href} target={target} rel={rel}>
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
              className="size-9 rounded-none border-0 p-0"
              aria-label={`Open options for ${name}`}
            >
              <IconChevronDown size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {onAddApp ? (
              <DropdownMenuItem onSelect={onAddApp}>
                <IconPlus size={14} className="mr-2" />
                {labels.addApp}
              </DropdownMenuItem>
            ) : null}
            {showInlineOption && href ? (
              <DropdownMenuItem onSelect={onOpenInline}>
                {labels.openInline}
              </DropdownMenuItem>
            ) : null}
            {showNewTabOption && href ? (
              <DropdownMenuItem asChild>
                <a href={href} target="_blank" rel="noreferrer">
                  {labels.openInNewTab}
                </a>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
