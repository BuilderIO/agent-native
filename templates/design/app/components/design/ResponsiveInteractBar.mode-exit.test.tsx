import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  ResponsiveInteractBar,
  type ResponsiveInteractBarProps,
} from "./ResponsiveInteractBar";

// Only the keys this bar reads — full catalog coverage across locales is
// verified by `guard:i18n-catalogs`, not here (same convention as
// BreakpointBar.test.tsx).
const CATALOG_MESSAGES = {
  designEditor: {
    modes: {
      edit: "Edit",
      annotate: "Annotate",
    },
    responsiveInteract: {
      device: "Device",
      width: "Width",
      widthAbbreviation: "W",
      height: "Height",
      heightAbbreviation: "H",
      zoom: "Zoom",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      zoomToPreset: "Zoom to {{percent}}%",
      exit: "Exit responsive preview",
    },
  },
};

function renderBar(props: Partial<ResponsiveInteractBarProps> = {}): string {
  return renderToStaticMarkup(
    createElement(AgentNativeI18nProvider, {
      catalog: { messages: CATALOG_MESSAGES },
      children: createElement(
        TooltipProvider,
        null,
        createElement(ResponsiveInteractBar, {
          deviceName: "Desktop",
          width: 1440,
          height: 900,
          zoom: 100,
          onDeviceChange: vi.fn(),
          onWidthChange: vi.fn(),
          onHeightChange: vi.fn(),
          onZoomChange: vi.fn(),
          onModeChange: vi.fn(),
          canAnnotate: true,
          onClose: vi.fn(),
          ...props,
        } as ResponsiveInteractBarProps),
      ),
    }),
  );
}

// Hiding the bottom toolbar during Interact closed the two-view bypass but
// left "Exit responsive preview" as the only way out — Edit and Annotate were
// not in the DOM at all. This bar carries them instead.
describe("ResponsiveInteractBar mode exits", () => {
  it("offers Edit and Annotate alongside Close", () => {
    const markup = renderBar();

    expect(markup).toContain('aria-label="Edit"');
    expect(markup).toContain('aria-label="Annotate"');
    expect(markup).toContain('aria-label="Exit responsive preview"');
    expect(markup).toContain("tabler-icon-transform-point");
    expect(markup).toContain("tabler-icon-scribble");
  });

  it("hides Annotate for a caller without edit access", () => {
    const markup = renderBar({ canAnnotate: false });

    expect(markup).toContain('aria-label="Edit"');
    expect(markup).not.toContain('aria-label="Annotate"');
  });

  it("keeps every right-side action at its clickable width", () => {
    const markup = renderBar();

    for (const label of ["Edit", "Annotate", "Exit responsive preview"]) {
      expect(markup).toMatch(
        new RegExp(
          `<button[^>]*class="[^"]*shrink-0[^"]*"[^>]*aria-label="${label}"`,
        ),
      );
    }
    expect(markup).toMatch(
      /<button[^>]*class="[^"]*shrink-0[^"]*"[^>]*>100\.0%/,
    );
  });
});
