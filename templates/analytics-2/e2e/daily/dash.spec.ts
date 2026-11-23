import { open, projectUrl, seed, trashProject } from "./dash.helpers";
import { expect, test, uniqueName, type Daily } from "./fixtures";
import {
  cellAt,
  cellLocator,
  editorOf,
  enterCommandMode,
  MOD,
  SAMPLE_CONNECTION,
  type Notebook,
} from "./notebook.helpers";
import {
  grantClipboard,
  listRow,
  openListRowMenu,
  publish,
} from "./objects.helpers";

const fast = { timeout: 400 };

test.describe("DASH", () => {
  test.describe.configure({ timeout: 45_000 });
  const created: string[] = [];
  test.afterEach(async ({ daily }) => {
    for (const id of created.splice(0)) await trashProject(daily, id);
  });

  async function sqlProject(daily: Daily, title?: string): Promise<Notebook> {
    const nb = await seed(
      daily,
      [
        {
          kind: "sql",
          text: "select * from orders limit 5",
          connection: SAMPLE_CONNECTION,
        },
      ],
      title,
    );
    created.push(nb.id);
    return nb;
  }

  const appBuilder = (daily: Daily) => daily.page.locator(".nb-app-builder");
  const shareButton = (daily: Daily) =>
    daily.page
      .locator(".nb-header-right")
      .getByRole("button", { name: "Share", exact: true });

  async function openShare(daily: Daily, nb: Notebook) {
    await open(daily, nb);
    await expect(shareButton(daily)).toBeVisible(fast);
    await daily.click(shareButton(daily), { label: "Share" });
    await daily.check({ url: projectUrl(nb) });
  }

  test("DASH-03 app starting state", async ({ daily }) => {
    test.fail(); // FINDING COV-DASH-03: a published app that is still loading reads "Loading…", not "Starting app"
    const nb = await sqlProject(daily);
    await publish(daily, nb.id);
    await daily.page.route("**/_agent-native/actions/get-*", async (route) => {
      await new Promise((done) => setTimeout(done, 1_500));
      await route.continue();
    });
    await daily.open(`/app/${nb.id}`);
    await expect(daily.page.getByText("Starting app")).toBeVisible(fast);
  });

  test("DASH-04 publish page from mod+shift+p", async ({ daily }) => {
    test.fail(); // FINDING COV-DASH-04: publishing is a small "Publish app" dialog, not the publish page (Back to project, Compare side by side, Pre-publish checks, Settings, Share my credentials, Request review)
    const nb = await sqlProject(daily);
    await open(daily, nb);
    await enterCommandMode(daily, 0);
    await daily.press(`${MOD}+Shift+p`);
    await expect(daily.page.getByText("Publish app").first()).toBeVisible();
    await daily.check({ url: projectUrl(nb), focus: "body-ok" });
    for (const name of [
      "Back to project",
      "Compare side by side",
      "Run all",
      "Request review",
    ])
      await expect(
        daily.page.getByRole("button", { name, exact: true }),
      ).toBeVisible(fast);
    for (const text of [
      "Pre-publish checks",
      "Settings",
      "Share my credentials",
    ])
      await expect(daily.page.getByText(text, { exact: true })).toBeVisible(
        fast,
      );
  });

  test("DASH-05 pre-publish checks", async ({ daily }) => {
    test.fail(); // FINDING COV-DASH-04: no pre-publish checks ("Running cells", "All cells ran", "No app errors reported")
    const nb = await sqlProject(daily);
    await open(daily, nb);
    await daily.click(
      daily.page.getByRole("button", { name: "Publish app", exact: true }),
    );
    await daily.check({ url: projectUrl(nb), focus: "body-ok" });
    await expect(
      daily.page.getByText("Pre-publish checks", { exact: true }),
    ).toBeVisible(fast);
    await expect(
      daily.page.getByText("All cells ran", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      daily.page.getByText("No app errors reported", { exact: true }),
    ).toBeVisible(fast);
  });

  test("DASH-06 first publish has no live app to compare", async ({
    daily,
  }) => {
    test.fail(); // FINDING COV-DASH-04: no side-by-side compare pane, so no "No live app yet" state
    const nb = await sqlProject(daily);
    await open(daily, nb);
    await daily.click(
      daily.page.getByRole("button", { name: "Publish app", exact: true }),
    );
    await daily.check({ url: projectUrl(nb), focus: "body-ok" });
    await expect(
      daily.page.getByText("No live app yet", { exact: true }),
    ).toBeVisible(fast);
    await expect(
      daily.page.getByText("Publish once to compare against it."),
    ).toBeVisible(fast);
  });

  test("DASH-07 publish makes the app live", async ({ daily }) => {
    test.fail(); // FINDING COV-DASH-05: after publishing there is no "Open app" control in the project
    const nb = await sqlProject(daily);
    await open(daily, nb);
    await daily.click(
      daily.page.getByRole("button", { name: "Publish app", exact: true }),
    );
    const dialog = daily.dialog();
    await expect(dialog).toBeVisible();
    await daily.check({
      url: projectUrl(nb),
      focus: dialog.getByRole("textbox"),
    });
    await daily.type("first version");
    await daily.press(`${MOD}+Enter`);
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect(
      daily.page.getByRole("button", { name: "Publish changes", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await daily.check({ url: projectUrl(nb) });
    await expect(
      daily.page
        .getByRole("button", { name: "Open app" })
        .or(daily.page.getByRole("link", { name: "Open app" })),
    ).toBeVisible(fast);
  });

  test("DASH-08 publish warns about unsaved edits", async ({ daily }) => {
    test.fail(); // FINDING COV-DASH-06: publishing with unsaved cell edits gives no "Save them first, or they won't be published" warning
    const nb = await sqlProject(daily);
    await open(daily, nb);
    await daily.page.route(
      "**/_agent-native/actions/save-project-cell",
      () => undefined,
    );
    await editorOf(cellAt(daily.page, 0)).press("End");
    await daily.type(" -- draft");
    await daily.page
      .getByRole("button", { name: "Publish app", exact: true })
      .click();
    await expect(
      daily.page.getByText(/Save them first, or they won.t be published/),
    ).toBeVisible(fast);
  });

  test("DASH-09 share dialog", async ({ daily }) => {
    test.fail(); // FINDING 586: the project header has no Share control
    const nb = await sqlProject(daily);
    await openShare(daily, nb);
    const dialog = daily.dialog();
    await expect(dialog.getByText(`Share ${nb.title}`)).toBeVisible(fast);
    await expect(dialog.getByText(/^Everyone at /).first()).toBeVisible(fast);
    await expect(dialog.getByText("Anyone with the link").first()).toBeVisible(
      fast,
    );
  });

  test("DASH-10 copy link menu", async ({ daily }) => {
    test.fail(); // FINDING 586: no Share > Copy link menu (project, published app, current view, collaborative session)
    const nb = await sqlProject(daily);
    await openShare(daily, nb);
    await daily.click(
      daily
        .dialog()
        .getByRole("button", { name: /Copy link/ })
        .first(),
    );
    for (const name of [
      /entire project/i,
      /published app/i,
      /current view/i,
      /collaborative session/i,
    ])
      await expect(
        daily.menu().getByRole("menuitem", { name }).first(),
      ).toBeVisible(fast);
    await expect(
      daily.menu().getByText("This project has not been published."),
    ).toBeVisible(fast);
  });

  test("DASH-11 copy link toast", async ({ daily }) => {
    const nb = await sqlProject(daily, uniqueName("Copy link"));
    await grantClipboard(daily);
    await daily.open("/home/all");
    await openListRowMenu(daily.page, nb.title);
    await daily.check({ url: /\/home\/all$/, focus: "body-ok" });
    await daily.click(
      daily
        .menu()
        .getByRole("menuitem", { name: "Copy link" })
        .or(daily.page.getByRole("menuitem", { name: "Copy link" }))
        .first(),
    );
    await expect
      .poll(() => daily.page.evaluate(() => navigator.clipboard.readText()))
      .toContain(nb.id);
    await daily.check({ url: /\/home\/all$/, focus: "body-ok" });
    await expect(daily.toast("Link copied to clipboard")).toBeVisible(fast);
  });

  test("DASH-12 embed options", async ({ daily }) => {
    test.fail(); // FINDING 586: no Share > Embed ("Embeddable link", "Embed code")
    const nb = await sqlProject(daily);
    await openShare(daily, nb);
    await daily.click(daily.dialog().getByRole("button", { name: "Embed" }));
    await expect(daily.page.getByText("Select app embed type")).toBeVisible(
      fast,
    );
    await expect(daily.page.getByText("Embeddable link")).toBeVisible(fast);
    await expect(daily.page.getByText("Embed code")).toBeVisible(fast);
  });

  test("DASH-13 sharing an untitled project asks for a name", async ({
    daily,
  }) => {
    test.fail(); // FINDING 586: no Share control, so no "Name before sharing?" prompt
    const nb = await sqlProject(daily, "");
    await openShare(daily, nb);
    await expect(daily.page.getByText("Name before sharing?")).toBeVisible(
      fast,
    );
  });

  test("DASH-14 removing the only owner asks to confirm", async ({ daily }) => {
    test.fail(); // FINDING 586: the share panel cannot change access, so there is no last-owner confirmation
    const nb = await sqlProject(daily);
    await openShare(daily, nb);
    await daily.click(
      daily
        .dialog()
        .getByRole("button", { name: /Remove|Owner/ })
        .first(),
    );
    await expect(
      daily.page.getByText("You are the only owner of this project."),
    ).toBeVisible(fast);
    await expect(
      daily.page.getByRole("button", { name: "Confirm" }),
    ).toBeVisible(fast);
  });

  test("DASH-15 present mode with mod+.", async ({ daily }) => {
    test.fail(); // FINDING COV-DASH-07: mod+. does not enter presentation mode
    const nb = await sqlProject(daily);
    await open(daily, nb);
    await daily.click(
      daily.page.getByRole("button", { name: "App builder", exact: true }),
    );
    await expect(appBuilder(daily)).toBeVisible({ timeout: 10_000 });
    await daily.check({ url: projectUrl(nb, "/app") });
    await daily.page.keyboard.press(`${MOD}+Period`);
    await expect(daily.page.locator(".nb-view-tabs")).toBeHidden(fast);
  });

  test("DASH-16 published and draft tags with viewer stats copy", async ({
    daily,
  }) => {
    test.fail(); // FINDING COV-DASH-02: project list rows carry no "Published" / "Draft" tag or viewer stats
    const live = await sqlProject(daily, uniqueName("Stats live"));
    const draft = await sqlProject(daily, uniqueName("Stats draft"));
    await publish(daily, live.id);
    await daily.open("/home/all");
    await expect(listRow(daily.page, draft.title)).toBeVisible({
      timeout: 30_000,
    });
    await daily.check({ url: /\/home\/all$/ });
    await expect(
      listRow(daily.page, live.title).getByText("Published", { exact: true }),
    ).toBeVisible(fast);
    await expect(
      listRow(daily.page, draft.title).getByText("Draft", { exact: true }),
    ).toBeVisible(fast);
    await listRow(daily.page, draft.title).hover();
    await expect(
      daily.page.getByText("Publish your app to see viewer counts & trends."),
    ).toBeVisible(fast);
  });

  test("DASH-17 view live version from the command palette", async ({
    daily,
  }) => {
    test.fail(); // FINDING COV-DASH-08: the project has no command palette with "View live version" / "Copy link to app"
    const nb = await sqlProject(daily);
    await publish(daily, nb.id);
    await open(daily, nb);
    await enterCommandMode(daily, 0);
    await daily.page.keyboard.press(`${MOD}+p`);
    await daily.page.keyboard.type("View live version");
    await expect(
      daily.page.getByRole("option", { name: /View live version/ }),
    ).toBeVisible(fast);
    await daily.page.keyboard.press("Enter");
    await expect(daily.page).toHaveURL(new RegExp(`/app/${nb.id}`), fast);
  });
});
