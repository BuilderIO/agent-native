// @vitest-environment happy-dom

import type { ContentDatabaseSource } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async () => ({}));

vi.mock("@/hooks/use-content-database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-database")>()),
  useMaterializeBuilderRequiredFields: () => ({
    isPending: false,
    mutateAsync,
  }),
}));

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { BuilderRequiredFieldsCard } from "./DatabaseView";

const source = {
  id: "builder-source",
  sourceName: "Agent Native blog article test",
  sourceType: "builder-cms",
  sourceTable: "agent-native-blog-article-test",
  metadata: {
    primaryKey: "id",
    titleField: "data.title",
    builderModelFields: [{ name: "author", required: true }],
  },
  fields: [
    {
      id: "author",
      sourceFieldKey: "data.author",
      sourceFieldLabel: "Author",
      sourceFieldType: "text",
      mappingType: "field",
      propertyId: null,
    },
  ],
} as unknown as ContentDatabaseSource;

describe("BuilderRequiredFieldsCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mutateAsync.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("offers the local materialization action from the ordinary source view", async () => {
    act(() => {
      root.render(
        <BuilderRequiredFieldsCard
          documentId="database-document"
          source={source}
          canEdit
          pending={false}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Add required fields"),
    );
    expect(button).toBeDefined();

    await act(async () => button?.click());

    expect(mutateAsync).toHaveBeenCalledWith({
      documentId: "database-document",
      sourceId: "builder-source",
    });
  });

  it("stays hidden when all required fields are already bound", () => {
    act(() => {
      root.render(
        <BuilderRequiredFieldsCard
          documentId="database-document"
          source={{
            ...source,
            fields: source.fields.map((field) => ({
              ...field,
              propertyId: "property-author",
            })),
          }}
          canEdit
          pending={false}
        />,
      );
    });

    expect(container.textContent).toBe("");
  });
});
