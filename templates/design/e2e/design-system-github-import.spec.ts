import { expect, test } from "@playwright/test";

test("imports multiple GitHub sources with durable ref and path scope", async ({
  page,
}) => {
  let capturedInput: Record<string, unknown> | null = null;

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
      capturedInput = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          source: "builder",
          projectId: "project-e2e",
          jobId: "job-e2e",
          designSystemId: "ds-e2e",
          suggestedTitle: "Acme",
          builderUrl:
            "https://builder.io/app/design-system-intelligence/ds-e2e",
          status: "in-progress",
          localDesignSystemId: "builder-ds-e2e",
          githubSourceCount: 2,
        }),
      });
    },
  );

  await page.goto("/design-systems/setup");
  await expect(
    page.getByRole("heading", { name: "Set up your design system" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Connect Code", exact: true }).click();

  const repoInput = page.getByPlaceholder("https://github.com/org/repo");
  await repoInput.fill("https://github.com/acme/ui");
  await page
    .getByPlaceholder("Branch, tag, or commit (optional)")
    .fill("release/2026");
  await page
    .getByPlaceholder("Files or folders, comma-separated (optional)")
    .fill("src/styles, design.md");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await repoInput.fill("https://github.com/acme/components");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText("https://github.com/acme/ui")).toBeVisible();
  await expect(
    page.getByText("release/2026 · src/styles, design.md"),
  ).toBeVisible();
  await expect(
    page.getByText("https://github.com/acme/components"),
  ).toBeVisible();

  await page
    .getByRole("banner")
    .getByRole("button", { name: "Continue to generation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/design-systems$/);

  expect(capturedInput).toMatchObject({
    githubSources: [
      {
        repoUrl: "https://github.com/acme/ui",
        ref: "release/2026",
        include: ["src/styles", "design.md"],
      },
      { repoUrl: "https://github.com/acme/components" },
    ],
  });
});
