// @vitest-environment happy-dom

/**
 * DesignEditor.crossScreenTextColor.spec.ts
 *
 * Regression coverage for finding 8 (cross-screen text color adaptation):
 * handleCrossScreenElementDrop used to never adapt board/screen text's
 * auto-applied white color when it landed in a light destination, so
 * white-on-white text became invisible on a cross-screen drop even though
 * the in-screen drag path (editor-chrome.bridge.ts's
 * adaptAutoTextColorForNest) already handled the same problem for
 * same-document re-parents.
 *
 * - shouldAdaptAutoTextColorForCrossScreenMove is the pure decision table,
 *   mirroring the in-screen bridge's adaptAutoTextColorForNest logic exactly
 *   (marker present → always adapt; no marker → only the conservative
 *   default-white + light-destination heuristic).
 * - adaptAutoTextColorForCrossScreenNode is the HTML-string-level function
 *   handleCrossScreenElementDrop calls post-move; it needs a DOM (DOMParser +
 *   getComputedStyle) hence the happy-dom environment directive, matching
 *   DesignEditor.batch3.spec.ts's precedent for DOM-dependent pure helpers
 *   in this file (vitest.config.ts has no default DOM environment).
 */

import { describe, expect, it } from "vitest";

import {
  adaptAutoTextColorForCrossScreenNode,
  BOARD_TEXT_AUTO_COLOR_MARKER,
  shouldAdaptAutoTextColorForCrossScreenMove,
} from "./DesignEditor";

describe("shouldAdaptAutoTextColorForCrossScreenMove (pure decision)", () => {
  it("adapts whenever the auto marker is present, regardless of destination background", () => {
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "#ffffff",
        hasAutoMarker: true,
        destinationBackgroundIsLight: false,
      }),
    ).toBe(true);
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "rgb(255, 255, 255)",
        hasAutoMarker: true,
        destinationBackgroundIsLight: false,
      }),
    ).toBe(true);
  });

  it("adapts pre-marker default-white text only when the destination is light", () => {
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "#ffffff",
        hasAutoMarker: false,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(true);
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "#fff",
        hasAutoMarker: false,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(true);
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "white",
        hasAutoMarker: false,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(true);
  });

  it("does NOT adapt default-white text dropped onto a dark destination (still visible)", () => {
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "#ffffff",
        hasAutoMarker: false,
        destinationBackgroundIsLight: false,
      }),
    ).toBe(false);
  });

  it("never touches an explicit, non-white user color even on a light destination", () => {
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "#111111",
        hasAutoMarker: false,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(false);
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "rgb(17, 24, 39)",
        hasAutoMarker: false,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(false);
  });

  it("is a no-op for empty/inherit/currentColor colors", () => {
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "",
        hasAutoMarker: true,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(false);
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "inherit",
        hasAutoMarker: true,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(false);
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "currentColor",
        hasAutoMarker: true,
        destinationBackgroundIsLight: true,
      }),
    ).toBe(false);
  });
});

describe("adaptAutoTextColorForCrossScreenNode (HTML-string level)", () => {
  it("rewrites marker-carrying board text's forced white to inherit in a light destination", () => {
    const html = `<!DOCTYPE html>
<html><head><style>body{background:#ffffff}</style></head>
<body>
  <div data-agent-native-node-id="txt_1" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_1");
    expect(result).toContain('data-agent-native-node-id="txt_1"');
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_1"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("inherit");
  });

  it("rewrites pre-marker default-white text to inherit when the destination background is light", () => {
    const html = `<!DOCTYPE html>
<html><head><style>body{background-color:#ffffff}</style></head>
<body>
  <div data-agent-native-node-id="txt_2" data-an-primitive="text" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_2");
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_2"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("inherit");
  });

  it("leaves default-white text untouched when the destination background is dark", () => {
    const html = `<!DOCTYPE html>
<html><head><style>body{background-color:rgb(10, 10, 10)}</style></head>
<body>
  <div data-agent-native-node-id="txt_3" data-an-primitive="text" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_3");
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_3"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("rgb(255, 255, 255)");
  });

  it("never touches an explicit non-white user color", () => {
    const html = `<!DOCTYPE html>
<html><head><style>body{background-color:#ffffff}</style></head>
<body>
  <div data-agent-native-node-id="txt_4" data-an-primitive="text" style="color: rgb(20, 20, 20);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_4");
    expect(result).toBe(html);
  });

  it("is a no-op for non-text primitives even if they carry a white color", () => {
    const html = `<!DOCTYPE html>
<html><head><style>body{background-color:#ffffff}</style></head>
<body>
  <div data-agent-native-node-id="rect_1" data-an-primitive="rectangle" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "rect_1");
    expect(result).toBe(html);
  });

  it("returns content unchanged when the node id can't be found", () => {
    const html = `<!DOCTYPE html><html><body><div data-agent-native-node-id="other">Hi</div></body></html>`;
    expect(adaptAutoTextColorForCrossScreenNode(html, "missing")).toBe(html);
  });
});
