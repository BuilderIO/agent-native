import { describe, expect, it } from "vitest";

import action from "./apply-visual-edit.js";

const styleIntent = {
  kind: "style" as const,
  target: { selector: "main" },
  property: "color",
  value: "red",
};

describe("apply-visual-edit schema", () => {
  it("requires a design or file id for persisted design-file edits", () => {
    expect(
      action.schema.safeParse({
        source: { kind: "design-file" },
        intent: styleIntent,
      }).success,
    ).toBe(false);

    expect(
      action.schema.safeParse({
        source: { kind: "design-file", designId: "design_123" },
        intent: styleIntent,
      }).success,
    ).toBe(true);

    expect(
      action.schema.safeParse({
        source: { kind: "design-file", fileId: "file_123" },
        intent: styleIntent,
      }).success,
    ).toBe(true);
  });

  it("accepts optional activeBreakpoint param", () => {
    const base = {
      source: { kind: "design-file", designId: "d1" },
      intent: styleIntent,
    };

    // omitted — fine
    expect(action.schema.safeParse(base).success).toBe(true);

    // null — fine
    expect(
      action.schema.safeParse({ ...base, activeBreakpoint: null }).success,
    ).toBe(true);

    // valid prefix values
    for (const bp of ["base", "sm", "md", "lg", "xl", "2xl"] as const) {
      expect(
        action.schema.safeParse({ ...base, activeBreakpoint: bp }).success,
        `prefix "${bp}" should be valid`,
      ).toBe(true);
    }

    // invalid value
    expect(
      action.schema.safeParse({ ...base, activeBreakpoint: "3xl" }).success,
    ).toBe(false);
  });

  it("accepts optional activeFrameWidthPx param", () => {
    const base = {
      source: { kind: "design-file", designId: "d1" },
      intent: styleIntent,
    };

    expect(
      action.schema.safeParse({ ...base, activeFrameWidthPx: 768 }).success,
    ).toBe(true);

    expect(
      action.schema.safeParse({ ...base, activeFrameWidthPx: null }).success,
    ).toBe(true);

    // non-positive width is rejected
    expect(
      action.schema.safeParse({ ...base, activeFrameWidthPx: 0 }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({ ...base, activeFrameWidthPx: -1 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Breakpoint-aware class-edit integration (inline-html path, no DB needed)
// ---------------------------------------------------------------------------

const html = `<div id="card" class="text-sm p-4">Hello</div>`;

describe("apply-visual-edit breakpoint-aware class edits", () => {
  it("adds a class globally when no breakpoint is specified", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "font-bold",
      },
      includeContent: true,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("font-bold");
    // No breakpoint prefix on the added class
    expect(result.patchedContent).not.toContain("md:font-bold");
  });

  it("scopes an 'add' class edit to the md: prefix when activeBreakpoint=md", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "text-base",
      },
      includeContent: true,
      activeBreakpoint: "md",
    });

    expect(result.result.status).toBe("applied");
    // The class should be added with the md: prefix, not globally
    expect(result.patchedContent).toContain("md:text-base");
    // The base text-sm class should be untouched
    expect(result.patchedContent).toContain("text-sm");
  });

  it("derives the breakpoint from activeFrameWidthPx when activeBreakpoint is omitted", async () => {
    // 768px maps to "md:" prefix via widthToPrefix
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "text-lg",
      },
      includeContent: true,
      activeFrameWidthPx: 768,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("md:text-lg");
  });

  it("activeBreakpoint takes priority over activeFrameWidthPx", async () => {
    // activeBreakpoint=lg should win, even though 768px would normally be "md"
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "text-xl",
      },
      includeContent: true,
      activeBreakpoint: "lg",
      activeFrameWidthPx: 768,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("lg:text-xl");
    expect(result.patchedContent).not.toContain("md:text-xl");
  });

  it("writes unprefixed class when activeBreakpoint=base (same as no breakpoint)", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "rounded-lg",
      },
      includeContent: true,
      activeBreakpoint: "base",
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("rounded-lg");
    expect(result.patchedContent).not.toContain("base:rounded-lg");
  });

  it("scopes a 'replace' class edit to the active breakpoint", async () => {
    // The node already has text-sm; replacing text-sm → text-base at md:
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "replace",
        from: "text-sm",
        to: "text-base",
      },
      includeContent: true,
      activeBreakpoint: "md",
    });

    expect(result.result.status).toBe("applied");
    // replace at md: sets the md: utility (uses setPropertyClass)
    expect(result.patchedContent).toContain("md:text-base");
    // base text-sm should still be in the class string
    expect(result.patchedContent).toContain("text-sm");
  });

  it("scopes a 'remove' class edit to the active breakpoint prefix", async () => {
    const htmlWithOverride = `<div id="card" class="text-sm md:text-base p-4">Hello</div>`;

    const result = await action.run({
      source: { kind: "inline-html", html: htmlWithOverride },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "remove",
        className: "md:text-base",
      },
      includeContent: true,
      activeBreakpoint: "md",
    });

    expect(result.result.status).toBe("applied");
    // The md: override should be removed
    expect(result.patchedContent).not.toContain("md:text-base");
    // The base class should remain
    expect(result.patchedContent).toContain("text-sm");
  });

  it("passes 'set' operations through globally (no per-breakpoint analog)", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "set",
        classNames: ["p-8", "text-lg"],
      },
      includeContent: true,
      activeBreakpoint: "md",
    });

    expect(result.result.status).toBe("applied");
    // set replaces all classes globally (no md: prefix)
    expect(result.patchedContent).toContain('class="p-8 text-lg"');
  });

  it("does not affect non-class intents when breakpoint is set", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "style",
        target: { selector: "#card" },
        property: "color",
        value: "blue",
      },
      includeContent: true,
      activeBreakpoint: "lg",
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain('style="color: blue"');
  });
});
