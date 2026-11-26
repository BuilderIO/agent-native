import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "@playwright/test";

export async function readCalendarSettingsFocus(page: Pick<Page, "evaluate">) {
  const timer = new AbortController();
  try {
    return await Promise.race([
      page.evaluate(() => {
        const dialog = document.querySelector(".calendar-settings-dialog");
        const active = document.activeElement;
        return {
          documentFocused: document.hasFocus(),
          documentVisible: document.visibilityState === "visible",
          dialogPresent: dialog !== null,
          activeElementInside: dialog?.contains(active) ?? false,
          dialogMatchesFocusWithin: dialog?.matches(":focus-within") ?? false,
          bodyFocused: active !== null && active === document.body,
          anotherDialogVisible: Array.from(
            document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
          ).some(
            (node) =>
              node !== dialog &&
              !dialog?.contains(node) &&
              node.getClientRects().length > 0 &&
              getComputedStyle(node).visibility === "visible",
          ),
        };
      }),
      delay(500, undefined, { signal: timer.signal }),
    ]);
  } catch {
    return undefined;
  } finally {
    timer.abort();
  }
}
