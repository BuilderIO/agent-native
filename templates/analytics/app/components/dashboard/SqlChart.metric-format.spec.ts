import { describe, it, expect } from "vitest";
import {
  formatMetricValue,
  safeDashboardLinkHref,
  sortTooltipPayloadItems,
} from "./SqlChart";

// Postgres/Neon returns numeric & bigint columns as STRINGS (SQLite returns JS
// numbers). The metric renderer used to only format `typeof raw === "number"`,
// so a Postgres rate like "0.00000000000000000000" was dumped verbatim instead
// of being shown as "0.00%". formatMetricValue coerces numeric strings first.
describe("formatMetricValue", () => {
  it("formats a Postgres numeric-string rate as a percent (the reported bug)", () => {
    // 21-decimal string exactly like the live "Viral Signup Share" panel showed
    expect(formatMetricValue("0.000000000000000000000", "percent")).toBe(
      "0.00%",
    );
  });

  it("formats a non-zero numeric-string rate as a percent", () => {
    expect(formatMetricValue("0.5", "percent")).toBe("50.00%");
    expect(formatMetricValue("0.1234", "percent")).toBe("12.34%");
  });

  it("formats a numeric-string coefficient (K) with the number formatter", () => {
    expect(formatMetricValue("0.3333333333", "number")).toBe("0.333");
    expect(formatMetricValue("2", "number")).toBe("2");
  });

  it("still formats plain JS numbers (SQLite path) unchanged", () => {
    expect(formatMetricValue(0, "percent")).toBe("0.00%");
    expect(formatMetricValue(42, "number")).toBe("42");
  });

  it("formats bigint count strings as plain integers", () => {
    expect(formatMetricValue("0", "number")).toBe("0");
    expect(formatMetricValue("1234", "number")).toBe("1,234");
  });

  it("honors a valueLabels override before any coercion", () => {
    expect(formatMetricValue("3", "number", { "3": "Tier 3" })).toBe("Tier 3");
  });

  it("leaves genuinely non-numeric strings untouched", () => {
    expect(formatMetricValue("n/a", "number")).toBe("n/a");
    expect(formatMetricValue("", "number")).toBe(""); // preserved original behavior
    expect(formatMetricValue(null, "number")).toBe("-");
    expect(formatMetricValue(undefined, "number")).toBe("-");
  });
});

describe("sortTooltipPayloadItems", () => {
  it("sorts numeric tooltip rows descending while keeping ties stable", () => {
    const items = [
      { name: "analytics", value: 69 },
      { name: "docs", value: "1025" },
      { name: "forms", value: 25 },
      { name: "content", value: 69 },
    ];

    expect(sortTooltipPayloadItems(items).map((item) => item.name)).toEqual([
      "docs",
      "analytics",
      "content",
      "forms",
    ]);
  });
});

describe("safeDashboardLinkHref", () => {
  it("keeps http, https, and root-relative links", () => {
    expect(safeDashboardLinkHref("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(safeDashboardLinkHref("http://example.com/path")).toBe(
      "http://example.com/path",
    );
    expect(safeDashboardLinkHref("/dashboards/example")).toBe(
      "/dashboards/example",
    );
  });

  it("blocks unsafe or incomplete link targets", () => {
    expect(safeDashboardLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeDashboardLinkHref("data:text/html,hi")).toBeNull();
    expect(safeDashboardLinkHref("//evil.example/path")).toBeNull();
    expect(safeDashboardLinkHref("example.com/path")).toBeNull();
    expect(safeDashboardLinkHref("")).toBeNull();
  });
});
