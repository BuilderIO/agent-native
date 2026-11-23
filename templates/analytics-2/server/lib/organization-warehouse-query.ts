import { createHash, randomUUID } from "node:crypto";

import {
  defineActionErrors,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { getDbExec, withDbExec } from "@agent-native/core/db";
import {
  readAppSecret,
  hasAppSecret,
  writeAppSecret,
  deleteAppSecret,
} from "@agent-native/core/secrets";
import {
  getRequestContext,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { getSettingEntry, mutateSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { requireSemanticOrg } from "../../actions/_semantic-helpers.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import {
  organizationWarehouseQueryInputSchema,
  recoverOrganizationWarehouseQueryInputSchema,
  type OrganizationWarehouseQueryInput,
  type OrganizationWarehouseQueryOutput,
} from "../../shared/organization-warehouse-query-contract.js";
import { PARTIAL_RESULT_NOTE } from "../model/cell-result-preview.js";
import { cancelWarehouseJob } from "../model/data-connection-provider.js";
import { rerouteMissingOrganizationSource } from "./connection-routing.js";
import {
  getOrganizationBigQueryCredentialReadiness,
  requireOrganizationBigQueryProjectId,
  withOrganizationBigQueryRequestContext,
} from "./org-bigquery-credentials.js";
import { getAnalytics2OrganizationQueryProviderApiRuntime } from "./provider-api.js";

export async function organizationWarehouseQueryToolAvailable(): Promise<boolean> {
  const context = getRequestContext();
  if (!context?.orgId || !context.userEmail) return false;
  try {
    const readiness = await getOrganizationBigQueryCredentialReadiness({
      orgId: context.orgId,
      userEmail: context.userEmail,
    });
    return readiness === "configured";
  } catch (error) {
    if (
      !isActionContractError(error) ||
      error.errorCode !== "bigquery_credentials_unavailable"
    )
      throw error;
    console.warn(
      "[analytics-2] Organization warehouse readiness could not be checked during tool discovery.",
    );
    return false;
  }
}

export const organizationWarehouseQueryErrors = defineActionErrors(
  "organization_query_actor_required",
  "organization_query_quota_cooldown",
  "organization_query_cleanup_failed",
  "organization_query_continuation_forbidden",
  "organization_query_continuation_invalid",
  "organization_query_continuation_stale",
  "organization_query_continuation_unreadable",
  "organization_query_in_progress",
  "organization_query_incomplete_rows",
  "organization_query_job_mismatch",
  "organization_query_job_status_unreadable",
  "organization_query_job_unreadable",
  "organization_query_location_unreadable",
  "organization_query_malformed_result",
  "organization_query_operation_invalid",
  "organization_query_page_repeated",
  "organization_query_page_unreadable",
  "organization_query_pending_rows",
  "organization_query_provider_failed",
  "organization_query_request_failed",
  "organization_query_reservation_lost",
  "organization_query_response_truncated",
  "organization_query_rows_unreadable",
  "organization_query_schema_changed",
  "organization_query_schema_unreadable",
  "organization_query_single_attempt_required",
  "organization_query_state_unreadable",
  "organization_query_total_changed",
  "organization_query_total_unreadable",
  "organization_query_transaction_required",
  "organization_query_unreadable_response",
  "workspace_required",
  "workspace_membership_required",
  "bigquery_org_context_mismatch",
  "bigquery_credentials_unavailable",
  "bigquery_org_credentials_missing",
  "bigquery_org_credentials_incomplete",
  "bigquery_project_id_invalid",
  "bigquery_read_only_query_required",
);

async function requireQueryProjectId(
  scope: Parameters<typeof requireOrganizationBigQueryProjectId>[0],
  context?: ActionRunContext,
): Promise<string> {
  try {
    return await requireOrganizationBigQueryProjectId(scope);
  } catch (error) {
    if (
      context?.caller !== undefined &&
      context.caller !== "frontend" &&
      context.caller !== "http" &&
      isActionContractError(error) &&
      (error.errorCode === "bigquery_org_credentials_missing" ||
        error.errorCode === "bigquery_org_credentials_incomplete" ||
        error.errorCode === "bigquery_credentials_unavailable")
    ) {
      organizationWarehouseQueryErrors.fail(
        "The organization warehouse is unavailable for this query. Continue with the requested saved warehouse via add-project-cell and its dataConnectionId. Discover accessible sources with list-data-connections when needed.",
        error.errorCode,
        {
          statusCode: error.statusCode,
          details: { nextRequiredAction: "add-project-cell" },
        },
      );
    }
    throw error;
  }
}

export async function runOrganizationWarehouseQueryInternal(
  input: OrganizationWarehouseQueryInput,
) {
  return executeOrganizationWarehouseQuery(input, (scope) =>
    requireOrganizationBigQueryProjectId(scope).catch(
      rerouteMissingOrganizationSource,
    ),
  );
}

type QueryFailureCode =
  | "quota_cooldown"
  | "cleanup_failed"
  | "actor_required"
  | "continuation_forbidden"
  | "continuation_invalid"
  | "continuation_stale"
  | "continuation_unreadable"
  | "in_progress"
  | "incomplete_rows"
  | "job_mismatch"
  | "job_status_unreadable"
  | "job_unreadable"
  | "location_unreadable"
  | "malformed_result"
  | "operation_invalid"
  | "page_repeated"
  | "page_unreadable"
  | "pending_rows"
  | "provider_failed"
  | "request_failed"
  | "reservation_lost"
  | "response_truncated"
  | "rows_unreadable"
  | "schema_changed"
  | "schema_unreadable"
  | "single_attempt_required"
  | "state_unreadable"
  | "total_changed"
  | "total_unreadable"
  | "transaction_required"
  | "unreadable_response";

const TTL_MS = 60 * 60 * 1000;
const stateSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  actor: z.string(),
  source: z.literal(ORGANIZATION_BIGQUERY_SOURCE_ID),
  fingerprint: z.string(),
  tokenHash: z.string(),
  continuationRef: z.string().nullable(),
  expiresAt: z.number(),
  reservation: z.string().nullable(),
  state: z.enum([
    "reserved",
    "pending",
    "paging",
    "complete",
    "failed",
    "uncertain",
    "budget_exhausted",
  ]),
  projectId: z.string(),
  schemaFingerprint: z.string().nullable(),
  pageHashes: z.array(z.string()).max(20),
  maxRows: z.number().int(),
  returned: z.number().int(),
  pages: z.number().int(),
  totalRows: z.string().nullable(),
});
type QueryState = z.infer<typeof stateSchema>;
const continuationSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    actor: z.string(),
    source: z.literal(ORGANIZATION_BIGQUERY_SOURCE_ID),
    fingerprint: z.string(),
    jobId: z.string().nullable(),
    location: z.string().nullable(),
    providerPage: z.string().nullable(),
    pendingQueryId: z
      .string()
      .regex(/^[a-f0-9]{64}\.[a-f0-9-]{36}$/)
      .nullable()
      .optional(),
  })
  .strict();
