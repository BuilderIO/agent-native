import {
  type PopoverContentOwnProps,
  popoverContentProps,
} from "@agent-native/design-system";
import { Popover as BasePopover } from "@base-ui/react/popover";
import * as React from "react";

import { cn } from "../../utils.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";

// Base UI's parts are exported where they are declared: through the export
// list, docgen documents Base UI's own component and drops these comments.

/**
 * A floating panel that opens from a button for related content or controls, on
 * Base UI's Popover. Root, Trigger and Close are Base UI's own parts.
 *
 * @import import { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverDescription, PopoverClose } from "@agent-native/toolkit/ui/base-ui/popover";
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

type PopupProps = Omit<BasePopover.Popup.Props, "className"> & {
  className?: string;
};

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

type PopoverContentProps = PopupProps &
  PositionerProps &
  PopoverContentOwnProps & {
    /** Where the popover mounts; the document body by default. */
    container?: BasePopover.Portal.Props["container"];
    /** Keep the popup in the DOM while closed. */
    keepMounted?: boolean;
  };

/**
 * The popover's panel, portaled and positioned beside its trigger or anchor. It
 * is Base UI's Popover Popup with Radix Themes' sizes.
 *
 * @import import { PopoverContent } from "@agent-native/toolkit/ui/base-ui/popover";
 */
const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  (props, ref) => {
    const [attributes, { className, container, keepMounted, ...rest }] =
      splitProps(popoverContentProps, props);
    const [positioner, popup] = splitPositionerProps(rest);
    return (
      <BasePopover.Portal container={container} keepMounted={keepMounted}>
        <BasePopover.Positioner
          className="popover-positioner"
          align="center"
          sideOffset={4}
          {...positioner}
        >
          <BasePopover.Popup
            ref={ref}
            data-slot="popover-content"
            className={cn("popover-popup", className)}
            {...popup}
            {...attributes}
          />
        </BasePopover.Positioner>
      </BasePopover.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

/**
 * The popover's heading, which also names it for assistive technology.
 *
 * @import import { PopoverTitle } from "@agent-native/toolkit/ui/base-ui/popover";
 */
const PopoverTitle = React.forwardRef<
  HTMLHeadingElement,
  Omit<BasePopover.Title.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BasePopover.Title
    ref={ref}
    className={cn("popover-title", className)}
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
  Omit<BasePopover.Description.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BasePopover.Description
    ref={ref}
    className={cn("popover-description", className)}
    {...props}
  />
));
PopoverDescription.displayName = "PopoverDescription";

/**
 * An arrow on the panel's edge that points at the trigger.
 *
 * @import import { PopoverArrow } from "@agent-native/toolkit/ui/base-ui/popover";
 */
const PopoverArrow = React.forwardRef<
  HTMLDivElement,
  Omit<BasePopover.Arrow.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BasePopover.Arrow
    ref={ref}
    className={cn("popover-arrow", className)}
    {...props}
  />
));
PopoverArrow.displayName = "PopoverArrow";

export {
  PopoverArrow,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  type PopoverContentProps,
};
