import type {
  ContentRelationshipHistoryChange,
  ContentRelationshipHistoryItem,
  ContentRelationshipItem,
  RelationshipTypeVersion,
} from "@shared/relationships";
import { describe, expect, it } from "vitest";

import {
  relationshipHistoryAuthorizingPrincipal,
  relationshipHistoryChangeDisplayText,
  relationshipOppositeEndpoint,
  relationshipPickerCandidates,
  relationshipPropertyRemovalMode,
  relationshipPropertyRemovalOperation,
} from "./ContentRelationships";
import { relationshipDirectionForDatabase } from "./RelationPropertyConfigurationDialog";

const edge = {
  sourcePageId: "deliverable",
  targetPageId: "person",
  source: { pageId: "deliverable", title: "Launch article", state: "active" },
  target: { pageId: "person", title: "Mira Chen", state: "active" },
} as ContentRelationshipItem;

describe("relationship UI helpers", () => {
  it("resolves the opposite Page without depending on database membership", () => {
    expect(relationshipOppositeEndpoint(edge, "deliverable")).toEqual(
      edge.target,
    );
    expect(relationshipOppositeEndpoint(edge, "person")).toEqual(edge.source);
  });

  it("binds an existing type in the direction owned by the database", () => {
    const version = {
      sourceDatabaseId: "deliverables",
      targetDatabaseId: "people",
    } as RelationshipTypeVersion;

    expect(relationshipDirectionForDatabase(version, "deliverables")).toBe(
      "forward",
    );
    expect(relationshipDirectionForDatabase(version, "people")).toBe("inverse");
    expect(relationshipDirectionForDatabase(version, "campaigns")).toBeNull();
  });

  it("keeps a suspended selected Page removable when it is absent from candidates", () => {
    expect(
      relationshipPickerCandidates(
        [],
        [
          {
            ...edge,
            state: "suspended",
            slotObservationToken: "slot-observation",
          } as ContentRelationshipItem,
        ],
        "deliverable",
      ),
    ).toEqual([
      {
        pageId: "person",
        title: "Mira Chen",
        context: {},
        slotObservationToken: "slot-observation",
      },
    ]);
  });

  it("derives relationship history copy from safe labels instead of identifiers", () => {
    const change = {
      eventId: "event-secret-id",
      kind: "replaced",
      relationshipTypeId: "type-secret-id",
      relationshipLabel: "Contributors",
      source: { pageId: "source-secret-id", title: "Launch article" },
      target: { pageId: "target-secret-id", title: "Mira Chen" },
      previousTarget: {
        pageId: "previous-secret-id",
        title: "Jordan Lee",
      },
    } satisfies ContentRelationshipHistoryChange;

    const text = relationshipHistoryChangeDisplayText(change);
    expect(text).toEqual({
      endpoints: "Launch article → Mira Chen",
      relationship: "Contributors",
      previousTarget: "Jordan Lee",
    });
    expect(JSON.stringify(text)).not.toContain("secret-id");
  });

  it("shows an agent's authorizing principal separately without duplicating a person", () => {
    const historyItem = {
      actor: {
        kind: "agent",
        displayName: "Editorial agent",
        networkProtocol: "a2a",
      },
      authorizingPrincipal: {
        kind: "user",
        email: "alice@example.test",
      },
    } as Pick<ContentRelationshipHistoryItem, "actor" | "authorizingPrincipal">;
    expect(relationshipHistoryAuthorizingPrincipal(historyItem)).toBe(
      "alice@example.test",
    );
    expect(
      relationshipHistoryAuthorizingPrincipal({
        actor: {
          kind: "person",
          displayName: "alice@example.test",
          email: "alice@example.test",
        },
        authorizingPrincipal: {
          kind: "user",
          email: "alice@example.test",
        },
      }),
    ).toBeNull();
  });

  it("removes checked relationships against the original Property preview", () => {
    expect(
      relationshipPropertyRemovalMode({
        keep: false,
        selectionReceipt: "property-preview-receipt",
        selectedEdgeIds: ["edge-a", "edge-b"],
      }),
    ).toEqual({
      kind: "remove-selected",
      selectionReceipt: "property-preview-receipt",
      edgeIds: ["edge-a", "edge-b"],
    });
  });

  it("never turns an incomplete destructive selection into keep", () => {
    expect(
      relationshipPropertyRemovalMode({
        keep: false,
        selectionReceipt: undefined,
        selectedEdgeIds: ["edge-a"],
      }),
    ).toBeNull();
    expect(
      relationshipPropertyRemovalMode({
        keep: false,
        selectionReceipt: "property-preview-receipt",
        selectedEdgeIds: [],
      }),
    ).toBeNull();
    expect(
      relationshipPropertyRemovalMode({
        keep: true,
        selectionReceipt: undefined,
        selectedEdgeIds: [],
      }),
    ).toEqual({ kind: "keep" });
  });

  it("reuses an operation ID only while retrying the same removal", () => {
    let nextId = 0;
    const createOperationId = () => `operation-${++nextId}`;
    const mode = {
      kind: "remove-selected" as const,
      selectionReceipt: "property-preview-receipt",
      edgeIds: ["edge-a"],
    };
    const first = relationshipPropertyRemovalOperation(
      null,
      "property-a",
      mode,
      createOperationId,
    );

    expect(
      relationshipPropertyRemovalOperation(
        first,
        "property-a",
        mode,
        createOperationId,
      ).operationId,
    ).toBe("operation-1");
    expect(
      relationshipPropertyRemovalOperation(
        first,
        "property-a",
        { ...mode, edgeIds: ["edge-b"] },
        createOperationId,
      ).operationId,
    ).toBe("operation-2");
  });
});