type ExecutionState = QueryState & {
  jobId: string | null;
  location: string | null;
  providerPage: string | null;
};

const ownFailures = new WeakSet<object>();
function failure(
  code: QueryFailureCode,
  message: string,
  statusCode = 409,
  details?: Record<string, unknown>,
): never {
  try {
    return organizationWarehouseQueryErrors.fail(
      message,
      `organization_query_${code}`,
      {
        statusCode,
        ...(details === undefined ? {} : { details }),
      },
    );
  } catch (error) {
    if (object(error)) ownFailures.add(error);
    throw error;
  }
}
async function mutateQuerySetting(
  key: string,
  updater: Parameters<typeof mutateSetting>[1],
) {
  await getSettingEntry(key, { bypassCache: true });
  const database = getDbExec();
  if (typeof database.transaction !== "function")
    failure(
      "transaction_required",
      "Durable query reservations require database transactions.",
      503,
    );
  return database.transaction((transaction) =>
    mutateSetting(key, updater, {
      transaction,
      validateStoredValue: (value) => {
        parseState(value);
      },
    }),
  );
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function parseState(value: unknown): QueryState {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success)
    failure(
      "state_unreadable",
      "The saved query state could not be read.",
      503,
    );
  return parsed.data;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type ReadQueryToken = {
  kind: "word" | "identifier" | "literal" | "symbol";
  value: string;
  depth: number;
};

function readOnlySqlTokens(query: string) {
  const tokens: ReadQueryToken[] = [];
  let quotedIdentifierStart = -1;
  let depth = 0;
  let index = 0;
  let state:
    | "normal"
    | "single"
    | "double"
    | "backtick"
    | "triple-single"
    | "triple-double"
    | "line-comment"
    | "block-comment" = "normal";

  while (index < query.length) {
    const char = query[index] ?? "";
    const next = query[index + 1];
    const third = query[index + 2];

    if (state === "line-comment") {
      if (char === "\n" || char === "\r") state = "normal";
      index++;
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "normal";
        index += 2;
      } else {
        index++;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "backtick") {
      const terminator =
        state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === "\\") {
        index += 2;
      } else if (char === terminator && next === terminator) {
        index += 2;
      } else if (char === terminator) {
        if (state === "backtick" && index === quotedIdentifierStart)
          return null;
        state = "normal";
        index++;
      } else {
        index++;
      }
      continue;
    }
    if (state === "triple-single" || state === "triple-double") {
      const terminator = state === "triple-single" ? "'" : '"';
      if (char === "\\") {
        index += 2;
      } else if (
        char === terminator &&
        next === terminator &&
        third === terminator
      ) {
        state = "normal";
        index += 3;
      } else {
        index++;
      }
      continue;
    }

    if (char === "#" || (char === "-" && next === "-")) {
      state = "line-comment";
      index += char === "#" ? 1 : 2;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 2;
      continue;
    }
    if (char === ";") {
      tokens.push({ kind: "symbol", value: char, depth });
      index++;
      continue;
    }
    if (char === "'" && next === "'" && third === "'") {
      tokens.push({ kind: "literal", value: "", depth });
      state = "triple-single";
      index += 3;
      continue;
    }
    if (char === '"' && next === '"' && third === '"') {
      tokens.push({ kind: "literal", value: "", depth });
      state = "triple-double";
      index += 3;
      continue;
    }
    if (char === "'") {
      tokens.push({ kind: "literal", value: "", depth });
      state = "single";
      index++;
      continue;
    }
    if (char === '"') {
      tokens.push({ kind: "literal", value: "", depth });
      state = "double";
      index++;
      continue;
    }
    if (char === "`") {
      tokens.push({ kind: "identifier", value: "", depth });
      quotedIdentifierStart = index + 1;
      state = "backtick";
      index++;
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "symbol", value: char, depth });
      depth++;
      index++;
      continue;
    }
    if (char === ")") {
      depth--;
      if (depth < 0) return null;
      tokens.push({ kind: "symbol", value: char, depth });
      index++;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (/[A-Za-z0-9_]/.test(query[index] ?? "")) index++;
      tokens.push({
        kind: "word",
        value: query.slice(start, index).toUpperCase(),
        depth,
      });
      continue;
    }
    if (!/\s/.test(char)) tokens.push({ kind: "symbol", value: char, depth });
    index++;
  }

  if (
    depth !== 0 ||
    [
      "single",
      "double",
      "backtick",
      "triple-single",
      "triple-double",
      "block-comment",
    ].includes(state)
  ) {
    return null;
  }
  return tokens;
}

