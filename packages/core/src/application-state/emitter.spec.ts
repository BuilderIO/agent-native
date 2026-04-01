import { describe, it, expect, vi } from "vitest";
import {
  getAppStateEmitter,
  emitAppStateChange,
  emitAppStateDelete,
  type AppStateEvent,
} from "./emitter.js";

describe("getAppStateEmitter", () => {
  it("returns an EventEmitter singleton", () => {
    const a = getAppStateEmitter();
    const b = getAppStateEmitter();
    expect(a).toBe(b);
  });
});

describe("emitAppStateChange", () => {
  it("emits an app-state change event with key", () => {
    const emitter = getAppStateEmitter();
    const handler = vi.fn();
    emitter.on("app-state", handler);

    emitAppStateChange("my-key");

    expect(handler).toHaveBeenCalledOnce();
    const event: AppStateEvent = handler.mock.calls[0][0];
    expect(event.source).toBe("app-state");
    expect(event.type).toBe("change");
    expect(event.key).toBe("my-key");
    expect(event.requestSource).toBeUndefined();

    emitter.removeListener("app-state", handler);
  });

  it("includes requestSource when provided", () => {
    const emitter = getAppStateEmitter();
    const handler = vi.fn();
    emitter.on("app-state", handler);

    emitAppStateChange("my-key", "tab-1");

    const event: AppStateEvent = handler.mock.calls[0][0];
    expect(event.requestSource).toBe("tab-1");

    emitter.removeListener("app-state", handler);
  });

  it("omits requestSource when undefined", () => {
    const emitter = getAppStateEmitter();
    const handler = vi.fn();
    emitter.on("app-state", handler);

    emitAppStateChange("my-key", undefined);

    const event: AppStateEvent = handler.mock.calls[0][0];
    expect("requestSource" in event).toBe(false);

    emitter.removeListener("app-state", handler);
  });
});

describe("emitAppStateDelete", () => {
  it("emits an app-state delete event", () => {
    const emitter = getAppStateEmitter();
    const handler = vi.fn();
    emitter.on("app-state", handler);

    emitAppStateDelete("del-key");

    expect(handler).toHaveBeenCalledOnce();
    const event: AppStateEvent = handler.mock.calls[0][0];
    expect(event.source).toBe("app-state");
    expect(event.type).toBe("delete");
    expect(event.key).toBe("del-key");

    emitter.removeListener("app-state", handler);
  });

  it("includes requestSource when provided", () => {
    const emitter = getAppStateEmitter();
    const handler = vi.fn();
    emitter.on("app-state", handler);

    emitAppStateDelete("del-key", "tab-2");

    const event: AppStateEvent = handler.mock.calls[0][0];
    expect(event.requestSource).toBe("tab-2");

    emitter.removeListener("app-state", handler);
  });
});
