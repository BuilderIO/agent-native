import { expect, it, vi } from "vitest";

import { notebookResultFields, stageNotebookSegment } from "./notebook-arrow";

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: vi.fn().mockResolvedValue(null),
}));

it("asks the workspace admin to set up storage when a SQL result cannot be saved", async () => {
  const columns = [{ name: "value", type: "STRING", mode: "REQUIRED" }];
  const record = vi.fn();
  await expect(
    stageNotebookSegment(
      {
        artifactId: "artifact",
        attemptId: "attempt",
        submissionId: "submission",
        ownerEmail: "test@example.com",
        startRow: 0,
        page: { columns, rows: [["example"]] },
        fields: notebookResultFields(columns),
      },
      record,
    ),
  ).rejects.toMatchObject({
    errorCode: "notebook_result_storage_unavailable",
    statusCode: 503,
    message:
      "Results can’t be saved in this workspace right now. A workspace admin needs to set up storage.",
  });
  expect(record).not.toHaveBeenCalled();
});