function hasReadQueryHead(tokens: readonly ReadQueryToken[]): boolean {
  const matchingClosers = new Map<number, number>();
  const openers: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token?.kind !== "symbol") continue;
    if (token.value === "(") openers.push(index);
    if (token.value === ")") {
      const opening = openers.pop();
      if (opening === undefined) return false;
      matchingClosers.set(opening, index);
    }
  }
  if (openers.length !== 0) return false;
  const isWord = (index: number, value: string) =>
    tokens[index]?.kind === "word" && tokens[index]?.value === value;
  const isSymbol = (index: number, value: string) =>
    tokens[index]?.kind === "symbol" && tokens[index]?.value === value;
  const queryTails = new Set([
    "UNION",
    "INTERSECT",
    "EXCEPT",
    "ORDER",
    "LIMIT",
  ]);
  const selectHead = (start: number, end: number, depth: number): boolean => {
    if (depth > 32 || start >= end) return false;
    if (isWord(start, "SELECT")) return true;
    if (!isSymbol(start, "(")) return false;
    const close = matchingClosers.get(start);
    if (
      close === undefined ||
      close >= end ||
      !queryHead(start + 1, close, depth + 1)
    )
      return false;
    if (close + 1 === end) return true;
    const tail = tokens[close + 1];
    return tail?.kind === "word" && queryTails.has(tail.value);
  };
  const queryHead = (start: number, end: number, depth: number): boolean => {
    if (depth > 32 || start >= end) return false;
    if (!isWord(start, "WITH")) return selectHead(start, end, depth);
    let index = start + 1;
    if (isWord(index, "RECURSIVE")) index++;
    while (index < end) {
      const name = tokens[index];
      if (name?.kind !== "word" && name?.kind !== "identifier") return false;
      index++;
      if (!isWord(index, "AS")) return false;
      index++;
      if (!isSymbol(index, "(")) return false;
      const close = matchingClosers.get(index);
      if (
        close === undefined ||
        close >= end ||
        !queryHead(index + 1, close, depth + 1)
      )
        return false;
      index = close + 1;
      if (isSymbol(index, ",")) {
        index++;
        continue;
      }
      return selectHead(index, end, depth + 1);
    }
    return false;
  };
  return queryHead(0, tokens.length, 0);
}

export function requireOrganizationReadOnlySql(query: string): string {
  const tokens = readOnlySqlTokens(query);
  const reject = () =>
    organizationWarehouseQueryErrors.fail(
      "Run one read-only SELECT query. Multi-statement and write queries are not allowed.",
      "bigquery_read_only_query_required",
      { statusCode: 400 },
    );
  if (tokens === null) return reject();
  const terminator = tokens.findIndex(
    (token) => token.kind === "symbol" && token.value === ";",
  );
  if (
    terminator !== -1 &&
    (terminator !== tokens.length - 1 || tokens[terminator]?.depth !== 0)
  )
    return reject();
  const statement = terminator === -1 ? tokens : tokens.slice(0, terminator);
  if (!hasReadQueryHead(statement)) return reject();
  return query.trim();
}

const fieldSchema: z.ZodType<Field> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(1024),
    type: z.string().min(1),
    mode: z.enum(["NULLABLE", "REQUIRED", "REPEATED"]).default("NULLABLE"),
    fields: z.array(fieldSchema).max(1000).optional(),
  }),
);
type Field = {
  name: string;
  type: string;
  mode: "NULLABLE" | "REQUIRED" | "REPEATED";
  fields?: Field[] | undefined;
};
function normalizeCell(field: Field, cell: unknown, depth = 0): unknown {
  if (
    depth > 32 ||
    !object(cell) ||
    !Object.hasOwn(cell, "v") ||
    cell.v === undefined
  )
    failure("malformed_result", "BigQuery returned a malformed row cell.", 502);
  const value = cell.v;
  if (value === null) return null;
  if (field.mode === "REPEATED") {
    if (!Array.isArray(value))
      failure(
        "malformed_result",
        "BigQuery returned a malformed repeated value.",
        502,
      );
    return value.map((entry) =>
      normalizeCell({ ...field, mode: "NULLABLE" }, entry, depth + 1),
    );
  }
  const type = field.type.toUpperCase();
  if (type === "STRUCT" || type === "RECORD") {
    if (
      !field.fields ||
      !object(value) ||
      !Array.isArray(value.f) ||
      value.f.length !== field.fields.length
    )
      failure(
        "malformed_result",
        "BigQuery returned a malformed nested record.",
        502,
      );
    const values = value.f;
    return Object.fromEntries(
      field.fields.map((nested, i) => [
        nested.name,
        normalizeCell(nested, values[i], depth + 1),
      ]),
    );
  }
  if (["BOOL", "BOOLEAN"].includes(type)) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    failure("malformed_result", "BigQuery returned an invalid boolean.", 502);
  }
  if (typeof value !== "string" && typeof value !== "number")
    failure(
      "malformed_result",
      "BigQuery returned an invalid scalar value.",
      502,
    );
  if (["FLOAT", "FLOAT64"].includes(type)) {
    if (
      typeof value === "string" &&
      ["NaN", "Infinity", "-Infinity"].includes(value)
    )
      return value;
    if (
      typeof value === "string" &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
    )
      failure("malformed_result", "BigQuery returned an invalid number.", 502);
    const number = Number(value);
    if (!Number.isFinite(number))
      failure("malformed_result", "BigQuery returned an invalid number.", 502);
    return number;
  }
  if (["INT64", "INTEGER"].includes(type) && !/^[+-]?\d+$/.test(String(value)))
    failure("malformed_result", "BigQuery returned an invalid integer.", 502);
  if (
    ["NUMERIC", "BIGNUMERIC", "DECIMAL", "BIGDECIMAL"].includes(type) &&
    (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(value)) ||
      (typeof value === "number" && !Number.isSafeInteger(value)))
  )
    failure("malformed_result", "BigQuery returned an invalid decimal.", 502);
  if (type === "JSON") {
    if (typeof value !== "string")
      failure("malformed_result", "BigQuery returned invalid JSON.", 502);
    try {
      return JSON.parse(value);
    } catch {
      failure("malformed_result", "BigQuery returned invalid JSON.", 502);
    }
  }
  return String(value);
}
function columnType(
  field: Field,
): OrganizationWarehouseQueryOutput["columns"][number]["type"] {
  const type = field.type.toUpperCase();
  if (
    field.mode === "REPEATED" ||
    ["STRUCT", "RECORD", "JSON", "GEOGRAPHY"].includes(type)
  )
    return "json";
  if (
    [
      "FLOAT",
      "FLOAT64",
      "INT64",
      "INTEGER",
      "NUMERIC",
      "BIGNUMERIC",
      "DECIMAL",
      "BIGDECIMAL",
    ].includes(type)
  )
    return "number";
  if (["BOOL", "BOOLEAN"].includes(type)) return "boolean";
  if (type === "DATE") return "date";
  if (["TIMESTAMP", "DATETIME", "TIME"].includes(type)) return "datetime";
  return "string";
}
const providerReasons = new Set([
  "accessDenied",
  "notFound",
  "invalidQuery",
  "bytesBilledLimitExceeded",
  "responseTooLarge",
  "resourcesExceeded",
  "billingTierLimitExceeded",
  "quotaExceeded",
  "backendError",
]);

