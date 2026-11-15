// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeAll, expect, it, vi } from "vitest";

import { ContentReferencePreview } from "./ContentReferencePreview";
import { DrawDiagramsContext } from "./draw-diagrams";

const previews = vi.hoisted(
  () => [] as Array<{ drawDiagrams?: boolean; editable?: boolean }>,
);

vi.mock("@/hooks/use-content-links", () => ({
  useLocalSourceDocument: () => ({
    data: { documentId: "referenced", title: "Referenced" },
    isError: false,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-documents", () => ({
  useDocument: () => ({
    data: {
      title: "Referenced",
      content: "```mermaid\nflowchart LR\n  A --> B\n```",
    },
    isError: false,
    isLoading: false,
  }),
}));

vi.mock("./VisualEditor", () => ({
  VisualEditor: (props: { drawDiagrams?: boolean; editable?: boolean }) => {
    previews.push(props);
    return null;
  },
}));

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

/** The props of the editor a reference preview mounts for the other page. */
async function previewEditorProps(drawDiagrams?: boolean) {
  previews.length = 0;
  const root = createRoot(document.createElement("div"));
  const preview = (
    <ContentReferencePreview sourcePath="./other.md" currentPath="docs/a.md" />
  );
  await act(async () => {
    root.render(
      <MemoryRouter>
        {drawDiagrams === undefined ? (
          preview
        ) : (
          <DrawDiagramsContext.Provider value={drawDiagrams}>
            {preview}
          </DrawDiagramsContext.Provider>
        )}
      </MemoryRouter>,
    );
  });
  // The preview's editor loads lazily.
  for (let tries = 0; tries < 50 && previews.length === 0; tries++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  act(() => {
    root.unmount();
  });
  return previews[previews.length - 1];
}

it("previews another page as code inside a page that draws no diagrams", async () => {
  expect(await previewEditorProps(false)).toMatchObject({
    drawDiagrams: false,
    editable: false,
  });
});

it("previews another page with its diagrams drawn by default", async () => {
  expect(await previewEditorProps()).toMatchObject({ drawDiagrams: true });
});
