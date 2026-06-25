import { defineAction } from "@agent-native/core";
import { organizations } from "@agent-native/core/org";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  resolvePlanAccessContext,
} from "../server/lib/local-identity.js";

function isRealSignedInUser(email: string | null | undefined): boolean {
  return Boolean(
    email && !isAnonymousPublicViewer(email) && !isGuestAuthorIdentity(email),
  );
}

async function getOrgName(orgId: string | null | undefined) {
  if (!orgId) return null;
  try {
    const [org] = await getDb()
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return org?.name ?? null;
  } catch {
    return null;
  }
}

export default defineAction({
  description:
    "Return whether a plan URL exists and whether the current viewer can access it. This reveals only existence/access metadata, never plan content.",
  schema: z.object({
    planId: z.string().min(1).describe("Plan ID to check."),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({ planId }) => {
    const rawViewerEmail = getRequestUserEmail() ?? null;
    const viewerEmail = isRealSignedInUser(rawViewerEmail)
      ? rawViewerEmail
      : null;
    const viewerName = viewerEmail ? (getRequestUserName() ?? null) : null;

    const [plan] = await getDb()
      .select({
        id: schema.plans.id,
        orgId: schema.plans.orgId,
        visibility: schema.plans.visibility,
        deletedAt: schema.plans.deletedAt,
      })
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);

    if (!plan || plan.deletedAt) {
      return {
        exists: false as const,
        hasAccess: false,
        signedIn: Boolean(viewerEmail),
        viewerEmail,
        viewerName,
        role: null,
        orgId: null,
        orgName: null,
        visibility: null,
      };
    }

    const access = await resolveAccess(
      "plan",
      planId,
      resolvePlanAccessContext(currentAccess()),
    );
    const visibility = plan.visibility ?? "private";
    const canRevealOrg = Boolean(access) || visibility === "org";

    return {
      exists: true as const,
      hasAccess: Boolean(access),
      signedIn: Boolean(viewerEmail),
      viewerEmail,
      viewerName,
      role: access?.role ?? null,
      orgId: canRevealOrg ? (plan.orgId ?? null) : null,
      orgName: canRevealOrg ? await getOrgName(plan.orgId) : null,
      visibility,
    };
  },
});
