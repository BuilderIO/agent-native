interface EditorShortcutEvent {
  key: string;
  code?: string;
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

function isFormControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select") !== null
  );
}

export function isGoogleSlidesCommentShortcut(event: EditorShortcutEvent) {
  return (
    !event.repeat &&
    !event.isComposing &&
    !event.shiftKey &&
    (event.key.toLowerCase() === "m" || event.code === "KeyM") &&
    event.altKey &&
    (event.ctrlKey || event.metaKey)
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
  if (!canComment || blockingSurfaceOpen) {
    return false;
  }

  const key = event.key.toLowerCase();
  const plainCanvasShortcut =
    key === "c" && !event.altKey && !event.ctrlKey && !event.metaKey;
  if (isGoogleSlidesCommentShortcut(event)) {
    return (
      focusedCanvas &&
      !isFormControlTarget(event.target) &&
      !isFormControlTarget(activeElement)
    );
  }

  return (
    !event.defaultPrevented &&
    !event.repeat &&
    !event.isComposing &&
    !event.shiftKey &&
    plainCanvasShortcut &&
    focusedCanvas &&
    !isEditableOrBlockingTarget(event.target) &&
    !isEditableOrBlockingTarget(activeElement)
  );
}

export function shouldCreateSlideWithShortcut(
  event: EditorShortcutEvent,
  {
    canEdit,
    activeElement,
    blockingSurfaceOpen,
  }: {
    canEdit: boolean;
    activeElement: Element | null;
    blockingSurfaceOpen: boolean;
  },
): boolean {
  return (
    canEdit &&
    !event.defaultPrevented &&
    !event.repeat &&
    !event.isComposing &&
    event.key.toLowerCase() === "m" &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !blockingSurfaceOpen &&
    !isEditableOrBlockingTarget(event.target) &&
    !isEditableOrBlockingTarget(activeElement)
  );
}
