import { test, expect, type Page } from "@playwright/test";

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
 * These assertions are about reachability, not pixels: the dialog stays inside
 * the viewport, the last control stays inside the dialog's visible box, and
 * the page behind it does not start scrolling.
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
      // the dialog is mispositioned or clips instead of scrolling.
      const advanced = dialog.getByRole("button", { name: /advanced/i });
      await expect(advanced).toBeVisible();
      await expect(advanced).toBeInViewport({ ratio: 1 });

      const clipped = await dialog.evaluate((node) => {
        const advancedRow = [...node.querySelectorAll("button")].find(
          (button) => button.textContent?.includes("Advanced"),
        );
        if (!advancedRow) return "missing";
        const reachable =
          node.scrollHeight - node.clientHeight <= 0 ||
          getComputedStyle(node).overflowY !== "hidden";
        return reachable ? "reachable" : "clipped";
      });
      expect(clipped).toBe("reachable");
    });
  }

  test("does not push the page into a scroll", async ({ page }) => {
    await page.setViewportSize(SHORT_VIEWPORT);
    await openCreatePlanDialog(page);

    const overflow = await page.evaluate(
      () => document.body.scrollHeight - window.innerHeight,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
