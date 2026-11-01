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

  it("centres on a match found only in markup", () => {
    const before = Array.from({ length: 60 }, (_, i) => `filler${i}`).join(" ");
    const after = Array.from({ length: 60 }, (_, i) => `later${i}`).join(" ");
    const window = `${before} See [the roadmap](https://content.test/page/q3-roadmap-x) for dates. ${after}`;

    const snippet = searchSnippet(window, "q3-roadmap-x", {
      matchOffset: window.indexOf("q3-roadmap-x"),
    });

    expect(snippet).toContain("See the roadmap for dates.");
    expect(snippet).not.toContain("filler0 ");
    expect(snippet).not.toContain("q3-roadmap-x");
  });

  it("counts a plain less-than sign before the match as text", () => {
    const before = Array.from({ length: 30 }, (_, i) => `filler${i}`).join(" ");
    const middle = Array.from({ length: 40 }, (_, i) => `middle${i}`).join(" ");
    const window = `${before} when x < y ${middle} See [the roadmap](https://content.test/page/q3-roadmap-x) for dates.`;

    const snippet = searchSnippet(window, "q3-roadmap-x", {
      matchOffset: window.indexOf("q3-roadmap-x"),
    });

    expect(snippet).toContain("See the roadmap for dates.");
  });

  it("keeps a plain less-than sign where the window ends", () => {
    expect(
      searchSnippet("Keep x < y in view while", "keep", { clippedEnd: true }),
    ).toBe("Keep x < y in view...");
  });

  it("keeps comparisons where a cut window starts or ends", () => {
    expect(
      searchSnippet(
        "cut Score = 5 > 3 for the pilot, if x<y then more",
        "pilot",
        { clippedStart: true, clippedEnd: true },
      ),
    ).toBe("...Score = 5 > 3 for the pilot, if x<y then...");
  });

  it("keeps a comparison between two operators", () => {
    expect(searchSnippet("Ship when 3 < 4 and 5 > 2 holds.", "ship")).toBe(
      "Ship when 3 < 4 and 5 > 2 holds.",
    );
  });

  it("centres on the occurrence the database chose, not the first", () => {
    const filler = Array.from({ length: 50 }, (_, i) => `filler${i}`).join(" ");
    const window = `Alpha needle first. ${filler} Beta needle second. ${filler}`;

    const snippet = searchSnippet(window, "needle", {
      matchOffset: window.indexOf("needle second"),
    });

    expect(snippet).toContain("Beta needle second.");
    expect(snippet).not.toContain("Alpha");
  });

  it("centres on a match in a link address with parentheses in it", () => {
    const before = Array.from({ length: 60 }, (_, i) => `filler${i}`).join(" ");
    const after = Array.from({ length: 60 }, (_, i) => `later${i}`).join(" ");
    const window = `${before} See [the history](https://en.wikipedia.org/wiki/Launch_(rocketry)/zephyr-key) first. ${after}`;

    const snippet = searchSnippet(window, "zephyr-key", {
      matchOffset: window.indexOf("zephyr-key"),
    });

    expect(snippet).toContain("See the history first.");
    expect(snippet).not.toContain("zephyr-key");
    expect(snippet).not.toContain(")");
  });

  it("centres on where the match was found when no exact phrase is given", () => {
    const before = Array.from({ length: 60 }, (_, i) => `early${i}`).join(" ");
    const after = Array.from({ length: 60 }, (_, i) => `late${i}`).join(" ");
    const window = `${before} launch\n\nplan ${after}`;

    const snippet = searchSnippet(window, "", {
      clippedStart: true,
      matchOffset: window.indexOf("launch"),
    });

    expect(snippet).toContain("launch plan");
    expect(snippet).not.toContain("early0 ");
  });

  it("drops the rest of a comment the window starts inside", () => {
    const window = "internal secret-plan draft --> Public launch notes here.";
    const snippet = searchSnippet(window, "secret-plan", {
      clippedStart: true,
      startsInComment: true,
      matchOffset: window.indexOf("secret-plan"),
    });

    expect(snippet).toBe("...Public launch notes here.");
    expect(
      searchSnippet("internal secret-plan draft", "secret-plan", {
        clippedStart: true,
        clippedEnd: true,
        startsInComment: true,
        matchOffset: 9,
      }),
    ).toBe("");
  });

  it("leaves a whole short page as it is", () => {
    expect(searchSnippet("Notes come first.", "notes")).toBe(
      "Notes come first.",
    );
  });
});
