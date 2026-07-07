import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  motionPropertyHasKeyframe,
  MotionKeyframeDiamond,
  type MotionKeyframeDiamondProps,
} from "./MotionKeyframeDiamond";

// Minimal catalog covering only the keys this component reads — see the
// same convention/rationale note in InteractionStatePanel.test.tsx. Full
// catalog coverage across all 11 locales is verified by
// `guard:i18n-catalogs`, not here.
const CATALOG_MESSAGES = {
  editPanel: {
    motionKeyframe: {
      addTooltip: "Add keyframe",
      removeTooltip: "Remove keyframe",
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

function renderDiamond(
  props: Partial<MotionKeyframeDiamondProps> = {},
): string {
  return renderWithProviders(MotionKeyframeDiamond, {
    cssProperty: "opacity",
    hasKeyframe: false,
    onToggle: vi.fn(),
    ...props,
  } as MotionKeyframeDiamondProps);
}

describe("MotionKeyframeDiamond", () => {
  it("renders an outline (non-pressed) diamond when the property has no keyframe", () => {
    const markup = renderDiamond({ hasKeyframe: false });
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("Add keyframe");
  });

  it("renders a filled (pressed) diamond when the property already has a keyframe", () => {
    const markup = renderDiamond({ hasKeyframe: true });
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("design-editor-accent-color");
    expect(markup).toContain("Remove keyframe");
  });

  it("stamps the exact CSS property name for the caller to resolve on click", () => {
    const markup = renderDiamond({ cssProperty: "border-radius" });
    expect(markup).toContain('data-motion-css-property="border-radius"');
  });

  it("carries an aria-label matching the tooltip for accessibility", () => {
    const markup = renderDiamond({ hasKeyframe: false });
    expect(markup).toContain('aria-label="Add keyframe"');
  });
});

describe("motionPropertyHasKeyframe", () => {
  it("returns false when keyframedProperties is undefined", () => {
    expect(motionPropertyHasKeyframe(undefined, "opacity")).toBe(false);
  });

  it("returns false when the property isn't in the list", () => {
    expect(motionPropertyHasKeyframe(["opacity"], "scale")).toBe(false);
  });

  it("returns true when the property is in the list", () => {
    expect(motionPropertyHasKeyframe(["opacity", "scale"], "scale")).toBe(true);
  });
});
