import {
  type PreviewCardPopupOwnProps,
  previewCardPopupProps,
} from "@agent-native/design-system";
import { PreviewCard as BasePreviewCard } from "@base-ui/react/preview-card";
import * as React from "react";

import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";

const PreviewCardPortal = scopePortal(BasePreviewCard.Portal);

/**
 * A card that previews what a link leads to when the link is hovered or
 * focused, on Base UI's Preview Card, Radix Themes' HoverCard. Root and Trigger
 * are Base UI's own parts.
 *
 * @import import { PreviewCard, PreviewCardTrigger, PreviewCardPopup } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
export const PreviewCard = BasePreviewCard.Root;

/**
 * The link that opens the preview on hover or focus, after its delay. Compose
 * your own with `render`.
 *
 * @import import { PreviewCardTrigger } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
export const PreviewCardTrigger = BasePreviewCard.Trigger;

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

type PreviewCardPopupProps = BasePreviewCard.Popup.Props &
  PositionerProps &
  PreviewCardPopupOwnProps & {
    container?: BasePreviewCard.Portal.Props["container"];
  };

/**
 * The preview's card, portaled and positioned beside its trigger. It is Base
 * UI's Preview Card Popup with Radix Themes' HoverCard sizes.
 *
 * @import import { PreviewCardPopup } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
const PreviewCardPopup = React.forwardRef<
  HTMLDivElement,
  PreviewCardPopupProps
>((props, ref) => {
  const [attributes, { className, container, ...rest }] = splitProps(
    previewCardPopupProps,
    props,
  );
  const [positioner, popup] = splitPositionerProps(rest);
  return (
    <PreviewCardPortal container={container}>
      <BasePreviewCard.Positioner
        className="preview-card-positioner"
        align="center"
        sideOffset={4}
        {...positioner}
      >
        <BasePreviewCard.Popup
          ref={ref}
          className={partClassName("preview-card-popup", className)}
          {...popup}
          {...attributes}
        />
      </BasePreviewCard.Positioner>
    </PreviewCardPortal>
  );
});
PreviewCardPopup.displayName = "PreviewCardPopup";

/**
 * An arrow on the card's edge that points at the trigger.
 *
 * @import import { PreviewCardArrow } from "@agent-native/toolkit/ui/base-ui/preview-card";
 */
const PreviewCardArrow = React.forwardRef<
  HTMLDivElement,
  BasePreviewCard.Arrow.Props
>(({ className, ...props }, ref) => (
  <BasePreviewCard.Arrow
    ref={ref}
    className={partClassName("preview-card-arrow", className)}
    {...props}
  />
));
PreviewCardArrow.displayName = "PreviewCardArrow";

export { PreviewCardArrow, PreviewCardPopup, type PreviewCardPopupProps };
