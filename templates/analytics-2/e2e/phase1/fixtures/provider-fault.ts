import { z } from "zod";

import type { WarehouseFixtureBridge } from "../../../shared/phase1-warehouse-fixture.js";
import { FixtureControlError } from "./control-server.js";

export const warehouseFixtureProject = "builder-io-qa";

const scope = z.object({
  connectionId: z.string().regex(/^wconn1:[a-f0-9]{64}$/),
});
const patch = z.strictObject({
  bigquery: z.enum(["ok", "empty", "error"]).optional(),
  bigqueryStorageFailure: z.boolean().optional(),
});

const submission = z.object({
  jobReference: z.object({ jobId: z.string().min(1) }),
});

export const warehouseFaultInput = z.discriminatedUnion("operation", [
  scope.extend({ operation: z.literal("warehouse-fault-open") }).strict(),
  scope
    .extend({ operation: z.literal("warehouse-fault-patch"), patch })
    .strict(),
  scope.extend({ operation: z.literal("warehouse-fault-calls") }).strict(),
  scope.extend({ operation: z.literal("warehouse-fault-close") }).strict(),
]);

export type WarehouseFaultInput = z.infer<typeof warehouseFaultInput>;

export function createWarehouseFaultControl() {
  type Call = {
    host: "storage" | "bigquery";
    method: string;
    path: string;
    jobId?: string;
  };
  const projectId = warehouseFixtureProject;
  const fixtures = new Map<
    string,
    {
      scenario: {
        projectId: string;
        bigquery: "ok" | "empty" | "error";
        bigqueryStorageFailure: boolean;
      };
      calls: Call[];
    }
  >();
  const projectPath = `/projects/${projectId}`;
  const datasets = `${projectPath}/datasets`;
  const query = `${projectPath}/queries`;
  const bridge: WarehouseFixtureBridge = {
    rest(connectionId, { method = "GET", path, query: params, body }) {
      const fixture = fixtures.get(connectionId);
      if (!fixture) return;
      if (
        method === "POST" &&
        (path === query || path === `${projectPath}/jobs`)
      ) {
        const jobId = submission.safeParse(body).data?.jobReference.jobId;
        fixture.calls.push({
          host: "bigquery",
          method,
          path,
          ...(jobId && { jobId }),
        });
      }
      const metadataOnly =
        typeof params === "object" && params !== null && "fields" in params;
      if (method === "GET" && path.startsWith(`${query}/`) && !metadataOnly)
        fixture.calls.push({ host: "bigquery", method, path });
      if (method !== "GET" || path !== datasets) return;
      fixture.calls.push({ host: "bigquery", method, path });
      if (fixture.scenario.bigquery === "error")
        return {
          response: {
            ok: false,
            status: 503,
            json: { error: { errors: [{ reason: "backendError" }] } },
          },
        };
      if (fixture.scenario.bigquery === "empty")
        return {
          response: {
            ok: true,
            status: 200,
            json: { kind: "bigquery#datasetList", datasets: [] },
          },
        };
    },
    beforeStorageRead(connectionId, project, jobId) {
      const fixture = fixtures.get(connectionId);
      if (
        project !== projectId ||
        !fixture?.scenario.bigqueryStorageFailure ||
        !fixture.calls.some(
          (call) => call.method === "POST" && call.jobId === jobId,
        )
      )
        return;
      fixture.scenario.bigqueryStorageFailure = false;
      fixture.calls.push({
        host: "storage",
        method: "GET",
        path: `${query}/${jobId}`,
        jobId,
      });
      throw Object.assign(new Error("Injected warehouse Storage read error"), {
        code: 14,
      });
    },
  };
  async function control(input: WarehouseFaultInput) {
    const fixture = fixtures.get(input.connectionId);
    if (input.operation === "warehouse-fault-open") {
      if (fixture)
        throw new FixtureControlError(
          "Warehouse fault fixture is already open",
          409,
        );
      const scenario = {
        projectId,
        bigquery: "ok" as const,
        bigqueryStorageFailure: false,
      };
      fixtures.set(input.connectionId, { scenario, calls: [] });
      return scenario;
    }
    if (!fixture)
      throw new FixtureControlError(
        "Unknown scoped warehouse fault fixture",
        404,
      );
    if (input.operation === "warehouse-fault-calls") return fixture.calls;
    if (input.operation === "warehouse-fault-close") {
      fixtures.delete(input.connectionId);
      return { closed: true };
    }
    const { bigquery, bigqueryStorageFailure } = input.patch;
    if (bigquery !== undefined) fixture.scenario.bigquery = bigquery;
    if (bigqueryStorageFailure !== undefined)
      fixture.scenario.bigqueryStorageFailure = bigqueryStorageFailure;
    return fixture.scenario;
  }
  return { bridge, control };
}
