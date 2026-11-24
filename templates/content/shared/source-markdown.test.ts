import { describe, expect, it } from "vitest";

import { canonicalizeNfm } from "./nfm";
import { mergeSourceMarkdown, sameSourceMarkdown } from "./source-markdown";

const NOTE = `# Field notes

Intro with *emphasis* and __strong__ words.
A second line of the same thought.

* first
* second
    * nested

| Name  | Count |
| :---- | ----: |
| Pears |     3 |
| Figs  |    12 |

~~~js
const a = 1;

const b = 2;
~~~

> A quote

---

Closing paragraph.
`;

function pageAfter(source: string, edit: (page: string) => string): string {
  const page = canonicalizeNfm(source);
  const edited = edit(page);
  if (edited === page) throw new Error("The edit changed nothing.");
  return edited;
}

function expectMerge(
  source: string,
  edit: (page: string) => string,
  expected: string,
) {
  const page = pageAfter(source, edit);
  const merged = mergeSourceMarkdown(source, page);
  expect(merged).toBe(expected);
  expect(sameSourceMarkdown(merged, page)).toBe(true);
}

describe("sameSourceMarkdown", () => {
  it("reads a file and the page made from it as the same", () => {
    expect(sameSourceMarkdown(NOTE, canonicalizeNfm(NOTE))).toBe(true);
  });

  it("ignores the empty line the editor keeps at the end of a page", () => {
    expect(sameSourceMarkdown("Text\n", "Text\n<empty-block/>")).toBe(true);
    expect(sameSourceMarkdown("", "<empty-block/>")).toBe(true);
  });

  it("tells a changed word apart", () => {
    expect(sameSourceMarkdown("Text\n", "Texts")).toBe(false);
  });
});

