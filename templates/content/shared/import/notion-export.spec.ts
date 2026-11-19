import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { PMDoc, PMNode } from "../nfm";
import {
  isNotionExport,
  notionFileTitle,
  planNotionExport,
  prepareNotionMarkdown,
} from "./notion-export";
import { NOTION_EXPORT_2026 } from "./notion-export.fixtures";
import {
  finalizePlannedPage,
  importFileKind,
  MAX_IMPORT_PAGE_CHARACTERS,
  planMarkdownPages,
} from "./plan";
import { readImportZip } from "./zip";

const ROOT = "Import fixture 2026 41a7b5df817a81eca183d7914fa51067.md";
const SUBPAGE_A =
  "Import fixture 2026/Subpage A 41a7b5df817a81eca545c5de112bc497.md";
const GRANDCHILD =
  "Import fixture 2026/Subpage A/Grandchild 41a7b5df817a81909b58f1928827a074.md";
const NOTES = "Import fixture 2026/Notes 41a7b5df817a815ebd71f728dc757fb7.md";
const SUBPAGE_NOTES =
  "Import fixture 2026/Subpage A/Notes 41a7b5df817a814283e6d8a82716bf57.md";
const QA =
  "Import fixture 2026/Q&A what why 100% [draft] #1 41a7b5df817a810ebabef9b04e31be1e.md";
const TASKS_CSV =
  "Import fixture 2026/Tasks 41a7b5df817a81db89cadaff27c5100b.csv";
const TASKS_ALL_CSV =
  "Import fixture 2026/Tasks 41a7b5df817a81db89cadaff27c5100b_all.csv";

