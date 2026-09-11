import { describe, expect, it } from "vitest";

import { removeEmptyGeneratedGroupWrappers } from "./code-layer-state";

const wrap = (inner: string) =>
  `<!doctype html><html><body><main data-agent-native-node-id="root">${inner}</main></body></html>`;

describe("removeEmptyGeneratedGroupWrappers", () => {
  it("removes a generated wrapper the edit emptied", () => {
    const content = wrap(
      '<div data-agent-native-node-id="g1" data-agent-native-layer-name="Group"></div><p data-agent-native-node-id="keep">keep</p>',
    );
    const next = removeEmptyGeneratedGroupWrappers(content, new Set(["g1"]));
    expect(next).not.toContain('data-agent-native-node-id="g1"');
    expect(next).toContain('data-agent-native-node-id="keep"');
  });

  it("removes a chain of nested generated wrappers", () => {
    const content = wrap(
      '<div data-agent-native-node-id="g1" data-agent-native-layer-name="Group"><div data-agent-native-node-id="g2" data-agent-native-layer-name="Group 2"></div></div>',
    );
    const next = removeEmptyGeneratedGroupWrappers(
      content,
      new Set(["g1", "g2"]),
    );
    expect(next).not.toContain('data-agent-native-node-id="g2"');
    expect(next).not.toContain('data-agent-native-node-id="g1"');
  });

  it("leaves a user-named empty container alone", () => {
    const content = wrap(
      '<div data-agent-native-node-id="c1" data-agent-native-layer-name="Sidebar"></div>',
    );
    expect(removeEmptyGeneratedGroupWrappers(content, new Set(["c1"]))).toBe(
      content,
    );
  });

  it("leaves a generated wrapper that still has children alone", () => {
    const content = wrap(
      '<div data-agent-native-node-id="g1" data-agent-native-layer-name="Group"><p data-agent-native-node-id="child">x</p></div>',
    );
    expect(removeEmptyGeneratedGroupWrappers(content, new Set(["g1"]))).toBe(
      content,
    );
  });

  it("returns documents with no layer names untouched", () => {
    const content = wrap('<div data-agent-native-node-id="plain"></div>');
    expect(removeEmptyGeneratedGroupWrappers(content, new Set(["plain"]))).toBe(
      content,
    );
  });
});
