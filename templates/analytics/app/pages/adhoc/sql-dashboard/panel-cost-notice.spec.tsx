// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "../../../i18n";
import { usePanelCostNotice } from "./panel-cost-notice";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  toast: { message: vi.fn(), warning: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

const GIB = 1024 ** 3;

let container: HTMLDivElement;
let root: Root;
let notify: ReturnType<typeof usePanelCostNotice>;

function Probe({ dashboardId }: { dashboardId?: string }) {
  notify = usePanelCostNotice(dashboardId);
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
          "~200 GiB scanned · $1.22 per refresh · no email reports A narrower date range or fewer columns scans less.",
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
});
