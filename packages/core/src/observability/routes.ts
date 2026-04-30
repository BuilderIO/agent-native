/**
 * H3 event handlers for the agent observability system.
 *
 * Mounted under `/_agent-native/observability/*` by the observability plugin.
 *
 *   GET    /                           — overview stats
 *   GET    /traces?since=N&limit=N     — list trace summaries
 *   GET    /traces/:runId              — get trace detail (spans + summary)
 *   GET    /traces/:runId/evals        — get evals for a run
 *   POST   /feedback                   — submit feedback
 *   GET    /feedback?since=N&limit=N   — list feedback entries
 *   GET    /feedback/stats?since=N     — feedback aggregation stats
 *   GET    /satisfaction?since=N       — satisfaction scores
 *   GET    /evals/stats?since=N        — eval stats
 *   GET    /experiments                — list experiments
 *   POST   /experiments                — create experiment
 *   GET    /experiments/:id            — get experiment detail
 *   PUT    /experiments/:id            — update experiment
 *   POST   /experiments/:id/results    — compute experiment results
 *   GET    /experiments/:id/results    — get experiment results
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession, DEV_MODE_USER_EMAIL } from "../server/auth.js";
import { readBody } from "../server/h3-helpers.js";
import {
  getObservabilityOverview,
  getTraceSummaries,
  getTraceSummary,
  getTraceSpansForRun,
  getEvalsForRun,
  insertFeedback,
  getFeedback,
  getFeedbackStats,
  getSatisfactionScores,
  getEvalStats,
  listExperiments,
  insertExperiment,
  getExperiment,
  updateExperiment,
  getExperimentResults,
} from "./store.js";
import type { FeedbackType, ExperimentStatus } from "./types.js";

function nanoid(size = 21): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

async function resolveOwner(event: H3Event): Promise<string> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

function parseSince(q: Record<string, any>): number {
  const raw = q.since;
  if (typeof raw === "string" && raw.length > 0) {
    const n = Number(raw);
    if (!isNaN(n) && n >= 0) return n;
  }
  return Date.now() - 7 * 86_400_000;
}

function parseLimit(q: Record<string, any>, fallback = 100): number {
  const raw = q.limit;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!isNaN(n) && n > 0) return Math.min(n, 500);
  }
  return fallback;
}

export function createObservabilityHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const pathname = (event.url?.pathname || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const parts = pathname ? pathname.split("/") : [];

    const owner = await resolveOwner(event);
    if (!owner || owner === DEV_MODE_USER_EMAIL) {
      const isLocal =
        process.env.NODE_ENV !== "production" ||
        process.env.AUTH_MODE === "local";
      if (!isLocal) {
        setResponseStatus(event, 401);
        return { error: "Authentication required" };
      }
    }

    // Every read endpoint passes `userId: owner` to the store. Omitting
    // it returns rows from every user — load-bearing.

    // GET / — overview stats
    if (method === "GET" && parts.length === 0) {
      const q = getQuery(event);
      const sinceMs = parseSince(q);
      return getObservabilityOverview(sinceMs, { userId: owner });
    }

    // GET /traces — list trace summaries
    if (method === "GET" && parts.length === 1 && parts[0] === "traces") {
      const q = getQuery(event);
      return getTraceSummaries({
        sinceMs: parseSince(q),
        limit: parseLimit(q),
        userId: owner,
      });
    }

    // GET /traces/:runId/evals — evals for a specific run
    if (
      method === "GET" &&
      parts.length === 3 &&
      parts[0] === "traces" &&
      parts[2] === "evals"
    ) {
      return getEvalsForRun(decodeURIComponent(parts[1]), { userId: owner });
    }

    // GET /traces/:runId — trace detail (summary + spans). Looking up by
    // runId opens an IDOR vector if we don't ALSO scope to the owner —
    // a user who knows or guesses another user's runId would otherwise
    // get back the trace. The `userId: owner` filter on both lookups
    // returns 404 instead.
    if (method === "GET" && parts.length === 2 && parts[0] === "traces") {
      const runId = decodeURIComponent(parts[1]);
      const [summary, spans] = await Promise.all([
        getTraceSummary(runId, { userId: owner }),
        getTraceSpansForRun(runId, { userId: owner }),
      ]);
      if (!summary) {
        setResponseStatus(event, 404);
        return { error: "Trace not found" };
      }
      return { summary, spans };
    }

    // GET /feedback/stats — feedback aggregation stats
    if (
      method === "GET" &&
      parts.length === 2 &&
      parts[0] === "feedback" &&
      parts[1] === "stats"
    ) {
      const q = getQuery(event);
      return getFeedbackStats(parseSince(q), { userId: owner });
    }

    // POST /feedback — submit feedback
    if (method === "POST" && parts.length === 1 && parts[0] === "feedback") {
      let body: any;
      try {
        body = await readBody(event);
      } catch {
        setResponseStatus(event, 400);
        return { error: "Invalid JSON body" };
      }
      const feedbackType = body?.feedbackType as FeedbackType | undefined;
      if (
        !feedbackType ||
        !["thumbs_up", "thumbs_down", "category", "text"].includes(feedbackType)
      ) {
        setResponseStatus(event, 400);
        return { error: "feedbackType is required" };
      }
      const rawValue = body.value;
      const value =
        rawValue == null
          ? ""
          : typeof rawValue === "object"
            ? JSON.stringify(rawValue)
            : String(rawValue);
      const id = nanoid();
      await insertFeedback({
        id,
        runId: body.runId ? String(body.runId) : null,
        threadId: body.threadId ? String(body.threadId) : null,
        messageSeq:
          typeof body.messageSeq === "number" ? body.messageSeq : null,
        feedbackType,
        value,
        userId: owner,
        createdAt: Date.now(),
      });
      // Fire-and-forget: recompute satisfaction score for the thread.
      if (body.threadId) {
        import("./feedback.js")
          .then(({ computeSatisfactionScore }) =>
            computeSatisfactionScore(String(body.threadId), {
              userId: owner,
            }).catch(() => {}),
          )
          .catch(() => {});
      }
      return { id };
    }

    // GET /feedback — list feedback entries
    if (method === "GET" && parts.length === 1 && parts[0] === "feedback") {
      const q = getQuery(event);
      return getFeedback({
        sinceMs: parseSince(q),
        limit: parseLimit(q),
        userId: owner,
      });
    }

    // GET /satisfaction — satisfaction scores
    if (method === "GET" && parts.length === 1 && parts[0] === "satisfaction") {
      const q = getQuery(event);
      return getSatisfactionScores({
        sinceMs: parseSince(q),
        userId: owner,
      });
    }

    // GET /evals/stats — eval stats
    if (
      method === "GET" &&
      parts.length === 2 &&
      parts[0] === "evals" &&
      parts[1] === "stats"
    ) {
      const q = getQuery(event);
      return getEvalStats(parseSince(q), { userId: owner });
    }

    // POST /experiments — create experiment
    if (method === "POST" && parts.length === 1 && parts[0] === "experiments") {
      let body: any;
      try {
        body = await readBody(event);
      } catch {
        setResponseStatus(event, 400);
        return { error: "Invalid JSON body" };
      }
      if (!body?.name) {
        setResponseStatus(event, 400);
        return { error: "name is required" };
      }
      if (body.variants !== undefined && !Array.isArray(body.variants)) {
        setResponseStatus(event, 400);
        return { error: "variants must be an array" };
      }
      const id = nanoid();
      await insertExperiment({
        id,
        name: String(body.name),
        status: "draft",
        variants: Array.isArray(body.variants) ? body.variants : [],
        metrics: Array.isArray(body.metrics) ? body.metrics : [],
        assignmentLevel:
          body.assignmentLevel === "session" ? "session" : "user",
        startedAt: null,
        endedAt: null,
        createdAt: Date.now(),
      });
      return { id };
    }

    // Experiments are platform-wide A/B test configurations — they assign
    // variants across all users, so reads are NOT per-user scoped. Writes
    // are gated by authentication above (only authenticated users or
    // local-dev can reach this point).

    // GET /experiments — list experiments
    if (method === "GET" && parts.length === 1 && parts[0] === "experiments") {
      return listExperiments();
    }

    // POST /experiments/:id/results — compute experiment results
    if (
      method === "POST" &&
      parts.length === 3 &&
      parts[0] === "experiments" &&
      parts[2] === "results"
    ) {
      try {
        const { computeExperimentResults } = await import("./experiments.js");
        const results = await computeExperimentResults(
          decodeURIComponent(parts[1]),
        );
        return results;
      } catch (err: any) {
        setResponseStatus(event, 500);
        return { error: err?.message ?? "Failed to compute results" };
      }
    }

    // GET /experiments/:id/results — experiment results
    if (
      method === "GET" &&
      parts.length === 3 &&
      parts[0] === "experiments" &&
      parts[2] === "results"
    ) {
      return getExperimentResults(decodeURIComponent(parts[1]));
    }

    // PUT /experiments/:id — update experiment
    if (method === "PUT" && parts.length === 2 && parts[0] === "experiments") {
      const id = decodeURIComponent(parts[1]);
      const existing = await getExperiment(id);
      if (!existing) {
        setResponseStatus(event, 404);
        return { error: "Experiment not found" };
      }
      let body: any;
      try {
        body = await readBody(event);
      } catch {
        setResponseStatus(event, 400);
        return { error: "Invalid JSON body" };
      }
      const updates: Record<string, any> = {};
      if (typeof body.name === "string") updates.name = body.name;
      if (typeof body.status === "string") {
        const s = body.status as ExperimentStatus;
        if (!["draft", "running", "paused", "completed"].includes(s)) {
          setResponseStatus(event, 400);
          return { error: "Invalid status" };
        }
        updates.status = s;
        if (s === "completed") updates.endedAt = Date.now();
      }
      if (Array.isArray(body.variants)) updates.variants = body.variants;
      if (Array.isArray(body.metrics)) updates.metrics = body.metrics;
      await updateExperiment(id, updates);
      return { ok: true };
    }

    // GET /experiments/:id — experiment detail
    if (method === "GET" && parts.length === 2 && parts[0] === "experiments") {
      const exp = await getExperiment(decodeURIComponent(parts[1]));
      if (!exp) {
        setResponseStatus(event, 404);
        return { error: "Experiment not found" };
      }
      return exp;
    }

    setResponseStatus(event, 404);
    return { error: "Not found" };
  });
}
