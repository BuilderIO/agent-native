// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

import { postScreenSettled, SCREEN_SETTLED_EVENT } from "./screen-settled.js";

vi.mock("./api-path.js", () => ({ resolveAppBasePath: () => "/items-app" }));

vi.mock("./frame.js", () => ({
  getFrameOrigin: () => "https://parent.example.test",
  isKnownFrameHostOrigin: () => true,
}));

afterEach(() => vi.unstubAllGlobals());

it("delivers the same settled receipt to the document and its parent", () => {
  const dispatchEvent = vi.fn();
  const postMessage = vi.fn();
  vi.stubGlobal("window", { dispatchEvent, parent: { postMessage } });
  postScreenSettled({ writeId: "write-1", url: "/items/one", tabId: "tab-1" });
  postScreenSettled({ writeId: "write-1", url: "/items/one", tabId: "tab-1" });
  const detail = {
    type: SCREEN_SETTLED_EVENT,
    writeId: "write-1",
    tabId: "tab-1",
    appBasePath: "/items-app",
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
