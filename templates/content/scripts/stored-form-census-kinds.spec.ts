import { describe, expect, it } from "vitest";

import { canonicalizeNfm } from "../shared/nfm";
import {
  canonicalizationLosses,
  canonicalizerFingerprint,
  classifyBody,
  diffLineHunks,
  explainHunk,
  withinEmphasisLimit,
  withinParserLimits,
} from "./stored-form-census-kinds";

const L = (...lines: string[]) => lines.join("\n");

describe("line hunks", () => {
  it("aligns unchanged lines and groups each change", () => {
    expect(
      diffLineHunks(["a", "b", "c", "d"], ["a", "B", "c", "d", "e"]),
    ).toEqual([
      { removed: ["b"], added: ["B"] },
      { removed: [], added: ["e"] },
    ]);
    expect(diffLineHunks(["same"], ["same"])).toEqual([]);
  });
});

describe("difference kinds", () => {
  it("explains a hunk with the fewest kinds that account for it", () => {
    expect(
      explainHunk({ removed: ["snake\\_case  "], added: ["snake_case"] }),
    ).toEqual(["trailing-whitespace", "backslash-escapes"]);
    expect(explainHunk({ removed: ["* item"], added: ["- item"] })).toEqual([
      "list-markers",
    ]);
    expect(explainHunk({ removed: ["___"], added: ["---"] })).toEqual([
      "thematic-break",
    ]);
    expect(explainHunk({ removed: [""], added: [] })).toEqual(["blank-lines"]);
    expect(
      explainHunk({
        removed: ["~~~js", "~~~"],
        added: ["\\~\\~\\~js", "\\~\\~\\~"],
      }),
    ).toEqual(["backslash-escapes"]);
    expect(
      explainHunk({ removed: ["| a |b|", "|---|---|"], added: ["<table>"] }),
    ).toEqual(["gfm-pipe-table-to-content-table"]);
    expect(
      explainHunk({
        removed: ["* item", "| a |b|", "|---|---|", "___"],
        added: ["- item", "<table>", "<tr>", "</table>", "---"],
      }),
    ).toEqual([
      "gfm-pipe-table-to-content-table",
      "thematic-break",
      "list-markers",
    ]);
    expect(
      explainHunk({ removed: ["completely"], added: ["different"] }),
    ).toEqual(["unclassified"]);
  });
});