async function readFixtureExport() {
  const zip = new JSZip();
  for (const file of NOTION_EXPORT_2026) {
    zip.file(
      file.path,
      "text" in file ? file.text : Buffer.from(file.base64, "base64"),
    );
  }
  const { entries } = await readImportZip(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const decoder = new TextDecoder();
  return {
    markdown: entries
      .filter((entry) => importFileKind(entry.path) === "markdown")
      .map((entry) => ({ path: entry.path, text: decoder.decode(entry.data) })),
    imagePaths: new Set(
      entries
        .filter((entry) => importFileKind(entry.path) === "image")
        .map((entry) => entry.path),
    ),
    attachmentPaths: new Set(
      entries
        .filter((entry) => importFileKind(entry.path) === "attachment")
        .map((entry) => entry.path),
    ),
  };
}

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

function nodesOfType(doc: PMDoc | PMNode, type: string): PMNode[] {
  const found: PMNode[] = [];
  const visit = (node: PMNode) => {
    if (node.type === type) found.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  for (const child of doc.content ?? []) visit(child);
  return found;
}

function textOf(node: PMDoc | PMNode): string {
  if ("text" in node && node.text) return node.text;
  return (node.content ?? []).map((child) => textOf(child)).join("");
}

function linkHrefs(doc: PMDoc): string[] {
  const hrefs: string[] = [];
  const visit = (node: PMNode) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") hrefs.push(String(mark.attrs?.href));
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const child of doc.content) visit(child);
  return hrefs;
}

describe("Notion export import", () => {
  it("rebuilds the page tree from the export's folders, without Notion's ids", async () => {
    const { pages, notion } = planMarkdownPages(await readFixtureExport());

    expect(
      pages.map((page) => [page.preview.title, page.path, page.parentPath]),
    ).toEqual([
      ["Import fixture 2026", ROOT, null],
      ["Notes", NOTES, ROOT],
      ["Q&A: what/why? 100% [draft] #1", QA, ROOT],
      ["Subpage A", SUBPAGE_A, ROOT],
      ["Grandchild", GRANDCHILD, SUBPAGE_A],
      ["Notes", SUBPAGE_NOTES, SUBPAGE_A],
    ]);
    expect(notion?.databases).toEqual([
      {
        name: "Tasks",
        csvPath: TASKS_CSV,
        keptCsvPath: TASKS_ALL_CSV,
        rows: [
          "Import fixture 2026/Tasks/Review the preview 41a7b5df817a817db1b0ddfda512ddc9.md",
          "Import fixture 2026/Tasks/Ship it 41a7b5df817a817892b2cd1512aa6374.md",
          "Import fixture 2026/Tasks/Write the importer 41a7b5df817a81b0baf4dd356dc0fa83.md",
        ],
      },
    ]);
    expect(notion?.databaseFiles.has(TASKS_CSV)).toBe(true);
    expect(
      pages.some((page) => page.path.startsWith("Import fixture 2026/Tasks/")),
    ).toBe(false);
  });

  it("keeps callouts and toggles with their children, and points links at the new pages", async () => {
    const { pages } = planMarkdownPages(await readFixtureExport());
    const ids = new Map(pages.map((page, index) => [page.path, `p${index}`]));
    const stored = (path: string) =>
      finalizePlannedPage(defined(pages.find((page) => page.path === path)), {
        assetUrl: (request) =>
          request.kind === "file"
            ? `https://files.example/${encodeURI(request.path)}`
            : null,
        pageHref: (target) =>
          ids.has(target) ? `/page/${ids.get(target)}` : null,
      });

    const root = stored(ROOT);
    const callouts = nodesOfType(root.doc, "notionCallout");
    expect(callouts.map((callout) => callout.attrs?.icon)).toEqual([
      "💡",
      "💡",
    ]);
    expect(textOf(defined(callouts[0]))).toContain("Callout child paragraph.");
    expect(nodesOfType(defined(callouts[0]), "bulletList")).toHaveLength(1);
    expect(textOf(defined(callouts[1]))).toBe("A gray callout with no icon.");

    const toggle = defined(
      nodesOfType(root.doc, "listItem").find((item) =>
        textOf(item).startsWith("A toggle with children"),
      ),
    );
    expect(textOf(toggle)).toContain("Hidden paragraph inside the toggle.");
    expect(textOf(toggle)).toContain("Deep inside.");

    expect(linkHrefs(root.doc)).toEqual([
      `/page/${ids.get(SUBPAGE_A)}`,
      `/page/${ids.get(NOTES)}`,
      `/page/${ids.get(QA)}`,
      `https://files.example/${encodeURI(TASKS_ALL_CSV)}`,
      "https://example.com/page?q=1",
      `/page/${ids.get(SUBPAGE_A)}`,
      `https://files.example/${encodeURI("Import fixture 2026/spec_sheet.pdf")}`,
      "https://example.com/bookmarked",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      `/page/${ids.get(GRANDCHILD)}`,
    ]);
    expect(
      nodesOfType(root.doc, "image").map((image) => image.attrs?.src),
    ).toEqual([
      `https://files.example/${encodeURI("Import fixture 2026/teal_square.png")}`,
      "https://www.notion.so/images/page-cover/gradients_8.png",
    ]);
    expect(root.report.notes.map((note) => note.kind)).not.toContain(
      "asset-missing",
    );
    expect(root.report.notes.map((note) => note.kind)).not.toContain(
      "link-target-not-imported",
    );

    expect(linkHrefs(stored(GRANDCHILD).doc)).toEqual([
      `/page/${ids.get(ROOT)}`,
      `/page/${ids.get(SUBPAGE_A)}`,
    ]);
    expect(
      nodesOfType(stored(SUBPAGE_A).doc, "image").map(
        (image) => image.attrs?.src,
      ),
    ).toEqual([
      `https://files.example/${encodeURI("Import fixture 2026/Subpage A/orange.png")}`,
    ]);
  });

  it("asks for each file a page uses once, an image to show and others to link", async () => {
    const { pages } = planMarkdownPages(await readFixtureExport());
    const root = defined(pages.find((page) => page.path === ROOT));

    expect(
      root.uploads.flatMap((request) =>
        request.kind === "file" ? [[request.path, request.use]] : [],
      ),
    ).toEqual([
      [TASKS_ALL_CSV, "link"],
      ["Import fixture 2026/teal_square.png", "image"],
      ["Import fixture 2026/spec_sheet.pdf", "link"],
    ]);
  });

  it("names a page by its file when its text has no title", () => {
    expect(
      notionFileTitle(
        "Folder/Meeting notes 41a7b5df817a815ebd71f728dc757fb7.md",
      ),
    ).toBe("Meeting notes");
    expect(notionFileTitle("Folder/plain.md")).toBe("plain");
    const { pages } = planMarkdownPages({
      markdown: [
        {
          path: "Meeting notes 41a7b5df817a815ebd71f728dc757fb7.md",
          text: "No heading here.",
        },
      ],
      imagePaths: new Set(),
    });
    expect(defined(pages[0]).preview.title).toBe("Meeting notes");
  });

  it("reads an older export, whose subpage folders keep Notion's ids", () => {
    const id = (n: number) => `${n}`.padStart(32, "a");
    const parent = `Wiki ${id(1)}.md`;
    const child = `Wiki ${id(1)}/Child ${id(2)}.md`;
    const grandchild = `Wiki ${id(1)}/Child ${id(2)}/Leaf ${id(3)}.md`;
    expect(isNotionExport([parent])).toBe(true);
    expect(isNotionExport(["notes/plain.md"])).toBe(false);

    const { parentCandidates } = planNotionExport([parent, child, grandchild]);
    expect(parentCandidates.get(parent)).toEqual([]);
    expect(parentCandidates.get(child)).toEqual([parent]);
    expect(parentCandidates.get(grandchild)).toEqual([child]);
  });

  it("puts a subpage under the same-titled page that links to it", () => {
    const id = (n: number) => `${n}`.padStart(32, "b");
    const first = `Plans ${id(1)}.md`;
    const second = `Plans ${id(2)}.md`;
    const child = `Plans/Q3 ${id(3)}.md`;
    const { pages } = planMarkdownPages({
      markdown: [
        { path: first, text: "# Plans\n\nThe first one." },
        {
          path: second,
          text: `# Plans\n\n[Q3](Plans/Q3%20${id(3)}.md)`,
        },
        { path: child, text: "# Q3" },
      ],
      imagePaths: new Set(),
    });
    expect(pages.find((page) => page.path === child)?.parentPath).toBe(second);
  });

  it("moves the subpages of a page too large to import up to the next page", () => {
    const id = (n: number) => `${n}`.padStart(32, "c");
    const top = `Top ${id(1)}.md`;
    const huge = `Top/Huge ${id(2)}.md`;
    const leaf = `Top/Huge/Leaf ${id(3)}.md`;
    const { pages, tooLarge } = planMarkdownPages({
      markdown: [
        { path: top, text: "# Top" },
        {
          path: huge,
          text: `# Huge\n\n${"x".repeat(MAX_IMPORT_PAGE_CHARACTERS + 1)}`,
        },
        { path: leaf, text: "# Leaf" },
      ],
      imagePaths: new Set(),
    });
    expect(tooLarge).toEqual([huge]);
    expect(pages.map((page) => [page.path, page.parentPath])).toEqual([
      [top, null],
      [leaf, top],
    ]);
  });
});

describe("Notion Markdown before parsing", () => {
  it("leaves Key: value lines under a page's title on the page", () => {
    const text =
      "# Standup\n\nDate: November 3, 2026\nAttendees: Sam, Kim\n\nNotes.";
    expect(prepareNotionMarkdown(text)).toEqual({ text, notes: [] });
  });

  it("opens each callout so its first line reads as Markdown", () => {
    const prepared = prepareNotionMarkdown(
      [
        "<aside>",
        '<img src="https://www.notion.so/icons/light-bulb_yellow.svg" alt="https://www.notion.so/icons/light-bulb_yellow.svg" width="40px" />',
        "**Heads up.** Read this first.",
        "</aside>",
        "",
        "```html",
        "<aside>",
        "</aside>",
        "```",
      ].join("\r\n"),
    );

    expect(prepared.text.split("\n")).toEqual([
      "<aside>",
      "",
      "",
      "**Heads up.** Read this first.",
      "",
      "</aside>",
      "",
      "```html",
      "<aside>",
      "</aside>",
      "```",
    ]);
    expect(prepared.notes).toEqual([{ kind: "callout-icon-replaced" }]);
  });

  it("shows a bookmark's URL as its link text", () => {
    const prepared = prepareNotionMarkdown(
      [
        "[](https://example.com/a)",
        "See [](https://example.com/b) and ![](https://example.com/c.png).",
        "```",
        "[](https://example.com/d)",
        "```",
      ].join("\n"),
    );

    expect(prepared.text.split("\n")).toEqual([
      "[https://example.com/a](https://example.com/a)",
      "See [https://example.com/b](https://example.com/b) and ![](https://example.com/c.png).",
      "```",
      "[](https://example.com/d)",
      "```",
    ]);
  });
});
