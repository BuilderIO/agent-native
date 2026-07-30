export interface TextToolShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
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

function isEditableOrBlockingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(EDITABLE_OR_BLOCKING_SELECTOR) !== null
  );
}

export function shouldActivateTextTool(
  event: TextToolShortcutEvent,
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
  if (
    !canEdit ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.key.toLowerCase() !== "t" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    blockingSurfaceOpen
  ) {
    return false;
  }

  return (
    !isEditableOrBlockingTarget(event.target) &&
    !isEditableOrBlockingTarget(activeElement)
  );
}
