// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { sizeNeedsMeasurement } from "../edit-panel/element-classification";
import { requestSelectionMeasurement } from "./measure-selection";

describe("sizeNeedsMeasurement", () => {
  it.each([
    "fit-content",
    "auto",
    "max-content",
    "min-content",
    "100%",
    ".5rem",
  ])("flags %s as unresolvable by the host", (value) => {
    expect(sizeNeedsMeasurement({ width: value })).toBe(true);
  });

  it.each(["180px", "12.5px", "0px", "0"])(
    "trusts the px size %s as-is",
    (value) => {
      expect(sizeNeedsMeasurement({ width: value })).toBe(false);
    },
  );

  it("checks height as well as width", () => {
    expect(sizeNeedsMeasurement({ height: "fit-content" })).toBe(true);
  });

  it("ignores properties that are not a size", () => {
    expect(sizeNeedsMeasurement({ flexBasis: "auto", color: "red" })).toBe(
      false,
    );
  });
});

describe("requestSelectionMeasurement", () => {
  const rect = { x: 0, y: 0, width: 101, height: 20 };

  /** A frame that answers the correlated request with `payload`. */
  function frame(payload: unknown): Window {
    const target = {
      postMessage: (message: { correlationId: string }) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selection-measured",
              correlationId: message.correlationId,
              payload,
            },
            source: target,
          }),
        );
      },
    } as unknown as Window;
    return target;
  }

  it("resolves with the measurement from the frame that has the element", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: [
        frame(null),
        frame({ tagName: "div", boundingRect: rect }),
      ],
      selector: '[data-agent-native-node-id="a"]',
    });
    expect(measured?.boundingRect.width).toBe(101);
  });

  it("keeps waiting past a frame that does not have the element", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: [frame(null), frame(null)],
      timeoutMs: 30,
    });
    expect(measured).toBeNull();
  });

  it("ignores a reply from a window that was never asked", async () => {
    const asked = frame(null);
    const promise = requestSelectionMeasurement({
      targetWindows: [asked],
      timeoutMs: 40,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agent-native:selection-measured",
          correlationId: "measure-anything",
          payload: { tagName: "div", boundingRect: rect },
        },
        source: {} as Window,
      }),
    );
    expect(await promise).toBeNull();
  });

  it("does not post when there is no live preview frame", async () => {
    const post = vi.fn();
    expect(
      await requestSelectionMeasurement({
        targetWindows: [null, undefined],
      }),
    ).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