describe("mergeSourceMarkdown", () => {
  it("returns the file untouched when the page says the same thing", () => {
    expect(
      mergeSourceMarkdown(NOTE, `${canonicalizeNfm(NOTE)}\n<empty-block/>`),
    ).toBe(NOTE);
  });

  it("changes only the edited paragraph", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("Closing paragraph.", "Closing words."),
      NOTE.replace("Closing paragraph.", "Closing words."),
    );
  });

  it("keeps the spelling around an edit inside a paragraph", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("words.", "words and more."),
      NOTE.replace("words.", "words and more."),
    );
  });

  it("keeps list markers and indentation when an item changes", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("nested", "nested deeper"),
      NOTE.replace("nested", "nested deeper"),
    );
  });

  it("writes a new list item in the list's own style", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("- second\n", "- second\n- third\n"),
      NOTE.replace(
        "* second\n    * nested\n",
        "* second\n* third\n    * nested\n",
      ),
    );
  });

  it("keeps a code fence's own marker when its code changes", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("const b = 2;", "const b = 3;"),
      NOTE.replace("const b = 2;", "const b = 3;"),
    );
  });

  it("keeps a pipe table a pipe table when one cell changes", () => {
    expectMerge(
      NOTE,
      (page) => page.replace(">12</td>", ">13</td>"),
      NOTE.replace("| Figs  |    12 |", "| Figs  | 13    |"),
    );
  });

  it("adds a row to a pipe table without touching the others", () => {
    expectMerge(
      NOTE,
      (page) =>
        page.replace(
          "</table>",
          '<tr>\n<td align="left">Plums</td>\n<td align="right">7</td>\n</tr>\n</table>',
        ),
      NOTE.replace(
        "| Figs  |    12 |\n",
        "| Figs  |    12 |\n| Plums | 7     |\n",
      ),
    );
  });

  it("removes a row from a pipe table", () => {
    expectMerge(
      NOTE,
      (page) =>
        page.replace(
          '<tr>\n<td align="left">Pears</td>\n<td align="right">3</td>\n</tr>\n',
          "",
        ),
      NOTE.replace("| Pears |     3 |\n", ""),
    );
  });

  it("separates a new paragraph the way the file separates its own", () => {
    expectMerge(
      NOTE,
      (page) =>
        page.replace(
          "Closing paragraph.",
          "Closing paragraph.\nOne more thing.",
        ),
      NOTE.replace(
        "Closing paragraph.\n",
        "Closing paragraph.\n\nOne more thing.\n",
      ),
    );
  });

  it("keeps a file without blank lines without them", () => {
    expectMerge(
      "One\nTwo\nThree\n",
      (page) => page.replace("Two", "Two\nTwo and a half"),
      "One\nTwo\nTwo and a half\nThree\n",
    );
  });

  it("keeps a new block apart from the paragraph above a blank line in a file with wrapped lines", () => {
    const source =
      "One wraps\nover two\nor three lines.\n\nReactions are permanent and stay\nfor good.\n";
    expectMerge(
      source,
      (page) => page.replace("Reactions are", "Reactions\nare"),
      source.replace("Reactions are", "Reactions\n\nare"),
    );
    expectMerge(
      source,
      (page) => page.replace("or three lines.", "or three lines.\nNew"),
      source.replace("or three lines.", "or three lines.\n\nNew"),
    );
    expectMerge(
      source,
      (page) => page.replace("over two", "over two\nNew"),
      source.replace("over two", "over two\nNew"),
    );
  });

  it("splits a paragraph in place", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("Closing paragraph.", "Closing\nparagraph."),
      NOTE.replace("Closing paragraph.", "Closing\n\nparagraph."),
    );
  });

  it("deletes a block and the gap it leaves", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("> A quote\n", ""),
      NOTE.replace("> A quote\n\n", ""),
    );
  });

  it("deletes the first and the last block", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("# Field notes\n", ""),
      NOTE.replace("# Field notes\n\n", ""),
    );
    expectMerge(
      NOTE,
      (page) => page.replace("\nClosing paragraph.", ""),
      NOTE.replace("\nClosing paragraph.\n", ""),
    );
  });

  it("inserts a block at the top", () => {
    expectMerge(
      NOTE,
      (page) => `New opening.\n${page}`,
      `New opening.\n\n${NOTE}`,
    );
  });

  it("writes a new table as a pipe table", () => {
    expectMerge(
      "Before\n\nAfter\n",
      (page) =>
        page.replace(
          "Before\n",
          'Before\n<table header-row="true">\n<tr>\n<td>A</td>\n<td>B</td>\n</tr>\n<tr>\n<td>1</td>\n<td>x \\| y</td>\n</tr>\n</table>\n',
        ),
      "Before\n\n| A | B |\n| --- | --- |\n| 1 | x \\| y |\n\nAfter\n",
    );
  });

  it("keeps a table the file writes as HTML in HTML", () => {
    const table =
      "<table>\n<tr>\n<td>A</td>\n<td>B</td>\n</tr>\n</table>\n\nAfter\n";
    expectMerge(
      table,
      (page) => page.replace("<td>B</td>", "<td>C</td>"),
      table.replace("<td>B</td>", "<td>C</td>"),
    );
  });

  it("keeps the layout of a table the file writes as HTML", () => {
    const table =
      '<table header-row="true">\n  <tr>\n    <td>A</td>\n    <td>B</td>\n  </tr>\n  <tr>\n    <td>1</td>\n    <td>2</td>\n  </tr>\n</table>\n\nAfter\n';
    expectMerge(
      table,
      (page) => page.replace("<td>2</td>", "<td>3</td>"),
      table.replace("<td>2</td>", "<td>3</td>"),
    );
  });

  it("escapes a pipe in a pipe table's code", () => {
    expectMerge(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
      (page) => page.replace("<td>2</td>", "<td>`x|y`</td>"),
      "| a | b |\n| --- | --- |\n| 1 | `x\\|y` |\n",
    );
  });

  it("keeps a pipe table whose first cell is HTML a pipe table", () => {
    const table = "<b>A</b> | B\n--- | ---\n1 | 2\n";
    expectMerge(
      table,
      (page) => page.replace("<td>2</td>", "<td>`x|y`</td>"),
      table.replace("2\n", "`x\\|y`\n"),
    );
  });

  it("puts a blank line around HTML and before a rule in a file without blank lines", () => {
    const source = "# A\n# B\n# C\n# D\n\n<div>text</div>\n\nEnd\n";
    expectMerge(
      source,
      (page) => `${page}\n${page.split("\n").slice(4, 5).join("")}\nAfter`,
      `${source}\n<div>text</div>\n\nAfter\n`,
    );
    expectMerge(
      "# A\n# B\n# C\nLabel\n",
      (page) => `${page}\n---\nAfter`,
      "# A\n# B\n# C\nLabel\n\n---\n\nAfter\n",
    );
  });

  it("reads an escaped pipe in a pipe table's code as a pipe", () => {
    expect(canonicalizeNfm("| a |\n| --- |\n| `x\\|y` \\| z |\n")).toContain(
      "<td>`x|y` \\| z</td>",
    );
  });

  it("keeps the Markdown of a block that moves or is copied", () => {
    const list = "* one _a_\n* two\n";
    expectMerge(
      `First\n\n${list}\nMiddle\n\nLast\n`,
      () => "Middle\nFirst\n- one *a*\n- two\nLast",
      `Middle\n\nFirst\n\n${list}\nLast\n`,
    );
    expectMerge(
      `${list}\nFirst\n\nMiddle __b__\n`,
      () => "First\nMiddle **b**\n- one *a*\n- two",
      `First\n\nMiddle __b__\n\n${list}`,
    );
    expectMerge(
      "First __b__\n\nLast\n",
      () => "First **b**\nLast\nFirst **b**",
      "First __b__\n\nLast\n\nFirst __b__\n",
    );
  });

  it("keeps the rest of the file when a list moves past its wrapped text", () => {
    expectMerge(
      "* Intro _x_\n\nText\n\n* Shape\n  first line\n  `second` line\n* End _y_\n",
      (page) => page.replace("- Shape\n  first line", "  first line\n- Shape"),
      "* Intro _x_\n\nText\n\n  first line\n* Shape\n  `second` line\n* End _y_\n",
    );
  });

  it("keeps a long list's layout when one item changes", () => {
    const list = (name: string) =>
      Array.from(
        { length: 4000 },
        (_, index) => `* item _${index === 2000 ? name : index}_`,
      ).join("\n\n");
    expectMerge(
      `${list("old")}\n`,
      (page) => page.replace("*old*", "*new*"),
      `${list("new")}\n`,
    );
  });

  it("keeps every other line when a line ending in spaces changes", () => {
    expectMerge(
      "Intro\n\nOld  \nNext\n\nEnd\n",
      (page) => page.replace("Old", "New"),
      "Intro\n\nNew  \nNext\n\nEnd\n",
    );
    expectMerge(
      "Intro   \n\nOld  \n\nEnd\t\n",
      (page) => page.replace("Old", "Older"),
      "Intro   \n\nOlder  \n\nEnd\t\n",
    );
  });

  it("writes a table that a pipe table can't hold as HTML", () => {
    const merged = mergeSourceMarkdown(
      NOTE,
      pageAfter(NOTE, (page) => page.replace("<tr>", '<tr color="red">')),
    );
    expect(merged).toContain('<tr color="red">');
    expect(merged).toContain("* first\n* second\n    * nested\n");
  });

  it("keeps Windows line endings", () => {
    const source = NOTE.replace(/\n/g, "\r\n");
    expectMerge(
      source,
      (page) =>
        page
          .replace("Closing paragraph.", "Closing words.\nOne more.")
          .replace("> A quote", "> Another quote"),
      NOTE.replace("Closing paragraph.\n", "Closing words.\n\nOne more.\n")
        .replace("> A quote", "> Another quote")
        .replace(/\n/g, "\r\n"),
    );
  });

  it("adds no final newline to a file without one", () => {
    expectMerge("Only line", (page) => page.replace("line", "row"), "Only row");
  });

  it("leaves the blocks around it alone when a heading becomes a paragraph", () => {
    expectMerge(
      NOTE,
      (page) => page.replace("# Field notes", "Field notes"),
      NOTE.replace("# Field notes", "Field notes"),
    );
  });

  it("writes an empty file's first text and clears a file", () => {
    expect(mergeSourceMarkdown("", "Hello")).toBe("Hello\n");
    expect(mergeSourceMarkdown("Hello\n", "<empty-block/>")).toBe("");
  });

  it("keeps every other block when two far apart change", () => {
    expectMerge(
      NOTE,
      (page) =>
        page
          .replace("# Field notes", "# Field notes, revised")
          .replace("Closing paragraph.", "Closing words."),
      NOTE.replace("# Field notes", "# Field notes, revised").replace(
        "Closing paragraph.",
        "Closing words.",
      ),
    );
  });

  it("always writes something that reads as the page", () => {
    const pages = [
      NOTE,
      "Para\nTight\n\n\n\nLoose\n",
      "- a\n\n- b\n\n1) one\n2) two\n",
      "\n\nLeading blank\n\n```\nunclosed\n\n",
      "| a | b |\n|---|---|\n| `x|y` | 2 |\n",
      "<callout>\n\tInside\n</callout>\n\nAfter\n",
      "Text <!-- note --> more\n\n<!-- alone -->\n",
    ];
    for (const source of pages) {
      for (const target of pages) {
        const page = canonicalizeNfm(target);
        expect(
          sameSourceMarkdown(mergeSourceMarkdown(source, page), page),
        ).toBe(true);
      }
    }
  });
});
