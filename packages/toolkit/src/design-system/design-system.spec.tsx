// @vitest-environment happy-dom

import { act, forwardRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolkitProvider } from "../provider.js";
import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
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

  it("warns when nested providers combine the effective ActionButton APIs", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const LegacyButton = () => <button data-adapter="legacy" />;
    const CustomActionButton = () => <button data-adapter="semantic" />;

    act(() => {
      root.render(
        <ToolkitProvider
          designSystem={{
            components: { ActionButton: CustomActionButton },
          }}
        >
          <ToolkitProvider components={{ Button: LegacyButton }}>
            <Button>Save</Button>
          </ToolkitProvider>
        </ToolkitProvider>,
      );
    });

    expect(container.querySelector("[data-adapter=semantic]")).not.toBeNull();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("forwards semantic intent independently from the legacy visual variant", () => {
    const received = vi.fn();
    const CustomActionButton = (props: ComponentProps<typeof ActionButton>) => {
      received(props.intent, props.emphasis);
      return <button>{props.children}</button>;
    };

    act(() => {
      root.render(
        <ToolkitProvider
          designSystem={{ components: { ActionButton: CustomActionButton } }}
        >
          <Button variant="ghost" intent="danger" emphasis="outline">
            Remove
          </Button>
        </ToolkitProvider>,
      );
    });

    expect(received).toHaveBeenCalledWith("danger", "outline");
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

  it.each(["pointer", "Enter", "Space", "ArrowDown"])(
    "preserves Radix menu trigger behavior through a legacy Button override with %s activation",
    async (activation) => {
      const onOpenChange = vi.fn();
      let buttonRef: HTMLButtonElement | null = null;
      const LegacyButton = forwardRef<
        HTMLButtonElement,
        ComponentProps<typeof Button>
      >(
        (
          {
            asChild: _asChild,
            emphasis: _emphasis,
            intent: _intent,
            size: _size,
            variant: _variant,
            ...props
          },
          ref,
        ) => <button {...props} ref={ref} data-adapter="legacy" />,
      );

      await act(async () => {
        root.render(
          <ToolkitProvider
            components={{ Button: LegacyButton }}
            designSystem={{}}
          >
            <DropdownMenu onOpenChange={onOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={(node) => {
                    buttonRef = node;
                  }}
                >
                  Open menu
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>First item</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ToolkitProvider>,
        );
      });

      const trigger = container.querySelector<HTMLButtonElement>("button");
      expect(trigger).not.toBeNull();
      expect(buttonRef).toBe(trigger);
      expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
      expect(trigger?.dataset.state).toBe("closed");

      await act(async () => {
        trigger?.focus();
        if (activation === "pointer") {
          trigger?.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              pointerType: "mouse",
            }),
          );
        } else {
          const key = activation === "Space" ? " " : activation;
          trigger?.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key }),
          );
        }
        await Promise.resolve();
      });

      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenLastCalledWith(true);
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      expect(trigger?.dataset.state).toBe("open");
      expect(document.querySelector("[role=menu]")).not.toBeNull();

      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
        );
        await Promise.resolve();
      });

      expect(onOpenChange).toHaveBeenCalledTimes(2);
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
      expect(trigger?.dataset.state).toBe("closed");
    },
  );

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
