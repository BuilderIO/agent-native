// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeBlock } from "./code.js";

describe("shared code block", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("omits the editor header when no filename label is present", () => {
    const Edit = codeBlock.Edit;
    expect(Edit).toBeTruthy();

    act(() => {
      root.render(
        Edit ? (
          <Edit
            blockId="code-1"
            ctx={{}}
            data={{ code: "const value = 1;", language: "ts" }}
            editable
            onChange={() => undefined}
          />
        ) : null,
      );
    });

    expect(container.querySelector(".plan-code-head")).toBeNull();
    expect(container.querySelector(".plan-code-chrome-float")).toBeTruthy();
    const captionInput = container.querySelector<HTMLInputElement>(
      ".plan-code-caption-input",
    );
    expect(captionInput).toBeTruthy();
    expect(captionInput?.value).toBe("");
    expect(container.textContent).not.toContain("Snippet");
  });

  it("keeps the editor header when a filename label is present", () => {
    const Edit = codeBlock.Edit;
    expect(Edit).toBeTruthy();

    act(() => {
      root.render(
        Edit ? (
          <Edit
            blockId="code-1"
            ctx={{}}
            data={{
              code: "const value = 1;",
              filename: "src/example.ts",
              language: "ts",
            }}
            editable
            onChange={() => undefined}
          />
        ) : null,
      );
    });

    expect(container.querySelector(".plan-code-head")).toBeTruthy();
    expect(container.querySelector(".plan-code-chrome-float")).toBeNull();
    expect(container.textContent).toContain("src/example.ts");
  });

  it("keeps an existing editor caption editable without showing an empty caption field", () => {
    const Edit = codeBlock.Edit;
    expect(Edit).toBeTruthy();

    act(() => {
      root.render(
        Edit ? (
          <Edit
            blockId="code-1"
            ctx={{}}
            data={{
              code: "const value = 1;",
              caption: "Existing caption",
            }}
            editable
            onChange={() => undefined}
          />
        ) : null,
      );
    });

    const captionInput = container.querySelector<HTMLInputElement>(
      ".plan-code-caption-input",
    );
    expect(captionInput).toBeTruthy();
    expect(captionInput?.value).toBe("Existing caption");
  });

  it("omits the read header and language bar when no filename label is present", () => {
    const Read = codeBlock.Read;
    expect(Read).toBeTruthy();

    act(() => {
      root.render(
        Read ? (
          <Read
            blockId="code-1"
            ctx={{}}
            data={{ code: "const value = 1;", language: "ts" }}
          />
        ) : null,
      );
    });

    expect(container.querySelector(".plan-code-head")).toBeNull();
    expect(container.querySelector(".plan-code-surface-bar")).toBeNull();
    expect(container.querySelector(".plan-code-chrome-float")).toBeTruthy();
  });
});
