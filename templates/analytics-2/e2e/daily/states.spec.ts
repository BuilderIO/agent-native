import type { Page, Route, Response } from "@playwright/test";

import { heroEditor, openHomeReady, waitForSendReady } from "./ask.helpers";
import { expect, test, uniqueName, type Daily } from "./fixtures";
import {
  cellAt,
  delayRuns,
  editorOf,
  openNotebook,
  sampleSql,
  SAMPLE_CONNECTION,
  seedNotebook,
} from "./notebook.helpers";
import {
  connectionDialog,
  createConnection,
  deleteConnections,
} from "./setup.helpers";

// Loading, empty, error, offline and slow states across the everyday screens.

const HOME = /\/home$/;
const FAST = { timeout: 400 };

const actionUrl = (name: string) =>
  new RegExp(`/_agent-native/actions/${name}(\\?|$)`);

/** Hold one action's response for `ms` (a slow server). */
async function slowAction(page: Page, name: string | RegExp, ms: number) {
  await page.route(
    typeof name === "string" ? actionUrl(name) : name,
    async (route: Route) => {
      await new Promise((done) => setTimeout(done, ms));
      await route.fallback();
    },
  );
}

/** Fail one request with a 500 for this page; the failure and its console line are expected. */
async function failRequest(
  daily: Daily,
  url: RegExp,
  filter?: (route: Route) => boolean,
) {
  daily.allowResponse.push(url);
  await daily.page.route(url, (route) =>
    !filter || filter(route)
      ? route.fulfill({ status: 500, json: { error: "daily: forced failure" } })
      : route.fallback(),
  );
}

const searchDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Search your workspace" });
const searchInput = (page: Page) =>
  searchDialog(page).getByRole("textbox", { name: "Search your workspace" });

