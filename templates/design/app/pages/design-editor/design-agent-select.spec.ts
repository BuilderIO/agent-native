// @vitest-environment happy-dom

import { clearAgentChatContext } from "@agent-native/core/client/agent-chat";
import {
  listAgentSelection,
  selectAgentSelectable,
} from "@agent-native/toolkit/app/agent-select";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  designElementSelectable,
  releaseScreenPicks,
  designScreenElement,
  designScreenSelectable,
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

// Staging a pick persists the composer context.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  clearAgentChatContext();
  vi.unstubAllGlobals();
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

  it("releases a design's screen and layer picks and nothing else", () => {
    const pick = (kind: string, id: string) =>
      selectAgentSelectable({ kind, id, title: id, getContext: () => id });
    pick("screen", "file-1");
    pick("element", "file-1/hero");
    pick("panel", "dash-1/panel-1");

    releaseScreenPicks(["file-1"]);
    expect(listAgentSelection().map(({ id }) => id)).toEqual([
      "dash-1/panel-1",
    ]);
  });
});
