// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  clampRangeToTextRoot,
  clampSelectionToTextRoot,
  firstTextLeaf,
  resolveSlidePointerTarget,
  type SlidePointerTarget,
  type SlidePointerTargetInput,
} from "./slide-pointer-target";

type Rect = { left: number; top: number; right: number; bottom: number };

const rect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): Rect => ({
  left,
  top,
  right,
  bottom,
});

/** The clip's slide: an unpainted container holding a left column and a chart block. */
function mountClipSlide() {
  const root = document.createElement("div");
  root.className = "slide-content";
  root.innerHTML = `
    <div class="fmd-slide" id="slide">
      <div id="container" style="display:flex;gap:24px">
        <div id="left" style="display:flex;flex-direction:column">
          <h2 id="h2">A spectrum, not a switch</h2>
          <p id="para">Magma with low viscosity tends to flow.</p>
          <div id="callout" style="background:#1b1b1b;border-left:3px solid #f97316;padding:12px">Eruption style depends on magma.</div>
          <div id="card" style="background:#14181d;padding:16px">
            <h3 id="cardTitle">Stat</h3><p id="cardBody">Card body copy</p>
          </div>
        </div>
        <div id="chart">
          <div id="row1"><div id="labelA">More fluid</div><div id="labelB">lava can travel farther</div></div>
          <div id="track1" style="background:#222"><div id="fill1" style="background:#f97316"></div></div>
          <div id="row2"><div id="labelC">More viscous</div><div id="labelD">pressure may build</div></div>
          <div id="track2" style="background:#222"><div id="fill2" style="background:#888"></div></div>
          <p id="caption">Conceptual tendencies, not a prediction scale</p>
        </div>
      </div>
      <p id="footer" style="text-align:right">04 / 08</p>
    </div>
  `;
  document.body.append(root);
  const byId = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const text = new Map<HTMLElement, Rect[]>([
    [byId("h2"), [rect(80, 150, 400, 180)]],
    [byId("para"), [rect(80, 190, 400, 210), rect(80, 210, 300, 230)]],
    [byId("callout"), [rect(95, 250, 380, 270)]],
    [byId("cardTitle"), [rect(96, 300, 140, 320)]],
    [byId("cardBody"), [rect(96, 330, 300, 350)]],
    [byId("labelA"), [rect(500, 150, 570, 165)]],
    [byId("labelB"), [rect(780, 150, 900, 165)]],
    [byId("caption"), [rect(500, 270, 800, 285)]],
    [byId("footer"), [rect(860, 500, 900, 512)]],
  ]);
  const bounds = new Map<HTMLElement, Rect>();
  const measure = {
    textRects: (el: HTMLElement) => text.get(el) ?? [],
    boundingRect: (el: HTMLElement) => bounds.get(el) ?? rect(0, 0, 0, 0),
  };
  const slide = byId("slide");
  const chain = (...ids: string[]) => [...ids.map(byId), slide, root];
  const resolve = (
    stack: HTMLElement[],
    point: { x: number; y: number },
    extra: Partial<SlidePointerTargetInput> = {},
  ) => resolveSlidePointerTarget({ root, point, stack, measure, ...extra });
  return { root, byId, text, bounds, measure, chain, resolve, slide };
}

