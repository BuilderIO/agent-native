import { checkEditorPreferences } from "../editor-preferences";
import {
  createBigQueryConnection,
  deleteConnection,
  open,
  outputOf,
  projectUrl,
  runButton,
  runWithKeyboard,
  seed,
  slowAction,
  stored,
  trashProject,
  waitForOutput,
} from "./dash.helpers";
import { expect, test } from "./fixtures";
import {
  cellAt,
  cellLocator,
  delayRuns,
  editorOf,
  enterCommandMode,
  MOD,
  SAMPLE_CONNECTION,
} from "./notebook.helpers";
import { connections } from "./setup.helpers";

const SAMPLE_NAME = "[Demo] Public Data";
const fast = { timeout: 400 };

test.describe("NOTEBOOK", () => {
  test.describe.configure({ timeout: 45_000 });
  const created: string[] = [];
  test.afterEach(async ({ daily }) => {
    for (const id of created.splice(0)) await trashProject(daily, id);
  });

  test("NOTEBOOK-01 add SQL cell", async ({ daily }) => {
    expect((await connections(daily)).filter((item) => item.isDefault)).toEqual(
      [],
    );
    const nb = await seed(daily, []);
    created.push(nb.id);
    await open(daily, nb, 0);
    await daily.check({ url: projectUrl(nb) });
    await daily.click(
      daily.page.getByRole("button", { name: "Query", exact: true }),
    );
    const cell = cellAt(daily.page, 0);
    await expect(cell).toBeVisible();
    await daily.check({ url: projectUrl(nb), focus: editorOf(cell) });
    // oracle-change: a fresh workspace has no configured default; the reference shows its source placeholder.
    await expect(
      cell.getByRole("button", { name: /^Data connection:/ }),
    ).toHaveAccessibleName("Data connection: Select a source", fast);
    expect((await stored(daily, nb.id))[0]?.dataConnectionId).toBeNull();
  });

  test("report 1794945614.960449: the selected source name is visible for one connection", async ({
    daily,
  }) => {
    const nb = await seed(daily, [
      {
        kind: "sql",
        text: "select * from orders limit 3",
        connection: SAMPLE_CONNECTION,
      },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    const picker = cellAt(daily.page, 0).getByRole("button", {
      name: `Data connection: ${SAMPLE_NAME}`,
    });
    await expect(picker).toBeVisible();
    await expect(picker).toContainText(SAMPLE_NAME);
    expect((await stored(daily, nb.id))[0]?.dataConnectionId).toBe(
      SAMPLE_CONNECTION,
    );
    await runWithKeyboard(daily, 0);
    await waitForOutput(daily.page, 0);
    await expect(cellAt(daily.page, 0).locator("tbody tr")).toHaveCount(3);
    await daily.page.screenshot({
      path: ".tmp/analytics-owner/saya-sql-source-latest.png",
      fullPage: true,
    });
    await daily.reload();
    await expect(picker).toContainText(SAMPLE_NAME);
  });

  test("report 1794948257 editor preferences persist", async ({ daily }) => {
    const bootstrap = await daily.action<{ workspace: { id: string } }>(
      "get-workspace-bootstrap",
      {},
      "GET",
    );
    await daily.open("/home");
    const page = await daily.context.newPage();
    try {
      await checkEditorPreferences(
        page,
        daily.server.base,
        bootstrap.workspace.id,
      );
    } finally {
      await page.close();
    }
  });

  test("NOTEBOOK-02 type and autosave survives reload", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-01: an edited cell's run control reads "Save edits and run cell", not "Save edits and rerun cell + downstream"
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    const cell = cellAt(daily.page, 0);
    await runWithKeyboard(daily, 0);
    await waitForOutput(daily.page, 0);
    await editorOf(cell).press("End");
    await daily.type(", 2 as b");
    await expect
      .poll(async () => (await stored(daily, nb.id))[0]?.source ?? "", {
        timeout: 5_000,
      })
      .toBe("select 1 as a, 2 as b");
    await daily.reload();
    await expect
      .poll(() => editorOf(cellAt(daily.page, 0)).innerText(), {
        timeout: 30_000,
      })
      .toBe("select 1 as a, 2 as b");
    await daily.check({ url: projectUrl(nb) });
    await expect(
      cellAt(daily.page, 0).getByRole("button", { name: /Discard edits/ }),
    ).toBeVisible(fast);
    await expect(runButton(cellAt(daily.page, 0))).toHaveAttribute(
      "title",
      /Save edits and rerun cell \+ downstream/,
      fast,
    );
  });

  test("report ADHOC-1117-EDITING-SNAPSHOT publishes the current draft before save and switches projects", async ({
    daily,
  }) => {
    const first = await seed(daily, [
      { kind: "sql", text: "select 1", connection: SAMPLE_CONNECTION },
    ]);
    const second = await seed(daily, [
      { kind: "sql", text: "select 2", connection: SAMPLE_CONNECTION },
    ]);
    created.push(first.id, second.id);
    await open(daily, first);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const routePattern = "**/_agent-native/actions/save-project-cell";
    await daily.page.route(routePattern, async (route) => {
      await held;
      await route.continue();
    });
    try {
      const editor = editorOf(cellAt(daily.page, 0));
      await editor.focus();
      await editor.press("ControlOrMeta+A");
      await daily.type("select unsaved_snapshot");
      const readSnapshot = () =>
        daily.page.evaluate(async () => {
          const tab = sessionStorage.getItem("agent-native:browser-tab-id");
          if (!tab) throw new Error("Missing browser tab ID");
          const response = await fetch(
            `/_agent-native/application-state/notebook-editing:${tab}`,
            { headers: { "X-Agent-Native-Browser-Tab": tab } },
          );
          if (!response.ok)
            throw new Error(`Snapshot read failed: ${response.status}`);
          return response.json();
        });
      await expect.poll(readSnapshot).toMatchObject({
        projectId: first.id,
        cells: expect.arrayContaining([
          expect.objectContaining({
            kind: "sql",
            text: "select unsaved_snapshot",
            unsaved: true,
          }),
        ]),
      });
      expect((await stored(daily, first.id))[0]?.source).toBe("select 1");
      release();
      await daily.page.unroute(routePattern);
      await open(daily, second);
      await expect.poll(readSnapshot).toMatchObject({
        projectId: second.id,
        cells: expect.arrayContaining([
          expect.objectContaining({ kind: "sql", text: "select 2" }),
        ]),
      });
    } finally {
      release();
      await daily.page.unroute(routePattern);
    }
  });

  test("NOTEBOOK-03 run cell with mod+enter", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-02: no Interrupt control while a cell runs (and no Queued/Starting status)
    const nb = await seed(daily, [
      {
        kind: "sql",
        text: "select * from orders limit 5",
        connection: SAMPLE_CONNECTION,
      },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    await delayRuns(daily.page, 1_500);
    await runWithKeyboard(daily, 0);
    const cell = cellAt(daily.page, 0);
    await expect(cell.getByText(/Running/).first()).toBeVisible();
    await daily.check({ url: projectUrl(nb) });
    await waitForOutput(daily.page, 0);
    await expect(
      outputOf(cell)
        .getByRole("table")
        .or(outputOf(cell).getByRole("grid"))
        .first(),
    ).toBeVisible();
    await daily.check({ url: projectUrl(nb) });
    await delayRuns(daily.page, 1_500);
    await runWithKeyboard(daily, 0);
    await expect(cell.getByRole("button", { name: "Interrupt" })).toBeVisible(
      fast,
    );
  });

  test("NOTEBOOK-04 run button label and stale output prefix", async ({
    daily,
  }) => {
    test.fail(); // FINDING COV-SQL-OUTPUT: a literal SQL query produces an error instead of an output summary.
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    const cell = cellAt(daily.page, 0);
    await expect(runButton(cell)).toHaveAttribute(
      "title",
      /^Run cell\n(⌘|ctrl)\+Enter$/,
    );
    await runWithKeyboard(daily, 0);
    await waitForOutput(daily.page, 0);
    await editorOf(cell).press("End");
    await daily.type(" ");
    await expect(runButton(cell)).toHaveAttribute("title", /^Stale output · /);
    await daily.check({ url: projectUrl(nb) });
  });

  test("NOTEBOOK-06 query error copy", async ({ daily }) => {
    test.fail(); // FINDING F12: run errors do not read "Your query could not be executed" / "We received the following error when executing this query:"
    const nb = await seed(daily, [
      {
        kind: "sql",
        text: "selec nothing from orders",
        connection: SAMPLE_CONNECTION,
      },
    ]);
    created.push(nb.id);
    daily.allowResponse = [/run-project-cell/];
    await open(daily, nb);
    await runWithKeyboard(daily, 0);
    const cell = cellAt(daily.page, 0);
    await expect(
      cell.getByText("Your query could not be executed"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      cell.getByText(
        "We received the following error when executing this query:",
      ),
    ).toBeVisible(fast);
    await expect(
      cell.getByRole("button", { name: /^Fix with the .+ Agent$/ }),
    ).toBeVisible(fast);
    await expect(cell.getByRole("button", { name: "Copy error" })).toBeVisible(
      fast,
    );
    await daily.check({ url: projectUrl(nb) });
  });

  test("NOTEBOOK-07 table not found on BigQuery", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-04: a missing table shows the raw message without the "Table not found" title
    const conn = await createBigQueryConnection(daily);
    try {
      const nb = await seed(daily, [
        {
          kind: "sql",
          text: "select * from daily_sales.no_such_table",
          connection: conn.id,
        },
      ]);
      created.push(nb.id);
      daily.allowResponse = [/run-project-cell/];
      await open(daily, nb);
      await expect(
        cellAt(daily.page, 0).getByRole("button", {
          name: /^Data connection:/,
        }),
      ).toHaveAccessibleName(`Data connection: ${conn.name}`);
      await runWithKeyboard(daily, 0);
      const cell = cellAt(daily.page, 0);
      await expect(
        cell.getByText(/was not found in location US/).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        cell.getByText("Table not found", { exact: true }),
      ).toBeVisible(fast);
      await daily.check({ url: projectUrl(nb) });
    } finally {
      await deleteConnection(daily, conn.id);
    }
  });

  test("NOTEBOOK-09 generic run failure", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-05: a server fault during a run has no "Something went wrong" callout with the restart-and-rerun advice
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    daily.allowResponse = [/run-project-cell/];
    await open(daily, nb);
    await daily.page.route(
      "**/_agent-native/actions/run-project-cell",
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "kernel fault" }),
        }),
    );
    await runWithKeyboard(daily, 0);
    const cell = cellAt(daily.page, 0);
    await expect(
      cell.getByText("Something went wrong", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      cell.getByText(
        /We ran into an error when executing this query\. Try restarting your kernel and rerunning the cell\./,
      ),
    ).toBeVisible(fast);
  });

  test("NOTEBOOK-10 parameterized SQL that cannot run safely", async ({
    daily,
  }) => {
    test.fail(); // FINDING COV-NOTEBOOK-06: a {{ }} parameter is sent as literal SQL; no "We couldn't execute this parameterized query" callout
    const nb = await seed(daily, [
      {
        kind: "sql",
        text: "select * from orders where id = {{ missing_var }}",
        connection: SAMPLE_CONNECTION,
      },
    ]);
    created.push(nb.id);
    daily.allowResponse = [/run-project-cell/];
    await open(daily, nb);
    await runWithKeyboard(daily, 0);
    await expect(
      cellAt(daily.page, 0).getByText(
        "We couldn't execute this parameterized query",
      ),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("NOTEBOOK-11 run with no connection selected", async ({ daily }) => {
    test.fail(); // FINDING F12: the error reads "Action run-project-cell failed: …", leaking the internal action name
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: null },
    ]);
    created.push(nb.id);
    daily.allowResponse = [/run-project-cell/];
    await open(daily, nb);
    await runWithKeyboard(daily, 0);
    const cell = cellAt(daily.page, 0);
    await expect(
      cell.getByText(/select a data connection/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(cell.getByText(/Action [a-z-]+ failed/)).toHaveCount(0);
    await daily.check({ url: projectUrl(nb) });
  });

  test("NOTEBOOK-12 failed cell state", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-07: a failed cell has no "Run failed" tag
    const nb = await seed(daily, [
      {
        kind: "sql",
        text: "select * from no_such_table",
        connection: SAMPLE_CONNECTION,
      },
    ]);
    created.push(nb.id);
    daily.allowResponse = [/run-project-cell/];
    await open(daily, nb);
    await runWithKeyboard(daily, 0);
    const tag = cellAt(daily.page, 0).getByText("Run failed", { exact: true });
    await expect(tag).toBeVisible({ timeout: 10_000 });
    await tag.hover();
    await expect(
      daily.page.getByText("This cell failed with an error"),
    ).toBeVisible(fast);
  });

  test("NOTEBOOK-13 interrupt shows cancelled", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-02: no Interrupt control, so a run cannot be cancelled
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    await delayRuns(daily.page, 3_000);
    await runWithKeyboard(daily, 0);
    const cell = cellAt(daily.page, 0);
    await expect(cell.getByText(/Running/).first()).toBeVisible();
    await cell.getByRole("button", { name: "Interrupt" }).click(fast);
    await expect(cell.getByText("Cancelled", { exact: true })).toBeVisible(
      fast,
    );
  });

  test("NOTEBOOK-14 cell with no output", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-08: a run that returns nothing shows no "No output" placeholder
    const conn = await createBigQueryConnection(daily);
    try {
      await daily.scenario({ bigquery: "empty" });
      const nb = await seed(daily, [
        {
          kind: "sql",
          text: "select * from daily_sales.orders",
          connection: conn.id,
        },
      ]);
      created.push(nb.id);
      await open(daily, nb);
      await runWithKeyboard(daily, 0);
      const cell = cellAt(daily.page, 0);
      await expect(outputOf(cell)).toBeVisible({ timeout: 15_000 });
      await expect(
        outputOf(cell).getByText(/^No output( content)?$/),
      ).toBeVisible(fast);
    } finally {
      await deleteConnection(daily, conn.id);
    }
  });

  test("NOTEBOOK-15 reload keeps cells, outputs and connection (BigQuery)", async ({
    daily,
  }) => {
    test.fail(); // FINDING COV-BQ-OUTPUT: the BigQuery query does not produce the expected output before reload.
    const conn = await createBigQueryConnection(daily);
    try {
      const nb = await seed(daily, [
        {
          kind: "sql",
          text: "select * from orders limit 5",
          connection: SAMPLE_CONNECTION,
        },
        {
          kind: "sql",
          text: "select * from daily_sales.orders limit 3",
          connection: conn.id,
        },
      ]);
      created.push(nb.id);
      await open(daily, nb);
      await runWithKeyboard(daily, 0);
      await waitForOutput(daily.page, 0);
      await runWithKeyboard(daily, 1);
      await waitForOutput(daily.page, 1, 15_000);
      const first = await cellAt(daily.page, 0)
        .locator(".nb-output-title")
        .innerText();
      const second = await cellAt(daily.page, 1)
        .locator(".nb-output-title")
        .innerText();
      expect(second).toMatch(/^3 rows/);
      await daily.check({ url: projectUrl(nb) });
      await daily.reload();
      await expect(cellLocator(daily.page)).toHaveCount(2, { timeout: 30_000 });
      await expect(
        cellAt(daily.page, 0).locator(".nb-output-title"),
      ).toHaveText(first, { timeout: 15_000 });
      await expect(
        cellAt(daily.page, 1).locator(".nb-output-title"),
      ).toHaveText(second);
      await expect(
        cellAt(daily.page, 0).getByRole("button", {
          name: /^Data connection:/,
        }),
      ).toHaveAccessibleName(`Data connection: ${SAMPLE_NAME}`);
      await expect(
        cellAt(daily.page, 1).getByRole("button", {
          name: /^Data connection:/,
        }),
      ).toHaveAccessibleName(`Data connection: ${conn.name}`);
      await daily.check({ url: projectUrl(nb) });
    } finally {
      await deleteConnection(daily, conn.id);
    }
  });

  test("NOTEBOOK-16 cell changed in another tab", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-09: the conflict shows a "Changed elsewhere" tag but not the sentence "This cell has been changed elsewhere. Discard your edits, or overwrite."
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    const editor = editorOf(cellAt(daily.page, 0));
    await editor.press("End");
    await daily.type(" -- mine");
    const { id: _id, ...contents } = (await stored(daily, nb.id))[0]!;
    await slowAction(daily, "save-project-cell", {
      projectId: nb.id,
      cellId: nb.cellIds[0],
      contents: { ...contents, source: "select 2 as a -- theirs" },
    });
    await editor.press("End");
    await daily.type("!");
    const cell = cellAt(daily.page, 0);
    await expect(
      cell.getByText("Changed elsewhere", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      cell.getByText(
        "This cell has been changed elsewhere. Discard your edits, or overwrite.",
      ),
    ).toBeVisible(fast);
  });

  test("NOTEBOOK-17 save edits error", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-10: a failed save does not say "We couldn’t save these edits."
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    daily.allowResponse = [/save-project-cell/];
    await open(daily, nb);
    await daily.page.route(
      "**/_agent-native/actions/save-project-cell",
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "save failed" }),
        }),
    );
    await editorOf(cellAt(daily.page, 0)).press("End");
    await daily.type(" -- edit");
    await runWithKeyboard(daily, 0);
    await expect(
      cellAt(daily.page, 0).getByText("We couldn’t save these edits."),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("NOTEBOOK-18 save refused for lack of permission", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-11: a permission refusal on save does not say "You cannot save these edits with your current permissions."
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    daily.allowResponse = [/save-project-cell/];
    await open(daily, nb);
    await daily.page.route(
      "**/_agent-native/actions/save-project-cell",
      (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "Forbidden", errorCode: "forbidden" }),
        }),
    );
    await editorOf(cellAt(daily.page, 0)).press("End");
    await daily.type(" -- edit");
    await runWithKeyboard(daily, 0);
    await expect(
      cellAt(daily.page, 0).getByText(
        "You cannot save these edits with your current permissions.",
      ),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("NOTEBOOK-20 add Python, Text and a chart from a result", async ({
    daily,
  }) => {
    test.fail(); // FINDING COV-NOTEBOOK-12: a result table has no "Duplicate to chart" action
    const nb = await seed(daily, [
      {
        kind: "sql",
        text: "select * from orders limit 5",
        connection: SAMPLE_CONNECTION,
      },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    await runWithKeyboard(daily, 0);
    await waitForOutput(daily.page, 0);
    await daily.click(
      daily.page.getByRole("button", { name: "Python", exact: true }),
    );
    await expect(cellLocator(daily.page)).toHaveCount(2);
    await daily.click(
      daily.page.getByRole("button", { name: "Text", exact: true }),
    );
    await expect(cellLocator(daily.page)).toHaveCount(3);
    await expect
      .poll(async () => (await stored(daily, nb.id)).map((c) => c.kind))
      .toEqual(["sql", "code", "text"]);
    await daily.check({ url: projectUrl(nb) });
    await outputOf(cellAt(daily.page, 0)).hover();
    await daily.page
      .getByRole("button", { name: "Duplicate to chart" })
      .click(fast);
    await expect(cellLocator(daily.page)).toHaveCount(4, fast);
  });

  test("NOTEBOOK-23 comment on selected cell text", async ({ daily }) => {
    test.fail(); // FINDING COV-NOTEBOOK-13: selecting text in a cell offers no comment control
    const nb = await seed(daily, [
      { kind: "sql", text: "select 1 as a", connection: SAMPLE_CONNECTION },
    ]);
    created.push(nb.id);
    await open(daily, nb);
    const editor = editorOf(cellAt(daily.page, 0));
    await editor.focus();
    await editor.press(`${MOD}+a`);
    await daily.page
      .getByRole("button", { name: /^(Add )?[Cc]omment$/ })
      .click(fast);
    await daily.type("check this");
    await daily.press(`${MOD}+Enter`);
    await expect(daily.page.getByText("check this")).toBeVisible(fast);
  });
});
