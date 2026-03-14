import { type RequestHandler } from "express";
import { runQuery } from "../lib/bigquery";
import { getDataDictionary, createDataDictionaryEntry, syncDataDictionary } from "../lib/notion";
import { sendDirectMessage } from "../lib/slack";

/**
 * GET /api/data-dictionary/missing-metrics
 * 
 * Detects metrics that are viewed frequently but missing from the Data Dictionary.
 * Uses the last 30 days of "metric viewed" events from BigQuery.
 * 
 * Query params:
 * - limit: max results to return (default: 20)
 * - days: lookback period (default: 30)
 */
export const handleMissingMetrics: RequestHandler = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const days = parseInt(req.query.days as string) || 30;

    // Get all metrics from the Data Dictionary
    const dictionaryEntries = await getDataDictionary();
    const definedMetrics = new Set(
      dictionaryEntries.map((entry) => entry.Metric.toLowerCase().trim())
    );

    // Query metric_viewed events from BigQuery
    const sql = `
      WITH metric_views AS (
        SELECT
          JSON_VALUE(data, '$.metricName') AS metric_name,
          JSON_VALUE(data, '$.dashboardId') AS dashboard_id,
          userId,
          createdDate
        FROM @app_events
        WHERE event = 'metric viewed'
          AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
          AND createdDate <= CURRENT_TIMESTAMP()
          AND JSON_VALUE(data, '$.metricName') IS NOT NULL
      )
      SELECT
        metric_name,
        COUNT(*) AS view_count,
        COUNT(DISTINCT userId) AS unique_viewers,
        ARRAY_AGG(DISTINCT dashboard_id IGNORE NULLS LIMIT 5) AS dashboards,
        MAX(createdDate) AS last_viewed
      FROM metric_views
      WHERE metric_name IS NOT NULL
        AND metric_name != ''
      GROUP BY metric_name
      HAVING view_count > 0
      ORDER BY view_count DESC, unique_viewers DESC
      LIMIT ${limit * 3}  -- Fetch more than needed to account for filtering
    `;

    const result = await runQuery(sql);

    // Filter out metrics that are already defined
    const missingMetrics = result.rows
      .filter((row) => {
        const metricName = String(row.metric_name || "").toLowerCase().trim();
        return metricName && !definedMetrics.has(metricName);
      })
      .slice(0, limit)
      .map((row) => ({
        metricName: String(row.metric_name),
        viewCount: Number(row.view_count),
        uniqueViewers: Number(row.unique_viewers),
        dashboards: (row.dashboards as string[]) || [],
        lastViewed: row.last_viewed ? String(row.last_viewed) : null,
      }));

    res.json({
      missingMetrics,
      totalDefinedMetrics: definedMetrics.size,
      lookbackDays: days,
    });
  } catch (err: any) {
    console.error("Missing metrics error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/data-dictionary/approve-suggestion
 *
 * Approves a metric suggestion and creates it in the Notion Data Dictionary.
 * Awards bonus points to the submitter.
 *
 * Body:
 * - metricName: string
 * - definition: string
 * - table: string
 * - department?: string
 * - owner?: string
 */
export const handleApproveSuggestion: RequestHandler = async (req, res) => {
  try {
    const { metricName, definition, table, department, owner } = req.body;

    if (!metricName || !definition || !table) {
      res.status(400).json({ error: "Missing required fields: metricName, definition, table" });
      return;
    }

    // Create entry in Notion Data Dictionary
    const result = await createDataDictionaryEntry({
      Metric: metricName,
      Definition: definition,
      Table: table,
      Department: department || "General",
      Owner: owner || "",
    });

    console.log(`Created Notion page for "${metricName}": ${result.url}`);

    // Trigger data dictionary sync (fire and forget)
    syncDataDictionary()
      .then(() => console.log("[approval] Data dictionary synced"))
      .catch((err) => console.error("[approval] Failed to sync data dictionary:", err.message));

    // Send Slack notification to submitter (fire and forget)
    // Note: submitter email needs to be tracked in the validation submission
    // For now, we'll send a notification to a hardcoded email or skip
    if (process.env.SLACK_BOT_TOKEN) {
      // TODO: Get submitter email from validation record
      // const submitterEmail = ... fetch from validations table
      // For now, just log that we would send a notification
      console.log(`[approval] Would send Slack notification for "${metricName}" approval`);

      // Example of how to send:
      // sendDirectMessage("primary", submitterEmail,
      //   `🎉 Your metric suggestion "${metricName}" has been approved and added to the Data Dictionary!\n` +
      //   `View it here: ${result.url}\n` +
      //   `You've earned 100 bonus points! 🏆`
      // ).catch((err) => console.error("[approval] Slack notification failed:", err));
    }

    // TODO: Award bonus points to submitter (requires tracking submission user)
    // TODO: Mark suggestion as approved in BigQuery

    res.json({
      success: true,
      notionPageId: result.id,
      notionPageUrl: result.url,
    });
  } catch (err: any) {
    console.error("Approve suggestion error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/data-dictionary/update-entry
 *
 * Updates an existing Data Dictionary entry in Notion.
 * Restricted to analytics team and admins only.
 *
 * Body:
 * - pageId: string (Notion page ID)
 * - updates: object with fields to update
 */
export const handleUpdateEntry: RequestHandler = async (req, res) => {
  try {
    const { pageId, updates } = req.body;

    if (!pageId || !updates) {
      res.status(400).json({ error: "Missing pageId or updates" });
      return;
    }

    // Import updateDataDictionaryEntry from notion.ts
    const { updateDataDictionaryEntry } = await import("../lib/notion");

    await updateDataDictionaryEntry(pageId, updates);

    console.log(`Updated Notion page ${pageId}`);

    // Trigger data dictionary sync (fire and forget)
    syncDataDictionary()
      .then(() => console.log("[update] Data dictionary synced"))
      .catch((err) => console.error("[update] Failed to sync data dictionary:", err.message));

    res.json({ success: true });
  } catch (err: any) {
    console.error("Update entry error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/data-dictionary/can-edit
 *
 * Checks if the current user can edit the Data Dictionary (analytics team or admin).
 */
export const handleCanEdit: RequestHandler = async (req, res) => {
  try {
    const userInfo = await getUserInfoFromToken(req);

    if (!userInfo) {
      console.log("[can-edit] No user info from token");
      res.json({ canEdit: false });
      return;
    }

    // Get reviewer allowlist from env var
    const reviewersEnv = process.env.DATA_DICT_REVIEWERS || "";
    const allowedReviewers = reviewersEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    // Allow if user is in reviewer list OR is an admin (builder.io domain or specific admin list)
    const isAdmin = userInfo.email.toLowerCase().endsWith("@builder.io");
    const canEdit = allowedReviewers.includes(userInfo.email.toLowerCase()) || isAdmin;

    console.log("[can-edit] User:", userInfo.email, "| Allowed reviewers:", allowedReviewers, "| Is admin:", isAdmin, "| Can edit:", canEdit);

    res.json({ canEdit, email: userInfo.email });
  } catch (err: any) {
    console.error("Can edit check error:", err.message);
    res.json({ canEdit: false });
  }
};

// --- Helper Functions ---

// Auth removed — stubs always return a local user
async function getUserInfoFromToken(_req: any): Promise<{ uid: string; email: string } | null> {
  return { uid: "local", email: "local@localhost" };
}
