/**
 * apply-a11y-fix.spec.ts
 *
 * Covers:
 *  - the pure finding→edit mapping (`a11yFindingToEdit` / `isA11yFindingAutoFixable`)
 *  - the produced HTML when the mapped edit is run through the shared
 *    `applyVisualEdit` primitive (exactly what the action does internally)
 *  - the action schema (target requirement, defaults)
 *  - the action's "not auto-fixable" early-return branch (no DB needed)
 *
 * The persisted DB path (resolveEditableDesignFile / persistDesignFileEdit)
 * requires a live DB + collab runtime and is not exercised here; the mapping +
 * applyVisualEdit composition fully determines the content that path writes.
 */

import { describe, expect, it } from "vitest";

import { applyVisualEdit, type EditIntent } from "../shared/code-layer.js";
import {
  a11yFindingToEdit,
  isA11yFindingAutoFixable,
  type A11yFinding,
} from "../shared/design-review.js";
import action from "./apply-a11y-fix.js";
import { checkTapTargets } from "./run-design-audit.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function finding(partial: Partial<A11yFinding>): A11yFinding {
  return {
    id: "x",
    severity: "warning",
    category: "other",
    message: "",
    fixAvailable: false,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Mapping: which findings are auto-fixable, and to what edit
// ---------------------------------------------------------------------------

describe("a11yFindingToEdit mapping", () => {
  it("maps a contrast finding to a style color edit (default near-black)", () => {
    const plan = a11yFindingToEdit(
      finding({
        id: "contrast:node-1",
        category: "contrast",
        nodeId: "html:abc",
      }),
    );
    expect(plan).not.toBeNull();
    expect(plan?.edit).toMatchObject({
      kind: "style",
      property: "color",
      value: "#111827",
      target: { nodeId: "html:abc" },
    });
    expect(plan?.label).toBe("Raise text contrast");
  });

  it("honors a caller-supplied replacement color for contrast fixes", () => {
    const plan = a11yFindingToEdit(
      finding({ category: "contrast", selector: "p.lead" }),
      { color: "#0f172a" },
    );
    expect(plan?.edit).toMatchObject({
      kind: "style",
      property: "color",
      value: "#0f172a",
      target: { selector: "p.lead" },
    });
  });

  it("maps a tap-target finding to a min-size class add", () => {
    const plan = a11yFindingToEdit(
      finding({ category: "tap-target", nodeId: "html:btn" }),
    );
    expect(plan?.edit).toMatchObject({
      kind: "class",
      operation: "add",
      classNames: ["min-h-[44px]", "min-w-[44px]"],
    });
    expect(plan?.label).toBe("Enlarge tap target");
  });

  it("maps a focus-visibility finding to a focus-visible ring class add", () => {
    const plan = a11yFindingToEdit(
      finding({ category: "focus-visibility", selector: "a.cta" }),
    );
    expect(plan?.edit).toMatchObject({
      kind: "class",
      operation: "add",
      classNames: ["focus-visible:ring-2"],
    });
  });

  it("returns null for attribute-only fixes (missing-alt, missing-label)", () => {
    expect(
      a11yFindingToEdit(
        finding({ category: "missing-alt", nodeId: "html:img" }),
      ),
    ).toBeNull();
    expect(
      a11yFindingToEdit(
        finding({ category: "missing-label", selector: "input#email" }),
      ),
    ).toBeNull();
  });

  it("returns null for reduced-motion / role / other", () => {
    expect(
      a11yFindingToEdit(
        finding({ category: "reduced-motion", nodeId: "html:hero" }),
      ),
    ).toBeNull();
    expect(
      a11yFindingToEdit(finding({ category: "role", nodeId: "html:x" })),
    ).toBeNull();
  });

  it("returns null when the finding has no node id or selector to anchor to", () => {
    expect(a11yFindingToEdit(finding({ category: "contrast" }))).toBeNull();
    expect(isA11yFindingAutoFixable(finding({ category: "tap-target" }))).toBe(
      false,
    );
  });

  it("isA11yFindingAutoFixable agrees with a11yFindingToEdit", () => {
    const fixable = finding({ category: "contrast", nodeId: "html:n" });
    const notFixable = finding({ category: "missing-alt", nodeId: "html:n" });
    expect(isA11yFindingAutoFixable(fixable)).toBe(true);
    expect(isA11yFindingAutoFixable(notFixable)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Produced content: run the mapped edit through the shared primitive
// ---------------------------------------------------------------------------

describe("apply-a11y-fix produced content (via applyVisualEdit)", () => {
  function applyPlan(html: string, f: A11yFinding, color?: string) {
    const plan = a11yFindingToEdit(f, color ? { color } : undefined);
    if (!plan) throw new Error("expected a fixable finding");
    return applyVisualEdit(html, plan.edit as EditIntent, {
      source: { kind: "inline-html" },
    });
  }

  it("writes an inline color style for a contrast fix", () => {
    const html = `<p data-agent-native-node-id="p1" class="text-white">Hi</p>`;
    const f = finding({
      category: "contrast",
      nodeId: undefined,
      selector: 'p[data-agent-native-node-id="p1"]',
    });
    const out = applyPlan(html, f);
    expect(out.result.status).toBe("applied");
    expect(out.result.changed).toBe(true);
    expect(out.content).toContain("color: #111827");
  });

  it("adds min-size classes for a tap-target fix without dropping existing classes", () => {
    const html = `<button data-agent-native-node-id="b1" class="h-4 px-2">Go</button>`;
    const f = finding({
      category: "tap-target",
      selector: 'button[data-agent-native-node-id="b1"]',
    });
    const out = applyPlan(html, f);
    expect(out.result.status).toBe("applied");
    expect(out.content).toContain("min-h-[44px]");
    expect(out.content).toContain("min-w-[44px]");
    // existing classes are preserved
    expect(out.content).toContain("h-4");
    expect(out.content).toContain("px-2");
  });

  it("adds a focus-visible ring class for a focus-visibility fix", () => {
    const html = `<a data-agent-native-node-id="a1" class="outline-none">x</a>`;
    const f = finding({
      category: "focus-visibility",
      selector: 'a[data-agent-native-node-id="a1"]',
    });
    const out = applyPlan(html, f);
    expect(out.result.status).toBe("applied");
    expect(out.content).toContain("focus-visible:ring-2");
  });
});

// ---------------------------------------------------------------------------
// Audit↔fix loop: a tap-target fix must stop the finding from re-appearing
// (regression for the "click Fix → Fixed → finding reappears on re-audit" bug)
// ---------------------------------------------------------------------------

describe("tap-target fix clears on re-audit", () => {
  it("re-flags nothing after the inline min-size fix is applied", () => {
    const html = `<button data-agent-native-node-id="b1" class="h-4 px-2">Go</button>`;

    // 1. Audit flags the tiny tap target.
    const before = checkTapTargets(html);
    expect(before).toHaveLength(1);
    expect(before[0]?.category).toBe("tap-target");

    // 2. Apply the inline auto-fix the Review panel uses.
    const plan = a11yFindingToEdit(
      finding({
        category: "tap-target",
        selector: 'button[data-agent-native-node-id="b1"]',
      }),
    );
    if (!plan) throw new Error("expected a fixable finding");
    const fixed = applyVisualEdit(html, plan.edit as EditIntent, {
      source: { kind: "inline-html" },
    });
    expect(fixed.content).toContain("min-h-[44px]");
    // The original tiny class is still present — the fix only adds min-sizes.
    expect(fixed.content).toContain("h-4");

    // 3. Re-audit the fixed content: the finding must be gone (previously it
    //    persisted because min-h-[44px] wasn't recognised as satisfying 44px).
    expect(checkTapTargets(fixed.content)).toHaveLength(0);
  });

  it("treats equivalent ≥44px min-size declarations as satisfying the floor", () => {
    // Arbitrary rem/em values, the Tailwind spacing scale, and full-bleed mins.
    expect(
      checkTapTargets(
        `<button class="h-4 min-h-[2.75rem] min-w-[2.75rem]">a</button>`,
      ),
    ).toHaveLength(0);
    expect(
      checkTapTargets(`<a class="h-5 min-h-11 min-w-11">b</a>`),
    ).toHaveLength(0);
    expect(
      checkTapTargets(`<button class="h-4 min-h-full min-w-full">c</button>`),
    ).toHaveLength(0);
  });

  it("still flags a tiny target whose min-size is below 44px", () => {
    // min-h-[24px] / min-h-5 (20px) must NOT silence the warning.
    expect(
      checkTapTargets(
        `<button class="h-4 min-h-[24px] min-w-[24px]">x</button>`,
      ),
    ).toHaveLength(1);
    expect(
      checkTapTargets(`<a class="h-4 min-h-5 min-w-5">y</a>`),
    ).toHaveLength(1);
  });

  it("flags tiny form controls as tap targets too", () => {
    expect(
      checkTapTargets(`<input class="h-4 w-4" aria-label="Name" />`),
    ).toHaveLength(1);
    expect(
      checkTapTargets(
        `<select class="h-5 w-5" aria-label="Sort"><option>A</option></select>`,
      ),
    ).toHaveLength(1);
    expect(
      checkTapTargets(
        `<textarea class="h-5 w-5" aria-label="Notes"></textarea>`,
      ),
    ).toHaveLength(1);
    expect(
      checkTapTargets(`<input type="hidden" class="h-4 w-4" />`),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Action schema
// ---------------------------------------------------------------------------

describe("apply-a11y-fix schema", () => {
  it("requires the finding to carry a node id or selector", () => {
    expect(
      action.schema.safeParse({
        designId: "d1",
        finding: { id: "x", severity: "warning", category: "contrast" },
      }).success,
    ).toBe(false);

    expect(
      action.schema.safeParse({
        designId: "d1",
        finding: {
          id: "x",
          severity: "warning",
          category: "contrast",
          nodeId: "html:n",
        },
      }).success,
    ).toBe(true);
  });

  it("defaults filename to index.html", () => {
    const parsed = action.schema.safeParse({
      designId: "d1",
      finding: {
        id: "x",
        severity: "error",
        category: "tap-target",
        selector: "button",
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.filename).toBe("index.html");
  });
});

// ---------------------------------------------------------------------------
// Action run: not-auto-fixable early return (no DB access)
// ---------------------------------------------------------------------------

describe("apply-a11y-fix run — non-fixable finding", () => {
  it("reports autoFixable:false and does not write for attribute-only findings", async () => {
    const res = (await action.run({
      designId: "d1",
      filename: "index.html",
      includeContent: false,
      finding: {
        id: "missing-alt:img-0",
        severity: "error",
        category: "missing-alt",
        message: "<img> is missing an alt attribute.",
        nodeId: "html:img",
        fixAvailable: false,
      },
    })) as { applied: boolean; autoFixable: boolean; reason?: string };

    expect(res.applied).toBe(false);
    expect(res.autoFixable).toBe(false);
    expect(res.reason).toMatch(/not auto-fixable/i);
  });
});
