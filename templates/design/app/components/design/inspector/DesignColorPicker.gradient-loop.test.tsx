// @vitest-environment happy-dom

/**
 * Selecting a gradient paint type must not put the picker into an unbounded
 * render loop.
 *
 * `color` is derived from the `value` string on every render, so an
 * unmemoized derived object churns the identity of every memo that depends on
 * it. `defaultGradient` mints random stop ids, so a churning fallback gradient
 * changes the stop-id list every render, and the effect that keeps
 * `selectedStopId` valid then sets state on every render forever. The popover
 * does not need to be open: `effectivePaintType` follows the `paintType` prop.
 */

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
  // Synchronous act: React then enforces its nested-update cap and throws,
  // instead of an async flush spinning until the worker is killed.
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
