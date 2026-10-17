const KEY = "design.figmaPasteImageNotice.dismissed";

export function figmaPasteImageNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
    // coercion-ok: an unreadable store carries no recorded preference, the same state as never having asked
  } catch {
    return false;
  }
}

export function dismissFigmaPasteImageNotice(): void {
  try {
    localStorage.setItem(KEY, "1");
    // coercion-ok: a choice that cannot be stored means the next paste asks again, the behaviour before this preference existed
  } catch {
    return;
  }
}
