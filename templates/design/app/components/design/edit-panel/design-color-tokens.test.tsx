// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import enUS from "../../../i18n/en-US";
import {
  DesignColorTokensProvider,
  readColorTokens,
} from "./design-color-tokens";
import { ColorInput } from "./panel-primitives";

const queryState = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: { data: undefined as unknown, isError: false },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => {
    queryState.calls.push(args);
    return queryState.result;
  },
  useActionMutation: () => ({ mutate: vi.fn() }),
}));

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
  queryState.calls = [];
  queryState.result = { data: undefined, isError: false };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const INDEXED = {
  designId: "d1",
  tokens: [
    { name: "Link", cssVar: "--link", value: "#0a6bd6", type: "color" },
    { name: "Gap", cssVar: "--gap", value: "16px", type: "spacing" },
    { name: "Ink", cssVar: "--ink", value: "#111111", type: "color" },
  ],
};

describe("readColorTokens", () => {
  it("keeps only color tokens, in order", () => {
    expect(readColorTokens({ data: INDEXED, isError: false })).toEqual({
      status: "ready",
      tokens: [
        { name: "Link", cssVar: "--link", value: "#0a6bd6" },
        { name: "Ink", cssVar: "--ink", value: "#111111" },
      ],
    });
  });

  it("is loading until an answer arrives and an error if none will", () => {
    expect(readColorTokens({ data: undefined, isError: false })).toEqual({
      status: "loading",
    });
    expect(readColorTokens({ data: undefined, isError: true })).toEqual({
      status: "error",
    });
  });

  it("treats an answer that is not a token list as an error, not an empty design", () => {
    expect(readColorTokens({ data: {}, isError: false })).toEqual({
      status: "error",
    });
    expect(
      readColorTokens({ data: { tokens: "nope" }, isError: false }),
    ).toEqual({ status: "error" });
  });

  it("is an empty list only when the design really has no color tokens", () => {
    expect(readColorTokens({ data: { tokens: [] }, isError: false })).toEqual({
      status: "ready",
      tokens: [],
    });
  });
});

function mount(
  props: Partial<React.ComponentProps<typeof ColorInput>> & {
    designId?: string | undefined;
    withProvider?: boolean;
  } = {},
) {
  const { withProvider = true, ...inputProps } = props;
  const designId = "designId" in props ? props.designId : "d1";
  delete (inputProps as { designId?: string }).designId;
  const onChange = vi.fn();
  const input = (
    <TooltipProvider>
      <ColorInput
        label="Fill"
        value="#ff0000"
        onChange={onChange}
        bindTokens
        {...inputProps}
      />
    </TooltipProvider>
  );
  act(() =>
    root.render(
      withProvider ? (
        <DesignColorTokensProvider designId={designId}>
          {input}
        </DesignColorTokensProvider>
      ) : (
        input
      ),
    ),
  );
  return { onChange };
}

const trigger = () =>
  document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Open color picker"]',
  )!;
const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  );

function openPicker() {
  act(() => trigger().click());
}
function tab(name: string) {
  return Array.from(
    popover()!.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((candidate) => candidate.textContent === name)!;
}

describe("DesignColorTokensProvider", () => {
  it("does not read the design's tokens until a picker opens", () => {
    queryState.result = { data: INDEXED, isError: false };
    mount();
    expect(queryState.calls).toHaveLength(0);

    openPicker();

    expect(queryState.calls.length).toBeGreaterThan(0);
    expect(queryState.calls[0]).toEqual([
      "index-design-tokens",
      { designId: "d1" },
    ]);
  });

  it("offers no Libraries without a design to read tokens from", () => {
    mount({ designId: undefined });
    openPicker();
    expect(popover()!.querySelector('[role="tablist"]')).toBeNull();
    expect(queryState.calls).toHaveLength(0);
  });

  it("offers no Libraries outside the inspector's provider", () => {
    mount({ withProvider: false });
    openPicker();
    expect(popover()!.querySelector('[role="tablist"]')).toBeNull();
  });

  it("offers no Libraries to a caller that does not bind tokens", () => {
    mount({ bindTokens: false });
    openPicker();
    expect(popover()!.querySelector('[role="tablist"]')).toBeNull();
    expect(queryState.calls).toHaveLength(0);
  });
});

describe("ColorInput token binding", () => {
  it("writes var(--token) as a commit and shows the token's color", () => {
    queryState.result = { data: INDEXED, isError: false };
    const { onChange } = mount();
    openPicker();
    act(() => tab("Libraries").click());

    const row = Array.from(
      popover()!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ).find((button) => button.textContent === "Link")!;
    act(() => row.click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("var(--link)", { phase: "commit" });
    expect(popover()).toBeNull();
    expect(
      trigger().querySelector<HTMLElement>("span.size-3\\.5")!.style
        .backgroundColor,
    ).toBe("#0a6bd6");
    expect(trigger().textContent).toContain("Link");
  });

  it("lists only color tokens", () => {
    queryState.result = { data: INDEXED, isError: false };
    mount();
    openPicker();
    act(() => tab("Libraries").click());
    const names = Array.from(
      popover()!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    )
      .filter((button) => button.title.startsWith("--"))
      .map((button) => button.textContent);
    expect(names).toEqual(["Link", "Ink"]);
  });

  it("opens on the bound token", () => {
    queryState.result = { data: INDEXED, isError: false };
    mount({ boundToken: "--ink" });
    openPicker();
    expect(tab("Libraries").getAttribute("aria-selected")).toBe("true");
    const active = Array.from(
      popover()!.querySelectorAll<HTMLButtonElement>(
        'button[aria-pressed="true"]',
      ),
    ).filter((button) => button.title.startsWith("--"));
    expect(active.map((button) => button.textContent)).toEqual(["Ink"]);
  });

  it("is a failure, not an empty design, when the tokens cannot be read", () => {
    queryState.result = { data: undefined, isError: true };
    mount();
    openPicker();
    act(() => tab("Libraries").click());
    expect(popover()!.textContent).toContain("Couldn't load design tokens");
  });
});
