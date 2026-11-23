import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { z } from "zod";

import {
  runRequestSchema,
  type RunRequest,
} from "../../shared/notebook-execution.js";
import {
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_DATA_SOURCE_NAME,
} from "../../shared/sample-data-contract.js";
import { connectionDialog, field } from "../daily/setup.helpers.js";
import {
  warehouseFaultInput,
  warehouseFixtureProject,
  type WarehouseFaultInput,
} from "./fixtures/provider-fault.js";
import type { FlowContext } from "./runtime.js";
import { EvidenceFailure, UnavailableFixture } from "./verdict.js";

export const project = warehouseFixtureProject;
export const warehouseName = "Parity Warehouse 01";

export type Source = { id: string; name: string };
export const demo: Source = {
  id: SAMPLE_DATA_SOURCE_ID,
  name: SAMPLE_DATA_SOURCE_NAME,
};

export function warehouseOption(page: Page, source: Source) {
  return page.getByRole("menuitemradio", { name: source.name, exact: true });
}

const idSchema = z.string().min(1);
const connectionSchema = z.object({
  id: idSchema,
  name: idSchema,
  type: idSchema,
  isDraft: z.boolean(),
  isDefault: z.boolean(),
});
const customerRows = (prefix: "us" | "east", offset: number) =>
  Array.from({ length: 100 }, (_, index) => [
    `${prefix}-${String(index + 1).padStart(3, "0")}`,
    index + 1 + offset,
  ]);

export const catalogFixtures = [
  { dataset: "a2_parity_q_us", rows: customerRows("us", 0) },
  { dataset: "a2_parity_q_east", rows: customerRows("east", 1000) },
];

export const warehouseQueries = [
  {
    sql: "select * from `builder-io-qa.a2_parity.customers` order by customer_id limit 50",
    dimensions: [50, 5] as const,
    rows: null,
  },
  {
    sql: "select channel, count(*) as n from `builder-io-qa.a2_parity.orders` group by channel order by channel",
    dimensions: [3, 2] as const,
    rows: [
      ["partner", 6667],
      ["sales", 6667],
      ["web", 6666],
    ],
  },
  {
    sql: "select c.segment, count(*) as n from `builder-io-qa.a2_parity.orders` o join `builder-io-qa.a2_parity.customers` c on o.customer_id = c.customer_id group by c.segment order by c.segment",
    dimensions: [3, 2] as const,
    rows: [
      ["enterprise", 6640],
      ["mid-market", 6680],
      ["smb", 6680],
    ],
  },
  {
    sql: "select event_type, count(*) as n from `builder-io-qa.a2_parity_east.events` group by event_type order by event_type",
    dimensions: [4, 2] as const,
    rows: [
      ["click", 1250],
      ["purchase", 1250],
      ["signup", 1250],
      ["view", 1250],
    ],
  },
];

export async function connections(flow: FlowContext) {
  return z
    .object({ connections: z.array(connectionSchema) })
    .parse(await flow.action("list-data-connections")).connections;
}

export async function refreshWarehouseCatalog(
  flow: Pick<FlowContext, "action">,
  connectionId: string,
) {
  const { nativeRevision } = z
    .object({ nativeRevision: z.string().min(1) })
    .parse(await flow.action("get-data-connection-form", { id: connectionId }));
  return flow.action("refresh-data-browser-catalog", {
    connectionId,
    revision: nativeRevision,
  });
}

export function warehouseCellRunIntent({
  requestId,
  snapshot,
  targetCellId,
  cache,
}: {
  requestId: string;
  snapshot: RunRequest["snapshot"];
  targetCellId: string;
  cache: RunRequest["cache"];
}): RunRequest {
  return runRequestSchema.parse({
    requestId,
    snapshot,
    mode: "cell-only",
    targetCellId,
    cache,
    staleValues: "reject",
  });
}

export async function readWarehouseCredential(flow: FlowContext) {
  if (!flow.bqKeyFile)
    flow.unavailable("BigQuery service-account fixture requires --bq-key-file");
  let credential: string;
  try {
    credential = await readFile(flow.bqKeyFile, "utf8");
    z.object({
      type: z.literal("service_account"),
      client_email: z.email(),
      private_key: z.string().includes("PRIVATE KEY"),
    }).parse(JSON.parse(credential));
  } catch {
    return flow.unavailable(
      "BigQuery service-account fixture is unreadable or invalid",
    );
  }
  return credential;
}

