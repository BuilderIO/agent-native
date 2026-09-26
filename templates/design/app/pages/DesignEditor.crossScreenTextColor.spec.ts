// @vitest-environment happy-dom

/**
 * DesignEditor.crossScreenTextColor.spec.ts
 *
 * Regression coverage for finding 8 (cross-screen text color adaptation) AND
 * its review follow-up (finding 1, the DOMParser defaultView bug):
 *
 * - handleCrossScreenElementDrop used to never adapt board/screen text's
 *   auto-applied white color when it landed in a light destination, so
 *   white-on-white text became invisible on a cross-screen drop even though
 *   the in-screen drag path (editor-chrome.bridge.ts's
 *   adaptAutoTextColorForNest) already handled the same problem for
 *   same-document re-parents.
 * - The original fix's `destinationBackgroundIsLightForNode` called
 *   `ownerDocument.defaultView.getComputedStyle(...)` on a DOMParser-parsed
 *   DETACHED document. In real Chrome, `defaultView` is ALWAYS null for a
 *   DOMParser document — so that code path always hit the `if (!view)
 *   return true` fallback and a pre-marker white text dropped onto a DARK
 *   destination got wrongly rewritten to `color:inherit`. happy-dom gives
 *   DOMParser documents a non-null `defaultView` that resolves `<style>`
 *   block rules via getComputedStyle, which is NOT how real Chrome behaves
 *   — the previous version of this spec file relied on exactly that
 *   unrealistic behavior (background set via a `<style>` block, not inline)
 *   and therefore could not have caught the bug it was meant to guard.
 *
 * This file now tests:
 * - `resolveDestinationBackgroundLightness` — the pure decision helper,
 *   exercised with explicit input chains only (no DOM, no environment
 *   quirks to be honest or dishonest about).
 * - `shouldAdaptAutoTextColorForCrossScreenMove` / `isStaleAutoTextColorMarker`
 *   — pure decision tables, same as before.
 * - `adaptAutoTextColorForCrossScreenNode` — the HTML-string-level function,
 *   now using only signals a DOMParser-detached document can ACTUALLY read
 *   without getComputedStyle: inline `background`/`background-color`
 *   declarations and utility-class name hints (the "Daylist" real-world
 *   case: dark backgrounds expressed via inline style or a `bg-*-900`-shape
 *   class, not a `<style>` block rule a detached doc can't resolve). A
 *   `<style>` block case is included explicitly to confirm it does NOT
 *   resolve via the no-live-doc fallback (proving the fix doesn't
 *   accidentally reintroduce a getComputedStyle-shaped dependency), and a
 *   live-document case confirms the PREFERRED path (a real mounted
 *   destination iframe) correctly resolves stylesheet/class-cascaded
 *   backgrounds when available.
 */

import { describe, expect, it } from "vitest";

import {
  adaptAutoTextColorForCrossScreenNode,
  BOARD_TEXT_AUTO_COLOR_MARKER,
  isStaleAutoTextColorMarker,
  resolveDestinationBackgroundLightness,
  shouldAdaptAutoTextColorForCrossScreenMove,
} from "./design-editor/cross-screen-text-color";

describe("resolveDestinationBackgroundLightness (pure, finding 1)", () => {
  it("is light with no signal anywhere in the chain (conservative default)", () => {
    expect(resolveDestinationBackgroundLightness([])).toBe(true);
    expect(
      resolveDestinationBackgroundLightness([{ darkClassHint: false }]),
    ).toBe(true);
  });

  it("resolves a light inline color as light", () => {
    expect(resolveDestinationBackgroundLightness([{ color: "#ffffff" }])).toBe(
      true,
    );
    expect(
      resolveDestinationBackgroundLightness([{ color: "rgb(245, 245, 245)" }]),
    ).toBe(true);
  });

  it("resolves a dark inline color as dark", () => {
    expect(resolveDestinationBackgroundLightness([{ color: "#0a0a0a" }])).toBe(
      false,
    );
    expect(
      resolveDestinationBackgroundLightness([{ color: "rgb(10, 10, 10)" }]),
    ).toBe(false);
  });

  it("treats alpha below 0.4 as transparent and keeps walking up the chain", () => {
    const result = resolveDestinationBackgroundLightness([
      { color: "rgba(10, 10, 10, 0.1)" }, // near-invisible dark tint — skip
      { color: "#0a0a0a" }, // real dark background further up — wins
    ]);
    expect(result).toBe(false);
  });

  it("treats alpha at/above 0.4 as opaque enough to trust", () => {
    const result = resolveDestinationBackgroundLightness([
      { color: "rgba(10, 10, 10, 0.4)" },
    ]);
    expect(result).toBe(false);
  });

  it("a dark-class hint only counts when no color signal is present on that element", () => {
    const result = resolveDestinationBackgroundLightness([
      { color: null },
      { darkClassHint: true },
    ]);
    expect(result).toBe(false);
  });

  it("stops at the first resolved (non-transparent) entry, ignoring further entries", () => {
    const result = resolveDestinationBackgroundLightness([
      { color: "#ffffff" }, // light — wins immediately
      { color: "#0a0a0a" }, // would be dark, but never reached
    ]);
    expect(result).toBe(true);
  });
});

