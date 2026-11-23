// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import type { ChartDrawingProps } from "./ChartDrawing";
import { VegaChart } from "./VegaChart";

const embed = vi.hoisted(() => ({
  pick: undefined as ((name: string, value: unknown) => void) | undefined,
}));

vi.mock("vega-embed", () => ({
  default: async (host: HTMLElement) => {
    host.appendChild(
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    );
    return {
      view: {
        addSignalListener: (
          name: string,
          listener: (name: string, value: unknown) => void,
        ) => {
          if (name === "pick") embed.pick = listener;
        },
      },
      finalize: () => {},
    };
  },
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

type Datum = { rowIndex: number; value?: number };

async function pickBin(binStart: number, binEnd: number): Promise<Datum> {
  const onMarkSelect = vi.fn();
  embed.pick = undefined;
  const props: ChartDrawingProps = {
    columns: ["latency_ms"],
    rows: [[10], [1], [11], [20]],
    mark: "histogram",
    onMarkSelect,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <VegaChart {...props} />
      </AgentNativeI18nProvider>,
    );
  });
  try {
    await vi.waitFor(() => expect(embed.pick).toBeDefined());
    await act(async () => {
      embed.pick?.("pick", { rawX: [[binStart, binEnd]] });
    });
    expect(onMarkSelect).toHaveBeenCalledTimes(1);
    return onMarkSelect.mock.calls[0]![0] as Datum;
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

describe("VegaChart histogram bin selection", () => {
  it("does not select a value on the next bin's lower edge from an intermediate [start, stop) bin", async () => {
    expect((await pickBin(0, 10)).rowIndex).toBe(1);
  });

  it("keeps the interior of the next bin including its lower edge", async () => {
    expect((await pickBin(10, 20)).rowIndex).toBe(0);
  });

  it("includes the maximum value in the final bin", async () => {
    const picked = await pickBin(20, 20);
    expect(picked.rowIndex).toBe(3);
  });
});
