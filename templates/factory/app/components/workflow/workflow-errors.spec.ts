import { describe, expect, it } from "vitest";

import {
  classifySaveFailure as classifySaveFailureOf,
  isUnknownActionError,
  readActionFailure as readActionFailureOf,
} from "./workflow-errors";

const UNKNOWN = "Unknown error";
const readActionFailure = (error: unknown) =>
  readActionFailureOf(error, UNKNOWN);
const classifySaveFailure = (error: unknown) =>
  classifySaveFailureOf(error, UNKNOWN);

function actionError(fields: {
  message?: string;
  errorCode?: string;
  status?: number;
  actionMessage?: string;
  details?: unknown;
}): Error {
  return Object.assign(new Error(fields.message ?? "Action failed"), fields);
}

describe("readActionFailure", () => {
  it("reads the typed code, status and details an action failure carries", () => {
    const failure = readActionFailure(
      actionError({
        message: "Action save-factory-workflow failed: no",
        actionMessage: "no",
        errorCode: "graph_invalid",
        status: 422,
        details: { issueCount: 2 },
      }),
    );
    expect(failure).toEqual({
      errorCode: "graph_invalid",
      status: 422,
      message: "no",
      details: { issueCount: 2 },
    });
  });

  it("falls back to the error message and empty details", () => {
    expect(readActionFailure(new Error("offline"))).toEqual({
      errorCode: null,
      status: null,
      message: "offline",
      details: {},
    });
  });

  it("does not read an array as details", () => {
    expect(readActionFailure(actionError({ details: [1, 2] })).details).toEqual(
      {},
    );
  });

  it("copes with a thrown value that is not an Error", () => {
    expect(readActionFailure("boom").message).toBe("boom");
    expect(readActionFailure(undefined).message).toBe("Unknown error");
  });
});

describe("isUnknownActionError", () => {
  it("is a 404 with no typed code", () => {
    expect(
      isUnknownActionError(readActionFailure(actionError({ status: 404 }))),
    ).toBe(true);
  });

  it("is not a typed not-found, a server error, or no status at all", () => {
    expect(
      isUnknownActionError(
        readActionFailure(
          actionError({ status: 404, errorCode: "workflow_not_found" }),
        ),
      ),
    ).toBe(false);
    expect(
      isUnknownActionError(readActionFailure(actionError({ status: 500 }))),
    ).toBe(false);
    expect(isUnknownActionError(readActionFailure(new Error("x")))).toBe(false);
  });
});

describe("classifySaveFailure", () => {
  it("returns every issue of a refused graph", () => {
    const result = classifySaveFailure(
      actionError({
        errorCode: "graph_invalid",
        details: {
          issueCount: 3,
          truncated: false,
          issues: [
            {
              source: "graph",
              code: "port_leads_nowhere",
              nodeId: "a",
              port: "out",
            },
            {
              source: "job",
              code: "schedule_timezone_required",
              nodeId: "t",
              detail: "Pick a time zone.",
            },
            { source: "schema", code: "too_small", path: "nodes.0.name" },
            { nope: true },
          ],
        },
      }),
    );
    expect(result.kind).toBe("graph_invalid");
    if (result.kind !== "graph_invalid") return;
    expect(result.issueCount).toBe(3);
    expect(result.issues).toEqual([
      { source: "graph", code: "port_leads_nowhere", nodeId: "a", port: "out" },
      {
        source: "job",
        code: "schedule_timezone_required",
        nodeId: "t",
        detail: "Pick a time zone.",
      },
      { source: "schema", code: "too_small", path: "nodes.0.name" },
    ]);
  });

  it("counts the listed issues when the count is missing, and keeps the truncation flag", () => {
    const result = classifySaveFailure(
      actionError({
        errorCode: "graph_invalid",
        details: { truncated: true, issues: [{ code: "x" }] },
      }),
    );
    expect(result).toMatchObject({ issueCount: 1, truncated: true });
  });

  it("reads the version a stale save lost to", () => {
    expect(
      classifySaveFailure(
        actionError({
          errorCode: "version_conflict",
          details: { currentVersion: 7 },
        }),
      ),
    ).toMatchObject({ kind: "version_conflict", currentVersion: 7 });
    expect(
      classifySaveFailure(actionError({ errorCode: "version_conflict" })),
    ).toMatchObject({ kind: "version_conflict", currentVersion: null });
  });

  it("says which version was saved when the job file did not follow", () => {
    expect(
      classifySaveFailure(
        actionError({
          errorCode: "job_sync_failed",
          details: { savedVersion: 4, disabledBySave: true },
        }),
      ),
    ).toMatchObject({
      kind: "job_sync_failed",
      savedVersion: 4,
      disabledBySave: true,
    });
  });

  it("separates a deleted workflow from everything else", () => {
    expect(
      classifySaveFailure(actionError({ errorCode: "workflow_not_found" }))
        .kind,
    ).toBe("workflow_not_found");
    expect(
      classifySaveFailure(
        actionError({ errorCode: "workflow_job_name_taken", message: "taken" }),
      ),
    ).toEqual({
      kind: "other",
      code: "workflow_job_name_taken",
      message: "taken",
    });
    expect(classifySaveFailure(new Error("offline"))).toEqual({
      kind: "other",
      code: null,
      message: "offline",
    });
  });
});
