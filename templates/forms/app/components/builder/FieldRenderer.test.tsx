// @vitest-environment happy-dom

import type { FormField } from "@shared/types";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FieldRenderer } from "./FieldRenderer";

describe("FieldRenderer file fields", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it("renders a native multi-file input and forwards selected files", () => {
    const onChange = vi.fn();
    const field = {
      id: "screenshots",
      type: "file",
      label: "Screenshots",
      required: false,
      multiple: true,
      accept: "image/*",
    } as FormField;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<FieldRenderer field={field} onChange={onChange} />);
    });

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(input?.multiple).toBe(true);
    expect(input?.accept).toBe("image/*");

    const file = new File(["image"], "screen.png", { type: "image/png" });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    act(() => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith([file]);
  });
});
