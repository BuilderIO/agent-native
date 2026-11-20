import {
  type AlertDialogContentOwnProps,
  alertDialogContentProps,
} from "@agent-native/design-system";
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import * as React from "react";

import { cn } from "../../utils.js";
import { Button, type ButtonProps } from "./button.js";
import { splitProps } from "./props.js";

// Base UI's parts are exported where they are declared: through the export
// list, docgen documents Base UI's own component and drops these comments.

/**
 * A dialog that asks the user to confirm or cancel before going on, on Base
 * UI's Alert Dialog. Unlike Dialog, an outside press never dismisses it and
 * Escape is the only implicit way out. Root, Trigger and Portal are Base UI's
 * parts.
 *
 * @import import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
export const AlertDialog = BaseAlertDialog.Root;

/**
 * The button that opens the alert dialog. Compose your own with `render`.
 *
 * @import import { AlertDialogTrigger } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
export const AlertDialogTrigger = BaseAlertDialog.Trigger;

/**
 * Moves the alert dialog into the body, or into `container`. AlertDialogContent
 * renders one already.
 *
 * @import import { AlertDialogPortal } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
export const AlertDialogPortal = BaseAlertDialog.Portal;

type WithClassName<Props> = Omit<Props, "className"> & { className?: string };

/**
 * The backdrop that dims the page behind the alert dialog. AlertDialogContent
 * renders one already.
 *
 * @import import { AlertDialogOverlay } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogOverlay = React.forwardRef<
  HTMLDivElement,
  WithClassName<BaseAlertDialog.Backdrop.Props>
>(({ className, ...props }, ref) => (
  <BaseAlertDialog.Backdrop
    ref={ref}
    className={cn("alert-dialog-backdrop", className)}
    {...props}
  />
));
AlertDialogOverlay.displayName = "AlertDialogOverlay";

type AlertDialogContentProps = WithClassName<BaseAlertDialog.Popup.Props> &
  AlertDialogContentOwnProps & {
    container?: BaseAlertDialog.Portal.Props["container"];
    keepMounted?: boolean;
    overlayClassName?: string;
    overlayStyle?: React.CSSProperties;
    overlayProps?: WithClassName<BaseAlertDialog.Backdrop.Props> & {
      [dataAttribute: `data-${string}`]: string | undefined;
    };
  };

/**
 * The alert dialog's window, with its backdrop and portal. It is Base UI's
 * Alert Dialog Popup with Radix Themes' sizes.
 *
 * @import import { AlertDialogContent } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogContent = React.forwardRef<
  HTMLDivElement,
  AlertDialogContentProps
>((props, ref) => {
  const [
    attributes,
    {
      className,
      container,
      keepMounted,
      overlayClassName,
      overlayStyle,
      overlayProps,
      ...rest
    },
  ] = splitProps(alertDialogContentProps, props);
  return (
    <AlertDialogPortal container={container} keepMounted={keepMounted}>
      <AlertDialogOverlay
        {...overlayProps}
        className={cn(overlayProps?.className, overlayClassName)}
        style={{ ...overlayProps?.style, ...overlayStyle }}
      />
      <BaseAlertDialog.Popup
        ref={ref}
        className={cn("alert-dialog-popup", className)}
        {...rest}
        {...attributes}
      />
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = "AlertDialogContent";

/**
 * Stacks the title and description at the top of the alert dialog.
 *
 * @import import { AlertDialogHeader } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("alert-dialog-header", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

/**
 * Lines up the cancel and action buttons along the bottom edge.
 *
 * @import import { AlertDialogFooter } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("alert-dialog-footer", className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

/**
 * The alert dialog's heading, which also names it for assistive technology.
 *
 * @import import { AlertDialogTitle } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  WithClassName<BaseAlertDialog.Title.Props>
>(({ className, ...props }, ref) => (
  <BaseAlertDialog.Title
    ref={ref}
    className={cn("alert-dialog-title", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

/**
 * The sentence under the title that says what confirming does.
 *
 * @import import { AlertDialogDescription } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  WithClassName<BaseAlertDialog.Description.Props>
>(({ className, ...props }, ref) => (
  <BaseAlertDialog.Description
    ref={ref}
    className={cn("alert-dialog-description", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

type AlertDialogButtonProps = ButtonProps;

/**
 * The close renders the Button. A Button rendered as a link tells the close
 * too (`nativeButton={false}`), so the close doesn't treat it as a button.
 */
function AlertDialogClose({
  closeRef,
  ...props
}: AlertDialogButtonProps & { closeRef: React.Ref<HTMLButtonElement> }) {
  const { nativeButton } = props;
  return (
    <BaseAlertDialog.Close
      ref={closeRef}
      {...(nativeButton === undefined ? {} : { nativeButton })}
      render={<Button {...props} />}
    />
  );
}

/**
 * The Button that confirms and closes the dialog. To keep the dialog open while
 * the action runs, cancel the close in `onOpenChange`.
 *
 * @import import { AlertDialogAction } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  AlertDialogButtonProps
>((props, ref) => <AlertDialogClose closeRef={ref} {...props} />);
AlertDialogAction.displayName = "AlertDialogAction";

/**
 * The Button that closes the dialog without acting, a gray surface button
 * unless told otherwise.
 *
 * @import import { AlertDialogCancel } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  AlertDialogButtonProps
>(({ variant = "surface", color = "gray", ...props }, ref) => (
  <AlertDialogClose closeRef={ref} variant={variant} color={color} {...props} />
));
AlertDialogCancel.displayName = "AlertDialogCancel";

export type { AlertDialogButtonProps, AlertDialogContentProps };
export {
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
