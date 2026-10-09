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
  it("uses white handles with a 2px #1a73e8 stroke and no shadow", () => {
    renderSelectionChrome();

    for (const name of ["nw", "ne", "sw", "se", "n", "e", "s", "w"] as const) {
      const target =
        name.length === 1 ? handle(name).firstElementChild : handle(name);
      if (!(target instanceof HTMLElement))
        throw new Error(`Missing ${name} bar`);
      const style = getComputedStyle(target);
      expect(style.backgroundColor).toBe("#fff");
      expect(style.borderTopColor).toBe("#1a73e8");
      expect(style.borderTopWidth).toBe("2px");
      expect(style.boxShadow).toBe("none");
    }
  });

  it("sizes corner circles 12px and edge pills 22x6.4", () => {
    renderSelectionChrome();

    expect(getComputedStyle(handle("nw")).width).toBe("12px");
    expect(getComputedStyle(handle("nw")).height).toBe("12px");
    const bar = (name: "n" | "e") =>
      getComputedStyle(handle(name).firstElementChild as HTMLElement);
    expect(bar("n").width).toBe("22px");
    expect(bar("n").height).toBe("6.4px");
    expect(bar("e").width).toBe("6.4px");
    expect(bar("e").height).toBe("22px");
  });

  it("centers the corner circles on the selection outline", () => {
    renderSelectionChrome();

    expect(getComputedStyle(handle("nw")).top).toBe("-7px");
    expect(getComputedStyle(handle("se")).right).toBe("-7px");
  });

  it("grabs 4px either side of an edge pill: 22x8, centred on the outline", () => {
    renderSelectionChrome();

    for (const name of ["n", "s"] as const) {
      expect(getComputedStyle(handle(name)).width).toBe("22px");
      expect(getComputedStyle(handle(name)).height).toBe("8px");
    }
    for (const name of ["e", "w"] as const) {
      expect(getComputedStyle(handle(name)).width).toBe("8px");
      expect(getComputedStyle(handle(name)).height).toBe("22px");
    }
    // 8px centred on the border centreline sits 5px outside the padding box.
    expect(getComputedStyle(handle("n")).top).toBe("-5px");
    expect(getComputedStyle(handle("s")).bottom).toBe("-5px");
    expect(getComputedStyle(handle("e")).right).toBe("-5px");
    expect(getComputedStyle(handle("w")).left).toBe("-5px");
  });

  it("grabs only the 8px padding box of a 12px corner circle", () => {
    renderSelectionChrome();

    expect(getComputedStyle(handle("nw")).pointerEvents).toBe("none");
    const css = stylesheet.textContent ?? "";
    const rule = css.match(
      /\[data-slide-resize-handle="se"\]::after\s*\{([^}]*)\}/,
    );
    expect(rule?.[1]).toMatch(/inset:\s*0/);
    expect(rule?.[1]).toMatch(/pointer-events:\s*auto/);
  });

  it("keeps the parent group's chrome out of the pointer path", () => {
    expect(stylesheet.textContent).toMatch(
      /\[data-slide-selection-chrome-parent="true"\] \*::after\s*\{\s*pointer-events:\s*none !important/,
    );
  });
});
