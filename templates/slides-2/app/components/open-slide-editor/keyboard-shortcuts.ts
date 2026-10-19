type ShortcutAction =
  | "toggle-overview"
  | "present-fullscreen"
  | "present-windowed"
  | "open-presenter-view"
  | "toggle-inspector"
  | "edit-selected-text"
  | "previous-slide"
  | "next-slide"
  | "select-all"
  | "save";

export type OpenSlideEditorShortcut = {
  action: ShortcutAction;
  preventDefault: boolean;
};

type Options = {
  overviewOpen?: boolean;
  isTypingTarget?: boolean;
  isControlTarget?: boolean;
  isComposing?: boolean;
  hasSelectedText?: boolean;
  keyCode?: number;
};

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

/** Translate OpenSlide editor-mode keys after applying its keyboard filters. */
export function getOpenSlideEditorShortcut(
  event: KeyboardEvent,
  {
    overviewOpen = false,
    isTypingTarget: frameIsTypingTarget = false,
    isControlTarget: frameIsControlTarget = false,
    isComposing = false,
    hasSelectedText = false,
    keyCode,
  }: Options = {},
): OpenSlideEditorShortcut | null {
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

  if (event.key === "ArrowUp")
    return { action: "previous-slide", preventDefault: true };
  if (event.key === "ArrowDown")
    return { action: "next-slide", preventDefault: true };
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
