import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  assertWorkspaceVisible,
  writeWorkspaceDefaults,
  type WorkspaceDefaults,
} from "../server/workspace-defaults.js";

export default defineAction({
  description:
    "Set the workspace-wide brand defaults every new deck starts from. Workspace admins only. " +
    "Pass a deck or design system id to set it, or null to clear it. Omitted fields are left unchanged.",
  schema: z.object({
    referenceDeckId: z
      .string()
      .nullish()
      .describe("Deck to use as the default style reference, or null to clear"),
    designSystemId: z
      .string()
      .nullish()
      .describe("Design system to apply by default, or null to clear"),
  }),
  run: async (args) => {
    const patch: Partial<WorkspaceDefaults> = {};

    if (args.referenceDeckId !== undefined) {
      if (args.referenceDeckId === null) {
        patch.referenceDeckId = null;
      } else {
        await assertAccess("deck", args.referenceDeckId, "viewer");
        await assertWorkspaceVisible("deck", args.referenceDeckId);
        patch.referenceDeckId = args.referenceDeckId;
      }
    }

    if (args.designSystemId !== undefined) {
      if (args.designSystemId === null) {
        patch.designSystemId = null;
      } else {
        await assertAccess("design-system", args.designSystemId, "viewer");
        await assertWorkspaceVisible("design-system", args.designSystemId);
        patch.designSystemId = args.designSystemId;
      }
    }

    return writeWorkspaceDefaults(patch);
  },
});
