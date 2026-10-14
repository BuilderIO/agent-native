// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TokensPanel } from "./TokensPanel";

const mocks = vi.hoisted(() => ({
  applyMutate: vi.fn(),
  importMutateAsync: vi.fn(),
  tokensData: {
    designId: "design-1",
    tokenCount: 3,
    tokens: [],
    groups: [
      {
        type: "color",
        tokens: [
          {
            name: "Accent",
            cssVar: "--accent",
            value: "#ff0000",
            type: "color",
            source: "design.md",
          },
          {
            name: "Surface",
            cssVar: "--surface",
            value: "#ffffff",
            type: "color",
            source: "design.md",
          },
        ],
      },
      {
        type: "spacing",
        tokens: [
          {
            name: "Gap",
            cssVar: "--gap",
            value: "8px",
            type: "spacing",
            source: "design.md",
          },
        ],
      },
    ],
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: mocks.tokensData,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useActionMutation: (action: string) =>
    action === "import-design-tokens"
      ? { mutateAsync: mocks.importMutateAsync, isPending: false }
      : { mutate: mocks.applyMutate, isPending: false },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));

vi.mock("./TokenColorPicker", () => ({
  TokenColorPicker: ({ name }: { name: string }) => (
    <button type="button" aria-label={`swatch ${name}`} />
  ),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <TooltipProvider>
        <TokensPanel designId="design-1" />
      </TooltipProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
}

function groupRow(label: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((el) => el.hasAttribute("aria-expanded") && el.textContent === label)!;
}

function setInputValue(input: HTMLInputElement, next: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Tokens panel header", () => {
  it("shows the count with search, import and new-token buttons", () => {
    expect(container.textContent).toContain("designEditor.tokens.count");
    expect(button("designEditor.tokens.search")).not.toBeNull();
    expect(button("designEditor.tokens.import")).not.toBeNull();
    expect(button("designEditor.tokens.newToken")).not.toBeNull();
  });

  it("opens the import menu with its four sources", async () => {
    await act(() => button("designEditor.tokens.import")!.click());
    const menuText = document.body.textContent ?? "";
    for (const title of [
      "Import a set from text",
      "Import from a file",
      "Import from a folder",
      "Import from current design",
    ]) {
      expect(menuText).toContain(title);
    }
  });

  it("opens the new-token popover and adds a normalized CSS variable", async () => {
    await act(() => button("designEditor.tokens.newToken")!.click());
    const inputs = Array.from(
      document.body.querySelectorAll<HTMLInputElement>("input.font-mono"),
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[0].placeholder).toBe("--my-token");
    await act(() => {
      setInputValue(inputs[0], "brand");
      setInputValue(inputs[1], "#123456");
    });
    const add = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((el) => el.textContent === "designEditor.tokens.add");
    await act(() => add!.click());
    expect(mocks.applyMutate).toHaveBeenCalledWith(
      {
        designId: "design-1",
        edits: [{ cssVar: "--brand", value: "#123456" }],
      },
      expect.any(Object),
    );
  });
});

describe("Tokens panel list", () => {
  it("lays rows out like Layers: 32px rows, 24px indent slots per level", () => {
    const colors = groupRow("Colors");
    expect(colors.classList.contains("h-[var(--design-row-height)]")).toBe(
      true,
    );
    expect(colors.classList.contains("pl-2.5")).toBe(true);
    expect(colors.querySelectorAll("[data-layer-row-indent]")).toHaveLength(1);

    const tokenRow = button("Edit Accent")!.closest<HTMLElement>(".group")!;
    expect(tokenRow.classList.contains("h-[var(--design-row-height)]")).toBe(
      true,
    );
    expect(tokenRow.classList.contains("pl-2.5")).toBe(true);
    const slots = tokenRow.querySelectorAll("[data-layer-row-indent]");
    expect(slots).toHaveLength(2);
    expect(
      Array.from(slots).every((slot) => slot.classList.contains("w-6")),
    ).toBe(true);
  });

  it("collapses a group", async () => {
    expect(button("Edit Accent")).not.toBeNull();
    await act(() => groupRow("Colors").click());
    expect(button("Edit Accent")).toBeNull();
    expect(button("Edit Gap")).not.toBeNull();
  });
});

describe("Tokens panel search", () => {
  it("opens the Layers-style field, filters, and closes on Escape when empty", async () => {
    expect(container.querySelector("input")).toBeNull();
    await act(async () => {
      button("designEditor.tokens.search")!.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const field = container.querySelector<HTMLInputElement>("input")!;
    expect(field.placeholder).toBe("designEditor.tokens.search");
    expect(document.activeElement).toBe(field);
    expect(field.parentElement?.querySelector("svg")).not.toBeNull();

    await act(() => setInputValue(field, "gap"));
    expect(button("Edit Gap")).not.toBeNull();
    expect(button("Edit Accent")).toBeNull();

    await act(() => setInputValue(field, ""));
    await act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(container.querySelector("input")).toBeNull();
  });
});
