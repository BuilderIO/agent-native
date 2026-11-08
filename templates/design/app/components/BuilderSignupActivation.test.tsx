// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ activate: vi.fn() }));
vi.mock("@agent-native/core/client/analytics", () => ({ track: vi.fn() }));
vi.mock("@agent-native/core/client/auth/builder-signup", () => ({
  activateBuilderSignupAssignment: mocks.activate,
  hasPendingBuilderSignupAssignment: () => true,
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

it("waits for verification without replacing an in-progress prompt when activation starts", async () => {
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
    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("My unfinished design prompt");
    await act(async () => finish());
    expect(container.querySelector("input")).toBe(input);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
