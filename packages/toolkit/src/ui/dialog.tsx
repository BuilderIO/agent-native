import * as DialogPrimitive from "@radix-ui/react-dialog";
import { IconX } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../utils.js";
import { ModalLayerProvider } from "./modal-layer.js";

/**
 * A dialog opened from a dropdown can leave the page dead.
 *
 * Radix applies a body scroll lock for a modal dialog and for an open menu. When
 * a menu item opens a dialog and the menu's exit animation finishes after the
 * dialog has closed, the menu's cleanup writes `pointer-events: none` back onto
 * the body and nothing ever clears it: the page looks normal and every click on
 * it does nothing. Measured in the automations data-table delete confirm (body
 * `pointer-events: none` after Cancel, autos only if the dialog was deferred).
 *
 * Every dialog we render restores an unlocked body once it is closed and no other
 * layer is open, so the order the locks unwind in stops mattering and callers can
 * open a dialog straight from a menu item.
 */
export const DIALOG_POINTER_LOCK_RESTORE = "dialog-pointer-lock-restore";

function openLayers(): number {
  if (typeof document === "undefined") return 0;
  // Only layers that are still open hold a lock. A menu that is animating out is
  // not one: it has already released its lock and is exactly what writes the stale
  // `pointer-events: none` this clears.
  return document.querySelectorAll(
    '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="menu"][data-state="open"],[role="listbox"][data-state="open"],[data-radix-popper-content-wrapper] [data-state="open"]',
  ).length;
}

/**
 * The same unwinding leaves a second, quieter trap behind: focus.
 *
 * Radix returns focus to the trigger when a dialog closes. When the dialog was
 * opened from a menu item, the trigger it returns to is a menu item inside a menu
 * that is already closed, so the focused element ends up inside a subtree with
 * `data-state="closed"`. The menu trigger then never sees the next press: measured
 * on the served build, `document.activeElement` was the closed dialog's own input
 * and the folder actions menu would not reopen until a reload, in two different
 * apps. The body lock was already clean, so this is a separate leak.
 *
 * Only release it when nothing is open: a focused element inside a closed layer is
 * always stale, but focus inside an open one belongs to the user.
 */
export function releaseStaleFocus() {
  if (typeof document === "undefined") return;
  if (openLayers() > 0) return;
  const active = document.activeElement;
  if (
    !active ||
    active === document.body ||
    active === document.documentElement
  )
    return;
  if (typeof (active as HTMLElement).closest !== "function") return;
  const stale = (active as HTMLElement).closest('[data-state="closed"]');
  if (!stale) return;
  // Blur first so the closed subtree stops owning the focus, then hand focus back to
  // the page so the next press reaches whatever the user aims at.
  (active as HTMLElement).blur();
  if (document.activeElement === active) {
    (active as HTMLElement).blur();
  }
}

export function releaseStaleBodyLock() {
  if (typeof document === "undefined") return;
  const body = document.body;
  if (openLayers() > 0) return;
  if (body.style.pointerEvents === "none") body.style.pointerEvents = "";
  if (body.hasAttribute("data-scroll-locked")) {
    body.removeAttribute("data-scroll-locked");
    body.style.removeProperty("overflow");
    body.style.removeProperty("padding-right");
  }
  // the focus leak is the same unwinding, one step behind the lock
  releaseStaleFocus();
}

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  );
  const isOpen = open ?? uncontrolledOpen;
  React.useEffect(() => {
    if (isOpen) {
      // Most callers close a dialog by unmounting it (`{open ? <Dialog .../> :
      // null}`), so the guard has to be the unmount itself, not a later render
      // with open=false. Neither path may cancel these: the menu's cleanup is
      // what writes the stale lock, and it can land after either one.
      return () => {
        for (const delay of [0, 150, 600]) {
          window.setTimeout(() => {
            releaseStaleBodyLock();
            releaseStaleFocus();
          }, delay);
        }
      };
    }
    // The unlock order depends on exit animations, so check again after them
    // rather than once: the dialog's own cleanup, then the menu's.
    for (const delay of [0, 150, 600]) {
      window.setTimeout(releaseStaleBodyLock, delay);
    }
    return undefined;
  }, [isOpen]);
  return (
    <DialogPrimitive.Root
      {...props}
      open={isOpen}
      onOpenChange={(next) => {
        if (open === undefined) setUncontrolledOpen(next);
        onOpenChange?.(next);
      }}
    >
      {children}
    </DialogPrimitive.Root>
  );
}
Dialog.displayName = "Dialog";

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

type DialogMotion = "default" | "instant";

interface DialogOverlayProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Overlay
> {
  motion?: DialogMotion;
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(({ className, motion = "default", ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[270] bg-background/45 backdrop-blur-[1px]",
      motion === "default" &&
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      motion === "instant" &&
        "transition-[backdrop-filter] duration-[1000ms] ease-[var(--ease-out-strong)] starting:[backdrop-filter:blur(0px)] motion-reduce:transition-none",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  hideClose?: boolean;
  motion?: DialogMotion;
  container?: React.ComponentPropsWithoutRef<
    typeof DialogPrimitive.Portal
  >["container"];
  closeLabel?: string;
  closeDisabled?: boolean;
  overlayClassName?: string;
  overlayStyle?: React.CSSProperties;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      hideClose,
      motion = "default",
      container,
      closeLabel = "Close",
      closeDisabled,
      overlayClassName,
      overlayStyle,
      ...props
    },
    ref,
  ) => (
    <DialogPortal container={container}>
      <DialogOverlay
        motion={motion}
        className={overlayClassName}
        style={overlayStyle}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-[280] grid max-h-[min(760px,calc(100vh-32px))] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-background p-6 text-foreground shadow-lg outline-none",
          motion === "default" &&
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=open]:duration-200 data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        <ModalLayerProvider value>{children}</ModalLayerProvider>
        {!hideClose && (
          <DialogPrimitive.Close
            disabled={closeDisabled}
            className={cn(
              "absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              closeDisabled && "pointer-events-none opacity-50",
            )}
          >
            <IconX className="h-4 w-4" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-start",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
