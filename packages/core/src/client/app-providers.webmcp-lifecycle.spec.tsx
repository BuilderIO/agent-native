// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registrationFactory = vi.hoisted(() => vi.fn());
const sessionStatus = vi.hoisted(() => ({ value: "authenticated" }));

vi.mock("./webmcp.js", () => ({
  createAgentNativeServerActionWebMcpRegistration: registrationFactory,
}));

vi.mock("./use-session.js", () => ({
  useSession: () => ({ status: sessionStatus.value, session: null }),
}));

import { AgentNativeWebMcpActionRegistration } from "./app-providers.js";

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
    sessionStatus.value = "authenticated";
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

  it("stops only the unmounted surface's registration", async () => {
    act(() => {
      root.render(
        <>
          <AgentNativeWebMcpActionRegistration key="a" />
          <AgentNativeWebMcpActionRegistration key="b" />
        </>,
      );
    });
    await vi.waitFor(() =>
      expect(registrationFactory).toHaveBeenCalledTimes(2),
    );
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

  it("stops only the unmounted surface's registration in the reverse order", async () => {
    act(() => {
      root.render(
        <>
          <AgentNativeWebMcpActionRegistration key="a" />
          <AgentNativeWebMcpActionRegistration key="b" />
        </>,
      );
    });
    await vi.waitFor(() =>
      expect(registrationFactory).toHaveBeenCalledTimes(2),
    );
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

  it("replaces a session-bypass registration when exclusions change", async () => {
    act(() => {
      root.render(
        <AgentNativeWebMcpActionRegistration excludeActionNames={["first"]} />,
      );
    });
    await vi.waitFor(() => {
      expect(registrationFactory).toHaveBeenCalledWith({
        excludeActionNames: ["first"],
      });
    });

    act(() => {
      root.render(
        <AgentNativeWebMcpActionRegistration excludeActionNames={["second"]} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(registrationFactory).toHaveBeenLastCalledWith({
      excludeActionNames: ["second"],
    });
  });

  it("keeps the session-gated registration alive through a transient revalidation and stops it on confirmed sign-out", async () => {
    act(() => {
      root.render(<AgentNativeWebMcpActionRegistration requireSession />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(registrationFactory).toHaveBeenCalledTimes(1);

    sessionStatus.value = "loading";
    act(() => {
      root.render(<AgentNativeWebMcpActionRegistration requireSession />);
    });
    expect(stops[0]).not.toHaveBeenCalled();

    sessionStatus.value = "authenticated";
    act(() => {
      root.render(<AgentNativeWebMcpActionRegistration requireSession />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(registrationFactory).toHaveBeenCalledTimes(1);
    expect(stops[0]).not.toHaveBeenCalled();

    sessionStatus.value = "unauthenticated";
    act(() => {
      root.render(<AgentNativeWebMcpActionRegistration requireSession />);
    });
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it("replaces a session-gated registration when exclusions change", async () => {
    act(() => {
      root.render(
        <AgentNativeWebMcpActionRegistration
          requireSession
          excludeActionNames={["first"]}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(registrationFactory).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        <AgentNativeWebMcpActionRegistration
          requireSession
          excludeActionNames={["second"]}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(registrationFactory).toHaveBeenCalledTimes(2);
    expect(registrationFactory).toHaveBeenLastCalledWith({
      excludeActionNames: ["second"],
    });
  });

  it("stops the session-gated registration on unmount", async () => {
    act(() => {
      root.render(<AgentNativeWebMcpActionRegistration requireSession />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(registrationFactory).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(null);
    });
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });
});
