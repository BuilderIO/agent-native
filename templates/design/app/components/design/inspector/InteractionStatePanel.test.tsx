// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { act, createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  InteractionStateOverrideIndicator,
  InteractionStatePanel,
  isImmediateInteractionMenuClose,
  type InteractionStatePanelProps,
} from "./InteractionStatePanel";

// Minimal catalog covering only the keys this component reads, so tests get
// the REAL translated strings (not the useT() humanized-fallback path) while
// staying independent of the full app/i18n-data.ts catalog. Coverage across
// all 11 locales for these keys is verified by `guard:i18n-catalogs`, not
// here.
const CATALOG_MESSAGES = {
  editPanel: {
    interactionStates: {
      default: "Default",
      hover: "Hover",
      focus: "Focus",
      focusVisible: "Focus visible",
      active: "Pressed",
      disabled: "Disabled",
      selectorLabel: "Interaction state",
      selectorTooltip: "Preview and edit hover, focus, and pressed states",
      editingState: "Editing {{state}} state",
      editingStateTooltip:
        "Editing the {{state}} state — styles here apply only when this element is {{state}}",
      hasOverrideIndicator: "This property is overridden in this state",
      reset: "Reset",
      resetOverride: "Reset override",
      resetOverrideTooltip:
        "Clear this state's override and use the default value",
    },
  },
};

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderWithProviders<P extends object>(
  Component: ComponentType<P>,
  props: P,
): string {
  return renderToStaticMarkup(
    createElement(AgentNativeI18nProvider, {
      catalog: { messages: CATALOG_MESSAGES },
      children: createElement(
        TooltipProvider,
        null,
        createElement(Component, props),
      ),
    }),
  );
}

function renderPanel(
  props: Partial<InteractionStatePanelProps> & {
    onActiveStateChange?: InteractionStatePanelProps["onActiveStateChange"];
  } = {},
): string {
  return renderWithProviders(InteractionStatePanel, {
    activeState: null,
    onActiveStateChange: vi.fn(),
    ...props,
  } as InteractionStatePanelProps);
}

describe("InteractionStatePanel", () => {
  it("classifies only the immediate post-open reconciliation close", () => {
    expect(isImmediateInteractionMenuClose(1_000, 1_399)).toBe(true);
    expect(isImmediateInteractionMenuClose(1_000, 1_400)).toBe(false);
    expect(isImmediateInteractionMenuClose(0, 1)).toBe(false);
  });

  it("shows 'Default' when no state is active, with no editing indicator", () => {
    const markup = renderPanel({ activeState: null });
    expect(markup).toContain("Default");
    expect(markup).not.toContain("Editing");
  });

  it("shows the plain Figma state name when Hover is active", () => {
    const markup = renderPanel({ activeState: "hover" });
    expect(markup).toContain(">Hover<");
    expect(markup).not.toContain(">Editing Hover state<");
  });

  it("shows the correct plain label for every non-default state", () => {
    expect(renderPanel({ activeState: "focus" })).toContain(">Focus<");
    expect(renderPanel({ activeState: "focus-visible" })).toContain(
      ">Focus visible<",
    );
    expect(renderPanel({ activeState: "active" })).toContain(">Pressed<");
    expect(renderPanel({ activeState: "disabled" })).toContain(">Disabled<");
  });

  it("keeps the trigger visually stable when switching states", () => {
    const defaultMarkup = renderPanel({ activeState: null });
    const hoverMarkup = renderPanel({ activeState: "hover" });
    expect(defaultMarkup).toContain("design-editor-control-bg");
    expect(hoverMarkup).toContain("design-editor-control-bg");
    expect(defaultMarkup).toContain('data-interaction-state="default"');
    expect(hoverMarkup).toContain('data-interaction-state="hover"');
  });

  it("carries an aria-label on the trigger for accessibility", () => {
    const markup = renderPanel({ activeState: null });
    expect(markup).toContain('aria-label="Interaction state"');
  });
});

const mountedRoots: Array<{
  root: ReturnType<typeof createRoot>;
  container: HTMLDivElement;
}> = [];

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) continue;
    await act(async () => mounted.root.unmount());
    mounted.container.remove();
  }
  document.body
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((node) => node.remove());
});

async function mountPanel(
  props: Partial<InteractionStatePanelProps> & {
    onActiveStateChange?: InteractionStatePanelProps["onActiveStateChange"];
  } = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  const onActiveStateChange = props.onActiveStateChange ?? vi.fn();
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: CATALOG_MESSAGES }}
        persistPreference={false}
      >
        <TooltipProvider>
          <InteractionStatePanel
            activeState={null}
            {...props}
            onActiveStateChange={onActiveStateChange}
          />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
  return { container, root, onActiveStateChange };
}

