// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  designElementSelectable,
  designScreenElement,
  designScreenSelectable,
  findDesignLayer,
} from "./design-agent-select";

const screens = [{ id: "file-1", filename: "home.html" }];

function renderScreen() {
  document.body.innerHTML = `
    <div data-frame-shell data-frame-id="file-1">
      <iframe data-screen-iframe-id="file-1"></iframe>
    </div>`;
  const frame = document.querySelector("iframe")!;
  const frameDocument = frame.contentDocument!;
  // happy-dom does not link a frame's window back to its host element.
  Object.defineProperty(frameDocument.defaultView!, "frameElement", {
    configurable: true,
    value: frame,
  });
  frameDocument.body.innerHTML = `
    <section data-agent-native-node-id="hero" data-agent-native-layer-name="Hero">
      <h1>Ship <em>faster</em></h1>
    </section>
    <p>Loose copy</p>`;
  return frameDocument;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Design Select adapter", () => {
  it("offers a screen through its canvas frame", () => {
    renderScreen();
    const screen = designScreenSelectable("design-1", "Launch", screens[0]);
    expect(screen.title).toBe("home");
    expect(screen.getElement()).toBe(designScreenElement("file-1"));
    expect(screen.getContext()).toBe(
      [
        'Selected screen in design "Launch".',
        "designId: design-1",
        "fileId: file-1",
        "Screen: home.html",
      ].join("\n"),
    );
  });

  it("resolves a target inside a screen to its layer", () => {
    const frameDocument = renderScreen();
    const em = frameDocument.querySelector("em")!;
    const selectable = designElementSelectable(
      "design-1",
      "Launch",
      screens,
      em,
    );

    expect(selectable).toMatchObject({
      kind: "element",
      id: "file-1/hero",
      parent: { kind: "screen", id: "file-1" },
      title: "Ship faster",
    });
    expect(selectable?.getElement()).toBe(
      frameDocument.querySelector("section"),
    );
    const context = selectable?.getContext() ?? "";
    expect(context).toContain("targetNodeId: hero");
    expect(context).toContain("fileId: file-1");
    expect(context).toContain("Layer: Hero");
  });

  it("finds the layer again after the screen re-renders", () => {
    const frameDocument = renderScreen();
    const selectable = designElementSelectable(
      "design-1",
      "Launch",
      screens,
      frameDocument.querySelector("em")!,
    );
    frameDocument.body.innerHTML = frameDocument.body.innerHTML;
    expect(selectable?.getElement()).toBe(
      frameDocument.querySelector("section"),
    );

    frameDocument.querySelector("section")!.remove();
    expect(selectable?.getElement()).toBeNull();
  });

  it("finds a layer again in a remounted breakpoint frame", () => {
    document.body.innerHTML = `
      <div data-frame-shell data-frame-id="file-1">
        <iframe data-screen-iframe-id="file-1::bp-375"></iframe>
      </div>`;
    const frame = document.querySelector("iframe")!;
    frame.contentDocument!.body.innerHTML =
      '<section data-agent-native-node-id="hero">Hi</section>';
    frame.remove();
    document
      .querySelector("[data-frame-id]")!
      .insertAdjacentHTML(
        "beforeend",
        '<iframe data-screen-iframe-id="file-1::bp-375"></iframe>',
      );
    const remounted = document.querySelector("iframe")!;
    remounted.contentDocument!.body.innerHTML =
      '<section data-agent-native-node-id="hero">Hi</section>';

    expect(findDesignLayer(frame, "file-1", "hero")).toBe(
      remounted.contentDocument!.querySelector("section"),
    );
  });

  it("ignores targets outside a screen document or a layer", () => {
    const frameDocument = renderScreen();
    expect(
      designElementSelectable(
        "design-1",
        "Launch",
        screens,
        frameDocument.querySelector("p")!,
      ),
    ).toBeNull();
    expect(
      designElementSelectable(
        "design-1",
        "Launch",
        screens,
        document.querySelector("[data-frame-id]")!,
      ),
    ).toBeNull();
    // An editor overlay in the frame resolves to the root, which is the screen.
    frameDocument.documentElement.setAttribute(
      "data-agent-native-node-id",
      "root",
    );
    const overlay = frameDocument.createElement("div");
    frameDocument.documentElement.appendChild(overlay);
    expect(
      designElementSelectable("design-1", "Launch", screens, overlay),
    ).toBeNull();
  });
});
