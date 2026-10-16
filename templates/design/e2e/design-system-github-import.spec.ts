import { type Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, test } from "./rails";

const FLAG = "design-system-workflows";

async function setFlagRules(page: Page, rules: Record<string, unknown>) {
  const response = await page.request.post(
    appPath("/_agent-native/actions/set-feature-flag"),
    {
      data: { operation: "replace-rules", key: FLAG, rules },
    },
  );
  expect(response.ok(), `set-feature-flag ${response.status()}`).toBe(true);
}

/** Turns the setup flow on (it is behind a waitlist) and returns a function that restores the flag's rules. */
async function enableDesignSystemWorkflows(page: Page) {
  const response = await page.request.get(
    appPath("/_agent-native/actions/list-feature-flags"),
  );
  expect(response.ok(), `list-feature-flags ${response.status()}`).toBe(true);
  const { flags } = (await response.json()) as {
    flags: { key: string; rules: Record<string, unknown> }[];
  };
  const { mode, emails, orgIds, percentage } = flags.find(
    (flag) => flag.key === FLAG,
  )!.rules;
  await setFlagRules(page, { mode: "on" });
  return () => setFlagRules(page, { mode, emails, orgIds, percentage });
}

/** Answers only the Builder plan lookup inside the editor's batched reads as an Enterprise plan. */
async function grantBuilderCodeIndexing(page: Page) {
  await page.route(
    "**/_agent-native/actions/get-actions-batch**",
    async (route) => {
      const { requests } = route.request().postDataJSON() as {
        requests: { action: string }[];
      };
      const response = await route.fetch();
      const json = (await response.json()) as { results: { body: unknown }[] };
      requests.forEach((request, index) => {
        if (request.action !== "get-design-system-tier-limit") return;
        json.results[index]!.body = {
          status: "ok",
          plan: "enterprise",
          current: 0,
          max: null,
          atMax: false,
          codeIndexingAllowed: true,
          upgradeUrl: null,
        };
      });
      await route.fulfill({ response, json });
    },
  );
}

// Both routed actions only proxy Builder (plan lookup, DSI indexing), which the local runner can't reach; the
// indexer's server side is covered by actions/index-design-system-with-builder.test.ts.
test("Connect Code sends every added GitHub source with its ref and comma-split paths to the Builder indexer", async ({
  app,
}) => {
  const page = app.page;
  await grantBuilderCodeIndexing(page);
  const sent: unknown[] = [];
  await page.route(
    "**/_agent-native/actions/index-design-system-with-builder**",
    async (route) => {
      sent.push(route.request().postDataJSON());
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

  const restoreFlag = await enableDesignSystemWorkflows(page);
  try {
    await page.goto(appPath("/design-systems/setup"));
    await expect(
      page.getByRole("heading", { name: "Set up your design system" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Connect Code", exact: true })
      .click();

    const repoInput = page.getByPlaceholder("https://github.com/org/repo");
    await repoInput.fill("https://github.com/acme/ui");
    await page
      .getByPlaceholder("Branch, tag, or commit (optional)")
      .fill("release/2026");
    await page
      .getByPlaceholder("Files or folders, comma-separated (optional)")
      .fill("src/styles, /design.md/");
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
    await expect(page.getByRole("heading", { name: "Acme" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open in Builder" }),
    ).toHaveAttribute("href", /design-system-intelligence\/ds-e2e/);

    expect(sent).toEqual([
      {
        githubSources: [
          {
            repoUrl: "https://github.com/acme/ui",
            ref: "release/2026",
            include: ["src/styles", "design.md"],
          },
          { repoUrl: "https://github.com/acme/components" },
        ],
      },
    ]);
  } finally {
    await restoreFlag();
  }
});
