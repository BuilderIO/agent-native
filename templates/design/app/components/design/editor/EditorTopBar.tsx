import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { EditorMode } from "@/pages/design-editor/types";

type TopBarModeDefinition = {
  mode: EditorMode;
  labelKey: string;
};

/**
 * Every mode the switch can show, in display order. The switch is built from
 * this list so a mode (Code, later) is one entry here rather than new JSX.
 * `edit` is shown as "Design"; the internal value stays `edit`.
 */
export const EDITOR_TOP_BAR_MODES: readonly TopBarModeDefinition[] = [
  { mode: "interact", labelKey: "designEditor.modes.interact" },
  { mode: "edit", labelKey: "designEditor.topBar.modeDesign" },
  { mode: "annotate", labelKey: "designEditor.modes.annotate" },
];

export function EditorTopBar({
  mode,
  onModeChange,
  modes = EDITOR_TOP_BAR_MODES.map((entry) => entry.mode),
  leading,
  center,
  zoomControl,
  presence,
  actions,
  leftInset,
  narrowLeftInset,
  inspectorWidth,
  widgetLayout = false,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  /** Modes to offer, in `EDITOR_TOP_BAR_MODES` order. */
  modes?: readonly EditorMode[];
  /** Mode-specific controls beside the mode switch (Interact's device and theme). */
  leading?: ReactNode;
  /** Route / URL controls. Empty until a mode needs it. */
  center?: ReactNode;
  zoomControl?: ReactNode;
  presence?: ReactNode;
  actions?: ReactNode;
  /** Width of the rail plus open left panel; the bar starts at the canvas column. */
  leftInset: number;
  /** Left inset below `md`, where the left panel overlays the canvas. */
  narrowLeftInset: number;
  /** Docked inspector width; presence and actions span it. Omit when it is hidden. */
  inspectorWidth?: number;
  /** Keep the title, Share, mode switch, and zoom inside a narrow MCP widget. */
  widgetLayout?: boolean;
}) {
  const t = useT();
  const visibleModes = EDITOR_TOP_BAR_MODES.filter((entry) =>
    modes.includes(entry.mode),
  );
  const activeMode = visibleModes.find((entry) => entry.mode === mode);
  return (
    <div
      data-design-top-bar
      data-design-chrome-region="top-bar"
      style={
        {
          "--top-bar-left": `${leftInset}px`,
          "--top-bar-left-narrow": `${narrowLeftInset}px`,
          "--top-bar-inspector": `${inspectorWidth ?? 0}px`,
        } as CSSProperties
      }
      className={cn(
        "absolute left-[var(--top-bar-left-narrow)] right-0 top-0 z-[60] grid h-12 items-center overflow-hidden border-b border-border bg-[var(--design-editor-panel-bg)] transition-[left] duration-150 ease-out motion-reduce:transition-none md:left-[var(--top-bar-left)]",
        widgetLayout
          ? "grid-cols-[max-content_minmax(0,1fr)_max-content] gap-1 px-1.5 py-2 sm:px-2"
          : "grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] gap-1 overscroll-x-contain p-2 max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden sm:gap-2",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {visibleModes.length > 0 ? (
          <div
            role="group"
            aria-label={t("designEditor.topBar.modeSwitch")}
            data-design-mode-switch
            className={cn(
              "shrink-0 items-center rounded-lg bg-muted p-0.5",
              widgetLayout ? "hidden min-[640px]:flex" : "flex",
            )}
          >
            {visibleModes.map((entry) => {
              const active = entry.mode === mode;
              return (
                <button
                  key={entry.mode}
                  type="button"
                  data-design-mode={entry.mode}
                  aria-pressed={active}
                  onClick={() => onModeChange(entry.mode)}
                  className={cn(
                    "flex h-5 cursor-pointer items-center rounded-md px-1.5 text-xs font-medium leading-4 sm:px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(entry.labelKey)}
                </button>
              );
            })}
          </div>
        ) : null}
        {widgetLayout && visibleModes.length > 0 ? (
          <div
            data-design-widget-mode-switch
            className="flex min-w-0 items-center min-[640px]:hidden"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("designEditor.topBar.modeSwitch")}
                  data-design-widget-mode-trigger
                  className="flex h-7 max-w-[6.5rem] min-w-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {activeMode ? t(activeMode.labelKey) : null}
                  </span>
                  <IconChevronDown className="size-3 shrink-0 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="design-editor-app-menu-content min-w-[9rem]"
              >
                <DropdownMenuRadioGroup
                  value={mode}
                  onValueChange={(value) => {
                    const nextMode = visibleModes.find(
                      (entry) => entry.mode === value,
                    );
                    if (nextMode) onModeChange(nextMode.mode);
                  }}
                >
                  {visibleModes.map((entry) => (
                    <DropdownMenuRadioItem
                      key={entry.mode}
                      value={entry.mode}
                      data-widget-design-mode={entry.mode}
                    >
                      {t(entry.labelKey)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        {leading}
      </div>
      <div
        data-design-top-bar-center
        className={cn(
          "flex min-w-0 items-center justify-center",
          widgetLayout && "w-full px-1",
        )}
      >
        {center}
      </div>
      <div
        className={cn(
          "flex min-w-0 items-center justify-end",
          widgetLayout ? "gap-1.5" : "gap-2",
        )}
      >
        {zoomControl ? (
          <div
            className={cn(
              "shrink-0 items-center",
              widgetLayout ? "flex" : "hidden sm:flex",
            )}
          >
            {zoomControl}
          </div>
        ) : null}
        <div
          data-design-top-bar-inspector-zone
          className={cn(
            "flex min-w-0 shrink-0 items-center justify-end gap-3",
            !widgetLayout &&
              inspectorWidth !== undefined &&
              "lg:min-w-[calc(var(--top-bar-inspector)-8px)]",
          )}
        >
          {presence && !widgetLayout ? (
            <div className="hidden shrink-0 items-center lg:flex">
              {presence}
            </div>
          ) : null}
          {actions ? (
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
