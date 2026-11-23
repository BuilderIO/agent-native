import { randomUUID } from "node:crypto";

import { agentEngineStatusUrlForChatApi } from "@agent-native/core/client/agent-engine-readiness";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import {
  projectDocumentSchema,
  sqlCellContentsSchema,
} from "../../app/lib/model/contracts.js";
import {
  startThreadInput,
  startThreadReceipt,
  submitThreadTurnInput,
} from "../../shared/analytics-thread.js";
import { runReceiptSchema } from "../../shared/notebook-execution.js";
import { notebookPendingChangesSchema } from "../../shared/notebook-proposals.js";
import { heroArea, heroEditor, threadEditor } from "../daily/ask.helpers.js";
import {
  cellAt,
  editorOf,
  SAMPLE_CONNECTION,
} from "../daily/notebook.helpers.js";
import { magicEditPrompt } from "../local/phase1-model.js";
import { publishFixture } from "../publish-fixture.js";
import { writeSqlEditor } from "../sql-editor.js";
import { withHeldDraftQuery } from "./draft-query-hold.js";
import {
  readAttempt,
  readCompletedResultPage,
  readRunAttempts,
} from "./execution-readback.js";
import type { FlowContext, FlowDefinition } from "./runtime.js";
import { EvidenceFailure } from "./verdict.js";
import { controlWarehouseEntitlement } from "./warehouse-entitlement.js";

const slow = { timeout: 60_000 };
const projectPath = (id: string) => `/project/${encodeURIComponent(id)}/latest`;
const appPath = (id: string) => `/app/${encodeURIComponent(id)}`;
const text = (page: Page, value: string) =>
  page.getByText(value, { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const uuid = () => randomUUID();

const cellSetup = {
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};
const sql = (name: string, source: string, warehouse = false) => ({
  ...cellSetup,
  kind: "sql",
  label: name,
  source,
  databaseSchema: null,
  dataConnectionId: warehouse ? SAMPLE_CONNECTION : null,
  ...(warehouse ? {} : { connectionMode: "dataframes" }),
  resultVariable: name.toLowerCase(),
  outputResult: true,
});

async function seedProject(flow: FlowContext, label: string, cells: object[]) {
  const title = flow.name(label);
  const created = await flow.action<{ id: string }>("create-project", {
    title,
    cells,
  });
  const { project } = await flow.action<{
    project: {
      id: string;
      cells: { id: string; contents: { label: string; source?: string } }[];
    };
  }>("get-project", { projectId: created.id });
  expect(project.id).toBe(created.id);
  expect(project.cells).toHaveLength(cells.length);
  flow.id("projectId", project.id);
  return { ...project, title };
}

async function publishedSeed(
  flow: FlowContext,
  name: string,
  sentinelLabel: string,
  sentinel: number,
) {
  const project = await seedProject(flow, name, [
    {
      ...cellSetup,
      kind: "text",
      label: sentinelLabel,
      text: `${sentinelLabel} ${sentinel}`,
      gridX: 0,
      gridY: 0,
      gridWidth: 12,
      gridHeight: 2,
    },
    {
      ...sql("Result", `select ${sentinel} as result`, true),
      gridX: 0,
      gridY: 2,
      gridWidth: 12,
      gridHeight: 2,
    },
  ]);
  const { releaseId } = await publishFixture(
    (action, input) => flow.action(action, input),
    project.id,
    name,
  );
  flow.id("releaseId", releaseId);
  await flow.open(appPath(project.id));
  await expect(
    flow.page.getByRole("heading", { name: project.title, exact: true }),
  ).toBeVisible(slow);
  return { project, releaseId };
}

async function mountedAction(
  flow: Pick<FlowContext, "page" | "missing">,
  name: string,
  trigger: () => Promise<void>,
) {
  const wait = flow.page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          `/_agent-native/actions/${name}`,
        ),
      { timeout: 15_000 },
    )
    .then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );
  await trigger();
  const observed = await wait;
  if ("error" in observed) {
    if (
      observed.error instanceof Error &&
      observed.error.name === "TimeoutError"
    )
      flow.missing(`mounted ${name} transition`);
    throw observed.error;
  }
  expect(observed.response.ok(), `${name} response`).toBe(true);
  return observed.response;
}

function oneInteger(rows: unknown[][], expected: number) {
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveLength(1);
  const value = rows[0]?.[0];
  expect([expected, String(expected)]).toContain(value);
}

function askOrderCount(value: unknown) {
  return z
    .union([
      z.number().int(),
      z.string().regex(/^\d+$/),
      z.object({
        type: z.enum(["integer", "int64"]),
        value: z.string().regex(/^\d+$/),
      }),
    ])
    .transform((count) =>
      String(typeof count === "object" ? count.value : count),
    )
    .parse(value);
}

function mountedHref(flow: FlowContext, path: string) {
  const mount = new URL(flow.baseUrl).pathname.replace(/\/$/, "");
  return flow.url(
    mount && path.startsWith(`${mount}/`) ? path.slice(mount.length) : path,
  );
}

async function colleagueIdentity(flow: FlowContext) {
  const owner = await flow.identity();
  const colleague = await flow.identity("colleague");
  if (
    owner.user.id === colleague.user.id ||
    owner.workspace.id !== colleague.workspace.id
  )
    flow.unavailable(
      "colleague session must belong to a different member in the same workspace",
    );
  return colleague;
}

async function wrongOrgIdentity(flow: FlowContext) {
  const owner = await flow.identity();
  const denied = await flow.identity("denied");
  if (
    owner.user.id === denied.user.id ||
    owner.workspace.id === denied.workspace.id
  )
    flow.unavailable(
      "denied session must belong to a different actor in another workspace",
    );
  return denied;
}

async function colleagueMemberId(
  flow: FlowContext,
  projectId: string,
  email: string,
) {
  const { people } = await flow.action<{ people: { id: string }[] }>(
    "find-published-app-colleagues",
    { projectId, query: email },
  );
  expect(people).toHaveLength(1);
  return z.string().parse(people[0]?.id);
}

async function verifyRevokedWarehouseResult(
  flow: FlowContext,
  colleagueEmail: string,
) {
  const fixture = z
    .object({ fixtureId: z.uuid(), connectionId: z.string().min(1) })
    .parse(
      await controlWarehouseEntitlement(flow, {
        operation: "warehouse-create-entitlement",
        colleagueEmail,
      }),
    );
  flow.id("entitlementConnectionId", fixture.connectionId);
  const project = await seedProject(flow, "Share warehouse entitlement 11", [
    {
      ...sql(
        "Warehouse",
        "select 11000 + max(sentinel) as result from a2_parity.sql_v2_04",
        true,
      ),
      dataConnectionId: fixture.connectionId,
    },
    {
      ...sql("Result", "select result from warehouse"),
      gridX: 0,
      gridY: 0,
      gridWidth: 12,
      gridHeight: 2,
    },
  ]);
  const { releaseId } = await publishFixture(
    (action, input) => flow.action(action, input),
    project.id,
    "share11-entitlement",
  );
  flow.id("entitlementReleaseId", releaseId);
  const { revision } = await flow.action<{ revision: string }>(
    "list-published-app-access",
    { projectId: project.id },
  );
  const memberId = await colleagueMemberId(flow, project.id, colleagueEmail);
  expect(
    await flow.action("set-published-app-access", {
      projectId: project.id,
      expectedRevision: revision,
      opId: uuid(),
      change: { kind: "grant", memberId, role: "app_viewer" },
    }),
  ).toMatchObject({ effect: "added" });

  const cellId = z.string().parse(project.cells[1]?.id);
  const open = async (actor: "owner" | "colleague") => {
    const session = z
      .object({
        releaseId: z.literal(releaseId),
        sessionId: z.string().min(1),
        projection: z.object({
          outputs: z.record(z.string(), z.object({ resultId: z.string() })),
        }),
      })
      .parse(
        await flow.action(
          "open-published-app-session",
          {
            projectId: project.id,
            version: "latest",
            openId: uuid(),
          },
          actor,
        ),
      );
    return {
      sessionId: session.sessionId,
      resultId: z.string().parse(session.projection.outputs[cellId]?.resultId),
    };
  };
  const scope = await open("colleague");
  const ownerScope = await open("owner");
  expect(ownerScope.resultId).toBe(scope.resultId);
  flow.id("entitlementResultId", scope.resultId);
  const page = () =>
    flow.action("get-notebook-result-page", { ...scope, page: 1 }, "colleague");
  const ready = readCompletedResultPage(await page(), 1, "1", scope.resultId);
  const expectedRows = [[{ type: "integer", value: "11042" }]];
  expect(ready.rows).toEqual(expectedRows);
  const drill = () =>
    flow.action(
      "open-published-result-drill",
      {
        ...scope,
        filters: [
          {
            fieldId: z.string().parse(ready.manifest.fields[0]?.fieldId),
            value: { type: "integer", value: "11042" },
          },
        ],
      },
      "colleague",
    );
  const expectDrill = async () => {
    expect(await drill()).toMatchObject({
      status: "ready",
      resultId: scope.resultId,
      totalRows: 1,
      rows: expectedRows,
    });
  };
  await expectDrill();
  try {
    await flow.transition(
      "revoke the colleague's producing warehouse entitlement",
      async () => {
        expect(
          await controlWarehouseEntitlement(flow, {
            operation: "warehouse-revoke-entitlement",
            fixtureId: fixture.fixtureId,
          }),
        ).toEqual({ fixtureId: fixture.fixtureId, entitled: false });
        expect(await page()).toEqual({
          status: "denied",
          reason: "access_denied",
        });
        expect(await drill()).toEqual({
          status: "denied",
          reason: "access_denied",
        });
        const ownerPage = await flow.action("get-notebook-result-page", {
          ...ownerScope,
          page: 1,
        });
        expect(
          readCompletedResultPage(ownerPage, 1, "1", scope.resultId).rows,
        ).toEqual(expectedRows);
      },
    );
  } finally {
    expect(
      await controlWarehouseEntitlement(flow, {
        operation: "warehouse-restore-entitlement",
        fixtureId: fixture.fixtureId,
      }),
    ).toEqual({ fixtureId: fixture.fixtureId, entitled: true });
  }
  await flow.readback(
    "the same result page and drill return after entitlement restoration",
    async () => {
      expect(
        readCompletedResultPage(await page(), 1, "1", scope.resultId).rows,
      ).toEqual(expectedRows);
      await expectDrill();
    },
  );
}

