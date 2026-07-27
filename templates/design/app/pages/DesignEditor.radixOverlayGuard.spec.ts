// @vitest-environment happy-dom

/**
 * DesignEditor.radixOverlayGuard.spec.ts
 *
 * Regression coverage for finding 7: `isRadixOverlayOpen` is the single
 * shared predicate behind both of the editor's Radix-overlay pointer-event
 * shields (`inspectorPopoverOpen` and `updateIframePointerEvents`), which
 * used to hand-duplicate slightly different logic. The
 * `updateIframePointerEvents` copy never checked a wrapper's own
 * `data-state` when it had no stateful descendant, so it always treated
 * that shape as "open" — this could leave the single-screen preview
 * iframe's pointer-events stuck at `none` after closing the zoom menu via
 * item-select (menu close via the reused-wrapper path leaves
 * `data-state="closed"` on the wrapper itself with no stateful child left
 * inside).
 */

import { describe, expect, it } from "vitest";

import { isRadixOverlayOpen } from "./design-editor/dom-guards";

function wrapperEl(html: string): Element {
  const container = document.createElement("div");
  container.innerHTML = html;
  const el = container.firstElementChild;
  if (!el) throw new Error("test fixture produced no element");
  return el;
}

describe("isRadixOverlayOpen", () => {
  it("is open when a stateful (non-tooltip) child is open", () => {
    const wrapper = wrapperEl(
      `<div data-radix-popper-content-wrapper><div data-state="open">Menu</div></div>`,
    );
    expect(isRadixOverlayOpen(wrapper)).toBe(true);
  });

  it("is NOT open when the only stateful child is closed", () => {
    const wrapper = wrapperEl(
      `<div data-radix-popper-content-wrapper><div data-state="closed">Menu</div></div>`,
    );
    expect(isRadixOverlayOpen(wrapper)).toBe(false);
  });

  it("is NOT open when there is no stateful child but the wrapper itself carries data-state=closed", () => {
    // This is the exact reported repro shape: closing the zoom menu via
    // item-select closes through the reused-wrapper path, leaving
    // data-state="closed" on the wrapper with no stateful child left
    // inside. The buggy updateIframePointerEvents copy treated this as
    // open; the corrected shared predicate must not.
    const wrapper = wrapperEl(
      `<div data-radix-popper-content-wrapper data-state="closed"></div>`,
    );
    expect(isRadixOverlayOpen(wrapper)).toBe(false);
  });

  it("is open (conservative default) when there is no stateful child and no data-state at all", () => {
    const wrapper = wrapperEl(`<div data-radix-popper-content-wrapper></div>`);
    expect(isRadixOverlayOpen(wrapper)).toBe(true);
  });

  it("is open when the wrapper itself carries data-state=open with no stateful child", () => {
    const wrapper = wrapperEl(
      `<div data-radix-popper-content-wrapper data-state="open"></div>`,
    );
    expect(isRadixOverlayOpen(wrapper)).toBe(true);
  });

  it("is NOT open when the wrapper is a first-party tooltip", () => {
    const wrapper = wrapperEl(
      `<div data-radix-popper-content-wrapper data-agent-native-tooltip data-state="open"></div>`,
    );
    expect(isRadixOverlayOpen(wrapper)).toBe(false);
  });

  it("is NOT open when the only stateful descendants are all first-party tooltips", () => {
    const wrapper = wrapperEl(
      `<div data-radix-popper-content-wrapper><div data-agent-native-tooltip data-state="open">Tip</div></div>`,
    );
    expect(isRadixOverlayOpen(wrapper)).toBe(false);
  });

  it("is open when a real menu is open alongside an open tooltip in the same wrapper", () => {
    const wrapper = wrapperEl(
      `<div data-radix-popper-content-wrapper>` +
        `<div data-agent-native-tooltip data-state="open">Tip</div>` +
        `<div data-state="open">Menu</div>` +
        `</div>`,
    );
    expect(isRadixOverlayOpen(wrapper)).toBe(true);
  });
});
