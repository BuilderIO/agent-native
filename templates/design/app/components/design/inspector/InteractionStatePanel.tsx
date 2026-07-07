/**
 * InteractionStatePanel — the Webflow-style element interaction-state
 * selector (Default / Hover / Focus / Focus-visible / Active / Disabled).
 *
 * Rendered at the top of the style sections when exactly one element is
 * selected (see `EditPanel`'s mount site). Selecting a non-default state:
 *   1. Visually marks the control as "editing <State>" so users can't
 *      forget they're no longer editing the element's base styling
 *      (Webflow/Framer convention — a persistent, unmissable accent, not a
 *      transient toast).
 *   2. Tells the parent via `onInteractionStateChange` so DesignEditor can
 *      force the canvas preview (phase 2 — see `shared/interaction-states.ts`
 *      module doc for the forced-preview attribute mechanism this drives).
 *   3. EditPanel then threads the active state through `StyleChangeMeta`
 *      (see EditPanel.tsx) so every style commit made while a state is
 *      active targets that state's managed CSS rule instead of the
 *      element's inline style.
 *
 * This component owns ONLY the selector UI — it has no opinion on how
 * styles are persisted. It reads `hasOverride` (per state) from the caller
 * so the row for a state that already has authored overrides can carry a
 * small accent dot, matching the rest of the app's "this control has a
 * non-default value" convention (see `StatesPanel`'s active-row dot and the
 * breakpoint override dot conventions).
 */

import { useT } from "@agent-native/core/client";
import {
  IconChevronDown,
  IconPointer,
  IconFocus2,
  IconHandClick,
  IconBan,
} from "@tabler/icons-react";
import { Fragment } from "react";

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
import { cn } from "@/lib/utils";

import type { InteractionState } from "../../../../shared/interaction-states";

export type { InteractionState };

/** `null` (or omitted) means the Default (base) state is active. */
export type ActiveInteractionState = InteractionState | null;

export interface InteractionStatePanelProps {
  /** `null` = Default. */
  activeState: ActiveInteractionState;
  onActiveStateChange: (state: ActiveInteractionState) => void;
  /**
   * Which non-default states are actually applicable to the selected
   * element. `disabled` only makes sense on form controls / buttons, for
   * example. Defaults to all five supported states when omitted so callers
   * that haven't wired element-kind detection yet still get a working
   * selector.
   */
  availableStates?: readonly InteractionState[];
  /**
   * States that already have at least one authored override, for the
   * dropdown's per-row accent dot. Does not affect availability.
   */
  statesWithOverrides?: ReadonlySet<InteractionState>;
}

const STATE_ICONS: Record<InteractionState, typeof IconPointer> = {
  hover: IconPointer,
  focus: IconFocus2,
  "focus-visible": IconFocus2,
  active: IconHandClick,
  disabled: IconBan,
};

function stateLabel(
  t: ReturnType<typeof useT>,
  state: ActiveInteractionState,
): string {
  switch (state) {
    case "hover":
      return t("editPanel.interactionStates.hover");
    case "focus":
      return t("editPanel.interactionStates.focus");
    case "focus-visible":
      return t("editPanel.interactionStates.focusVisible");
    case "active":
      return t("editPanel.interactionStates.active");
    case "disabled":
      return t("editPanel.interactionStates.disabled");
    default:
      return t("editPanel.interactionStates.default");
  }
}

const DEFAULT_AVAILABLE_STATES: readonly InteractionState[] = [
  "hover",
  "focus",
  "focus-visible",
  "active",
  "disabled",
];

export function InteractionStatePanel({
  activeState,
  onActiveStateChange,
  availableStates = DEFAULT_AVAILABLE_STATES,
  statesWithOverrides,
}: InteractionStatePanelProps) {
  const t = useT();
  const isNonDefault = activeState !== null;

  return (
    <div className="border-b border-[var(--design-editor-control-border)] px-2 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-[12px] font-semibold outline-none transition-colors",
                  isNonDefault
                    ? "bg-[var(--design-editor-accent-color)] text-white shadow-[0_0_0_1px_var(--design-editor-accent-color)]"
                    : "bg-[var(--design-editor-control-bg)] text-foreground hover:bg-[var(--design-editor-panel-raised-bg)]",
                )}
                aria-label={t("editPanel.interactionStates.selectorLabel")}
              >
                {isNonDefault ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-white"
                    aria-hidden="true"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">
                  {isNonDefault
                    ? t("editPanel.interactionStates.editingState", {
                        state: stateLabel(t, activeState),
                      })
                    : stateLabel(t, null)}
                </span>
                <IconChevronDown className="size-3.5 shrink-0 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem
                onClick={() => onActiveStateChange(null)}
                className={cn(activeState === null && "font-semibold")}
              >
                <span className="flex-1">{stateLabel(t, null)}</span>
                {activeState === null && (
                  <span className="size-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              {availableStates.map((state) => {
                const Icon = STATE_ICONS[state];
                const hasOverride = statesWithOverrides?.has(state) ?? false;
                return (
                  <DropdownMenuItem
                    key={state}
                    onClick={() => onActiveStateChange(state)}
                    className={cn(activeState === state && "font-semibold")}
                  >
                    <Icon className="mr-2 size-3.5 shrink-0" />
                    <span className="flex-1">{stateLabel(t, state)}</span>
                    {hasOverride && (
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          activeState === state
                            ? "bg-primary"
                            : "bg-[var(--design-editor-accent-color)]",
                        )}
                        aria-label={t(
                          "editPanel.interactionStates.hasOverrideIndicator",
                        )}
                      />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipTrigger>
        <TooltipContent>
          {isNonDefault
            ? t("editPanel.interactionStates.editingStateTooltip", {
                state: stateLabel(t, activeState),
              })
            : t("editPanel.interactionStates.selectorTooltip")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * PropertyRow reset/override indicator — a small accent dot placed next to
 * any style-section field row that has a declared override in the active
 * interaction state, plus a reset button that clears just that property.
 * Follows the same "dot + reset" shape as the breakpoint-override indicator
 * convention (`getBreakpointOverrideState` callers elsewhere in EditPanel).
 *
 * Usage: wrap or place inline next to a field's label when
 * `hasOverride` is true. `onReset` should call the shared
 * `removeStateProperty` helper (via the parent's style-change plumbing) for
 * that property/state.
 */
export function InteractionStateOverrideIndicator({
  hasOverride,
  onReset,
}: {
  hasOverride: boolean;
  onReset?: () => void;
}) {
  const t = useT();
  if (!hasOverride) return null;
  return (
    <Fragment>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="ml-1 inline-block size-1.5 shrink-0 rounded-full bg-[var(--design-editor-accent-color)]"
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipContent>
          {t("editPanel.interactionStates.hasOverrideIndicator")}
        </TooltipContent>
      </Tooltip>
      {onReset ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onReset}
              className="ml-0.5 cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground"
              aria-label={t("editPanel.interactionStates.resetOverride")}
            >
              {t("editPanel.interactionStates.reset")}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t("editPanel.interactionStates.resetOverrideTooltip")}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </Fragment>
  );
}
