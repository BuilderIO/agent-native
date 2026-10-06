// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => ({
    data: { configured: true },
    isSuccess: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { PlanMarkdownEditor } from "./PlanMarkdownEditor";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PlanMarkdownEditor image node", () => {
  it("mounts a markdown image without a duplicate plugin-key crash", () => {
    expect(() => {
      act(() => {
        root.render(
          <PlanMarkdownEditor
            markdown={"![A cat](https://cdn.example.com/cat.png)\n"}
            onSave={() => {}}
          />,
        );
      });
    }).not.toThrow();

    expect(container.querySelector(".ProseMirror")).toBeTruthy();
  });
});
