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
const frames = [
  { id: "file-a:1", title: "First frame", url: "https://example.com/a" },
  { id: "file-b:1", title: "Second frame", url: "https://example.com/b" },
];
function multiple() {
  return {
    presentation: {
      type: "dialog" as const,
      mode: "multiple" as const,
      onAttach: vi.fn().mockResolvedValue(undefined),
    },
    searchPlaceholder: "Search frames",
    scopeKey: "account-a",
    refreshKey: 0,
    link: {
      label: "Source URL",
      placeholder: "https://example.com/file",
      submitLabel: "Unused legacy label",
      validate: (url: string) =>
        url.includes("/supported/") ? undefined : "Use a supported source URL",
    },
    load: vi.fn().mockResolvedValue({ items: frames, hasMore: false }),
  } satisfies ComposerContextPickerConfig;
}
async function render(
  config: ComposerContextPickerConfig,
  onParentSubmit?: () => void,
) {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onParentSubmit?.();
          }}
        >
          <input aria-label="Prompt draft" defaultValue="Keep my draft" />
          <ComposerContextMenu
            items={[
              {
                id: "category",
                label: "Design",
                children: [
                  { id: "link", label: "Attach source", picker: config },
                ],
              },
            ]}
          />
        </form>
      </TooltipProvider>,
    ),
  );
}
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function row(text: string) {
  const target = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((element) => element.textContent === text);
  expect(target, text).toBeDefined();
  return target!;
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const trigger = () =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Add context"]',
  )!;
