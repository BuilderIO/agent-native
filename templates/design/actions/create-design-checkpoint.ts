/**
 * create-design-checkpoint — Task 5a.
 *
 * Creates a durable, attributable `design_versions` snapshot of the full
 * current file set so it can be restored later via `restore-design-version`.
 * Use before risky operations (an agent generation, a screen delete, a bulk
 * import) or as an explicit user checkpoint. Auto-created kinds
 * (`pre-agent-run`, `pre-structural`) are bounded: only the newest N per design
 * are kept and older auto-checkpoints are pruned (a delete of rows this system
 * created automatically — never of manual/user snapshots).
 *
 * Additive only: writes a new versions row; never alters or drops file data.
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { writeDesignCheckpoint } from "../server/lib/design-checkpoint.js";

const CHECKPOINT_KINDS = ["manual", "pre-agent-run", "pre-structural"] as const;

export default defineAction({
  description:
    "Create a durable, attributable design checkpoint — a design_versions " +
    "snapshot of the full current file set — that can be restored later with " +
    "restore-design-version. kind 'manual' is an explicit user checkpoint; " +
    "'pre-agent-run' should be created once before an agent generation; " +
    "'pre-structural' before a destructive structural edit (screen delete, " +
    "bulk import). Auto-created kinds are pruned to the newest 20 per design.",
  schema: z.object({
    designId: z.string().describe("Design project ID to checkpoint"),
    kind: z
      .enum(CHECKPOINT_KINDS)
      .default("manual")
      .describe("Checkpoint kind (controls pruning + attribution)"),
    trigger: z
      .string()
      .optional()
      .describe("Provenance: originating action name or agent run id"),
    label: z.string().optional().describe("Optional human-readable label"),
  }),
  run: async ({ designId, kind, trigger, label }) => {
    await assertAccess("design", designId, "editor");
    const createdBy = getRequestUserEmail() ?? "agent";
    const result = await writeDesignCheckpoint({
      designId,
      kind,
      createdBy,
      trigger,
      label,
      // Only auto-created kinds are pruned; a manual checkpoint is always kept.
      prune: kind !== "manual",
    });
    return {
      versionId: result.versionId,
      kind,
      createdBy,
      filesCaptured: result.filesCaptured,
      pruned: result.pruned,
    };
  },
});
