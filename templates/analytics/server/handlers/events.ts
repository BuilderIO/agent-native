import { defineEventHandler, setResponseStatus } from "h3";
import { getAccessToken } from "../lib/gcloud";
import { resolveCredential } from "../lib/credentials";
import { withRequestContextFromEvent } from "../lib/credentials";
import { readBody } from "@agent-native/core/server";

/**
 * POST /api/events/track
 *
 * Logs custom events to BigQuery events_partitioned table.
 * Used for tracking metric views, user actions, etc.
 */
export const handleTrackEvent = defineEventHandler(async (event) => {
  try {
    const { event: eventName, data, userId, timestamp } = await readBody(event);

    if (!eventName || typeof eventName !== "string") {
      setResponseStatus(event, 400);
      return { error: "Missing or invalid 'event' field" };
    }

    // Auth has been removed — user info comes from request body only
    let authenticatedUserId: string | null = null;
    let userEmail: string | null = null;

    // Prepare event row for BigQuery
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

    // Insert into BigQuery via REST API. We need the request context to
    // resolve the per-user BIGQUERY_PROJECT_ID + service-account credential,
    // so wrap inside withRequestContextFromEvent. The fetch itself still
    // doesn't block the response (resolved upfront, fired async after).
    const ctxResult = await withRequestContextFromEvent(event, async (ctx) => {
      const [credentials, projectId] = await Promise.all([
        resolveCredential("GOOGLE_APPLICATION_CREDENTIALS_JSON", ctx),
        resolveCredential("BIGQUERY_PROJECT_ID", ctx),
      ]);
      if (!credentials || !projectId) return null;
      const token = await getAccessToken();
      return { token, projectId };
    });

    if (ctxResult) {
      const { token, projectId } = ctxResult;
      // Fire and forget — don't block the response on the BigQuery insert.
      fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId || "your-gcp-project-id"}/datasets/analytics/tables/events_partitioned/insertAll`,
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

    // Respond immediately - don't wait for BigQuery
    setResponseStatus(event, 202);
    return { success: true };
  } catch (err: any) {
    console.error("Track event error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