function button(text: string) {
  const target = Array.from(
    dialog()!.querySelectorAll<HTMLButtonElement>("button"),
  ).find((element) => element.textContent === text);
  expect(target, text).toBeDefined();
  return target!;
}
async function open() {
  await act(async () =>
    trigger().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  await act(async () => row("Add context").click());
  await act(async () => row("Design").click());
  expect(row("Attach source").hasAttribute("aria-haspopup")).toBe(false);
  await act(async () => row("Attach source").click());
  await tick();
  expect(dialog()).not.toBeNull();
}
async function type(value: string, selector = 'input[type="url"]') {
  const input = dialog()!.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () => button(text).click());
  await tick();
}
async function choose(title: string) {
  const label = Array.from(
    dialog()!.querySelectorAll<HTMLLabelElement>("label"),
  ).find((element) => element.textContent === title)!;
  const checkbox = document.getElementById(label.htmlFor)!;
  await act(async () => checkbox.click());
  return checkbox;
}
async function browse() {
  await type("https://example.com/supported/file");
  await click("Continue");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("shared context URL dialog", () => {
  it("isolates Continue and Attach form submissions from the portaled parent composer", async () => {
    const config = multiple();
    const parent = vi.fn();
    config.presentation.onAttach.mockResolvedValue(false);
    await render(config, parent);
    await open();
    await type("https://example.com/supported/file");
    await act(async () => dialog()!.querySelector("form")!.requestSubmit());
    expect(config.load).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
    await choose("First frame");
    await act(async () => dialog()!.querySelector("form")!.requestSubmit());
    expect(config.presentation.onAttach).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Prompt draft"]')!
        .value,
    ).toBe("Keep my draft");
  });
  it("opens only from an ordinary menu action, focuses URL after menu close and restores plus on cancel", async () => {
    const config = multiple();
    await render(config);
    expect(dialog()).toBeNull();
    await open();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(dialog()!.textContent).toContain("Attach source");
    expect(document.activeElement).toBe(
      dialog()!.querySelector('input[type="url"]'),
    );
    expect(dialog()!.querySelectorAll("form")).toHaveLength(1);
    expect(config.load).not.toHaveBeenCalled();
    await click("Cancel");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Prompt draft"]')!
        .value,
    ).toBe("Keep my draft");
    await open();
    expect(
      dialog()!.querySelector<HTMLInputElement>('input[type="url"]')!.value,
    ).toBe("");
  });
  it("makes blank Enter inert and validates URL and host restrictions before any provider call", async () => {
    const config = multiple();
    await render(config);
    await open();
    expect(button("Continue").disabled).toBe(true);
    await act(async () =>
      dialog()!
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
    expect(dialog()!.textContent).not.toContain("Enter a link.");
    for (const url of [
      "not-a-url",
      "javascript:alert(1)",
      "ftp://example.com/supported/file",
      "https://user:secret@example.com/supported/file",
      "https://example.com/unsupported",
    ]) {
      await type(url);
      expect(button("Continue").disabled).toBe(true);
      await act(async () =>
        dialog()!
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
    }
    expect(config.load).not.toHaveBeenCalled();
    expect(config.presentation.onAttach).not.toHaveBeenCalled();
    await browse();
    expect(config.load).toHaveBeenCalledOnce();
  });
  it("stages checkboxes, excludes already attached IDs without conflating files and attaches one frozen batch", async () => {
    const config = multiple();
    await render({ ...config, selectedIds: ["file-a:1"] });
    await open();
    await browse();
    expect(button("Attach").disabled).toBe(true);
    const existing = await choose("First frame");
    expect(existing.getAttribute("aria-checked")).toBe("true");
    expect(existing.hasAttribute("disabled")).toBe(true);
    await choose("Second frame");
    expect(config.presentation.onAttach).not.toHaveBeenCalled();
    await click("Attach");
    expect(config.presentation.onAttach).toHaveBeenCalledOnce();
    const [items, request] = config.presentation.onAttach.mock.calls[0];
    expect(items).toEqual([frames[1]]);
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(items[0])).toBe(true);
    expect(request).toMatchObject({
      url: "https://example.com/supported/file",
      page: 1,
      signal: expect.any(AbortSignal),
    });
    expect(dialog()).toBeNull();
  });
  it("retains staged choices across pages, search and ordinary refresh", async () => {
    const config = multiple();
    config.load.mockImplementation(async ({ page }: { page: number }) => ({
      items: [frames[page === 2 ? 1 : 0]],
      hasMore: page === 1,
      nextCursor: "second",
    }));
    await render(config);
    await open();
    await browse();
    await choose("First frame");
    await click("Next");
    await choose("Second frame");
    await type("one", 'input[type="search"]');
    await render({ ...config, refreshKey: 1 });
    await click("Attach");
    expect(config.presentation.onAttach.mock.calls[0][0]).toEqual(frames);
    expect(
      config.load.mock.calls.some(([request]) => request.cursor === "second"),
    ).toBe(true);
  });
  it("shows provider errors, retries without losing the URL, and suppresses late cancelled reads", async () => {
    const config = multiple();
    const late = deferred<{ items: typeof frames; hasMore: boolean }>();
    config.load
      .mockRejectedValueOnce(new Error("Source access denied"))
      .mockReturnValueOnce(late.promise);
    await render(config);
    await open();
    await browse();
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe(
      "Source access denied",
    );
    expect(dialog()!.querySelector('[role="status"]')).toBeNull();
    await click("Retry");
    const request = config.load.mock.calls.at(-1)![0];
    expect(request.url).toBe("https://example.com/supported/file");
    await click("Cancel");
    expect(request.signal.aborted).toBe(true);
    await act(async () => late.resolve({ items: frames, hasMore: false }));
    expect(dialog()).toBeNull();
  });
  it("aborts a pending batch on identity change and does not close a newer dialog", async () => {
    const config = multiple();
    const pending = deferred<void>();
    config.presentation.onAttach.mockReturnValue(pending.promise);
    await render(config);
    await open();
    await browse();
    await choose("First frame");
    await click("Attach");
    const request = config.presentation.onAttach.mock.calls[0][1];
    expect(button("Attach").disabled).toBe(true);
    await render({ ...config, scopeKey: "account-b" });
    await tick();
    expect(dialog()).toBeNull();
    expect(request.signal.aborted).toBe(true);
    await open();
    await act(async () => pending.resolve());
    expect(dialog()).not.toBeNull();
    expect(
      dialog()!.querySelector<HTMLInputElement>('input[type="url"]')!.value,
    ).toBe("");
  });
  it("backs out of a pending list and ignores its stale response", async () => {
    const config = multiple();
    const pending = deferred<{ items: typeof frames; hasMore: boolean }>();
    config.load.mockReturnValue(pending.promise);
    await render(config);
    await open();
    await browse();
    const request = config.load.mock.calls[0][0];
    await click("Back");
    expect(request.signal.aborted).toBe(true);
    await act(async () => pending.resolve({ items: frames, hasMore: false }));
    expect(dialog()!.querySelector('[role="checkbox"]')).toBeNull();
    expect(document.activeElement).toBe(
      dialog()!.querySelector('input[type="url"]'),
    );
  });
  it("retries failed batches and respects false without clearing staged selection", async () => {
    const config = multiple();
    config.presentation.onAttach
      .mockRejectedValueOnce(new Error("Cannot attach yet"))
      .mockResolvedValueOnce(false);
    await render(config);
    await open();
    await browse();
    await choose("First frame");
    await click("Attach");
    expect(dialog()!.textContent).toContain("Cannot attach yet");
    expect(button("Retry").parentElement).toBe(button("Attach").parentElement);
    await click("Retry");
    expect(dialog()).not.toBeNull();
    expect(config.presentation.onAttach).toHaveBeenCalledTimes(2);
    expect(button("Attach").disabled).toBe(false);
  });
  it("dims the parent surface behind the source picker", async () => {
    await render(multiple());
    await open();

    const overlay = Array.from(
      document.querySelectorAll<HTMLElement>('[data-state="open"]'),
    ).find((element) => element.className.includes("backdrop-blur-sm"));
    expect(overlay?.className).toContain("bg-background/85");
  });
  it("uses URL-only mode without a list, keeps caret navigation, and restores focus on Escape", async () => {
    const select = vi.fn().mockResolvedValue(false);
    const load = vi.fn();
    await render({
      presentation: { type: "dialog", mode: "url" },
      onSelect: select,
      load,
      searchPlaceholder: "Unused",
      link: {
        label: "Website URL",
        placeholder: "https://example.com",
        submitLabel: "Unused",
      },
    });
    await open();
    expect(button("Attach").disabled).toBe(true);
    await type("https://example.com/page");
    const input =
      dialog()!.querySelector<HTMLInputElement>('input[type="url"]')!;
    for (const key of ["ArrowLeft", "ArrowRight"])
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        ),
      );
    expect(dialog()).not.toBeNull();
    await click("Attach");
    expect(load).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(
      {
        id: "https://example.com/page",
        title: "https://example.com/page",
        url: "https://example.com/page",
      },
      expect.objectContaining({
        url: "https://example.com/page",
        signal: expect.any(AbortSignal),
      }),
    );
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await tick();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
