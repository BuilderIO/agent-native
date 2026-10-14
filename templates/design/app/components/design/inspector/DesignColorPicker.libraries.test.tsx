// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import enUS from "../../../i18n/en-US";
import type { DesignColorTokens } from "./color-picker-tokens";
import { DesignColorPicker } from "./DesignColorPicker";

// Resolve copy from the real English catalog so a misspelled key fails here.
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, string>) => {
    const found = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enUS,
      );
    if (typeof found !== "string") throw new Error(`Missing i18n key ${key}`);
    return found.replace(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? "");
  },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const ready = (
  ...tokens: Array<{ name: string; cssVar: string; value: string }>
): DesignColorTokens => ({ status: "ready", tokens });

const TOKENS = ready(
  { name: "Primary", cssVar: "--primary", value: "#171717" },
  { name: "On primary", cssVar: "--on-primary", value: "#ffffff" },
  { name: "Link", cssVar: "--link", value: "#0a6bd6" },
);

function renderPicker(
  props: Partial<React.ComponentProps<typeof DesignColorPicker>> = {},
) {
  act(() => {
    root.render(
      <TooltipProvider>
        <DesignColorPicker
          value="#ff0000"
          onChange={() => {}}
          open
          onOpenChange={() => {}}
          trigger={<button type="button">Open picker</button>}
          tokens={TOKENS}
          onPickToken={() => {}}
          {...props}
        />
      </TooltipProvider>,
    );
  });
}

const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  )!;

const librariesTab = () =>
  Array.from(popover().querySelectorAll<HTMLElement>('[role="tab"]')).find(
    (tab) => tab.textContent === "Libraries",
  )!;

const rows = () =>
  Array.from(
    popover().querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  ).filter((button) => button.title.startsWith("--"));

function openLibraries() {
  act(() => librariesTab().click());
}

