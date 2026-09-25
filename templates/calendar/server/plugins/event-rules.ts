import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import {
  getJevContextCredentials,
  isJevEnabled,
  registerRecurringSweepHandler,
  requestJevThroughBuilder,
  runWithRequestContext,
  scheduledTriggerAvailability,
  type JevResponse,
} from "@agent-native/core/server";
import { startIntervalJob } from "@agent-native/core/server/interval-job";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";

import type { CalendarEventRuleActivity } from "../../shared/api.js";
import { normalizeCalendarSettings } from "../../shared/settings.js";
import { calendarListEvents, GoogleApiError } from "../lib/google-api.js";
import * as googleCalendar from "../lib/google-calendar.js";

const INTERVAL_MS = 5 * 60_000;
const EVENT_BATCH_SIZE = 10;
const PROCESSED_LIMIT = 2000;
const RUNTIME_KEY = "calendar-event-rules-runtime";
type PendingRsvp = Pick<
  CalendarEventRuleActivity,
  "id" | "eventId" | "accountEmail" | "title" | "action" | "occurredAt"
> & { action: "accepted" | "declined" };
type Runtime = {
  cursors?: Record<string, string>;
  processed?: Record<string, string>;
  initialSyncAt?: Record<string, string>;
  pendingRsvps?: Record<string, PendingRsvp>;
  accountRefreshErrors?: Array<{ email: string; error: string }>;
  lastError?: string;
  lastConflictCount?: number;
  lastSweepAt?: number;
};

function eventKey(account: string, calendarId: string, id: string) {
  return `google:${account.toLowerCase()}:${calendarId}:${id}`;
}

export function isEligibleInvitation(
  event: any,
  accountEmail: string,
  now = Date.now(),
) {
  const end = event.end?.dateTime ?? event.end?.date;
  const endAt = Date.parse(end ?? "");
  if (
    event.status === "cancelled" ||
    event.organizer?.self === true ||
    !Number.isFinite(endAt) ||
    endAt <= now
  ) {
    return false;
  }
  const attendee = (event.attendees ?? []).find(
    (candidate: any) =>
      candidate.self === true ||
      candidate.email?.toLowerCase() === accountEmail.toLowerCase(),
  );
  return attendee?.responseStatus === "needsAction";
}

async function evaluate(
  owner: string,
  events: any[],
  rules: NonNullable<
    ReturnType<typeof normalizeCalendarSettings>["eventRules"]
  >,
) {
  const active = Object.entries(rules).filter(([, prompt]) => prompt?.trim());
  if (!active.length || !events.length) return new Map<string, Set<string>>();
  const credentials = await getJevContextCredentials(owner);
  if (!(await isJevEnabled(credentials)))
    throw new Error("Jev invitation rules require Jev access.");
  const decisions = new Map<string, Set<string>>();
  for (let offset = 0; offset < events.length; offset += EVENT_BATCH_SIZE) {
    const batch = events.slice(offset, offset + EVENT_BATCH_SIZE);
    const questions: Record<string, unknown> = {};
    const entries = new Map<string, { eventId: string; action: string }>();
    batch.forEach((event, eventIndex) => {
      active.forEach(([action, prompt], ruleIndex) => {
        const id = `event_${eventIndex}_${ruleIndex}`;
        entries.set(id, { eventId: event.id, action });
        questions[id] = {
          type: "noul",
          instructions: `Does calendar event ${event.id} clearly match the user's ${action} rule: "${prompt}"?`,
          criteria: {
            true: "The invitation clearly matches the user's rule.",
            false: "The invitation does not clearly match the user's rule.",
          },
        };
      });
    });
    const request = {
      model: "jev-latest",
      state: {
        events: batch.map((event) => ({
          id: event.id,
          title: event.summary ?? "",
          description: event.description ?? "",
          location: event.location ?? "",
          start: event.start?.dateTime ?? event.start?.date ?? "",
          organizer: event.organizer?.email ?? "",
          attendees: (event.attendees ?? []).map((attendee: any) => ({
            email: attendee.email,
            responseStatus: attendee.responseStatus,
          })),
        })),
      },
      questions,
    };
    let response: JevResponse;
    if (credentials.builderAuth) {
      response = await requestJevThroughBuilder(
        credentials.builderAuth,
        request,
        { timeoutMs: 12_000 },
      );
    } else if (credentials.personalApiKey || credentials.apiKey) {
      const apiKey = credentials.personalApiKey ?? credentials.apiKey!;
      const result = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(12_000),
      });
      if (!result.ok)
        throw new Error(`TypeSafe Jev request failed (${result.status}).`);
      response = (await result.json()) as JevResponse;
    } else {
      throw new Error("Jev invitation rules require Jev access.");
    }
    if (!response.answers || typeof response.answers !== "object")
      throw new Error("Jev returned no invitation rule answers.");
    for (const id of entries.keys()) {
      const probability = response.answers[id]?.noul;
      if (
        typeof probability !== "number" ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
      ) {
        throw new Error(
          `Jev returned an invalid invitation rule answer: ${id}.`,
        );
      }
    }
    for (const [id, entry] of entries) {
      const probability = response.answers[id]?.noul;
      if (typeof probability === "number" && probability >= 0.8) {
        const actions = decisions.get(entry.eventId) ?? new Set<string>();
        actions.add(entry.action);
        decisions.set(entry.eventId, actions);
      }
    }
  }
  return decisions;
}

