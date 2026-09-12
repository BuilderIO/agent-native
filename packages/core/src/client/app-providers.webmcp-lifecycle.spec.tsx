// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registrationFactory = vi.hoisted(() => vi.fn());

vi.mock("./webmcp.js", () => ({
  createAgentNativeServerActionWebMcpRegistration: registrationFactory,
}));

import { AgentNativeWebMcpActionRegistration } from "./app-providers.js";

// Registration ownership is local to each mount: two coexisting provider
// surfaces each create their own registration, and unmounting one stops only
// the registration its own effect created — never the other surface's.
describe("WebMCP registration lifecycle ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let stops: Array<ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    stops = [];
    let instance = 0;
    registrationFactory.mockReset();
    registrationFactory.mockImplementation(() => {
      const id = instance++;
      const stop = vi.fn();
      stops[id] = stop;
      return {
        supported: true,
        registered: 0,
        start: vi.fn(async () => {}),
        stop,
      };
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("stops only the unmounted surface's registration", () => {
    act(() => {
      root.render(
        <>
          <AgentNativeWebMcpActionRegistration key="a" />
          <AgentNativeWebMcpActionRegistration key="b" />
        </>,
      );
    });
    expect(registrationFactory).toHaveBeenCalledTimes(2);

    act(() => {
      root.render(
        <>
          <AgentNativeWebMcpActionRegistration key="b" />
        </>,
      );
    });
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(stops[1]).not.toHaveBeenCalled();

    act(() => {
      root.render(null);
    });
    expect(stops[1]).toHaveBeenCalledTimes(1);
  });

  it("stops only the unmounted surface's registration in the reverse order", () => {
    act(() => {
      root.render(
        <>
          <AgentNativeWebMcpActionRegistration key="a" />
          <AgentNativeWebMcpActionRegistration key="b" />
        </>,
      );
    });
    expect(registrationFactory).toHaveBeenCalledTimes(2);

    act(() => {
      root.render(
        <>
          <AgentNativeWebMcpActionRegistration key="a" />
        </>,
      );
    });
    expect(stops[1]).toHaveBeenCalledTimes(1);
    expect(stops[0]).not.toHaveBeenCalled();

    act(() => {
      root.render(null);
    });
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });
});
