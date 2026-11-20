import {
  type DialogPopupOwnProps,
  dialogPopupProps,
} from "@agent-native/design-system";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { ModalLayerProvider } from "../modal-layer.js";
import { IconButton } from "./button.js";
import { splitProps } from "./props.js";

/**
 * A window over the page for a task the user finishes or dismisses before
 * going back. Root, Trigger, Close and Portal are Base UI's Dialog parts.
 *
 * @import import { Dialog, DialogTrigger, DialogPopup, DialogTitle, DialogDescription } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
export const Dialog = BaseDialog.Root;

/**
 * The button that opens the dialog. Compose your own with `render`.
 *
 * @import import { DialogTrigger } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
export const DialogTrigger = BaseDialog.Trigger;

/**
 * A button that closes the dialog it sits in. Compose your own with `render`.
 *
 * @import import { DialogClose } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
export const DialogClose = BaseDialog.Close;

/**
 * Moves the dialog into the body, or into `container`. DialogPopup renders
 * one already, so reach for it only with your own popup.
 *
 * @import import { DialogPortal } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
export const DialogPortal = BaseDialog.Portal;

type DialogMotion = "default" | "instant";

type WithClassName<Props> = Omit<Props, "className"> & {
  className?: string | undefined;
};

type DialogBackdropProps = WithClassName<BaseDialog.Backdrop.Props> & {
  motion?: DialogMotion;
};

/**
 * The backdrop that dims the page behind the dialog. DialogPopup renders
 * one already.
 *
 * @import import { DialogBackdrop } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogBackdrop = React.forwardRef<HTMLDivElement, DialogBackdropProps>(
  ({ className, motion = "default", ...props }, ref) => (
    <BaseDialog.Backdrop
      ref={ref}
      className={cn("dialog-backdrop", className)}
      data-motion={motion}
      {...props}
    />
  ),
);
DialogBackdrop.displayName = "DialogBackdrop";

type DialogPopupProps = WithClassName<BaseDialog.Popup.Props> &
  DialogPopupOwnProps & {
    showClose?: boolean;
    motion?: DialogMotion;
    container?: BaseDialog.Portal.Props["container"];
    keepMounted?: boolean;
    closeLabel?: string;
    closeDisabled?: boolean;
    backdropClassName?: string | undefined;
    backdropStyle?: React.CSSProperties | undefined;
  };

/**
 * The dialog's window, with its backdrop, portal and close button. It is
 * Base UI's Dialog Popup with Radix Themes' sizes.
 *
 * @import import { DialogPopup } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogPopup = React.forwardRef<HTMLDivElement, DialogPopupProps>(
  (props, ref) => {
    const [
      attributes,
      {
        className,
        children,
        showClose = true,
        motion = "default",
        container,
        keepMounted,
        closeLabel = "Close",
        closeDisabled,
        backdropClassName,
        backdropStyle,
        ...rest
      },
    ] = splitProps(dialogPopupProps, props);
    return (
      <DialogPortal container={container} keepMounted={keepMounted}>
        <DialogBackdrop
          motion={motion}
          className={backdropClassName}
          {...(backdropStyle ? { style: backdropStyle } : {})}
        />
        <BaseDialog.Popup
          ref={ref}
          className={cn("dialog-popup", className)}
          data-motion={motion}
          {...rest}
          {...attributes}
        >
          <ModalLayerProvider value>{children}</ModalLayerProvider>
          {showClose && (
            <BaseDialog.Close
              render={
                <IconButton
                  className="dialog-close"
                  variant="ghost"
                  color="gray"
                />
              }
              disabled={closeDisabled}
              aria-label={closeLabel}
            >
              <IconX aria-hidden />
            </BaseDialog.Close>
          )}
        </BaseDialog.Popup>
      </DialogPortal>
    );
  },
);
DialogPopup.displayName = "DialogPopup";

/**
 * Stacks the title and description at the top of the dialog.
 *
 * @import import { DialogHeader } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("dialog-header", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

/**
 * Lines up the dialog's actions along its bottom edge.
 *
 * @import import { DialogFooter } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("dialog-footer", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

/**
 * The dialog's heading, which also names it for assistive technology.
 *
 * @import import { DialogTitle } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  WithClassName<BaseDialog.Title.Props>
>(({ className, ...props }, ref) => (
  <BaseDialog.Title
    ref={ref}
    className={cn("dialog-title", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

/**
 * A sentence under the title that the dialog is described by.
 *
 * @import import { DialogDescription } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  WithClassName<BaseDialog.Description.Props>
>(({ className, ...props }, ref) => (
  <BaseDialog.Description
    ref={ref}
    className={cn("dialog-description", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export type { DialogPopupProps, DialogMotion, DialogBackdropProps };
export {
  DialogBackdrop,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