function objectOf(target: SlidePointerTarget) {
  if (target.kind !== "object") throw new Error("expected an object target");
  return target;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveSlidePointerTarget on the clip slide", () => {
  it("treats wrapper whitespace as empty slide at every nesting level", () => {
    const { chain, resolve } = mountClipSlide();
    const stacks = {
      "row gap": chain("row1", "chart", "container"),
      "chart block": chain("chart", "container"),
      container: chain("container"),
      "left column gap": chain("left", "container"),
      "empty slide": chain(),
    };
    for (const [label, stack] of Object.entries(stacks)) {
      expect(resolve(stack, { x: 700, y: 150 }), label).toEqual({
        kind: "whitespace",
        cursor: "default",
      });
    }
  });

  it("resolves the caption text leaf with a text cursor and edit grab", () => {
    const { byId, chain, resolve } = mountClipSlide();
    const target = objectOf(
      resolve(chain("caption", "chart", "container"), { x: 600, y: 278 }),
    );
    expect(target).toMatchObject({
      hit: "text",
      cursor: "text",
      grab: "edit",
      object: byId("caption"),
      textRoot: byId("caption"),
    });
  });

  it("falls to the caption body, still a text object, outside its line bounds", () => {
    const { byId, chain, resolve } = mountClipSlide();
    const target = objectOf(
      resolve(chain("caption", "chart", "container"), { x: 820, y: 278 }),
    );
    expect(target).toMatchObject({
      hit: "body",
      cursor: "move",
      grab: "move",
      object: byId("caption"),
      textRoot: byId("caption"),
    });
  });

  it("picks a bar fill, then its track, as painted bodies", () => {
    const { byId, chain, resolve } = mountClipSlide();
    const fill = objectOf(
      resolve(chain("fill1", "track1", "chart", "container"), {
        x: 520,
        y: 200,
      }),
    );
    expect(fill).toMatchObject({
      hit: "body",
      object: byId("fill1"),
      textRoot: null,
    });
    const track = objectOf(
      resolve(chain("track1", "chart", "container"), { x: 700, y: 200 }),
    );
    expect(track).toMatchObject({ hit: "body", object: byId("track1") });
  });

  it("picks the card for its padding and the text leaf for its text", () => {
    const { byId, chain, resolve } = mountClipSlide();
    const padding = objectOf(
      resolve(chain("card", "left", "container"), { x: 85, y: 290 }),
    );
    // Several leaves: a caret goes into the first one in document order.
    expect(padding).toMatchObject({
      hit: "body",
      object: byId("card"),
      textRoot: byId("cardTitle"),
    });
    const nonTextLeafPixel = objectOf(
      resolve(chain("cardBody", "card", "left", "container"), {
        x: 350,
        y: 340,
      }),
    );
    expect(nonTextLeafPixel).toMatchObject({
      hit: "body",
      object: byId("card"),
    });
    const heading = objectOf(
      resolve(chain("cardTitle", "card", "left", "container"), {
        x: 110,
        y: 310,
      }),
    );
    expect(heading).toMatchObject({
      hit: "text",
      object: byId("cardTitle"),
      textRoot: byId("cardTitle"),
    });
  });

  it("makes a callout that owns its text one object split into text and body", () => {
    const { byId, chain, resolve } = mountClipSlide();
    const onText = objectOf(
      resolve(chain("callout", "left", "container"), { x: 200, y: 260 }),
    );
    expect(onText).toMatchObject({ hit: "text", object: byId("callout") });
    const onPadding = objectOf(
      resolve(chain("callout", "left", "container"), { x: 90, y: 262 }),
    );
    expect(onPadding).toMatchObject({
      hit: "body",
      object: byId("callout"),
      textRoot: byId("callout"),
    });
  });

  it("gives the footer's blank area the footer leaf body, not its text", () => {
    // The footer is one full-width text leaf, so its blank left side is that
    // object's body (move), not a transparent wrapper and not a caret.
    const { byId, chain, resolve } = mountClipSlide();
    const blank = objectOf(resolve(chain("footer"), { x: 200, y: 506 }));
    expect(blank).toMatchObject({
      hit: "body",
      cursor: "move",
      object: byId("footer"),
    });
    const number = objectOf(resolve(chain("footer"), { x: 880, y: 506 }));
    expect(number).toMatchObject({ hit: "text", object: byId("footer") });
  });

  it("returns the same target whatever is selected", () => {
    const { root, chain, resolve } = mountClipSlide();
    const probes = [
      { stack: chain("row1", "chart", "container"), point: { x: 700, y: 150 } },
      {
        stack: chain("labelA", "row1", "chart", "container"),
        point: { x: 520, y: 155 },
      },
      {
        stack: chain("caption", "chart", "container"),
        point: { x: 600, y: 278 },
      },
      {
        stack: chain("fill1", "track1", "chart", "container"),
        point: { x: 520, y: 200 },
      },
      { stack: chain("card", "left", "container"), point: { x: 85, y: 290 } },
      {
        stack: chain("callout", "left", "container"),
        point: { x: 200, y: 260 },
      },
      { stack: chain("footer"), point: { x: 200, y: 506 } },
    ];
    const candidates = [
      null,
      ...Array.from(root.querySelectorAll<HTMLElement>("*")),
    ];
    for (const probe of probes) {
      const baseline = resolve(probe.stack, probe.point);
      for (const selected of candidates) {
        const result = resolve(probe.stack, probe.point, { selected });
        if (baseline.kind === "whitespace") {
          expect(result).toEqual(baseline);
          continue;
        }
        const { hoverOutline: _ignored, ...rest } = objectOf(result);
        const { hoverOutline: _base, ...baseRest } = baseline;
        expect(rest).toEqual(baseRest);
      }
    }
  });

  it("outlines on hover exactly the object a press would take", () => {
    const { chain, resolve } = mountClipSlide();
    for (const stack of [
      chain("caption", "chart", "container"),
      chain("fill1", "track1", "chart", "container"),
      chain("card", "left", "container"),
      chain("footer"),
    ]) {
      const target = objectOf(resolve(stack, { x: 600, y: 278 }));
      expect(target.hoverOutline).toBe(target.object);
    }
  });

  it("drops the outline only for the object that is already selected", () => {
    const { byId, chain, resolve } = mountClipSlide();
    const target = objectOf(
      resolve(
        chain("caption", "chart", "container"),
        { x: 600, y: 278 },
        {
          selected: byId("caption"),
        },
      ),
    );
    expect(target.hoverOutline).toBeNull();
    expect(target.object).toBe(byId("caption"));
  });

  it("falls back to the event target's ancestors when there is no stack", () => {
    const { root, byId, measure } = mountClipSlide();
    const caption = objectOf(
      resolveSlidePointerTarget({
        root,
        point: { x: 600, y: 278 },
        target: byId("caption"),
        measure,
      }),
    );
    expect(caption.object).toBe(byId("caption"));
    expect(
      resolveSlidePointerTarget({
        root,
        point: { x: 700, y: 150 },
        target: byId("row1"),
        measure,
      }),
    ).toEqual({ kind: "whitespace", cursor: "default" });
  });
});

