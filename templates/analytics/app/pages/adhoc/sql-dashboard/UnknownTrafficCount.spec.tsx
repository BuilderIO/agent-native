// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useActionQuery: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, values?: Record<string, unknown>): string =>
      `${key}${values ? `:${JSON.stringify(values)}` : ""}`,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
}));

import { UnknownTrafficCount } from "./UnknownTrafficCount";

describe("UnknownTrafficCount", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function rendered(query: Record<string, unknown>) {
    mocks.useActionQuery.mockReturnValue(query);
    await act(async () => root.render(<UnknownTrafficCount />));
    return container.textContent;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows how many events have no known environment", async () => {
    expect(
      await rendered({
        data: { days: 7, production: 10, beta: 1, unknown: 1234 },
        isError: false,
      }),
    ).toContain("sqlDashboard.unknownTraffic:");
  });

  it("stays out of the way when there are none, or while loading", async () => {
    expect(
      await rendered({
        data: { days: 7, production: 10, beta: 1, unknown: 0 },
        isError: false,
      }),
    ).toBe("");
    expect(await rendered({ data: undefined, isError: false })).toBe("");
  });

  it("says so when the count can't be read, rather than showing none", async () => {
    expect(await rendered({ data: undefined, isError: true })).toBe(
      "sqlDashboard.unknownTrafficUnavailable",
    );
  });
});