const share11 = {
  id: "11-share-with-colleague",
  async run(flow: FlowContext) {
    const { page } = flow;
    const { project, releaseId } = await flow.step(
      "publish share11-v1 with 11042",
      () => publishedSeed(flow, "share11-v1", "Share sentinel", 11042),
    );
    const share = button(page, "Share");
    await flow.require(share, "Share from published app");
    await share.click();
    const rowRole = (name: string) =>
      button(page, name).or(page.getByRole("option", { name, exact: true }));
    const access = () =>
      flow.action<{
        projectId: string;
        revision: string;
        generalAccess: string;
        supportedRoles: string[];
        grants: { id: string; person: { id: string }; role: string }[];
        appHref: string;
      }>("list-published-app-access", { projectId: project.id });
    const initial = await flow.step("read app-only grant capability", access);
    if (!initial.supportedRoles.includes("app_viewer"))
      flow.missing("Can view app role");
    const colleague = await colleagueIdentity(flow);
    const memberId = await colleagueMemberId(
      flow,
      project.id,
      colleague.user.email,
    );
    const picker = page.getByRole("combobox");
    await flow.require(picker, "workspace colleague picker");
    await flow.oracle("Invite only and member chooser", async () => {
      expect(initial.generalAccess).toBe("private");
      await expect(text(page, "Invite only")).toBeVisible();
      await expect(picker).toHaveAttribute(
        "placeholder",
        /^(\+ Users|\+ Users, groups, or collections\.\.\.)$/,
      );
    });
    await picker.fill(colleague.user.name);
    await page
      .getByRole("option", { name: colleague.user.name, exact: true })
      .click();
    if (initial.supportedRoles.includes("explorer")) {
      await expect(rowRole("Can explore")).toBeVisible();
      await rowRole("Can explore").click();
      await rowRole("Can view app").click();
    }
    await flow.oracle(
      "Can view app limits recipients to the published app and comments",
      async () => {
        await expect(rowRole("Can view app")).toBeVisible();
        await expect(
          text(page, "Can view and comment only on the published App."),
        ).toBeVisible();
      },
    );
    await flow.transition("Add colleague as Can view app", async () => {
      await mountedAction(flow, "set-published-app-access", () =>
        button(page, "Add").click(),
      );
      await expect(text(page, "Access added.")).toBeVisible();
    });
    const saved = await flow.readback(
      "read exact persisted app-only grant and canonical link",
      async () => {
        const projection = await access();
        expect(projection.projectId).toBe(project.id);
        expect(BigInt(projection.revision)).toBe(BigInt(initial.revision) + 1n);
        const grants = projection.grants.filter(
          (g) => g.person.id === memberId,
        );
        expect(grants).toHaveLength(1);
        const grant = z
          .object({ id: z.string(), role: z.literal("app_viewer") })
          .parse(grants[0]);
        flow.id("grantId", grant.id);
        expect(mountedHref(flow, projection.appHref)).toBe(
          flow.url(`${appPath(project.id)}/latest`),
        );
        return { grant, href: projection.appHref };
      },
    );
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await button(page, "Copy link").click();
    await expect(
      text(page, "Link to published app copied to clipboard."),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      mountedHref(flow, saved.href),
    );
    const sessionInput = {
      projectId: project.id,
      version: "latest" as const,
      openId: uuid(),
    };
    const session = await flow.readback(
      "colleague resolves the pinned release using an independent action",
      async () => {
        const result = await flow.action<{
          releaseId: string;
          sessionId: string;
        }>("open-published-app-session", sessionInput, "colleague");
        expect(result.releaseId).toBe(releaseId);
        flow.id("colleagueSessionId", result.sessionId);
        return result;
      },
    );
    await flow.cold(
      "colleague sees Share sentinel 11042",
      async (viewer) => {
        await viewer.goto(mountedHref(flow, saved.href));
        await expect(text(viewer, "Share sentinel 11042")).toBeVisible(slow);
        await expect(button(viewer, "Explore")).toHaveCount(0);
      },
      "colleague",
    );
    await flow.rejectAction(
      "get-project",
      { projectId: project.id },
      /forbidden|not_found/i,
      "colleague",
    );
    await flow.transition(
      "revoke the colleague's access from Share",
      async () => {
        const row = page
          .getByRole("row")
          .filter({ hasText: colleague.user.name });
        await row
          .getByRole("button", { name: "Can view app", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "Remove access", exact: true })
          .click();
        await mountedAction(flow, "set-published-app-access", () =>
          button(page, "Remove").click(),
        );
        await expect(text(page, "Access removed.")).toBeVisible();
      },
    );
    await flow.readback(
      "revoked grant is absent and revision advanced",
      async () => {
        const projection = await access();
        expect(BigInt(projection.revision)).toBe(BigInt(initial.revision) + 2n);
        expect(projection.grants.some((g) => g.id === saved.grant.id)).toBe(
          false,
        );
      },
    );
    await flow.rejectAction(
      "get-published-app-session",
      { releaseId: session.releaseId, sessionId: session.sessionId },
      /forbidden|not_found/i,
      "colleague",
    );
    await flow.rejectAction(
      "open-published-app-session",
      { ...sessionInput, openId: uuid() },
      /forbidden|not_found/i,
      "colleague",
    );
    await wrongOrgIdentity(flow);
    await flow.rejectAction(
      "open-published-app-session",
      { ...sessionInput, openId: uuid() },
      /forbidden|not_found/i,
      "denied",
    );
    await verifyRevokedWarehouseResult(flow, colleague.user.email);
  },
} satisfies FlowDefinition;

