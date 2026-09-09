// @vitest-environment happy-dom

import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import type { ContentRelationshipItem } from "@shared/relationships";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relationshipMocks = vi.hoisted(() => ({
  relationships: {} as Record<string, unknown>,
  candidates: {} as Record<string, unknown>,
  types: {} as Record<string, unknown>,
  mutateAsync: vi.fn(),
  clearFailedRequest: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (value: string) => value,
    formatNumber: (value: number) => String(value),
  }),
  useT: () => (key: string) =>
    ({
      "relationships.loadFailed": "Relationships could not be loaded.",
      "relationships.tryAgain": "Try again",
      "relationships.searchPages": "Search pages...",
      "relationships.noMatchingPages": "No matching pages",
      "relationships.cancel": "Cancel",
      "relationships.apply": "Apply",
    })[key] ?? key,
}));

vi.mock("@/hooks/use-relationship-app-state", () => ({
  useRelationshipAppState: () => undefined,
}));

vi.mock("@/hooks/use-content-relationships", () => ({
  canonicalRelationOptions: () => ({
    kind: "canonical",
    relationshipTypeId: "contributors",
    projectionId: "contributors-property",
    direction: "forward",
    editable: true,
  }),
  contentRelationshipOperationId: () => "operation-1",
  isSupersededRelationshipMutationError: () => false,
  relationshipMutationErrorMessage: (error: Error) => error.message,
  useContentRelationships: () => relationshipMocks.relationships,
  useContentRelationCandidates: () => relationshipMocks.candidates,
  useContentRelationshipTypes: () => relationshipMocks.types,
  useMutateContentRelationships: () => ({
    mutateAsync: relationshipMocks.mutateAsync,
    retryFailed: vi.fn(),
    clearFailedRequest: relationshipMocks.clearFailedRequest,
    failedVariables: null,
    isPending: false,
  }),
  useContentRelationshipHistory: vi.fn(),
  usePrepareContentRelationshipRemoval: vi.fn(),
  useRemoveContentRelationProperty: vi.fn(),
  useUndoContentRelationshipRevision: vi.fn(),
}));

import { RelationBulkValueEditor } from "./ContentRelationships";

const property = {
  definition: {
    id: "contributors-property",
    databaseId: "deliverables",
    name: "Contributors",
    type: "relation",
    options: {},
  },
  value: null,
  editable: true,
} as DocumentProperty;

const selectedItems = ["launch", "social"].map(
  (pageId) =>
    ({
      id: `item-${pageId}`,
      databaseId: "deliverables",
      document: {
        id: pageId,
        parentId: null,
        title: pageId,
        content: "",
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z",
      },
      position: 0,
      properties: [],
    }) satisfies ContentDatabaseItem,
);

function edge(
  sourcePageId = "launch",
  activationIds = [`activation-${sourcePageId}`],
): ContentRelationshipItem {
  return {
    edgeId: `${sourcePageId}-mira`,
    lineageId: `${sourcePageId}-mira`,
    typeId: "contributors",
    typeVersionId: "contributors-v1",
    sourcePageId,
    targetPageId: "mira",
    direction: "outgoing",
    state: "active",
    observedActivationIds: activationIds,
    observationToken: `observation-${activationIds.join("-")}`,
    slotObservationToken: `slot-${sourcePageId}`,
    source: { pageId: sourcePageId, title: sourcePageId, state: "active" },
    target: { pageId: "mira", title: "Mira", state: "active" },
    relationship: {
      forwardLabel: "Contributors",
      inverseLabel: "Deliverables",
      label: "Contributors",
      forwardCardinality: "many",
    },
    routes: [
      {
        kind: "forward-property",
        propertyId: "contributors-property",
        sourcePageId,
      },
    ],
  };
}

function readyQuery(data: unknown) {
  return {
    data,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  };
}

describe("RelationBulkValueEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    relationshipMocks.mutateAsync.mockReset();
    relationshipMocks.mutateAsync.mockResolvedValue({ results: [] });
    relationshipMocks.clearFailedRequest.mockReset();
    relationshipMocks.candidates = readyQuery({
      scope: "viewer-accessible",
      items: [
        {
          pageId: "mira",
          title: "Mira",
          context: {},
          slotObservationToken: null,
        },
      ],
      slotObservationToken: null,
      nextCursor: null,
    });
    relationshipMocks.types = readyQuery({
      scope: "viewer-accessible",
      items: [
        {
          type: { id: "contributors" },
          version: { id: "contributors-v1", forwardCardinality: "many" },
          projections: [],
          capabilities: {},
        },
      ],
      nextCursor: null,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function render() {
    act(() => {
      root.render(
        <RelationBulkValueEditor
          property={property}
          selectedItems={selectedItems}
          disabled={false}
          onDone={vi.fn()}
        />,
      );
    });
  }

  it("visibly blocks an errored baseline instead of rendering unchecked rows", () => {
    relationshipMocks.relationships = {
      data: undefined,
      isError: true,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
    render();

    expect(container.textContent).toContain(
      "Relationships could not be loaded.",
    );
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    expect(
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Apply",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("renders a dash for mixed membership", () => {
    relationshipMocks.relationships = readyQuery({
      scope: "viewer-accessible",
      items: [edge()],
      nextCursor: null,
    });
    render();

    const checkbox = container.querySelector(
      '[role="checkbox"]',
    ) as HTMLElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("mixed");
    expect(
      container.querySelector("[data-relationship-bulk-mixed]"),
    ).not.toBeNull();
  });

  it("freezes observed removals before a concurrent activation appears", async () => {
    relationshipMocks.relationships = readyQuery({
      scope: "viewer-accessible",
      items: [edge("launch"), edge("social")],
      nextCursor: null,
    });
    render();

    const checkbox = container.querySelector(
      '[role="checkbox"]',
    ) as HTMLElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    await act(async () => checkbox.click());
    relationshipMocks.relationships = readyQuery({
      scope: "viewer-accessible",
      items: [
        edge("launch", ["activation-launch", "activation-concurrent"]),
        edge("social"),
      ],
      nextCursor: null,
    });
    render();
    const apply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply",
    )!;
    await act(async () => apply.click());

    expect(relationshipMocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "operation-1",
        changes: expect.arrayContaining([
          expect.objectContaining({
            kind: "remove",
            edgeId: "launch-mira",
            observedActivationIds: ["activation-launch"],
          }),
        ]),
      }),
    );
  });
});