async function openMenu(trigger: HTMLButtonElement) {
  trigger.focus();
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

describe("InteractionStatePanel menu interactions", () => {
  it("restores a controlled open menu after a transient inspector-subtree remount", async () => {
    const onActiveStateChange = vi.fn();
    const onOpenChange = vi.fn();
    const { container, root } = await mountPanel({
      open: true,
      onOpenChange,
      onActiveStateChange,
    });
    expect(
      container
        .querySelector('button[aria-label="Interaction state"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");

    // A just-authored source update can briefly make inspectorElement null.
    // EditPanel keeps `open` above this conditional subtree and passes it back
    // when the exact same stable selection is reconciled.
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: CATALOG_MESSAGES }}
          persistPreference={false}
        >
          <TooltipProvider>{null}</TooltipProvider>
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: CATALOG_MESSAGES }}
          persistPreference={false}
        >
          <TooltipProvider>
            <InteractionStatePanel
              activeState="hover"
              onActiveStateChange={onActiveStateChange}
              open
              onOpenChange={onOpenChange}
            />
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    expect(
      container
        .querySelector('button[aria-label="Interaction state"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("matches Figma's state order, icons, and selected trailing dot", async () => {
    const { container } = await mountPanel();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Interaction state"]',
    );
    expect(trigger).not.toBeNull();
    await openMenu(trigger!);

    const items = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Default",
      "Hover",
      "Focus",
      "Focus visible",
      "Pressed",
      "Disabled",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
    expect(items[0]?.querySelector("svg")).toBeNull();
    for (const item of items.slice(1)) {
      expect(item.querySelector("svg")).not.toBeNull();
    }
    expect(items[0]?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("keeps canonical Figma order when the caller narrows states out of order", async () => {
    const { container } = await mountPanel({
      availableStates: ["disabled", "hover", "focus"],
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Interaction state"]',
    );
    await openMenu(trigger!);
    const items = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Default",
      "Hover",
      "Focus",
      "Disabled",
    ]);
  });

  it("supports Arrow-key navigation and Enter selection", async () => {
    const onActiveStateChange = vi.fn();
    const { container } = await mountPanel({ onActiveStateChange });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Interaction state"]',
    );
    await openMenu(trigger!);

    const items = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    expect(document.activeElement).toBe(items[0]);
    await act(async () => {
      items[0]!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(items[1]);
    await act(async () => {
      items[1]!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onActiveStateChange).toHaveBeenCalledOnce();
    expect(onActiveStateChange).toHaveBeenCalledWith("hover");
  });

  it("always marks the selected non-default row, even before it has overrides", async () => {
    const { container } = await mountPanel({ activeState: "active" });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Interaction state"]',
    );
    await openMenu(trigger!);
    const pressed = document.body.querySelector<HTMLElement>(
      '[data-interaction-state-option="active"]',
    );
    expect(pressed?.getAttribute("aria-checked")).toBe("true");
    expect(pressed?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("retains an authored-override indicator on an unselected state", async () => {
    const { container } = await mountPanel({
      statesWithOverrides: new Set(["hover"]),
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Interaction state"]',
    );
    await openMenu(trigger!);
    const hover = document.body.querySelector<HTMLElement>(
      '[data-interaction-state-option="hover"]',
    );
    expect(hover?.dataset.hasOverride).toBe("true");
    expect(
      hover?.querySelector(
        '[aria-label="This property is overridden in this state"]',
      ),
    ).not.toBeNull();
  });
});

describe("InteractionStateOverrideIndicator", () => {
  it("renders nothing when there is no override", () => {
    const markup = renderWithProviders(InteractionStateOverrideIndicator, {
      hasOverride: false,
    });
    expect(markup).toBe("");
  });

  it("renders an indicator dot when there is an override", () => {
    const markup = renderWithProviders(InteractionStateOverrideIndicator, {
      hasOverride: true,
    });
    expect(markup.length).toBeGreaterThan(0);
    expect(markup).toContain("design-editor-accent-color");
  });

  it("renders a reset affordance when onReset is provided", () => {
    const markup = renderWithProviders(InteractionStateOverrideIndicator, {
      hasOverride: true,
      onReset: vi.fn(),
    });
    expect(markup).toContain("Reset");
  });

  it("omits the reset affordance when onReset is not provided", () => {
    const markup = renderWithProviders(InteractionStateOverrideIndicator, {
      hasOverride: true,
    });
    expect(markup).not.toContain("Reset");
  });
});
