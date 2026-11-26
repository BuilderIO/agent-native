import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "@playwright/test";

const unavailableFocus = { available: false } as const;

export async function readCalendarSettingsFocus(page: Pick<Page, "evaluate">) {
  const timer = new AbortController();
  try {
    return await Promise.race([
      page.evaluate(() => {
        const dialog = document.querySelector(".calendar-settings-dialog");
        const active = document.activeElement;
        return {
          available: true as const,
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
      delay(500, unavailableFocus, { signal: timer.signal }),
    ]);
  } catch {
    return unavailableFocus;
  } finally {
    timer.abort();
  }
}
