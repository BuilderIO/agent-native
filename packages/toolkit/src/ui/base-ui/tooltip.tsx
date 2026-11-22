import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import * as React from "react";

import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";

const TooltipPortal = scopePortal(BaseTooltip.Portal);

export function normalizeTooltipText(text: string): string {
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return decoded.replace(
    /\b([A-Za-z][A-Za-z ]*?)\((?=(?:⌘|⌃|⌥|⇧|Ctrl|Alt|Shift|Cmd))/g,
    (_match, label) => `${label.charAt(0).toUpperCase()}${label.slice(1)} (`,
  );
}

/**
 * Shares the open delay across the tooltips inside it, so moving from one to
 * the next opens it at once. It is Base UI's own Provider.
 *
 * @import import { TooltipProvider } from "@agent-native/toolkit/ui/base-ui/tooltip";
 */
export const TooltipProvider = BaseTooltip.Provider;

/**
 * A short label that names a control on hover or keyboard focus, on Base
 * UI's Tooltip.
 *
 * Escape closes the tooltip and carries on to whatever else that key
 * dismisses, so a tooltip on a menu trigger never costs a second Escape to
 * close the card or dialog that trigger sits in.
 *
 * @import import { Tooltip, TooltipTrigger, TooltipPopup, TooltipProvider } from "@agent-native/toolkit/ui/base-ui/tooltip";
 */
function Tooltip<Payload = unknown>({
  onOpenChange,
  ...props
}: BaseTooltip.Root.Props<Payload>) {
  return (
    <BaseTooltip.Root
      onOpenChange={(open, details) => {
        if (details.reason === "escape-key") details.allowPropagation();
        onOpenChange?.(open, details);
      }}
      {...props}
    />
  );
}

/**
 * The control the tooltip names. Compose your own with `render`.
 *
 * It opens on keyboard focus only. Focus that a closing menu, popover or dialog
 * hands back after a click is not a keyboard visit, and focus in a popup
 * portaled from inside the trigger bubbles to it through React.
 *
 * @import import { TooltipTrigger } from "@agent-native/toolkit/ui/base-ui/tooltip";
 */
const TooltipTrigger = React.forwardRef<
  HTMLButtonElement,
  BaseTooltip.Trigger.Props
>(({ onFocus, ...props }, ref) => (
  <BaseTooltip.Trigger
    ref={ref}
    onFocus={(event) => {
      onFocus?.(event);
      const focused = event.target;
      if (
        !event.currentTarget.contains(focused) ||
        !focused.matches(":focus-visible")
      ) {
        event.preventBaseUIHandler();
      }
    }}
    {...props}
  />
));
TooltipTrigger.displayName = "TooltipTrigger";

type PositionerProps = Pick<
  BaseTooltip.Positioner.Props,
  | "side"
  | "align"
  | "sideOffset"
  | "alignOffset"
  | "collisionPadding"
  | "collisionAvoidance"
  | "collisionBoundary"
  | "arrowPadding"
  | "anchor"
  | "sticky"
  | "positionMethod"
  | "disableAnchorTracking"
>;

export interface TooltipPopupProps
  extends BaseTooltip.Popup.Props, PositionerProps {
  /** Portal target. */
  container?: BaseTooltip.Portal.Props["container"];
  /** Keeps the popup mounted while closed. */
  keepMounted?: BaseTooltip.Portal.Props["keepMounted"];
}

/**
 * The tooltip's label, portaled and positioned above its trigger.
 *
 * @import import { TooltipPopup } from "@agent-native/toolkit/ui/base-ui/tooltip";
 */
const TooltipPopup = React.forwardRef<HTMLDivElement, TooltipPopupProps>(
  (
    {
      container,
      keepMounted,
      side = "top",
      align,
      sideOffset = 6,
      alignOffset,
      collisionPadding,
      collisionAvoidance,
      collisionBoundary,
      arrowPadding,
      anchor,
      sticky,
      positionMethod,
      disableAnchorTracking,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <TooltipPortal container={container} keepMounted={keepMounted}>
      <BaseTooltip.Positioner
        className="tooltip-positioner"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        collisionAvoidance={collisionAvoidance}
        collisionBoundary={collisionBoundary}
        arrowPadding={arrowPadding}
        anchor={anchor}
        sticky={sticky}
        positionMethod={positionMethod}
        disableAnchorTracking={disableAnchorTracking}
      >
        <BaseTooltip.Popup
          ref={ref}
          data-agent-native-tooltip="true"
          className={partClassName("tooltip-popup", className)}
          {...props}
        >
          {typeof children === "string"
            ? normalizeTooltipText(children)
            : children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </TooltipPortal>
  ),
);
TooltipPopup.displayName = "TooltipPopup";

export { Tooltip, TooltipTrigger, TooltipPopup };
