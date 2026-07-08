import { resolveBuilderCredential } from "@agent-native/core/server";

import type {
  BuilderCmsModelFieldSummary,
  BuilderCmsModelSummary,
  BuilderCmsModelsResponse,
} from "../shared/api.js";
import {
  builderBlocksHash,
  builderEntryBlocks,
  type BuilderContentEntry,
} from "../shared/builder-mdx.js";
import {
  normalizeBuilderCmsApiEntry,
  type BuilderCmsSourceEntry,
} from "./_builder-cms-source-adapter.js";

export type BuilderCmsReadState = "live" | "unconfigured" | "error";

export interface BuilderCmsReadResult {
  state: BuilderCmsReadState;
  entries: BuilderCmsSourceEntry[];
  fetchedAt: string;
  message: string | null;
  progress: BuilderCmsReadProgress;
}

export interface BuilderCmsReadProgress {
  requestedLimit: number;
  pageSize: number;
  startOffset: number;
  nextOffset: number;
  fetchedEntryCount: number;
  hasMore: boolean;
  partial: boolean;
  readMode: "builder-api" | "mcp" | "none";
}

export interface BuilderCmsEntryLiveState {
  exists: boolean;
  published: "published" | "draft" | string | null;
  lastUpdated: number | string | null;
  blocksHash: string | null;
  id: string | null;
}

type FetchLike = typeof fetch;

type BuilderMcpContentPart = {
  type?: string;
  text?: string;
};

type BuilderMcpToolResult = {
  content?: BuilderMcpContentPart[];
};

const BUILDER_CMS_DEFAULT_READ_LIMIT = 500;
const BUILDER_CMS_MAX_READ_LIMIT = 1000;
const BUILDER_CMS_PAGE_SIZE = 100;
const BUILDER_CMS_READ_RETRIES = 2;
const BUILDER_CMS_ENTRY_FIELDS =
  "id,name,published,lastUpdated,createdDate,data.title,data.handle,data.url,data.slug,data.date,data.description,data.status,data.author,data.image,data.blocks,data.blocksString";

function builderContentApiHost() {
  return (
    process.env.BUILDER_CONTENT_API_HOST ??
    process.env.BUILDER_CMS_API_HOST ??
    "https://cdn.builder.io"
  ).replace(/\/+$/, "");
}

function entryArrayFromResponse(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.results) ? record.results : [];
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringOrNumberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return stringFromUnknown(value);
}

function liveStateFromBuilderEntry(value: unknown): BuilderCmsEntryLiveState {
  if (Array.isArray(value)) {
    return value.length > 0
      ? liveStateFromBuilderEntry(value[0])
      : {
          exists: false,
          published: null,
          lastUpdated: null,
          blocksHash: null,
          id: null,
        };
  }
  if (!value || typeof value !== "object") {
    return {
      exists: false,
      published: null,
      lastUpdated: null,
      blocksHash: null,
      id: null,
    };
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.results)) {
    return liveStateFromBuilderEntry(record.results);
  }
  if (Object.keys(record).length === 0) {
    return {
      exists: false,
      published: null,
      lastUpdated: null,
      blocksHash: null,
      id: null,
    };
  }

  const data =
    record.data &&
    typeof record.data === "object" &&
    !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};
  const id =
    stringFromUnknown(record.id) ??
    stringFromUnknown(record["@id"]) ??
    stringFromUnknown(record.uuid);
  if (!id) {
    return {
      exists: false,
      published: null,
      lastUpdated: null,
      blocksHash: null,
      id: null,
    };
  }

  const blocks = builderEntryBlocks(record as BuilderContentEntry);
  return {
    exists: true,
    published:
      stringFromUnknown(record.published) ?? stringFromUnknown(data.published),
    lastUpdated:
      stringOrNumberFromUnknown(record.lastUpdated) ??
      stringOrNumberFromUnknown(record.updatedDate) ??
      stringOrNumberFromUnknown(record.updatedAt) ??
      stringOrNumberFromUnknown(data.updatedAt),
    blocksHash: blocks.length > 0 ? builderBlocksHash(blocks) : null,
    id,
  };
}

