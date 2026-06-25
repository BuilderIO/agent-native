import { resolveBuilderCredential } from "@agent-native/core/server";

import type {
  BuilderCmsModelFieldSummary,
  BuilderCmsModelSummary,
  BuilderCmsModelsResponse,
} from "../shared/api.js";
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
  "id,name,published,lastUpdated,createdDate,data.title,data.handle,data.url,data.slug,data.date,data.description,data.status,data.author,data.image";

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
          return {
            name: fieldName,
            type:
              typeof fieldRecord.type === "string" && fieldRecord.type.trim()
                ? fieldRecord.type.trim()
                : "unknown",
            required: fieldRecord.required === true,
          };
        })
        .filter((field): field is BuilderCmsModelSummary["fields"][number] =>
          Boolean(field),
        )
    : [];

  return { id, name, displayName, kind, fields };
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
  const contentEntries: BuilderCmsSourceEntry[] = [];
  const seenContentIds = new Set<string>();
  for (
    let offset = 0;
    contentEntries.length < limit;
    offset += BUILDER_CMS_PAGE_SIZE
  ) {
    const pageLimit = readPageLimit(limit - contentEntries.length);
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
    if (pageEntries.length < pageLimit || appended === 0) break;
  }
  if (contentEntries.length > 0) {
    return {
      state: "live",
      entries: contentEntries,
      fetchedAt,
      message: null,
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
  };
}

async function readBuilderCmsContentEntriesViaContentApi(args: {
  model: string;
  limit?: number;
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
  const entries: BuilderCmsSourceEntry[] = [];
  const seenIds = new Set<string>();
  for (
    let offset = 0;
    entries.length < limit;
    offset += BUILDER_CMS_PAGE_SIZE
  ) {
    const pageUrl = new URL(url);
    const pageLimit = readPageLimit(limit - entries.length);
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
      };
    }

    if (!response.ok) {
      return {
        state: "error",
        entries: [],
        fetchedAt,
        message: `Builder CMS read failed with HTTP ${response.status}.`,
      };
    }

    const json = (await response.json()) as unknown;
    const pageEntries = entryArrayFromResponse(json)
      .map((entry) => normalizeBuilderCmsApiEntry(entry, args.model))
      .filter((entry): entry is BuilderCmsSourceEntry => Boolean(entry));
    const appended = appendUniqueBuilderEntries(entries, seenIds, pageEntries);
    if (pageEntries.length < pageLimit || appended === 0) break;
  }

  return {
    state: "live",
    entries,
    fetchedAt,
    message: null,
  };
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
    };
  }

  return {
    state: "error",
    entries: [],
    fetchedAt,
    message: "Builder CMS read returned no entries.",
  };
}
