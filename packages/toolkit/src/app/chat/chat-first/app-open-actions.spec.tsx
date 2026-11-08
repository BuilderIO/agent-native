// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppOpenActions } from "./app-open-actions.js";

describe("AppOpenActions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ["link", { href: "https://clips.example.test", external: true }],
    ["button", { onOpen: () => {} }],
  ] as const)(
    "names the %s Open control after the app",
    async (_kind, props) => {
      await act(async () => {
        root.render(
          <AppOpenActions
            name="Clips"
            labels={{ openApp: "Open", openAppAccessible: "Open Clips" }}
            {...props}
          />,
        );
      });

      expect(
        container
          .querySelector(".app-open-actions__primary")
          ?.getAttribute("aria-label"),
      ).toBe("Open Clips");
    },
  );
});
