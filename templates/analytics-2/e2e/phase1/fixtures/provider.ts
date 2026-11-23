import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { z } from "zod";

import { FixtureControlError, startControlServer } from "./control-server.js";
import { openProviderActionClient } from "./provider-action.js";
import {
  entitlementControl,
  entitlementInput,
} from "./provider-entitlement.js";
import {
  warehouseFaultInput,
  warehouseFixtureProject,
} from "./provider-fault.js";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    "storage-state": { type: "string" },
    "bq-key-file": { type: "string" },
  },
});
const storageState = values["storage-state"];
const key = values["bq-key-file"];
if (!storageState || !key)
  throw new Error("Pass --storage-state and --bq-key-file");
const credential = await readFile(key, "utf8");
let keyConfig: unknown;
try {
  keyConfig = JSON.parse(credential);
} catch {
  throw new Error("The BigQuery fixture key file is not JSON");
}
const project = z
  .object({ project_id: z.literal(warehouseFixtureProject) })
  .safeParse(keyConfig);
if (!project.success)
  throw new Error("The BigQuery fixture key must use the QA project");
const projectId = project.data.project_id;

const { action, dispose } = await openProviderActionClient(
  values["base-url"] ?? "",
  storageState,
);

const port = 4411;
const entitlement = entitlementControl({ action, credential, projectId });
const server = await startControlServer(
  port,
  "/phase1/provider-control",
  z.discriminatedUnion("operation", [entitlementInput, warehouseFaultInput]),
  async (input) => {
    if (!("connectionId" in input)) return entitlement(input);
    const response = await fetch(
      "http://127.0.0.1:4412/phase1/worker-control",
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok)
      throw new FixtureControlError(
        `Warehouse worker control HTTP ${response.status}`,
        response.status === 404 || response.status === 409
          ? response.status
          : 502,
      );
    return z
      .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
      .parse(await response.json());
  },
);
console.log(`Phase 1 provider fixture at http://127.0.0.1:${port}`);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => void dispose());
  });
}
