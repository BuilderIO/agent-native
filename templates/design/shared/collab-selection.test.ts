import { describe, expect, it } from "vitest";

import {
  agentSelectionDescriptor,
  escapeAttrValue,
  targetSelector,
} from "./collab-selection.js";

describe("collab-selection", () => {
  describe("escapeAttrValue", () => {
    it("escapes backslashes and double quotes", () => {
      expect(escapeAttrValue('a"b\\c')).toBe('a\\"b\\\\c');
    });

    it("leaves ordinary values untouched", () => {
      expect(escapeAttrValue("hero-cta")).toBe("hero-cta");
    });
  });

  describe("targetSelector", () => {
    it("prefers a node-id anchor over a projection selector", () => {
      expect(
        targetSelector({ nodeId: "hero-cta", selector: "main > button" }),
      ).toBe('[data-agent-native-node-id="hero-cta"]');
    });

    it("escapes quotes in the node id", () => {
      expect(targetSelector({ nodeId: 'a"b' })).toBe(
        '[data-agent-native-node-id="a\\"b"]',
      );
    });

    it("falls back to the projection selector when no node id", () => {
      expect(targetSelector({ selector: "main > button" })).toBe(
        "main > button",
      );
    });

    it("returns null when neither is available", () => {
      expect(targetSelector({})).toBeNull();
      expect(targetSelector({ nodeId: null, selector: null })).toBeNull();
    });
  });

  describe("agentSelectionDescriptor", () => {
    it("builds a { selector, label } descriptor", () => {
      expect(
        agentSelectionDescriptor({ nodeId: "hero-cta" }, "Editing text"),
      ).toEqual({
        selector: '[data-agent-native-node-id="hero-cta"]',
        label: "Editing text",
      });
    });

    it("omits the label when not provided", () => {
      expect(agentSelectionDescriptor({ selector: "main" })).toEqual({
        selector: "main",
      });
    });

    it("returns null when the target cannot be resolved to a selector", () => {
      expect(agentSelectionDescriptor({}, "Editing text")).toBeNull();
    });
  });
});