function readLimit(limit: number | undefined) {
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return Math.min(Math.floor(limit), BUILDER_CMS_MAX_READ_LIMIT);
  }
  const envLimit = Number(process.env.BUILDER_CMS_READ_LIMIT);
  if (Number.isFinite(envLimit) && envLimit > 0) {
    return Math.min(Math.floor(envLimit), BUILDER_CMS_MAX_READ_LIMIT);
  }
  return BUILDER_CMS_DEFAULT_READ_LIMIT;
}

function readPageLimit(remaining: number) {
  return Math.min(remaining, BUILDER_CMS_PAGE_SIZE);
}

function retryableBuilderReadStatus(status: number) {
  return status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBuilderContentPage(args: {
  fetchImpl: FetchLike;
  url: URL;
}): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= BUILDER_CMS_READ_RETRIES; attempt += 1) {
    try {
      const response = await args.fetchImpl(args.url, {
        headers: { accept: "application/json" },
      });
      if (
        !retryableBuilderReadStatus(response.status) ||
        attempt === BUILDER_CMS_READ_RETRIES
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === BUILDER_CMS_READ_RETRIES) {
        throw error;
      }
    }
    await sleep(25 * (attempt + 1));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Builder read failed.");
}

function appendUniqueBuilderEntries(
  target: BuilderCmsSourceEntry[],
  seen: Set<string>,
  entries: BuilderCmsSourceEntry[],
) {
  let appended = 0;
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    target.push(entry);
    appended += 1;
  }
  return appended;
}

function builderMcpEndpoint() {
  return (
    process.env.BUILDER_CMS_MCP_ENDPOINT ??
    "https://cdn.builder.io/api/v1/mcp/builder-content"
  ).replace(/\/+$/, "");
}

async function readBuilderPrivateKey() {
  return (
    (await resolveBuilderCredential("BUILDER_PRIVATE_KEY")) ??
    (await resolveBuilderCredential("BUILDER_CMS_PRIVATE_KEY"))
  );
}

function parseBuilderMcpToolJson(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const result = value as BuilderMcpToolResult;
  const text = result.content
    ?.filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function postBuilderMcp(args: {
  endpoint: string;
  privateKey: string;
  payload: Record<string, unknown>;
  sessionId?: string | null;
  fetchImpl: FetchLike;
}) {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${args.privateKey}`,
    "content-type": "application/json",
  };
  if (args.sessionId) headers["mcp-session-id"] = args.sessionId;
  const response = await args.fetchImpl(args.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(args.payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Builder MCP request failed with HTTP ${response.status}.`);
  }
  return {
    json: JSON.parse(text) as Record<string, unknown>,
    sessionId: response.headers.get("mcp-session-id"),
  };
}

function builderMcpEntriesFromToolResponse(
  response: unknown,
  model: string,
): BuilderCmsSourceEntry[] {
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  const entries =
    (Array.isArray(record.content) && record.content) ||
    (Array.isArray(record.results) && record.results) ||
    [];
  return entries
    .map((entry) => normalizeBuilderCmsApiEntry(entry, model))
    .filter((entry): entry is BuilderCmsSourceEntry => Boolean(entry));
}

