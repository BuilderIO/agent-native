import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { AgentMark } from "@agent-native/toolkit/app/shared";
import {
  IconAssembly,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessages,
  IconStack2,
  IconTimelineEvent,
} from "@tabler/icons-react";
import { useRef, type ReactNode } from "react";

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

export function DesignWorkspaceRail({
  showAccountMenu,
  activePanel,
  disabledPanels,
  motionOpen,
  onMotionToggle,
  projectMenu,
  onPanelChange,
}: {
  showAccountMenu?: boolean;
  activePanel: DesignLeftPanel | null;
  disabledPanels?: ReadonlySet<DesignLeftPanel>;
  motionOpen?: boolean;
  onMotionToggle?: () => void;
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
      label: t("designEditor.leftRail.layers"),
      icon: <IconStack2 className="size-5" stroke={1.5} />,
    },
    {
      panel: "agent",
      label: t("designEditor.leftRail.agent"),
      icon: <AgentMark className="size-5" />,
    },
    {
      panel: "tokens",
      label: t("designEditor.leftRail.tokens"),
      icon: <IconAssembly className="size-5" stroke={1.5} />,
    },
    {
      panel: "threads",
      label: t("designEditor.leftRail.threads"),
      icon: <IconMessages className="size-5" stroke={1.5} />,
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
        {onMotionToggle ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("designEditor.motion.dockLabel")}
                aria-current={motionOpen ? "page" : undefined}
                onClick={onMotionToggle}
                className="design-workspace-rail-item group flex w-full cursor-pointer flex-col items-center gap-0.5 p-1 text-[11px] leading-4 text-foreground outline-none"
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md transition-colors group-focus-visible:ring-1 group-focus-visible:ring-[var(--design-editor-accent-color)]",
                    motionOpen
                      ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)]"
                      : "group-hover:bg-[var(--design-editor-layer-hover-color)]",
                  )}
                >
                  <IconTimelineEvent className="size-5" stroke={1.5} />
                </span>
                <span className="w-full truncate px-0.5 text-center">
                  {t("designEditor.motion.dockLabel")}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("designEditor.motion.dockLabel")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex-1" />
      <div className="flex w-full shrink-0 flex-col items-center gap-1 p-2">
        {showAccountMenu ? (
          <OrgSwitcher compact hideBuilderCreditNotice />
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
