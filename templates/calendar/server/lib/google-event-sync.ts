import {
  calendarBatchListEvents,
  GoogleApiError,
  type CalendarEventListParams,
} from "./google-api.js";

type ProviderEvent = Record<string, unknown> & { id: string };
type SyncSnapshot = {
  events: ProviderEvent[];
  token: string;
  updatedAt: number;
};
type SyncRequest = {
  owner: string;
  orgId: string | null | undefined;
  account: string;
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  eventTypes: string[];
  maxResults: number;
};

const snapshots = new Map<string, SyncSnapshot>();
const pending = new Map<string, Promise<ProviderEvent[]>>();
const MAX_SNAPSHOTS = 64;
const MAX_AGE_MS = 30 * 60 * 1000;

type BatchItem = {
  calendarId: string;
  params: CalendarEventListParams;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};
const batches = new Map<string, BatchItem[]>();

function batchList(
  accessToken: string,
  calendarId: string,
  params: CalendarEventListParams,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const batch = batches.get(accessToken);
    if (batch) {
      batch.push({ calendarId, params, resolve, reject });
      return;
    }
    const items: BatchItem[] = [{ calendarId, params, resolve, reject }];
    batches.set(accessToken, items);
    queueMicrotask(() => {
      batches.delete(accessToken);
      for (let start = 0; start < items.length; start += 100) {
        const chunk = items.slice(start, start + 100);
        void calendarBatchListEvents(
          accessToken,
          chunk.map(({ calendarId, params }) => ({ calendarId, params })),
        )
          .then((results) => {
            if (results.length !== chunk.length)
              throw new Error("Calendar batch response is incomplete");
            results.forEach((result, index) => {
              const item = chunk.find((_, position) => position === index);
              if (!item)
                throw new Error("Calendar batch response is incomplete");
              if (result.status === "fulfilled") item.resolve(result.value);
              else item.reject(result.reason);
            });
          })
          .catch((error: unknown) => {
            for (const item of chunk) item.reject(error);
          });
      }
    });
  });
}

function eventTime(event: ProviderEvent, field: "start" | "end"): number {
  const value = event[field];
  if (!value || typeof value !== "object")
    throw new Error("Google event is missing its time");
  const time = value as { date?: unknown; dateTime?: unknown };
  const text = typeof time.dateTime === "string" ? time.dateTime : time.date;
  if (typeof text !== "string" || !Number.isFinite(Date.parse(text)))
    throw new Error("Google event has an invalid time");
  return Date.parse(text);
}

function inRange(event: ProviderEvent, from: number, to: number): boolean {
  return eventTime(event, "end") >= from && eventTime(event, "start") <= to;
}

async function readPages(request: SyncRequest, token?: string) {
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const events: ProviderEvent[] = [];
  do {
    const page = await batchList(request.accessToken, request.calendarId, {
      ...(token
        ? { syncToken: token }
        : { timeMin: request.timeMin, timeMax: request.timeMax }),
      singleEvents: true,
      showDeleted: true,
      eventTypes: request.eventTypes,
      maxResults: request.maxResults,
      ...(pageToken ? { pageToken } : {}),
    });
    if (!page || typeof page !== "object")
      throw new Error("Invalid Google Calendar response");
    const result = page as {
      items?: unknown;
      nextPageToken?: unknown;
      nextSyncToken?: unknown;
    };
    if (result.items !== undefined && !Array.isArray(result.items))
      throw new Error("Invalid Google Calendar events");
    for (const event of result.items ?? []) {
      if (
        !event ||
        typeof event !== "object" ||
        typeof event.id !== "string" ||
        !event.id
      )
        throw new Error("Google Calendar returned an event without an id");
      events.push(event as ProviderEvent);
    }
    if (
      result.nextPageToken !== undefined &&
      typeof result.nextPageToken !== "string"
    )
      throw new Error("Invalid Google Calendar page cursor");
    if (
      result.nextSyncToken !== undefined &&
      typeof result.nextSyncToken !== "string"
    )
      throw new Error("Invalid Google Calendar sync cursor");
    pageToken = result.nextPageToken || undefined;
    nextSyncToken = result.nextSyncToken || undefined;
  } while (pageToken);
  if (!nextSyncToken)
    throw new Error("Google Calendar did not return a sync cursor");
  return { events, token: nextSyncToken };
}

export async function listSyncedGoogleEvents(
  request: SyncRequest,
): Promise<ProviderEvent[]> {
  const cacheKey = JSON.stringify([
    request.orgId ?? null,
    request.owner.toLowerCase(),
    request.account.toLowerCase(),
    request.calendarId,
    request.timeMin,
    request.timeMax,
    request.eventTypes,
    request.maxResults,
  ]);
  const existing = pending.get(cacheKey);
  if (existing) return existing;
  const run = async () => {
    let snapshot = snapshots.get(cacheKey);
    if (snapshot && Date.now() - snapshot.updatedAt > MAX_AGE_MS) {
      snapshots.delete(cacheKey);
      snapshot = undefined;
    }
    let response;
    try {
      response = await readPages(request, snapshot?.token);
    } catch (error) {
      if (
        error instanceof GoogleApiError &&
        (error.status === 401 ||
          (error.status === 403 &&
            ![
              "rateLimitExceeded",
              "userRateLimitExceeded",
              "quotaExceeded",
              "dailyLimitExceeded",
              "rate_limit_exceeded",
            ].includes(error.reason ?? "")))
      )
        snapshots.delete(cacheKey);
      if (
        !(error instanceof GoogleApiError) ||
        error.status !== 410 ||
        !snapshot
      )
        throw error;
      snapshots.delete(cacheKey);
      snapshot = undefined;
      response = await readPages(request);
    }
    const byId = new Map(
      (snapshot?.events ?? []).map((event) => [event.id, event]),
    );
    const from = Date.parse(request.timeMin);
    const to = Date.parse(request.timeMax);
    for (const event of response.events) {
      if (event.status === "cancelled") {
        byId.delete(event.id);
        for (const [id, prior] of byId)
          if (prior.recurringEventId === event.id) byId.delete(id);
      } else if (inRange(event, from, to)) {
        byId.set(event.id, event);
      } else {
        byId.delete(event.id);
      }
    }
    const events = [...byId.values()];
    snapshots.delete(cacheKey);
    if (snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = snapshots.keys().next().value;
      if (oldest !== undefined) snapshots.delete(oldest);
    }
    snapshots.set(cacheKey, {
      events,
      token: response.token,
      updatedAt: Date.now(),
    });
    return events;
  };
  const result = run();
  pending.set(cacheKey, result);
  try {
    return await result;
  } finally {
    pending.delete(cacheKey);
  }
}
