import * as parse5 from "parse5";
import { expect, it, vi } from "vitest";

import {
  buildCodeLayerProjection,
  structurePreservingEditTarget,
} from "./code-layer";
import { assertDesignHtmlEditIntegrity } from "./html-integrity";

vi.mock("parse5", async (importOriginal) => {
  const actual = await importOriginal<typeof import("parse5")>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

const doc = (body: string) =>
  `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body>${body}</body></html>`;

const edit = (previousContent: string, nextContent: string) =>
  assertDesignHtmlEditIntegrity({
    previousContent,
    nextContent,
    fileType: "html",
  });

it("lets a style or text edit of a validated document skip the re-parse", () => {
  const loaded = doc('<main><p style="color: red">Hello</p></main>');
  const first = loaded.replace("Hello", "Hi");
  edit(loaded, first);
  buildCodeLayerProjection(first);

  const parse = vi.mocked(parse5.parse);
  parse.mockClear();
  const restyled = first.replace("color: red", "color: blue");
  edit(first, restyled);
  buildCodeLayerProjection(restyled);
  edit(restyled, restyled.replace("Hi", "Howdy"));
  expect(parse).not.toHaveBeenCalled();

  expect(() =>
    edit(restyled, restyled.replace("</p>", "</p></span>")),
  ).toThrow();
  expect(parse).toHaveBeenCalled();
});

it("fully checks a structure-preserving edit of a document it never validated", () => {
  const broken = doc('<main><div style="color: red">Hello</main>');
  buildCodeLayerProjection(broken);
  expect(() =>
    edit(broken, broken.replace("color: red", "color: blue")),
  ).toThrow();
});

it("fully checks a CSS edit inside a style block of a validated document", () => {
  const valid = doc("<style>main { color: red; }</style><main>Hello</main>");
  edit(valid, valid.replace("Hello", "Hi"));
  const previous = valid.replace("Hello", "Hi");
  buildCodeLayerProjection(previous);

  expect(() =>
    edit(previous, previous.replace("color: red; }", "color: red;")),
  ).toThrow();
});

it("fully checks a style edit that unhides an x-cloak element", () => {
  const alpine =
    '<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>';
  const valid = doc(
    `${alpine}<div x-data="{}" x-cloak style="display: none">Menu</div>`,
  );
  edit(valid, valid.replace("Menu", "Menus"));
  const previous = valid.replace("Menu", "Menus");
  buildCodeLayerProjection(previous);

  expect(() =>
    edit(previous, previous.replace("display: none", "color: red")),
  ).toThrow();
});

it("never treats an edit inside a script or style block as structure-preserving", () => {
  const page = doc(
    "<style>main { color: red; }</style><script>let x = 1;</script><main>Hi</main>",
  );
  buildCodeLayerProjection(page);

  expect(
    structurePreservingEditTarget(
      page,
      page.replace("color: red", "color: blue"),
    ),
  ).toBeNull();
  expect(
    structurePreservingEditTarget(page, page.replace("let x = 1", "let x = 2")),
  ).toBeNull();
  expect(
    structurePreservingEditTarget(page, page.replace(">Hi<", ">Hey<")),
  ).not.toBeNull();
});
