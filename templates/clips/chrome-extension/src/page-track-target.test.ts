// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import {
  accessibleName,
  cssSelector,
  describeTarget,
  implicitRole,
  maskText,
  viewportInCapture,
} from "./page-track-target";

const privacy = {
  blockSelector: "[data-an-block], .an-block",
  maskTextClass: "an-mask",
  maskTextSelector: "[data-an-mask]",
};

const nodeIds = new Map<Node, number>();
const nodeId = (node: Node) => nodeIds.get(node) ?? -1;

afterEach(() => {
  document.body.innerHTML = "";
  nodeIds.clear();
});

describe("clicked page targets", () => {
  it("names the button around the pressed icon", () => {
    document.body.innerHTML =
      '<main><button data-testid="send"><svg><path></path></svg><span>Send prompt</span></button></main>';
    const button = document.querySelector("button");
    const path = document.querySelector("path");
    if (!button || !path) throw new Error("fixture missing");
    nodeIds.set(button, 42);

    const target = describeTarget(path, nodeId, privacy);

    expect(target).toMatchObject({
      id: 42,
      role: "button",
      name: "Send prompt",
      selector: 'button[data-testid="send"]',
      blocked: false,
    });
  });

  it("masks the name of a masked element and leaves out a blocked one", () => {
    document.body.innerHTML =
      '<div class="an-mask"><a href="/acct">Jane Doe</a></div><input data-an-block aria-label="Password">';
    const link = document.querySelector("a");
    const field = document.querySelector("input");
    if (!link || !field) throw new Error("fixture missing");

    expect(describeTarget(link, nodeId, privacy)).toMatchObject({
      role: "link",
      name: "**** ***",
      blocked: false,
    });
    expect(describeTarget(field, nodeId, privacy)).toMatchObject({
      role: "textbox",
      name: null,
      blocked: true,
    });
  });

  it("names a field by its label, never its value", () => {
    document.body.innerHTML =
      '<label for="q">Search notes</label><input id="q" type="search" value="secret plans">';
    const field = document.querySelector("input");
    if (!field) throw new Error("fixture missing");

    expect(accessibleName(field, privacy)).toBe("Search notes");
    expect(implicitRole(field)).toBe("textbox");
  });

  it("leaves out or masks a target inside a blocked or masked shadow host", () => {
    const blockedHost = document.createElement("div");
    blockedHost.setAttribute("data-an-block", "");
    blockedHost.attachShadow({ mode: "open" }).innerHTML =
      "<button>Private customer</button>";
    const maskedHost = document.createElement("div");
    maskedHost.className = "an-mask";
    maskedHost.attachShadow({ mode: "open" }).innerHTML =
      "<button>Jane Doe</button>";
    document.body.append(blockedHost, maskedHost);
    const blockedButton = blockedHost.shadowRoot?.querySelector("button");
    const maskedButton = maskedHost.shadowRoot?.querySelector("button");
    if (!blockedButton || !maskedButton) throw new Error("no shadow buttons");

    expect(describeTarget(blockedButton, nodeId, privacy)).toMatchObject({
      name: null,
      blocked: true,
    });
    expect(describeTarget(maskedButton, nodeId, privacy)).toMatchObject({
      name: "**** ***",
      blocked: false,
    });
  });

  it("leaves blocked and masked text inside a target out of its name", () => {
    document.body.innerHTML = [
      '<button id="open"><span data-an-block>Secret customer</span> <span>Open</span> <span class="an-mask">Jane</span></button>',
      '<span id="hidden-label" data-an-block>Hidden label</span>',
      '<button id="labelled" aria-labelledby="hidden-label">Go</button>',
      '<label for="holder" class="an-mask">Card holder</label><input id="holder">',
    ].join("");
    const open = document.getElementById("open");
    const labelled = document.getElementById("labelled");
    const holder = document.getElementById("holder");
    if (!open || !labelled || !holder) throw new Error("fixture missing");

    expect(describeTarget(open, nodeId, privacy).name).toBe("Open ****");
    expect(describeTarget(labelled, nodeId, privacy).name).toBe("Go");
    expect(accessibleName(holder, privacy)).toBe("**** ******");
  });

  it("builds a short selector from the nearest id", () => {
    document.body.innerHTML =
      '<section id="toolbar"><ul><li>One</li><li><span>Two</span></li></ul></section>';
    const span = document.querySelector("li:nth-of-type(2) span");
    if (!span) throw new Error("fixture missing");

    expect(cssSelector(span)).toBe(
      "section#toolbar > ul > li:nth-of-type(2) > span",
    );
  });

  it("masks every visible character", () => {
    expect(maskText("Card 4242")).toBe("**** ****");
  });
});

describe("page viewport in the recording", () => {
  const geometry = {
    innerWidth: 1200,
    innerHeight: 700,
    outerWidth: 1200,
    outerHeight: 800,
    screenX: 100,
    screenY: 50,
    screenLeft: 0,
    screenTop: 0,
    screenWidth: 1600,
    screenHeight: 1000,
    devicePixelRatio: 2,
  };

  it("fills the frame exactly when the tab is captured", () => {
    expect(viewportInCapture("tab", 2400, 1400, geometry)).toEqual({
      x: 0,
      y: 0,
      width: 2400,
      height: 1400,
      dpr: 2,
      basis: "exact",
    });
  });

  it("estimates the viewport under the window's toolbar", () => {
    expect(viewportInCapture("window", 2400, 1600, geometry)).toEqual({
      x: 0,
      y: 200,
      width: 2400,
      height: 1400,
      dpr: 2,
      basis: "estimated",
    });
  });

  it("estimates the viewport on a captured screen, scaled to the frame", () => {
    expect(viewportInCapture("display", 1600, 1000, geometry)).toEqual({
      x: 100,
      y: 150,
      width: 1200,
      height: 700,
      dpr: 2,
      basis: "estimated",
    });
  });
});
