import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderContext } from "../types.js";
import { HTML_ROUGH_SELECTOR } from "./wireframe-kit.js";
import type { WireframeData } from "./wireframe.config.js";
import { WireframeBlock } from "./wireframe.js";

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

function render(data: WireframeData, renderCtx = ctx): string {
  return renderToStaticMarkup(
    createElement(WireframeBlock, {
      data,
      blockId: "wf-1",
      ctx: renderCtx,
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

function classStyle(html: string, className: string): string {
  const tag =
    html.match(
      new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`),
    )?.[0] ?? "";
  return tag.match(/\sstyle="([^"]*)"/)?.[1] ?? "";
}

/** Pull the inline `style` attribute of the scale-reservation wrapper. */
function fitWrapperStyle(html: string): string {
  const outerTag =
    html.match(/<div[^>]*class="plan-kit-wireframe"[^>]*>/)?.[0] ?? "";
  const outerEnd = html.indexOf(outerTag) + outerTag.length;
  const rest = html.slice(Math.max(outerEnd, 0));
  const innerTag = rest.match(/<div[^>]*style="([^"]*)"[^>]*>/)?.[0] ?? "";
  return innerTag.match(/style="([^"]*)"/)?.[1] ?? "";
}

function roughScopeInnerHtml(html: string): string {
  const marker = 'data-rough-scope="wireframe"';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return "";
  const tagEnd = html.indexOf(">", markerIndex);
  if (tagEnd < 0) return "";

  let depth = 1;
  const tagRe = /<\/?div\b[^>]*>/g;
  tagRe.lastIndex = tagEnd + 1;
  for (let match = tagRe.exec(html); match; match = tagRe.exec(html)) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(tagEnd + 1, match.index);
    } else if (!tag.endsWith("/>")) {
      depth += 1;
    }
  }
  return "";
}

describe("wireframe auto-height frame", () => {
  it("roughens standard wireframe primitives by default", () => {
    expect(HTML_ROUGH_SELECTOR).toContain("[data-rough]");
    expect(HTML_ROUGH_SELECTOR).toContain("button");
    expect(HTML_ROUGH_SELECTOR).toContain("input");
    expect(HTML_ROUGH_SELECTOR).toContain(".wf-btn");
    expect(HTML_ROUGH_SELECTOR).toContain(".wf-card");
    expect(HTML_ROUGH_SELECTOR).toContain(".wf-box");
    expect(HTML_ROUGH_SELECTOR).toContain(".wf-pill");
    expect(HTML_ROUGH_SELECTOR).toContain(".wf-chip");
    expect(HTML_ROUGH_SELECTOR).toContain(".wf-icon-fallback");
    expect(HTML_ROUGH_SELECTOR).toContain("[style*='border:']");
    expect(HTML_ROUGH_SELECTOR).toContain("[style*='border-bottom:']");
    expect(HTML_ROUGH_SELECTOR).not.toContain(".wf-frame-target");
  });

  it("hides standard primitive borders after rough.js redraws them", () => {
    const css = readFileSync("src/styles/blocks.css", "utf8");
    const hideRule =
      css.match(
        /\.plan-html-frame\[data-rough-ready\][^{]*\{[^}]*border-color:\s*transparent !important;[^}]*\}/s,
      )?.[0] ?? "";

    expect(hideRule).toContain("button");
    expect(hideRule).toContain("[data-rough]");
    expect(hideRule).toContain(".wf-btn");
    expect(hideRule).toContain(".wf-card");
    expect(hideRule).toContain(".wf-box");
    expect(hideRule).toContain(".wf-pill");
    expect(hideRule).toContain(".wf-chip");
    expect(hideRule).toContain(".wf-icon-fallback");
    expect(hideRule).toContain('[style*="border:"]');
    expect(hideRule).toContain('[style*="border-bottom:"]');
    expect(hideRule).toContain(':not([data-rough="none"])');
  });

  it("styles wf-row as a label/value row primitive", () => {
    const css = readFileSync("src/styles/blocks.css", "utf8");
    const rowRule =
      css.match(
        /\.plan-html-frame:not\(\[data-render-mode="design"\]\) \.wf-row\s*\{[^}]*\}/s,
      )?.[0] ?? "";
    const valueRule =
      css.match(
        /\.plan-html-frame:not\(\[data-render-mode="design"\]\) \.wf-row > :last-child\s*\{[^}]*\}/s,
      )?.[0] ?? "";

    expect(rowRule).toContain("display: flex");
    expect(rowRule).toContain("justify-content: space-between");
    expect(valueRule).toContain("margin-inline-start: auto");
    expect(valueRule).toContain("text-align: end");
  });

  it("strips theme-breaking Tailwind color and shadow classes from wireframes", () => {
    const html = render({
      surface: "browser",
      html: '<section class="bg-white text-zinc-950 shadow-xl flex gap-3 wf-card hover:bg-slate-800"><p class="text-sm text-slate-400">copy</p></section>',
    });

    expect(html).not.toContain("bg-white");
    expect(html).not.toContain("text-zinc-950");
    expect(html).not.toContain("shadow-xl");
    expect(html).not.toContain("hover:bg-slate-800");
    expect(html).not.toContain("text-slate-400");
    expect(html).toContain("flex");
    expect(html).toContain("gap-3");
    expect(html).toContain("wf-card");
    expect(html).toContain("text-sm");
  });

  it("preserves Tailwind theme classes when a design surface opts in", () => {
    const html = render({
      surface: "browser",
      renderMode: "design",
      html: '<section class="bg-white text-zinc-950 shadow-xl">Design</section>',
    });

    expect(html).toContain("bg-white");
    expect(html).toContain("text-zinc-950");
    expect(html).toContain("shadow-xl");
  });

  it("shows the surface frame by default", () => {
    const html = render({
      surface: "browser",
      html: "<div>Framed by default</div>",
    });

    expect(html).toContain('data-frame="show"');
  });

  it("lets host context hide the surface frame by default", () => {
    const html = render(
      {
        surface: "browser",
        html: "<div>Docs-style borderless mockup</div>",
      },
      { visualFrame: "hide" },
    );

    expect(html).toContain('data-frame="hide"');
  });

  it("lets explicit block data override the host frame default", () => {
    const html = render(
      {
        surface: "browser",
        frame: "show",
        html: "<div>Docs block that wants containment</div>",
      },
      { visualFrame: "hide" },
    );

    expect(html).toContain('data-frame="show"');
  });

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

  it("keeps the unscaled auto-height wrapper in natural SSR flow", () => {
    const html = render({
      surface: "desktop",
      html: "<div>Short mockup</div>",
    });
    const style = fitWrapperStyle(html);

    expect(style).not.toMatch(/(^|;)\s*height\s*:/);
  });

  it("renders captions in static markup", () => {
    const html = render({
      surface: "desktop",
      html: "<div>Mockup with caption</div>",
      caption: "Review the main editor state",
    });

    expect(html).toContain("Review the main editor state");
    expect(html).toContain("text-plan-muted");
  });

  it("does not add decorative shadows around the artboard", () => {
    const html = render({
      surface: "browser",
      html: "<div>Mockup without fake depth</div>",
    });
    const style = artboardStyle(html);

    expect(style).not.toMatch(/box-shadow/i);
  });

  it("does not paint a default artboard or root screen backdrop", () => {
    const kitHtml = render({
      surface: "browser",
      screen: [
        {
          el: "card",
          children: [{ el: "text", text: "Preserved card fill" }],
        },
      ],
    });
    const css = readFileSync("src/styles/blocks.css", "utf8");
    const htmlFrameRule =
      css.match(/\.plan-html-frame\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(artboardStyle(kitHtml)).not.toMatch(/(^|;)\s*background\s*:/);
    expect(classStyle(kitHtml, "plan-wf")).toMatch(
      /background\s*:\s*transparent/,
    );
    expect(kitHtml).toContain("background:var(--card)");
    expect(htmlFrameRule).toContain("background: transparent");
    expect(htmlFrameRule).not.toContain("background: var(--wf-paper)");
  });

  it("renders the static outer artboard border only when the frame is shown", () => {
    const html = render({
      surface: "browser",
      skeleton: true,
      html: "<div>Skeleton mockup</div>",
    });
    const borderlessHtml = render({
      surface: "browser",
      frame: "hide",
      skeleton: true,
      html: "<div>Skeleton mockup</div>",
    });

    expect(roughScopeInnerHtml(html)).toContain("border:1.5px solid");
    expect(roughScopeInnerHtml(borderlessHtml)).not.toContain(
      "border:1.5px solid",
    );
  });

  it("renders a contextual visual style toggle", () => {
    const html = render({
      surface: "browser",
      html: "<div>Mockup with style control</div>",
    });

    expect(html).toContain('aria-label="Switch to clean visual style"');
    expect(html).toContain(">Clean</span>");
  });

  it("keeps the visual style toggle outside the rough.js measurement scope", () => {
    const html = render({
      surface: "browser",
      html: "<button>Authored mock button</button>",
    });

    const buttonMarker = 'data-wireframe-style-toggle="true"';
    expect(html).toContain('data-rough-scope="wireframe"');
    expect(html).toContain(buttonMarker);
    expect(html).toContain('data-rough="none"');
    expect(roughScopeInnerHtml(html)).not.toContain(buttonMarker);
  });

  it("renders allowlisted icon markers as inline Tabler-style SVG icons", () => {
    const html = render({
      surface: "popover",
      html: '<button aria-label="Email"><span data-icon="email" aria-label="Email"></span></button><button><i data-icon="lock"></i></button><span data-icon="chevron"></span>',
    });

    expect(html).toContain('class="wf-icon"');
    expect(html).toContain('data-icon="mail"');
    expect(html).toContain('data-icon="lock"');
    expect(html).toContain('data-icon="chevronDown"');
    expect(html).toContain('aria-label="Email"');
    expect(html).toContain("<svg");
    expect(html).not.toContain(">email<");
    expect(html).not.toContain(">lock<");
  });

  it("renders unknown icon markers as a visible fallback", () => {
    const html = render({
      surface: "popover",
      html: '<span data-icon="made-up" aria-label="Mystery icon"></span>',
    });

    expect(html).toContain('class="wf-icon wf-icon-fallback"');
    expect(html).toContain('data-icon="unknown"');
    expect(html).toContain('data-icon-name="made-up"');
    expect(html).toContain('aria-label="Mystery icon"');
    expect(html).toContain(">?</span>");
  });

  it("normalizes sanitized icon labels without double escaping", () => {
    const html = render({
      surface: "popover",
      html: '<span data-icon="mail" aria-label="A & B"></span>',
    });

    expect(html).toContain('aria-label="A &amp; B"');
    expect(html).not.toContain("A &amp;amp; B");
  });

  it("renders empty icon names as a visible fallback", () => {
    const html = render({
      surface: "popover",
      html: '<span data-icon="" aria-label=""></span>',
    });

    expect(html).toContain('class="wf-icon wf-icon-fallback"');
    expect(html).toContain('data-icon-name="unknown"');
    expect(html).toContain('aria-label="Unsupported icon: unknown"');
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
