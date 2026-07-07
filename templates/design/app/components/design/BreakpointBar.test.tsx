import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  availableBreakpointPresets,
  breakpointLabelForWidth,
  BreakpointDeviceControl,
  type BreakpointDeviceControlProps,
  FRAMER_BREAKPOINT_PRESETS,
  parseBreakpointWidthInput,
} from "./BreakpointBar";

// Minimal catalog covering only the keys BreakpointDeviceControl reads — see
// the same convention/rationale note in
// inspector/BreakpointOverrideIndicator.test.tsx. Full catalog coverage
// across all 11 locales is verified by `guard:i18n-catalogs`, not here.
const CATALOG_MESSAGES = {
  designEditor: {
    breakpointBar: {
      base: "Base",
      editBaseWidth: "Edit base width",
      addBreakpoint: "Add breakpoint",
      remove: "Remove breakpoint",
      options: "Breakpoint options",
      changeWidth: "Change width",
      customWidth: "Custom width",
      add: "Add",
      showAllBreakpoints: "Show all breakpoints",
      desktop: "Desktop",
      tablet: "Tablet",
      phone: "Phone",
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
      children: createElement(Component, props),
    }),
  );
}

function renderControl(
  props: Partial<BreakpointDeviceControlProps> = {},
): string {
  return renderWithProviders(BreakpointDeviceControl, {
    breakpoints: [],
    canEdit: true,
    onSelect: vi.fn(),
    ...props,
  } as BreakpointDeviceControlProps);
}

describe("BreakpointDeviceControl — item 8a device icons", () => {
  it("renders a phone icon + width number for a narrow breakpoint segment", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Phone", widthPx: 390 }],
    });
    expect(markup).toContain("tabler-icon-device-mobile");
    expect(markup).not.toContain("tabler-icon-device-tablet");
    expect(markup).not.toContain("tabler-icon-device-desktop");
    expect(markup).toContain(">390<");
  });

  it("renders a tablet icon + width number for a mid-width breakpoint segment", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Tablet", widthPx: 810 }],
    });
    expect(markup).toContain("tabler-icon-device-tablet");
    expect(markup).not.toContain("tabler-icon-device-mobile");
    expect(markup).toContain(">810<");
  });

  it("renders a desktop icon + width number for a wide breakpoint segment", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Desktop", widthPx: 1200 }],
    });
    expect(markup).toContain("tabler-icon-device-desktop");
    expect(markup).toContain(">1200<");
  });

  it("renders one icon per segment, ordered widest first, plus the icon-only Base segment", () => {
    const markup = renderControl({
      breakpoints: [
        { id: "bp-390", label: "Phone", widthPx: 390 },
        { id: "bp-810", label: "Tablet", widthPx: 810 },
      ],
    });
    // Base segment uses IconViewportWide (icon-only, no width shown for it).
    expect(markup).toContain("tabler-icon-viewport-wide");
    const tabletIndex = markup.indexOf("tabler-icon-device-tablet");
    const mobileIndex = markup.indexOf("tabler-icon-device-mobile");
    expect(tabletIndex).toBeGreaterThan(-1);
    expect(mobileIndex).toBeGreaterThan(-1);
    // Widest-first ordering: the 810 (tablet) segment's icon appears before
    // the 390 (mobile) segment's icon in source order.
    expect(tabletIndex).toBeLessThan(mobileIndex);
  });

  it("boundary: exactly 1024px renders as desktop, exactly 600px renders as tablet", () => {
    const desktopBoundary = renderControl({
      breakpoints: [{ id: "bp-1", label: "Desktop", widthPx: 1024 }],
    });
    expect(desktopBoundary).toContain("tabler-icon-device-desktop");

    const tabletBoundary = renderControl({
      breakpoints: [{ id: "bp-1", label: "Tablet", widthPx: 600 }],
    });
    expect(tabletBoundary).toContain("tabler-icon-device-tablet");
  });
});

describe("BreakpointDeviceControl — Base segment and selection state", () => {
  it("marks Base as pressed when activeWidthPx is undefined", () => {
    const markup = renderControl({ activeWidthPx: undefined });
    expect(markup).toContain('aria-pressed="true"');
  });

  it("marks the matching breakpoint segment as pressed when active", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Tablet", widthPx: 810 }],
      activeWidthPx: 810,
    });
    // Two aria-pressed="true": none expected on Base (false) and one on the
    // active breakpoint segment.
    const trueCount = (markup.match(/aria-pressed="true"/g) ?? []).length;
    expect(trueCount).toBe(1);
  });
});

describe("parseBreakpointWidthInput", () => {
  it("accepts a valid width in range", () => {
    expect(parseBreakpointWidthInput("500", [])).toBe(500);
  });

  it("rejects non-numeric input", () => {
    expect(parseBreakpointWidthInput("abc", [])).toBeNull();
  });

  it("rejects widths below 320 or above 3840", () => {
    expect(parseBreakpointWidthInput("319", [])).toBeNull();
    expect(parseBreakpointWidthInput("3841", [])).toBeNull();
  });

  it("rejects a width already taken by another breakpoint", () => {
    expect(parseBreakpointWidthInput("810", [810])).toBeNull();
  });
});

describe("breakpointLabelForWidth / availableBreakpointPresets", () => {
  it("labels widths by the same buckets as the device icon", () => {
    expect(breakpointLabelForWidth(1200)).toBe("Desktop");
    expect(breakpointLabelForWidth(810)).toBe("Tablet");
    expect(breakpointLabelForWidth(390)).toBe("Phone");
  });

  it("excludes presets already present by exact width", () => {
    const remaining = availableBreakpointPresets([810]);
    expect(remaining.map((p) => p.widthPx)).not.toContain(810);
    expect(remaining.length).toBe(FRAMER_BREAKPOINT_PRESETS.length - 1);
  });
});
