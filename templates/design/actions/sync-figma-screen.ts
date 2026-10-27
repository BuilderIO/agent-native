import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import { assertFigmaSyncEnabled } from "../server/lib/figma-sync-flag.js";
import {
  buildScreenFilesFromFigmaNodes,
  fetchFigmaNodeSnapshot,
} from "../server/lib/figma-node-import.js";
import {
  classifyFigmaSync,
  hashJson,
  hashText,
  type FigmaSyncBaseline,
} from "../server/lib/figma-sync.js";
import { designOutputWriteReceipt } from "../shared/generation-output-receipt.js";

const schemaInput = z.object({
  designId: z.string().min(1).describe("Design project id."),
  fileId: z.string().min(1).describe("Linked HTML screen file id."),
  mode: z
    .enum(["check", "pull", "record-push"])
    .default("check")
    .describe(
      'Sync operation: "check" reports drift, "pull" applies a source-only change when the Design screen still matches its baseline, and "record-push" records a verified connected-tool write.',
    ),
  expectedFigmaVersion: z
    .string()
    .optional()
    .describe(
      'For "record-push", the last-synced source version observed before the connected write.',
    ),
  expectedFigmaNodeHashBefore: z
    .string()
    .optional()
    .describe(
      'For "record-push", the source node hash observed before the connected write; it must still match the saved baseline.',
    ),
  expectedDesignHash: z
    .string()
    .optional()
    .describe(
      'For "record-push", the Design HTML hash exported to the source.',
    ),
  expectedFigmaVersionAfter: z
    .string()
    .optional()
    .describe(
      'For "record-push", the source version observed after the connected write.',
    ),
  expectedFigmaNodeHashAfter: z
    .string()
    .optional()
    .describe(
      'For "record-push", the source node hash observed after the connected write.',
    ),
});

const errors = defineActionErrors(
  "figma_sync_disabled",
  "figma_sync_unlinked",
  "figma_sync_screen_missing",
  "invalid_design_data",
  "not_found",
  "figma_sync_untracked",
  "figma_sync_baseline_changed",
  "figma_sync_write_not_found",
  "figma_sync_design_conflict",
  "figma_sync_import_failed",
);

