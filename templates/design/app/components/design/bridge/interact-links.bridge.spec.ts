// @vitest-environment happy-dom

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { interactLinksBridgeScript } from "../../../../.generated/bridge/interact-links.generated";

describe("Interact links bridge", () => {
  let posted: Record<string, unknown>[] = [];
  let documentListeners: string[] = [];
  let windowListeners: string[] = [];

  beforeAll(() => {
    vi.stubGlobal("parent", {
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    });
    const addDocumentListener = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options) => {
        documentListeners.push(type);
        addDocumentListener(type, listener, options);
      },
    );
    const addWindowListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options) => {
        windowListeners.push(type);
        addWindowListener(type, listener, options);
      },
    );
    new Function(interactLinksBridgeScript)();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    posted = [];
  });

  function anchor(attributes: Record<string, string>, text = "link") {
    const a = document.createElement("a");
    for (const [name, value] of Object.entries(attributes)) {
      a.setAttribute(name, value);
    }
    a.textContent = text;
    document.body.appendChild(a);
    return a;
  }

  function click(
    target: Element,
    init: {
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      button?: number;
    } = {},
  ) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: init.button ?? 0,
      metaKey: init.metaKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      shiftKey: init.shiftKey ?? false,
      altKey: init.altKey ?? false,
    });
    target.dispatchEvent(event);
    return event;
  }

  describe("a link to another screen", () => {
    it.each([
      ["a rooted path", "/pricing", "pricing"],
      ["a file name", "pricing.html", "pricing.html"],
      ["a dotted path", "./checkout.html", "checkout.html"],
      ["a parent path", "../checkout.html", "checkout.html"],
      ["a path with a query and fragment", "/pricing?plan=pro#team", "pricing"],
    ])("switches screens for %s", (_label, href, screen) => {
      const event = click(anchor({ href }));

      expect(event.defaultPrevented).toBe(true);
      expect(posted).toEqual([{ type: "prototype-navigate", href, screen }]);
    });

    it("switches screens for a link marked with data-screen, with or without an href", () => {
      const marked = click(anchor({ "data-screen": "checkout.html" }));
      expect(marked.defaultPrevented).toBe(true);
      const both = click(
        anchor({ href: "https://example.com/", "data-screen": "docs.html" }),
      );
      expect(both.defaultPrevented).toBe(true);
      expect(posted).toEqual([
        {
          type: "prototype-navigate",
          href: "checkout.html",
          screen: "checkout.html",
        },
        { type: "prototype-navigate", href: "docs.html", screen: "docs.html" },
      ]);
    });

    it("follows a click on something inside the link", () => {
      const a = anchor({ href: "/pricing" });
      const inner = document.createElement("span");
      a.appendChild(inner);

      const event = click(inner);

      expect(event.defaultPrevented).toBe(true);
      expect(posted).toHaveLength(1);
    });
  });

  describe("an in-page link", () => {
    let scrollIntoView: ReturnType<typeof vi.fn>;
    let scrollTo: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      scrollIntoView = vi.fn();
      scrollTo = vi.fn();
      Element.prototype.scrollIntoView =
        scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
      window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    });

    function section(attributes: Record<string, string>) {
      const el = document.createElement("section");
      for (const [name, value] of Object.entries(attributes)) {
        el.setAttribute(name, value);
      }
      document.body.appendChild(el);
      return el;
    }

    it("scrolls its target into view instead of leaving the page", () => {
      const target = section({ id: "features" });
      const event = click(anchor({ href: "#features" }));

      expect(event.defaultPrevented).toBe(true);
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(target);
      expect(posted).toEqual([]);
    });

    it("finds a target by escaped id or by name, as a browser does", () => {
      const spaced = section({ id: "our team" });
      click(anchor({ href: "#our%20team" }));
      expect(scrollIntoView.mock.contexts[0]).toBe(spaced);

      const named = document.createElement("a");
      named.setAttribute("name", "legacy");
      document.body.appendChild(named);
      click(anchor({ href: "#legacy" }));
      expect(scrollIntoView.mock.contexts[1]).toBe(named);
    });

    it("goes to the top for a bare # or #top", () => {
      expect(click(anchor({ href: "#" })).defaultPrevented).toBe(true);
      expect(click(anchor({ href: "#top" })).defaultPrevented).toBe(true);
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
    });

    it("does nothing, and does not leave the page, when its target is missing", () => {
      const event = click(anchor({ href: "#nowhere" }));

      expect(event.defaultPrevented).toBe(true);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(posted).toEqual([]);
    });

    it.each([
      ["a modified click", { metaKey: true }],
      ["a middle click", { button: 1 }],
    ])("leaves %s to the browser", (_label, init) => {
      section({ id: "features" });
      const event = click(anchor({ href: "#features" }), init);

      expect(event.defaultPrevented).toBe(false);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("leaves a click the page already handled to the page", () => {
      section({ id: "features" });
      const a = anchor({ href: "#features" });
      a.addEventListener("click", (event) => event.preventDefault());

      click(a);

      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("everything else is left to the page", () => {
    it.each([
      ["an external link", { href: "https://example.com/pricing" }],
      ["a protocol-relative link", { href: "//example.com/pricing" }],
      ["a mailto link", { href: "mailto:hi@example.com" }],
      ["a tel link", { href: "tel:+15551234567" }],
      ["a javascript link", { href: "javascript:void(0)" }],
      ["an empty link", { href: "" }],
      [
        "a link that opens a new window",
        { href: "/pricing", target: "_blank" },
      ],
      ["a download link", { href: "/report.pdf", download: "" }],
      ["an anchor with no destination", {}],
    ])("does not touch %s", (_label, attributes) => {
      const event = click(anchor(attributes));

      expect(event.defaultPrevented).toBe(false);
      expect(posted).toEqual([]);
    });

    it.each([
      ["Cmd", { metaKey: true }],
      ["Ctrl", { ctrlKey: true }],
      ["Shift", { shiftKey: true }],
      ["Alt", { altKey: true }],
      ["a middle button", { button: 1 }],
      ["a right button", { button: 2 }],
    ])("does not touch a link clicked with %s", (_label, init) => {
      const event = click(anchor({ href: "/pricing" }), init);

      expect(event.defaultPrevented).toBe(false);
      expect(posted).toEqual([]);
    });

    it("does not touch a click that is not on a link", () => {
      const button = document.createElement("button");
      document.body.appendChild(button);
      const text = document.createElement("p");
      document.body.appendChild(text);

      expect(click(button).defaultPrevented).toBe(false);
      expect(click(text).defaultPrevented).toBe(false);
      expect(click(document.body).defaultPrevented).toBe(false);
      expect(posted).toEqual([]);
    });

    it("leaves a click the page already handled to the page", () => {
      const a = anchor({ href: "/pricing" });
      a.addEventListener("click", (event) => event.preventDefault());

      click(a);

      expect(posted).toEqual([]);
    });

    it("still follows a link the page only listens to", () => {
      const a = anchor({ href: "/pricing" });
      const pageListener = vi.fn();
      a.addEventListener("click", pageListener);

      const event = click(a);

      expect(pageListener).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
      expect(posted).toHaveLength(1);
    });
  });

  it("listens for clicks and nothing else", () => {
    expect(new Set(documentListeners)).toEqual(new Set(["click"]));
    expect(windowListeners).toEqual([]);
  });

  it("registers exactly one listener and never stops the page's own", () => {
    expect(interactLinksBridgeScript.match(/addEventListener\(/g)).toHaveLength(
      1,
    );
    expect(interactLinksBridgeScript).not.toMatch(
      /stopPropagation|stopImmediatePropagation/,
    );
  });
});
