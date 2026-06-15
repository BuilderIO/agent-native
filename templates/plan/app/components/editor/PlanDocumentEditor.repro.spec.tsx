// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanContent } from "@shared/plan-content";
import { PlanDocumentEditor } from "./PlanDocumentEditor";

const IMAGE_SRC = "https://cdn.example.com/cat.png";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  document
    .querySelectorAll("img")
    .forEach((image) => image.removeAttribute("src"));
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flushEditorEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PlanDocumentEditor image node", () => {
  it("mounts markdown images without reading editor.view.dom before the view exists", async () => {
    const content: PlanContent = {
      version: 2,
      blocks: [
        {
          id: "rich-text-with-image",
          type: "rich-text",
          data: {
            markdown: `Intro copy.\n\n![A cat](${IMAGE_SRC})\n\nDone.`,
          },
        },
      ],
    };

    expect(() => {
      act(() => {
        root.render(
          <PlanDocumentEditor
            content={content}
            editable
            onBlocksChange={vi.fn()}
          />,
        );
      });
    }).not.toThrow();

    await flushEditorEffects();
    await flushEditorEffects();

    const image = container.querySelector(
      ".plan-image-node img",
    ) as HTMLImageElement | null;
    expect(
      container.querySelector(".plan-document-editor .ProseMirror"),
    ).toBeTruthy();
    expect(image?.getAttribute("src")).toBe(IMAGE_SRC);
    expect(image?.getAttribute("alt")).toBe("A cat");
  });
});
