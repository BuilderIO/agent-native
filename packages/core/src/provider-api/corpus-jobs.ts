import { randomUUID } from "node:crypto";

import { z } from "zod";

import { defineAction } from "../action.js";
import { getCredentialContext } from "../server/request-context.js";
import {
  appendProviderCorpusJobHits,
  createProviderCorpusJob,
  deleteProviderCorpusJob,
  getProviderCorpusJob,
  getProviderCorpusJobHits,
  listProviderCorpusJobs,
  updateProviderCorpusJob,
  type ProviderCorpusJobRecord,
  type ProviderCorpusJobStatus,
} from "./corpus-jobs-store.js";
import type { ProviderApiMethod, ProviderApiRequestArgs } from "./index.js";
import { getStagedDatasetRows } from "./staged-datasets-store.js";

type ProviderCorpusRuntime = {
  executeRequest(args: ProviderApiRequestArgs): Promise<unknown>;
};

export interface CreateProviderCorpusJobActionOptions {
  appId: string;
  getRuntime: () => ProviderCorpusRuntime;
}

const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const ProviderRequestSchema = z.object({
  provider: z.string().min(1).describe("Configured provider API id."),
  method: MethodSchema.default("GET").describe("HTTP method to use."),
  path: z.string().min(1).describe("Provider API path or allowed full URL."),
  query: z.unknown().optional().describe("Optional query parameters."),
  headers: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
  auth: z.enum(["default", "none"]).default("default"),
  connectionId: z.string().trim().min(1).optional(),
  accountId: z.string().optional(),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).optional(),
  maxBytes: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(4 * 1024 * 1024)
    .optional(),
});

const PaginationSchema = z.object({
  itemsPath: z
    .string()
    .optional()
    .describe("Dot-path to records in each page, e.g. records.calls."),
  nextCursorPath: z
    .string()
    .optional()
    .describe("Dot-path to the next cursor in each response."),
  cursorPath: z.string().optional().describe("Alias for nextCursorPath."),
  cursorParam: z
    .string()
    .optional()
    .describe("Query parameter that receives the next cursor."),
  cursorBodyPath: z
    .string()
    .optional()
    .describe("Request body path that receives the next cursor."),
  pageParam: z
    .string()
    .optional()
    .describe("Query parameter for page-number pagination."),
  startPage: z.coerce.number().int().min(0).optional(),
  offsetParam: z
    .string()
    .optional()
    .describe("Query parameter for offset pagination."),
  startOffset: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().min(1).optional(),
  maxPages: z.coerce
    .number()
    .int()
    .min(1)
    .max(2_000)
    .optional()
    .describe("Overall page cap for the job. Default 500."),
});

const BatchSchema = z.object({
  items: z
    .array(z.unknown())
    .max(10_000)
    .optional()
    .describe("Input records or ids to process in batches."),
  inputDatasetId: z
    .string()
    .optional()
    .describe("Optional staged dataset id to read input records from."),
  inputValuePath: z
    .string()
    .optional()
    .describe("Dot-path to extract the provider id/value from each input row."),
  batchSize: z.coerce.number().int().min(1).max(100).optional(),
  itemBodyPath: z
    .string()
    .optional()
    .describe("Dot-path in request body where the current batch array goes."),
  itemQueryParam: z
    .string()
    .optional()
    .describe("Query parameter where the current batch goes."),
  responseItemsPath: z
    .string()
    .optional()
    .describe("Dot-path to records in each batch response."),
});

const SearchSchema = z.object({
  query: z.string().optional().describe("Phrase to search for."),
  queries: z.array(z.string()).max(50).optional(),
  terms: z
    .array(z.string())
    .max(50)
    .optional()
    .describe("Terms for allTerms/anyTerm search."),
  regex: z.string().optional(),
  regexFlags: z.string().optional(),
  matchMode: z.enum(["query", "allTerms", "anyTerm"]).optional(),
  caseSensitive: z.boolean().optional(),
  textPaths: z
    .array(z.string())
    .max(100)
    .optional()
    .describe("Only search these dot-paths. Omit to search text recursively."),
  idPaths: z.array(z.string()).max(100).optional(),
  metadataPaths: z.array(z.string()).max(100).optional(),
  contextChars: z.coerce.number().int().min(20).max(1_000).optional(),
  maxHits: z.coerce.number().int().min(1).max(10_000).optional(),
  maxHitsPerItem: z.coerce.number().int().min(1).max(100).optional(),
  maxFieldsPerItem: z.coerce.number().int().min(1).max(50_000).optional(),
});

const LimitsSchema = z.object({
  pageBudget: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Pages to process in this action call. Default 25."),
  batchBudget: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Batches to process in this action call. Default 25."),
  runtimeMs: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(110_000)
    .optional()
    .describe("Wall-clock budget for this action call. Default 90000."),
  itemBudget: z.coerce
    .number()
    .int()
    .min(1)
    .max(200_000)
    .optional()
    .describe("Response records to search in this action call."),
  maxHits: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .describe("Stored hit cap for the whole job. Default comes from search."),
});

const ProviderCorpusJobSchema = z.object({
  operation: z
    .enum(["start", "continue", "status", "results", "list", "delete"])
    .default("start"),
  jobId: z
    .string()
    .optional()
    .describe("Existing job id for continue/status/results/delete."),
  name: z.string().optional().describe("Human-readable job name."),
  mode: z.enum(["paginated-search", "batch-search"]).optional(),
  request: ProviderRequestSchema.optional(),
  pagination: PaginationSchema.optional(),
  batch: BatchSchema.optional(),
  search: SearchSchema.optional(),
  limits: LimitsSchema.optional(),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Results/list offset."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .optional()
    .describe("Results/list limit."),
});

