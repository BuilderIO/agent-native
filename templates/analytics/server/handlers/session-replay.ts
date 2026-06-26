import { gunzipSync } from "node:zlib";

import {
  defineEventHandler,
  getHeader,
  getQuery,
  getRouterParam,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { runApiHandlerWithContext } from "../lib/credentials";
import {
  getSessionReplayManifest,
  getSessionReplayEvents,
  getSessionReplaySummary,
  listSessionRecordings,
  parseSessionReplayIngestPayload,
  recordSessionReplayChunks,
  readSessionReplayChunkBytes,
  type SessionReplayListFilters,
} from "../lib/session-replay.js";

const PUBLIC_KEY_QUERY_NAMES = new Set([
  "apiKey",
  "analyticsKey",
  "key",
  "publicKey",
  "writeKey",
]);

function readOrigin(event: any): string | null {
  const origin = getHeader(event, "origin");
  if (typeof origin === "string" && origin.trim()) return origin.trim();
  return null;
}

function setCors(event: any): void {
  const origin = readOrigin(event);
  if (origin) {
    setResponseHeader(event, "Access-Control-Allow-Origin", origin);
    setResponseHeader(event, "Vary", "Origin");
  }
  setResponseHeader(
    event,
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS",
  );
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "content-type, content-encoding, x-agent-native-analytics-key",
  );
  setResponseHeader(event, "Access-Control-Max-Age", "86400");
}

function statusFromError(error: any): number {
  return typeof error?.statusCode === "number" ? error.statusCode : 400;
}

function messageFromError(error: any): string {
  return error?.message || String(error);
}

function hasQueryKey(query: Record<string, unknown>): boolean {
  return Object.keys(query).some((key) => PUBLIC_KEY_QUERY_NAMES.has(key));
}

function injectHeaderKey(body: unknown, headerKey?: string): unknown {
  if (!headerKey) return body;
  if (typeof body === "string" && body.trim()) {
    return { ...JSON.parse(body), publicKey: headerKey };
  }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), publicKey: headerKey };
  }
  return { publicKey: headerKey };
}

function statusError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function decodeSessionReplayRequestBody(
  rawBody: Buffer | Uint8Array | string | undefined,
  contentEncoding?: string | null,
): { body: unknown; requestBytes: number } {
  const requestBytes =
    typeof rawBody === "string"
      ? Buffer.byteLength(rawBody, "utf8")
      : (rawBody?.byteLength ?? 0);
  const bytes = Buffer.isBuffer(rawBody)
    ? rawBody
    : rawBody instanceof Uint8Array
      ? Buffer.from(rawBody)
      : Buffer.from(rawBody ?? "", "utf8");
  const encoding = (contentEncoding ?? "").split(";")[0]?.trim().toLowerCase();
  let decoded = bytes;

  if (encoding === "gzip" || encoding === "x-gzip") {
    try {
      decoded = gunzipSync(bytes);
    } catch {
      throw statusError("Invalid gzip-compressed replay body", 400);
    }
  } else if (encoding && encoding !== "identity") {
    throw statusError(
      `Unsupported replay request content-encoding: ${encoding}`,
      415,
    );
  }

  const text = decoded.toString("utf8");
  if (!text.trim()) {
    return { body: undefined, requestBytes };
  }
  try {
    return { body: JSON.parse(text), requestBytes };
  } catch {
    return { body: text, requestBytes };
  }
}

async function readSessionReplayRequestBody(
  event: any,
): Promise<{ body: unknown; requestBytes: number }> {
  const rawBody = await readRawBody(event, false);
  return decodeSessionReplayRequestBody(
    rawBody,
    getHeader(event, "content-encoding"),
  );
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return undefined;
}

