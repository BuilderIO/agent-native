import { defineAction } from "@agent-native/core/action";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  canManageWorkspaceDefaults,
  getWorkspaceDefaults,
} from "../server/workspace-defaults.js";
import getDesignSystem from "./get-design-system.js";

/**
 * `unavailable` is not `null`. A default the caller cannot open means an admin
 * pointed at something private; collapsing that into "no default" hides the
 * misconfiguration from the only people who can fix it.
 */
type DefaultRef =
  | { id: string; title: string; unavailable?: false }
  | { id: string; title: null; unavailable: true }
  | null;

export default defineAction({
  description:
    "Read the workspace-wide brand defaults: the default reference deck and design system new decks start from when the user has not picked their own. " +
    "Call this before generating a deck from a bare prompt so the result is on brand.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const defaults = await getWorkspaceDefaults();

    let referenceDeck: DefaultRef = null;
    if (defaults.referenceDeckId) {
      const access = await resolveAccess("deck", defaults.referenceDeckId);
      referenceDeck = access
        ? { id: defaults.referenceDeckId, title: access.resource.title }
        : { id: defaults.referenceDeckId, title: null, unavailable: true };
    }

    return {
      referenceDeck,
      designSystem: await loadAgentDesignSystemContext(
        defaults.designSystemId,
        getDesignSystem,
      ),
      canManage: await canManageWorkspaceDefaults(),
    };
  },
});
