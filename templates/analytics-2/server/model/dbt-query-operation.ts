import { createHash, randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  dbtMetricQuerySelectionSchema,
  type DbtSemanticClient,
} from "../lib/dbt-semantic-protocol.js";
import { mutateDbtQueryOperation } from "./dbt-query-operation-store.js";

/** Internal server binding from an authorised saved cell, never action input. */
export type DbtQueryBinding = Readonly<{
  ownerEmail: string;
  orgId: string;
  projectId: string;
  cellId: string;
  connectionId: string;
  revision: string;
  selection: z.input<typeof dbtMetricQuerySelectionSchema>;
}>;
type Authority = {
  binding: DbtQueryBinding;
  client: Pick<DbtSemanticClient, "startQuery" | "readQueryPage">;
};
const resultPageSchema = z.object({
  pageNum: z.number().int().positive(),
  fields: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(
    z.record(
      z.string(),
      z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    ),
  ),
  sql: z.string().nullable(),
});
const stateSchema = z.object({
  id: z.string(),
  bindingHash: z.string(),
  reservation: z.string().nullable(),
  expiresAt: z.number(),
  status: z.enum(["starting", "running", "complete", "unknown", "failed"]),
  queryId: z.string().nullable(),
  nextPage: z.number().int().positive(),
  totalPages: z.number().int().nonnegative().nullable(),
  schemaHash: z.string().nullable(),
  lastPage: resultPageSchema.nullable(),
});
type State = z.infer<typeof stateSchema>;
type QueryPage = Awaited<ReturnType<DbtSemanticClient["readQueryPage"]>>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bindingHash = (binding: DbtQueryBinding) =>
  hash([
    binding.ownerEmail,
    binding.orgId,
    binding.projectId,
    binding.cellId,
    binding.connectionId,
    binding.revision,
    dbtMetricQuerySelectionSchema.parse(binding.selection),
  ]);
function conflict(): never {
  return fail(
    "This metric query changed or is already running. Reload before continuing.",
    {
      statusCode: 409,
      errorCode: "dbt_query_operation_changed",
    },
  );
}
function expired(): never {
  return fail(
    "This metric query expired before it finished. Start it again to continue.",
    {
      statusCode: 409,
      errorCode: "dbt_query_operation_changed",
      details: { reason: "expired" },
    },
  );
}
function presentation(state: State) {
  return {
    operationId: state.id,
    status: state.status,
    hasNextPage: state.status === "running",
    nextPage: state.nextPage,
    totalPages: state.totalPages,
  };
}
const retryableRead = new Set([
  "dbt_semantic_unavailable",
  "dbt_semantic_timeout",
  "dbt_semantic_cancelled",
  "dbt_semantic_rate_limited",
]);

/**
 * Internal coordinator, not an action. authorize loads the owned saved cell,
 * SL capability, grant/credential revision and current AI policy before making
 * a fresh client. One page per call, no hidden retry, polling or aggregate cap.
 */
