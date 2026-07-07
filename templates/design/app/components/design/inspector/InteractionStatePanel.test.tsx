import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  InteractionStateOverrideIndicator,
  InteractionStatePanel,
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
  it("shows 'Default' when no state is active, with no editing indicator", () => {
    const markup = renderPanel({ activeState: null });
    expect(markup).toContain("Default");
    expect(markup).not.toContain("Editing");
  });

  it("shows an unmissable 'Editing <State> state' label when Hover is active", () => {
    const markup = renderPanel({ activeState: "hover" });
    expect(markup).toContain("Editing Hover state");
  });

  it("shows the correct editing label for every non-default state", () => {
    expect(renderPanel({ activeState: "focus" })).toContain(
      "Editing Focus state",
    );
    expect(renderPanel({ activeState: "focus-visible" })).toContain(
      "Editing Focus visible state",
    );
    expect(renderPanel({ activeState: "active" })).toContain(
      "Editing Pressed state",
    );
    expect(renderPanel({ activeState: "disabled" })).toContain(
      "Editing Disabled state",
    );
  });

  it("uses a visibly different accent style for non-default vs default state", () => {
    const defaultMarkup = renderPanel({ activeState: null });
    const hoverMarkup = renderPanel({ activeState: "hover" });
    // Default uses the neutral control background; a non-default state
    // switches the trigger to the accent-color background so it's
    // impossible to miss that a state other than Default is being edited.
    expect(defaultMarkup).toContain("design-editor-control-bg");
    expect(hoverMarkup).not.toContain("design-editor-control-bg");
    expect(hoverMarkup).toContain("design-editor-accent-color");
  });

  it("carries an aria-label on the trigger for accessibility", () => {
    const markup = renderPanel({ activeState: null });
    expect(markup).toContain('aria-label="Interaction state"');
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