const graph12 = {
  id: "12-graph-run-modes",
  async run(flow: FlowContext) {
    const { page } = flow;
    const project = await seedProject(flow, "Run graph 12", [
      sql("A", "select 42 as value", true),
      sql("B", "select value + 8 as value from a"),
      sql("C", "select value + 12 as value from a"),
      sql("D", "select b.value + c.value as value from b cross join c"),
      sql("U", "select 84 as value", true),
      sql("V", "select value + 1 as value from u"),
    ]);
    const [a, b, c, d, u, v] = z
      .tuple([
        z.string(),
        z.string(),
        z.string(),
        z.string(),
        z.string(),
        z.string(),
      ])
      .parse(project.cells.map((cell) => cell.id));
    const ids = [a, b, c, d, u, v];
    await flow.open(projectPath(project.id));
    const runAll = button(page, "Run all");
    await flow.require(runAll, "Run all notebook control");
    async function admit(
      label: string,
      trigger: () => Promise<void>,
      expected: string[],
    ) {
      const response = await flow.transition(label, () =>
        mountedAction(flow, "start-notebook-run", trigger),
      );
      const receipt = runReceiptSchema.parse(await response.json());
      flow.id(`run-${receipt.request.mode}`, receipt.runId);
      expect(receipt.plan.admittedCellIds).toEqual(expected);
      expect(
        new Set(receipt.attempts.map((attempt) => attempt.attempt.attemptId))
          .size,
      ).toBe(expected.length);
      return flow.readback(
        `${label} has the same durable admission and terminal attempts`,
        async () => {
          let last = receipt;
          await expect
            .poll(async () => {
              const durable = readRunAttempts(
                await flow.action("get-notebook-run", {
                  runId: receipt.runId,
                }),
                receipt.runId,
              );
              last = durable;
              expect(durable.plan.admittedCellIds).toEqual(expected);
              expect(
                durable.attempts.map((attempt) => attempt.attempt.attemptId),
              ).toEqual(
                receipt.attempts.map((attempt) => attempt.attempt.attemptId),
              );
              return durable.attempts.every(
                ({ state }) =>
                  state.status !== "queued" && state.status !== "running",
              );
            }, slow)
            .toBe(true);
          const unfinished = last.attempts.filter(
            ({ state }) => state.status !== "complete",
          );
          if (unfinished.length) {
            throw new EvidenceFailure(
              `Notebook run ${receipt.runId} ended with ${unfinished.map(({ state }) => state.status).join(", ")}`,
            );
          }
          return last;
        },
      );
    }
    const baseline = await admit(
      "Run all admits the complete graph in notebook order",
      () => runAll.click(),
      ids,
    );
    await flow.readback("baseline diamond D reads exactly 104", async () => {
      const attempt = baseline.attempts.find(
        ({ attempt }) => attempt.cellId === d,
      );
      if (!attempt || attempt.state.status !== "complete")
        throw new Error("No complete baseline D attempt");
      const resultId = z.string().parse(attempt.state.resultIds[0]);
      const result = readCompletedResultPage(
        await flow.action("get-notebook-result-page", { resultId, page: 1 }),
        1,
        "1",
        resultId,
      );
      expect(result.manifest.result.producer.attemptId).toBe(
        attempt.attempt.attemptId,
      );
      oneInteger(result.rows, 104);
    });
    const runOptions = button(page, "Run all options");
    await flow.require(runOptions, "project run options");
    await runOptions.click();
    await page
      .getByRole("menuitem", { name: "Run mode", exact: true })
      .press("ArrowRight");
    await flow.oracle(
      "Auto default and exact one-off run mode options",
      async () => {
        const auto = page.getByRole("menuitemradio", {
          name: "Auto",
          exact: true,
        });
        await expect(auto).toHaveAttribute("aria-checked", "true");
        for (const label of [
          "Cell only",
          "Cell + upstream",
          "Cell + downstream",
        ])
          await expect(text(page, label)).toBeVisible();
      },
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    async function runCell(index: number, modeName: string) {
      const cell = cellAt(page, index);
      const options = cell.getByRole("button", {
        name: "Run mode",
        exact: true,
      });
      await flow.require(options, "one-off cell run mode menu");
      await options.click();
      await page.getByRole("menuitem", { name: modeName, exact: true }).click();
    }
    async function editSql(index: number, source: string) {
      const editor = editorOf(cellAt(page, index));
      await mountedAction(flow, "save-project-cell", () =>
        writeSqlEditor(editor, source),
      );
      const { project: saved } = z
        .object({ project: projectDocumentSchema })
        .parse(await flow.action("get-project", { projectId: project.id }));
      expect(saved.cells.find(({ id }) => id === ids[index])).toMatchObject({
        contents: { kind: "sql", source },
      });
    }
    await admit("Cell only admits only B", () => runCell(1, "Cell only"), [b]);
    await admit(
      "Cell + upstream admits A, B, C, D",
      () => runCell(3, "Cell + upstream"),
      [a, b, c, d],
    );
    await admit(
      "Cell + downstream admits B and D",
      () => runCell(1, "Cell + downstream"),
      [b, d],
    );
    await editSql(2, "select value + 13 as value from a");
    const auto = await admit(
      "Auto B admits B, edited C and D",
      () => runCell(1, "Auto"),
      [b, c, d],
    );
    const expectedValues = [42, 50, 55, 105, 84, 85];
    await flow.readback(
      "result pages preserve exact graph values and attempt provenance",
      async () => {
        for (const [index, cellId] of ids.entries()) {
          const attempt = [...auto.attempts, ...baseline.attempts].find(
            ({ attempt }) => attempt.cellId === cellId,
          );
          if (!attempt || attempt.state.status !== "complete")
            throw new Error("No durable result for graph cell");
          const resultId = z.string().parse(attempt.state.resultIds[0]);
          const value = z.number().parse(expectedValues[index]);
          const page = readCompletedResultPage(
            await flow.action("get-notebook-result-page", {
              resultId,
              page: 1,
            }),
            1,
            "1",
            resultId,
          );
          expect(page.manifest.result.producer.attemptId).toBe(
            attempt.attempt.attemptId,
          );
          oneInteger(page.rows, value);
          flow.id(`result-${index}`, resultId);
        }
      },
    );
    for (const [index, value] of expectedValues.entries())
      await expect(
        cellAt(page, index).getByRole("cell", {
          name: String(value),
          exact: true,
        }),
      ).toBeVisible(slow);
    await flow.cold(
      "cold notebook preserves exact diamond results",
      async (cold) => {
        await cold.goto(flow.url(projectPath(project.id)));
        await expect(
          cellAt(cold, 3).getByRole("cell", { name: "105", exact: true }),
        ).toBeVisible(slow);
        await expect(
          cellAt(cold, 5).getByRole("cell", { name: "85", exact: true }),
        ).toBeVisible(slow);
      },
    );
    await wrongOrgIdentity(flow);
    await flow.rejecting("Wrong workspace cannot read the run", async () => {
      expect(
        await flow.action(
          "get-notebook-run",
          { runId: baseline.runId },
          "denied",
        ),
      ).toEqual({ status: "absent", reason: "not_found" });
    });
    const getRun = async (runId: string) =>
      readRunAttempts(await flow.action("get-notebook-run", { runId }), runId);
    const getKernel = async () =>
      z
        .object({
          status: z.literal("found"),
          generation: z.string().regex(/^\d+$/),
        })
        .parse(
          await flow.action("get-notebook-kernel-session", {
            scope: { kind: "draft", projectId: project.id },
          }),
        );
    async function expectEmptyOutputs() {
      const { cells } = z
        .object({
          status: z.literal("found"),
          cells: z.record(
            z.string(),
            z.object({ resultId: z.string().nullable() }),
          ),
        })
        .parse(
          await flow.action("get-notebook-execution", {
            projectId: project.id,
          }),
        );
      expect(ids.map((id) => cells[id]?.resultId)).toEqual(ids.map(() => null));
    }
    const scope = { projectId: project.id, cellId: a };
    await flow.transition(
      "Restart advances generation and Interrupt cancels the held graph",
      () =>
        withHeldDraftQuery(flow, scope, "before-dispatch", async (hold) => {
          const before = await getKernel();
          await runOptions.click();
          const restart = page.getByRole("menuitem", {
            name: "Restart and run all",
            exact: true,
          });
          const response = await mountedAction(
            flow,
            "control-notebook-kernel",
            () => restart.click(),
          );
          expect(response.request().postDataJSON()).toMatchObject({
            operation: "restart-and-run-all",
            expectedGeneration: before.generation,
          });
          const receipt = z
            .object({
              runId: z.string().min(1),
              generation: z.string().regex(/^\d+$/),
            })
            .parse(await response.json());
          expect(BigInt(receipt.generation)).toBe(
            BigInt(before.generation) + 1n,
          );
          const attemptId = await hold.waitForAttempt(receipt.runId);
          const started = await getRun(receipt.runId);
          expect(started.plan.admittedCellIds).toEqual(ids);
          expect(started.attempts.map(({ state }) => state.status)).toEqual([
            "running",
            "queued",
            "queued",
            "queued",
            "queued",
            "queued",
          ]);
          expect(started.attempts[0]?.attempt.attemptId).toBe(attemptId);
          await expectEmptyOutputs();
          const interrupt = button(page, "Interrupt");
          await flow.require(interrupt, "Interrupt the active graph");
          const cancellation = await mountedAction(
            flow,
            "cancel-notebook-run",
            () => interrupt.click(),
          );
          expect(cancellation.request().postDataJSON()).toEqual({
            runId: receipt.runId,
          });
          await expect
            .poll(
              async () =>
                (await getRun(receipt.runId)).attempts.map(
                  ({ state }) => state.status,
                ),
              slow,
            )
            .toEqual(ids.map(() => "cancelled"));
          expect(await getKernel()).toMatchObject({
            generation: receipt.generation,
          });
          await expectEmptyOutputs();
          flow.id("interruptedRestartRun", receipt.runId);
        }),
    );
    await flow.cold(
      "Cold notebook has no outputs left by the interrupted restart",
      async (cold) => {
        await cold.goto(flow.url(projectPath(project.id)));
        await expect(cellAt(cold, ids.length - 1)).toBeVisible(slow);
        for (const index of ids.keys())
          await expect(
            cellAt(cold, index).locator(".nb-table tbody tr"),
          ).toHaveCount(0);
      },
    );
    await admit(
      "Run all restores the graph after interrupt",
      () => runAll.click(),
      ids,
    );
    await editSql(1, "select parity_bad_12 from a");
    await flow.rejecting(
      "failed B blocks D and preserves the independent branch",
      async () => {
        await mountedAction(flow, "start-notebook-run", () =>
          runCell(1, "Cell + downstream"),
        );
        await expect(cellAt(page, 1)).toContainText(
          /(?:Binder Error|Referenced column).*parity_bad_12|parity_bad_12.*not found/s,
          slow,
        );
        await expect(cellAt(page, 3)).toContainText(
          "This cell was cancelled because an upstream cell encountered an error.",
          slow,
        );
        await expect(
          cellAt(page, 5).getByRole("cell", { name: "85", exact: true }),
        ).toBeVisible();
      },
    );
    await flow.transition(
      "Clear outputs fences a staged result that arrives late",
      () =>
        withHeldDraftQuery(flow, scope, "before-promotion", async (hold) => {
          await editSql(0, "select 42 as value where true");
          const response = await mountedAction(flow, "start-notebook-run", () =>
            runCell(0, "Cell only"),
          );
          const late = runReceiptSchema.parse(await response.json());
          expect(late.plan.admittedCellIds).toEqual([a]);
          const attemptId = await hold.waitForAttempt(late.runId);
          expect(attemptId).toBe(late.attempts[0]?.attempt.attemptId);
          await runOptions.click();
          const clear = page.getByRole("menuitem", {
            name: "Clear outputs",
            exact: true,
          });
          await flow.require(clear, "clear notebook outputs");
          await mountedAction(flow, "clear-project-outputs", () =>
            clear.click(),
          );
          await expect(text(page, "Project outputs cleared")).toBeVisible();
          await expectEmptyOutputs();
          await hold.release();
          await expect
            .poll(
              () =>
                flow.action("get-notebook-run-diagnostics", {
                  runId: late.runId,
                  attemptId,
                }),
              slow,
            )
            .toMatchObject({
              status: "found",
              diagnostic: { code: "superseded" },
            });
          await expectEmptyOutputs();
          await expect(
            cellAt(page, 0).locator(".nb-table tbody tr"),
          ).toHaveCount(0);
          flow.id("clearedLateRun", late.runId);
        }),
    );
  },
} satisfies FlowDefinition;

async function requireModel(flow: FlowContext) {
  const response = await flow.page.request.get(
    flow.url(agentEngineStatusUrlForChatApi()),
    {
      maxRedirects: 0,
      headers: { "x-agent-native-frontend": "1" },
    },
  );
  try {
    if (!response.ok())
      flow.unavailable(`model readiness returned HTTP ${response.status()}`);
    const status = z
      .object({ chatEligible: z.boolean() })
      .safeParse(await response.json());
    if (!status.success || !status.data.chatEligible)
      flow.unavailable(
        "agent-engine/status did not report chatEligible=true; configure a signed-in provider or the local Phase 1 model fixture",
      );
  } finally {
    await response.dispose();
  }
}

const changesSchema = notebookPendingChangesSchema;

export function magicSqlProposal(
  page: Pick<Page, "locator">,
  proposalId: string,
) {
  return page
    .locator(`[data-notebook-proposal=${JSON.stringify(proposalId)}]`)
    .getByRole("cell", { name: "13042", exact: true });
}

export async function rejectStaleNotebookReview(
  flow: Pick<FlowContext, "rejectAction">,
  input: {
    projectId: string;
    threadId: string;
    proposalId: string;
    overlayRevision: string;
    acceptedHead: Record<string, unknown>;
  },
) {
  await flow.rejectAction(
    "decide-notebook-pending-changes",
    {
      projectId: input.projectId,
      threadId: input.threadId,
      opId: uuid(),
      expectedOverlayRevision: input.overlayRevision,
      observedHead: input.acceptedHead,
      selection: { kind: "selected", ids: [input.proposalId] },
      decision: "undo",
    },
    /overlay_conflict|proposal_base_changed/,
    "owner",
    { uiOnly: true },
  );
}

const magic13 = {
  id: "13-magic-review-and-run",
  async run(flow: FlowContext) {
    const { page } = flow;
    const { project, releaseId } = await publishedSeed(
      flow,
      "magic13-v1",
      "Magic baseline",
      42,
    );
    await flow.open(projectPath(project.id));
    const agent = button(page, "Agent");
    await flow.require(agent, "notebook Agent view");
    await agent.click();
    await requireModel(flow);
    const editor = threadEditor(page);
    await flow.require(editor, "notebook agent composer");
    await flow.oracle("Ask approval is the default", async () => {
      await expect(button(page, "Ask")).toBeVisible();
      await expect(editor).toBeEditable();
    });
    const prompt =
      "Use notebook tools. Insert a SQL cell using SELECT 13042 AS result, visualize that result in a chart, and add an independent text cell containing Magic scratch 13. Run the candidate SQL before asking for review. Do not confirm anything.";
    await editor.fill(prompt);
    const review = button(page, "View pending changes");
    const proposalHeadings = page.locator("[data-notebook-proposal-heading]");
    const proposalsResponse = page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.pathname.endsWith(
              "/_agent-native/actions/get-notebook-pending-changes",
            ) && response.ok()
          );
        },
        { timeout: 75_000 },
      )
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      );
    await flow.transition(
      "agent stages changes before any accepted mutation",
      async () => {
        await button(page, "Send message").click();
        try {
          await review.waitFor({ state: "visible", timeout: 75_000 });
        } catch (error) {
          if (error instanceof Error && error.name === "TimeoutError")
            flow.missing("View pending changes after bound tool dispatch");
          throw error;
        }
        await expect(text(page, "3 pending changes")).toBeVisible(slow);
      },
    );
    const observed = await proposalsResponse;
    if ("error" in observed)
      flow.missing("registered pending changes projection");
    const request = observed.response.request();
    const threadId = z
      .string()
      .min(1)
      .parse(
        request.method() === "GET"
          ? new URL(request.url()).searchParams.get("threadId")
          : (request.postDataJSON() as { threadId?: string }).threadId,
      );
    flow.id("threadId", threadId);
    const pending = async () =>
      changesSchema.parse(
        await flow.action("get-notebook-pending-changes", {
          projectId: project.id,
          threadId,
        }),
      );
    const staged = await flow.readback(
      "three independent proposal identities and SQL candidate result",
      async () => {
        await expect
          .poll(
            async () =>
              (await pending()).changes.filter(
                ({ resultIds }) => resultIds.length > 0,
              ).length,
            slow,
          )
          .toBe(1);
        const state = await pending();
        const [sqlProposal] = z
          .tuple([changesSchema.shape.changes.element])
          .parse(state.changes.filter(({ resultIds }) => resultIds.length > 0));
        await expect(magicSqlProposal(page, sqlProposal.id)).toBeVisible(slow);
        expect(state.changes.map((change) => change.status)).toEqual([
          "pending",
          "pending",
          "pending",
        ]);
        expect(new Set(state.changes.map((change) => change.id)).size).toBe(3);
        flow.id("bindingId", state.bindingId);
        for (const [index, change] of state.changes.entries())
          flow.id(`proposal-${index}`, change.id);
        const resultIds = state.changes.flatMap((change) => change.resultIds);
        expect(resultIds.length).toBeGreaterThan(0);
        const results = await Promise.all(
          resultIds.map((resultId) =>
            flow.action<{ rows?: unknown[][] }>("get-notebook-result-page", {
              resultId,
              page: 1,
              threadId,
            }),
          ),
        );
        expect(
          results.some((result) =>
            result.rows?.some(
              (row) =>
                row.length === 1 && [13042, "13042"].includes(row[0] as number),
            ),
          ),
        ).toBe(true);
        for (const resultId of resultIds) {
          expect(
            await flow.action("get-notebook-result-page", {
              resultId,
              page: 1,
            }),
          ).toMatchObject({ status: "denied" });
        }
        const accepted = await flow.action<{ project: { cells: unknown[] } }>(
          "get-project",
          { projectId: project.id },
        );
        expect(accepted.project.cells).toHaveLength(2);
        return { ...state, sqlCellId: sqlProposal.cellId };
      },
    );
    await flow.oracle(
      "review button opens the staged diffs and the shortcut advances focus",
      async () => {
        await review.click();
        await expect(proposalHeadings.first()).toBeFocused();
        await page.keyboard.press("Alt+k");
        await expect(proposalHeadings.nth(1)).toBeFocused();
        await expect(button(page, "Confirm all")).toBeVisible();
        await expect(button(page, "Undo all")).toBeVisible();
        await expect(text(page, "Magic scratch 13").first()).toBeVisible();
      },
    );
    const scratch = page
      .locator("[data-notebook-cell]")
      .filter({ has: text(page, "Magic scratch 13") });
    const chatScratch = page
      .locator(".ws-agent-notebook")
      .getByText("Magic scratch 13", { exact: true })
      .filter({ visible: true });
    await expect(chatScratch.first()).toBeVisible();
    const referenceCount = await chatScratch.count();
    await scratch.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(chatScratch).toHaveCount(referenceCount);
    for (let index = 0; index < referenceCount; index++) {
      const reference = chatScratch.nth(index);
      await expect(reference).toBeVisible();
      await expect(reference).toHaveJSProperty("tagName", "DEL");
    }
    const confirm = await flow.transition(
      "confirm the two dependent SQL and chart changes",
      () =>
        mountedAction(flow, "decide-notebook-pending-changes", () =>
          button(page, "Confirm all").click(),
        ),
    );
    const decision = z
      .object({
        checkpointId: z.string(),
        acceptedHead: z.record(z.string(), z.unknown()),
        promotedResultIds: z.array(z.string()).min(1),
      })
      .parse(await confirm.json());
    flow.id("checkpointId", decision.checkpointId);
    const checkpoint = page
      .getByRole("status")
      .filter({ has: button(page, "View version") });
    await expect(checkpoint).toBeVisible();
    await expect(checkpoint).toContainText("Saved a version");
    await flow.readback(
      "accepted head and checkpoint persisted, while scratch was undone",
      async () => {
        const final = await pending();
        expect(final.acceptedHead).toEqual(decision.acceptedHead);
        expect(final.acceptedHead).not.toEqual(staged.acceptedHead);
        expect(final.changes.map((change) => change.status).sort()).toEqual([
          "confirmed",
          "confirmed",
          "undone",
        ]);
        const versions = await flow.action<{ versions: { id: string }[] }>(
          "list-project-versions",
          { projectId: project.id },
        );
        expect(
          versions.versions.some(
            (version) => version.id === decision.checkpointId,
          ),
        ).toBe(true);
      },
    );
    await flow.cold(
      "confirmed candidate survives a cold notebook reopen",
      async (cold) => {
        await cold.goto(flow.url(projectPath(project.id)));
        await expect(
          cold
            .locator(`[data-notebook-cell=${JSON.stringify(staged.sqlCellId)}]`)
            .getByRole("cell", { name: "13042", exact: true }),
        ).toBeVisible(slow);
        await expect(
          cold
            .locator("[data-notebook-cell]")
            .filter({ hasText: "Magic scratch 13" }),
        ).toHaveCount(0);
        await cold.goto(flow.url(appPath(project.id)));
        await expect(text(cold, "Magic baseline 42")).toBeVisible(slow);
        await expect(
          cold.getByRole("cell", { name: "13042", exact: true }),
        ).toHaveCount(0);
      },
    );
    const frozen = await flow.action<{
      project: { publishedVersionId: string };
    }>("get-project", { projectId: project.id });
    expect(frozen.project.publishedVersionId).toBe(releaseId);
    await flow.rejectAction(
      "get-notebook-pending-changes",
      { projectId: project.id, threadId: uuid() },
      /thread_not_found|review_context_required|review_forbidden/,
    );
    await rejectStaleNotebookReview(flow, {
      projectId: project.id,
      threadId,
      proposalId: z.string().min(1).parse(staged.changes[0]?.id),
      overlayRevision: staged.overlayRevision,
      acceptedHead: staged.acceptedHead,
    });
    const scope = { projectId: project.id, threadId };
    const editedCell = page.locator(
      `[data-notebook-cell=${JSON.stringify(staged.sqlCellId)}]`,
    );
    const activeProposal = async () =>
      (await pending()).changes.find(
        ({ cellId, status }) =>
          cellId === staged.sqlCellId &&
          (status === "pending" || status === "conflicted"),
      );
    const stageEdit = async () => {
      await editor.fill(magicEditPrompt);
      await button(page, "Send message").click();
      await expect
        .poll(async () => (await activeProposal())?.kind, slow)
        .toBe("edit");
    };
    const undoAll = () =>
      mountedAction(flow, "decide-notebook-pending-changes", async () => {
        const undo = button(page, "Undo all");
        if (!(await undo.isVisible())) await review.click();
        await undo.click();
      });
    const humanSql = "SELECT 13099 AS result";
    const readAcceptedSql = async () => {
      const { project } = z
        .object({ project: projectDocumentSchema })
        .parse(
          await flow.action("get-project", { projectId: scope.projectId }),
        );
      return sqlCellContentsSchema.parse(
        project.cells.find(({ id }) => id === staged.sqlCellId)?.contents,
      );
    };
    await flow.rejecting(
      "A same-field human edit blocks confirmation",
      async () => {
        await stageEdit();
        const before = await pending();
        const { id: proposalId } = changesSchema.shape.changes.element.parse(
          await activeProposal(),
        );
        await flow.action("save-project-cell", {
          projectId: project.id,
          cellId: staged.sqlCellId,
          contents: { ...(await readAcceptedSql()), source: humanSql },
        });
        expect((await readAcceptedSql()).source).toBe(humanSql);
        await expect
          .poll(async () => (await activeProposal())?.status, slow)
          .toBe("conflicted");
        await flow.rejectAction(
          "decide-notebook-pending-changes",
          {
            ...scope,
            opId: uuid(),
            expectedOverlayRevision: before.overlayRevision,
            observedHead: before.acceptedHead,
            selection: { kind: "selected", ids: [proposalId] },
            decision: "confirm",
          },
          /proposal_base_changed/,
          "owner",
          { uiOnly: true },
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        await undoAll();
      },
    );
    await flow.transition(
      "Undo all fences a candidate result held before promotion",
      () =>
        withHeldDraftQuery(
          flow,
          { projectId: project.id, cellId: staged.sqlCellId },
          "before-candidate-promotion",
          async (hold) => {
            await stageEdit();
            await expect
              .poll(async () => (await activeProposal())?.runId, slow)
              .toEqual(expect.any(String));
            const candidate = changesSchema.shape.changes.element.parse(
              await activeProposal(),
            );
            const runId = z.string().min(1).parse(candidate.runId);
            const attemptId = await hold.waitForAttempt(runId);
            const readRun = async () =>
              readAttempt(
                await flow.action("get-notebook-run", { runId, threadId }),
                runId,
                staged.sqlCellId,
              );
            expect(candidate.resultIds).toEqual([]);
            expect((await readRun()).state.status).toBe("running");
            const diagnostics = () =>
              flow.action("get-notebook-run-diagnostics", {
                runId,
                attemptId,
                threadId,
              });
            expect(await diagnostics()).toMatchObject({ status: "found" });
            const undone = await undoAll();
            expect(await undone.json()).toMatchObject({
              decision: "undo",
              proposalIds: [candidate.id],
            });
            await hold.release();
            await expect
              .poll(async () => (await readRun()).state, slow)
              .toEqual({ status: "failed", reason: "execution_failed" });
            expect(await diagnostics()).toEqual({
              status: "denied",
              reason: "access_denied",
            });
            expect(
              (await pending()).changes.find(({ id }) => id === candidate.id),
            ).toMatchObject({ status: "undone", resultIds: [] });
            await expect(
              editedCell.getByRole("cell", { name: "13099", exact: true }),
            ).toBeVisible(slow);
            await expect(
              editedCell.getByRole("cell", { name: "13077", exact: true }),
            ).toHaveCount(0);
          },
        ),
    );
    expect((await readAcceptedSql()).source).toBe(humanSql);
  },
} satisfies FlowDefinition;

