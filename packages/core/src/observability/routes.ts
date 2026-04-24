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
 *   GET    /experiments/:id/results    — get experiment results
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession } from "../server/auth.js";
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
  return session?.email || "local@localhost";
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
    if (!owner || owner === "local@localhost") {
      const isLocal =
        process.env.NODE_ENV !== "production" ||
        process.env.AUTH_MODE === "local";
      if (!isLocal) {
        setResponseStatus(event, 401);
        return { error: "Authentication required" };
      }
    }

    // GET / — overview stats
    if (method === "GET" && parts.length === 0) {
      const q = getQuery(event);
      const sinceMs = parseSince(q);
      return getObservabilityOverview(sinceMs);
    }

    // GET /traces — list trace summaries
    if (method === "GET" && parts.length === 1 && parts[0] === "traces") {
      const q = getQuery(event);
      return getTraceSummaries({
        sinceMs: parseSince(q),
        limit: parseLimit(q),
      });
    }

    // GET /traces/:runId/evals — evals for a specific run
    if (
      method === "GET" &&
      parts.length === 3 &&
      parts[0] === "traces" &&
      parts[2] === "evals"
    ) {
      return getEvalsForRun(decodeURIComponent(parts[1]));
    }

    // GET /traces/:runId — trace detail (summary + spans)
    if (method === "GET" && parts.length === 2 && parts[0] === "traces") {
      const runId = decodeURIComponent(parts[1]);
      const [summary, spans] = await Promise.all([
        getTraceSummary(runId),
        getTraceSpansForRun(runId),
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
      return getFeedbackStats(parseSince(q));
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
      return { id };
    }

    // GET /feedback — list feedback entries
    if (method === "GET" && parts.length === 1 && parts[0] === "feedback") {
      const q = getQuery(event);
      return getFeedback({
        sinceMs: parseSince(q),
        limit: parseLimit(q),
      });
    }

    // GET /satisfaction — satisfaction scores
    if (method === "GET" && parts.length === 1 && parts[0] === "satisfaction") {
      const q = getQuery(event);
      return getSatisfactionScores({ sinceMs: parseSince(q) });
    }

    // GET /evals/stats — eval stats
    if (
      method === "GET" &&
      parts.length === 2 &&
      parts[0] === "evals" &&
      parts[1] === "stats"
    ) {
      const q = getQuery(event);
      return getEvalStats(parseSince(q));
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

    // GET /experiments — list experiments
    if (method === "GET" && parts.length === 1 && parts[0] === "experiments") {
      return listExperiments();
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