describe("body classification", () => {
  it("leaves a canonical body alone", () => {
    const body = canonicalizeNfm("A plain paragraph");
    expect(classifyBody(body)).toEqual({ status: "canonical", losses: [] });
  });

  it("sees CRLF line endings as their own kind without calling them lossy", () => {
    const result = classifyBody("Line one\r\nLine two");
    expect(result.status).toBe("non-canonical");
    if (result.status !== "non-canonical") return;
    expect(result.kinds).toContain("line-endings");
    expect(result.losses).toEqual([]);
  });

  it("counts a GFM pipe table becoming a content table as a conversion, not a loss", () => {
    const result = classifyBody("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(result.status).toBe("non-canonical");
    if (result.status !== "non-canonical") return;
    expect(result.kinds).toEqual(["gfm-pipe-table-to-content-table"]);
    expect(result.losses).toEqual([]);
  });

  it("sees an escape Content keeps as a visible backslash", () => {
    const result = classifyBody("snake\\_case word");
    expect(result.status).toBe("non-canonical");
    if (result.status !== "non-canonical") return;
    expect(result.kinds).toEqual(["escape-kept-as-backslash"]);
    expect(result.losses).toEqual(["gfm-escape-shown-literally"]);

    const mixed = classifyBody("Uses snake\\_case and costs $60");
    expect(mixed.status === "non-canonical" && mixed.kinds).toEqual([
      "backslash-escapes",
      "escape-kept-as-backslash",
    ]);
  });

  it("flags agent formatting Content misreads even when the bytes are canonical", () => {
    expect(classifyBody("__bold__ text")).toEqual({
      status: "canonical",
      losses: ["gfm-strong-dropped"],
    });
    expect(classifyBody(L("- a", "    - child", "- b"))).toEqual({
      status: "canonical",
      losses: ["gfm-list-nesting-lost", "gfm-list-items-lost"],
    });
    for (const heading of [L("Heading", "======="), L("Heading", "--")]) {
      expect(classifyBody(heading), heading).toEqual({
        status: "canonical",
        losses: ["gfm-headings-lost"],
      });
    }
    // Content keeps the indent as text in a paragraph.
    expect(classifyBody("    code line")).toEqual({
      status: "canonical",
      losses: ["gfm-code-blocks-lost"],
    });
    // One run of bold to GFM, half of which Content shows as underscores.
    expect(classifyBody("**kept**__lost__")).toEqual({
      status: "canonical",
      losses: ["gfm-strong-dropped"],
    });
    // The same amount of italic, on different text: b to GFM, "a " to Content,
    // and with repeated letters, the second a to GFM and the first to Content.
    for (const moved of ["*a * _b_", "*a * _a_"]) {
      expect(classifyBody(moved), moved).toEqual({
        status: "canonical",
        losses: ["gfm-emphasis-dropped"],
      });
    }
    // A toggle's summary is plain text, so its asterisks show.
    expect(classifyBody(L('## **Toggle** {toggle="true"}', "\tChild"))).toEqual(
      { status: "canonical", losses: ["gfm-strong-dropped"] },
    );
  });

  it("flags formatting canonicalizing removes", () => {
    const result = classifyBody(L("~~~js", "code", "~~~"));
    expect(result.status).toBe("non-canonical");
    if (result.status !== "non-canonical") return;
    expect(result.losses).toContain("gfm-code-blocks-lost");
    // Content writes `---` under a paragraph as a divider; a longer underline
    // is a heading to GFM, which canonicalizing turns into one.
    expect(classifyBody(L("Title", "-----"))).toMatchObject({
      status: "non-canonical",
      losses: ["gfm-headings-lost"],
    });
    expect(
      classifyBody(L("Intro", "", "    const x = 1;", "    const y = 2;")),
    ).toMatchObject({
      status: "non-canonical",
      losses: ["gfm-code-blocks-lost"],
    });
    // A fenced block inside a quote is lost, but its contents are still code.
    expect(
      classifyBody(L("> ```html", '> <a href="C:\\temp">x</a>', "> ```")),
    ).toMatchObject({ losses: ["gfm-code-blocks-lost"] });
    // A container marker inside a fence is code, not the fence's end.
    for (const marker of ["- ", "> ", "1. "]) {
      expect(
        classifyBody(
          L("```html", `${marker}\`\`\``, '<a href="C:\\temp">', "```"),
        ),
      ).toMatchObject({ status: "non-canonical", losses: [] });
    }
    expect(canonicalizationLosses("Keep every word", "Keep word")).toContain(
      "gfm-text-dropped",
    );
    // A link's address is not text anyone reads, so it cannot stand in for a
    // dropped word.
    expect(
      canonicalizationLosses(
        "alpha beta",
        "alpha [x](https://example.com/beta)",
      ),
    ).toContain("gfm-text-dropped");
    // Nor can an atom's serialized settings or a raw block's tag.
    for (const block of [
      '<bookmark url="https://example.com/beta">Site</bookmark>',
      '<ContentReference sourcePath="../symbols/beta.builder.mdx" title="Docs Tip" />',
    ]) {
      expect(
        canonicalizationLosses(
          L("alpha beta", "", block),
          L("alpha", "", block),
        ),
        block,
      ).toContain("gfm-text-dropped");
    }
  });

  it("classifies a line of list or quote markers in linear time", () => {
    // A pattern that let two parts share the blanks after a marker retried
    // every split of every run: twenty markers took over a minute.
    for (const marker of ["-   ", "1.   ", ">  ", "> -  "]) {
      const line = `${marker.repeat(28)}x`;
      expect(["canonical", "non-canonical"], marker).toContain(
        classifyBody(line).status,
      );
    }
  });

  it("refuses a body whose canonical form is past the parser limits", () => {
    // Canonicalizing escapes each `<`, doubling the line past its cap.
    expect(classifyBody(`x ${"<".repeat(20_000)}`)).toEqual({
      status: "pastParserLimits",
    });
    expect(classifyBody(`x ${"<".repeat(10_000)}`).status).toBe(
      "non-canonical",
    );
  });

  it("does not flag Content's own syntax as lost agent text", () => {
    for (const body of [
      'Colored paragraph {color="red"}',
      L('## Toggle {toggle="true"}', "\tChild under toggle"),
      L(
        "- bullet",
        "\t- nested",
        '<callout icon="💡">',
        "\t- inside",
        "</callout>",
      ),
      L("A paragraph", "---"),
      L("- item", "\tchild paragraph"),
      "Inline math $E = mc^2$ and a [link](https://example.com)",
      '<page url="https://www.notion.so/abc">Child Page</page>',
      "<table_of_contents/>",
      '<bookmark url="https://example.com/beta">Site</bookmark>',
      // Kept as raw source, formatting included.
      L(
        '<Callout type="tip">',
        "Some **bold** words and a [link](https://example.com/x)",
        "</Callout>",
      ),
      L(
        '<synced_block url="https://www.notion.so/s">',
        "\tShared",
        "</synced_block>",
      ),
      L("$$", "\\int_0^1 x^2 dx", "$$"),
      "Escaped \\< and \\* and price \\$5",
      "[one](https://a.example)[two](https://b.example)",
      "[one](https://a.example)[two](https://a.example)",
      L("```html", '<a href="C:\\temp">x</a>', "```"),
      L("\t```", '\t<a href="C:\\temp">', "\t```"),
      'Use `<a href="C:\\temp">` here',
      "`a`**`b`**",
      "~~a~~**~~b~~**",
      '<span color="red">`a`</span>`b`',
    ]) {
      expect(canonicalizeNfm(body), body).toBe(body);
      expect(classifyBody(body), body).toEqual({
        status: "canonical",
        losses: [],
      });
    }
  });

  it("fingerprints the canonicalizer deterministically", () => {
    expect(canonicalizerFingerprint()).toMatch(/^[0-9a-f]{16}$/);
    expect(canonicalizerFingerprint()).toBe(canonicalizerFingerprint());
  });
});

describe("parser limits", () => {
  const staircase = (indent: string, depth: number, item = "- x") =>
    Array.from({ length: depth }, (_, i) => `${indent.repeat(i)}${item}`).join(
      "\n",
    );

  it("counts indentation as nesting, so a list cannot pass one level per line", () => {
    // A list nested a thousand levels this way took 35 seconds to classify.
    expect(withinParserLimits(staircase("\t", 50))).toBe(true);
    expect(withinParserLimits(staircase("\t", 51))).toBe(false);
    expect(withinParserLimits(staircase("  ", 100))).toBe(true);
    expect(withinParserLimits(staircase("  ", 101))).toBe(false);
    // An empty item nests as deeply, on the last line as on any other.
    for (const item of ["*", "1.", "-\r"]) {
      expect(withinParserLimits(staircase("\t", 50, item)), item).toBe(true);
      expect(withinParserLimits(staircase("\t", 51, item)), item).toBe(false);
    }
    // Content's parser ends a line at a bare CR as well.
    expect(withinParserLimits(staircase("\t", 51).replace(/\n/g, "\r"))).toBe(
      false,
    );
    expect(withinParserLimits(`${"> ".repeat(67)}x`)).toBe(true);
    expect(withinParserLimits(`${"> ".repeat(68)}x`)).toBe(false);
    expect(withinParserLimits("Plain prose\n\nwith no markers")).toBe(true);
  });

  it("carries the depth of Content's containers from line to line", () => {
    // 400 nested `<details>` took two and a half minutes to classify.
    const details = (depth: number) =>
      L(
        ...Array<string>(depth).fill("<details>"),
        "x",
        ...Array<string>(depth).fill("</details>"),
      );
    expect(withinParserLimits(details(100))).toBe(true);
    expect(withinParserLimits(details(101))).toBe(false);
    // A closing tag ends the depth its opening tag began.
    expect(withinParserLimits(L(details(60), details(60)))).toBe(true);
    expect(withinParserLimits(L(...Array<string>(300).fill(details(1))))).toBe(
      true,
    );
    expect(
      withinParserLimits(L('<callout icon="x">', staircase("  ", 100))),
    ).toBe(false);
    expect(withinParserLimits(L("<columns>", "<column>", "x"))).toBe(true);
    // Toggle headings nest by tabs alone, which Content reads in one pass.
    const toggles = Array.from(
      { length: 700 },
      (_, i) => `${"\t".repeat(i)}# x {toggle="true"}`,
    ).join("\n");
    expect(withinParserLimits(toggles)).toBe(true);
    expect(classifyBody(toggles).status).toBe("canonical");
    // Content rereads each line once per container around it: 100 levels
    // around 20,000 lines took 35 seconds to classify.
    const around = (lines: number) =>
      L(
        ...Array<string>(100).fill("<details>"),
        ...Array<string>(lines).fill("filler"),
        ...Array<string>(100).fill("</details>"),
      );
    expect(withinParserLimits(around(2000))).toBe(true);
    expect(withinParserLimits(around(3000))).toBe(false);
  });

  it("closes a container only where Content would", () => {
    // Each of these nests 120 `<details>` in Content, though a closing tag
    // follows every opening one: of another tag, padded, or inside a fence.
    const nested = (...after: string[]) =>
      L(
        ...Array<string>(120).fill(L("<details>", ...after)),
        ...Array<string>(120).fill("</details>"),
      );
    for (const close of ["</callout>", "  </details>", "</details> "]) {
      expect(withinParserLimits(nested(close)), close).toBe(false);
    }
    expect(withinParserLimits(nested("```", "</details>", "```"))).toBe(false);
    // An indented fence ends Content's code block but not its scanners'
    // fence, so the opening tags inside that fence still open containers.
    expect(
      withinParserLimits(L("```", "  ```", nested("```", "</details>", "```"))),
    ).toBe(false);
    // Containers closed before a mismatched close stay closed.
    expect(
      withinParserLimits(
        L(
          ...Array<string>(150).fill(L("<details>", "x", "</details>")),
          "<callout>",
          "</details>",
          "</callout>",
          ...Array<string>(3000).fill("filler"),
        ),
      ),
    ).toBe(true);
  });

  it("caps the emphasis runs in one paragraph, however many lines it spans", () => {
    // A 256 KiB page of `*a` lines took over nine minutes to classify.
    const runs = (count: number, separator: string) =>
      Array<string>(count).fill("*a").join(separator);
    expect(withinEmphasisLimit(runs(8192, "\n"))).toBe(true);
    expect(withinEmphasisLimit(runs(8193, "\n"))).toBe(false);
    expect(withinEmphasisLimit(runs(8193, "\r"))).toBe(false);
    expect(classifyBody(runs(8193, "\n"))).toEqual({
      status: "pastParserLimits",
    });
    // A blank line ends the paragraph; a `_` inside a word is not emphasis.
    expect(withinEmphasisLimit(L(runs(8000, ""), " \t", runs(8000, "")))).toBe(
      true,
    );
    expect(withinEmphasisLimit("snake_case ".repeat(10_000))).toBe(true);
    expect(withinEmphasisLimit("_a_ ".repeat(4097))).toBe(false);
    // Rescanning a run from inside it took 14 seconds for these eight lines.
    const underscores = Array<string>(8).fill(`a${"_".repeat(31_000)}b`);
    const startedAt = performance.now();
    expect(withinEmphasisLimit(L(...underscores))).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