const turnsSchema = z.object({
  turns: z.array(
    z.object({
      receipt: z.object({
        messageId: z.string(),
        runId: z.string(),
        sequence: z.string(),
        phase: z.literal("complete"),
      }),
      toolReceipts: z.array(z.object({ id: z.string() })).min(1),
      chartArtifacts: z
        .array(z.object({ id: z.string(), resultId: z.string() }))
        .min(1),
    }),
  ),
});

export async function saveAskProjectFromShare(
  flow: Pick<FlowContext, "page" | "require" | "missing">,
) {
  const { page } = flow;
  await page
    .getByRole("dialog", { name: /^Share / })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const save = button(page, "Save as project");
  await flow.require(save, "Save as project");
  await mountedAction(flow, "save-analytics-thread-project", () =>
    save.click(),
  );
}

function askResponse(page: Page, name: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith(
        `/_agent-native/actions/${name}`,
      ),
    slow,
  );
}

async function verifyAskUploadRetry(flow: FlowContext) {
  const { page } = flow;
  await flow.open("/home");
  const filename = `phase1-ask-${uuid()}.csv`;
  const prompt = flow.name("Read the attached channel counts");
  await heroEditor(page).fill(prompt);
  expect(
    await flow.workerFixture("ask-fail-upload", { filename, armed: true }),
  ).toEqual({ armed: true });
  try {
    const [start, failure] = await Promise.all([
      askResponse(page, "start-analytics-thread"),
      askResponse(page, "upload-project-file"),
      heroArea(page)
        .locator('input[type="file"][multiple]')
        .setInputFiles({
          name: filename,
          mimeType: "text/csv",
          buffer: Buffer.from("channel,orders\nweb,14042\n"),
        }),
    ]);
    expect(start.ok()).toBe(true);
    const { intentId } = startThreadInput.parse(start.request().postDataJSON());
    const receipt = startThreadReceipt.parse(await start.json());
    const readBinding = () =>
      flow.action("get-analytics-thread-bootstrap", { intentId });
    expect(failure.status()).toBe(503);
    expect(await failure.json()).toMatchObject({
      errorCode: "attachment_storage_unavailable",
    });
    const retry = button(page, "Retry upload");
    await expect(retry).toBeVisible(slow);
    await expect(heroEditor(page)).toHaveText(prompt);
    await expect.poll(readBinding).toMatchObject({
      phase: "ready",
      receipt: {
        ...receipt,
        initialTurn: null,
        uploadSlots: receipt.uploadSlots.map((slot) => ({
          ...slot,
          state: "failed",
        })),
      },
    });
    await mountedAction(flow, "upload-project-file", () => retry.click());
    await expect.poll(readBinding).toMatchObject({
      phase: "ready",
      receipt: {
        threadId: receipt.threadId,
        projectId: receipt.projectId,
        initialTurn: null,
        uploadSlots: receipt.uploadSlots.map((slot) => ({
          ...slot,
          state: "ready",
        })),
      },
    });
    const sent = await mountedAction(flow, "submit-analytics-thread-turn", () =>
      button(page, "Send message").click(),
    );
    const turn = submitThreadTurnInput.parse(sent.request().postDataJSON());
    expect(turn).toMatchObject({
      threadId: receipt.threadId,
      prompt: {
        text: prompt,
        attachmentIds: receipt.uploadSlots.map(({ uploadId }) => uploadId),
      },
    });
    await expect(page).toHaveURL(
      new RegExp(`/thread/${receipt.threadId}(?:/|$)`),
      slow,
    );
    const stored = await flow.action<{ turns: unknown[] }>(
      "get-analytics-thread-turns",
      { threadId: receipt.threadId },
    );
    expect(stored.turns).toEqual([
      expect.objectContaining({
        receipt: expect.objectContaining({
          messageId: turn.messageId,
          sequence: "1",
        }),
      }),
    ]);
    const files = await flow.action<{ files: unknown[] }>(
      "list-project-files",
      { projectId: receipt.projectId },
    );
    expect(files.files).toEqual([
      expect.objectContaining({ filename, mimeType: "text/csv" }),
    ]);
  } finally {
    expect(
      await flow.workerFixture("ask-fail-upload", { filename, armed: false }),
    ).toEqual({ armed: false });
  }
}

