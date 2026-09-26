// @vitest-environment happy-dom

import { DesignSystemContext } from "@agent-native/toolkit/design-system";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptHome, PromptHomeLibrary } from "./PromptHome.js";
import {
  TemplateLibraryCard,
  TemplateLibraryGrid,
} from "./TemplateLibraryGrid.js";

const labels = {
  loading: "Loading templates",
  empty: "No templates",
  retry: "Retry",
};
const items = [
  { id: "one", title: "Pitch", description: "Stored description" },
  { id: "two", title: "Update" },
];

describe("prompt home and library", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const render = (node: ReactNode) => act(() => root.render(node));

  it("places the prompt above the full-width library without extra chrome", () => {
    render(
      <PromptHome
        title="Create"
        composer={<textarea defaultValue="Draft" />}
        connection={<button>Connect</button>}
        mobileToolbar={<button>Import</button>}
        quickActions={<button>Start</button>}
      >
        <div data-library>Templates</div>
      </PromptHome>,
    );
    expect(container.querySelectorAll("main")).toHaveLength(0);
    expect(container.querySelector("h2")?.textContent).toBe("Create");
    expect(
      container
        .querySelector(".agent-prompt-home-hero")
        ?.nextElementSibling?.hasAttribute("data-library"),
    ).toBe(true);
    expect(
      container
        .querySelector("textarea")
        ?.closest(".agent-prompt-home-composer"),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Getting Started");
  });

  it("leaves the main landmark owned by the app shell", () => {
    render(
      <main>
        <PromptHome title="Create" composer={<textarea />} />
      </main>,
    );
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("keeps the existing composer mounted when connection or library changes", () => {
    const home = (connected: boolean) => (
      <PromptHome
        title="Create"
        composer={<textarea defaultValue="Draft" />}
        connection={connected ? undefined : <button>Connect</button>}
      >
        <div>{connected ? "Recent" : "Templates"}</div>
      </PromptHome>
    );
    render(home(false));
    const textarea = container.querySelector("textarea")!;
    textarea.value = "Unsaved user draft";
    render(home(true));
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("Unsaved user draft");
  });

  it("shows templates without fake tabs when recents are unavailable", () => {
    const onValueChange = vi.fn();
    render(
      <PromptHomeLibrary
        value="recent"
        onValueChange={onValueChange}
        labels={{ templates: "Templates", recent: "Recent" }}
        showRecent={false}
        browseAll={<a href="/templates">Browse all</a>}
        templates={<div>Real catalog</div>}
        recent={<div>Private history</div>}
      />,
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).toContain("Real catalog");
    expect(container.textContent).not.toContain("Private history");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/templates",
    );
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("uses controlled semantic tabs with keyboard selection and active actions", async () => {
    function Library() {
      const [value, setValue] = useState<"templates" | "recent">("templates");
      return (
        <PromptHomeLibrary
          value={value}
          onValueChange={setValue}
          labels={{ templates: "Templates", recent: "Recent" }}
          showRecent
          browseAll={<a href="/templates">Browse all</a>}
          recentActions={<button>Filter</button>}
          templates={<div>Catalog</div>}
          recent={<div>Owned work</div>}
        />
      );
    }
    render(<Library />);
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(
      container
        .querySelector('[role="tablist"]')
        ?.parentElement?.querySelector('a[href="/templates"]'),
    ).not.toBeNull();
    act(() => tabs[0]!.focus());
    await act(async () => {
      tabs[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Owned work");
    expect(container.textContent).toContain("Filter");
    expect(container.querySelector('a[href="/templates"]')).toBeNull();
  });

  it("renders host previews and only stored descriptions", () => {
    render(
      <TemplateLibraryGrid
        items={items}
        labels={labels}
        renderPreview={(item) => <img alt={item.title} src="/preview.png" />}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe(
      "Stored description",
    );
  });

  it("activates image and caption through one focus target while actions stay separate", () => {
    const onSelect = vi.fn();
    const secondary = vi.fn();
    render(
      <TemplateLibraryCard
        item={items[0]!}
        preview={<img alt="Preview" src="/preview.png" />}
        actions={<button onClick={secondary}>Delete</button>}
        onSelect={onSelect}
      />,
    );
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(1);
    for (const selector of ["img", "h3", "p"])
      act(() => container.querySelector<HTMLElement>(selector)!.click());
    expect(onSelect).toHaveBeenCalledTimes(3);
    act(() => container.querySelector("button")!.click());
    expect(secondary).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("exposes selected state and supports Enter and Space selection", () => {
    const onSelect = vi.fn();
    render(
      <TemplateLibraryGrid
        items={items}
        labels={labels}
        selectedId="one"
        renderPreview={() => null}
        onSelect={onSelect}
      />,
    );
    const card = container.querySelector<HTMLElement>('[role="button"]')!;
    act(() => card.focus());
    expect(document.activeElement).toBe(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    for (const key of ["Enter", " "])
      act(() =>
        card.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        ),
      );
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(items[0], card);
  });

  it.each(["disabled", "pending", "item-disabled"])(
    "prevents %s card activation",
    (mode) => {
      const onSelect = vi.fn();
      render(
        <TemplateLibraryCard
          item={{ ...items[0]!, disabled: mode === "item-disabled" }}
          preview={null}
          disabled={mode === "disabled"}
          pending={mode === "pending"}
          onSelect={onSelect}
        />,
      );
      const card = container.querySelector<HTMLElement>('[role="button"]')!;
      expect(card.getAttribute("aria-disabled")).toBe("true");
      act(() => {
        card.click();
        card.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it("preserves native link modifier-click and keeps secondary actions outside", () => {
    const action = vi.fn();
    render(
      <TemplateLibraryGrid
        items={[items[0]!]}
        labels={labels}
        renderPreview={() => null}
        renderLink={(item, children) => (
          <a href={`/templates/${item.id}`}>{children}</a>
        )}
        renderActions={() => <button onClick={action}>Delete</button>}
      />,
    );
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/templates/one");
    expect(link.querySelector("button")).toBeNull();
    const modified = new MouseEvent("click", {
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => link.dispatchEvent(modified));
    expect(modified.defaultPrevented).toBe(false);
    act(() => container.querySelector("button")!.click());
    expect(action).toHaveBeenCalledOnce();
  });

  it("removes navigation while a link card is pending", () => {
    render(
      <TemplateLibraryCard
        item={items[0]!}
        preview={null}
        pending
        renderLink={(_, children) => <a href="/template">{children}</a>}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(
      container.querySelector('[role="link"]')?.getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("keeps secondary actions outside the disabled primary card semantics", () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    render(
      <TemplateLibraryCard
        item={items[0]!}
        preview={null}
        disabled
        onSelect={onSelect}
        actions={<button onClick={onAction}>Manage</button>}
      />,
    );
    expect(
      container.querySelector('[role="button"]')?.querySelector("button"),
    ).toBeNull();
    act(() => container.querySelector("button")!.click());
    expect(onAction).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("makes initial loading, error, and empty mutually exclusive", () => {
    const props = {
      items: [],
      labels,
      renderPreview: () => null,
      onSelect: vi.fn(),
    };
    render(<TemplateLibraryGrid {...props} loading />);
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe(labels.loading);
    expect(container.textContent).not.toContain(labels.empty);
    render(<TemplateLibraryGrid {...props} loading error="Access denied" />);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')).toBeNull();
    render(<TemplateLibraryGrid {...props} />);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      labels.empty,
    );
  });

  it("retains loaded cards after a refresh failure and exposes retry", () => {
    const onRetry = vi.fn();
    render(
      <TemplateLibraryGrid
        items={items}
        labels={labels}
        error="Refresh failed"
        onRetry={onRetry}
        renderPreview={() => null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("h3")).toHaveLength(2);
    act(() => container.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("honors a non-Tailwind semantic Surface, Tabs, and ActionButton adapter", () => {
    const surface = vi.fn();
    const onSelect = vi.fn();
    render(
      <DesignSystemContext.Provider
        value={{
          definition: {
            components: {
              Surface: ({ children, interactive, onPress }) => {
                surface();
                return interactive ? (
                  <button data-company-surface onClick={() => onPress?.()}>
                    {children}
                  </button>
                ) : (
                  <article data-company-surface>{children}</article>
                );
              },
              ActionButton: ({ children, onPress }) => (
                <button data-company-action onClick={() => onPress?.()}>
                  {children}
                </button>
              ),
              Tabs: ({ items: tabs, value, onChange }) => (
                <section data-company-tabs>
                  {tabs.map((tab) => (
                    <button key={tab.value} onClick={() => onChange(tab.value)}>
                      {tab.label}
                    </button>
                  ))}
                  {tabs.find((tab) => tab.value === value)?.content}
                </section>
              ),
            },
          },
        }}
      >
        <PromptHomeLibrary
          value="templates"
          onValueChange={vi.fn()}
          labels={{ templates: "Templates", recent: "Recent" }}
          showRecent
          templates={
            <TemplateLibraryGrid
              items={items}
              labels={labels}
              error="Refresh failed"
              onRetry={vi.fn()}
              renderPreview={() => null}
              onSelect={onSelect}
            />
          }
        />
      </DesignSystemContext.Provider>,
    );
    expect(container.querySelector("[data-company-tabs]")).not.toBeNull();
    expect(container.querySelector("[data-company-action]")).not.toBeNull();
    const card = container.querySelector<HTMLButtonElement>(
      "[data-company-surface]",
    )!;
    act(() => card.click());
    expect(onSelect).toHaveBeenCalledWith(items[0], expect.any(HTMLElement));
    expect(surface).toHaveBeenCalled();
  });
});
