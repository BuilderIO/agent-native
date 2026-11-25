// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  canvasImageFrameBootstrap,
  toCanvasImageUrl,
} from "./canvas-image-url";
import { prepareExportImageSource } from "./export-image-source";

const ORIGIN = "https://design.example.test";
const PHOTO = "https://images.example.test/photo.jpg?w=5350&fit=crop";
const LARGE = "https://images.example.test/photo-2x.jpg";

const originalDecode = HTMLImageElement.prototype.decode;

beforeEach(() => {
  HTMLImageElement.prototype.decode = async () => {};
});

afterEach(() => {
  HTMLImageElement.prototype.decode = originalDecode;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function shownAs(image: HTMLImageElement, currentSrc: string) {
  Object.defineProperty(image, "currentSrc", { value: currentSrc });
}

function installBootstrapMarker() {
  const holder = document.createElement("div");
  holder.innerHTML = canvasImageFrameBootstrap(ORIGIN);
  document.head.append(...holder.childNodes);
}

it("decodes the original when the canvas shows a resized copy", async () => {
  installBootstrapMarker();
  const resized = toCanvasImageUrl(PHOTO, ORIGIN) ?? "";
  const image = document.createElement("img");
  image.setAttribute("src", resized);
  image.setAttribute("srcset", `${toCanvasImageUrl(LARGE, ORIGIN)} 2x`);
  document.body.append(image);
  shownAs(image, resized);

  const prepared = await prepareExportImageSource(
    image,
    AbortSignal.timeout(1000),
  );

  expect(prepared).not.toBe(image);
  expect(prepared.getAttribute("src")).toBe(PHOTO);
  expect(prepared.getAttribute("srcset")).toBe(`${LARGE} 2x`);
  expect(image.getAttribute("src")).toBe(resized);
});

it("restores picture sources in the clone", async () => {
  installBootstrapMarker();
  const resized = toCanvasImageUrl(PHOTO, ORIGIN) ?? "";
  document.body.innerHTML = `<picture><source srcset="${toCanvasImageUrl(LARGE, ORIGIN)?.replace(/&/g, "&amp;")} 2x"><img src="${resized.replace(/&/g, "&amp;")}"></picture>`;
  const image = document.querySelector("img");
  if (!image) throw new Error("picture image missing");
  shownAs(image, resized);

  const prepared = await prepareExportImageSource(
    image,
    AbortSignal.timeout(1000),
  );

  expect(prepared.getAttribute("src")).toBe(PHOTO);
  expect(
    prepared
      .closest("picture")
      ?.querySelector("source")
      ?.getAttribute("srcset"),
  ).toBe(`${LARGE} 2x`);
});

it("uses the image itself when the frame has no resize bootstrap", async () => {
  const image = document.createElement("img");
  image.setAttribute("src", PHOTO);
  document.body.append(image);
  shownAs(image, PHOTO);

  const prepared = await prepareExportImageSource(
    image,
    AbortSignal.timeout(1000),
  );

  expect(prepared).toBe(image);
});
