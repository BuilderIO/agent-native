import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";

/**
 * shadcn-style AlertDialog for the Tauri tray app.
 *
 * Mirrors shadcn/ui's alert-dialog API, but styled with the desktop app's
 * plain-CSS theme tokens instead of Tailwind — this app has no Tailwind/
 * shadcn build. Deliberately skips Radix's `Portal`: the popover window is
 * sized to fit `.app`'s measured content (see `resize_popover`) and clipped
 * to its own rounded corners, so a body-portaled overlay would render past
 * the window's actual bounds. Overlay/Content use `position: absolute`
 * instead of `fixed` so they stay inside `.app`'s rounded, clipped bounds.
 */

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={["alert-dialog-overlay", className].filter(Boolean).join(" ")}
    {...props}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={["alert-dialog-content", className].filter(Boolean).join(" ")}
      {...props}
    />
  </>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["alert-dialog-header", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["alert-dialog-footer", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={["alert-dialog-title", className].filter(Boolean).join(" ")}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={["alert-dialog-description", className]
      .filter(Boolean)
      .join(" ")}
    {...props}
  />
));
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={["primary", className].filter(Boolean).join(" ")}
    {...props}
  />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={["secondary", className].filter(Boolean).join(" ")}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
