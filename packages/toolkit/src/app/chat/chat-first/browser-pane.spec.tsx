// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatFirstBrowserPane } from "./browser-pane.js";

describe("ChatFirstBrowserPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not iframe Builder Visual Editor pages", () => {
    const url = "https://builder.io/app/projects/project-123/branch/qa-branch";

    act(() => {
      root.render(
        <ChatFirstBrowserPane
          url={url}
          onClose={vi.fn()}
          renderEmbed={() => <iframe data-testid="embedded-page" />}
        />,
      );
    });

    expect(container.querySelector("[data-testid='embedded-page']")).toBeNull();
    expect(
      container.querySelector(`a[href="${url}"][target="_blank"]`),
    ).not.toBeNull();
  });

  it("keeps ordinary browser pages in the embedded surface", () => {
    act(() => {
      root.render(
        <ChatFirstBrowserPane
          url="https://example.com/docs"
          onClose={vi.fn()}
          renderEmbed={() => <iframe data-testid="embedded-page" />}
        />,
      );
    });

    expect(
      container.querySelector("[data-testid='embedded-page']"),
    ).not.toBeNull();
  });
});