async function persistEventRuleActivity(
  owner: string,
  activity: CalendarEventRuleActivity[],
  addedHiddenKeys: ReadonlySet<string> = new Set(),
) {
  if (!activity.length && !addedHiddenKeys.size) return;
  await mutateUserSetting(owner, "calendar-settings", (current) => {
    const record = (current ?? {}) as Record<string, unknown>;
    const latest = normalizeCalendarSettings(record);
    const nextActivity = new Map(
      latest.eventRuleActivity?.map((entry) => [entry.id, entry]),
    );
    for (const entry of activity) nextActivity.set(entry.id, entry);
    return {
      ...record,
      hiddenEventKeys: [
        ...new Set([...(latest.hiddenEventKeys ?? []), ...addedHiddenKeys]),
      ].slice(-5000),
      eventRuleActivity: [...nextActivity.values()].slice(-50),
    };
  });
}

async function syncOwner(owner: string, signal?: AbortSignal) {
  const settings = normalizeCalendarSettings(
    await getUserSetting(owner, "calendar-settings"),
  );
  const rules = settings.eventRules ?? {};
  const hasActiveRules = Object.values(rules).some((rule) => rule?.trim());
  // coercion-ok: null means this owner has not recorded a sweep cursor yet.
  const runtime = ((await getUserSetting(owner, RUNTIME_KEY)) ?? {}) as Runtime;
  const cursors = { ...(runtime.cursors ?? {}) };
  const processed = { ...(runtime.processed ?? {}) };
  const initialSyncAt = { ...(runtime.initialSyncAt ?? {}) };
  const pendingRsvps = { ...(runtime.pendingRsvps ?? {}) };
  const resolvedPendingRsvps = new Set<string>();
  let conflictCount = 0;
  const persistProgress = (lastSweepAt?: number) =>
    mutateUserSetting(owner, RUNTIME_KEY, (current) => {
      const latest = (current ?? {}) as Runtime;
      const latestPendingRsvps = {
        ...(latest.pendingRsvps ?? {}),
        ...pendingRsvps,
      };
      for (const id of resolvedPendingRsvps) delete latestPendingRsvps[id];
      return {
        ...latest,
        cursors,
        processed: Object.fromEntries(
          Object.entries(processed).slice(-PROCESSED_LIMIT),
        ),
        initialSyncAt,
        pendingRsvps: latestPendingRsvps,
        lastConflictCount: conflictCount,
        ...(lastSweepAt ? { lastSweepAt } : {}),
      };
    });
  const persistPendingRsvp = async (pending: PendingRsvp) => {
    pendingRsvps[pending.id] = pending;
    resolvedPendingRsvps.delete(pending.id);
    await mutateUserSetting(owner, RUNTIME_KEY, (current) => {
      const latest = (current ?? {}) as Runtime;
      return {
        ...latest,
        pendingRsvps: {
          ...(latest.pendingRsvps ?? {}),
          [pending.id]: pending,
        },
      };
    });
  };

  for (const [id, pending] of Object.entries(pendingRsvps)) {
    signal?.throwIfAborted();
    const event = await googleCalendar.getEvent(pending.eventId, {
      ownerEmail: owner,
      accountEmail: pending.accountEmail,
    });
    const currentResponse =
      event.responseStatus ??
      event.attendees?.find(
        (attendee) =>
          attendee.self ||
          attendee.email?.toLowerCase() === pending.accountEmail.toLowerCase(),
      )?.responseStatus;
    if (currentResponse === pending.action)
      await persistEventRuleActivity(owner, [pending]);
    delete pendingRsvps[id];
    resolvedPendingRsvps.add(id);
  }
  if (resolvedPendingRsvps.size) await persistProgress();

  if (!hasActiveRules) return;
  if (runtime.lastSweepAt && Date.now() - runtime.lastSweepAt < INTERVAL_MS)
    return;

  const accounts = await googleCalendar.getClientsForAccountsWithErrors(owner);
  const accountRefreshErrors = accounts.errors
    .slice(0, 10)
    .map(({ email, error }) => ({
      email,
      error: error.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300),
    }));
  await mutateUserSetting(owner, RUNTIME_KEY, (current) => {
    const next = { ...((current ?? {}) as Runtime) };
    if (accountRefreshErrors.length)
      next.accountRefreshErrors = accountRefreshErrors;
    else delete next.accountRefreshErrors;
    return next;
  });

  for (const account of accounts.clients) {
    signal?.throwIfAborted();
    const calendarId = "primary";
    const accountCalendarKey = `${account.email.toLowerCase()}:${calendarId}`;
    let cursor: string | undefined = cursors[accountCalendarKey];
    let initial = initialSyncAt[accountCalendarKey];
    if (!initial) {
      initial = initialSyncAt[accountCalendarKey] = new Date().toISOString();
      await persistProgress();
    }
    let fullSyncStartedAt = cursor ? undefined : initial;
    let events: any[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const result = await calendarListEvents(
          account.accessToken,
          "primary",
          {
            ...(cursor ? { syncToken: cursor } : { timeMin: initial }),
            showDeleted: true,
            maxResults: 250,
            pageToken,
          },
        );
        events.push(...(result.items ?? []));
        pageToken = result.nextPageToken;
        if (result.nextSyncToken) cursor = result.nextSyncToken;
      } while (pageToken);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.status !== 410 || !cursor)
        throw error;
      // Google invalidates sync tokens periodically; reset from now and resume incremental reads.
      delete cursors[accountCalendarKey];
      cursor = undefined;
      initial = new Date().toISOString();
      fullSyncStartedAt = initial;
      initialSyncAt[accountCalendarKey] = initial;
      await persistProgress();
      do {
        const result = await calendarListEvents(
          account.accessToken,
          "primary",
          { timeMin: initial, showDeleted: true, maxResults: 250, pageToken },
        );
        events.push(...(result.items ?? []));
        pageToken = result.nextPageToken;
        if (result.nextSyncToken) cursor = result.nextSyncToken;
      } while (pageToken);
    }
    if (cursor) cursors[accountCalendarKey] = cursor;
    const pending = events.filter((event) => {
      const identity = eventKey(account.email, calendarId, event.id);
      const version = `${event.updated ?? ""}:${event.status ?? ""}`;
      const createdAfterSetup =
        !fullSyncStartedAt ||
        Date.parse(event.created ?? "") >= Date.parse(fullSyncStartedAt) ||
        (cursor &&
          Date.parse(event.updated ?? "") >= Date.parse(fullSyncStartedAt));
      return (
        createdAfterSetup &&
        isEligibleInvitation(event, account.email) &&
        processed[identity] !== version
      );
    });
    const decisions = await evaluate(owner, pending, rules);
    const addedHiddenKeys = new Set<string>();
    const activity: CalendarEventRuleActivity[] = [];
    for (const event of pending) {
      const identity = eventKey(account.email, calendarId, event.id);
      const version = `${event.updated ?? ""}:${event.status ?? ""}`;
      const actions = decisions.get(event.id) ?? new Set();
      if (actions.has("accept") && actions.has("decline")) {
        conflictCount += 1;
        console.warn(
          "[calendar-event-rules] skipped conflicting Jev RSVP rules.",
        );
      } else if (actions.has("accept") || actions.has("decline")) {
        const responseAction = actions.has("accept") ? "accepted" : "declined";
        const entry: PendingRsvp = {
          id: `${identity}|${version}|${responseAction}`,
          eventId: event.id,
          accountEmail: account.email,
          title:
            typeof event.summary === "string"
              ? event.summary.slice(0, 500)
              : "",
          action: responseAction,
          occurredAt: new Date().toISOString(),
        };
        await persistPendingRsvp(entry);
        await googleCalendar.rsvpEvent(event.id, responseAction, {
          ownerEmail: owner,
          accountEmail: account.email,
        });
        activity.push(entry);
      }
      if (actions.has("hide")) {
        addedHiddenKeys.add(identity);
        activity.push({
          id: `${identity}|${version}|hidden`,
          eventId: event.id,
          accountEmail: account.email,
          title:
            typeof event.summary === "string"
              ? event.summary.slice(0, 500)
              : "",
          action: "hidden",
          occurredAt: new Date().toISOString(),
          hiddenEventKey: identity,
        });
      }
      delete processed[identity];
      processed[identity] = version;
    }
    if (activity.length || addedHiddenKeys.size) {
      await persistEventRuleActivity(owner, activity, addedHiddenKeys);
      for (const entry of activity) {
        if (entry.action === "hidden") continue;
        delete pendingRsvps[entry.id];
        resolvedPendingRsvps.add(entry.id);
      }
    }
    await persistProgress();
  }
  await persistProgress(Date.now());
  if (accountRefreshErrors.length) {
    throw new Error(
      `Google Calendar token refresh failed for ${accounts.errors.length} account(s).`,
    );
  }
}

