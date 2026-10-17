// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TokensPanel } from "./TokensPanel";

const mocks = vi.hoisted(() => ({
  applyMutateAsync: vi.fn(),
  importMutateAsync: vi.fn(),
  tokensData: {
    designId: "design-1",
    tokenCount: 3,
    tokens: [],
    groups: [
      {
        group: "color",
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
        group: "spacing",
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
      : { mutateAsync: mocks.applyMutateAsync, isPending: false },
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
  mocks.applyMutateAsync.mockResolvedValue({});
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <TokensPanel designId="design-1" />
        </TooltipProvider>
      </QueryClientProvider>,
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

/** Radix menus open on keyboard or pointerdown, not a synthetic click. */
async function openMenu(label: string) {
  await act(() =>
    button(label)!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

function menuItem(label: string) {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((el) => el.textContent === label);
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
    await openMenu("designEditor.tokens.import");
    for (const key of [
      "importDtcg",
      "importCssOrTailwind",
      "importClipboard",
      "importFromDesign",
    ]) {
      expect(menuItem(`designEditor.tokens.${key}`)).toBeDefined();
    }
  });

  it("adds a typed draft token from the new-token menu", async () => {
    await openMenu("designEditor.tokens.newToken");
    await act(() => menuItem("designEditor.tokens.types.opacity")!.click());
    // The draft row mounts once the menu has finished closing.
    const draftInputs = () =>
      Array.from(
        container.querySelectorAll<HTMLInputElement>("input.font-mono"),
      );
    await vi.waitFor(() => expect(draftInputs()).toHaveLength(2));
    const [nameInput, valueInput] = draftInputs();
    expect(nameInput.value).toBe("--opacity-1");
    await act(() => setInputValue(valueInput, "0.4"));
    await act(() =>
      valueInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(mocks.applyMutateAsync).toHaveBeenCalledWith({
      designId: "design-1",
      edits: [{ cssVar: "--opacity-1", value: "0.4", type: "opacity" }],
    });
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
    expect(container.querySelector('input:not([type="file"])')).toBeNull();
    await act(async () => {
      button("designEditor.tokens.search")!.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const field = container.querySelector<HTMLInputElement>(
      'input:not([type="file"])',
    )!;
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
    expect(container.querySelector('input:not([type="file"])')).toBeNull();
  });
});
