// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebGlWaveBackground } from "./WebGlWaveBackground.js";

let intersectionObserver: TestIntersectionObserver | undefined;

class TestIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {
    intersectionObserver = this;
  }

  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = () => [];

  notify(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  intersectionObserver = undefined;
});

describe("WebGlWaveBackground", () => {
  it("stops requesting frames while outside the viewport", () => {
    let nextFrameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      callbacks.set(id, callback);
      return id;
    });
    const cancelFrame = vi.fn((id: number) => callbacks.delete(id));
    const gl = {
      ARRAY_BUFFER: 34962,
      COMPILE_STATUS: 35713,
      FRAGMENT_SHADER: 35632,
      LINK_STATUS: 35714,
      STATIC_DRAW: 35044,
      TRIANGLES: 4,
      VERTEX_SHADER: 35633,
      attachShader: vi.fn(),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      compileShader: vi.fn(),
      createBuffer: vi.fn(() => ({})),
      createProgram: vi.fn(() => ({})),
      createShader: vi.fn(() => ({})),
      deleteBuffer: vi.fn(),
      deleteProgram: vi.fn(),
      deleteShader: vi.fn(),
      drawArrays: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      getAttribLocation: vi.fn(() => 0),
      getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
      getProgramParameter: vi.fn(() => true),
      getShaderParameter: vi.fn(() => true),
      getUniformLocation: vi.fn(() => ({})),
      linkProgram: vi.fn(),
      shaderSource: vi.fn(),
      uniform1f: vi.fn(),
      uniform2f: vi.fn(),
      uniform3f: vi.fn(),
      useProgram: vi.fn(),
      vertexAttribPointer: vi.fn(),
      viewport: vi.fn(),
    } as unknown as WebGLRenderingContext;

    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => gl) as typeof HTMLCanvasElement.prototype.getContext,
    );

    render(<WebGlWaveBackground />);

    expect(intersectionObserver).toBeDefined();
    act(() => intersectionObserver?.notify(false));
    expect(requestFrame).not.toHaveBeenCalled();

    act(() => intersectionObserver?.notify(true));
    expect(requestFrame).toHaveBeenCalledTimes(1);

    act(() => callbacks.get(1)?.(40));
    expect(requestFrame).toHaveBeenCalledTimes(2);

    const cancelledCallback = callbacks.get(2);
    act(() => intersectionObserver?.notify(false));
    expect(cancelFrame).toHaveBeenCalledWith(2);

    act(() => cancelledCallback?.(80));
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });
});