function normalizeBuilderCmsModel(
  value: unknown,
): BuilderCmsModelSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  const id =
    typeof record.id === "string" && record.id.trim() ? record.id : name;
  const displayName =
    typeof record.displayName === "string" && record.displayName.trim()
      ? record.displayName.trim()
      : name;
  const kind =
    typeof record.kind === "string" && record.kind.trim()
      ? record.kind.trim()
      : "unknown";
  const fields = Array.isArray(record.fields)
    ? record.fields
        .map((field) => {
          if (!field || typeof field !== "object") return null;
          const fieldRecord = field as Record<string, unknown>;
          const fieldName =
            typeof fieldRecord.name === "string" ? fieldRecord.name.trim() : "";
          if (!fieldName) return null;
          const inputType =
            typeof fieldRecord.inputType === "string" &&
            fieldRecord.inputType.trim()
              ? fieldRecord.inputType.trim()
              : typeof fieldRecord.input === "string" &&
                  fieldRecord.input.trim()
                ? fieldRecord.input.trim()
                : undefined;
          const label =
            typeof fieldRecord.label === "string" && fieldRecord.label.trim()
              ? fieldRecord.label.trim()
              : typeof fieldRecord.friendlyName === "string" &&
                  fieldRecord.friendlyName.trim()
                ? fieldRecord.friendlyName.trim()
                : undefined;
          const enumOptions = stringOptionsFromUnknown(fieldRecord.enum);
          const options = stringOptionsFromUnknown(
            fieldRecord.options ?? fieldRecord.allowedValues,
          );
          return {
            name: fieldName,
            ...(label ? { label } : {}),
            type:
              typeof fieldRecord.type === "string" && fieldRecord.type.trim()
                ? fieldRecord.type.trim()
                : "unknown",
            ...(inputType ? { inputType } : {}),
            ...(enumOptions ? { enum: enumOptions } : {}),
            ...(options ? { options } : {}),
            required: fieldRecord.required === true,
          };
        })
        .filter((field): field is BuilderCmsModelSummary["fields"][number] =>
          Boolean(field),
        )
    : [];

  return { id, name, displayName, kind, fields };
}

function stringOptionsFromUnknown(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .map((option) => {
      if (typeof option === "string" || typeof option === "number") {
        return String(option).trim();
      }
      if (!option || typeof option !== "object") return "";
      const record = option as Record<string, unknown>;
      for (const key of ["label", "name", "value"]) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          return String(candidate);
        }
      }
      return "";
    })
    .filter(Boolean);
  return options.length > 0 ? Array.from(new Set(options)) : undefined;
}

function builderMcpModelsFromToolResponse(
  response: unknown,
): BuilderCmsModelSummary[] {
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  const models = Array.isArray(record.models) ? record.models : [];
  return models
    .map((model) => normalizeBuilderCmsModel(model))
    .filter((model): model is BuilderCmsModelSummary => Boolean(model))
    .sort((a, b) => {
      if (a.name === "agent-native-blog-article-test") return -1;
      if (b.name === "agent-native-blog-article-test") return 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

async function initializeBuilderMcp(args: {
  endpoint: string;
  privateKey: string;
  fetchImpl: FetchLike;
}) {
  const initialized = await postBuilderMcp({
    endpoint: args.endpoint,
    privateKey: args.privateKey,
    fetchImpl: args.fetchImpl,
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "agent-native-content-template",
          version: "0.1.0",
        },
      },
    },
  });
  const sessionId = initialized.sessionId;
  if (sessionId) {
    await postBuilderMcp({
      endpoint: args.endpoint,
      privateKey: args.privateKey,
      fetchImpl: args.fetchImpl,
      sessionId,
      payload: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
    }).catch(() => null);
  }
  return sessionId;
}

