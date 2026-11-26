import { type DrawerOwnProps, drawerProps } from "@agent-native/design-system";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { useRender } from "@base-ui/react/use-render";
import { IconX } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { ModalLayerProvider, useInModalLayer } from "../modal-layer.js";
import { IconButton } from "./button.js";
import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

type DrawerSide = NonNullable<DrawerOwnProps["side"]>;

const SWIPE_DIRECTION: Record<DrawerSide, "up" | "down" | "left" | "right"> = {
  bottom: "down",
  top: "up",
  left: "left",
  right: "right",
};

const DrawerSideContext = React.createContext<DrawerSide | undefined>(
  undefined,
);

type DrawerProps = Omit<BaseDrawer.Root.Props, "swipeDirection"> &
  DrawerOwnProps;

/**
 * A panel that slides in from an edge of the screen and swipes away, on Base
 * UI's Drawer: a bottom sheet with a handle, or a side panel. The side
 * belongs to the root because it decides the swipe direction.
 *
 * @import import { Drawer, DrawerTrigger, DrawerPopup, DrawerTitle, DrawerDescription } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
function Drawer(props: DrawerProps) {
  const [attributes, rest] = splitProps(drawerProps, props);
  const side = attributes["data-side"] as DrawerSide;
  return (
    <DrawerSideContext.Provider value={side}>
      <BaseDrawer.Root swipeDirection={SWIPE_DIRECTION[side]} {...rest} />
    </DrawerSideContext.Provider>
  );
}

function useDrawerSide(): DrawerSide {
  const side = React.useContext(DrawerSideContext);
  if (side === undefined) {
    throw new Error("DrawerPopup must be rendered inside a Drawer.");
  }
  return side;
}
Drawer.displayName = "Drawer";

/**
 * The button that opens the drawer. Compose your own with `render`.
 *
 * @import import { DrawerTrigger } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
export const DrawerTrigger = BaseDrawer.Trigger;

/**
 * A button that closes the drawer it sits in. Compose your own with `render`.
 *
 * @import import { DrawerClose } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
export const DrawerClose = BaseDrawer.Close;

/**
 * Moves the drawer into the body, or into `container`. DrawerPopup renders
 * one already, so reach for it only with your own popup.
 *
 * @import import { DrawerPortal } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
export const DrawerPortal = scopePortal(BaseDrawer.Portal);

function useOverDialog() {
  const overDialog = useInModalLayer();
  return {
    attributes: overDialog ? { "data-over-dialog": "" } : {},
    forceBackdrop: overDialog,
  };
}

/**
 * The backdrop that dims the page behind the drawer. DrawerPopup renders
 * one already.
 *
 * @import import { DrawerBackdrop } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
const DrawerBackdrop = React.forwardRef<
  HTMLDivElement,
  BaseDrawer.Backdrop.Props
>(({ className, ...props }, ref) => {
  const { attributes, forceBackdrop } = useOverDialog();
  return (
    <BaseDrawer.Backdrop
      ref={ref}
      className={partClassName("drawer-backdrop", className)}
      forceRender={forceBackdrop}
      {...attributes}
      {...props}
    />
  );
});
DrawerBackdrop.displayName = "DrawerBackdrop";

type DrawerPopupProps = BaseDrawer.Popup.Props & {
  container?: BaseDrawer.Portal.Props["container"];
  keepMounted?: boolean;
  showOverlay?: boolean;
  backdropClassName?: BaseDrawer.Backdrop.Props["className"];
  backdropStyle?: BaseDrawer.Backdrop.Props["style"];
  /** A close button in the corner. Defaults on for a panel, off for a bottom drawer, which swipes down. */
  showClose?: boolean;
  closeLabel?: string;
};

/**
 * The drawer's panel, with its backdrop, portal, handle and close button,
 * anchored to the side its Drawer sets.
 *
 * @import import { DrawerPopup } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
const DrawerPopup = React.forwardRef<HTMLDivElement, DrawerPopupProps>(
  (
    {
      className,
      children,
      container,
      keepMounted,
      showOverlay = true,
      backdropClassName,
      backdropStyle,
      showClose,
      closeLabel = "Close",
      ...props
    },
    ref,
  ) => {
    const side = useDrawerSide();
    const { attributes, forceBackdrop } = useOverDialog();
    return (
      <DrawerPortal container={container} keepMounted={keepMounted}>
        {showOverlay ? (
          <BaseDrawer.Backdrop
            className={partClassName("drawer-backdrop", backdropClassName)}
            style={backdropStyle}
            forceRender={forceBackdrop}
            {...attributes}
          />
        ) : null}
        <BaseDrawer.Viewport className="drawer-viewport" {...attributes}>
          <BaseDrawer.Popup
            ref={ref}
            className={partClassName("drawer-popup", className)}
            {...attributes}
            {...props}
            data-side={side}
          >
            {side === "bottom" ? (
              <div className="drawer-handle" aria-hidden />
            ) : null}
            <BaseDrawer.Content className="drawer-content">
              <ModalLayerProvider value>{children}</ModalLayerProvider>
            </BaseDrawer.Content>
            {(showClose ?? side !== "bottom") ? (
              <BaseDrawer.Close
                render={
                  <IconButton
                    className="drawer-close"
                    variant="ghost"
                    color="gray"
                  />
                }
                aria-label={closeLabel}
              >
                <IconX aria-hidden />
              </BaseDrawer.Close>
            ) : null}
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </DrawerPortal>
    );
  },
);
DrawerPopup.displayName = "DrawerPopup";

/**
 * Stacks the title and description at the top of the drawer.
 *
 * @import import { DrawerHeader } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
const DrawerHeader = ({
  render,
  ref,
  className,
  ...props
}: useRender.ComponentProps<"div">) =>
  useRender({
    defaultTagName: "div",
    render,
    ref,
    props: { ...props, className: cn("drawer-header", className) },
  });
DrawerHeader.displayName = "DrawerHeader";

/**
 * Lines up the drawer's actions along its bottom edge.
 *
 * @import import { DrawerFooter } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
const DrawerFooter = ({
  render,
  ref,
  className,
  ...props
}: useRender.ComponentProps<"div">) =>
  useRender({
    defaultTagName: "div",
    render,
    ref,
    props: { ...props, className: cn("drawer-footer", className) },
  });
DrawerFooter.displayName = "DrawerFooter";

/**
 * The drawer's heading, which also names it for assistive technology.
 *
 * @import import { DrawerTitle } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
const DrawerTitle = React.forwardRef<
  HTMLHeadingElement,
  BaseDrawer.Title.Props
>(({ className, ...props }, ref) => (
  <BaseDrawer.Title
    ref={ref}
    className={partClassName("drawer-title", className)}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

/**
 * A sentence under the title that the drawer is described by.
 *
 * @import import { DrawerDescription } from "@agent-native/toolkit/ui/base-ui/drawer";
 */
const DrawerDescription = React.forwardRef<
  HTMLParagraphElement,
  BaseDrawer.Description.Props
>(({ className, ...props }, ref) => (
  <BaseDrawer.Description
    ref={ref}
    className={partClassName("drawer-description", className)}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

export type { DrawerPopupProps, DrawerProps, DrawerSide };
export {
  Drawer,
  DrawerBackdrop,
  DrawerPopup,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
