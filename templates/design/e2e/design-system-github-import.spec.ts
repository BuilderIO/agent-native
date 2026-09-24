import { expect, test } from "@playwright/test";

test("commits scoped GitHub references locally and preserves them when editing is cancelled", async ({
  page,
}) => {
  let indexRequests = 0;
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
  await page.route(
    "**/_agent-native/actions/index-design-system-with-builder**",
    async (route) => {
      indexRequests += 1;
      await route.abort();
    },
  );
  await page.goto("/design-systems/setup");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Acme");
  await page.getByRole("radio", { name: "References", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const source = page.locator('[data-source="github"]');
  await expect(source).toHaveAttribute("data-state", "empty");
  await source.click();
  const repoInput = page.getByPlaceholder("https://github.com/org/repo");
  await repoInput.fill("https://github.com/example/ui");
  await page
    .getByPlaceholder("Branch, tag, or commit (optional)")
    .fill("release/2026");
  await page
    .getByPlaceholder("Files or folders, comma-separated (optional)")
    .fill("src/styles, design.md");
  await page
    .getByRole("button", { name: "Add repository", exact: true })
    .click();
  await repoInput.fill("https://github.com/example/components");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(source).toHaveAttribute("data-state", "added");
  await expect(source.getByText("Added", { exact: true })).toHaveCount(1);
  expect(indexRequests).toBe(0);
  await source.click();
  await expect(
    page.getByText(
      "https://github.com/example/ui · release/2026 · src/styles, design.md",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("https://github.com/example/components", { exact: true }),
  ).toBeVisible();
  await repoInput.fill("https://github.com/example/unconfirmed");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await source.click();
  await expect(repoInput).toHaveValue("");
  await expect(
    page.getByText("https://github.com/example/components", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove https://github.com/example/ui",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Remove https://github.com/example/components",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(source).toHaveAttribute("data-state", "empty");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  expect(indexRequests).toBe(0);
  // Final chat batching is verified with a mocked acknowledgment in component tests.
});
