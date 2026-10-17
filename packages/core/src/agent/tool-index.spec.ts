import { describe, expect, it } from "vitest";

import { formatToolIndex } from "./tool-index.js";

describe("tool-index", () => {
  it("returns empty string for empty input", () => {
    expect(formatToolIndex([])).toBe("");
  });

  it("groups tools by topic", () => {
    const result = formatToolIndex([
      "create-document",
      "list-documents",
      "update-document",
    ]);
    expect(result).toContain("## Tool index");
    expect(result).toContain("- document:");
    expect(result).toContain("create-document");
    expect(result).toContain("list-documents");
    expect(result).toContain("update-document");
  });

  it("strips leading verbs for grouping", () => {
    const result = formatToolIndex(["get-user", "list-user", "fetch-user"]);
    expect(result).toContain("- user:");
    expect(result).toContain("get-user");
  });

  it("singularizes group keys", () => {
    const result = formatToolIndex(["create-queries", "update-queries"]);
    // "queries" should singularize to "query"
    expect(result).toContain("- query:");
  });

  it("singularizes -ies to -y", () => {
    const result = formatToolIndex(["get-entities", "list-entities"]);
    expect(result).toContain("- entity:");
  });

  it("removes trailing -s (but not -ss)", () => {
    const result = formatToolIndex(["get-items", "list-items"]);
    expect(result).toContain("- item:");
  });

  it("does not remove -ss", () => {
    const result = formatToolIndex(["get-class", "list-class"]);
    expect(result).toContain("- class:");
  });

  it("groups MCP tools by server", () => {
    const result = formatToolIndex([
      "mcp__google_calendar__create_event",
      "mcp__google_calendar__list_events",
      "mcp__slack__send_message",
      "mcp__slack__read_thread",
    ]);
    expect(result).toContain("- mcp__google_calendar__*:");
    expect(result).toContain("mcp__google_calendar__create_event");
    expect(result).toContain("- mcp__slack__*:");
    expect(result).toContain("mcp__slack__send_message");
  });

  it("moves singleton groups to other", () => {
    const result = formatToolIndex([
      "create-document",
      "list-documents",
      "unique-tool",
    ]);
    // unique-tool should be in "other"
    expect(result).toContain("- other:");
    expect(result).toContain("unique-tool");
  });

  it("sorts group keys alphabetically", () => {
    const result = formatToolIndex([
      "create-zebra",
      "get-zebra",
      "create-alpha",
      "get-alpha",
      "create-mango",
      "get-mango",
    ]);
    const lines = result.split("\n");
    const groupLines = lines.filter((l) => l.startsWith("- "));
    // Should be sorted: alpha, mango, zebra (not other)
    expect(groupLines[0]).toContain("- alpha:");
    expect(groupLines[1]).toContain("- mango:");
    expect(groupLines[2]).toContain("- zebra:");
  });

  it("puts other at the end", () => {
    const result = formatToolIndex([
      "create-document",
      "get-document",
      "unique-tool",
    ]);
    const lines = result.split("\n");
    const lastGroupLine = lines.filter((l) => l.startsWith("- ")).pop();
    expect(lastGroupLine).toContain("- other:");
  });

  it("deduplicates tool names", () => {
    const result = formatToolIndex([
      "get-document",
      "get-document",
      "list-document",
    ]);
    // Should contain tool only once
    expect((result.match(/get-document/g) || []).length).toBe(1);
  });

  it("is deterministic for the same input", () => {
    const names = [
      "create-document",
      "list-documents",
      "get-user",
      "update-user",
      "mcp__slack__send_message",
    ];
    const result1 = formatToolIndex(names);
    const result2 = formatToolIndex([...names].reverse());
    expect(result1).toBe(result2);
  });

  it("handles underscore-separated names", () => {
    const result = formatToolIndex(["get_document", "list_documents"]);
    expect(result).toContain("- document:");
  });

  it("handles mixed separators", () => {
    const result = formatToolIndex(["get-document_item", "list-document_item"]);
    expect(result).toContain("- document:");
  });

  it("keeps the body within the budget by capping each topic", () => {
    const names = Array.from({ length: 20 }, (_, i) => `create_item_${i}`);
    const result = formatToolIndex(names, { maxChars: 120 });
    const body = result.split("\n\n")[1] ?? "";

    expect(body.length).toBeLessThanOrEqual(120);
    expect(body).toMatch(/^- item: create_item_0, .* \(\+\d+ more\)$/);
  });

  it("falls back to topic counts when even one name per topic does not fit", () => {
    const names = [
      ...Array.from({ length: 5 }, (_, i) => `list-dashboard-${i}`),
      ...Array.from({ length: 5 }, (_, i) => `get-report-${i}`),
    ];
    const result = formatToolIndex(names, { maxChars: 40 });

    expect(result).toContain("counts only");
    expect(result).toContain("- dashboard (5)");
    expect(result).toContain("- report (5)");
  });

  it("lists every name when the budget allows", () => {
    const names = Array.from({ length: 300 }, (_, i) => `get-widget-${i}`);
    const result = formatToolIndex(names);

    for (const name of names) expect(result).toContain(name);
    expect(result).not.toContain("more)");
  });

  it("handles all-MCP tools", () => {
    const result = formatToolIndex([
      "mcp__slack__send_message",
      "mcp__slack__read_thread",
      "mcp__gmail__send_email",
      "mcp__gmail__read_email",
    ]);
    expect(result).toContain("- mcp__slack__*:");
    expect(result).toContain("- mcp__gmail__*:");
  });

  it("includes header text", () => {
    const result = formatToolIndex(["get-document"]);
    expect(result).toContain("## Tool index");
    expect(result).toContain("These tools exist but are not loaded yet");
    expect(result).toContain("tool-search");
  });

  it("handles names with no leading verb", () => {
    const result = formatToolIndex(["document", "user", "team"]);
    // Each should be in "other" (singletons)
    expect(result).toContain("- other:");
    expect(result).toContain("document");
    expect(result).toContain("user");
    expect(result).toContain("team");
  });

  it("sorts tools within each group", () => {
    const result = formatToolIndex([
      "create-zebra",
      "create-alpha",
      "create-mango",
    ]);
    const lines = result.split("\n");
    const groupLine = lines.find((l) => l.startsWith("- create:"));
    if (groupLine) {
      const tools = groupLine
        .split(":")[1]
        .split(",")
        .map((s) => s.trim());
      expect(tools[0]).toBe("create-alpha");
      expect(tools[1]).toBe("create-mango");
      expect(tools[2]).toBe("create-zebra");
    }
  });

  it("handles long tool names", () => {
    const result = formatToolIndex([
      "get_very_long_tool_name_with_many_parts",
      "list_very_long_tool_name_with_many_parts",
    ]);
    expect(result).toContain("get_very_long_tool_name_with_many_parts");
  });

  it("keeps words that already end in s as their own topic name", () => {
    const result = formatToolIndex([
      "get-analysis",
      "save-analysis",
      "create-alias",
      "delete-alias",
      "list-analytics-keys",
      "get-analytics-rule",
    ]);

    expect(result).toContain("- analysis: get-analysis, save-analysis");
    expect(result).toContain("- alias: create-alias, delete-alias");
    expect(result).toContain(
      "- analytics: get-analytics-rule, list-analytics-keys",
    );
  });
});
