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

    expect(action.schema.safeParse(base).success).toBe(true);

    expect(
      action.schema.safeParse({ ...base, activeBreakpoint: null }).success,
    ).toBe(true);

    for (const bp of ["base", "sm", "md", "lg", "xl", "2xl"] as const) {
      expect(
        action.schema.safeParse({ ...base, activeBreakpoint: bp }).success,
        `prefix "${bp}" should be valid`,
      ).toBe(true);
    }

    expect(
      action.schema.safeParse({ ...base, activeBreakpoint: "3xl" }).success,
    ).toBe(false);
  });

  it("accepts the source-backed Boolean Subtract intent with at least two operands", () => {
    const source = { kind: "inline-html" as const, html };
    expect(
      action.schema.safeParse({
        source,
        intent: { kind: "booleanSubtract", targetIds: ["base", "cutter"] },
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        source,
        intent: { kind: "booleanSubtract", targetIds: ["base"] },
      }).success,
    ).toBe(false);
  });

  it("accepts bounded measured wrap hints with relative offsets", () => {
    const source = { kind: "inline-html" as const, html };
    expect(
      action.schema.safeParse({
        source,
        intent: {
          kind: "wrapNodes",
          targetIds: ["first", "second"],
          sizeHints: {
            first: { width: 120, height: 80, left: -16, top: 24 },
            second: { width: 100, height: 60 },
          },
        },
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        source,
        intent: {
          kind: "wrapNodes",
          targetIds: ["first"],
          sizeHints: {
            first: { width: Number.POSITIVE_INFINITY, height: 60 },
          },
        },
      }).success,
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

    expect(
      action.schema.safeParse({ ...base, activeFrameWidthPx: 0 }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({ ...base, activeFrameWidthPx: -1 }).success,
    ).toBe(false);
  });
});

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
    expect(result.patchedContent).toContain("md:text-base");
    expect(result.patchedContent).toContain("text-sm");
  });

  it("derives the breakpoint from activeFrameWidthPx when activeBreakpoint is omitted", async () => {
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
    expect(result.patchedContent).toContain("md:text-base");
    expect(result.patchedContent).toContain("text-sm");
  });

  it("reports conflict for a breakpoint-scoped 'replace' when 'from' does not match the current utility (VE1 regression)", async () => {
    const htmlWithOverride = `<div id="card" class="text-sm md:text-base p-4">Hello</div>`;

    const result = await action.run({
      source: { kind: "inline-html", html: htmlWithOverride },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "replace",
        from: "text-lg", // does NOT match the current md: utility (text-base)
        to: "text-xl",
      },
      includeContent: true,
      activeBreakpoint: "md",
    });

    expect(result.result.status).toBe("conflict");
    expect(result.result.changed).toBe(false);
    expect(result.patchedContent).toBe(htmlWithOverride);
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
    expect(result.patchedContent).not.toContain("md:text-base");
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

describe("apply-visual-edit Framer-scoped edits (maxWidthPx)", () => {
  it("accepts the optional maxWidthPx param", () => {
    const base = {
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "text-lg",
      },
    };
    expect(action.schema.safeParse({ ...base, maxWidthPx: 809 }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({ ...base, maxWidthPx: 0 }).success).toBe(
      false,
    );
  });

  it("scopes a class edit to a desktop-down max-width bound", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "text-lg",
      },
      includeContent: true,
      maxWidthPx: 809,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("max-[809px]:text-lg");
    expect(result.patchedContent).toContain("text-sm");
  });

  it("scopes a raw-CSS style edit into the managed @media block", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "style",
        target: { selector: "#card" },
        property: "left",
        value: "137px",
      },
      includeContent: true,
      maxWidthPx: 809,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain(
      "<style data-agent-native-breakpoints>",
    );
    expect(result.patchedContent).toContain("@media (max-width: 809px)");
    expect(result.patchedContent).toContain("left: 137px;");
    expect(result.patchedContent).not.toContain('style="left');
  });

  it("routes a utility-valued style edit to a scoped class instead", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "style",
        target: { selector: "#card" },
        property: "fontSize",
        value: "text-lg",
      },
      includeContent: true,
      maxWidthPx: 809,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("max-[809px]:text-lg");
    expect(result.patchedContent).not.toContain(
      "data-agent-native-breakpoints",
    );
  });

  it("maxWidthPx takes priority over activeBreakpoint/activeFrameWidthPx", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "class",
        target: { selector: "#card" },
        operation: "add",
        className: "text-lg",
      },
      includeContent: true,
      maxWidthPx: 809,
      activeBreakpoint: "md",
      activeFrameWidthPx: 768,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("max-[809px]:text-lg");
    expect(result.patchedContent).not.toContain("md:text-lg");
  });

  it("supports the breakpoint-style intent directly", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: {
        kind: "breakpoint-style",
        target: { selector: "#card" },
        maxWidthPx: 1279,
        property: "top",
        value: "24px",
      },
      includeContent: true,
    });

    expect(result.result.status).toBe("applied");
    expect(result.patchedContent).toContain("@media (max-width: 1279px)");
    expect(result.patchedContent).toContain("top: 24px;");
  });
});

describe("apply-visual-edit batched intent failure", () => {
  it("returns a projection consistent with the rolled-back content when a later intent fails", async () => {
    const result = await action.run({
      source: { kind: "inline-html", html },
      intent: [
        {
          kind: "class",
          target: { selector: "#card" },
          operation: "add",
          className: "added-class",
        },
        {
          kind: "style",
          target: { selector: "#missing" },
          property: "color",
          value: "red",
        },
      ],
      includeContent: true,
    });

    expect(result.result.status).not.toBe("applied");
    expect(result.patchedContent).toBe(html);
    const cardNode = result.projection.nodes.find((node) =>
      node.selectors.includes("#card"),
    );
    expect(cardNode).toBeDefined();
    expect(cardNode?.classes).not.toContain("added-class");
  });
});
