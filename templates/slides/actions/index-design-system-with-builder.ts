import { defineAction } from "@agent-native/core";
import {
  startBuilderDesignSystemIndex,
  type BuilderDesignSystemIndexFile,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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

function localBuilderDesignSystemId(builderDesignSystemId: string): string {
  const slug = builderDesignSystemId
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `builder-${slug || "design-system"}`;
}

function builderProxyData({
  builderDesignSystemId,
  jobId,
  builderUrl,
  projectName,
  description,
}: {
  builderDesignSystemId: string;
  jobId: string;
  builderUrl: string;
  projectName?: string;
  description?: string;
}) {
  return JSON.stringify({
    source: "builder",
    builderDesignSystemId,
    builderJobId: jobId,
    builderUrl,
    colors: {
      primary: "var(--primary)",
      secondary: "var(--secondary)",
      accent: "var(--accent)",
      background: "var(--background)",
      surface: "var(--card)",
      text: "var(--foreground)",
      textMuted: "var(--muted-foreground)",
    },
    typography: {
      headingFont: "inherit",
      bodyFont: "inherit",
      headingWeight: "700",
      bodyWeight: "400",
      headingSizes: { h1: "48px", h2: "32px", h3: "24px" },
    },
    spacing: { elementGap: "24px", slidePadding: "48px" },
    borders: { radius: "12px", accentWidth: "1px" },
    logos: [],
    notes: [
      "This is a local proxy for a Builder-indexed design system.",
      `Builder design system id: ${builderDesignSystemId}`,
      `Builder indexing job id: ${jobId}`,
      `Builder URL: ${builderUrl}`,
      projectName ? `Requested name: ${projectName}` : "",
      description ? `Context: ${description}` : "",
      "Use Builder as the source of truth for extracted tokens and guidance.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

function builderProxyInstructions({
  builderDesignSystemId,
  jobId,
  builderUrl,
}: {
  builderDesignSystemId: string;
  jobId: string;
  builderUrl: string;
}) {
  return [
    "This design system is indexed and owned by Builder.",
    `Builder design system id: ${builderDesignSystemId}`,
    `Builder job id: ${jobId}`,
    `Builder URL: ${builderUrl}`,
    "When generating slides, treat Builder as the source of truth for the final extracted tokens, assets, and guidance.",
  ].join("\n");
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

    const db = getDb();
    const now = new Date().toISOString();
    const orgId = getRequestOrgId();
    const baseLocalDesignSystemId = localBuilderDesignSystemId(
      result.designSystemId,
    );
    const title = projectName?.trim() || "Builder indexed design system";
    const localData = builderProxyData({
      builderDesignSystemId: result.designSystemId,
      jobId: result.jobId,
      builderUrl: result.builderUrl,
      projectName,
      description,
    });
    const customInstructions = builderProxyInstructions({
      builderDesignSystemId: result.designSystemId,
      jobId: result.jobId,
      builderUrl: result.builderUrl,
    });
    const [existing] = await db
      .select({
        id: schema.designSystems.id,
        ownerEmail: schema.designSystems.ownerEmail,
      })
      .from(schema.designSystems)
      .where(eq(schema.designSystems.id, baseLocalDesignSystemId))
      .limit(1);
    const localDesignSystemId =
      existing && existing.ownerEmail !== ownerEmail
        ? `${baseLocalDesignSystemId}-${nanoid(8)}`
        : baseLocalDesignSystemId;
    if (existing && existing.ownerEmail === ownerEmail) {
      await db
        .update(schema.designSystems)
        .set({
          title,
          description:
            description ??
            `Builder indexed design system ${result.designSystemId}`,
          data: localData,
          assets: "[]",
          customInstructions,
          updatedAt: now,
        })
        .where(eq(schema.designSystems.id, existing.id));
    } else {
      const [ownedSystem] = await db
        .select({ id: schema.designSystems.id })
        .from(schema.designSystems)
        .where(eq(schema.designSystems.ownerEmail, ownerEmail))
        .limit(1);
      await db.insert(schema.designSystems).values({
        id: localDesignSystemId,
        title,
        description:
          description ??
          `Builder indexed design system ${result.designSystemId}`,
        data: localData,
        assets: "[]",
        customInstructions,
        isDefault: !ownedSystem,
        ownerEmail,
        orgId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      ...result,
      localDesignSystemId,
      uploadedFileCount: files.length,
      instructions: [
        "Builder design-system indexing has started.",
        `Builder design system: ${result.designSystemId}`,
        `Local selectable design system: ${localDesignSystemId}`,
        `Builder job: ${result.jobId}`,
        `Open: ${result.builderUrl}`,
        "Use the local design system id in Slides flows; Builder remains the source of truth for the indexed brand kit.",
      ].join("\n"),
    };
  },
});
