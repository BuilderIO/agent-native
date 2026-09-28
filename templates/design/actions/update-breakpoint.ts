import { defineAction } from "@agent-native/core/action";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import { migrateBreakpointMediaBounds } from "../server/lib/breakpoint-media-migration.js";
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import type { BreakpointSet } from "../shared/design-state.js";
import {
  breakpointUpperBoundPx,
  widthToPrefix,
} from "../shared/responsive-classes.js";

type BreakpointSetRead =
  | { kind: "missing"; set: null }
  | { kind: "invalid"; set: null }
  | { kind: "valid"; set: BreakpointSet };

const breakpointSetSchema = z.object({
  id: z.string(),
  breakpoints: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      widthPx: z.number().finite().int().positive(),
      prefix: z.enum(["base", "sm", "md", "lg", "xl", "2xl"]),
    }),
  ),
});

function readBreakpointSet(designData: DesignDataRecord): BreakpointSetRead {
  const raw = designData.breakpointSet;
  if (raw === undefined || raw === null) {
    return { kind: "missing", set: null };
  }
  if (!breakpointSetSchema.safeParse(raw).success) {
    return { kind: "invalid", set: null };
  }

  return { kind: "valid", set: raw as BreakpointSet };
}

function screenBaseWidth(
  designData: DesignDataRecord,
  fileId: string,
): number | null {
  const metadataByFileId = designData.screenMetadata;
  if (
    !metadataByFileId ||
    typeof metadataByFileId !== "object" ||
    Array.isArray(metadataByFileId)
  ) {
    return null;
  }
  const metadata = (metadataByFileId as Record<string, unknown>)[fileId];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const width = (metadata as Record<string, unknown>).width;
  return typeof width === "number" && Number.isFinite(width) ? width : null;
}

class BreakpointMediaMigrationError extends Error {
  constructor(fileId: string) {
    super(
      `Cannot safely migrate responsive overrides for file '${fileId}'; the width change would move a managed rule into the base scope or create a conflicting rule.`,
    );
    this.name = "BreakpointMediaMigrationError";
  }
}

