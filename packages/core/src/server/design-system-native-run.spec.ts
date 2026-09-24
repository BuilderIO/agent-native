import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  thread: vi.fn(),
  access: vi.fn(),
  active: vi.fn(),
  count: vi.fn(),
  byId: vi.fn(),
  latest: vi.fn(),
}));
vi.mock("../chat-threads/store.js", () => ({
  getThread: mocks.thread,
  resolveThreadAccess: mocks.access,
}));
vi.mock("../agent/run-manager.js", () => ({
  getActiveRunForThreadAsync: mocks.active,
}));
vi.mock("../agent/run-store.js", () => ({
  countRunsForTurn: mocks.count,
  getRunById: mocks.byId,
  getRunByThread: mocks.latest,
}));
import { designSystemWorkspaceSchema } from "../shared/design-system-authoring.js";
import { readDesignSystemNativeThreadState } from "./design-system-native-run.js";
import { runWithRequestContext } from "./request-context.js";

const workspace = designSystemWorkspaceSchema.parse({
  schemaVersion: 1,
  ownerApp: "design",
  systemId: "system",
  revision: 0,
  conversationId: "system-thread",
  conversationScope: "design-system:system",
  intent: "fresh",
  sources: [],
  artifacts: [],
  run: {
    id: "persisted-run",
    status: "running",
    stage: "drafting-foundations",
    error: null,
  },
  kickoff: {
    status: "claimed",
    requestId: "new-source-batch",
    claimId: "claim",
    leaseUntil: 0,
    error: null,
  },
  selectedTargetId: null,
  originDraft: null,
  updatedAt: "now",
  creationHash: "hash",
  operations: [],
});
const read = (runId?: string) =>
  runWithRequestContext(
    { userEmail: "owner@example.test", orgId: "org-test" },
    () =>
      readDesignSystemNativeThreadState(
        workspace,
        runId ? { runId } : undefined,
      ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.thread.mockResolvedValue({ id: "system-thread" });
  mocks.access.mockResolvedValue({ messageCount: 20 });
  mocks.active.mockResolvedValue({ runId: "latest-run", status: "running" });
  mocks.count.mockResolvedValue(0);
  mocks.byId.mockResolvedValue({
    id: "persisted-run",
    threadId: "system-thread",
    status: "errored",
    terminalReason: "provider failed",
    startedAt: 100,
  });
  mocks.latest.mockResolvedValue({
    id: "latest-run",
    threadId: "system-thread",
    status: "running",
    startedAt: 200,
  });
});
describe("native run ownership and exact kickoff receipts", () => {
  it("reconciles the latest durable turn instead of an older workspace run and checks only this source-batch receipt", async () => {
    expect(await read()).toMatchObject({
      kickoffReceived: false,
      messageCount: 20,
      run: {
        runId: "latest-run",
        status: "running",
      },
    });
    expect(mocks.count).toHaveBeenCalledWith(
      "system-thread",
      "new-source-batch",
    );
    expect(mocks.latest).toHaveBeenCalledWith("system-thread", {
      includeTerminal: true,
    });
    expect(mocks.byId).not.toHaveBeenCalled();
    expect(mocks.access).toHaveBeenCalledWith(
      "owner@example.test",
      "system-thread",
      "viewer",
      { orgId: "org-test" },
    );
  });
  it("rejects a requested run from another thread", async () => {
    mocks.byId.mockResolvedValue({
      id: "persisted-run",
      threadId: "another-thread",
      status: "completed",
    });
    await expect(read("persisted-run")).rejects.toMatchObject({
      errorCode: "design_system_run_mismatch",
      statusCode: 409,
    });
  });
  it("rejects a delayed old bind after a newer native turn has persisted", async () => {
    await expect(read("persisted-run")).rejects.toMatchObject({
      errorCode: "design_system_run_superseded",
      statusCode: 409,
    });
  });
  it("recovers terminal state after the manager's reconnect window expires", async () => {
    mocks.active.mockResolvedValue(null);
    mocks.latest.mockResolvedValue({
      id: "latest-run",
      threadId: "system-thread",
      status: "completed",
      startedAt: 200,
    });
    expect((await read()).run).toMatchObject({
      runId: "latest-run",
      status: "completed",
    });
  });
  it("requires an actual persisted run for an explicit bind", async () => {
    mocks.byId.mockResolvedValue(null);
    expect((await read("unknown-run")).run).toBeNull();
  });
  it("does not inspect runs when conversation access is denied", async () => {
    mocks.access.mockResolvedValue(null);
    await expect(read()).rejects.toMatchObject({
      errorCode: "design_system_conversation_forbidden",
      statusCode: 403,
    });
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.byId).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
