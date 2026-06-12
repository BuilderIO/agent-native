import { resolveBuilderCredential } from "@agent-native/core/server";
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
    return Math.min(Math.floor(limit), 100);
  }
  const envLimit = Number(process.env.BUILDER_CMS_READ_LIMIT);
  if (Number.isFinite(envLimit) && envLimit > 0) {
    return Math.min(Math.floor(envLimit), 100);
  }
  return 20;
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

async function readBuilderCmsContentEntriesViaMcp(args: {
  model: string;
  limit?: number;
  fetchImpl: FetchLike;
  privateKey: string;
}): Promise<BuilderCmsReadResult> {
  const fetchedAt = new Date().toISOString();
  const endpoint = builderMcpEndpoint();
  const initialized = await postBuilderMcp({
    endpoint,
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
      endpoint,
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

  const limit = readLimit(args.limit);
  const contentResult = await postBuilderMcp({
    endpoint,
    privateKey: args.privateKey,
    fetchImpl: args.fetchImpl,
    sessionId,
    payload: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_builder_content",
        arguments: {
          modelName: args.model,
          limit,
          fields: "id,name,published,lastUpdated,createdDate,data.title,data.handle,data.url,data.date",
        },
      },
    },
  });
  const contentJson = parseBuilderMcpToolJson(contentResult.json.result);
  const contentEntries = builderMcpEntriesFromToolResponse(
    contentJson,
    args.model,
  );
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
            fields:
              "id,name,published,lastUpdated,createdDate,data.title,data.handle,data.url,data.date",
          },
        },
      },
    }).catch(() => null);
    const entryJson = entryResult
      ? parseBuilderMcpToolJson(entryResult.json.result)
      : null;
    const [hydrated] = builderMcpEntriesFromToolResponse(
      entryJson,
      args.model,
    );
    hydratedEntries.push(hydrated ?? entry);
  }

  return {
    state: "live",
    entries: hydratedEntries,
    fetchedAt,
    message: null,
  };
}

export async function readBuilderCmsContentEntries(args: {
  model: string;
  limit?: number;
  fetchImpl?: FetchLike;
}): Promise<BuilderCmsReadResult> {
  const fetchedAt = new Date().toISOString();
  const privateKey = await readBuilderPrivateKey();
  const fetchImpl = args.fetchImpl ?? fetch;
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

  const publicKey = await resolveBuilderCredential("BUILDER_PUBLIC_KEY");
  if (!publicKey) {
    return {
      state: "unconfigured",
      entries: [],
      fetchedAt,
      message:
        "Builder CMS read skipped because BUILDER_PUBLIC_KEY is not configured.",
    };
  }

  const url = new URL(
    `/api/v3/content/${encodeURIComponent(args.model)}`,
    builderContentApiHost(),
  );
  url.searchParams.set("apiKey", publicKey);
  url.searchParams.set("limit", String(readLimit(args.limit)));
  url.searchParams.set("enrich", "false");
  url.searchParams.set("noCache", "true");

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    return {
      state: "error",
      entries: [],
      fetchedAt,
      message: `Builder CMS read failed with HTTP ${response.status}.`,
    };
  }

  const json = (await response.json()) as unknown;
  const entries = entryArrayFromResponse(json)
    .map((entry) => normalizeBuilderCmsApiEntry(entry, args.model))
    .filter((entry): entry is BuilderCmsSourceEntry => Boolean(entry));

  return {
    state: "live",
    entries,
    fetchedAt,
    message: null,
  };
}
