import {
  createError,
  defineEventHandler,
  getRouterParam,
  getHeader,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { readBrowserTabIdHeader } from "../server/agent-run-context.js";
import { readBody } from "../server/h3-helpers.js";
import {
  APP_STATE_BATCH_ROUTE_HEADER,
  APP_STATE_SEQ_HEADER,
  APP_STATE_WRITER_HEADER,
  TAB_SCOPED_APP_STATE_KEYS,
} from "../shared/app-state-routes.js";
import { appStateKeyForBrowserTab } from "./script-helpers.js";
import {
  appStateGet,
  appStateGetManyEntries,
  appStatePut,
  appStateCompareAndSet,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
  type AppStateWriteOrder,
} from "./store.js";

export const APP_STATE_ANONYMOUS_OWNER_CONTEXT_KEY =
  "agentNativeAppStateAnonymousOwner";

export type AppStateAnonymousOwnerResolver = (
  event: H3Event,
) => string | null | Promise<string | null>;

async function getSessionId(event: H3Event): Promise<string> {
  const { getSession } = await import("../server/auth.js");
  const session = await getSession(event);
  if (session?.email) return session.email;
  const anonymousOwner = event.context?.[
    APP_STATE_ANONYMOUS_OWNER_CONTEXT_KEY
  ] as AppStateAnonymousOwnerResolver | undefined;
  const owner = await anonymousOwner?.(event);
  if (owner) return owner;
  throw createError({
    statusCode: 401,
    statusMessage: "Unauthenticated",
  });
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_:-]/g, "");
}

const APP_STATE_WRITER_PATTERN = /^[a-zA-Z0-9_:-]{1,128}$/;

/**
 * The order a browser page gave a write (see AppStateWriteOrder): its writer
 * header plus a sequence number from the sequence header or a batch item's
 * `seq`. A write with neither is unordered; one with a malformed or partial
 * order is rejected rather than applied out of order.
 */
function writeOrder(
  event: H3Event,
  seq: unknown,
): AppStateWriteOrder | undefined {
  const writer = getHeader(event, APP_STATE_WRITER_HEADER);
  if (writer === undefined && seq === undefined) return undefined;
  if (
    writer === undefined ||
    !APP_STATE_WRITER_PATTERN.test(writer) ||
    typeof seq !== "number" ||
    !Number.isSafeInteger(seq) ||
    seq < 1
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `${APP_STATE_WRITER_HEADER} and a positive integer sequence must be sent together`,
    });
  }
  return { writer, seq };
}

// The sequence header as a number when it's all digits, else as sent, so
// writeOrder rejects it.
function headerSeq(event: H3Event): unknown {
  const seq = getHeader(event, APP_STATE_SEQ_HEADER);
  return seq !== undefined && /^[0-9]{1,16}$/.test(seq) ? Number(seq) : seq;
}

function requestScopedKey(key: string, event: H3Event): string {
  return TAB_SCOPED_APP_STATE_KEYS.has(key)
    ? appStateKeyForBrowserTab(key, readBrowserTabIdHeader(event))
    : key;
}

export const getState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = requestScopedKey(
    safeKey(String(getRouterParam(event, "key"))),
    event,
  );
  const value = await appStateGet(sessionId, key);
  return value ?? null;
});

export const MAX_APP_STATE_BATCH_KEYS = 100;

export const getStateMany = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const raw = getQuery(event).keys;
  const requested = [
    ...new Set(
      (Array.isArray(raw) ? raw : [raw])
        .flatMap((entry) => String(entry ?? "").split(","))
        .map((key) => safeKey(key.trim()))
        .filter((key) => key.length > 0),
    ),
  ];
  const storageKeys = requested.map((key) => requestScopedKey(key, event));
  const keys = [...new Set(storageKeys)];

  if (keys.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Query parameter `keys` is required",
    });
  }
  if (keys.length > MAX_APP_STATE_BATCH_KEYS) {
    throw createError({
      statusCode: 400,
      statusMessage: `At most ${MAX_APP_STATE_BATCH_KEYS} keys may be read at once`,
    });
  }

  const entries = await appStateGetManyEntries(sessionId, keys);
  const entriesByKey = new Map(
    entries.map((entry) => [entry.key, entry.value]),
  );
  const values: Record<string, unknown> = {};
  requested.forEach((key, index) => {
    const storageKey = storageKeys[index];
    if (storageKey !== undefined && entriesByKey.has(storageKey)) {
      values[key] = entriesByKey.get(storageKey);
    }
  });
  return {
    values,
    missing: requested.filter((key) => !(key in values)),
  };
});

export const putState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = requestScopedKey(
    safeKey(String(getRouterParam(event, "key"))),
    event,
  );
  const order = writeOrder(event, headerSeq(event));
  const body = await readBody(event);
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStatePut(sessionId, key, body, { requestSource, order });
  return body;
});

export const MAX_APP_STATE_BATCH_WRITES = 100;

