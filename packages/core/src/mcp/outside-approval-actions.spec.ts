import { describe, expect, it } from "vitest";

import type { ActionCaller, ActionRunContext } from "../action.js";
import decideResourceSuggestionProposal from "../review/suggestions/actions/decide-resource-suggestion-proposal.js";
import decideResourceSuggestion from "../review/suggestions/actions/decide-resource-suggestion.js";
import unshareResource from "../sharing/actions/unshare-resource.js";
import bulkUpdateWorkspaceUserGroups from "../workspace-connections/actions/bulk-update-workspace-user-groups.js";
import deleteWorkspaceUserGroup from "../workspace-connections/actions/delete-workspace-user-group.js";
import upsertWorkspaceUserGroup from "../workspace-connections/actions/upsert-workspace-user-group.js";

const ASK_OUTSIDE_AGENTS = {
  "decide-resource-suggestion": decideResourceSuggestion,
  "decide-resource-suggestion-proposal": decideResourceSuggestionProposal,
  "unshare-resource": unshareResource,
  "bulk-update-workspace-user-groups": bulkUpdateWorkspaceUserGroups,
  "delete-workspace-user-group": deleteWorkspaceUserGroup,
  "upsert-workspace-user-group": upsertWorkspaceUserGroup,
};

type Gate = (
  args: unknown,
  ctx?: ActionRunContext,
) => boolean | Promise<boolean>;

describe("shared actions outside agents run behind approval", () => {
  it.each(Object.entries(ASK_OUTSIDE_AGENTS))(
    "%s is served unlisted and asks only outside callers",
    async (_name, entry) => {
      expect(entry.mcpTool).toBe("search");
      expect(typeof entry.needsApproval).toBe("function");
      const gate = entry.needsApproval as Gate;
      const asks = (
        caller: ActionCaller,
        extra: Partial<ActionRunContext> = {},
      ) => gate({}, { caller, ...extra } as ActionRunContext);

      expect(await asks("tool")).toBe(false);
      expect(await asks("frontend")).toBe(false);
      expect(await asks("mcp")).toBe(true);
      expect(await asks("http")).toBe(true);
      expect(await asks("tool", { networkProtocol: "a2a" })).toBe(true);
    },
  );
});
