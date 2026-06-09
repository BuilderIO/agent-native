import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WireframeBlock } from "./wireframe.js";
import type { WireframeData } from "./wireframe.config.js";
import type { BlockRenderContext } from "../types.js";

/**
 * Rendering contract for the AUTO-HEIGHT wireframe frame.
 *
 * The frame is content-driven: it keeps each surface's WIDTH/footprint and all
 * chrome, but its HEIGHT fits the content instead of being padded to a fixed
 * per-surface aspect (which left a big empty vertical band below short content
 * in published recaps). So the inner artboard must NOT carry a hard pixel
 * `height` — only a `min-height` floor that content can grow past or settle
 * toward.
 *
 * These assertions run against the effect-free static markup (no layout
 * measurement), which exercises exactly the SSR / first-paint fallback: the
 * floor-height box, never a fixed aspect.
 */

const ctx = {} as unknown as BlockRenderContext;

function render(data: WireframeData): string {
  return renderToStaticMarkup(
    createElement(WireframeBlock, {
      data,
      blockId: "wf-1",
      ctx,
    }),
  );
}

/** Pull the inline `style` attribute of the `.plan-kit-artboard` element. */
function artboardStyle(html: string): string {
  const match = html.match(
    /class="plan-kit-artboard[^"]*"[^>]*style="([^"]*)"/,
  );
  if (!match) {
    // The class/style attribute order can vary; fall back to scanning the tag.
    const tag = html.match(/<div[^>]*plan-kit-artboard[^>]*>/)?.[0] ?? "";
    return tag.match(/style="([^"]*)"/)?.[1] ?? "";
  }
  return match[1];
}

describe("wireframe auto-height frame", () => {
  it("floors the artboard with min-height and sets no fixed height (kit tree)", () => {
    const html = render({
      surface: "browser",
      screen: [{ el: "title", text: "Hi" }],
    });
    const style = artboardStyle(html);

    expect(style).toMatch(/min-height/);
    // No fixed `height:` declaration on the artboard — that is what used to pad
    // short content to a tall fixed aspect.
    expect(style).not.toMatch(/(^|;)\s*height\s*:/);
  });

  it("floors the artboard with min-height and sets no fixed height (html mockup)", () => {
    const html = render({
      surface: "browser",
      html: "<div>Short header + dropdown</div>",
    });
    const style = artboardStyle(html);

    expect(style).toMatch(/min-height/);
    expect(style).not.toMatch(/(^|;)\s*height\s*:/);
  });

  it("keeps the per-surface width footprint", () => {
    const html = render({
      surface: "browser",
      html: "<div>x</div>",
    });
    const style = artboardStyle(html);

    // browser preset width is 900 — the footprint is preserved.
    expect(style).toMatch(/width\s*:\s*900px/);
  });

  it("applies a taller floor to a phone surface than a popover", () => {
    const mobileStyle = artboardStyle(
      render({ surface: "mobile", html: "<div>x</div>" }),
    );
    const popoverStyle = artboardStyle(
      render({ surface: "popover", html: "<div>x</div>" }),
    );

    const mobileFloor = Number(
      mobileStyle.match(/min-height\s*:\s*(\d+)px/)?.[1] ?? "0",
    );
    const popoverFloor = Number(
      popoverStyle.match(/min-height\s*:\s*(\d+)px/)?.[1] ?? "0",
    );

    expect(mobileFloor).toBeGreaterThan(popoverFloor);
  });
});
