import { describe, expect, it } from "vitest";

import {
  factoryNavigationState,
  factorySearchParamsEqual,
  factoryUrlForTab,
  factoryWorkflowUrl,
  leavesOpenWorkflow,
  parseWorkspaceTab,
  readWorkflowParams,
  retainFactoryTabParams,
} from "./factory-tab-params";

describe("parseWorkspaceTab", () => {
  it("opens Workflows when there is no tab", () => {
    expect(parseWorkspaceTab(null)).toBe("workflows");
    expect(parseWorkspaceTab("")).toBe("workflows");
  });

  it("keeps the current tabs", () => {
    for (const tab of [
      "workflows",
      "items",
      "activity",
      "settings",
      "agents",
    ] as const) {
      expect(parseWorkspaceTab(tab)).toBe(tab);
    }
  });

  it("sends the old Inbox to Items and every other retired tab to Workflows", () => {
    expect(parseWorkspaceTab("inbox")).toBe("items");
    for (const retired of [
      "overview",
      "automations",
      "audit",
      "map",
      "rules",
      "history",
    ]) {
      expect(parseWorkspaceTab(retired)).toBe("workflows");
    }
  });

  it("opens Workflows for a value it has never heard of", () => {
    expect(parseWorkspaceTab("billing")).toBe("workflows");
  });
});

describe("retainFactoryTabParams", () => {
  it("leaves the default tab bare and keeps the open workflow and selection", () => {
    const current = new URLSearchParams(
      "factoryId=f1&tab=audit&workflow=w1&node=n1&edge=e1&run=r1&version=3&auditRunId=a1&automationId=x",
    );
    const next = retainFactoryTabParams(current, "workflows");
    expect(next.get("tab")).toBeNull();
    expect(next.get("factoryId")).toBe("f1");
    expect(next.get("workflow")).toBe("w1");
    expect(next.get("node")).toBe("n1");
    expect(next.get("edge")).toBe("e1");
    expect(next.get("run")).toBe("r1");
    expect(next.get("version")).toBe("3");
    expect(next.get("auditRunId")).toBeNull();
    expect(next.get("automationId")).toBeNull();
  });

  it("names every tab but the default", () => {
    const current = new URLSearchParams("factoryId=f1&workflow=w1&node=n1");
    expect(retainFactoryTabParams(current, "items").get("tab")).toBe("items");
    expect(retainFactoryTabParams(current, "activity").get("tab")).toBe(
      "activity",
    );
    expect(retainFactoryTabParams(current, "settings").get("tab")).toBe(
      "settings",
    );
  });

  it("drops the canvas selection when the tab does not own it", () => {
    const current = new URLSearchParams(
      "factoryId=f1&workflow=w1&node=n1&edge=e1&run=r1",
    );
    const next = retainFactoryTabParams(current, "settings");
    expect(next.get("factoryId")).toBe("f1");
    expect(next.get("workflow")).toBeNull();
    expect(next.get("node")).toBeNull();
    expect(next.get("edge")).toBeNull();
    expect(next.get("run")).toBeNull();
  });

  it("keeps an Items deep link intact", () => {
    const current = new URLSearchParams(
      "factoryId=f1&tab=items&item=i1&status=needs_manual&needsYou=true&q=crash",
    );
    const next = retainFactoryTabParams(current, "items");
    expect(next.get("item")).toBe("i1");
    expect(next.get("status")).toBe("needs_manual");
    expect(next.get("needsYou")).toBe("true");
    expect(next.get("q")).toBe("crash");
  });

  it("keeps Activity filters and drops Items filters", () => {
    const current = new URLSearchParams(
      "factoryId=f1&tab=activity&who=agent&kind=run&range=7d&status=failed&q=x",
    );
    const next = retainFactoryTabParams(current, "activity");
    expect(next.get("who")).toBe("agent");
    expect(next.get("kind")).toBe("run");
    expect(next.get("range")).toBe("7d");
    expect(next.get("status")).toBeNull();
    expect(next.get("q")).toBeNull();
  });
});

describe("factorySearchParamsEqual", () => {
  it("treats the same keys and values as equal regardless of order", () => {
    expect(
      factorySearchParamsEqual(
        new URLSearchParams("factoryId=f1&workflow=w1"),
        new URLSearchParams("workflow=w1&factoryId=f1"),
      ),
    ).toBe(true);
  });

  it("tells different values apart", () => {
    expect(
      factorySearchParamsEqual(
        new URLSearchParams("factoryId=f1&workflow=w1"),
        new URLSearchParams("factoryId=f1&workflow=w2"),
      ),
    ).toBe(false);
  });
});

describe("factoryUrlForTab", () => {
  it("builds the Workflows URL without a tab param", () => {
    expect(factoryUrlForTab("f1", "workflows")).toBe("/factory?factoryId=f1");
  });

  it("builds a named tab URL and carries nothing over by default", () => {
    expect(factoryUrlForTab("f1", "items")).toBe(
      "/factory?tab=items&factoryId=f1",
    );
  });

  it("keeps what the target tab owns from the current URL", () => {
    expect(
      factoryUrlForTab(
        "f1",
        "workflows",
        new URLSearchParams("factoryId=f1&tab=map&workflow=w1&node=n1"),
      ),
    ).toBe("/factory?factoryId=f1&workflow=w1&node=n1");
  });
});

