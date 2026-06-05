import { describe, expect, it } from "vitest";
import { applyMarkdownFormat } from "./PlanMarkdownEditor";

describe("PlanMarkdownEditor markdown formatting", () => {
  it("prefixes the current line for block-level formats", () => {
    const result = applyMarkdownFormat(
      "Intro\nMake this a section",
      "heading",
      {
        start: 8,
        end: 12,
      },
    );

    expect(result.markdown).toBe("Intro\n## Make this a section");
    expect(result.selectionStart).toBe(11);
  });

  it("prefixes every selected line for lists", () => {
    const result = applyMarkdownFormat("First\nSecond", "bullet", {
      start: 0,
      end: "First\nSecond".length,
    });

    expect(result.markdown).toBe("- First\n- Second");
    expect(result.selectionEnd).toBe("First\nSecond".length + 4);
  });

  it("wraps inline selections without rewriting surrounding markdown", () => {
    const result = applyMarkdownFormat("Keep exact source", "bold", {
      start: 5,
      end: 10,
    });

    expect(result.markdown).toBe("Keep **exact** source");
    expect(result.selectionStart).toBe(7);
    expect(result.selectionEnd).toBe(12);
  });
});