type AppStateBatchWrite =
  | { key: string; value: unknown; requestSource?: string; seq?: number }
  | { key: string; delete: true; requestSource?: string; seq?: number };

// A write sets a value or deletes the key, never both: an entry that carries
// a value alongside any `delete`, or a `delete` other than true, is rejected
// rather than guessed at.
function isBatchWrite(write: unknown): write is AppStateBatchWrite {
  if (!write || typeof write !== "object") return false;
  const entry = write as Record<string, unknown>;
  if (typeof entry.key !== "string") return false;
  if ("value" in entry) return !("delete" in entry);
  return entry.delete === true;
}

type AppStateBatchWriteResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

/**
 * Applies several PUT or DELETE writes from one browser tab in one request,
 * each exactly as its own route would. The client sends at most one write per
 * key in a batch, so the writes run in parallel. Each write answers on its
 * own: one failing doesn't fail the others.
 */
export const putStateMany = defineEventHandler(async (event: H3Event) => {
  setResponseHeader(event, APP_STATE_BATCH_ROUTE_HEADER, "1");
  const sessionId = await getSessionId(event);
  const body = (await readBody(event)) as { writes?: unknown } | null;
  const writes = body?.writes;
  if (
    !Array.isArray(writes) ||
    writes.length === 0 ||
    !writes.every(isBatchWrite)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "`writes` must list { key, value } or { key, delete: true } entries",
    });
  }
  if (writes.length > MAX_APP_STATE_BATCH_WRITES) {
    throw createError({
      statusCode: 400,
      statusMessage: `At most ${MAX_APP_STATE_BATCH_WRITES} keys may be written at once`,
    });
  }
  const results = await Promise.all(
    (writes as AppStateBatchWrite[]).map(
      async (write): Promise<AppStateBatchWriteResult> => {
        const key = requestScopedKey(safeKey(write.key), event);
        try {
          const options = {
            ...(typeof write.requestSource === "string" && write.requestSource
              ? { requestSource: write.requestSource }
              : {}),
            order: writeOrder(event, write.seq),
          };
          if (!("value" in write)) {
            await appStateDelete(sessionId, key, options);
            return { ok: true, value: { ok: true } };
          }
          // Like the per-key route, which stores whatever body it's sent.
          await appStatePut(
            sessionId,
            key,
            write.value as Record<string, unknown>,
            options,
          );
          return { ok: true, value: write.value };
        } catch (error) {
          const status =
            (error as { statusCode?: unknown }).statusCode ??
            (error as { status?: unknown }).status;
          return {
            ok: false,
            status: typeof status === "number" ? status : 500,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    ),
  );
  return { results };
});

export const compareAndSetState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = requestScopedKey(
    safeKey(String(getRouterParam(event, "key"))),
    event,
  );
  const body = (await readBody(event)) as {
    expected?: Record<string, unknown> | null;
    next?: Record<string, unknown> | null;
  };
  if (!("expected" in body) || !("next" in body)) {
    throw createError({
      statusCode: 400,
      statusMessage: "expected and next are required",
    });
  }
  const requestSource = getHeader(event, "x-request-source") || undefined;
  return {
    changed: await appStateCompareAndSet(
      sessionId,
      key,
      body.expected ?? null,
      body.next ?? null,
      { requestSource },
    ),
  };
});

export const deleteState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = requestScopedKey(
    safeKey(String(getRouterParam(event, "key"))),
    event,
  );
  const order = writeOrder(event, headerSeq(event));
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStateDelete(sessionId, key, { requestSource, order });
  return { ok: true };
});

function composeDraftKey(id: string): string {
  return `compose-${safeKey(id)}`;
}

export const listComposeDrafts = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const items = await appStateList(sessionId, "compose-");
  return items.map((item) => item.value);
});

export const getComposeDraft = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const id = getRouterParam(event, "id") as string;
  const value = await appStateGet(sessionId, composeDraftKey(id));
  return value ?? null;
});

export const putComposeDraft = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const id = getRouterParam(event, "id") as string;
  const body = await readBody(event);
  const { subject, body: bodyText } = body;

  if (typeof subject !== "string" || typeof bodyText !== "string") {
    setResponseStatus(event, 400);
    return { error: "subject and body are required strings" };
  }

  const state = { ...body, id };
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStatePut(sessionId, composeDraftKey(id), state, { requestSource });
  return state;
});

export const deleteComposeDraft = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const id = getRouterParam(event, "id") as string;
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStateDelete(sessionId, composeDraftKey(id), { requestSource });
  return { ok: true };
});

export const deleteAllComposeDrafts = defineEventHandler(
  async (event: H3Event) => {
    const sessionId = await getSessionId(event);
    const requestSource = getHeader(event, "x-request-source") || undefined;
    await appStateDeleteByPrefix(sessionId, "compose-", { requestSource });
    return { ok: true };
  },
);