function providerDiagnostics(status: unknown, errors: unknown) {
  const first = Array.isArray(errors) ? errors[0] : null;
  const reason = object(first) ? first.reason : null;
  return {
    providerStatus:
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : null,
    providerReason:
      typeof reason === "string" && providerReasons.has(reason) ? reason : null,
  };
}

function providerFailureMessage(
  diagnostics: ReturnType<typeof providerDiagnostics>,
  fallback: string,
): string {
  const { providerReason, providerStatus } = diagnostics;
  if (providerReason === "bytesBilledLimitExceeded")
    return "BigQuery exceeded the organization query bytes-billed limit. Narrow the SQL or run the query on a saved warehouse connection via list-data-connections, add-project-cell, and run-project-cell.";
  if (
    providerReason === "accessDenied" ||
    providerStatus === 401 ||
    providerStatus === 403
  )
    return "BigQuery denied access on the organization source. Check permissions or continue with a granted saved warehouse connection via list-data-connections, add-project-cell, and run-project-cell.";
  if (providerReason === "notFound" || providerStatus === 404)
    return "BigQuery could not find the referenced dataset or table on the organization source. Check the table name or continue with a saved warehouse connection via list-data-connections, add-project-cell, and run-project-cell.";
  if (providerReason === "invalidQuery")
    return "BigQuery rejected the SQL syntax or identifiers. Fix the query and retry.";
  if (providerReason === "responseTooLarge")
    return "BigQuery returned a response exceeding the maximum result size. Add a LIMIT or aggregate in SQL and retry.";
  return fallback;
}

