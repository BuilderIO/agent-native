import { useT } from "@agent-native/core/client/i18n";
import type { CSSProperties, ReactNode } from "react";

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
  center,
  zoomControl,
  presence,
  actions,
  leftInset,
  narrowLeftInset,
  inspectorWidth,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  /** Modes to offer, in `EDITOR_TOP_BAR_MODES` order. */
  modes?: readonly EditorMode[];
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
}) {
  const t = useT();
  const visibleModes = EDITOR_TOP_BAR_MODES.filter((entry) =>
    modes.includes(entry.mode),
  );
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
      className="absolute left-[var(--top-bar-left-narrow)] right-0 top-0 z-[60] grid h-12 grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center gap-1 overflow-hidden border-b border-border bg-[var(--design-editor-panel-bg)] p-2 transition-[left] duration-150 ease-out motion-reduce:transition-none sm:gap-2 md:left-[var(--top-bar-left)]"
    >
      <div className="flex min-w-0 items-center">
        {visibleModes.length > 0 ? (
          <div
            role="group"
            aria-label={t("designEditor.topBar.modeSwitch")}
            data-design-mode-switch
            className="flex shrink-0 items-center rounded-lg bg-muted p-0.5"
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
      </div>
      <div
        data-design-top-bar-center
        className="flex min-w-0 items-center justify-center"
      >
        {center}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {zoomControl ? (
          <div className="hidden shrink-0 items-center sm:flex">
            {zoomControl}
          </div>
        ) : null}
        <div
          data-design-top-bar-inspector-zone
          className={cn(
            "flex min-w-0 shrink-0 items-center justify-end gap-3",
            inspectorWidth !== undefined &&
              "lg:min-w-[calc(var(--top-bar-inspector)-8px)]",
          )}
        >
          {presence ? (
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