describe("resolveSlidePointerTarget modifiers", () => {
  it("never edits or drags on an additive press and duplicates from text on Alt", () => {
    const { chain, resolve } = mountClipSlide();
    const stack = chain("caption", "chart", "container");
    const point = { x: 600, y: 278 };
    expect(
      objectOf(resolve(stack, point, { modifiers: { shiftKey: true } })).grab,
    ).toBe("none");
    expect(
      objectOf(resolve(stack, point, { modifiers: { metaKey: true } })).grab,
    ).toBe("none");
    expect(
      objectOf(resolve(stack, point, { modifiers: { altKey: true } })).grab,
    ).toBe("move");
  });
});

describe("resolveSlidePointerTarget groups", () => {
  function mountGroup() {
    const root = document.createElement("div");
    root.className = "slide-content";
    root.innerHTML = `
      <div class="fmd-slide" id="slide">
        <p id="outside">Outside text</p>
        <div id="group" class="fmd-slide-group" data-slide-group="true" data-slide-object-id="g1" style="position:absolute">
          <div id="a" data-slide-object-id="a1" style="position:absolute;background:#123">Alpha</div>
          <div id="b" data-slide-object-id="b1" style="position:absolute;background:#321">Beta</div>
        </div>
      </div>
    `;
    document.body.append(root);
    const byId = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    const measure = {
      textRects: (el: HTMLElement) =>
        el.id === "a"
          ? [rect(10, 10, 60, 30)]
          : el.id === "b"
            ? [rect(110, 10, 160, 30)]
            : [],
      boundingRect: () => rect(0, 0, 0, 0),
    };
    const run = (id: string, extra: Partial<SlidePointerTargetInput> = {}) =>
      resolveSlidePointerTarget({
        root,
        point: { x: id === "a" ? 20 : 120, y: 20 },
        stack: [byId(id), byId("group"), byId("slide"), root],
        measure,
        ...extra,
      });
    return { root, byId, run, measure };
  }

  it("drills from the group to a member only once the group is selected", () => {
    const { byId, run } = mountGroup();
    expect(objectOf(run("a")).object).toBe(byId("group"));
    expect(objectOf(run("a", { selected: byId("outside") })).object).toBe(
      byId("group"),
    );
    expect(objectOf(run("a", { selected: byId("group") })).object).toBe(
      byId("a"),
    );
    expect(objectOf(run("a", { selected: byId("group") }))).toMatchObject({
      hit: "text",
      grab: "edit",
    });
  });

  it("keeps sibling members directly pickable while one member is selected", () => {
    const { byId, run } = mountGroup();
    expect(objectOf(run("b", { selected: byId("a") })).object).toBe(byId("b"));
  });

  it("selects the whole group on a member press without a caret", () => {
    const { byId, run } = mountGroup();
    expect(objectOf(run("a"))).toMatchObject({
      hit: "body",
      textRoot: null,
      cursor: "move",
      grab: "move",
      object: byId("group"),
    });
  });

  it("picks members directly when asked to go into groups (double-click)", () => {
    const { byId, run } = mountGroup();
    expect(objectOf(run("b", { intoGroups: true }))).toMatchObject({
      object: byId("b"),
      hit: "text",
    });
  });

  it("does not hit-test the empty space inside a group's bounds", () => {
    const { byId, root, measure } = mountGroup();
    for (const selected of [null, byId("group"), byId("a")]) {
      expect(
        resolveSlidePointerTarget({
          root,
          point: { x: 80, y: 80 },
          stack: [byId("group"), byId("slide"), root],
          selected,
          measure,
        }),
      ).toEqual({ kind: "whitespace", cursor: "default" });
    }
  });
});

