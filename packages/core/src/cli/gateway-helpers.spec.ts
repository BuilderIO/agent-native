import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { attachGatewaySocketErrorSink } from "./gateway-helpers.js";

describe("attachGatewaySocketErrorSink", () => {
  it("handles socket error events without throwing", () => {
    const socket = new EventEmitter();
    const onError = vi.fn();
    const error = new Error("read ECONNRESET");

    attachGatewaySocketErrorSink(socket, onError);

    expect(() => socket.emit("error", error)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("only attaches one sink per socket", () => {
    const socket = new EventEmitter();
    const first = vi.fn();
    const second = vi.fn();

    attachGatewaySocketErrorSink(socket, first);
    attachGatewaySocketErrorSink(socket, second);

    expect(socket.listenerCount("error")).toBe(1);
    socket.emit("error", new Error("write EPIPE"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
