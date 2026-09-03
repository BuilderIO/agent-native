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

interface SlideToolShortcutOptions {
  canEdit: boolean;
  activeElement: Element | null;
  blockingSurfaceOpen: boolean;
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

function shouldActivateSlideTool(
  event: TextToolShortcutEvent,
  key: "r" | "t",
  { canEdit, activeElement, blockingSurfaceOpen }: SlideToolShortcutOptions,
): boolean {
  if (
    !canEdit ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.key.toLowerCase() !== key ||
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

export function shouldActivateTextTool(
  event: TextToolShortcutEvent,
  options: SlideToolShortcutOptions,
): boolean {
  return shouldActivateSlideTool(event, "t", options);
}

export function shouldActivateRectangleTool(
  event: TextToolShortcutEvent,
  options: SlideToolShortcutOptions,
): boolean {
  return shouldActivateSlideTool(event, "r", options);
}
