import {
  AlertDialog,
  AlertDialogAction as ToolkitAlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent as ToolkitAlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@agent-native/toolkit/ui/alert-dialog";
import * as React from "react";

function findConfirmButton(root: HTMLElement): HTMLElement | null {
  const explicit = root.querySelector<HTMLElement>(
    '[data-confirm-action="true"]:not([disabled])',
  );
  if (explicit) return explicit;
  const destructive = root.querySelector<HTMLElement>(
    'button[data-variant="destructive"]:not([disabled]), button.bg-destructive:not([disabled])',
  );
  if (destructive) return destructive;
  const footerButtons = [
    ...root.querySelectorAll<HTMLButtonElement>(
      '[data-slot="alert-dialog-footer"] button:not([disabled]), .sm\\:justify-end button:not([disabled])',
    ),
  ];
  return footerButtons.length > 1
    ? footerButtons[footerButtons.length - 1]!
    : null;
}

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof ToolkitAlertDialogAction>,
  React.ComponentPropsWithoutRef<typeof ToolkitAlertDialogAction>
>((props, ref) => (
  <ToolkitAlertDialogAction ref={ref} data-confirm-action="true" {...props} />
));
AlertDialogAction.displayName = ToolkitAlertDialogAction.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof ToolkitAlertDialogContent>,
  React.ComponentPropsWithoutRef<typeof ToolkitAlertDialogContent>
>(({ onOpenAutoFocus, ...props }, ref) => {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const cleanupTimers = React.useRef<(() => void) | null>(null);

  React.useEffect(() => () => cleanupTimers.current?.(), []);

  const attachRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      cleanupTimers.current?.();
      cleanupTimers.current = null;
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
      if (!node) return;
      const reclaim = () => {
        if (!node.isConnected) return;
        if (node.contains(document.activeElement)) return;
        findConfirmButton(node)?.focus();
      };
      const timer0 = window.setTimeout(reclaim, 0);
      const timer40 = window.setTimeout(reclaim, 40);
      const raf = window.requestAnimationFrame(reclaim);
      cleanupTimers.current = () => {
        window.clearTimeout(timer0);
        window.clearTimeout(timer40);
        window.cancelAnimationFrame(raf);
      };
    },
    [ref],
  );

  return (
    <ToolkitAlertDialogContent
      ref={attachRef}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        const root = contentRef.current;
        if (!root) return;
        const confirm = findConfirmButton(root);
        if (confirm) {
          event.preventDefault();
          confirm.focus();
        }
      }}
      {...props}
    />
  );
});
AlertDialogContent.displayName = ToolkitAlertDialogContent.displayName;

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
