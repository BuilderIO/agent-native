import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers.js";

let restoreDesignSystemWorkflows: (() => Promise<void>) | undefined;

async function setFeatureFlagRules(
  page: Page,
  key: string,
  rules: Record<string, unknown>,
) {
  const response = await page.request.post(
    `${e2eBaseURL()}/_agent-native/actions/set-feature-flag`,
    { data: { operation: "replace-rules", key, rules } },
  );
  if (!response.ok()) {
    throw new Error(
      `set-feature-flag failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function enableDesignSystemWorkflowsAndRestore(
  page: Page,
): Promise<() => Promise<void>> {
  const response = await page.request.get(
    `${e2eBaseURL()}/_agent-native/actions/list-feature-flags`,
  );
  if (!response.ok()) {
    throw new Error(
      `list-feature-flags failed: ${response.status()} ${await response.text()}`,
    );
  }
  const listed = await response.json();
  const key = "design-system-workflows";
  const currentRules = listed.flags?.find(
    (flag: { key: string }) => flag.key === key,
  )?.rules;
  if (!currentRules || !["off", "on", "rules"].includes(currentRules.mode)) {
    throw new Error(`list-feature-flags did not return rules for ${key}`);
  }
  const previousRules = {
    mode: currentRules.mode,
    ...(currentRules.emails !== undefined && {
      emails: currentRules.emails,
    }),
    ...(currentRules.orgIds !== undefined && {
      orgIds: currentRules.orgIds,
    }),
    ...(currentRules.percentage !== undefined && {
      percentage: currentRules.percentage,
    }),
  };

  await setFeatureFlagRules(page, key, { mode: "on" });
  return async () => {
    const restored = await setFeatureFlagRules(page, key, previousRules);
    expect(restored.rules).toMatchObject(previousRules);
  };
}

test.beforeEach(async ({ page }) => {
  restoreDesignSystemWorkflows =
    await enableDesignSystemWorkflowsAndRestore(page);
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

test.afterEach(async () => {
  await restoreDesignSystemWorkflows?.();
  restoreDesignSystemWorkflows = undefined;
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

  await page.goto("/design-systems/setup", { waitUntil: "domcontentloaded" });
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

  await expect(page.getByRole("heading", { name: "Acme" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Builder" }),
  ).toHaveAttribute("href", /design-system-intelligence\/ds-design-md-e2e/);
  expect(capturedInput).toMatchObject({
    designMd:
      "# Acme Design System\n\nUse cobalt accents and compact controls.",
  });
});

test("imports a dropped design.md file", async ({ page }) => {
  await page.goto("/design-systems/setup");
  await page
    .getByRole("button", { name: "Import design.md", exact: true })
    .click();

  await page
    .locator("#design-system-design-md-source > button")
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

  await expect(
    page.locator("#design-system-design-md-source").getByText("design.md", {
      exact: true,
    }),
  ).toBeVisible();
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
    "The Markdown file must be 2 MB or smaller.",
  );
});
