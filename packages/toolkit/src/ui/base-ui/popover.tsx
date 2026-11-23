import {
  type PopoverPopupOwnProps,
  popoverPopupProps,
} from "@agent-native/design-system";
import { Popover as BasePopover } from "@base-ui/react/popover";
import * as React from "react";

import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";

const PopoverPortal = scopePortal(BasePopover.Portal);

/**
 * A floating panel that opens from a button for related content or controls, on
 * Base UI's Popover. Root, Trigger and Close are Base UI's own parts.
 *
 * @import import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle, PopoverDescription, PopoverClose } from "@agent-native/toolkit/ui/base-ui/popover";
 */
export const Popover = BasePopover.Root;

/**
 * The button that opens the popover. Compose your own button with `render`.
 *
 * @import import { PopoverTrigger } from "@agent-native/toolkit/ui/base-ui/popover";
 */
export const PopoverTrigger = BasePopover.Trigger;

/**
 * A button that closes the popover it sits in. Compose your own with `render`.
 *
 * @import import { PopoverClose } from "@agent-native/toolkit/ui/base-ui/popover";
 */
export const PopoverClose = BasePopover.Close;

type PositionerProps = Pick<
  BasePopover.Positioner.Props,
  | "anchor"
  | "side"
  | "align"
  | "sideOffset"
  | "alignOffset"
  | "collisionBoundary"
  | "collisionPadding"
  | "collisionAvoidance"
  | "sticky"
  | "arrowPadding"
  | "disableAnchorTracking"
  | "positionMethod"
>;

type PopoverPopupProps = BasePopover.Popup.Props &
  PositionerProps &
  PopoverPopupOwnProps & {
    /** Where the popover mounts; the document body by default. */
    container?: BasePopover.Portal.Props["container"];
    /** Keep the popup in the DOM while closed. */
    keepMounted?: boolean;
  };

/**
 * The popover's panel, portaled and positioned beside its trigger or anchor. It
 * is Base UI's Popover Popup with Radix Themes' sizes.
 *
 * @import import { PopoverPopup } from "@agent-native/toolkit/ui/base-ui/popover";
 */
const PopoverPopup = React.forwardRef<HTMLDivElement, PopoverPopupProps>(
  (props, ref) => {
    const [attributes, { className, container, keepMounted, ...rest }] =
      splitProps(popoverPopupProps, props);
    const [positioner, popup] = splitPositionerProps(rest);
    return (
      <PopoverPortal container={container} keepMounted={keepMounted}>
        <BasePopover.Positioner
          className="popover-positioner"
          align="center"
          sideOffset={4}
          {...positioner}
        >
          <BasePopover.Popup
            ref={ref}
            data-slot="popover-content"
            className={partClassName("popover-popup", className)}
            {...popup}
            {...attributes}
          />
        </BasePopover.Positioner>
      </PopoverPortal>
    );
  },
);
PopoverPopup.displayName = "PopoverPopup";

/**
 * The popover's heading, which also names it for assistive technology.
 *
 * @import import { PopoverTitle } from "@agent-native/toolkit/ui/base-ui/popover";
 */
const PopoverTitle = React.forwardRef<
  HTMLHeadingElement,
  BasePopover.Title.Props
>(({ className, ...props }, ref) => (
  <BasePopover.Title
    ref={ref}
    className={partClassName("popover-title", className)}
    {...props}
  />
));
PopoverTitle.displayName = "PopoverTitle";

/**
 * A sentence under the title that the popover is described by.
 *
 * @import import { PopoverDescription } from "@agent-native/toolkit/ui/base-ui/popover";
 */
const PopoverDescription = React.forwardRef<
  HTMLParagraphElement,
  BasePopover.Description.Props
>(({ className, ...props }, ref) => (
  <BasePopover.Description
    ref={ref}
    className={partClassName("popover-description", className)}
    {...props}
  />
));
PopoverDescription.displayName = "PopoverDescription";

/**
 * An arrow on the panel's edge that points at the trigger.
 *
 * @import import { PopoverArrow } from "@agent-native/toolkit/ui/base-ui/popover";
 */
const PopoverArrow = React.forwardRef<HTMLDivElement, BasePopover.Arrow.Props>(
  ({ className, ...props }, ref) => (
    <BasePopover.Arrow
      ref={ref}
      className={partClassName("popover-arrow", className)}
      {...props}
    />
  ),
);
PopoverArrow.displayName = "PopoverArrow";

export {
  PopoverArrow,
  PopoverPopup,
  PopoverDescription,
  PopoverTitle,
  type PopoverPopupProps,
};
