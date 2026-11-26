import {
  defineAction,
  fail,
  isActionContractError,
  isOutsideAgentCall,
} from "@agent-native/core/action";
import { z } from "zod";

import {
  BrainCaptureBlockedError,
  BrainCaptureConcurrentError,
  createCaptureWithWarnings,
  ensureManualSource,
  getAccessibleSource,
  serializeSource,
} from "../server/lib/brain.js";
import { importReplacesCapture } from "../server/lib/capture-replacement.js";
import { BrainClassifierUnavailableError } from "../server/lib/capture-sanitization.js";
import { enqueueCaptureDistillation } from "../server/lib/distillation-queue.js";
import {
  parseCaptureMetadata,
  withheldPassageCount,
  withOmissionReceipt,
} from "../server/lib/search-index-contracts.js";
import { documentImportFormat } from "../shared/document-import.js";
import {
  SCREENING_UNAVAILABLE_CODE,
  screeningRefusalMessage,
} from "./_manual-import-errors.js";

const MAX_MARKDOWN_FILES = 100;
const MAX_MARKDOWN_FILE_CHARS = 250_000;
const MAX_MARKDOWN_BATCH_CHARS = 4_000_000;
const BATCH_SCREENING_BUDGET_MS = 90_000;

type ImportedMarkdownResult =
  | {
      path: string;
      status: "imported";
      captureId: string;
      withheldPassages: number | null;
      passageQuarantine?: { version: 1; withheldPassages: number | null };
      distillation: "queued" | "existing" | "skipped" | "failed";
      error?: string;
      postCommitWarnings?: string[];
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
      errorCode?: string;
    };

const markdownFileSchema = z.object({
  path: z.string().trim().min(1).max(2_000),
  content: z.string().max(MAX_MARKDOWN_FILE_CHARS),
  kind: z
    .enum(["document", "transcript"])
    .optional()
    .describe(
      "Set document or transcript explicitly; when omitted, preserve an existing capture's kind or use document for a new file.",
    ),
  capturedAt: z.iso
    .datetime({ offset: true })
    .optional()
    .describe(
      "Capture time as an ISO 8601 datetime with timezone, when known.",
    ),
  participants: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .optional()
    .describe(
      "Optional participant labels. Privacy screening discards the labels and stores only their count; they do not grant access or change the audience. An empty list preserves the existing count.",
    ),
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
  if (!documentImportFormat(path)) {
    return {
      path: null,
      error: "Only .md, .markdown, and .txt files are supported.",
    };
  }
  return { path, error: null };
}

function suppliedProvenanceApplied(
  capture:
    | {
        capturedAt?: string | null | undefined;
        kind?: string | null | undefined;
        metadataJson?: string | null | undefined;
      }
    | undefined,
  file: {
    kind?: string | undefined;
    capturedAt?: string | undefined;
    participants?: string[] | undefined;
  },
) {
  if (!capture) return false;
  if (file.kind && capture.kind !== file.kind) return false;
  if (file.capturedAt || file.participants?.length) {
    const metadata = JSON.parse(capture.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    if (file.capturedAt) {
      const wanted = Date.parse(file.capturedAt);
      if (
        !capture.capturedAt ||
        Date.parse(capture.capturedAt) !== wanted ||
        metadata.capturedAtSource !== "manual-markdown"
      )
        return false;
    }
    if (
      file.participants?.length &&
      metadata.participantsCount !== file.participants.length
    )
      return false;
  }
  return true;
}

export default defineAction({
  description:
    "Import a bounded folder or batch of Markdown (.md, .markdown) or plain text (.txt) files into a manual Brain source. Paths are preserved for deduplication and each file is queued for distillation by default. Participant labels are screened to a count, not retained or used as access grants.",
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
    kind: z
      .enum(["document", "transcript"])
      .optional()
      .describe(
        "Treat every file as a document (default) or a meeting transcript; transcript passages may be withheld for privacy.",
      ),
    enqueueDistillation: z.coerce.boolean().default(true),
  }),
  needsApproval: async (args, ctx) =>
    isOutsideAgentCall(ctx) &&
    (await importReplacesCapture(
      args.files.flatMap((file) => {
        const normalized = normalizeMarkdownPath(file.path);
        return normalized.path ? [`markdown:${normalized.path}`] : [];
      }),
      { sourceId: args.sourceId, sourceTitle: args.sourceTitle },
    )),
  mcpTool: "search",
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
          error: "The file has no text.",
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
    const batchStartedAt = Date.now();
    for (const file of validFiles) {
      const normalizedPath = file.normalizedPath;
      if (Date.now() - batchStartedAt > BATCH_SCREENING_BUDGET_MS) {
        importedResults.push({
          path: normalizedPath,
          status: "failed",
          error:
            "This request ran out of screening time before reaching this file. Import it again in a smaller batch.",
          errorCode: "batch_time_budget",
        });
        continue;
      }
      try {
        const effectiveKind = file.input.kind ?? args.kind;
        const captureInput = {
          sourceId: source.id,
          externalId: `markdown:${normalizedPath}`,
          title: normalizedPath,
          ...(effectiveKind ? { kind: effectiveKind } : {}),
          content: file.input.content,
          ...(file.input.capturedAt
            ? {
                capturedAt: file.input.capturedAt,
                capturedAtSource: "manual-markdown" as const,
              }
            : {}),
          metadata: {
            path: normalizedPath,
            sourceFormat: documentImportFormat(normalizedPath) ?? "markdown",
            ...(file.input.participants?.length
              ? { participants: file.input.participants }
              : {}),
          },
        };
        let stored = await createCaptureWithWarnings(captureInput);
        if (
          !suppliedProvenanceApplied(stored.capture, {
            ...file.input,
            kind: effectiveKind,
          })
        ) {
          stored = await createCaptureWithWarnings(captureInput);
          if (
            !suppliedProvenanceApplied(stored.capture, {
              ...file.input,
              kind: effectiveKind,
            })
          ) {
            if (effectiveKind && stored.capture.kind !== effectiveKind)
              throw new BrainCaptureConcurrentError();
            fail(
              "The capture changed during import and the supplied provenance was not applied. Retry the import.",
              { errorCode: "capture_changed", statusCode: 409 },
            );
          }
        }
        const { capture, postCommitWarnings } = stored;
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
        const withheldPassages = withheldPassageCount(
          parseCaptureMetadata(
            withOmissionReceipt(
              capture.metadataJson,
              capture.content,
              capture.kind,
            ),
          ),
          source.provider,
          capture.kind,
        );
        importedResults.push({
          path: normalizedPath,
          status: "imported",
          captureId: capture.id,
          withheldPassages,
          ...(withheldPassages !== 0
            ? { passageQuarantine: { version: 1 as const, withheldPassages } }
            : {}),
          distillation,
          ...(postCommitWarnings ? { postCommitWarnings } : {}),
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
        } else if (error instanceof BrainCaptureConcurrentError) {
          importedResults.push({
            path: normalizedPath,
            status: "failed",
            error: error.message,
            errorCode: "capture_concurrent",
          });
        } else if (error instanceof BrainClassifierUnavailableError) {
          importedResults.push({
            path: normalizedPath,
            status: "failed",
            error: screeningRefusalMessage(error),
            errorCode: SCREENING_UNAVAILABLE_CODE,
          });
        } else {
          importedResults.push({
            path: normalizedPath,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            ...(isActionContractError(error) &&
            error.errorCode === "capture_changed"
              ? { errorCode: error.errorCode }
              : {}),
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
