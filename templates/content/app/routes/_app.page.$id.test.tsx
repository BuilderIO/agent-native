// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const documentEditor = vi.fn((_props: unknown) => null);

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/editor/DocumentEditor", () => ({
  DocumentEditor: (props: unknown) => documentEditor(props),
}));

import DocumentPage from "./_app.page.$id";

describe("document page route context", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    documentEditor.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("passes database membership and named-view selectors to the editor", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/page/database-page?databaseId=database-1&databaseDocumentId=database-page&viewId=ready-view",
          ]}
        >
          <Routes>
            <Route path="/page/:id" element={<DocumentPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(documentEditor).toHaveBeenCalledWith({
      documentId: "database-page",
      databaseId: "database-1",
      databaseDocumentId: "database-page",
      viewId: "ready-view",
    });
  });
});
