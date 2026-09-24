// @vitest-environment jsdom
import type { AxeResults, NodeResult, Result } from "axe-core";
import { describe, expect, it } from "vitest";

import { mapAxeContrastResults } from "./contrast-audit";

function element(html: string, selector: string): Element {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root.querySelector(selector)!;
}

function node(data: Record<string, unknown>, target: Element): NodeResult {
  return {
    html: target.outerHTML,
    target: ["p"],
    element: target as HTMLElement,
    any: [
      {
        id: "color-contrast",
        data,
        relatedNodes: [],
        impact: "serious",
        message: "",
      },
    ],
    all: [],
    none: [],
  } as unknown as NodeResult;
}

function rule(nodes: NodeResult[], id = "color-contrast"): Result {
  return { id, nodes } as unknown as Result;
}

function results(
  groups: Partial<Pick<AxeResults, "violations" | "incomplete" | "passes">>,
) {
  return { violations: [], incomplete: [], passes: [], ...groups };
}

describe("mapAxeContrastResults", () => {
  it("maps a violation to measured and required ratios on its slide object", () => {
    const caption = element(
      '<div data-slide-object-id="obj-7"><p>  Muted\n caption  </p></div>',
      "p",
    );
    const mapped = mapAxeContrastResults(
      results({
        violations: [
          rule([
            node(
              {
                fgColor: "#aaaaaa",
                bgColor: "#ffffff",
                contrastRatio: 2.32,
                fontSize: "12.0pt (16px)",
                fontWeight: "normal",
                expectedContrastRatio: "4.5:1",
              },
              caption,
            ),
          ]),
        ],
      }),
      "slide-1",
    );
    expect(mapped.failures).toEqual([
      {
        slideId: "slide-1",
        objectId: "obj-7",
        text: "Muted caption",
        foreground: "#aaaaaa",
        background: "#ffffff",
        ratio: 2.32,
        requiredRatio: 4.5,
        fontSize: "12.0pt (16px)",
        fontWeight: "normal",
      },
    ]);
    expect(mapped.checkedNodeCount).toBe(1);
  });
});