function readResponse(raw: unknown): Record<string, unknown> {
  if (!object(raw) || !object(raw.response))
    failure(
      "unreadable_response",
      "BigQuery returned an unreadable response.",
      502,
    );
  const response = raw.response;
  if (response.ok === false && response.status === 429) {
    const quota = object(response.quota) ? response.quota : null;
    const json = object(response.json) ? response.json : null;
    const headers = object(response.headers) ? response.headers : null;
    const header = headers?.["retry-after"];
    const declaredMs = quota?.retryAfterMs ?? json?.retryAfterMs;
    let retryAfterMs: number | null = null;
    if (
      typeof declaredMs === "number" &&
      Number.isFinite(declaredMs) &&
      declaredMs >= 0
    )
      retryAfterMs = Math.min(TTL_MS, Math.ceil(declaredMs));
    else if (typeof header === "string" && /^\d{1,8}$/.test(header))
      retryAfterMs = Math.min(TTL_MS, Number(header) * 1000);
    else if (
      typeof header === "string" &&
      /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
        header,
      )
    ) {
      const retryAt = Date.parse(header);
      if (
        Number.isFinite(retryAt) &&
        new Date(retryAt).toUTCString() === header
      )
        retryAfterMs = Math.min(TTL_MS, Math.max(0, retryAt - Date.now()));
    }
    failure(
      "quota_cooldown",
      retryAfterMs === null
        ? "BigQuery is temporarily rate limited. Retry later."
        : "BigQuery is temporarily rate limited. Retry after the indicated delay.",
      429,
      {
        retryAfterMs,
        retryAt:
          retryAfterMs === null
            ? null
            : new Date(Date.now() + retryAfterMs).toISOString(),
      },
    );
  }
  if (response.truncated !== false)
    failure(
      "response_truncated",
      "BigQuery response is incomplete or its truncation status is unreadable.",
      502,
    );
  if (response.ok !== true) {
    const diagnostics = providerDiagnostics(
      response.status,
      object(response.json) && object(response.json.error)
        ? response.json.error.errors
        : null,
    );
    failure(
      "provider_failed",
      providerFailureMessage(
        diagnostics,
        "BigQuery could not complete this request. Check the connection and query, then retry.",
      ),
      502,
      diagnostics,
    );
  }
  if (!object(response.json))
    failure("unreadable_response", "BigQuery returned no query result.", 502);
  if (
    response.json.errors !== undefined &&
    (!Array.isArray(response.json.errors) || response.json.errors.length > 0)
  ) {
    const diagnostics = providerDiagnostics(
      response.status,
      response.json.errors,
    );
    failure(
      "provider_failed",
      providerFailureMessage(diagnostics, "BigQuery rejected this query."),
      422,
      diagnostics,
    );
  }
  return response.json;
}
function normalizeResult(
  result: Record<string, unknown>,
  state: ExecutionState,
): {
  output: OrganizationWarehouseQueryOutput;
  state: ExecutionState;
  providerTypes: string[];
  jobIdentity: string;
} {
  if (typeof result.jobComplete !== "boolean")
    failure(
      "job_status_unreadable",
      "BigQuery omitted a valid completion status.",
      502,
    );
  const reference = object(result.jobReference) ? result.jobReference : null;
  if (
    reference?.projectId !== undefined &&
    reference.projectId !== state.projectId
  )
    failure(
      "job_mismatch",
      "BigQuery returned a different query project.",
      502,
    );
  const jobId = reference?.jobId === undefined ? state.jobId : reference.jobId;
  if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(jobId))
    failure(
      "job_unreadable",
      "BigQuery returned no resumable query identity.",
      502,
    );
  if (state.jobId !== null && state.jobId !== jobId)
    failure("job_mismatch", "BigQuery changed the query identity.", 502);
  const location = reference?.location ?? result.location ?? state.location;
  if (
    location !== null &&
    (typeof location !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(location))
  )
    failure(
      "location_unreadable",
      "BigQuery returned an invalid query location.",
      502,
    );
  if (state.location !== null && location !== state.location)
    failure("job_mismatch", "BigQuery changed the query location.", 502);
  const jobIdentity = hash(JSON.stringify([state.projectId, jobId]));
  const nextToken = randomUUID();
  const nextState: ExecutionState = {
    ...state,
    jobId,
    location,
    reservation: null,
    tokenHash: hash(nextToken),
  };
  const opaqueId = `${state.id}.${nextToken}`;
  if (!result.jobComplete) {
    if (
      result.rows !== undefined &&
      (!Array.isArray(result.rows) || result.rows.length !== 0)
    )
      failure(
        "pending_rows",
        "BigQuery returned partial rows before the job completed.",
        502,
      );
    nextState.state = "pending";
    return {
      state: nextState,
      providerTypes: [],
      jobIdentity,
      output: {
        columns: [],
        rows: [],
        rowCount: 0,
        complete: false,
        hasMore: true,
        nextPageToken: null,
        queryId: opaqueId,
        status: "running",
        totalRows: null,
        truncated: false,
        jobComplete: false,
        semanticDefinitionIds: [],
        warnings: [
          "The query is still running. Poll using the returned queryId.",
        ],
      },
    };
  }
  if (!object(result.schema))
    failure("schema_unreadable", "BigQuery omitted the result schema.", 502);
  const parsed = z
    .array(fieldSchema)
    .min(1)
    .max(1000)
    .safeParse(result.schema.fields);
  if (
    !parsed.success ||
    new Set(parsed.data.map((field) => field.name)).size !== parsed.data.length
  )
    failure(
      "schema_unreadable",
      "BigQuery returned an invalid result schema.",
      502,
    );
  const fields = parsed.data;
  const validateNames = (items: Field[], depth = 0): void => {
    if (
      depth > 32 ||
      new Set(items.map((field) => field.name)).size !== items.length
    )
      failure(
        "schema_unreadable",
        "BigQuery returned duplicate or deeply nested result fields.",
        502,
      );
    for (const field of items)
      if (field.fields) validateNames(field.fields, depth + 1);
  };
  validateNames(fields);
  const schemaFingerprint = hash(JSON.stringify(fields));
  if (
    state.schemaFingerprint !== null &&
    state.schemaFingerprint !== schemaFingerprint
  )
    failure(
      "schema_changed",
      "BigQuery changed the result schema while paging.",
      502,
    );
  if (
    typeof result.totalRows !== "string" ||
    !/^\d{1,30}$/.test(result.totalRows)
  )
    failure(
      "total_unreadable",
      "BigQuery omitted a valid total row count.",
      502,
    );
  if (state.totalRows !== null && result.totalRows !== state.totalRows)
    failure(
      "total_changed",
      "BigQuery changed the total row count while paging.",
      502,
    );
  const sourceRows = result.rows === undefined ? [] : result.rows;
  if (
    !Array.isArray(sourceRows) ||
    sourceRows.length > Math.min(state.maxRows, 50_000 - state.returned)
  )
    failure(
      "rows_unreadable",
      "BigQuery returned an invalid result page.",
      502,
    );
  const rows = sourceRows.map((row) => {
    if (!object(row) || !Array.isArray(row.f) || row.f.length !== fields.length)
      failure(
        "rows_unreadable",
        "BigQuery returned a row that does not match the schema.",
        502,
      );
    const cells = row.f;
    return Object.fromEntries(
      fields.map((field, index) => [
        field.name,
        normalizeCell(field, cells[index]),
      ]),
    );
  });
  if (
    result.pageToken !== undefined &&
    (typeof result.pageToken !== "string" ||
      !result.pageToken ||
      result.pageToken.length > 16_384)
  )
    failure(
      "page_unreadable",
      "BigQuery returned an invalid continuation.",
      502,
    );
  const providerPage =
    typeof result.pageToken === "string" ? result.pageToken : null;
  if (providerPage !== null && state.pageHashes.includes(hash(providerPage)))
    failure(
      "page_repeated",
      "BigQuery repeated the previous result page.",
      502,
    );
  const returned = state.returned + rows.length;
  const total = BigInt(result.totalRows);
  if (
    BigInt(returned) > total ||
    (providerPage === null && BigInt(returned) !== total) ||
    (providerPage !== null && BigInt(returned) >= total)
  )
    failure(
      "incomplete_rows",
      "BigQuery returned an incomplete or inconsistent result page.",
      502,
    );
  const pages = state.pages + 1;
  const exhausted =
    providerPage !== null && (returned >= 50_000 || pages >= 20);
  nextState.state = exhausted
    ? "budget_exhausted"
    : providerPage
      ? "paging"
      : "complete";
  nextState.schemaFingerprint = schemaFingerprint;
  nextState.pageHashes =
    providerPage === null
      ? state.pageHashes
      : [...state.pageHashes, hash(providerPage)];
  nextState.providerPage = providerPage;
  nextState.returned = returned;
  nextState.pages = pages;
  nextState.totalRows = result.totalRows;
  return {
    state: nextState,
    jobIdentity,
    providerTypes: fields.map((field) =>
      field.mode === "REPEATED" ? "REPEATED" : field.type,
    ),
    output: {
      columns: fields.map((field) => ({
        name: field.name,
        type: columnType(field),
      })),
      rows,
      rowCount: rows.length,
      complete: providerPage === null,
      hasMore: providerPage !== null,
      nextPageToken: providerPage === null || exhausted ? null : opaqueId,
      queryId: providerPage === null || exhausted ? null : opaqueId,
      status: nextState.state,
      totalRows: result.totalRows,
      truncated: exhausted,
      jobComplete: true,
      semanticDefinitionIds: [],
      warnings: [
        ...(providerPage !== null ? [PARTIAL_RESULT_NOTE] : []),
        ...(exhausted
          ? [
              "The finite query result budget was reached. Narrow the query to retrieve the remaining rows.",
            ]
          : []),
      ],
    },
  };
}

export async function runOrganizationWarehouseQuery(
  input: OrganizationWarehouseQueryInput,
  context?: ActionRunContext,
): Promise<OrganizationWarehouseQueryOutput> {
  const { output } = await executeOrganizationWarehouseQuery(input, (scope) =>
    requireQueryProjectId(scope, context),
  );
  return output;
}