const ProviderCorpusJobReadSchema = z.object({
  operation: z.enum(["list", "status", "results"]).default("list"),
  jobId: z.string().optional().describe("Existing job id for status/results."),
  offset: z.coerce.number().int().min(0).optional().describe("Results offset."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .optional()
    .describe("Results/list limit."),
});

type ProviderCorpusJobArgs = z.infer<typeof ProviderCorpusJobSchema>;
type ProviderCorpusJobReadArgs = z.infer<typeof ProviderCorpusJobReadSchema>;
type ProviderRequest = z.infer<typeof ProviderRequestSchema>;
type PaginationConfig = z.infer<typeof PaginationSchema>;
type BatchConfig = z.infer<typeof BatchSchema>;
type SearchConfig = z.infer<typeof SearchSchema>;
type LimitsConfig = z.infer<typeof LimitsSchema>;

interface SearchHit {
  id: string | null;
  idPath: string | null;
  itemIndex: number;
  path: string;
  kind: string;
  query: string;
  match: string;
  snippet: string;
  matchedTerms?: string[];
  metadata?: Record<string, unknown>;
  pageIndex?: number;
  pageItemIndex?: number;
  batchIndex?: number;
  batchItemIndex?: number;
}

interface SearchPageResult {
  searchedItems: number;
  matchedItems: number;
  totalHits: number;
  storedHits: SearchHit[];
}

interface ProviderBodyResult {
  body: unknown;
  quota?: { retryAt: string; retryAfterMs: number; reason: string };
}

interface MatchRecord {
  kind: string;
  query: string;
  index: number;
  endIndex?: number;
  match: string;
  matchedTerms?: string[];
  snippet?: string;
}

const DEFAULT_PAGE_BUDGET = 25;
const DEFAULT_BATCH_BUDGET = 25;
const DEFAULT_RUNTIME_MS = 90_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_OVERALL_MAX_PAGES = 500;
const DEFAULT_MAX_HITS = 500;

export function createProviderCorpusJobAction(
  options: CreateProviderCorpusJobActionOptions,
) {
  return defineAction({
    description:
      "Create, continue, inspect, list, read results from, or delete a durable provider corpus search job. " +
      "Use this for broad provider searches, cross-source joins, transcript/message/ticket/issue/document scans, batch endpoint walks, and absence-sensitive questions that may exceed one tool call. " +
      "The job is generic: paginated-search walks any paginated provider endpoint; batch-search walks a supplied id/record list or staged dataset through any provider endpoint by injecting each batch into a query param or request body path. " +
      "Every provider request still goes through provider-api-request credentials, host allow-listing, SSRF blocking, secret redaction, and provider quota cooldown. " +
      "When status is paused or quota_wait, call operation=continue with the jobId after the indicated time/budget. Report coverage counts, pagination status, and any remaining gaps.",
    schema: ProviderCorpusJobSchema,
    http: false,
    run: async (args) => runProviderCorpusJobAction(args, options),
  });
}

export function createProviderCorpusJobReadAction(
  options: Pick<CreateProviderCorpusJobActionOptions, "appId">,
) {
  return defineAction({
    description:
      "Read provider corpus job status and stored results for the current user. " +
      "This read-only companion is for UI polling and status surfaces; it cannot start or continue provider requests.",
    schema: ProviderCorpusJobReadSchema,
    http: { method: "GET" },
    readOnly: true,
    agentTool: false,
    run: async (args) => runProviderCorpusJobReadAction(args, options),
  });
}

async function runProviderCorpusJobAction(
  args: ProviderCorpusJobArgs,
  options: CreateProviderCorpusJobActionOptions,
) {
  const ctx = getCredentialContext();
  if (!ctx)
    throw new Error("No authenticated context for provider-corpus-job.");

  if (args.operation === "list") {
    const jobs = await listProviderCorpusJobs({
      appId: options.appId,
      ownerEmail: ctx.userEmail,
      limit: args.limit,
    });
    return { jobs: jobs.map(jobSummary), total: jobs.length };
  }

  if (args.operation === "start") {
    const job = await startJob(args, options.appId, ctx.userEmail);
    return continueJob(job, args.limits, options.getRuntime());
  }

  const jobId = args.jobId?.trim();
  if (!jobId) throw new Error(`${args.operation} requires jobId.`);

  if (args.operation === "delete") {
    const deleted = await deleteProviderCorpusJob({
      id: jobId,
      appId: options.appId,
      ownerEmail: ctx.userEmail,
    });
    if (!deleted) {
      throw new Error(
        `Provider corpus job ${jobId} not found or belongs to another owner/app.`,
      );
    }
    return { deleted: true, jobId };
  }

  const job = await getProviderCorpusJob({
    id: jobId,
    appId: options.appId,
    ownerEmail: ctx.userEmail,
  });
  if (!job) {
    throw new Error(
      `Provider corpus job ${jobId} not found or belongs to another owner/app.`,
    );
  }

  if (args.operation === "status") return jobStatus(job);
  if (args.operation === "results") {
    const hits = await getProviderCorpusJobHits({
      jobId,
      appId: options.appId,
      ownerEmail: ctx.userEmail,
      offset: args.offset,
      limit: args.limit,
    });
    return {
      ...jobStatus(job),
      hits,
      offset: args.offset ?? 0,
      limit: args.limit ?? 100,
    };
  }
  if (args.operation === "continue") {
    return continueJob(job, args.limits, options.getRuntime());
  }

  throw new Error(`Unsupported provider corpus operation ${args.operation}.`);
}

async function runProviderCorpusJobReadAction(
  args: ProviderCorpusJobReadArgs,
  options: Pick<CreateProviderCorpusJobActionOptions, "appId">,
) {
  const ctx = getCredentialContext();
  if (!ctx)
    throw new Error("No authenticated context for provider corpus jobs.");

  if (args.operation === "list") {
    const jobs = await listProviderCorpusJobs({
      appId: options.appId,
      ownerEmail: ctx.userEmail,
      limit: args.limit,
    });
    return { jobs: jobs.map(jobStatus), total: jobs.length };
  }

  const jobId = args.jobId?.trim();
  if (!jobId) throw new Error(`${args.operation} requires jobId.`);

  const job = await getProviderCorpusJob({
    id: jobId,
    appId: options.appId,
    ownerEmail: ctx.userEmail,
  });
  if (!job) {
    throw new Error(
      `Provider corpus job ${jobId} not found or belongs to another owner/app.`,
    );
  }

  if (args.operation === "status") return jobStatus(job);
  const hits = await getProviderCorpusJobHits({
    jobId,
    appId: options.appId,
    ownerEmail: ctx.userEmail,
    offset: args.offset,
    limit: args.limit,
  });
  return {
    ...jobStatus(job),
    hits,
    offset: args.offset ?? 0,
    limit: args.limit ?? 100,
  };
}

async function startJob(
  args: ProviderCorpusJobArgs,
  appId: string,
  ownerEmail: string,
): Promise<ProviderCorpusJobRecord> {
  if (!args.mode) throw new Error("start requires mode.");
  if (!args.request) throw new Error("start requires request.");
  const search = args.search ?? {};
  if (!hasSearchNeedle(search)) {
    throw new Error(
      "start requires search.query, search.queries, search.terms, or search.regex.",
    );
  }
  if (args.mode === "paginated-search" && !args.pagination) {
    throw new Error("paginated-search requires pagination.");
  }
  if (args.mode === "batch-search") {
    if (!args.batch) throw new Error("batch-search requires batch config.");
    if (!args.batch.itemBodyPath && !args.batch.itemQueryParam) {
      throw new Error(
        "batch-search requires batch.itemBodyPath or batch.itemQueryParam.",
      );
    }
    if (!args.batch.items?.length && !args.batch.inputDatasetId) {
      throw new Error("batch-search requires batch.items or inputDatasetId.");
    }
  }

  const id = args.jobId?.trim() || `pcj_${randomUUID().replace(/-/g, "")}`;
  const request = cleanRequest(args.request);
  const checkpoint =
    args.mode === "batch-search"
      ? { nextIndex: 0, sourceItemCount: null }
      : {
          pageIndex: 0,
          cursor: null,
          pageNumber: args.pagination?.startPage ?? 1,
          offset: args.pagination?.startOffset ?? 0,
          lastCursor: null,
          stoppedReason: null,
        };

  return createProviderCorpusJob({
    id,
    appId,
    ownerEmail,
    name: args.name?.trim() || id,
    mode: args.mode,
    status: "paused",
    provider: request.provider,
    request: request as unknown as Record<string, unknown>,
    pagination:
      (args.pagination as Record<string, unknown> | undefined) ?? null,
    batch: (args.batch as Record<string, unknown> | undefined) ?? null,
    search: search as Record<string, unknown>,
    limits: (args.limits as Record<string, unknown> | undefined) ?? {},
    checkpoint,
  });
}

async function continueJob(
  job: ProviderCorpusJobRecord,
  overrideLimits: LimitsConfig | undefined,
  runtime: ProviderCorpusRuntime,
) {
  if (job.status === "completed") return jobStatus(job);

  const limits = normalizeLimits({
    ...(job.limits as LimitsConfig),
    ...(overrideLimits ?? {}),
  });
  await updateProviderCorpusJob({
    id: job.id,
    appId: job.appId,
    ownerEmail: job.ownerEmail,
    status: "running",
    error: null,
    nextResumeAt: null,
  });

  try {
    const refreshed = await getProviderCorpusJob({
      id: job.id,
      appId: job.appId,
      ownerEmail: job.ownerEmail,
    });
    if (!refreshed)
      throw new Error(`Provider corpus job ${job.id} disappeared.`);
    const next =
      refreshed.mode === "batch-search"
        ? await runBatchSearch(refreshed, limits, runtime)
        : await runPaginatedSearch(refreshed, limits, runtime);
    const hits = await getProviderCorpusJobHits({
      jobId: next.id,
      appId: next.appId,
      ownerEmail: next.ownerEmail,
      limit: 25,
    });
    return {
      ...jobStatus(next),
      sampleHits: hits,
      nextAction: nextAction(next),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed =
      (await updateProviderCorpusJob({
        id: job.id,
        appId: job.appId,
        ownerEmail: job.ownerEmail,
        status: "failed",
        error: message,
      })) ?? job;
    return { ...jobStatus(failed), nextAction: nextAction(failed) };
  }
}

async function runPaginatedSearch(
  job: ProviderCorpusJobRecord,
  limits: Required<LimitsConfig>,
  runtime: ProviderCorpusRuntime,
): Promise<ProviderCorpusJobRecord> {
  const startedAt = Date.now();
  const pagination = normalizePagination(job.pagination);
  const request = job.request as ProviderRequest;
  const search = job.search as SearchConfig;
  const checkpoint = { ...job.checkpoint };
  const maxPages = pagination.maxPages ?? DEFAULT_OVERALL_MAX_PAGES;
  let pageIndex = numberValue(checkpoint.pageIndex, 0);
  let cursor = valueOrNull(checkpoint.cursor);
  let pageNumber = numberValue(
    checkpoint.pageNumber,
    pagination.startPage ?? 1,
  );
  let offset = numberValue(checkpoint.offset, pagination.startOffset ?? 0);
  let pagesThisCall = 0;
  let itemsThisCall = 0;
  let current = job;

  while (
    pagesThisCall < limits.pageBudget &&
    pageIndex < maxPages &&
    itemsThisCall < limits.itemBudget &&
    Date.now() - startedAt < limits.runtimeMs
  ) {
    const pageRequest = buildPaginatedRequest(request, pagination, {
      pageIndex,
      cursor,
      pageNumber,
      offset,
    });
    const provider = await callProvider(runtime, pageRequest);
    if (provider.quota) {
      return pauseForQuota(
        current,
        {
          ...checkpoint,
          pageIndex,
          cursor,
          pageNumber,
          offset,
        },
        provider.quota,
      );
    }

    const items = extractItemsArray(provider.body, pagination.itemsPath, false);
    const nextCursorPath = pagination.nextCursorPath || pagination.cursorPath;
    const nextCursor = nextCursorPath
      ? valueOrNull(getAtPath(provider.body, nextCursorPath))
      : null;
    const searchResult = searchItems(items, search, {
      baseItemIndex: current.itemsProcessed,
      maxStoredHits: Math.max(0, limits.maxHits - current.storedHits),
      pageIndex,
    });
    const storedHits = searchResult.storedHits.map((hit) => hitToRecord(hit));
    await appendProviderCorpusJobHits({
      jobId: job.id,
      startIndex: current.storedHits,
      hits: storedHits,
    });

    pagesThisCall++;
    itemsThisCall += searchResult.searchedItems;
    const nextCheckpoint: Record<string, unknown> = {
      ...checkpoint,
      pageIndex: pageIndex + 1,
      cursor: nextCursor,
      pageNumber,
      offset,
      lastCursor: nextCursor,
      stoppedReason: null,
    };

    let status: ProviderCorpusJobStatus = "paused";
    let stoppedReason: string | null = null;
    if (items.length === 0) {
      status = "completed";
      stoppedReason = "empty-page";
    } else if (nextCursorPath) {
      if (!nextCursor) {
        status = "completed";
        stoppedReason = "no-next-cursor";
      } else if (cursor !== null && String(nextCursor) === String(cursor)) {
        status = "completed";
        stoppedReason = "repeated-cursor";
      } else {
        cursor = nextCursor;
      }
    } else if (pagination.pageParam) {
      pageNumber += 1;
      nextCheckpoint.pageNumber = pageNumber;
    } else if (pagination.offsetParam) {
      const step = pagination.pageSize || items.length;
      offset += step;
      nextCheckpoint.offset = offset;
      if (pagination.pageSize && items.length < pagination.pageSize) {
        status = "completed";
        stoppedReason = "short-page";
      }
    } else {
      status = "completed";
      stoppedReason = "single-page";
    }

    if (pageIndex + 1 >= maxPages && status !== "completed") {
      status = "completed";
      stoppedReason = "max-pages";
    }

    nextCheckpoint.stoppedReason = stoppedReason;
    current =
      (await updateProviderCorpusJob({
        id: job.id,
        appId: job.appId,
        ownerEmail: job.ownerEmail,
        status,
        checkpoint: nextCheckpoint,
        pagesProcessed: current.pagesProcessed + 1,
        itemsProcessed: current.itemsProcessed + searchResult.searchedItems,
        matchedItems: current.matchedItems + searchResult.matchedItems,
        totalHits: current.totalHits + searchResult.totalHits,
        storedHits: current.storedHits + storedHits.length,
        error: null,
        nextResumeAt: null,
      })) ?? current;

    pageIndex += 1;
    if (status === "completed") return current;
  }

  return pauseForBudget(current, {
    ...checkpoint,
    pageIndex,
    cursor,
    pageNumber,
    offset,
    stoppedReason: "budget",
  });
}

async function runBatchSearch(
  job: ProviderCorpusJobRecord,
  limits: Required<LimitsConfig>,
  runtime: ProviderCorpusRuntime,
): Promise<ProviderCorpusJobRecord> {
  const startedAt = Date.now();
  const batch = normalizeBatch(job.batch);
  const request = job.request as ProviderRequest;
  const search = job.search as SearchConfig;
  const sourceItems = await loadBatchSourceItems(job, batch);
  const totalSourceItems = sourceItems.length;
  let nextIndex = numberValue(job.checkpoint.nextIndex, 0);
  let batchesThisCall = 0;
  let itemsThisCall = 0;
  let current = job;

  while (
    nextIndex < totalSourceItems &&
    batchesThisCall < limits.batchBudget &&
    itemsThisCall < limits.itemBudget &&
    Date.now() - startedAt < limits.runtimeMs
  ) {
    const slice = sourceItems.slice(nextIndex, nextIndex + batch.batchSize);
    const values = slice
      .map((item) =>
        batch.inputValuePath ? getAtPath(item, batch.inputValuePath) : item,
      )
      .filter((value) => value !== undefined && value !== null);
    if (values.length === 0) {
      nextIndex += slice.length || batch.batchSize;
      continue;
    }

    const batchRequest = buildBatchRequest(request, batch, values);
    const provider = await callProvider(runtime, batchRequest);
    if (provider.quota) {
      return pauseForQuota(
        current,
        {
          ...job.checkpoint,
          nextIndex,
          sourceItemCount: totalSourceItems,
        },
        provider.quota,
      );
    }

    const items = extractItemsArray(
      provider.body,
      batch.responseItemsPath,
      true,
    );
    const searchResult = searchItems(items, search, {
      baseItemIndex: current.itemsProcessed,
      maxStoredHits: Math.max(0, limits.maxHits - current.storedHits),
      batchIndex: current.batchesProcessed,
    });
    const storedHits = searchResult.storedHits.map((hit) => hitToRecord(hit));
    await appendProviderCorpusJobHits({
      jobId: job.id,
      startIndex: current.storedHits,
      hits: storedHits,
    });

    batchesThisCall++;
    itemsThisCall += searchResult.searchedItems;
    nextIndex += slice.length;
    const status: ProviderCorpusJobStatus =
      nextIndex >= totalSourceItems ? "completed" : "paused";

    current =
      (await updateProviderCorpusJob({
        id: job.id,
        appId: job.appId,
        ownerEmail: job.ownerEmail,
        status,
        checkpoint: {
          ...job.checkpoint,
          nextIndex,
          sourceItemCount: totalSourceItems,
          stoppedReason: status === "completed" ? "completed" : "budget",
        },
        batchesProcessed: current.batchesProcessed + 1,
        itemsProcessed: current.itemsProcessed + searchResult.searchedItems,
        matchedItems: current.matchedItems + searchResult.matchedItems,
        totalHits: current.totalHits + searchResult.totalHits,
        storedHits: current.storedHits + storedHits.length,
        error: null,
        nextResumeAt: null,
      })) ?? current;

    if (status === "completed") return current;
  }

  return pauseForBudget(current, {
    ...job.checkpoint,
    nextIndex,
    sourceItemCount: totalSourceItems,
    stoppedReason: "budget",
  });
}

async function pauseForQuota(
  job: ProviderCorpusJobRecord,
  checkpoint: Record<string, unknown>,
  quota: { retryAt: string; retryAfterMs: number; reason: string },
): Promise<ProviderCorpusJobRecord> {
  return (
    (await updateProviderCorpusJob({
      id: job.id,
      appId: job.appId,
      ownerEmail: job.ownerEmail,
      status: "quota_wait",
      checkpoint,
      error: `Provider quota exhausted. Retry after ${quota.retryAt}.`,
      nextResumeAt: parseRetryAt(quota.retryAt, quota.retryAfterMs),
    })) ?? job
  );
}

async function pauseForBudget(
  job: ProviderCorpusJobRecord,
  checkpoint: Record<string, unknown>,
): Promise<ProviderCorpusJobRecord> {
  return (
    (await updateProviderCorpusJob({
      id: job.id,
      appId: job.appId,
      ownerEmail: job.ownerEmail,
      status: "paused",
      checkpoint,
      error: null,
      nextResumeAt: null,
    })) ?? job
  );
}

async function callProvider(
  runtime: ProviderCorpusRuntime,
  request: ProviderRequest,
): Promise<ProviderBodyResult> {
  const raw = (await runtime.executeRequest(cleanRequest(request))) as Record<
    string,
    unknown
  >;
  const response = raw.response as Record<string, unknown> | undefined;
  if (!response) {
    return { body: raw };
  }
  const quota = readQuota(response);
  if (quota) return { body: null, quota };
  if (response.ok !== true) {
    const status = response.status ?? "unknown";
    const detail = response.text ?? response.json ?? response.statusText ?? "";
    throw new Error(
      `Provider request failed (${status}): ${stringifyBrief(detail, 500)}`,
    );
  }
  return {
    body:
      response.json ??
      (typeof response.text === "string" ? tryParseJson(response.text) : null),
  };
}

async function loadBatchSourceItems(
  job: ProviderCorpusJobRecord,
  batch: Required<BatchConfig>,
): Promise<unknown[]> {
  if (batch.items.length > 0) return batch.items;
  if (!batch.inputDatasetId) return [];
  return getStagedDatasetRows({
    id: batch.inputDatasetId,
    appId: job.appId,
    ownerEmail: job.ownerEmail,
  });
}

function cleanRequest(request: ProviderRequest): ProviderApiRequestArgs {
  return {
    provider: request.provider,
    method: request.method as ProviderApiMethod,
    path: request.path,
    query: request.query,
    headers: request.headers,
    body: request.body,
    auth: request.auth,
    connectionId: request.connectionId,
    accountId: request.accountId,
    timeoutMs: request.timeoutMs,
    maxBytes: request.maxBytes,
  };
}

function buildPaginatedRequest(
  request: ProviderRequest,
  pagination: Required<PaginationConfig>,
  state: {
    pageIndex: number;
    cursor: unknown;
    pageNumber: number;
    offset: number;
  },
): ProviderRequest {
  let query = cloneRecord(request.query);
  let body = request.body;
  if (pagination.pageParam) {
    query = { ...query, [pagination.pageParam]: state.pageNumber };
  }
  if (pagination.offsetParam) {
    query = { ...query, [pagination.offsetParam]: state.offset };
  }
  if (state.pageIndex > 0 && state.cursor != null) {
    if (pagination.cursorParam) {
      query = { ...query, [pagination.cursorParam]: state.cursor };
    }
    if (pagination.cursorBodyPath) {
      body = setAtPath(body, pagination.cursorBodyPath, state.cursor);
    }
  }
  return { ...request, query, body };
}

function buildBatchRequest(
  request: ProviderRequest,
  batch: Required<BatchConfig>,
  values: unknown[],
): ProviderRequest {
  let query = cloneRecord(request.query);
  let body = request.body;
  const payload = values.length === 1 ? values[0] : values;
  if (batch.itemQueryParam) {
    query = { ...query, [batch.itemQueryParam]: payload };
  }
  if (batch.itemBodyPath) {
    body = setAtPath(body, batch.itemBodyPath, values);
  }
  return { ...request, query, body };
}

function searchItems(
  items: unknown[],
  search: SearchConfig,
  options: {
    baseItemIndex: number;
    maxStoredHits: number;
    pageIndex?: number;
    batchIndex?: number;
  },
): SearchPageResult {
  const maxStoredHits = Math.max(0, options.maxStoredHits);
  const maxHitsPerItem = boundedNumber(search.maxHitsPerItem, 3, 1, 100);
  const maxFieldsPerItem = boundedNumber(
    search.maxFieldsPerItem,
    5_000,
    1,
    50_000,
  );
  let matchedItems = 0;
  let totalHits = 0;
  const storedHits: SearchHit[] = [];

  for (let itemOffset = 0; itemOffset < items.length; itemOffset++) {
    const item = items[itemOffset];
    const fields = collectSearchStrings(
      item,
      search.textPaths,
      maxFieldsPerItem,
    );
    const identity = extractItemIdentity(item, search.idPaths);
    const metadata = extractMetadata(item, search.metadataPaths);
    let itemMatched = false;
    let storedForItem = 0;
    const itemWideTermMatch = findItemWideTermMatch(fields, search);

    const addHit = (field: TextField, match: MatchRecord) => {
      totalHits++;
      if (!itemMatched) {
        matchedItems++;
        itemMatched = true;
      }
      if (storedHits.length < maxStoredHits && storedForItem < maxHitsPerItem) {
        storedForItem++;
        storedHits.push({
          id: identity.id,
          idPath: identity.idPath,
          itemIndex: options.baseItemIndex + itemOffset,
          pageIndex: options.pageIndex,
          pageItemIndex:
            options.pageIndex === undefined ? undefined : itemOffset,
          batchIndex: options.batchIndex,
          batchItemIndex:
            options.batchIndex === undefined ? undefined : itemOffset,
          path: field.path,
          kind: match.kind,
          query: match.query,
          match: match.match,
          snippet:
            match.snippet ??
            makeSnippet(
              field.text,
              match.index,
              search.contextChars,
              match.endIndex,
            ),
          ...(match.matchedTerms?.length
            ? { matchedTerms: match.matchedTerms }
            : {}),
          ...(Object.keys(metadata).length ? { metadata } : {}),
        });
      }
    };

    if (itemWideTermMatch) {
      addHit(itemWideTermMatch.field, itemWideTermMatch.match);
    }

    for (const field of fields) {
      const matches = findSearchMatches(field.text, search, !itemWideTermMatch);
      for (const match of matches) addHit(field, match);
    }
  }

  return {
    searchedItems: items.length,
    matchedItems,
    totalHits,
    storedHits,
  };
}

function normalizeLimits(input: LimitsConfig): Required<LimitsConfig> {
  const maxHits = input.maxHits ?? DEFAULT_MAX_HITS;
  return {
    pageBudget: input.pageBudget ?? DEFAULT_PAGE_BUDGET,
    batchBudget: input.batchBudget ?? DEFAULT_BATCH_BUDGET,
    runtimeMs: input.runtimeMs ?? DEFAULT_RUNTIME_MS,
    itemBudget: input.itemBudget ?? 200_000,
    maxHits,
  };
}

function normalizePagination(
  input: Record<string, unknown> | null,
): Required<PaginationConfig> {
  const parsed = PaginationSchema.parse(input ?? {});
  return {
    itemsPath: parsed.itemsPath ?? "",
    nextCursorPath: parsed.nextCursorPath ?? "",
    cursorPath: parsed.cursorPath ?? "",
    cursorParam: parsed.cursorParam ?? "",
    cursorBodyPath: parsed.cursorBodyPath ?? "",
    pageParam: parsed.pageParam ?? "",
    startPage: parsed.startPage ?? 1,
    offsetParam: parsed.offsetParam ?? "",
    startOffset: parsed.startOffset ?? 0,
    pageSize: parsed.pageSize ?? 0,
    maxPages: parsed.maxPages ?? DEFAULT_OVERALL_MAX_PAGES,
  };
}

function normalizeBatch(
  input: Record<string, unknown> | null,
): Required<BatchConfig> {
  const parsed = BatchSchema.parse(input ?? {});
  return {
    items: parsed.items ?? [],
    inputDatasetId: parsed.inputDatasetId ?? "",
    inputValuePath: parsed.inputValuePath ?? "",
    batchSize: parsed.batchSize ?? DEFAULT_BATCH_SIZE,
    itemBodyPath: parsed.itemBodyPath ?? "",
    itemQueryParam: parsed.itemQueryParam ?? "",
    responseItemsPath: parsed.responseItemsPath ?? "",
  };
}

function jobStatus(job: ProviderCorpusJobRecord) {
  const nextResumeAtIso = job.nextResumeAt
    ? new Date(job.nextResumeAt).toISOString()
    : null;
  return {
    job: jobSummary(job),
    source: jobSourceSummary(job),
    coverage: {
      pagesProcessed: job.pagesProcessed,
      batchesProcessed: job.batchesProcessed,
      itemsProcessed: job.itemsProcessed,
      matchedItems: job.matchedItems,
      totalHits: job.totalHits,
      storedHits: job.storedHits,
      truncatedHits: job.totalHits > job.storedHits,
    },
    checkpoint: job.checkpoint,
    error: job.error,
    nextResumeAt: nextResumeAtIso,
  };
}

function jobSourceSummary(job: ProviderCorpusJobRecord) {
  const request = job.request as Partial<ProviderRequest>;
  const pagination = (job.pagination ?? {}) as Partial<PaginationConfig>;
  const batch = (job.batch ?? {}) as Partial<BatchConfig>;
  const search = (job.search ?? {}) as Partial<SearchConfig>;
  return {
    provider: job.provider,
    mode: job.mode,
    request: {
      method: request.method ?? "GET",
      path: request.path ?? "",
    },
    pagination: {
      itemsPath: pagination.itemsPath ?? null,
      nextCursorPath:
        pagination.nextCursorPath ?? pagination.cursorPath ?? null,
      cursorParam: pagination.cursorParam ?? null,
      cursorBodyPath: pagination.cursorBodyPath ?? null,
      pageParam: pagination.pageParam ?? null,
      offsetParam: pagination.offsetParam ?? null,
    },
    batch: {
      inputDatasetId: batch.inputDatasetId ?? null,
      inputValuePath: batch.inputValuePath ?? null,
      batchSize: batch.batchSize ?? null,
      itemBodyPath: batch.itemBodyPath ?? null,
      itemQueryParam: batch.itemQueryParam ?? null,
      responseItemsPath: batch.responseItemsPath ?? null,
      sourceItemCount:
        typeof job.checkpoint.sourceItemCount === "number"
          ? job.checkpoint.sourceItemCount
          : null,
    },
    search: {
      textPaths: search.textPaths ?? [],
      idPaths: search.idPaths ?? [],
      metadataPaths: search.metadataPaths ?? [],
      matchMode: search.matchMode ?? null,
      queryCount:
        (search.query ? 1 : 0) +
        (search.regex ? 1 : 0) +
        (search.queries?.length ?? 0) +
        (search.terms?.length ?? 0),
    },
  };
}

function jobSummary(job: ProviderCorpusJobRecord) {
  return {
    id: job.id,
    name: job.name,
    mode: job.mode,
    status: job.status,
    provider: job.provider,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  };
}

function nextAction(job: ProviderCorpusJobRecord): string {
  if (job.status === "completed") {
    return `Read all stored hits with operation="results", jobId="${job.id}".`;
  }
  if (job.status === "quota_wait") {
    const at = job.nextResumeAt
      ? new Date(job.nextResumeAt).toISOString()
      : "later";
    return `Provider quota is cooling down. Continue this job after ${at} with operation="continue", jobId="${job.id}".`;
  }
  if (job.status === "paused") {
    return `Continue this job with operation="continue", jobId="${job.id}" until completed or quota_wait.`;
  }
  if (job.status === "failed") {
    return 'Fix the request/configuration or start a new job; progress and stored hits are still inspectable with operation="results".';
  }
  return `Check status with operation="status", jobId="${job.id}".`;
}

function extractItemsArray(
  body: unknown,
  itemsPath: string | undefined,
  wrapObjectFallback: boolean,
): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  if (itemsPath) {
    const found = getAtPath(body, itemsPath);
    if (Array.isArray(found)) return found;
    if (found !== undefined && wrapObjectFallback) return [found];
    return [];
  }
  const obj = body as Record<string, unknown>;
  for (const key of [
    "data",
    "results",
    "items",
    "records",
    "rows",
    "calls",
    "callTranscripts",
    "transcripts",
    "messages",
    "tickets",
    "issues",
    "deals",
    "events",
    "notes",
    "documents",
    "entries",
    "objects",
  ]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  const arrayFields = Object.values(obj).filter(Array.isArray);
  if (arrayFields.length === 1) return arrayFields[0] as unknown[];
  return wrapObjectFallback ? [body] : [];
}

function hasSearchNeedle(search: SearchConfig): boolean {
  return Boolean(
    search.query ||
    search.regex ||
    search.queries?.length ||
    search.terms?.length,
  );
}

function readQuota(response: Record<string, unknown>) {
  const quota = response.quota as Record<string, unknown> | undefined;
  if (quota?.exhausted === true && typeof quota.retryAt === "string") {
    return {
      retryAt: quota.retryAt,
      retryAfterMs: numberValue(quota.retryAfterMs, 0),
      reason: String(quota.reason ?? "quota"),
    };
  }
  const json = response.json as Record<string, unknown> | undefined;
  if (
    json?.error === "provider_quota_exhausted" &&
    typeof json.retryAt === "string"
  ) {
    return {
      retryAt: json.retryAt,
      retryAfterMs: numberValue(json.retryAfterMs, 0),
      reason: String(json.reason ?? "quota"),
    };
  }
  return null;
}

function hitToRecord(hit: SearchHit): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(hit).filter(([, value]) => value !== undefined),
  );
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function stringifyBrief(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.slice(0, maxChars);
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function valueOrNull(value: unknown): unknown | null {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false
  ) {
    return null;
  }
  return value;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRetryAt(retryAt: string, retryAfterMs: number): number {
  const parsed = Date.parse(retryAt);
  if (Number.isFinite(parsed)) return parsed;
  return Date.now() + Math.max(0, retryAfterMs);
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, finite));
}

