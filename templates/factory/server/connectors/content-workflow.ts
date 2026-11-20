import { createHash, randomUUID } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import {
  callMcpTool,
  findConnectedMcpServersForProvider,
  listRemoteServers,
  listVisibleMcpTools,
  McpAppApiError,
  mcpToolCallWasNotSent,
  mergedConfigKey,
  type AppMcpTool,
} from "@agent-native/core/mcp-client";

import { failWorkflowAction } from "../lib/workflow-action-errors.js";
import { isRecord, textOf } from "./provider-step-support.js";

export const CONTENT_MCP_PROVIDER_ID = "content";

export const CONTENT_CONNECT_STEPS =
  'Settings, Integrations, Add custom integration: Content\'s MCP server, https://content.agent-native.com/_agent-native/mcp, with "Personal" chosen, then sign in to Content';

const READ_TOOL = "get-content-database";
const UPSERT_TOOL = "upsert-database-item-by-key";
const PAGE_PATH = /\/page\/([A-Za-z0-9_-]{1,64})(?:[/?#]|$)/;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_VALUES = 100;
const KEY_PAGE_SIZE = 100;
const KEY_PAGES = 20;
const NOTHING_WRITTEN = new Set([
  "DATABASE_NOT_FOUND",
  "DATABASE_SPACE_REQUIRED",
  "DUPLICATE_ROW",
  "EMPTY_ROW_PATCH",
  "INVALID_PROPERTY_VALUE",
  "INVALID_ROW_PATCHES",
  "NATURAL_KEY_CONFLICT",
  "NATURAL_KEY_IMMUTABLE",
  "NATURAL_KEY_INVALID",
  "NATURAL_KEY_NOT_CONFIGURED",
  "PROPERTY_NOT_WRITABLE",
  "ROW_ACCESS_DENIED",
  "ROW_ALREADY_EXISTS",
  "ROW_NOT_FOUND",
  "ROW_PATCH_LIMIT",
  "ROW_REVISION_CONFLICT",
  "SCHEMA_REVISION_CONFLICT",
  "SOURCE_READ_ONLY",
  "SYSTEM_DATABASE_UNSUPPORTED",
  "TARGET_MISMATCH",
  "UNKNOWN_PROPERTY",
]);

export interface ContentRowInput {
  collection: string;
  key: string;
  title?: string | undefined;
  values?: Record<string, unknown> | undefined;
}

export interface ContentRowResult {
  ok: true;
  outcome: "created" | "updated" | "unchanged";
  documentId: string;
  itemId: string;
  url: string | null;
}

export interface ContentServer {
  id: string;
  url: string;
}

export interface ContentWorkflowDeps {
  listTools: () => Promise<AppMcpTool[]>;
  personalServers: () => Promise<ContentServer[]>;
  callTool: (
    serverId: string,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

interface ContentCall {
  identity: {
    userEmail: string;
    orgId: string;
    factoryId: string;
    automationId?: string | undefined;
    runId?: string | undefined;
    callId?: string | undefined;
  };
  context?: ActionRunContext | undefined;
  deps?: ContentWorkflowDeps;
}

interface ContractProperty {
  id: string;
  name: string;
  type: string;
  writable: boolean;
}

export function contentMcpDeps(
  ownerEmail: string,
  context?: ActionRunContext,
): ContentWorkflowDeps {
  return {
    listTools: () =>
      listVisibleMcpTools({ providerId: CONTENT_MCP_PROVIDER_ID }),
    personalServers: async () => {
      const [found, stored] = await Promise.all([
        findConnectedMcpServersForProvider({
          providerId: CONTENT_MCP_PROVIDER_ID,
          userEmail: ownerEmail,
        }),
        listRemoteServers("user", ownerEmail),
      ]);
      if (found.unreadableScopes.length > 0) {
        throw new Error("the owner's saved connections could not be read");
      }
      const content = new Set(found.servers.map((server) => server.id));
      return stored
        .filter((server) => content.has(server.id))
        .map((server) => ({
          id: mergedConfigKey("user", server, ownerEmail),
          url: server.url,
        }));
    },
    callTool: (serverId, name, args) =>
      callMcpTool(serverId, name, args, {
        providerId: CONTENT_MCP_PROVIDER_ID,
        ...(context ? { context } : {}),
      }),
  };
}

export function parseCollectionRef(collection: string): {
  documentId: string;
  origin: string | null;
} {
  const text = collection.trim();
  if (DOCUMENT_ID.test(text)) return { documentId: text, origin: null };
  const url = urlOf(text);
  const documentId =
    url?.searchParams.get("documentId") ??
    (url ? PAGE_PATH.exec(url.pathname)?.[1] : undefined);
  if (!url || !documentId || !DOCUMENT_ID.test(documentId)) {
    failWorkflowAction({
      message: `"${text.slice(0, 200)}" is not a Content collection link or page ID. Copy the collection's link from Content.`,
      errorCode: "content_collection_invalid",
      statusCode: 400,
    });
  }
  return { documentId, origin: url.origin };
}

export const CONTENT_UNREACHABLE =
  "The Content connection is saved, but Factory could not reach it or it lacks the tools this step needs. Open Settings, Integrations and sign in to Content again if it asks.";

export async function ownerContentServers(
  deps: ContentWorkflowDeps,
): Promise<{ saved: ContentServer[]; reachable: ContentServer[] }> {
  const [tools, saved] = await Promise.all([
    deps.listTools(),
    deps.personalServers(),
  ]);
  const reachable = saved.filter((server) =>
    [READ_TOOL, UPSERT_TOOL].every((name) =>
      tools.some((tool) => tool.serverId === server.id && tool.name === name),
    ),
  );
  return { saved, reachable };
}

async function ownerConnection(
  deps: ContentWorkflowDeps,
): Promise<{ serverId: string; origin: string | null }> {
  let servers: { saved: ContentServer[]; reachable: ContentServer[] };
  try {
    servers = await ownerContentServers(deps);
  } catch (error) {
    failWorkflowAction({
      message: `Factory could not list the owner's connections (${reasonOf(error)}).`,
      errorCode: "content_request_failed",
      statusCode: 424,
      retryable: true,
    });
  }
  const { saved, reachable } = servers;
  if (saved.length === 0) {
    failWorkflowAction({
      message: `The workflow's owner has not connected Content for themselves (${CONTENT_CONNECT_STEPS}). A connection shared with the workspace does not count.`,
      errorCode: "content_not_connected",
      statusCode: 412,
    });
  }
  if (saved.length > 1) {
    failWorkflowAction({
      message: `The workflow's owner has connected Content ${saved.length} times, so which one to write to is unclear. Only the owner can fix it: in their own account, keep one connection and remove the others.`,
      errorCode: "content_connection_ambiguous",
      statusCode: 409,
    });
  }
  if (!reachable[0]) {
    failWorkflowAction({
      message:
        "The workflow's owner has a saved Content connection, but Factory could not reach it or it lacks the tools this step needs. Only the owner can fix it: in their own account, Settings, Integrations, sign in to Content again if it asks.",
      errorCode: "content_connection_unavailable",
      statusCode: 424,
      retryable: true,
    });
  }
  const server = reachable[0];
  return { serverId: server.id, origin: urlOf(server.url)?.origin ?? null };
}

function toolValue(
  result: unknown,
  refusal: string,
  errorCode: string,
  unreadableCode = "content_unexpected_response",
) {
  const record = isRecord(result) ? result : {};
  const text = resultText(record);
  if (record.isError === true) {
    failWorkflowAction({
      message: `${refusal}: ${text.slice(0, 500) || "Content gave no reason."}`,
      errorCode,
      statusCode: 422,
    });
  }
  if (isRecord(record.structuredContent)) return record.structuredContent;
  const parsed = jsonRecordOf(text);
  if (parsed) return parsed;
  failWorkflowAction({
    message: `${refusal}: Content's answer could not be read.`,
    errorCode: unreadableCode,
    statusCode: 502,
  });
}

function resultText(record: Record<string, unknown>): string {
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((part) => (isRecord(part) ? textOf(part.text) : undefined))
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

function resultErrorCode(record: Record<string, unknown>): string | undefined {
  const structured = isRecord(record.structuredContent)
    ? record.structuredContent
    : {};
  const error = isRecord(structured.error) ? structured.error : {};
  return (
    textOf(error.errorCode) ??
    /\(errorCode: ([A-Za-z0-9_.:-]+)\)/.exec(resultText(record))?.[1]
  );
}

function contractProperties(contract: Record<string, unknown>) {
  const list: unknown = contract.properties;
  if (!Array.isArray(list)) unreadableColumns();
  return list.map((entry: unknown): ContractProperty => {
    if (!isRecord(entry)) unreadableColumns();
    const id = textOf(entry.id);
    const type = textOf(entry.type);
    const name: unknown = entry.name;
    const writable: unknown = entry.writable;
    if (
      !id ||
      !type ||
      typeof name !== "string" ||
      typeof writable !== "boolean"
    ) {
      unreadableColumns();
    }
    return { id, name, type, writable };
  });
}

function unreadableColumns(): never {
  failWorkflowAction({
    message:
      "Content could not describe the collection's columns: they came back in a shape this step does not read.",
    errorCode: "content_unexpected_response",
    statusCode: 502,
  });
}

function propertyEntries(
  properties: ContractProperty[],
  keyPropertyId: string,
  values: Record<string, unknown>,
) {
  const names = Object.keys(values);
  if (names.length > MAX_VALUES) {
    failWorkflowAction({
      message: `A row takes at most ${MAX_VALUES} values; this step has ${names.length}.`,
      errorCode: "content_too_many_values",
      statusCode: 400,
    });
  }
  const claimed = new Map<string, string>();
  return names.map((name) => {
    const exact = properties.filter((property) => property.name === name);
    const loose = properties.filter(
      (property) => property.name.toLowerCase() === name.toLowerCase(),
    );
    const property =
      exact.length === 1 ? exact[0] : loose.length === 1 ? loose[0] : null;
    if (!property) {
      failWorkflowAction({
        message: `The collection has no single column named "${name.slice(0, 120)}". Its columns: ${properties.map((entry) => entry.name).join(", ")}.`,
        errorCode: "content_column_unknown",
        statusCode: 400,
      });
    }
    const earlier = claimed.get(property.id);
    if (earlier !== undefined) {
      failWorkflowAction({
        message: `"${earlier.slice(0, 120)}" and "${name.slice(0, 120)}" both name the column "${property.name}". Keep one of them.`,
        errorCode: "content_column_repeated",
        statusCode: 400,
      });
    }
    claimed.set(property.id, name);
    if (property.id === keyPropertyId) {
      failWorkflowAction({
        message: `"${property.name}" is the collection's key, which this step sets from its key field.`,
        errorCode: "content_column_is_key",
        statusCode: 400,
      });
    }
    if (!property.writable) {
      failWorkflowAction({
        message: `"${property.name}" can't be written this way (a ${property.type} column). Leave it out of the values.`,
        errorCode: "content_column_read_only",
        statusCode: 400,
      });
    }
    return {
      propertyId: property.id,
      propertyType: property.type,
      value: values[name],
    };
  });
}

function rowsWithKey(
  collection: Record<string, unknown>,
  keyPropertyId: string,
  key: string,
): { rowRevision: string }[] {
  const items: unknown = collection.items;
  if (!Array.isArray(items)) unreadableKeyPage();
  return items.flatMap((item: unknown) => {
    const properties: unknown = isRecord(item) ? item.properties : undefined;
    if (
      !isRecord(item) ||
      !Array.isArray(properties) ||
      !properties.every(isRecord)
    ) {
      unreadableKeyPage();
    }
    const keyValues = properties.filter(
      (entry) => entry.propertyId === keyPropertyId,
    );
    const keyValue = keyValues[0]?.value;
    if (keyValues.length !== 1 || typeof keyValue !== "string") {
      unreadableKeyPage();
    }
    if (keyValue !== key) return [];
    const rowRevision = textOf(item.rowRevision);
    if (!rowRevision) {
      failWorkflowAction({
        message: `Content could not look up the row by its key: the row with the key "${key.slice(0, 120)}" came back without a revision.`,
        errorCode: "content_unexpected_response",
        statusCode: 502,
      });
    }
    return [{ rowRevision }];
  });
}

function unreadableKeyPage(): never {
  failWorkflowAction({
    message:
      "Content could not look up the row by its key: a page of rows came back in a shape this step does not read.",
    errorCode: "content_unexpected_response",
    statusCode: 502,
  });
}

async function rowWithKey(
  deps: ContentWorkflowDeps,
  serverId: string,
  documentId: string,
  keyColumn: { id: string; name: string },
  key: string,
): Promise<{ rowRevision: string } | null> {
  const matches: { rowRevision: string }[] = [];
  for (let page = 0; page < KEY_PAGES; page += 1) {
    const keyed = toolValue(
      await read(deps, serverId, {
        documentId,
        compactRows: true,
        limit: KEY_PAGE_SIZE,
        offset: page * KEY_PAGE_SIZE,
        tableQuery: {
          search: "",
          filters: [
            {
              key: keyColumn.id,
              label: keyColumn.name,
              operator: "equals",
              value: JSON.stringify([key]),
            },
          ],
          sorts: [],
          filterMode: "and",
        },
      }),
      "Content could not look up the row by its key",
      "content_collection_unreadable",
    );
    matches.push(...rowsWithKey(keyed, keyColumn.id, key));
    if (matches.length > 1) {
      failWorkflowAction({
        message: `More than one row has the key "${key.slice(0, 120)}", so which to update is unclear. Fix the duplicate in Content.`,
        errorCode: "content_key_duplicated",
        statusCode: 409,
      });
    }
    const hasMore = isRecord(keyed.pagination)
      ? keyed.pagination.hasMore
      : undefined;
    if (typeof hasMore !== "boolean") {
      failWorkflowAction({
        message:
          "Content could not look up the row by its key: its answer did not say whether more rows follow.",
        errorCode: "content_unexpected_response",
        statusCode: 502,
      });
    }
    if (!hasMore) return matches[0] ?? null;
  }
  failWorkflowAction({
    message: `More than ${KEY_PAGE_SIZE * KEY_PAGES} rows have a key that differs from "${key.slice(0, 120)}" only in case or spacing, so Factory stopped looking for it.`,
    errorCode: "content_key_lookup_too_broad",
    statusCode: 409,
  });
}

function idempotencyKey(
  call: ContentCall,
  input: ContentRowInput,
  revisions: { schema: string; row: string | null },
): string {
  const { identity } = call;
  const parts = [
    identity.orgId,
    identity.factoryId,
    identity.automationId ?? null,
    identity.runId ?? null,
    identity.callId ?? null,
    input.collection.trim(),
    input.key,
    input.title ?? null,
    input.values ?? null,
    revisions.schema,
    revisions.row,
  ];
  const seed = identity.runId ? JSON.stringify(parts) : randomUUID();
  return `factory-content-${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;
}

export async function upsertContentRow(
  call: ContentCall,
  input: ContentRowInput,
): Promise<ContentRowResult> {
  const deps =
    call.deps ?? contentMcpDeps(call.identity.userEmail, call.context);
  const { documentId, origin: linked } = parseCollectionRef(input.collection);
  const { serverId, origin } = await ownerConnection(deps);
  if (linked && origin && linked !== origin) {
    failWorkflowAction({
      message: `That collection link is on ${linked.slice(0, 200)}, but the owner's Content connection is to ${origin}. Use a link from ${origin}, or the collection's page ID.`,
      errorCode: "content_collection_other_host",
      statusCode: 400,
    });
  }

  const collection = toolValue(
    await read(deps, serverId, { documentId, compactRows: true, limit: 1 }),
    "Content could not read the collection",
    "content_collection_unreadable",
  );
  const contract = isRecord(collection.mutationContract)
    ? collection.mutationContract
    : null;
  const keyPropertyId = contract
    ? textOf(contract.naturalKeyPropertyId)
    : undefined;
  const schemaRevision = contract ? textOf(contract.schemaRevision) : undefined;
  const target = contract ? mutationTarget(contract.target) : null;
  if (!contract || !target || !schemaRevision) {
    failWorkflowAction({
      message:
        "That page is not a Content collection this account can write to.",
      errorCode: "content_collection_not_writable",
      statusCode: 403,
    });
  }
  if (!keyPropertyId) {
    failWorkflowAction({
      message:
        "The collection has no unique key column, so a row can't be found again by its key. Set one in Content first.",
      errorCode: "content_key_missing",
      statusCode: 412,
    });
  }
  const properties = contractProperties(contract);
  const keyColumn = properties.find(
    (property) => property.id === keyPropertyId,
  );
  if (!keyColumn) unreadableColumns();
  const entries = propertyEntries(
    properties,
    keyPropertyId,
    input.values ?? {},
  );

  const existing = await rowWithKey(
    deps,
    serverId,
    documentId,
    { id: keyPropertyId, name: keyColumn.name },
    input.key,
  );
  const expectedRowRevision = existing?.rowRevision ?? null;

  let written: unknown;
  try {
    written = await deps.callTool(serverId, UPSERT_TOOL, {
      target,
      expectedSchemaRevision: schemaRevision,
      idempotencyKey: idempotencyKey(call, input, {
        schema: schemaRevision,
        row: expectedRowRevision,
      }),
      keyValue: input.key,
      expectedRowRevision,
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(entries.length > 0 ? { propertyEntries: entries } : {}),
    });
  } catch (error) {
    if (wasNotSent(error)) {
      failWorkflowAction({
        message: `Factory could not send the row to Content (${reasonOf(error)}).`,
        errorCode: "content_request_failed",
        statusCode: 424,
        retryable: true,
      });
    }
    failWorkflowAction({
      message: `Content did not answer the write (${reasonOf(error)}).`,
      errorCode: "content_write_outcome_unknown",
      statusCode: 502,
    });
  }
  if (
    isRecord(written) &&
    written.isError === true &&
    !NOTHING_WRITTEN.has(resultErrorCode(written) ?? "")
  ) {
    failWorkflowAction({
      message: `Content answered the write with an error that does not say the row was left alone, so it may have been written: ${resultText(written).slice(0, 500) || "Content gave no reason."}`,
      errorCode: "content_write_outcome_unknown",
      statusCode: 502,
    });
  }
  const result = toolValue(
    written,
    "Content refused the row",
    "content_write_refused",
    "content_write_outcome_unknown",
  );
  const receipt = isRecord(result.receipt) ? result.receipt : {};
  const row = isRecord(receipt.row) ? receipt.row : {};
  const outcome = receipt.outcome;
  const rowDocumentId = textOf(row.documentId);
  const itemId = textOf(row.itemId);
  const urlPath = textOf(row.urlPath);
  if (
    (outcome !== "created" &&
      outcome !== "updated" &&
      outcome !== "unchanged") ||
    !rowDocumentId ||
    !itemId
  ) {
    failWorkflowAction({
      message:
        "Content's answer to the write has no row receipt, so whether the row was written is unknown.",
      errorCode: "content_write_outcome_unknown",
      statusCode: 502,
    });
  }
  return {
    ok: true,
    outcome,
    documentId: rowDocumentId,
    itemId,
    url:
      origin && urlPath?.startsWith("/")
        ? `${origin}${urlPath}`
        : origin
          ? `${origin}/page/${encodeURIComponent(rowDocumentId)}`
          : null,
  };
}

async function read(
  deps: ContentWorkflowDeps,
  serverId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await deps.callTool(serverId, READ_TOOL, args);
  } catch (error) {
    failWorkflowAction({
      message: `Factory could not read the collection from Content (${reasonOf(error)}).`,
      errorCode: "content_request_failed",
      statusCode: 424,
      retryable: true,
    });
  }
}

function mutationTarget(value: unknown) {
  if (!isRecord(value)) return null;
  const spaceId = textOf(value.spaceId);
  const databaseId = textOf(value.databaseId);
  const databaseDocumentId = textOf(value.databaseDocumentId);
  return spaceId && databaseId && databaseDocumentId
    ? { spaceId, databaseId, databaseDocumentId }
    : null;
}

function wasNotSent(error: unknown): boolean {
  return error instanceof McpAppApiError || mcpToolCallWasNotSent(error);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "no reason";
}

function urlOf(text: string): URL | null {
  try {
    return new URL(text);
    // coercion-ok: text that is not a URL is refused by the caller as not a link.
  } catch {
    return null;
  }
}

function jsonRecordOf(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
    // coercion-ok: text that is not JSON is reported by the caller as unreadable.
  } catch {
    return null;
  }
}
