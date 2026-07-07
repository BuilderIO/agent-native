import { describe, expect, it } from "vitest";

import {
  derivePromptTitle,
  sanitizeGeneratedDesignTitle,
} from "./prompt-title";

describe("derivePromptTitle", () => {
  it("returns the full first line when short enough", () => {
    expect(derivePromptTitle("A clean dashboard")).toBe("A clean dashboard");
  });

  it("strips trailing sentence punctuation", () => {
    expect(derivePromptTitle("Build me a login page!")).toBe(
      "Build me a login page",
    );
  });

  it("truncates long prompts at a word boundary near 40 chars", () => {
    const prompt =
      "A clean analytics dashboard with a sidebar, charts, and a data table for tracking sales";
    const title = derivePromptTitle(prompt);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(41);
    // The word before the ellipsis should be intact, not cut mid-word.
    const withoutEllipsis = title.slice(0, -1);
    expect(prompt.startsWith(withoutEllipsis)).toBe(true);
  });

  it("only uses the first line of a multi-line prompt", () => {
    expect(derivePromptTitle("Line one\nLine two\nLine three")).toBe(
      "Line one",
    );
  });

  it("falls back to a default when the prompt is empty or whitespace", () => {
    expect(derivePromptTitle("")).toBe("Untitled Design");
    expect(derivePromptTitle("   \n  ")).toBe("Untitled Design");
  });
});

describe("sanitizeGeneratedDesignTitle", () => {
  it("strips wrapping quotes", () => {
    expect(sanitizeGeneratedDesignTitle('"Analytics Dashboard"')).toBe(
      "Analytics Dashboard",
    );
    expect(sanitizeGeneratedDesignTitle("'Analytics Dashboard'")).toBe(
      "Analytics Dashboard",
    );
  });

  it("strips a leading Title:/Name: prefix", () => {
    expect(sanitizeGeneratedDesignTitle("Title: Sales Overview")).toBe(
      "Sales Overview",
    );
    expect(sanitizeGeneratedDesignTitle("Name: Sales Overview")).toBe(
      "Sales Overview",
    );
  });

  it("strips trailing punctuation", () => {
    expect(sanitizeGeneratedDesignTitle("Sales Overview.")).toBe(
      "Sales Overview",
    );
    expect(sanitizeGeneratedDesignTitle("Sales Overview!")).toBe(
      "Sales Overview",
    );
  });

  it("converts to Title Case with minor words lowercased", () => {
    expect(sanitizeGeneratedDesignTitle("analytics dashboard for sales")).toBe(
      "Analytics Dashboard for Sales",
    );
  });

  it("preserves existing acronyms", () => {
    expect(sanitizeGeneratedDesignTitle("AI powered CRM dashboard")).toBe(
      "AI Powered CRM Dashboard",
    );
  });

  it("collapses internal whitespace and newlines", () => {
    expect(sanitizeGeneratedDesignTitle("Sales   \n Overview")).toBe(
      "Sales Overview",
    );
  });

  it("caps overly long generated text", () => {
    const long = "word ".repeat(30).trim();
    const result = sanitizeGeneratedDesignTitle(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(60);
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(sanitizeGeneratedDesignTitle("")).toBeNull();
    expect(sanitizeGeneratedDesignTitle("   ")).toBeNull();
    expect(sanitizeGeneratedDesignTitle('""')).toBeNull();
  });
});
