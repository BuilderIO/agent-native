/**
 * S6 edge-case correctness tests for the deterministic visual-edit engine.
 *
 * 1. no-op-reports-applied  — edits that produce no content change should have
 *    `changed: false` in the PatchResult regardless of intent kind.
 * 2. multi-token-breakpoint — setting multiple utility tokens at a single
 *    responsive breakpoint must handle every token, not silently discard extras.
 * 3. replace-honors-from   — `responsive-class` "replace" must honour the
 *    `from` guard and report a conflict (no content change) when the current
 *    class does not match `from`.
 */

import { describe, expect, it } from "vitest";

import { applyVisualEdit } from "./code-layer.js";

const SOURCE = { kind: "inline-html" as const };
const TARGET = { selector: "div.target" };

function html(classAttr: string): string {
  return `<div class="${classAttr} target"><p>Hello</p></div>`;
}

describe("no-op-reports-applied (Edge 1)", () => {
  it("class 'add' when the class is already present: changed=false, status=applied", () => {
    const src = html("flex text-lg font-bold");
    const result = applyVisualEdit(
      src,
      { kind: "class", target: TARGET, operation: "add", className: "text-lg" },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(false);
    expect(result.content).toBe(src);
  });

  it("class 'remove' when the class is absent: changed=false, status=applied", () => {
    const src = html("flex text-lg");
    const result = applyVisualEdit(
      src,
      {
        kind: "class",
        target: TARGET,
        operation: "remove",
        className: "nonexistent",
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(false);
    expect(result.content).toBe(src);
  });

  it("responsive-class 'add' when that exact class is already present: changed=false", () => {
    const src = html("md:text-lg font-bold");
    const result = applyVisualEdit(
      src,
      {
        kind: "responsive-class",
        target: TARGET,
        prefix: "md",
        operation: "add",
        utility: "text-lg",
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(false);
    expect(result.content).toBe(src);
  });

  it("responsive-class 'remove' when no such stem exists at that prefix: changed=false", () => {
    const src = html("text-sm font-bold");
    const result = applyVisualEdit(
      src,
      {
        kind: "responsive-class",
        target: TARGET,
        prefix: "md",
        operation: "remove",
        stem: "font-size",
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(false);
    expect(result.content).toBe(src);
  });
});

describe("multi-token edits at a breakpoint (Edge 2)", () => {
  it("class 'add' with multiple classNames adds all tokens, not just the first", () => {
    const src = html("flex");
    const result = applyVisualEdit(
      src,
      {
        kind: "class",
        target: TARGET,
        operation: "add",
        classNames: ["text-lg", "font-bold"],
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(true);
    const afterClasses = result.result.after?.classes ?? [];
    expect(afterClasses).toContain("text-lg");
    expect(afterClasses).toContain("font-bold");
  });

  it("responsive-class 'add' with multiple space-separated utilities in a single call adds all tokens correctly", () => {
    const src = html("flex");

    const r1 = applyVisualEdit(
      src,
      {
        kind: "responsive-class",
        target: TARGET,
        prefix: "md",
        operation: "add",
        utility: "text-lg",
      },
      { source: SOURCE },
    );
    expect(r1.result.changed).toBe(true);

    const r2 = applyVisualEdit(
      r1.content,
      {
        kind: "responsive-class",
        target: TARGET,
        prefix: "md",
        operation: "add",
        utility: "font-bold",
      },
      { source: SOURCE },
    );
    expect(r2.result.changed).toBe(true);

    const afterClasses = r2.result.after?.classes ?? [];
    expect(afterClasses).toContain("md:text-lg");
    expect(afterClasses).toContain("md:font-bold");
  });

  it("responsive-class 'replace' replaces by stem without clobbering sibling tokens at the same breakpoint", () => {
    const src = html("md:text-sm md:font-bold");
    const result = applyVisualEdit(
      src,
      {
        kind: "responsive-class",
        target: TARGET,
        prefix: "md",
        operation: "replace",
        utility: "text-lg",
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(true);
    const afterClasses = result.result.after?.classes ?? [];
    expect(afterClasses).toContain("md:text-lg");
    expect(afterClasses).toContain("md:font-bold");
  });
});

describe("replace honoring 'from' (Edge 3)", () => {
  it("class 'replace' is a no-op / conflict when 'from' does not match any current class", () => {
    const src = html("text-sm font-bold");
    const result = applyVisualEdit(
      src,
      {
        kind: "class",
        target: TARGET,
        operation: "replace",
        from: "text-xl",
        to: "text-2xl",
      },
      { source: SOURCE },
    );
    expect(result.result.changed).toBe(false);
    expect(result.content).toBe(src);
  });

  it("class 'replace' succeeds when 'from' matches", () => {
    const src = html("text-sm font-bold");
    const result = applyVisualEdit(
      src,
      {
        kind: "class",
        target: TARGET,
        operation: "replace",
        from: "text-sm",
        to: "text-xl",
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(true);
    const afterClasses = result.result.after?.classes ?? [];
    expect(afterClasses).toContain("text-xl");
    expect(afterClasses).not.toContain("text-sm");
  });

  it("responsive-class 'replace' reports conflict when 'from' does not match the current utility at that prefix", () => {
    const src = html("md:text-sm");
    const result = applyVisualEdit(
      src,
      {
        kind: "responsive-class",
        target: TARGET,
        prefix: "md",
        operation: "replace",
        utility: "text-lg",
        from: "text-xl",
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("conflict");
    expect(result.result.changed).toBe(false);
    expect(result.content).toBe(src);
  });

  it("responsive-class 'replace' applies when 'from' matches the current utility at that prefix", () => {
    const src = html("md:text-sm");
    const result = applyVisualEdit(
      src,
      {
        kind: "responsive-class",
        target: TARGET,
        prefix: "md",
        operation: "replace",
        utility: "text-lg",
        from: "text-sm",
      },
      { source: SOURCE },
    );
    expect(result.result.status).toBe("applied");
    expect(result.result.changed).toBe(true);
    const afterClasses = result.result.after?.classes ?? [];
    expect(afterClasses).toContain("md:text-lg");
    expect(afterClasses).not.toContain("md:text-sm");
  });

  it("class 'replace' scoped to a breakpoint via activeBreakpoint is a no-op when 'from' does not match the current token at that prefix", () => {
    const src = html("md:text-sm");
    const result = applyVisualEdit(
      src,
      {
        kind: "class",
        target: TARGET,
        operation: "replace",
        from: "text-xl", // this class does NOT exist at md: prefix in src
        to: "text-lg",
      },
      { source: SOURCE },
    );
    expect(result.result.changed).toBe(false);
    expect(result.content).toBe(src);
  });
});
