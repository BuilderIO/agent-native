// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pending: false,
  activate: vi.fn<() => Promise<"connected" | "fallback" | "disabled">>(),
}));

vi.mock("@agent-native/core/client/auth/builder-signup", () => ({
  hasPendingBuilderSignupAssignment: () => mocks.pending,
  activateBuilderSignupAssignment: mocks.activate,
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  track: vi.fn(),
}));

import { BuilderSignupActivation } from "./BuilderSignupActivation";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {`count ${count}`}
    </button>
  );
}

let container: HTMLDivElement;
let root: Root;
const queryClient = new QueryClient();

async function render(userId: string | undefined) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <BuilderSignupActivation userId={userId}>
          <Counter />
        </BuilderSignupActivation>
      </QueryClientProvider>,
    );
  });
}

async function clickCounter() {
  await act(async () => {
    container.querySelector("button")?.click();
  });
}

describe("BuilderSignupActivation", () => {
  beforeEach(() => {
    mocks.pending = false;
    mocks.activate.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps children mounted when the session resolves", async () => {
    await render(undefined);
    await clickCounter();
    await render("user-1");

    expect(container.querySelector("button")?.textContent).toBe("count 1");
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("covers children during a pending activation without remounting them", async () => {
    mocks.pending = true;
    let finish: (value: "connected") => void = () => {};
    mocks.activate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await render(undefined);
    await clickCounter();
    await render("user-2");

    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("count 1");

    mocks.pending = false;
    await act(async () => finish("connected"));

    expect(container.querySelector("[aria-busy='true']")).toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("count 1");
    expect(invalidate).toHaveBeenCalled();
  });
});
