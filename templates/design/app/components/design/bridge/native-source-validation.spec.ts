// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNativeSceneProvider,
  sourceClipPlan,
  type NativeSourceRecord,
} from "./native-source-provider";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture() {
  const target = document.createElement("div");
  const group = document.createElement("div");
  const first = document.createElement("div");
  const second = document.createElement("div");
  group.append(first, second);
  target.append(group);
  document.body.append(target);
  const styles = new Map<Element, CSSStyleDeclaration>();
  for (const node of [target, group, first, second])
    styles.set(node, {
      display: "block",
      position: "static",
      isolation: "auto",
      opacity: "1",
      transform: "none",
      translate: "none",
      rotate: "none",
      scale: "none",
      zIndex: "auto",
      clipPath: "none",
      maskImage: "none",
    } as CSSStyleDeclaration);
  const reads = vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation((node) => {
      const style = styles.get(node);
      if (!style) throw new Error("Unexpected source style read");
      return style;
    });
  const provider = createNativeSceneProvider(target, "layer");
  if (!provider) throw new Error("A source provider is required");
  const records: NativeSourceRecord[] = [first, second].map((node, index) => ({
    key: index + 1,
    node,
    kind: "dom",
    width: 20,
    height: 20,
    revision: 1,
    coordinateSpace: "target-local",
    rect: { x: 0, y: 0, width: 20, height: 20 },
    localBox: { x: 0, y: 0, width: 20, height: 20 },
    localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    clip: { x: 0, y: 0, width: 20, height: 20 },
    clips: [],
    groupClips: [],
    isolationPath: [],
    opacity: 1,
  }));
  const validate = () =>
    (
      provider as unknown as {
        assertSourceComposition(records: NativeSourceRecord[]): void;
      }
    ).assertSourceComposition(records);
  const setStyle = (node: Element, changes: Partial<CSSStyleDeclaration>) => {
    const style = styles.get(node);
    if (!style) throw new Error("A source style is required");
    styles.set(node, { ...style, ...changes } as CSSStyleDeclaration);
  };
  return { provider, target, group, first, second, reads, setStyle, validate };
}

function clippedPlanFixture() {
  const target = document.createElement("div");
  const group = document.createElement("div");
  const source = document.createElement("div");
  target.append(group);
  group.append(source);
  document.body.append(target);
  const sizes = new Map<Element, { width: number; height: number }>([
    [target, { width: 100, height: 100 }],
    [group, { width: 80, height: 60 }],
    [source, { width: 20, height: 20 }],
  ]);
  const positions = new Map<Element, { x: number; y: number }>([
    [target, { x: 0, y: 0 }],
    [group, { x: 10, y: 0 }],
    [source, { x: 0, y: 0 }],
  ]);
  for (const node of [target, group, source]) {
    Object.defineProperties(node, {
      offsetWidth: {
        configurable: true,
        get: () => sizes.get(node)?.width ?? 0,
      },
      offsetHeight: {
        configurable: true,
        get: () => sizes.get(node)?.height ?? 0,
      },
      offsetLeft: {
        configurable: true,
        get: () => positions.get(node)?.x ?? 0,
      },
      offsetTop: {
        configurable: true,
        get: () => positions.get(node)?.y ?? 0,
      },
      offsetParent: { configurable: true, value: null },
    });
  }
  const declarations = new Map<Element, Record<string, string>>();
  const styles = new Map<Element, CSSStyleDeclaration>();
  for (const node of [target, group, source]) {
    const values: Record<string, string> = {
      display: "block",
      visibility: "visible",
      opacity: "1",
      position: "static",
      transform: "none",
      transformOrigin: "0px 0px",
      translate: "none",
      rotate: "none",
      scale: "none",
      perspective: "none",
      transformStyle: "flat",
      isolation: "auto",
      zIndex: "auto",
      mixBlendMode: "normal",
      filter: "none",
      backdropFilter: "none",
      backgroundImage: "none",
      clipPath: "none",
      maskImage: "none",
      overflowX: node === group ? "hidden" : "visible",
      overflowY: node === group ? "hidden" : "visible",
      overflowClipMargin: "0px",
      borderTopWidth: "0px",
      borderRightWidth: "0px",
      borderBottomWidth: "0px",
      borderLeftWidth: "0px",
      borderTopLeftRadius: "0px",
      borderTopRightRadius: "0px",
      borderBottomRightRadius: "0px",
      borderBottomLeftRadius: "0px",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      paddingLeft: "0px",
    };
    declarations.set(node, values);
    styles.set(
      node,
      new Proxy(values, {
        get(targetValues, property) {
          if (property === "getPropertyValue")
            return (name: string) =>
              name === "overflow-clip-margin"
                ? targetValues.overflowClipMargin
                : "0px";
          return Reflect.get(targetValues, property);
        },
      }) as unknown as CSSStyleDeclaration,
    );
  }
  const reads = vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation((node) => {
      const style = styles.get(node);
      if (!style) throw new Error("Unexpected source style read");
      return style;
    });
  const setStyle = (node: Element, changes: Record<string, string>) => {
    const values = declarations.get(node);
    if (!values) throw new Error("A source style is required");
    Object.assign(values, changes);
  };
  return { target, group, source, sizes, reads, setStyle };
}

