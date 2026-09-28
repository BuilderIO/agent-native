import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  ResponsiveInteractBar,
  type ResponsiveInteractBarProps,
} from "./ResponsiveInteractBar";

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
    <AgentNativeI18nProvider catalog={{ messages: CATALOG_MESSAGES }}>
      <TooltipProvider>
        {createElement(ResponsiveInteractBar, {
          deviceName: "Desktop",
          width: 1440,
          height: 900,
          onDeviceChange: vi.fn(),
          onWidthChange: vi.fn(),
          onHeightChange: vi.fn(),
          onModeChange: vi.fn(),
          canAnnotate: true,
          onClose: vi.fn(),
          ...props,
        } as ResponsiveInteractBarProps)}
      </TooltipProvider>
    </AgentNativeI18nProvider>,
  );
}

describe("ResponsiveInteractBar mode exits", () => {
  it("offers Edit and Annotate alongside Close", () => {
    const markup = renderBar();

    expect(markup).toContain('aria-label="Edit"');
    expect(markup).toContain('aria-label="Annotate"');
    expect(markup).toContain('aria-label="Exit responsive preview"');
    expect(markup).toContain("tabler-icon-transform-point");
    expect(markup).toContain("tabler-icon-scribble");
  });

  it("shows the exit control's label as visible text, not just a tooltip", () => {
    const markup = renderBar();
    const exitButtonStart = markup.indexOf(
      'aria-label="Exit responsive preview"',
    );
    const exitButtonEnd = markup.indexOf("</button>", exitButtonStart);

    expect(exitButtonStart).toBeGreaterThan(-1);
    expect(markup.slice(exitButtonStart, exitButtonEnd)).toContain(
      "Exit responsive preview",
    );
  });

  it("reserves the pinned Close width without rendering a second control", () => {
    const markup = renderBar({ showClose: false });

    expect(markup).toContain('aria-label="Edit"');
    expect(markup).not.toContain('aria-label="Exit responsive preview"');
    expect(markup).toContain(
      'aria-hidden="true" class="invisible flex shrink-0 items-center pl-1"',
    );
    expect(markup).toMatch(
      /<button class="[^"]*h-7[^"]*shrink-0[^"]*gap-1\.5[^"]*px-2[^"]*!text-\[12px\][^"]*" disabled="" tabindex="-1">/,
    );
    expect(markup).toContain("Exit responsive preview");
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
    expect(markup).not.toContain("100.0%");
    expect(markup).toContain(
      'class="flex shrink-0 items-center bg-[var(--design-editor-panel-bg)] pl-1"',
    );
  });
});
