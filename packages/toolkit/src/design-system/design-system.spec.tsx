// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolkitProvider } from "../provider.js";
import { Button } from "../ui/button.js";
import { ActionButton } from "./components.js";
import { defaultDesignSystemComponents } from "./default-adapter.js";
import { defineDesignSystem } from "./definition.js";
import { defineTheme } from "./theme.js";
import { DESIGN_SYSTEM_CONTRACT_VERSION } from "./types.js";

describe("design-system contract", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("locks the seventeen semantic component names", () => {
    expect(DESIGN_SYSTEM_CONTRACT_VERSION).toBe(1);
    expect(Object.keys(defaultDesignSystemComponents).sort()).toEqual(
      [
        "ActionButton",
        "Avatar",
        "Checkbox",
        "Dialog",
        "IconButton",
        "Menu",
        "Picker",
        "Popover",
        "Skeleton",
        "Spinner",
        "Status",
        "Surface",
        "Switch",
        "Tabs",
        "TextArea",
        "TextField",
        "Tooltip",
      ].sort(),
    );
  });

  it("preserves typed design-system and theme definitions", () => {
    const theme = defineTheme({
      colors: {
        light: { primary: "oklch(55% 0.2 260)" },
      },
      radius: "0.75rem",
    });
    const definition = defineDesignSystem({
      name: "Acme",
      theme,
      components: {},
    });

    expect(definition).toEqual({ name: "Acme", theme, components: {} });
  });

  it("prefers ActionButton over the legacy Button override", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const LegacyButton = () => <button data-adapter="legacy" />;
    const CustomActionButton = () => <button data-adapter="semantic" />;

    act(() => {
      root.render(
        <ToolkitProvider
          components={{ Button: LegacyButton }}
          designSystem={{
            components: { ActionButton: CustomActionButton },
          }}
        >
          <Button>Save</Button>
        </ToolkitProvider>,
      );
    });

    expect(container.querySelector("[data-adapter=semantic]")).not.toBeNull();
    expect(container.querySelector("[data-adapter=legacy]")).toBeNull();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("uses legacy Button as the lowest-precedence ActionButton adapter", () => {
    const LegacyButton = (props: ComponentProps<"button">) => (
      <button {...props} data-adapter="legacy" />
    );

    act(() => {
      root.render(
        <ToolkitProvider components={{ Button: LegacyButton }}>
          <ActionButton>Save</ActionButton>
        </ToolkitProvider>,
      );
    });

    expect(container.querySelector("[data-adapter=legacy]")?.textContent).toBe(
      "Save",
    );
  });

  it("isolates a broken customer component and renders the default control", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const BrokenActionButton = () => {
      throw new Error("broken adapter");
    };

    act(() => {
      root.render(
        <ToolkitProvider
          designSystem={{
            components: { ActionButton: BrokenActionButton },
          }}
        >
          <ActionButton>Fallback action</ActionButton>
        </ToolkitProvider>,
      );
    });

    expect(container.querySelector("button")?.textContent).toBe(
      "Fallback action",
    );
    expect(console.error).toHaveBeenCalled();
  });
});