async function readBuilderCmsContentEntriesViaMcp(args: {
  model: string;
  limit?: number;
  maxPages?: number;
  offset?: number;
  fetchImpl: FetchLike;
  privateKey: string;
}): Promise<BuilderCmsReadResult> {
  const fetchedAt = new Date().toISOString();
  const endpoint = builderMcpEndpoint();
  const sessionId = await initializeBuilderMcp({
    endpoint,
    privateKey: args.privateKey,
    fetchImpl: args.fetchImpl,
  });

  const limit = readLimit(args.limit);
  const startOffset =
    typeof args.offset === "number" && Number.isFinite(args.offset)
      ? Math.max(0, Math.floor(args.offset))
      : 0;
  const contentEntries: BuilderCmsSourceEntry[] = [];
  const seenContentIds = new Set<string>();
  let pagesRead = 0;
  let hasMore = false;
  for (
    let offset = startOffset;
    startOffset + contentEntries.length < limit;
    offset += BUILDER_CMS_PAGE_SIZE
  ) {
    const pageLimit = readPageLimit(
      limit - startOffset - contentEntries.length,
    );
    const contentResult = await postBuilderMcp({
      endpoint,
      privateKey: args.privateKey,
      fetchImpl: args.fetchImpl,
      sessionId,
      payload: {
        jsonrpc: "2.0",
        id: `content-${offset}`,
        method: "tools/call",
        params: {
          name: "get_builder_content",
          arguments: {
            modelName: args.model,
            limit: pageLimit,
            offset,
            fields: BUILDER_CMS_ENTRY_FIELDS,
            enrich: true,
          },
        },
      },
    });
    const contentJson = parseBuilderMcpToolJson(contentResult.json.result);
    const pageEntries = builderMcpEntriesFromToolResponse(
      contentJson,
      args.model,
    );
    const appended = appendUniqueBuilderEntries(
      contentEntries,
      seenContentIds,
      pageEntries,
    );
    pagesRead += 1;
    hasMore =
      pageEntries.length >= pageLimit &&
      appended > 0 &&
      contentEntries.length < limit;
    if (args.maxPages && pagesRead >= args.maxPages) break;
    if (!hasMore) break;
  }
  if (contentEntries.length > 0) {
    return {
      state: "live",
      entries: contentEntries,
      fetchedAt,
      message: null,
      progress: {
        requestedLimit: limit,
        pageSize: BUILDER_CMS_PAGE_SIZE,
        startOffset,
        nextOffset: startOffset + contentEntries.length,
        fetchedEntryCount: startOffset + contentEntries.length,
        hasMore,
        partial: hasMore && Boolean(args.maxPages),
        readMode: "mcp",
      },
    };
  }

  const searchText =
    process.env.BUILDER_CMS_MCP_SEARCH_TEXT ??
    (args.model === "agent-native-blog-article-test"
      ? "Agent Native Test"
      : "");
  if (!searchText.trim()) {
    return {
      state: "live",
      entries: [],
      fetchedAt,
      message: null,
      progress: {
        requestedLimit: limit,
        pageSize: BUILDER_CMS_PAGE_SIZE,
        startOffset,
        nextOffset: startOffset,
        fetchedEntryCount: 0,
        hasMore: false,
        partial: false,
        readMode: "mcp",
      },
    };
  }

  const searchResult = await postBuilderMcp({
    endpoint,
    privateKey: args.privateKey,
    fetchImpl: args.fetchImpl,
    sessionId,
    payload: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search_builder_content",
        arguments: {
          searchText,
          limit,
          offset: 0,
          includeDrafts: true,
          returnFullContent: false,
        },
      },
    },
  });
  const searchJson = parseBuilderMcpToolJson(searchResult.json.result);
  const searchEntries = builderMcpEntriesFromToolResponse(
    searchJson,
    args.model,
  );
  const hydratedEntries: BuilderCmsSourceEntry[] = [];
  for (const entry of searchEntries) {
    const entryResult = await postBuilderMcp({
      endpoint,
      privateKey: args.privateKey,
      fetchImpl: args.fetchImpl,
      sessionId,
      payload: {
        jsonrpc: "2.0",
        id: `entry-${entry.id}`,
        method: "tools/call",
        params: {
          name: "get_builder_content",
          arguments: {
            modelName: args.model,
            limit: 1,
            query: { id: entry.id },
            fields: BUILDER_CMS_ENTRY_FIELDS,
            enrich: true,
          },
        },
      },
    }).catch(() => null);
    const entryJson = entryResult
      ? parseBuilderMcpToolJson(entryResult.json.result)
      : null;
    const [hydrated] = builderMcpEntriesFromToolResponse(entryJson, args.model);
    hydratedEntries.push(hydrated ?? entry);
  }

  return {
    state: "live",
    entries: hydratedEntries,
    fetchedAt,
    message: null,
    progress: {
      requestedLimit: limit,
      pageSize: BUILDER_CMS_PAGE_SIZE,
      startOffset,
      nextOffset: startOffset + hydratedEntries.length,
      fetchedEntryCount: startOffset + hydratedEntries.length,
      hasMore: false,
      partial: false,
      readMode: "mcp",
    },
  };
}

