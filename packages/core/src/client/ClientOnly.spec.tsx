// @vitest-environment happy-dom

const hookSpies = vi.hoisted(() => ({
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  hookSpies.useEffect.mockImplementation(actual.useEffect);
  hookSpies.useLayoutEffect.mockImplementation(actual.useLayoutEffect);
  return {
    ...actual,
    useEffect: hookSpies.useEffect,
    useLayoutEffect: hookSpies.useLayoutEffect,
  };
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientOnly } from "./ClientOnly.js";

describe("ClientOnly", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    hookSpies.useEffect.mockClear();
    hookSpies.useLayoutEffect.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("selects the browser layout effect for the SSR handoff", () => {
    const app = (
      <ClientOnly fallback={<div data-testid="loading" />}>
        <div data-testid="content">App</div>
      </ClientOnly>
    );

    expect(renderToString(app)).toContain('data-testid="loading"');

    // DOM assertions after act flush both effect types. Observe the hook
    // selected for the browser handoff instead.
    act(() => root.render(app));

    expect(hookSpies.useLayoutEffect).toHaveBeenCalledWith(
      expect.any(Function),
      [],
    );
    expect(hookSpies.useEffect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
  });
});
