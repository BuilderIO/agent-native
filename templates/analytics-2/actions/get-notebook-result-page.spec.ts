import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentResultActor: vi.fn(),
  getNotebookResultPage: vi.fn(),
  notebookThreadMatches: vi.fn(),
}));

vi.mock("../server/lib/notebook-tool-context.js", () => ({
  notebookThreadMatches: mocks.notebookThreadMatches,
}));
vi.mock("../server/model/notebook-results.js", async () => {
  const { z } = await import("zod");
  return {
    currentResultActor: mocks.currentResultActor,
    getNotebookResultPage: mocks.getNotebookResultPage,
    getNotebookResultPageInput: z.any(),
    getNotebookResultPageOutput: z.any(),
  };
});

import {
  PARTIAL_RESULT_NOTE,
  resultPreviewSchema,
} from "../server/model/cell-result-preview.js";
import getNotebookResultPageAction from "./get-notebook-result-page.js";

function readyPage(rowCount: number, returned: number, page = 1) {
  return {
    status: "ready" as const,
    manifest: {
      result: {
        id: "res_1234567890abcdef",
        producer: {
          runId: "run_1234567890abcdef",
          attemptId: "att_1234567890abcdef",
          cellId: "cel_1",
          exportId: "0",
        },
      },
      status: "complete" as const,
      fields: [{ fieldId: "0", name: "event_id", type: "integer" as const }],
      rowCount: String(rowCount),
      segments: 1,
    },
    page,
    rows: Array.from({ length: returned }, (_, i) => [i + 1]),
    view: { page, viewRevision: "0" },
  };
}

beforeEach(() => {
  mocks.currentResultActor.mockReset().mockResolvedValue({
    email: "qa-fleet@builder.io",
    orgId: "org_1",
    caller: "tool",
  });
  mocks.notebookThreadMatches.mockReset().mockReturnValue(true);
  mocks.getNotebookResultPage.mockReset();
});

describe("report SAYA-1117-PREVIEW-INFERENCE: get-notebook-result-page preview metadata", () => {
  it("attaches partial preview metadata and non-representative warning for agent callers when more rows exist", async () => {
    mocks.getNotebookResultPage.mockResolvedValue(readyPage(150, 50, 1));
    const response = (await getNotebookResultPageAction.run(
      { resultId: "res_1234567890abcdef", page: 1 },
      { caller: "tool" },
    )) as Record<string, unknown>;
    expect(response.status).toBe("ready");
    const preview = resultPreviewSchema.parse(response.preview);
    expect(preview).toEqual({
      offset: 0,
      nextOffset: 50,
      valuesTruncated: false,
      columnsTruncated: false,
      returnedRows: 50,
      totalRows: "150",
      partial: true,
      partialNote: PARTIAL_RESULT_NOTE,
    });
  });

  it("marks single-page complete results as non-partial for agent callers", async () => {
    mocks.getNotebookResultPage.mockResolvedValue(readyPage(5, 5, 1));
    const response = (await getNotebookResultPageAction.run(
      { resultId: "res_1234567890abcdef", page: 1 },
      { caller: "tool" },
    )) as Record<string, unknown>;
    expect(response.status).toBe("ready");
    const preview = resultPreviewSchema.parse(response.preview);
    expect(preview).toEqual({
      offset: 0,
      nextOffset: null,
      valuesTruncated: false,
      columnsTruncated: false,
      returnedRows: 5,
      totalRows: "5",
      partial: false,
    });
  });

  it("omits agent preview metadata for frontend callers", async () => {
    mocks.getNotebookResultPage.mockResolvedValue(readyPage(150, 50, 1));
    const response = (await getNotebookResultPageAction.run(
      { resultId: "res_1234567890abcdef", page: 1 },
      { caller: "frontend" },
    )) as Record<string, unknown>;
    expect(response.status).toBe("ready");
    expect(response.preview).toBeUndefined();
  });
});
