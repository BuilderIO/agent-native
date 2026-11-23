// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  errors: {} as Record<string, boolean>,
  refetch: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
  useActionQuery: (name: string) => {
    const refetch = (mocks.refetch[name] ??= vi.fn());
    return mocks.errors[name]
      ? { data: undefined, isError: true, isPending: false, refetch }
      : {
          data:
            name === "list-data-endorsed-catalog"
              ? { items: [], statuses: [], categories: [] }
              : name === "list-data-recents"
                ? { recents: [] }
                : { favorites: [] },
          isError: false,
          isPending: false,
          refetch,
        };
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { DataRecommendedPanel } from "./DataRecommendations";

describe("recommended data error recovery", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.errors = {};
    mocks.refetch = {};
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = () =>
    act(() =>
      root.render(
        <MemoryRouter>
          <DataRecommendedPanel />
        </MemoryRouter>,
      ),
    );

  it.each([
    ["list-data-endorsed-catalog", "Error loading endorsed data"],
    ["list-data-recents", "Error loading recently used"],
    ["list-data-favorites", "Error loading favorites"],
  ])(
    "report A2-FIND-S2-RECOMMENDED-ERROR-NO-RETRY retries %s from its own alert",
    (action, message) => {
      mocks.errors[action] = true;
      render();
      const alerts = [...host.querySelectorAll('[role="alert"]')];
      expect(alerts).toHaveLength(1);
      const alert = alerts[0] as HTMLElement;
      expect(alert.textContent).toContain(message);
      const retry = alert.querySelector("button");
      if (!retry) throw new Error("Retry was not rendered.");
      expect(retry.textContent).toBe("editorPreferences.retry");
      act(() => retry.click());
      expect(mocks.refetch[action]).toHaveBeenCalledOnce();
      for (const [name, fn] of Object.entries(mocks.refetch)) {
        if (name !== action) expect(fn).not.toHaveBeenCalled();
      }
    },
  );

  it("renders an alert with Retry for each failed section at once", () => {
    mocks.errors = {
      "list-data-endorsed-catalog": true,
      "list-data-recents": true,
      "list-data-favorites": true,
    };
    render();
    expect(host.querySelectorAll('[role="alert"] button')).toHaveLength(3);
  });
});
