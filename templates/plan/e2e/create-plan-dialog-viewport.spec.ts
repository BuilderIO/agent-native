import { test, expect, type Locator, type Page } from "@playwright/test";

/*
 * CREATE-PLAN DIALOG GEOMETRY.
 *
 * The "Ask agent to create plan" dialog once shipped with `relative` in its
 * DialogContent className. tailwind-merge kept that and dropped the
 * primitive's `fixed`, so the dialog left the viewport, rendered in document
 * flow underneath the page, and put its last row — the Advanced trigger with
 * the source/planning-style summary — below the fold. Nothing threw; the page
 * just grew a scrollbar.
 *
 * DialogContent also capped its height and then clipped with overflow-hidden,
 * so anything past the cap was painted outside the box with no way to scroll
 * to it. Expanding Advanced is what pushes a short viewport past that cap.
 *
 * These assertions are about reachability, not pixels.
 */

const SHORT_VIEWPORT = { width: 1280, height: 700 };
const VERY_SHORT_VIEWPORT = { width: 1280, height: 480 };

async function openCreatePlanDialog(page: Page) {
  // ?create=1 is the same entry point the empty-state button uses, and it does
  // not depend on whether this account already has plans.
  await page.goto("/plans?create=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Ask agent to create plan")).toBeVisible();
  return dialog;
}

/** Overflow the dialog cannot scroll to is overflow the user cannot reach. */
async function unreachableOverflow(dialog: Locator): Promise<number> {
  return dialog.evaluate((node) => {
    const hidden = node.scrollHeight - node.clientHeight;
    if (hidden <= 0) return 0;
    return getComputedStyle(node).overflowY === "hidden" ? hidden : 0;
  });
}

async function scrollDialogToBottom(dialog: Locator) {
  await dialog.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
}

test.describe("create-plan dialog stays inside the viewport", () => {
  for (const viewport of [SHORT_VIEWPORT, VERY_SHORT_VIEWPORT]) {
    test(`at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const dialog = await openCreatePlanDialog(page);

      await expect
        .poll(async () => {
          const box = await dialog.boundingBox();
          if (!box) return null;
          return {
            aboveTop: box.y < -0.5,
            belowBottom: box.y + box.height > viewport.height + 0.5,
          };
        })
        .toEqual({ aboveTop: false, belowBottom: false });

      // The Advanced row is the last child, so it is the first thing lost when
      // the dialog is mispositioned.
      const advanced = dialog.getByRole("button", { name: /advanced/i });
      await expect(advanced).toBeInViewport({ ratio: 1 });
      expect(await unreachableOverflow(dialog)).toBe(0);

      // Expanding Advanced grows the dialog past its height cap and reveals
      // the Source and planning-style selects the report called unreachable.
      await advanced.click();
      const planningStyle = dialog.getByLabel("Agent planning style");
      await expect(dialog.getByLabel("Source")).toBeVisible();
      await expect(planningStyle).toBeVisible();

      expect(await unreachableOverflow(dialog)).toBe(0);
      await scrollDialogToBottom(dialog);
      await expect(planningStyle).toBeInViewport({ ratio: 1 });

      await expect
        .poll(async () => {
          const box = await dialog.boundingBox();
          if (!box) return null;
          return box.y + box.height > viewport.height + 0.5;
        })
        .toBe(false);
    });
  }

  test("does not push the page into a scroll", async ({ page }) => {
    await page.setViewportSize(SHORT_VIEWPORT);
    const dialog = await openCreatePlanDialog(page);
    await dialog.getByRole("button", { name: /advanced/i }).click();
    await expect(dialog.getByLabel("Agent planning style")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.body.scrollHeight - window.innerHeight,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