async function readBuilderCmsContentEntriesViaContentApi(args: {
  model: string;
  limit?: number;
  maxPages?: number;
  offset?: number;
  fetchImpl: FetchLike;
  publicKey: string;
}): Promise<BuilderCmsReadResult> {
  const fetchedAt = new Date().toISOString();
  const url = new URL(
    `/api/v3/content/${encodeURIComponent(args.model)}`,
    builderContentApiHost(),
  );
  url.searchParams.set("apiKey", args.publicKey);
  // Enrich expands reference fields (e.g. blog-article -> blog-author) inline so
  // mapped source columns can show the referenced entry's name instead of a
  // bare reference id.
  url.searchParams.set("enrich", "true");
  url.searchParams.set("noCache", "true");

  const limit = readLimit(args.limit);
  const startOffset =
    typeof args.offset === "number" && Number.isFinite(args.offset)
      ? Math.max(0, Math.floor(args.offset))
      : 0;
  const entries: BuilderCmsSourceEntry[] = [];
  const seenIds = new Set<string>();
  let pagesRead = 0;
  let hasMore = false;
  for (
    let offset = startOffset;
    startOffset + entries.length < limit;
    offset += BUILDER_CMS_PAGE_SIZE
  ) {
    const pageUrl = new URL(url);
    const pageLimit = readPageLimit(limit - startOffset - entries.length);
    pageUrl.searchParams.set("limit", String(pageLimit));
    pageUrl.searchParams.set("offset", String(offset));

    let response: Response;
    try {
      response = await fetchBuilderContentPage({
        fetchImpl: args.fetchImpl,
        url: pageUrl,
      });
    } catch (error) {
      return {
        state: "error",
        entries: [],
        fetchedAt,
        message:
          error instanceof Error
            ? `Builder CMS read failed: ${error.message}`
            : "Builder CMS read failed.",
        progress: {
          requestedLimit: limit,
          pageSize: BUILDER_CMS_PAGE_SIZE,
          startOffset,
          nextOffset: startOffset + entries.length,
          fetchedEntryCount: startOffset + entries.length,
          hasMore,
          partial: Boolean(args.maxPages) && hasMore,
          readMode: "builder-api",
        },
      };
    }

    if (!response.ok) {
      return {
        state: "error",
        entries: [],
        fetchedAt,
        message: `Builder CMS read failed with HTTP ${response.status}.`,
        progress: {
          requestedLimit: limit,
          pageSize: BUILDER_CMS_PAGE_SIZE,
          startOffset,
          nextOffset: startOffset + entries.length,
          fetchedEntryCount: startOffset + entries.length,
          hasMore,
          partial: Boolean(args.maxPages) && hasMore,
          readMode: "builder-api",
        },
      };
    }

    const json = (await response.json()) as unknown;
    const pageEntries = entryArrayFromResponse(json)
      .map((entry) => normalizeBuilderCmsApiEntry(entry, args.model))
      .filter((entry): entry is BuilderCmsSourceEntry => Boolean(entry));
    const appended = appendUniqueBuilderEntries(entries, seenIds, pageEntries);
    pagesRead += 1;
    hasMore =
      pageEntries.length >= pageLimit && appended > 0 && entries.length < limit;
    if (args.maxPages && pagesRead >= args.maxPages) break;
    if (!hasMore) break;
  }

  return {
    state: "live",
    entries,
    fetchedAt,
    message: null,
    progress: {
      requestedLimit: limit,
      pageSize: BUILDER_CMS_PAGE_SIZE,
      startOffset,
      nextOffset: startOffset + entries.length,
      fetchedEntryCount: startOffset + entries.length,
      hasMore,
      partial: hasMore && Boolean(args.maxPages),
      readMode: "builder-api",
    },
  };
}

