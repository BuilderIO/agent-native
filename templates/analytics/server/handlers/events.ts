import {
  isTestIdentity,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  SYNTHETIC_TRAFFIC_HEADER,
  isSyntheticTrafficValue,
} from "@agent-native/core/shared";
import { defineEventHandler, getHeader, setResponseStatus } from "h3";

import { getAppEventsTable } from "../lib/bigquery";
import {
  getCredentialContextFromEvent,
  resolveCredential,
} from "../lib/credentials";
import { getAccessToken } from "../lib/gcloud";

// The legacy client sends `data` as a JSON string; anything unparseable is
// stored as it came.
function eventData(data: unknown): Record<string, unknown> | string {
  if (typeof data !== "string") {
    return data && typeof data === "object"
      ? { ...(data as Record<string, unknown>) }
      : {};
  }
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return data;
  }
  return data;
}

// A retained test identity's exception carries `test_identity: true` for
// metric SQL to exclude. Only the server sets it: a client-sent marker is
// dropped, or anyone could hide a real user's errors.
function storedEventData(
  props: Record<string, unknown> | string,
  testIdentity: string | undefined,
): string {
  if (typeof props === "string") {
    return testIdentity
      ? JSON.stringify({ data: props, test_identity: true })
      : props;
  }
  const { test_identity: _clientMarker, ...fields } = props;
  return JSON.stringify(
    testIdentity ? { ...fields, test_identity: true } : fields,
  );
}

export const handleTrackEvent = defineEventHandler(async (event) => {
  if (isSyntheticTrafficValue(getHeader(event, SYNTHETIC_TRAFFIC_HEADER))) {
    setResponseStatus(event, 202);
    return { success: true, accepted: 0 };
  }

  try {
    const { event: eventName, data, userId, timestamp } = await readBody(event);

    if (!eventName || typeof eventName !== "string") {
      setResponseStatus(event, 400);
      return { error: "Missing or invalid 'event' field" };
    }

    // The legacy client sends an opaque uid, so only the signed-in email can
    // match a configured test identity. No session is not a test identity.
    const ctx = await getCredentialContextFromEvent(event);
    const props = eventData(data);
    const fields = typeof props === "string" ? {} : props;
    const testIdentity = [
      userId,
      ctx?.userEmail,
      fields.user_email,
      fields.userEmail,
      fields.email,
    ].find((value): value is string => isTestIdentity(value));
    // `$exception` stays: this table is the only place it is queryable.
    if (eventName !== "$exception" && testIdentity) {
      setResponseStatus(event, 202);
      return { success: true, accepted: 0, suppressedTestIdentity: 1 };
    }

    let authenticatedUserId: string | null = null;

    const eventRow = {
      event: eventName,
      data: storedEventData(props, testIdentity),
      userId: authenticatedUserId || userId || null,
      userEmail: testIdentity ?? null,
      sessionId: null, // Could be added later if we track sessions
      organizationId: null, // Could be derived from user if needed
      createdDate: timestamp
        ? new Date(timestamp).toISOString()
        : new Date().toISOString(),
      name: null,
      url: null,
      type: null,
      kind: null,
      message: null,
      modelName: null,
      modelId: null,
    };

    const ctxResult = ctx
      ? await runWithRequestContext(
          { userEmail: ctx.userEmail, orgId: ctx.orgId ?? undefined },
          async () => {
            const [credentials, projectId] = await Promise.all([
              resolveCredential("GOOGLE_APPLICATION_CREDENTIALS_JSON", ctx),
              resolveCredential("BIGQUERY_PROJECT_ID", ctx),
            ]);
            if (!credentials || !projectId) return null;
            const [token, table] = await Promise.all([
              getAccessToken(),
              getAppEventsTable(projectId, ctx),
            ]);
            return { token, table };
          },
        )
      : null;

    if (ctxResult) {
      const { token, table } = ctxResult;
      fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${table.projectId}/datasets/${table.datasetId}/tables/${table.tableId}/insertAll`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rows: [{ json: eventRow }],
          }),
        },
      )
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text();
            console.error(
              `Failed to insert event to BigQuery: ${res.status} ${text}`,
            );
          }
        })
        .catch((err) => {
          console.error("Failed to insert event to BigQuery:", err.message);
        });
    }

    setResponseStatus(event, 202);
    return { success: true };
  } catch (err: any) {
    console.error("Track event error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
