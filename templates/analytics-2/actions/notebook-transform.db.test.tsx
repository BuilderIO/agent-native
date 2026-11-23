import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import {
  loadActionsFromStaticRegistry,
  resetAppConfigForTests,
  runWithRequestContext,
} from "@agent-native/core/server";
import { act } from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

import enUS from "../app/i18n/en-US";
import { getDb } from "../server/db/index.js";
import { createNotebookWorker } from "../server/execution/notebook-worker.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { digest } from "../server/model/notebook-execution/planner.js";
import { notebookResultManifests } from "../server/model/notebook-execution/schema.js";
import { notebookRunStore } from "../server/model/notebook-execution/service.js";
import { readCurrentDraftSnapshot } from "../server/model/notebook-execution/snapshot.js";
import { createProject } from "../server/model/projects-store.js";
import { runRequestSchema } from "../shared/notebook-execution.js";
import { resultManifestSchema } from "../shared/notebook-result-contract.js";
import { pivotConfigV2Schema } from "../shared/pivot-config.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import addProjectCell from "./add-project-cell.js";
import getNotebookTransform from "./get-notebook-transform.js";
import getProject from "./get-project.js";
import openNotebookVisualizationDrill from "./open-notebook-visualization-drill.js";
import saveProjectCell from "./save-project-cell.js";
import startNotebookRun from "./start-notebook-run.js";

vi.mock(
  "../server/execution/visualization-kernel.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/execution/visualization-kernel.js")
    >()),
    executeVisualizationSql: (
      await import("../server/testing/visualization-sql-fixture.js")
    ).runVisualizationInPGlite,
  }),
);

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  useSession: () => ({ session: null }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: async () => {},
  writeClientAppState: async () => {},
}));

const actions = loadActionsFromStaticRegistry({
  "get-notebook-transform": getNotebookTransform,
  "get-project": getProject,
  "save-project-cell": saveProjectCell,
});
const owner = "pivot-owner@example.test";
const worker = createNotebookWorker(notebookRunStore);
const artifacts = new Map<string, Uint8Array>();
const blobProviderId = "pivot-fixture";
let dom:
  | Awaited<ReturnType<(typeof builtinEnvironments)["happy-dom"]["setup"]>>
  | undefined;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  resetAppConfigForTests();
  registerPrivateBlobProvider({
    id: blobProviderId,
    name: "Pivot fixture artifacts",
    isConfigured: () => true,
    put: async ({ key, data }) => {
      if (!key || artifacts.has(key))
        throw new Error("Unexpected artifact key");
      artifacts.set(key, Uint8Array.from(data));
      return {
        id: key,
        provider: blobProviderId,
        encrypted: false,
        opaque: true,
      };
    },
    read: async (handle) => {
      const data = artifacts.get(handle.id);
      if (!data) throw new Error("Missing fixture artifact");
      return { data, handle };
    },
    delete: async ({ id }) => ({
      deleted: artifacts.delete(id),
      provider: blobProviderId,
    }),
  });
  await runMigrations([...ORG_MIGRATIONS], {
    table: "pivot_test_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  dom = await builtinEnvironments["happy-dom"].setup(globalThis, {});
});