export async function runCalendarEventRulesOnce(signal?: AbortSignal) {
  const owners = new Set(
    (await listOAuthAccounts("google"))
      .map((account) => account.owner)
      .filter((owner): owner is string => Boolean(owner)),
  );
  const failures: Error[] = [];
  for (const owner of owners) {
    signal?.throwIfAborted();
    try {
      await runWithRequestContext({ userEmail: owner }, async () => {
        try {
          await syncOwner(owner, signal);
          await mutateUserSetting(owner, RUNTIME_KEY, (current) => {
            const next = { ...((current ?? {}) as Runtime) };
            delete next.lastError;
            return next;
          });
        } catch (error) {
          const message = (
            error instanceof Error ? error.message : "Invitation rules failed"
          )
            .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .slice(0, 300);
          await mutateUserSetting(owner, RUNTIME_KEY, (current) => ({
            ...((current ?? {}) as Runtime),
            lastError: message,
          }));
          throw new Error(`${owner}: ${message}`);
        }
      });
    } catch (error) {
      failures.push(
        error instanceof Error ? error : new Error("Invitation rules failed"),
      );
    }
  }
  if (failures.length) {
    const error = new Error(
      `Calendar event rules failed for ${failures.length} owner(s).`,
    );
    error.name = "AggregateError";
    Object.assign(error, { errors: failures });
    throw error;
  }
}

const runRegisteredCalendarEventRules = () => runCalendarEventRulesOnce();
let unregisterRecurringSweepHandler: (() => void) | undefined;

export default function registerCalendarEventRules() {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "calendar-event-rules",
    runRegisteredCalendarEventRules,
  );
  const availability = scheduledTriggerAvailability();
  if (!availability.available || availability.driver !== "in-process") return;
  startIntervalJob(runCalendarEventRulesOnce, {
    intervalMs: INTERVAL_MS,
    leading: false,
    onError: (error) =>
      console.error("[calendar-event-rules] sync failed:", error),
  });
}
