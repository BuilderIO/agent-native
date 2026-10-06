import { describe, expect, it } from "vitest";

import { buildResourcePack } from "./pack.js";
import { isBinaryResourceMimeType } from "./store.js";

describe("isBinaryResourceMimeType", () => {
  it("omits pdf, zip, and office bytes from an exported pack", () => {
    const binary = [
      {
        path: "brief.pdf",
        mimeType: "application/pdf",
        content: "pdf-bytes-must-not-export",
      },
      {
        path: "archive.zip",
        mimeType: "application/zip",
        content: "zip-bytes-must-not-export",
      },
      {
        path: "sheet.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: "xlsx-bytes-must-not-export",
      },
      {
        path: "memo.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: "docx-bytes-must-not-export",
      },
      {
        path: "deck.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        content: "pptx-bytes-must-not-export",
      },
      {
        path: "legacy.doc",
        mimeType: "application/msword",
        content: "doc-bytes-must-not-export",
      },
    ];
    const pack = buildResourcePack(
      [
        { path: "notes.md", scope: "personal", content: "keep-this-visible\n" },
        ...binary
          .filter((row) => !isBinaryResourceMimeType(row.mimeType))
          .map((row) => ({
            path: row.path,
            scope: "personal" as const,
            content: row.content,
          })),
      ],
      { exportedAt: 1, source: { scope: "personal" } },
    );
    const serialized = JSON.stringify(pack);

    expect(pack.resources.map((entry) => entry.path)).toEqual(["notes.md"]);
    expect(serialized).toContain("keep-this-visible");
    for (const row of binary) {
      expect(isBinaryResourceMimeType(row.mimeType)).toBe(true);
      expect(serialized).not.toContain(row.content);
    }
  });

  it("fails closed for other non-text upload types and unknown types", () => {
    for (const mimeType of [
      "application/gzip",
      "application/x-tar",
      "application/vnd.ms-excel",
      "application/octet-stream",
      "image/png",
      "audio/mpeg",
      "video/mp4",
      "Application/PDF",
      "application/pdf; charset=binary",
      "application/x-future-binary",
      "",
    ]) {
      expect(isBinaryResourceMimeType(mimeType)).toBe(true);
    }
  });

  it("keeps text and json resources exportable", () => {
    for (const mimeType of [
      "text/markdown",
      "text/plain",
      "text/csv",
      "text/html",
      "Text/Plain",
      "text/plain; charset=utf-8",
      "application/json",
      "Application/JSON",
      "application/json; charset=utf-8",
    ]) {
      expect(isBinaryResourceMimeType(mimeType)).toBe(false);
    }
  });
});
