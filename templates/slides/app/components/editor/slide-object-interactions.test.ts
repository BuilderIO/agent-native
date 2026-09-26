// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { sanitizeSlideHtml } from "@/lib/sanitize-slide-html";

import {
  alignSlideObjectMembers,
  applySlideObjectMoveDelta,
  arrangeSlideLayerInParent,
  buildPastedSlideObjects,
  canDropSlideLayerAdjacent,
  canDropSlideLayerInside,
  clientPointToSlideCoordinates,
  cloneSlideObject,
  collectMovableSlideObjects,
  computeSlideObjectZOrder,
  clampSlideObjectPlacementPosition,
  computeSlideObjectZOrderForSelection,
  createSlideLinePlacementGeometry,
  createSlideObjectPlacementGeometry,
  copySlideObjects,
  readSlideObjectClipboardId,
  slideObjectClipboardHtml,
  writeSlideObjectClipboard,
  createSlidesSelectionState,
  ensureSlideObjectId,
  ensureSlideTextBoxCanvas,
  findSlideObjectById,
  freezeSlideElementForFreeform,
  getSlideSelectionIdentity,
  getSlideSelectionMode,
  groupSlideObjects,
  findPersistedImageObject,
  isSlideObjectGroup,
  isAutoHeightTextResize,
  isValidSlideClipboardRoot,
  readSlideObjectSelectionFrame,
  resolveSlideClipboardElement,
  getSlideTextBoxDefaultColor,
  isDeletableFlowImage,
  isDeletableSlideElement,
  preserveSlideObjectLayoutSpacer,
  persistSlideObjectZOrderFromDom,
  removeSlideObjectAndLayoutSpacer,
  resolveSlideObjectContainingBlock,
  resolveSlideObjectGroupRoot,
  resolveSlideObjectInsertionContainingBlock,
  resolveSlideObjectMoveRoots,
  restoreSlideObjectStyle,
  resizeSlideObject,
  resizeSlideObjectMembers,
  resizeTransformedSlideObject,
  scaleSlideObjectGroupMembers,
  readSlideObjectRotation,
  readSlideObjectTransformSnapshot,
  resolveSlideObjectRotationDelta,
  rotateSlideObjectMembers,
  setSlideObjectRotation,
  keepAbsoluteDescendantsInPlace,
  releaseSlideObjectFromLeftBoxes,
  setSlideObjectDimension,
  snapSlideObjectMove,
  stripTransientSlideLayoutSpacers,
  ungroupSlideObject,
  SLIDE_OBJECT_PASTE_OFFSET,
  distributeSlideObjectMembers,
  type SlideObjectGeometry,
  type SlideObjectGroupResizeMember,
  type SlideObjectRotationMember,
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

function groupResizeMember(
  objectId: string,
  element: HTMLElement,
  start: SlideObjectGeometry,
): SlideObjectGroupResizeMember {
  return {
    objectId,
    element,
    start,
    ...readSlideObjectTransformSnapshot(element),
  };
}

function rotationMember(
  objectId: string,
  element: HTMLElement,
  start: SlideObjectGeometry,
  rotation: number,
): SlideObjectRotationMember {
  return {
    objectId,
    element,
    start,
    rotation,
    ...readSlideObjectTransformSnapshot(element),
  };
}

describe("slide object interactions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks layer clipboard HTML so native text and layer copies are exclusive", () => {
    const copied = {
      html: ['<div data-slide-object-id="layer-1">Layer</div>'],
    };
    const html = slideObjectClipboardHtml("copy-1", copied);

    expect(readSlideObjectClipboardId(html, document)).toBe("copy-1");
    expect(
      readSlideObjectClipboardId("<div>external text</div>", document),
    ).toBe(null);
  });

  it("writes readable text and a layer marker to the native clipboard", async () => {
    const write = vi.fn(async (_items: ClipboardItem[]) => undefined);
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);

    await writeSlideObjectClipboard(
      "copy-1",
      { html: ['<div data-slide-object-id="layer-1">Layer</div>'] },
      null,
    );

    const item = write.mock.calls[0]![0]![0] as unknown as FakeClipboardItem;
    expect(await item.items["text/plain"]?.text()).toBe("Layer");
    expect(await item.items["text/html"]?.text()).toContain(
      'data-agent-native-slide-object-clipboard="copy-1"',
    );
  });

  it("does not start a fallback write after rich clipboard rejection", async () => {
    const write = vi.fn(async () => {
      throw new Error("clipboard denied");
    });
    const writeText = vi.fn(async (_text: string) => undefined);
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);

    await expect(
      writeSlideObjectClipboard(
        "copy-1",
        { html: ['<div data-slide-object-id="layer-1">Layer</div>'] },
        null,
      ),
    ).rejects.toThrow("clipboard denied");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("preserves line breaks in plain-text clipboard content", async () => {
    const write = vi.fn(async (_items: ClipboardItem[]) => undefined);
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);

    await writeSlideObjectClipboard(
      "copy-1",
      {
        html: [
          '<div data-slide-object-id="layer-1">First<br>Second</div>',
          "<p>Third</p><p>Fourth</p><style>.hidden{display:none}</style><script>bad()</script><template>Hidden</template>",
        ],
      },
      null,
    );

    const item = write.mock.calls[0]![0]![0] as unknown as FakeClipboardItem;
    expect(await item.items["text/plain"]?.text()).toBe(
      "First\nSecond\nThird\nFourth",
    );
  });

  it("uses plain text when rich clipboard writing is unavailable", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("ClipboardItem", undefined);

    await expect(
      writeSlideObjectClipboard(
        "copy-1",
        { html: ['<div data-slide-object-id="layer-1">Layer</div>'] },
        null,
      ),
    ).resolves.toBe("text-only");
    expect(writeText).toHaveBeenCalledWith("Layer");
  });

  it("keeps the marker when the legacy copy event writes clipboard HTML", async () => {
    const written = new Map<string, string>();
    const originalExecCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    const execCommand = vi.fn(() => {
      const event = new Event("copy", { cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          setData: (type: string, value: string) => written.set(type, value),
        },
      });
      document.dispatchEvent(event);
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    try {
      await expect(
        writeSlideObjectClipboard(
          "copy-1",
          { html: ['<div data-slide-object-id="layer-1">Layer</div>'] },
          document,
        ),
      ).resolves.toBe("rich");
      expect(
        readSlideObjectClipboardId(written.get("text/html"), document),
      ).toBe("copy-1");
      expect(written.get("text/html")).toContain(
        "<div data-agent-native-slide-object-clipboard=",
      );
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, "execCommand", originalExecCommand);
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }
  });

  it("starts each asynchronous native clipboard write immediately", async () => {
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    const htmlWrites: Blob[] = [];
    const releases: Array<() => void> = [];
    const write = vi.fn((items: FakeClipboardItem[]) => {
      htmlWrites.push(items[0]!.items["text/html"]!);
      return new Promise<void>((resolve) => releases.push(resolve));
    });
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);

    const first = writeSlideObjectClipboard(
      "copy-1",
      { html: ['<div data-slide-object-id="layer-1">First</div>'] },
      null,
    );
    await Promise.resolve();
    const second = writeSlideObjectClipboard(
      "copy-2",
      { html: ['<div data-slide-object-id="layer-2">Second</div>'] },
      null,
    );
    await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(2);
    await expect(htmlWrites[0]!.text()).resolves.toContain(
      'data-agent-native-slide-object-clipboard="copy-1"',
    );
    await expect(htmlWrites[1]!.text()).resolves.toContain(
      'data-agent-native-slide-object-clipboard="copy-2"',
    );
    releases[1]!();
    releases[0]!();
    await expect(first).resolves.toBe("rich");
    await expect(second).resolves.toBe("rich");
    expect(htmlWrites).toHaveLength(2);
  });

  it("lets an explicit size override a generated text cap", () => {
    const heading = document.createElement("h2");
    heading.style.maxWidth = "420px";
    const plain = document.createElement("p");
    document.body.append(heading, plain);

    setSlideObjectDimension(heading, "width", "634px");
    setSlideObjectDimension(plain, "width", "200px");

    expect(heading.style.width).toBe("634px");
    expect(heading.style.maxWidth).toBe("none");
    expect(plain.style.maxWidth).toBe("");
    heading.remove();
    plain.remove();
  });

  it("keeps freed descendants in place when their old box becomes positioned", () => {
    const box = document.createElement("div");
    const freed = document.createElement("div");
    freed.style.position = "absolute";
    freed.style.left = "300px";
    freed.style.top = "200px";
    box.append(freed);
    document.body.append(box);
    let boxPositioned = false;
    freed.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: boxPositioned ? 380 : 300,
        y: boxPositioned ? 260 : 200,
        width: 100,
        height: 20,
      });

    keepAbsoluteDescendantsInPlace(box, () => {
      box.style.position = "absolute";
      boxPositioned = true;
    });

    expect(freed.style.left).toBe("220px");
    expect(freed.style.top).toBe("140px");
    box.remove();
  });

  it("shifts right/bottom-anchored descendants on their own sides and undoes on cancel", () => {
    const box = document.createElement("div");
    const badge = document.createElement("div");
    const originalStyle = "position:absolute;right:24px;bottom:16px;width:40px";
    badge.setAttribute("style", originalStyle);
    box.append(badge);
    document.body.append(box);
    let boxPositioned = false;
    badge.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: boxPositioned ? 580 : 500,
        y: boxPositioned ? 330 : 300,
        width: 40,
        height: 20,
      });

    const undo = keepAbsoluteDescendantsInPlace(box, () => {
      box.style.position = "absolute";
      boxPositioned = true;
    });

    expect(badge.style.right).toBe("104px");
    expect(badge.style.bottom).toBe("46px");
    expect(badge.style.left).toBe("");
    expect(badge.style.top).toBe("");
    undo();
    expect(badge.getAttribute("style")).toBe(originalStyle);
    box.remove();
  });

  it("keeps a descendant stretched between both insets the same size", () => {
    const box = document.createElement("div");
    const band = document.createElement("div");
    band.setAttribute("style", "position:absolute;left:10px;right:10px");
    box.append(band);
    document.body.append(box);
    let boxPositioned = false;
    band.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: boxPositioned ? 150 : 100,
        y: 50,
        width: boxPositioned ? 260 : 200,
        height: 20,
      });

    keepAbsoluteDescendantsInPlace(box, () => {
      box.style.position = "absolute";
      boxPositioned = true;
    });

    expect(band.style.left).toBe("-40px");
    expect(band.style.right).toBe("120px");
    box.remove();
  });

  it("detects insets anchored by a slide stylesheet rule", () => {
    const sheet = document.createElement("style");
    sheet.textContent =
      ".corner-badge { position: absolute; right: 24px; bottom: 16px; }";
    document.head.append(sheet);
    const box = document.createElement("div");
    const badge = document.createElement("div");
    badge.className = "corner-badge";
    box.append(badge);
    document.body.append(box);
    let boxPositioned = false;
    badge.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: boxPositioned ? 580 : 500,
        y: boxPositioned ? 330 : 300,
        width: 40,
        height: 20,
      });

    keepAbsoluteDescendantsInPlace(box, () => {
      box.style.position = "absolute";
      boxPositioned = true;
    });

    expect(badge.style.right).toBe("104px");
    expect(badge.style.bottom).toBe("46px");
    expect(badge.style.left).toBe("");
    expect(badge.style.position).toBe("");
    box.remove();
    sheet.remove();
  });

  it("re-homes an object dropped outside its box and closes the box's slot", () => {
    const layer = document.createElement("div");
    layer.innerHTML = `
      <div id="card">
        <div class="fmd-layout-spacer" data-slide-layout-spacer-for="text-id"></div>
        <div id="text" data-slide-object-id="text-id" style="position:absolute;left:40px;top:300px">Text</div>
      </div>
    `;
    document.body.append(layer);
    const card = layer.querySelector<HTMLElement>("#card")!;
    const text = layer.querySelector<HTMLElement>("#text")!;
    layer.getBoundingClientRect = () =>
      DOMRect.fromRect({ width: 960, height: 540 });
    card.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 40, y: 100, width: 800, height: 80 });
    text.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 40, y: 300, width: 200, height: 20 });

    expect(releaseSlideObjectFromLeftBoxes(text, layer)).toBe(true);
    expect(text.parentElement).toBe(layer);
    expect(layer.querySelector(".fmd-layout-spacer")).toBeNull();
    expect(text.style.left).toBe("40px");
    expect(text.style.top).toBe("300px");
    layer.remove();
  });

  it("keeps an object dropped inside its box as the box's child", () => {
    const layer = document.createElement("div");
    layer.innerHTML = `
      <div id="card">
        <div class="fmd-layout-spacer" data-slide-layout-spacer-for="text-id"></div>
        <div id="text" data-slide-object-id="text-id" style="position:absolute">Text</div>
      </div>
    `;
    document.body.append(layer);
    const card = layer.querySelector<HTMLElement>("#card")!;
    const text = layer.querySelector<HTMLElement>("#text")!;
    card.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 40, y: 100, width: 800, height: 80 });
    text.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 60, y: 120, width: 200, height: 20 });

    expect(releaseSlideObjectFromLeftBoxes(text, layer)).toBe(false);
    expect(text.parentElement).toBe(card);
    expect(layer.querySelector(".fmd-layout-spacer")).not.toBeNull();
    layer.remove();
  });

  it("lets explicit image sizing override image size caps", () => {
    const image = document.createElement("img");
    image.style.setProperty("height", "auto", "important");
    image.style.setProperty("max-height", "32px", "important");

    setSlideObjectDimension(image, "height", "64px");

    expect(image.style.getPropertyValue("height")).toBe("64px");
    expect(image.style.getPropertyPriority("height")).toBe("important");
    expect(image.style.getPropertyValue("max-height")).toBe("none");
    expect(image.style.getPropertyPriority("max-height")).toBe("important");
  });

  it("restores capped image styles after a canceled resize", () => {
    const image = document.createElement("img");
    const originalStyle =
      "position:absolute;width:260px;height:auto!important;max-width:260px!important;max-height:32px!important;";
    image.setAttribute("style", originalStyle);

    setSlideObjectDimension(image, "height", "64px");
    restoreSlideObjectStyle(image, originalStyle);

    expect(image.getAttribute("style")).toBe(originalStyle);
  });

  it("restores each capped image after a canceled group resize", () => {
    const images = [
      document.createElement("img"),
      document.createElement("img"),
    ];
    const originalStyles = images.map(
      (image, index) =>
        `position:absolute;left:${index * 40}px;width:260px;height:auto!important;max-height:32px!important;`,
    );
    images.forEach((image, index) =>
      image.setAttribute("style", originalStyles[index]),
    );

    for (const image of images) {
      setSlideObjectDimension(image, "height", "64px");
    }
    images.forEach((image, index) =>
      restoreSlideObjectStyle(image, originalStyles[index]),
    );

    expect(images.map((image) => image.getAttribute("style"))).toEqual(
      originalStyles,
    );
  });

  it("rejects nesting into void layer targets while keeping containers valid", () => {
    expect(canDropSlideLayerInside(document.createElement("img"))).toBe(false);
    expect(canDropSlideLayerInside(document.createElement("p"))).toBe(false);
    expect(canDropSlideLayerInside(document.createElement("h2"))).toBe(false);
    expect(canDropSlideLayerInside(document.createElement("div"))).toBe(true);
  });

  it("rejects nesting into rich-text layer targets", () => {
    const richText = document.createElement("div");
    richText.innerHTML = "<p>Heading</p><p>Body</p>";

    expect(canDropSlideLayerInside(richText)).toBe(false);
  });

  it("rejects adjacent drops that would violate structural parent rules", () => {
    const paragraph = document.createElement("p");
    const span = document.createElement("span");
    paragraph.append(span);
    expect(canDropSlideLayerAdjacent(document.createElement("div"), span)).toBe(
      false,
    );

    const list = document.createElement("ul");
    const listItem = document.createElement("li");
    list.append(listItem);
    expect(
      canDropSlideLayerAdjacent(document.createElement("div"), listItem),
    ).toBe(false);
    expect(
      canDropSlideLayerAdjacent(document.createElement("li"), listItem),
    ).toBe(true);
  });

  it("rejects structural children as direct clipboard roots", () => {
    expect(isValidSlideClipboardRoot(document.createElement("li"))).toBe(false);
    expect(isValidSlideClipboardRoot(document.createElement("td"))).toBe(false);
    expect(isValidSlideClipboardRoot(document.createElement("div"))).toBe(true);
  });

  it("resizes multi-selection members proportionally from the southeast", () => {
    const result = resizeSlideObjectMembers(
      [
        {
          objectId: "a",
          element: document.createElement("div"),
          start: { x: 10, y: 20, width: 20, height: 20 },
        },
        {
          objectId: "b",
          element: document.createElement("div"),
          start: { x: 50, y: 50, width: 20, height: 20 },
        },
      ],
      { handle: "se", dx: 30, dy: 20 },
    );

    expect(result.get("a")).toEqual({ x: 10, y: 20, width: 30, height: 28 });
    expect(result.get("b")).toEqual({ x: 70, y: 62, width: 30, height: 28 });
  });

  it("resizes a rotated object in its local axes and holds the opposite edge", () => {
    const geometry = resizeTransformedSlideObject(
      { x: 100, y: 80, width: 100, height: 50 },
      {
        transform: "matrix(0, 1, -1, 0, 0, 0)",
        transformOrigin: "50% 50%",
      },
      {
        handle: "n",
        dx: 20,
        dy: 0,
        preserveAspectRatio: false,
      },
    );

    expect(geometry).toEqual({ x: 110, y: 70, width: 100, height: 70 });
  });

  it("preserves an explicitly fixed transform origin while resizing", () => {
    const geometry = resizeTransformedSlideObject(
      { x: 100, y: 80, width: 100, height: 50 },
      {
        transform: "matrix(0, 1, -1, 0, 0, 0)",
        transformOrigin: "50px 25px",
      },
      {
        handle: "n",
        dx: 20,
        dy: 0,
        preserveAspectRatio: false,
      },
    );

    expect(geometry).toEqual({ x: 120, y: 80, width: 100, height: 70 });
  });

  it("keeps a computed centered transform origin relative to the resized box", () => {
    const element = createFreeformObject("computed-origin");
    Object.defineProperty(element, "offsetWidth", { value: 100 });
    Object.defineProperty(element, "offsetHeight", { value: 50 });
    const getComputedStyle = window.getComputedStyle;
    const mock = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((target, pseudoElement) =>
        target === element
          ? ({
              transform: "matrix(0, 1, -1, 0, 0, 0)",
              transformOrigin: "50px 25px",
            } as CSSStyleDeclaration)
          : getComputedStyle.call(window, target, pseudoElement),
      );

    try {
      expect(readSlideObjectTransformSnapshot(element)).toEqual({
        transform: "matrix(0, 1, -1, 0, 0, 0)",
        transformOrigin: "50% 50%",
      });
    } finally {
      mock.mockRestore();
    }
  });

  it("measures selection handles in the rotated object's local frame", () => {
    const element = createFreeformObject("rotated");
    element.style.width = "100px";
    element.style.height = "50px";
    element.style.transform = "matrix(0, 1, -1, 0, 0, 0)";
    element.style.transformOrigin = "50% 50%";
    Object.defineProperty(element, "offsetWidth", { value: 100 });
    Object.defineProperty(element, "offsetHeight", { value: 50 });

    const frame = readSlideObjectSelectionFrame(element, {
      left: 200,
      top: 100,
      width: 50,
      height: 100,
    } as DOMRect);

    expect(frame).toEqual({
      left: 175,
      top: 125,
      width: 100,
      height: 50,
      transform: "matrix(0, 1, -1, 0, 0, 0)",
      transformOrigin: { x: 50, y: 25 },
    });
  });

  it("scales each grouped descendant in its own parent coordinate space", () => {
    const first = createFreeformObject("first");
    const nestedGroup = createFreeformObject("nested-group");
    const nestedChild = createFreeformObject("nested-child");
    const plan = scaleSlideObjectGroupMembers(
      [
        groupResizeMember("first", first, {
          x: 10,
          y: 20,
          width: 40,
          height: 30,
        }),
        groupResizeMember("nested-group", nestedGroup, {
          x: 60,
          y: 50,
          width: 40,
          height: 40,
        }),
        groupResizeMember("nested-child", nestedChild, {
          x: 10,
          y: 15,
          width: 20,
          height: 20,
        }),
      ],
      { width: 100, height: 100 },
      { width: 200, height: 50 },
    );

    expect(plan.get(first)?.geometry).toEqual({
      x: 20,
      y: 10,
      width: 80,
      height: 15,
    });
    expect(plan.get(nestedGroup)?.geometry).toEqual({
      x: 120,
      y: 25,
      width: 80,
      height: 20,
    });
    expect(plan.get(nestedChild)?.geometry).toEqual({
      x: 20,
      y: 7.5,
      width: 40,
      height: 10,
    });
  });

  it("scales grouped member transforms with the parent resize", () => {
    const member = createFreeformObject("member");
    const plan = scaleSlideObjectGroupMembers(
      [
        {
          objectId: "member",
          element: member,
          start: { x: 20, y: 30, width: 40, height: 20 },
          transform: "matrix(0.8, 0.6, -0.6, 0.8, 10, -8)",
          transformOrigin: "25% 75%",
        },
      ],
      { width: 100, height: 100 },
      { width: 200, height: 50 },
    );

    expect(plan.get(member)).toEqual({
      geometry: { x: 40, y: 15, width: 80, height: 10 },
      transform: "matrix(0.8, 0.15, -2.4, 0.8, 20, -4)",
      transformOrigin: "20px 7.5px",
    });
  });

  it("keeps descendants anchored during west and north group resizes", () => {
    const member = createFreeformObject("member");
    const groupStart = { x: 100, y: 80, width: 100, height: 60 };
    const fixedEast = groupStart.x + groupStart.width;
    const fixedSouth = groupStart.y + groupStart.height;
    const originalMemberLeft = groupStart.x + 20;
    const originalMemberTop = groupStart.y + 10;

    for (const resize of [
      { handle: "w" as const, dx: -60, dy: 0 },
      { handle: "n" as const, dx: 0, dy: -60 },
      { handle: "nw" as const, dx: -60, dy: -60 },
    ]) {
      const groupEnd = resizeSlideObject(groupStart, {
        ...resize,
        preserveAspectRatio: false,
      });
      const plan = scaleSlideObjectGroupMembers(
        [
          groupResizeMember("member", member, {
            x: 20,
            y: 10,
            width: 30,
            height: 20,
          }),
        ],
        groupStart,
        groupEnd,
      );
      const memberGeometry = plan.get(member)!;
      const scaleX = groupEnd.width / groupStart.width;
      const scaleY = groupEnd.height / groupStart.height;

      expect({
        x: groupEnd.x + memberGeometry.geometry.x,
        y: groupEnd.y + memberGeometry.geometry.y,
      }).toEqual({
        x: fixedEast - (fixedEast - originalMemberLeft) * scaleX,
        y: fixedSouth - (fixedSouth - originalMemberTop) * scaleY,
      });
    }
  });

  it("resizes multi-selection members from the west and honors minimum bounds", () => {
    const result = resizeSlideObjectMembers(
      [
        {
          objectId: "a",
          element: document.createElement("div"),
          start: { x: 10, y: 20, width: 20, height: 30 },
        },
      ],
      { handle: "w", dx: 100, dy: 0, minSize: 24 },
    );

    expect(result.get("a")).toEqual({ x: 6, y: 20, width: 24, height: 30 });
  });

  it("keeps every non-uniform member above the minimum while preserving placement", () => {
    const result = resizeSlideObjectMembers(
      [
        {
          objectId: "small",
          element: document.createElement("div"),
          start: { x: 10, y: 20, width: 20, height: 30 },
        },
        {
          objectId: "large",
          element: document.createElement("div"),
          start: { x: 50, y: 60, width: 100, height: 80 },
        },
      ],
      { handle: "se", dx: -90, dy: -70, minSize: 24 },
    );

    expect(result.get("small")).toEqual({
      x: 10,
      y: 20,
      width: 24,
      height: 24,
    });
    expect(result.get("large")).toEqual({
      x: 58,
      y: 52,
      width: 120,
      height: 64,
    });
  });

  it("keeps the minimum member size while preserving aspect-locked scaling", () => {
    const result = resizeSlideObjectMembers(
      [
        {
          objectId: "wide",
          element: document.createElement("div"),
          start: { x: 10, y: 20, width: 20, height: 40 },
        },
        {
          objectId: "square",
          element: document.createElement("div"),
          start: { x: 50, y: 60, width: 40, height: 40 },
        },
      ],
      { handle: "se", dx: -80, dy: -80, preserveAspectRatio: true },
    );

    expect(result.get("wide")).toEqual({
      x: 10,
      y: 20,
      width: 24,
      height: 48,
    });
    expect(result.get("square")).toEqual({
      x: 58,
      y: 68,
      width: 48,
      height: 48,
    });
  });

  it("normalizes drag placement from either direction with a minimum size", () => {
    expect(
      createSlideObjectPlacementGeometry({ x: 160, y: 120 }, { x: 40, y: 30 }),
    ).toEqual({ x: 40, y: 30, width: 120, height: 90 });
    expect(
      createSlideObjectPlacementGeometry({ x: 10, y: 20 }, { x: 10, y: 20 }),
    ).toEqual({ x: 10, y: 20, width: 24, height: 24 });
  });

  it("builds a rotated bar spanning the drag start and end points for a line", () => {
    const geometry = createSlideLinePlacementGeometry(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    );
    expect(geometry).toEqual({
      x: 0,
      y: -2,
      width: 100,
      height: 4,
      rotation: 0,
    });
  });

  it("computes the drag angle so a diagonal line is not axis-aligned", () => {
    const start = { x: 100, y: 100 };
    const end = { x: 300, y: 250 };
    const geometry = createSlideLinePlacementGeometry(start, end);

    expect(geometry.width).toBeCloseTo(Math.hypot(200, 150), 5);
    expect(geometry.height).toBe(4);
    expect(geometry.rotation).toBeCloseTo(
      (Math.atan2(150, 200) * 180) / Math.PI,
      5,
    );

    const reversed = createSlideLinePlacementGeometry(end, start);
    expect(reversed.width).toBeCloseTo(geometry.width, 5);
    const angleDelta =
      ((reversed.rotation - geometry.rotation + 540) % 360) - 180;
    expect(Math.abs(angleDelta)).toBeCloseTo(180, 5);
  });

  it("keeps a minimum thickness even for a zero-length drag", () => {
    const geometry = createSlideLinePlacementGeometry(
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      6,
    );
    expect(geometry.width).toBe(6);
    expect(geometry.height).toBe(6);
  });

  it("clamps an unrotated shape identically to the old plain bounding-box clamp", () => {
    expect(
      clampSlideObjectPlacementPosition(
        { x: -50, y: 10, width: 80, height: 40 },
        300,
        200,
      ),
    ).toEqual({ x: 0, y: 10 });
    expect(
      clampSlideObjectPlacementPosition(
        { x: 250, y: 10, width: 80, height: 40 },
        300,
        200,
      ),
    ).toEqual({ x: 220, y: 10 });
  });

  it("clamps a rotated line by its rendered footprint, not its unrotated bar length", () => {
    const start = { x: 10, y: 0 };
    const end = { x: 30, y: 250 };
    const geometry = createSlideLinePlacementGeometry(start, end);

    const clamped = clampSlideObjectPlacementPosition(
      geometry,
      300,
      300,
      geometry.rotation,
    );

    const renderedCenterX = clamped.x + geometry.width / 2;
    expect(renderedCenterX).toBeCloseTo((start.x + end.x) / 2, 5);
  });

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

  it("uses the positioned slide when its inner autofit layer is static", () => {
    const slide = document.createElement("div");
    const layer = document.createElement("div");
    const layoutGroup = document.createElement("div");
    const text = document.createElement("p");
    slide.className = "fmd-slide";
    slide.style.position = "relative";
    layer.setAttribute("data-fmd-autofit-content", "true");
    layoutGroup.append(text);
    layer.append(layoutGroup);
    slide.append(layer);
    document.body.append(slide);

    expect(resolveSlideObjectContainingBlock(text, layer)).toBe(slide);
  });

  it("uses the actual CSS containing block when inserting into a static autofit layer", () => {
    const slide = document.createElement("div");
    const layer = document.createElement("div");
    slide.className = "fmd-slide";
    slide.style.position = "relative";
    slide.style.padding = "78px 106px";
    layer.setAttribute("data-fmd-autofit-content", "true");
    slide.append(layer);
    document.body.append(slide);

    expect(resolveSlideObjectInsertionContainingBlock(layer)).toBe(slide);

    const object = document.createElement("div");
    object.style.position = "absolute";
    layer.append(object);
    expect(resolveSlideObjectContainingBlock(object, layer)).toBe(slide);
  });

  it("uses an active autofit transform as the insertion containing block", () => {
    const slide = document.createElement("div");
    const layer = document.createElement("div");
    slide.className = "fmd-slide";
    slide.style.position = "relative";
    layer.setAttribute("data-fmd-autofit-content", "true");
    layer.style.transform = "scale(0.9)";
    slide.append(layer);
    document.body.append(slide);

    expect(resolveSlideObjectInsertionContainingBlock(layer)).toBe(layer);
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

  it("uses Shift aspect locking for corners and midpoint handles", () => {
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
    ).toEqual({ x: 130, y: 57.5, width: 170, height: 85 });
  });

  it("keeps height auto only for a width-only drag on a text object", () => {
    const textBox = document.createElement("div");
    textBox.className = "fmd-text-box";
    textBox.textContent = "Some text";

    const shape = document.createElement("div");
    shape.setAttribute("data-slide-shape", "rectangle");

    for (const handle of ["e", "w"] as const) {
      expect(isAutoHeightTextResize(textBox, handle, false)).toBe(true);
      expect(isAutoHeightTextResize(textBox, handle, true)).toBe(false);
      expect(isAutoHeightTextResize(shape, handle, false)).toBe(false);
    }

    for (const handle of ["nw", "ne", "sw", "se", "n", "s"] as const) {
      expect(isAutoHeightTextResize(textBox, handle, false)).toBe(false);
    }
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

  it("does not copy imported PPTX metadata onto a layout spacer", () => {
    const parent = document.createElement("div");
    const shape = document.createElement("div");
    shape.className = "fmd-pptx-shape";
    shape.setAttribute("data-pptx-element-kind", "shape");
    shape.setAttribute("data-pptx-image-name", "not-an-image");
    parent.append(shape);

    const spacer = freezeSlideElementForFreeform(
      shape,
      { x: 0, y: 0, width: 120, height: 80 },
      {
        display: "block",
        flexGrow: "0",
        flexShrink: "1",
        flexBasis: "auto",
        alignSelf: "auto",
      },
    );

    expect(spacer.classList.contains("fmd-pptx-shape")).toBe(false);
    expect(spacer.hasAttribute("data-pptx-element-kind")).toBe(false);
    expect(spacer.hasAttribute("data-pptx-image-name")).toBe(false);
  });

  it("keeps a committed flow slot through serialization cleanup", () => {
    const root = document.createElement("div");
    const rectangle = document.createElement("div");
    root.append(rectangle);

    freezeSlideElementForFreeform(
      rectangle,
      { x: 0, y: 0, width: 120, height: 80 },
      {
        display: "block",
        flexGrow: "0",
        flexShrink: "1",
        flexBasis: "auto",
        alignSelf: "auto",
      },
    );
    preserveSlideObjectLayoutSpacer(rectangle);

    const serializedRoot = root.cloneNode(true) as HTMLElement;
    stripTransientSlideLayoutSpacers(serializedRoot);
    const persisted = sanitizeSlideHtml(serializedRoot.innerHTML);
    const persistedRoot = document.createElement("div");
    persistedRoot.innerHTML = persisted;

    expect(
      persistedRoot.querySelector(
        '.fmd-layout-spacer[data-slide-layout-preserved="true"]',
      ),
    ).toBeTruthy();
    expect(
      persistedRoot.querySelector(
        `[data-slide-layout-spacer-for="${rectangle.dataset.slideObjectId}"]`,
      ),
    ).toBeTruthy();
  });

  it("removes a committed flow object's preserved slot with the object", () => {
    const root = document.createElement("div");
    const rectangle = document.createElement("div");
    root.append(rectangle);

    freezeSlideElementForFreeform(
      rectangle,
      { x: 0, y: 0, width: 120, height: 80 },
      {
        display: "block",
        flexGrow: "0",
        flexShrink: "1",
        flexBasis: "auto",
        alignSelf: "auto",
      },
    );
    preserveSlideObjectLayoutSpacer(rectangle);

    removeSlideObjectAndLayoutSpacer(rectangle);

    expect(root.children).toHaveLength(0);
  });

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

  it("persists the DOM order of a moved freeform stack", () => {
    const container = document.createElement("div");
    const source = createFreeformObject("source", { zIndex: 0 });
    const peer = createFreeformObject("peer", { zIndex: 1 });
    container.append(peer, source);

    expect(persistSlideObjectZOrderFromDom(source, container)).toBe(true);
    expect(peer.style.zIndex).toBe("0");
    expect(source.style.zIndex).toBe("1");
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

  it("computes one-step freeform z-order changes while preserving peer order", () => {
    const container = document.createElement("div");
    const first = createFreeformObject("first", { zIndex: 0 });
    const second = createFreeformObject("second", { zIndex: 1 });
    const third = createFreeformObject("third", { zIndex: 2 });
    container.append(first, second, third);
    document.body.append(container);

    expect(computeSlideObjectZOrder(second, container, "forward")).toEqual({
      value: 2,
      shiftPeers: [{ element: third, value: 1 }],
    });
    expect(computeSlideObjectZOrder(second, container, "backward")).toEqual({
      value: 0,
      shiftPeers: [{ element: first, value: 1 }],
    });
  });

  it("moves multi-selected layers together while preserving their relative order", () => {
    const container = document.createElement("div");
    const first = createFreeformObject("first", { zIndex: 0 });
    const middle = createFreeformObject("middle", { zIndex: 1 });
    const last = createFreeformObject("last", { zIndex: 2 });
    container.append(first, middle, last);
    document.body.append(container);

    expect(
      computeSlideObjectZOrderForSelection([first, last], container, "forward"),
    ).toEqual(
      new Map([
        [first, 1],
        [middle, 0],
      ]),
    );
    expect(
      computeSlideObjectZOrderForSelection([first, last], container, "back"),
    ).toEqual(
      new Map([
        [last, 1],
        [middle, 2],
      ]),
    );
  });

  it("moves contiguous multi-selections one layer past the adjacent peer", () => {
    const container = document.createElement("div");
    const first = createFreeformObject("first", { zIndex: 0 });
    const second = createFreeformObject("second", { zIndex: 1 });
    const third = createFreeformObject("third", { zIndex: 2 });
    const fourth = createFreeformObject("fourth", { zIndex: 3 });
    container.append(first, second, third, fourth);
    document.body.append(container);

    expect(
      computeSlideObjectZOrderForSelection(
        [first, second],
        container,
        "forward",
      ),
    ).toEqual(
      new Map([
        [first, 1],
        [second, 2],
        [third, 0],
      ]),
    );
    expect(
      computeSlideObjectZOrderForSelection(
        [third, fourth],
        container,
        "backward",
      ),
    ).toEqual(
      new Map([
        [third, 1],
        [fourth, 2],
        [second, 3],
      ]),
    );
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

  it("moves a bordered container when all of its selectable leaves are selected", () => {
    const slideContent = document.createElement("div");
    const card = document.createElement("div");
    card.style.borderTop = "2px solid";
    const label = document.createElement("div");
    label.dataset.builderId = "label";
    const copy = document.createElement("div");
    copy.dataset.builderId = "copy";
    card.append(label, copy);
    slideContent.append(card);

    expect(
      resolveSlideObjectMoveRoots(
        [label, copy],
        new Set(["label", "copy"]),
        slideContent,
      ),
    ).toEqual([card]);
    expect(
      resolveSlideObjectMoveRoots([label], new Set(["label"]), slideContent),
    ).toEqual([label]);
  });

  it("does not promote a bordered flow card with positioned descendants", () => {
    const slideContent = document.createElement("div");
    const card = document.createElement("div");
    card.style.borderLeft = "2px solid";
    const label = document.createElement("div");
    label.dataset.builderId = "label";
    const positioned = document.createElement("div");
    positioned.dataset.builderId = "positioned";
    positioned.style.position = "absolute";
    card.append(label, positioned);
    slideContent.append(card);

    expect(
      resolveSlideObjectMoveRoots(
        [label, positioned],
        new Set(["label", "positioned"]),
        slideContent,
      ),
    ).toEqual([label, positioned]);
  });

  it("promotes the highest fully-selected bordered card", () => {
    const slideContent = document.createElement("div");
    const outerCard = document.createElement("div");
    outerCard.style.borderBottom = "2px solid";
    const innerCard = document.createElement("div");
    innerCard.style.borderRight = "2px solid";
    const label = document.createElement("div");
    label.dataset.builderId = "label";
    const copy = document.createElement("div");
    copy.dataset.builderId = "copy";
    innerCard.append(label, copy);
    outerCard.append(innerCard);
    slideContent.append(outerCard);

    expect(
      resolveSlideObjectMoveRoots(
        [label, copy],
        new Set(["label", "copy"]),
        slideContent,
      ),
    ).toEqual([outerCard]);
  });

  it("does not promote a bordered flow card with fixed descendants", () => {
    const slideContent = document.createElement("div");
    const card = document.createElement("div");
    card.style.borderTop = "2px solid";
    const label = document.createElement("div");
    label.dataset.builderId = "label";
    const fixed = document.createElement("div");
    fixed.dataset.builderId = "fixed";
    fixed.style.position = "fixed";
    card.append(label, fixed);
    slideContent.append(card);

    expect(
      resolveSlideObjectMoveRoots(
        [label, fixed],
        new Set(["label", "fixed"]),
        slideContent,
      ),
    ).toEqual([label, fixed]);
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

    applySlideObjectMoveDelta(members, 100, -10, applyGeometry);
    expect(applied.get("a")).toEqual({ x: 110, y: 10, width: 50, height: 50 });
    expect(applied.get("b")).toEqual({ x: 130, y: 30, width: 50, height: 50 });
  });

  it("snaps object edges and centers to nearby peer anchors and returns guides", () => {
    const result = snapSlideObjectMove({
      moving: { x: 100, y: 160, width: 80, height: 40 },
      deltaX: 17,
      deltaY: 0,
      peers: [{ x: 200, y: 50, width: 120, height: 80 }],
      canvas: { width: 1280, height: 720 },
    });

    expect(result.deltaX).toBe(20);
    expect(result.deltaY).toBe(0);
    expect(result.guides).toContainEqual({
      orientation: "vertical",
      position: 200,
      start: 0,
      end: 720,
    });
  });

  it("snaps both axes to slide anchors, ignores distant targets, and bypasses with Cmd/Ctrl", () => {
    const snapped = snapSlideObjectMove({
      moving: { x: 4, y: 3, width: 80, height: 40 },
      deltaX: -4,
      deltaY: -3,
      peers: [{ x: 500, y: 500, width: 40, height: 40 }],
      canvas: { width: 1280, height: 720 },
    });
    expect(snapped.deltaX).toBe(-4);
    expect(snapped.deltaY).toBe(-3);
    expect(snapped.guides).toHaveLength(2);

    const bypassed = snapSlideObjectMove({
      moving: { x: 4, y: 3, width: 80, height: 40 },
      deltaX: -4,
      deltaY: -3,
      peers: [],
      canvas: { width: 1280, height: 720 },
      bypass: true,
    });
    expect(bypassed).toEqual({ deltaX: -4, deltaY: -3, guides: [] });
  });

  it("aligns selected members to their shared bounds without changing size", () => {
    const members = [
      {
        objectId: "a",
        element: document.createElement("div"),
        start: { x: 10, y: 20, width: 50, height: 40 },
      },
      {
        objectId: "b",
        element: document.createElement("div"),
        start: { x: 110, y: 80, width: 30, height: 60 },
      },
    ];

    const centered = alignSlideObjectMembers(members, "center");
    expect(centered.get("a")).toEqual({
      x: 50,
      y: 20,
      width: 50,
      height: 40,
    });
    expect(centered.get("b")).toEqual({
      x: 60,
      y: 80,
      width: 30,
      height: 60,
    });
    expect(alignSlideObjectMembers(members, "bottom").get("a")).toEqual({
      x: 10,
      y: 100,
      width: 50,
      height: 40,
    });
  });

  it("distributes three or more selected members with equal edge gaps", () => {
    const members = [
      {
        objectId: "a",
        element: document.createElement("div"),
        start: { x: 0, y: 20, width: 40, height: 20 },
      },
      {
        objectId: "b",
        element: document.createElement("div"),
        start: { x: 80, y: 80, width: 20, height: 30 },
      },
      {
        objectId: "c",
        element: document.createElement("div"),
        start: { x: 200, y: 140, width: 40, height: 20 },
      },
    ];

    const plan = distributeSlideObjectMembers(members, "horizontal");
    expect(plan.get("a")?.x).toBe(0);
    expect(plan.get("b")?.x).toBe(110);
    expect(plan.get("c")?.x).toBe(200);
    expect(
      distributeSlideObjectMembers(members.slice(0, 2), "vertical"),
    ).toEqual(new Map());
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

  it("does not copy list or table children without their structural parent", () => {
    const listItem = document.createElement("li");
    listItem.dataset.slideObjectId = "list-item";

    expect(copySlideObjects([listItem]).html).toEqual([]);
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

  it("does not classify ordinary flow containers as images", () => {
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

describe("isDeletableSlideElement", () => {
  it("accepts an AI-generated flow div", () => {
    const rectangle = document.createElement("div");
    rectangle.className = "generated-rectangle";
    rectangle.dataset.builderId = "b-generated";
    rectangle.textContent = "Generated content";

    expect(isDeletableSlideElement(rectangle)).toBe(true);
  });

  it("removes the selected flow div without touching its sibling", () => {
    const root = document.createElement("div");
    const rectangle = document.createElement("div");
    rectangle.className = "generated-rectangle";
    rectangle.dataset.builderId = "b-generated";
    const sibling = document.createElement("p");
    sibling.textContent = "Keep this content";
    root.append(rectangle, sibling);

    removeSlideObjectAndLayoutSpacer(rectangle);

    expect(root.contains(rectangle)).toBe(false);
    expect(root.contains(sibling)).toBe(true);
  });

  it("preserves a deleted flow element's layout slot when requested", () => {
    const root = document.createElement("div");
    const rectangle = document.createElement("div");
    const sibling = document.createElement("div");
    Object.defineProperties(rectangle, {
      offsetWidth: { configurable: true, value: 420 },
      offsetHeight: { configurable: true, value: 96 },
    });
    root.append(rectangle, sibling);

    removeSlideObjectAndLayoutSpacer(rectangle, { preserveLayoutSlot: true });

    const spacer = root.firstElementChild as HTMLElement;
    expect(root.contains(rectangle)).toBe(false);
    expect(root.contains(sibling)).toBe(true);
    expect(spacer.classList.contains("fmd-layout-spacer")).toBe(true);
    expect(spacer.dataset.slideLayoutPreserved).toBe("true");
    expect(spacer.dataset.slideLayoutSpacerFor).toBe(
      rectangle.dataset.slideObjectId,
    );
    expect(spacer.style.width).toBe("420px");
    expect(spacer.style.height).toBe("96px");
  });

  it("keeps renderer shells and layout spacers protected", () => {
    const shell = document.createElement("div");
    shell.className = "fmd-slide";
    const autofit = document.createElement("div");
    autofit.className = "fmd-autofit-scale";
    const contentLayer = document.createElement("div");
    contentLayer.setAttribute("data-fmd-autofit-content", "true");
    const canvas = document.createElement("div");
    canvas.setAttribute("data-slide-canvas", "slide-1");
    const spacer = document.createElement("div");
    spacer.className = "fmd-layout-spacer";

    for (const element of [shell, autofit, contentLayer, canvas, spacer]) {
      expect(isDeletableSlideElement(element)).toBe(false);
    }
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

describe("resolveSlideClipboardElement", () => {
  it("uses the persisted image owner for a single overlay selection", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-pptx-image" data-slide-object-id="image-owner">' +
      '<img src="image.png" />' +
      "</div>";
    const img = root.querySelector("img") as HTMLImageElement;
    const staleSelection = document.createElement("div");

    expect(resolveSlideClipboardElement(staleSelection, img, root)).toBe(
      root.firstElementChild,
    );
  });

  it("resolves an image overlay to its object in traversal order", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-builder-id="first" data-slide-object-id="first"></div>' +
      '<div class="fmd-pptx-image" data-builder-id="image-owner" ' +
      'data-slide-object-id="image-owner"><img src="image.png" /></div>' +
      '<div data-builder-id="last" data-slide-object-id="last"></div>';
    const image = root.querySelector("img") as HTMLImageElement;
    const traversalOrder = Array.from(root.children);
    const selected = resolveSlideClipboardElement(null, image, root);

    expect(traversalOrder.indexOf(selected!)).toBe(1);
  });

  it("keeps the normal selected element when no image overlay is active", () => {
    const root = document.createElement("div");
    const selected = document.createElement("div");

    expect(resolveSlideClipboardElement(selected, null, root)).toBe(selected);
  });
});

describe("arrangeSlideLayerInParent", () => {
  function mountSlide(inner: string): HTMLElement {
    document.body.innerHTML = `
      <div data-slide-canvas="s1">
        <div class="slide-content">
          <div class="fmd-slide" style="position:relative;display:flex;flex-direction:column">${inner}</div>
        </div>
      </div>`;
    return document.querySelector(".fmd-slide") as HTMLElement;
  }

  const zOf = (element: HTMLElement) => element.style.zIndex;

  it("raises a flow layer above its siblings instead of moving it down the column", () => {
    const slide = mountSlide(
      `<h1 id="a">Title</h1><p id="b">One</p><p id="c">Two</p>`,
    );
    const a = slide.querySelector<HTMLElement>("#a")!;

    expect(arrangeSlideLayerInParent(a, "front")).toBe(true);
    expect(Array.from(slide.children).map((n) => n.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(Number(zOf(a))).toBeGreaterThan(0);
  });

  it("sends a text layer behind an image that carries no explicit z-index", () => {
    const slide = mountSlide(
      `<img id="img" data-slide-object-id="i1" style="position:absolute;left:0;top:0" />
       <h1 id="a">Overlay title</h1>`,
    );
    const a = slide.querySelector<HTMLElement>("#a")!;
    const img = slide.querySelector<HTMLElement>("#img")!;

    expect(arrangeSlideLayerInParent(a, "back")).toBe(true);
    expect(Number(zOf(a))).toBeLessThan(Number(zOf(img)));
  });

  it("keeps a sole layer reporting no change rather than silently reordering", () => {
    const slide = mountSlide(`<div id="wrap"><h1>Title</h1></div>`);
    const wrap = slide.querySelector<HTMLElement>("#wrap")!;

    expect(arrangeSlideLayerInParent(wrap, "front")).toBe(false);
    expect(arrangeSlideLayerInParent(wrap, "back")).toBe(false);
  });

  it("reports no change once the layer already sits at that end", () => {
    const slide = mountSlide(`<h1 id="a">Title</h1><p id="b">One</p>`);
    const a = slide.querySelector<HTMLElement>("#a")!;

    expect(arrangeSlideLayerInParent(a, "front")).toBe(true);
    expect(arrangeSlideLayerInParent(a, "front")).toBe(false);
  });

  it("round-trips front and back across repeated presses", () => {
    const slide = mountSlide(
      `<div id="a">A</div><div id="b">B</div><div id="c">C</div>`,
    );
    const a = slide.querySelector<HTMLElement>("#a")!;
    const b = slide.querySelector<HTMLElement>("#b")!;

    arrangeSlideLayerInParent(a, "front");
    expect(Number(zOf(a))).toBeGreaterThan(Number(zOf(b) || 0));

    arrangeSlideLayerInParent(a, "back");
    expect(Number(zOf(a))).toBeLessThan(Number(zOf(b)));

    arrangeSlideLayerInParent(b, "back");
    expect(Number(zOf(b))).toBeLessThan(Number(zOf(a)));
  });

  it("promotes a static layer so the index it is handed is not inert", () => {
    document.body.innerHTML = `
      <div data-slide-canvas="s1"><div class="slide-content">
        <div class="fmd-slide" style="position:relative;display:block">
          <div id="a">A</div><div id="b">B</div>
        </div>
      </div></div>`;
    const a = document.querySelector<HTMLElement>("#a")!;

    expect(arrangeSlideLayerInParent(a, "front")).toBe(true);
    expect(a.style.position).toBe("relative");
  });

  it("leaves reserved negative background layers below every editable layer", () => {
    const slide = mountSlide(
      `<div id="bg" style="position:absolute;z-index:-1">bg</div>
       <h1 id="a">Title</h1><p id="b">One</p>`,
    );
    const a = slide.querySelector<HTMLElement>("#a")!;

    arrangeSlideLayerInParent(a, "back");
    expect(slide.querySelector<HTMLElement>("#bg")!.style.zIndex).toBe("-1");
    expect(Number(zOf(a))).toBeGreaterThanOrEqual(0);
  });

  it("moves a layer one step forward and backward without changing layout order", () => {
    const slide = mountSlide(
      `<div id="a">A</div><div id="b">B</div><div id="c">C</div>`,
    );
    const a = slide.querySelector<HTMLElement>("#a")!;

    expect(arrangeSlideLayerInParent(a, "forward")).toBe(true);
    expect(Array.from(slide.children).map((node) => node.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(Number(zOf(a))).toBe(1);
    expect(Number(zOf(slide.querySelector<HTMLElement>("#b")!))).toBe(0);

    expect(arrangeSlideLayerInParent(a, "backward")).toBe(true);
    expect(Number(zOf(a))).toBe(0);
    expect(Number(zOf(slide.querySelector<HTMLElement>("#b")!))).toBe(1);
  });
});

describe("slide object groups and rotation", () => {
  const geometryFor = (
    entries: Array<[HTMLElement, SlideObjectGeometry]>,
  ): {
    get: (element: HTMLElement) => SlideObjectGeometry;
    apply: (element: HTMLElement, geometry: SlideObjectGeometry) => void;
  } => {
    const geometries = new Map(entries);
    const get = (element: HTMLElement) => {
      const known = geometries.get(element);
      if (known) return known;
      return {
        x: Number.parseFloat(element.style.left) || 0,
        y: Number.parseFloat(element.style.top) || 0,
        width: Number.parseFloat(element.style.width) || 0,
        height: Number.parseFloat(element.style.height) || 0,
      };
    };
    const apply = (element: HTMLElement, geometry: SlideObjectGeometry) => {
      geometries.set(element, geometry);
      element.style.left = `${geometry.x}px`;
      element.style.top = `${geometry.y}px`;
      element.style.width = `${geometry.width}px`;
      element.style.height = `${geometry.height}px`;
    };
    return { get, apply };
  };

  it("resolves a grouped descendant to its nearest group wrapper", () => {
    const boundary = document.createElement("div");
    const outer = document.createElement("div");
    outer.className = "fmd-slide-group";
    outer.setAttribute("data-slide-group", "true");
    const inner = outer.cloneNode(false) as HTMLElement;
    const member = document.createElement("div");
    outer.append(inner);
    inner.append(member);
    boundary.append(outer);

    expect(resolveSlideObjectGroupRoot(member, boundary)).toBe(inner);
    expect(resolveSlideObjectGroupRoot(inner, boundary)).toBe(inner);
    expect(resolveSlideObjectGroupRoot(boundary, boundary)).toBeNull();
  });

  it("groups absolute siblings into one durable wrapper and ungroups at its stack position", () => {
    const parent = document.createElement("div");
    const first = createFreeformObject("first", { zIndex: 0 });
    const second = createFreeformObject("second", { zIndex: 0 });
    const outside = createFreeformObject("outside", { zIndex: 0 });
    parent.append(first, outside, second);
    document.body.append(parent);
    const firstGeometry = { x: 20, y: 30, width: 80, height: 40 };
    const secondGeometry = { x: 140, y: 60, width: 50, height: 30 };
    const outsideGeometry = { x: 300, y: 10, width: 20, height: 20 };
    const geometry = geometryFor([
      [first, firstGeometry],
      [second, secondGeometry],
      [outside, outsideGeometry],
    ]);

    const group = groupSlideObjects(
      [second, first],
      geometry.get,
      geometry.apply,
    );

    expect(group).not.toBeNull();
    expect(isSlideObjectGroup(group!)).toBe(true);
    expect(group!.getAttribute("data-slide-object-id")).toBeTruthy();
    expect(group!.style.left).toBe("20px");
    expect(group!.style.top).toBe("30px");
    expect(group!.style.width).toBe("170px");
    expect(group!.style.height).toBe("60px");
    expect(Array.from(parent.children)).toEqual([outside, group]);
    expect(Array.from(group!.children)).toEqual([first, second]);
    expect(first.style.left).toBe("0px");
    expect(first.style.top).toBe("0px");
    expect(second.style.left).toBe("120px");
    expect(second.style.top).toBe("30px");

    const ungrouped = ungroupSlideObject(group!, geometry.get, geometry.apply);
    expect(ungrouped).toEqual([first, second]);
    expect(parent.children[0]).toBe(outside);
    expect(parent.children[1]).toBe(first);
    expect(parent.children[2]).toBe(second);
    expect(first.style.left).toBe("20px");
    expect(first.style.top).toBe("30px");
    expect(second.style.left).toBe("140px");
    expect(second.style.top).toBe("60px");
  });

  it("includes transformed member bounds when creating the group wrapper", () => {
    const parent = document.createElement("div");
    const first = createFreeformObject("first");
    const second = createFreeformObject("second");
    first.style.transform = "rotate(90deg)";
    parent.append(first, second);
    const geometry = geometryFor([
      [first, { x: 10, y: 10, width: 100, height: 20 }],
      [second, { x: 90, y: 10, width: 20, height: 20 }],
    ]);

    const group = groupSlideObjects(
      [first, second],
      geometry.get,
      geometry.apply,
    );

    expect(group).not.toBeNull();
    expect(group!.style.left).toBe("50px");
    expect(group!.style.top).toBe("-30px");
    expect(group!.style.width).toBe("60px");
    expect(group!.style.height).toBe("100px");
    expect(first.style.left).toBe("-40px");
    expect(first.style.top).toBe("40px");
    expect(second.style.left).toBe("40px");
    expect(second.style.top).toBe("40px");
  });

  it("restores members to the wrapper stack slot when ungrouping", () => {
    const parent = document.createElement("div");
    const first = createFreeformObject("first", { zIndex: 0 });
    const second = createFreeformObject("second", { zIndex: 2 });
    const outside = createFreeformObject("outside", { zIndex: 2 });
    outside.setAttribute("data-builder-id", "outside");
    parent.append(first, second, outside);
    const geometry = geometryFor([
      [first, { x: 0, y: 0, width: 40, height: 40 }],
      [second, { x: 60, y: 0, width: 40, height: 40 }],
      [outside, { x: 120, y: 0, width: 40, height: 40 }],
    ]);
    const group = groupSlideObjects(
      [first, second],
      geometry.get,
      geometry.apply,
    );
    expect(group).not.toBeNull();
    expect(arrangeSlideLayerInParent(group!, "front")).toBe(true);
    expect(group!.style.zIndex).toBe("3");

    const ungrouped = ungroupSlideObject(group!, geometry.get, geometry.apply);

    expect(ungrouped).toEqual([first, second]);
    expect(first.style.zIndex).toBe("3");
    expect(second.style.zIndex).toBe("3");
    expect(Number(first.style.zIndex)).toBeGreaterThan(
      Number(outside.style.zIndex),
    );
    expect(Number(second.style.zIndex)).toBeGreaterThan(
      Number(outside.style.zIndex),
    );
  });

  it("preserves inner paint order when ungrouping inverse DOM and z-index order", () => {
    const parent = document.createElement("div");
    const frontFirst = createFreeformObject("front-first", { zIndex: 4 });
    const backSecond = createFreeformObject("back-second", { zIndex: 1 });
    const outside = createFreeformObject("outside", { zIndex: 4 });
    parent.append(frontFirst, backSecond, outside);
    const geometry = geometryFor([
      [frontFirst, { x: 0, y: 0, width: 40, height: 40 }],
      [backSecond, { x: 60, y: 0, width: 40, height: 40 }],
      [outside, { x: 120, y: 0, width: 40, height: 40 }],
    ]);
    const group = groupSlideObjects(
      [frontFirst, backSecond],
      geometry.get,
      geometry.apply,
    );

    expect(group).not.toBeNull();
    expect(Array.from(group!.children)).toEqual([frontFirst, backSecond]);
    expect(group!.style.zIndex).toBe("4");

    const ungrouped = ungroupSlideObject(group!, geometry.get, geometry.apply);

    expect(ungrouped).toEqual([backSecond, frontFirst]);
    expect(Array.from(parent.children)).toEqual([
      backSecond,
      frontFirst,
      outside,
    ]);
    expect([
      backSecond.style.zIndex,
      frontFirst.style.zIndex,
      outside.style.zIndex,
    ]).toEqual(["4", "4", "4"]);

    const persisted = sanitizeSlideHtml(parent.innerHTML);
    const reloaded = document.createElement("div");
    reloaded.innerHTML = persisted;
    expect(
      Array.from(reloaded.children).map((element) =>
        element.getAttribute("data-slide-object-id"),
      ),
    ).toEqual(["back-second", "front-first", "outside"]);
    expect(
      Array.from(reloaded.children).map(
        (element) => (element as HTMLElement).style.zIndex,
      ),
    ).toEqual(["4", "4", "4"]);
  });

  it("preserves a group's rotation when ungrouping its members", () => {
    const parent = document.createElement("div");
    const first = createFreeformObject("first");
    const second = createFreeformObject("second");
    parent.append(first, second);
    const geometry = geometryFor([
      [first, { x: 20, y: 30, width: 80, height: 40 }],
      [second, { x: 140, y: 60, width: 50, height: 30 }],
    ]);
    const group = groupSlideObjects(
      [first, second],
      geometry.get,
      geometry.apply,
    );
    expect(group).not.toBeNull();
    setSlideObjectRotation(group!, 90);

    ungroupSlideObject(group!, geometry.get, geometry.apply);

    expect(first.style.left).toBe("75px");
    expect(first.style.top).toBe("-5px");
    expect(second.style.left).toBe("65px");
    expect(second.style.top).toBe("105px");
    expect(readSlideObjectRotation(first)).toBe(90);
    expect(readSlideObjectRotation(second)).toBe(90);
  });

  it.each([
    ["matrix", "matrix(1, 0, 0, 1, 20, 0)"],
    ["translate", "translate(20px, 0px)"],
  ])(
    "preserves a translated child's visual center when ungrouping a rotated group (%s)",
    (_kind, transform) => {
      const parent = document.createElement("div");
      const group = document.createElement("div");
      group.className = "fmd-slide-group";
      group.setAttribute("data-slide-group", "true");
      group.style.position = "absolute";
      const first = createFreeformObject("first");
      const second = createFreeformObject("second");
      first.style.transform = transform;
      first.style.transformOrigin = "50% 50%";
      group.append(first, second);
      parent.append(group);
      document.body.append(parent);
      const geometry = geometryFor([
        [group, { x: 100, y: 100, width: 200, height: 100 }],
        [first, { x: 20, y: 20, width: 40, height: 20 }],
        [second, { x: 120, y: 50, width: 30, height: 20 }],
      ]);
      setSlideObjectRotation(group, 90);
      const groupCenter = { x: 200, y: 150 };
      const originalVisualCenter = { x: 160, y: 130 };
      const expectedVisualCenter = {
        x: groupCenter.x - (originalVisualCenter.y - groupCenter.y),
        y: groupCenter.y + (originalVisualCenter.x - groupCenter.x),
      };

      ungroupSlideObject(group, geometry.get, geometry.apply);

      const nextGeometry = geometry.get(first);
      expect({
        x: nextGeometry.x + nextGeometry.width / 2 + 20,
        y: nextGeometry.y + nextGeometry.height / 2,
      }).toEqual(expectedVisualCenter);
      expect(readSlideObjectRotation(first)).toBe(90);
    },
  );

  it.each([15, 14.5])(
    "preserves a scaled and sheared child's visual center through rotated ungroup (%s°)",
    (childAngle) => {
      const parent = document.createElement("div");
      const group = document.createElement("div");
      group.className = "fmd-slide-group";
      group.setAttribute("data-slide-group", "true");
      group.style.position = "absolute";
      const first = createFreeformObject("first");
      const second = createFreeformObject("second");
      const radians = (childAngle * Math.PI) / 180;
      const matrix = [
        2 * Math.cos(radians),
        2 * Math.sin(radians),
        0.25,
        1.5,
        20,
        -10,
      ];
      first.style.transform = `matrix(${matrix.join(", ")})`;
      first.style.transformOrigin = "25% 75%";
      group.append(first, second);
      parent.append(group);
      document.body.append(parent);
      const firstGeometry = { x: 20, y: 20, width: 40, height: 20 };
      const groupGeometry = { x: 100, y: 100, width: 200, height: 100 };
      const geometry = geometryFor([
        [group, groupGeometry],
        [first, firstGeometry],
        [second, { x: 120, y: 50, width: 30, height: 20 }],
      ]);
      const origin = { x: 10, y: 15 };
      const center = { x: 20, y: 10 };
      const transformOffset = {
        x:
          matrix[0]! * (center.x - origin.x) +
          matrix[2]! * (center.y - origin.y) +
          matrix[4]! +
          origin.x -
          center.x,
        y:
          matrix[1]! * (center.x - origin.x) +
          matrix[3]! * (center.y - origin.y) +
          matrix[5]! +
          origin.y -
          center.y,
      };
      const originalVisualCenter = {
        x: groupGeometry.x + firstGeometry.x + center.x + transformOffset.x,
        y: groupGeometry.y + firstGeometry.y + center.y + transformOffset.y,
      };
      const groupCenter = { x: 200, y: 150 };
      const expectedVisualCenter = {
        x: groupCenter.x - (originalVisualCenter.y - groupCenter.y),
        y: groupCenter.y + (originalVisualCenter.x - groupCenter.x),
      };
      setSlideObjectRotation(group, 90);

      ungroupSlideObject(group, geometry.get, geometry.apply);

      const nextGeometry = geometry.get(first);
      const nextMatrix = first.style.transform
        .match(/^matrix\((.+)\)$/)?.[1]
        ?.split(",")
        .map(Number);
      expect(nextMatrix).toHaveLength(6);
      const nextTransformOffset = {
        x:
          (nextMatrix?.[0] ?? 1) * (center.x - origin.x) +
          (nextMatrix?.[2] ?? 0) * (center.y - origin.y) +
          (nextMatrix?.[4] ?? 0) +
          origin.x -
          center.x,
        y:
          (nextMatrix?.[1] ?? 0) * (center.x - origin.x) +
          (nextMatrix?.[3] ?? 1) * (center.y - origin.y) +
          (nextMatrix?.[5] ?? 0) +
          origin.y -
          center.y,
      };
      expect(nextGeometry.x + center.x + nextTransformOffset.x).toBeCloseTo(
        expectedVisualCenter.x,
        3,
      );
      expect(nextGeometry.y + center.y + nextTransformOffset.y).toBeCloseTo(
        expectedVisualCenter.y,
        3,
      );
    },
  );

  it("keeps auto stacking implicit when grouping auto-z siblings", () => {
    const parent = document.createElement("div");
    const first = createFreeformObject("first");
    const second = createFreeformObject("second");
    first.style.zIndex = "auto";
    second.style.zIndex = "auto";
    parent.append(first, second);
    const geometry = geometryFor([
      [first, { x: 0, y: 0, width: 40, height: 40 }],
      [second, { x: 60, y: 0, width: 40, height: 40 }],
    ]);

    const group = groupSlideObjects(
      [first, second],
      geometry.get,
      geometry.apply,
    );

    expect(group?.style.zIndex).toBe("");
  });

  it("preserves the effective class z-index when grouping members", () => {
    const style = document.createElement("style");
    style.textContent = ".slide-object-class-z-test { z-index: 12; }";
    document.head.append(style);

    const parent = document.createElement("div");
    const first = createFreeformObject("first");
    const second = createFreeformObject("second", { zIndex: 4 });
    first.classList.add("slide-object-class-z-test");
    parent.append(first, second);
    document.body.append(parent);
    const geometry = geometryFor([
      [first, { x: 0, y: 0, width: 40, height: 40 }],
      [second, { x: 60, y: 0, width: 40, height: 40 }],
    ]);

    const group = groupSlideObjects(
      [first, second],
      geometry.get,
      geometry.apply,
    );

    try {
      expect(group?.style.zIndex).toBe("12");
    } finally {
      parent.remove();
      style.remove();
    }
  });

  it("rotates a multi-selection around its union center", () => {
    const first = createFreeformObject("first");
    const second = createFreeformObject("second");
    const members = [
      rotationMember("first", first, { x: 0, y: 0, width: 20, height: 20 }, 0),
      rotationMember(
        "second",
        second,
        { x: 80, y: 0, width: 20, height: 20 },
        10,
      ),
    ];

    const plan = rotateSlideObjectMembers(members, 90);

    expect(plan.get("first")).toMatchObject({
      geometry: { x: 40, y: -40, width: 20, height: 20 },
      rotation: 90,
    });
    expect(plan.get("second")).toMatchObject({
      geometry: { x: 40, y: 40, width: 20, height: 20 },
      rotation: 100,
    });
  });

  it("preserves a class-supplied transform during rotation", () => {
    const style = document.createElement("style");
    style.textContent =
      ".slide-css-transform-test { transform: matrix(1.5, 0, 0, 1.5, 20, 8); }";
    document.head.append(style);
    const element = createFreeformObject("css-transform");
    element.classList.add("slide-css-transform-test");
    document.body.append(element);

    try {
      const member = rotationMember(
        "css-transform",
        element,
        { x: 0, y: 0, width: 100, height: 50 },
        0,
      );
      const plan = rotateSlideObjectMembers([member], 45);
      const next = plan.get("css-transform");
      const matrix = next?.transform
        .match(/^matrix\((.+)\)$/)?.[1]
        ?.split(",")
        .map(Number);

      expect(element.style.transform).toBe("");
      expect(matrix).toHaveLength(6);
      expect(Math.hypot(matrix?.[0] ?? 0, matrix?.[1] ?? 0)).toBeCloseTo(
        1.5,
        8,
      );
      expect(
        (Math.atan2(matrix?.[1] ?? 0, matrix?.[0] ?? 1) * 180) / Math.PI,
      ).toBeCloseTo(45, 8);
      expect(matrix?.[4]).toBe(20);
      expect(matrix?.[5]).toBe(8);
    } finally {
      element.remove();
      style.remove();
    }
  });

  it("keeps the pointer-rotation pivot fixed across preview updates", () => {
    const first = createFreeformObject("first");
    first.style.transform = "matrix(1, 0, 0, 1, 20, -5)";
    first.style.transformOrigin = "25% 75%";
    const second = createFreeformObject("second");
    second.style.transform =
      "matrix(0.965925826, 0.258819045, -0.258819045, 0.965925826, -4, 8)";
    const initial = [
      rotationMember("first", first, { x: 0, y: 0, width: 120, height: 20 }, 0),
      rotationMember(
        "second",
        second,
        { x: 140, y: 15, width: 20, height: 80 },
        15,
      ),
    ];
    const referenceFirst = createFreeformObject("reference-first");
    referenceFirst.style.transform = first.style.transform;
    referenceFirst.style.transformOrigin = first.style.transformOrigin;
    const referenceSecond = createFreeformObject("reference-second");
    referenceSecond.style.transform = second.style.transform;
    const reference = [
      rotationMember(
        "first",
        referenceFirst,
        initial[0]!.start,
        initial[0]!.rotation,
      ),
      rotationMember(
        "second",
        referenceSecond,
        initial[1]!.start,
        initial[1]!.rotation,
      ),
    ];

    const firstPreview = rotateSlideObjectMembers(initial, 10);
    for (const member of initial) {
      setSlideObjectRotation(
        member.element,
        firstPreview.get(member.objectId)!.rotation,
      );
    }
    const nextPreview = rotateSlideObjectMembers(initial, 20);
    const directPreview = rotateSlideObjectMembers(reference, 20);

    const output = (plan: typeof nextPreview) =>
      [...plan.entries()].map(([id, value]) => [
        id,
        { geometry: value.geometry, transform: value.transform },
      ]);
    expect(output(nextPreview)).toEqual(output(directPreview));
  });

  it.each([
    ["matrix", "matrix(1, 0, 0, 1, 20, 0)"],
    ["translate", "translate(20px, 0px)"],
  ])(
    "rotates translated members around the visible selection center (%s)",
    (_kind, transform) => {
      const first = createFreeformObject("first");
      first.style.transform = transform;
      const second = createFreeformObject("second");
      const members = [
        rotationMember(
          "first",
          first,
          { x: 0, y: 0, width: 20, height: 20 },
          0,
        ),
        rotationMember(
          "second",
          second,
          { x: 80, y: 0, width: 20, height: 20 },
          0,
        ),
      ];

      const plan = rotateSlideObjectMembers(members, 90);

      expect(plan.get("first")).toMatchObject({
        geometry: { x: 30, y: -30, width: 20, height: 20 },
        rotation: 90,
      });
      expect(plan.get("second")).toMatchObject({
        geometry: { x: 50, y: 30, width: 20, height: 20 },
        rotation: 90,
      });
    },
  );

  it("reads and replaces a persisted rotate transform", () => {
    const element = document.createElement("div");
    element.style.transform = "translate(2px) rotate(15deg)";

    expect(readSlideObjectRotation(element)).toBe(15);
    setSlideObjectRotation(element, 30);
    expect(element.style.transform).toContain("rotate(30deg)");
    expect(readSlideObjectRotation(element)).toBe(30);
  });

  it("replaces a matrix rotation without dropping scale or translation", () => {
    const element = document.createElement("div");
    element.style.transform =
      "matrix(1.931851652, 0.51763809, -0.51763809, 1.931851652, 10, 20)";
    expect(readSlideObjectRotation(element)).toBeCloseTo(15);

    setSlideObjectRotation(element, 30);

    const values = element.style.transform
      .match(/^matrix\((.+)\)$/)?.[1]
      ?.split(",")
      .map(Number);
    expect(values).toHaveLength(6);
    expect(Math.hypot(values?.[0] ?? 0, values?.[1] ?? 0)).toBeCloseTo(2);
    expect(
      Math.atan2(values?.[1] ?? 0, values?.[0] ?? 1) * (180 / Math.PI),
    ).toBeCloseTo(30);
    expect(values?.[4]).toBe(10);
    expect(values?.[5]).toBe(20);
    expect(readSlideObjectRotation(element)).toBeCloseTo(30);
  });

  it("preserves fractional rotation when reading a matrix-backed transform", () => {
    const element = document.createElement("div");
    const angle = 12.5;
    const radians = (angle * Math.PI) / 180;
    element.style.transform = `matrix(${[
      Math.cos(radians),
      Math.sin(radians),
      -Math.sin(radians),
      Math.cos(radians),
      10,
      20,
    ].join(", ")})`;

    expect(readSlideObjectRotation(element)).toBeCloseTo(angle);
    setSlideObjectRotation(element, readSlideObjectRotation(element) + 15);
    expect(readSlideObjectRotation(element)).toBeCloseTo(angle + 15);
  });

  it("normalizes pointer rotation across the angle boundary and snaps only with Shift", () => {
    const center = { x: 0, y: 0 };
    const pointAt = (angle: number) => ({
      x: Math.cos((angle * Math.PI) / 180),
      y: Math.sin((angle * Math.PI) / 180),
    });

    expect(
      resolveSlideObjectRotationDelta(179, center, pointAt(-179), false),
    ).toBeCloseTo(2);
    expect(resolveSlideObjectRotationDelta(0, center, pointAt(22), true)).toBe(
      15,
    );
    expect(
      resolveSlideObjectRotationDelta(0, center, pointAt(22), false),
    ).toBeCloseTo(22);
  });

  it("preserves a group's durable child identity through slide sanitization", () => {
    const parent = document.createElement("div");
    const first = createFreeformObject("first");
    const second = createFreeformObject("second");
    parent.append(first, second);
    const geometry = geometryFor([
      [first, { x: 20, y: 30, width: 80, height: 40 }],
      [second, { x: 140, y: 60, width: 50, height: 30 }],
    ]);
    const group = groupSlideObjects(
      [first, second],
      geometry.get,
      geometry.apply,
    );
    expect(group).not.toBeNull();
    setSlideObjectRotation(group!, 15);

    const persisted = sanitizeSlideHtml(parent.innerHTML);
    const reloaded = document.createElement("div");
    reloaded.innerHTML = persisted;
    const restoredGroup = reloaded.querySelector<HTMLElement>(
      '.fmd-slide-group[data-slide-group="true"]',
    );

    expect(restoredGroup?.getAttribute("data-slide-object-id")).toBeTruthy();
    expect(restoredGroup?.style.transform).toBe("rotate(15deg)");
    expect(
      Array.from(
        restoredGroup?.querySelectorAll("[data-slide-object-id]") ?? [],
      ).map((element) => element.getAttribute("data-slide-object-id")),
    ).toEqual(["first", "second"]);
  });
});

describe("layer drop and arrange guards", () => {
  it("rejects inside drops that a parser would silently reparent", () => {
    const table = document.createElement("table");
    const row = document.createElement("tr");
    const div = document.createElement("div");
    const listItem = document.createElement("li");
    const list = document.createElement("ul");

    expect(canDropSlideLayerInside(table, div)).toBe(false);
    expect(canDropSlideLayerInside(row, div)).toBe(false);
    expect(canDropSlideLayerInside(list, div)).toBe(false);
    expect(canDropSlideLayerInside(list, listItem)).toBe(true);
    expect(canDropSlideLayerInside(document.createElement("div"), div)).toBe(
      true,
    );
  });

  it("refuses to arrange a reserved negative-z background layer", () => {
    document.body.innerHTML = `
      <div data-slide-canvas="s1"><div class="slide-content">
        <div class="fmd-slide" style="position:relative;display:flex">
          <div id="bg" style="position:absolute;z-index:-1">bg</div>
          <h1 id="a">Title</h1>
        </div>
      </div></div>`;
    const bg = document.querySelector<HTMLElement>("#bg")!;

    expect(arrangeSlideLayerInParent(bg, "front")).toBe(false);
    expect(bg.style.zIndex).toBe("-1");
  });
});
