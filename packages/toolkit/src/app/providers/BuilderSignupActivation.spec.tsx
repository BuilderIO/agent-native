// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<"eligible" | "disabled">>(),
  activate: vi.fn<() => Promise<"connected" | "fallback" | "disabled">>(),
}));

vi.mock("@agent-native/core/client/auth/builder-signup", () => ({
  startBuilderSignupActivation: mocks.status,
  activateBuilderSignupAssignment: mocks.activate,
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  track: vi.fn(),
}));

import {
  BuilderSignupActivationCover,
  useBuilderSignupActivation,
} from "./BuilderSignupActivation.js";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {`count ${count}`}
    </button>
  );
}

function Activation({ userId }: { userId: string | undefined }) {
  const { activating, resolving } = useBuilderSignupActivation(
    userId,
    "clips_builder_signup_v1",
  );
  return (
    <BuilderSignupActivationCover activating={activating}>
      <span data-resolving={resolving} />
      <Counter />
    </BuilderSignupActivationCover>
  );
}

let container: HTMLDivElement;
let root: Root;
const queryClient = new QueryClient();

async function render(userId: string | undefined) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Activation userId={userId} />
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
    mocks.status.mockResolvedValue("disabled");
    mocks.activate.mockReset();
    queryClient.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps first-run onboarding suppressed while eligibility resolves without covering existing content", async () => {
    mocks.status.mockReturnValue(new Promise(() => {}));
    await render("pending-user");
    expect(
      container
        .querySelector("[data-resolving]")
        ?.getAttribute("data-resolving"),
    ).toBe("true");
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("keeps the cover after a polling timeout until the server confirms a terminal result", async () => {
    mocks.status.mockResolvedValue("eligible");
    mocks.activate.mockRejectedValue(new Error("polling timed out"));
    await render("timeout-user");
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
    expect(container.querySelector("[role='status']")).not.toBeNull();
    mocks.status.mockResolvedValue("disabled");
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await vi.waitFor(() =>
      expect(container.querySelector("[role='status']")).toBeNull(),
    );
  });

  it("keeps children mounted when the session resolves", async () => {
    await render(undefined);
    await clickCounter();
    await render("user-1");

    expect(container.querySelector("button")?.textContent).toBe("count 1");
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("covers children during a pending activation without remounting them", async () => {
    mocks.status.mockResolvedValue("eligible");
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
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());

    expect(container.querySelector("[role='status']")).not.toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("count 1");
    expect(
      container.querySelector("button")?.closest("[inert]"),
    ).not.toBeNull();

    mocks.status.mockResolvedValue("disabled");
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: [
          "builder-signup-eligibility",
          "clips_builder_signup_v1",
          "user-2",
        ],
      });
    });
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData([
          "builder-signup-eligibility",
          "clips_builder_signup_v1",
          "user-2",
        ]),
      ).toBe("disabled"),
    );
    await render("user-2");
    expect(container.querySelector("[role='status']")).not.toBeNull();
    await act(async () => finish("connected"));

    expect(container.querySelector("[role='status']")).toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("count 1");
    expect(container.querySelector("[inert]")).toBeNull();
    expect(invalidate).toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it("refreshes queries when activation ends after its effect is disposed", async () => {
    mocks.status.mockResolvedValue("eligible");
    let fail: (error: Error) => void = () => {};
    mocks.activate.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await render("user-3");
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
    await render(undefined);
    mocks.status.mockResolvedValue("disabled");
    await act(async () => fail(new Error("activation failed")));

    expect(invalidate).toHaveBeenCalled();
    invalidate.mockRestore();
  });
});
