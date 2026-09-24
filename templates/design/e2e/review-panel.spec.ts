import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { DESIGN_REVIEW_PANEL } from "../shared/design-flags";
import { enableFeatureFlag, gotoEditor } from "./helpers";

const AUTH_DIR = process.env.E2E_AUTH_DIR
  ? path.resolve(process.env.E2E_AUTH_DIR)
  : path.join(import.meta.dirname, ".auth");

test("clicking a review finding opens its details", async ({ page }) => {
  const { designId } = JSON.parse(
    await readFile(path.join(AUTH_DIR, "seed.json"), "utf8"),
  ) as { designId: string };
  const disableReviewPanel = await enableFeatureFlag(
    page,
    DESIGN_REVIEW_PANEL.key,
  );

  try {
    await gotoEditor(page, designId);
    const reviewToggle = page.getByRole("button", {
      name: "Review",
      exact: true,
    });
    await reviewToggle.scrollIntoViewIfNeeded();
    await expect(reviewToggle).toBeVisible();
    await reviewToggle.click();

    await expect(page.getByTestId("review-panel")).toBeVisible();
    const auditResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/run-design-audit") &&
        response.request().method() !== "OPTIONS",
    );
    await page.getByRole("button", { name: "Run audit", exact: true }).click();
    const response = await auditResponse;
    expect(
      response.ok(),
      `run-design-audit returned ${response.status()}`,
    ).toBe(true);

    const finding = page.getByRole("button", {
      name: "<img> is missing an alt attribute.",
      exact: true,
    });
    await expect(finding).toHaveAttribute("aria-expanded", "false");
    await finding.click();
    await expect(
      page.getByText(
        'Add alt="" for decorative images or a descriptive alt for informative images.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(finding).toHaveAttribute("aria-expanded", "true");
  } finally {
    await disableReviewPanel();
  }
});
