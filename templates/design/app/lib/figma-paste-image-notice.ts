/**
 * Whether to prompt about image fills a paste could not carry. Per browser,
 * because it is a reading preference: nothing else depends on knowing it, and
 * the placeholders themselves stay visible either way.
 */

const KEY = "design.figmaPasteImageNotice.dismissed";

export function figmaPasteImageNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Site data blocked: prompt rather than stay silent, since silence would
    // leave the placeholders unexplained.
    return false;
  }
}

export function dismissFigmaPasteImageNotice(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Nothing to do — the next paste asks again, as if never asked.
  }
}
