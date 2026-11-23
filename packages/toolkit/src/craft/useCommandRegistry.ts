import * as React from "react";

/**
 * Target platform used to format `Mod` shortcut display labels.
 */
export type ShortcutPlatform = "mac" | "other";

/**
 * Registered command entry for `useCommandRegistry`.
 */
export interface CommandRegistryItem {
  id: string;
  label: string;
  shortcut: string;
  group?: string;
  description?: string;
  enabled?: boolean;
  allowInInput?: boolean;
  preventDefault?: boolean;
  onTrigger: (event: KeyboardEvent) => void;
}

/**
 * Display metadata returned for rendering a `?` keyboard shortcut reference.
 */
export interface CommandShortcutDescriptor {
  id: string;
  label: string;
  shortcut: string;
  displayShortcut: string;
  group: string;
  description?: string;
  enabled: boolean;
}

/**
 * Options for `useCommandRegistry`.
 */
export interface UseCommandRegistryOptions {
  enabled?: boolean;
  enableHelpShortcut?: boolean;
  platform?: ShortcutPlatform;
  target?: EventTarget | null;
}

/**
 * Return value of `useCommandRegistry`.
 */
export interface CommandRegistryResult {
  shortcuts: CommandShortcutDescriptor[];
  isHelpOpen: boolean;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleHelp: () => void;
  formatShortcut: (combo: string) => string;
}

/**
 * Parsed key combination produced by `parseShortcutCombo`.
 */
export interface ParsedShortcutCombo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  escape: "escape",
  space: " ",
  spacebar: " ",
  enter: "enter",
  return: "enter",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

/**
 * Detects whether the current runtime should display macOS command glyphs.
 */
export function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") {
    return "other";
  }
  const platformString = navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platformString) ? "mac" : "other";
}

/**
 * Returns `true` when an event target is an editable text input, textarea,
 * select, or `contenteditable` element where single-key shortcuts must not fire.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  if (!("tagName" in target)) {
    return false;
  }
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return true;
  }
  if (element.isContentEditable) {
    return true;
  }
  const contentEditableAttr = element.getAttribute("contenteditable");
  if (contentEditableAttr === "" || contentEditableAttr === "true") {
    return true;
  }
  if (typeof element.closest === "function") {
    return (
      element.closest('[contenteditable="true"], [contenteditable=""]') !== null
    );
  }
  return false;
}

/**
 * Parses a portable shortcut descriptor such as `Mod+K`, `Mod+Shift+P`,
 * `j`, `k`, `Escape`, or `?`.
 */
export function parseShortcutCombo(combo: string): ParsedShortcutCombo {
  const tokens = combo
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let mod = false;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let key = "";

  for (const rawToken of tokens) {
    const lower = rawToken.toLowerCase();
    if (lower === "mod") {
      mod = true;
    } else if (lower === "ctrl" || lower === "control") {
      ctrl = true;
    } else if (lower === "meta" || lower === "cmd" || lower === "command") {
      meta = true;
    } else if (lower === "alt" || lower === "option") {
      alt = true;
    } else if (lower === "shift") {
      shift = true;
    } else {
      key = KEY_ALIASES[lower] ?? lower;
    }
  }

  return { key, mod, ctrl, meta, alt, shift };
}

/**
 * Matches a DOM `KeyboardEvent` against a portable shortcut descriptor.
 * `Mod` matches either `metaKey` or `ctrlKey` so shortcuts work cleanly on
 * macOS, Windows, and Linux.
 */
export function matchesShortcutEvent(
  event: KeyboardEvent,
  combo: string,
): boolean {
  const parsed = parseShortcutCombo(combo);
  if (!parsed.key) {
    return false;
  }

  const eventKey = event.key.toLowerCase();
  const normalizedEventKey = KEY_ALIASES[eventKey] ?? eventKey;
  if (normalizedEventKey !== parsed.key) {
    return false;
  }

  if (parsed.mod) {
    if (!event.metaKey && !event.ctrlKey) {
      return false;
    }
  } else {
    if (event.metaKey !== parsed.meta) {
      return false;
    }
    if (event.ctrlKey !== parsed.ctrl) {
      return false;
    }
  }

  if (event.altKey !== parsed.alt) {
    return false;
  }

  const isShiftedSymbol = parsed.key === "?";
  if (!isShiftedSymbol && event.shiftKey !== parsed.shift) {
    return false;
  }

  return true;
}

/**
 * Formats a portable shortcut string for display in menus or a `?` help modal.
 */
