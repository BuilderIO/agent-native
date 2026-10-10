// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { mapNativeSourceAffine } from "./native-source-affine-geometry";
import {
  CachedLeaf,
  createNativeSceneProvider,
  sourceClipPlan,
} from "./native-source-provider";

const rootWidth = Object.getOwnPropertyDescriptor(
  document.documentElement,
  "offsetWidth",
);
const rootHeight = Object.getOwnPropertyDescriptor(
  document.documentElement,
  "offsetHeight",
);
const bodyWidth = Object.getOwnPropertyDescriptor(document.body, "offsetWidth");
const bodyHeight = Object.getOwnPropertyDescriptor(
  document.body,
  "offsetHeight",
);

afterEach(() => {
  document.body.replaceChildren();
  for (const [node, key, descriptor] of [
    [document.documentElement, "offsetWidth", rootWidth],
    [document.documentElement, "offsetHeight", rootHeight],
    [document.body, "offsetWidth", bodyWidth],
    [document.body, "offsetHeight", bodyHeight],
  ] as const) {
    if (descriptor) Object.defineProperty(node, key, descriptor);
    else Reflect.deleteProperty(node, key);
  }
  vi.restoreAllMocks();
});

function fixture() {
  const source = document.createElement("canvas");
  source.width = 20;
  source.height = 30;
  const target = document.createElement("div");
  target.setAttribute("data-agent-native-node-id", "receiver");
  document.body.append(source, target);
  const boxes = new Map<Element, DOMRect>([
    [document.documentElement, new DOMRect(0, 0, innerWidth, innerHeight)],
    [document.body, new DOMRect(0, 0, innerWidth, innerHeight)],
    [source, new DOMRect(90, 80, 20, 30)],
    [target, new DOMRect(100, 80, 100, 50)],
  ]);
  const transform = { value: "none" };
  const radius = { value: "0px" };
  const rootColor = { value: "rgba(0, 0, 0, 0)" };
  for (const [element, box] of boxes) {
    Object.defineProperties(element, {
      offsetWidth: { configurable: true, value: box.width },
      offsetHeight: { configurable: true, value: box.height },
      offsetLeft: { configurable: true, value: box.x },
      offsetTop: { configurable: true, value: box.y },
    });
  }
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return boxes.get(this) ?? new DOMRect(0, 0, 0, 0);
    },
  );
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({
        length: 0,
        imageRendering: "auto",
        objectFit: "fill",
        objectPosition: "50% 50%",
        width: "auto",
        height: "auto",
        boxSizing: "content-box",
        display: element === document.head ? "none" : "block",
        visibility: "visible",
        opacity: "1",
        position: "static",
        transform: element === target ? transform.value : "none",
        transformOrigin: "0px 0px",
        translate: "none",
        perspective: "none",
        transformStyle: "flat",
        rotate: "none",
        scale: "none",
        isolation: "auto",
        zIndex: "auto",
        order: "0",
        mixBlendMode: "normal",
        filter: "none",
        backdropFilter: "none",
        backgroundImage: "none",
        backgroundColor:
          element === document.documentElement
            ? rootColor.value
            : "rgba(0, 0, 0, 0)",
        boxShadow: "none",
        outlineStyle: "none",
        clipPath: "none",
        maskImage: "none",
        overflowX: element === target ? "clip" : "visible",
        overflowY: element === target ? "clip" : "visible",
        borderTopWidth: "0px",
        borderRightWidth: "0px",
        borderBottomWidth: "0px",
        borderLeftWidth: "0px",
        borderTopLeftRadius: element === target ? radius.value : "0px",
        borderTopRightRadius: element === target ? radius.value : "0px",
        borderBottomRightRadius: element === target ? radius.value : "0px",
        borderBottomLeftRadius: element === target ? radius.value : "0px",
        paddingTop: "0px",
        paddingRight: "0px",
        paddingBottom: "0px",
        paddingLeft: "0px",
        getPropertyValue: (name: string) =>
          name === "overflow-clip-margin" ? "border-box 12px" : "0px",
      }) as unknown as CSSStyleDeclaration,
  );
  return { source, target, boxes, transform, radius, rootColor };
}

