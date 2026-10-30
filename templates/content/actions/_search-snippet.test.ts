import { describe, expect, it } from "vitest";

import { searchSnippet } from "./_search-snippet.js";

describe("searchSnippet", () => {
  it("shows the page's text, not its markup", () => {
    const window =
      '<table header-row="true">\n<tr>\n<td>Milestone</td>\n<td>Status</td>\n</tr>\n</table>\nThe <span color="red">launch table</span> lists owners; see <mention-page url="https://content.test/page/abc"/> and [the plan](https://content.test/plan).';

    const snippet = searchSnippet(window, "table");

    expect(snippet).toBe(
      "Milestone Status The launch table lists owners; see and the plan.",
    );
  });

  it("drops a tag and a word the window cuts through", () => {
    const window =
      'ble color="gray">Each wave waits until crash-free sessions stay above 99.5% for 24 hours, then the next wave starts on the following morning.<span col';

    const snippet = searchSnippet(window, "crash-free", {
      clippedStart: true,
      clippedEnd: true,
    });

    expect(snippet).toBe(
      "...wave waits until crash-free sessions stay above 99.5% for 24 hours, then the next wave starts on the following...",
    );
  });

  it("cuts long text at word breaks around the match", () => {
    const before = Array.from({ length: 40 }, (_, i) => `before${i}`).join(" ");
    const after = Array.from({ length: 40 }, (_, i) => `after${i}`).join(" ");

    const snippet = searchSnippet(`${before} needle ${after}`, "needle");

    expect(snippet.startsWith("...before")).toBe(true);
    expect(snippet.endsWith("...")).toBe(true);
    expect(snippet).toContain(" needle ");
    const words = snippet.replace(/^\.\.\.|\.\.\.$/g, "").split(" ");
    for (const word of words)
      expect(word).toMatch(/^(before|after)\d+$|^needle$/);
  });

  it("leaves a whole short page as it is", () => {
    expect(searchSnippet("Notes come first.", "notes")).toBe(
      "Notes come first.",
    );
  });
});
