// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { navBridgeScript } from "../../../../.generated/bridge/nav.generated";

/**
 * Interact mode omits the editor-chrome bridge entirely (see
 * DesignCanvas.tsx) so this always-on nav bridge is the ONLY click-handling
 * script active there. A reported crash — Cmd+Click on a screen-link block in
 * Interact mode threw "Cannot read properties of undefined (reading
 * 'width')" during a host re-render — traced back to this handler treating
 * every click identically regardless of modifier keys, forcing a same-tab
 * screen switch on a Cmd/Ctrl/Shift/middle-click that should have been left
 * to the browser's own new-tab/new-window gesture (or been a no-op).
 */
describe("nav bridge modifier clicks", () => {
  let posted: Record<string, unknown>[] = [];

  // Installed once: the bridge binds to `document`, so re-running it per test
  // would stack listeners and post each payload several times.
  beforeAll(() => {
    vi.stubGlobal("parent", {
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    });
    // The generated module is an IIFE string meant for an iframe's <script>.
    new Function(navBridgeScript)();
  });

  beforeEach(() => {
    posted = [];
    document.body.innerHTML = "";
  });

  function dispatchClick(
    target: Element,
    init: {
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      button?: number;
    } = {},
  ) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: init.button ?? 0,
    });
    Object.defineProperty(event, "metaKey", { value: init.metaKey ?? false });
    Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey ?? false });
    Object.defineProperty(event, "shiftKey", {
      value: init.shiftKey ?? false,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    target.dispatchEvent(event);
    return preventDefault;
  }

  it("switches screens on a plain click of a data-screen element", () => {
    const a = document.createElement("a");
    a.setAttribute("data-screen", "checkout.html");
    document.body.appendChild(a);

    const preventDefault = dispatchClick(a);

    expect(preventDefault).toHaveBeenCalled();
    expect(posted).toEqual([
      {
        type: "prototype-navigate",
        href: "checkout.html",
        screen: "checkout.html",
      },
    ]);
  });

  it.each([
    { label: "Cmd-click", init: { metaKey: true } },
    { label: "Ctrl-click", init: { ctrlKey: true } },
    { label: "Shift-click", init: { shiftKey: true } },
    { label: "middle-click", init: { button: 1 } },
  ])(
    "leaves a $label of a data-screen element alone instead of forcing a screen switch",
    ({ init }) => {
      const a = document.createElement("a");
      a.setAttribute("data-screen", "checkout.html");
      document.body.appendChild(a);

      const preventDefault = dispatchClick(a, init);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(posted).toHaveLength(0);
    },
  );

  it("leaves a Cmd-click of a real internal href alone so the browser can open a new tab", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "checkout.html");
    document.body.appendChild(a);

    const preventDefault = dispatchClick(a, { metaKey: true });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it("still switches screens for a plain click of a real internal href", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "checkout.html");
    document.body.appendChild(a);

    const preventDefault = dispatchClick(a);

    expect(preventDefault).toHaveBeenCalled();
    expect(posted).toEqual([
      {
        type: "prototype-navigate",
        href: "checkout.html",
        screen: "checkout.html",
      },
    ]);
  });

  it("does not touch an external link's target attribute on a Cmd-click (native new-tab already applies)", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "https://example.com");
    document.body.appendChild(a);

    dispatchClick(a, { metaKey: true });

    expect(a.getAttribute("target")).toBeNull();
    expect(posted).toHaveLength(0);
  });
});
