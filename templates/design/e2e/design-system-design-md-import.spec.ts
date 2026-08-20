import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/_agent-native/actions/list-designs**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ designs: [] }),
    });
  });
  await page.route(
    "**/_agent-native/actions/list-design-systems**",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ designSystems: [] }),
      });
    },
  );
});

test("imports design.md guidance through Builder DSI", async ({ page }) => {
  let capturedInput: Record<string, unknown> | null = null;

  await page.route(
    "**/_agent-native/actions/index-design-system-with-builder**",
    async (route) => {
      capturedInput = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          source: "builder",
          projectId: "project-design-md-e2e",
          jobId: "job-design-md-e2e",
          designSystemId: "ds-design-md-e2e",
          suggestedTitle: "Acme",
          builderUrl:
            "https://builder.io/app/design-system-intelligence/ds-design-md-e2e",
          status: "in-progress",
          localDesignSystemId: "builder-ds-design-md-e2e",
          uploadedFileCount: 1,
        }),
      });
    },
  );

  await page.goto("/design-systems/setup");
  await page
    .getByRole("button", { name: "Import design.md", exact: true })
    .click();
  await page.locator('input[accept=".md,.mdx"]').setInputFiles({
    name: "design.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Acme Design System\n\nUse cobalt accents and compact controls.",
    ),
  });

  await expect(
    page.locator("#design-system-design-md-source").getByText("design.md", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Continue to generation", exact: true })
    .click();

  await expect(page).toHaveURL(/\/design-systems$/);
  expect(capturedInput).toMatchObject({
    designMd:
      "# Acme Design System\n\nUse cobalt accents and compact controls.",
  });
});

test("rejects design.md files larger than the inline Builder limit", async ({
  page,
}) => {
  await page.goto("/design-systems/setup");
  await page
    .getByRole("button", { name: "Import design.md", exact: true })
    .click();
  await page.locator('input[accept=".md,.mdx"]').setInputFiles({
    name: "design.md",
    mimeType: "text/markdown",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, "x"),
  });

  await expect(page.getByRole("alert")).toHaveText(
    "design.md must be 2 MB or smaller.",
  );
});
