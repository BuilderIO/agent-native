import { defineEventHandler, getQuery, readBody, setResponseStatus } from "h3";
import {
  getUserPersona,
  setUserPersona,
  getAllUserPersonas,
  PersonaType,
} from "../lib/user-persona";
import { runQuery } from "../lib/bigquery";
import { calculateValidationPoints } from "../lib/contribution-scoring";

// In-memory stores (temporary until we have Firestore permissions)
interface UserPoints {
  userId: string;
  userEmail: string;
  totalPoints: number;
  weekPoints: number;
  monthPoints: number;
  contributionCount: number;
  validationCount: number;
  lastActivity: Date;
  updatedAt: Date;
}

interface MetricMetadata {
  metricId: string;
  validationIssues: number;
  validationTrust: number;
  lastFlagged?: Date;
  updatedAt: Date;
}

const userPointsStore = new Map<string, UserPoints>();
const metricMetadataStore = new Map<string, MetricMetadata>();
const validationsStore: any[] = [];

// GET /api/gamification/persona - Get current user's persona
export const handleGetPersona = defineEventHandler(async (event) => {
  try {
    const userId = await getUserIdFromToken();
    if (!userId) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }

    const persona = await getUserPersona(userId);
    return { persona };
  } catch (err: any) {
    console.error("Get persona error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// POST /api/gamification/persona - Set current user's persona
export const handleSetPersona = defineEventHandler(async (event) => {
  try {
    const userInfo = await getUserInfoFromToken();
    console.log("User info from token:", userInfo);

    if (!userInfo) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }

    const body = await readBody(event);
    console.log("Setting persona - request body:", body);
    const { persona, department } = body;

    if (!["analytics", "dept_head", "regular"].includes(persona)) {
      console.error("Invalid persona type:", persona);
      setResponseStatus(event, 400);
      return { error: "Invalid persona type" };
    }

    console.log("Calling setUserPersona with:", {
      userId: userInfo.uid,
      persona,
      department,
    });
    await setUserPersona(
      userInfo.uid,
      persona as PersonaType,
      userInfo.email,
      department,
    );

    console.log("Successfully set persona");
    return { success: true, persona, department };
  } catch (err: any) {
    console.error("Set persona error:", err);
    console.error("Error stack:", err.stack);
    setResponseStatus(event, 500);
    return { error: err.message || "Failed to set persona" };
  }
});

// POST /api/gamification/validate-metric - Submit a metric validation
export const handleValidateMetric = defineEventHandler(async (event) => {
  try {
    const userInfo = await getUserInfoFromToken();
    if (!userInfo) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }

    const userId = userInfo.uid;
    const email = userInfo.email;

    const {
      metricId,
      metricName,
      rating,
      comment,
      tags,
      metricValue,
      isNewMetric,
      suggestedDefinition,
      suggestedTable,
    } = await readBody(event);

    if (!metricId || !metricName || !rating) {
      setResponseStatus(event, 400);
      return { error: "Missing required fields" };
    }

    if (!["accurate", "mostly_accurate", "needs_review"].includes(rating)) {
      setResponseStatus(event, 400);
      return { error: "Invalid rating" };
    }

    // Calculate points
    let points = calculateValidationPoints(rating, !!comment);

    // Bonus points for suggesting new metric to dictionary
    if (isNewMetric && suggestedDefinition) {
      points += 5;
    }

    // Log validation to in-memory store (for backward compatibility)
    const validationId = `${userId}-${metricId}-${Date.now()}`;
    const validation = {
      id: validationId,
      timestamp: new Date(),
      metricName,
      metricId,
      userEmail: email,
      userId,
      rating,
      comment: comment || "",
      tags: tags || [],
      pointsEarned: points,
      hasDataPreview: true,
      metricValue,
      isNewMetric: isNewMetric || false,
      suggestedDefinition: suggestedDefinition || null,
      suggestedTable: suggestedTable || null,
      status: "pending", // pending, approved, rejected
    };
    validationsStore.push(validation);
    console.log(
      `Saved validation to memory store${isNewMetric ? " (NEW METRIC)" : ""}`,
    );

    // Persist to BigQuery (fire and forget)
    persistValidationToBigQuery(validation).catch((err) => {
      console.error("Failed to persist validation to BigQuery:", err.message);
    });

    // Update user points
    await incrementUserPoints(userId, email, points, "validation");

    // If needs review, update metric metadata
    if (rating === "needs_review") {
      await incrementValidationIssues(metricId);
    } else {
      await incrementValidationTrust(metricId);
    }

    return { success: true, points };
  } catch (err: any) {
    console.error("Validate metric error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// GET /api/gamification/leaderboard?period=week|month|alltime&track=all|contributors|validators
export const handleLeaderboard = defineEventHandler(async (event) => {
  try {
    const { period: periodParam, track: trackParam } = getQuery(event);
    const period = (periodParam as string) || "week";
    const track = (trackParam as string) || "all";

    // For MVP, fetch from Firestore aggregates
    // In production, query BigQuery for real-time data
    const leaderboard = await getLeaderboardFromFirestore(period, track);

    return { leaderboard, period, track };
  } catch (err: any) {
    console.error("Leaderboard error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// GET /api/gamification/new-metrics - Get new metric suggestions (for analytics team)
export const handleNewMetrics = defineEventHandler(async (_event) => {
  try {
    // Filter validations for new metrics with suggestions
    const newMetricSuggestions = validationsStore
      .filter((v) => v.isNewMetric && v.suggestedDefinition)
      .map((v) => ({
        metricName: v.metricName,
        metricValue: v.metricValue,
        suggestedBy: v.userEmail,
        suggestedDefinition: v.suggestedDefinition,
        suggestedTable: v.suggestedTable,
        validationRating: v.rating,
        comment: v.comment,
        timestamp: v.timestamp,
      }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return { suggestions: newMetricSuggestions };
  } catch (err: any) {
    console.error("New metrics error:", err.message);
    setResponseStatus(_event, 500);
    return { error: err.message };
  }
});

// GET /api/gamification/my-stats - Get current user's stats
export const handleMyStats = defineEventHandler(async (event) => {
  try {
    const userInfo = await getUserInfoFromToken();
    if (!userInfo) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }

    const stats = await getUserStats(userInfo.email);

    return { stats };
  } catch (err: any) {
    console.error("My stats error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// --- Helper Functions ---

// Auth removed — stubs always return a local user
async function getUserIdFromToken(): Promise<string | null> {
  return "local";
}

async function getUserInfoFromToken(): Promise<{
  uid: string;
  email: string;
} | null> {
  return { uid: "local", email: "local@localhost" };
}

async function incrementUserPoints(
  userId: string,
  email: string,
  points: number,
  type: "contribution" | "validation",
): Promise<void> {
  const existing = userPointsStore.get(userId);

  if (!existing) {
    userPointsStore.set(userId, {
      userId,
      userEmail: email,
      totalPoints: points,
      weekPoints: points,
      monthPoints: points,
      contributionCount: type === "contribution" ? 1 : 0,
      validationCount: type === "validation" ? 1 : 0,
      lastActivity: new Date(),
      updatedAt: new Date(),
    });
  } else {
    userPointsStore.set(userId, {
      ...existing,
      totalPoints: existing.totalPoints + points,
      weekPoints: existing.weekPoints + points,
      monthPoints: existing.monthPoints + points,
      contributionCount:
        existing.contributionCount + (type === "contribution" ? 1 : 0),
      validationCount:
        existing.validationCount + (type === "validation" ? 1 : 0),
      lastActivity: new Date(),
      updatedAt: new Date(),
    });
  }
  console.log("Updated user points:", userPointsStore.get(userId));
}

async function incrementValidationIssues(metricId: string): Promise<void> {
  const existing = metricMetadataStore.get(metricId);

  if (!existing) {
    metricMetadataStore.set(metricId, {
      metricId,
      validationIssues: 1,
      validationTrust: 0,
      lastFlagged: new Date(),
      updatedAt: new Date(),
    });
  } else {
    metricMetadataStore.set(metricId, {
      ...existing,
      validationIssues: existing.validationIssues + 1,
      lastFlagged: new Date(),
      updatedAt: new Date(),
    });
  }
}

async function incrementValidationTrust(metricId: string): Promise<void> {
  const existing = metricMetadataStore.get(metricId);

  if (!existing) {
    metricMetadataStore.set(metricId, {
      metricId,
      validationIssues: 0,
      validationTrust: 1,
      updatedAt: new Date(),
    });
  } else {
    metricMetadataStore.set(metricId, {
      ...existing,
      validationTrust: existing.validationTrust + 1,
      updatedAt: new Date(),
    });
  }
}

async function getLeaderboardFromFirestore(
  period: string,
  track: string,
): Promise<any[]> {
  // Get all user points from memory store
  const allPoints = Array.from(userPointsStore.values());

  const results = await Promise.all(
    allPoints.map(async (data) => {
      // Get persona for user
      const persona = await getUserPersona(data.userId);

      // Filter by track type
      if (track === "contributors" && data.contributionCount === 0) return null;
      if (track === "validators" && data.validationCount === 0) return null;

      return {
        userId: data.userId,
        email: data.userEmail,
        totalPoints:
          period === "week"
            ? data.weekPoints
            : period === "month"
              ? data.monthPoints
              : data.totalPoints,
        contributionCount: data.contributionCount || 0,
        validationCount: data.validationCount || 0,
        persona: persona?.persona || "regular",
        department: persona?.department || "General",
        lastActivity: data.lastActivity,
      };
    }),
  );

  // Sort by points and limit to top 50
  return results
    .filter((r) => r !== null)
    .sort((a, b) => (b?.totalPoints || 0) - (a?.totalPoints || 0))
    .slice(0, 50);
}

async function getUserStats(email: string): Promise<any> {
  // Find user in memory store
  const userPoints = Array.from(userPointsStore.values()).find(
    (p) => p.userEmail === email,
  );

  if (!userPoints) {
    return {
      totalPoints: 0,
      weekPoints: 0,
      monthPoints: 0,
      contributionCount: 0,
      validationCount: 0,
      rank: null,
    };
  }

  return {
    totalPoints: userPoints.totalPoints || 0,
    weekPoints: userPoints.weekPoints || 0,
    monthPoints: userPoints.monthPoints || 0,
    contributionCount: userPoints.contributionCount || 0,
    validationCount: userPoints.validationCount || 0,
    rank: await getUserRank(email),
  };
}

async function getUserRank(email: string): Promise<number | null> {
  const allPoints = Array.from(userPointsStore.values()).sort(
    (a, b) => b.totalPoints - a.totalPoints,
  );

  const rank = allPoints.findIndex((p) => p.userEmail === email);

  return rank >= 0 ? rank + 1 : null;
}

// --- BigQuery Persistence ---

/**
 * Persist validation to BigQuery logs.metric_validations table.
 * Fire-and-forget - does not block API response.
 */
async function persistValidationToBigQuery(validation: any): Promise<void> {
  const sql = `
    INSERT INTO \`your-gcp-project-id.logs.metric_validations\`
      (id, timestamp, metric_name, metric_id, user_email, user_id, rating, comment, tags, points_earned, has_data_preview, status, is_new_metric, suggested_definition, suggested_table)
    VALUES
      (
        @id,
        @timestamp,
        @metric_name,
        @metric_id,
        @user_email,
        @user_id,
        @rating,
        @comment,
        @tags,
        @points_earned,
        @has_data_preview,
        @status,
        @is_new_metric,
        @suggested_definition,
        @suggested_table
      )
  `;

  const params = {
    id: validation.id,
    timestamp: validation.timestamp.toISOString(),
    metric_name: validation.metricName,
    metric_id: validation.metricId,
    user_email: validation.userEmail,
    user_id: validation.userId,
    rating: validation.rating,
    comment: validation.comment || "",
    tags: validation.tags || [],
    points_earned: validation.pointsEarned,
    has_data_preview: validation.hasDataPreview || false,
    status: validation.status || "pending",
    is_new_metric: validation.isNewMetric || false,
    suggested_definition: validation.suggestedDefinition || null,
    suggested_table: validation.suggestedTable || null,
  };

  // Run query - this will throw if it fails, and the caller will log the error
  await runQuery(
    sql.replace(/@(\w+)/g, (_, key) => {
      const val = (params as any)[key];
      if (val === null || val === undefined) return "NULL";
      if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
      if (typeof val === "number") return String(val);
      if (Array.isArray(val))
        return `[${val.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(", ")}]`;
      return `"${String(val).replace(/"/g, '\\"')}"`;
    }),
  );
}
