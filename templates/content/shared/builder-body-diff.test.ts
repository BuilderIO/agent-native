import { describe, expect, it } from "vitest";

import { builderBodyLineDiff } from "./builder-body-diff";

function paragraphs(count: number, label = "Paragraph") {
  return Array.from(
    { length: count },
    (_, index) => `${label} ${index + 1} says something.`,
  ).join("\n\n");
}

describe("builderBodyLineDiff", () => {
  it("returns null when only line endings and outer whitespace differ", () => {
    expect(builderBodyLineDiff("One\r\nTwo\n", "  One\nTwo")).toBeNull();
  });

  it("finds an edit deep in a long body, with context around it", () => {
    const current = paragraphs(60);
    const proposed = current.replace(
      "Paragraph 55 says something.",
      "Paragraph 55 says something new.",
    );

    const diff = builderBodyLineDiff(current, proposed);

    expect(diff).toMatchObject({
      omittedHunkCount: 0,
      addedLineCount: 1,
      removedLineCount: 1,
    });
    expect(diff?.hunks).toHaveLength(1);
    expect(diff?.hunks[0]?.lines).toEqual([
      { kind: "same", text: "Paragraph 53 says something." },
      { kind: "same", text: "Paragraph 54 says something." },
      {
        kind: "removed",
        text: "Paragraph 55 says something.",
        changedFrom: 27,
        changedTo: 27,
      },
      {
        kind: "added",
        text: "Paragraph 55 says something new.",
        changedFrom: 27,
        changedTo: 31,
      },
      { kind: "same", text: "Paragraph 56 says something." },
      { kind: "same", text: "Paragraph 57 says something." },
    ]);
  });

  it("keeps separate hunks for distant edits and merges near ones", () => {
    const current = paragraphs(40);
    const proposed = current
      .replace("Paragraph 3 says", "Paragraph 3 now says")
      .replace("Paragraph 5 says", "Paragraph 5 now says")
      .replace("Paragraph 30 says", "Paragraph 30 now says");

    const diff = builderBodyLineDiff(current, proposed);

    expect(diff?.hunks).toHaveLength(2);
    const firstHunk = diff?.hunks[0]?.lines.map((line) => line.text) ?? [];
    expect(firstHunk).toContain("Paragraph 3 now says something.");
    expect(firstHunk).toContain("Paragraph 5 now says something.");
    expect(diff?.hunks[1]?.lines.map((line) => line.text)).toContain(
      "Paragraph 30 now says something.",
    );
  });

  it("shows added and removed lines that have no partner whole", () => {
    const diff = builderBodyLineDiff(
      "Intro\n\nOutro",
      "Intro\n\nNew line\n\nOutro",
    );

    expect(diff?.hunks[0]?.lines).toEqual([
      { kind: "same", text: "Intro" },
      { kind: "added", text: "New line" },
      { kind: "same", text: "Outro" },
    ]);
  });

  it("clips a long changed line around the change", () => {
    const filler = "word ".repeat(200);
    const current = `${filler}old ending.`;
    const proposed = `${filler}new ending.`;

    const diff = builderBodyLineDiff(current, proposed);
    const added = diff?.hunks[0]?.lines.find((line) => line.kind === "added");

    expect(added?.text.startsWith("…")).toBe(true);
    expect(added?.text.length).toBeLessThan(400);
    expect(added?.text.slice(added.changedFrom, added.changedTo)).toBe("new");
  });

  it("limits how many hunks it returns and counts the rest", () => {
    const current = paragraphs(200);
    let proposed = current;
    for (let index = 10; index <= 190; index += 20) {
      proposed = proposed.replace(
        `Paragraph ${index} says`,
        `Paragraph ${index} now says`,
      );
    }

    const diff = builderBodyLineDiff(current, proposed);

    expect(diff?.hunks).toHaveLength(6);
    expect(diff?.omittedHunkCount).toBe(4);
    expect(diff?.addedLineCount).toBe(10);
  });

  it("limits the lines in one hunk", () => {
    const diff = builderBodyLineDiff(
      paragraphs(50, "Old"),
      paragraphs(50, "New"),
    );

    expect(diff?.hunks).toHaveLength(1);
    expect(diff?.hunks[0]?.lines).toHaveLength(24);
    expect(diff?.hunks[0]?.omittedLineCount).toBe(76);
  });
});