describe("single-plan clipping style reads", () => {
  it("reads each clipped ancestor once per plan and refreshes CSS and layout on the next plan", () => {
    const scene = clippedPlanFixture();
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function")
      vi.spyOn(CSS, "supports").mockReturnValue(true);
    const first = sourceClipPlan(
      scene.source,
      scene.target,
      "target-local",
      false,
    );
    expect(
      scene.reads.mock.calls.filter(
        ([node, pseudo]) => node === scene.group && pseudo === undefined,
      ),
    ).toHaveLength(1);
    expect(
      scene.reads.mock.calls.filter(
        ([node, pseudo]) => node === scene.group && pseudo === "::before",
      ),
    ).toHaveLength(1);
    expect(
      scene.reads.mock.calls.filter(
        ([node, pseudo]) => node === scene.group && pseudo === "::after",
      ),
    ).toHaveLength(1);
    expect(first.groupClips[0]?.clip.localBox).toMatchObject({
      x: 0,
      width: 80,
    });
    expect(first.clip).toMatchObject({ x: 10, width: 80 });

    scene.reads.mockClear();
    scene.setStyle(scene.group, {
      overflowX: "clip",
      overflowY: "clip",
      overflowClipMargin: "content-box 2px",
    });
    scene.sizes.set(scene.group, { width: 90, height: 60 });
    const second = sourceClipPlan(
      scene.source,
      scene.target,
      "target-local",
      false,
    );
    expect(
      scene.reads.mock.calls.filter(
        ([node, pseudo]) => node === scene.group && pseudo === undefined,
      ),
    ).toHaveLength(1);
    expect(
      scene.reads.mock.calls.filter(
        ([node, pseudo]) => node === scene.group && pseudo === "::before",
      ),
    ).toHaveLength(1);
    expect(
      scene.reads.mock.calls.filter(
        ([node, pseudo]) => node === scene.group && pseudo === "::after",
      ),
    ).toHaveLength(1);
    expect(second.groupClips[0]?.clip.localBox).toMatchObject({
      x: -2,
      width: 94,
    });
    expect(second.clip).toMatchObject({ x: 8, width: 92 });
  });
});

describe("synchronous source composition style reads", () => {
  it("bounds ancestor style reads by visible source nodes during one validation", () => {
    const scene = fixture();
    try {
      scene.validate();
      expect(scene.reads.mock.calls.length).toBeLessThanOrEqual(4);
      expect(new Set(scene.reads.mock.calls.map(([node]) => node)).size).toBe(
        4,
      );
    } finally {
      scene.provider.dispose();
    }
  });

  it("reads new CSS declarations on every call even when the provider epoch is unchanged", () => {
    const scene = fixture();
    try {
      scene.validate();
      const epoch = scene.provider.authoredSourceEpoch?.();
      scene.setStyle(scene.group, { clipPath: "circle(25%)" });
      expect(scene.provider.authoredSourceEpoch?.()).toBe(epoch);
      expect(scene.validate).toThrow(
        expect.objectContaining({ code: "source-mask-unsupported" }),
      );
      scene.setStyle(scene.group, { clipPath: "none" });
      scene.setStyle(scene.first, { position: "relative", zIndex: "2" });
      scene.setStyle(scene.second, { position: "relative", zIndex: "1" });
      expect(scene.validate).toThrow(
        expect.objectContaining({ code: "source-stacking-order" }),
      );
      scene.setStyle(scene.first, { position: "static", zIndex: "auto" });
      scene.setStyle(scene.second, { position: "static", zIndex: "auto" });
      expect(scene.validate).not.toThrow();
    } finally {
      scene.provider.dispose();
    }
  });

  it("revalidates authored opacity while native suppression is installed and restored", () => {
    const scene = fixture();
    try {
      scene.group.setAttribute("data-an-native-scene-suppressed", "");
      scene.group.setAttribute("data-an-native-authored-opacity", "0.5");
      scene.setStyle(scene.group, { opacity: "0" });
      expect(scene.validate).not.toThrow();
      scene.group.setAttribute("data-an-native-authored-opacity", "unreadable");
      expect(scene.validate).toThrow(
        expect.objectContaining({ code: "source-opacity-invalid" }),
      );
      scene.group.removeAttribute("data-an-native-scene-suppressed");
      scene.group.removeAttribute("data-an-native-authored-opacity");
      scene.setStyle(scene.group, { opacity: "1" });
      expect(scene.validate).not.toThrow();
    } finally {
      scene.provider.dispose();
    }
  });
});
