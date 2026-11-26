import { describe, expect, it } from "vitest";

import getObservabilityReviewApp from "./get-observability-review-app.js";
import getObservabilityReviewSummarySource from "./get-observability-review-summary-source.js";
import listObservabilityReviews from "./list-observability-reviews.js";
import saveObservabilityInstructionUpdate from "./save-observability-instruction-update.js";
import saveObservabilityReviewSummary from "./save-observability-review-summary.js";

describe("observability actions over MCP", () => {
  it.each([
    ["get-observability-review-app", getObservabilityReviewApp],
    [
      "get-observability-review-summary-source",
      getObservabilityReviewSummarySource,
    ],
    ["list-observability-reviews", listObservabilityReviews],
    [
      "save-observability-instruction-update",
      saveObservabilityInstructionUpdate,
    ],
    ["save-observability-review-summary", saveObservabilityReviewSummary],
  ] as const)("keeps %s in the app, off MCP", (_name, action) => {
    expect(action.mcpTool).toBe(false);
  });
});
