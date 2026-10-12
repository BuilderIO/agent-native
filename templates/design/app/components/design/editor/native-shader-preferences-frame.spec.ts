// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

import { getBreakpointIframeId } from "../multi-screen/iframe-targeting";
import {
  findVisibleNativeShaderPreferencesFrame,
  NativeShaderPreferencesFrameError,
} from "./native-shader-preferences-frame";

function addFrame(
  root: HTMLElement,
  id: string,
  board = false,
  width = 960,
  height = 640,
) {
  const parent = document.createElement("div");
  parent.style.opacity = "1";
  root.style.opacity = "1";
  if (board) parent.dataset.boardSurfaceLayer = "";
  const frame = document.createElement("iframe");
  frame.dataset.designPreviewIframe = "";
  frame.style.opacity = "1";
  frame.style.visibility = "visible";
  Object.defineProperty(frame, "contentWindow", { value: window });
  if (!board) frame.dataset.screenIframeId = id;
  Object.defineProperties(frame, {
    clientWidth: { value: width },
    clientHeight: { value: height },
  });
  frame.getBoundingClientRect = () =>
    ({
      left: 1,
      top: 1,
      right: 1 + width,
      bottom: 1 + height,
      width,
      height,
    }) as DOMRect;
  parent.append(frame);
  root.append(parent);
  return frame;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("uses the unique visible active screen without falling back to another screen", () => {
  const root = document.createElement("div");
  document.body.append(root);
  addFrame(root, "old-screen").style.display = "none";
  const active = addFrame(root, "active-screen");
  expect(
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "active-screen",
    }),
  ).toBe(active);
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({ root, screenId: "missing" }),
  ).toThrowError(NativeShaderPreferencesFrameError);
});

it("refuses duplicate or hidden matches and does not read a stale breakpoint", () => {
  const root = document.createElement("div");
  document.body.append(root);
  addFrame(root, "screen-1");
  const breakpoint = addFrame(root, getBreakpointIframeId("screen-1", 480));
  expect(
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "screen-1",
      breakpointWidthPx: 480,
    }),
  ).toBe(breakpoint);
  addFrame(root, getBreakpointIframeId("screen-1", 480));
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "screen-1",
      breakpointWidthPx: 480,
    }),
  ).toThrowError("frame-ambiguous");
  root.lastElementChild?.remove();
  breakpoint.style.visibility = "hidden";
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "screen-1",
      breakpointWidthPx: 480,
    }),
  ).toThrowError("frame-hidden");
  breakpoint.style.visibility = "visible";
  breakpoint.parentElement!.style.opacity = "0";
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "screen-1",
      breakpointWidthPx: 480,
    }),
  ).toThrowError("frame-hidden");
});

it("selects the authoritative board surface only for the board file", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const board = addFrame(root, "", true);
  addFrame(root, "screen-1");
  expect(
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "board-id",
      boardFileId: "board-id",
    }),
  ).toBe(board);
  expect(
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "screen-1",
      boardFileId: "board-id",
    }).dataset.screenIframeId,
  ).toBe("screen-1");
  root.remove();
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({
      root,
      screenId: "board-id",
      boardFileId: "board-id",
    }),
  ).toThrowError("frame-hidden");
});

it("requires nonzero outer viewport, visible intersection, and positive frame extent", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const frame = addFrame(root, "screen-1");
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(0);
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({ root, screenId: "screen-1" }),
  ).toThrowError("frame-hidden");
  vi.restoreAllMocks();
  frame.getBoundingClientRect = () =>
    ({
      left: 2_000,
      right: 2_960,
      top: 1,
      bottom: 641,
      width: 960,
      height: 640,
    }) as DOMRect;
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({ root, screenId: "screen-1" }),
  ).toThrowError("frame-hidden");
  frame.remove();
  addFrame(root, "screen-1", false, 0, 640);
  expect(() =>
    findVisibleNativeShaderPreferencesFrame({ root, screenId: "screen-1" }),
  ).toThrowError("frame-hidden");
});
