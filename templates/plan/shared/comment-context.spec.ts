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
      "Target point: 18% across / 46% down",
    ]);
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
