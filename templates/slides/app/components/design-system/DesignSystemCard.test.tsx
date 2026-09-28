// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { DesignSystemData } from "../../../shared/api";
import { DesignSystemCard } from "./DesignSystemCard";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/sharing", () => ({
  ShareButton: () => <button aria-label="share">share</button>,
}));

vi.mock("@agent-native/toolkit/sharing", () => ({
  VisibilityBadge: () => null,
}));

function designSystemData(): DesignSystemData {
  return {
    colors: {
      primary: "#111111",
      secondary: "#222222",
      accent: "#333333",
      background: "#ffffff",
      surface: "#eeeeee",
      text: "#000000",
      textMuted: "#666666",
    },
    typography: {
      headingFont: "Inter, sans-serif",
      bodyFont: "Inter, sans-serif",
      headingWeight: "700",
      bodyWeight: "400",
      headingSizes: { h1: "32px", h2: "24px", h3: "18px" },
    },
    spacing: { slidePadding: "24px", elementGap: "12px" },
    borders: { radius: "8px", accentWidth: "2px" },
    slideDefaults: { background: "#ffffff", labelStyle: "none" },
    logos: [],
  };
}

function renderCard(
  overrides: Partial<Parameters<typeof DesignSystemCard>[0]> = {},
) {
  return render(
    <TooltipProvider>
      <DesignSystemCard
        id="ds-1"
        title="Cursor Slide Deck Design System"
        data={designSystemData()}
        isDefault={false}
        accessRole="owner"
        canManage
        onClick={vi.fn()}
        onSetDefault={vi.fn()}
        onDelete={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("DesignSystemCard swatch/action layout", () => {
  afterEach(cleanup);

  it("keeps the color swatches and the set-default/share/menu buttons as separate, non-overlapping flex siblings", () => {
    renderCard();

    const swatches = screen.getByTestId("design-system-swatches");
    const actions = screen.getByTestId("design-system-actions");

    expect(actions.className).not.toMatch(/\babsolute\b/);
    expect(swatches.className).not.toMatch(/\babsolute\b/);

    const row = swatches.parentElement;
    expect(row).toBe(actions.parentElement);
    expect(row?.className).toMatch(/\bjustify-between\b/);

    expect(swatches.className).toMatch(/\bflex-wrap\b/);
    expect(swatches.className).toMatch(/\bmin-w-0\b/);

    expect(actions.className).toMatch(/\bshrink-0\b/);
  });

  it("keeps the same non-overlapping layout when the swatch group is much wider than the preview", () => {
    const { container } = renderCard();
    const swatchDots = container.querySelectorAll<HTMLElement>(
      '[data-testid="design-system-swatches"] > div',
    );
    expect(swatchDots.length).toBeGreaterThan(0);

    const actions = screen.getByTestId("design-system-actions");
    swatchDots.forEach((dot) => {
      dot.style.width = "200px";
    });

    expect(
      container
        .querySelector('[data-testid="design-system-swatches"]')
        ?.className.includes("flex-wrap"),
    ).toBe(true);
    expect(actions.className).not.toMatch(/\babsolute\b/);
  });
});