async function openHomeIdle(daily: Daily) {
  await daily.open("/home");
  await expect(
    daily.page.getByText("JUMP BACK IN", { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

async function openSearch(daily: Daily) {
  await openHomeIdle(daily);
  await daily.page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur?.(),
  );
  await daily.page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(searchInput(daily.page)).toBeFocused();
}

async function holdAction(page: Page, name: string | RegExp) {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route(
    typeof name === "string" ? actionUrl(name) : name,
    async (route) => {
      await held;
      await route.fallback();
    },
  );
  return release;
}

test("A2-COLD-HOME-ENTRY-5S: connect opens while workspace details are held", async ({
  daily,
}) => {
  const release = await holdAction(daily.page, "get-workspace-activity");
  try {
    await daily.open("/home");
    const link = daily.page.getByRole("link", {
      name: "Connect your data",
      exact: true,
    });
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.click();
    const dialog = connectionDialog(daily.page);
    await expect(dialog).toBeVisible();
    await expect(
      dialog
        .getByRole("banner")
        .getByRole("heading", { name: "Add a data connection", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      dialog.getByRole("button", { name: "Google BigQuery" }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("report A2-COLD-HOME-ENTRY-5S: setup is ready when the shell finishes even if later scripts stall", async ({
  daily,
}) => {
  const { page } = daily;
  let shellReleased = false;
  let releaseScripts = () => {};
  const scriptsHeld = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route(/\.js(?:\?|$)/, async (route) => {
    if (shellReleased) await scriptsHeld;
    await route.continue();
  });
  await page.route(actionUrl("get-workspace-activity"), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    shellReleased = true;
    await route.continue();
  });
  try {
    await daily.open("/home");
    const link = page.getByRole("link", {
      name: "Connect your data",
      exact: true,
    });
    await expect(link).toBeVisible({ timeout: 5_000 });
    await expect(link).toHaveAttribute("href", /\/home\/data\?connect=1$/);
  } finally {
    releaseScripts();
  }
});

test("ASK-02 report 1794900076.228569: Home prompt keeps its border when focused", async ({
  daily,
}) => {
  const { page } = daily;
  await daily.open("/home");
  const editor = heroEditor(page);
  const composer = page.locator(".ws-agent-home .agent-composer-root");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const border = await composer.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await editor.click();
  await expect(editor).toBeFocused();
  await expect(composer).toHaveCSS("border-color", border);
  await expect(editor).toHaveCSS("outline-style", "none");
  await page.getByRole("button", { name: "Search", exact: true }).focus();
  for (
    let i = 0;
    i < 30 &&
    !(await editor.evaluate((node) => node === document.activeElement));
    i++
  )
    await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS("outline-style", "none");
  await expect(composer).toHaveCSS("border-color", border);
});

test("STATES-01 Home loading shows skeletons, never the empty text", async ({
  daily,
}) => {
  const release = await holdAction(daily.page, "get-workspace-activity");
  try {
    await daily.open("/home");
    await expect(
      daily.page
        .locator('[data-slot="skeleton"], .animate-pulse, [aria-busy="true"]')
        .first(),
    ).toBeVisible();
    await expect(
      daily.page.getByText(
        "Analyze and visualize your data in a notebook and publish interactive apps",
        { exact: true },
      ),
    ).toHaveCount(0);
    release();
    await expect(
      daily.page.getByRole("tablist", { name: "Jump back in" }),
    ).toBeVisible();
    await daily.check({ url: HOME });
  } finally {
    release();
  }
});

test("STATES-04 search loading shows a spinner and no 'No results found' until loaded", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-SEARCH-LOADING: search has no visible loading indicator after its request starts.
  const { page } = daily;
  await openSearch(daily);
  await slowAction(page, "search-workspace", 1_500);
  const requested = page.waitForRequest(
    (request) =>
      request.url().includes("/_agent-native/actions/search-workspace") &&
      new URL(request.url()).searchParams.get("text") === "qqzzxx-nothing",
  );
  await daily.type("qqzzxx-nothing");
  await requested;
  const dialog = searchDialog(page);
  await expect(
    dialog
      .locator('[role="progressbar"], [aria-busy="true"], .animate-spin')
      .first(),
  ).toBeVisible(FAST);
  await expect(dialog.getByText("No results found")).toHaveCount(0);
  await expect(dialog.getByText("No results found")).toBeVisible({
    timeout: 10_000,
  });
  await daily.check({ url: HOME, focus: searchInput(page) });
});

test("STATES-05 search error shows Something went wrong", async ({ daily }) => {
  const { page } = daily;
  await failRequest(daily, actionUrl("search-workspace"));
  await openSearch(daily);
  const failed = daily.page.waitForResponse(
    (response) =>
      response.url().includes("/actions/search-workspace") &&
      new URL(response.url()).searchParams.get("text") === "qqzzxx-error",
  );
  await daily.type("qqzzxx-error");
  expect((await failed).status()).toBe(500);
  await expect(
    searchDialog(page).getByText("Something went wrong"),
  ).toBeVisible({ timeout: 10_000 });
  await daily.check({ url: HOME, allowErrorText: true });
});

async function openDemoConnection(daily: Daily) {
  const name = uniqueName("State catalog");
  await createConnection(daily, name);
  await daily.open("/home/data");
  await daily.page.getByText(name, { exact: true }).first().click();
}

test("STATES-06 data browser loading shows a list loader", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-DATA-LOADING: a held catalog read shows generic Loading instead of the data list loader.
  const name = uniqueName("Loading catalog");
  await createConnection(daily, name);
  const release = await holdAction(
    daily.page,
    /\/_agent-native\/actions\/(get-data-browser-catalog|list-connection-datasets|list-data-connection-schemas)(\?|$)/,
  );
  try {
    await daily.open("/home/data");
    await expect(
      daily.page
        .locator(
          '[data-slot="skeleton"], .animate-pulse, [aria-busy="true"], [role="progressbar"], .animate-spin',
        )
        .first(),
    ).toBeVisible();
    release();
    await daily.page.getByText(name, { exact: true }).click();
    await expect(
      daily.page.getByRole("columnheader", { name: /^Schemas [(]3[)]$/i }),
    ).toBeVisible();
    await daily.check();
  } finally {
    release();
  }
});

test("STATES-07 data browser listing failure says Failed to load schemas", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-STATES-02: a failed schema listing does not read "Failed to load schemas".
  const { page } = daily;
  await failRequest(
    daily,
    /\/_agent-native\/actions\/(get-data-browser-catalog|list-connection-datasets|list-data-connection-schemas)(\?|$)/,
  );
  await openDemoConnection(daily);
  await expect(page.getByText(/Failed to load (schemas|tables)/)).toBeVisible({
    timeout: 5_000,
  });
});

test("STATES-08 a slow connection test shows the testing tooltip on Create", async ({
  daily,
}) => {
  const { page } = daily;
  await daily.scenario({ bigquery: "slow" });
  const name = uniqueName("Slow warehouse");
  let creation: Promise<Response> | undefined;
  try {
    await daily.open("/home/data");
    await page
      .getByRole("button", { name: /^(Add data connection|Connect your data)/ })
      .click({ timeout: 30_000 });
    const dialog = page.getByRole("dialog").last();
    await dialog.getByRole("button", { name: "Google BigQuery" }).click();
    await dialog.getByLabel(/^Name/).first().fill(name);
    await dialog
      .getByLabel(/^Project ID/)
      .first()
      .fill("daily-fake-project");
    await dialog
      .getByLabel(/^Service account configuration/)
      .first()
      .fill(await daily.serviceAccountKey());
    creation = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/_agent-native/actions/create-workspace-warehouse-form") &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Create connection" }).click();
    await expect(
      page.getByText(
        "Testing connection and fetching schema. This may take a moment...",
      ),
    ).toBeVisible(FAST);
  } finally {
    if (creation) await creation;
    await deleteConnections(daily, [name]);
  }
});

test("STATES-09 a failed connection test shows the connection error callout", async ({
  daily,
}) => {
  const { page } = daily;
  await daily.scenario({ bigquery: "denied" });
  const name = uniqueName("Denied warehouse");
  daily.allowResponse.push(
    /\/_agent-native\/actions\/create-workspace-warehouse-form/,
  );
  try {
    await daily.open("/home/data");
    await page
      .getByRole("button", { name: /^(Add data connection|Connect your data)/ })
      .click({ timeout: 30_000 });
    const dialog = page.getByRole("dialog").last();
    await dialog.getByRole("button", { name: "Google BigQuery" }).click();
    await dialog.getByLabel(/^Name/).first().fill(name);
    await dialog
      .getByLabel(/^Project ID/)
      .first()
      .fill("daily-fake-project");
    await dialog
      .getByLabel(/^Service account configuration/)
      .first()
      .fill(await daily.serviceAccountKey());
    await dialog.getByRole("button", { name: "Create connection" }).click();
    await expect(
      dialog.getByText(
        "Error connecting to data source. Please check your connection details and user permissions, then try again, or save as draft.",
      ),
    ).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("Database Error:")).toBeVisible();
  } finally {
    await deleteConnections(daily, [name]);
  }
});

test("STATES-10 a loading chart says Loading chart...", async ({ daily }) => {
  const { page } = daily;
  const nb = await seedNotebook(daily, [{ kind: "chart" }]);
  try {
    await slowAction(
      page,
      /\/_agent-native\/actions\/(get-project|run-project-cell)(\?|$)/,
      1_500,
    );
    await daily.open(`/project/${nb.id}/latest`);
    await expect(page.getByText("Loading chart...")).toBeVisible({
      timeout: 5_000,
    });
  } finally {
    await daily.cleanupProject(nb.id);
  }
});

test("STATES-12 first run in a project shows the kernel Starting status", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-STATES-05: the first run in a project shows no kernel "Starting" status before "Running".
  const { page } = daily;
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: sampleSql(2), connection: SAMPLE_CONNECTION },
  ]);
  try {
    await openNotebook(daily, nb);
    await delayRuns(page, 2_000);
    await editorOf(cellAt(page, 0)).focus();
    await daily.press("ControlOrMeta+Enter");
    await expect(page.getByText(/^Starting/).first()).toBeVisible(FAST);
  } finally {
    await daily.cleanupProject(nb.id);
  }
});

