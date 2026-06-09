// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JSON_EXPLORER_DEFAULT_COLLAPSED_DEPTH,
  JSON_EXPLORER_MAX_COLLAPSED_DEPTH,
} from "./json-explorer.config.js";
import { JsonExplorerEdit, JsonExplorerRead } from "./JsonExplorerBlock.js";

describe("JsonExplorerBlock", () => {
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

  it("auto-expands two container levels by default", () => {
    act(() => {
      root.render(
        <JsonExplorerRead
          blockId="json-1"
          ctx={{}}
          data={{
            json: JSON.stringify({
              domain: "schema",
              subjects: [
                {
                  deepKey: "hidden until expanded",
                  nested: { child: true },
                },
              ],
            }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain('"domain"');
    expect(container.textContent).toContain('"subjects"');
    expect(container.textContent).toContain("0: {{…} 2 keys…}");
    expect(container.textContent).not.toContain("deepKey");
  });

  it("offers auto-expand presets from the edit surface", () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <JsonExplorerEdit
          blockId="json-1"
          ctx={{}}
          data={{ json: "{}" }}
          editable
          onChange={onChange}
        />,
      );
    });

    const defaultPreset = container.querySelector<HTMLButtonElement>(
      `button[aria-pressed="true"]`,
    );
    expect(defaultPreset?.textContent).toBe("2 levels");

    const allPreset = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "All",
    );
    expect(allPreset).toBeTruthy();

    act(() => {
      allPreset?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onChange).toHaveBeenCalledWith({
      json: "{}",
      collapsedDepth: JSON_EXPLORER_MAX_COLLAPSED_DEPTH,
    });
  });

  it("exports the intended default expansion depth", () => {
    expect(JSON_EXPLORER_DEFAULT_COLLAPSED_DEPTH).toBe(2);
  });

  it("alt-click expands and collapses a node's descendants deeply", () => {
    act(() => {
      root.render(
        <JsonExplorerRead
          blockId="json-1"
          ctx={{}}
          data={{
            collapsedDepth: 1,
            json: JSON.stringify({
              subjects: [
                {
                  nested: {
                    child: "deep value",
                  },
                },
              ],
            }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain('"subjects"');
    expect(container.textContent).not.toContain("deep value");

    const subjectsToggle = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((button) => button.textContent?.includes('"subjects"'));
    expect(subjectsToggle).toBeTruthy();

    act(() => {
      subjectsToggle?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          altKey: true,
        }),
      );
    });

    expect(container.textContent).toContain("deep value");

    const expandedSubjectsToggle = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((button) => button.textContent?.includes('"subjects"'));

    act(() => {
      expandedSubjectsToggle?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          altKey: true,
        }),
      );
    });

    expect(container.textContent).not.toContain("deep value");
  });

  it("expands and collapses the full tree from the toolbar", () => {
    act(() => {
      root.render(
        <JsonExplorerRead
          blockId="json-1"
          ctx={{}}
          data={{
            collapsedDepth: 1,
            json: JSON.stringify({
              subjects: [
                {
                  nested: {
                    child: "deep value",
                  },
                },
              ],
            }),
          }}
        />,
      );
    });

    expect(container.textContent).not.toContain("deep value");

    const toolbar = container.querySelector<HTMLElement>(
      "[data-json-explorer-actions]",
    );
    expect(toolbar?.className).toContain("opacity-0");
    expect(toolbar?.className).toContain("group-hover:opacity-100");

    const expandAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Expand all",
    );
    expect(expandAll).toBeTruthy();
    expect(expandAll?.disabled).toBe(false);

    act(() => {
      expandAll?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain("deep value");
    expect(expandAll?.disabled).toBe(true);

    const collapseAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Collapse all",
    );
    expect(collapseAll).toBeTruthy();
    expect(collapseAll?.disabled).toBe(false);

    act(() => {
      collapseAll?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).not.toContain("deep value");
    expect(collapseAll?.disabled).toBe(true);
    expect(expandAll?.disabled).toBe(false);
  });
});
