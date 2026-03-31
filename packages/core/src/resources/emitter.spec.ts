import { describe, it, expect, vi } from "vitest";
import {
  getResourcesEmitter,
  emitResourceChange,
  emitResourceDelete,
  type ResourceEvent,
} from "./emitter.js";

describe("getResourcesEmitter", () => {
  it("returns a singleton EventEmitter", () => {
    const a = getResourcesEmitter();
    const b = getResourcesEmitter();
    expect(a).toBe(b);
  });
});

describe("emitResourceChange", () => {
  it("emits a resources change event", () => {
    const emitter = getResourcesEmitter();
    const handler = vi.fn();
    emitter.on("resources", handler);

    emitResourceChange("id-1", "README.md", "user@test.com");

    expect(handler).toHaveBeenCalledOnce();
    const event: ResourceEvent = handler.mock.calls[0][0];
    expect(event.source).toBe("resources");
    expect(event.type).toBe("change");
    expect(event.id).toBe("id-1");
    expect(event.path).toBe("README.md");
    expect(event.owner).toBe("user@test.com");
    expect(event.requestSource).toBeUndefined();

    emitter.removeListener("resources", handler);
  });

  it("includes requestSource when provided", () => {
    const emitter = getResourcesEmitter();
    const handler = vi.fn();
    emitter.on("resources", handler);

    emitResourceChange("id-1", "README.md", "user@test.com", "tab-1");

    const event: ResourceEvent = handler.mock.calls[0][0];
    expect(event.requestSource).toBe("tab-1");

    emitter.removeListener("resources", handler);
  });

  it("omits requestSource when not provided", () => {
    const emitter = getResourcesEmitter();
    const handler = vi.fn();
    emitter.on("resources", handler);

    emitResourceChange("id-1", "file.md", "owner");

    const event: ResourceEvent = handler.mock.calls[0][0];
    expect("requestSource" in event).toBe(false);

    emitter.removeListener("resources", handler);
  });
});

describe("emitResourceDelete", () => {
  it("emits a resources delete event", () => {
    const emitter = getResourcesEmitter();
    const handler = vi.fn();
    emitter.on("resources", handler);

    emitResourceDelete("id-2", "old-file.md", "owner");

    expect(handler).toHaveBeenCalledOnce();
    const event: ResourceEvent = handler.mock.calls[0][0];
    expect(event.source).toBe("resources");
    expect(event.type).toBe("delete");
    expect(event.id).toBe("id-2");
    expect(event.path).toBe("old-file.md");
    expect(event.owner).toBe("owner");

    emitter.removeListener("resources", handler);
  });

  it("includes requestSource when provided", () => {
    const emitter = getResourcesEmitter();
    const handler = vi.fn();
    emitter.on("resources", handler);

    emitResourceDelete("id-2", "file.md", "owner", "src");

    const event: ResourceEvent = handler.mock.calls[0][0];
    expect(event.requestSource).toBe("src");

    emitter.removeListener("resources", handler);
  });
});
