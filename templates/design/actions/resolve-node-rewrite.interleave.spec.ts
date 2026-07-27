import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const initialContent =
    '<!DOCTYPE html><html><body><section data-agent-native-node-id="hero">Old</section><footer>Keep</footer></body></html>';
  const file = {
    id: "file_1",
    designId: "design_1",
    filename: "index.html",
    fileType: "html",
    content: initialContent,
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
    initialContent,
    file,
    selectChain,
    state: new Map<string, Record<string, unknown>>(),
    live: { content: initialContent, versionHash: "hash_base" },
    readLiveSourceFile: vi.fn(),
    writeInlineSourceFile: vi.fn(),
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async (key: string) => mocks.state.get(key) ?? null),
  writeAppState: vi.fn(async (key: string, value: Record<string, unknown>) => {
    mocks.state.set(key, value);
  }),
  listAppState: vi.fn(async (prefix: string) =>
    [...mocks.state.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
  ),
  compareAndSetAppState: vi.fn(
    async (
      key: string,
      expected: Record<string, unknown> | null,
      next: Record<string, unknown> | null,
    ) => {
      const current = mocks.state.get(key) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      if (next) mocks.state.set(key, next);
      else mocks.state.delete(key);
      return true;
    },
  ),
  compareAndSetManyAppState: vi.fn(
    async (
      operations: Array<{
        key: string;
        expectedValue: Record<string, unknown> | null;
        nextValue: Record<string, unknown> | null;
      }>,
    ) => {
      const matches = operations.every(
        ({ key, expectedValue }) =>
          JSON.stringify(mocks.state.get(key) ?? null) ===
          JSON.stringify(expectedValue),
      );
      if (!matches) return false;
      for (const { key, nextValue } of operations) {
        if (nextValue) mocks.state.set(key, nextValue);
        else mocks.state.delete(key);
      }
      return true;
    },
  ),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ access: true })),
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("nanoid", () => ({ nanoid: vi.fn(() => "proposal_1") }));

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
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
} from "../shared/node-rewrite.js";
import beginAction from "./begin-node-rewrite-request.js";
import proposeAction from "./propose-node-rewrite.js";
import resolveAction from "./resolve-node-rewrite.js";

describe("node rewrite propose/accept interleave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.clear();
    mocks.live.content = mocks.initialContent;
    mocks.live.versionHash = "hash_base";
    mocks.selectChain.limit.mockResolvedValue([mocks.file]);
    mocks.readLiveSourceFile.mockImplementation(async () => ({
      ...mocks.live,
      language: "html",
    }));
    mocks.writeInlineSourceFile.mockResolvedValue({
      changed: true,
      versionHash: "hash_next",
      updatedAt: "2026-07-16T00:02:00.000Z",
    });
    mocks.state.set(designRepromptPendingStateKey("design_1", "file_1"), {
      repromptId: "reprompt_1",
      designId: "design_1",
      fileId: "file_1",
      target: { nodeId: "hero" },
      baseVersionHash: "hash_base",
      instruction: "Make it darker",
      createdAt: "2026-07-16T00:00:00.000Z",
    });
  });

  it("never rebases a proposal over a collab edit that lands before accept", async () => {
    const proposed = await proposeAction.run({
      source: { fileId: "file_1" },
      target: { nodeId: "hero" },
      baseVersionHash: "hash_base",
      repromptId: "reprompt_1",
      variants: [
        {
          html: '<section data-agent-native-node-id="hero" class="dark">New</section>',
          summary: "Dark hero",
        },
      ],
    });
    expect(
      mocks.state.get(
        designRepromptProposalStateKey("design_1", "file_1", "reprompt_1"),
      ),
    ).toEqual(expect.objectContaining({ proposalId: proposed.proposalId }));

    mocks.live.content = mocks.initialContent.replace("Keep", "Human edit");
    mocks.live.versionHash = "hash_collab_edit";

    await expect(
      resolveAction.run({
        proposalId: proposed.proposalId,
        resolution: "accept",
      }),
    ).rejects.toThrow("Screen changed since proposal");
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(
      mocks.state.has(
        designRepromptProposalStateKey("design_1", "file_1", "reprompt_1"),
      ),
    ).toBe(true);
    expect(
      mocks.state.has(designRepromptPendingStateKey("design_1", "file_1")),
    ).toBe(true);
  });

  it("does not write an old proposal when a newer request wins before reservation", async () => {
    const proposed = await proposeAction.run({
      source: { fileId: "file_1" },
      target: { nodeId: "hero" },
      baseVersionHash: "hash_base",
      repromptId: "reprompt_1",
      variants: [
        {
          html: '<section data-agent-native-node-id="hero">New</section>',
          summary: "Updated hero",
        },
      ],
    });
    let finishRead!: () => void;
    mocks.readLiveSourceFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () =>
            resolve({ ...mocks.live, language: "html" } as never);
        }),
    );

    const accepting = resolveAction.run({
      proposalId: proposed.proposalId,
      resolution: "accept",
    });
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
    await beginAction.run({
      repromptId: "reprompt_2",
      designId: "design_1",
      fileId: "file_1",
      target: { nodeId: "hero" },
      baseVersionHash: "hash_base",
      instruction: "Try another direction",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    finishRead();

    await expect(accepting).rejects.toThrow("newer regeneration request");
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("lets acceptance reservation defeat a concurrent rejection", async () => {
    const proposed = await proposeAction.run({
      source: { fileId: "file_1" },
      target: { nodeId: "hero" },
      baseVersionHash: "hash_base",
      repromptId: "reprompt_1",
      variants: [
        {
          html: '<section data-agent-native-node-id="hero">New</section>',
          summary: "Updated hero",
        },
      ],
    });
    let finishWrite!: () => void;
    mocks.writeInlineSourceFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWrite = () =>
            resolve({
              changed: true,
              versionHash: "hash_next",
              updatedAt: "2026-07-17T00:01:00.000Z",
            });
        }),
    );

    const accepting = resolveAction.run({
      proposalId: proposed.proposalId,
      resolution: "accept",
    });
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    await expect(
      resolveAction.run({
        proposalId: proposed.proposalId,
        resolution: "reject",
      }),
    ).rejects.toThrow("newer regeneration request");
    finishWrite();

    await expect(accepting).resolves.toEqual(
      expect.objectContaining({ changed: true, cleanupComplete: true }),
    );
    expect(
      mocks.state.has(designRepromptPendingStateKey("design_1", "file_1")),
    ).toBe(false);
  });
});