describe("Backdrop local source capture", () => {
  it.each([1, 1.6, 2])(
    "retains prior paint outside the receiver at density %s",
    async (density) => {
      const { source, target } = fixture();
      const provider = createNativeSceneProvider(target, "backdrop");
      expect(provider).not.toBeNull();
      try {
        provider!.setDensity(density);
        const scene = await provider!.readScene();
        const record = scene.find((item) => item.node === source);
        expect(record).toMatchObject({
          coordinateSpace: "target-local-global",
          kind: "canvas",
          rect: { x: -10, y: 0, width: 20, height: 30 },
          clip: { x: -10, y: 0, width: 20, height: 30 },
          width: 20,
          height: 30,
        });
        expect(record?.source).toBe(source);
        expect(
          sourceClipPlan(source, target, "target-local-global", true)
            .ancestorClip,
        ).toEqual({ x: -12, y: -12, width: 124, height: 74 });
      } finally {
        provider?.dispose();
      }
    },
  );

  it("inverse-projects reflected scale and reads a fresh transform on each scene", async () => {
    const { source, target, boxes, transform } = fixture();
    boxes.set(source, new DOMRect(120, 80, 20, 30));
    Object.defineProperty(source, "offsetLeft", {
      configurable: true,
      value: 120,
    });
    transform.value = "matrix(-2, 0, 0, 3, 0, 0)";
    boxes.set(target, new DOMRect(-100, 80, 200, 150));
    const provider = createNativeSceneProvider(target, "backdrop");
    try {
      const record = (await provider!.readScene()).find(
        (item) => item.node === source,
      );
      expect(record?.rect.x).toBe(-20);
      expect(record?.rect.y).toBeCloseTo(0, 5);
      expect(record?.rect.width).toBe(10);
      expect(record?.rect.height).toBeCloseTo(10, 5);
      expect(record?.clip.x).toBe(-12);
      expect(record?.clip.width).toBe(2);
      transform.value = "none";
      boxes.set(target, new DOMRect(100, 80, 100, 50));
      const changed = (await provider!.readScene()).find(
        (item) => item.node === source,
      );
      expect(changed?.rect).toEqual({ x: 20, y: 0, width: 20, height: 30 });
    } finally {
      provider?.dispose();
    }
  });

  it("preserves a rotated source footprint rather than its viewport AABB sampling", async () => {
    const { source, target, boxes, transform } = fixture();
    source.height = 20;
    Object.defineProperties(source, {
      offsetHeight: { configurable: true, value: 20 },
      offsetTop: { configurable: true, value: 70 },
    });
    boxes.set(source, new DOMRect(90, 70, 20, 20));
    transform.value = "matrix(0, 1, -1, 0, 0, 0)";
    boxes.set(target, new DOMRect(50, 80, 50, 100));
    const provider = createNativeSceneProvider(target, "backdrop");
    try {
      const record = (await provider!.readScene()).find(
        (item) => item.node === source,
      );
      expect(record?.rect).toEqual({ x: -10, y: -10, width: 20, height: 20 });
      if (!record?.localToTarget)
        throw new Error("Projected source unavailable.");
      expect(
        mapNativeSourceAffine(record.localToTarget, { x: 5, y: 5 }),
      ).toEqual({ x: -5, y: 5 });
    } finally {
      provider?.dispose();
    }
  });

  it("rejects an unreadable singular receiver without returning prior source paint", async () => {
    const { target, boxes, transform } = fixture();
    const provider = createNativeSceneProvider(target, "backdrop");
    try {
      expect((await provider!.readScene()).length).toBeGreaterThan(0);
      transform.value = "matrix(0, 0, 0, 1, 0, 0)";
      boxes.set(target, new DOMRect(100, 80, 0, 50));
      await expect(provider!.readScene()).rejects.toMatchObject({
        code: "source-transform",
      });
    } finally {
      provider?.dispose();
    }
  });

  it("projects the full CSS canvas background into the expanded source window", async () => {
    const { target, rootColor } = fixture();
    rootColor.value = "rgb(12, 34, 56)";
    const captured = document.createElement("canvas");
    captured.width = innerWidth;
    captured.height = innerHeight;
    vi.spyOn(CachedLeaf.prototype, "read").mockResolvedValue(captured);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (kind: string) {
        return kind === "2d"
          ? ({
              fillStyle: "",
              fillRect() {},
            } as unknown as CanvasRenderingContext2D)
          : null;
      } as typeof HTMLCanvasElement.prototype.getContext,
    );
    const provider = createNativeSceneProvider(target, "backdrop");
    try {
      const background = (await provider!.readScene()).find(
        (record) => record.sourceRole === "viewport-background",
      );
      expect(background).toMatchObject({
        coordinateSpace: "target-local-global",
        localBox: { x: 0, y: 0, width: innerWidth, height: innerHeight },
        rect: { x: -100, y: -80, width: innerWidth, height: innerHeight },
        clip: { x: -12, y: -12, width: 124, height: 74 },
      });
    } finally {
      provider?.dispose();
    }
  });

  it("clips an enlarged native Backdrop presentation to its authored receiver border", async () => {
    const { source, target, boxes, radius } = fixture();
    source.setAttribute("data-an-native-canvas", "expanded-backdrop");
    source.setAttribute("data-an-native-backdrop-presentation", "");
    source.setAttribute("data-an-native-backdrop-receiver-node-id", "receiver");
    source.setAttribute("data-agent-native-node-id", "receiver");
    target.setAttribute(
      "data-an-native-backdrop-instance",
      "expanded-backdrop",
    );
    source.width = 124;
    source.height = 74;
    Object.defineProperties(source, {
      offsetWidth: { configurable: true, value: 124 },
      offsetHeight: { configurable: true, value: 74 },
      offsetLeft: { configurable: true, value: 88 },
      offsetTop: { configurable: true, value: 68 },
    });
    boxes.set(source, new DOMRect(88, 68, 124, 74));
    radius.value = "9px";
    const provider = createNativeSceneProvider(
      document.documentElement,
      "layer",
    );
    try {
      const record = (await provider!.readScene()).find(
        (item) => item.nativeInstanceId === "expanded-backdrop",
      );
      expect(record?.localBox).toEqual({ x: 0, y: 0, width: 124, height: 74 });
      expect(record?.rect).toEqual({ x: 88, y: 68, width: 124, height: 74 });
      expect(record?.clips).toHaveLength(1);
      expect(record?.clips?.[0]).toMatchObject({
        localBox: { x: 0, y: 0, width: 100, height: 50 },
        rect: { x: 100, y: 80, width: 100, height: 50 },
        radii: {
          topLeft: { x: 9, y: 9 },
          topRight: { x: 9, y: 9 },
          bottomLeft: { x: 9, y: 9 },
          bottomRight: { x: 9, y: 9 },
        },
      });
    } finally {
      provider?.dispose();
    }
  });
});
