import { defineAction } from "@agent-native/core";
import {
  buildBuilderDesignSystemIndexFiles,
  startBuilderDesignSystemIndex,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { upsertBuilderProxyDesignSystem } from "../server/lib/builder-design-system-proxy.js";

const codeFileSchema = z.object({
  filename: z.string().trim().min(1).describe("File name or relative path"),
  content: z
    .string()
    .describe(
      "File content. Text files (code, CSS, markdown, JSON, SVG): raw text. " +
        "Binary files -- most importantly `.fig` (a zip/kiwi binary container, " +
        'never valid text) -- MUST be base64-encoded with encoding: "base64"; ' +
        "sending raw/binary-as-string content with the default utf8 encoding " +
        "corrupts the file before it reaches Builder.",
    ),
  mimeType: z.string().trim().optional().describe("Optional MIME type"),
  encoding: z
    .enum(["utf8", "base64"])
    .optional()
    .describe(
      "Encoding of `content`. Defaults to utf8. Set to base64 for `.fig` and " +
        "other binary files.",
    ),
});

const githubSourceSchema = z.object({
  repoUrl: z.string().trim().min(1).describe("GitHub repository URL"),
  ref: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional branch, tag, or commit"),
  include: z
    .array(z.string().trim().min(1))
    .optional()
    .describe("Optional repository-relative files or folders to include"),
  exclude: z
    .array(z.string().trim().min(1))
    .optional()
    .describe("Optional repository-relative files or folders to exclude"),
  instructions: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional indexing guidance for this repository"),
});

export default defineAction({
  description:
    "Start Builder DSI design-system indexing from connected code, a GitHub repository, code/design files, and optional design.md guidance. " +
    "Use this instead of legacy local code import when the user wants a reusable brand kit or slide design system. " +
    "Requires Builder.io to be connected (free tier available); Builder owns the indexed design-system docs, generated guidance, token/component extraction, and job state.",
  schema: z.object({
    projectName: z
      .string()
      .optional()
      .describe("Optional Builder project/design-system name"),
    description: z
      .string()
      .optional()
      .describe("Additional brand context or instructions for Builder"),
    githubRepoUrl: z
      .string()
      .optional()
      .describe("Legacy single GitHub repository URL to index with Builder"),
    githubSources: z
      .array(githubSourceSchema)
      .min(1)
      .max(20)
      .optional()
      .describe(
        "GitHub repositories to index in one design system. Each source may specify a branch/tag/commit and repository-relative files or folders.",
      ),
    connectedProjectId: z
      .string()
      .optional()
      .describe("Optional existing Builder project id to attach indexing to"),
    codeFiles: z
      .array(codeFileSchema)
      .optional()
      .describe("Optional inlined code/design files to upload to Builder"),
    designMd: z
      .string()
      .optional()
      .describe(
        "Optional design.md guidance to upload to Builder DSI alongside Figma/code sources",
      ),
  }),
  run: async ({
    projectName,
    description,
    githubRepoUrl,
    githubSources,
    connectedProjectId,
    codeFiles,
    designMd,
  }) => {
    const files = buildBuilderDesignSystemIndexFiles({
      codeFiles,
      designMd,
    });
    const result = await startBuilderDesignSystemIndex({
      projectName,
      description,
      githubRepoUrl,
      githubRepos: githubSources,
      connectedProjectId,
      files,
    });
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const proxy = await upsertBuilderProxyDesignSystem({
      result,
      ownerEmail,
      orgId: getRequestOrgId(),
      projectName,
      description,
      githubSources:
        githubSources ?? (githubRepoUrl ? [{ repoUrl: githubRepoUrl }] : []),
      sourceKind:
        (githubSources?.length || githubRepoUrl) &&
        (codeFiles?.length || designMd)
          ? "mixed"
          : githubSources?.length || githubRepoUrl
            ? "github"
            : codeFiles?.length || designMd
              ? "code"
              : undefined,
    });

    return {
      ...result,
      ...proxy,
      uploadedFileCount: files.length,
      githubSourceCount: githubSources?.length ?? (githubRepoUrl ? 1 : 0),
    };
  },
});
