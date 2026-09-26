import {
  defineEventHandler,
  getHeader,
  getMethod,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getOrgContext } from "../org/context.js";
import { getSession } from "../server/auth.js";
import { readBody } from "../server/h3-helpers.js";
import { getRequestContext } from "../server/request-context.js";
import { track } from "../tracking/registry.js";
import { emitAiFeedbackSurveyEvent } from "./posthog-ai.js";
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
import { trackingIdentityProperties } from "./tracking-identity.js";
import type { FeedbackType, ExperimentStatus } from "./types.js";

const FEEDBACK_TYPES = [
  "thumbs_up",
  "thumbs_down",
  "category",
  "text",
] as const satisfies readonly FeedbackType[];

function isFeedbackType(value: unknown): value is FeedbackType {
  return (
    typeof value === "string" &&
    (FEEDBACK_TYPES as readonly string[]).includes(value)
  );
}

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

async function feedbackReadScope(
  event: H3Event,
  userId: string,
): Promise<{ orgId: string } | { userId: string; orgId?: string }> {
  const org = await getOrgContext(event);
  return org.orgId && (org.role === "owner" || org.role === "admin")
    ? { orgId: org.orgId }
    : { userId, ...(org.orgId ? { orgId: org.orgId } : {}) };
}

function canManageExperiments(ownerEmail: string): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const admins = (process.env.AGENT_NATIVE_EXPERIMENT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(ownerEmail.trim().toLowerCase());
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
    const rawMethod = getMethod(event);
    const method = rawMethod === "HEAD" ? "GET" : rawMethod;
    const pathname = (event.url?.pathname || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const parts = pathname ? pathname.split("/") : [];

    const owner = await resolveOwner(event);

    if (method === "GET" && parts.length === 0) {
      const q = getQuery(event);
      const sinceMs = parseSince(q);
      return getObservabilityOverview(sinceMs, { userId: owner });
    }

    if (method === "GET" && parts.length === 1 && parts[0] === "traces") {
      const q = getQuery(event);
      return getTraceSummaries({
        sinceMs: parseSince(q),
        limit: parseLimit(q),
        userId: owner,
      });
    }

    if (
      method === "GET" &&
      parts.length === 3 &&
      parts[0] === "traces" &&
      parts[2] === "evals"
    ) {
      return getEvalsForRun(decodeURIComponent(parts[1]), { userId: owner });
    }

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

    if (
      method === "GET" &&
      parts.length === 2 &&
      parts[0] === "feedback" &&
      parts[1] === "stats"
    ) {
      setResponseHeader(event, "Cache-Control", "private, no-store");
      const q = getQuery(event);
      return getFeedbackStats(
        parseSince(q),
        await feedbackReadScope(event, owner),
      );
    }

    if (method === "POST" && parts.length === 1 && parts[0] === "feedback") {
      let body: any;
      try {
        body = await readBody(event);
      } catch {
        setResponseStatus(event, 400);
        return { error: "Invalid JSON body" };
      }
      const feedbackType = body?.feedbackType;
      if (!isFeedbackType(feedbackType)) {
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
      const idempotencyKey =
        feedbackType === "text"
          ? getHeader(event, "idempotency-key")?.trim() || null
          : null;
      const org = await getOrgContext(event);
      const runId = body.runId ? String(body.runId) : null;
      let threadId = body.threadId ? String(body.threadId) : null;
      let model: string | undefined;
      let orgId = org.orgId;
      if (runId) {
        const summary = await getTraceSummary(runId, {
          userId: owner,
          ...(org.orgId ? { orgId: org.orgId } : {}),
        });
        if (!summary || (threadId && threadId !== summary.threadId)) {
          setResponseStatus(event, 404);
          return { error: "Trace not found" };
        }
        threadId = summary.threadId;
        model = summary.model || undefined;
        orgId = summary.orgId ?? org.orgId;
      }
      const inserted = await insertFeedback({
        id,
        runId,
        threadId,
        messageSeq:
          typeof body.messageSeq === "number" ? body.messageSeq : null,
        feedbackType,
        value,
        idempotencyKey,
        userId: owner,
        orgId,
        source: "chat",
        createdAt: Date.now(),
      });
      if (!inserted) return { id };
      {
        const isThumb =
          feedbackType === "thumbs_up" || feedbackType === "thumbs_down";

        track(
          "$ai_feedback",
          {
            ...trackingIdentityProperties(),
            source: "agent_observability",
            ...(isThumb
              ? {
                  sentiment:
                    feedbackType === "thumbs_up" ? "positive" : "negative",
                }
              : {}),
            feedback_type: feedbackType,
            run_id: runId,
            thread_id: threadId,
            model,
            $ai_trace_id: runId ?? undefined,
            $ai_session_id: threadId ?? undefined,
            $ai_model: model,
          },
          { userId: owner },
        );

        emitAiFeedbackSurveyEvent({
          runId,
          threadId,
          userId: owner,
          feedbackType,
          value,
          submissionId:
            runId && typeof body.messageSeq === "number"
              ? `${runId}:${body.messageSeq}`
              : id,
          model,
          browserSessionId: getRequestContext()?.browserSessionId,
        });
      }
      if (threadId) {
        import("./feedback.js")
          .then(({ computeSatisfactionScore }) =>
            computeSatisfactionScore(threadId!, {
              userId: owner,
            }).catch(() => {}),
          )
          .catch(() => {});
      }
      return { id };
    }

    if (method === "GET" && parts.length === 1 && parts[0] === "feedback") {
      setResponseHeader(event, "Cache-Control", "private, no-store");
      const q = getQuery(event);
      return getFeedback({
        sinceMs: parseSince(q),
        limit: parseLimit(q),
        feedbackType: isFeedbackType(q.feedbackType)
          ? q.feedbackType
          : undefined,
        source: "chat",
        ...(await feedbackReadScope(event, owner)),
      });
    }

    if (method === "GET" && parts.length === 1 && parts[0] === "satisfaction") {
      const q = getQuery(event);
      return getSatisfactionScores({
        sinceMs: parseSince(q),
        userId: owner,
      });
    }

    if (
      method === "GET" &&
      parts.length === 2 &&
      parts[0] === "evals" &&
      parts[1] === "stats"
    ) {
      const q = getQuery(event);
      return getEvalStats(parseSince(q), { userId: owner });
    }

    if (parts[0] === "experiments" && !canManageExperiments(owner)) {
      setResponseStatus(event, 403);
      return { error: "Experiment administrator access required" };
    }

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
        ownerEmail: owner,
      });
      return { id };
    }

    if (method === "GET" && parts.length === 1 && parts[0] === "experiments") {
      return listExperiments();
    }

    if (
      method === "POST" &&
      parts.length === 3 &&
      parts[0] === "experiments" &&
      parts[2] === "results"
    ) {
      const id = decodeURIComponent(parts[1]);
      const existing = await getExperiment(id);
      if (!existing) {
        setResponseStatus(event, 404);
        return { error: "Experiment not found" };
      }
      if (existing.ownerEmail && existing.ownerEmail !== owner) {
        setResponseStatus(event, 404);
        return { error: "Experiment not found" };
      }
      try {
        const { computeExperimentResults } = await import("./experiments.js");
        const results = await computeExperimentResults(id);
        return results;
      } catch (err: any) {
        setResponseStatus(event, 500);
        return { error: err?.message ?? "Failed to compute results" };
      }
    }

    if (
      method === "GET" &&
      parts.length === 3 &&
      parts[0] === "experiments" &&
      parts[2] === "results"
    ) {
      return getExperimentResults(decodeURIComponent(parts[1]));
    }

    if (method === "PUT" && parts.length === 2 && parts[0] === "experiments") {
      const id = decodeURIComponent(parts[1]);
      const existing = await getExperiment(id);
      if (!existing) {
        setResponseStatus(event, 404);
        return { error: "Experiment not found" };
      }
      if (existing.ownerEmail && existing.ownerEmail !== owner) {
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
