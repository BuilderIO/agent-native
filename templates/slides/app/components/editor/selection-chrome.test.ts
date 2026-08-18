// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

beforeAll(() => {
  document.head.append(stylesheet);
});

afterAll(() => {
  stylesheet.remove();
});

function renderSelectionChrome() {
  document.body.innerHTML = `
    <div data-slide-selection-chrome="true">
      <span data-slide-resize-handle="nw"></span>
      <span data-slide-resize-handle="ne"></span>
      <span data-slide-resize-handle="sw"></span>
      <span data-slide-resize-handle="se"></span>
      <span data-slide-resize-handle="n"><span data-slide-resize-handle-bar="true"></span></span>
      <span data-slide-resize-handle="e"><span data-slide-resize-handle-bar="true"></span></span>
      <span data-slide-resize-handle="s"><span data-slide-resize-handle-bar="true"></span></span>
      <span data-slide-resize-handle="w"><span data-slide-resize-handle-bar="true"></span></span>
    </div>
  `;
}

function handle(name: "nw" | "ne" | "sw" | "se" | "n" | "e" | "s" | "w") {
  const element = document.querySelector(
    `[data-slide-resize-handle="${name}"]`,
  );
  if (!(element instanceof HTMLElement)) throw new Error(`Missing ${name}`);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("slide selection chrome", () => {
  it("uses white, blue-outlined handles without a dark shadow", () => {
    renderSelectionChrome();

    for (const name of ["nw", "ne", "sw", "se", "n", "e", "s", "w"] as const) {
      const target =
        name.length === 1 ? handle(name).firstElementChild : handle(name);
      if (!(target instanceof HTMLElement))
        throw new Error(`Missing ${name} bar`);
      const style = getComputedStyle(target);
      expect(style.backgroundColor).toBe("#fff");
      expect(style.borderTopColor).toBe("#609ff8");
      expect(style.boxShadow).toBe("none");
    }
  });

  it("centers the edge hit targets on the selection outline", () => {
    renderSelectionChrome();

    expect(getComputedStyle(handle("n")).top).toBe("-6.5px");
    expect(getComputedStyle(handle("s")).bottom).toBe("-6.5px");
    expect(getComputedStyle(handle("e")).right).toBe("-6.5px");
    expect(getComputedStyle(handle("w")).left).toBe("-6.5px");
  });
});
