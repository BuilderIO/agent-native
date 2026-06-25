import { describe, expect, it } from "vitest";

import {
  extractCommentMentions,
  formatPlanCommentAnchorForAgent,
  formatPlanCommentMentionToken,
  parsePlanCommentAnchor,
  planCommentAnchorDetails,
} from "./comment-context.js";

describe("plan comment context helpers", () => {
  it("formats text anchors with resolver and target details for agents", () => {
    const anchor = parsePlanCommentAnchor(
      JSON.stringify({
        x: 12,
        y: 34,
        anchorKind: "text",
        sectionTitle: "Implementation",
        textQuote: "Update the run manager copy",
        targetSelector: '[data-block-id="impl"] p:nth-of-type(2)',
        targetX: 18,
        targetY: 46,
        targetKind: "text",
        targetText: "Update the run manager copy in the sidebar.",
        resolutionTarget: "human",
        screenId: "confirm",
      }),
    );

    expect(formatPlanCommentAnchorForAgent(anchor)).toBe(
      'Implementation: "Update the run manager copy"',
    );
    expect(planCommentAnchorDetails(anchor)).toEqual([
      "Expected resolver: human reviewer",
      'Location: Implementation: "Update the run manager copy"',
      'Target: kind=text, text="Update the run manager copy in the sidebar."',
      "Prototype screen: confirm",
      'Selector: [data-block-id="impl"] p:nth-of-type(2)',
      "Target point: 18% across / 46% down within the text",
    ]);
  });

  it("formats a visual anchor with targetNodeId and targetNodePath", () => {
    const anchor = parsePlanCommentAnchor(
      JSON.stringify({
        anchorKind: "visual",
        targetKind: "wireframe",
        visualX: 18,
        visualY: 46,
        targetNodeId: "node_abc123",
        targetNodePath: 'card > list > listItem "Acme Inc"',
        sectionTitle: "Dashboard",
      }),
    );

    expect(formatPlanCommentAnchorForAgent(anchor)).toBe(
      'Dashboard: card > list > listItem "Acme Inc" at 18% across / 46% down within the wireframe',
    );
    expect(planCommentAnchorDetails(anchor)).toEqual(
      expect.arrayContaining([
        'Wireframe node: id="node_abc123" (addressable by wireframe/design patch ops), path: card > list > listItem "Acme Inc"',
      ]),
    );
  });

  it("formats a canvas anchor with board dimensions", () => {
    const anchor = parsePlanCommentAnchor(
      JSON.stringify({
        anchorKind: "visual",
        markupType: "callout",
        planAnnotationId: "ann_xyz",
        visualLabel: "Login screen",
        canvasX: 121,
        canvasY: 240,
        canvasWidth: 1600,
        canvasHeight: 900,
        x: 7,
        y: 26,
      }),
    );

    expect(formatPlanCommentAnchorForAgent(anchor)).toBe(
      "Login screen callout at canvas 121, 240 of 1600 x 900 board px",
    );
    expect(planCommentAnchorDetails(anchor)).toEqual(
      expect.arrayContaining([
        "Canvas point: canvas 121, 240 of 1600 x 900 board px",
      ]),
    );
  });

  it("formats an enriched pinned fallback when x/y are present but anchorKind is not point", () => {
    const anchor = parsePlanCommentAnchor(
      JSON.stringify({
        x: 12,
        y: 40,
      }),
    );

    expect(formatPlanCommentAnchorForAgent(anchor)).toBe(
      "Pinned at 12% across / 40% down of the full plan document",
    );
  });

  it("formats document coordinates for a bare point anchor", () => {
    const anchor = parsePlanCommentAnchor(
      JSON.stringify({ anchorKind: "point", x: 10, y: 20 }),
    );

    expect(formatPlanCommentAnchorForAgent(anchor)).toBe(
      "Pinned at 10% across / 20% down of the full plan document",
    );
  });

  it("returns Pinned to plan only for an anchor with no location at all", () => {
    const anchor = parsePlanCommentAnchor(JSON.stringify({ ambiguous: false }));

    expect(formatPlanCommentAnchorForAgent(anchor)).toBe("Pinned to plan");
  });

  it("serializes and extracts mention chips from readable comment text", () => {
    const token = formatPlanCommentMentionToken({
      label: "Tiana",
      email: "tiana@example.com",
    });

    expect(token).toBe("@[Tiana](mailto:tiana%40example.com)");
    expect(extractCommentMentions(`Please check ${token}`)).toEqual([
      { label: "Tiana", email: "tiana@example.com" },
    ]);
  });
});
