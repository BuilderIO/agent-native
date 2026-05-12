import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getFileBlame } from "../server/lib/github";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Get Git blame for a file path in a GitHub repository. Returns the most recent commit per blame range, who authored it, and any associated PR.",
  schema: z.object({
    owner: z.string().describe("GitHub repository owner (org or user)"),
    repo: z.string().describe("GitHub repository name"),
    path: z.string().describe("File path within the repository"),
    ref: z
      .string()
      .default("HEAD")
      .describe("Branch, tag, or commit SHA (default: HEAD)"),
  }),
  readOnly: true,
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["GITHUB_TOKEN"],
      "GitHub",
    );
    if (credentials.ok === false) return credentials.response;

    try {
      const result = await getFileBlame(
        args.owner,
        args.repo,
        args.path,
        args.ref,
      );
      return result;
    } catch (err) {
      return providerError(err);
    }
  },
});
