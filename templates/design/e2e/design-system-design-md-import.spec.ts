import { expect, test, type Page } from "@playwright/test";

async function chooseMarkdown(page: Page) {
  await page.goto("/design-systems/setup");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Acme");
  await page.getByRole("radio", { name: "References", exact: true }).click();
  await expect(page.locator("[data-source]")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.locator('[data-source="designMd"]').click();
}

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

test("commits design.md only on Add without starting a provider job", async ({
  page,
}) => {
  let indexRequests = 0;
  await page.route(
    "**/_agent-native/actions/index-design-system-with-builder**",
    async (route) => {
      indexRequests += 1;
      await route.abort();
    },
  );
  await chooseMarkdown(page);
  await page.locator('input[accept=".md,.mdx"]').setInputFiles({
    name: "design.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Acme Design System\n\nUse cobalt accents and compact controls.",
    ),
  });
  await expect(page.getByText("design.md", { exact: true })).toBeVisible();
  expect(indexRequests).toBe(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const source = page.locator('[data-source="designMd"]');
  await expect(source).toHaveAttribute("data-state", "empty");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await source.click();
  await page.locator('input[accept=".md,.mdx"]').setInputFiles({
    name: "design.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Acme guidance"),
  });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(source).toHaveAttribute("data-state", "added");
  await expect(source.getByText("Added", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  expect(indexRequests).toBe(0);
  await source.click();
  await page
    .getByRole("button", { name: "Remove design.md", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(source).toHaveAttribute("data-state", "empty");
  expect(indexRequests).toBe(0);
  // Final chat handoff and its combined payload are mocked in the component tests.
});

test("stages a dropped design.md file without starting indexing", async ({
  page,
}) => {
  let indexRequests = 0;
  await page.route(
    "**/_agent-native/actions/index-design-system-with-builder**",
    async (route) => {
      indexRequests += 1;
      await route.abort();
    },
  );
  await chooseMarkdown(page);
  await page
    .getByRole("button", { name: "Upload design.md", exact: true })
    .evaluate((button) => {
      const file = new File(
        ["# Dropped Design System\n\nUse cobalt accents."],
        "design.md",
        { type: "text/markdown" },
      );
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      button.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
    });
  await expect(page.getByText("design.md", { exact: true })).toBeVisible();
  expect(indexRequests).toBe(0);
});

test("rejects design.md files larger than the inline Builder limit", async ({
  page,
}) => {
  await chooseMarkdown(page);
  await page.locator('input[accept=".md,.mdx"]').setInputFiles({
    name: "design.md",
    mimeType: "text/markdown",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, "x"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "The Markdown file must be 2 MB or smaller.",
  );
});