async function verifyAskModelUnavailable(flow: FlowContext) {
  const { page } = flow;
  await flow.open("/home");
  const prompt = flow.name("Ask while the model is unavailable");
  await heroEditor(page).fill(prompt);
  expect(
    await flow.modelFixture("ask-model-unavailable", {
      prompt,
      unavailable: true,
    }),
  ).toEqual({ unavailable: true });
  try {
    const [response] = await Promise.all([
      askResponse(page, "start-analytics-thread"),
      button(page, "Send message").click(),
    ]);
    const { intentId } = startThreadInput.parse(
      response.request().postDataJSON(),
    );
    expect(response.status()).toBe(503);
    expect(await response.json()).toMatchObject({
      errorCode: "ai_provider_unavailable",
    });
    await expect(text(page, "Connect an AI provider to continue.")).toBeVisible(
      slow,
    );
    await expect(heroEditor(page)).toHaveText(prompt);
    await expect(page).toHaveURL(/\/home(?:\?|$)/);
    await flow.rejectAction(
      "get-analytics-thread-bootstrap",
      { intentId },
      /thread_not_found/,
    );
  } finally {
    expect(
      await flow.modelFixture("ask-model-unavailable", {
        prompt,
        unavailable: false,
      }),
    ).toEqual({ unavailable: false });
  }
}