function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Libraries pane", () => {
  it("lists the design's color tokens by name", () => {
    renderPicker();
    openLibraries();
    expect(popover().textContent).toContain("Design tokens");
    expect(rows().map((row) => row.textContent)).toEqual([
      "Primary",
      "On primary",
      "Link",
    ]);
  });

  it("has no control to create a token", () => {
    renderPicker();
    const header = popover().querySelector('[role="tablist"]')!;
    expect(header.querySelectorAll("button")).toHaveLength(2);
    openLibraries();
    expect(
      Array.from(popover().querySelectorAll("button")).some((button) =>
        /create|new token|add token/i.test(
          `${button.getAttribute("aria-label")} ${button.textContent}`,
        ),
      ),
    ).toBe(false);
  });

  it("filters the list as the search changes and says when nothing matches", () => {
    renderPicker();
    openLibraries();
    const search = popover().querySelector<HTMLInputElement>(
      'input[aria-label="Search tokens"]',
    )!;

    typeInto(search, "pri");
    expect(rows().map((row) => row.textContent)).toEqual([
      "Primary",
      "On primary",
    ]);

    typeInto(search, "--link");
    expect(rows().map((row) => row.textContent)).toEqual(["Link"]);

    typeInto(search, "nothing like this");
    expect(rows()).toHaveLength(0);
    expect(popover().textContent).toContain("No tokens match your search");

    typeInto(search, "");
    expect(rows()).toHaveLength(3);
  });

  it("reports the picked token and closes the picker", () => {
    const onPickToken = vi.fn();
    const onOpenChange = vi.fn();
    const onChange = vi.fn();
    renderPicker({ onPickToken, onOpenChange, onChange });
    openLibraries();

    act(() => rows()[2]!.click());

    expect(onPickToken).toHaveBeenCalledTimes(1);
    expect(onPickToken).toHaveBeenCalledWith({
      name: "Link",
      cssVar: "--link",
      value: "#0a6bd6",
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks the token the fill is bound to and opens on Libraries", () => {
    renderPicker({ boundToken: "--on-primary" });
    expect(librariesTab().getAttribute("aria-selected")).toBe("true");
    const active = rows().filter(
      (row) => row.getAttribute("aria-pressed") === "true",
    );
    expect(active.map((row) => row.textContent)).toEqual(["On primary"]);
    expect(active[0]!.querySelector(".tabler-icon-check")).not.toBeNull();
  });

  it("opens on Custom when the fill is not bound to a token", () => {
    renderPicker();
    expect(librariesTab().getAttribute("aria-selected")).toBe("false");
    expect(popover().querySelector('input[aria-label="Hex"]')).not.toBeNull();
  });

  it("says so, with no search field, when the design has no color tokens", () => {
    renderPicker({ tokens: ready() });
    openLibraries();
    expect(popover().textContent).toContain("This design has no color tokens");
    expect(
      popover().querySelector('input[aria-label="Search tokens"]'),
    ).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("shows a failure, not an empty design, when tokens cannot be loaded", () => {
    renderPicker({ tokens: { status: "error" } });
    openLibraries();
    expect(popover().textContent).toContain("Couldn't load design tokens");
    expect(popover().textContent).not.toContain("no color tokens");
    expect(
      popover().querySelector('input[aria-label="Search tokens"]'),
    ).toBeNull();
  });

  it("shows a placeholder, not an empty design, while tokens load", () => {
    renderPicker({ tokens: { status: "loading" } });
    openLibraries();
    expect(popover().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(popover().textContent).not.toContain("no color tokens");
  });

  it("asks its owner to load tokens when it opens", () => {
    const onRequestTokens = vi.fn();
    renderPicker({ onRequestTokens, open: false });
    expect(onRequestTokens).not.toHaveBeenCalled();
    renderPicker({ onRequestTokens, open: true });
    expect(onRequestTokens).toHaveBeenCalled();
  });

  it("keeps the header for a gradient, so switching paint does not move the picker", () => {
    renderPicker({
      value: "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
      paintType: "linear",
    });
    expect(popover().querySelector('[role="tablist"]')).not.toBeNull();
    expect(librariesTab().getAttribute("aria-selected")).toBe("false");
    openLibraries();
    expect(rows()).toHaveLength(3);
  });

  it("offers no Libraries when nothing can bind a token", () => {
    renderPicker({ onPickToken: undefined });
    expect(popover().querySelector('[role="tablist"]')).toBeNull();
  });
});

describe("a fill written as var(--token)", () => {
  const trigger = () =>
    document.body.querySelector<HTMLElement>(
      'button[aria-label="Open color picker"]',
    );
  /** The field's swatch: the trigger itself for a typed color, a span in it for a token. */
  const swatch = () =>
    trigger()!.querySelector<HTMLElement>("span.size-3\\.5") ?? trigger()!;

  function renderClosed(
    value: string,
    tokens: DesignColorTokens | undefined = TOKENS,
  ) {
    act(() => {
      root.render(
        <TooltipProvider>
          <DesignColorPicker
            value={value}
            tokens={tokens}
            onChange={() => {}}
            onPickToken={() => {}}
          />
        </TooltipProvider>,
      );
    });
  }

  it("shows the resolved color on the swatch and the token's name in the Fill field", () => {
    renderClosed("var(--link)");
    expect(swatch().style.backgroundColor).toBe("#0a6bd6");
    // A token is named, not typed over: no field, and its color is not spelled out.
    expect(document.body.querySelector('input[aria-label="Color"]')).toBeNull();
    expect(trigger()!.textContent).toBe("Link100%");
    expect(trigger()!.title).toBe("var(--link)");
  });

  it("follows a token that aliases another", () => {
    renderClosed(
      "var(--accent)",
      ready(
        { name: "Accent", cssVar: "--accent", value: "var(--link)" },
        { name: "Link", cssVar: "--link", value: "#0a6bd6" },
      ),
    );
    expect(swatch().style.backgroundColor).toBe("#0a6bd6");
    expect(trigger()!.textContent).toContain("Accent");
  });

  it("shows an unresolved token as unresolved, never as a color", () => {
    renderClosed("var(--missing)");
    expect(swatch().style.backgroundColor).toBe("");
    expect(swatch().className).toContain("repeating-linear-gradient");
    expect(trigger()!.title).toBe("--missing isn't defined in this design");
    // The chip keeps the property's name; there is no stand-in color.
    expect(trigger()!.textContent).toContain("--missing");
    expect(trigger()!.textContent).not.toContain("000000");
    expect(trigger()!.querySelector("span.bg-primary\\/10")).toBeNull();
  });

  it("does not call a token unresolved before the token list has loaded", () => {
    renderClosed("var(--link)", { status: "loading" });
    expect(trigger()!.title).toBe("Loading --link");
    expect(swatch().style.backgroundColor).toBe("");
  });

  it("says the list failed to load when it did", () => {
    renderClosed("var(--link)", { status: "error" });
    expect(trigger()!.title).toBe("Couldn't load design tokens");
  });

  it("asks for the token list so it can resolve the value", () => {
    const onRequestTokens = vi.fn();
    act(() => {
      root.render(
        <TooltipProvider>
          <DesignColorPicker
            value="var(--link)"
            onChange={() => {}}
            onRequestTokens={onRequestTokens}
          />
        </TooltipProvider>,
      );
    });
    expect(onRequestTokens).toHaveBeenCalled();
  });
});
