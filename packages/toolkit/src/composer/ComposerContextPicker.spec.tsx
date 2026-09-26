// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import {
  ComposerContextMenu,
  type ComposerContextPickerConfig,
} from "./ComposerContextMenu.js";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(config: ComposerContextPickerConfig) {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <ComposerContextMenu
          items={[
            {
              id: "category",
              label: "Category",
              searchPlaceholder: "Search category",
              children: [{ id: "source", label: "Source", picker: config }],
            },
          ]}
        />
      </TooltipProvider>,
    ),
  );
}
const menus = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));
const row = (label: string) => {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  ).find((element) => element.textContent === label);
  expect(found, label).toBeDefined();
  return found!;
};
async function key(target: HTMLElement, key: string) {
  await act(async () => {
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(label: string) {
  await act(async () => row(label).click());
}
async function open() {
  await key(
    container.querySelector('button[aria-label="Add context"]')!,
    "ArrowDown",
  );
  await click("Add context");
  await click("Category");
  await click("Source");
}
async function search(value: string, placeholder = "Search source") {
  const input = document.querySelector<HTMLInputElement>(
    `input[placeholder="${placeholder}"]`,
  )!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const local = () => ({
  searchPlaceholder: "Search source",
  items: [
    { id: "one", title: "One" },
    { id: "two", title: "Two" },
  ],
  onSelect: vi.fn(),
});

describe("declarative context picker", () => {
  it("disables page controls while fetching and retains the footer", async () => {
    const pending = deferred<{
      items: { id: string; title: string }[];
      hasMore: boolean;
    }>();
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: "one", title: "One" }],
        hasMore: true,
        nextCursor: "next",
      })
      .mockReturnValueOnce(pending.promise);
    await render({
      searchPlaceholder: "Search source",
      load,
      onSelect: vi.fn(),
      footerAction: { label: "Create source", onSelect: () => false },
    });
    await open();
    await click("Next");
    expect(row("Next").getAttribute("aria-disabled")).toBe("true");
    expect(row("Previous").getAttribute("aria-disabled")).toBe("true");
    expect(row("Create source").getAttribute("aria-disabled")).not.toBe("true");
    expect(menus().at(-1)?.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(menus().at(-1)?.textContent).not.toContain("No matching context.");
    await act(async () => pending.resolve({ items: [], hasMore: false }));
    expect(menus().at(-1)?.textContent).toContain("No matching context.");
  });
  it("reports malformed remote payloads instead of turning them into empty lists", async () => {
    await render({
      searchPlaceholder: "Search source",
      load: vi.fn().mockResolvedValue({ hasMore: false }),
      onSelect: vi.fn(),
    });
    await open();
    expect(menus().at(-1)?.textContent).toContain("Could not load context.");
    expect(menus().at(-1)?.querySelector('[role="status"]')).toBeNull();
    expect(row("Retry")).toBeDefined();
  });
  it("supports local error Retry, disabled rows and clear selection", async () => {
    const retry = vi.fn();
    const clear = vi.fn().mockResolvedValue(false);
    const select = vi.fn();
    const config = {
      searchPlaceholder: "Search source",
      items: [{ id: "one", title: "One", disabled: true }],
      error: "Local read failed",
      onRetry: retry,
      onSelect: select,
      selectedIds: ["one"],
      clearSelection: { label: "Clear selection", onSelect: clear },
    };
    await render(config);
    await open();
    await click("Retry");
    expect(retry).toHaveBeenCalledOnce();
    await render({ ...config, error: undefined });
    await click("One");
    expect(select).not.toHaveBeenCalled();
    await click("Clear selection");
    expect(clear).toHaveBeenCalledOnce();
    expect(menus()).toHaveLength(4);
  });
  it("retries a failed selection and closes only on success", async () => {
    const onSelect = vi
      .fn()
      .mockRejectedValueOnce(new Error("Reference read failed"))
      .mockResolvedValue(undefined);
    await render({ ...local(), onSelect });
    await open();
    await click("One");
    expect(menus().at(-1)?.textContent).toContain("Reference read failed");
    await click("Retry");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(menus()).toHaveLength(0);
  });
  it("aborts selection on identity change and cannot close the new account's picker", async () => {
    const pending = deferred<void>();
    const onSelect = vi.fn().mockReturnValue(pending.promise);
    const config = { ...local(), onSelect, scopeKey: "account-a" };
    await render(config);
    await open();
    await click("One");
    await render({ ...config, scopeKey: "account-b" });
    expect(onSelect.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => pending.resolve());
    expect(menus()).toHaveLength(4);
  });
  it("keeps link, search and page on sync refresh, and aborts a dismissed load", async () => {
    const pending = deferred<{ items: { id: string; title: string }[] }>();
    const load = vi.fn().mockResolvedValue({
      items: [{ id: "one", title: "One" }],
      hasMore: true,
      nextCursor: "next",
    });
    const config = {
      searchPlaceholder: "Search source",
      load,
      onSelect: vi.fn(),
      refreshKey: 1,
      link: { placeholder: "Source URL", submitLabel: "Read link" },
    };
    await render(config);
    await open();
    await search("https://example.com/source", "Source URL");
    await click("Read link");
    await search("one");
    await click("Next");
    load.mockReturnValueOnce(pending.promise);
    await render({ ...config, refreshKey: 2 });
    const request = load.mock.calls.at(-1)![0];
    expect(request).toMatchObject({
      page: 2,
      search: "one",
      url: "https://example.com/source",
      cursor: "next",
    });
    await key(
      document.querySelector('input[placeholder="Search source"]')!,
      "Escape",
    );
    expect(request.signal.aborted).toBe(true);
    await act(async () =>
      pending.resolve({ items: [{ id: "late", title: "Late" }] }),
    );
    expect(menus()).toHaveLength(3);
    expect(document.body.textContent).not.toContain("Late");
  });
  it("keeps connected panels, integrated headers and source search autofocus", async () => {
    await render(local());
    await open();
    expect(menus()).toHaveLength(4);
    expect(menus().every((menu) => menu.classList.contains("w-64"))).toBe(true);
    const searches = document.querySelectorAll('input[role="searchbox"]');
    expect(searches).toHaveLength(1);
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    for (const input of searches)
      expect(input.hasAttribute("aria-controls")).toBe(false);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(
      document.querySelector('input[placeholder="Search source"]'),
    );
  });
  it("filters locally, reserves trailing checks, and preserves selection when callback returns false", async () => {
    const select = vi.fn().mockResolvedValue(false);
    await render({ ...local(), selectedIds: ["one"], onSelect: select });
    await open();
    expect(row("One").getAttribute("aria-checked")).toBe("true");
    expect(row("Two").lastElementChild?.classList.contains("size-4")).toBe(
      true,
    );
    await search("two");
    expect(menus().at(-1)?.textContent).not.toContain("One");
    await click("Two");
    expect(select).toHaveBeenCalledWith(
      { id: "two", title: "Two" },
      expect.objectContaining({
        search: "two",
        page: 1,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(menus()).toHaveLength(4);
  });
  it("routes typing and arrows through real Radix menu items and closes only the deepest submenu", async () => {
    await render(local());
    await open();
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search source"]',
    )!;
    await key(input, "t");
    expect(document.activeElement).toBe(input);
    await key(input, "ArrowDown");
    expect(document.activeElement).toBe(row("One"));
    await key(row("One"), "ArrowDown");
    expect(document.activeElement).toBe(row("Two"));
    await key(row("Two"), "ArrowLeft");
    expect(menus()).toHaveLength(3);
    expect(document.activeElement).toBe(row("Source"));
    await key(row("Source"), "Escape");
    expect(menus()).toHaveLength(2);
    expect(document.activeElement).toBe(row("Category"));
  });
  it("loads pages with cursor history and preserves location on refresh without descriptor loops", async () => {
    const load = vi
      .fn<NonNullable<ComposerContextPickerConfig["load"]>>()
      .mockResolvedValue({
        items: [{ id: "one", title: "One" }],
        hasMore: true,
        nextCursor: "cursor-2",
      });
    const config = {
      searchPlaceholder: "Search source",
      load,
      onSelect: vi.fn(),
      refreshKey: 0,
    };
    await render(config);
    await open();
    expect(load).toHaveBeenCalledTimes(1);
    await render({ ...config });
    expect(load).toHaveBeenCalledTimes(1);
    await click("Next");
    expect(load.mock.calls.at(-1)?.[0]).toMatchObject({
      page: 2,
      cursor: "cursor-2",
      search: "",
    });
    await render({ ...config, refreshKey: 1 });
    expect(load.mock.calls.at(-1)?.[0]).toMatchObject({
      page: 2,
      cursor: "cursor-2",
    });
    await click("Previous");
    expect(load.mock.calls.at(-1)?.[0].page).toBe(1);
    await search("find");
    expect(load.mock.calls.at(-1)?.[0]).toMatchObject({
      search: "find",
      page: 1,
    });
  });
  it("shows exclusive loading/error/empty states and real Retry", async () => {
    const pending = deferred<{ items: []; hasMore: boolean }>();
    const load = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ items: [], hasMore: false });
    await render({
      searchPlaceholder: "Search source",
      load,
      onSelect: vi.fn(),
    });
    await open();
    const source = () => menus().at(-1)!;
    expect(source().querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(source().textContent).not.toContain("No matching context.");
    await act(async () => pending.reject(new Error("Read failed")));
    expect(source().querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(source().querySelector('[role="status"]')).toBeNull();
    await click("Retry");
    expect(source().querySelector('[role="alert"]')).toBeNull();
    expect(source().textContent).toContain("No matching context.");
  });
  it("suppresses stale search and identity responses even when loaders ignore abort", async () => {
    const first = deferred<{ items: { id: string; title: string }[] }>();
    const second = deferred<{ items: { id: string; title: string }[] }>();
    const load = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue({ items: [{ id: "safe", title: "Safe" }] });
    const config = {
      searchPlaceholder: "Search source",
      load,
      onSelect: vi.fn(),
      scopeKey: "account-a",
    };
    await render(config);
    await open();
    await search("new");
    expect(load.mock.calls[0][0].signal.aborted).toBe(true);
    await render({ ...config, scopeKey: "account-b" });
    expect(load.mock.calls.at(-1)?.[0].search).toBe("");
    await act(async () => {
      first.resolve({ items: [{ id: "old", title: "Old" }] });
      second.resolve({ items: [{ id: "leak", title: "Leak" }] });
    });
    expect(menus().at(-1)?.textContent).toContain("Safe");
    expect(menus().at(-1)?.textContent).not.toMatch(/Old|Leak/);
  });
  it("ignores a slow selection after dismiss and reopening", async () => {
    const pending = deferred<void>();
    const select = vi.fn().mockReturnValue(pending.promise);
    await render({ ...local(), onSelect: select });
    await open();
    await click("One");
    const signal = select.mock.calls[0][1].signal;
    await key(row("One"), "Escape");
    expect(signal.aborted).toBe(true);
    await click("Source");
    await act(async () => pending.resolve());
    expect(menus()).toHaveLength(4);
  });
  it("validates links before reading, searches results, and returns to the populated link stage", async () => {
    const load = vi
      .fn()
      .mockResolvedValue({ items: [{ id: "one", title: "One" }] });
    await render({
      searchPlaceholder: "Search source",
      load,
      onSelect: vi.fn(),
      link: {
        placeholder: "Source URL",
        submitLabel: "Read link",
        validate: (url) =>
          url.startsWith("https://") ? undefined : "Use HTTPS",
      },
    });
    await open();
    expect(load).not.toHaveBeenCalled();
    await click("Read link");
    expect(menus().at(-1)?.textContent).toContain("Enter a link.");
    await search("bad", "Source URL");
    await click("Read link");
    expect(menus().at(-1)?.textContent).toContain("Use HTTPS");
    await search("https://example.com/source", "Source URL");
    await click("Read link");
    expect(load.mock.calls[0][0]).toMatchObject({
      url: "https://example.com/source",
      page: 1,
    });
    await search("one");
    expect(load.mock.calls.at(-1)?.[0]).toMatchObject({
      url: "https://example.com/source",
      search: "one",
    });
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Back"]')!
        .click(),
    );
    expect(
      document.querySelector<HTMLInputElement>(
        'input[placeholder="Source URL"]',
      )?.value,
    ).toBe("https://example.com/source");
    expect(menus()).toHaveLength(4);
    await key(
      document.querySelector('input[placeholder="Source URL"]')!,
      "ArrowLeft",
    );
    expect(menus()).toHaveLength(4);
    await key(
      document.querySelector('input[placeholder="Source URL"]')!,
      "ArrowRight",
    );
    expect(menus()).toHaveLength(4);
    await key(row("Read link"), "ArrowLeft");
    expect(menus()).toHaveLength(3);
  });
  it("keeps a genuine link footer present in empty and populated states", async () => {
    const config = {
      ...local(),
      items: [],
      footerAction: {
        label: "Create source",
        renderLink: (children: React.ReactNode) => (
          <a href="/sources/setup">{children}</a>
        ),
      },
    };
    await render(config);
    await open();
    const footer = row("Create source");
    expect(footer.tagName).toBe("A");
    expect(footer.getAttribute("href")).toBe("/sources/setup");
    expect(footer.closest('[role="group"]')).not.toBeNull();
    expect(menus().at(-1)?.querySelector('[role="separator"]')).not.toBeNull();
    await render({ ...config, items: [{ id: "one", title: "One" }] });
    expect(row("Create source")).toBe(footer);
  });
  it.each(["meta", "ctrl", "middle"])(
    "preserves native %s-click link activation",
    async (modifier) => {
      await render({
        ...local(),
        footerAction: {
          label: "Create source",
          renderLink: (children) => <a href="/sources/setup">{children}</a>,
        },
      });
      await open();
      const event = new MouseEvent(
        modifier === "middle" ? "auxclick" : "click",
        {
          bubbles: true,
          cancelable: true,
          metaKey: modifier === "meta",
          ctrlKey: modifier === "ctrl",
          button: modifier === "middle" ? 1 : 0,
        },
      );
      await act(async () => row("Create source").dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    },
  );
  it("retries footer failure from the link stage without starting a read", async () => {
    const footer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not open setup"))
      .mockResolvedValue(false);
    const load = vi.fn();
    await render({
      searchPlaceholder: "Search source",
      load,
      onSelect: vi.fn(),
      link: { placeholder: "Source URL", submitLabel: "Read link" },
      footerAction: { label: "Create source", onSelect: footer },
    });
    await open();
    await click("Create source");
    expect(menus().at(-1)?.textContent).toContain("Could not open setup");
    await click("Retry");
    expect(footer).toHaveBeenCalledTimes(2);
    expect(load).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(4);
  });
});
