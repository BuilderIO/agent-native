import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

test("empty thread canvas is not covered by an opaque transcript", async ({
  page,
}) => {
  await page.goto(`${BASE}/ask`);
  await expect(page.locator(".agentkit-composer-stack")).toHaveCount(1);
  await expect(page.locator(".agentkit-composer-stack")).toBeVisible();
  const covers = await page
    .locator(".analytics-2-new-thread .agent-panel-root")
    .evaluate((panel) => {
      const box = panel.getBoundingClientRect();
      return document
        .elementsFromPoint(box.right - 12, box.bottom - 12)
        .filter((element) => element !== panel && panel.contains(element))
        .map((element) => ({
          element: element.tagName,
          background: getComputedStyle(element).backgroundColor,
        }))
        .filter(
          ({ background }) =>
            background !== "transparent" && background !== "rgba(0, 0, 0, 0)",
        );
    });
  expect(covers).toEqual([]);
});
