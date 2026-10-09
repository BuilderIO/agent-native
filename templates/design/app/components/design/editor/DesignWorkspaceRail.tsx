import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAssembly,
  IconFile,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSparkles,
} from "@tabler/icons-react";
import { useRef, type ReactNode } from "react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DesignLeftPanel } from "@/pages/design-editor/types";

export const INITIAL_GENERATION_DISABLED_LEFT_PANELS = new Set<DesignLeftPanel>(
  ["file", "tokens"],
);

export interface DesignWorkspaceRailAccount {
  email: string;
  name?: string;
  image?: string;
}

function AccountAvatar({ account }: { account: DesignWorkspaceRailAccount }) {
  const storedAvatarUrl = useAvatarUrl(account.email);
  const avatarUrl = storedAvatarUrl ?? account.image;
  const label = account.name?.trim() || account.email;
  return (
    <Avatar className="size-6 border border-border">
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className="bg-muted text-[11px] font-semibold text-muted-foreground">
        {label.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export function DesignWorkspaceRail({
  account,
  activePanel,
  disabledPanels,
  projectMenu,
  onPanelChange,
}: {
  account?: DesignWorkspaceRailAccount | null;
  activePanel: DesignLeftPanel | null;
  disabledPanels?: ReadonlySet<DesignLeftPanel>;
  projectMenu: ReactNode;
  onPanelChange: (panel: DesignLeftPanel | null) => void;
}) {
  const t = useT();
  const toggleLabel = t(
    activePanel
      ? "designEditor.leftRail.collapse"
      : "designEditor.leftRail.expand",
  );
  const lastPanelRef = useRef<DesignLeftPanel | null>(null);
  if (activePanel) lastPanelRef.current = activePanel;
  const items: Array<{
    panel: DesignLeftPanel;
    label: string;
    icon: ReactNode;
  }> = [
    {
      panel: "file",
      label: t("designEditor.leftRail.file"),
      icon: <IconFile className="size-5" stroke={1.5} />,
    },
    {
      panel: "agent",
      label: t("designEditor.leftRail.agent"),
      icon: <IconSparkles className="size-5" stroke={1.5} />,
    },
    {
      panel: "tokens",
      label: t("designEditor.leftRail.tokens"),
      icon: <IconAssembly className="size-5" stroke={1.5} />,
    },
  ];

  return (
    <nav
      aria-label={t("designEditor.leftRail.label")}
      data-design-chrome-region="workspace-rail"
      className="flex min-h-0 w-[var(--design-chrome-rail-width)] shrink-0 flex-col items-center border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)]"
    >
      {projectMenu ? (
        <div className="flex h-12 w-full shrink-0 items-center justify-center border-b border-[var(--design-editor-panel-divider-color)]">
          {projectMenu}
        </div>
      ) : null}
      <div className="flex min-h-0 w-full flex-col items-center overflow-y-auto overscroll-contain py-[calc(var(--design-baseline-unit)*1.5)]">
        {items.map((item) => {
          const active = item.panel === activePanel;
          const disabled = disabledPanels?.has(item.panel) ?? false;
          return (
            <Tooltip key={item.panel}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-disabled={disabled || undefined}
                  aria-current={active ? "page" : undefined}
                  tabIndex={disabled ? -1 : undefined}
                  onClick={(event) => {
                    if (disabled) {
                      event.preventDefault();
                      return;
                    }
                    onPanelChange(active ? null : item.panel);
                  }}
                  className={cn(
                    "design-workspace-rail-item group flex w-full cursor-pointer flex-col items-center gap-0.5 p-1 text-[11px] leading-4 text-foreground outline-none",
                    disabled && "cursor-default opacity-35",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md transition-colors group-focus-visible:ring-1 group-focus-visible:ring-[var(--design-editor-accent-color)]",
                      active
                        ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)]"
                        : !disabled &&
                            "group-hover:bg-[var(--design-editor-layer-hover-color)]",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="w-full truncate px-0.5 text-center">
                    {item.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex-1" />
      <div className="flex w-full shrink-0 flex-col items-center gap-1 p-2">
        {account ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-8 rounded-md"
              >
                <Link
                  to="/settings"
                  aria-label={t("designEditor.leftRail.account")}
                >
                  <AccountAvatar account={account} />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {account.name?.trim() || account.email}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label={toggleLabel}
              onClick={() => {
                if (activePanel) {
                  onPanelChange(null);
                  return;
                }
                const last = lastPanelRef.current;
                onPanelChange(
                  last && !disabledPanels?.has(last) ? last : "agent",
                );
              }}
            >
              {activePanel ? (
                <IconLayoutSidebarLeftCollapse className="size-4" />
              ) : (
                <IconLayoutSidebarLeftExpand className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}
