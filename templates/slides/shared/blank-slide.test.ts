import { describe, expect, it } from "vitest";

import { isBlankSlideContent, isRealSlide } from "./blank-slide";

const CLIENT_DEFAULT_BLANK = `<div class="fmd-slide" style="padding: 80px 110px; position: relative; font-family: 'Poppins', sans-serif;"></div>`;
const SERVER_FALLBACK_PLACEHOLDER = `<div class="fmd-slide" style="box-sizing: border-box; width: 100%; height: 100%; padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;"><div style="font-size: 28px; font-weight: 600; color: hsl(var(--muted-foreground) / 0.4);">Double-click to edit</div></div>`;
const excalidrawWith = (elements: unknown[]) =>
  JSON.stringify({ elements, appState: {} });

describe("isBlankSlideContent", () => {
  it.each([
    ["the client default blank", CLIENT_DEFAULT_BLANK],
    ["an empty string", ""],
    ["an entity-only body", '<div class="fmd-slide">&nbsp;</div>'],
    ["a transparent background class", '<div class="bg-transparent"></div>'],
  ])("treats %s as blank", (_name, html) => {
    expect(isBlankSlideContent(html)).toBe(true);
  });

  it.each([
    ["text", '<div class="fmd-slide">Agenda</div>'],
    ["a background class", '<div class="fmd-slide bg-slate-900"></div>'],
    [
      "an inline background",
      '<div class="fmd-slide" style="background: #123456;"></div>',
    ],
    [
      "an svg with no text",
      '<div class="fmd-slide"><svg width="10" height="10"></svg></div>',
    ],
    ["an image", '<div class="fmd-slide"><img src="/a.png"></div>'],
  ])("treats %s as content", (_name, html) => {
    expect(isBlankSlideContent(html)).toBe(false);
  });
});

describe("isRealSlide", () => {
  it("counts a slide with content and not a blank one", () => {
    expect(
      isRealSlide({ content: '<div class="fmd-slide">Agenda</div>' }),
    ).toBe(true);
    expect(isRealSlide({ content: CLIENT_DEFAULT_BLANK })).toBe(false);
    expect(
      isRealSlide({ content: '<div class="fmd-slide">&nbsp;</div>' }),
    ).toBe(false);
  });

  it("counts a slide whose only content is a background class or an svg", () => {
    expect(isRealSlide({ content: '<div class="bg-slate-900"></div>' })).toBe(
      true,
    );
    expect(isRealSlide({ content: "<svg></svg>" })).toBe(true);
  });

  // Known limitation: the server's last-slide fallback carries text, so it is
  // counted like any slide the user typed into.
  it("counts the server fallback placeholder because it carries text", () => {
    expect(isRealSlide({ content: SERVER_FALLBACK_PLACEHOLDER })).toBe(true);
  });

  it("counts excalidraw data with elements that the renderer draws instead of the content", () => {
    expect(
      isRealSlide({
        content: CLIENT_DEFAULT_BLANK,
        excalidrawData: excalidrawWith([{ id: "rect-1", type: "rectangle" }]),
      }),
    ).toBe(true);
  });

  it.each([
    ["no elements", excalidrawWith([])],
    ["data that is not JSON", "not json"],
    ["JSON with no elements array", JSON.stringify({ appState: {} })],
    ["a null value", null],
    ["a missing value", undefined],
  ])("does not count excalidraw data with %s", (_name, excalidrawData) => {
    expect(isRealSlide({ content: CLIENT_DEFAULT_BLANK, excalidrawData })).toBe(
      false,
    );
  });

  it("does not count a value that is not a slide", () => {
    expect(isRealSlide(null)).toBe(false);
    expect(isRealSlide(undefined)).toBe(false);
    expect(isRealSlide({ content: 42 })).toBe(false);
  });
});
