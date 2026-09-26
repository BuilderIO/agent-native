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

  it("turns text axe could not judge into a failure or a pass once its background is measured", () => {
    const low = element(
      '<div data-slide-object-id="low"><p>Low</p></div>',
      "p",
    );
    const ok = element("<p>Ok</p>", "p");
    const glyph = element("<p>Icon</p>", "p");
    const measurement = (ratio: number) => ({
      foreground: "#777777",
      background: "#ffffff",
      ratio,
      requiredRatio: 4.5,
      fontSize: "12.0pt (16px)",
      fontWeight: "400",
    });
    const mapped = mapAxeContrastResults(
      results({
        incomplete: [
          rule([
            node({ messageKey: "bgOverlap" }, low),
            node({ messageKey: "bgGradient" }, ok),
            node({ messageKey: "nonBmp" }, glyph),
          ]),
        ],
      }),
      "slide-1",
      (target) => measurement(target === low ? 4.47 : 7),
    );
    expect(mapped.failures).toEqual([
      {
        slideId: "slide-1",
        objectId: "low",
        text: "Low",
        ...measurement(4.47),
      },
    ]);
    expect(mapped.unverified).toEqual([
      { slideId: "slide-1", text: "Icon", reason: "nonBmp" },
    ]);
    expect(mapped.checkedNodeCount).toBe(3);
  });

  it("keeps text unverified when its background cannot be measured", () => {
    const text = element("<p>Over photo</p>", "p");
    const mapped = mapAxeContrastResults(
      results({ incomplete: [rule([node({ messageKey: "bgImage" }, text)])] }),
      "slide-1",
      () => null,
    );
    expect(mapped.failures).toEqual([]);
    expect(mapped.unverified).toEqual([
      { slideId: "slide-1", text: "Over photo", reason: "bgImage" },
    ]);
  });
});
