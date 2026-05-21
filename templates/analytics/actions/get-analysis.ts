import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";
import { getAnalysis } from "../server/lib/dashboards-store";

const MCP_APP_FRAME_DOMAINS = [
  "https:",
  "http://localhost:*",
  "http://127.0.0.1:*",
];

export default defineAction({
  description: "Get a saved ad-hoc analysis by ID, including its full results.",
  schema: z.object({
    id: z.string().describe("The analysis ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    resource: embedApp({
      title: "Analysis preview",
      description: "Open the saved analysis in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open analysis",
      frameDomains: MCP_APP_FRAME_DOMAINS,
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
    const a = await getAnalysis(args.id, { email, orgId });
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
    };
  },
});