export default defineAction({
  description:
    "Update one breakpoint's width in the design's breakpoint set. The " +
    "breakpoint id and set id are preserved, duplicate widths are rejected, " +
    "and the set remains sorted by frame width. Managed width-scoped overrides " +
    "move with the bounds derived from the updated set in the same transaction.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    breakpointId: z
      .string()
      .describe("Id of the BreakpointDefinition to update."),
    widthPx: z
      .number()
      .int()
      .min(320)
      .max(3840)
      .describe("New frame width in pixels."),
    label: z
      .string()
      .min(1)
      .optional()
      .describe("Optional replacement label for the frame."),
  }),
  capabilityScopes: ["visual-edit"],
  run: async ({ designId, breakpointId, widthPx, label }, context) => {
    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    let persisted;
    try {
      persisted = await mutateDesignData({
        designId,
        mutate: (current, { updatedAt }) => {
          const read = readBreakpointSet(current);
          if (read.kind !== "valid") return current;
          const set = read.set;
          const existing = set.breakpoints.find(
            (breakpoint) => breakpoint.id === breakpointId,
          );
          if (!existing) return current;
          if (
            set.breakpoints.some(
              (breakpoint) =>
                breakpoint.id !== breakpointId &&
                breakpoint.widthPx === widthPx,
            )
          ) {
            return current;
          }

          const nextBreakpoint = {
            ...existing,
            widthPx,
            prefix: widthToPrefix(widthPx),
            ...(label === undefined ? {} : { label }),
          };
          const breakpoints = set.breakpoints
            .map((breakpoint) =>
              breakpoint.id === breakpointId ? nextBreakpoint : breakpoint,
            )
            .sort((a, b) => a.widthPx - b.widthPx);
          return {
            ...current,
            breakpointSet: { ...set, breakpoints },
            breakpointSetUpdatedAt: updatedAt,
          };
        },
        mutateFiles: (current, next, { files }) => {
          if (current === next) return [];
          const previousRead = readBreakpointSet(current);
          const nextRead = readBreakpointSet(next);
          if (previousRead.kind !== "valid" || nextRead.kind !== "valid") {
            return [];
          }

          const previousSet = previousRead.set;
          const nextSet = nextRead.set;
          const previousWidths = previousSet.breakpoints.map(
            (breakpoint) => breakpoint.widthPx,
          );
          const nextWidths = nextSet.breakpoints.map(
            (breakpoint) => breakpoint.widthPx,
          );
          const nextById = new Map(
            nextSet.breakpoints.map((breakpoint) => [
              breakpoint.id,
              breakpoint,
            ]),
          );
          const widthMap = new Map<number, number | null>();
          const updates: Array<{ fileId: string; content: string }> = [];

          for (const file of files) {
            if (file.fileType !== "html") continue;
            const baseWidthPx = screenBaseWidth(current, file.id);
            const boundMap = new Map<number, number | null>();
            for (const breakpoint of previousSet.breakpoints) {
              const nextBreakpoint = nextById.get(breakpoint.id);
              if (!nextBreakpoint) continue;
              widthMap.set(breakpoint.widthPx, nextBreakpoint.widthPx);
              const previousBound = breakpointUpperBoundPx(
                previousWidths,
                breakpoint.widthPx,
                baseWidthPx,
              );
              if (previousBound === null) continue;
              boundMap.set(
                previousBound,
                breakpointUpperBoundPx(
                  nextWidths,
                  nextBreakpoint.widthPx,
                  baseWidthPx,
                ),
              );
            }
            const content = migrateBreakpointMediaBounds(
              file.content,
              boundMap,
              { widthMap },
            );
            if (content === null)
              throw new BreakpointMediaMigrationError(file.id);
            if (content !== file.content) {
              updates.push({ fileId: file.id, content });
            }
          }
          return updates;
        },
        isApplied: (current) => {
          const read = readBreakpointSet(current);
          if (read.kind !== "valid") return true;
          const set = read.set;
          const updated = set.breakpoints.find(
            (breakpoint) => breakpoint.id === breakpointId,
          );
          if (!updated) return true;
          if (updated?.widthPx === widthPx) {
            return label === undefined || updated.label === label;
          }
          return (
            updated !== undefined &&
            set.breakpoints.some(
              (breakpoint) =>
                breakpoint.id !== breakpointId &&
                breakpoint.widthPx === widthPx,
            )
          );
        },
      });
    } catch (error) {
      if (error instanceof BreakpointMediaMigrationError) {
        return { updated: false, reason: error.message };
      }
      throw error;
    }

    const collabReconcilePending: string[] = [];
    await Promise.all(
      (persisted.updatedFiles ?? []).map(async (file) => {
        try {
          if (await hasCollabState(file.id)) {
            await applyText(file.id, file.content, "content", "agent", {
              validateBase: (base) => {
                if (base !== file.previousContent) {
                  throw new Error(
                    `Live collaboration content changed before responsive override migration for file '${file.id}'.`,
                  );
                }
              },
            });
          } else {
            await seedFromText(file.id, file.content);
          }
        } catch (error) {
          collabReconcilePending.push(file.id);
          console.warn(
            `[design] breakpoint override migration committed but collab reconcile is pending for ${file.id}:`,
            error,
          );
        }
      }),
    );

    const updatedSetRead = readBreakpointSet(persisted.data);
    if (updatedSetRead.kind === "invalid") {
      return {
        updated: false,
        reason: "Breakpoint set is invalid; refusing update.",
      };
    }
    const updatedSet = updatedSetRead.set;
    const updatedBreakpoint = updatedSet?.breakpoints.find(
      (breakpoint) => breakpoint.id === breakpointId,
    );

    if (!updatedSet || !updatedBreakpoint) {
      return {
        updated: false,
        reason: `Breakpoint '${breakpointId}' not found in the set.`,
      };
    }
    if (updatedBreakpoint.widthPx !== widthPx) {
      return {
        updated: false,
        reason: `A breakpoint with width ${widthPx}px already exists.`,
        breakpointSet: updatedSet,
      };
    }

    return {
      updated: true,
      breakpoint: updatedBreakpoint,
      breakpointSet: updatedSet,
      ...(collabReconcilePending.length > 0 ? { collabReconcilePending } : {}),
    };
  },
});
