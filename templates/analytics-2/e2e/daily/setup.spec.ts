import { openHomeReady, waitForSendReady } from "./ask.helpers";
import { runWithKeyboard } from "./dash.helpers";
import { expect, test, uniqueName } from "./fixtures";
import { editorOf } from "./notebook.helpers";
import {
  connectionDialog,
  connections,
  createConnection,
  deleteConnections,
  deleteSecret,
  field,
  fillBigQuery,
  openAddConnection,
  openBigQueryForm,
} from "./setup.helpers";

const CONNECT_ERROR =
  "Error connecting to data source. Please check your connection details and user permissions, then try again, or save as draft.";

test.describe("first run for a new admin", () => {
  test("SETUP-01 new admin lands on the first useful screen", async ({
    daily,
  }) => {
    // FINDING COV-SETUP-01: the Home composer placeholder differs from the reference and the prompt is not focused on arrival.
    test.fail();
    await daily.open("/");
    const prompt = daily.page.locator(
      '[data-agent-composer-variant="hero"][data-agent-composer-slot="editor-input"]',
    );
    await expect(
      daily.page.getByText("Jump back in", { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await daily.check({ url: /\/home$/ });
    for (const tab of ["Projects", "Threads", "Explorations", "Data"])
      await expect(
        daily.page
          .getByRole("tab", { name: tab, exact: true })
          .or(daily.page.getByRole("button", { name: tab, exact: true }))
          .first(),
      ).toBeVisible();
    await expect(prompt.locator("[data-placeholder]").first()).toHaveAttribute(
      "data-placeholder",
      "Ask a data question and chat in a thread...",
    );
    await expect(prompt).toBeFocused({ timeout: 400 });
  });

  test("SETUP-02 empty notebook offers connect", async ({ daily }) => {
    // FINDING COV-SETUP-02: a new project's empty state has no "Connect your data" heading, "Or" divider or "Start with data" section.
    test.fail();
    const project = await daily.createProject(uniqueName("Setup empty"));
    try {
      await daily.open(`/project/${project.id}/latest`);
      await expect(
        daily.page.getByRole("navigation", { name: "Project views" }),
      ).toBeVisible();
      await expect(
        daily.page.getByRole("button", { name: "Browse all data" }),
      ).toBeVisible({ timeout: 400 });
      await daily.check({ url: new RegExp(`/project/${project.id}/latest$`) });
      for (const name of ["Search for data", "Upload a CSV"])
        await expect(daily.page.getByRole("button", { name })).toBeVisible();
      await expect(
        daily.page.getByRole("heading", { name: "Connect your data" }),
      ).toBeVisible({ timeout: 400 });
      await expect(daily.page.getByText("Or", { exact: true })).toBeVisible({
        timeout: 400,
      });
      await expect(
        daily.page.getByText("Start with data", { exact: true }),
      ).toBeVisible({ timeout: 400 });
      await expect(
        daily.page.getByRole("button", { name: "More", exact: true }),
      ).toBeVisible({ timeout: 400 });
    } finally {
      await daily.action("trash-project", { projectId: project.id });
    }
  });
});

test.describe("add a BigQuery connection", () => {
  test("SETUP-03 open the add-connection dialog from Data", async ({
    daily,
  }) => {
    const dialog = await openAddConnection(daily);
    await daily.check({
      url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
    });
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeVisible();
    const cards = await dialog
      .locator(".data-picker-body")
      .getByRole("button")
      .allInnerTexts();
    const names = cards.map((t) => t.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain("Google BigQuery");
  });

  test("SETUP-04 dialog Escape rules", async ({ daily }) => {
    let dialog = await openAddConnection(daily);
    await daily.press("Escape");
    await expect(dialog).toBeHidden();
    await daily.check({
      url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
    });
    dialog = await openAddConnection(daily);
    await dialog.getByRole("button", { name: "Google BigQuery" }).click();
    const name = field(dialog, /^Name/);
    await name.click();
    await daily.type("Draft escape");
    await daily.press("Escape", { feedback: false });
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue("Draft escape");
    await daily.page.mouse.click(5, 450);
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue("Draft escape");
    await daily.check({
      url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test("SETUP-05 pick BigQuery", async ({ daily }) => {
    const dialog = await openBigQueryForm(daily);
    await daily.check({
      url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
    });
    await expect(
      dialog.getByRole("button", { name: "Add a data connection" }),
    ).toBeVisible();
    await expect(dialog.locator(".data-form-header")).toContainText("BigQuery");
    await expect(
      dialog.getByText(
        "Only workspace admins can view or edit this configuration.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create connection" }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Add a data connection" }).click();
    await expect(
      dialog.getByRole("button", { name: "Google BigQuery" }),
    ).toBeVisible();
    await daily.check({
      url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
    });
  });

  test("SETUP-06 required-field validation", async ({ daily }) => {
    const dialog = await openBigQueryForm(daily);
    const create = dialog.getByRole("button", { name: "Create connection" });
    for (const label of [
      "Name",
      "Project ID",
      "Service account configuration (JSON)",
    ])
      await expect(
        dialog.locator("label", { hasText: label }).first(),
      ).toContainText("*");
    await create.locator("..").hover();
    await expect(
      daily.page.getByText("Missing required fields", { exact: true }),
    ).toBeVisible();
    await fillBigQuery(daily, dialog, {
      name: uniqueName("Req"),
      projectId: "local-fake-project",
    });
    await expect(create).toBeDisabled();
    await fillBigQuery(daily, dialog, { key: await daily.serviceAccountKey() });
    await expect(create).toBeEnabled();
    await daily.check({
      url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
    });
  });

  test("SETUP-07 save draft needs a name", async ({ daily }) => {
    const dialog = await openBigQueryForm(daily);
    const draft = dialog.getByRole("button", { name: "Save draft" });
    await expect(draft).toBeDisabled();
    await draft.locator("..").hover();
    await expect(
      daily.page.getByText("Add a name to save this as a draft", {
        exact: true,
      }),
    ).toBeVisible();
    await field(dialog, /^Name/).click();
    await daily.type("D");
    await expect(draft).toBeEnabled();
    await daily.check({
      url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
    });
  });

  test("SETUP-08 save draft then banner on reopen", async ({ daily }) => {
    // FINDING COV-SETUP-08: reopening a draft connection shows no "This is a draft data connection" banner.
    test.fail();
    const name = uniqueName("Setup draft");
    try {
      const dialog = await openBigQueryForm(daily);
      await field(dialog, /^Name/).fill(name);
      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await daily.check({
        url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
      });
      await expect
        .poll(
          async () =>
            (await connections(daily)).find((c) => c.name === name)?.isDraft,
        )
        .toBe(true);
      await daily.open("/settings/data-sources");
      await daily.page.getByRole("button", { name: `${name} options` }).click();
      await daily.page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(
        daily.page.getByText(
          'This is a draft data connection. Click "Create connection" to save this as a live data connection.',
          { exact: true },
        ),
      ).toBeVisible({ timeout: 400 });
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("report 1794913977.330369 saves a draft without browsing schemas and allows activation", async ({
    daily,
  }) => {
    const name = uniqueName("Draft report 1794913977");
    try {
      const dialog = await openBigQueryForm(daily);
      await field(dialog, /^Name/).fill(name);
      const forbidden: string[] = [];
      daily.page.on("request", (request) => {
        if (
          /\/actions\/(refresh-data-browser-catalog|list-connection-datasets)/.test(
            request.url(),
          )
        )
          forbidden.push(request.url());
      });
      await dialog
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect
        .poll(async () =>
          (await connections(daily))
            .filter((c) => c.name === name)
            .map((c) => c.isDraft),
        )
        .toEqual([true]);
      const created = (await connections(daily)).filter((c) => c.name === name);
      expect(created).toHaveLength(1);
      const [createdConnection] = created;
      if (!createdConnection) throw new Error("Expected one draft connection");
      const createdId = createdConnection.id;
      await expect(
        daily.page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await expect(
        daily.page
          .locator(".data-page-source")
          .getByText("Draft", { exact: true }),
      ).toBeVisible();
      await expect(daily.page.getByText("Failed to load schemas")).toHaveCount(
        0,
      );
      await expect(
        daily.page.locator(".data-page-tree-status[role=alert]"),
      ).toHaveCount(0);
      expect(forbidden).toEqual([]);
      await daily.open("/settings/data-sources");
      await daily.page
        .getByRole("button", { name: `${name} options`, exact: true })
        .click();
      await daily.page
        .getByRole("menuitem", { name: "Edit", exact: true })
        .click();
      const edit = connectionDialog(daily.page);
      await fillBigQuery(daily, edit, {
        projectId: "local-fake-project",
        key: await daily.serviceAccountKey(),
      });
      await edit
        .getByRole("button", { name: "Update connection", exact: true })
        .click();
      await expect(edit).toBeHidden({ timeout: 30_000 });
      await expect
        .poll(async () =>
          (await connections(daily))
            .filter((c) => c.name === name)
            .map((c) => ({ id: c.id, isDraft: c.isDraft })),
        )
        .toEqual([{ id: createdId, isDraft: false }]);
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("SETUP-09 save draft failure names the reason", async ({ daily }) => {
    // FINDING COV-SETUP-09: a failed draft save shows "Error saving draft." without the server's user-facing message.
    test.fail();
    const dialog = await openBigQueryForm(daily);
    daily.allowResponse.push(
      /create-workspace-warehouse-form|save-data-connection/,
    );
    await daily.page.route(
      /\/_agent-native\/actions\/save-data-connection/,
      (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "A connection with this name already exists.",
          }),
        }),
    );
    await field(dialog, /^Name/).fill(uniqueName("Draft fail"));
    await dialog.getByRole("button", { name: "Save draft" }).click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("Error saving draft.");
    await daily.page.unroute(/\/_agent-native\/actions\/save-data-connection/);
    await expect(alert).toContainText(
      "A connection with this name already exists.",
      { timeout: 400 },
    );
  });

  test("SETUP-10 create with a pasted key tests while it runs", async ({
    daily,
  }) => {
    const name = uniqueName("Setup slow");
    try {
      await daily.scenario({ bigquery: "slow" });
      const dialog = await openBigQueryForm(daily);
      await fillBigQuery(daily, dialog, {
        name,
        projectId: "local-fake-project",
        key: await daily.serviceAccountKey(),
      });
      const create = dialog.getByRole("button", { name: "Create connection" });
      await create.focus();
      await daily.press("Enter");
      await expect(create).toBeDisabled();
      await create.locator("..").hover();
      await expect(
        daily.page.getByText(
          "Testing connection and fetching schema. This may take a moment...",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await daily.check({
        url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
      });
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("SETUP-11 malformed key never reaches the provider", async ({
    daily,
  }) => {
    const dialog = await openBigQueryForm(daily);
    daily.allowResponse.push(
      /\/_agent-native\/actions\/(save-data-connection|create-workspace-warehouse-form)/,
    );
    const saves: string[] = [];
    daily.page.on("request", (r) => {
      if (/save-data-connection/.test(r.url())) saves.push(r.url());
    });
    await fillBigQuery(daily, dialog, {
      name: uniqueName("Bad key"),
      projectId: "local-fake-project",
      key: "{ not json",
    });
    const create = dialog.getByRole("button", { name: "Create connection" });
    if (await create.isEnabled()) await create.click();
    await expect(
      dialog.getByRole("alert").or(dialog.locator(".data-field-error")).first(),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(saves).toEqual([]);
    expect(
      (await daily.providerCalls()).filter((c) =>
        c.host.endsWith("googleapis.com"),
      ),
    ).toEqual([]);
    await daily.check({ url: /\/home\/data$/, allowErrorText: true });
  });

  test("SETUP-12 bad credentials show the connect error with the database message", async ({
    daily,
  }) => {
    const name = uniqueName("Setup denied");
    daily.allowResponse.push(
      /create-workspace-warehouse-form|save-data-connection/,
    );
    try {
      await daily.scenario({ bigquery: "denied" });
      const dialog = await openBigQueryForm(daily);
      await fillBigQuery(daily, dialog, {
        name,
        projectId: "local-fake-project",
        key: await daily.serviceAccountKey(),
      });
      await dialog.getByRole("button", { name: "Create connection" }).click();
      const alert = dialog
        .getByRole("alert")
        .filter({ hasText: "Error connecting" });
      await expect(alert).toContainText(CONNECT_ERROR, { timeout: 30_000 });
      await expect(
        alert.getByRole("button", { name: /dismiss/i }),
      ).toBeVisible();
      await expect(
        alert.getByText("Database Error:", { exact: true }),
      ).toBeVisible({ timeout: 400 });
      await expect(alert).toContainText("Access Denied", { timeout: 400 });
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("SETUP-13 success closes the dialog and lists the connection", async ({
    daily,
  }) => {
    const name = uniqueName("Setup ok");
    try {
      const dialog = await openBigQueryForm(daily);
      await fillBigQuery(daily, dialog, {
        name,
        projectId: "local-fake-project",
        key: await daily.serviceAccountKey(),
      });
      await dialog.getByRole("button", { name: "Create connection" }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await daily.check({
        url: /\/home\/data(?:\/all\/data-connection\/[^/]+)?$/,
      });
      await expect(
        daily.page.getByText(name, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await daily.open("/settings/data-sources");
      await expect(
        daily.page.getByText(name, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await daily.page.getByRole("button", { name: `${name} options` }).click();
      await daily.page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(
        daily.page.getByRole("button", { name: "Update connection" }),
      ).toBeVisible();
      await daily.check({ url: /\/settings\/data-sources$/ });
    } finally {
      await deleteConnections(daily, [name]);
    }
  });
});

test.describe("browse a new connection", () => {
  async function openConnection(
    daily: import("./fixtures").Daily,
    name: string,
  ) {
    await daily.open("/home/data");
    const entry = daily.page.getByText(name, { exact: true }).first();
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await entry.click();
  }

  test("SETUP-14 datasets list while project-wide INFORMATION_SCHEMA is denied", async ({
    daily,
  }) => {
    const name = uniqueName("Setup browse");
    try {
      await createConnection(daily, name);
      await openConnection(daily, name);
      for (const dataset of ["daily_sales", "single_table", "warehouse_many"])
        await expect(
          daily.page.getByText(dataset, { exact: true }).first(),
        ).toBeVisible({ timeout: 30_000 });
      await expect(
        daily.page.getByText(/Failed to load|could not be loaded/),
      ).toHaveCount(0);
      await daily.check();
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("SETUP-14 schemas header counts the readable datasets", async ({
    daily,
  }) => {
    // FINDING COV-SETUP-14: the dataset list header reads "Datasets (n)" where the reference reads "Schemas (n)".
    const name = uniqueName("Setup schemas");
    try {
      await createConnection(daily, name);
      await openConnection(daily, name);
      await expect(
        daily.page.getByText("daily_sales", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        daily.page.getByRole("columnheader", { name: /^Schemas [(]3[)]$/i }),
      ).toBeVisible({ timeout: 400 });
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("SETUP-15 tables list for a dataset", async ({ daily }) => {
    const name = uniqueName("Setup tables");
    try {
      await createConnection(daily, name);
      await openConnection(daily, name);
      await daily.page
        .getByText("daily_sales", { exact: true })
        .first()
        .click();
      for (const table of ["orders", "customers"])
        await expect(
          daily.page.getByText(table, { exact: true }).first(),
        ).toBeVisible({ timeout: 30_000 });
      await daily.check();
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("SETUP-15 tables header, columns and error copy", async ({ daily }) => {
    // FINDING COV-SETUP-15: the tables list has no "Tables (n)" header with Status / Categories columns, and a failed load does not read "Failed to load tables".
    test.fail(); // FINDING COV-TABLE-METADATA: the table list omits Status and Categories columns.
    const name = uniqueName("Setup tables copy");
    try {
      await createConnection(daily, name);
      await openConnection(daily, name);
      await daily.page
        .getByText("daily_sales", { exact: true })
        .first()
        .click();
      await expect(
        daily.page.getByText("orders", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        daily.page.getByRole("columnheader", { name: /^Tables [(]2[)]$/i }),
      ).toBeVisible({ timeout: 400 });
      await expect(
        daily.page.getByRole("columnheader", { name: "Status" }),
      ).toBeVisible({ timeout: 400 });
      await expect(
        daily.page.getByRole("columnheader", { name: "Categories" }),
      ).toBeVisible({ timeout: 400 });
      await daily.scenario({ bigquery: "error" });
      daily.allowResponse.push(/.*/);
      await daily.page
        .getByText("single_table", { exact: true })
        .first()
        .click();
      await expect(
        daily.page.getByText("Failed to load tables", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteConnections(daily, [name]);
    }
  });

  test("SETUP-17 report A2-LOCAL-BQ-STORAGE-FIXTURE: default connection runs and persists query results", async ({
    daily,
  }) => {
    const name = uniqueName("Setup default");
    const project = await daily.createProject(
      uniqueName("Setup default project"),
    );
    const previous =
      (await connections(daily)).find((c) => c.isDefault)?.id ?? null;
    try {
      const id = await createConnection(daily, name);
      await daily.action("set-default-data-connection", { id });
      await daily.open(`/project/${project.id}/latest`);
      const query = daily.page.getByRole("button", {
        name: "Query",
        exact: true,
      });
      await expect(query).toBeVisible({ timeout: 30_000 });
      await daily.click(query);
      const cell = daily.page.locator(".nb-cell").first();
      await expect(cell.getByText(name).first()).toBeVisible({
        timeout: 15_000,
      });
      const initial = await daily.action<{
        project: { cells: Array<{ id: string }> };
      }>("get-project", { projectId: project.id }, "GET");
      expect(initial.project.cells).toHaveLength(1);
      const cellId = initial.project.cells[0]?.id;
      if (!cellId) throw new Error("Created query cell is missing");
      const sql = "select * from daily_sales.customers";
      const editor = editorOf(cell);
      await editor.fill(sql);
      const run = daily.page
        .waitForResponse(
          (response) => {
            const request = response.request();
            if (
              request.method() !== "POST" ||
              !response
                .url()
                .includes("/_agent-native/actions/run-project-cell")
            )
              return false;
            const data = request.postDataJSON();
            return data.projectId === project.id && data.cellId === cellId;
          },
          { timeout: 30_000 },
        )
        .then(
          (response) => ({ response }),
          (error: unknown) => ({ error }),
        );
      await runWithKeyboard(daily, 0);
      const result = await run;
      if ("error" in result) throw result.error;
      expect(result.response.ok(), await result.response.text()).toBe(true);
      const rows = cell.locator(".nb-table tbody tr");
      await expect(rows).toHaveText(["1Ada", "2Grace"], { timeout: 30_000 });
      const saved = await daily.action<{
        project: {
          cells: Array<{
            id: string;
            contents: { dataConnectionId: string; source: string };
          }>;
        };
        outputs: Record<
          string,
          { output: { type: string; rows: unknown[][] } }
        >;
      }>("get-project", { projectId: project.id }, "GET");
      expect(saved.project.cells).toHaveLength(1);
      const savedCell = saved.project.cells[0];
      if (!savedCell) throw new Error("Saved query cell is missing");
      expect(savedCell.contents.dataConnectionId).toBe(id);
      expect(savedCell.contents.source).toBe(sql);
      expect(saved.outputs[savedCell.id]?.output).toMatchObject({
        type: "table",
        rows: [
          [1, "Ada"],
          [2, "Grace"],
        ],
      });
      expect(
        (await daily.providerCalls()).some(
          (call) =>
            call.host === "storage" && call.path === "/__control/storage",
        ),
      ).toBe(true);
      await daily.reload();
      await expect(cell.getByText(name).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(rows).toHaveText(["1Ada", "2Grace"], { timeout: 30_000 });
      await daily.check({ url: new RegExp(`/project/${project.id}/latest$`) });
    } finally {
      await daily.action("trash-project", { projectId: project.id });
      await daily.action("set-default-data-connection", { id: previous });
      await deleteConnections(daily, [name]);
    }
  });
});

test.describe("keys and integrations", () => {
  const KEY = "HUBSPOT_MCP_CLIENT_ID";
  const LABEL = "HubSpot MCP OAuth client ID";

  async function openKey(daily: import("./fixtures").Daily) {
    await daily.open(`/settings/secrets#secrets:${KEY}`);
    const row = daily.page
      .locator("div.border-b")
      .filter({ hasText: LABEL })
      .first();
    await expect(row).toBeVisible();
    const toggle = row.locator("button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    const rotate = row.getByRole("button", { name: "Rotate", exact: true });
    if (await rotate.isVisible()) await rotate.click();
    const input = daily.page.locator(`input[aria-label="${LABEL}"]`);
    await expect(input).toBeVisible({ timeout: 5000 });
    const test_ = row.getByRole("button", { name: "Test", exact: true });
    return {
      input,
      row,
      test: test_,
      result: row.locator('[data-testid="secret-test-result"]'),
    };
  }

  test("SETUP-18 HubSpot key screen reachable from the connect dialog", async ({
    daily,
  }) => {
    await daily.open("/settings/integrations");
    const connect = daily.page.getByRole("button", {
      name: "Connect HubSpot",
      exact: true,
    });
    await expect(connect).toBeVisible({ timeout: 30_000 });
    await daily.click(connect);
    const setup = daily.page.getByText("Set up for workspace", { exact: true });
    if (await setup.isVisible()) await setup.click();
    const add = daily.page.getByRole("button", {
      name: "Add workspace credentials",
      exact: true,
    });
    await expect(add).toBeVisible({ timeout: 15_000 });
    await daily.click(add);
    await expect(daily.page).toHaveURL(
      new RegExp(`/settings/secrets#secrets:${KEY}$`),
    );
    await expect(daily.dialog()).toHaveCount(0);
    await expect(daily.page.getByText(LABEL, { exact: true })).toBeVisible();
    await daily.check({ url: new RegExp(`/settings/secrets#secrets:${KEY}$`) });
  });

  test("SETUP-19 HubSpot key test shows progress", async ({ daily }) => {
    const k = await openKey(daily);
    await k.input.fill("hubspot-client-id-candidate");
    let release: () => void = () => {};
    const held = new Promise<void>((done) => (release = done));
    await daily.page.route(
      new RegExp(`/_agent-native/secrets/${KEY}/test$`),
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await k.test.click();
    const busy = k.row.getByRole("button", { name: "Testing…" });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await expect(k.result).toHaveAttribute("aria-live", "polite");
    await expect(k.result).not.toContainText(
      /Working|works|can't be checked|failed/,
    );
    release();
    await expect(k.result).toContainText(/\S/, { timeout: 15_000 });
    await k.input.fill("");
    await daily.check({ url: new RegExp(`/settings/secrets#secrets:${KEY}$`) });
  });

  test("SETUP-20 HubSpot key test result is honest", async ({ daily }) => {
    const k = await openKey(daily);
    await k.input.fill("hubspot-client-id-candidate");
    await k.test.click();
    await expect(k.result).toHaveText(
      "This key can't be checked on its own. It is checked when you connect the integration.",
      { timeout: 15_000 },
    );
    await expect(k.result).not.toContainText("Working");
    await k.input.fill("");
    await daily.check({ url: new RegExp(`/settings/secrets#secrets:${KEY}$`) });
  });

  test("SETUP-21 HubSpot key test failure is specific", async ({ daily }) => {
    const k = await openKey(daily);
    const path = new RegExp(`/_agent-native/secrets/${KEY}/test$`);
    daily.allowResponse.push(path);
    await k.input.fill("hubspot-client-id-candidate");
    const cases: Array<
      [(route: import("@playwright/test").Route) => Promise<void>, string]
    > = [
      [
        (r) =>
          r.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              error: "Authentication credentials not found.",
            }),
          }),
        "Authentication credentials not found.",
      ],
      [
        (r) =>
          r.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: false }),
          }),
        "Invalid",
      ],
      [
        (r) =>
          r.fulfill({
            status: 502,
            contentType: "text/html",
            body: "<html>bad gateway</html>",
          }),
        "Test failed (HTTP 502). Try again in a moment.",
      ],
      [
        (r) => r.abort("connectionrefused"),
        "Test failed: could not reach the server. Check your connection and try again.",
      ],
    ];
    for (const [answer, text] of cases) {
      await daily.page.route(path, answer);
      await k.test.click();
      await expect(k.result).toHaveText(text, { timeout: 15_000 });
      await daily.page.unroute(path);
    }
    await k.input.fill("");
    // The aborted request logs a console error by design; clear it before the invariant check.
    await daily.check();
  });

  test("SETUP-22 Builder.io connect opens the authorization window", async ({
    daily,
  }) => {
    await daily.open("/settings/connected-apps");
    const row = daily.page
      .locator("div")
      .filter({ hasText: /^Builder\.io/ })
      .filter({
        has: daily.page.getByRole("button", { name: "Connect", exact: true }),
      })
      .last();
    const connect = row.getByRole("button", { name: "Connect", exact: true });
    await expect(connect).toBeVisible({ timeout: 30_000 });
    await daily.click(connect);
    const existing = daily.page.getByRole("button", {
      name: /^(I have a Builder\.io account|Connect Builder\.io)$/,
    });
    await expect(existing).toBeVisible();
    await daily.context.route(
      /\/_agent-native\/builder\/connect(\?|$)/,
      async (route) => {
        const start = await route.fetch({ maxRedirects: 0 });
        expect(
          start.status(),
          "the real app creates an OAuth authorization redirect",
        ).toBe(302);
        const location = new URL(start.headers().location ?? "");
        expect(location.origin).toBe("https://mcp.builder.io");
        expect(location.pathname).toBe("/authorize");
        const authorization = await fetch(
          `${daily.server.fake}authorize${location.search}`,
          { headers: { "x-fake-host": location.hostname } },
        );
        expect(authorization.ok).toBe(true);
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: await authorization.text(),
        });
      },
    );
    const popup = daily.page.waitForEvent("popup", { timeout: 15_000 });
    await existing.click();
    const win = await popup;
    await expect
      .poll(() => win.url(), { timeout: 15_000 })
      .toMatch(/builder\.io|\/_agent-native\/builder\/connect/);
    await expect(daily.page.getByText(/App navigation blocked/i)).toHaveCount(
      0,
    );
    await expect(win.getByText(/App navigation blocked/i)).toHaveCount(0);
    await expect(
      win.getByRole("heading", { name: "Authorize", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await win.close();
    await daily.check({ url: /\/settings\/connected-apps$/ });
  });

  test("SETUP-23 custom keys from missing-provider setup lands on model settings", async ({
    daily,
  }) => {
    await daily.page.route("**/_agent-native/agent-engine/status*", (route) =>
      route.fulfill({
        status: 200,
        json: { configured: false, chatEligible: false },
      }),
    );
    await daily.open("/home");
    await daily.page
      .getByRole("button", { name: "Custom keys", exact: true })
      .click();
    const custom = daily.page.getByRole("link", {
      name: /^Add a key in Settings/,
    });
    await expect(custom).toBeVisible();
    await daily.click(custom);
    await expect(daily.page).toHaveURL(/\/settings\/(model|keys)$/);
    await expect(
      daily.page.getByText("AI provider", { exact: true }),
    ).toBeVisible();
    await daily.check({ url: /\/settings\/(model|keys)$/ });
  });

  test("SETUP-24 first useful screen after setup", async ({ daily }) => {
    await openHomeReady(daily);
    const editor = daily.page.locator(
      '[data-agent-composer-variant="hero"][data-agent-composer-slot="editor-input"]',
    );
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await daily.type("[chart] revenue by month");
    await waitForSendReady(daily.page);
    await daily.press("Enter");
    await expect(daily.page).toHaveURL(/\/thread\/[0-9a-f-]{36}$/, {
      timeout: 20_000,
    });
    await expect(
      daily.page.locator("svg").filter({ hasText: "Apr" }).first(),
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      daily.page.getByText("Revenue by month").first(),
    ).toBeVisible();
    await daily.check({ url: /\/thread\/[0-9a-f-]{36}$/ });
  });
});

// App-specific first-run extension: app/components/onboarding/AnalyticsFirstRun.tsx.
test("SETUP-25 fresh first-run setup can Skip into the useful Home screen", async ({
  daily,
}) => {
  const original = await daily.context.cookies(daily.server.base);
  try {
    await daily.context.addCookies([
      { name: "agent-native-first-run", value: "1", url: daily.server.base },
    ]);
    await daily.page.route(
      "**/_agent-native/onboarding/first-run/status*",
      (route) => route.fulfill({ status: 200, json: { firstRun: true } }),
    );
    await daily.open("/home");
    await expect(
      daily.page.getByRole("heading", {
        name: "Start your first analysis",
        exact: true,
      }),
    ).toBeVisible();
    const completed = daily.page.waitForResponse(
      (response) =>
        response.url().endsWith("/onboarding/first-run/complete") &&
        response.request().method() === "POST",
    );
    await daily.click(
      daily.page.getByRole("button", { name: "Skip", exact: true }),
    );
    expect((await completed).ok()).toBe(true);
    await expect(
      daily.page.getByRole("heading", {
        name: "Start your first analysis",
        exact: true,
      }),
    ).toBeHidden();
    await expect(
      daily.page.getByRole("tablist", { name: "Jump back in" }),
    ).toBeVisible();
    await daily.check({ url: /\/home$/ });
  } finally {
    await daily.context.addCookies(original);
  }
});

test("report 961: editing a service account refreshes the saved schema without a manual refresh", async ({
  daily,
}) => {
  const name = uniqueName("Report 961");
  const id = await createConnection(daily, name);
  await daily.open("/settings/data-sources");
  await daily.page
    .getByRole("button", { name: `${name} options`, exact: true })
    .click();
  await daily.page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = connectionDialog(daily.page);
  await fillBigQuery(daily, dialog, { key: await daily.serviceAccountKey() });
  const refreshed = daily.page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(
        "/actions/refresh-data-browser-catalog",
      ) &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().connectionId === id,
  );
  await dialog
    .getByRole("button", { name: "Update connection", exact: true })
    .click();
  const response = await refreshed;
  expect(response.ok()).toBe(true);
  expect((await response.json()).refreshState).toBe("ready");
  await expect(dialog).toBeHidden();
  const catalog = await daily.action<{
    refreshState: string;
    totalCount: number;
  }>("get-data-browser-catalog", { connectionId: id }, "GET");
  expect(catalog.refreshState).toBe("ready");
  expect(catalog.totalCount).toBeGreaterThan(0);
  await daily.check({ url: /\/settings\/data-sources$/ });
  await daily.page.screenshot({
    path: ".tmp/analytics-owner/report-961-local.png",
  });
});
