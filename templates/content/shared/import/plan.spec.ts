import { describe, expect, it } from "vitest";

import {
  dataUrlByteLength,
  dataUrlBytes,
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
    expect(importFileKind("notes.constructor")).toBe("unsupported");
  });

  it("previews picked images as available and asks for each upload once", () => {
    const {
      pages: [page],
    } = planMarkdownPages({
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
    const {
      pages: [page],
    } = planMarkdownPages({
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

    const {
      pages: [page],
    } = planMarkdownPages({
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
    expect(dataUrlByteLength("data:image/png,%89PNG%0D%0A%1A%0A")).toBe(8);
    expect(dataUrlByteLength("data:image/svg+xml,café")).toBe(5);
    expect(dataUrlByteLength("data:image/png")).toBeNull();
    expect(dataUrlByteLength("data:image/png,")).toBeNull();
    expect(dataUrlByteLength("data:image/png;base64,")).toBeNull();
  });

  it.each([
    ["unpadded", "QUI", [0x41, 0x42]],
    ["wrapped across lines", "QU\nJD", [0x41, 0x42, 0x43]],
    ["with percent escapes", "%2B%2F8%3D", [0xfb, 0xff]],
  ])(
    "decodes a %s base64 image to the bytes it spells",
    (_, payload, bytes) => {
      const url = `data:image/png;base64,${payload}`;

      expect([...dataUrlBytes(url)!]).toEqual(bytes);
      expect(dataUrlByteLength(url)).toBe(bytes.length);
    },
  );

  it.each([
    ["100%", "100%"],
    ["%G0", "%G0"],
    ["%3Csvg%3E100%%3C/svg%3E", "<svg>100%</svg>"],
  ])(
    "keeps a percent sign that starts no escape in %s, as browsers do",
    (payload, text) => {
      const url = `data:image/svg+xml,${payload}`;

      expect(new TextDecoder().decode(dataUrlBytes(url)!)).toBe(text);
      expect(dataUrlByteLength(url)).toBe(text.length);
    },
  );

  it.each([["%%%"], ["QUJD!"], ["QUJDR"], ["QQ="], ["Q=Q="], ["%C3%A9QUI"]])(
    "gives no size or bytes to the base64 payload %s",
    (payload) => {
      const url = `data:image/png;base64,${payload}`;

      expect(dataUrlByteLength(url)).toBeNull();
      expect(dataUrlBytes(url)).toBeNull();
    },
  );

  it("previews an embedded image that won't decode as missing", () => {
    const {
      pages: [page],
    } = planMarkdownPages({
      markdown: [
        {
          path: "guide.md",
          text: "![Chart](data:image/png;base64,QUJD!)",
        },
      ],
      imagePaths: new Set(),
    });

    expect(page.uploads).toEqual([]);
    expect(page.preview.assets.map((asset) => asset.status)).toEqual([
      "missing",
    ]);
  });

  it("leaves out a page too long to save, and reports links to it as not imported", () => {
    const { pages, tooLarge } = planMarkdownPages({
      markdown: [
        { path: "guide.md", text: "# Guide\n\nSee [the log](log.md)." },
        { path: "log.md", text: `# Log\n\n${"entry ".repeat(90_000)}` },
        { path: "faq.md", text: "# FAQ\n\nAnswers." },
      ],
      imagePaths: new Set(),
    });

    expect(tooLarge).toEqual(["log.md"]);
    expect(pages.map((page) => page.path)).toEqual(["guide.md", "faq.md"]);
    expect(pages[0].preview.report.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "link-target-not-imported",
          samples: ["log.md"],
        }),
      ]),
    );
  });

  it("pads short table rows from one budget for the whole import", () => {
    // 200 one-cell rows under a 201-cell row pad 40,000 cells; the import
    // may pad 100,000 in all.
    const paddedTable = [
      "| a |",
      "| - |",
      `| ${Array.from({ length: 201 }, (_, index) => `c${index}`).join(" | ")} |`,
      ...Array.from({ length: 199 }, () => "| x |"),
    ].join("\n");
    for (const order of [
      ["a.md", "b.md", "c.md"],
      ["c.md", "b.md", "a.md"],
    ]) {
      const { pages, tooLarge } = planMarkdownPages({
        markdown: order.map((path) => ({
          path,
          text: `# ${path}\n\n${paddedTable}`,
        })),
        imagePaths: new Set(),
      });

      const tables = (path: string) =>
        pages
          .find((page) => page.path === path)
          ?.preview.doc.content?.filter((node) => node.type === "table").length;
      expect(tooLarge).toEqual([]);
      expect(pages.map((page) => page.path)).toEqual(order);
      expect([tables("a.md"), tables("b.md"), tables("c.md")]).toEqual([
        1, 1, 0,
      ]);
    }
  });
});
