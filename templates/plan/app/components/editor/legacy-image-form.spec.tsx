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

/**
 * The image block is a legacy (non-registry) block; its `data` schema is a
 * `z.object(...).refine(...)`. This guards that the schema auto-editor renders
 * real form inputs for it (the "schema forms instead of raw JSON" behavior) —
 * i.e. `introspect` peels the `.refine()` wrapper and classifies every field.
 */
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

    // Required `alt` renders as a field carrying the current value (a textarea,
    // since its max length classifies it as long text — proving `introspect`
    // peeled the `.refine()` wrapper and classified the field).
    const altField = [
      ...container.querySelectorAll("input"),
      ...container.querySelectorAll("textarea"),
    ].find((field) => (field as HTMLInputElement).value === "A cat");
    expect(altField).toBeTruthy();

    // Optional fields (url / caption / fit) sit behind a "More options" toggle.
    const moreButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("More options"),
    );
    expect(moreButton).toBeTruthy();
    act(() => moreButton!.click());

    // `fit` is an enum → a native <select>; its presence proves introspection
    // classified the refined object's fields rather than bailing out.
    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    const optionValues = Array.from(select!.querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(optionValues).toEqual(expect.arrayContaining(["contain", "cover"]));

    // No unsupported-field hint and no raw JSON textarea.
    expect(container.textContent).not.toContain("needs a custom editor");
  });
});