function pathParts(path: string | undefined): string[] {
  if (!path) return [];
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getAtPath(value: unknown, path: string | undefined): unknown {
  let current = value;
  for (const part of pathParts(path)) {
    if (current === undefined || current === null) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setAtPath(base: unknown, path: string, value: unknown): unknown {
  const parts = pathParts(path);
  if (!parts.length) return value;
  const root =
    base && typeof base === "object" && !Array.isArray(base)
      ? (JSON.parse(JSON.stringify(base)) as Record<string, unknown>)
      : {};
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    const next =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    current[part] = next;
    current = next;
  }
  current[parts[parts.length - 1]!] = value;
  return root;
}

interface TextField {
  path: string;
  text: string;
}

function collectSearchStrings(
  item: unknown,
  textPaths: string[] | undefined,
  maxFields: number,
): TextField[] {
  const paths = (textPaths ?? []).filter((path) => path.trim());
  if (!paths.length) return collectStrings(item, "", [], maxFields);
  const fields: TextField[] = [];
  for (const path of paths) {
    const value = getAtPath(item, path);
    if (value !== undefined) collectStrings(value, path, fields, maxFields);
    if (fields.length >= maxFields) break;
  }
  return fields;
}

function collectStrings(
  value: unknown,
  basePath: string,
  out: TextField[],
  limit: number,
): TextField[] {
  if (out.length >= limit || value === undefined || value === null) return out;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    out.push({ path: basePath || "$", text: String(value) });
    return out;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && out.length < limit; i++) {
      collectStrings(
        value[i],
        basePath ? `${basePath}[${i}]` : `[${i}]`,
        out,
        limit,
      );
    }
    return out;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (out.length >= limit) break;
      collectStrings(
        (value as Record<string, unknown>)[key],
        basePath ? `${basePath}.${key}` : key,
        out,
        limit,
      );
    }
  }
  return out;
}

