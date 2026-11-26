import { describe, expect, it } from "vitest";

import {
  imagesFor,
  parseResult,
  renderHtml,
  renderSummary,
  summarize,
} from "./report.ts";
import { outcomeFromError, type ShotResult, shotFile } from "./results.ts";

function shot(
  storyId: string,
  appearance: "light" | "dark",
  outcome: ShotResult["outcome"],
  message?: string,
): ShotResult {
  return {
    storyId,
    appearance,
    file: shotFile(storyId, appearance),
    outcome,
    ...(message ? { message } : {}),
  };
}

describe("screenshot results", () => {
  it("files a story's screenshots by component, story and appearance", () => {
    expect(shotFile("components-button--playground", "dark")).toBe(
      "components-button/playground/dark",
    );
    expect(() => shotFile("no-separator", "light")).toThrow(
      "is not <component>--<story>",
    );
  });

  it("reads only the matcher's own differences as visual outcomes", () => {
    expect(
      outcomeFromError(
        new Error("Screenshot does not match the stored reference."),
      ),
    ).toBe("changed");
    expect(
      outcomeFromError(new Error("No existing reference screenshot found.")),
    ).toBe("new");
    expect(
      outcomeFromError(
        new Error("Could not capture a stable screenshot within 5000ms."),
      ),
    ).toBe("unstable");
    expect(outcomeFromError(new Error("Element not found"))).toBeNull();
  });

  it("refuses a result file that is not a screenshot result", () => {
    expect(() =>
      parseResult('{"storyId":"a--b","appearance":"sepia"}', "a.json"),
    ).toThrow("a.json is not a screenshot result");
  });
});

describe("summarize", () => {
  it("counts every outcome and lists only what needs review, in story order", () => {
    const summary = summarize([
      shot("b--two", "dark", "changed"),
      shot("b--two", "light", "matched"),
      shot("a--one", "dark", "unstable"),
      shot("a--one", "light", "new"),
      shot("c--three", "light", "skipped"),
    ]);
    expect(summary.stories).toBe(3);
    expect(summary.counts).toEqual({
      matched: 1,
      recorded: 0,
      changed: 1,
      new: 1,
      unstable: 1,
      skipped: 1,
    });
    expect(
      summary.review.map((r) => `${r.storyId} ${r.appearance} ${r.outcome}`),
    ).toEqual([
      "a--one light new",
      "a--one dark unstable",
      "b--two dark changed",
    ]);
  });
});

describe("imagesFor", () => {
  it("pairs a changed shot's baseline with the actual and diff Vitest wrote", () => {
    const files = new Set([
      "baseline/a/one/light.png",
      "diff/a/one/light-actual.png",
      "diff/a/one/light-diff.png",
    ]);
    expect(
      imagesFor(shot("a--one", "light", "changed"), (f) => files.has(f)),
    ).toEqual({
      before: "baseline/a/one/light.png",
      after: "diff/a/one/light-actual.png",
      diff: "diff/a/one/light-diff.png",
    });
  });

  it("has no diff when the dimensions changed, and fails without an actual", () => {
    const files = new Set([
      "baseline/a/one/light.png",
      "diff/a/one/light-actual.png",
    ]);
    expect(
      imagesFor(shot("a--one", "light", "changed"), (f) => files.has(f)).diff,
    ).toBeNull();
    expect(() =>
      imagesFor(
        shot("a--one", "light", "changed"),
        (f) => f === "baseline/a/one/light.png",
      ),
    ).toThrow("changed but");
  });

  it("finds a new shot where CI writes it, then where a local run does", () => {
    const ci = new Set(["diff/a/one/dark-reference.png"]);
    expect(
      imagesFor(shot("a--one", "dark", "new"), (f) => ci.has(f)).after,
    ).toBe("diff/a/one/dark-reference.png");
    const local = new Set(["baseline/a/one/dark.png"]);
    expect(
      imagesFor(shot("a--one", "dark", "new"), (f) => local.has(f)).after,
    ).toBe("baseline/a/one/dark.png");
    expect(() => imagesFor(shot("a--one", "dark", "new"), () => false)).toThrow(
      "no screenshot was written",
    );
  });
});

describe("renderHtml", () => {
  it("shows before, after and diff for each change, linked to its story, escaped", () => {
    const result = shot(
      "a--one",
      "light",
      "changed",
      "\u001b[31m<b>mismatch</b>\u001b[39m",
    );
    const html = renderHtml(
      summarize([result]),
      [
        {
          result,
          images: {
            before: "images/a/one/light-before.png",
            after: "images/a/one/light-after.png",
            diff: null,
          },
        },
      ],
      "..",
    );
    expect(html).toContain('href="../?path=/story/a--one"');
    expect(html).toContain('src="images/a/one/light-before.png"');
    expect(html).toContain('src="images/a/one/light-after.png"');
    expect(html).toContain("&lt;b&gt;mismatch&lt;/b&gt;");
    expect(html).not.toContain("<b>mismatch");
    expect(html).not.toContain("\u001b");
  });
});

describe("renderSummary", () => {
  it("says plainly when nothing was compared for want of a baseline", () => {
    const summary = summarize([
      shot("a--one", "light", "recorded"),
      shot("a--one", "dark", "recorded"),
      shot("b--two", "light", "recorded"),
      shot("c--three", "light", "skipped"),
    ]);
    expect(renderSummary(summary, "record", true)).toContain(
      "No baseline on main yet: 2 stories recorded, nothing compared.",
    );
  });

  it("lists the changed stories with counts", () => {
    const markdown = renderSummary(
      summarize([
        shot("a--one", "light", "changed"),
        shot("b--two", "light", "matched"),
      ]),
      "compare",
      false,
    );
    expect(markdown).toContain(
      "2 stories compared: 1 changed, 0 new, 0 unstable, 1 matched, 0 skipped.",
    );
    expect(markdown).toContain("| `a--one` | light | Changed |");
    expect(markdown).not.toContain("b--two");
  });
});
