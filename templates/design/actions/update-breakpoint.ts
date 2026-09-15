import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import type { BreakpointSet } from "../shared/design-state.js";
import { widthToPrefix } from "../shared/responsive-classes.js";

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

  // Keep the original object so unrelated persisted set metadata survives.
  return { kind: "valid", set: raw as BreakpointSet };
}

export default defineAction({
  description:
    "Update one breakpoint's width in the design's breakpoint set. The " +
    "breakpoint id and set id are preserved, duplicate widths are rejected, " +
    "and the set remains sorted by frame width. Width-scoped overrides are " +
    "stored independently by their existing max-width bounds and are not " +
    "rewritten by this metadata update. Moving a breakpoint across a sibling " +
    "width can change its applicable bound; that cross-neighbor CSS migration " +
    "is a separate multi-file CAS operation, so authored rules stay intact.",
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

    const persisted = await mutateDesignData({
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
              breakpoint.id !== breakpointId && breakpoint.widthPx === widthPx,
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
              breakpoint.id !== breakpointId && breakpoint.widthPx === widthPx,
          )
        );
      },
    });

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
    };
  },
});
