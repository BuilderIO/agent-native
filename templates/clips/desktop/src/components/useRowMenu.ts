import { useEffect, useRef, useState } from "react";

/**
 * Open/close state for a settings-row dropdown menu (source, camera, mic
 * pickers). Closes on outside click and Escape — native-feeling popover
 * behavior. `rowRef` must be attached to the row container so outside-click
 * detection knows what "inside" means.
 */
export function useRowMenu() {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      const el = rowRef.current;
      if (!el) return;
      if (!el.contains(ev.target as Node)) setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, rowRef };
}
