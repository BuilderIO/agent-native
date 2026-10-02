import * as parse5 from "parse5";
import { expect, it, vi } from "vitest";

import { buildCodeLayerProjection } from "./code-layer";
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
