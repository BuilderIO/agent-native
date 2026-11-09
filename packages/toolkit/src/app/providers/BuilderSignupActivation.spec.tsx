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

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  useSession: () => ({
    session: { userId: "startup-cover-user", emailVerified: true },
  }),
}));

vi.mock("@agent-native/core/client/onboarding/first-run-enabled", () => ({
  isFirstRunOnboardingEnabled: () => false,
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  track: vi.fn(),
}));

import { useStartupInteractionBlocked } from "../onboarding/first-run-startup-gate-context.js";
import {
  BuilderSignupActivationCover,
  BuilderSignupStartupGate,
  useBuilderSignupActivation,
} from "./BuilderSignupActivation.js";

function Counter() {
  const [count, setCount] = useState(0);
  const blocked = useStartupInteractionBlocked();
  return (
    <button
      data-startup-interaction-blocked={blocked}
      type="button"
      onClick={() => setCount((value) => value + 1)}
    >
      {`count ${count}`}
    </button>
  );
}

function Activation({ userId }: { userId: string | undefined }) {
  const { activating, resolving, statusError, retryStatus } =
    useBuilderSignupActivation(userId, "clips_builder_signup_v1");
  return (
    <BuilderSignupActivationCover
      activating={activating}
      statusError={statusError}
      retryStatus={retryStatus}
    >
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

  it("reports eligibility resolution separately from confirmed activation", async () => {
    mocks.status.mockReturnValue(new Promise(() => {}));
    await render("pending-user");
    expect(
      container
        .querySelector("[data-resolving]")
        ?.getAttribute("data-resolving"),
    ).toBe("true");
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("keeps startup content interactive while eligibility resolves, without mounting onboarding", async () => {
    let finish!: (value: "disabled") => void;
    mocks.status.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <BuilderSignupStartupGate
            experimentId="clips_builder_signup_v1"
            suppressSurface
          >
            <Counter />
          </BuilderSignupStartupGate>
        </QueryClientProvider>,
      );
    });
    expect(container.querySelector("[role='status']")).toBeNull();
    expect(container.querySelector("button")?.closest("[inert]")).toBeNull();
    expect(
      container
        .querySelector("button")
        ?.getAttribute("data-startup-interaction-blocked"),
    ).toBe("false");
    await clickCounter();
    expect(container.textContent).toContain("count 1");
    await act(async () => {
      finish("disabled");
    });
    await vi.waitFor(() =>
      expect(container.querySelector("[role='status']")).toBeNull(),
    );
    expect(container.querySelector("button")?.closest("[inert]")).toBeNull();
  });

  it("retains confirmed disabled eligibility when a background refetch fails", async () => {
    mocks.status.mockResolvedValue("disabled");
    await render("confirmed-disabled-user");
    await vi.waitFor(() =>
      expect(
        container
          .querySelector("[data-resolving]")
          ?.getAttribute("data-resolving"),
      ).toBe("false"),
    );
    mocks.status.mockRejectedValue(new Error("background refetch failed"));
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: [
          "builder-signup-eligibility",
          "clips_builder_signup_v1",
          "confirmed-disabled-user",
        ],
      });
    });
    expect(
      container
        .querySelector("[data-resolving]")
        ?.getAttribute("data-resolving"),
    ).toBe("false");
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.querySelector("[inert]")).toBeNull();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("keeps the cover after a polling timeout until the server confirms a terminal result", async () => {
    mocks.status.mockResolvedValue("eligible");
    mocks.activate.mockRejectedValue(new Error("polling timed out"));
    await render("timeout-user");
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
    expect(container.querySelector("[role='status']")).not.toBeNull();
    expect(
      container
        .querySelector("button")
        ?.getAttribute("data-startup-interaction-blocked"),
    ).toBe("true");
    mocks.status.mockResolvedValue("disabled");
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await vi.waitFor(() =>
      expect(container.querySelector("[role='status']")).toBeNull(),
    );
  });

  it("keeps unknown eligibility deferred with an interactive Retry notice until status is confirmed", async () => {
    mocks.status.mockRejectedValue(new Error("eligibility unavailable"));
    await render("eligibility-error-user");
    await vi.waitFor(
      () => expect(container.querySelector("[role='alert']")).not.toBeNull(),
      { timeout: 4000 },
    );
    expect(
      container
        .querySelector("[data-resolving]")
        ?.getAttribute("data-resolving"),
    ).toBe("true");
    expect(container.querySelector("[inert]")).toBeNull();
    mocks.status.mockResolvedValue("disabled");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[role='alert'] button")
        ?.click();
    });
    await vi.waitFor(() =>
      expect(
        container
          .querySelector("[data-resolving]")
          ?.getAttribute("data-resolving"),
      ).toBe("false"),
    );
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("retries a failed activation after a fresh eligible status on a host without background execution", async () => {
    mocks.status.mockResolvedValue("eligible");
    mocks.activate
      .mockRejectedValueOnce(new Error("request never reached the server"))
      .mockResolvedValueOnce("connected");
    await render("non-background-user");
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    await vi.waitFor(() =>
      expect(container.querySelector("[role='status']")).toBeNull(),
    );
  });

  it("caps automatic activation retries and leaves further recovery to the Retry button", async () => {
    mocks.status.mockResolvedValue("eligible");
    mocks.activate.mockRejectedValue(
      new Error("persistent activation transport failure"),
    );
    await render("bounded-retry-user");
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledTimes(3), {
      timeout: 6000,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const statusReadsAtCap = mocks.status.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2300));
    });
    expect(mocks.activate).toHaveBeenCalledTimes(3);
    expect(mocks.status).toHaveBeenCalledTimes(statusReadsAtCap);
    expect(container.querySelector("[role='alert']")).not.toBeNull();
    mocks.activate.mockResolvedValue("connected");
    await act(async () => {
      container
        .querySelector("[role='alert'] button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledTimes(4));
    await vi.waitFor(() =>
      expect(container.querySelector("[role='status']")).toBeNull(),
    );
  }, 10000);

  it("stops polling and offers Retry when confirmed activation status becomes unavailable", async () => {
    mocks.status.mockResolvedValue("eligible");
    mocks.activate.mockRejectedValue(new Error("polling timed out"));
    await render("retry-status-user");
    await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
    mocks.status.mockRejectedValue(new Error("status unavailable"));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await vi.waitFor(
      () => expect(container.querySelector("[role='alert']")).not.toBeNull(),
      { timeout: 4000 },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    const statusReadsAfterError = mocks.status.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2300));
    });
    expect(mocks.status).toHaveBeenCalledTimes(statusReadsAfterError);
    await act(async () => {
      container
        .querySelector("[role='alert'] button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(mocks.status.mock.calls.length).toBeGreaterThan(
        statusReadsAfterError,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    expect(container.querySelector("[role='alert'] button")).not.toBeNull();
    expect(container.querySelector("[inert]")).not.toBeNull();
    mocks.status.mockResolvedValue("disabled");
    await act(async () => {
      container
        .querySelector("[role='alert'] button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(container.querySelector("[role='status']")).toBeNull(),
    );
  }, 10000);

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
