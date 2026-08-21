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
  activePanel: DesignLeftPanel;
  disabledPanels?: ReadonlySet<DesignLeftPanel>;
  hiddenPanels?: ReadonlySet<DesignLeftPanel>;
  motionOpen?: boolean;
  motionDisabled?: boolean;
  projectMenu: ReactNode;
  onMotionToggle?: () => void;
  onPanelChange: (panel: DesignLeftPanel) => void;
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
      icon: <IconFile className="size-[15px]" />,
    },
    {
      panel: "agent",
      label: t("designEditor.leftRail.agent"),
      icon: <IconMessage className="size-[15px]" />,
    },
    ...(SHOW_DESIGN_SECONDARY_LEFT_PANELS
      ? [
          {
            panel: "assets" as const,
            label: t("designEditor.leftRail.assets"),
            icon: <IconPhoto className="size-[15px]" />,
          },
        ]
      : []),
    {
      panel: "import",
      label: t("designEditor.leftRail.import"),
      icon: <IconFileImport className="size-[15px]" />,
    },
    ...(SHOW_DESIGN_SECONDARY_LEFT_PANELS
      ? [
          {
            panel: "tools" as const,
            label: t("designEditor.leftRail.tools"),
            icon: <IconPuzzle className="size-[15px]" />,
          },
          {
            panel: "tokens" as const,
            label: t("designEditor.leftRail.tokens"),
            icon: <IconAssembly className="size-[15px]" />,
          },
        ]
      : []),
    ...(SHOW_DESIGN_CODE_LEFT_PANEL
      ? [
          {
            panel: "code" as const,
            label: "Code" /* i18n-ignore */,
            icon: <IconCode className="size-[15px]" />,
            separatorBefore: true,
          },
        ]
      : []),
  ];

  return (
    <nav
      aria-label={t("designEditor.leftRail.label")}
      className="flex min-h-0 w-[57px] shrink-0 flex-col items-center overflow-y-auto overscroll-contain border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] py-3"
    >
      <div className="mb-3 flex h-8 items-center justify-center">
        {projectMenu}
      </div>
      <div className="mb-5 h-px w-8 bg-border/70" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4">
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
                      onPanelChange(item.panel);
                    }}
                    onPointerEnter={() => {
                      if (item.panel === "code") preloadCodeWorkbench();
                    }}
                    onFocus={() => {
                      if (item.panel === "code") preloadCodeWorkbench();
                    }}
                    className={cn(
                      "group flex w-12 cursor-pointer flex-col items-center justify-start gap-1 rounded-none text-[10px] font-[450] leading-none text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                      disabled &&
                        "cursor-default opacity-35 hover:text-muted-foreground",
                      active && "text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg transition-colors",
                        active
                          ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)]"
                          : "text-muted-foreground group-hover:bg-[var(--design-editor-layer-hover-color)] group-hover:text-foreground",
                        disabled &&
                          "group-hover:bg-transparent group-hover:text-muted-foreground",
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="max-w-full truncate leading-none">
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
      {onMotionToggle ? (
        <div className="mt-4 flex w-full flex-col items-center border-t border-border/70 pt-3">
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
                  "group flex w-12 cursor-pointer flex-col items-center justify-start gap-1 rounded-none !text-[10px] font-[450] leading-none text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  motionDisabled &&
                    "cursor-default opacity-35 hover:text-muted-foreground",
                  motionOpen && "text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-colors",
                    motionOpen
                      ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)]"
                      : "text-muted-foreground group-hover:bg-[var(--design-editor-layer-hover-color)] group-hover:text-foreground",
                    motionDisabled &&
                      "group-hover:bg-transparent group-hover:text-muted-foreground",
                  )}
                >
                  {motionOpen ? (
                    <IconChevronDown className="size-[15px]" />
                  ) : (
                    <IconChevronUp className="size-[15px]" />
                  )}
                </span>
                <span className="max-w-full truncate leading-none">
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
