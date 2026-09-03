// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("../use-dynamic-schema", () => ({
  useDynamicProperties: () => ({
    properties: [{ name: "userId", count: 3 }],
    isLoading: false,
  }),
}));

import { PropertyCombobox } from "./PropertyCombobox";

describe("PropertyCombobox", () => {
  let container: HTMLDivElement;
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

  it("shows a human-readable property label in the trigger", async () => {
    await act(async () => {
      root.render(<PropertyCombobox value="modelName" onChange={vi.fn()} />);
    });

    expect(container.querySelector("button")?.textContent).toContain(
      "Model name",
    );
  });

  it("humanizes dynamically discovered properties in the list", async () => {
    await act(async () => {
      root.render(<PropertyCombobox value="" onChange={vi.fn()} autoOpen />);
    });

    expect(document.body.textContent).toContain("User ID");
    expect(document.body.textContent).not.toContain("userId");
  });
});