function asInt(value: unknown): number | undefined {
  const raw = asString(value);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function asBool(value: unknown): boolean | undefined {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return undefined;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return undefined;
}

function asStatus(value: unknown): "active" | "completed" | undefined {
  const raw = asString(value);
  return raw === "active" || raw === "completed" ? raw : undefined;
}

function listFiltersFromQuery(
  query: Record<string, unknown>,
): SessionReplayListFilters {
  return {
    query: asString(query.query) ?? asString(query.q),
    app: asString(query.app),
    template: asString(query.template),
    sessionId: asString(query.sessionId),
    userId: asString(query.userId),
    anonymousId: asString(query.anonymousId),
    path: asString(query.path),
    from: asString(query.from),
    to: asString(query.to),
    minDurationMs: asInt(query.minDurationMs),
    hasErrors: asBool(query.hasErrors),
    hasRageClicks: asBool(query.hasRageClicks),
    status: asStatus(query.status),
    limit: asInt(query.limit),
  };
}

export const handleSessionReplayOptions = defineEventHandler((event) => {
  setCors(event);
  setResponseStatus(event, 204);
  return "";
});

export const handleSessionReplayIngest = defineEventHandler(async (event) => {
  setCors(event);
  try {
    const query = getQuery(event);
    if (hasQueryKey(query)) {
      throw Object.assign(
        new Error(
          "Analytics public keys must be sent in the request body or x-agent-native-analytics-key header, not the query string",
        ),
        { statusCode: 400 },
      );
    }

    const headerKey = getHeader(event, "x-agent-native-analytics-key");
    const { body: rawBody, requestBytes } =
      await readSessionReplayRequestBody(event);
    const body = injectHeaderKey(rawBody, headerKey);
    const parsed = parseSessionReplayIngestPayload(body);
    const result = await recordSessionReplayChunks(parsed, {
      origin: readOrigin(event),
      requestBytes,
    });
    setResponseStatus(event, 202);
    return { success: true, ...result };
  } catch (error: any) {
    setResponseStatus(event, statusFromError(error));
    return { error: messageFromError(error) };
  }
});

export const handleSessionReplayList = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async (ctx) => {
    try {
      const recordings = await listSessionRecordings(
        { userEmail: ctx.userEmail, orgId: ctx.orgId ?? null },
        listFiltersFromQuery(getQuery(event)),
      );
      return { recordings };
    } catch (error: any) {
      setResponseStatus(event, statusFromError(error));
      return { error: messageFromError(error) };
    }
  });
});

export const handleSessionReplaySummary = defineEventHandler(async (event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  return runApiHandlerWithContext(event, async (ctx) => {
    try {
      const recording = await getSessionReplaySummary(recordingId, {
        userEmail: ctx.userEmail,
        orgId: ctx.orgId ?? null,
      });
      return { recording };
    } catch (error: any) {
      setResponseStatus(event, statusFromError(error));
      return { error: messageFromError(error) };
    }
  });
});

export const handleSessionReplayEvents = defineEventHandler(async (event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  return runApiHandlerWithContext(event, async (ctx) => {
    try {
      const query = getQuery(event);
      return await getSessionReplayEvents(
        recordingId,
        { userEmail: ctx.userEmail, orgId: ctx.orgId ?? null },
        {
          startSeq: asInt(query.startSeq),
          endSeq: asInt(query.endSeq),
          limit: asInt(query.limit),
        },
      );
    } catch (error: any) {
      setResponseStatus(event, statusFromError(error));
      return { error: messageFromError(error) };
    }
  });
});

export const handleSessionReplayManifest = defineEventHandler(async (event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  return runApiHandlerWithContext(event, async (ctx) => {
    try {
      return await getSessionReplayManifest(recordingId, {
        userEmail: ctx.userEmail,
        orgId: ctx.orgId ?? null,
      });
    } catch (error: any) {
      setResponseStatus(event, statusFromError(error));
      return { error: messageFromError(error) };
    }
  });
});

export const handleSessionReplayChunkBytes = defineEventHandler(
  async (event) => {
    const recordingId = getRouterParam(event, "recordingId");
    const seqRaw = getRouterParam(event, "seq");
    const seq = asInt(seqRaw);
    if (!recordingId || seq === undefined) {
      setResponseStatus(event, 400);
      return { error: "Missing recordingId or seq" };
    }

    return runApiHandlerWithContext(event, async (ctx) => {
      try {
        const result = await readSessionReplayChunkBytes(recordingId, seq, {
          userEmail: ctx.userEmail,
          orgId: ctx.orgId ?? null,
        });
        setResponseHeader(event, "Content-Type", "application/json");
        setResponseHeader(event, "Content-Encoding", "gzip");
        setResponseHeader(event, "Cache-Control", "no-store");
        setResponseHeader(event, "X-Session-Replay-Seq", String(result.seq));
        setResponseHeader(event, "X-Session-Replay-Checksum", result.checksum);
        return result.data;
      } catch (error: any) {
        setResponseStatus(event, statusFromError(error));
        return { error: messageFromError(error) };
      }
    });
  },
);
