import { describe, expect, it } from "vitest";

import { normalizeWorkspaceFileResult } from "./workspace-file-result.js";

describe("normalizeWorkspaceFileResult", () => {
  it("normalizes a complete file result", () => {
    expect(
      normalizeWorkspaceFileResult({
        file: {
          resourceId: "resource-example",
          path: "exports/report.csv",
          name: "report.csv",
          contentType: "text/csv",
          sizeBytes: 2048,
          updatedAt: "2026-07-29T10:01:00.000Z",
        },
      }),
    ).toEqual({
      file: {
        resourceId: "resource-example",
        path: "exports/report.csv",
        name: "report.csv",
        contentType: "text/csv",
        sizeBytes: 2048,
        updatedAt: "2026-07-29T10:01:00.000Z",
      },
    });
  });

  it.each([
    null,
    {},
    { file: {} },
    {
      file: {
        resourceId: "",
        path: "exports/report.csv",
        name: "report.csv",
        contentType: "text/csv",
        sizeBytes: 1,
      },
    },
    {
      file: {
        resourceId: "resource-example",
        path: "exports/report.csv",
        name: "report.csv",
        contentType: "text/csv",
        sizeBytes: -1,
      },
    },
  ])("rejects malformed file results", (value) => {
    expect(normalizeWorkspaceFileResult(value)).toBeNull();
  });
});
