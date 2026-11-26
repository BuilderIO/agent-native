import {
  type AlertDialogPopupOwnProps,
  alertDialogPopupProps,
} from "@agent-native/design-system";
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { cn } from "../../utils.js";
import { Button, type ButtonProps } from "./button.js";
import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

/**
 * A dialog that asks the user to confirm or cancel before going on, on Base
 * UI's Alert Dialog. Unlike Dialog, an outside press never dismisses it and
 * Escape is the only implicit way out. Root, Trigger and Portal are Base UI's
 * parts.
 *
 * @import import { AlertDialog, AlertDialogTrigger, AlertDialogPopup, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
export const AlertDialog = BaseAlertDialog.Root;

/**
 * The button that opens the alert dialog. Compose your own with `render`.
 *
 * @import import { AlertDialogTrigger } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
export const AlertDialogTrigger = BaseAlertDialog.Trigger;

/**
 * Moves the alert dialog into the body, or into `container`. AlertDialogPopup
 * renders one already.
 *
 * @import import { AlertDialogPortal } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
export const AlertDialogPortal = scopePortal(BaseAlertDialog.Portal);

/**
 * The backdrop that dims the page behind the alert dialog. AlertDialogPopup
 * renders one already.
 *
 * @import import { AlertDialogBackdrop } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogBackdrop = React.forwardRef<
  HTMLDivElement,
  BaseAlertDialog.Backdrop.Props
>(({ className, ...props }, ref) => (
  <BaseAlertDialog.Backdrop
    ref={ref}
    className={partClassName("alert-dialog-backdrop", className)}
    {...props}
  />
));
AlertDialogBackdrop.displayName = "AlertDialogBackdrop";

type AlertDialogPopupProps = BaseAlertDialog.Popup.Props &
  AlertDialogPopupOwnProps & {
    container?: BaseAlertDialog.Portal.Props["container"];
    keepMounted?: boolean;
    backdropClassName?: BaseAlertDialog.Backdrop.Props["className"];
    backdropStyle?: BaseAlertDialog.Backdrop.Props["style"];
    backdropProps?: BaseAlertDialog.Backdrop.Props & {
      [dataAttribute: `data-${string}`]: string | undefined;
    };
  };

type BackdropValue<T> =
  | T
  | ((state: BaseAlertDialog.Backdrop.State) => T | undefined);

function combineBackdropValues<T extends string | React.CSSProperties>(
  base: BackdropValue<T> | undefined,
  override: BackdropValue<T> | undefined,
  merge: (base: T | undefined, override: T | undefined) => T,
): BackdropValue<T> | undefined {
  if (base === undefined) return override;
  if (override === undefined) return base;
  if (typeof base !== "function" && typeof override !== "function")
    return merge(base, override);
  return (state) =>
    merge(
      typeof base === "function" ? base(state) : base,
      typeof override === "function" ? override(state) : override,
    );
}

/**
 * The alert dialog's window, with its backdrop and portal. It is Base UI's
 * Alert Dialog Popup with Radix Themes' sizes.
 *
 * @import import { AlertDialogPopup } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogPopup = React.forwardRef<
  HTMLDivElement,
  AlertDialogPopupProps
>((props, ref) => {
  const [
    attributes,
    {
      className,
      container,
      keepMounted,
      backdropClassName,
      backdropStyle,
      backdropProps,
      ...rest
    },
  ] = splitProps(alertDialogPopupProps, props);
  return (
    <AlertDialogPortal container={container} keepMounted={keepMounted}>
      <AlertDialogBackdrop
        {...backdropProps}
        className={combineBackdropValues<string>(
          backdropProps?.className,
          backdropClassName,
          cn,
        )}
        style={combineBackdropValues<React.CSSProperties>(
          backdropProps?.style,
          backdropStyle,
          (base, override) => ({ ...base, ...override }),
        )}
      />
      <BaseAlertDialog.Popup
        ref={ref}
        className={partClassName("alert-dialog-popup", className)}
        {...rest}
        {...attributes}
      />
    </AlertDialogPortal>
  );
});
AlertDialogPopup.displayName = "AlertDialogPopup";

/**
 * Stacks the title and description at the top of the alert dialog.
 *
 * @import import { AlertDialogHeader } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogHeader = ({
  render,
  ...props
}: useRender.ComponentProps<"div">) =>
  useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "alert-dialog-header" }, props),
  });
AlertDialogHeader.displayName = "AlertDialogHeader";

/**
 * Lines up the cancel and action buttons along the bottom edge.
 *
 * @import import { AlertDialogFooter } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogFooter = ({
  render,
  ...props
}: useRender.ComponentProps<"div">) =>
  useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "alert-dialog-footer" }, props),
  });
AlertDialogFooter.displayName = "AlertDialogFooter";

/**
 * The alert dialog's heading, which also names it for assistive technology.
 *
 * @import import { AlertDialogTitle } from "@agent-native/toolkit/ui/base-ui/alert-dialog";
 */
const AlertDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  BaseAlertDialog.Title.Props
>(({ className, ...props }, ref) => (
  <BaseAlertDialog.Title
    ref={ref}
    className={partClassName("alert-dialog-title", className)}
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
  BaseAlertDialog.Description.Props
>(({ className, ...props }, ref) => (
  <BaseAlertDialog.Description
    ref={ref}
    className={partClassName("alert-dialog-description", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

type AlertDialogButtonProps = ButtonProps;

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

export type { AlertDialogButtonProps, AlertDialogPopupProps };
export {
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
