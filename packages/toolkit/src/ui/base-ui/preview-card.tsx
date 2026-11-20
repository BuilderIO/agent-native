import {
  type PreviewCardContentOwnProps,
  previewCardContentProps,
} from "@agent-native/design-system";
import { PreviewCard as BasePreviewCard } from "@base-ui/react/preview-card";
import * as React from "react";

import { cn } from "../../utils.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";

// Base UI's parts are exported where they are declared: through the export
// list, docgen documents Base UI's own component and drops these comments.

/**
 * A card that previews what a link leads to when the link is hovered or
 * focused, on Base UI's Preview Card, Radix Themes' HoverCard. Root and Trigger
 * are Base UI's own parts.
 *
 * @import import { PreviewCard, PreviewCardTrigger, PreviewCardContent } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
export const PreviewCard = BasePreviewCard.Root;

/**
 * The link that opens the preview on hover or focus, after its delay. Compose
 * your own with `render`.
 *
 * @import import { PreviewCardTrigger } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
export const PreviewCardTrigger = BasePreviewCard.Trigger;

type PopupProps = Omit<BasePreviewCard.Popup.Props, "className"> & {
  className?: string;
};

type PositionerProps = Pick<
  BasePreviewCard.Positioner.Props,
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

type PreviewCardContentProps = PopupProps &
  PositionerProps &
  PreviewCardContentOwnProps & {
    container?: BasePreviewCard.Portal.Props["container"];
  };

/**
 * The preview's card, portaled and positioned beside its trigger. It is Base
 * UI's Preview Card Popup with Radix Themes' HoverCard sizes.
 *
 * @import import { PreviewCardContent } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
const PreviewCardContent = React.forwardRef<
  HTMLDivElement,
  PreviewCardContentProps
>((props, ref) => {
  const [attributes, { className, container, ...rest }] = splitProps(
    previewCardContentProps,
    props,
  );
  const [positioner, popup] = splitPositionerProps(rest);
  return (
    <BasePreviewCard.Portal container={container}>
      <BasePreviewCard.Positioner
        className="preview-card-positioner"
        align="center"
        sideOffset={4}
        {...positioner}
      >
        <BasePreviewCard.Popup
          ref={ref}
          className={cn("preview-card-popup", className)}
          {...popup}
          {...attributes}
        />
      </BasePreviewCard.Positioner>
    </BasePreviewCard.Portal>
  );
});
PreviewCardContent.displayName = "PreviewCardContent";

/**
 * An arrow on the card's edge that points at the trigger.
 *
 * @import import { PreviewCardArrow } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
const PreviewCardArrow = React.forwardRef<
  HTMLDivElement,
  Omit<BasePreviewCard.Arrow.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BasePreviewCard.Arrow
    ref={ref}
    className={cn("preview-card-arrow", className)}
    {...props}
  />
));
PreviewCardArrow.displayName = "PreviewCardArrow";

export { PreviewCardArrow, PreviewCardContent, type PreviewCardContentProps };
