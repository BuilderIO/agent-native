import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { CellDraft } from "../../app/lib/model/contracts.js";
import type { EntitlementInput } from "./fixtures/provider-entitlement.js";
import type { FlowContext } from "./runtime.js";
import { EvidenceFailure } from "./verdict.js";

type EntitlementSqlCell = {
  label?: string;
  source: string;
  dataConnectionId: string | null;
  resultVariable: string;
};

export async function createWarehouseEntitlementProject(
  flow: { action: (name: string, input: object) => Promise<unknown> },
  title: string,
  cells: EntitlementSqlCell[],
) {
  const starterCells: CellDraft[] = cells.map((cell) => ({
    ...cell,
    kind: "sql",
    label: cell.label ?? null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    ...(cell.dataConnectionId === null && { connectionMode: "dataframes" }),
    databaseSchema: null,
    outputResult: true,
  }));
  const created = await flow.action("create-project", {
    requestId: randomUUID(),
    title,
    starter: {
      kind: "cells",
      cells: starterCells,
    },
  });
  return z.object({ id: z.string().min(1) }).parse(created).id;
}

const fixtureError = z.object({
  error: z
    .string()
    .regex(/^Fixture (?:UI capability|action [a-z-]+) HTTP \d{3}$/),
});

export async function controlWarehouseEntitlement(
  flow: Pick<FlowContext, "providerFixtureUrl" | "unavailable">,
  input: EntitlementInput,
) {
  const address = flow.providerFixtureUrl;
  if (!address)
    flow.unavailable("Scoped warehouse entitlement fixture required");
  const response = await fetch(new URL("/phase1/provider-control", address), {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(90_000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = fixtureError.safeParse(body);
    throw new EvidenceFailure(
      `Warehouse entitlement fixture ${input.operation} HTTP ${response.status}${detail.success ? ` (${detail.data.error})` : ""}`,
    );
  }
  return body;
}
