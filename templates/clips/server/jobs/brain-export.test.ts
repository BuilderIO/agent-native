import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  exportRun: vi.fn(),
  runWithRequestContext: vi.fn(),
  select: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  eq: (...values: unknown[]) => values,
  isNull: (value: unknown) => value,
}));

vi.mock("../../actions/export-to-brain.js", () => ({
  default: { run: mocks.exportRun },
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    recordings: {
      id: "recordings.id",
      orgId: "recordings.orgId",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      trashedAt: "recordings.trashedAt",
    },
  },
}));

vi.mock("../lib/recordings.js", () => ({
  ownerEmailMatches: (...values: unknown[]) => values,
}));

import { runBrainExportSweepOnce } from "./brain-export.js";

function queryResult(result: unknown) {
  const promise = Promise.resolve(result);
  const query: Record<string, unknown> = {
    from: () => query,
    where: () => query,
    limit: () => promise,
    then: promise.then.bind(promise),
  };
  return query;
}

describe("Brain export recovery sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runWithRequestContext.mockImplementation(
      async (_context, callback: () => Promise<unknown>) => callback(),
    );
  });

  it("bounds pending work and records an attempt when an item throws", async () => {
    mocks.execute.mockResolvedValue({
      rows: [
        {
          session_id: "person@example.com",
          key: "clips-brain-export-recording-1",
          value: JSON.stringify({
            recordingId: "recording-1",
            status: "pending",
            attempts: 0,
            updatedAt: "2026-07-22T00:00:00.000Z",
            nextAttemptAt: "2026-07-22T00:00:00.000Z",
          }),
        },
      ],
    });
    mocks.select.mockReturnValue(
      queryResult([{ ownerEmail: "person@example.com", orgId: "org-example" }]),
    );
    mocks.exportRun.mockRejectedValue(new Error("unexpected failure"));

    await runBrainExportSweepOnce();

    expect(mocks.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("ORDER BY updated_at ASC LIMIT ?"),
      args: [
        "clips-brain-export-%",
        '%"status":"pending"%',
        '%"status":"failed"%',
        100,
      ],
    });
    expect(mocks.exportRun).toHaveBeenCalledWith({
      recordingId: "recording-1",
      retryAttempt: 1,
    });
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "clips-brain-export-recording-1",
      expect.objectContaining({
        status: "failed",
        attempts: 1,
        reason: "brain-export-worker-failed",
        nextAttemptAt: expect.any(String),
      }),
    );
  });
});
