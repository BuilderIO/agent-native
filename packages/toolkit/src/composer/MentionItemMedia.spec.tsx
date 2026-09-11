// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MentionItemMedia } from "./MentionItemMedia.js";
import { ComposerRuntimeAdaptersProvider } from "./runtime-adapters.js";
import type { MentionItemMedia as MentionItemMediaValue } from "./types.js";

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

describe("MentionItemMedia", () => {
  it("keeps the legacy icon when no media is configured", () => {
    act(() => root.render(<MentionItemMedia icon="agent" />));

    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders provider-defined text and background", () => {
    act(() =>
      root.render(
        <MentionItemMedia
          icon="agent"
          media={{
            type: "text",
            text: "🏠",
            backgroundColor: "rgb(15, 118, 110)",
          }}
        />,
      ),
    );

    expect(container.textContent).toBe("🏠");
    expect(container.querySelector("svg")).toBeNull();
    const frame = container.querySelector("span");
    expect(frame?.className).toContain("size-5");
    expect(frame?.firstElementChild?.className).toContain("size-3");
    expect(frame?.firstElementChild?.className).toContain("text-[9px]");
    expect(frame?.style.backgroundColor).toBe("rgb(15, 118, 110)");
  });

  it("allows providers to omit leading media explicitly", () => {
    act(() =>
      root.render(<MentionItemMedia icon="agent" media={{ type: "none" }} />),
    );

    expect(container.innerHTML).toBe("");
  });

  it("falls back to the legacy icon for empty text media", () => {
    act(() =>
      root.render(
        <MentionItemMedia icon="agent" media={{ type: "text", text: " " }} />,
      ),
    );

    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a contained image without leaking a referrer", () => {
    act(() =>
      root.render(
        <MentionItemMedia
          icon="agent"
          media={{ type: "image", src: "/agent.png" }}
        />,
      ),
    );

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/agent.png");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.className).toContain("size-3");
    expect(image?.className).toContain("object-contain");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("resolves root-relative images against the app mount", () => {
    act(() =>
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{ resolvePath: (path) => `/assets${path}` }}
        >
          <MentionItemMedia media={{ type: "image", src: "/agent.png" }} />
        </ComposerRuntimeAdaptersProvider>,
      ),
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/agent.png",
    );
  });

  it("leaves absolute image URLs unchanged", () => {
    act(() =>
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{ resolvePath: (path) => `/assets${path}` }}
        >
          <MentionItemMedia
            media={{ type: "image", src: "https://example.com/agent.png" }}
          />
        </ComposerRuntimeAdaptersProvider>,
      ),
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/agent.png",
    );
  });

  it.each([{ type: "text" }, { type: "image", src: null }])(
    "falls back safely for malformed media",
    (media) => {
      act(() =>
        root.render(
          <MentionItemMedia
            icon="agent"
            media={media as unknown as MentionItemMediaValue}
          />,
        ),
      );

      expect(container.querySelector("svg")).not.toBeNull();
    },
  );

  it("preserves the compact clipboard fallback for slot references", () => {
    act(() =>
      root.render(<MentionItemMedia size="sm" fallbackIcon="clipboard" />),
    );

    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "size-3",
    );
  });
});
