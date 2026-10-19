import { describe, expect, it, vi } from "vitest";

import { relativePositionContainingBlockDirection } from "./relative-position-containing-block";

type TestElement = {
  name: string;
  parentElement: TestElement | null;
};

type DisplayDirection = Pick<CSSStyleDeclaration, "display" | "direction">;

function element(name: string, parentElement: TestElement | null): TestElement {
  return { name, parentElement };
}

function style(display: string, direction: string): DisplayDirection {
  return { display, direction } as DisplayDirection;
}

describe("relativePositionContainingBlockDirection", () => {
  it("skips inline and contents wrappers to the nearest supported box", () => {
    const outer = element("outer", null);
    const containingBlock = element("grid", outer);
    const contents = element("contents", containingBlock);
    const inline = element("inline", contents);
    const target = element("target", inline);
    const getStyle = vi.fn((candidate: TestElement) => {
      if (candidate === inline) return style("inline", "ltr");
      if (candidate === contents) return style("contents", "ltr");
      if (candidate === containingBlock) return style("grid", "rtl");
      return style("block", "ltr");
    });

    expect(relativePositionContainingBlockDirection(target, getStyle)).toBe(
      "rtl",
    );
    expect(getStyle.mock.calls.map(([candidate]) => candidate.name)).toEqual([
      "inline",
      "contents",
      "grid",
    ]);
  });

  it("returns the nearest supported ancestor direction", () => {
    const outer = element("outer", null);
    const near = element("near", outer);
    const target = element("target", near);
    const getStyle = (candidate: TestElement) =>
      candidate === near ? style("flow-root", "ltr") : style("block", "rtl");

    expect(relativePositionContainingBlockDirection(target, getStyle)).toBe(
      "ltr",
    );
  });

  it("recognizes the supported block container displays", () => {
    for (const display of [
      "block",
      "flow-root",
      "list-item",
      "inline-block",
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
      "table-cell",
      "table-caption",
    ]) {
      const parent = element(display, null);
      const target = element("target", parent);

      expect(
        relativePositionContainingBlockDirection(target, () =>
          style(display, "rtl"),
        ),
        display,
      ).toBe("rtl");
    }
  });

  it("refuses unknown display boxes instead of guessing from an outer box", () => {
    const outer = element("outer", null);
    const unknown = element("unknown", outer);
    const target = element("target", unknown);
    const getStyle = (candidate: TestElement) =>
      candidate === unknown
        ? style("inline-table", "rtl")
        : style("block", "ltr");

    expect(relativePositionContainingBlockDirection(target, getStyle)).toBe(
      undefined,
    );
  });

  it("returns undefined when there is no ancestor box", () => {
    const target = element("target", null);

    expect(
      relativePositionContainingBlockDirection(target, () =>
        style("block", "ltr"),
      ),
    ).toBeUndefined();
  });
});
