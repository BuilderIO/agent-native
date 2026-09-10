interface EditorShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  repeat: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

const EDITABLE_OR_BLOCKING_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='textbox']",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
].join(", ");

function isEditableSurface(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox']",
    ) !== null ||
      target.isContentEditable)
  );
}

function isEditableOrBlockingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(EDITABLE_OR_BLOCKING_SELECTOR) !== null
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

export function shouldActivateSlidesCommentShortcut(
  event: EditorShortcutEvent,
  {
    canComment,
    activeElement,
    focusedCanvas,
    blockingSurfaceOpen,
  }: {
    canComment: boolean;
    activeElement: Element | null;
    focusedCanvas: boolean;
    blockingSurfaceOpen: boolean;
  },
): boolean {
  if (
    !canComment ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.shiftKey ||
    blockingSurfaceOpen ||
    isEditableOrBlockingTarget(event.target) ||
    isEditableOrBlockingTarget(activeElement)
  ) {
    return false;
  }

  const key = event.key.toLowerCase();
  const plainCanvasShortcut =
    key === "c" && !event.altKey && !event.ctrlKey && !event.metaKey;
  const googleShortcut =
    key === "m" && event.altKey && (event.ctrlKey || event.metaKey);

  return googleShortcut || (plainCanvasShortcut && focusedCanvas);
}