describe("resolveSlidePointerTarget freeform objects", () => {
  function mountFreeform() {
    const root = document.createElement("div");
    root.className = "slide-content";
    root.innerHTML = `
      <div class="fmd-slide" id="slide">
        <div id="lower" class="fmd-text-box" data-slide-object-id="t1" style="position:absolute">Lower text</div>
        <div id="top" data-slide-object-id="t2" style="position:absolute"></div>
        <div id="empty" class="fmd-text-box" data-slide-object-id="t3" style="position:absolute"></div>
      </div>
    `;
    document.body.append(root);
    const byId = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    const bounds = new Map<HTMLElement, Rect>([
      [byId("lower"), rect(100, 200, 300, 260)],
      [byId("top"), rect(0, 0, 50, 50)],
      [byId("empty"), rect(400, 200, 500, 260)],
    ]);
    const measure = {
      textRects: (el: HTMLElement) =>
        el.id === "lower" ? [rect(110, 210, 200, 230)] : [],
      boundingRect: (el: HTMLElement) => bounds.get(el) ?? rect(0, 0, 0, 0),
    };
    const resolve = (
      stack: HTMLElement[],
      point: { x: number; y: number },
      extra: Partial<SlidePointerTargetInput> = {},
    ) => resolveSlidePointerTarget({ root, point, stack, measure, ...extra });
    return { root, byId, resolve };
  }

  it("lets an unfilled freeform object on top block the text box below it", () => {
    const { byId, root, resolve } = mountFreeform();
    const slide = byId("slide");
    expect(
      objectOf(
        resolve([byId("top"), byId("lower"), slide, root], { x: 150, y: 220 }),
      ),
    ).toMatchObject({ object: byId("top"), hit: "body" });
    expect(
      objectOf(resolve([byId("lower"), slide, root], { x: 150, y: 220 })),
    ).toMatchObject({
      object: byId("lower"),
      hit: "text",
      textRoot: byId("lower"),
    });
  });

  it("selects and moves a persisted text box from its padding, unselected", () => {
    const { byId, root, resolve } = mountFreeform();
    const target = objectOf(
      resolve([byId("lower"), byId("slide"), root], { x: 280, y: 255 }),
    );
    expect(target).toMatchObject({
      hit: "body",
      grab: "move",
      cursor: "move",
      object: byId("lower"),
      textRoot: byId("lower"),
    });
  });

  it("keeps an empty text box whole-box hit-testable and blocking", () => {
    const { byId, root, resolve } = mountFreeform();
    const target = objectOf(
      resolve([byId("empty"), byId("lower"), byId("slide"), root], {
        x: 450,
        y: 230,
      }),
    );
    expect(target).toMatchObject({
      object: byId("empty"),
      hit: "body",
      cursor: "move",
    });
  });

  it("grabs a freeform object from 5 px outside its border but not 6", () => {
    const { byId, root, resolve } = mountFreeform();
    const stack = [byId("slide"), root];
    expect(objectOf(resolve(stack, { x: 95, y: 230 }))).toMatchObject({
      object: byId("lower"),
      hit: "body",
      grab: "move",
    });
    expect(objectOf(resolve(stack, { x: 305, y: 265 })).object).toBe(
      byId("lower"),
    );
    expect(resolve(stack, { x: 94, y: 230 }).kind).toBe("whitespace");
  });

  it("prefers a direct hit over a neighbouring object's edge slop", () => {
    const { byId, root, resolve } = mountFreeform();
    const target = objectOf(
      resolve([byId("empty"), byId("slide"), root], { x: 403, y: 230 }),
    );
    expect(target.object).toBe(byId("empty"));
  });
});