export async function coordinateDbtQuery(
  request:
    | { mode: "start" }
    | { mode: "read"; operationId: string; pageNum: number },
  authorize: () => Promise<Authority>,
) {
  const authority = await authorize();
  const binding = structuredClone(authority.binding);
  const selection = dbtMetricQuerySelectionSchema.parse(binding.selection);
  const expected = bindingHash(binding);
  const key = `analytics-2:dbt-query:${hash([binding.ownerEmail, binding.orgId, binding.projectId, binding.cellId])}`;
  const reservation = randomUUID();
  let replay = false;
  const state = stateSchema.parse(
    await mutateDbtQueryOperation(binding, key, (raw) => {
      const previous = raw === null ? null : stateSchema.parse(raw);
      if (previous?.reservation) conflict();
      if (request.mode === "start") {
        // Unknown POSTs and interrupted starts never dispatch a second query.
        if (
          previous &&
          ["starting", "running", "unknown"].includes(previous.status)
        )
          conflict();
        return {
          id: randomUUID(),
          bindingHash: expected,
          reservation,
          expiresAt: Date.now() + 60 * 60 * 1000,
          status: "starting",
          queryId: null,
          nextPage: 1,
          totalPages: null,
          schemaHash: null,
          lastPage: null,
        } satisfies State;
      }
      if (
        !previous ||
        previous.id !== request.operationId ||
        previous.bindingHash !== expected
      )
        conflict();
      if (previous.expiresAt <= Date.now()) expired();
      if (!previous.queryId) conflict();
      if (
        previous.lastPage?.pageNum === request.pageNum &&
        ["running", "complete"].includes(previous.status)
      ) {
        replay = true;
        return previous;
      }
      if (
        previous.status !== "running" ||
        previous.nextPage !== request.pageNum
      )
        conflict();
      return { ...previous, reservation };
    }),
  );
  const assertReservation = (raw: Record<string, unknown> | null) => {
    const current = stateSchema.parse(raw);
    if (
      current.id !== state.id ||
      current.reservation !== reservation ||
      current.bindingHash !== expected
    )
      conflict();
    return current;
  };
  async function reauthorize() {
    const fresh = await authorize();
    if (Date.now() >= state.expiresAt) expired();
    if (bindingHash(fresh.binding) !== expected) conflict();
    return fresh.client;
  }
  if (replay) {
    await reauthorize();
    return {
      ...presentation(state),
      sourceConnectionId: binding.connectionId,
      page: state.lastPage,
    };
  }
  let dispatchAttempted = false;
  try {
    const client = await reauthorize();
    let next: State;
    let page: QueryPage | undefined;
    dispatchAttempted = true;
    if (request.mode === "start") {
      const result = await client.startQuery(selection);
      next = {
        ...state,
        reservation: null,
        status: "running",
        queryId: result.queryId,
      };
    } else {
      page = await client.readQueryPage({
        queryId: state.queryId!,
        pageNum: state.nextPage,
      });
      if (page.queryId !== state.queryId || page.pageNum !== state.nextPage)
        conflict();
      if (page.status === "SUCCESSFUL" && "fields" in page) {
        const schemaHash = hash(page.fields);
        if (
          (state.schemaHash !== null && state.schemaHash !== schemaHash) ||
          (state.totalPages !== null && state.totalPages !== page.totalPages)
        )
          conflict();
        next = {
          ...state,
          reservation: null,
          schemaHash,
          totalPages: page.totalPages,
          lastPage: resultPageSchema.parse({
            pageNum: page.pageNum,
            fields: page.fields,
            rows: page.rows,
            sql: page.sql,
          }),
          nextPage: state.nextPage + 1,
          status: state.nextPage >= page.totalPages ? "complete" : "running",
        };
      } else next = { ...state, reservation: null };
    }
    await reauthorize();
    await mutateDbtQueryOperation(binding, key, (raw) => {
      assertReservation(raw);
      return next;
    });
    // Only local operation references cross the server boundary.
    const result =
      page?.status === "SUCCESSFUL" && "fields" in page
        ? {
            pageNum: page.pageNum,
            fields: page.fields,
            rows: page.rows,
            sql: page.sql,
          }
        : null;
    return {
      ...presentation(next),
      sourceConnectionId: binding.connectionId,
      page: result,
    };
  } catch (error) {
    const safe = (error && typeof error === "object" ? error : {}) as {
      errorCode?: string;
      details?: { queryOutcome?: string };
    };
    try {
      await mutateDbtQueryOperation(binding, key, (raw) => {
        const current = assertReservation(raw);
        const uncertain =
          request.mode === "start" &&
          dispatchAttempted &&
          safe.details?.queryOutcome !== "not-dispatched";
        return {
          ...current,
          reservation: null,
          status: uncertain
            ? "unknown"
            : request.mode === "read" && retryableRead.has(safe.errorCode ?? "")
              ? "running"
              : "failed",
        };
      });
    } catch {
      // The provider/transport error is the useful one. If the reservation was
      // lost to another writer, the CAS above conflicts; do not replace the
      // original error with that bookkeeping conflict.
    }
    throw error;
  }
}
