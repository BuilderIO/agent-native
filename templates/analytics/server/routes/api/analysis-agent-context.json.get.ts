import {
  AGENT_ACCESS_PARAM,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { ANALYTICS_ANALYSIS_AGENT_RESOURCE_KIND } from "../../../shared/resource-agent-access.js";
import { getDb, schema } from "../../db/index.js";
import { buildAnalysisAgentContext } from "../../lib/agent-readable-resource-context.js";
import type { AnalysisRecord } from "../../lib/dashboards-store.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToAnalysis(row: any): AnalysisRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    question: row.question,
    instructions: row.instructions,
    dataSources: parseJson<string[]>(row.dataSources, []),
    resultMarkdown: row.resultMarkdown,
    resultData: row.resultData
      ? parseJson<Record<string, unknown> | null>(row.resultData, null)
      : null,
    author: row.author ?? null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
  };
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const query = getQuery(event);
  const id = queryString(query.id);
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Analysis id is required" };
  }

  const token = queryString(query[AGENT_ACCESS_PARAM]);
  const db = getDb() as any;
  // guard:allow-unscoped -- this endpoint returns analysis context only when the analysis is public or an analysis-scoped agent_access token verifies for this id.
  const [row] = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.id, id))
    .limit(1);

  if (!row) {
    setResponseStatus(event, 404);
    return { error: "Analysis not found" };
  }

  const tokenAccess = token
    ? verifyScopedAgentAccessToken(token, {
        resourceKind: ANALYTICS_ANALYSIS_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  if (row.visibility !== "public" && !tokenAccess) {
    setResponseStatus(event, 403);
    return { error: "Invalid or expired agent access token" };
  }

  return buildAnalysisAgentContext(rowToAnalysis(row));
});
