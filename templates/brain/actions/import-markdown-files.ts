import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  BrainCaptureBlockedError,
  createCapture,
  ensureManualSource,
  getAccessibleSource,
  serializeSource,
} from "../server/lib/brain.js";
import { enqueueCaptureDistillation } from "../server/lib/distillation-queue.js";

const MAX_MARKDOWN_FILES = 100;
const MAX_MARKDOWN_FILE_CHARS = 250_000;
const MAX_MARKDOWN_BATCH_CHARS = 4_000_000;

type ImportedMarkdownResult =
  | {
      path: string;
      status: "imported";
      captureId: string;
      distillation: "queued" | "existing" | "skipped" | "failed";
      error?: string;
    }
  | {
      path: string;
      status: "blocked";
      sensitivityReceipt: unknown;
    }
  | {
      path: string;
      status: "failed";
      error: string;
    };

const markdownFileSchema = z.object({
  path: z.string().trim().min(1).max(2_000),
  content: z.string().max(MAX_MARKDOWN_FILE_CHARS),
});

function normalizeMarkdownPath(value: string) {
  const rawPath = value.trim().replace(/\\/g, "/");
  if (
    !rawPath ||
    rawPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(rawPath) ||
    rawPath.includes("\0")
  ) {
    return { path: null, error: "The file path must be relative." };
  }
  const segments = rawPath.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return { path: null, error: "The file path contains an invalid segment." };
  }
  const path = segments.join("/");
  if (!/\.(?:md|markdown)$/i.test(path)) {
    return { path: null, error: "Only .md and .markdown files are supported." };
  }
  return { path, error: null };
}

export default defineAction({
  description:
    "Import a bounded folder or batch of Markdown files into a manual Brain source. Paths are preserved for deduplication and each file is queued for distillation by default.",
  schema: z.object({
    sourceId: z.string().min(1).optional(),
    sourceTitle: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Manual source title to create/use when sourceId is omitted"),
    files: z.array(markdownFileSchema).min(1).max(MAX_MARKDOWN_FILES),
    enqueueDistillation: z.coerce.boolean().default(true),
  }),
  run: async (args) => {
    const prepared = args.files.map((file) => {
      const normalized = normalizeMarkdownPath(file.path);
      if (normalized.error) {
        return {
          input: file,
          path: file.path,
          normalizedPath: null,
          status: "failed" as const,
          error: normalized.error,
        };
      }
      if (!file.content.trim()) {
        return {
          input: file,
          path: file.path,
          normalizedPath: normalized.path,
          status: "failed" as const,
          error: "The Markdown file is empty.",
        };
      }
      return {
        input: file,
        path: file.path,
        normalizedPath: normalized.path,
        status: "ready" as const,
        error: null,
      };
    });
    const validFiles = prepared.filter(
      (
        file,
      ): file is (typeof prepared)[number] & {
        normalizedPath: string;
        status: "ready";
      } => file.status === "ready" && file.normalizedPath !== null,
    );
    const invalidResults = prepared
      .filter((file) => file.status === "failed")
      .map((file) => ({
        path: file.path,
        status: "failed" as const,
        error: file.error ?? "The file could not be imported.",
      }));

    const totalCharacters = validFiles.reduce(
      (total, file) => total + file.input.content.length,
      0,
    );
    if (totalCharacters > MAX_MARKDOWN_BATCH_CHARS) {
      throw new Error(
        `The Markdown batch is too large. Keep the batch under ${MAX_MARKDOWN_BATCH_CHARS.toLocaleString()} characters.`,
      );
    }

    if (!validFiles.length) {
      return {
        source: undefined,
        files: invalidResults,
        summary: {
          requested: args.files.length,
          imported: 0,
          queued: 0,
          blocked: 0,
          failed: invalidResults.length,
        },
      };
    }

    const source = args.sourceId
      ? (await getAccessibleSource(args.sourceId, "editor")).resource
      : await ensureManualSource(args.sourceTitle ?? "Manual imports");
    if (source.provider !== "manual") {
      throw new Error(
        "Markdown files can only be imported into manual sources.",
      );
    }

    const importedResults: ImportedMarkdownResult[] = [];
    for (const file of validFiles) {
      const normalizedPath = file.normalizedPath;
      try {
        const capture = await createCapture({
          sourceId: source.id,
          externalId: `markdown:${normalizedPath}`,
          title: normalizedPath,
          kind: "document",
          content: file.input.content,
          metadata: {
            path: normalizedPath,
            sourceFormat: "markdown",
          },
        });
        let distillation: "queued" | "existing" | "skipped" | "failed" =
          "skipped";
        let distillationError: string | undefined;
        if (
          args.enqueueDistillation &&
          capture.status !== "distilled" &&
          capture.status !== "ignored"
        ) {
          try {
            const queued = await enqueueCaptureDistillation({ capture });
            distillation = queued.existing ? "existing" : "queued";
          } catch (error) {
            distillation = "failed";
            distillationError =
              error instanceof Error ? error.message : String(error);
          }
        }
        importedResults.push({
          path: normalizedPath,
          status: "imported",
          captureId: capture.id,
          distillation,
          ...(distillationError
            ? {
                error: `Capture imported, but distillation failed: ${distillationError}`,
              }
            : {}),
        });
      } catch (error) {
        if (error instanceof BrainCaptureBlockedError) {
          importedResults.push({
            path: normalizedPath,
            status: "blocked",
            sensitivityReceipt: error.receipt,
          });
        } else {
          importedResults.push({
            path: normalizedPath,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    const files = [...invalidResults, ...importedResults];
    return {
      source: serializeSource(source),
      files,
      summary: {
        requested: files.length,
        imported: importedResults.filter((file) => file.status === "imported")
          .length,
        queued: importedResults.filter(
          (file) =>
            file.status === "imported" &&
            (file.distillation === "queued" ||
              file.distillation === "existing"),
        ).length,
        blocked: importedResults.filter((file) => file.status === "blocked")
          .length,
        failed: files.filter((file) => file.status === "failed").length,
      },
    };
  },
});
