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

export default defineAction({
  description:
    "Start Builder DSI design-system indexing from connected code, a GitHub repository, code/design files, and optional design.md guidance. " +
    "Use this instead of local import-code/import-github when the user wants a reusable brand kit or design system. " +
    "Requires Builder.io to be connected; Builder owns the indexed design-system docs, generated guidance, token/component extraction, and job state.",
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
      .describe("GitHub repository URL to index with Builder"),
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
    connectedProjectId,
    codeFiles,
    designMd,
  }) => {
    const files = buildBuilderDesignSystemIndexFiles({
      codeFiles,
      designMd,
      // Agent action payloads intentionally stay at the core 2 MB inline
      // budget. Fail loudly instead of silently dropping a larger `.fig`;
      // the setup screen's guarded multipart route supports up to 200 MB.
      overflowBehavior: "throw",
    });
    const result = await startBuilderDesignSystemIndex({
      projectName,
      description,
      githubRepoUrl,
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
    });

    return {
      ...result,
      ...proxy,
      uploadedFileCount: files.length,
    };
  },
});
