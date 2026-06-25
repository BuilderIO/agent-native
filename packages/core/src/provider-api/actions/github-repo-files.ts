import { z } from "zod";

import { defineAction } from "../../action.js";
import type {
  GitHubRepositoryFileDeleteArgs,
  GitHubRepositoryFileListArgs,
  GitHubRepositoryFileReadArgs,
  GitHubRepositoryFileSearchArgs,
  GitHubRepositoryFileWriteArgs,
  ProviderApiRuntime,
} from "../index.js";

const GitHubCommitIdentitySchema = z.object({
  name: z.string().min(1).describe("Commit identity name."),
  email: z.string().email().describe("Commit identity email."),
  date: z.string().optional().describe("Optional ISO timestamp."),
});

const GitHubRepoFilesActionSchema = z.object({
  operation: z
    .enum(["list", "search", "read", "write", "delete"])
    .describe(
      "Operation to perform: list repository file paths, search code/files, read one file, create/update one file, or delete one file.",
    ),
  owner: z.string().min(1).describe("Repository owner or organization."),
  repo: z
    .string()
    .min(1)
    .describe("Repository name, with or without a trailing .git suffix."),
  path: z
    .string()
    .optional()
    .describe(
      "Repository-relative file or directory path. For search without query, this filters matching paths.",
    ),
  ref: z
    .string()
    .optional()
    .describe(
      "Branch, tag, or commit-ish for list/read. Code search uses GitHub's default-branch search.",
    ),
  recursive: z
    .boolean()
    .optional()
    .describe("For list, read the repository tree recursively."),
  includeDirectories: z
    .boolean()
    .optional()
    .describe("For list, include directory entries along with files."),
  query: z
    .string()
    .optional()
    .describe(
      "For search, a GitHub code-search term. Omit to search/filter file paths from the repository tree.",
    ),
  filename: z
    .string()
    .optional()
    .describe("For search, restrict to an exact filename."),
  extension: z
    .string()
    .optional()
    .describe("For search, restrict to a file extension such as ts or md."),
  language: z
    .string()
    .optional()
    .describe("For code search, restrict to a GitHub language qualifier."),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("For code search, result page to fetch."),
  perPage: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("For code search, results per page."),
  maxFiles: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .describe(
      "Maximum file entries to return from list or tree-filter search.",
    ),
  includeTextMatches: z
    .boolean()
    .optional()
    .describe("For code search, request GitHub text-match metadata."),
  content: z
    .string()
    .optional()
    .describe("For write, complete replacement UTF-8 file content."),
  message: z.string().optional().describe("For write, commit message."),
  branch: z
    .string()
    .optional()
    .describe(
      "For write, branch to create/update on. Defaults to GitHub's default branch.",
    ),
  sha: z
    .string()
    .optional()
    .describe(
      "For write updates, the current blob SHA. The action reads it first by default when omitted.",
    ),
  overwriteExisting: z
    .boolean()
    .optional()
    .describe(
      "For write, read the current file SHA first when sha is omitted, then update if it exists. Defaults to true.",
    ),
  committer: GitHubCommitIdentitySchema.optional().describe(
    "Optional GitHub contents API committer identity.",
  ),
  author: GitHubCommitIdentitySchema.optional().describe(
    "Optional GitHub contents API author identity.",
  ),
  connectionId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional workspace GitHub connection id to use."),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .optional()
    .describe("Request timeout in milliseconds."),
  maxBytes: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(4 * 1024 * 1024)
    .optional()
    .describe("Maximum provider response bytes to read."),
});

type GitHubRepoFilesActionArgs = z.infer<typeof GitHubRepoFilesActionSchema>;

export interface CreateGitHubRepoFilesActionOptions {
  description?: string;
  requireApprovalForWrites?: boolean;
}

export function createGitHubRepoFilesAction(
  runtime: Pick<
    ProviderApiRuntime,
    | "listGitHubRepositoryFiles"
    | "searchGitHubRepositoryFiles"
    | "readGitHubRepositoryFile"
    | "writeGitHubRepositoryFile"
    | "deleteGitHubRepositoryFile"
  >,
  options: CreateGitHubRepoFilesActionOptions = {},
) {
  const requireApprovalForWrites = options.requireApprovalForWrites ?? true;
  return defineAction({
    description:
      options.description ??
      "List, search, read, create/update, and delete GitHub repository files through the configured GitHub connector or GITHUB_TOKEN. Uses GitHub REST APIs directly; it does not clone repositories or use a filesystem sandbox.",
    schema: GitHubRepoFilesActionSchema,
    http: false,
    needsApproval: requireApprovalForWrites
      ? (args: GitHubRepoFilesActionArgs) =>
          args.operation === "write" || args.operation === "delete"
      : false,
    run: async (args) => {
      if (args.operation === "list") {
        return runtime.listGitHubRepositoryFiles({
          owner: args.owner,
          repo: args.repo,
          path: args.path,
          ref: args.ref,
          recursive: args.recursive,
          includeDirectories: args.includeDirectories,
          maxFiles: args.maxFiles,
          connectionId: args.connectionId,
          timeoutMs: args.timeoutMs,
          maxBytes: args.maxBytes,
        } satisfies GitHubRepositoryFileListArgs);
      }

      if (args.operation === "search") {
        return runtime.searchGitHubRepositoryFiles({
          owner: args.owner,
          repo: args.repo,
          query: args.query,
          path: args.path,
          filename: args.filename,
          extension: args.extension,
          language: args.language,
          ref: args.ref,
          perPage: args.perPage,
          page: args.page,
          maxFiles: args.maxFiles,
          includeTextMatches: args.includeTextMatches,
          connectionId: args.connectionId,
          timeoutMs: args.timeoutMs,
          maxBytes: args.maxBytes,
        } satisfies GitHubRepositoryFileSearchArgs);
      }

      if (args.operation === "read") {
        if (!args.path) throw new Error("path is required for read.");
        return runtime.readGitHubRepositoryFile({
          owner: args.owner,
          repo: args.repo,
          path: args.path,
          ref: args.ref,
          connectionId: args.connectionId,
          timeoutMs: args.timeoutMs,
          maxBytes: args.maxBytes,
        } satisfies GitHubRepositoryFileReadArgs);
      }

      if (!args.path) {
        throw new Error(`path is required for ${args.operation}.`);
      }
      if (args.operation === "delete") {
        return runtime.deleteGitHubRepositoryFile({
          owner: args.owner,
          repo: args.repo,
          path: args.path,
          message: args.message ?? `Delete ${args.path}`,
          branch: args.branch,
          sha: args.sha,
          committer: args.committer,
          author: args.author,
          connectionId: args.connectionId,
          timeoutMs: args.timeoutMs,
          maxBytes: args.maxBytes,
        } satisfies GitHubRepositoryFileDeleteArgs);
      }

      if (args.content === undefined) {
        throw new Error("content is required for write.");
      }
      if (!args.message) throw new Error("message is required for write.");
      return runtime.writeGitHubRepositoryFile({
        owner: args.owner,
        repo: args.repo,
        path: args.path,
        content: args.content,
        message: args.message,
        branch: args.branch,
        sha: args.sha,
        overwriteExisting: args.overwriteExisting ?? true,
        committer: args.committer,
        author: args.author,
        connectionId: args.connectionId,
        timeoutMs: args.timeoutMs,
        maxBytes: args.maxBytes,
      } satisfies GitHubRepositoryFileWriteArgs);
    },
  });
}

export { GitHubRepoFilesActionSchema };
