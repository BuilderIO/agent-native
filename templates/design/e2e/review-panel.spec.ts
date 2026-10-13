import { DESIGN_REVIEW_TOOLS_LAB } from "../shared/labs";
import { enableLab } from "./helpers";
import { expect, test } from "./rails";

const PAGE_WITH_UNLABELLED_IMAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Review fixture</title></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff;color:#111111">
  <h1 data-agent-native-node-id="title" style="margin:0 0 16px;font-size:32px">Review fixture</h1>
  <img data-agent-native-node-id="hero" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%23336699'/%3E%3C/svg%3E" width="120" height="80">
</body></html>`;

test("clicking a review finding opens its details", async ({ app, page }) => {
  const designId = await app.seed(PAGE_WITH_UNLABELLED_IMAGE);
  const restoreReviewPanel = await enableLab(page, DESIGN_REVIEW_TOOLS_LAB.key);
  try {
    await app.open(designId);
    const panel = page.getByTestId("review-panel");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible();

    const auditResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/run-design-audit") &&
        response.request().method() !== "OPTIONS",
    );
    await page.getByRole("button", { name: "Run audit", exact: true }).click();
    expect((await auditResponse).ok()).toBe(true);

    const findings = panel.locator('div[role="button"][aria-label]');
    await expect
      .poll(() =>
        findings.evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("aria-label")),
        ),
      )
      .toStrictEqual(["<img> is missing an alt attribute."]);
    const finding = panel.getByRole("button", {
      name: "<img> is missing an alt attribute.",
      exact: true,
    });
    await expect(finding).toHaveAttribute("aria-expanded", "false");
    const detail = panel.getByText(
      'Add alt="" for decorative images or a descriptive alt for informative images.',
      { exact: true },
    );
    await expect(detail).toHaveCount(0);

    await finding.click();

    await expect(finding).toHaveAttribute("aria-expanded", "true");
    await expect(detail).toBeVisible();
    await expect(
      panel.locator('[aria-expanded="true"][role="button"]'),
    ).toHaveCount(1);
  } finally {
    await restoreReviewPanel();
  }
});
