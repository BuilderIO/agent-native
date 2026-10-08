import { describe, expect, it } from "vitest";

import {
  dataUrlByteLength,
  finalizePlannedPage,
  importFileKind,
  matchImportImagePath,
  normalizeImportPath,
  planMarkdownPages,
} from "./plan";

describe("Import planning", () => {
  it("keeps picked names inside the import", () => {
    expect(normalizeImportPath("notes\\guide.md")).toBe("notes/guide.md");
    expect(normalizeImportPath("./notes//guide.md")).toBe("notes/guide.md");
    expect(normalizeImportPath("/guide.md")).toBe("guide.md");
    expect(normalizeImportPath("../secrets.md")).toBeNull();
    expect(normalizeImportPath("notes/../../x.md")).toBeNull();
    expect(normalizeImportPath("")).toBeNull();
  });

  it("sorts files into pages, images, and formats not supported yet", () => {
    expect(importFileKind("guide.MD")).toBe("markdown");
    expect(importFileKind("guide.markdown")).toBe("markdown");
    expect(importFileKind("logo.svg")).toBe("image");
    expect(importFileKind("photo.JPEG")).toBe("image");
    expect(importFileKind("export.zip")).toBe("unsupported");
    expect(importFileKind("report.docx")).toBe("unsupported");
    expect(importFileKind("README")).toBe("unsupported");
  });

  it("previews picked images as available and asks for each upload once", () => {
    const [page] = planMarkdownPages({
      markdown: [
        {
          path: "guide.md",
          text: [
            "# Guide",
            "",
            "![Logo](logo.png)",
            "",
            "![Logo again](./logo.png)",
            "",
            "![Diagram](diagram.png)",
            "",
            "See [setup](setup.md) and [faq](faq.md).",
          ].join("\n"),
        },
        { path: "setup.md", text: "# Setup" },
      ],
      imagePaths: new Set(["logo.png"]),
    });

    expect(page.preview.title).toBe("Guide");
    expect(page.uploads).toEqual([
      { kind: "file", path: "logo.png", reference: "logo.png" },
    ]);
    expect(page.preview.assets.map((asset) => asset.status)).toEqual([
      "available",
      "available",
      "missing",
    ]);
    const lost = Object.fromEntries(
      page.preview.report.notes.map((note) => [note.kind, note.samples]),
    );
    expect(lost["asset-missing"]).toEqual(["diagram.png"]);
    expect(lost["link-target-not-imported"]).toEqual(["faq.md"]);
  });

  it("stores uploaded URLs and links between imported pages", () => {
    const [page] = planMarkdownPages({
      markdown: [
        {
          path: "guide.md",
          text: "# Guide\n\n![Logo](logo.png)\n\nSee [setup](setup.md).",
        },
        { path: "setup.md", text: "# Setup" },
      ],
      imagePaths: new Set(["logo.png"]),
    });

    const stored = finalizePlannedPage(page, {
      assetUrl: (request) =>
        request.kind === "file" && request.path === "logo.png"
          ? "https://files.example/logo.png"
          : null,
      pageHref: (path) => (path === "setup.md" ? "/page/setup123" : null),
    });

    expect(stored.content).toContain("![Logo](https://files.example/logo.png)");
    expect(stored.content).toContain("[setup](/page/setup123)");
    expect(stored.report.status).toBe("preserved");
  });

  it("matches a picked image to a reference in a folder by its unique name", () => {
    const picked = new Set(["diagram.png", "a/logo.png", "b/logo.png"]);
    expect(matchImportImagePath("images/diagram.png", picked)).toBe(
      "diagram.png",
    );
    expect(matchImportImagePath("a/logo.png", picked)).toBe("a/logo.png");
    expect(matchImportImagePath("images/logo.png", picked)).toBeNull();

    const [page] = planMarkdownPages({
      markdown: [{ path: "guide.md", text: "![D](images/diagram.png)\n" }],
      imagePaths: new Set(["diagram.png"]),
    });
    expect(page.uploads).toEqual([
      expect.objectContaining({ kind: "file", path: "diagram.png" }),
    ]);
    const stored = finalizePlannedPage(page, {
      assetUrl: (request) =>
        request.kind === "file" && request.path === "diagram.png"
          ? "/uploads/diagram.png"
          : null,
      pageHref: () => null,
    });
    expect(stored.content).toContain("/uploads/diagram.png");
    expect(stored.report.status).toBe("preserved");
  });

  it("measures embedded images, and gives no size to one that won't decode", () => {
    expect(dataUrlByteLength("data:image/png;base64,AAAA")).toBe(3);
    expect(dataUrlByteLength("data:image/png;base64,AAA=")).toBe(2);
    expect(dataUrlByteLength("data:image/svg+xml,%3Csvg%3E")).toBe(5);
    expect(dataUrlByteLength("data:image/svg+xml,100%")).toBeNull();
    expect(dataUrlByteLength("data:image/svg+xml,%FF")).toBeNull();
  });

  it("previews an embedded image that won't decode as missing", () => {
    const [page] = planMarkdownPages({
      markdown: [
        {
          path: "guide.md",
          text: "![Chart](data:image/svg+xml,<svg>100%</svg>)",
        },
      ],
      imagePaths: new Set(),
    });

    expect(page.uploads).toEqual([]);
    expect(page.preview.assets.map((asset) => asset.status)).toEqual([
      "missing",
    ]);
  });
});
