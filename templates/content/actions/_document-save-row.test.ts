import { describe, expect, it } from "vitest";

import {
  documentContentHash,
  documentRevisionToken,
} from "./_document-edit-mutation.js";
import {
  editorSaveIsInSql,
  type DocumentSaveRow,
} from "./_document-save-row.js";

const ROW: DocumentSaveRow = {
  bodyRevision: 4,
  content: "Saved body.",
  title: "Saved title",
  updatedAt: "2026-10-17T12:00:05.000Z",
};

function claim(
  overrides: Partial<Parameters<typeof editorSaveIsInSql>[1]> = {},
) {
  return {
    revision: documentRevisionToken(4, "Saved body."),
    title: "Saved title",
    titleUpdatedAt: "2026-10-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("editorSaveIsInSql", () => {
  it("accepts the same revision, text, and title", () => {
    expect(editorSaveIsInSql(ROW, claim())).toBe(true);
  });

  it("accepts a later body revision written by someone else", () => {
    expect(
      editorSaveIsInSql(
        { ...ROW, bodyRevision: 6, content: "Agent edit." },
        claim(),
      ),
    ).toBe(true);
  });

  it("accepts a title another writer saved after the editor save", () => {
    expect(editorSaveIsInSql({ ...ROW, title: "Renamed" }, claim())).toBe(true);
  });

  it("refuses a body revision SQL has not reached", () => {
    expect(
      editorSaveIsInSql(
        ROW,
        claim({ revision: documentRevisionToken(5, "x") }),
      ),
    ).toBe(false);
  });

  it("refuses the same revision number with different text", () => {
    expect(
      editorSaveIsInSql(
        ROW,
        claim({ revision: `body:4:${documentContentHash("Other body.")}` }),
      ),
    ).toBe(false);
  });

  it("refuses a different title that is not newer than the editor save", () => {
    expect(
      editorSaveIsInSql(
        { ...ROW, title: "Renamed", updatedAt: "2026-10-17T12:00:00.000Z" },
        claim(),
      ),
    ).toBe(false);
    expect(
      editorSaveIsInSql(
        { ...ROW, title: "Renamed" },
        claim({ titleUpdatedAt: null }),
      ),
    ).toBe(false);
  });

  it("refuses a malformed revision token", () => {
    expect(editorSaveIsInSql(ROW, claim({ revision: "body:4" }))).toBe(false);
  });
});
