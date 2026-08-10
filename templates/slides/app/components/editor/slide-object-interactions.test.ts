// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { sanitizeSlideHtml } from "@/lib/sanitize-slide-html";

import {
  applySlideObjectMoveDelta,
  buildPastedSlideObjects,
  clientPointToSlideCoordinates,
  cloneSlideObject,
  collectMovableSlideObjects,
  computeSlideObjectZOrder,
  copySlideObjects,
  createSlidesSelectionState,
  ensureSlideObjectId,
  ensureSlideTextBoxCanvas,
  findSlideObjectById,
  freezeSlideElementForFreeform,
  getSlideSelectionIdentity,
  getSlideSelectionMode,
  findPersistedImageObject,
  getSlideTextBoxDefaultColor,
  isDeletableFlowImage,
  removeSlideObjectAndLayoutSpacer,
  resolveSlideObjectContainingBlock,
  resizeSlideObject,
  SLIDE_OBJECT_PASTE_OFFSET,
  type SlideObjectGeometry,
} from "./slide-object-interactions";

function createFreeformObject(
  id: string,
  { left, top, zIndex }: { left?: number; top?: number; zIndex?: number } = {},
): HTMLElement {
  const element = document.createElement("div");
  element.dataset.slideObjectId = id;
  element.style.position = "absolute";
  if (left !== undefined) element.style.left = `${left}px`;
  if (top !== undefined) element.style.top = `${top}px`;
  if (zIndex !== undefined) element.style.zIndex = `${zIndex}`;
  return element;
}