async function executeOrganizationWarehouseQuery(
  input: OrganizationWarehouseQueryInput,
  resolveProjectId: typeof requireOrganizationBigQueryProjectId,
) {
  const args = organizationWarehouseQueryInputSchema.parse(input);
  const orgId = await requireSemanticOrg();
  const email = getRequestUserEmail();
  if (!email?.trim())
    failure(
      "actor_required",
      "An authenticated workspace member is required.",
      403,
    );
  const actor = email.trim().toLowerCase();
  const projectId = await resolveProjectId({ orgId, userEmail: actor });
  const runtime = getAnalytics2OrganizationQueryProviderApiRuntime();
  if (
    args.operation === "start" &&
    runtime.requestCapabilities?.singleAttemptUnsafeRequests !== true
  )
    failure(
      "single_attempt_required",
      "The warehouse transport must support single-attempt query submission.",
      503,
    );
  const querySql =
    args.operation === "start"
      ? requireOrganizationReadOnlySql(args.sql)
      : null;
  const fingerprint =
    args.operation === "start"
      ? hash(
          JSON.stringify([
            orgId,
            actor,
            ORGANIZATION_BIGQUERY_SOURCE_ID,
            querySql,
          ]),
        )
      : null;
  const id =
    args.operation === "start" ? fingerprint : args.queryId.split(".")[0];
  if (!id)
    failure("continuation_invalid", "The query continuation is invalid.");
  // Mounted settings endpoints force user namespaces. Transactional CAS suppresses global settings events for this internal namespace.
  const key = `analytics-2:organization-query:${id}`;
  const reservation = randomUUID();
  const now = Date.now();
  const raw = await mutateQuerySetting(key, (current) => {
    if (args.operation === "start") {
      if (current !== null) {
        const previous = parseState(current);
        if (
          previous.expiresAt > now &&
          ["reserved", "pending", "paging", "uncertain"].includes(
            previous.state,
          )
        )
          failure(
            "in_progress",
            "This query is already in progress or has an unknown submission outcome. Use its continuation or wait for expiry.",
          );
      }
      return {
        id,
        orgId,
        actor,
        source: ORGANIZATION_BIGQUERY_SOURCE_ID,
        fingerprint: fingerprint ?? "",
        tokenHash: hash(randomUUID()),
        continuationRef: null,
        expiresAt: now + TTL_MS,
        reservation,
        state: "reserved",
        projectId,
        schemaFingerprint: null,
        pageHashes: [],
        maxRows: args.maxRows,
        returned: 0,
        pages: 0,
        totalRows: null,
      } satisfies QueryState;
    }
    if (current === null)
      failure(
        "continuation_invalid",
        "The query continuation was not found or has expired.",
        404,
      );
    const saved = parseState(current);
    if (
      saved.orgId !== orgId ||
      saved.actor !== actor ||
      saved.source !== ORGANIZATION_BIGQUERY_SOURCE_ID ||
      saved.id !== id ||
      saved.fingerprint !== id
    )
      failure(
        "continuation_forbidden",
        "This query belongs to a different workspace or member.",
        403,
      );
    if (
      saved.expiresAt <= now ||
      saved.tokenHash !== hash(args.queryId.split(".")[1] ?? "") ||
      saved.projectId !== projectId
    )
      failure(
        "continuation_stale",
        "The query continuation expired or was already consumed.",
      );
    if (saved.reservation !== null)
      failure("in_progress", "A query operation is already in progress.");
    if (
      (args.operation === "poll" && saved.state !== "pending") ||
      (args.operation === "next-page" && saved.state !== "paging")
    )
      failure(
        "operation_invalid",
        "This operation does not match the saved query state.",
      );
    return { ...saved, reservation };
  });
  const state = parseState(raw);
  let startFailureIsDefinitive = false;
  let continuationFailureIsTerminal = false;
  try {
    let execution: ExecutionState = {
      ...state,
      jobId: null,
      location: null,
      providerPage: null,
    };
    if (args.operation !== "start") {
      if (state.continuationRef !== key) {
        continuationFailureIsTerminal = true;
        failure(
          "continuation_forbidden",
          "The saved continuation reference does not match this query.",
          403,
        );
      }
      const stored = await readAppSecret({ key, scope: "org", scopeId: orgId });
      if (!stored) {
        continuationFailureIsTerminal = true;
        failure(
          "continuation_invalid",
          "The saved query continuation was not found or has expired.",
          404,
        );
      }
      let value: unknown;
      try {
        value = JSON.parse(stored.value);
      } catch {
        failure(
          "continuation_unreadable",
          "The saved query continuation could not be read.",
          503,
        );
      }
      const parsed = continuationSchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.id !== state.id ||
        parsed.data.orgId !== orgId ||
        parsed.data.actor !== actor ||
        parsed.data.source !== state.source ||
        parsed.data.fingerprint !== state.fingerprint
      ) {
        continuationFailureIsTerminal = true;
        failure(
          "continuation_forbidden",
          "The saved continuation is not authorized for this query.",
          403,
        );
      }
      execution = {
        ...state,
        jobId: parsed.data.jobId,
        location: parsed.data.location,
        providerPage: parsed.data.providerPage,
      };
    }
    const request =
      args.operation === "start"
        ? {
            provider: "bigquery" as const,
            method: "POST" as const,
            path: `projects/${encodeURIComponent(projectId)}/queries`,
            timeoutMs: 60_000,
            maxBytes: 4_000_000,
            body: {
              query: querySql,
              useLegacySql: false,
              jobCreationMode: "JOB_CREATION_REQUIRED",
              timeoutMs: 45_000,
              maxResults: args.maxRows,
              maximumBytesBilled: "50000000000",
            },
          }
        : {
            provider: "bigquery" as const,
            method: "GET" as const,
            path: `projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(execution.jobId ?? "")}`,
            timeoutMs: 45_000,
            maxBytes: 4_000_000,
            query: {
              maxResults: Math.min(state.maxRows, 50_000 - state.returned),
              timeoutMs: 30_000,
              ...(execution.providerPage === null
                ? {}
                : { pageToken: execution.providerPage }),
              ...(execution.location === null
                ? {}
                : { location: execution.location }),
            },
          };
    const response = await withOrganizationBigQueryRequestContext(
      { orgId, userEmail: actor },
      () => runtime.executeRequest(request),
    );
    const providerResponse =
      object(response) && object(response.response) ? response.response : null;
    const payload =
      providerResponse && object(providerResponse.json)
        ? providerResponse.json
        : null;
    startFailureIsDefinitive = Boolean(
      providerResponse &&
      ((providerResponse.ok === false &&
        typeof providerResponse.status === "number" &&
        [400, 401, 403, 404, 405, 409, 422, 429].includes(
          providerResponse.status,
        )) ||
        (providerResponse.ok === true &&
          providerResponse.status === 200 &&
          providerResponse.truncated === false &&
          payload?.jobComplete === true)),
    );
    continuationFailureIsTerminal = Boolean(
      providerResponse &&
      ((providerResponse.ok === false &&
        typeof providerResponse.status === "number" &&
        [400, 401, 403, 404, 405, 409, 422].includes(
          providerResponse.status,
        )) ||
        (providerResponse.ok === true &&
          providerResponse.status === 200 &&
          providerResponse.truncated === false &&
          payload?.jobComplete === true &&
          Array.isArray(payload.errors) &&
          payload.errors.length > 0)),
    );
    const normalized = normalizeResult(readResponse(response), execution);
    const secretRef = { key, scope: "org" as const, scopeId: orgId };
    await hasAppSecret(secretRef);
    const database = getDbExec();
    if (typeof database.transaction !== "function")
      failure(
        "transaction_required",
        "Durable query reservations require database transactions.",
        503,
      );
    await database.transaction((transaction) =>
      withDbExec(transaction, async () => {
        const { jobId, location, providerPage, ...persisted } =
          normalized.state;
        const retainsContinuation = normalized.output.queryId !== null;
        if (retainsContinuation) {
          await writeAppSecret({
            ...secretRef,
            value: JSON.stringify({
              id: state.id,
              orgId,
              actor,
              source: state.source,
              fingerprint: state.fingerprint,
              jobId,
              location,
              providerPage,
              pendingQueryId:
                normalized.output.status === "running"
                  ? normalized.output.queryId
                  : null,
            }),
          });
        } else {
          await deleteAppSecret(secretRef);
        }
        await mutateSetting(
          key,
          (current) => {
            const saved = parseState(current);
            if (
              saved.reservation !== reservation ||
              saved.tokenHash !== state.tokenHash ||
              saved.id !== state.id ||
              saved.fingerprint !== state.fingerprint ||
              saved.state !== state.state
            )
              failure(
                "reservation_lost",
                "The query operation no longer owns its reservation.",
              );
            return {
              ...persisted,
              continuationRef: retainsContinuation ? key : null,
            };
          },
          {
            transaction,
            validateStoredValue: (value) => {
              parseState(value);
            },
          },
        );
      }),
    );
    const { output, providerTypes, jobIdentity } = normalized;
    return { output, providerTypes, jobIdentity };
  } catch (error) {
    if (args.operation !== "start" && !continuationFailureIsTerminal) {
      try {
        await mutateQuerySetting(key, (current) => {
          const saved = parseState(current);
          if (
            saved.reservation !== reservation ||
            saved.id !== state.id ||
            saved.fingerprint !== state.fingerprint ||
            saved.state !== state.state ||
            saved.tokenHash !== state.tokenHash
          )
            failure(
              "reservation_lost",
              "The query operation no longer owns its reservation.",
            );
          return { ...saved, reservation: null };
        });
      } catch (releaseError) {
        if (object(releaseError) && ownFailures.has(releaseError))
          throw releaseError;
        failure(
          "cleanup_failed",
          "The request outcome may be unknown and its saved state could not be finalized. It will not be resubmitted automatically.",
          503,
        );
      }
      if (object(error) && ownFailures.has(error)) throw error;
      failure(
        "request_failed",
        "The request could not be completed or its saved state finalized. Its outcome may be unknown; it will not be resubmitted automatically.",
        502,
      );
    }
    const secretRef = { key, scope: "org" as const, scopeId: orgId };
    try {
      await hasAppSecret(secretRef);
      const database = getDbExec();
      if (typeof database.transaction !== "function")
        failure(
          "transaction_required",
          "Durable query reservations require database transactions.",
          503,
        );
      await database.transaction((transaction) =>
        withDbExec(transaction, async () => {
          await deleteAppSecret(secretRef);
          await mutateSetting(
            key,
            (current) => {
              const saved = parseState(current);
              if (
                saved.reservation !== reservation ||
                saved.id !== state.id ||
                saved.fingerprint !== state.fingerprint ||
                saved.state !== state.state ||
                saved.tokenHash !== state.tokenHash
              )
                failure(
                  "reservation_lost",
                  "The query operation no longer owns its reservation.",
                );
              return {
                ...saved,
                reservation: null,
                tokenHash: hash(randomUUID()),
                continuationRef: null,
                state:
                  args.operation === "start" && !startFailureIsDefinitive
                    ? "uncertain"
                    : "failed",
              };
            },
            {
              transaction,
              validateStoredValue: (value) => {
                parseState(value);
              },
            },
          );
        }),
      );
    } catch (cleanupError) {
      if (object(cleanupError) && ownFailures.has(cleanupError))
        throw cleanupError;
      failure(
        "cleanup_failed",
        "The request outcome may be unknown and its saved state could not be finalized. It will not be resubmitted automatically.",
        503,
      );
    }
    if (object(error) && ownFailures.has(error)) throw error;
    failure(
      "request_failed",
      "The request could not be completed or its saved state finalized. Its outcome may be unknown; it will not be resubmitted automatically.",
      502,
    );
  }
}