describe("isStaleAutoTextColorMarker (finding 2a)", () => {
  it("is NOT stale when the marker is present and the color is still auto-default white", () => {
    expect(
      isStaleAutoTextColorMarker({
        inlineColor: "rgb(255, 255, 255)",
        hasAutoMarker: true,
      }),
    ).toBe(false);
    expect(
      isStaleAutoTextColorMarker({ inlineColor: "#fff", hasAutoMarker: true }),
    ).toBe(false);
  });

  it("IS stale when the marker is present but the color has since diverged from white", () => {
    expect(
      isStaleAutoTextColorMarker({
        inlineColor: "#1a2b3c",
        hasAutoMarker: true,
      }),
    ).toBe(true);
  });

  it("is never stale when there's no marker to begin with", () => {
    expect(
      isStaleAutoTextColorMarker({
        inlineColor: "#1a2b3c",
        hasAutoMarker: false,
      }),
    ).toBe(false);
  });
});

describe("shouldAdaptAutoTextColorForCrossScreenMove (pure decision)", () => {
  it("adapts whenever the auto marker is present AND the color is still default white, regardless of destination background", () => {
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

  it("finding 2: a STALE marker (color diverged from white) falls through to the conservative heuristic instead of always adapting", () => {
    expect(
      shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: "#1a2b3c",
        hasAutoMarker: true,
        destinationBackgroundIsLight: false,
      }),
    ).toBe(false);
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

describe("adaptAutoTextColorForCrossScreenNode (HTML-string level, no live doc)", () => {
  it("rewrites marker-carrying board text's forced white to inherit against an INLINE light background", () => {
    const html = `<!DOCTYPE html>
<html><head></head>
<body style="background-color: #ffffff;">
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

  it("rewrites pre-marker default-white text to inherit when the destination has an INLINE light background", () => {
    const html = `<!DOCTYPE html>
<html><head></head>
<body style="background-color: #ffffff;">
  <div data-agent-native-node-id="txt_2" data-an-primitive="text" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_2");
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_2"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("inherit");
  });

  it("leaves default-white text untouched when the destination has an INLINE dark background", () => {
    const html = `<!DOCTYPE html>
<html><head></head>
<body style="background-color: rgb(10, 10, 10);">
  <div data-agent-native-node-id="txt_3" data-an-primitive="text" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_3");
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_3"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("rgb(255, 255, 255)");
  });

  it("leaves default-white text untouched when the destination has a dark utility CLASS background (e.g. bg-neutral-950)", () => {
    const html = `<!DOCTYPE html>
<html><head></head>
<body class="bg-neutral-950">
  <div data-agent-native-node-id="txt_3b" data-an-primitive="text" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_3b");
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_3b"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("rgb(255, 255, 255)");
  });

  it("without a live doc, a <style> BLOCK rule background is not resolved — falls through to the conservative light default", () => {
    const html = `<!DOCTYPE html>
<html><head><style>body{background-color:rgb(10, 10, 10)}</style></head>
<body>
  <div data-agent-native-node-id="txt_3c" data-an-primitive="text" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_3c");
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_3c"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("inherit");
  });

  it("prefers a supplied LIVE document's computed style, correctly resolving a <style>-block dark background", () => {
    const style = document.createElement("style");
    style.textContent = "body{background-color:rgb(10, 10, 10)}";
    const target = document.createElement("div");
    target.setAttribute("data-agent-native-node-id", "txt_4");
    target.style.color = "rgb(255, 255, 255)";
    document.head.appendChild(style);
    document.body.appendChild(target);

    try {
      const html = `<!DOCTYPE html>
<html><head></head>
<body>
  <div data-agent-native-node-id="txt_4" data-an-primitive="text" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
      const result = adaptAutoTextColorForCrossScreenNode(
        html,
        "txt_4",
        document,
      );
      const doc = new DOMParser().parseFromString(result, "text/html");
      const el = doc.querySelector(
        '[data-agent-native-node-id="txt_4"]',
      ) as HTMLElement;
      expect(el.style.color).toBe("rgb(255, 255, 255)");
    } finally {
      document.head.removeChild(style);
      document.body.removeChild(target);
    }
  });

  it("never touches an explicit non-white user color", () => {
    const html = `<!DOCTYPE html>
<html><head></head>
<body style="background-color: #ffffff;">
  <div data-agent-native-node-id="txt_5" data-an-primitive="text" style="color: rgb(20, 20, 20);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_5");
    expect(result).toBe(html);
  });

  it("is a no-op for non-text primitives even if they carry a white color", () => {
    const html = `<!DOCTYPE html>
<html><head></head>
<body style="background-color: #ffffff;">
  <div data-agent-native-node-id="rect_1" data-an-primitive="rectangle" style="color: rgb(255, 255, 255);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "rect_1");
    expect(result).toBe(html);
  });

  it("returns content unchanged when the node id can't be found", () => {
    const html = `<!DOCTYPE html><html><body><div data-agent-native-node-id="other">Hi</div></body></html>`;
    expect(adaptAutoTextColorForCrossScreenNode(html, "missing")).toBe(html);
  });

  it("strips a stale marker from the output even though no color adaptation happens", () => {
    const html = `<!DOCTYPE html>
<html><head></head>
<body style="background-color: #ffffff;">
  <div data-agent-native-node-id="txt_6" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color: rgb(20, 20, 20);">Hello</div>
</body></html>`;
    const result = adaptAutoTextColorForCrossScreenNode(html, "txt_6");
    expect(result).not.toContain(BOARD_TEXT_AUTO_COLOR_MARKER);
    const doc = new DOMParser().parseFromString(result, "text/html");
    const el = doc.querySelector(
      '[data-agent-native-node-id="txt_6"]',
    ) as HTMLElement;
    expect(el.style.color).toBe("rgb(20, 20, 20)");
  });
});