test("STATES-13 going offline while editing keeps the draft and says the edit was not saved", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-STATES-06: an edit made offline gives no "We couldn’t save these edits." message.
  const { page, context } = daily;
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: sampleSql(1), connection: SAMPLE_CONNECTION },
  ]);
  try {
    await openNotebook(daily, nb);
    const editor = editorOf(cellAt(page, 0));
    await editor.click();
    await context.setOffline(true);
    await page.keyboard.press("End");
    await daily.type(" -- offline edit");
    await editor.blur();
    await expect(editor).toContainText("offline edit");
    await expect(page.getByText("We couldn’t save these edits.")).toBeVisible({
      timeout: 5_000,
    });
  } finally {
    await context.setOffline(false);
    await daily.cleanupProject(nb.id);
  }
});

test("STATES-14 sending from Home while offline shows a failure toast and keeps the text", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-STATES-07: Enter while offline gives no "Error submitting your prompt" toast.
  const { page, context } = daily;
  await openHomeReady(daily);
  await heroEditor(page).focus();
  await daily.type("[stream] asked while offline");
  await waitForSendReady(page);
  try {
    await context.setOffline(true);
    await page.keyboard.press("Enter");
    await expect(daily.toast("Error submitting your prompt")).toBeVisible({
      timeout: 5_000,
    });
    await expect(heroEditor(page)).toHaveText("[stream] asked while offline");
  } finally {
    await context.setOffline(false);
  }
});

