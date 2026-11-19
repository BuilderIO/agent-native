// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentImages } from "./CommentImages";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { name?: string }) =>
    options?.name === undefined ? key : `${key}:${options.name}`,
}));

describe("CommentImages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function button(label: string): HTMLButtonElement {
    const found = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!found) throw new Error(`No button labelled ${label}`);
    return found;
  }

  it("hands focus back to the thumbnail when the viewer closes after a zoom", async () => {
    await act(async () =>
      root.render(
        <CommentImages
          images={[
            {
              url: "/api/private-media/shot",
              name: "shot.png",
              contentType: "image/png",
            },
          ]}
        />,
      ),
    );
    const thumbnail = button("comments.openImage:shot.png");
    thumbnail.focus();
    await act(async () => thumbnail.click());

    const zoomIn = button("editor.media.zoomIn");
    zoomIn.focus();
    await act(async () => zoomIn.click());
    expect(zoomIn.disabled).toBe(true);

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(document.querySelector(".media-lightbox")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(thumbnail));
  });
});