describe("slide object interactions", () => {
  it("promotes a Markdown-rendered canvas so a new text box can persist as a freeform object", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-slide-canvas style="justify-content: center; align-items: flex-start; padding: 48px 64px; color: rgb(17, 24, 39); font-family: Inter, sans-serif;">
        <div class="slide-content" style="color: rgb(255, 255, 255)"><h1 style="color: rgb(17, 24, 39)">Markdown heading</h1></div>
      </div>
    `;
    document.body.append(root);
    const heading = root.querySelector<HTMLElement>("h1")!;

    const canvas = ensureSlideTextBoxCanvas(root);

    expect(canvas?.fmdSlide.classList.contains("fmd-slide")).toBe(true);
    expect(canvas?.fmdSlide.textContent).toBe("Markdown heading");
    expect(canvas?.fmdSlide.style.padding).toBe("48px 64px");

    const box = document.createElement("div");
    box.className = "fmd-text-box";
    box.style.position = "absolute";
    box.style.color = getSlideTextBoxDefaultColor(
      heading,
      canvas!.positioningLayer,
    );
    box.textContent = "New text";
    ensureSlideObjectId(box);
    canvas!.positioningLayer.append(box);

    expect(canvas!.fmdSlide.querySelector(".fmd-text-box")?.textContent).toBe(
      "New text",
    );
    expect(box.dataset.slideObjectId).toBeTruthy();
    expect(box.style.color).toBe("rgb(17, 24, 39)");
    const persistedHtml = sanitizeSlideHtml(
      root.querySelector(".slide-content")?.innerHTML ?? "",
    );
    expect(persistedHtml).toContain("fmd-slide");
    expect(persistedHtml).toContain("fmd-text-box");
    expect(persistedHtml).toContain("data-slide-object-id");
    root.remove();
  });

  it("prefers rendered text over a generic white slide-content shell and contrasts a blank dark canvas", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-slide-canvas style="background-color: rgb(255, 255, 255)">
        <div class="slide-content" style="color: rgb(255, 255, 255)"><h1 style="color: rgb(17, 24, 39)">Dark heading</h1></div>
      </div>
    `;
    document.body.append(root);
    const shell = root.querySelector<HTMLElement>(".slide-content")!;
    const lightCanvas = ensureSlideTextBoxCanvas(root)!;

    expect(
      getSlideTextBoxDefaultColor(shell, lightCanvas.positioningLayer),
    ).toBe("rgb(17, 24, 39)");

    const darkRoot = document.createElement("div");
    darkRoot.innerHTML = `
      <div data-slide-canvas style="background-color: rgb(0, 0, 0)">
        <div class="slide-content"></div>
      </div>
    `;
    document.body.append(darkRoot);
    const darkCanvas = ensureSlideTextBoxCanvas(darkRoot)!;
    expect(getSlideTextBoxDefaultColor(null, darkCanvas.positioningLayer)).toBe(
      "#ffffff",
    );
    root.remove();
    darkRoot.remove();
  });

  it("declines two-column Markdown promotion without dropping either rendered column", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-slide-canvas>
        <div class="slide-content"><p>Left column</p></div>
        <div class="slide-content"><p>Right column</p></div>
      </div>
    `;

    expect(ensureSlideTextBoxCanvas(root)).toBeNull();
    expect(root.textContent).toContain("Left column");
    expect(root.textContent).toContain("Right column");
    expect(root.querySelector(".fmd-slide")).toBeNull();
  });

  it("places boxes in the autofit layer's unscaled layout coordinates", () => {
    expect(
      clientPointToSlideCoordinates(
        820,
        500,
        { left: 226, top: 80, width: 1700, height: 920 },
        1700,
        920,
      ),
    ).toEqual({ x: 594, y: 420 });
  });

  it("preserves negative coordinates when a slide click is outside its padded layer", () => {
    expect(
      clientPointToSlideCoordinates(
        80,
        40,
        { left: 110, top: 80, width: 1700, height: 920 },
        1700,
        920,
      ),
    ).toEqual({ x: -30, y: -40 });
  });

  it("uses the nearest positioned ancestor for nested freeform coordinates", () => {
    const layer = document.createElement("div");
    const layoutGroup = document.createElement("div");
    const positionedParent = document.createElement("div");
    const text = document.createElement("p");
    positionedParent.style.position = "absolute";
    positionedParent.append(text);
    layoutGroup.append(positionedParent);
    layer.append(layoutGroup);
    document.body.append(layer);

    const containingBlock = resolveSlideObjectContainingBlock(text, layer);

    expect(containingBlock).toBe(positionedParent);
    expect(
      clientPointToSlideCoordinates(
        250,
        130,
        { left: 200, top: 100, width: 800, height: 600 },
        800,
        600,
      ),
    ).toEqual({ x: 50, y: 30 });
  });

  it("falls back to the autofit layer for normal nested layout", () => {
    const layer = document.createElement("div");
    const layoutGroup = document.createElement("div");
    const text = document.createElement("p");
    layoutGroup.append(text);
    layer.append(layoutGroup);
    document.body.append(layer);

    expect(resolveSlideObjectContainingBlock(text, layer)).toBe(layer);
  });

  it("gives clones a distinct persisted identity and drops runtime ids", () => {
    const object = document.createElement("div");
    object.dataset.builderId = "b-1";
    object.dataset.slideObjectId = "original";
    object.innerHTML = `
      <span data-builder-id="b-2">Text</span>
      <div data-slide-object-id="nested-object">Nested object</div>
    `;

    const clone = cloneSlideObject(object);
    const originalIds = new Set(
      [
        object,
        ...object.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
      ].map((node) => node.dataset.slideObjectId),
    );
    const cloneIds = [
      clone,
      ...clone.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ].map((node) => node.dataset.slideObjectId);

    expect(clone.dataset.slideObjectId).not.toBe(object.dataset.slideObjectId);
    expect(clone.querySelectorAll("[data-builder-id]")).toHaveLength(0);
    expect(new Set(cloneIds)).toHaveLength(cloneIds.length);
    expect(cloneIds.some((id) => originalIds.has(id))).toBe(false);
    expect(ensureSlideObjectId(object)).toBe("original");
  });

  it("remints DOM ids and keeps clone-local references attached", () => {
    const object = document.createElement("div");
    object.id = "source-root";
    object.dataset.slideObjectId = "source-object";
    object.innerHTML = `
      <label for="source-input" aria-describedby="source-description external">Label</label>
      <input id="source-input" />
      <span id="source-description">Description</span>
      <a href="#source-description">Jump</a>
      <div id="source-filter"></div>
      <div style="filter: url(#source-filter)"></div>
    `;
    document.body.append(object);

    const clone = cloneSlideObject(object);
    document.body.append(clone);
    const label = clone.querySelector("label")!;
    const input = clone.querySelector("input")!;
    const description = clone.querySelector("span")!;
    const link = clone.querySelector("a")!;
    const filter = clone.querySelector("[style]")!;
    const filterTarget = clone.querySelectorAll<HTMLElement>("div[id]")[0];
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[id]")).map(
      (element) => element.id,
    );

    expect(clone.id).not.toBe("source-root");
    expect(new Set(ids)).toHaveLength(ids.length);
    expect(label.getAttribute("for")).toBe(input.id);
    expect(label.getAttribute("aria-describedby")).toBe(
      `${description.id} external`,
    );
    expect(link.getAttribute("href")).toBe(`#${description.id}`);
    expect(filter.getAttribute("style")).toContain(`url(#${filterTarget.id})`);
  });

  it("publishes persisted freeform identity while retaining the runtime selector", () => {
    const object = document.createElement("div");
    object.dataset.slideObjectId = "freeform-1";

    expect(
      getSlideSelectionIdentity(object, '[data-builder-id="b-1"]'),
    ).toEqual({
      selector: '[data-slide-object-id="freeform-1"]',
      runtimeSelector: '[data-builder-id="b-1"]',
      objectId: "freeform-1",
    });
  });

  it("keeps absolute objects in box-selected and honors resizing mode", () => {
    const absoluteObject = { isImage: false, isAbsolute: true };

    expect(getSlideSelectionMode(absoluteObject)).toBe("box-selected");
    expect(getSlideSelectionMode(absoluteObject, "resizing")).toBe("resizing");
  });

  it("publishes canvas text-tool state while the tool is armed", () => {
    expect(
      createSlidesSelectionState({
        deckId: "deck-1",
        slideId: "slide-1",
        slideIndex: 2,
        mode: "canvas",
        items: [],
        drawMode: false,
        pinMode: false,
        textBoxMode: true,
      }),
    ).toEqual({
      deckId: "deck-1",
      slideId: "slide-1",
      slideIndex: 2,
      slideNumber: 3,
      mode: "canvas",
      activeTool: "text",
      items: [],
    });
  });

  it("resolves a persisted object after its DOM path changes", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-fmd-autofit-content>
        <div data-slide-object-id="persisted-text">Text</div>
      </div>
    `;

    expect(findSlideObjectById(root, "persisted-text")?.textContent).toBe(
      "Text",
    );
    expect(findSlideObjectById(root, "missing")).toBeNull();
  });

  it.each([
    ["nw", { x: 140, y: 80, width: 160, height: 70 }],
    ["n", { x: 100, y: 80, width: 200, height: 70 }],
    ["ne", { x: 100, y: 80, width: 240, height: 70 }],
    ["w", { x: 140, y: 50, width: 160, height: 100 }],
    ["e", { x: 100, y: 50, width: 240, height: 100 }],
    ["sw", { x: 140, y: 50, width: 160, height: 130 }],
    ["s", { x: 100, y: 50, width: 200, height: 130 }],
    ["se", { x: 100, y: 50, width: 240, height: 130 }],
  ] as const)(
    "resizes and anchors the opposite edge for the %s handle",
    (handle, expected) => {
      expect(
        resizeSlideObject(
          { x: 100, y: 50, width: 200, height: 100 },
          { handle, dx: 40, dy: 30, preserveAspectRatio: false },
        ),
      ).toEqual(expected);
    },
  );

  it.each([
    ["nw", 500, 500, { x: 276, y: 126, width: 24, height: 24 }],
    ["n", 0, 500, { x: 100, y: 126, width: 200, height: 24 }],
    ["ne", -500, 500, { x: 100, y: 126, width: 24, height: 24 }],
    ["w", 500, 0, { x: 276, y: 50, width: 24, height: 100 }],
    ["e", -500, 0, { x: 100, y: 50, width: 24, height: 100 }],
    ["sw", 500, -500, { x: 276, y: 50, width: 24, height: 24 }],
    ["s", 0, -500, { x: 100, y: 50, width: 200, height: 24 }],
    ["se", -500, -500, { x: 100, y: 50, width: 24, height: 24 }],
  ] as const)(
    "keeps the opposite edge anchored when the %s handle reaches the minimum",
    (handle, dx, dy, expected) => {
      expect(
        resizeSlideObject(
          { x: 100, y: 50, width: 200, height: 100 },
          { handle, dx, dy, preserveAspectRatio: false },
        ),
      ).toEqual(expected);
    },
  );

  it("uses Shift aspect locking for corners while midpoint handles remain axis-only", () => {
    expect(
      resizeSlideObject(
        { x: 100, y: 50, width: 200, height: 100 },
        { handle: "nw", dx: 30, dy: 10, preserveAspectRatio: true },
      ),
    ).toEqual({ x: 130, y: 65, width: 170, height: 85 });

    expect(
      resizeSlideObject(
        { x: 100, y: 50, width: 200, height: 100 },
        { handle: "w", dx: 30, dy: 99, preserveAspectRatio: true },
      ),
    ).toEqual({ x: 130, y: 50, width: 170, height: 100 });
  });

  it("freezes an in-flow text block without removing its layout slot", () => {
    const parent = document.createElement("div");
    const text = document.createElement("h1");
    text.dataset.builderId = "heading";
    text.textContent = "Slide title";
    text.style.fontWeight = "700";
    parent.append(text);

    const spacer = freezeSlideElementForFreeform(
      text,
      { x: 120, y: 80, width: 420, height: 64 },
      {
        display: "block",
        flexGrow: "0",
        flexShrink: "1",
        flexBasis: "auto",
        alignSelf: "auto",
      },
      {
        color: "rgb(17, 24, 39)",
        direction: "ltr",
        fontFamily: "Inter",
        fontSize: "48px",
        fontStyle: "normal",
        fontWeight: "500",
        letterSpacing: "-1px",
        lineHeight: "56px",
        textAlign: "left",
        textDecoration: "none",
        textShadow: "none",
        textTransform: "none",
        whiteSpace: "normal",
        wordSpacing: "0px",
      },
    );

    expect(parent.children).toHaveLength(2);
    expect(parent.firstElementChild).toBe(spacer);
    expect(spacer.classList.contains("fmd-layout-spacer")).toBe(true);
    expect(spacer.style.visibility).toBe("hidden");
    expect(spacer.style.width).toBe("420px");
    expect(spacer.style.flexGrow).toBe("0");
    expect(spacer.style.flexShrink).toBe("0");
    expect(spacer.style.flexBasis).toBe("auto");
    expect(spacer.dataset.builderId).toBeUndefined();
    expect(text.style.position).toBe("absolute");
    expect(text.style.left).toBe("120px");
    expect(text.style.top).toBe("80px");
    expect(text.style.color).toBe("rgb(17, 24, 39)");
    expect(text.style.fontSize).toBe("48px");
    expect(text.style.fontWeight).toBe("700");
    expect(text.dataset.slideObjectId).toBeTruthy();
    expect(spacer.dataset.slideLayoutSpacerFor).toBe(
      text.dataset.slideObjectId,
    );

    removeSlideObjectAndLayoutSpacer(text);
    expect(parent.children).toHaveLength(0);
  });

  it.each([
    ["image", "img"],
    ["container", "div"],
  ] as const)(
    "freezes an in-flow %s as a movable object",
    (_label, tagName) => {
      const parent = document.createElement("div");
      const element = document.createElement(tagName);
      if (tagName === "div") element.textContent = "Wrapper content";
      parent.append(element);

      const spacer = freezeSlideElementForFreeform(
        element,
        { x: 120, y: 80, width: 420, height: 64 },
        {
          display: "block",
          flexGrow: "0",
          flexShrink: "1",
          flexBasis: "auto",
          alignSelf: "auto",
        },
      );

      expect(element.style.position).toBe("absolute");
      expect(element.dataset.slideObjectId).toBeTruthy();
      expect(spacer.dataset.slideLayoutSpacerFor).toBe(
        element.dataset.slideObjectId,
      );

      removeSlideObjectAndLayoutSpacer(element);
      expect(parent.children).toHaveLength(0);
    },
  );

  it("sends an object in front of every peer", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("front-me", { zIndex: 0 });
    const peerA = createFreeformObject("peer-a", { zIndex: 2 });
    const peerB = createFreeformObject("peer-b", { zIndex: 5 });
    container.append(element, peerA, peerB);

    expect(computeSlideObjectZOrder(element, container, "front")).toEqual({
      value: 6,
      shiftPeers: [],
    });
  });

  it("sends an object behind every peer when there is room below", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("back-me", { zIndex: 5 });
    const peerA = createFreeformObject("peer-a", { zIndex: 2 });
    const peerB = createFreeformObject("peer-b", { zIndex: 3 });
    container.append(element, peerA, peerB);

    expect(computeSlideObjectZOrder(element, container, "back")).toEqual({
      value: 1,
      shiftPeers: [],
    });
  });

  it("returns null when there are no other freeform peers", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("solo");
    container.append(element);

    expect(computeSlideObjectZOrder(element, container, "front")).toBeNull();
    expect(computeSlideObjectZOrder(element, container, "back")).toBeNull();
  });

  it("returns null when the object already sits in the requested position", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("already-front", { zIndex: 6 });
    const peer = createFreeformObject("peer", { zIndex: 5 });
    container.append(element, peer);

    expect(computeSlideObjectZOrder(element, container, "front")).toBeNull();
  });

  it("normalizes the whole stack instead of tying at zero when back has no room", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("send-to-back", { zIndex: 2 });
    const peerAtZero = createFreeformObject("peer-zero", { zIndex: 0 });
    const peerAtOne = createFreeformObject("peer-one", { zIndex: 1 });
    container.append(element, peerAtZero, peerAtOne);

    const change = computeSlideObjectZOrder(element, container, "back");

    expect(change?.value).toBe(0);
    expect(change?.shiftPeers).toEqual(
      expect.arrayContaining([
        { element: peerAtZero, value: 1 },
        { element: peerAtOne, value: 2 },
      ]),
    );
    expect(change?.shiftPeers).toHaveLength(2);
  });

  it("never produces a negative value even when a peer sits at -1", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("send-to-back", { zIndex: 3 });
    const background = createFreeformObject("background", { zIndex: -1 });
    const editablePeer = createFreeformObject("peer", { zIndex: 0 });
    container.append(element, background, editablePeer);

    const change = computeSlideObjectZOrder(element, container, "back");

    expect(change?.value).toBeGreaterThanOrEqual(0);
    for (const shift of change?.shiftPeers ?? []) {
      expect(shift.value).toBeGreaterThanOrEqual(0);
    }
    expect(change).toEqual({
      value: 0,
      shiftPeers: [{ element: editablePeer, value: 1 }],
    });
  });

  it("orders tied editable peers deterministically when sending an object back", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("send-to-back", { zIndex: 7 });
    const firstPeer = createFreeformObject("first-peer", { zIndex: 4 });
    const tiedPeer = createFreeformObject("tied-peer", { zIndex: 4 });
    const lastPeer = createFreeformObject("last-peer", { zIndex: 9 });
    container.append(element, firstPeer, tiedPeer, lastPeer);

    expect(computeSlideObjectZOrder(element, container, "back")).toEqual({
      value: 0,
      shiftPeers: [
        { element: firstPeer, value: 1 },
        { element: tiedPeer, value: 2 },
        { element: lastPeer, value: 3 },
      ],
    });
  });

  it("limits z-order peers to editable objects in the same context", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("target", { zIndex: 0 });
    const peer = createFreeformObject("peer", { zIndex: 2 });
    const inFlowObject = document.createElement("div");
    inFlowObject.dataset.slideObjectId = "in-flow";
    inFlowObject.style.zIndex = "99";
    const positionedGroup = document.createElement("div");
    positionedGroup.style.position = "relative";
    const nestedObject = createFreeformObject("nested", { zIndex: 99 });
    positionedGroup.append(nestedObject);
    const translucentGroup = document.createElement("div");
    translucentGroup.style.opacity = "0.5";
    const isolatedObject = createFreeformObject("isolated", { zIndex: 99 });
    translucentGroup.append(isolatedObject);
    container.append(
      element,
      peer,
      inFlowObject,
      positionedGroup,
      translucentGroup,
    );
    document.body.append(container);

    expect(computeSlideObjectZOrder(element, container, "front")).toEqual({
      value: 3,
      shiftPeers: [],
    });
  });

  it("excludes nested descendants from the peer set", () => {
    const container = document.createElement("div");
    const element = createFreeformObject("outer", { zIndex: 0 });
    const nested = createFreeformObject("nested", { zIndex: 9 });
    element.append(nested);
    const peer = createFreeformObject("peer", { zIndex: 1 });
    container.append(element, peer);

    expect(computeSlideObjectZOrder(element, container, "front")).toEqual({
      value: 2,
      shiftPeers: [],
    });
  });

  it("collects only absolutely positioned, uniquely identified objects", () => {
    const absoluteA = createFreeformObject("a", { left: 10, top: 20 });
    const absoluteB = createFreeformObject("b", { left: 30, top: 40 });
    const duplicateOfA = createFreeformObject("a", { left: 99, top: 99 });
    const inFlow = document.createElement("div");
    inFlow.dataset.slideObjectId = "in-flow";
    const noId = document.createElement("div");
    noId.style.position = "absolute";
    document.body.append(absoluteA, absoluteB, duplicateOfA, inFlow, noId);

    const members = collectMovableSlideObjects(
      [absoluteA, absoluteB, duplicateOfA, inFlow, noId],
      (element) => ({
        x: Number.parseFloat(element.style.left),
        y: Number.parseFloat(element.style.top),
        width: 100,
        height: 100,
      }),
    );

    expect(members.map((member) => member.objectId)).toEqual(["a", "b"]);
    expect(members[0].start).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("uses top-level selected roots for group moves and copying", () => {
    const parent = createFreeformObject("parent", { left: 10, top: 20 });
    const child = createFreeformObject("child", { left: 30, top: 40 });
    parent.append(child);

    const members = collectMovableSlideObjects([parent, child], (element) => ({
      x: Number.parseFloat(element.style.left),
      y: Number.parseFloat(element.style.top),
      width: 100,
      height: 100,
    }));
    const copied = copySlideObjects([parent, child]);

    expect(members.map((member) => member.objectId)).toEqual(["parent"]);
    expect(copied.html).toHaveLength(1);
    const pasted = buildPastedSlideObjects(copied, document);
    expect(pasted).toHaveLength(1);
    expect(pasted[0].querySelector("[data-slide-object-id]")).not.toBeNull();
  });

  it("moves every member by the same delta relative to its own captured start", () => {
    const objectA = createFreeformObject("a", { left: 10, top: 20 });
    const objectB = createFreeformObject("b", { left: 30, top: 40 });
    document.body.append(objectA, objectB);
    const applied = new Map<string, SlideObjectGeometry>();
    const members = collectMovableSlideObjects(
      [objectA, objectB],
      (element) => ({
        x: Number.parseFloat(element.style.left),
        y: Number.parseFloat(element.style.top),
        width: 50,
        height: 50,
      }),
    );

    const applyGeometry = (
      element: HTMLElement,
      geometry: SlideObjectGeometry,
    ) => {
      applied.set(element.dataset.slideObjectId as string, geometry);
    };

    applySlideObjectMoveDelta(members, 5, 5, applyGeometry);
    expect(applied.get("a")).toEqual({ x: 15, y: 25, width: 50, height: 50 });
    expect(applied.get("b")).toEqual({ x: 35, y: 45, width: 50, height: 50 });

    // A second call with a different delta must still measure from `start`,
    // not from wherever the previous call left things — no cumulative drift.
    applySlideObjectMoveDelta(members, 100, -10, applyGeometry);
    expect(applied.get("a")).toEqual({ x: 110, y: 10, width: 50, height: 50 });
    expect(applied.get("b")).toEqual({ x: 130, y: 30, width: 50, height: 50 });
  });

  it("strips transient builder ids when copying and remints ids when pasting", () => {
    const object = document.createElement("div");
    object.dataset.slideObjectId = "source-root";
    object.dataset.builderId = "b-1";
    object.id = "source-root";
    object.style.position = "absolute";
    object.style.left = "10px";
    object.style.top = "20px";
    object.innerHTML = `<label for="source-input">Label</label><input id="source-input" data-builder-id="b-2" data-slide-object-id="source-nested" />`;

    const copied = copySlideObjects([object]);
    expect(copied.html[0]).not.toContain("data-builder-id");

    const copiedTemplate = document.createElement("template");
    copiedTemplate.innerHTML = copied.html[0];
    const copiedRoot = copiedTemplate.content.firstElementChild as HTMLElement;
    const copiedInput = copiedRoot.querySelector("input")!;

    const [pasted] = buildPastedSlideObjects(copied, document);

    expect(pasted.dataset.slideObjectId).not.toBe("source-root");
    const nested = pasted.querySelector("[data-slide-object-id]");
    const input = pasted.querySelector("input")!;
    const label = pasted.querySelector("label")!;
    expect(nested?.getAttribute("data-slide-object-id")).not.toBe(
      "source-nested",
    );
    const pastedIds = [
      pasted.dataset.slideObjectId,
      nested?.getAttribute("data-slide-object-id"),
    ];
    expect(new Set(pastedIds)).toHaveLength(2);
    expect(
      pastedIds.some((id) => id === "source-root" || id === "source-nested"),
    ).toBe(false);
    expect(pasted.style.left).toBe(`${10 + SLIDE_OBJECT_PASTE_OFFSET}px`);
    expect(pasted.style.top).toBe(`${20 + SLIDE_OBJECT_PASTE_OFFSET}px`);
    expect(pasted.id).not.toBe("source-root");
    expect(input.id).not.toBe("source-input");
    expect(pasted.id).not.toBe(copiedRoot.id);
    expect(input.id).not.toBe(copiedInput.id);
    expect(label.getAttribute("for")).toBe(input.id);
  });

  it("leaves position untouched when a copied object has no inline left/top", () => {
    const object = document.createElement("div");
    object.dataset.slideObjectId = "no-position";

    const [pasted] = buildPastedSlideObjects(
      copySlideObjects([object]),
      document,
    );

    expect(pasted.style.left).toBe("");
    expect(pasted.style.top).toBe("");
  });
});

describe("isDeletableFlowImage", () => {
  it("accepts a plain image in flow layout", () => {
    const img = document.createElement("img");
    expect(isDeletableFlowImage(img)).toBe(true);
  });

  it("accepts an image placeholder box", () => {
    const placeholder = document.createElement("div");
    placeholder.className = "fmd-img-placeholder";
    expect(isDeletableFlowImage(placeholder)).toBe(true);
  });

  it("refuses ordinary flow containers so Delete cannot collapse a layout", () => {
    const card = document.createElement("div");
    card.className = "fmd-card";
    card.innerHTML = "<img src='x.png' /><p>Zamioculcas</p>";
    expect(isDeletableFlowImage(card)).toBe(false);
  });

  it("refuses text blocks", () => {
    const heading = document.createElement("h1");
    heading.textContent = "Low LIGHT";
    expect(isDeletableFlowImage(heading)).toBe(false);
  });
});

describe("findPersistedImageObject", () => {
  function importedSlide(): { root: HTMLElement; img: HTMLElement } {
    const root = document.createElement("div");
    root.className = "fmd-slide";
    root.innerHTML =
      '<div class="fmd-pptx-image" data-pptx-element-kind="image" ' +
      'data-slide-object-id="pdf-img-1-0" style="position:absolute">' +
      '<img src="plant.png" />' +
      "</div>";
    const img = root.querySelector("img") as HTMLElement;
    return { root, img };
  }

  it("returns the wrapper that carries the persisted object id", () => {
    const { root, img } = importedSlide();
    const owner = findPersistedImageObject(img, root);
    expect(owner?.getAttribute("data-slide-object-id")).toBe("pdf-img-1-0");
  });

  it("resolves an empty placeholder to the same wrapper", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-pptx-image" data-slide-object-id="pdf-img-2-0">' +
      '<div class="fmd-img-placeholder"></div>' +
      "</div>";
    const placeholder = root.querySelector(
      ".fmd-img-placeholder",
    ) as HTMLElement;
    expect(
      findPersistedImageObject(placeholder, root)?.getAttribute(
        "data-slide-object-id",
      ),
    ).toBe("pdf-img-2-0");
  });

  it("returns null for an ordinary flow image so only the image is removed", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="card"><img src="a.png" /><p>Label</p></div>';
    const img = root.querySelector("img") as HTMLElement;
    expect(findPersistedImageObject(img, root)).toBeNull();
  });

  it("does not escape past the slide root", () => {
    const outer = document.createElement("div");
    outer.className = "fmd-pptx-image";
    outer.setAttribute("data-slide-object-id", "outside");
    const root = document.createElement("div");
    outer.appendChild(root);
    const img = document.createElement("img");
    root.appendChild(img);
    expect(findPersistedImageObject(img, root)).toBeNull();
  });

  it("ignores a positioned container that is not an image wrapper", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-pptx-shape" data-pptx-element-kind="shape" ' +
      'data-slide-object-id="shape-1"><img src="a.png" /></div>';
    const img = root.querySelector("img") as HTMLElement;
    expect(findPersistedImageObject(img, root)).toBeNull();
  });
});
