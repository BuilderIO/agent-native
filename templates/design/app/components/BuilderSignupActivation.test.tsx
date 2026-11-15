// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ activate: vi.fn(), status: vi.fn() }));
vi.mock("@agent-native/core/client/analytics", () => ({ track: vi.fn() }));
vi.mock("@agent-native/core/client/auth/builder-signup", () => ({
  activateBuilderSignupAssignment: mocks.activate,
  startBuilderSignupActivation: mocks.status,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import {
  BuilderSignupActivationCover,
  useBuilderSignupActivation,
} from "./BuilderSignupActivation";
function Activation({ verified }: { verified: boolean }) {
  const activating = useBuilderSignupActivation(
    verified ? "verification-transition" : undefined,
  );
  return (
    <BuilderSignupActivationCover activating={activating}>
      <input aria-label="Prompt" defaultValue="" />
    </BuilderSignupActivationCover>
  );
}

it("checks eligibility without blocking on cookie hints and preserves an in-progress prompt after verification", async () => {
  let determineEligibility: (value: string) => void = () => {};
  mocks.status.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        determineEligibility = resolve;
      }),
  );
  let finish: () => void = () => {};
  mocks.activate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const render = (verified: boolean) =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Activation verified={verified} />
      </QueryClientProvider>,
    );
  try {
    await act(async () => render(false));
    expect(mocks.activate).not.toHaveBeenCalled();
    const input = container.querySelector("input");
    if (!input) throw new Error("Prompt input did not mount");
    input.value = "My unfinished design prompt";
    await act(async () => render(true));
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(container.querySelector("[inert]")).toBeNull();
    document.cookie = "an_builder_signup_pending=1";
    await act(async () => render(true));
    expect(container.querySelector("[inert]")).toBeNull();
    await act(async () => determineEligibility("eligible"));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(mocks.activate).toHaveBeenCalledOnce();
    });
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("My unfinished design prompt");
    await act(async () => finish());
    expect(container.querySelector("input")).toBe(input);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    document.cookie = "an_builder_signup_pending=; Max-Age=0; Path=/";
  }
});
