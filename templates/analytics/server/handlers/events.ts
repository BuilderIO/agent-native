import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { getAccessToken } from "../lib/gcloud";

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || "your-gcp-project-id";

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

    // Insert into BigQuery via REST API (fire and forget - don't await)
    getAccessToken()
      .then((token) =>
        fetch(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/datasets/analytics/tables/events_partitioned/insertAll`,
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
        ),
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

    // Respond immediately - don't wait for BigQuery
    setResponseStatus(event, 202);
    return { success: true };
  } catch (err: any) {
    console.error("Track event error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
