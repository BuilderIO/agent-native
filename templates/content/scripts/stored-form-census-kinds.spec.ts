import { describe, expect, it } from "vitest";

import { canonicalizeNfm } from "../shared/nfm";
import {
  canonicalizationLosses,
  canonicalizerFingerprint,
  classifyBody,
  diffLineHunks,
  explainHunk,
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
    expect(classifyBody(L("Heading", "======="))).toEqual({
      status: "canonical",
      losses: ["gfm-headings-lost"],
    });
  });

  it("flags formatting canonicalizing removes", () => {
    const result = classifyBody(L("~~~js", "code", "~~~"));
    expect(result.status).toBe("non-canonical");
    if (result.status !== "non-canonical") return;
    expect(result.losses).toContain("gfm-code-blocks-lost");
    expect(canonicalizationLosses("Keep every word", "Keep word")).toContain(
      "gfm-text-dropped",
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
      "Inline math $E = mc^2$ and a [link](https://example.com)",
      '<page url="https://www.notion.so/abc">Child Page</page>',
      "<table_of_contents/>",
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
