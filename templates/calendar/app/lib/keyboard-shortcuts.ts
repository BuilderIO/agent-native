const SHORTCUT_OWNERS = [
  '[contenteditable]:not([contenteditable="false"])',
  "[role='textbox']",
  "[role='combobox']",
  "input",
  "textarea",
  "select",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']",
].join(",");

export function isCalendarShortcutSuppressedTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(SHORTCUT_OWNERS) !== null;
}
