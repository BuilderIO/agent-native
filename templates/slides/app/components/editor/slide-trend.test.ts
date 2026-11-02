// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { sanitizeSlideHtml } from "@/lib/sanitize-slide-html";

import { QUARTERLY_DECK } from "../../../server/lib/deck-templates/a-quarterly";
import { refreshAutoTrends, trendOfText } from "./slide-trend";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountSlide(index: number) {
  const slide = QUARTERLY_DECK.slides.at(index);
  if (!slide) throw new Error(`the QBR template has no slide ${index}`);
  document.body.innerHTML = `<div class="slide-content">${slide.content}</div>`;
  return slide.content;
}

function value(text: string): HTMLElement {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>('[data-trend="auto"]'),
  ).find((element) => element.textContent === text);
  if (!found) throw new Error(`no auto-trend value ${text}`);
  return found;
}

describe("values colored by their sign", () => {
  it("reads the sign of the first number", () => {
    expect(trendOfText("+4.1%")).toBe("up");
    expect(trendOfText("12 pts")).toBe("up");
    expect(trendOfText("-0.0pt QoQ")).toBe("down");
    expect(trendOfText("−3%")).toBe("down");
    expect(trendOfText("$-1.2M")).toBe("down");
    expect(trendOfText("0.0%")).toBe("flat");
    expect(trendOfText("n/a")).toBeNull();
  });

  it("recolors a QBR delta pill from its edited text", () => {
    mountSlide(1);
    const pill = value("-0.0pt");
    expect(pill.style.getPropertyValue("--trend")).toBe("var(--trend-down)");
    pill.textContent = "+2.4pt";
    refreshAutoTrends(pill.closest("div") ?? pill);
    expect(pill.style.getPropertyValue("--trend")).toBe("var(--trend-up)");
    expect(pill.style.getPropertyValue("color")).toBe("var(--trend)");
  });

  it("recolors a segment cell, with a flat color for an unsigned zero", () => {
    mountSlide(4);
    const cell = value("-0.0%");
    cell.textContent = "+3.0%";
    refreshAutoTrends(cell);
    expect(cell.style.getPropertyValue("--trend")).toBe("var(--trend-up)");
    cell.textContent = "0%";
    refreshAutoTrends(cell);
    expect(cell.style.getPropertyValue("--trend")).toBe("var(--trend-flat)");
  });

  it("leaves untouched values byte for byte", () => {
    mountSlide(4);
    const table = document.querySelector("table");
    if (!table) throw new Error("no segment table");
    const before = table.outerHTML;
    refreshAutoTrends(table);
    expect(table.outerHTML).toBe(before);
  });

  it("survives the slide sanitizer", () => {
    const content = mountSlide(4);
    const clean = sanitizeSlideHtml(content);
    expect(clean).toContain('data-trend="auto"');
    expect(clean).toMatch(/--trend:\s*var\(--trend-down\)/);
    expect(clean).toMatch(/[;"]\s*color:\s*var\(--trend\)/);
  });
});
