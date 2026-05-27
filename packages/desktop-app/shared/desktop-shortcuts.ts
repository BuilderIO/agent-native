export type DesktopShortcutBehavior = "toggle" | "show";

export interface DesktopShortcutBinding {
  id: string;
  accelerator: string;
  app: string;
  view?: string;
  behavior: DesktopShortcutBehavior;
  enabled: boolean;
}

export interface DesktopShortcutRegistration {
  id: string;
  registered: boolean;
  error?: string;
}

export interface DesktopShortcutSettings {
  bindings: DesktopShortcutBinding[];
  registrations: DesktopShortcutRegistration[];
}

export interface DesktopShortcutUpsertRequest {
  id?: string;
  accelerator: string;
  app: string;
  view?: string;
  behavior?: DesktopShortcutBehavior;
  enabled?: boolean;
}

export interface DesktopShortcutUpdateResult {
  ok: boolean;
  settings: DesktopShortcutSettings;
  error?: string;
}

const MODIFIER_ALIASES: Record<string, string> = {
  alt: "Alt",
  cmd: "Command",
  command: "Command",
  commandorcontrol: "CommandOrControl",
  commandorctrl: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  control: "Control",
  ctrl: "Control",
  meta: "Command",
  opt: "Alt",
  option: "Alt",
  shift: "Shift",
};

const KEY_ALIASES: Record<string, string> = {
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  backspace: "Backspace",
  delete: "Delete",
  down: "Down",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  left: "Left",
  minus: "-",
  plus: "Plus",
  return: "Enter",
  right: "Right",
  space: "Space",
  tab: "Tab",
  up: "Up",
};

const MODIFIER_ORDER = [
  "CommandOrControl",
  "Command",
  "Control",
  "Alt",
  "Shift",
];
const NON_SHIFT_MODIFIERS = new Set([
  "CommandOrControl",
  "Command",
  "Control",
  "Alt",
]);
const RESERVED_COMMAND_KEYS = new Set(["H", "M", "Q", "W", "Tab"]);

function reservedShortcutError(
  modifiers: Set<string>,
  key: string,
): string | undefined {
  if (
    !RESERVED_COMMAND_KEYS.has(key) ||
    ![...modifiers].some((modifier) => NON_SHIFT_MODIFIERS.has(modifier))
  ) {
    return undefined;
  }
  return "Choose a shortcut that does not override quit, hide, minimize, close-window, or app-switching keys.";
}

function normalizeShortcutKey(part: string): string {
  const lower = part.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(part)) return part.toUpperCase();
  if (part.length === 1) return part.toUpperCase();
  return part;
}

export function normalizeDesktopShortcutAccelerator(rawAccelerator: string): {
  accelerator?: string;
  error?: string;
} {
  const parts = rawAccelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return { error: "Use at least one modifier plus a key." };
  }

  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part.toLowerCase()];
    if (alias) {
      modifiers.add(alias);
      continue;
    }
    if (key) return { error: "Use a single non-modifier key." };
    key = normalizeShortcutKey(part);
  }

  if (!key) return { error: "Choose a key after the modifiers." };
  if (![...modifiers].some((modifier) => NON_SHIFT_MODIFIERS.has(modifier))) {
    return { error: "Use Command, Control, or Option with the key." };
  }
  const reservedError = reservedShortcutError(modifiers, key);
  if (reservedError) return { error: reservedError };

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) =>
    modifiers.has(modifier),
  );
  return { accelerator: [...orderedModifiers, key].join("+") };
}

export function formatDesktopShortcutAccelerator(
  accelerator: string,
  platform = "darwin",
): string {
  const replacements: Record<string, string> =
    platform === "darwin"
      ? {
          Alt: "Option",
          Command: "Cmd",
          CommandOrControl: "Cmd/Ctrl",
          Control: "Ctrl",
        }
      : {
          Alt: "Alt",
          Command: "Cmd",
          CommandOrControl: "Ctrl/Cmd",
          Control: "Ctrl",
        };

  return accelerator
    .split("+")
    .map((part) => replacements[part] ?? part)
    .join("+");
}

export function shortcutOpenPathForBinding(
  binding: Pick<DesktopShortcutBinding, "app" | "view">,
): string {
  const params = new URLSearchParams();
  params.set("app", binding.app);
  const view = binding.view?.trim();
  if (view) params.set("view", view);
  return `/_agent-native/open?${params.toString()}`;
}
