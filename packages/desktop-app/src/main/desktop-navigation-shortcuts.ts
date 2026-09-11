import { isDesktopSettingsShortcut } from "@shared/desktop-shortcuts";

export type DesktopNavigationShortcutInput = {
  type: string;
  key: string;
  code?: string;
  meta?: boolean;
  control?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type DesktopShortcutKeydown = {
  key: string;
  code?: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey?: boolean;
};

export function forwardDesktopNavigationShortcutInput(
  event: { preventDefault(): void },
  input: DesktopNavigationShortcutInput,
  send: (payload: DesktopShortcutKeydown) => void,
): boolean {
  if (!(input.meta || input.control) || input.type !== "keyDown") return false;

  const key = input.key.toLowerCase();
  const isNumericShortcut = !input.shift && !input.alt && /^[1-9]$/.test(key);
  const isBracketLeft =
    input.code === "BracketLeft" || key === "[" || key === "{";
  const isBracketRight =
    input.code === "BracketRight" || key === "]" || key === "}";
  const isBracketShortcut =
    Boolean(input.shift) && !input.alt && (isBracketLeft || isBracketRight);
  const isSettingsShortcut = isDesktopSettingsShortcut(input);
  if (!isNumericShortcut && !isBracketShortcut && !isSettingsShortcut) {
    return false;
  }

  event.preventDefault();
  send({
    key: isSettingsShortcut
      ? ","
      : isNumericShortcut
        ? key
        : isBracketLeft
          ? "["
          : "]",
    code: input.code,
    shiftKey: Boolean(input.shift),
    altKey: Boolean(input.alt),
    ctrlKey: Boolean(input.control),
    metaKey: Boolean(input.meta),
  });
  return true;
}