test("STATES-15 a denied clipboard gives a failure toast on copy link", async ({
  daily,
}) => {
  const { page } = daily;
  const project = await daily.createProject(uniqueName("Copy link denied"));
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            Promise.reject(new DOMException("denied", "NotAllowedError")),
          write: () =>
            Promise.reject(new DOMException("denied", "NotAllowedError")),
        },
      });
    });
    await daily.open("/home/all");
    const row = page
      .locator("div,tr,li")
      .filter({ has: page.getByRole("link", { name: project.title }) })
      .filter({ has: page.getByRole("button", { name: /more actions/i }) })
      .last();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.hover();
    await row.getByRole("button", { name: /more actions/i }).click();
    await page.getByRole("menuitem", { name: /Copy link/ }).click();
    await expect(
      daily.toast(/Failed to copy|Couldn.t copy|Could not copy/),
    ).toBeVisible({ timeout: 5_000 });
  } finally {
    await daily.cleanupProject(project.id);
  }
});

test("STATES-17 schema tree search with no matches says the search returned no results", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-DATA-FILTER-EMPTY: a filtered tree says No schemas found instead of Your search returned no results.
  const { page } = daily;
  await openDemoConnection(daily);
  const filter = page
    .getByRole("searchbox")
    .or(page.getByPlaceholder(/search|filter/i))
    .first();
  await expect(filter).toBeVisible({ timeout: 15_000 });
  await filter.click();
  await daily.type("qqzzxx-none");
  await expect(
    page.getByText("Your search returned no results.", { exact: true }),
  ).toBeVisible({
    timeout: 5_000,
  });
  await daily.check();
});

test("STATES-19 filtering projects to nothing says so", async ({ daily }) => {
  const { page } = daily;
  await daily.open("/home/archive");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const filter = page.getByRole("searchbox", { name: "Title", exact: true });
  await expect(filter).toBeVisible();
  await filter.click();
  await daily.type("qqzzxx-no-project");
  await expect(page.getByText("No projects match that filter")).toBeVisible({
    timeout: 5_000,
  });
  await daily.check({ url: /\/home\/archive/ });
});

test("STATES-20 a failing table preview offers a retry", async ({ daily }) => {
  test.fail();
  // FINDING COV-STATES-10: a failed table preview does not show "Something went wrong" with a retry.
  const { page } = daily;
  await failRequest(daily, actionUrl("get-data-table-details"));
  await openDemoConnection(daily);
  await page.getByText("daily_sales", { exact: true }).first().click();
  const table = page.getByText("orders", { exact: true }).first();
  await expect(table).toBeVisible({ timeout: 15_000 });
  await table.click();
  await expect(page.getByText("Something went wrong")).toBeVisible({
    timeout: 5_000,
  });
  await expect(
    page.getByRole("button", { name: /retry|try again/i }),
  ).toBeVisible();
});
