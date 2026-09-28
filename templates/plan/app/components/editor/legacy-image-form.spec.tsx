// @vitest-environment happy-dom

import {
  SchemaBlockEditor,
  type BlockRenderContext,
} from "@agent-native/core/blocks";
import { imageDataSchema } from "@shared/plan-content";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const CTX: BlockRenderContext = { dialect: "gfm" };

describe("image block schema form", () => {
  it("renders schema-driven inputs (not a JSON blob) for the refined image schema", () => {
    act(() => {
      root.render(
        <SchemaBlockEditor
          data={{ url: "https://cdn.example.com/cat.png", alt: "A cat" }}
          schema={imageDataSchema}
          onChange={() => {}}
          editable
          ctx={CTX}
        />,
      );
    });

    const altField = [
      ...container.querySelectorAll("input"),
      ...container.querySelectorAll("textarea"),
    ].find((field) => (field as HTMLInputElement).value === "A cat");
    expect(altField).toBeTruthy();

    const moreButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("More options"),
    );
    expect(moreButton).toBeTruthy();
    act(() => moreButton!.click());

    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    const optionValues = Array.from(select!.querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(optionValues).toEqual(expect.arrayContaining(["contain", "cover"]));

    expect(container.textContent).not.toContain("needs a custom editor");
  });
});
