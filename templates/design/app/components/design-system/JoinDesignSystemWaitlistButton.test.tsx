// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ submitWaitlist: vi.fn() }));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/design-system-waitlist", () => ({
  submitDesignSystemsWaitlist: mocks.submitWaitlist,
}));

import { JoinDesignSystemWaitlistButton } from "./JoinDesignSystemWaitlistButton";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.submitWaitlist.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("JoinDesignSystemWaitlistButton", () => {
  it("submits the Design Systems use case and confirms only a submitted form", async () => {
    mocks.submitWaitlist.mockResolvedValue({ status: "submitted" });
    await act(async () => root.render(<JoinDesignSystemWaitlistButton />));

    const button = container.querySelector("button")!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(mocks.submitWaitlist).toHaveBeenCalledWith(
      new URL("/design-systems", window.location.origin).href,
    );
    expect(container.textContent).toContain("designSystems.waitlist.joined");
    expect(button.disabled).toBe(true);
  });

  it("does not claim success when the hosted waitlist did not receive the form", async () => {
    mocks.submitWaitlist.mockResolvedValue({ status: "unavailable" });
    await act(async () => root.render(<JoinDesignSystemWaitlistButton />));

    await act(async () => {
      container.querySelector("button")!.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "designSystems.waitlist.unavailable",
    );
    expect(container.textContent).not.toContain(
      "designSystems.waitlist.joined",
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("shows a localized error when the request fails", async () => {
    mocks.submitWaitlist.mockResolvedValue({ status: "failed" });
    await act(async () => root.render(<JoinDesignSystemWaitlistButton />));

    await act(async () => {
      container.querySelector("button")!.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("designSystems.waitlist.error");
    expect(container.textContent).not.toContain(
      "designSystems.waitlist.joined",
    );
  });
});