afterAll(async () => {
  await closeDbExec();
  await dom?.teardown(globalThis);
  unregisterPrivateBlobProvider(blobProviderId);
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

async function fixture(
  sql = `SELECT * FROM (VALUES ('North', 'web', 42), ('North', 'web', 8), ('North', 'store', 12), ('South', 'web', 84)) AS sales("Region", "Channel", "Amount")`,
) {
  const orgId = randomUUID();
  const memberId = randomUUID();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "Pivot workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: memberId,
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  const context = {
    caller: "frontend" as const,
    userEmail: owner,
    orgId,
    appId: "analytics-2",
  };
  const actor = <T,>(fn: () => T) =>
    runWithRequestContext(
      { userEmail: owner, orgId, authUserId: owner, isSyntheticTraffic: true },
      fn,
    );
  const project = await createProject({
    ownerEmail: owner,
    orgId,
    title: "Regional sales",
    cells: [
      {
        kind: "sql",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
        source: sql,
        databaseSchema: null,
        resultVariable: "sales",
        outputResult: true,
      },
    ],
  });
  const producer = project.cells[0];
  assert(producer);
  const projectId = project.id;
  const identity = { orgId, ownerEmail: owner, caller: context.caller };
  const run = () =>
    actor(async () => {
      const current = await readCurrentDraftSnapshot(identity, projectId);
      assert(current.status === "accepted");
      const receipt = await startNotebookRun.run(
        runRequestSchema.parse({
          requestId: randomUUID(),
          snapshot: current.value.snapshot,
          targetCellId: producer.id,
          mode: "cell-only",
          staleValues: "reject",
          cache: "bypass",
        }),
        context,
      );
      assert(receipt.status === "admitted", JSON.stringify(receipt));
      expect(await worker(identity, receipt.runId)).toBe(true);
      const attempt = receipt.attempts[0]?.attempt;
      assert(attempt);
      const results = await getDb()
        .select()
        .from(notebookResultManifests)
        .where(eq(notebookResultManifests.id, digest(attempt)))
        .limit(1);
      const result = results.at(0);
      assert(
        result?.manifest.status === "complete" ||
          result?.manifest.status === "complete-empty",
        JSON.stringify(result),
      );
      return result;
    });
  const result = await run();
  return {
    actor,
    context,
    memberId,
    projectId,
    producer,
    run,
    artifact: result,
    read: () => actor(() => getProject.run({ projectId }, context)),
    transform: (cellId: string) =>
      actor(() => getNotebookTransform.run({ projectId, cellId }, context)),
  };
}

function withText<T extends HTMLElement>(
  within: ParentNode,
  selector: string,
  label: string,
) {
  const element = Array.from(within.querySelectorAll<T>(selector)).find(
    (item) => item.textContent.trim() === label,
  );
  assert(element, `Missing ${selector} named ${label}`);
  return element;
}

function press(target: HTMLElement, key: string) {
  return act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function waitForElement<T extends Element>(find: () => T | null) {
  await act(async () => vi.waitFor(() => assert(find())));
  const element = find();
  assert(element);
  return element;
}

it("adds a bound Pivot over a complete Arrow result and restores committed Region × Channel totals on cold reopen", async () => {
  const { actor, context, projectId, producer, read, transform } =
    await fixture();
  const [
    { ProjectEditor },
    { useActionQuery },
    { AgentNativeI18nProvider },
    { QueryClient, QueryClientProvider },
    { createRoot },
    { MemoryRouter },
  ] = await Promise.all([
    import("../app/components/notebook/ProjectEditor"),
    import("@agent-native/core/client/hooks"),
    import("@agent-native/core/client/i18n"),
    import("@tanstack/react-query"),
    import("react-dom/client"),
    import("react-router"),
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  let client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.href);
    const name = url.pathname.split("/").at(-1) ?? "";
    if (name === "get-actions-batch")
      return new Response(name, { status: 404 });
    const action = actions[name];
    assert(action, `Unregistered fixture action: ${url.pathname}`);
    expect(init?.method).toBe(
      action.http === false ? undefined : (action.http?.method ?? "POST"),
    );
    const args: unknown =
      typeof init?.body === "string"
        ? JSON.parse(init.body)
        : Object.fromEntries(url.searchParams);
    return Response.json(await actor(() => action.run(args, context)));
  });

  function Notebook() {
    const { data } = useActionQuery<Awaited<ReturnType<typeof getProject.run>>>(
      "get-project",
      { projectId },
    );
    if (!data) return null;
    return (
      <ProjectEditor
        project={data.project}
        outputs={data.outputs}
        connections={[]}
        agentOpen={false}
        onRename={async () => {}}
        onSaveCell={async () => {}}
        onAddCell={async (kind, afterCellId) => {
          const added = await actor(() =>
            addProjectCell.run({ projectId, kind, afterCellId }, context),
          );
          client.setQueryData(["action", "get-project", { projectId }], {
            ...data,
            project: added.project,
          });
          return added.createdCellId;
        }}
        onDeleteCell={async () => {}}
        onRunCell={async () => {}}
        onSelectConnection={async () => {}}
      />
    );
  }

  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <MemoryRouter>
              <Notebook />
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
  const select = async (label: string, value: string) => {
    const trigger = await waitForElement(() =>
      host.querySelector<HTMLElement>(
        `[role="combobox"][aria-label="${label}"]:not([disabled])`,
      ),
    );
    await press(trigger, "Enter");
    await press(withText(document, '[role="option"]', value), "Enter");
  };
  const assertTotals = () => {
    const table = host.querySelector(
      "table[aria-label='Pivot'], [aria-label='Pivot'] table",
    );
    assert(table, host.textContent);
    const headers = Array.from(table.querySelectorAll("thead th"));
    const web = headers.findIndex(
      (header) => header.textContent.trim() === "web",
    );
    expect(web).toBeGreaterThan(0);
    const north = withText(table, "tbody th", "North").closest("tr");
    assert(north);
    expect(north.children.item(web)?.textContent).toBe("50");
    const total = withText(table, "tbody th", "Total").closest("tr");
    assert(total);
    expect(total.lastElementChild?.textContent).toBe("146");
  };

  try {
    await render();
    const more = await waitForElement(
      () =>
        Array.from(host.querySelectorAll("button")).find(
          (button) => button.textContent.trim() === "More",
        ) ?? null,
    );
    await press(more, "ArrowDown");
    await act(async () =>
      withText(document, '[role="menuitem"]', "Pivot").click(),
    );
    await act(async () =>
      vi.waitFor(() =>
        expect(host.textContent).toContain("Add a value to build your pivot."),
      ),
    );
    const loaded = await read();
    expect(loaded.project.cells.map((cell) => cell.contents.kind)).toEqual([
      "sql",
      "pivot",
    ]);
    const cell = loaded.project.cells.at(1);
    assert(cell?.contents.kind === "pivot");
    const unconfigured = await transform(cell.id);
    expect(unconfigured.result.status).toBe("unconfigured");
    const source = unconfigured.sources.find(
      (item) => item.binding.cellId === producer.id,
    );
    assert(source);

    expect(cell.contents.pivotConfig?.source).toEqual({
      cellId: producer.id,
      exportId: "result",
    });
    await select("Add row", "Region");
    await select("Add column", "Channel");
    await select("Add value", "Amount");
    await act(async () => vi.waitFor(assertTotals, { timeout: 10_000 }));

    const committed = (await read()).project.cells.find(
      (item) => item.id === cell.id,
    );
    assert(committed?.contents.kind === "pivot");
    const field = (name: string) =>
      source.fields.find((item) => item.name === name)?.fieldId;
    expect(committed.contents.pivotConfig).toMatchObject({
      revision: 3,
      source: { cellId: producer.id, exportId: "result" },
      rows: [field("Region")],
      columns: [field("Channel")],
      values: [{ fieldId: field("Amount"), aggregation: "sum" }],
      rowTotals: true,
      columnTotals: true,
    });
    expect((await transform(cell.id)).result).toMatchObject({
      status: "ready",
      source: {
        completeness: "complete",
        rowCount: 4,
        result: {
          resultId: source.binding.resultId,
          producer: { cellId: producer.id, exportId: source.binding.exportId },
        },
      },
    });

    await act(async () => root.unmount());
    client.clear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(host);
    await render();
    await act(async () => vi.waitFor(assertTotals, { timeout: 10_000 }));
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("rejects incomplete Arrow coverage, superseded drill selections, and revoked workspace access", async () => {
  const { actor, context, memberId, projectId, run, artifact, transform } =
    await fixture();
  const added = await actor(() =>
    addProjectCell.run({ kind: "pivot", projectId }, context),
  );
  const cellId = added.createdCellId;
  const cell = added.project.cells.find((item) => item.id === cellId);
  assert(cell?.contents.kind === "pivot");
  const initial = pivotConfigV2Schema.parse(cell.contents.pivotConfig);
  const source = (await transform(cellId)).sources.at(0);
  const amount = source?.fields.find((field) => field.name === "Amount");
  assert(source && amount);
  await actor(() =>
    saveProjectCell.run(
      {
        projectId,
        cellId,
        expectedUpdatedAt: cell.updatedAt,
        contents: {
          ...cell.contents,
          pivotConfig: {
            ...initial,
            revision: initial.revision + 1,
            values: [
              {
                measureId: "sum-amount",
                fieldId: amount.fieldId,
                aggregation: "sum",
              },
            ],
          },
        },
      },
      context,
    ),
  );
  const first = (await transform(cellId)).result;
  assert(
    "columns" in first &&
      first.status === "ready" &&
      first.visualizationResultId,
  );
  const value = first.rows.at(0)?.values.at(0);
  assert(value?.kind === "value" && value.selectionId);
  const drill = {
    projectId,
    cellId,
    visualizationResultId: first.visualizationResultId,
    selectionId: value.selectionId,
    mode: "view-data" as const,
    requestId: randomUUID(),
  };

  for (const reason of ["coverage_unverified", "sampled"] as const) {
    await getDb()
      .update(notebookResultManifests)
      .set({
        manifest: resultManifestSchema.parse({
          status: "incomplete",
          result: artifact.manifest.result,
          fields: artifact.manifest.fields,
          reason,
          verifiedRowCount: "2",
        }),
      })
      .where(eq(notebookResultManifests.id, artifact.id));
    expect(await transform(cellId)).toEqual({
      sources: [],
      result: { status: "blocked", reason: "result_incomplete" },
    });
  }

  const rerun = await run();
  const current = await transform(cellId);
  expect(current.result).toMatchObject({
    status: "ready",
    source: { result: { resultId: rerun.id } },
  });
  expect(
    await actor(() => openNotebookVisualizationDrill.run(drill, context)),
  ).toEqual({
    status: "stale",
    reason: "result_superseded",
  });
  const replacement = current.sources.at(0);
  assert(replacement);
  expect(replacement.binding.resultId).not.toBe(source.binding.resultId);
  expect(replacement.fields).toEqual(source.fields);

  await getDb().delete(orgMembers).where(eq(orgMembers.id, memberId));
  await expect(transform(cellId)).rejects.toMatchObject({
    errorCode: "workspace_membership_required",
    statusCode: 403,
  });
});

it("binds a Single value to the complete result and restores its aggregate and row selections", async () => {
  const samples = Array.from({ length: 120 }, (_, index) => `(${index + 1})`);
  const { actor, context, projectId, producer, read, transform, memberId } =
    await fixture(
      `SELECT CAST("Amount" AS DOUBLE PRECISION) AS "Amount", CASE WHEN "Amount" % 2 = 0 THEN 'even' ELSE 'odd' END AS "Group", CASE WHEN "Amount" = 120 THEN DATE '2026-04-01' ELSE DATE '2026-01-01' END AS "Month" FROM (VALUES ${samples.join(", ")}) AS sales("Amount") ORDER BY "Amount"`,
    );
  const added = await actor(() =>
    addProjectCell.run({ kind: "metric", projectId }, context),
  );
  const cellId = added.createdCellId;
  const initial = await transform(cellId);
  expect(initial.result).toMatchObject({
    status: "ready",
    kind: "metric",
    source: {
      rowCount: 120,
      result: { producer: { cellId: producer.id, exportId: "result" } },
    },
    field: { name: "Amount", type: "number" },
    aggregation: "sum",
    value: 7260,
  });
  const source = initial.sources.at(0);
  assert(source);
  const group = source.fields.find(({ name }) => name === "Group");
  const month = source.fields.find(({ name }) => name === "Month");
  assert(group && month);
  const save = async (
    revision: number,
    selection: {
      mode: "row" | "aggregate";
      aggregation: "max" | null;
      row: number;
      fieldId: string | null;
    },
  ) => {
    const cell = (await read()).project.cells.find(({ id }) => id === cellId);
    assert(cell?.contents.kind === "metric");
    const metricConfig = {
      version: 1 as const,
      revision,
      source: { cellId: producer.id, exportId: "result" },
      title: "Quarterly sales",
      format: "number" as const,
      ...selection,
    };
    const contents = { ...cell.contents, metricConfig };
    await actor(() =>
      saveProjectCell.run(
        { projectId, cellId, contents, expectedUpdatedAt: cell.updatedAt },
        context,
      ),
    );
    expect(
      (await read()).project.cells.find(({ id }) => id === cellId)?.contents,
    ).toMatchObject({ metricConfig });
    return (await transform(cellId)).result;
  };
  expect(
    await save(1, {
      mode: "aggregate",
      aggregation: "max",
      row: 0,
      fieldId: null,
    }),
  ).toMatchObject({ aggregation: "max", value: 120 });
  expect(
    await save(2, { mode: "row", aggregation: null, row: 0, fieldId: null }),
  ).toMatchObject({ aggregation: null, value: 1 });
  expect(
    await save(3, { mode: "row", aggregation: null, row: -1, fieldId: null }),
  ).toMatchObject({ aggregation: null, value: 120 });
  expect(
    await save(4, {
      mode: "aggregate",
      aggregation: null,
      row: 0,
      fieldId: group.fieldId,
    }),
  ).toMatchObject({ aggregation: "count-distinct", value: 2 });
  expect(
    await save(5, {
      mode: "aggregate",
      aggregation: null,
      row: 0,
      fieldId: month.fieldId,
    }),
  ).toMatchObject({ aggregation: "max", value: "2026-04-01" });
  expect(
    await save(6, {
      mode: "aggregate",
      aggregation: null,
      row: 0,
      fieldId: "removed-field",
    }),
  ).toEqual({ status: "blocked", reason: "visualization_binding_invalid" });
  expect(
    await actor(() =>
      getNotebookTransform.run(
        { projectId, cellId, mode: "metric", expectedConfigRevision: 5 },
        context,
      ),
    ),
  ).toEqual({
    sources: [],
    result: { status: "stale", reason: "notebook_conflict" },
  });
  await getDb().delete(orgMembers).where(eq(orgMembers.id, memberId));
  await expect(transform(cellId)).rejects.toMatchObject({
    errorCode: "workspace_membership_required",
    statusCode: 403,
  });
});

it("leaves Single value blank for an empty sum or an unbound source", async () => {
  const { actor, context, projectId, transform } = await fixture(
    'SELECT CAST(0 AS BIGINT) AS "Amount" WHERE false',
  );
  const empty = await actor(() =>
    addProjectCell.run({ kind: "metric", projectId }, context),
  );
  expect((await transform(empty.createdCellId)).result).toMatchObject({
    status: "empty",
    kind: "metric",
    source: { rowCount: 0 },
    aggregation: "sum",
    value: null,
  });

  const source = empty.project.cells[0];
  assert(source);
  const unbound = await actor(() =>
    addProjectCell.run(
      { kind: "metric", projectId, beforeCellId: source.id },
      context,
    ),
  );
  expect(await transform(unbound.createdCellId)).toEqual({
    sources: [],
    result: { status: "unconfigured" },
  });
});
