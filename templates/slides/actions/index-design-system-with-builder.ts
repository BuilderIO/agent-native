import { defineAction } from "@agent-native/core";
import {
  startBuilderDesignSystemIndex,
  type BuilderDesignSystemIndexFile,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { upsertBuilderProxyDesignSystem } from "../server/lib/builder-design-system-proxy.js";

const MAX_CODE_FILES = 50;
const MAX_TOTAL_CODE_BYTES = 2 * 1024 * 1024;

const codeFileSchema = z.object({
  filename: z.string().trim().min(1).describe("File name or relative path"),
  content: z.string().describe("Raw text content of the code/design file"),
  mimeType: z.string().trim().optional().describe("Optional MIME type"),
});

function mimeTypeForFilename(filename: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const lower = filename.toLowerCase();
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "text/markdown";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "text/plain";
}

function makeFiles(
  codeFiles: Array<z.infer<typeof codeFileSchema>> | undefined,
): BuilderDesignSystemIndexFile[] {
  const encoder = new TextEncoder();
  const files: BuilderDesignSystemIndexFile[] = [];
  let totalBytes = 0;
  for (const file of (codeFiles ?? []).slice(0, MAX_CODE_FILES)) {
    const data = encoder.encode(file.content);
    if (totalBytes + data.byteLength > MAX_TOTAL_CODE_BYTES) break;
    totalBytes += data.byteLength;
    files.push({
      name: file.filename.replace(/^\/+/, "") || "code.txt",
      data,
      mimeType: mimeTypeForFilename(file.filename, file.mimeType),
    });
  }
  return files;
}

export default defineAction({
  description:
    "Start Builder design-system indexing from a GitHub repository and/or code files. " +
    "Use this instead of local import-code/import-github when the user wants a reusable brand kit or slide design system. " +
    "Requires Builder.io to be connected; Builder owns the indexed design-system docs, generated guidance, and job state.",
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
  }),
  run: async ({
    projectName,
    description,
    githubRepoUrl,
    connectedProjectId,
    codeFiles,
  }) => {
    const files = makeFiles(codeFiles);
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
