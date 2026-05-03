import { defineAction } from "@agent-native/core";
import {
  getBuilderBranchProjectId,
  resolveBuilderCredentials,
  runBuilderAgent,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description:
    "Request a production code change through configured Builder branch creation. Use this in production when the user asks to modify UI, add features, change styles, fix bugs, or update source code.",
  schema: z.object({
    description: z
      .string()
      .optional()
      .describe("A clear description of the code change requested by the user"),
    files: z
      .string()
      .optional()
      .describe(
        "Optional comma-separated list of files likely involved in the change",
      ),
  }),
  http: false,
  run: async (args) => {
    const { description, files } = args;

    if (!description?.trim()) {
      return "Error: --description is required.";
    }

    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      return [
        "request-code-change is only active in production.",
        "In development, you can edit files directly via the dev agent tools.",
        `Requested change: "${description}"`,
      ].join("\n");
    }

    const projectId = getBuilderBranchProjectId();
    if (!projectId) {
      return {
        status: "not_configured",
        description,
        ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
        message:
          "Production code changes need Builder branch creation to be configured. Set ENABLE_BUILDER=true with BUILDER_BRANCH_PROJECT_ID or BUILDER_PROJECT_ID, then connect Builder credentials for this user or deployment.",
      };
    }

    const credentials = await resolveBuilderCredentials().catch(() => null);
    if (!credentials?.privateKey || !credentials.publicKey) {
      return {
        status: "not_configured",
        projectId,
        description,
        ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
        message:
          "Builder branch creation is enabled, but Builder credentials are not connected. Connect Builder for this user or configure deployment-managed Builder credentials.",
      };
    }

    const userEmail = getRequestUserEmail() || undefined;
    const userId = credentials.userId || undefined;
    if (!userEmail && !userId) {
      return {
        status: "not_authenticated",
        projectId,
        description,
        ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
        message:
          "A signed-in user or Builder user ID is required to start a production code branch.",
      };
    }

    const prompt = [
      "Make this production code change in the app:",
      description,
      files?.trim() ? `Likely files: ${files}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await runBuilderAgent({
      prompt,
      projectId,
      ...(userId ? { userId } : { userEmail }),
    });

    return {
      status: "queued",
      projectId: result.projectId || projectId,
      branchName: result.branchName,
      url: result.url,
      description,
      ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
      message: `Builder branch creation is running. Track the change at: ${result.url}`,
    };
  },
});
