import type {
  ContentRelationCandidate,
  ContentRelationshipItem,
} from "@shared/relationships";
import { describe, expect, it } from "vitest";

import {
  effectiveRelationshipBulkSelectionState,
  planRelationshipBulkChanges,
  relationshipBulkCandidates,
  relationshipBulkReadStatus,
  toggleRelationshipBulkIntent,
} from "./relationship-bulk";

function candidate(pageId: string): ContentRelationCandidate {
  return {
    pageId,
    title: pageId,
    context: {},
    slotObservationToken: `slot-${pageId}`,
  };
}

function edge(
  sourcePageId: string,
  targetPageId: string,
): ContentRelationshipItem {
  return {
    edgeId: `${sourcePageId}-${targetPageId}`,
    lineageId: `${sourcePageId}-${targetPageId}`,
    typeId: "contributors",
    typeVersionId: "contributors-v1",
    sourcePageId,
    targetPageId,
    direction: "outgoing",
    state: "active",
    observedActivationIds: [`activation-${sourcePageId}-${targetPageId}`],
    observationToken: `observation-${sourcePageId}-${targetPageId}`,
    slotObservationToken: `slot-${sourcePageId}`,
    source: { pageId: sourcePageId, title: sourcePageId, state: "active" },
    target: { pageId: targetPageId, title: targetPageId, state: "active" },
    relationship: {
      forwardLabel: "Contributors",
      inverseLabel: "Deliverables",
      label: "Contributors",
      forwardCardinality: "many",
    },
    routes: [],
  };
}

describe("relationship bulk selection", () => {
  it("adds a mixed candidate only to missing rows and preserves untouched people", () => {
    const edges = [edge("launch", "mira"), edge("social", "jo")];
    const candidates = relationshipBulkCandidates({
      candidates: [candidate("mira"), candidate("jo")],
      edges,
      selectedPageIds: ["launch", "social"],
      direction: "forward",
    });
    expect(
      candidates.map(({ pageId, selectionState }) => [pageId, selectionState]),
    ).toEqual([
      ["mira", "mixed"],
      ["jo", "mixed"],
    ]);

    const intent = toggleRelationshipBulkIntent({
      candidateId: "mira",
      candidates,
      intent: {},
      direction: "forward",
      forwardCardinality: "many",
    });
    const plan = planRelationshipBulkChanges({
      candidates,
      edges,
      selectedPageIds: ["launch", "social"],
      direction: "forward",
      forwardCardinality: "many",
      intent,
    });
    expect(plan.error).toBeNull();
    expect(plan.items).toMatchObject([
      {
        kind: "add",
        anchorPageId: "social",
        sourcePageId: "social",
        targetPageId: "mira",
      },
    ]);
  });

  it("collapses checked to off to checked into no net intent", () => {
    const candidates = relationshipBulkCandidates({
      candidates: [candidate("mira")],
      edges: [edge("launch", "mira"), edge("social", "mira")],
      selectedPageIds: ["launch", "social"],
      direction: "forward",
    });
    const off = toggleRelationshipBulkIntent({
      candidateId: "mira",
      candidates,
      intent: {},
      direction: "forward",
      forwardCardinality: "many",
    });
    const restored = toggleRelationshipBulkIntent({
      candidateId: "mira",
      candidates,
      intent: off,
      direction: "forward",
      forwardCardinality: "many",
    });
    expect(off).toEqual({ mira: false });
    expect(restored).toEqual({});
    expect(
      planRelationshipBulkChanges({
        candidates,
        edges: [edge("launch", "mira"), edge("social", "mira")],
        selectedPageIds: ["launch", "social"],
        direction: "forward",
        forwardCardinality: "many",
        intent: restored,
      }).items,
    ).toEqual([]);
  });

  it("rejects assigning one inverse max-one source to several selected rows", () => {
    const candidates = relationshipBulkCandidates({
      candidates: [candidate("mira")],
      edges: [],
      selectedPageIds: ["launch", "social"],
      direction: "inverse",
    });
    expect(
      planRelationshipBulkChanges({
        candidates,
        edges: [],
        selectedPageIds: ["launch", "social"],
        direction: "inverse",
        forwardCardinality: "one",
        intent: { mira: true },
      }),
    ).toEqual({ items: [], error: "inverse-max-one" });
  });

  it("keeps inverse max-one sources independently selectable for one row", () => {
    const candidates = relationshipBulkCandidates({
      candidates: [candidate("mira"), candidate("jo")],
      edges: [],
      selectedPageIds: ["launch"],
      direction: "inverse",
    });
    const mira = toggleRelationshipBulkIntent({
      candidateId: "mira",
      candidates,
      intent: {},
      direction: "inverse",
      forwardCardinality: "one",
    });
    const both = toggleRelationshipBulkIntent({
      candidateId: "jo",
      candidates,
      intent: mira,
      direction: "inverse",
      forwardCardinality: "one",
    });
    expect(both).toEqual({ mira: true, jo: true });
    expect(
      planRelationshipBulkChanges({
        candidates,
        edges: [],
        selectedPageIds: ["launch"],
        direction: "inverse",
        forwardCardinality: "one",
        intent: both,
      }).items,
    ).toMatchObject([
      { kind: "replace", sourcePageId: "mira", targetPageId: "launch" },
      { kind: "replace", sourcePageId: "jo", targetPageId: "launch" },
    ]);
  });

  it("keeps one coherent final target when forward max-one choices change", () => {
    const edges = [edge("launch", "mira"), edge("social", "mira")];
    const candidates = relationshipBulkCandidates({
      candidates: [candidate("mira"), candidate("jo"), candidate("sam")],
      edges,
      selectedPageIds: ["launch", "social"],
      direction: "forward",
    });
    const chooseJo = toggleRelationshipBulkIntent({
      candidateId: "jo",
      candidates,
      intent: {},
      direction: "forward",
      forwardCardinality: "one",
    });
    const chooseSam = toggleRelationshipBulkIntent({
      candidateId: "sam",
      candidates,
      intent: chooseJo,
      direction: "forward",
      forwardCardinality: "one",
    });

    expect(chooseSam).toEqual({ mira: false, sam: true });
    expect(
      candidates.map((item) =>
        effectiveRelationshipBulkSelectionState(item, chooseSam),
      ),
    ).toEqual(["none", "none", "all"]);
    expect(
      planRelationshipBulkChanges({
        candidates,
        edges,
        selectedPageIds: ["launch", "social"],
        direction: "forward",
        forwardCardinality: "one",
        intent: chooseSam,
      }).items,
    ).toMatchObject([
      { kind: "replace", anchorPageId: "launch", targetPageId: "sam" },
      { kind: "replace", anchorPageId: "social", targetPageId: "sam" },
    ]);
  });

  it("blocks errored and incomplete reads instead of exposing false unchecked states", () => {
    expect(
      relationshipBulkReadStatus([
        { isError: true },
        { isError: false, data: { nextCursor: null } },
      ]),
    ).toBe("unavailable");
    expect(
      relationshipBulkReadStatus([
        { isError: false, data: { nextCursor: "more" } },
      ]),
    ).toBe("unavailable");
    expect(relationshipBulkReadStatus([{ isError: false }])).toBe("loading");
    expect(
      relationshipBulkReadStatus([
        {
          isError: false,
          isPlaceholderData: true,
          data: { nextCursor: null },
        },
      ]),
    ).toBe("loading");
  });
});