describe("factoryWorkflowUrl", () => {
  it("opens a workflow with an optional selection and run", () => {
    expect(factoryWorkflowUrl("f1", { workflowId: "w1" })).toBe(
      "/factory?factoryId=f1&workflow=w1",
    );
    expect(
      factoryWorkflowUrl("f1", {
        workflowId: "w1",
        nodeId: "n1",
        runId: "r1",
      }),
    ).toBe("/factory?factoryId=f1&workflow=w1&node=n1&run=r1");
    expect(factoryWorkflowUrl("f1", { workflowId: "w1", version: 4 })).toBe(
      "/factory?factoryId=f1&workflow=w1&version=4",
    );
  });

  it("encodes ids", () => {
    expect(factoryWorkflowUrl("f 1", { workflowId: "a&b" })).toBe(
      "/factory?factoryId=f+1&workflow=a%26b",
    );
  });
});

describe("readWorkflowParams", () => {
  it("reads what is open and null for what is not", () => {
    expect(
      readWorkflowParams(new URLSearchParams("workflow=w1&node=n1&run=r1")),
    ).toEqual({
      workflowId: "w1",
      nodeId: "n1",
      edgeId: null,
      runId: "r1",
      version: null,
    });
  });

  it("reads a version only when it is a whole number from 1", () => {
    expect(readWorkflowParams(new URLSearchParams("version=12")).version).toBe(
      12,
    );
    for (const bad of ["0", "-1", "1.5", ""]) {
      expect(
        readWorkflowParams(new URLSearchParams(`version=${bad}`)).version,
      ).toBeNull();
    }
  });
});

describe("leavesOpenWorkflow", () => {
  const open = {
    pathname: "/factory",
    search: "?factoryId=f1&workflow=w1&node=n1",
  };

  it("is false while only the selection or replay changes", () => {
    expect(
      leavesOpenWorkflow(open, {
        pathname: "/factory",
        search: "?factoryId=f1&workflow=w1&edge=e1&run=r2",
      }),
    ).toBe(false);
  });

  it("is true for another workflow, tab, factory or page", () => {
    expect(
      leavesOpenWorkflow(open, {
        pathname: "/factory",
        search: "?factoryId=f1&workflow=w2",
      }),
    ).toBe(true);
    expect(
      leavesOpenWorkflow(open, {
        pathname: "/factory",
        search: "?factoryId=f1&tab=items",
      }),
    ).toBe(true);
    expect(
      leavesOpenWorkflow(open, {
        pathname: "/factory",
        search: "?factoryId=f2&workflow=w1",
      }),
    ).toBe(true);
    expect(leavesOpenWorkflow(open, { pathname: "/chat", search: "" })).toBe(
      true,
    );
  });

  it("is true for the back arrow to the list", () => {
    expect(
      leavesOpenWorkflow(open, {
        pathname: "/factory",
        search: "?factoryId=f1",
      }),
    ).toBe(true);
  });

  it("reads a retired tab name as Workflows", () => {
    expect(
      leavesOpenWorkflow(
        {
          pathname: "/factory",
          search: "?factoryId=f1&tab=automations&workflow=w1",
        },
        { pathname: "/factory", search: "?factoryId=f1&workflow=w1" },
      ),
    ).toBe(false);
  });
});

describe("factoryNavigationState", () => {
  it("is empty for the factory list", () => {
    expect(factoryNavigationState(new URLSearchParams())).toEqual({});
  });

  it("reports Workflows for an open factory with no tab", () => {
    expect(factoryNavigationState(new URLSearchParams("factoryId=f1"))).toEqual(
      {
        factoryId: "f1",
        factoryTab: "workflows",
      },
    );
  });

  it("reports the open workflow with its step, connection and run", () => {
    expect(
      factoryNavigationState(
        new URLSearchParams("factoryId=f1&workflow=w1&node=n1&run=r1"),
      ),
    ).toEqual({
      factoryId: "f1",
      factoryTab: "workflows",
      workflowId: "w1",
      nodeId: "n1",
      runId: "r1",
    });
    expect(
      factoryNavigationState(
        new URLSearchParams("factoryId=f1&workflow=w1&edge=e1"),
      ),
    ).toMatchObject({ workflowId: "w1", edgeId: "e1" });
  });

  it("does not report a step or run with no workflow open", () => {
    expect(
      factoryNavigationState(
        new URLSearchParams("factoryId=f1&node=n1&run=r1"),
      ),
    ).toEqual({ factoryId: "f1", factoryTab: "workflows" });
  });

  it("does not call an Items or Activity filter an open workflow", () => {
    expect(
      factoryNavigationState(
        new URLSearchParams("factoryId=f1&tab=items&workflow=w1&item=i1"),
      ),
    ).toEqual({ factoryId: "f1", factoryTab: "items", factoryItemId: "i1" });
    expect(
      factoryNavigationState(
        new URLSearchParams("factoryId=f1&tab=activity&workflow=w1"),
      ),
    ).toEqual({ factoryId: "f1", factoryTab: "activity" });
  });

  it("maps a retired tab to the one that replaced it", () => {
    expect(
      factoryNavigationState(new URLSearchParams("factoryId=f1&tab=inbox")),
    ).toMatchObject({ factoryTab: "items" });
    expect(
      factoryNavigationState(new URLSearchParams("factoryId=f1&tab=audit")),
    ).toMatchObject({ factoryTab: "workflows" });
  });

  it("keeps the workspace-level agents page", () => {
    expect(factoryNavigationState(new URLSearchParams("tab=agents"))).toEqual({
      factoryTab: "agents",
    });
  });
});
