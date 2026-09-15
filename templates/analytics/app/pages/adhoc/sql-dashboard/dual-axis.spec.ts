import { describe, expect, it } from "vitest";

import { resolveDualAxis } from "./dual-axis";

describe("resolveDualAxis", () => {
  it("keeps a single axis when no series is assigned to the right", () => {
    const plan = resolveDualAxis(["signups", "logins"], {
      yFormatter: "number",
    });

    expect(plan.enabled).toBe(false);
    expect(plan.leftKeys).toEqual(["signups", "logins"]);
    expect(plan.rightKeys).toEqual([]);
    expect(plan.sideFor("signups")).toBe("left");
    expect(plan.formatterFor("signups")).toBe("number");
    expect(plan.leftLabel).toBeUndefined();
  });

  it("splits series across two axes with their own formatters", () => {
    const plan = resolveDualAxis(["signups", "conversion_rate"], {
      yFormatter: "number",
      rightYKeys: ["conversion_rate"],
      rightYFormatter: "percent",
    });

    expect(plan.enabled).toBe(true);
    expect(plan.leftKeys).toEqual(["signups"]);
    expect(plan.rightKeys).toEqual(["conversion_rate"]);
    expect(plan.sideFor("conversion_rate")).toBe("right");
    expect(plan.formatterFor("conversion_rate")).toBe("percent");
    expect(plan.formatterFor("signups")).toBe("number");
    expect(plan.leftLabel).toBe("signups");
    expect(plan.rightLabel).toBe("conversion_rate");
  });

  it("falls back to the left formatter when the right axis has none", () => {
    const plan = resolveDualAxis(["signups", "rate"], {
      yFormatter: "currency",
      rightYKeys: ["rate"],
    });

    expect(plan.rightFormatter).toBe("currency");
  });

  it("collapses to one axis when every series would move right", () => {
    const plan = resolveDualAxis(["a", "b"], {
      rightYKeys: ["a", "b"],
      rightYFormatter: "percent",
      yFormatter: "number",
    });

    expect(plan.enabled).toBe(false);
    expect(plan.leftKeys).toEqual(["a", "b"]);
    expect(plan.sideFor("a")).toBe("left");
    expect(plan.formatterFor("a")).toBe("number");
  });

  it("ignores right-axis names the query never returned", () => {
    const plan = resolveDualAxis(["signups"], { rightYKeys: ["typo_rate"] });

    expect(plan.enabled).toBe(false);
    expect(plan.rightKeys).toEqual([]);
  });

  it("labels an axis only while the name list stays short", () => {
    const two = resolveDualAxis(["a", "b", "rate"], { rightYKeys: ["rate"] });
    expect(two.leftLabel).toBe("a, b");

    const three = resolveDualAxis(["a", "b", "c", "rate"], {
      rightYKeys: ["rate"],
    });
    expect(three.leftLabel).toBeUndefined();
    expect(three.rightLabel).toBe("rate");

    const long = resolveDualAxis(
      ["a_very_long_first_party_metric_name", "rate"],
      { rightYKeys: ["rate"] },
    );
    expect(long.leftLabel).toBe("a_very_long_first_party_m...");
  });

  it("labels axes with display names so Prometheus series stay readable", () => {
    const plan = resolveDualAxis(
      ['up{job="api"}', 'rate{job="api"}'],
      { rightYKeys: ['rate{job="api"}'] },
      (key) => key.split("{")[0],
    );

    expect(plan.leftLabel).toBe("up");
    expect(plan.rightLabel).toBe("rate");
  });
});
