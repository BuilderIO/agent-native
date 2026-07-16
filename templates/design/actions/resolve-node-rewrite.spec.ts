import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const file = {
    id: "file_1",
    designId: "design_1",
    filename: "index.html",
    fileType: "html",
    content:
      '<!DOCTYPE html><html><body><main><section data-agent-native-node-id="hero"><h1>Old</h1></section><footer>Keep</footer></main></body></html>',
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    designData: JSON.stringify({ sourceType: "inline" }),
  };
  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.innerJoin.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  return {
    file,
    selectChain,
    listAppState: vi.fn(),
    readAppState: vi.fn(),
    deleteAppState: vi.fn(),
    readLiveSourceFile: vi.fn(),
    writeInlineSourceFile: vi.fn(),
    assertAccess: vi.fn(),
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  listAppState: mocks.listAppState,
  readAppState: mocks.readAppState,
  deleteAppState: mocks.deleteAppState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ access: true })),
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: () => mocks.selectChain }),
  schema: {
    designs: { id: "designs.id", data: "designs.data" },
    designShares: "designShares",
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
  },
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));

import {
  DESIGN_REPROMPT_PROPOSAL_STATE_PREFIX,
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
} from "../shared/node-rewrite.js";
import action from "./resolve-node-rewrite.js";

function proposal() {
  return {
    proposalId: "proposal_1",
    repromptId: "reprompt_1",
    designId: "design_1",
    fileId: "file_1",
    filename: "index.html",
    target: { nodeId: "hero" },
    resolvedTarget: {
      nodeId: "hero",
      selector: '[data-agent-native-node-id="hero"]',
    },
    baseVersionHash: "hash_base",
    variants: [
      {
        html: '<section data-agent-native-node-id="hero" class="dark"><h1>New</h1></section>',
        summary: "Dark hero",
      },
    ],
    chosenIndex: 0,
    createdAt: "2026-07-16T00:01:00.000Z",
  };
}

describe("resolve-node-rewrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.limit.mockResolvedValue([mocks.file]);
    mocks.listAppState.mockResolvedValue([
      {
        key: designRepromptProposalStateKey("design_1", "file_1"),
        value: proposal(),
      },
    ]);
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === designRepromptProposalStateKey("design_1", "file_1")
        ? proposal()
        : { repromptId: "reprompt_1" },
    );
    mocks.deleteAppState.mockResolvedValue(true);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: mocks.file.content,
      versionHash: "hash_base",
      language: "html",
    });
    mocks.writeInlineSourceFile.mockResolvedValue({
      versionHash: "hash_next",
      changed: true,
      updatedAt: "2026-07-16T00:02:00.000Z",
    });
  });

  it("accepts one variant as a single version-checked inline write", async () => {
    expect(action.agentTool).toBe(false);
    const result = await action.run({
      proposalId: "proposal_1",
      resolution: "accept",
      variantIndex: 0,
    });

    expect(mocks.listAppState).toHaveBeenCalledWith(
      DESIGN_REPROMPT_PROPOSAL_STATE_PREFIX,
    );
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design_1",
        expectedVersionHash: "hash_base",
        content: expect.stringContaining(
          '<section data-agent-native-node-id="hero" class="dark"><h1 data-agent-native-node-id=',
        ),
      }),
    );
    const written = mocks.writeInlineSourceFile.mock.calls[0]![0].content;
    expect(written).toContain("<footer>Keep</footer>");
    expect(written).not.toContain("<h1>Old</h1>");
    expect(result).toEqual(
      expect.objectContaining({
        resolution: "accept",
        changed: true,
        versionHash: "hash_next",
      }),
    );
    expect(mocks.deleteAppState).toHaveBeenCalledTimes(2);
    expect(mocks.deleteAppState).toHaveBeenCalledWith(
      designRepromptProposalStateKey("design_1", "file_1"),
    );
    expect(mocks.deleteAppState).toHaveBeenCalledWith(
      designRepromptPendingStateKey("design_1", "file_1"),
    );
  });

  it("rejects without reading or writing design content and clears both records", async () => {
    const result = await action.run({
      proposalId: "proposal_1",
      resolution: "reject",
    });

    expect(mocks.readLiveSourceFile).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.deleteAppState).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        resolution: "reject",
        changed: false,
        bridgeMessages: [
          expect.objectContaining({
            type: "node-html-preview",
            operation: "restore",
          }),
        ],
      }),
    );
  });

  it("preserves a newer pending refinement while resolving the visible proposal", async () => {
    const pendingKey = designRepromptPendingStateKey("design_1", "file_1");
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === pendingKey ? { repromptId: "reprompt_2" } : proposal(),
    );

    await action.run({
      proposalId: "proposal_1",
      resolution: "reject",
    });

    expect(mocks.deleteAppState).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAppState).toHaveBeenCalledWith(
      designRepromptProposalStateKey("design_1", "file_1"),
    );
    expect(mocks.deleteAppState).not.toHaveBeenCalledWith(pendingKey);
  });

  it("fails closed on a version mismatch and leaves proposal state intact", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content: mocks.file.content.replace("Keep", "Human edit"),
      versionHash: "hash_human_edit",
      language: "html",
    });

    await expect(
      action.run({ proposalId: "proposal_1", resolution: "accept" }),
    ).rejects.toThrow("Screen changed since proposal");
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.deleteAppState).not.toHaveBeenCalled();
  });

  it("does not clear state when the chosen variant index is invalid", async () => {
    await expect(
      action.run({
        proposalId: "proposal_1",
        resolution: "accept",
        variantIndex: 2,
      }),
    ).rejects.toThrow("out of range");
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.deleteAppState).not.toHaveBeenCalled();
  });
});
