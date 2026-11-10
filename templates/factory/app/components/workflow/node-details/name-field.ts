/** What a key does in the step name field: `leave` hands focus to the modal and the blur saves. */
export type NameKeyAction = "commit-and-close" | "leave" | "revert";

/**
 * Enter finishes the edit. In a modal opened only to rename the step it also
 * closes the modal, so a rename never leaves the full details open behind it;
 * the caller closes only when the name was accepted. Escape reverts the edit
 * and never closes the modal here. A key pressed while an input method is
 * composing text belongs to the composition, not to the field.
 */
export function nameKeyAction(
  key: string,
  closesOnEnter: boolean,
  composing: boolean,
): NameKeyAction | null {
  if (composing) return null;
  if (key === "Enter") return closesOnEnter ? "commit-and-close" : "leave";
  if (key === "Escape") return "revert";
  return null;
}