const ask14 = {
  id: "14-ask-thread-follow-up",
  async run(flow: FlowContext) {
    const { page } = flow;
    await flow.open("/home");
    await flow.require(heroEditor(page), "Home Ask composer");
    await requireModel(flow);
    const colleague = await colleagueIdentity(flow);
    const { fixtureId, connectionId } = z
      .object({
        fixtureId: z.uuid(),
        connectionId: z.string().min(1),
      })
      .parse(
        await controlWarehouseEntitlement(flow, {
          operation: "warehouse-create-entitlement",
          colleagueEmail: colleague.user.email,
        }),
      );
    const send = button(page, "Send message");
    await flow.oracle(
      "Home Ask heading, placeholder and default choice",
      async () => {
        await expect(text(page, "What do you want to know?")).toBeVisible();
        await expect(
          heroEditor(page).locator("[data-placeholder]").first(),
        ).toHaveAttribute(
          "data-placeholder",
          "Ask a data question or describe a data app to build...",
        );
        await expect(
          heroArea(page).getByText("Ask", { exact: true }),
        ).toBeVisible();
        await expect(send).toBeDisabled();
      },
    );
    await heroEditor(page).fill(
      `Orders by channel for fixture 14 using warehouse ${connectionId}`,
    );
    await flow.transition(
      "Home Ask admits one thread before answering",
      async () => {
        await mountedAction(flow, "start-analytics-thread", () => send.click());
        await expect(page).toHaveURL(
          /\/thread\/[a-zA-Z0-9_-]+(?:\/[^/?]+)?(?:\?.*)?$/,
          slow,
        );
        await expect(text(page, "Working...").first()).toBeVisible(slow);
      },
    );
    const match = new URL(page.url()).pathname.match(/\/thread\/([^/]+)/);
    const threadId = z.string().min(1).parse(match?.[1]);
    flow.id("threadId", threadId);
    const first = ["web", "14042", "sales", "14084"];
    for (const value of first)
      await expect(text(page, value).first()).toBeVisible(slow);
    await threadEditor(page).fill("Total those channels");
    await flow.transition(
      "follow-up is admitted on the same thread",
      async () => {
        await mountedAction(flow, "submit-analytics-thread-turn", () =>
          send.click(),
        );
        expect(
          new URL(page.url()).pathname.match(/\/thread\/([^/]+)/)?.[1],
        ).toBe(threadId);
        await expect(text(page, "28126").first()).toBeVisible(slow);
      },
    );
    const summary = () =>
      flow.action<{
        binding: {
          projectId: string;
          threadId: string;
          bindingId: string;
          href: string;
        } | null;
        listed: boolean;
      }>("get-thread-summary", { threadId });
    const binding = await flow.readback(
      "two ordered persisted turns, real tool and chart ids, one unlisted project",
      async () => {
        const stored = await summary();
        expect(stored.listed).toBe(false);
        const bound = z
          .object({
            projectId: z.string(),
            threadId: z.literal(threadId),
            bindingId: z.string(),
            href: z.string(),
          })
          .parse(stored.binding);
        flow.id("projectId", bound.projectId);
        flow.id("bindingId", bound.bindingId);
        const { turns } = turnsSchema.parse(
          await flow.action("get-analytics-thread-turns", { threadId }),
        );
        expect(turns).toHaveLength(2);
        const [firstTurn, secondTurn] = z
          .tuple([
            turnsSchema.shape.turns.element,
            turnsSchema.shape.turns.element,
          ])
          .parse(turns);
        expect(BigInt(secondTurn.receipt.sequence)).toBe(
          BigInt(firstTurn.receipt.sequence) + 1n,
        );
        expect(firstTurn.receipt.runId).not.toBe(secondTurn.receipt.runId);
        const readChart = async (turn: typeof firstTurn) => {
          expect(turn.chartArtifacts).toHaveLength(1);
          const chart = z
            .object({ id: z.string(), resultId: z.string() })
            .parse(turn.chartArtifacts[0]);
          return flow.action<{ rows: unknown[][] }>(
            "get-notebook-result-page",
            { resultId: chart.resultId, threadId, page: 1 },
          );
        };
        const firstChart = await readChart(firstTurn);
        expect(firstChart.rows).toHaveLength(2);
        expect(
          firstChart.rows
            .map(([label, value]) => [label, askOrderCount(value)])
            .sort(),
        ).toEqual([
          ["sales", "14084"],
          ["web", "14042"],
        ]);
        const total = z
          .tuple([z.tuple([z.unknown()])])
          .parse((await readChart(secondTurn)).rows);
        expect(askOrderCount(total[0][0])).toBe("28126");
        for (const [index, turn] of turns.entries()) {
          flow.id(`turn-${index}`, turn.receipt.messageId);
          flow.id(`run-${index}`, turn.receipt.runId);
          for (const [tool, receipt] of turn.toolReceipts.entries())
            flow.id(`tool-${index}-${tool}`, receipt.id);
          for (const [chart, artifact] of turn.chartArtifacts.entries())
            flow.id(`chart-${index}-${chart}`, artifact.id);
        }
        return {
          ...bound,
          turnIds: [firstTurn.receipt.messageId, secondTurn.receipt.messageId],
        };
      },
    );
    const share = button(page, "Share");
    await flow.require(share, "Ask thread Share");
    await share.click();
    await page.getByRole("combobox").fill(colleague.user.name);
    await page
      .getByRole("option", { name: colleague.user.name, exact: true })
      .click();
    await mountedAction(flow, "set-analytics-thread-access", () =>
      button(page, "Add").click(),
    );
    await flow.cold(
      "authorized colleague reads both turns from the canonical mounted thread link",
      async (cold) => {
        await cold.goto(mountedHref(flow, binding.href));
        for (const value of [...first, "28126"])
          await expect(text(cold, value).first()).toBeVisible(slow);
        await expect(button(cold, "Send message")).toHaveCount(0);
      },
      "colleague",
    );
    await flow.rejecting(
      "Warehouse revocation redacts both shared answers and their traces",
      async () => {
        const entitlement = (entitled: boolean) =>
          controlWarehouseEntitlement(flow, {
            operation: entitled
              ? "warehouse-restore-entitlement"
              : "warehouse-revoke-entitlement",
            fixtureId,
          });
        try {
          expect(await entitlement(false)).toEqual({
            fixtureId,
            entitled: false,
          });
          const shared = await flow.action<{ turns: unknown[] }>(
            "get-analytics-thread-turns",
            { threadId },
            "colleague",
          );
          expect(shared.turns).toEqual(
            binding.turnIds.map((messageId) =>
              expect.objectContaining({
                receipt: expect.objectContaining({ messageId }),
                denied: true,
                answerBlocks: [],
                chartArtifacts: [],
                toolReceipts: [],
              }),
            ),
          );
          await flow.cold(
            "Reopen the shared thread after warehouse revocation",
            async (cold) => {
              await cold.goto(mountedHref(flow, binding.href));
              await expect(
                text(cold, "You don’t have access to this data."),
              ).toHaveCount(2);
              for (const value of [...first, "28126"])
                await expect(text(cold, value)).toHaveCount(0);
            },
            "colleague",
          );
        } finally {
          expect(await entitlement(true)).toEqual({
            fixtureId,
            entitled: true,
          });
        }
      },
    );
    await flow.rejectAction(
      "submit-analytics-thread-turn",
      {
        threadId,
        messageId: uuid(),
        prompt: {
          text: "Third turn",
          attachmentIds: [],
          mentions: [],
          sourceIds: [],
          approval: "ask",
        },
      },
      /thread_forbidden/,
      "colleague",
    );
    await wrongOrgIdentity(flow);
    await flow.rejectAction(
      "get-analytics-thread-turns",
      { threadId },
      /thread_not_found|thread_forbidden/,
      "denied",
    );
    const projects = () =>
      flow.action<{ projects: { id: string }[] }>("list-projects", {
        view: "active",
      });
    expect(
      (await projects()).projects.filter(({ id }) => id === binding.projectId),
    ).toHaveLength(0);
    await flow.transition(
      "Close Share and save the existing Ask project from its header",
      () => saveAskProjectFromShare(flow),
    );
    const listed = await summary();
    expect(listed.listed).toBe(true);
    expect(listed.binding?.projectId).toBe(binding.projectId);
    expect(
      (await projects()).projects.filter(({ id }) => id === binding.projectId),
    ).toHaveLength(1);
    await flow.rejecting(
      "Retry a failed CSV upload on the same Ask binding",
      () => verifyAskUploadRetry(flow),
    );
    await flow.rejecting(
      "An unavailable model preserves the Home draft before provisioning",
      () => verifyAskModelUnavailable(flow),
    );
  },
} satisfies FlowDefinition;

