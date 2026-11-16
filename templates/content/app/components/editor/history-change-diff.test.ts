import type { DocumentHistoryPageState } from "@shared/document-history";
import { describe, expect, it } from "vitest";

import { historyChangeSpans } from "./history-change-diff";

function state(
  checkpointId: string,
  content: string,
): DocumentHistoryPageState {
  return { checkpointId, title: "Plan", content, createdAt: checkpointId };
}

describe("historyChangeSpans", () => {
  it("joins changes that followed one another and splits where someone edited between", () => {
    const one = state("1", "One");
    const two = state("2", "One A");
    const three = state("3", "One AB");
    const edited = state("4", "One AB by person");
    const four = state("5", "One AB by person, again");
    expect(
      historyChangeSpans([
        { before: one, after: two },
        { before: two, after: three },
        { before: edited, after: four },
      ]),
    ).toEqual([
      { before: one, after: three },
      { before: edited, after: four },
    ]);
  });

  it("finds no span in an entry without changes", () => {
    expect(historyChangeSpans([])).toEqual([]);
  });
});
