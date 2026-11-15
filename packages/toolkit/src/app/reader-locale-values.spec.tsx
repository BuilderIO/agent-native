// @vitest-environment happy-dom

// The reader-locale class in the shared dashboard and chat widgets. Three surfaces every template
// mounts formatted their numbers and one its dates with no locale argument, so they followed the
// machine's locale instead of the one the reader picked in the app. Each case below fails on the
// old bare `toLocaleString()` / `Intl.DateTimeFormat(undefined)` and passes once the locale reaches
// Intl; the component cases prove the reader's locale is what arrives, not a hard-coded one.
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataTable, formatDataTableCell } from "../dashboard/DataTable.js";
import { formatSummaryPillValue } from "./chat/chat/widgets/DataInsightsWidget.js";
import { formatScheduledDate } from "./chat/chat/widgets/RecordChangeWidget.js";
import { createToolkitI18nCatalog } from "./i18n.js";

const catalog = createToolkitI18nCatalog({ messages: {} });

describe("reader locale in shared value formatting", () => {
  it("groups a table cell's digits in the reader's locale", () => {
    expect(formatDataTableCell(1234, "en-US")).toBe("1,234");
    expect(formatDataTableCell(1234, "de-DE")).toBe("1.234");
    // The two must differ, or the locale never reached Intl.
    expect(formatDataTableCell(1234, "en-US")).not.toBe(
      formatDataTableCell(1234, "de-DE"),
    );
    // Non-integers keep the four-decimal rule, which is locale-independent.
    expect(formatDataTableCell(1.23456, "de-DE")).toBe("1.2346");
    expect(formatDataTableCell(null, "de-DE")).toBe("-");
  });

  it("groups a metric pill's digits in the reader's locale", () => {
    expect(formatSummaryPillValue(1234, "en-US")).toBe("1,234");
    expect(formatSummaryPillValue(1234, "de-DE")).toBe("1.234");
    expect(formatSummaryPillValue("pending", "de-DE")).toBe("pending");
  });

  it("reads a scheduled time in the reader's locale", () => {
    const value = "2026-11-09T18:00:00Z";
    expect(formatScheduledDate(value, "de-DE")).toBe(
      new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(Date.parse(value)),
    );
    expect(formatScheduledDate(value, "de-DE")).not.toBe(
      formatScheduledDate(value, "en-US"),
    );
    expect(formatScheduledDate(undefined, "de-DE")).toBeUndefined();
  });

  describe("mounted with a German reader", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    });

    it("renders the dashboard table in German, not the machine's locale", async () => {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={catalog}
            initialLocale="de-DE"
            initialPreference="de-DE"
            persistPreference={false}
          >
            <DataTable data={[{ value: 1234 }]} />
          </AgentNativeI18nProvider>,
        );
      });

      expect(container.textContent).toContain("1.234");
      expect(container.textContent).not.toContain("1,234");
    });
  });
});
