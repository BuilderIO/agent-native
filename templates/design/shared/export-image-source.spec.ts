// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  canvasImageFrameBootstrap,
  CANVAS_IMAGE_ROUTE,
  toCanvasImageUrl,
} from "./canvas-image-url";
import {
  prepareExportImageSource,
  restoreCanvasImageSources,
} from "./export-image-source";

const ORIGIN = "https://design.example.com";
const PROXY = {
  origin: ORIGIN,
  route: CANVAS_IMAGE_ROUTE,
  auth: { subject: "subj_-1", exp: 1893456000, token: "tok_-1" },
};
const PHOTO = "https://images.example.com/photo.jpg?w=5350&fit=crop";
const LARGE = "https://images.example.com/photo-2x.jpg";

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
  holder.innerHTML = canvasImageFrameBootstrap(PROXY);
  document.head.append(...holder.childNodes);
}

it("decodes the original when the canvas shows a resized copy", async () => {
  installBootstrapMarker();
  const resized = toCanvasImageUrl(PHOTO, PROXY) ?? "";
  const image = document.createElement("img");
  image.setAttribute("src", resized);
  image.setAttribute("srcset", `${toCanvasImageUrl(LARGE, PROXY)} 2x`);
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
  const resized = toCanvasImageUrl(PHOTO, PROXY) ?? "";
  document.body.innerHTML = `<picture><source srcset="${toCanvasImageUrl(LARGE, PROXY)?.replace(/&/g, "&amp;")} 2x"><img src="${resized.replace(/&/g, "&amp;")}"></picture>`;
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

it("restores CSS background URLs in style attributes and style text of a cloned tree", () => {
  const resized = toCanvasImageUrl(PHOTO, PROXY) ?? "";
  const large = toCanvasImageUrl(LARGE, PROXY) ?? "";
  const root = document.createElement("div");
  root.innerHTML = `<style>.hero{background-image:url("${resized}")}</style><div style="background:url(${large.replace(/&/g, "&amp;")}) center"></div><img src="${resized.replace(/&/g, "&amp;")}">`;
  restoreCanvasImageSources(root, ORIGIN);
  expect(root.querySelector("style")?.textContent).toBe(
    `.hero{background-image:url("${PHOTO}")}`,
  );
  expect(root.querySelector("div")?.getAttribute("style")).toBe(
    `background:url(${LARGE}) center`,
  );
  expect(root.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
  expect(root.innerHTML).not.toContain("/api/canvas-image");
});