export async function readBuilderCmsEntryLiveState(args: {
  model: string;
  entryId: string;
  fetchImpl?: FetchLike;
}): Promise<BuilderCmsEntryLiveState> {
  const publicKey = await resolveBuilderCredential("BUILDER_PUBLIC_KEY");
  if (!publicKey) {
    throw new Error(
      "Builder CMS live entry read skipped because BUILDER_PUBLIC_KEY is not configured.",
    );
  }

  const url = new URL(
    `/api/v3/content/${encodeURIComponent(args.model)}/${encodeURIComponent(
      args.entryId,
    )}`,
    builderContentApiHost(),
  );
  url.searchParams.set("apiKey", publicKey);
  url.searchParams.set("includeUnpublished", "true");
  url.searchParams.set("cachebust", String(Date.now()));

  const response = await fetchBuilderContentPage({
    fetchImpl: args.fetchImpl ?? fetch,
    url,
  });
  if (response.status === 404) {
    return {
      exists: false,
      published: null,
      lastUpdated: null,
      blocksHash: null,
      id: null,
    };
  }
  if (!response.ok) {
    throw new Error(
      `Builder CMS live entry read failed with HTTP ${response.status}.`,
    );
  }

  const json = (await response.json()) as unknown;
  return liveStateFromBuilderEntry(json);
}

