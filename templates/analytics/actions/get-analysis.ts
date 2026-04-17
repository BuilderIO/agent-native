import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { getAnalysis } from "../server/lib/dashboards-store";

export default defineAction({
  description: "Get a saved ad-hoc analysis by ID, including its full results.",
  schema: z.object({
    id: z.string().describe("The analysis ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail() || "local@localhost";
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
