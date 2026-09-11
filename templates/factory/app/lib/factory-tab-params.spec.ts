import { describe, expect, it } from "vitest";

import {
  factorySearchParamsEqual,
  factoryUrlForTab,
  retainFactoryTabParams,
} from "./factory-tab-params";

describe("retainFactoryTabParams", () => {
  it("keeps inbox filters and drops other tab params", () => {
    const current = new URLSearchParams(
      "factoryId=f1&tab=audit&itemId=i1&status=failed&risk=high&range=today&source=slack&auditRunId=r1&automationId=a1&node=n1",
    );
    const next = retainFactoryTabParams(current, "inbox");
    expect(next.get("factoryId")).toBe("f1");
    expect(next.get("tab")).toBeNull();
    expect(next.get("itemId")).toBe("i1");
    expect(next.get("status")).toBe("failed");
    expect(next.get("risk")).toBe("high");
    expect(next.get("range")).toBe("today");
    expect(next.get("source")).toBe("slack");
    expect(next.get("auditRunId")).toBeNull();
    expect(next.get("automationId")).toBeNull();
    expect(next.get("node")).toBeNull();
  });

  it("keeps map selection and drops inbox filters", () => {
    const current = new URLSearchParams(
      "factoryId=f1&status=failed&node=n1&edge=e1",
    );
    const next = retainFactoryTabParams(current, "map");
    expect(next.get("tab")).toBe("map");
    expect(next.get("node")).toBe("n1");
    expect(next.get("edge")).toBe("e1");
    expect(next.get("status")).toBeNull();
  });

  it("keeps audit filters and drops inbox filters", () => {
    const current = new URLSearchParams(
      "factoryId=f1&tab=inbox&itemId=i1&status=failed&range=today&automation=factory-pr-babysit&auditRunId=r1",
    );
    const next = retainFactoryTabParams(current, "audit");
    expect(next.get("tab")).toBe("audit");
    expect(next.get("auditRunId")).toBe("r1");
    expect(next.get("automation")).toBe("factory-pr-babysit");
    expect(next.get("range")).toBe("today");
    expect(next.get("itemId")).toBeNull();
    expect(next.get("status")).toBeNull();
  });

  it("keeps create automation on Automations and drops it elsewhere", () => {
    const current = new URLSearchParams(
      "factoryId=f1&tab=automations&createAutomation=1&automationId=a1",
    );
    const automations = retainFactoryTabParams(current, "automations");
    expect(automations.get("createAutomation")).toBe("1");
    expect(automations.get("automationId")).toBe("a1");
    expect(
      retainFactoryTabParams(current, "settings").get("createAutomation"),
    ).toBeNull();
  });

  it("drops inbox filters when leaving Inbox", () => {
    const current = new URLSearchParams(
      "factoryId=f1&status=failed&risk=high&range=7d&source=slack&itemId=i1",
    );
    const next = retainFactoryTabParams(current, "settings");
    expect(next.get("factoryId")).toBe("f1");
    expect(next.get("tab")).toBe("settings");
    expect(next.get("status")).toBeNull();
    expect(next.get("risk")).toBeNull();
    expect(next.get("range")).toBeNull();
    expect(next.get("source")).toBeNull();
    expect(next.get("itemId")).toBeNull();
  });
});

describe("factorySearchParamsEqual", () => {
  it("treats the same keys and values as equal regardless of order", () => {
    expect(
      factorySearchParamsEqual(
        new URLSearchParams("factoryId=f1&status=failed"),
        new URLSearchParams("status=failed&factoryId=f1"),
      ),
    ).toBe(true);
  });
});

describe("factoryUrlForTab", () => {
  it("builds an inbox URL without a tab param", () => {
    expect(
      factoryUrlForTab(
        "f1",
        "inbox",
        new URLSearchParams("factoryId=f1&tab=map&node=n1"),
      ),
    ).toBe("/factory?factoryId=f1");
  });
});