const DEFAULT_ID_PATHS = [
  "id",
  "callId",
  "callID",
  "call_id",
  "call.id",
  "call.metaData.id",
  "metaData.id",
  "metadata.id",
  "recordId",
  "record_id",
  "objectId",
  "object_id",
  "ticketId",
  "ticket_id",
  "issueId",
  "issue_id",
  "messageId",
  "message_id",
  "conversationId",
  "conversation_id",
  "eventId",
  "event_id",
  "documentId",
  "document_id",
  "url",
  "webUrl",
  "permalink",
];

function extractItemIdentity(
  item: unknown,
  idPaths: string[] | undefined,
): { id: string | null; idPath: string | null } {
  for (const path of [...(idPaths ?? []), ...DEFAULT_ID_PATHS]) {
    const value = getAtPath(item, path);
    if (value !== undefined && value !== null && String(value) !== "") {
      return { id: stringifySearchValue(value), idPath: path };
    }
  }
  return { id: null, idPath: null };
}

function extractMetadata(
  item: unknown,
  metadataPaths: string[] | undefined,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const path of metadataPaths ?? []) {
    const value = getAtPath(item, path);
    if (value !== undefined) metadata[path] = value;
  }
  return metadata;
}

function stringifySearchValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return stringifyBrief(value, 500);
}

