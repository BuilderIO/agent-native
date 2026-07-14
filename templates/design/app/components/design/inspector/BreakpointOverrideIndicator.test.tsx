import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  BreakpointOverrideIndicator,
  type BreakpointOverrideIndicatorProps,
} from "./BreakpointOverrideIndicator";

// Minimal catalog covering only the keys this component reads — see the
// same convention/rationale note in InteractionStatePanel.test.tsx. Full
// catalog coverage across all 11 locales is verified by
// `guard:i18n-catalogs`, not here.
const CATALOG_MESSAGES = {
  editPanel: {
    breakpointOverride: {
      overriddenTooltip: "Overridden at this breakpoint",
      overriddenAtTooltip: "Overridden at {{width}}px",
      reset: "Reset override",
      resetShort: "Reset",
      resetTooltip: "Clear this breakpoint's override and use the base value",
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

function renderIndicator(
  props: Partial<BreakpointOverrideIndicatorProps> = {},
): string {
  return renderWithProviders(BreakpointOverrideIndicator, {
    overridden: false,
    ...props,
  } as BreakpointOverrideIndicatorProps);
}

describe("BreakpointOverrideIndicator", () => {
  it("renders nothing when not overridden", () => {
    const markup = renderIndicator({ overridden: false });
    expect(markup).toBe("");
  });

  it("renders an accent dot when overridden", () => {
    const markup = renderIndicator({ overridden: true, maxWidthPx: 810 });
    expect(markup.length).toBeGreaterThan(0);
    expect(markup).toContain("design-editor-accent-color");
  });

  it("includes the overridden width in the tooltip", () => {
    const markup = renderIndicator({ overridden: true, maxWidthPx: 810 });
    expect(markup).toContain("810px");
    expect(markup).toContain('aria-label="Overridden at 810px"');
  });

  it("falls back to a generic tooltip when no width is given", () => {
    const markup = renderIndicator({ overridden: true, maxWidthPx: null });
    expect(markup).toContain('aria-label="Overridden at this breakpoint"');
  });

  it("renders a reset affordance when onReset is provided", () => {
    const markup = renderIndicator({
      overridden: true,
      maxWidthPx: 810,
      onReset: vi.fn(),
    });
    expect(markup).toContain("Reset");
  });

  it("omits the reset affordance when onReset is not provided", () => {
    const markup = renderIndicator({ overridden: true, maxWidthPx: 810 });
    expect(markup).not.toContain(">Reset<");
  });
});
