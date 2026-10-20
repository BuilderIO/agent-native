// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "../../../i18n";
import { panelCostChange, usePanelCostNotice } from "./panel-cost-notice";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  toast: { message: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

const GIB = 1024 ** 3;

let container: HTMLDivElement;
let root: Root;
let notice: ReturnType<typeof usePanelCostNotice>;
const notify = (panelId: string, title: string) =>
  notice.notify(panelId, title);

function Probe({ dashboardId }: { dashboardId?: string }) {
  notice = usePanelCostNotice(dashboardId);
  return null;
}

function render(dashboardId: string | undefined) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <Probe dashboardId={dashboardId} />
      </AgentNativeI18nProvider>,
    );
  });
}

function estimated(bytes: number, usdPerRun: number, more = {}) {
  return {
    target: "dashboard",
    panels: [
      {
        panelId: "p1",
        title: "Signups",
        source: "bigquery",
        status: "estimated",
        estimatedBytes: bytes,
        usdPerRun,
        runsPerMonth: null,
        usdPerMonth: null,
        overPerRunThreshold: false,
        overPerMonthThreshold: false,
        ...more,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("usePanelCostNotice", () => {
  it("estimates the saved panel and shows what a refresh costs", async () => {
    mocks.callAction.mockResolvedValueOnce(
      estimated(2 * GIB, 0.0122, { runsPerMonth: 60, usdPerMonth: 0.73 }),
    );
    render("d1");

    await act(() => notify("p1", "Signups"));

    expect(mocks.callAction).toHaveBeenCalledWith("estimate-query-cost", {
      dashboardId: "d1",
      panelId: "p1",
    });
    expect(mocks.toast.message).toHaveBeenCalledWith(
      'BigQuery cost of "Signups"',
      expect.objectContaining({
        id: "panel-cost:d1:p1",
        description:
          "~2 GiB scanned · $0.01 per refresh · ~$0.73/month in email reports",
        duration: 8000,
      }),
    );
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it("keeps a warning up until dismissed when the panel is over a threshold", async () => {
    mocks.callAction.mockResolvedValueOnce(
      estimated(200 * GIB, 1.2207, { overPerRunThreshold: true }),
    );
    render("d1");

    await act(() => notify("p1", "Signups"));

    expect(mocks.toast.warning).toHaveBeenCalledWith(
      '"Signups" is expensive to refresh',
      expect.objectContaining({
        description:
          "~200 GiB scanned · $1.22 per refresh · no email reports\nA narrower date range or fewer columns scans less.",
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
      }),
    );
  });

  it("shows a tiny cost as under a cent", async () => {
    mocks.callAction.mockResolvedValueOnce(estimated(20 * 1024 ** 2, 0.0001));
    render("d1");

    await act(() => notify("p1", "Signups"));

    expect(mocks.toast.message.mock.calls[0][1].description).toBe(
      "~20 MiB scanned · <$0.01 per refresh · no email reports",
    );
  });

  it("shows nothing for panels outside BigQuery or a failed estimate", async () => {
    render("d1");
    mocks.callAction.mockResolvedValueOnce({
      target: "dashboard",
      panels: [{ panelId: "p1", status: "not_bigquery", reason: "ga4" }],
    });
    await act(() => notify("p1", "Signups"));
    mocks.callAction.mockRejectedValueOnce(new Error("offline"));
    await act(() => notify("p1", "Signups"));

    expect(mocks.toast.message).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it("drops an estimate that lands after leaving the dashboard", async () => {
    let resolve!: (value: unknown) => void;
    mocks.callAction.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    render("d1");
    const pending = notify("p1", "Signups");
    render("d2");

    await act(async () => {
      resolve(estimated(2 * GIB, 0.0122));
      await pending;
    });

    expect(mocks.toast.message).not.toHaveBeenCalled();
  });

  it("drops an older save's estimate that lands after a newer one", async () => {
    let resolveOlder!: (value: unknown) => void;
    mocks.callAction
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveOlder = res;
        }),
      )
      .mockResolvedValueOnce(estimated(2 * GIB, 0.0122));
    render("d1");
    const older = notify("p1", "Signups");
    await act(() => notify("p1", "Signups"));

    await act(async () => {
      resolveOlder(estimated(200 * GIB, 1.2207, { overPerRunThreshold: true }));
      await older;
    });

    expect(mocks.toast.message).toHaveBeenCalledTimes(1);
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it("closes an earlier warning when a newer save can't be priced", async () => {
    mocks.callAction
      .mockResolvedValueOnce(
        estimated(200 * GIB, 1.2207, { overPerRunThreshold: true }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    render("d1");
    await act(() => notify("p1", "Signups"));
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();

    await act(() => notify("p1", "Signups"));

    expect(mocks.toast.dismiss).toHaveBeenCalledWith("panel-cost:d1:p1");
  });

  it("closes its warnings when you leave the dashboard", async () => {
    mocks.callAction.mockResolvedValueOnce(
      estimated(200 * GIB, 1.2207, { overPerRunThreshold: true }),
    );
    render("d1");
    await act(() => notify("p1", "Signups"));
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();

    render("d2");

    expect(mocks.toast.dismiss).toHaveBeenCalledWith("panel-cost:d1:p1");
  });

  it("closes a panel's notice and drops its pending estimate when it stops running a query", async () => {
    let resolve!: (value: unknown) => void;
    mocks.callAction
      .mockResolvedValueOnce(
        estimated(200 * GIB, 1.2207, { overPerRunThreshold: true }),
      )
      .mockReturnValueOnce(
        new Promise((res) => {
          resolve = res;
        }),
      );
    render("d1");
    await act(() => notify("p1", "Signups"));
    const pending = notify("p1", "Signups");

    act(() => notice.clear("p1"));
    await act(async () => {
      resolve(estimated(200 * GIB, 1.2207, { overPerRunThreshold: true }));
      await pending;
    });

    expect(mocks.toast.dismiss).toHaveBeenCalledWith("panel-cost:d1:p1");
    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
  });
});

describe("panelCostChange", () => {
  const chart = {
    chartType: "line",
    source: "bigquery",
    sql: "SELECT week, signups FROM t",
  } as const;
  const section = { ...chart, chartType: "section" } as const;

  it("prices a new panel, a changed query and a section turned into a chart", () => {
    expect(panelCostChange(null, chart)).toBe("notify");
    expect(
      panelCostChange(chart, { ...chart, sql: "SELECT week FROM t2" }),
    ).toBe("notify");
    expect(panelCostChange(chart, { ...chart, source: "first-party" })).toBe(
      "notify",
    );
    expect(panelCostChange(section, chart)).toBe("notify");
  });

  it("clears the notice of a panel turned into a section", () => {
    expect(panelCostChange(chart, section)).toBe("clear");
    expect(panelCostChange(chart, { ...chart, chartType: "extension" })).toBe(
      "clear",
    );
  });

  it("leaves a chart-type change that keeps the query, and sections, alone", () => {
    expect(panelCostChange(chart, { ...chart, chartType: "bar" })).toBeNull();
    expect(
      panelCostChange(section, { ...section, sql: "SELECT 1" }),
    ).toBeNull();
    expect(panelCostChange(null, section)).toBeNull();
  });
});
