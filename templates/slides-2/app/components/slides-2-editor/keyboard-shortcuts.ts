type ShortcutAction =
  | "toggle-overview"
  | "present-fullscreen"
  | "present-windowed"
  | "open-presenter-view"
  | "toggle-inspector"
  | "preview-mode"
  | "edit-mode"
  | "toggle-comment-mode"
  | "edit-selected-text"
  | "delete-selected-object"
  | "nudge-selected-object"
  | "previous-slide"
  | "next-slide"
  | "select-all"
  | "save";

export type Slides2EditorShortcut = {
  action: ShortcutAction;
  preventDefault: boolean;
  delta?: { x: number; y: number };
};

type Options = {
  overviewOpen?: boolean;
  isTypingTarget?: boolean;
  isControlTarget?: boolean;
  isComposing?: boolean;
  hasSelectedText?: boolean;
  hasSelectedObject?: boolean;
  canComment?: boolean;
  keyCode?: number;
};

type ArrowModifiers = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">;

export function shouldIgnoreModifiedArrowNavigation(
  key: string,
  modifiers: ArrowModifiers,
): boolean {
  return (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key) &&
    (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey)
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea"))
  );
}

function isShortcutControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'button, a, input, textarea, select, summary, [role="dialog"], [role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="listbox"], [role="option"], [role="tablist"], [data-inspector-ui], [data-design-ui]',
    )
  );
}

/** Translate Slides2 editor-mode keys after applying its keyboard filters. */
export function getSlides2EditorShortcut(
  event: KeyboardEvent,
  {
    overviewOpen = false,
    isTypingTarget: frameIsTypingTarget = false,
    isControlTarget: frameIsControlTarget = false,
    isComposing = false,
    hasSelectedText = false,
    hasSelectedObject = false,
    canComment = false,
    keyCode,
  }: Options = {},
): Slides2EditorShortcut | null {
  if (
    event.isComposing ||
    isComposing ||
    event.keyCode === 229 ||
    keyCode === 229 ||
    event.defaultPrevented
  ) {
    return null;
  }

  const key = event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (command && !event.altKey && !event.shiftKey && key === "s")
    return { action: "save", preventDefault: true };
  if (isTypingTarget(event.target) || frameIsTypingTarget || event.altKey) {
    return null;
  }
  if (command && key === "a") {
    if (isShortcutControlTarget(event.target) || frameIsControlTarget)
      return null;
    return { action: "select-all", preventDefault: true };
  }
  if (command) return null;

  const togglesOverview = key === "o";
  if (isShortcutControlTarget(event.target) || frameIsControlTarget)
    return null;

  if (togglesOverview)
    return { action: "toggle-overview", preventDefault: true };

  if (overviewOpen) return null;

  if (key === "i") return { action: "toggle-inspector", preventDefault: true };

  if (
    hasSelectedObject &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    const step = event.shiftKey ? 10 : 1;
    return {
      action: "nudge-selected-object",
      preventDefault: true,
      delta: {
        x:
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
        y:
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0,
      },
    };
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowUp")
    return { action: "previous-slide", preventDefault: true };
  if (event.key === "ArrowRight" || event.key === "ArrowDown")
    return { action: "next-slide", preventDefault: true };
  if (key === "v") return { action: "preview-mode", preventDefault: true };
  if (key === "e") return { action: "edit-mode", preventDefault: true };
  if (key === "c" && canComment)
    return { action: "toggle-comment-mode", preventDefault: true };
  if (
    hasSelectedObject &&
    (event.key === "Delete" || event.key === "Backspace")
  ) {
    return { action: "delete-selected-object", preventDefault: true };
  }
  if (key === "f")
    return { action: "present-fullscreen", preventDefault: false };
  if (event.key === "Enter" && hasSelectedText)
    return { action: "edit-selected-text", preventDefault: true };
  if (event.key === "Enter")
    return { action: "present-windowed", preventDefault: false };
  if (key === "p")
    return { action: "open-presenter-view", preventDefault: false };

  return null;
}
