import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  binding: vi.fn(),
}));
vi.mock("../server/lib/notebook-tool-context.js", () => ({
  isNotebookToolWrite: () => false,
  requireNotebookToolIdentity: vi.fn(),
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi
    .fn()
    .mockResolvedValue({ ownerEmail: "owner@example.test", orgId: "org-1" }),
}));
vi.mock("../server/model/notebook-execution/service.js", () => ({
  currentExecutionActor: vi.fn().mockResolvedValue({ caller: "agent" }),
  notebookExecution: vi.fn(),
}));
vi.mock("../server/model/notebook-execution/thread-snapshot.js", () => ({
  currentThreadSnapshot: mocks.snapshot,
}));
vi.mock("../server/model/analytics-thread-bootstrap.js", () => ({
  readAnalyticsThreadBinding: mocks.binding,
}));
vi.mock("../server/model/project-query.js", async () => ({
  ...(await vi.importActual<object>("../server/model/project-query.js")),
  runProjectQuery: vi.fn(),
}));

import runProjectCell from "./run-project-cell.js";

const input = {
  projectId: "prj_v3",
  cellId: "cel_1",
  threadId: "thread-home",
};
const context = { caller: "agent" } as never;

describe("run-project-cell from a conversation bound to another project", () => {
  beforeEach(() => {
    mocks.snapshot.mockReset().mockResolvedValue({ status: "denied" });
    mocks.binding.mockReset();
  });

  it("says the conversation belongs to another project instead of a bare thread_not_found", async () => {
    mocks.binding.mockResolvedValue({ project: { id: "prj_private_empty" } });
    await expect(runProjectCell.run(input, context)).rejects.toMatchObject({
      errorCode: "thread_project_mismatch",
      statusCode: 409,
      message: expect.stringContaining("open-project"),
    });
  });

  it("keeps thread_not_found when the thread is not the caller's", async () => {
    mocks.binding.mockResolvedValue(undefined);
    await expect(runProjectCell.run(input, context)).rejects.toMatchObject({
      errorCode: "thread_not_found",
      statusCode: 404,
    });
  });

  it.each(["poll", "next-page", "page"] as const)(
    "report SAYA-1117-WRITE-CLAIMS: directs thread %s calls to get-notebook-run instead of review_context_required",
    async (operation) => {
      await expect(
        runProjectCell.run({ ...input, operation }, context),
      ).rejects.toMatchObject({
        errorCode: "thread_run_poll_unsupported",
        statusCode: 400,
        message: expect.stringMatching(
          /get-notebook-run.*get-notebook-result-page/,
        ),
      });
    },
  );
});