function normalizedTerms(search: SearchConfig): string[] {
  const explicit = (search.terms ?? [])
    .map((term) => term.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;
  if (search.matchMode === "allTerms" && search.query) {
    return search.query
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
  }
  return [];
}

function findItemWideTermMatch(fields: TextField[], search: SearchConfig) {
  const terms = normalizedTerms(search);
  if (!terms.length || search.matchMode === "anyTerm") return null;
  const caseSensitive = Boolean(search.caseSensitive);
  const fieldWindows = fields
    .map((field) => {
      const hits = bestTermClusterInText(field.text, terms, caseSensitive).map(
        (hit) => ({ ...hit, field }),
      );
      if (hits.length !== terms.length) return null;
      const start = Math.min(...hits.map((hit) => hit.index));
      const end = Math.max(...hits.map((hit) => hit.end));
      return {
        field,
        hits,
        start,
        end,
        length: end - start,
      };
    })
    .filter(
      (
        result,
      ): result is {
        field: TextField;
        hits: TermHit[];
        start: number;
        end: number;
        length: number;
      } => Boolean(result),
    )
    .sort((a, b) => a.length - b.length || a.start - b.start);

  const bestFieldWindow = fieldWindows[0];
  if (bestFieldWindow) {
    const context = boundedNumber(search.contextChars, 180, 20, 1_000);
    const snippet =
      bestFieldWindow.length > context * 4
        ? makeCombinedTermSnippet(bestFieldWindow.hits, search.contextChars)
        : undefined;
    return {
      field: bestFieldWindow.field,
      match: {
        kind: "allTerms",
        query: terms.join(" "),
        index: bestFieldWindow.start,
        endIndex: bestFieldWindow.end,
        match: bestFieldWindow.field.text.slice(
          bestFieldWindow.start,
          bestFieldWindow.end,
        ),
        matchedTerms: terms,
        snippet,
      },
    };
  }

  const termHits = terms.map((term) => {
    for (const field of fields) {
      const hit = firstTermHitInField(field, term, caseSensitive);
      if (hit) return hit;
    }
    return null;
  });
  if (termHits.some((hit) => !hit)) return null;
  const hits = termHits.filter(isTermHit);
  const first = hits.sort((a, b) => a.index - b.index)[0];
  if (!first) return null;
  return {
    field: first.field,
    match: {
      kind: "allTerms",
      query: terms.join(" "),
      index: first.index,
      endIndex: first.end,
      match: first.match,
      matchedTerms: terms,
      snippet: makeCombinedTermSnippet(hits, search.contextChars),
    },
  };
}

function findSearchMatches(
  text: string,
  search: SearchConfig,
  includeTerms: boolean,
): MatchRecord[] {
  const source = String(text);
  const caseSensitive = Boolean(search.caseSensitive);
  const haystack = caseSensitive ? source : source.toLowerCase();
  const maxMatchesPerField = 1_000;
  const matches: MatchRecord[] = [];

  const addSubstring = (needle: unknown, label: string, kind: string) => {
    if (needle === undefined || needle === null) return;
    const rawNeedle = String(needle);
    if (!rawNeedle) return;
    const searchNeedle = caseSensitive ? rawNeedle : rawNeedle.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const index = haystack.indexOf(searchNeedle, from);
      if (index < 0) break;
      matches.push({
        kind,
        query: label,
        index,
        match: source.slice(index, index + rawNeedle.length),
      });
      from = index + Math.max(1, searchNeedle.length);
      if (matches.length >= maxMatchesPerField) break;
    }
  };

  if (search.regex) {
    const regex = new RegExp(
      search.regex,
      normalizeRegexFlags(search.regexFlags, caseSensitive),
    );
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) && typeof match.index === "number") {
      matches.push({
        kind: "regex",
        query: search.regex,
        index: match.index,
        match: match[0],
      });
      if (matches.length >= maxMatchesPerField) break;
      if (match[0] === "") regex.lastIndex += 1;
    }
  }

  if (search.query) addSubstring(search.query, search.query, "query");
  for (const query of search.queries ?? []) addSubstring(query, query, "query");

  const terms = includeTerms ? normalizedTerms(search) : [];
  if (terms.length) {
    const mode = search.matchMode === "anyTerm" ? "anyTerm" : "allTerms";
    const hits =
      mode === "allTerms"
        ? bestTermClusterInText(source, terms, caseSensitive)
        : terms
            .map((term) =>
              firstTermHitInText(
                source,
                haystack,
                caseSensitive ? term : term.toLowerCase(),
                term,
              ),
            )
            .filter(isInlineTermHit)
            .sort((a, b) => a.index - b.index);
    if (
      (mode === "allTerms" && hits.length === terms.length) ||
      (mode === "anyTerm" && hits.length > 0)
    ) {
      const first = hits[0];
      if (first) {
        const endIndex =
          mode === "allTerms"
            ? Math.max(...hits.map((hit) => hit.end))
            : first.end;
        matches.push({
          kind: mode,
          query: terms.join(" "),
          index: first.index,
          endIndex,
          match:
            mode === "allTerms"
              ? source.slice(first.index, endIndex)
              : first.match,
          matchedTerms:
            mode === "allTerms" ? terms : hits.map((hit) => hit.term),
        });
      }
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

function normalizeRegexFlags(
  flags: string | undefined,
  caseSensitive: boolean,
): string {
  const allowed = (flags ?? "")
    .replace(/[^dgimsuvy]/g, "")
    .replace(/[gy]/g, "");
  const withCase = caseSensitive || /i/.test(allowed) ? allowed : `${allowed}i`;
  return `${withCase}g`;
}

function makeSnippet(
  text: string,
  index: number,
  contextChars: number | undefined,
  endIndex = index,
): string {
  const context = boundedNumber(contextChars, 180, 20, 1_000);
  const start = Math.max(0, index - context);
  const end = Math.min(text.length, Math.max(index, endIndex) + context);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`
    .replace(/\s+/g, " ")
    .trim();
}

interface InlineTermHit {
  term: string;
  index: number;
  end: number;
  match: string;
}

interface TermHit extends InlineTermHit {
  field: TextField;
}

function firstTermHitInText(
  source: string,
  haystack: string,
  needle: string,
  term: string,
): InlineTermHit | null {
  const index = haystack.indexOf(needle);
  return index >= 0
    ? {
        term,
        index,
        end: index + term.length,
        match: source.slice(index, index + term.length),
      }
    : null;
}

function firstTermHitInField(
  field: TextField,
  term: string,
  caseSensitive: boolean,
): TermHit | null {
  const source = field.text;
  const haystack = caseSensitive ? source : source.toLowerCase();
  const needle = caseSensitive ? term : term.toLowerCase();
  const hit = firstTermHitInText(source, haystack, needle, term);
  return hit ? { ...hit, term, field } : null;
}

function isInlineTermHit(
  hit: InlineTermHit | null | undefined,
): hit is InlineTermHit {
  return Boolean(hit);
}

function isTermHit(hit: TermHit | null): hit is TermHit {
  return Boolean(hit);
}

function bestTermClusterInText(
  source: string,
  terms: string[],
  caseSensitive: boolean,
): InlineTermHit[] {
  const haystack = caseSensitive ? source : source.toLowerCase();
  const allHits = terms.map((term) => {
    const needle = caseSensitive ? term : term.toLowerCase();
    const hits: InlineTermHit[] = [];
    let from = 0;
    while (from <= haystack.length) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      hits.push({
        term,
        index,
        end: index + term.length,
        match: source.slice(index, index + term.length),
      });
      from = index + Math.max(1, needle.length);
      if (hits.length >= 100) break;
    }
    return hits;
  });
  if (allHits.some((hits) => hits.length === 0)) return [];

  const flattened = allHits
    .flat()
    .sort((a, b) => a.index - b.index || a.end - b.end);
  let best: InlineTermHit[] | null = null;
  let bestLength = Infinity;

  for (let start = 0; start < flattened.length; start++) {
    const selected = new Map<string, InlineTermHit>();
    for (let end = start; end < flattened.length; end++) {
      const hit = flattened[end]!;
      selected.set(hit.term, hit);
      if (selected.size !== terms.length) continue;
      const cluster = terms
        .map((term) => selected.get(term))
        .filter(isInlineTermHit)
        .sort((a, b) => a.index - b.index);
      const length =
        Math.max(...cluster.map((item) => item.end)) -
        Math.min(...cluster.map((item) => item.index));
      if (length < bestLength) {
        best = cluster;
        bestLength = length;
      }
      break;
    }
  }

  return best ?? [];
}

function makeCombinedTermSnippet(
  hits: TermHit[],
  contextChars: number | undefined,
): string {
  const context = boundedNumber(contextChars, 180, 20, 1_000);
  const shownHits = hits.slice(0, 5);
  const perHitContext = Math.max(
    20,
    Math.min(120, Math.floor(context / Math.max(1, Math.min(3, hits.length)))),
  );
  const parts = shownHits.map((hit) => {
    const snippet = makeSnippet(
      hit.field.text,
      hit.index,
      perHitContext,
      hit.end,
    );
    return `${hit.field.path}: ${snippet}`;
  });
  if (hits.length > shownHits.length) {
    parts.push(`... +${hits.length - shownHits.length} more terms`);
  }
  return parts.join(" | ");
}
