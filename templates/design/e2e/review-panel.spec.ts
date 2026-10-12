import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { DESIGN_REVIEW_TOOLS_LAB } from "../shared/labs";
import { enableLab, gotoEditor } from "./helpers";

const AUTH_DIR = process.env.E2E_AUTH_DIR
  ? path.resolve(process.env.E2E_AUTH_DIR)
  : path.join(import.meta.dirname, ".auth");

test("Threads opens in the left sidebar", async ({ page }, testInfo) => {
  const { designId } = JSON.parse(
    await readFile(path.join(AUTH_DIR, "seed.json"), "utf8"),
  ) as { designId: string };

  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Threads", exact: true }).click();

  await expect(
    page.getByText("No open threads.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Design", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("threads-sidebar.png") });
});

test("selecting a thread opens its anchored comment without changing the inspector", async ({
  page,
}) => {
  const { designId } = JSON.parse(
    await readFile(path.join(AUTH_DIR, "seed.json"), "utf8"),
  ) as { designId: string };

  await gotoEditor(page, designId);
  const screenId = await page
    .locator("[data-frame-id]")
    .first()
    .getAttribute("data-frame-id");
  if (!screenId) throw new Error("seeded design has no screen id");

  const commentResponse = await page.request.post(
    "/_agent-native/actions/create-review-comment",
    {
      data: {
        resourceType: "design",
        resourceId: designId,
        targetId: screenId,
        anchor: {
          point: { xPct: 50, yPct: 50 },
          screenId,
          screenPoint: { xPct: 50, yPct: 50 },
        },
        body: "Threads browser selection check",
        authorName: "E2E Reviewer",
      },
    },
  );
  expect(
    commentResponse.ok(),
    `create-review-comment returned ${commentResponse.status()}`,
  ).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Threads", exact: true }).click();

  const thread = page.locator("[data-review-thread-summary]");
  await expect(thread).toHaveAttribute(
    "aria-label",
    "E2E Reviewer: Threads browser selection check",
  );
  await thread.click();
  await expect(
    page
      .locator("[data-review-popover]")
      .filter({ hasText: "Threads browser selection check" })
      .last(),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Design", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("clicking a review finding opens its details", async ({ page }) => {
  const { designId } = JSON.parse(
    await readFile(path.join(AUTH_DIR, "seed.json"), "utf8"),
  ) as { designId: string };
  const restoreReviewPanel = await enableLab(page, DESIGN_REVIEW_TOOLS_LAB.key);

  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    const reviewHeading = page.getByRole("heading", {
      name: "Review",
      exact: true,
    });
    await reviewHeading.scrollIntoViewIfNeeded();
    await expect(reviewHeading).toBeVisible();

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
    await restoreReviewPanel();
  }
});
