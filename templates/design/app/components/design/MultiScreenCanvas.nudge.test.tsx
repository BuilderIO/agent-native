// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("MultiScreenCanvas keyboard nudge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("moves by the configured amount even when alignment snapping is nearby", async () => {
    let committedX: number | undefined;
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "anchor", filename: "anchor.html", content: "" },
            { id: "selected", filename: "selected.html", content: "" },
          ]}
          zoom={100}
          creation={{ activeTool: "move" }}
          geometry={{
            geometryById: {
              anchor: { x: 0, y: 0, width: 100, height: 100 },
              selected: { x: 100, y: 0, width: 100, height: 100 },
            },
            onGeometryCommit: (_before, after) => {
              committedX = after.selected?.x;
            },
          }}
          selection={{ selectedScreenIds: ["selected"] }}
          onPick={() => {}}
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(committedX).toBe(101);
  });
});
