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

export type DesktopNavigationShortcutSource = "shell" | "app-webview";

export function forwardDesktopNavigationShortcutInput(
  event: { preventDefault(): void },
  input: DesktopNavigationShortcutInput,
  send: (payload: DesktopShortcutKeydown) => void,
  source: DesktopNavigationShortcutSource = "shell",
): boolean {
  if (!(input.meta || input.control) || input.type !== "keyDown") return false;

  const key = input.key.toLowerCase();
  const isNumericShortcut = !input.shift && !input.alt && /^[1-9]$/.test(key);
  // A focused app webview keeps Cmd+, so it opens that app's Settings; the
  // shell's own settings stay on Cmd+, while the shell has focus.
  const isSettingsShortcut =
    source === "shell" && isDesktopSettingsShortcut(input);
  if (!isNumericShortcut && !isSettingsShortcut) {
    return false;
  }

  event.preventDefault();
  send({
    key: isSettingsShortcut ? "," : key,
    code: input.code,
    shiftKey: Boolean(input.shift),
    altKey: Boolean(input.alt),
    ctrlKey: Boolean(input.control),
    metaKey: Boolean(input.meta),
  });
  return true;
}
