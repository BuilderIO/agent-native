import { useT } from "@agent-native/core/client/i18n";
import {
  IconAssembly,
  IconChevronDown,
  IconChevronUp,
  IconCode,
  IconFile,
  IconFileImport,
  IconMessage,
  IconPhoto,
  IconPuzzle,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { preloadCodeWorkbench } from "@/components/design/code-workbench/CodeWorkbenchLoader";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  SHOW_DESIGN_CODE_LEFT_PANEL,
  SHOW_DESIGN_SECONDARY_LEFT_PANELS,
  type DesignLeftPanel,
} from "@/pages/design-editor/types";

export const INITIAL_GENERATION_DISABLED_LEFT_PANELS = new Set<DesignLeftPanel>(
  ["file", "assets", "tools", "tokens", "import", "code"],
);

export function DesignWorkspaceRail({
  activePanel,
  disabledPanels,
  hiddenPanels,
  motionOpen,
  motionDisabled,
  projectMenu,
  onMotionToggle,
  onPanelChange,
}: {
  activePanel: DesignLeftPanel | null;
  disabledPanels?: ReadonlySet<DesignLeftPanel>;
  hiddenPanels?: ReadonlySet<DesignLeftPanel>;
  motionOpen?: boolean;
  motionDisabled?: boolean;
  projectMenu: ReactNode;
  onMotionToggle?: () => void;
  onPanelChange: (panel: DesignLeftPanel | null) => void;
}) {
  const t = useT();
  const items: Array<{
    panel: DesignLeftPanel;
    label: string;
    icon: ReactNode;
    separatorBefore?: boolean;
  }> = [
    {
      panel: "file",
      label: t("designEditor.leftRail.file"),
      icon: <IconFile className="size-[var(--design-icon-size)]" />,
    },
    {
      panel: "agent",
      label: t("designEditor.leftRail.agent"),
      icon: <IconMessage className="size-[var(--design-icon-size)]" />,
    },
    ...(SHOW_DESIGN_SECONDARY_LEFT_PANELS
      ? [
          {
            panel: "assets" as const,
            label: t("designEditor.leftRail.assets"),
            icon: <IconPhoto className="size-[var(--design-icon-size)]" />,
          },
        ]
      : []),
    {
      panel: "import",
      label: t("designEditor.leftRail.import"),
      icon: <IconFileImport className="size-[var(--design-icon-size)]" />,
    },
    ...(SHOW_DESIGN_SECONDARY_LEFT_PANELS
      ? [
          {
            panel: "tools" as const,
            label: t("designEditor.leftRail.tools"),
            icon: <IconPuzzle className="size-[var(--design-icon-size)]" />,
          },
          {
            panel: "tokens" as const,
            label: t("designEditor.leftRail.tokens"),
            icon: <IconAssembly className="size-[var(--design-icon-size)]" />,
          },
        ]
      : []),
    ...(SHOW_DESIGN_CODE_LEFT_PANEL
      ? [
          {
            panel: "code" as const,
            label: "Code" /* i18n-ignore */,
            icon: <IconCode className="size-[var(--design-icon-size)]" />,
            separatorBefore: true,
          },
        ]
      : []),
  ];

  return (
    <nav
      aria-label={t("designEditor.leftRail.label")}
      data-design-chrome-region="workspace-rail"
      className="flex min-h-0 w-[var(--design-chrome-rail-width)] shrink-0 flex-col items-center overflow-y-auto overscroll-contain border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] py-[var(--design-baseline-unit)]"
    >
      <div className="mb-[var(--design-baseline-unit)] flex h-[var(--design-row-height)] items-center justify-center">
        {projectMenu}
      </div>
      <div className="mb-[var(--design-baseline-unit)] h-px w-[calc(var(--design-baseline-unit)*4)] bg-border/70" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-[var(--design-baseline-unit)]">
        {items.map((item) => {
          if (hiddenPanels?.has(item.panel)) return null;
          const active = item.panel === activePanel;
          const disabled = disabledPanels?.has(item.panel) ?? false;
          return (
            <div key={item.panel} className="flex w-full flex-col items-center">
              {item.separatorBefore ? (
                <div className="-mt-1 mb-3 h-px w-8 bg-border/70" />
              ) : null}
              <Tooltip>
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
                    onPointerEnter={() => {
                      if (item.panel === "code") preloadCodeWorkbench();
                    }}
                    onFocus={() => {
                      if (item.panel === "code") preloadCodeWorkbench();
                    }}
                    className={cn(
                      "design-workspace-rail-item group flex size-[calc(var(--design-baseline-unit)*6)] cursor-pointer flex-col items-center justify-center gap-[var(--design-baseline-half)] rounded-lg font-[450] text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                      disabled
                        ? "cursor-default opacity-35"
                        : active
                          ? "bg-[var(--design-editor-selection-color)] text-foreground"
                          : "hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-[var(--design-control-height)] items-center justify-center transition-colors",
                        active
                          ? "text-[var(--design-editor-accent-color)]"
                          : "text-muted-foreground group-hover:text-foreground",
                        disabled && "group-hover:text-muted-foreground",
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="w-full truncate px-1 text-center leading-none">
                      {item.label}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
      {onMotionToggle && SHOW_DESIGN_SECONDARY_LEFT_PANELS ? (
        <div className="mt-[var(--design-baseline-unit)] flex w-full flex-col items-center border-t border-border/70 pt-[var(--design-baseline-unit)]">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={"Motion" /* i18n-ignore */}
                aria-disabled={motionDisabled || undefined}
                aria-pressed={motionOpen || undefined}
                tabIndex={motionDisabled ? -1 : undefined}
                onClick={(event) => {
                  if (motionDisabled) {
                    event.preventDefault();
                    return;
                  }
                  onMotionToggle();
                }}
                className={cn(
                  "design-workspace-rail-item group flex size-[calc(var(--design-baseline-unit)*6)] cursor-pointer flex-col items-center justify-center gap-[var(--design-baseline-half)] rounded-lg font-[450] text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  motionDisabled
                    ? "cursor-default opacity-35"
                    : motionOpen
                      ? "bg-[var(--design-editor-selection-color)] text-foreground"
                      : "hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-[var(--design-control-height)] items-center justify-center transition-colors",
                    motionOpen
                      ? "text-[var(--design-editor-accent-color)]"
                      : "text-muted-foreground group-hover:text-foreground",
                    motionDisabled && "group-hover:text-muted-foreground",
                  )}
                >
                  {motionOpen ? (
                    <IconChevronDown className="size-[var(--design-icon-size)]" />
                  ) : (
                    <IconChevronUp className="size-[var(--design-icon-size)]" />
                  )}
                </span>
                <span className="w-full truncate px-1 text-center leading-none">
                  {"Motion" /* i18n-ignore */}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {"Motion" /* i18n-ignore */}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </nav>
  );
}
