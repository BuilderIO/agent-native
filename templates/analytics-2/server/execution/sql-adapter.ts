import { fail, type ActionContractError } from "@agent-native/core/action";
import { z } from "zod";

import {
  cancelWarehouseJob,
  executeQueryPage,
  executeStorageQueryPage,
  type WarehouseQueryInput,
} from "../model/data-connection-provider.js";
import { digest } from "../model/notebook-execution/planner.js";
import type { BigQuerySource } from "./source-resolver.js";
import type { CompiledSql } from "./sql-compiler.js";

const responseSchema = z.object({
  response: z.object({
    ok: z.boolean(),
    status: z.number(),
    truncated: z.boolean(),
    json: z.unknown(),
  }),
});
const providerErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z
      .array(
        z.object({
          reason: z.string().optional(),
          message: z.string().optional(),
        }),
      )
      .optional(),
  }),
});
const errorResultSchema = z.object({
  reason: z.string(),
  message: z.string().optional(),
});
const dryRunSchema = z.object({
  status: z.object({ errorResult: errorResultSchema.optional() }).optional(),
  jobReference: z.object({
    projectId: z.string(),
    location: z.string().regex(/^[a-z][a-z0-9-]*$/i),
  }),
  statistics: z.object({
    query: z.object({ statementType: z.string() }),
  }),
});
const jobSchema = z.object({
  jobReference: z.object({
    projectId: z.string(),
    jobId: z.string(),
    location: z.string(),
  }),
  status: z.object({
    state: z.enum(["PENDING", "RUNNING", "DONE"]),
    errorResult: errorResultSchema.optional(),
  }),
});
export class ProviderOutcomeUnknown extends Error {}
export class WarehouseExecutionError extends Error {
  constructor(
    code: string,
    readonly provider?: { reason: string; message?: string | undefined },
  ) {
    super(code);
  }
}

export class RestartWarehouseSpool extends Error {
  constructor(readonly diagnostic: ActionContractError) {
    super("warehouse_storage_fallback", { cause: diagnostic });
  }
}

function queryConfig(
  source: BigQuerySource,
  compiled: CompiledSql,
  cache: "reuse" | "bypass",
) {
  return {
    query: source.normalizeSql?.(compiled.sql) ?? compiled.sql,
    useLegacySql: false,
    useQueryCache: cache === "reuse",
    ...(source.defaultDatasetId
      ? {
          defaultDataset: {
            projectId: source.projectId,
            datasetId: source.defaultDatasetId,
          },
        }
      : {}),
    ...(source.maximumBytesBilled
      ? { maximumBytesBilled: source.maximumBytesBilled }
      : {}),
    ...(compiled.parameters.length
      ? {
          parameterMode: "NAMED",
          queryParameters: compiled.parameters,
        }
      : {}),
  };
}

function rejectedQuery(status: number, json: unknown) {
  const error = providerErrorSchema.safeParse(json).data?.error;
  return new WarehouseExecutionError(
    status === 401 || status === 403
      ? "warehouse_query_denied"
      : "warehouse_query_failed",
    {
      reason: error?.errors?.[0]?.reason ?? String(status),
      message: error?.message ?? error?.errors?.[0]?.message,
    },
  );
}

export async function bigQueryLocation(
  source: BigQuerySource,
  compiled: CompiledSql,
  cache: "reuse" | "bypass",
) {
  const unreadable = () =>
    fail("BigQuery could not validate the query. Try running it again.", {
      errorCode: "warehouse_query_validation_unreadable",
      statusCode: 502,
    });
  let raw: unknown;
  try {
    raw = await source.runtime.executeRequest({
      provider: "bigquery",
      method: "POST",
      path: `/projects/${encodeURIComponent(source.projectId)}/jobs`,
      body: {
        configuration: {
          dryRun: true,
          query: queryConfig(source, compiled, cache),
        },
      },
      maxBytes: 2_000_000,
      timeoutMs: 30_000,
    });
  } catch {
    return unreadable();
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.response.truncated) return unreadable();
  const response = parsed.data.response;
  if (!response.ok) throw rejectedQuery(response.status, response.json);
  const jobError = dryRunSchema.pick({ status: true }).safeParse(response.json)
    .data?.status?.errorResult;
  if (jobError)
    throw new WarehouseExecutionError(
      jobError.reason === "accessDenied"
        ? "warehouse_query_denied"
        : "warehouse_query_failed",
      jobError,
    );
  const job = dryRunSchema.safeParse(response.json);
  if (!job.success || job.data.jobReference.projectId !== source.projectId)
    return unreadable();
  if (job.data.statistics.query.statementType !== "SELECT")
    fail(
      "Run one read-only SELECT query. Multi-statement and write queries are not allowed.",
      {
        errorCode: "bigquery_read_only_query_required",
        statusCode: 400,
      },
    );
  return job.data.jobReference.location;
}

