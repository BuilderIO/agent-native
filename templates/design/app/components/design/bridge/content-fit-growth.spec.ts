import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const bridgeNames = ["editor-chrome.bridge.ts", "hit-test.bridge.ts"] as const;

type BridgeName = (typeof bridgeNames)[number];

type ElementSize = { width: number; height: number };

type FakeElement = {
  parentElement: FakeElement | null;
  style: Record<string, string>;
  offsetWidth?: number;
  offsetHeight?: number;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

function bridgeSource(name: BridgeName) {
  return readFileSync(resolve(bridgeDir, name), "utf8");
}

function compile<T extends (...args: any[]) => any>(
  source: string,
  name: string,
  nextFunction: string,
  globals: Record<string, unknown>,
): T {
  const start = source.indexOf(`function ${name}(`);
  const next = source.indexOf(`function ${nextFunction}(`, start);
  const end = source.lastIndexOf("\n", next);
  if (start < 0 || end < 0) throw new Error(`Could not isolate ${name}`);
  return new Function(
    ...Object.keys(globals),
    `${ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2020 })}; return ${name};`,
  )(...Object.values(globals)) as T;
}

function makeContainer(
  options: {
    width?: string;
    height?: string;
    maxWidth?: string;
    maxHeight?: string;
    display?: string;
    current?: ElementSize;
    scaleX?: number;
    scaleY?: number;
    boxSizing?: string;
    paddingLeft?: string;
    paddingRight?: string;
    paddingTop?: string;
    paddingBottom?: string;
    borderLeftWidth?: string;
    borderRightWidth?: string;
    borderTopWidth?: string;
    borderBottomWidth?: string;
  } = {},
  bridge: BridgeName = "editor-chrome.bridge.ts",
) {
  const body: FakeElement = {
    parentElement: null,
    style: {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1440,
      height: 1024,
    }),
  };
  const container: FakeElement = {
    parentElement: body,
    style: {
      width: options.width ?? "fit-content",
      height: options.height ?? "fit-content",
    },
    getAttribute: (name) => (name === "data-an-primitive" ? "frame" : null),
    offsetWidth: 35,
    offsetHeight: 19,
    getBoundingClientRect: () => ({
      left: 720,
      top: 942,
      width: (options.current?.width ?? 35) * (options.scaleX ?? 1),
      height: (options.current?.height ?? 19) * (options.scaleY ?? 1),
    }),
  };
  const child: FakeElement = {
    parentElement: container,
    style: {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({
      left: 720,
      top: 942,
      width: 35,
      height: 19,
    }),
  };
  const computed = {
    display: options.display ?? "flex",
    maxWidth: options.maxWidth ?? "none",
    maxHeight: options.maxHeight ?? "none",
    boxSizing: options.boxSizing ?? "content-box",
    paddingLeft: options.paddingLeft ?? "0px",
    paddingRight: options.paddingRight ?? "0px",
    paddingTop: options.paddingTop ?? "0px",
    paddingBottom: options.paddingBottom ?? "0px",
    borderLeftWidth: options.borderLeftWidth ?? "0px",
    borderRightWidth: options.borderRightWidth ?? "0px",
    borderTopWidth: options.borderTopWidth ?? "0px",
    borderBottomWidth: options.borderBottomWidth ?? "0px",
  };
  const source = bridgeSource(bridge);
  const helper = compile<
    (element: Element, sourceWidth: number, sourceHeight: number) => boolean
  >(source, "dropCanGrowContentSizedAutoLayout", "dropFitsAutoLayoutFallback", {
    dropContentSize: (element: FakeElement) =>
      element === container
        ? {
            width: (options.current?.width ?? 35) * (options.scaleX ?? 1),
            height: (options.current?.height ?? 19) * (options.scaleY ?? 1),
          }
        : { width: 1440, height: 1024 },
    window: { getComputedStyle: () => computed },
  });
  return { body, container, child, computed, helper };
}

function resolveAutoLayoutFallback(
  bridge: BridgeName,
  options: Parameters<typeof makeContainer>[0] = {},
) {
  const { container, helper, computed } = makeContainer(options, bridge);
  const source = bridgeSource(bridge);
  const nextFunction =
    bridge === "editor-chrome.bridge.ts"
      ? "isOutsideIframeViewport"
      : "elementFromEditorPoint";
  const fitsFallback = compile<
    (element: Element, sourceWidth: number, sourceHeight: number) => boolean
  >(source, "dropFitsAutoLayoutFallback", nextFunction, {
    dropFitsContainer: () => false,
    dropCanGrowContentSizedAutoLayout: helper,
    dropContentSize: (element: FakeElement) =>
      element === container
        ? (options.current ?? { width: 35, height: 19 })
        : { width: 1440, height: 1024 },
    flexMainAxis: () => "y",
    window: {
      getComputedStyle: () => ({
        ...computed,
        flexWrap: "nowrap",
        flexDirection: "column",
      }),
    },
  });
  return fitsFallback(container as unknown as Element, 81, 80);
}

function resolveGuardTarget(
  bridge: BridgeName,
  options: Parameters<typeof makeContainer>[0] = {},
) {
  const { body, container, child, helper } = makeContainer(options, bridge);
  const target = { anchor: child, placement: "after", dropMode: "flow-insert" };
  const source = bridgeSource(bridge);
  const dropFitsContainer = () => false;
  const nearestChildInsertionTarget = vi.fn(() => null);
  if (bridge === "editor-chrome.bridge.ts") {
    const apply = compile<
      (
        value: typeof target,
        event: { clientX: number; clientY: number },
      ) => unknown
    >(source, "applyFreeDropSizeGuard", "cancelAutoLayoutTargetResolution", {
      ignoreAutoLayoutHeld: () => false,
      isPlatformPrimaryChord: () => false,
      dropContainerForTarget: () => container,
      dragEl: {} as Element,
      groupOthers: [],
      dragElStartRect: { width: 81, height: 80 },
      document: { body, documentElement: {} },
      isContainerDropTarget: (element: FakeElement) => element === container,
      isAutoLayoutElement: (element: FakeElement) => element === container,
      isAbsolutePrimitiveContainer: () => false,
      isFreeformRelativeContainer: () => false,
      dropFitsContainer,
      dropCanGrowContentSizedAutoLayout: helper,
      dropFitsAutoLayoutFallback: () => false,
      parentFlowAxis: () => "y",
      nearestChildInsertionTarget,
    });
    return {
      target,
      result: apply(target, { clientX: 746, clientY: 951 }),
      helper,
      container,
    };
  }
  const apply = compile<
    (value: typeof target, x: number, y: number, size: ElementSize) => unknown
  >(source, "applyHitTestSizeGuard", "showInsertionGuideFor", {
    document: { body, documentElement: {} },
    isContainerDropTarget: (element: FakeElement) => element === container,
    isAutoLayoutElement: (element: FakeElement) => element === container,
    isAbsolutePrimitiveContainer: () => false,
    isFreeformRelativeContainer: () => false,
    dropFitsContainer,
    dropCanGrowContentSizedAutoLayout: helper,
    dropFitsAutoLayoutFallback: () => false,
    hasKnownFlexMainAxis: () => true,
    isMultiTrackGrid: () => false,
    nearestChildInsertionTarget,
    parentFlowAxis: () => "y",
  });
  return {
    target,
    result: apply(target, 746, 951, { width: 81, height: 80 }),
    helper,
    container,
  };
}

describe("auto-layout content-sized drop growth", () => {
  it.each(bridgeNames)(
    "keeps the 81x80 duplicate in a 35x19 fit-content wrapper in %s",
    (bridge) => {
      const { target, result } = resolveGuardTarget(bridge);
      expect(result).toBe(target);
    },
  );

  it.each(bridgeNames)(
    "allows the same eligible wrapper as a flow ancestor in %s",
    (bridge) => {
      expect(resolveAutoLayoutFallback(bridge)).toBe(true);
    },
  );

  it.each([
    {
      name: "fixed width and height",
      width: "35px",
      height: "19px",
      maxWidth: "none",
      maxHeight: "none",
    },
    {
      name: "max-width below source",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "60px",
      maxHeight: "none",
    },
    {
      name: "max-height below source",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "none",
      maxHeight: "70px",
    },
  ])("still rejects $name in both direct guards", ({ ...options }) => {
    for (const bridge of bridgeNames) {
      const { result } = resolveGuardTarget(bridge, options);
      expect(result).toBeNull();
    }
  });

  it.each([
    {
      name: "fixed width",
      width: "35px",
      height: "fit-content",
      maxWidth: "none",
      maxHeight: "none",
      current: { width: 35, height: 19 },
      expected: false,
    },
    {
      name: "max-width below source",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "60px",
      maxHeight: "none",
      current: { width: 35, height: 19 },
      expected: false,
    },
    {
      name: "max-height below source",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "none",
      maxHeight: "70px",
      current: { width: 35, height: 19 },
      expected: false,
    },
    {
      name: "unresolved max-width",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "100%",
      maxHeight: "none",
      current: { width: 35, height: 19 },
      expected: false,
    },
    {
      name: "adequate max constraints",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "100px",
      maxHeight: "90px",
      current: { width: 35, height: 19 },
      expected: true,
    },
    {
      name: "already-fitting fixed width plus content-sized height",
      width: "35px",
      height: "fit-content",
      maxWidth: "none",
      maxHeight: "none",
      current: { width: 90, height: 19 },
      expected: true,
    },
    {
      name: "non-flex fit-content wrapper",
      width: "fit-content",
      height: "fit-content",
      display: "block",
      maxWidth: "none",
      maxHeight: "none",
      current: { width: 35, height: 19 },
      expected: false,
    },
    {
      name: "zoomed-out max caps below viewport source size",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "100px",
      maxHeight: "100px",
      scaleX: 0.5,
      scaleY: 0.5,
      current: { width: 35, height: 19 },
      expected: false,
      sourceWidth: 60,
      sourceHeight: 60,
    },
    {
      name: "zoomed-in max caps above viewport source size",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "100px",
      maxHeight: "100px",
      scaleX: 2,
      scaleY: 2,
      current: { width: 35, height: 19 },
      expected: true,
      sourceWidth: 60,
      sourceHeight: 60,
    },
    {
      name: "border-box max cap subtracts padding and border",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "100px",
      maxHeight: "100px",
      boxSizing: "border-box",
      paddingLeft: "20px",
      paddingRight: "20px",
      borderLeftWidth: "2px",
      borderRightWidth: "2px",
      current: { width: 35, height: 19 },
      expected: false,
      sourceWidth: 60,
      sourceHeight: 60,
    },
    {
      name: "content-box max cap remains content capacity",
      width: "fit-content",
      height: "fit-content",
      maxWidth: "100px",
      maxHeight: "100px",
      boxSizing: "content-box",
      paddingLeft: "20px",
      paddingRight: "20px",
      borderLeftWidth: "2px",
      borderRightWidth: "2px",
      current: { width: 35, height: 19 },
      expected: true,
      sourceWidth: 80,
      sourceHeight: 80,
    },
    {
      name: "fit-content function cap subtracts border-box insets",
      width: "fit-content(100px)",
      height: "fit-content",
      boxSizing: "border-box",
      paddingLeft: "20px",
      paddingRight: "20px",
      borderLeftWidth: "2px",
      borderRightWidth: "2px",
      current: { width: 35, height: 19 },
      expected: false,
      sourceWidth: 60,
      sourceHeight: 60,
    },
  ])("$name remains constrained in each bridge", ({ expected, ...options }) => {
    for (const bridge of bridgeNames) {
      const { helper, container } = makeContainer(options, bridge);
      const sourceWidth = "sourceWidth" in options ? options.sourceWidth : 81;
      const sourceHeight =
        "sourceHeight" in options ? options.sourceHeight : 80;
      expect(
        helper(container as unknown as Element, sourceWidth, sourceHeight),
      ).toBe(expected);
    }
  });
});
