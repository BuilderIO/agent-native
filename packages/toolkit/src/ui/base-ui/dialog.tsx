import {
  type DialogContentOwnProps,
  dialogContentProps,
} from "@agent-native/design-system";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { ModalLayerProvider } from "../modal-layer.js";
import { splitProps } from "./props.js";

/**
 * A window over the page for a task the user finishes or dismisses before
 * going back. Root, Trigger, Close and Portal are Base UI's Dialog parts.
 *
 * @import import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@agent-native/toolkit/ui/base-ui/dialog";
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
 * Moves the dialog into the body, or into `container`. DialogContent renders
 * one already, so reach for it only with your own popup.
 *
 * @import import { DialogPortal } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
export const DialogPortal = BaseDialog.Portal;

type DialogMotion = "default" | "instant";

type WithClassName<Props> = Omit<Props, "className"> & {
  className?: string | undefined;
};

type DialogOverlayProps = WithClassName<BaseDialog.Backdrop.Props> & {
  motion?: DialogMotion;
};

/**
 * The backdrop that dims the page behind the dialog. DialogContent renders
 * one already.
 *
 * @import import { DialogOverlay } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogOverlay = React.forwardRef<HTMLDivElement, DialogOverlayProps>(
  ({ className, motion = "default", ...props }, ref) => (
    <BaseDialog.Backdrop
      ref={ref}
      className={cn("dialog-backdrop", className)}
      data-motion={motion}
      {...props}
    />
  ),
);
DialogOverlay.displayName = "DialogOverlay";

type DialogContentProps = WithClassName<BaseDialog.Popup.Props> &
  DialogContentOwnProps & {
    hideClose?: boolean;
    motion?: DialogMotion;
    container?: BaseDialog.Portal.Props["container"];
    keepMounted?: boolean;
    closeLabel?: string;
    closeDisabled?: boolean;
    overlayClassName?: string | undefined;
    overlayStyle?: React.CSSProperties | undefined;
  };

/**
 * The dialog's window, with its backdrop, portal and close button. It is
 * Base UI's Dialog Popup with Radix Themes' sizes.
 *
 * @import import { DialogContent } from "@agent-native/toolkit/ui/base-ui/dialog";
 */
const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  (props, ref) => {
    const [
      attributes,
      {
        className,
        children,
        hideClose,
        motion = "default",
        container,
        keepMounted,
        closeLabel = "Close",
        closeDisabled,
        overlayClassName,
        overlayStyle,
        ...rest
      },
    ] = splitProps(dialogContentProps, props);
    return (
      <DialogPortal container={container} keepMounted={keepMounted}>
        <DialogOverlay
          motion={motion}
          className={overlayClassName}
          {...(overlayStyle ? { style: overlayStyle } : {})}
        />
        <BaseDialog.Popup
          ref={ref}
          className={cn("dialog-popup", className)}
          data-motion={motion}
          {...rest}
          {...attributes}
        >
          <ModalLayerProvider value>{children}</ModalLayerProvider>
          {!hideClose && (
            <BaseDialog.Close
              className="dialog-close"
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
DialogContent.displayName = "DialogContent";

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

export type { DialogContentProps, DialogMotion, DialogOverlayProps };
export {
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
