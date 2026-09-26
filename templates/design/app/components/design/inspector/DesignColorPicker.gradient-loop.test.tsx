// @vitest-environment happy-dom


import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DesignColorPicker } from "./DesignColorPicker";

let container: HTMLDivElement;
let root: Root;
let uncaught: unknown[] = [];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  uncaught = [];
  root = createRoot(container, {
    onUncaughtError: (error) => uncaught.push(error),
    onCaughtError: (error) => uncaught.push(error),
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DesignColorPicker gradient paint type", () => {
  it(
    "settles instead of looping when paintType is a gradient",
    { timeout: 20_000 },
    () => {
      let thrown: unknown = null;
      try {
        act(() => {
          root.render(
            <DesignColorPicker
              value="#ff0000"
              paintType="linear"
              onChange={() => {}}
            />,
          );
        });
      } catch (error) {
        thrown = error;
      }

      const messages = [thrown, ...uncaught]
        .filter(Boolean)
        .map((error) => (error as Error).message ?? String(error));
      expect(messages.join(" | ")).not.toContain("Maximum update depth");
      expect(thrown).toBeNull();
    },
  );
});