describe("resolveSlidePointerTarget special elements", () => {
  it("treats a full-slide painted backdrop as empty slide", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="fmd-slide"><div id="backdrop" style="background:#111"><div><div></div></div></div></div>`;
    document.body.append(root);
    const backdrop = root.querySelector<HTMLElement>("#backdrop")!;
    const slideRect = DOMRect.fromRect({ width: 960, height: 540 });
    root.getBoundingClientRect = () => slideRect;
    backdrop.getBoundingClientRect = () => slideRect;
    expect(
      resolveSlidePointerTarget({
        root,
        point: { x: 10, y: 10 },
        stack: [backdrop, root.firstElementChild as HTMLElement, root],
        measure: { textRects: () => [], boundingRect: () => rect(0, 0, 0, 0) },
      }),
    ).toEqual({ kind: "whitespace", cursor: "default" });
  });

  it("keeps a wrapper that carries media or mixed content selectable", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div id="media"><svg id="icon"></svg></div>
        <div id="mixed">Loose text<div><i></i></div></div>
      </div>`;
    document.body.append(root);
    const measure = {
      textRects: () => [],
      boundingRect: () => rect(0, 0, 0, 0),
    };
    const slide = root.firstElementChild as HTMLElement;
    const media = root.querySelector<HTMLElement>("#media")!;
    const mixed = root.querySelector<HTMLElement>("#mixed")!;
    expect(
      objectOf(
        resolveSlidePointerTarget({
          root,
          point: { x: 1, y: 1 },
          stack: [root.querySelector("#icon")!, media, slide, root],
          measure,
        }),
      ).object,
    ).toBe(media);
    expect(
      objectOf(
        resolveSlidePointerTarget({
          root,
          point: { x: 1, y: 1 },
          stack: [mixed, slide, root],
          measure,
        }),
      ).object,
    ).toBe(mixed);
  });

  it("selects an image, including its persisted wrapper", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="fmd-slide"><div id="wrap" class="fmd-pptx-image" data-slide-object-id="i1" style="position:absolute"><img id="img" src="x.png"></div></div>`;
    document.body.append(root);
    const wrap = root.querySelector<HTMLElement>("#wrap")!;
    const target = objectOf(
      resolveSlidePointerTarget({
        root,
        point: { x: 1, y: 1 },
        stack: [
          root.querySelector("#img")!,
          wrap,
          root.firstElementChild!,
          root,
        ],
        measure: { textRects: () => [], boundingRect: () => rect(0, 0, 0, 0) },
      }),
    );
    expect(target).toMatchObject({ object: wrap, hit: "body", textRoot: null });
  });
});

describe("resolveSlidePointerTarget on lists, tables and logo rows", () => {
  const noMeasure = {
    textRects: () => [],
    boundingRect: () => rect(0, 0, 0, 0),
  };

  it("treats a row of several images as layout, not an object", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="fmd-slide"><div id="logos" style="display:flex;gap:24px"><img src="a.png"><img src="b.png"></div></div>`;
    document.body.append(root);
    const logos = root.querySelector<HTMLElement>("#logos")!;
    expect(
      resolveSlidePointerTarget({
        root,
        point: { x: 40, y: 10 },
        stack: [logos, root.firstElementChild as HTMLElement, root],
        measure: noMeasure,
      }),
    ).toEqual({ kind: "whitespace", cursor: "default" });
  });

  it("takes a press on a bullet or the list gutter as text, not a list move", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="fmd-slide"><ul id="list"><li id="one">First point</li><li id="two">Second point</li></ul></div>`;
    document.body.append(root);
    const byId = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    const list = byId("list");
    const measure = {
      // Text starts at x=100; the bullet sits in the 40px gutter at x=60..100.
      textRects: (el: HTMLElement) =>
        list.contains(el)
          ? [rect(100, 50, 300, 70), rect(100, 80, 300, 100)]
          : [],
      boundingRect: (el: HTMLElement) =>
        el === list ? rect(60, 50, 300, 100) : rect(0, 0, 0, 0),
    };
    const stack = (id: string) => [
      byId(id),
      list,
      root.firstElementChild!,
      root,
    ];
    const gutter = objectOf(
      resolveSlidePointerTarget({
        root,
        point: { x: 70, y: 90 },
        stack: stack("two") as HTMLElement[],
        measure,
      }),
    );
    expect(gutter).toMatchObject({ hit: "text", cursor: "text", grab: "edit" });
    expect(gutter.textRoot?.contains(byId("two"))).toBe(true);
    // Left of the list's own edge is not its gutter.
    const outside = resolveSlidePointerTarget({
      root,
      point: { x: 40, y: 90 },
      stack: stack("two") as HTMLElement[],
      measure,
    });
    expect(outside.kind === "object" ? outside.hit : "whitespace").not.toBe(
      "text",
    );
  });

  it("makes a table cell all text, so a press in its padding never moves it", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="fmd-slide"><table id="table"><tbody><tr><td id="cell" style="padding:20px">Cell text</td></tr></tbody></table></div>`;
    document.body.append(root);
    const cell = root.querySelector<HTMLElement>("#cell")!;
    const target = objectOf(
      resolveSlidePointerTarget({
        root,
        point: { x: 5, y: 5 },
        stack: [cell, root.firstElementChild as HTMLElement, root],
        measure: {
          textRects: (el) => (el === cell ? [rect(50, 50, 100, 70)] : []),
          boundingRect: () => rect(0, 0, 0, 0),
        },
      }),
    );
    expect(target).toMatchObject({
      object: cell,
      hit: "text",
      textRoot: cell,
      grab: "edit",
    });
  });
});

