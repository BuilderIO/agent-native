import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  IconFlowGrid,
  IconFlowHorizontal,
  IconFlowNormal,
  IconFlowVertical,
  IconGap,
  IconLayoutSettings,
  IconPaddingHorizontal,
  IconPaddingVertical,
  IconSizingFill,
  IconSizingFixed,
  IconSizingHug,
  IconSizingMax,
  IconSizingMin,
  IconSizingRemove,
  IconSizingVariable,
  IconText,
} from "./design-icons";

const INSPECTOR_ICONS = [
  IconText,
  IconGap,
  IconPaddingHorizontal,
  IconPaddingVertical,
  IconFlowHorizontal,
  IconFlowVertical,
  IconFlowNormal,
  IconFlowGrid,
  IconLayoutSettings,
  IconSizingFixed,
  IconSizingHug,
  IconSizingFill,
  IconSizingMin,
  IconSizingMax,
  IconSizingVariable,
  IconSizingRemove,
];

describe("Inspector icon vocabulary", () => {
  it.each(INSPECTOR_ICONS)(
    "uses Tabler's shared canvas and stroke contract",
    (Icon) => {
      const markup = renderToStaticMarkup(createElement(Icon));

      expect(markup).toContain("tabler-icon");
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain('stroke-width="2"');
      expect(markup).toContain('stroke-linecap="round"');
      expect(markup).toContain('stroke-linejoin="round"');
    },
  );
});
