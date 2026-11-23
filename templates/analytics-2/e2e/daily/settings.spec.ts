import { expect, test, uniqueName, type Daily } from "./fixtures";
import { deleteSecret } from "./setup.helpers";

const FAST = { timeout: 400 };

async function openSettings(daily: Daily, path: string) {
  await daily.open(path);
  await expect(
    daily.page.getByRole("link", { name: "Profile", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("settings", () => {
  test("SETTINGS-01 open settings and go back", async ({ daily }) => {
    await daily.open("/home");
    const gear = daily.page.locator('a[href="/settings"]').first();
    await expect(gear).toBeVisible({ timeout: 30_000 });
    await daily.click(gear);
    await expect(daily.page).toHaveURL(/\/settings(\/general)?$/);
    await expect(daily.page).toHaveTitle("Settings");
    await daily.check({ url: /\/settings(\/general)?$/ });
    const back = daily.page.getByRole("link", {
      name: "Settings",
      exact: true,
    });
    await daily.click(back);
    await expect(daily.page).toHaveURL(/\/home$/);
    await daily.check({ url: /\/home$/ });
  });

  test("SETTINGS-02 settings nav groups and filter", async ({ daily }) => {
    // FINDING COV-SETTINGS-02: the settings nav has no filter box, so "No matching settings" never shows.
    test.fail();
    await openSettings(daily, "/settings");
    for (const group of [
      "Account",
      "Workspace",
      "Features",
      "Projects",
      "Access & Security",
    ])
      await expect(
        daily.page.getByText(group, { exact: true }).first(),
      ).toBeVisible();
    const filter = daily.page
      .getByRole("textbox", { name: /filter|search settings/i })
      .or(daily.page.getByPlaceholder(/filter|search/i))
      .first();
    await expect(filter).toBeVisible(FAST);
    await filter.click();
    await daily.type("zzzz-no-such-setting");
    await expect(
      daily.page.getByText("No matching settings", { exact: true }),
    ).toBeVisible(FAST);
  });

  test("SETTINGS-03 preferences editor options and theme", async ({
    daily,
  }) => {
    // FINDING COV-SETTINGS-03: Preferences has no per-cell-type editor options (word wrap, line numbers) or Light / Dark theme choice.
    test.fail();
    await openSettings(daily, "/settings/preferences");
    await daily.check({ url: /\/settings\/preferences$/ });
    await expect(
      daily.page.getByRole("heading", { name: "Preferences" }),
    ).toBeVisible(FAST);
    for (const cell of ["Markdown", "SQL", "Code"])
      await expect(
        daily.page.getByText(cell, { exact: true }).first(),
      ).toBeVisible(FAST);
    await expect(daily.page.getByText(/word wrap/i).first()).toBeVisible(FAST);
    await expect(daily.page.getByText(/line numbers/i).first()).toBeVisible(
      FAST,
    );
    for (const theme of ["Light", "Dark"])
      await expect(
        daily.page.getByText(theme, { exact: true }).first(),
      ).toBeVisible(FAST);
  });

  test("SETTINGS-04 notification toggles", async ({ daily }) => {
    // FINDING COV-SETTINGS-04: Notifications shows only a desktop "Response completed" toggle, not the per-event toggles.
    test.fail();
    await openSettings(daily, "/settings/notifications");
    await daily.check({ url: /\/settings\/notifications$/ });
    for (const label of [
      "Comments",
      "Text cell",
      "Project shared with you",
      "Project run successes",
      "Project run failures",
      "API token expiration",
      "Project access request",
      "Workspace role request",
      "Agent thread flagged for review",
      "Admin project access",
      "Project auto-archived",
      "Project archived or trashed",
      "Project review requests",
      "Project reviewed",
      "Component upgrade available",
      "Component import cell updates",
    ])
      await expect(
        daily.page.getByText(label, { exact: true }).first(),
        label,
      ).toBeVisible(FAST);
  });

  test("SETTINGS-05 connected apps", async ({ daily }) => {
    // FINDING COV-SETTINGS-05: "Connected apps" lists available integrations instead of the user's OAuth grants with an empty "No connected apps" state.
    test.fail();
    await openSettings(daily, "/settings/connected-apps");
    await daily.check({ url: /\/settings\/connected-apps$/ });
    await expect(
      daily.page.getByText("Connected apps", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      daily.page.getByText(/^(No connected apps|No OAuth tokens)$/).first(),
    ).toBeVisible(FAST);
  });

  test("SETTINGS-06 turning memory off asks what to keep", async ({
    daily,
  }) => {
    // FINDING COV-SETTINGS-06: there is no memory switch whose off position opens "Disable memory".
    test.fail();
    await openSettings(daily, "/settings/preferences");
    const memory = daily.page.getByRole("switch", { name: /memory/i }).first();
    await expect(memory).toBeVisible(FAST);
    await memory.click();
    const dialog = daily.page.getByRole("dialog", { name: "Disable memory" });
    await expect(dialog).toBeVisible(FAST);
    await expect(dialog.getByText("Keep existing memories")).toBeVisible();
    await expect(dialog.getByText("Delete all memories")).toBeVisible();
  });

  test("SETTINGS-07 AI settings and custom keys", async ({ daily }) => {
    // FINDING COV-SETTINGS-07: AI & agents has no "Manage AI features for your workspace." page with the custom OpenAI + Anthropic key form.
    test.fail();
    await openSettings(daily, "/settings/agent");
    await daily.check({ url: /\/settings\/agent$/ });
    await expect(
      daily.page.getByText("Manage AI features for your workspace.", {
        exact: true,
      }),
    ).toBeVisible(FAST);
    await expect(
      daily.page.getByText(
        "Use your own custom API keys to control governance and billing. Both OpenAI and Anthropic keys are required.",
        { exact: true },
      ),
    ).toBeVisible(FAST);
    await expect(
      daily.page.getByPlaceholder("Give your key a name"),
    ).toBeVisible(FAST);
    await expect(
      daily.page.getByText("Organization ID", { exact: true }),
    ).toBeVisible(FAST);
  });

  test("SETTINGS-08 project security toggles", async ({ daily }) => {
    // FINDING COV-SETTINGS-08: there is no workspace Sharing / Export / Data access settings section.
    test.fail();
    await openSettings(daily, "/settings/general");
    const security = daily.page
      .getByRole("link", { name: /Security|Sharing/ })
      .first();
    await expect(security).toBeVisible(FAST);
    await security.click();
    for (const label of [
      "Share projects to web",
      "Allow projects to be shared with guests",
      "Share projects with workspace",
      "Share new projects with workspace by default",
      "Share new Threads with workspace by default",
      "Generate app links with current inputs",
      "Export apps as PDFs",
      "Download and copy CSVs from tables",
      "Export to Google Sheets",
      "Allow file uploads",
      "Allow project-level data connections",
      "Show workspace secret values in project UI",
    ])
      await expect(
        daily.page.getByText(label, { exact: true }),
        label,
      ).toBeVisible(FAST);
  });

  test("SETTINGS-09 users and roles", async ({ daily }) => {
    // FINDING COV-SETTINGS-09: Users has "Role requests" but no "User attributes", "Embed users", "Allowed email domains" or "Invite links" subsections.
    test.fail();
    await openSettings(daily, "/settings/users");
    await daily.check({ url: /\/settings\/users$/ });
    await expect(daily.page.getByText("dev@local.test").first()).toBeVisible({
      timeout: 15_000,
    });
    for (const label of [
      "Role requests",
      "User attributes",
      "Embed users",
      "Allowed email domains",
      "Invite links",
    ])
      await expect(
        daily.page.getByText(label, { exact: true }).first(),
        label,
      ).toBeVisible(FAST);
  });

  test("SETTINGS-10 compute and environment", async ({ daily }) => {
    // FINDING COV-SETTINGS-10: settings have no Compute / Environment page (usage, kernels, timezone, SQL caching, images).
    test.fail();
    await openSettings(daily, "/settings");
    const compute = daily.page
      .getByRole("link", { name: /Compute|Environment/ })
      .first();
    await expect(compute).toBeVisible(FAST);
    await compute.click();
    for (const label of [
      "Usage",
      "Kernels",
      "Workspace timezone",
      "Workspace SQL caching",
      "Python Kernel settings",
      "Docker image repositories",
      "Custom kernels",
      "Custom images",
    ])
      await expect(
        daily.page.getByText(label, { exact: true }).first(),
        label,
      ).toBeVisible(FAST);
  });

  test("SETTINGS-11 data connections admin", async ({ daily }) => {
    // FINDING COV-SETTINGS-11: Data sources has no "Add data connection" button or BigQuery OAuth apps section ("Add a BigQuery OAuth app", "No apps yet").
    test.fail();
    await openSettings(daily, "/settings/data-sources");
    await daily.check({ url: /\/settings\/data-sources$/ });
    await expect(
      daily.page.getByText("[Demo] Public Data").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      daily.page.getByRole("button", { name: "Add data connection" }),
    ).toBeVisible(FAST);
    await expect(
      daily.page.getByText("No apps yet", { exact: true }),
    ).toBeVisible(FAST);
    const addApp = daily.page.getByRole("button", {
      name: "Add a BigQuery OAuth app",
    });
    await expect(addApp).toBeVisible(FAST);
    await addApp.click();
    for (const label of [
      "App name",
      "BigQuery Project ID",
      "OAuth Client ID",
      "OAuth Client secret",
    ])
      await expect(
        daily.page.getByText(label, { exact: true }).first(),
        label,
      ).toBeVisible(FAST);
    await expect(
      daily.page.getByRole("button", { name: "Add app" }),
    ).toBeVisible(FAST);
  });

  test("SETTINGS-12 secrets: save and remove a key", async ({ daily }) => {
    const KEY = "HUBSPOT_MCP_CLIENT_ID";
    const LABEL = "HubSpot MCP OAuth client ID";
    try {
      await openSettings(daily, `/settings/secrets#secrets:${KEY}`);
      const input = daily.page.locator(`input[aria-label="${LABEL}"]`);
      const row = daily.page
        .locator("div.border-b")
        .filter({ hasText: LABEL })
        .first();
      await expect(row).toBeVisible();
      const toggle = row.locator("button[aria-expanded]").first();
      if ((await toggle.getAttribute("aria-expanded")) !== "true")
        await toggle.click();
      const rotateExisting = row.getByRole("button", {
        name: "Rotate",
        exact: true,
      });
      if (await rotateExisting.isVisible()) await rotateExisting.click();
      await expect(input).toBeVisible();
      await expect(
        row.getByRole("button", { name: "Test", exact: true }),
      ).toBeVisible();
      const save = row.getByRole("button", { name: "Save", exact: true });
      await input.fill(uniqueName("client-id").replaceAll(" ", "-"));
      await daily.click(save);
      await expect(
        daily.page.getByText("Saved", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await daily.check({
        url: new RegExp(`/settings/secrets#secrets:${KEY}$`),
      });
      daily.allowResponse.push(new RegExp(`/_agent-native/secrets/${KEY}$`));
      await daily.page.route(
        new RegExp(`/_agent-native/secrets/${KEY}$`),
        (route) =>
          route.request().method() === "POST"
            ? route.fulfill({
                status: 503,
                contentType: "text/html",
                body: "unavailable",
              })
            : route.continue(),
      );
      const rotate = row.getByRole("button", { name: "Rotate", exact: true });
      await expect(
        rotate,
        "the saved credential has finished refreshing",
      ).toBeVisible({ timeout: 15_000 });
      await rotate.click();
      await row.locator("input").first().fill("second-value");
      await row.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        daily.page.getByText("Save failed (503)", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteSecret(daily, KEY);
    }
  });

  test("SETTINGS-13 theme command switches without reload", async ({
    daily,
  }) => {
    // FINDING COV-SETTINGS-13: the search palette has no "Theme: Enable Dark theme" / "Enable Light theme" commands.
    test.fail();
    await daily.open("/home");
    await expect(
      daily.page.getByText("JUMP BACK IN", { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await daily.press("ControlOrMeta+k");
    await daily.type("Enable Dark theme");
    const command = daily.page
      .getByRole("option", { name: /Enable Dark theme/ })
      .first();
    await expect(command).toBeVisible(FAST);
    await daily.press("Enter");
    await expect(daily.page.locator("html")).toHaveClass(/dark/, FAST);
    await daily.check({ url: /\/home$/ });
  });

  test("SETTINGS-14 billing page", async ({ daily }) => {
    // FINDING COV-SETTINGS-14: there is no "Plan & billing" page; /settings/billing falls back to General.
    test.fail();
    await openSettings(daily, "/settings/billing");
    await expect(daily.page).toHaveURL(/\/settings\/billing$/, FAST);
    for (const label of [
      "Billing history",
      "No billing history yet",
      "Pending charges and balances",
      "Credits overview",
      "Credit usage controls",
    ])
      await expect(
        daily.page.getByText(label, { exact: true }).first(),
        label,
      ).toBeVisible(FAST);
  });
});
