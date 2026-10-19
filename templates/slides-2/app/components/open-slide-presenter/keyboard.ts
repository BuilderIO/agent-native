type PresenterKeyboardEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "repeat"
>;

export type PresenterConsoleCommand =
  | "next"
  | "previous"
  | "first"
  | "last"
  | "blackout"
  | "whiteout";

export function hasPresenterModifier(
  event: Pick<PresenterKeyboardEvent, "metaKey" | "ctrlKey" | "altKey">,
) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

export function getPresenterConsoleCommand(
  event: PresenterKeyboardEvent,
): PresenterConsoleCommand | null {
  if (hasPresenterModifier(event)) return null;

  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
    return "next";
  }
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
    return "previous";
  }
  if (event.key === "Home") return "first";
  if (event.key === "End") return "last";
  if (event.key.toLowerCase() === "b") return "blackout";
  if (event.key.toLowerCase() === "w") return "whiteout";
  return null;
}
