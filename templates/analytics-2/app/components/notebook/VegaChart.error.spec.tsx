// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { VegaChart } from "./VegaChart";

let failEmbed = false;
vi.mock("vega-embed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vega-embed")>();
  return {
    ...actual,
    default: (...args: Parameters<typeof actual.default>) =>
      failEmbed ? Promise.reject(new Error("boom")) : actual.default(...args),
  };
});

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!("getBBox" in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value() {
        return { x: 0, y: 0, width: 40, height: 12 };
      },
    });
  }
});

afterEach(() => {
  failEmbed = false;
});

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <VegaChart
          columns={["month", "Revenue"]}
          rows={[
            ["Jan", 100],
            ["Feb", 160],
          ]}
          mark="bar"
        />
      </AgentNativeI18nProvider>,
    );
  });
  return { container, unmount: () => act(async () => root.unmount()) };
}

describe("VegaChart bar mark", () => {
  it("renders into a host carrying the nb-chart-mark-bar class", async () => {
    const { container, unmount } = await mount();
    try {
      expect(container.querySelector(".nb-chart-mark-bar")).not.toBeNull();
      await vi.waitFor(() =>
        expect(container.querySelector("g.mark-rect path")).not.toBeNull(),
      );
    } finally {
      await unmount();
    }
  });

  it("shows a typed error state when the chart cannot be embedded", async () => {
    failEmbed = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, unmount } = await mount();
    try {
      await vi.waitFor(() =>
        expect(
          container.querySelector('[data-chart-error="render-failed"]'),
        ).not.toBeNull(),
      );
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("boom");
    } finally {
      await unmount();
    }
  });
});
