// oracle-change: the unchanged framework/skill contract moved to its own guidance spec; action behavior remains here.
import { describe, expect, it, vi } from "vitest";

import { createDataWidgetActionEntries } from "./context-tools.js";

describe("data widget action validation", () => {
  it("passes original widget input and action context to an optional validator", async () => {
    const input = {
      widget: "data-table",
      table: {
        columns: [{ key: "category", label: "Category" }],
        rows: [["verified"]],
      },
    };
    const context = { request: "test-context" };
    const validate = vi.fn(async () => {});
    const action =
      createDataWidgetActionEntries(validate)["render-data-widget"]!;

    await expect(action.run(input, context as never)).resolves.toMatchObject({
      table: { rows: [{ category: "verified" }] },
    });
    expect(validate).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledWith(input, context);
  });

  it("preserves public record-row input while validating and rendering it", async () => {
    const input = {
      widget: "data-table",
      table: {
        columns: [{ key: "category", label: "Category" }],
        rows: [{ category: "existing-format" }],
      },
    };
    const validateDataWidget = vi.fn(async () => {});
    const action =
      createDataWidgetActionEntries(validateDataWidget)["render-data-widget"]!;

    const result = await action.run(input);

    expect(result).toMatchObject({
      table: { rows: [{ category: "existing-format" }] },
    });
    expect(validateDataWidget).toHaveBeenCalledWith(input, undefined);
  });

  it("rejects when the app validator refuses otherwise valid widget data", async () => {
    const input = {
      widget: "data-table",
      table: {
        columns: [{ key: "category", label: "Category" }],
        rows: [["unverified"]],
      },
    };
    const rejection = new Error("Widget data is not verified.");
    const validate = vi.fn(() => {
      throw rejection;
    });
    const action =
      createDataWidgetActionEntries(validate)["render-data-widget"]!;

    await expect(action.run(input)).rejects.toBe(rejection);
    expect(validate).toHaveBeenCalledOnce();
  });

  it("normalizes compact chart points before returning renderer data", async () => {
    const input = {
      widget: "data-chart",
      chartSeries: {
        type: "line",
        xKey: "month",
        series: [{ key: "wins", label: "Wins" }],
        points: [
          { xValue: "2026-01", values: [10] },
          { xValue: "2026-02", values: [12] },
        ],
      },
    };
    const validateDataWidget = vi.fn(async () => {});
    const action =
      createDataWidgetActionEntries(validateDataWidget)["render-data-widget"]!;

    await expect(action.run(input)).resolves.toMatchObject({
      chartSeries: {
        data: [
          { month: "2026-01", wins: 10 },
          { month: "2026-02", wins: 12 },
        ],
      },
    });
    expect(validateDataWidget).toHaveBeenCalledWith(input, undefined);
  });
});
