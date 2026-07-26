import { describe, expect, it } from "vitest";

import {
  type PromptSection,
  selectPromptSectionsWithinBudget,
} from "./prompt-resources.js";

function section(
  label: string,
  chars: number,
  governance: PromptSection["governance"] = "inherited",
): PromptSection {
  const open = `<resource name="${label}" scope="test">\n`;
  const close = `\n</resource>`;
  const padding = Math.max(1, chars - open.length - close.length);
  return { content: `${open}${"x".repeat(padding)}${close}`, governance };
}

function joined(sections: string[]): string {
  return sections.join("\n\n");
}

describe("selectPromptSectionsWithinBudget", () => {
  it("keeps every section and stays silent when the budget is comfortable", () => {
    const sections = [
      section("AGENTS.md", 4_000, "required"),
      section("workspace-index", 2_000),
      section("memory/MEMORY.md", 1_500, "user"),
      section("available-apps", 1_200, "required"),
    ];

    const result = selectPromptSectionsWithinBudget(sections, 48_000);

    expect(result.sections).toEqual(sections.map((entry) => entry.content));
    expect(result.skipped).toEqual([]);
    expect(result.overflowChars).toBe(0);
    expect(joined(result.sections)).not.toContain("<context-budget-note>");
  });

  it("reserves required sections and skips discretionary ones under a tight budget", () => {
    const sections = [
      section("workspace-index", 1_500),
      section("org-index", 1_500),
      section("available-apps", 800, "required"),
    ];

    const result = selectPromptSectionsWithinBudget(sections, 3_200);

    expect(result.sections).toContain(sections[2]!.content);
    expect(result.sections).toContain(sections[0]!.content);
    expect(result.sections).not.toContain(sections[1]!.content);
    expect(result.overflowChars).toBe(0);
    // A pinned section keeps its assembled position; reservation is about
    // budget, not ordering.
    expect(result.sections.indexOf(sections[2]!.content)).toBe(
      result.sections.length - 2,
    );
    expect(joined(result.sections).length).toBeLessThanOrEqual(3_200);
  });

  it("names every skipped section and its size so an over-budget request is observable", () => {
    const sections = [
      section("workspace-index", 1_500),
      section("org-index", 1_500),
      section("available-apps", 800, "required"),
    ];

    const result = selectPromptSectionsWithinBudget(sections, 3_200);

    expect(result.skipped).toEqual([
      { label: "org-index (test)", chars: sections[1]!.content.length },
    ]);
    const note = result.sections.at(-1)!;
    expect(note).toContain("<context-budget-note>");
    expect(note).toContain("1 section(s) did not fit the 3,200-character");
    expect(note).toContain("org-index (test)");
    expect(note).toContain("Treat them as unread, not as absent");
  });

  it("keeps the trim note inside the reserved allowance when many sections are skipped", () => {
    const sections = [
      section("available-apps", 500, "required"),
      ...Array.from({ length: 40 }, (_, index) =>
        section(`discretionary-section-with-a-long-name-${index}`, 1_000),
      ),
    ];

    // The smallest budget that still fits the required section: any trim note
    // longer than the reserve the fitter set aside would overflow it.
    const budget = sections[0]!.content.length + 2 + 700;
    const result = selectPromptSectionsWithinBudget(sections, budget);

    expect(result.skipped).toHaveLength(40);
    expect(result.overflowChars).toBe(0);
    expect(joined(result.sections).length).toBeLessThanOrEqual(budget);
  });

  it("sends required sections whole and reports the overflow when they alone exceed the budget", () => {
    const sections = [
      section("AGENTS.md", 900, "required"),
      section("workspace-index", 500),
      section("available-apps", 800, "required"),
    ];

    const result = selectPromptSectionsWithinBudget(sections, 1_000);

    expect(result.sections.slice(0, 2)).toEqual([
      sections[0]!.content,
      sections[2]!.content,
    ]);
    expect(result.skipped).toEqual([
      { label: "workspace-index (test)", chars: sections[1]!.content.length },
    ]);
    const rendered = joined(result.sections);
    expect(rendered.length).toBeGreaterThan(1_000);
    expect(result.overflowChars).toBe(rendered.length - 1_000);
    expect(rendered).toContain("<context-budget-note>");
  });
});
