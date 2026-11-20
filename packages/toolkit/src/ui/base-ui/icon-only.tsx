import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import * as React from "react";

/**
 * True inside a container that shows its controls as icons only, like a
 * collapsed sidebar. Parts that read it keep their label as the control's
 * name and show it beside the control in a tooltip instead.
 */
const IconOnlyContext = React.createContext(false);

/**
 * Marks its children as shown icon-only, as a collapsed sidebar does, so the
 * parts inside name themselves in tooltips.
 *
 * @import import { IconOnlyProvider } from "@agent-native/toolkit/ui/base-ui/icon-only";
 */
export const IconOnlyProvider = IconOnlyContext.Provider;

export function useIconOnly(): boolean {
  return React.useContext(IconOnlyContext);
}

/**
 * Names an icon-only control beside it, on hover and focus, on Base UI's
 * Tooltip.
 *
 * @import import { IconOnlyTooltip } from "@agent-native/toolkit/ui/base-ui/icon-only";
 */
export function IconOnlyTooltip({
  trigger,
  children,
}: {
  trigger: React.ReactElement;
  children: React.ReactNode;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={trigger} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          className="tooltip-positioner"
          side="right"
          sideOffset={8}
        >
          <BaseTooltip.Popup className="tooltip-popup">
            {children}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
