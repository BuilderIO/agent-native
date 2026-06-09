// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeTabsBlock } from "./code-tabs.js";
import { TabsBlockEditor, TabsBlockReader } from "./tabs.js";
import type { CodeTabsData } from "./code-tabs.config.js";
import type { TabsData } from "./tabs.config.js";

const manyCodeTabs: CodeTabsData = {
  tabs: Array.from({ length: 12 }, (_, index) => ({
    id: `code-tab-${index + 1}`,
    label: `${index + 1}. long-file-name-${index + 1}.tsx`,
    code: `export const value${index + 1} = ${index + 1};`,
    language: "tsx",
  })),
};

const filenameOnlyCodeTabs: CodeTabsData = {
  tabs: [
    {
      id: "code-tab-content",
      label: "content.ts",
      code: "export type PlaygroundBlock = {\n  id: string;\n};",
    },
  ],
};

const manyContentTabs: TabsData = {
  tabs: Array.from({ length: 12 }, (_, index) => ({
    id: `tab-${index + 1}`,
    label: `${index + 1}. Long tab ${index + 1}`,
    blocks: [],
  })),
};

const verticalContentTabs: TabsData = {
  ...manyContentTabs,
  orientation: "vertical",
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("shared block tab rails", () => {
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

  function expectHorizontalScrollRail(tablist: HTMLElement | null) {
    expect(tablist).toBeTruthy();
    expect(tablist?.className).toContain("overflow-x-auto");
    expect(tablist?.className).toContain("flex-nowrap");
    expect(tablist?.className).not.toContain("flex-wrap");
    expect(tablist?.className).toContain("min-w-0");
    expect(tablist?.className).toContain("w-full");
  }

  it("keeps code-tab editor tabs on one horizontally scrollable row", () => {
    const Edit = codeTabsBlock.Edit;
    expect(Edit).toBeTruthy();

    act(() => {
      root.render(
        Edit ? (
          <Edit
            blockId="code-tabs-1"
            ctx={{}}
            data={manyCodeTabs}
            editable
            onChange={() => undefined}
          />
        ) : null,
      );
    });

    const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
    expectHorizontalScrollRail(tablist);
    expect(
      tablist?.querySelector<HTMLElement>('[role="tab"]')?.className,
    ).toContain("whitespace-nowrap");
    expect(tablist?.parentElement?.className).toContain("min-w-0");
  });

  it("syntax-highlights code-tab editor content from the filename when language is omitted", () => {
    const Edit = codeTabsBlock.Edit;
    expect(Edit).toBeTruthy();

    act(() => {
      root.render(
        Edit ? (
          <Edit
            blockId="code-tabs-1"
            ctx={{}}
            data={filenameOnlyCodeTabs}
            editable
            onChange={() => undefined}
          />
        ) : null,
      );
    });

    const layer = container.querySelector<HTMLElement>(
      "[data-code-tabs-highlight-layer]",
    );
    expect(layer?.textContent).toContain("export type PlaygroundBlock");
    expect(
      Array.from(layer?.querySelectorAll("span") ?? []).some((span) =>
        span.className.includes("text-"),
      ),
    ).toBe(true);
    expect(container.querySelector("textarea")?.className).toContain(
      "text-transparent",
    );
  });

  it("edits code-tab metadata from the settings popover instead of inline fields", () => {
    const Edit = codeTabsBlock.Edit;
    const changes: CodeTabsData[] = [];
    expect(Edit).toBeTruthy();

    act(() => {
      root.render(
        Edit ? (
          <Edit
            blockId="code-tabs-1"
            ctx={{}}
            data={manyCodeTabs}
            editable
            onChange={(next) => changes.push(next)}
          />
        ) : null,
      );
    });

    expect(
      container.querySelector<HTMLInputElement>(
        'input[value="1. long-file-name-1.tsx"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("Language");
    expect(container.textContent).not.toContain("Add tab");

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit code tabs"]',
    );
    expect(editButton).toBeTruthy();

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = document.body.querySelector<HTMLInputElement>(
      'input[value="1. long-file-name-1.tsx"]',
    );
    expect(input).toBeTruthy();
    expect(document.body.textContent).toContain("Language");

    setInputValue(input!, "example.tsx");

    expect(changes.at(-1)?.tabs[0]?.label).toBe("example.tsx");
  });

  it("keeps content tab editor tabs on one horizontally scrollable row", () => {
    act(() => {
      root.render(
        <TabsBlockEditor
          blockId="tabs-1"
          ctx={{}}
          data={manyContentTabs}
          editable
          onChange={() => undefined}
        />,
      );
    });

    const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
    expectHorizontalScrollRail(tablist);
    expect(
      tablist?.querySelector<HTMLElement>('[role="tab"]')?.className,
    ).toContain("whitespace-nowrap");
    expect(tablist?.parentElement?.className).toContain("min-w-0");
  });

  it("renders content tab reader tabs as a vertical side rail when requested", () => {
    act(() => {
      root.render(
        <TabsBlockReader
          blockId="tabs-1"
          ctx={{}}
          data={verticalContentTabs}
        />,
      );
    });

    const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
    expect(tablist?.getAttribute("aria-orientation")).toBe("vertical");
    expect(tablist?.className).toContain("@xl/tabs:flex-col");
    expect(tablist?.className).toContain("@xl/tabs:overflow-y-auto");
    expect(
      tablist?.querySelector<HTMLElement>('[role="tab"] span')?.className,
    ).toContain("truncate");
  });

  it("edits content tab labels from the settings popover instead of an inline field", () => {
    const changes: TabsData[] = [];

    act(() => {
      root.render(
        <TabsBlockEditor
          blockId="tabs-1"
          ctx={{}}
          data={manyContentTabs}
          editable
          onChange={(next) => changes.push(next)}
        />,
      );
    });

    expect(
      container.querySelector<HTMLInputElement>('input[value="1. Long tab 1"]'),
    ).toBeNull();

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit tabs"]',
    );
    expect(editButton).toBeTruthy();

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = document.body.querySelector<HTMLInputElement>(
      'input[value="1. Long tab 1"]',
    );
    expect(input).toBeTruthy();

    setInputValue(input!, "Overview");

    expect(changes.at(-1)?.tabs[0]?.label).toBe("Overview");
  });

  it("switches content tabs between top and side layouts from the settings popover", () => {
    const changes: TabsData[] = [];

    act(() => {
      root.render(
        <TabsBlockEditor
          blockId="tabs-1"
          ctx={{}}
          data={manyContentTabs}
          editable
          onChange={(next) => changes.push(next)}
        />,
      );
    });

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit tabs"]',
    );
    expect(editButton).toBeTruthy();

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const sideButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ).find((button) => button.textContent === "Side");
    expect(sideButton).toBeTruthy();

    act(() => {
      sideButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(changes.at(-1)?.orientation).toBe("vertical");
    expect(changes.at(-1)?.tabs).toBe(manyContentTabs.tabs);
  });

  it("only exposes the vertical tab edit trigger on the selected tab", () => {
    act(() => {
      root.render(
        <TabsBlockEditor
          blockId="tabs-1"
          ctx={{}}
          data={verticalContentTabs}
          editable
          onChange={() => undefined}
        />,
      );
    });

    const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
    const selectedTab = tablist?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    const inactiveTab = tablist?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="false"]',
    );
    const editButtons = tablist?.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Edit tabs"]',
    );

    expect(editButtons).toHaveLength(1);
    expect(selectedTab?.parentElement?.contains(editButtons?.[0] ?? null)).toBe(
      true,
    );
    expect(
      inactiveTab?.parentElement?.querySelector('[aria-label="Edit tabs"]'),
    ).toBeNull();
    expect(editButtons?.[0]?.className).toContain(
      "group-focus-within/tab:opacity-100",
    );
    expect(editButtons?.[0]?.className).toContain("opacity-0");
  });

  it("keeps content tab reader tabs on one horizontally scrollable row", () => {
    act(() => {
      root.render(
        <TabsBlockReader blockId="tabs-1" ctx={{}} data={manyContentTabs} />,
      );
    });

    const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
    expectHorizontalScrollRail(tablist);
    expect(
      tablist?.querySelector<HTMLElement>('[role="tab"]')?.className,
    ).toContain("whitespace-nowrap");
  });
});
