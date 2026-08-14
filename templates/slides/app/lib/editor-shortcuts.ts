interface EditorShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

function isEditableSurface(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox']",
    ) !== null ||
      target.isContentEditable)
  );
}

export function shouldStopSlidesItalicShortcut(event: EditorShortcutEvent) {
  if (
    event.repeat ||
    event.isComposing ||
    event.key.toLowerCase() !== "i" ||
    event.altKey ||
    event.shiftKey ||
    !(event.ctrlKey || event.metaKey)
  ) {
    return false;
  }

  return true;
}

export function isSlidesItalicEditableTarget(event: EditorShortcutEvent) {
  return isEditableSurface(event.target);
}

export function shouldSuppressSlidesItalicShortcut(event: EditorShortcutEvent) {
  return (
    shouldStopSlidesItalicShortcut(event) &&
    !isSlidesItalicEditableTarget(event)
  );
}
