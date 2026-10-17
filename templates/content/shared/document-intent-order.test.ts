import { describe, expect, it } from "vitest";

import {
  compareDocumentBodyIntents,
  type CommittedDocumentBodyIntent,
  type DocumentBodyIntent,
} from "./document-intent-order.js";

const first: CommittedDocumentBodyIntent = {
  writerId: "browser:a",
  operationId: "a:1",
  generation: 1,
  authoredBaseRevision: 3,
  committedRevision: 4,
};

describe("document body intent order", () => {
  it("orders a successor after an observed predecessor", () => {
    const successor: DocumentBodyIntent = {
      writerId: "mcp:b",
      operationId: "b:1",
      authoredBaseRevision: 4,
    };
    expect(compareDocumentBodyIntents(successor, first)).toBe("incoming-after");
  });

  it("keeps later generations ahead when an older request arrives late", () => {
    const later = { ...first, operationId: "a:2", generation: 2 };
    expect(compareDocumentBodyIntents(first, later)).toBe("committed-after");
    expect(compareDocumentBodyIntents(later, first)).toBe("incoming-after");
  });

  it("uses a stable tie in both delivery orders for concurrent writers", () => {
    const other: CommittedDocumentBodyIntent = {
      writerId: "mcp:z",
      operationId: "z:1",
      authoredBaseRevision: 3,
      committedRevision: 4,
    };
    expect(compareDocumentBodyIntents(other, first)).toBe(
      "incoming-concurrent-wins",
    );
    expect(compareDocumentBodyIntents(first, other)).toBe(
      "committed-concurrent-wins",
    );
  });

  it("never promotes an exact retry to new intent", () => {
    expect(compareDocumentBodyIntents(first, first)).toBe("same");
  });
});
