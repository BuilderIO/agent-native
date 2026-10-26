// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDocumentStatusController,
  type StatusFaviconRenderer,
} from "./document-status.js";

const labels = {
  running: (title: string) => `Working · ${title}`,
  replyReady: (title: string) => `Reply ready · ${title}`,
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("document status controller", () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any"><link rel="apple-touch-icon" href="/touch.png">';
    document.title = "Inbox";
  });

  afterEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("prefixes the title while running and for a ready reply, then restores it", () => {
    const controller = createDocumentStatusController({ labels });
    controller.setStatus("running");
    expect(document.title).toBe("Working · Inbox");
    controller.setStatus("reply-ready");
    expect(document.title).toBe("Reply ready · Inbox");
    controller.setStatus("idle");
    expect(document.title).toBe("Inbox");
    controller.dispose();
  });

  it("keeps a title the app sets while decorated as the new base", async () => {
    const controller = createDocumentStatusController({ labels });
    controller.setStatus("running");
    document.title = "Settings";
    await settle();
    expect(document.title).toBe("Working · Settings");
    controller.setStatus("idle");
    expect(document.title).toBe("Settings");
    controller.dispose();
  });

  it("maps a stale decorated title put back by the app to its base", async () => {
    const controller = createDocumentStatusController({ labels });
    controller.setStatus("running");
    controller.setStatus("reply-ready");
    // A title guard restoring the last readable title it saw.
    document.title = "Working · Inbox";
    await settle();
    expect(document.title).toBe("Reply ready · Inbox");
    controller.dispose();
    expect(document.title).toBe("Inbox");
  });

  it("draws the status on every icon link and restores each attribute exactly", async () => {
    const renderFavicon = vi.fn<StatusFaviconRenderer>(
      async (_source, status) => `data:image/png;base64,${status}`,
    );
    const controller = createDocumentStatusController({
      labels,
      renderFavicon,
    });
    controller.setStatus("running");
    await settle();
    const icon =
      document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    expect(renderFavicon).toHaveBeenCalledWith(
      new URL("/icon.svg", document.baseURI).href,
      "running",
    );
    expect(icon.getAttribute("href")).toBe("data:image/png;base64,running");
    expect(icon.getAttribute("type")).toBe("image/png");
    expect(icon.hasAttribute("sizes")).toBe(false);
    // Only `rel~="icon"` links are decorated.
    expect(
      document.head
        .querySelector('link[rel="apple-touch-icon"]')
        ?.getAttribute("href"),
    ).toBe("/touch.png");

    controller.setStatus("reply-ready");
    await settle();
    expect(icon.getAttribute("href")).toBe("data:image/png;base64,reply-ready");

    controller.setStatus("idle");
    expect(icon.getAttribute("href")).toBe("/icon.svg");
    expect(icon.getAttribute("type")).toBe("image/svg+xml");
    expect(icon.getAttribute("sizes")).toBe("any");
    controller.dispose();
  });

  it("leaves the favicon alone when the icon cannot be drawn", async () => {
    const controller = createDocumentStatusController({
      labels,
      renderFavicon: async () => null,
    });
    controller.setStatus("running");
    await settle();
    expect(
      document.head.querySelector('link[rel="icon"]')?.getAttribute("href"),
    ).toBe("/icon.svg");
    controller.dispose();
  });

  it("drops a drawing that resolves after the status cleared", async () => {
    let resolve!: (value: string) => void;
    const controller = createDocumentStatusController({
      labels,
      renderFavicon: () => new Promise((done) => (resolve = done)),
    });
    controller.setStatus("running");
    controller.setStatus("idle");
    resolve("data:image/png;base64,late");
    await settle();
    expect(
      document.head.querySelector('link[rel="icon"]')?.getAttribute("href"),
    ).toBe("/icon.svg");
    controller.dispose();
  });

  it("adds a temporary icon link when the page has none and removes it on clear", async () => {
    document.head.innerHTML = "";
    const controller = createDocumentStatusController({
      labels,
      renderFavicon: async () => "data:image/png;base64,dot",
    });
    controller.setStatus("running");
    await settle();
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    controller.setStatus("idle");
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(0);
    controller.dispose();
  });
});
