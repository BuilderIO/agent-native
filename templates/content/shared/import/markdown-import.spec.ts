import { describe, expect, it } from "vitest";

import { createContentEditorStructuralSchema } from "../content-editor-structural-schema";
import { markdownWithTitle } from "../document-export";
import { docToNfm, nfmToDoc, type PMDoc, type PMNode } from "../nfm";
import { finalizeMarkdownImport, ImportContractError } from "./finalize";
import { parseMarkdownImport } from "./markdown";
import {
  LIST_INDENTS_MD,
  README_MD,
  RELEASE_NOTES_MD,
  UNTABBED_CALLOUT_NFM,
} from "./markdown-import.fixtures";
import type {
  ImportFinalizeMode,
  ImportedPage,
  ImportResolvers,
} from "./types";

const editorSchema = createContentEditorStructuralSchema();

function importMarkdown(
  text: string,
  options: {
    sourcePath?: string;
    resolvers?: ImportResolvers;
    mode?: ImportFinalizeMode;
  } = {},
): ImportedPage {
  const draft = parseMarkdownImport({
    sourcePath: options.sourcePath ?? "notes/page.md",
    text,
  });
  return finalizeMarkdownImport(
    draft,
    options.resolvers ?? {},
    options.mode ?? "apply",
  );
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

function noteKinds(page: ImportedPage): string[] {
  return page.report.notes.map((note) => note.kind);
}

function expectEditorAccepts(page: ImportedPage) {
  expect(() =>
    editorSchema.nodeFromJSON(page.doc as never).check(),
  ).not.toThrow();
}

describe("Markdown import", () => {
  it("imports an ordinary Markdown file with its structure, title, and named losses", () => {
    const page = importMarkdown(RELEASE_NOTES_MD, {
      sourcePath: "release/release-notes.md",
      resolvers: {
        asset: (request) =>
          request.kind === "file" &&
          request.path === "release/images/architecture.png"
            ? {
                status: "resolved",
                url: "https://files.example/architecture.png",
              }
            : { status: "missing" },
      },
    });

    expect(page.title).toBe("Release notes 2.4");
    expect(page.titleSource).toBe("frontmatter");
    expect(
      nodesOfType(page.doc, "heading").filter(
        (heading) => heading.attrs?.level === 1,
      ),
    ).toHaveLength(0);

    const [highlights] = nodesOfType(page.doc, "orderedList");
    const nested = nodesOfType(highlights.content![0], "bulletList");
    expect(nested.map(textOf)).toEqual([
      "Up to 3x on large foldersFewer retries",
    ]);
    expect(
      nodesOfType(page.doc, "taskItem").map((item) => item.attrs?.checked),
    ).toEqual([true, false]);

    const [table] = nodesOfType(page.doc, "table");
    expect(table.content).toHaveLength(4);
    expect(
      table.content![0].content!.map((cell) => [
        cell.type,
        cell.attrs?.textAlign,
      ]),
    ).toEqual([
      ["tableHeader", "left"],
      ["tableHeader", "center"],
      ["tableHeader", "right"],
    ]);

    expect(
      nodesOfType(page.doc, "codeBlock").map((block) => block.attrs?.language),
    ).toEqual(["mermaid", "ts"]);
    expect(
      nodesOfType(page.doc, "image").map((image) => image.attrs?.src),
    ).toEqual([
      "https://files.example/architecture.png",
      "https://example.com/static/logo.png",
    ]);
    expect(
      nodesOfType(page.doc, "notionInlineAtom").map(
        (atom) => atom.attrs?.label,
      ),
    ).toEqual(["O(n \\log n)"]);
    expect(nodesOfType(page.doc, "notionBlockAtom")).toHaveLength(1);

    const keys = nodesOfType(page.doc, "text").filter((node) =>
      node.marks?.some((mark) => mark.type === "code"),
    );
    expect(keys.map((node) => node.text)).toEqual(
      expect.arrayContaining(["Ctrl", "S"]),
    );

    const [toggle] = nodesOfType(page.doc, "notionToggle");
    expect(toggle.attrs?.summary).toBe("Known issues");
    expect(textOf(toggle)).toBe("Large PDFs export slowly.");

    expect(page.content).toContain("Press `Ctrl`+`S` to save.\\[1\\]");
    expect(page.content.endsWith("---\n1. Saving also triggers a sync.")).toBe(
      true,
    );
    expect(nodesOfType(page.doc, "horizontalRule")).toHaveLength(1);

    expect(page.frontmatter.unmapped).toEqual({
      tags: ["release", "changelog"],
      author: "Sam Example",
    });
    expect(page.report.coverage.missingCharacters).toBe(0);
    expect(noteKinds(page)).toEqual([
      "image-title-dropped",
      "frontmatter-not-shown",
      "footnotes-moved-to-end",
      "html-formatting-converted",
    ]);
    expect(page.report.status).toBe("lost");
    expectEditorAccepts(page);
  });

  it("nests every list indentation style editors write", () => {
    const page = importMarkdown(LIST_INDENTS_MD);

    expect(page.content).toBe(
      [
        "- two-space parent",
        "\t- two-space child",
        "\t\t- two-space grandchild",
        "- four-space parent",
        "\t- four-space child",
        "- tab parent",
        "\t- tab child",
        "1. ordered parent",
        "\t1. three-space ordered child",
        "- [ ] task parent",
        "\t- [x] task child",
      ].join("\n"),
    );
    expect(page.report.status).toBe("preserved");
    expectEditorAccepts(page);
  });

  it("takes the title from the first heading, or the file name, without duplicating it", () => {
    const fromHeading = importMarkdown("# Weekly sync\n\nNotes");
    expect([fromHeading.title, fromHeading.titleSource]).toEqual([
      "Weekly sync",
      "heading",
    ]);
    expect(fromHeading.content).toBe("Notes");

    const fromFile = importMarkdown("Notes", {
      sourcePath: "notes/q3-planning_notes.md",
    });
    expect([fromFile.title, fromFile.titleSource]).toEqual([
      "Q3 planning notes",
      "filename",
    ]);

    const differentHeading = importMarkdown(
      "---\ntitle: Roadmap\n---\n# Goals\n\nShip it",
    );
    expect(differentHeading.title).toBe("Roadmap");
    expect(differentHeading.content).toBe("# Goals\nShip it");

    const laterHeading = importMarkdown("Intro\n\n# Section", {
      sourcePath: "notes/draft.md",
    });
    expect(laterHeading.title).toBe("Draft");
    expect(laterHeading.content).toBe("Intro\n# Section");
  });

  it("leaves a missing image as a block the reader can fill, and reports it", () => {
    const page = importMarkdown("![Diagram](./diagram.png)");

    expect(nodesOfType(page.doc, "image").map((image) => image.attrs)).toEqual([
      expect.objectContaining({ src: "", alt: "Diagram" }),
    ]);
    expect(page.report.notes).toEqual([
      expect.objectContaining({
        kind: "asset-missing",
        severity: "lost",
        samples: ["notes/diagram.png"],
      }),
    ]);
    expect(page.report.status).toBe("lost");
  });

  it("hands embedded images to the uploader and never reports their bytes", () => {
    const payload =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
    const markdown = `![Pixel](data:image/png;base64,${payload})`;
    const requests: string[] = [];
    const page = importMarkdown(markdown, {
      resolvers: {
        asset: (request) => {
          requests.push(request.kind === "data-url" ? request.mediaType : "");
          return { status: "resolved", url: "https://files.example/pixel.png" };
        },
      },
    });

    expect(requests).toEqual(["image/png"]);
    expect(page.content).toBe("![Pixel](https://files.example/pixel.png)");
    expect(page.assets).toEqual([
      { reference: "image/png (1 KB, embedded)", status: "resolved" },
    ]);
    expect(JSON.stringify(page.report)).not.toContain(payload);

    const unresolved = importMarkdown(markdown);
    expect(unresolved.content).not.toContain("data:");
    expect(JSON.stringify(unresolved.report)).not.toContain(payload);
    expect(noteKinds(unresolved)).toEqual(["asset-missing"]);
  });

  it("refuses to apply an import whose files were never uploaded", () => {
    const resolvers: ImportResolvers = {
      asset: () => ({ status: "available" }),
    };
    expect(() =>
      importMarkdown("![Chart](chart.png)", { resolvers, mode: "apply" }),
    ).toThrow(ImportContractError);

    const preview = importMarkdown("![Chart](chart.png)", {
      resolvers,
      mode: "preview",
    });
    expect(preview.assets).toEqual([
      { reference: "chart.png", status: "available" },
    ]);
    expect(noteKinds(preview)).toEqual([]);
  });

  it("points links at imported pages and names links it cannot keep", () => {
    const page = importMarkdown(README_MD, {
      sourcePath: "repo/README.md",
      resolvers: {
        link: (path) =>
          path === "repo/docs/setup.md" ? "/page/setup123" : null,
      },
    });

    const hrefs = nodesOfType(page.doc, "text").flatMap((node) =>
      (node.marks ?? [])
        .filter((mark) => mark.type === "link")
        .map((mark) => [node.text, mark.attrs?.href]),
    );
    expect(hrefs).toEqual([
      ["setup guide", "/page/setup123"],
      ["the API", "../outside/api.md"],
      ["an anchor", "#usage"],
      ["Reference link", "https://example.com/docs"],
    ]);
    expect(page.content).toContain("and a script.");
    expect(page.content).toContain("\\[missing reference\\]\\[nowhere\\]");

    const notes = Object.fromEntries(
      page.report.notes.map((note) => [note.kind, note.samples]),
    );
    expect(notes["link-target-not-imported"]).toEqual(["outside/api.md"]);
    expect(notes["link-removed"]).toEqual([
      "https://ci.example.com/runs",
      "javascript:alert(1)",
    ]);
    expect(notes["link-title-dropped"]).toEqual(["Docs home"]);
  });

  it("resolves references only inside the import root", () => {
    const requested: string[] = [];
    const resolvers: ImportResolvers = {
      asset: (request) => {
        if (request.kind === "file") requested.push(request.path);
        return { status: "resolved", url: "https://files.example/chart.png" };
      },
      link: (path) => {
        requested.push(path);
        return "/page/api123";
      },
    };
    const source = "![Chart](chart.png)\n\nSee [the API](api.md).";

    const outside = importMarkdown(source, {
      sourcePath: "../private/page.md",
      resolvers,
    });
    expect(requested).toEqual([]);
    expect(noteKinds(outside)).toEqual([
      "asset-missing",
      "link-target-not-imported",
    ]);

    importMarkdown(source, { sourcePath: "notes/../page.md", resolvers });
    expect(requested).toEqual(["chart.png", "api.md"]);
  });

  it("keeps README HTML readable and names what it flattened", () => {
    const page = importMarkdown(README_MD, {
      sourcePath: "repo/README.md",
      resolvers: {
        asset: (request) =>
          request.kind === "file" && request.path === "repo/logo.svg"
            ? { status: "resolved", url: "https://files.example/logo.svg" }
            : { status: "missing" },
      },
    });

    expect(page.content.split("\n").slice(0, 3)).toEqual([
      "![Project logo](https://files.example/logo.svg)",
      "**Fast** builds for every team",
      "![Build status](https://ci.example.com/badge.svg)",
    ]);
    const [callout] = nodesOfType(page.doc, "notionCallout");
    expect(callout.attrs).toEqual(
      expect.objectContaining({ icon: "⚠️", color: "yellow_bg" }),
    );
    expect(textOf(callout)).toBe("Version 1 is no longer supported.");

    const highlighted = nodesOfType(page.doc, "text").find(
      (node) => node.text === "highlighted",
    );
    expect(highlighted?.marks).toEqual([
      expect.objectContaining({
        type: "notionSpan",
        attrs: expect.objectContaining({ bgColor: "yellow_bg" }),
      }),
    ]);
    expect(nodesOfType(page.doc, "hardBreak")).toHaveLength(1);

    const notes = Object.fromEntries(
      page.report.notes.map((note) => [note.kind, note.samples]),
    );
    expect(notes["hidden-html-dropped"]).toEqual(["<!-- prettier-ignore -->"]);
    expect(notes["html-block-flattened"]).toEqual(["<sup>"]);
    expect(notes["github-alert-to-callout"]).toEqual(["warning"]);
    expect(notes["inline-image-moved-to-own-line"]).toEqual(["Project logo"]);
    expect(page.report.coverage.missingCharacters).toBe(0);
    expectEditorAccepts(page);
  });

  it("reads dollar amounts as text and math as math", () => {
    const page = importMarkdown(
      "Plans cost $5 and $10 per month; the identity is $e^{i\\pi} + 1 = 0$.",
    );

    expect(
      nodesOfType(page.doc, "notionInlineAtom").map(
        (atom) => atom.attrs?.label,
      ),
    ).toEqual(["e^{i\\pi} + 1 = 0"]);
    expect(textOf(page.doc)).toContain("Plans cost $5 and $10 per month");
  });

  it("round-trips a Content Markdown export", () => {
    const stored = docToNfm(
      nfmToDoc(
        [
          '<callout icon="💡" color="blue_bg">',
          "\tCallout body with **bold**",
          "</callout>",
          '## Heading {color="red"}',
          "- item",
          "\t- nested",
          "<details>",
          "<summary>Toggle</summary>",
          "\tToggle child",
          "</details>",
          "<columns>",
          "\t<column>",
          "\t\tLeft",
          "\t</column>",
          "\t<column>",
          "\t\tRight",
          "\t</column>",
          "</columns>",
          "<empty-block/>",
          'Paragraph with <span color="blue">color</span> and $x^2$.',
        ].join("\n"),
      ),
    );

    const page = importMarkdown(markdownWithTitle("Launch plan", stored), {
      sourcePath: "launch-plan.md",
    });

    expect(page.dialect).toBe("nfm");
    expect([page.title, page.titleSource]).toEqual(["Launch plan", "heading"]);
    expect(page.content).toBe(stored);
    expect(page.report.status).toBe("preserved");
    expect(page.report.notes).toEqual([]);
  });

  it("drops the same links from Content Markdown as from other Markdown", () => {
    const page = importMarkdown(
      [
        '<callout icon="💡" color="blue_bg">',
        "\t[Run me](javascript:alert(1)) and [notes](data:text/plain,SECRET)",
        "</callout>",
        "[Docs](https://example.com/docs) and [API](../api.md)",
      ].join("\n"),
      { sourcePath: "launch-plan.md" },
    );

    expect(page.dialect).toBe("nfm");
    const hrefs = nodesOfType(page.doc, "text").flatMap((node) =>
      (node.marks ?? [])
        .filter((mark) => mark.type === "link")
        .map((mark) => [node.text, mark.attrs?.href]),
    );
    expect(hrefs).toEqual([
      ["Docs", "https://example.com/docs"],
      ["API", "../api.md"],
    ]);
    expect(textOf(nodesOfType(page.doc, "notionCallout")[0])).toBe(
      "Run me and notes",
    );
    const notes = Object.fromEntries(
      page.report.notes.map((note) => [note.kind, note.samples]),
    );
    expect(notes["link-removed"]).toEqual([
      "javascript:alert(1)",
      "text/plain (1 KB, embedded)",
    ]);
    expect(notes["link-target-not-imported"]).toEqual(["../api.md"]);
    expect(JSON.stringify(page.report)).not.toContain("SECRET");
    expectEditorAccepts(page);
  });

  it("indents an untabbed NFM container body instead of dropping it", () => {
    const page = importMarkdown(UNTABBED_CALLOUT_NFM);

    expect(page.dialect).toBe("nfm");
    expect(textOf(nodesOfType(page.doc, "notionCallout")[0])).toBe(
      "Remember to tab-indent callout bodies.",
    );
    expect(textOf(nodesOfType(page.doc, "notionToggle")[0])).toBe(
      "Hidden detail",
    );
    expect(page.report.status).toBe("preserved");
  });

  it("stops indenting untabbed NFM containers past a bounded depth", () => {
    const source = `${"<callout>\n".repeat(2000)}Deep body\n${"</callout>\n".repeat(2000)}`;
    const page = importMarkdown(source);

    expect(page.dialect).toBe("nfm");
    expect(page.content.length).toBeLessThan(source.length);
    expect(noteKinds(page)).toEqual(
      expect.arrayContaining(["unsupported-markdown", "text-not-landed"]),
    );
  });

  it.each([
    ["with no title", "Visible words"],
    [
      "whose frontmatter title and description hold the same words",
      "---\ntitle: Phantom paragraph\ndescription: A phantom paragraph\n---\nVisible words",
    ],
  ])("names source text that never reached a page %s", (_, text) => {
    const draft = parseMarkdownImport({ sourcePath: "notes/page.md", text });
    if (draft.coverage.kind !== "markdown")
      throw new Error("expected Markdown");
    const page = finalizeMarkdownImport(
      {
        ...draft,
        coverage: {
          ...draft.coverage,
          visible: [...draft.coverage.visible, "phantom paragraph"],
        },
      },
      {},
      "apply",
    );

    expect(page.report.coverage.missingCharacters).toBeGreaterThan(0);
    expect(page.report.notes).toEqual([
      expect.objectContaining({
        kind: "text-not-landed",
        samples: ["phantom, paragraph"],
      }),
    ]);
    expect(page.report.status).toBe("lost");
  });

  it("keeps frontmatter it cannot place with the import record", () => {
    const mapped = importMarkdown(
      "---\ntitle: Garden\ndescription: Planting notes\nicon: 🌱\nseason: spring\n---\nBody",
    );
    expect([mapped.title, mapped.description, mapped.icon]).toEqual([
      "Garden",
      "Planting notes",
      "🌱",
    ]);
    expect(mapped.frontmatter).toEqual({
      unmapped: { season: "spring" },
      unreadable: null,
    });
    expect(mapped.report.status).toBe("converted");

    const unreadable = importMarkdown("---\ntitle: [unclosed\n---\nBody", {
      sourcePath: "notes/broken.md",
    });
    expect(unreadable.title).toBe("Broken");
    expect(unreadable.frontmatter.unreadable).toBe("title: [unclosed");
    expect(noteKinds(unreadable)).toEqual(["frontmatter-unreadable"]);
    expect(unreadable.content).toBe("Body");
  });

  it("keeps frontmatter whose aliases loop as unreadable", () => {
    const raw = "loop: &loop\n  name: Garden\n  self: *loop";
    const page = importMarkdown(`---\n${raw}\n---\nBody`);

    expect(page.frontmatter).toEqual({ unmapped: null, unreadable: raw });
    expect(noteKinds(page)).toEqual(["frontmatter-unreadable"]);
    expect(JSON.stringify(page.report)).not.toContain("Garden");
    expect(page.content).toBe("Body");
  });

  it("numbers footnotes in reading order, including ones cited by a footnote", () => {
    const page = importMarkdown(
      [
        "First.[^b] Second.[^a]",
        "",
        "[^a]: Alpha cites.[^c]",
        "[^b]: Beta.",
        "[^c]: Gamma.",
        "[^d]: Unused.",
      ].join("\n"),
    );

    expect(page.content).toBe(
      [
        "First.\\[1\\] Second.\\[2\\]",
        "---",
        "1. Beta.",
        "2. Alpha cites.\\[3\\]",
        "3. Gamma.",
        "4. Unused.",
      ].join("\n"),
    );
  });

  it("keeps a footnote reference with no definition as written", () => {
    const page = importMarkdown("A claim.[^missing]");

    expect(page.content).toBe("A claim.\\[\\^missing\\]");
    expect(page.report.status).toBe("preserved");
  });

  it("removes a link or image whose scheme hides behind a control character", () => {
    const page = importMarkdown(
      [
        "[tab](<java\tscript:alert(1)>)",
        "[climb](<java\tscript:alert(1)//../../..>)",
        "[entity](java&#9;script:alert(1))",
        '<a href="&#1;javascript:alert(1)">leading</a>',
        "![image](<java\tscript:alert(1)>)",
      ].join("\n\n"),
    );

    const hrefs = nodesOfType(page.doc, "text").flatMap((node) =>
      (node.marks ?? [])
        .filter((mark) => mark.type === "link")
        .map((mark) => mark.attrs?.href),
    );
    expect(hrefs).toEqual([]);
    expect(nodesOfType(page.doc, "image")[0]?.attrs?.src).toBe("");
    expect(page.content).not.toMatch(/script:/);
    expect(noteKinds(page)).toEqual(
      expect.arrayContaining(["link-removed", "asset-missing"]),
    );
  });

  it("keeps source text that reads like an import placeholder", () => {
    const page = importMarkdown(
      "Write `agent-native-import-reference:0` or agent-native-import-reference:1.\n\n![Chart](chart.png)",
      {
        resolvers: {
          asset: () => ({
            status: "resolved",
            url: "https://files.example/chart.png",
          }),
        },
      },
    );

    expect(page.content).toContain("`agent-native-import-reference:0`");
    expect(page.content).toContain("agent-native-import-reference:1.");
    expect(nodesOfType(page.doc, "image")[0]?.attrs?.src).toBe(
      "https://files.example/chart.png",
    );
  });

  it("keeps text written right after a closing details tag", () => {
    const page = importMarkdown(
      [
        "<details><summary>One</summary>Inside one</details>",
        "After one",
        "",
        "<details>",
        "<summary>Two</summary>",
        "",
        "Inside two",
        "",
        "</details>",
        "<details><summary>Three</summary>",
        "",
        "Inside three",
        "",
        "</details>",
        "After three",
      ].join("\n"),
    );

    expect(
      page.doc.content.map((node) =>
        node.type === "notionToggle"
          ? `${node.attrs?.summary}: ${textOf(node)}`
          : textOf(node),
      ),
    ).toEqual([
      "One: Inside one",
      "After one",
      "Two: Inside two",
      "Three: Inside three",
      "After three",
    ]);
    expect(noteKinds(page)).not.toContain("text-not-landed");
  });

  it("reports a table instead of padding it into far more cells than it holds", () => {
    const wideRow = `| ${Array.from({ length: 400 }, (_, index) => `c${index}`).join(" | ")} |`;
    const page = importMarkdown(
      [
        "| a |",
        "| - |",
        wideRow,
        ...Array.from({ length: 300 }, () => "| x |"),
      ].join("\n"),
    );

    expect(nodesOfType(page.doc, "table")).toEqual([]);
    expect(noteKinds(page)).toContain("unsupported-markdown");
    expect(noteKinds(page)).not.toContain("text-not-landed");

    const ragged = importMarkdown("| a | b |\n| - | - |\n| 1 |\n| 2 | 3 | 4 |");
    expect(
      nodesOfType(ragged.doc, "tableRow").map(
        (row) => row.content?.length ?? 0,
      ),
    ).toEqual([3, 3, 3]);

    // Each table pads 39,999 cells; the budget is for the whole file.
    const paddedTable = [
      "| a |",
      "| - |",
      `| ${Array.from({ length: 200 }, (_, index) => `c${index}`).join(" | ")} |`,
      ...Array.from({ length: 200 }, () => "| x |"),
    ].join("\n");
    const many = importMarkdown(
      [paddedTable, paddedTable, paddedTable].join("\n\nBetween\n\n"),
    );
    expect(nodesOfType(many.doc, "table")).toHaveLength(2);
    expect(noteKinds(many)).toContain("unsupported-markdown");
  });

  it("keeps an image out of a table cell, since stored tables hold none", () => {
    const requested: string[] = [];
    const page = importMarkdown(
      "| Logo | Name |\n| - | - |\n| ![Acme logo](logo.png) | Acme |",
      {
        resolvers: {
          asset: (request) => {
            requested.push(request.reference);
            return { status: "resolved", url: "https://files.example/l.png" };
          },
        },
      },
    );

    expect(requested).toEqual([]);
    expect(nodesOfType(page.doc, "image")).toEqual([]);
    expect(textOf(nodesOfType(page.doc, "tableCell")[0]!)).toBe("Acme logo");
    expect(noteKinds(page)).toContain("unsupported-markdown");
    expect(noteKinds(page)).not.toContain("structure-changed-on-save");
  });

  it("names a link around an HTML image and embedded media it can't keep", () => {
    const page = importMarkdown(
      [
        '<p align="center"><a href="https://example.com"><img src="https://example.com/logo.png" alt="Logo"></a></p>',
        'Demo: <video src="https://example.com/demo.mp4" controls/>',
        '<iframe src="https://example.com/embed">Watch the demo</iframe>',
      ].join("\n\n"),
    );

    const notes = Object.fromEntries(
      page.report.notes.map((note) => [note.kind, note.samples]),
    );
    expect(notes["link-removed"]).toEqual(["https://example.com"]);
    expect(notes["unsupported-markdown"]).toEqual(["<video>", "<iframe>"]);
    expect(page.report.status).toBe("lost");
    expect(page.content).toContain("Watch the demo");
  });

  it("keeps text after a script whose body looks like markup", () => {
    const page = importMarkdown(
      '<div><script>var s = "<style>"; // <!--</script>Visible after</div>',
    );

    expect(page.content).toContain("Visible after");
    expect(page.content).not.toContain("var s");
    expect(noteKinds(page)).not.toContain("text-not-landed");
  });

  it("checks the urls of Content Markdown files, bookmarks, and embeds", () => {
    const page = importMarkdown(
      [
        "<empty-block/>",
        '<file src="data:application/pdf;base64,JVBERi0xLjQK"></file>',
        '<pdf src="./spec.pdf"></pdf>',
        '<bookmark url="javascript:alert(1)"></bookmark>',
        '<embed url="https://example.com/embed"></embed>',
      ].join("\n"),
    );

    expect(page.dialect).toBe("nfm");
    expect(page.content).not.toContain("base64");
    expect(page.content).not.toContain("javascript:");
    expect(page.content).toContain("./spec.pdf");
    expect(page.content).toContain("https://example.com/embed");
    const notes = Object.fromEntries(
      page.report.notes.map((note) => [note.kind, note.samples]),
    );
    expect(notes["unsupported-markdown"]).toEqual([
      expect.stringMatching(/^application\/pdf/),
    ]);
    expect(notes["link-removed"]).toEqual(["javascript:alert(1)"]);
    expect(notes["link-target-not-imported"]).toEqual(["./spec.pdf"]);
  });

  it.each([
    ["block quotes", `${"> ".repeat(5000)}deep`],
    ["lists", `${"- ".repeat(5000)}deep`],
    [
      "lists continued across lines",
      `${"- ".repeat(40)}a\n${"  ".repeat(40)}${"- ".repeat(40)}deep`,
    ],
  ])("reports %s nested past the limit instead of overflowing", (_, nested) => {
    const page = importMarkdown(`Before\n\n${nested}\n\nAfter`);

    expect(noteKinds(page)).toContain("unsupported-markdown");
    expect(noteKinds(page)).not.toContain("text-not-landed");
    expect(page.content).toContain("Before");
    expect(page.content).toContain("After");
  });

  it("reports HTML elements nested past the limit and keeps their text", () => {
    const page = importMarkdown(`<div>
${"<span>".repeat(70)}deep
</div>`);

    expect(noteKinds(page)).toContain("unsupported-markdown");
    expect(page.content).toContain("deep");
  });

  it("reports Content Markdown nested past the limit instead of overflowing", () => {
    const nested = Array.from(
      { length: 700 },
      (_, depth) => `${"\t".repeat(depth)}- level ${depth}`,
    ).join("\n");
    const page = importMarkdown(`<empty-block/>\nBefore\n${nested}\nAfter`);

    expect(page.dialect).toBe("nfm");
    expect(noteKinds(page)).toContain("unsupported-markdown");
    expect(noteKinds(page)).not.toContain("text-not-landed");
    expect(page.content).toContain("level 64");
    expect(page.content).not.toContain("level 65");
    expect(page.content).toContain("After");
  });

  it("drops the body of a hidden element written inside a paragraph", () => {
    const page = importMarkdown(
      "Visible <script>secret()</script> and <style>.x { color: red }</style>shown",
    );

    expect(textOf(page.doc)).toBe("Visible  and shown");
    expect(noteKinds(page)).toContain("hidden-html-dropped");
    expect(noteKinds(page)).not.toContain("text-not-landed");
  });

  it("reads Content's colored text without reading the file as Content Markdown", () => {
    const page = importMarkdown(
      [
        'Some <span color="red">warm</span> text.',
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
      ].join("\n"),
    );

    expect(page.dialect).toBe("markdown");
    expect(nodesOfType(page.doc, "table")).toHaveLength(1);
    expect(
      nodesOfType(page.doc, "text").find((node) => node.text === "warm")?.marks,
    ).toEqual([
      {
        type: "notionSpan",
        attrs: expect.objectContaining({ color: "red" }),
      },
    ]);
    expect(page.report.notes).toEqual([]);
  });

  it("ignores a closing details tag inside a comment or script", () => {
    const page = importMarkdown(
      [
        "<details><summary>One</summary>",
        "<!-- </details> -->",
        "<script>const tag = '</details>';</script>",
        "Inside one",
        "</details>",
        "",
        "After",
      ].join("\n"),
    );

    expect(
      page.doc.content.map((node) =>
        node.type === "notionToggle"
          ? `${node.attrs?.summary}: ${textOf(node).trim()}`
          : textOf(node),
      ),
    ).toEqual(["One: Inside one", "After"]);
  });

  it.each([
    ["nested emphasis", `${"*a ".repeat(3000)}b${" a*".repeat(3000)}`],
    ["unmatched link brackets", "a]".repeat(20000)],
  ])("reads a paragraph with too many %s as plain text", (_, paragraph) => {
    const page = importMarkdown(`Before *kept*\n\n${paragraph}\n\nAfter`);

    expect(noteKinds(page)).toContain("unsupported-markdown");
    expect(noteKinds(page)).not.toContain("text-not-landed");
    expect(textOf(page.doc)).toContain(paragraph.slice(0, 60));
    expect(
      nodesOfType(page.doc, "text").find((node) => node.text === "kept")?.marks,
    ).toEqual([{ type: "italic" }]);
    expect(page.content).toContain("After");
  });

  it("finds closing tags after text that lengthens when lowercased", () => {
    const dotted = "İ".repeat(12);
    const page = importMarkdown(
      [
        `<div><script>"${dotted}"</script>Visible after</div>`,
        "",
        `<details><summary>${dotted}</summary>Inside</details>`,
      ].join("\n"),
    );

    expect(page.content).toContain("Visible after");
    const [toggle] = nodesOfType(page.doc, "notionToggle");
    expect([toggle?.attrs?.summary, textOf(toggle).trim()]).toEqual([
      dotted,
      "Inside",
    ]);
    expect(noteKinds(page)).not.toContain("text-not-landed");
  });

  it("keeps a __proto__ frontmatter key with the import record", () => {
    const page = importMarkdown('---\n"__proto__": kept\n---\nBody');

    expect(Object.entries(page.frontmatter.unmapped ?? {})).toEqual([
      ["__proto__", "kept"],
    ]);
  });
});
