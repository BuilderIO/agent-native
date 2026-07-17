import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const file = {
    id: "file_1",
    designId: "design_1",
    filename: "index.html",
    fileType: "html",
    content:
      '<!DOCTYPE html><html><body><main><section data-agent-native-node-id="hero"><h1>Old</h1></section></main></body></html>',
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
    readLiveSourceFile: vi.fn(),
    readAppState: vi.fn(),
    writeAppState: vi.fn(),
    compareAndSetAppState: vi.fn(),
    assertAccess: vi.fn(),
    nanoid: vi.fn(),
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mocks.compareAndSetAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ access: true })),
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("nanoid", () => ({ nanoid: mocks.nanoid }));

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
}));

import {
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
} from "../shared/node-rewrite.js";
import action from "./propose-node-rewrite.js";

const target = { nodeId: "hero" };

describe("propose-node-rewrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.limit.mockResolvedValue([mocks.file]);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: mocks.file.content,
      versionHash: "hash_base",
      language: "html",
    });
    mocks.readAppState.mockResolvedValue({
      repromptId: "reprompt_1",
      designId: "design_1",
      fileId: "file_1",
      target,
      baseVersionHash: "hash_base",
      instruction: "Make the hero darker",
      createdAt: "2026-07-16T00:00:00.000Z",
    });
    mocks.nanoid.mockReturnValue("proposal_1");
    mocks.compareAndSetAppState.mockResolvedValue(true);
  });

  it("uses client-valid per-design and per-file application-state keys", () => {
    expect(designRepromptPendingStateKey("design_1", "file_1")).toBe(
      "design-reprompt-pending:design_1:file_1",
    );
    expect(
      designRepromptProposalStateKey("design_1", "file_1", "reprompt_1"),
    ).toBe("design-reprompt-proposal:design_1:file_1:reprompt_1");
  });

  it("requires a scoped source, target, base hash, and one to three variants", () => {
    const valid = {
      source: { designId: "design_1", fileId: "file_1" },
      target,
      baseVersionHash: "hash_base",
      repromptId: "reprompt_1",
      variants: [{ html: "<section>New</section>", summary: "Darker hero" }],
    };
    expect(action.schema.safeParse(valid).success).toBe(true);
    expect(action.schema.safeParse({ ...valid, target: {} }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...valid, variants: [] }).success).toBe(
      false,
    );
    expect(
      action.schema.safeParse({
        ...valid,
        variants: Array.from({ length: 4 }, () => valid.variants[0]),
      }).success,
    ).toBe(false);
  });

  it("stores a scoped proposal and returns the first non-persistent preview", async () => {
    const result = await action.run({
      source: { designId: "design_1", fileId: "file_1" },
      target,
      baseVersionHash: "hash_base",
      repromptId: "reprompt_1",
      variants: [
        {
          html: '<section class="bg-slate-950"><h1>New</h1></section>',
          summary: "Dark hero",
        },
      ],
    });

    expect(mocks.readAppState).toHaveBeenCalledWith(
      designRepromptPendingStateKey("design_1", "file_1"),
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      designRepromptProposalStateKey("design_1", "file_1", "reprompt_1"),
      expect.objectContaining({
        proposalId: "node-rewrite-proposal_1",
        repromptId: "reprompt_1",
        baseVersionHash: "hash_base",
        chosenIndex: 0,
      }),
    );
    expect(result.bridgeMessages).toEqual([
      expect.objectContaining({
        type: "node-html-preview",
        proposalId: "node-rewrite-proposal_1",
        operation: "preview",
        html: '<section class="bg-slate-950"><h1>New</h1></section>',
      }),
    ]);
  });

  it("rejects an agent-selected target that differs from pending state", async () => {
    await expect(
      action.run({
        source: { fileId: "file_1" },
        target: { selector: "main" },
        baseVersionHash: "hash_base",
        repromptId: "reprompt_1",
        variants: [{ html: "<main>Changed</main>", summary: "Changed main" }],
      }),
    ).rejects.toThrow("does not match the pending selected subtree");
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("fails with re-anchor guidance when the selected node is gone", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<!DOCTYPE html><html><body><main>Gone</main></body></html>",
      versionHash: "hash_base",
      language: "html",
    });

    await expect(
      action.run({
        source: { fileId: "file_1" },
        target,
        baseVersionHash: "hash_base",
        repromptId: "reprompt_1",
        variants: [
          { html: "<section>Changed</section>", summary: "Changed hero" },
        ],
      }),
    ).rejects.toThrow(/Target missing.+re-anchor/i);
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("rejects a variant containing more than one root subtree", async () => {
    await expect(
      action.run({
        source: { fileId: "file_1" },
        target,
        baseVersionHash: "hash_base",
        repromptId: "reprompt_1",
        variants: [
          {
            html: "<section>One</section><aside>Two</aside>",
            summary: "Two roots",
          },
        ],
      }),
    ).rejects.toThrow("exactly one root element");
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("rejects candidate payloads above the bounded application-state budget", async () => {
    const largeText = "界".repeat(90_000);

    await expect(
      action.run({
        source: { fileId: "file_1" },
        target,
        baseVersionHash: "hash_base",
        repromptId: "reprompt_1",
        variants: [
          {
            html: `<section>${largeText}</section>`,
            summary: "Large candidate",
          },
        ],
      }),
    ).rejects.toThrow("too large to preview safely");
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("removes stale candidates when a newer request wins during proposal creation", async () => {
    const firstPending = await mocks.readAppState();
    mocks.readAppState
      .mockReset()
      .mockResolvedValueOnce(firstPending)
      .mockResolvedValueOnce({ ...firstPending, repromptId: "reprompt_2" });

    await expect(
      action.run({
        source: { fileId: "file_1" },
        target,
        baseVersionHash: "hash_base",
        repromptId: "reprompt_1",
        variants: [
          { html: "<section>Changed</section>", summary: "Changed hero" },
        ],
      }),
    ).rejects.toThrow("superseded by a newer request");

    const proposalKey = designRepromptProposalStateKey(
      "design_1",
      "file_1",
      "reprompt_1",
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      proposalKey,
      expect.objectContaining({ repromptId: "reprompt_1" }),
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      proposalKey,
      expect.objectContaining({ repromptId: "reprompt_1" }),
      null,
    );
  });
});
