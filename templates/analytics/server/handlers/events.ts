import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { BigQuery } from "@google-cloud/bigquery";

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || "your-gcp-project-id";
const EVENTS_TABLE = `${PROJECT_ID}.analytics.events_partitioned`;

let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;

  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentials) {
    const parsed = JSON.parse(credentials);
    bigqueryClient = new BigQuery({
      projectId: PROJECT_ID,
      credentials: parsed,
    });
  } else {
    bigqueryClient = new BigQuery({ projectId: PROJECT_ID });
  }

  return bigqueryClient;
}

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
      createdDate: timestamp ? new Date(timestamp) : new Date(),
      name: null,
      url: null,
      type: null,
      kind: null,
      message: null,
      modelName: null,
      modelId: null,
    };

    // Insert into BigQuery (fire and forget - don't await)
    const client = getBigQueryClient();
    client
      .dataset("analytics")
      .table("events_partitioned")
      .insert([eventRow])
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
