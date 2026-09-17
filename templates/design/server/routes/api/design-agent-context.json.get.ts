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

import { DESIGN_AGENT_RESOURCE_KIND } from "../../../shared/agent-readable.js";
import { getDb, schema } from "../../db/index.js";
import { buildDesignHandoffPayload } from "../../lib/coding-handoff.js";
import { buildDesignSnapshot } from "../../lib/design-snapshot.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const query = getQuery(event);
  const id = queryString(query.id);
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design id is required" };
  }

  const token = queryString(query[AGENT_ACCESS_PARAM]);
  const db = getDb();
  // guard:allow-unscoped -- this endpoint returns a design handoff only when it is public or a design-scoped agent_access token verifies for this id.
  const [design] = await db
    .select()
    .from(schema.designs)
    .where(eq(schema.designs.id, id))
    .limit(1);

  if (!design) {
    setResponseStatus(event, 404);
    return { error: "Design not found" };
  }

  const tokenAccess = token
    ? verifyScopedAgentAccessToken(token, {
        resourceKind: DESIGN_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  if (design.visibility !== "public" && !tokenAccess) {
    setResponseStatus(event, 403);
    return { error: "Invalid or expired agent access token" };
  }

  const snapshot = await buildDesignSnapshot(id, design.data);
  if (snapshot.files.length === 0) {
    setResponseStatus(event, 404);
    return { error: "This design has no files to hand off yet" };
  }

  return {
    resourceType: "design",
    id: design.id,
    visibility: design.visibility,
    url: `/design/${design.id}`,
    handoff: buildDesignHandoffPayload({
      design,
      files: snapshot.files.map((f) => ({
        filename: f.filename,
        fileType: f.fileType,
        content: f.content,
      })),
      resolvedCssVars: snapshot.resolvedCssVars,
    }),
    appliedTweaks: snapshot.appliedTweaks,
    resolvedCssVars: snapshot.resolvedCssVars,
  };
});
