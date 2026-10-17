// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SlideInner,
  isRawHtmlSlide,
} from "../../app/components/deck/SlideRenderer";
import { getAspectRatioDims } from "../../shared/aspect-ratios.js";
import { listBuiltInDeckTemplates } from "./deck-templates.js";

vi.mock("../../app/components/deck/MermaidRenderer", () => ({
  MermaidRenderer: () => null,
}));
vi.mock("../../app/components/deck/ExcalidrawSlide", () => ({
  ExcalidrawThumbnail: () => null,
  parseExcalidrawData: () => null,
}));

afterEach(cleanup);

describe("built-in templates through the actual slide renderer", () => {
  for (const template of listBuiltInDeckTemplates()) {
    it.each(template.slides)(
      `${template.id} renders $id as editable HTML rather than text`,
      (slide) => {
        expect(isRawHtmlSlide(slide)).toBe(true);
        expect(getAspectRatioDims(template.aspectRatio)).toMatchObject({
          width: template.width,
          height: template.height,
        });
        const { container } = render(
          <SlideInner
            slide={slide}
            aspectRatio={template.aspectRatio}
            stampSource
          />,
        );
        const canvas = container.querySelector<HTMLElement>(
          "[data-slide-canvas]",
        );
        const content = container.querySelector<HTMLElement>(".fmd-slide");
        expect(canvas?.style.width).toBe("960px");
        expect(canvas?.style.height).toBe("540px");
        expect(content?.style.width).toBe("960px");
        expect(content?.style.height).toBe("540px");
        expect(
          content?.querySelector("h1")?.textContent?.length,
        ).toBeGreaterThan(5);
        expect(
          content?.querySelector("p")?.textContent?.length,
        ).toBeGreaterThan(20);
        expect(
          content?.querySelector("h1")?.getAttribute("style"),
        ).not.toContain("margin:0 0:0");
        expect(container.textContent).not.toContain('<div class="fmd-slide"');
        expect(container.querySelector("script,iframe,img")).toBeNull();
      },
    );
  }
});
