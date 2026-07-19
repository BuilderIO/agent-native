import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="an-alert-dialog-overlay" />
      <AlertDialogPrimitive.Content
        className={classes("an-alert-dialog-content", className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div className={classes("an-alert-dialog-header", className)} {...props} />
  );
}

export function AlertDialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div className={classes("an-alert-dialog-footer", className)} {...props} />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={classes("an-alert-dialog-title", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={classes("an-alert-dialog-description", className)}
      {...props}
    />
  );
}
