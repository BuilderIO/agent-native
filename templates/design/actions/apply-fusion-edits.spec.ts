/**
 * Tests for apply-fusion-edits batching: pending queued edits become one
 * numbered prompt for the app agent, and rows transition to sent/error based
 * on the dispatch result.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({
    role: "editor",
    resource: {
      id: "design_1",
      title: "My App",
      data: JSON.stringify({
        fusionApp: {
          projectId: "proj_1",
          branchName: "sunny-meadow",
          status: "ready",
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        },
      }),
    },
  }),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
}));

const sendFusionBranchMessage = vi.fn();
vi.mock("@agent-native/core/server", () => ({
  sendFusionBranchMessage: (args: unknown) => sendFusionBranchMessage(args),
}));

// Force the flag on for tests; keep the real data helpers.
vi.mock("../shared/full-app.js", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, FULL_APP_BUILDING_ENABLED: true };
});

vi.mock("nanoid", () => ({ nanoid: () => "batch_123" }));

let pendingRows: Array<Record<string, unknown>> = [];
const updateCalls: Array<Record<string, unknown>> = [];

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(pendingRows),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push(vals);
          return Promise.resolve();
        },
      }),
    }),
  }),
  schema: {
    designFusionEdits: {
      id: "id",
      designId: "designId",
      status: "status",
      createdAt: "createdAt",
    },
  },
}));

import action from "./apply-fusion-edits.js";

beforeEach(() => {
  sendFusionBranchMessage.mockReset();
  updateCalls.length = 0;
  pendingRows = [];
});

describe("apply-fusion-edits", () => {
  it("returns sentCount 0 when nothing is pending", async () => {
    const result = (await action.run({ designId: "design_1" } as never)) as {
      sentCount: number;
    };
    expect(result.sentCount).toBe(0);
    expect(sendFusionBranchMessage).not.toHaveBeenCalled();
  });

  it("batches pending edits into one numbered prompt and marks them sent", async () => {
    pendingRows = [
      {
        id: "e1",
        instruction: "Make the header sticky",
        target: JSON.stringify({ path: "/", selector: "header" }),
      },
      {
        id: "e2",
        instruction: "Use a green primary button",
        target: null,
      },
    ];
    sendFusionBranchMessage.mockResolvedValue({ sent: true });

    const result = (await action.run({ designId: "design_1" } as never)) as {
      sentCount: number;
      batchId: string;
    };

    expect(result.sentCount).toBe(2);
    expect(result.batchId).toBe("batch_123");
    expect(sendFusionBranchMessage).toHaveBeenCalledTimes(1);
    const { prompt, projectId, branchName } = sendFusionBranchMessage.mock
      .calls[0]![0] as Record<string, string>;
    expect(projectId).toBe("proj_1");
    expect(branchName).toBe("sunny-meadow");
    expect(prompt).toContain(
      "1. Make the header sticky (path: /, selector: header)",
    );
    expect(prompt).toContain("2. Use a green primary button");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      status: "sent",
      batchId: "batch_123",
    });
  });

  it("marks rows error when the dispatch fails", async () => {
    pendingRows = [{ id: "e1", instruction: "Anything", target: null }];
    sendFusionBranchMessage.mockResolvedValue({
      sent: false,
      error: "container unreachable",
    });

    const result = (await action.run({ designId: "design_1" } as never)) as {
      sentCount: number;
      error?: string;
    };

    expect(result.sentCount).toBe(0);
    expect(result.error).toBe("container unreachable");
    expect(updateCalls[0]).toMatchObject({
      status: "error",
      error: "container unreachable",
    });
  });
});
