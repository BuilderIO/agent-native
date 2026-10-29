const CANVAS_HOTKEY_CODE_FALLBACKS: Record<string, string> = {
  KeyA: "a",
  KeyB: "b",
  KeyC: "c",
  KeyD: "d",
  KeyE: "e",
  KeyF: "f",
  KeyG: "g",
  KeyH: "h",
  KeyI: "i",
  KeyJ: "j",
  KeyK: "k",
  KeyL: "l",
  KeyM: "m",
  KeyN: "n",
  KeyO: "o",
  KeyP: "p",
  KeyQ: "q",
  KeyR: "r",
  KeyS: "s",
  KeyT: "t",
  KeyU: "u",
  KeyV: "v",
  KeyW: "w",
  KeyX: "x",
  KeyY: "y",
  KeyZ: "z",
  BracketRight: "]",
  BracketLeft: "[",
};

/**
 * The letter a shortcut names, read from the physical key when the typed
 * character is not one: macOS Option turns G into "©", and non-Latin layouts
 * type their own script.
 */
export function normalizeCanvasHotkeyKey(
  event: Pick<KeyboardEvent, "key" | "code"> & { altKey?: boolean },
) {
  if (event.key === " ") return "space";
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (/^[a-z]$/.test(key)) return key;
  return CANVAS_HOTKEY_CODE_FALLBACKS[event.code] ?? key;
}
