import { defineAction, embedApp } from "@agent-native/core";
import {
  currentRequestUserIsOrgAdmin,
  getAppConfig,
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  getAnalysis,
  getAnalysisForReview,
} from "../server/lib/dashboards-store";

export default defineAction({
  description: "Get a saved ad-hoc analysis by ID, including its full results.",
  schema: z.object({
    id: z.string().describe("The analysis ID"),
    reviewPreview: z
      .boolean()
      .optional()
      .describe(
        "Human Review only: read a saved analysis for an organization owner/admin. Cross-organization reads are limited to the single organization configured as this app's observability super organization.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Analysis preview",
      description: "Open the saved analysis in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open analysis",
      height: 680,
    }),
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const a = result as { id?: string; error?: string };
    if (a.error || !a.id) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "analyses",
        params: { analysisId: a.id },
      }),
      label: "Open analysis in Analytics",
      view: "analyses",
    };
  },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    let a;
    if (args.reviewPreview) {
      if (!orgId || !(await currentRequestUserIsOrgAdmin(orgId))) {
        throw Object.assign(
          new Error(
            "Only organization owners and admins can preview reviewed analyses.",
          ),
          { statusCode: 403 },
        );
      }
      const superOrgId = getAppConfig().observability.superOrgId;
      a = await getAnalysisForReview(
        args.id,
        superOrgId === orgId
          ? { kind: "super-organization" }
          : { kind: "organization", orgId },
      );
    } else {
      a = await getAnalysis(args.id, { email, orgId });
    }
    if (!a) return { error: "Analysis not found" };
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      question: a.question,
      instructions: a.instructions,
      dataSources: a.dataSources,
      resultMarkdown: a.resultMarkdown,
      resultData: a.resultData,
      author: a.author,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      ownerEmail: a.ownerEmail,
      orgId: a.orgId,
      visibility: a.visibility,
      role: a.role,
      canEdit: a.canEdit,
      canManage: a.canManage,
    };
  },
});
