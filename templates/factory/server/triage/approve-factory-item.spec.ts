import { describe, expect, it, vi } from "vitest";

import approveFactoryItem from "../../actions/approve-factory-item.js";
import { startBuilderRun } from "./builder-executor.js";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
}));
vi.mock("../db/schema.js", () => ({
  triageDecisions: {},
  triageItems: {},
  triageRuns: {},
}));
vi.mock("../lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: vi.fn(),
  workspaceMemberIdentityFromContext: vi.fn(),
}));
vi.mock("./builder-executor.js", () => ({
  startBuilderRun: vi.fn(),
}));
vi.mock("./ids.js", () => ({
  stableId: vi.fn(),
}));

describe("approve-factory-item agent gate", () => {
  it("does not start Builder work from an unapproved agent call", async () => {
    const action = approveFactoryItem as unknown as {
      needsApproval?: boolean;
      run: (input: unknown) => Promise<unknown>;
    };
    const result = action.needsApproval
      ? { status: "approval_required" }
      : ((await action.run({ itemId: "item-1", confirm: true })) as {
          status?: string;
        });

    expect(result.status).toBe("approval_required");
    expect(startBuilderRun).not.toHaveBeenCalled();
  });
});