describe("firstTextLeaf", () => {
  it("returns the only text leaf, or the first of several in document order", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="fmd-slide">
      <div id="solo" style="background:#111;padding:8px"><p id="only">Only</p></div>
      <div id="many" style="background:#111;padding:8px"><h3 id="head">Head</h3><p id="body">Body</p></div>
      <div id="none" style="background:#111;padding:8px"></div>
    </div>`;
    document.body.append(root);
    const get = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    expect(firstTextLeaf(get("solo"), root)).toBe(get("only"));
    expect(firstTextLeaf(get("many"), root)).toBe(get("head"));
    expect(firstTextLeaf(get("none"), root)).toBeNull();
  });
});

describe("clampSelectionToTextRoot", () => {
  function mountLeaves() {
    document.body.innerHTML = `<p id="a">Alpha text</p><p id="b">Beta text</p><p id="c">Gamma text</p>`;
    const get = (id: string) => document.getElementById(id)!;
    return { a: get("a"), b: get("b"), c: get("c") };
  }

  it("leaves a selection inside the root alone", () => {
    const { a } = mountLeaves();
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(a.firstChild!, 2, a.firstChild!, 6);
    clampSelectionToTextRoot(selection, a);
    expect(selection.toString()).toBe("pha ");
  });

  it("pins a forward drag that runs into the next leaf to the end of the press leaf", () => {
    const { a, b } = mountLeaves();
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(a.firstChild!, 3, b.firstChild!, 2);
    clampSelectionToTextRoot(selection, a);
    expect(selection.anchorNode).toBe(a.firstChild);
    expect(selection.anchorOffset).toBe(3);
    expect(a.contains(selection.focusNode)).toBe(true);
    expect(selection.toString()).toBe("ha text");
  });

  it("keeps the anchor of a backward drag that runs into the previous leaf", () => {
    const { a, b } = mountLeaves();
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(b.firstChild!, 4, a.firstChild!, 2);
    clampSelectionToTextRoot(selection, b);
    expect(selection.anchorNode).toBe(b.firstChild);
    expect(selection.anchorOffset).toBe(4);
    expect(b.contains(selection.focusNode)).toBe(true);
    expect(selection.toString()).toBe("Beta");
  });
});

describe("clampRangeToTextRoot", () => {
  function mountLeaves() {
    document.body.innerHTML = `<p id="a">Alpha text</p><p id="b">Beta text</p><p id="c">Gamma text</p>`;
    const get = (id: string) => document.getElementById(id)!;
    const range = (from: [Node, number], to: [Node, number]) => {
      const r = document.createRange();
      r.setStart(...from);
      r.setEnd(...to);
      return r;
    };
    return { a: get("a"), b: get("b"), c: get("c"), range };
  }

  it("keeps a range that is already inside the root", () => {
    const { a, range } = mountLeaves();
    const clamped = clampRangeToTextRoot(
      range([a.firstChild!, 2], [a.firstChild!, 5]),
      a,
    );
    expect([clamped.startOffset, clamped.endOffset]).toEqual([2, 5]);
    expect(clamped.startContainer).toBe(a.firstChild);
  });

  it("clamps a drag that ends in a later leaf to the end of the press leaf", () => {
    const { a, b, range } = mountLeaves();
    const clamped = clampRangeToTextRoot(
      range([a.firstChild!, 3], [b.firstChild!, 2]),
      a,
    );
    expect(clamped.startContainer).toBe(a.firstChild);
    expect(clamped.startOffset).toBe(3);
    expect(a.contains(clamped.endContainer)).toBe(true);
    expect(clamped.toString()).toBe("ha text");
  });

  it("clamps a drag that ends in an earlier leaf to the start of the press leaf", () => {
    const { a, b, range } = mountLeaves();
    const clamped = clampRangeToTextRoot(
      range([a.firstChild!, 2], [b.firstChild!, 2]).cloneRange(),
      b,
    );
    expect(b.contains(clamped.startContainer)).toBe(true);
    expect(b.contains(clamped.endContainer)).toBe(true);
    expect(clamped.toString()).toBe("Be");
  });

  it("collapses a range that lies entirely outside the root onto its edge", () => {
    const { a, c, range } = mountLeaves();
    const clamped = clampRangeToTextRoot(
      range([c.firstChild!, 1], [c.firstChild!, 4]),
      a,
    );
    expect(clamped.collapsed).toBe(true);
    expect(a.contains(clamped.startContainer)).toBe(true);
  });

  it("does not mutate the range it was given", () => {
    const { a, b, range } = mountLeaves();
    const original = range([a.firstChild!, 3], [b.firstChild!, 2]);
    clampRangeToTextRoot(original, a);
    expect(original.endContainer).toBe(b.firstChild);
    expect(original.endOffset).toBe(2);
  });
});

describe("resolveSlidePointerTarget on slide-number digits", () => {
  it("counts the digits drawn by a token as text, not as the footer's body", () => {
    const root = document.createElement("div");
    root.className = "slide-content";
    root.innerHTML = `<div class="fmd-slide"><p id="footer">Page <span id="n" data-slide-number></span></p></div>`;
    document.body.append(root);
    const token = root.querySelector<HTMLElement>("#n")!;
    const footer = root.querySelector<HTMLElement>("#footer")!;
    token.getClientRects = () =>
      [
        { left: 100, top: 10, right: 112, bottom: 30, width: 12, height: 20 },
      ] as unknown as DOMRectList;
    const target = resolveSlidePointerTarget({
      root,
      point: { x: 106, y: 20 },
      stack: [token, footer, root],
    });
    expect(target.hit).toBe("text");
    expect(target.textRoot).toBe(footer);
  });
});
