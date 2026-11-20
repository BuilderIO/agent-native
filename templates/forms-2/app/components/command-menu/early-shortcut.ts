type EarlyWindow = Window & { __searchKeyPressed?: boolean };

/** Inline in the document head, so a ⌘K pressed while the app hydrates is not lost. */
export const EARLY_SHORTCUT_SCRIPT = `window.__searchKeyPressed=false;window.addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k")window.__searchKeyPressed=true})`;

export function consumeEarlyShortcut(): boolean {
  const pressed = (window as EarlyWindow).__searchKeyPressed === true;
  (window as EarlyWindow).__searchKeyPressed = false;
  return pressed;
}
