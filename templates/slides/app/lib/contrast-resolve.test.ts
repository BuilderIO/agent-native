// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { measureRenderedContrast, parseCssColor } from "./contrast-resolve";

function mount(html: string) {
  document.body.innerHTML = `<div data-slide-canvas="s1" style="background-color: rgb(255, 255, 255)">${html}</div>`;
  const canvas = document.querySelector<HTMLElement>("[data-slide-canvas]")!;
  const byId = (id: string) => document.getElementById(id)!;
  return { canvas, byId };
}

// jsdom has no layout, so give every text run one 100x20 box.
beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ left: 10, top: 10, width: 100, height: 20 }],
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) =>
    pseudo
      ? ({
          content: "none",
          backgroundColor: "rgba(0, 0, 0, 0)",
        } as CSSStyleDeclaration)
      : computed(el),
  );
});

afterEach(() => {
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("parseCssColor", () => {
  it("reads rgb and rgba in both syntaxes", () => {
    expect(parseCssColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor("rgba(1, 2, 3, 0.5)")).toEqual({
      r: 1,
      g: 2,
      b: 3,
      a: 0.5,
    });
    expect(parseCssColor("rgb(1 2 3 / 50%)")).toEqual({
      r: 1,
      g: 2,
      b: 3,
      a: 0.5,
    });
    expect(parseCssColor("color(display-p3 1 0 0)")).toBeNull();
  });
});

describe("measureRenderedContrast", () => {
  it("measures text against the opaque shape beneath it", () => {
    const { canvas, byId } = mount(
      '<div id="card" style="background-color: rgb(17, 17, 17)"><p id="t" style="color: rgb(255, 255, 255); font-size: 16px; font-weight: 400">Hi</p></div>',
    );
    const stack = [byId("t"), byId("card"), canvas];
    const measured = measureRenderedContrast(byId("t"), canvas, () => stack);
    expect(measured).toMatchObject({
      foreground: "#ffffff",
      background: "#111111",
      requiredRatio: 4.5,
    });
    expect(measured!.ratio).toBeGreaterThan(18);
  });

  it("composites a translucent layer over the opaque one", () => {
    const { canvas, byId } = mount(
      '<div id="tint" style="background-color: rgba(0, 0, 0, 0.5)"><p id="t" style="color: rgb(255, 255, 255); font-size: 16px">Hi</p></div>',
    );
    const stack = [byId("t"), byId("tint"), canvas];
    const measured = measureRenderedContrast(byId("t"), canvas, () => stack);
    expect(measured?.background).toBe("#808080");
    expect(measured!.ratio).toBeLessThan(4.5);
  });

  it("uses the worst sampled point when the text spans two backgrounds", () => {
    const { canvas, byId } = mount(
      '<div id="dark" style="background-color: rgb(0, 0, 0)"></div><p id="t" style="color: rgb(119, 119, 119); font-size: 16px">Hi</p>',
    );
    const measured = measureRenderedContrast(byId("t"), canvas, (x) =>
      x < 40 ? [byId("t"), byId("dark"), canvas] : [byId("t"), canvas],
    );
    expect(measured?.background).toBe("#ffffff");
    expect(measured!.ratio).toBeLessThan(4.5);
  });

  it("stays unverified over an image or gradient layer", () => {
    const { canvas, byId } = mount(
      '<div id="art" style="background-image: linear-gradient(red, blue)"><p id="t" style="color: rgb(255, 255, 255); font-size: 16px">Hi</p></div>',
    );
    expect(
      measureRenderedContrast(byId("t"), canvas, () => [
        byId("t"),
        byId("art"),
        canvas,
      ]),
    ).toBeNull();
  });

  it("stays unverified when a slide layer paints over the text", () => {
    const { canvas, byId } = mount(
      '<p id="t" style="color: rgb(0, 0, 0); font-size: 16px">Hi</p><div id="veil" style="background-color: rgba(255, 0, 0, 0.3)"></div>',
    );
    expect(
      measureRenderedContrast(byId("t"), canvas, () => [
        byId("veil"),
        byId("t"),
        canvas,
      ]),
    ).toBeNull();
  });

  it("ignores editor chrome above the slide", () => {
    const { canvas, byId } = mount(
      '<p id="t" style="color: rgb(0, 0, 0); font-size: 16px">Hi</p>',
    );
    const chrome = document.createElement("div");
    chrome.style.backgroundColor = "rgb(0, 0, 255)";
    document.body.append(chrome);
    const measured = measureRenderedContrast(byId("t"), canvas, () => [
      chrome,
      byId("t"),
      canvas,
    ]);
    expect(measured?.background).toBe("#ffffff");
  });

  it("stays unverified when nothing opaque sits under the text inside the slide", () => {
    const { canvas, byId } = mount(
      '<p id="t" style="color: rgb(0, 0, 0); font-size: 16px">Hi</p>',
    );
    canvas.style.backgroundColor = "rgba(0, 0, 0, 0)";
    expect(
      measureRenderedContrast(byId("t"), canvas, () => [
        byId("t"),
        canvas,
        document.body,
      ]),
    ).toBeNull();
  });

  it("treats large text as needing 3:1", () => {
    const { canvas, byId } = mount(
      '<h1 id="t" style="color: rgb(0, 0, 0); font-size: 24px; font-weight: 400">Hi</h1>',
    );
    expect(
      measureRenderedContrast(byId("t"), canvas, () => [byId("t"), canvas])
        ?.requiredRatio,
    ).toBe(3);
  });
});
