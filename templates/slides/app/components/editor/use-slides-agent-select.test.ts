// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  slideElements,
  slideObjectSelectable,
} from "./use-slides-agent-select";

function renderDeck() {
  document.body.innerHTML = `
    <aside>
      <button data-slide-thumbnail-id="s1">
        <div data-slide-thumbnail-frame>
          <div data-slide-canvas="s1">
            <div data-slide-content-scope="t1"><h1>Thumb</h1></div>
          </div>
        </div>
      </button>
    </aside>
    <main data-main-slide-canvas="true">
      <div data-slide-canvas="s1">
        <div data-slide-content-scope="m1">
          <div class="fmd-slide">
            <h1>Quarterly <strong>results</strong></h1>
            <div data-slide-object-id="chart-1"><img alt="Revenue chart" /></div>
          </div>
        </div>
      </div>
    </main>`;
}

const slideNumberOf = (slideId: string) => (slideId === "s1" ? 1 : null);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Slides Select adapter", () => {
  it("outlines a slide on the canvas and in the thumbnail rail", () => {
    renderDeck();
    expect(
      slideElements("s1").map((element) => element.tagName.toLowerCase()),
    ).toEqual(["button", "div"]);
  });

  it("picks the block an inline target belongs to, by its path in the slide HTML", () => {
    renderDeck();
    const strong = document.querySelector("main strong")!;
    const selectable = slideObjectSelectable("deck-1", slideNumberOf, strong);

    expect(selectable).toMatchObject({
      kind: "element",
      id: "s1/path:div:nth-child(1) > h1:nth-child(1)",
      parent: { kind: "slide", id: "s1" },
      title: "Quarterly results",
    });
    expect(selectable?.getElement()).toBe(document.querySelector("main h1"));
    expect(selectable?.getContext()).toBe(
      [
        "Deck id: deck-1",
        "Slide id: s1",
        "Slide number: 1",
        "Element path in the slide HTML: div:nth-child(1) > h1:nth-child(1)",
        "Element tag: h1",
        "Element text: Quarterly results",
        "Edit only this element on this slide.",
      ].join("\n"),
    );
  });

  it("prefers a persisted object id", () => {
    renderDeck();
    const image = document.querySelector("main img")!;
    const selectable = slideObjectSelectable("deck-1", slideNumberOf, image);
    expect(selectable?.id).toBe(
      "s1/path:div:nth-child(1) > div:nth-child(2) > img:nth-child(1)",
    );

    const object = document.querySelector('[data-slide-object-id="chart-1"]')!;
    const objectSelectable = slideObjectSelectable(
      "deck-1",
      slideNumberOf,
      object,
    );
    expect(objectSelectable?.id).toBe("s1/object:chart-1");
    expect(objectSelectable?.getContext()).toContain(
      'Element selector: [data-slide-object-id="chart-1"]',
    );
  });

  it("ignores thumbnails and the slide root itself", () => {
    renderDeck();
    expect(
      slideObjectSelectable(
        "deck-1",
        slideNumberOf,
        document.querySelector("aside h1")!,
      ),
    ).toBeNull();
    expect(
      slideObjectSelectable(
        "deck-1",
        slideNumberOf,
        document.querySelector("main [data-slide-content-scope]")!,
      ),
    ).toBeNull();
  });
});
