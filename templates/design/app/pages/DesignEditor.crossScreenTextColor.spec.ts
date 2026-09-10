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
    // Color signal present (even if transparent-ish) takes precedence over
    // a class hint at the SAME position — but transparent entries fall
    // through to the NEXT entry, which is a class hint here.
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
    // Marker present, but the color is a deliberately-chosen non-white —
    // must NOT be treated as "always safe to adapt" just because the marker
    // is there. Falls through to the default-white check, which fails
    // (color isn't white), so no adaptation.
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

  // Finding 1 (the DOMParser defaultView bug): this is the real "Daylist"
  // shape — an INLINE dark background (the only signal a detached
  // DOMParser document can honestly read without getComputedStyle). Before
  // the fix, destinationBackgroundIsLightForNode always fell into its
  // `if (!view) return true` branch in real Chrome (defaultView is null for
  // DOMParser docs there), so this case was WRONGLY treated as light and
  // the white text got incorrectly rewritten to `inherit` — invisible
  // dark-on-dark once `inherit` picked up the (also-dark) surrounding text
  // color, or at best undefined behavior. The fixed pure ancestor-chain walk
  // must resolve this as dark and leave the text alone.
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

  // Same real-world shape, but the dark background comes from a Tailwind
  // utility class instead of an inline style (also part of "which signals
  // it actually has" for the Daylist case) — the cheap dark-class-name
  // heuristic must catch this too.
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

  // A <style> BLOCK rule (as opposed to inline style or a recognized
  // utility class) is NOT a signal the no-live-doc fallback path can read
  // (that would require getComputedStyle against a real cascade, which is
  // exactly what real Chrome's null defaultView makes impossible for a
  // DOMParser document). With no live destination doc supplied and no
  // inline/class signal, this must fall through to the conservative
  // "light" default — proving the fix doesn't quietly reintroduce a
  // getComputedStyle-shaped dependency on the no-live-doc path.
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
    // No live doc, no inline/class signal → conservative "light" default →
    // default-white heuristic fires → rewritten to inherit.
    expect(el.style.color).toBe("inherit");
  });

  // Finding 1's "prefer the live destination iframe" path: when a live
  // document IS supplied (MultiScreenCanvas mounts the destination screen
  // as a same-origin iframe reachable via data-screen-iframe-id), a
  // stylesheet-cascaded dark background (the case the no-live-doc fallback
  // above cannot see) resolves correctly via real getComputedStyle. A
  // DOMParser-parsed document (even via document.implementation) has a null
  // defaultView in a real browser, so this test simulates a truly "live,
  // mounted, has a working cascade" document using happy-dom's own global
  // `document` (which DOES have a real defaultView/getComputedStyle) —
  // temporarily attaching the destination content to it, the same way a
  // real same-origin iframe's contentDocument would be a live, cascaded
  // document. Cleans up afterward so it can't leak into other tests.
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
      // Live doc resolved the <style>-block dark background correctly →
      // text stays white (untouched), matching the no-live-doc inline/class
      // test above rather than the <style>-block-without-live-doc fallback
      // test (which conservatively assumes light and rewrites to inherit).
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

  // Finding 2(a): a stale marker must be stripped from the output even when
  // no adaptation happens (the color already diverged from white, so the
  // marker no longer describes reality).
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
    // The explicit color itself must be untouched — only the stale marker
    // attribute is stripped.
    expect(el.style.color).toBe("rgb(20, 20, 20)");
  });
});
