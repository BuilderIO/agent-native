import { useCallback, useEffect, useId, useState } from "react";

/**
 * Coordinates the Radix menus used by recorder rows. Radix owns outside-click,
 * Escape, focus return, and keyboard navigation; this small shared channel
 * ensures opening one row closes any other row menu in the popover.
 */
export function useRowMenu() {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOtherMenuOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener("clips:row-menu-open", onOtherMenuOpen);
    return () => {
      window.removeEventListener("clips:row-menu-open", onOtherMenuOpen);
    };
  }, [id]);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        window.dispatchEvent(
          new CustomEvent("clips:row-menu-open", { detail: id }),
        );
      }
      setOpen(nextOpen);
    },
    [id],
  );

  return { open, onOpenChange };
}
