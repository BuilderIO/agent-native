// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  BreakpointOverrideIndicator,
  type BreakpointOverrideIndicatorProps,
} from "./BreakpointOverrideIndicator";

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
    <AgentNativeI18nProvider catalog={{ messages: CATALOG_MESSAGES }}>
      <TooltipProvider>{createElement(Component, props)}</TooltipProvider>
    </AgentNativeI18nProvider>,
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

  it("falls back to the generic tooltip when maxWidthPx is non-finite or non-positive", () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -400]) {
      const markup = renderIndicator({
        overridden: true,
        maxWidthPx: invalid,
      });
      expect(markup).toContain('aria-label="Overridden at this breakpoint"');
      expect(markup).not.toContain("NaNpx");
    }
  });

  it("stops propagation and prevents default when clicking Reset inside a clickable row", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onParentClick = vi.fn();
    const onReset = vi.fn();
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider catalog={{ messages: CATALOG_MESSAGES }}>
            <TooltipProvider>
              <div onClick={onParentClick}>
                <BreakpointOverrideIndicator
                  overridden
                  maxWidthPx={810}
                  onReset={onReset}
                />
              </div>
            </TooltipProvider>
          </AgentNativeI18nProvider>,
        );
      });
      const resetButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Reset override"]',
      );
      expect(resetButton).not.toBeNull();
      if (!resetButton) return;
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        resetButton.dispatchEvent(clickEvent);
      });
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(onParentClick).not.toHaveBeenCalled();
      expect(clickEvent.defaultPrevented).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
