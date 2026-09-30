// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callActionWithRetry = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", async () => ({
  ...(await vi.importActual("@agent-native/core/client/hooks")),
  callActionWithRetry,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) => {
    if (key === "editor.properties.editProperty") {
      return `Edit ${String(options?.name)}`;
    }
    return key;
  },
}));

import { PropertyValuePopover } from "./DocumentProperties";

const relationProperty: DocumentProperty = {
  definition: {
    id: "related",
    databaseId: "database",
    name: "Related",
    type: "relation",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: ["page-1"],
  editable: true,
};

const searchableRelationProperty: DocumentProperty = {
  ...relationProperty,
  definition: {
    ...relationProperty.definition,
    options: { relation: { databaseId: "database-1" } },
  },
};

describe("relation property value trigger", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PropertyValuePopover
            property={relationProperty}
            documentId="document"
            portalled={false}
          >
            <a href="/page-1" onClick={(event) => event.preventDefault()}>
              Linked page
            </a>
          </PropertyValuePopover>
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    callActionWithRetry.mockReset();
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps relation links outside button semantics", () => {
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.closest('button, [role="button"]')).toBeNull();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Related"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.contains(link)).toBe(false);
  });

  it("does not open the picker when a relation link is clicked", () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Related"]',
    );
    act(() => container.querySelector("a")?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("loads and shows relation rows beyond the first page", async () => {
    const rows = Array.from({ length: 32 }, (_, index) => ({
      documentId: `page-${index}`,
      title: `Page ${index}`,
      icon: null,
    }));
    callActionWithRetry.mockImplementation(
      async (_action: string, args: { offset?: number; limit?: number }) => {
        const offset = args.offset ?? 0;
        const limit = args.limit ?? 25;
        const pageRows = rows.slice(offset, offset + limit);
        const nextOffset = offset + pageRows.length;
        return {
          databaseId: "database-1",
          databaseDocumentId: "database-page",
          rowCreation: null,
          rows: pageRows,
          pagination: {
            offset,
            limit,
            totalItems: rows.length,
            returnedItems: pageRows.length,
            hasMore: nextOffset < rows.length,
            nextOffset: nextOffset < rows.length ? nextOffset : null,
          },
        };
      },
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PropertyValuePopover
            property={searchableRelationProperty}
            documentId="document"
            portalled={false}
          >
            <span>Relation</span>
          </PropertyValuePopover>
        </QueryClientProvider>,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Related"]',
    );
    await act(async () => trigger?.click());

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.textContent).toContain("Page 24"),
      );
    });
    expect(container.textContent).not.toContain("Page 25");

    const showMore = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("sidebar.showMore"),
    );
    expect(showMore).toBeDefined();
    await act(async () => showMore?.click());

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.textContent).toContain("Page 31"),
      );
    });
    expect(
      callActionWithRetry.mock.calls.map(([, args]) => args.offset),
    ).toEqual([0, 25]);
    expect(container.textContent).not.toContain("sidebar.showMore");
  });
});
