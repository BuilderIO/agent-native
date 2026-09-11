import { defineAction } from "@agent-native/core/action";
import {
  resolveBuilderBranchProjectId,
  resolveBuilderRequestAuthorization,
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
      throw new Error("--description is required.");
    }

    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      return [
        "request-code-change is only active in production.",
        "In development, you can edit files directly via the dev agent tools.",
        `Requested change: "${description}"`,
      ].join("\n");
    }

    const projectId = await resolveBuilderBranchProjectId();
    if (!projectId) {
      return {
        status: "not_configured",
        description,
        ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
        message:
          "Builder branch creation is not available for this organization yet.",
      };
    }

    // OAuth custody wins when connected, falls back to a legacy private key
    // otherwise — same precedence runBuilderAgent applies internally, so this
    // gate must recognize the same two credential kinds or an OAuth-only-
    // connected org gets told branch creation isn't configured at all.
    const authorization = await resolveBuilderRequestAuthorization({
      requiredScope: "builder:agents:run",
    });
    if (
      !authorization ||
      (authorization.source === "legacy" && !authorization.legacyPublicKey)
    ) {
      return {
        status: "not_configured",
        projectId,
        description,
        ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
        message:
          "Builder branch creation is not available for this organization yet.",
      };
    }

    const userEmail = getRequestUserEmail() || undefined;
    const userId = authorization.userId || undefined;
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
