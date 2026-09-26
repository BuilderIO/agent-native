import { readBody } from "@agent-native/core/server";
import {
  SYNTHETIC_TRAFFIC_HEADER,
  isSyntheticTrafficValue,
} from "@agent-native/core/shared";
import { defineEventHandler, getHeader, setResponseStatus } from "h3";

import { getAppEventsTable } from "../lib/bigquery";
import { resolveCredential } from "../lib/credentials";
import { withRequestContextFromEvent } from "../lib/credentials";
import { getAccessToken } from "../lib/gcloud";

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

    let authenticatedUserId: string | null = null;
    let userEmail: string | null = null;

    const eventRow = {
      event: eventName,
      data: typeof data === "string" ? data : JSON.stringify(data || {}),
      userId: authenticatedUserId || userId || null,
      userEmail: userEmail || null,
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

    const ctxResult = await withRequestContextFromEvent(event, async (ctx) => {
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
    });

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
