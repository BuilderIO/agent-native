// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PrivateContentSurface from "./PrivateContentSurface.js";

describe("PrivateContentSurface privacy disclosure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        privateContent: {
          health: vi.fn(async () => ({ ok: false, error: "locked" })),
          list: vi.fn(async () => ({ ok: true, value: { documents: [] } })),
        },
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("names both intentional readers and visible hosted metadata", async () => {
    await act(async () => {
      root.render(<PrivateContentSurface onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "Hosted Content cannot read your pages.",
    );
    expect(container.textContent).toContain(
      "Ciphertext sizes, timing, and access patterns remain visible.",
    );
    expect(container.textContent).toContain(
      "Your chosen agent can read what you ask it to use.",
    );
    expect(container.textContent).toContain(
      "The model provider you choose can read that specific text.",
    );
    expect(container.textContent).not.toMatch(/zero.knowledge/i);
  });
});