export function prepareBigQuery(
  source: BigQuerySource,
  compiled: CompiledSql,
  submissionId: string,
  cache: "reuse" | "bypass",
) {
  const config = queryConfig(source, compiled, cache);
  const fingerprint = digest([
    submissionId,
    source.projectId,
    source.location,
    source.generation,
    config,
  ]);
  const job = {
    projectId: source.projectId,
    location: source.location,
    jobId: `analytics2_${fingerprint}`,
  };
  return { config, fingerprint, job };
}

type Operation = ReturnType<typeof prepareBigQuery>;

export function bigQueryAdapter(source: BigQuerySource, operation: Operation) {
  const { runtime, projectId, storage } = source;
  const { job, config } = operation;
  const path = `/projects/${encodeURIComponent(projectId)}/jobs`;
  const probe = () =>
    runtime.executeRequest({
      provider: "bigquery",
      method: "GET",
      path: `${path}/${job.jobId}`,
      query: { location: job.location },
      maxBytes: 2_000_000,
      timeoutMs: 30_000,
    });
  async function readJob(request: Promise<unknown>, submitting = false) {
    let raw: unknown;
    try {
      raw = await request;
    } catch (error) {
      throw new ProviderOutcomeUnknown("warehouse_job_unreadable", {
        cause: error,
      });
    }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.response.truncated)
      throw new ProviderOutcomeUnknown("warehouse_job_unreadable");
    const { response } = parsed.data;
    if ((!submitting && response.status === 404) || response.status === 409)
      return null;
    if (!response.ok) {
      if ([400, 401, 403, 404, 422].includes(response.status))
        throw rejectedQuery(response.status, response.json);
      throw new ProviderOutcomeUnknown("warehouse_job_unreadable");
    }
    const value = jobSchema.safeParse(response.json);
    if (
      !value.success ||
      value.data.jobReference.jobId !== job.jobId ||
      value.data.jobReference.projectId !== job.projectId ||
      value.data.jobReference.location.toLowerCase() !==
        job.location.toLowerCase()
    )
      throw new ProviderOutcomeUnknown("warehouse_job_identity_mismatch");
    return value.data.status;
  }
  return {
    async start(recovered: boolean) {
      if (recovered) {
        const saved = await readJob(probe());
        if (saved) return saved;
      }
      let result;
      try {
        result = await readJob(
          runtime.executeRequest({
            provider: "bigquery",
            method: "POST",
            path,
            body: { jobReference: job, configuration: { query: config } },
            maxBytes: 2_000_000,
            timeoutMs: 30_000,
          }),
          true,
        );
      } catch (error) {
        if (!(error instanceof ProviderOutcomeUnknown)) throw error;
      }
      result ??= await readJob(probe());
      if (!result)
        throw new ProviderOutcomeUnknown("warehouse_job_outcome_unknown");
      return result;
    },
    page(input: Omit<WarehouseQueryInput, "job" | "query" | "parameters">) {
      const next = { ...input, job };
      return storage
        ? executeStorageQueryPage(runtime, {
            ...storage,
            projectId,
            input: next,
          })
        : executeQueryPage(runtime, projectId, next);
    },
    spoolPage(
      transport: "storage" | "rest",
      offset: number,
      cursor: string | null,
    ) {
      if (transport === "rest") {
        return executeQueryPage(runtime, projectId, {
          job,
          ...(cursor ? { pageToken: cursor } : {}),
        });
      }
      if (!storage) throw new Error("Storage transport is unavailable");
      return executeStorageQueryPage(runtime, {
        ...storage,
        projectId,
        input: { job, rowOffset: offset },
        onStorageFallback(error) {
          throw new RestartWarehouseSpool(error);
        },
      });
    },
    cancel: (operation: "request" | "status") =>
      cancelWarehouseJob(runtime, job, operation),
  };
}
