import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { readPrivateBlob, type PrivateBlobHandle } from "@agent-native/core/private-blob";
import { getRequestOrgId, getRequestUserEmail } from "@agent-native/core/server";
import { resolveNativeContextCloneReference } from "@agent-native/creative-context/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store.js";

const payloadSchema = z.object({ id: z.string(), kind: z.enum(["explorer", "sql"]), title: z.string(), config: z.record(z.string(), z.unknown()), updatedAt: z.string() });

export default defineAction({
  description: "Clone an exact governed SQL-backed Analytics dashboard without executing any of its queries.",
  schema: z.object({ contextId: z.string(), artifactKey: z.string(), resourceId: z.string(), expectedUpdatedAt: z.string().optional(), title: z.string().optional() }),
  run: async (args) => {
    const email = getRequestUserEmail(); if (!email) throw new Error("no authenticated user"); const orgId = getRequestOrgId() ?? null;
    const reference = await resolveNativeContextCloneReference({ appId: "analytics", resourceType: "dashboard", resourceId: args.resourceId, expectedUpdatedAt: args.expectedUpdatedAt, contextId: args.contextId, artifactKey: args.artifactKey });
    const raw = await readPrivateBlob(reference.cloneHandle as PrivateBlobHandle); const body = Buffer.from(raw.data).toString("utf8"); const hash = createHash("sha256").update(body).digest("hex");
    if (raw.metadata?.appId !== "analytics" || raw.metadata?.resourceType !== "dashboard" || raw.metadata?.resourceId !== args.resourceId || raw.metadata?.contentHash !== hash) throw new Error("Governed dashboard clone payload failed integrity verification.");
    const payload = payloadSchema.parse(JSON.parse(body)); const id = `sql-dashboard-${nanoid()}`;
    const dashboard = await upsertDashboard(id, payload.kind, { title: args.title?.trim() || `Copy of ${payload.title}`, ...payload.config }, { email, orgId });
    const persisted = await getDashboard(id, { email, orgId });
    if (!persisted || persisted.updatedAt !== dashboard.updatedAt) throw new Error("Dashboard clone did not persist.");
    return { id: persisted.id, title: persisted.title, kind: persisted.kind, clonedExactVersion: reference.publishedItemVersionId };
  },
});