export async function readBuilderCmsContentEntry(args: {
  model: string;
  entryId: string;
  fetchImpl?: FetchLike;
}): Promise<BuilderCmsSourceEntry | null> {
  const publicKey = await resolveBuilderCredential("BUILDER_PUBLIC_KEY");
  if (!publicKey) {
    throw new Error(
      "Builder CMS entry read skipped because BUILDER_PUBLIC_KEY is not configured.",
    );
  }

  const url = new URL(
    `/api/v3/content/${encodeURIComponent(args.model)}/${encodeURIComponent(
      args.entryId,
    )}`,
    builderContentApiHost(),
  );
  url.searchParams.set("apiKey", publicKey);
  url.searchParams.set("includeUnpublished", "true");
  url.searchParams.set("enrich", "true");
  url.searchParams.set("noCache", "true");
  url.searchParams.set("cachebust", String(Date.now()));
  url.searchParams.set("fields", BUILDER_CMS_ENTRY_FIELDS);

  const response = await fetchBuilderContentPage({
    fetchImpl: args.fetchImpl ?? fetch,
    url,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Builder CMS entry read failed with HTTP ${response.status}.`,
    );
  }

  const json = (await response.json()) as unknown;
  const rawEntry = Array.isArray(json)
    ? json[0]
    : (entryArrayFromResponse(json)[0] ?? json);
  const entry = normalizeBuilderCmsApiEntry(rawEntry, args.model);
  return entry?.id === args.entryId ? entry : null;
}

export async function listBuilderCmsModels(
  args: {
    fetchImpl?: FetchLike;
  } = {},
): Promise<BuilderCmsModelsResponse> {
  const fetchedAt = new Date().toISOString();
  const privateKey = await readBuilderPrivateKey();
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!privateKey) {
    return {
      state: "unconfigured",
      models: [],
      fetchedAt,
      message:
        "Builder CMS model discovery skipped because BUILDER_PRIVATE_KEY is not configured.",
    };
  }

  try {
    const endpoint = builderMcpEndpoint();
    const sessionId = await initializeBuilderMcp({
      endpoint,
      privateKey,
      fetchImpl,
    });
    const modelsResult = await postBuilderMcp({
      endpoint,
      privateKey,
      fetchImpl,
      sessionId,
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "list_builder_models",
          arguments: {},
        },
      },
    });
    const modelsJson = parseBuilderMcpToolJson(modelsResult.json.result);
    return {
      state: "live",
      models: builderMcpModelsFromToolResponse(modelsJson),
      fetchedAt,
      message: null,
    };
  } catch (error) {
    return {
      state: "error",
      models: [],
      fetchedAt,
      message:
        error instanceof Error
          ? error.message
          : "Builder CMS model discovery failed.",
    };
  }
}

export async function readBuilderCmsModelFields(args: {
  model: string;
  fetchImpl?: FetchLike;
}): Promise<BuilderCmsModelFieldSummary[]> {
  const models = await listBuilderCmsModels({ fetchImpl: args.fetchImpl });
  if (models.state !== "live") return [];
  const modelName = args.model.trim().toLowerCase();
  return (
    models.models.find((model) => {
      return (
        model.name.trim().toLowerCase() === modelName ||
        model.id.trim().toLowerCase() === modelName ||
        model.displayName.trim().toLowerCase() === modelName
      );
    })?.fields ?? []
  );
}

export async function readBuilderCmsContentEntries(args: {
  model: string;
  limit?: number;
  maxPages?: number;
  offset?: number;
  fetchImpl?: FetchLike;
}): Promise<BuilderCmsReadResult> {
  const fetchedAt = new Date().toISOString();
  const privateKey = await readBuilderPrivateKey();
  const fetchImpl = args.fetchImpl ?? fetch;
  const publicKey = await resolveBuilderCredential("BUILDER_PUBLIC_KEY");
  if (publicKey) {
    const contentApiRead = await readBuilderCmsContentEntriesViaContentApi({
      model: args.model,
      limit: args.limit,
      maxPages: args.maxPages,
      offset: args.offset,
      fetchImpl,
      publicKey,
    });
    if (contentApiRead.state === "live" && contentApiRead.entries.length > 0) {
      return contentApiRead;
    }
    if (!privateKey) return contentApiRead;
  }

  if (privateKey) {
    try {
      return await readBuilderCmsContentEntriesViaMcp({
        model: args.model,
        limit: args.limit,
        maxPages: args.maxPages,
        offset: args.offset,
        fetchImpl,
        privateKey,
      });
    } catch (error) {
      return {
        state: "error",
        entries: [],
        fetchedAt,
        message:
          error instanceof Error
            ? error.message
            : "Builder CMS MCP read failed.",
        progress: {
          requestedLimit: readLimit(args.limit),
          pageSize: BUILDER_CMS_PAGE_SIZE,
          startOffset: 0,
          nextOffset: 0,
          fetchedEntryCount: 0,
          hasMore: false,
          partial: false,
          readMode: "mcp",
        },
      };
    }
  }

  if (!publicKey) {
    return {
      state: "unconfigured",
      entries: [],
      fetchedAt,
      message:
        "Builder CMS read skipped because BUILDER_PUBLIC_KEY is not configured.",
      progress: {
        requestedLimit: readLimit(args.limit),
        pageSize: BUILDER_CMS_PAGE_SIZE,
        startOffset: 0,
        nextOffset: 0,
        fetchedEntryCount: 0,
        hasMore: false,
        partial: false,
        readMode: "none",
      },
    };
  }

  return {
    state: "error",
    entries: [],
    fetchedAt,
    message: "Builder CMS read returned no entries.",
    progress: {
      requestedLimit: readLimit(args.limit),
      pageSize: BUILDER_CMS_PAGE_SIZE,
      startOffset: 0,
      nextOffset: 0,
      fetchedEntryCount: 0,
      hasMore: false,
      partial: false,
      readMode: "none",
    },
  };
}