/** Recover an existing pending operation without submitting or consuming a query. */
export async function recoverOrganizationWarehouseQuery(
  input: z.infer<typeof recoverOrganizationWarehouseQueryInputSchema>,
  context?: ActionRunContext,
): Promise<OrganizationWarehouseQueryOutput> {
  const args = recoverOrganizationWarehouseQueryInputSchema.parse(input);
  const orgId = await requireSemanticOrg();
  const email = getRequestUserEmail();
  if (!email?.trim())
    failure(
      "actor_required",
      "An authenticated workspace member is required.",
      403,
    );
  const actor = email.trim().toLowerCase();
  const projectId = await requireQueryProjectId(
    {
      orgId,
      userEmail: actor,
    },
    context,
  );
  const querySql = requireOrganizationReadOnlySql(args.sql);
  const id = hash(
    JSON.stringify([orgId, actor, ORGANIZATION_BIGQUERY_SOURCE_ID, querySql]),
  );
  const key = `analytics-2:organization-query:${id}`;
  await getSettingEntry(key, { bypassCache: true });
  const database = getDbExec();
  if (typeof database.transaction !== "function")
    failure(
      "transaction_required",
      "Durable query recovery requires database transactions.",
      503,
    );
  return database.transaction((transaction) =>
    withDbExec(transaction, async () => {
      const entry = await getSettingEntry(key, { transaction });
      if (!entry.found)
        failure(
          "continuation_invalid",
          "The query continuation was not found or has expired.",
          404,
        );
      const state = parseState(entry.value);
      if (
        state.orgId !== orgId ||
        state.actor !== actor ||
        state.source !== args.connectionId ||
        state.id !== id ||
        state.fingerprint !== id ||
        state.projectId !== projectId
      )
        failure(
          "continuation_forbidden",
          "This query belongs to a different workspace or member.",
          403,
        );
      if (state.expiresAt <= Date.now())
        failure(
          "continuation_stale",
          "The query continuation expired or was already consumed.",
        );
      if (
        state.reservation !== null ||
        state.state !== "pending" ||
        state.returned !== 0 ||
        state.pages !== 0
      )
        failure(
          "operation_invalid",
          "Only an idle pending query can be recovered.",
        );
      if (state.continuationRef !== key)
        failure(
          "continuation_forbidden",
          "The saved continuation reference does not match this query.",
          403,
        );
      const stored = await readAppSecret({ key, scope: "org", scopeId: orgId });
      if (!stored)
        failure(
          "continuation_invalid",
          "The saved query continuation was not found or has expired.",
          404,
        );
      let value: unknown;
      try {
        value = JSON.parse(stored.value);
      } catch {
        failure(
          "continuation_unreadable",
          "The saved query continuation could not be read.",
          503,
        );
      }
      const parsed = continuationSchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.id !== id ||
        parsed.data.orgId !== orgId ||
        parsed.data.actor !== actor ||
        parsed.data.source !== args.connectionId ||
        parsed.data.fingerprint !== id
      )
        failure(
          "continuation_forbidden",
          "The saved continuation is not authorized for this query.",
          403,
        );
      const queryId = parsed.data.pendingQueryId;
      if (
        !queryId ||
        queryId.split(".")[0] !== id ||
        hash(queryId.split(".")[1] ?? "") !== state.tokenHash
      )
        failure(
          "continuation_stale",
          "The query continuation expired or was already consumed.",
        );
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        complete: false,
        hasMore: true,
        nextPageToken: null,
        queryId,
        status: "running" as const,
        totalRows: null,
        truncated: false,
        jobComplete: false,
        semanticDefinitionIds: [],
        warnings: [
          "The query is still running. Poll using the returned queryId.",
        ],
      };
    }),
  );
}

