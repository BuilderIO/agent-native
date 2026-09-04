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
  function frame(payload: unknown, screenId = "screen-1"): Window {
    const target = {
      postMessage: (message: { correlationId: string }) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selection-measured",
              correlationId: message.correlationId,
              screenId,
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
      targetWindows: () => [
        frame(null),
        frame({ tagName: "div", boundingRect: rect }),
      ],
      screenId: "screen-1",
      selector: '[data-agent-native-node-id="a"]',
    });
    expect(measured?.boundingRect.width).toBe(101);
  });

  it("keeps waiting past a frame that does not have the element", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: () => [frame(null), frame(null)],
      screenId: "screen-1",
      attempts: 1,
      timeoutMs: 30,
    });
    expect(measured).toBeNull();
  });

  it("ignores a reply from a window that was never asked", async () => {
    const asked = frame(null);
    const promise = requestSelectionMeasurement({
      targetWindows: () => [asked],
      screenId: "screen-1",
      attempts: 1,
      timeoutMs: 40,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agent-native:selection-measured",
          correlationId: "measure-anything",
          screenId: "screen-1",
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
        targetWindows: () => [null, undefined],
        screenId: "screen-1",
      }),
    ).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores a positive match from a different screen", async () => {
    // Breakpoint screens share node ids, so the same selector resolves in
    // more than one frame.
    const measured = await requestSelectionMeasurement({
      targetWindows: () => [
        frame({ tagName: "div", boundingRect: rect }, "screen-mobile"),
      ],
      screenId: "screen-desktop",
      attempts: 1,
      timeoutMs: 40,
    });
    expect(measured).toBeNull();
  });

  it("retries so a frame whose bridge installs late still answers", async () => {
    // The iframe exposes contentWindow before the bridge listener exists, so
    // the first post is dropped.
    let installed = false;
    const target = {
      postMessage: (message: { correlationId: string }) => {
        if (!installed) return;
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selection-measured",
              correlationId: message.correlationId,
              screenId: "screen-1",
              payload: { tagName: "div", boundingRect: rect },
            },
            source: target,
          }),
        );
      },
    } as unknown as Window;
    window.setTimeout(() => {
      installed = true;
    }, 60);

    const measured = await requestSelectionMeasurement({
      targetWindows: () => [target],
      screenId: "screen-1",
      attempts: 3,
      timeoutMs: 40,
      retryDelayMs: 40,
    });
    expect(measured?.boundingRect.width).toBe(101);
  });

  it("sees a frame that only mounts after the first attempt", async () => {
    const late: Window[] = [];
    window.setTimeout(() => {
      late.push(frame({ tagName: "div", boundingRect: rect }));
    }, 60);

    const measured = await requestSelectionMeasurement({
      targetWindows: () => late,
      screenId: "screen-1",
      attempts: 3,
      timeoutMs: 40,
      retryDelayMs: 40,
    });
    expect(measured?.boundingRect.width).toBe(101);
  });
});
