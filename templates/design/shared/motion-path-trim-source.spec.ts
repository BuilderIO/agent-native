import { describe, expect, it } from "vitest";

import {
  applyMotionPathTrimSource,
  MotionPathTrimSourceError,
  restoreMotionPathTrimSource,
} from "./motion-path-trim-source";

describe("Motion Path source adapter", () => {
  it("normalizes and restores an inline SVG pathLength without changing the source", () => {
    const source =
      '<svg><path data-agent-native-node-id="trim-target" d="M0 0L10 10" /></svg>';
    const applied = applyMotionPathTrimSource(source, ["trim-target"], "html");

    expect(applied).toContain('pathLength="100"');
    expect(applied).toContain(
      'data-agent-native-motion-path-length="v1:html:absent"',
    );
    expect(applyMotionPathTrimSource(applied, ["trim-target"], "html")).toBe(
      applied,
    );
    expect(restoreMotionPathTrimSource(applied, "html")).toBe(source);
    expect(applyMotionPathTrimSource(applied, [], "html")).toBe(source);
  });

  it("restores the authored inline SVG pathLength value exactly", () => {
    const source =
      "<svg><path data-agent-native-node-id='trim-target' d='M0 0L10 10' pathLength = '24' /></svg>";
    const applied = applyMotionPathTrimSource(source, ["trim-target"], "html");

    expect(applied).toContain('pathLength="100"');
    expect(restoreMotionPathTrimSource(applied, "html")).toBe(source);
  });

  it("normalizes and restores TSX pathLength attributes", () => {
    const source = `export function Shape() {
  return <svg><path data-agent-native-node-id="trim-target" d="M0 0L10 10" pathLength={24} /></svg>;
}`;
    const applied = applyMotionPathTrimSource(source, ["trim-target"], "tsx");

    expect(applied).toContain("pathLength={100}");
    expect(applied).toContain(
      'data-agent-native-motion-path-length="v1:tsx:attribute:pathLength%3D%7B24%7D"',
    );
    expect(applyMotionPathTrimSource(applied, ["trim-target"], "tsx")).toBe(
      applied,
    );
    expect(restoreMotionPathTrimSource(applied, "tsx")).toBe(source);
    expect(applyMotionPathTrimSource(applied, [], "tsx")).toBe(source);
  });

  it("restores missing TSX pathLength and rejects edited managed values", () => {
    const source =
      'export const Shape = () => <svg><path data-agent-native-node-id="trim-target" d="M0 0L10 10" /></svg>;';
    const applied = applyMotionPathTrimSource(source, ["trim-target"], "tsx");
    const edited = applied.replace("pathLength={100}", "pathLength={50}");

    expect(restoreMotionPathTrimSource(applied, "tsx")).toBe(source);
    expect(() => restoreMotionPathTrimSource(edited, "tsx")).toThrow(
      MotionPathTrimSourceError,
    );
  });

  it("requires active targets to be unambiguous SVG paths", () => {
    expect(() =>
      applyMotionPathTrimSource(
        '<div data-agent-native-node-id="trim-target"></div>',
        ["trim-target"],
        "html",
      ),
    ).toThrow(/must be an SVG path element/);

    expect(() =>
      applyMotionPathTrimSource(
        '<svg><path data-agent-native-node-id="trim-target"/><path data-agent-native-node-id="trim-target"/></svg>',
        ["trim-target"],
        "html",
      ),
    ).toThrow(/ambiguous/);
  });

  it("rejects a TSX path whose spread attributes could override pathLength", () => {
    const source =
      'export const Shape = (props: object) => <svg><path {...props} data-agent-native-node-id="trim-target" /></svg>;';

    expect(() =>
      applyMotionPathTrimSource(source, ["trim-target"], "tsx"),
    ).toThrow(/spread attributes/);
  });
});
