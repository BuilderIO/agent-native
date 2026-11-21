// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

import { postScreenSettled, SCREEN_SETTLED_EVENT } from "./screen-settled.js";

vi.mock("./frame.js", () => ({
  getFramePostMessageTargetOrigin: () => "https://parent.example.test",
}));

afterEach(() => vi.unstubAllGlobals());

it("delivers the same settled receipt to the document and its parent", () => {
  const dispatchEvent = vi.fn();
  const postMessage = vi.fn();
  vi.stubGlobal("window", { dispatchEvent, parent: { postMessage } });
  postScreenSettled("write-1", "/items/one");
  postScreenSettled("write-1", "/items/one");
  const detail = {
    type: SCREEN_SETTLED_EVENT,
    writeId: "write-1",
    url: "/items/one",
    screenSummary: { title: document.title, route: "/items/one" },
  };
  expect(dispatchEvent).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ detail }),
  );
  expect(postMessage).toHaveBeenCalledExactlyOnceWith(
    detail,
    "https://parent.example.test",
  );
});