export async function fillCredential(dialog: Locator, value: string) {
  const input = field(dialog, /^Service account configuration/);
  try {
    await input.evaluate((element, secret) => {
      if (!(element instanceof HTMLInputElement))
        throw new Error("Missing masked credential input");
      if (element.type !== "password")
        throw new Error("Credential input is unmasked");
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setValue) throw new Error("Credential input is not editable");
      setValue.call(element, secret);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  } catch {
    throw new Error("Could not fill the masked BigQuery credential field");
  }
}

export function invalidCredential(credential: string): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    ...JSON.parse(credential),
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

export async function openBigQuery(flow: FlowContext) {
  await flow.open("/data");
  const warehouse = flow.page.getByText("Warehouse", { exact: true });
  await flow.require(warehouse, "Warehouse settings entry");
  await warehouse.click();
  const add = flow.page.getByRole("button", {
    name: /^(\+ Connection|Add (?:a )?data connection|Connect your data)/,
  });
  await flow.require(add, "Add data connection");
  await add.click();
  const dialog = connectionDialog(flow.page);
  const bigquery = dialog.getByRole("button", {
    name: "Google BigQuery",
    exact: true,
  });
  await flow.require(bigquery, "BigQuery setup");
  await bigquery.click();
  return dialog;
}

export async function saveWarehouse(
  page: Page,
  dialog: Locator,
  name: string,
  credential: string,
  datasets = "",
) {
  await field(dialog, /^Name/).fill(name);
  await field(dialog, /^Project ID/).fill(project);
  if (datasets) await field(dialog, /^Datasets/).fill(datasets);
  await fillCredential(dialog, credential);
  const [saved] = await Promise.all([
    page.waitForResponse((res) => {
      const path = new URL(res.url()).pathname;
      return (
        res.request().method() === "POST" &&
        (path.endsWith("/actions/create-workspace-warehouse-form") ||
          path.endsWith("/actions/save-data-connection"))
      );
    }),
    dialog
      .getByRole("button", { name: "Create connection", exact: true })
      .click(),
  ]);
  await expectWarehouseFixtureSaved(saved, datasets);
  await expect(dialog).toBeHidden();
}

const datasetUnverified = z.object({
  errorCode: z.literal("data_connection_dataset_unverified"),
  details: z.object({ field: z.literal("datasetNames"), dataset: z.string() }),
});
const warehouseActionError = z.object({
  error: z.string().min(1),
  errorCode: z.string().regex(/^[a-z][a-z0-9_]{0,100}$/),
});

export async function expectWarehouseFixtureSaved(
  saved: Pick<Response, "ok" | "status" | "json">,
  datasets: string,
) {
  if (saved.ok()) return;
  const reason = `Warehouse Create HTTP ${saved.status()}`;
  const body: unknown = await saved.json().catch(() => {
    throw new EvidenceFailure(`${reason}: unreadable error response`);
  });
  const typed = warehouseActionError.safeParse(body);
  if (!typed.success)
    throw new EvidenceFailure(`${reason}: invalid action error body`);
  if (saved.status() === 400 && datasets) {
    const rejected = datasetUnverified.safeParse(body);
    if (
      rejected.success &&
      datasets
        .split(",")
        .some((name) => name.trim() === rejected.data.details.dataset)
    ) {
      throw new UnavailableFixture(
        `BigQuery fixture dataset ${rejected.data.details.dataset} is unavailable to the service account`,
      );
    }
  }
  expect(saved.ok(), `${reason}: ${typed.data.errorCode}`).toBe(true);
}

export async function fixtureWarehouse(
  flow: FlowContext,
  datasets = "",
): Promise<Source> {
  const name = datasets ? `Parity source ${datasets}` : warehouseName;
  const existing = (await connections(flow)).find(
    (entry) =>
      entry.name === name && entry.type === "bigquery" && !entry.isDraft,
  );
  if (existing) return existing;
  const credential = await readWarehouseCredential(flow);
  const dialog = await openBigQuery(flow);
  try {
    await saveWarehouse(flow.page, dialog, name, credential, datasets);
  } finally {
    if (await dialog.isVisible()) {
      await fillCredential(dialog, "");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }
  }
  const saved = (await connections(flow)).find((entry) => entry.name === name);
  if (!saved) throw new Error("Warehouse fixture did not persist");
  return saved;
}

export function catalogFixtureWarehouse(flow: FlowContext) {
  return fixtureWarehouse(
    flow,
    catalogFixtures.map(({ dataset }) => dataset).join(", "),
  );
}

const providerCalls = z.array(
  z.object({
    host: idSchema,
    method: idSchema,
    path: idSchema,
    jobId: idSchema.optional(),
  }),
);
const providerScenario = z.object({
  projectId: z.literal(project),
  bigquery: z.enum(["ok", "empty", "error", "denied", "slow"]),
  bigqueryStorageFailure: z.boolean().optional(),
});

export async function warehouseFaultFixture(
  flow: Pick<FlowContext, "providerFixtureUrl" | "unavailable">,
  connectionId: string,
) {
  if (!flow.providerFixtureUrl)
    return flow.unavailable(
      "Warehouse fault checks require the isolated provider fixture",
    );
  const url = new URL(flow.providerFixtureUrl);
  const signedInFixture = Symbol();
  async function requestDaily(path: string, data?: object) {
    const response = await fetch(new URL(`/__control/${path}`, url), {
      signal: AbortSignal.timeout(5_000),
      ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
    });
    if (!response.ok) {
      if (path === "scenario" && !data && response.status === 404) {
        const missing = z
          .object({ errorCode: z.literal("fixture_route_not_found") })
          .safeParse(await response.json().catch(() => undefined));
        if (missing.success) return signedInFixture;
      }
      throw new Error(`Warehouse fixture ${path} HTTP ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }
  async function requestSignedIn(input: WarehouseFaultInput) {
    const response = await fetch(new URL("/phase1/provider-control", url), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(warehouseFaultInput.parse(input)),
      signal: AbortSignal.timeout(10_000),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const code = z.object({ errorCode: z.string() }).safeParse(result)
        .data?.errorCode;
      if (
        input.operation === "warehouse-fault-open" &&
        ((response.status === 404 && code === "fixture_route_not_found") ||
          (response.status === 400 && code === "fixture_invalid_request"))
      ) {
        return flow.unavailable(
          "Warehouse fault checks require the Storage and catalog fault provider fixture",
        );
      }
      throw new EvidenceFailure(
        `Warehouse fixture ${input.operation} HTTP ${response.status}`,
      );
    }
    return result;
  }
  const dailyScenario = await requestDaily("scenario");
  const daily = dailyScenario !== signedInFixture;
  const before = providerScenario.safeParse(
    daily
      ? dailyScenario
      : await requestSignedIn({
          operation: "warehouse-fault-open",
          connectionId,
        }),
  );
  if (
    !before.success ||
    before.data.bigquery !== "ok" ||
    before.data.bigqueryStorageFailure === true
  )
    return flow.unavailable(
      "Warehouse fault fixture is not serving the ready parity project scenario",
    );
  return {
    async calls() {
      return providerCalls.parse(
        await (daily
          ? requestDaily("calls")
          : requestSignedIn({
              operation: "warehouse-fault-calls",
              connectionId,
            })),
      );
    },
    async patch(patch: {
      bigquery?: "ok" | "empty" | "error";
      bigqueryStorageFailure?: boolean;
    }) {
      const changed = providerScenario.parse(
        await (daily
          ? requestDaily("scenario", patch)
          : requestSignedIn({
              operation: "warehouse-fault-patch",
              connectionId,
              patch,
            })),
      );
      expect(changed).toMatchObject(patch);
    },
    async [Symbol.asyncDispose]() {
      if (!daily)
        z.object({ closed: z.literal(true) }).parse(
          await requestSignedIn({
            operation: "warehouse-fault-close",
            connectionId,
          }),
        );
    },
  };
}