function failAction(
  message: string,
  options: {
    errorCode: (typeof errors.codes)[number];
    statusCode?: number;
    details?: Record<string, unknown>;
  },
): never {
  return errors.fail(message, options.errorCode, {
    ...(options.statusCode === undefined ? {} : { statusCode: options.statusCode }),
    ...(options.details === undefined ? {} : { details: options.details }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDesignData(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    failAction("Design data is invalid and cannot be synchronized.", {
      errorCode: "invalid_design_data",
      statusCode: 409,
    });
  }
}

function readScreenMetadata(
  data: Record<string, unknown>,
  fileId: string,
): Record<string, unknown> {
  const metadata = isRecord(data.screenMetadata) ? data.screenMetadata : {};
  const screen = metadata[fileId];
  return isRecord(screen) ? screen : {};
}

function readBaseline(value: unknown): FigmaSyncBaseline | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.figmaNodeHash !== "string" ||
    typeof value.designHash !== "string"
  ) {
    return null;
  }
  return {
    figmaVersion:
      typeof value.figmaVersion === "string" ? value.figmaVersion : null,
    figmaNodeHash: value.figmaNodeHash,
    designHash: value.designHash,
  };
}

function copyScreenMetadata(
  data: Record<string, unknown>,
  fileId: string,
  screen: Record<string, unknown>,
): Record<string, unknown> {
  const metadata = isRecord(data.screenMetadata) ? data.screenMetadata : {};
  return {
    ...data,
    screenMetadata: { ...metadata, [fileId]: screen },
  };
}

async function persistBaseline(input: {
  designId: string;
  fileId: string;
  fileKey: string;
  nodeId: string;
  previousBaseline: FigmaSyncBaseline;
  nextBaseline: FigmaSyncBaseline;
  expectedDesignHash: string;
  content?: string;
}) {
  return mutateDesignData({
    designId: input.designId,
    lockSourceMutation: true,
    mutate: (current, { updatedAt }) => {
      const currentScreen = readScreenMetadata(current, input.fileId);
      const currentBaseline = readBaseline(currentScreen.figmaSync);
      if (
        currentScreen.figmaFileKey !== input.fileKey ||
        currentScreen.figmaNodeId !== input.nodeId ||
        !currentBaseline ||
        currentBaseline.figmaNodeHash !==
          input.previousBaseline.figmaNodeHash ||
        currentBaseline.designHash !== input.previousBaseline.designHash ||
        currentBaseline.figmaVersion !== input.previousBaseline.figmaVersion
      ) {
        failAction(
          "The source link changed while synchronization was running. Check again before retrying.",
          {
            errorCode: "figma_sync_baseline_changed",
            statusCode: 409,
          },
        );
      }
      const nextScreen = {
        ...currentScreen,
        figmaSync: input.nextBaseline,
      };
      const next = copyScreenMetadata(current, input.fileId, nextScreen);
      return { ...next, updatedAt };
    },
    mutateFiles: (_current, next, { files }) => {
      const screen = files.find((file) => file.id === input.fileId);
      if (!screen || screen.fileType !== "html") {
        failAction("The linked Design screen is no longer available.", {
          errorCode: "figma_sync_screen_missing",
          statusCode: 404,
        });
      }
      if (hashText(screen.content) !== input.expectedDesignHash) {
        failAction(
          "The Design screen changed during synchronization. Nothing was overwritten; check again.",
          {
            errorCode: "figma_sync_design_conflict",
            statusCode: 409,
          },
        );
      }
      const nextScreen = readScreenMetadata(next, input.fileId);
      const nextBaseline = readBaseline(nextScreen.figmaSync);
      if (
        !nextBaseline ||
        nextBaseline.figmaNodeHash !== input.nextBaseline.figmaNodeHash ||
        nextBaseline.designHash !== input.nextBaseline.designHash
      ) {
        failAction("The synchronization baseline could not be verified.", {
          errorCode: "figma_sync_baseline_changed",
          statusCode: 409,
        });
      }
      return input.content
        ? [{ fileId: input.fileId, content: input.content }]
        : [];
    },
    isApplied: (persisted) => {
      const screen = readScreenMetadata(persisted, input.fileId);
      const baseline = readBaseline(screen.figmaSync);
      return Boolean(
        screen.figmaFileKey === input.fileKey &&
        screen.figmaNodeId === input.nodeId &&
        baseline?.figmaNodeHash === input.nextBaseline.figmaNodeHash &&
        baseline.designHash === input.nextBaseline.designHash &&
        baseline.figmaVersion === input.nextBaseline.figmaVersion,
      );
    },
  });
}

export default defineAction({
  description:
    "Check or synchronize a Design screen linked to a source node. Tracks the source file version plus stable node and HTML hashes. A pull only replaces the screen when the source node changed and the Design screen still matches its last-synced hash; simultaneous edits are reported as conflicts and never overwritten. After an authorized connected-tool write, record-push requires matching before and after source snapshots and the exported Design hash.",
  schema: schemaInput,
  outputSchema: z
    .object({
      status: z.enum([
        "in-sync",
        "figma-changed",
        "design-changed",
        "both-changed",
        "untracked",
      ]),
      fileKey: z.string(),
      nodeId: z.string(),
      figmaVersion: z.string().nullable().optional(),
      figmaNodeHash: z.string().optional(),
      designHash: z.string().optional(),
      lastSyncedVersion: z.string().nullable().optional(),
      figmaChanged: z.boolean().optional(),
      designChanged: z.boolean().optional(),
      recorded: z.boolean().optional(),
      applied: z.boolean().optional(),
      reason: z.string().optional(),
      warnings: z.array(z.string()).optional(),
      _receipt: z
        .object({
          changed: z.boolean(),
          verified: z.literal(true),
          summary: z.string(),
          subject: z.string(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  errors,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args, context) => {
    await assertFigmaSyncEnabled();
    await assertAccess("design", args.designId, "editor");
    const db = getDb();
    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, args.designId));
    if (!design) {
      failAction("Design not found.", { errorCode: "not_found", statusCode: 404 });
    }
    const [screenFile] = await db
      .select({
        id: schema.designFiles.id,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, args.fileId),
          eq(schema.designFiles.designId, args.designId),
        ),
      );
    if (!screenFile || screenFile.fileType !== "html") {
      failAction("Choose an HTML screen linked to a source node.", {
        errorCode: "figma_sync_screen_missing",
        statusCode: 404,
      });
    }

    const designData = readDesignData(design.data);
    const screenMetadata = readScreenMetadata(designData, args.fileId);
    const fileKey =
      typeof screenMetadata.figmaFileKey === "string"
        ? screenMetadata.figmaFileKey
        : null;
    const nodeId =
      typeof screenMetadata.figmaNodeId === "string"
        ? screenMetadata.figmaNodeId
        : null;
    const baseline = readBaseline(screenMetadata.figmaSync);
    if (!fileKey || !nodeId) {
      failAction(
        "This screen is not linked to a source node. Import it from a file or frame link to enable synchronization.",
        {
          errorCode: "figma_sync_unlinked",
          statusCode: 409,
        },
      );
    }

    const figmaSnapshot = await fetchFigmaNodeSnapshot(fileKey, nodeId);
    const figmaNodeHash = hashJson(figmaSnapshot.node);
    const designHash = hashText(screenFile.content);
    const status = classifyFigmaSync({
      baseline,
      figmaNodeHash,
      designHash,
    });

    if (args.mode === "check") {
      return {
        status,
        fileKey,
        nodeId,
        figmaVersion: figmaSnapshot.version,
        figmaNodeHash,
        designHash,
        lastSyncedVersion: baseline?.figmaVersion ?? null,
        figmaChanged: status === "figma-changed" || status === "both-changed",
        designChanged: status === "design-changed" || status === "both-changed",
      };
    }

    if (!baseline) {
      failAction(
        "This screen has no saved sync baseline. Import it again from its source link before synchronizing.",
        {
          errorCode: "figma_sync_untracked",
          statusCode: 409,
        },
      );
    }

    if (args.mode === "record-push") {
      if (
        args.expectedFigmaVersion !== baseline.figmaVersion ||
        args.expectedFigmaNodeHashBefore !== baseline.figmaNodeHash ||
        args.expectedDesignHash !== designHash ||
        args.expectedFigmaVersionAfter !== figmaSnapshot.version ||
        args.expectedFigmaNodeHashAfter !== figmaNodeHash
      ) {
        failAction(
          "The source version or Design export changed. Check synchronization again before recording the connected write.",
          {
            errorCode: "figma_sync_baseline_changed",
            statusCode: 409,
          },
        );
      }
      if (figmaNodeHash === baseline.figmaNodeHash) {
        failAction(
          "The linked source node has not changed, so the write cannot be verified.",
          {
            errorCode: "figma_sync_write_not_found",
            statusCode: 409,
          },
        );
      }
      await persistBaseline({
        designId: args.designId,
        fileId: args.fileId,
        fileKey,
        nodeId,
        previousBaseline: baseline,
        nextBaseline: {
          figmaVersion: figmaSnapshot.version,
          figmaNodeHash,
          designHash,
        },
        expectedDesignHash: designHash,
      });
      return {
        status: "in-sync" as const,
        fileKey,
        nodeId,
        figmaVersion: figmaSnapshot.version,
        recorded: true,
      };
    }

    if (status !== "figma-changed") {
      return {
        status,
        fileKey,
        nodeId,
        figmaVersion: figmaSnapshot.version,
        applied: false,
      };
    }

    const imported = await buildScreenFilesFromFigmaNodes(
      fileKey,
      { [nodeId]: figmaSnapshot.node },
      {
        source: (_importedNodeId, node, content) => ({
          figmaSync: {
            figmaVersion: figmaSnapshot.version,
            figmaLastModified: figmaSnapshot.lastModified,
            figmaNodeHash: hashJson(node),
            designHash: hashText(content),
          },
        }),
      },
    );
    const replacement = imported.files.find((file) => file.fileType === "html");
    if (!replacement) {
      failAction("The linked source node could not be converted to an HTML screen.", {
        errorCode: "figma_sync_import_failed",
        statusCode: 422,
      });
    }

    const latestSnapshot = await fetchFigmaNodeSnapshot(fileKey, nodeId);
    const latestFigmaHash = hashJson(latestSnapshot.node);
    if (latestFigmaHash !== figmaNodeHash) {
      return {
        status: "figma-changed" as const,
        fileKey,
        nodeId,
        figmaVersion: latestSnapshot.version,
        applied: false,
        reason: "The source node changed while its import was being prepared.",
      };
    }

    await snapshotDesignBeforeAgentEdit(args.designId, context);
    const nextBaseline: FigmaSyncBaseline = {
      figmaVersion: latestSnapshot.version,
      figmaNodeHash: latestFigmaHash,
      designHash: hashText(replacement.content),
    };
    await persistBaseline({
      designId: args.designId,
      fileId: args.fileId,
      fileKey,
      nodeId,
      previousBaseline: baseline,
      nextBaseline,
      expectedDesignHash: designHash,
      content: replacement.content,
    });
    return {
      status: "in-sync" as const,
      fileKey,
      nodeId,
      figmaVersion: latestSnapshot.version,
      applied: true,
      warnings: imported.omissionWarnings,
      _receipt: designOutputWriteReceipt(args.designId, 1),
    };
  },
});