export function formatShortcutLabel(
  combo: string,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string {
  const parsed = parseShortcutCombo(combo);
  const parts: string[] = [];

  if (parsed.mod) {
    parts.push(platform === "mac" ? "⌘" : "Ctrl");
  }
  if (parsed.ctrl) {
    parts.push(platform === "mac" ? "⌃" : "Ctrl");
  }
  if (parsed.meta) {
    parts.push(platform === "mac" ? "⌘" : "Meta");
  }
  if (parsed.alt) {
    parts.push(platform === "mac" ? "⌥" : "Alt");
  }
  if (parsed.shift) {
    parts.push(platform === "mac" ? "⇧" : "Shift");
  }

  const displayKey =
    parsed.key === "escape"
      ? "Esc"
      : parsed.key === " "
        ? "Space"
        : parsed.key.length === 1
          ? parsed.key.toUpperCase()
          : parsed.key.charAt(0).toUpperCase() + parsed.key.slice(1);
  parts.push(displayKey);

  return platform === "mac" ? parts.join("") : parts.join("+");
}

/**
 * Registers portable keyboard shortcuts (`Mod` = `Cmd`/`Ctrl`, `j`/`k`, `Esc`)
 * that automatically ignore editable inputs and feed a `?` shortcut list.
 */
export function useCommandRegistry(
  commands: readonly CommandRegistryItem[],
  options: UseCommandRegistryOptions = {},
): CommandRegistryResult {
  const {
    enabled = true,
    enableHelpShortcut = true,
    platform,
    target,
  } = options;

  const [isHelpOpen, setHelpOpen] = React.useState(false);
  const resolvedPlatform = React.useMemo(
    () => platform ?? detectShortcutPlatform(),
    [platform],
  );
  const commandsRef = React.useRef(commands);
  const helpOpenRef = React.useRef(isHelpOpen);

  React.useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);

  React.useEffect(() => {
    helpOpenRef.current = isHelpOpen;
  }, [isHelpOpen]);

  const toggleHelp = React.useCallback(() => {
    setHelpOpen((previous) => !previous);
  }, []);

  const formatShortcut = React.useCallback(
    (combo: string) => formatShortcutLabel(combo, resolvedPlatform),
    [resolvedPlatform],
  );

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    const listenerTarget =
      target !== undefined
        ? target
        : typeof window !== "undefined"
          ? window
          : null;
    if (!listenerTarget) {
      return;
    }

    const handleKeyDown = (rawEvent: Event) => {
      const event = rawEvent as KeyboardEvent;
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      const inEditable = isEditableTarget(event.target);

      if (
        enableHelpShortcut &&
        matchesShortcutEvent(event, "?") &&
        !inEditable
      ) {
        event.preventDefault();
        setHelpOpen((previous) => !previous);
        return;
      }

      if (
        enableHelpShortcut &&
        helpOpenRef.current &&
        matchesShortcutEvent(event, "Escape")
      ) {
        event.preventDefault();
        setHelpOpen(false);
        return;
      }

      for (const command of commandsRef.current) {
        if (command.enabled === false) {
          continue;
        }
        const parsed = parseShortcutCombo(command.shortcut);
        const allowInInput = command.allowInInput ?? parsed.key === "escape";
        if (inEditable && !allowInInput) {
          continue;
        }
        if (matchesShortcutEvent(event, command.shortcut)) {
          if (command.preventDefault !== false) {
            event.preventDefault();
          }
          command.onTrigger(event);
          return;
        }
      }
    };

    listenerTarget.addEventListener("keydown", handleKeyDown);
    return () => {
      listenerTarget.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, enableHelpShortcut, target]);

  const shortcuts = React.useMemo<CommandShortcutDescriptor[]>(() => {
    const entries: CommandShortcutDescriptor[] = commands.map((command) => {
      const descriptor: CommandShortcutDescriptor = {
        id: command.id,
        label: command.label,
        shortcut: command.shortcut,
        displayShortcut: formatShortcut(command.shortcut),
        group: command.group ?? "General",
        enabled: command.enabled !== false,
      };
      if (command.description !== undefined) {
        descriptor.description = command.description;
      }
      return descriptor;
    });

    if (
      enableHelpShortcut &&
      !commands.some((command) => command.shortcut.trim() === "?")
    ) {
      entries.push({
        id: "craft.toggle-shortcut-help",
        label: "Show keyboard shortcuts",
        shortcut: "?",
        displayShortcut: "?",
        group: "Help",
        enabled: true,
      });
    }

    return entries;
  }, [commands, enableHelpShortcut, formatShortcut]);

  return {
    shortcuts,
    isHelpOpen,
    setHelpOpen,
    toggleHelp,
    formatShortcut,
  };
}
