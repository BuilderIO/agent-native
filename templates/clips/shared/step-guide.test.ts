import { describe, expect, it } from "vitest";

import {
  buildStepGuide,
  parseStepTitle,
  stepGuideMarkdown,
} from "./step-guide";

describe("parseStepTitle", () => {
  it("splits the number from an uploaded step title", () => {
    expect(parseStepTitle('12. Click "Save" button')).toEqual({
      stepNumber: 12,
      title: 'Click "Save" button',
    });
  });

  it("leaves a title without a step number alone", () => {
    expect(parseStepTitle(" Login screen ")).toEqual({
      stepNumber: null,
      title: "Login screen",
    });
    expect(parseStepTitle("2.5 release notes")).toEqual({
      stepNumber: null,
      title: "2.5 release notes",
    });
    expect(parseStepTitle("3. ")).toEqual({ stepNumber: null, title: "3." });
  });
});

describe("buildStepGuide", () => {
  it("orders by step number and renumbers without gaps", () => {
    const guide = buildStepGuide([
      { id: "c", title: "10. Click Done" },
      { id: "a", title: "1. Click File" },
      { id: "b", title: "3. Click Export" },
    ]);
    expect(guide.map((s) => [s.number, s.recording.id, s.title])).toEqual([
      [1, "a", "Click File"],
      [2, "b", "Click Export"],
      [3, "c", "Click Done"],
    ]);
  });

  it("keeps unnumbered screenshots after the steps, in upload order", () => {
    const guide = buildStepGuide([
      { id: "x", title: "Extra note" },
      { id: "b", title: "2. Second" },
      { id: "y", title: "Another" },
      { id: "a", title: "1. First" },
    ]);
    expect(guide.map((s) => s.recording.id)).toEqual(["a", "b", "x", "y"]);
    expect(guide[2]).toMatchObject({ number: 3, title: "Extra note" });
  });

  it("keeps upload order between steps sharing a number", () => {
    const guide = buildStepGuide([
      { id: "first", title: "1. Click" },
      { id: "second", title: "1. Click" },
    ]);
    expect(guide.map((s) => s.recording.id)).toEqual(["first", "second"]);
  });
});

describe("stepGuideMarkdown", () => {
  it("writes a heading and a linked image per step", () => {
    const markdown = stepGuideMarkdown({
      title: "Step capture 2026-10-18 09:30",
      steps: [
        {
          number: 1,
          title: 'Click "Save" [draft] button',
          imageUrl: "https://clips.test/api/thumbnail/a",
          linkUrl: "https://clips.test/share/a",
        },
        {
          number: 2,
          title: "",
          imageUrl: null,
          linkUrl: "https://clips.test/share/b",
        },
      ],
    });
    expect(markdown).toBe(
      [
        "# Step capture 2026-10-18 09:30",
        '## Step 1: Click "Save" [draft] button',
        '[![Click "Save" \\[draft\\] button](<https://clips.test/api/thumbnail/a>)](<https://clips.test/share/a>)',
        "## Step 2: Step 2",
        "[Open step 2](<https://clips.test/share/b>)",
      ].join("\n\n") + "\n",
    );
  });

  it("keeps a title on one line", () => {
    const markdown = stepGuideMarkdown({
      title: "## Guide\nnext",
      steps: [],
    });
    expect(markdown).toBe("# Guide next\n");
  });
});
