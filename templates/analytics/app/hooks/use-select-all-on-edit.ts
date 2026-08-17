import { useEffect, useRef } from "react";

/**
 * Focuses and selects all text in an input/textarea when a rename or
 * inline-edit field mounts, so the existing value is ready to be replaced by
 * typing. `autoFocus` alone only places the caret; it doesn't select text.
 */
export function useSelectAllOnEdit<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(isEditing: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    const frame = requestAnimationFrame(() => ref.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  return ref;
}
