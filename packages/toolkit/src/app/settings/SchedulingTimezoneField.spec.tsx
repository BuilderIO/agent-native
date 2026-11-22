// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => state.query,
  useActionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, opts?: { defaultValue?: string }) =>
    opts?.defaultValue ?? key,
}));

vi.mock("../agent-page/TimezoneSelect.js", () => ({
  browserTimezone: () => "UTC",
  TimezoneSelect: ({
    value,
    disabled,
    unavailable,
  }: {
    value: string;
    disabled: boolean;
    unavailable?: boolean;
  }) => (
    <select
      data-testid="tz"
      value={value}
      disabled={disabled}
      data-unavailable={unavailable ? "true" : undefined}
    >
      <option value="system">system</option>
      <option value="Europe/Paris">Europe/Paris</option>
    </select>
  ),
}));

import { SchedulingTimezoneField } from "./SchedulingTimezoneField.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("SchedulingTimezoneField", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("disables the select and offers Retry when the preference fails to load", () => {
    const refetch = vi.fn();
    state.query = { data: undefined, isLoading: false, isError: true, refetch };
    act(() => root.render(<SchedulingTimezoneField />));

    expect(
      (container.querySelector("select") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const retry = container.querySelector("button") as HTMLButtonElement;
    act(() => retry.click());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("marks the select unavailable instead of showing the system value on failure", () => {
    state.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    };
    act(() => root.render(<SchedulingTimezoneField />));
    expect(
      container.querySelector("select")?.getAttribute("data-unavailable"),
    ).toBe("true");
  });

  it("disables Retry and marks it busy while the refetch is in flight", () => {
    const refetch = vi.fn();
    state.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: true,
      refetch,
    };
    act(() => root.render(<SchedulingTimezoneField />));

    const retry = container.querySelector("button") as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    act(() => retry.click());
    expect(refetch).not.toHaveBeenCalled();
  });

  it("renders a loaded value without an error", () => {
    state.query = {
      data: { locale: "en-US", timezone: "Europe/Paris" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    act(() => root.render(<SchedulingTimezoneField compact />));

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("Europe/Paris");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
