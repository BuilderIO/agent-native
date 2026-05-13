import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getFileContent,
  getRepo,
  listRepos,
  searchCode,
} from "../server/lib/github";
import { getGitHubAccessToken } from "../server/lib/github-oauth";
import { tryRequestCredentialContext } from "../server/lib/credentials-context";
import { providerError } from "./_provider-action-utils";

const modeSchema = z
  .enum(["list-repos", "repo-info", "search-code", "get-file"])
  .optional();

export default defineAction({
  description:
    "Search and read code from GitHub repositories. Use this to list accessible repos, search code for exact strings like trackI(), and fetch source files for inspection.",
  schema: z.object({
    mode: modeSchema.describe(
      "Operation: list-repos, repo-info, search-code, or get-file. Defaults to search-code when query is provided, get-file when path is provided, otherwise list-repos.",
    ),
    repo: z
      .string()
      .optional()
      .describe("Repository in owner/repo format. Required for get-file."),
    query: z
      .string()
      .optional()
      .describe(
        'Code search query. Examples: "trackI", "\\"trackI()\\"", "event_name".',
      ),
    org: z
      .string()
      .optional()
      .describe("Limit code search to a GitHub organization."),
    user: z.string().optional().describe("Limit code search to a GitHub user."),
    path: z
      .string()
      .optional()
      .describe(
        "Path qualifier for search-code, or the file/directory path for get-file.",
      ),
    extension: z
      .string()
      .optional()
      .describe("Limit code search by extension, e.g. ts, tsx, py."),
    filename: z
      .string()
      .optional()
      .describe("Limit code search by filename, e.g. analytics.ts."),
    ref: z
      .string()
      .optional()
      .describe("Branch, tag, or SHA to use when reading a file."),
    visibility: z
      .enum(["all", "public", "private"])
      .optional()
      .describe("Repository visibility filter for list-repos."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum results to return, 1-100."),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(200_000)
      .optional()
      .describe("Maximum file bytes to return for get-file."),
  }),
  http: false,
  run: async (args) => {
    const ctx = tryRequestCredentialContext();
    if (!ctx) {
      return {
        error: "missing_api_key",
        key: "AUTH",
        label: "Authentication",
        message: "Sign in to access this data source.",
        settingsPath: "/data-sources",
      };
    }
    const { token } = await getGitHubAccessToken(ctx);
    if (!token) {
      return {
        error: "missing_api_key",
        key: "GITHUB_TOKEN",
        label: "GitHub",
        message:
          "Connect GitHub in Settings -> Data sources, then retry the code search.",
        settingsPath: "/data-sources",
      };
    }

    const mode =
      args.mode ??
      (args.path && args.repo && !args.query
        ? "get-file"
        : args.query
          ? "search-code"
          : "list-repos");

    try {
      if (mode === "list-repos") {
        const repos = await listRepos({
          query: args.query,
          visibility: args.visibility,
          limit: args.limit,
        });
        return { repos, total: repos.length };
      }

      if (mode === "repo-info") {
        if (!args.repo) return { error: "repo is required for repo-info" };
        const [owner, repo] = args.repo.split("/");
        if (!owner || !repo) {
          return { error: "repo must be in owner/repo format" };
        }
        return { repo: await getRepo(owner, repo) };
      }

      if (mode === "get-file") {
        if (!args.repo || !args.path) {
          return { error: "repo and path are required for get-file" };
        }
        return {
          file: await getFileContent({
            repo: args.repo,
            path: args.path,
            ref: args.ref,
            maxBytes: args.maxBytes,
          }),
        };
      }

      if (!args.query) return { error: "query is required for search-code" };
      const results = await searchCode({
        query: args.query,
        repo: args.repo,
        org: args.org,
        user: args.user,
        path: args.path,
        extension: args.extension,
        filename: args.filename,
        limit: args.limit,
      });
      return { results, total: results.length };
    } catch (err) {
      return providerError(err);
    }
  },
});