export async function cancelOrganizationWarehouseQuery(
  queryId: string,
  operation: "request" | "status",
) {
  if (!/^[a-f0-9]{64}\.[a-f0-9-]{36}$/.test(queryId))
    failure("continuation_invalid", "The query continuation is invalid.");
  const orgId = await requireSemanticOrg();
  const email = getRequestUserEmail();
  if (!email?.trim())
    failure(
      "actor_required",
      "An authenticated workspace member is required.",
      403,
    );
  const actor = email.trim().toLowerCase();
  const projectId = await requireOrganizationBigQueryProjectId({
    orgId,
    userEmail: actor,
  });
  const id = queryId.split(".")[0] ?? "";
  const key = `analytics-2:organization-query:${id}`;
  const reservation = randomUUID();
  const state = parseState(
    await mutateQuerySetting(key, (current) => {
      if (current === null)
        failure(
          "continuation_invalid",
          "The query continuation was not found.",
          404,
        );
      const saved = parseState(current);
      if (
        saved.orgId !== orgId ||
        saved.actor !== actor ||
        saved.id !== id ||
        saved.fingerprint !== id ||
        saved.projectId !== projectId
      )
        failure(
          "continuation_forbidden",
          "This query belongs to a different workspace or member.",
          403,
        );
      if (
        saved.expiresAt <= Date.now() ||
        saved.tokenHash !== hash(queryId.split(".")[1] ?? "") ||
        saved.continuationRef !== key
      )
        failure(
          "continuation_stale",
          "The query continuation expired or was already consumed.",
        );
      if (saved.reservation !== null)
        failure("in_progress", "A query operation is already in progress.");
      if (saved.state !== "pending")
        failure("operation_invalid", "Only a pending query can be cancelled.");
      return { ...saved, reservation };
    }),
  );
  let result: "pending" | "cancelled" | "complete" | "failed" | undefined;
  try {
    const stored = await readAppSecret({ key, scope: "org", scopeId: orgId });
    if (!stored)
      failure(
        "continuation_invalid",
        "The saved query continuation was not found.",
        404,
      );
    let value: unknown;
    try {
      value = JSON.parse(stored.value);
    } catch {
      failure(
        "continuation_unreadable",
        "The saved query continuation could not be read.",
        503,
      );
    }
    const parsed = continuationSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.id !== id ||
      parsed.data.orgId !== orgId ||
      parsed.data.actor !== actor ||
      parsed.data.fingerprint !== state.fingerprint ||
      !parsed.data.jobId ||
      !parsed.data.location
    )
      failure(
        "continuation_unreadable",
        "The saved query job identity could not be read.",
        503,
      );
    const { jobId, location } = parsed.data;
    result = await withOrganizationBigQueryRequestContext(
      { orgId, userEmail: actor },
      () =>
        cancelWarehouseJob(
          getAnalytics2OrganizationQueryProviderApiRuntime(),
          { projectId, jobId, location },
          operation,
        ),
    );
    return result;
  } finally {
    await mutateQuerySetting(key, (current) => {
      const saved = parseState(current);
      if (
        saved.reservation !== reservation ||
        saved.id !== id ||
        saved.tokenHash !== state.tokenHash
      )
        failure(
          "reservation_lost",
          "The query operation no longer owns its reservation.",
        );
      return {
        ...saved,
        reservation: null,
        ...(result === "cancelled" || result === "failed"
          ? { state: "failed" as const, tokenHash: hash(randomUUID()) }
          : {}),
      };
    });
  }
}
