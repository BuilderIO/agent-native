import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  findUnreadableTextColors,
  formatSlideContrastWarning,
} from "./slide-contrast.js";

describe("contrastRatio", () => {
  it("matches the WCAG extremes", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("composites a translucent foreground instead of scoring it opaque", () => {
    // Without alpha compositing this is black-on-white and scores 21:1.
    expect(contrastRatio("rgba(0, 0, 0, 0.1)", "#ffffff")!).toBeLessThan(1.3);
    expect(contrastRatio("#0000001a", "#ffffff")!).toBeLessThan(1.3);
    expect(contrastRatio("rgba(0, 0, 0, 1)", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("does not guess what sits behind a translucent background", () => {
    expect(contrastRatio("#000000", "rgba(255, 255, 255, 0.4)")).toBeNull();
  });

  it("returns null rather than a pass for an unreadable side", () => {
    expect(contrastRatio("var(--ink)", "#ffffff")).toBeNull();
    expect(contrastRatio("#000000", "linear-gradient(#fff, #eee)")).toBeNull();
  });
});

describe("findUnreadableTextColors", () => {
  it("catches the reported light-on-light slide", () => {
    // Material-3-style light kit: surface canvas with an on-primary-ish text
    // color that only belongs on the filled primary container.
    const html = `
      <div class="fmd-slide" style="background: #FEF7FF; padding: 64px 80px;">
        <h1 style="color: #FFFBFE; font-size: 56px;">The Moon Landing</h1>
        <p style="color: #F7F2FA;">July 20, 1969</p>
      </div>`;

    const report = findUnreadableTextColors({ html });

    expect(report.unreadable.map((entry) => entry.text)).toEqual([
      "#f7f2fa",
      "#fffbfe",
    ]);
    expect(report.unreadable[0]!.ratio).toBeLessThan(1.2);
  });

  it("passes a correctly paired light kit", () => {
    const html = `
      <div class="fmd-slide" style="background: #FEF7FF;">
        <h1 style="color: #1D1B20;">The Moon Landing</h1>
        <p style="color: #49454F;">July 20, 1969</p>
      </div>`;

    expect(findUnreadableTextColors({ html }).unreadable).toEqual([]);
  });

  it("passes a correctly paired dark kit", () => {
    const html = `
      <div class="fmd-slide" style="background: #0B0E14;">
        <h1 style="color: #F7F8FA;">The Moon Landing</h1>
      </div>`;

    expect(findUnreadableTextColors({ html }).unreadable).toEqual([]);
  });

  it("does not flag light text that sits on a dark card in a light slide", () => {
    const html = `
      <div class="fmd-slide" style="background: #FEF7FF;">
        <h1 style="color: #1D1B20;">The Moon Landing</h1>
        <div style="background: #1D1B20; padding: 24px;">
          <span style="color: #FFFFFF;">Apollo 11</span>
        </div>
      </div>`;

    expect(findUnreadableTextColors({ html }).unreadable).toEqual([]);
  });

  it("reads the slide background set outside the HTML", () => {
    const html = `<div class="fmd-slide"><h1 style="color: #FFFBFE;">Hi</h1></div>`;

    expect(
      findUnreadableTextColors({ html, slideBackground: "#FEF7FF" }).unreadable,
    ).toHaveLength(1);
    expect(
      findUnreadableTextColors({ html, slideBackground: "#0B0E14" }).unreadable,
    ).toEqual([]);
  });

  it("catches near-invisible translucent text on a readable canvas", () => {
    const html = `
      <div class="fmd-slide" style="background: #FFFFFF;">
        <p style="color: rgba(0, 0, 0, 0.08);">July 20, 1969</p>
      </div>`;

    expect(findUnreadableTextColors({ html }).unreadable).toHaveLength(1);
  });

  it("checks every declared text color, past any summary truncation", () => {
    const many = Array.from(
      { length: 30 },
      (_, index) =>
        `<p style="color: #1D1B${index.toString(16).padStart(2, "0")};">row ${index}</p>`,
    ).join("");
    const html = `<div class="fmd-slide" style="background: #1D1B20;">${many}<p style="color: #FFFBFE;">readable</p></div>`;

    // Every near-#1D1B20 text color is unreadable on that canvas; a capped
    // audit dropped the ones past its limit.
    expect(
      findUnreadableTextColors({ html }).unreadable.length,
    ).toBeGreaterThan(24);
  });

  it("catches translucent hsla text the same way it catches rgba", () => {
    const html = `<div class="fmd-slide" style="background: #FFFFFF;"><p style="color: hsla(0, 0%, 0%, 0.07);">x</p></div>`;
    expect(findUnreadableTextColors({ html }).unreadable).toHaveLength(1);
  });

  it("catches an unreadable named color", () => {
    const html = `<div class="fmd-slide" style="background: white;"><p style="color: lightgray;">x</p></div>`;
    expect(findUnreadableTextColors({ html }).unreadable).toHaveLength(1);
  });

  it("reports nothing when no background is readable", () => {
    const html = `
      <div class="fmd-slide" style="background: var(--ds-bg);">
        <h1 style="color: #FFFBFE;">Hi</h1>
      </div>`;

    const report = findUnreadableTextColors({ html });
    expect(report.unreadable).toEqual([]);
    expect(report.checkedBackgrounds).toEqual([]);
  });
});

describe("formatSlideContrastWarning", () => {
  it("names the failing pairs and refuses a done claim", () => {
    const warning = formatSlideContrastWarning(
      findUnreadableTextColors({
        html: `<div style="background: #FEF7FF;"><p style="color: #FFFBFE;">x</p></div>`,
      }),
    );
    expect(warning).toContain("#fffbfe on #fef7ff");
    expect(warning).toContain("4.5:1");
    expect(warning).toContain("Do not report the deck as done");
  });

  it("returns null when the slide is readable", () => {
    expect(
      formatSlideContrastWarning({ unreadable: [], checkedBackgrounds: [] }),
    ).toBeNull();
  });
});