export function scheduleWeekday(page: Pick<Page, "getByRole">) {
  return page.getByRole("combobox", {
    name: "Day of the week",
    exact: true,
  });
}

const schedule15 = {
  id: "15-schedule-published-app",
  async run(flow: FlowContext) {
    const { page } = flow;
    const { project, releaseId: v1 } = await publishedSeed(
      flow,
      "schedule15-v1",
      "Schedule sentinel",
      15040,
    );
    const clock = await flow.workerFixture("schedule-clock", {
      projectId: project.id,
      at: "2026-11-18T07:59:00Z",
    });
    let primaryError: unknown;
    try {
      const schedules = button(page, "Scheduled runs & notifications");
      await flow.require(
        schedules,
        "Scheduled runs & notifications on the published app",
      );
      await schedules.click();
      const add = button(page, "+ Add schedule").or(
        button(page, "New scheduled run"),
      );
      await flow.require(add.first(), "New scheduled run");
      await flow.oracle("schedule empty view, tabs and filters", async () => {
        await expect(
          page.getByRole("tab", { name: "Notifications", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("tab", { name: "Run log", exact: true }),
        ).toBeVisible();
        for (const copy of [
          "All schedules",
          "Your notifications",
          "No schedules",
        ])
          await expect(text(page, copy)).toBeVisible();
      });
      await add.first().click();
      const frequency = page.getByRole("combobox", {
        name: "Frequency",
        exact: true,
      });
      const update = page.getByRole("switch", {
        name: "Update published results",
        exact: true,
      });
      const cache = page.getByRole("switch", {
        name: "Use cached SQL results",
        exact: true,
      });
      const advanced = button(page, "Advanced");
      await flow.oracle(
        "weekly Monday, Custom template and cache defaults",
        async () => {
          await expect(frequency).toHaveText("Weekly");
          await expect(scheduleWeekday(page)).toBeVisible();
          await expect(scheduleWeekday(page)).toHaveText("Monday");
          await frequency.click();
          await page
            .getByRole("option", { name: "Custom", exact: true })
            .click();
          await expect(
            page.getByRole("textbox", { name: "Cron expression", exact: true }),
          ).toHaveValue("0 0 * * 1-5");
          await expect(button(page, "Save & add notification")).toBeVisible();
          await expect(button(page, "Save run")).toBeVisible();
          await expect(advanced).toHaveText("Advanced Settings");
          await advanced.click();
          await expect(update).toHaveAttribute("aria-checked", "true");
          await expect(cache).toHaveAttribute("aria-checked", "false");
        },
      );
      const cron = page.getByRole("textbox", {
        name: "Cron expression",
        exact: true,
      });
      await flow.rejecting(
        "six-field cron is rejected before scheduling",
        async () => {
          await cron.fill("0 0 9 * * 1-5");
          await button(page, "Save run").click();
          await expect(
            text(page, "Enter a valid five-field cron expression."),
          ).toBeVisible();
        },
      );
      await cron.fill("0 9 * * 1-5");
      await page
        .getByRole("combobox", { name: "Time zone", exact: true })
        .click();
      const tz = page.getByRole("combobox", {
        name: "Search time zones",
        exact: true,
      });
      await tz.fill("Europe/Amsterdam");
      await page
        .getByRole("option", { name: "Europe/Amsterdam", exact: true })
        .click();
      const colleague = await colleagueIdentity(flow);
      const memberId = await colleagueMemberId(
        flow,
        project.id,
        colleague.user.email,
      );
      await flow.step(
        "grant the notification recipient access to the published app",
        async () => {
          const { revision } = await flow.action<{ revision: string }>(
            "list-published-app-access",
            { projectId: project.id },
          );
          const receipt = await flow.action<{ effect: string }>(
            "set-published-app-access",
            {
              projectId: project.id,
              opId: uuid(),
              expectedRevision: revision,
              change: { kind: "grant", memberId, role: "app_viewer" },
            },
          );
          expect(receipt.effect).toBe("added");
        },
      );
      const identity = z
        .object({
          at: z.literal("2026-11-18T07:59:00Z"),
          workerBuildSha: z.string(),
          runner: z.literal("analytics2-published-app-schedules"),
        })
        .parse(clock);
      if (identity.workerBuildSha !== flow.expectedSha)
        flow.unavailable("schedule worker SHA does not match candidate");
      flow.id("workerBuildSha", identity.workerBuildSha);
      await button(page, "Save & add notification").click();
      await page
        .getByRole("combobox", { name: "Recipient", exact: true })
        .fill(colleague.user.name);
      await page
        .getByRole("option", { name: colleague.user.name, exact: true })
        .click();
      await flow.transition(
        "save weekday 09:00 rule and colleague notification",
        () =>
          mountedAction(flow, "set-published-app-schedule", () =>
            button(page, "Save notification").click(),
          ),
      );
      const config = {
        cadence: { kind: "custom", cron: "0 9 * * 1-5" },
        timezone: "Europe/Amsterdam",
        target: "default",
        updatePublishedResults: true,
        useCachedSqlResults: false,
        recipients: [{ memberId, on: "both" }],
      };
      const list = () =>
        flow.action<{
          schedules: {
            scheduleId: string;
            normalizedCron: string;
            enabled: boolean;
            nextFireAt: string;
            config: unknown;
          }[];
        }>("list-published-app-schedules", { projectId: project.id });
      const scheduled = await flow.readback(
        "stored cron, time zone, next fire, recipient and cache policy",
        async () => {
          const { schedules } = await list();
          expect(schedules).toHaveLength(1);
          const schedule = z
            .object({
              scheduleId: z.string(),
              nextFireAt: z.iso.datetime(),
              config: z.unknown(),
              normalizedCron: z.string(),
              enabled: z.boolean(),
            })
            .parse(schedules[0]);
          expect(schedule.config).toEqual(config);
          expect(schedule.normalizedCron).toBe("0 9 * * 1-5");
          expect(schedule.enabled).toBe(true);
          flow.id("scheduleId", schedule.scheduleId);
          return schedule;
        },
      );
      await flow.cold(
        "cold app reopen preserves the schedule and default sentinel",
        async (cold) => {
          await cold.goto(flow.url(appPath(project.id)));
          await expect(text(cold, "Schedule sentinel 15040")).toBeVisible(slow);
          await button(cold, "Scheduled runs & notifications").click();
          await expect(text(cold, "Europe/Amsterdam")).toBeVisible();
        },
      );
      const mutation = {
        projectId: project.id,
        opId: uuid(),
        change: { kind: "create", scheduleId: uuid(), config },
      };
      await flow.rejectAction(
        "set-published-app-schedule",
        mutation,
        /schedule_forbidden|project_not_found/,
        "colleague",
      );
      await flow.rejectAction(
        "set-published-app-schedule",
        {
          ...mutation,
          change: {
            ...mutation.change,
            config: {
              ...config,
              cadence: { kind: "custom", cron: "0 0 9 * * 1-5" },
            },
          },
        },
        /invalid_cadence|cron/,
      );
      await wrongOrgIdentity(flow);
      await flow.rejectAction(
        "list-published-app-schedule-runs",
        { projectId: project.id, scheduleId: scheduled.scheduleId },
        /schedule_forbidden|project_not_found/,
        "denied",
      );
      if (scheduled.nextFireAt !== "2026-11-18T08:00:00Z")
        flow.unavailable(
          "controlled worker clock must be set to 2026-11-18T07:59:00Z",
        );
      await verifyScheduleTicks(
        flow,
        project,
        scheduled.scheduleId,
        v1,
        memberId,
      );
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      await flow
        .step("restore scheduler fixture clock", () =>
          flow.workerFixture("schedule-reset-clock", { projectId: project.id }),
        )
        .catch((error: unknown) => {
          if (!primaryError) throw error;
        });
    }
  },
} satisfies FlowDefinition;

async function verifyScheduleTicks(
  flow: FlowContext,
  project: Awaited<ReturnType<typeof seedProject>>,
  scheduleId: string,
  v1: string,
  memberId: string,
) {
  const tickSchema = z.object({
    tickId: z.string(),
    scheduleId: z.literal(scheduleId),
    dueAt: z.iso.datetime(),
    releaseId: z.string().nullable(),
    runId: z.string().nullable(),
    status: z.string(),
    cache: z.string(),
    diagnostic: z.object({ code: z.string() }).nullable(),
    deliveries: z.array(
      z.object({ memberId: z.string(), outcome: z.string() }),
    ),
  });
  const controlled = { projectId: project.id, scheduleId };
  const ticks = async () =>
    z
      .object({ runs: z.array(tickSchema) })
      .parse(await flow.action("list-published-app-schedule-runs", controlled))
      .runs;
  expect(await ticks()).toEqual([]);
  const firstDue = "2026-11-18T08:00:00Z";
  const secondDue = "2026-11-19T08:00:00Z";
  const cellId = z.string().parse(project.cells[1]?.id);
  const draft = await flow.action<{
    project: { cells: { id: string; contents: object }[] };
  }>("get-project", { projectId: project.id });
  const contents = z
    .object({ id: z.literal(cellId), kind: z.literal("sql") })
    .passthrough()
    .parse(draft.project.cells.find((cell) => cell.id === cellId)?.contents);
  const hold = await flow.workerFixture("schedule-hold-query", {
    ...controlled,
    dueAt: firstDue,
    result: 15042,
  });
  const holdId = z.object({ holdId: z.string().min(1) }).parse(hold).holdId;
  try {
    await flow.action("save-project-cell", {
      projectId: project.id,
      cellId,
      contents: { ...contents, source: "select 15084 as result" },
    });
    const sweep = async (dueAt: string) => {
      const woke = z
        .object({
          workerBuildSha: z.string(),
          runner: z.literal("analytics2-published-app-schedules"),
          dueAt: z.literal(dueAt),
        })
        .parse(
          await flow.workerFixture("schedule-sweep", { ...controlled, dueAt }),
        );
      if (woke.workerBuildSha !== flow.expectedSha)
        flow.unavailable("schedule worker SHA changed during fixture dispatch");
    };
    await sweep(firstDue);
    await sweep(firstDue);
    const running = await flow.readback(
      "two invocations claim the same single v1 tick",
      async () => {
        await expect
          .poll(async () => (await ticks()).map(({ status }) => status), slow)
          .toEqual(["running"]);
        const tick = tickSchema.parse((await ticks())[0]);
        expect(tick.dueAt).toBe(firstDue);
        expect(tick.releaseId).toBe(v1);
        flow.id("tickV1", tick.tickId);
        flow.id("runV1", z.string().parse(tick.runId));
        return tick;
      },
    );
    const { releaseId: v2 } = await publishFixture(
      (action, input) => flow.action(action, input),
      project.id,
      "schedule15-v2",
    );
    expect(v2).not.toBe(v1);
    flow.id("releaseV2", v2);
    await flow.workerFixture("schedule-release-query", {
      ...controlled,
      holdId,
    });
    await flow.readback(
      "superseded v1 result is 15042, with one delivery and no v2 cache promotion",
      async () => {
        await expect
          .poll(async () => (await ticks()).map(({ status }) => status), slow)
          .toEqual(["succeeded"]);
        const tick = tickSchema.parse((await ticks())[0]);
        expect(tick).toMatchObject({
          tickId: running.tickId,
          runId: running.runId,
          releaseId: v1,
          dueAt: firstDue,
          cache: "superseded",
        });
        expect(tick.deliveries).toEqual([{ memberId, outcome: "sent" }]);
        const runId = z.string().parse(tick.runId);
        const run = readRunAttempts(
          await flow.action("get-notebook-run", { runId }),
          runId,
        );
        const attempt = run.attempts.find(
          ({ attempt }) => attempt.cellId === cellId,
        );
        if (!attempt || attempt.state.status !== "complete")
          throw new Error("Scheduled result attempt did not finish");
        const resultId = z.string().parse(attempt.state.resultIds[0]);
        const page = readCompletedResultPage(
          await flow.action("get-notebook-result-page", { resultId, page: 1 }),
          1,
          "1",
          resultId,
        );
        expect(page.manifest.result.producer.attemptId).toBe(
          attempt.attempt.attemptId,
        );
        oneInteger(page.rows, 15042);
        flow.id("scheduleV1ResultId", resultId);
      },
    );
    await flow.workerFixture("schedule-fail-query", {
      ...controlled,
      dueAt: secondDue,
      code: "fixture_schedule_15_fault",
    });
    await sweep(secondDue);
    await flow.readback(
      "failed next tick preserves the last-good cache and sends one failure delivery",
      async () => {
        await expect
          .poll(
            async () =>
              (await ticks())
                .map(({ dueAt, status }) => [dueAt, status])
                .sort(),
            slow,
          )
          .toEqual([
            [firstDue, "succeeded"],
            [secondDue, "failed"],
          ]);
        const fault = tickSchema.parse(
          (await ticks()).find(({ dueAt }) => dueAt === secondDue),
        );
        expect(fault).toMatchObject({
          releaseId: v2,
          cache: "preserved",
          diagnostic: { code: "fixture_schedule_15_fault" },
        });
        expect(fault.deliveries).toEqual([{ memberId, outcome: "sent" }]);
        flow.id("faultTickId", fault.tickId);
      },
    );
    await flow.cold(
      "v2 still shows 15084 after the failed schedule",
      async (cold) => {
        await cold.goto(flow.url(appPath(project.id)));
        await expect(
          cold.getByRole("cell", { name: "15084", exact: true }),
        ).toBeVisible(slow);
        await expect(
          cold.getByRole("cell", { name: "15042", exact: true }),
        ).toHaveCount(0);
        await button(cold, "Scheduled runs & notifications").click();
        await cold.getByRole("tab", { name: "Run log", exact: true }).click();
        await expect(
          text(cold, "Published results kept from the last successful run."),
        ).toBeVisible();
      },
    );
  } finally {
    await flow.workerFixture("schedule-reset", { ...controlled, holdId });
  }
}

export const flows11To15 = [share11, graph12, magic13, ask14, schedule15];
