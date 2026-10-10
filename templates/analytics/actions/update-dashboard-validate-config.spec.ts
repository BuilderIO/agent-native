import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/analytics/adhoc"),
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(async () => undefined),
  hasCollabState: vi.fn(async () => false),
  seedFromText: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/dashboards-store", () => ({
  assertDashboardEditable: vi.fn(async () => undefined),
  getDashboard: vi.fn(),
  upsertDashboardOutcome: vi.fn(async () => ({
    dashboard: { archivedAt: null },
    didWrite: true,
  })),
  DashboardConflictError: class DashboardConflictError extends Error {},
}));

vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: vi.fn(async () => null),
}));

const { assertValidDashboardConfig, isAgentCaller, validateDashboardConfig } =
  await import("./update-dashboard");

function panel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `${id} title`,
    source: "first-party",
    chartType: "metric",
    width: 1,
    sql: "SELECT 1 AS value",
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("validateDashboardConfig ratchet", () => {
  const base = {
    name: "Virality",
    panels: [
      panel("a"),
      panel("b"),
      panel("viral-by-app", { title: "VIRALITY BY APP", width: "wide" }),
    ],
  };

  it("lets an unrelated edit through a dashboard with a legacy invalid width", () => {
    const next = clone(base);
    next.panels[0].title = "Renamed";

    expect(validateDashboardConfig(next, { baseline: base })).toBeNull();
  });

  it("still rejects the same legacy panel without a baseline", () => {
    expect(validateDashboardConfig(clone(base))).toBe(
      'panel "viral-by-app" ("VIRALITY BY APP") width is "wide"; set width to an integer 1-6 (updatePanel patch {"width":1}).',
    );
  });

  it("names the id, title, current value, and repair when a touched panel is invalid", () => {
    const next = clone(base);
    next.panels[2].title = "VIRALITY BY APP (weekly)";

    expect(validateDashboardConfig(next, { baseline: base })).toBe(
      'panel "viral-by-app" ("VIRALITY BY APP (weekly)") width is "wide"; set width to an integer 1-6 (updatePanel patch {"width":1}).',
    );
  });

  it("rejects a panel that became invalid in this edit and reports every one", () => {
    const next = clone(base);
    next.panels[0].width = 0;
    next.panels[1].width = 9;
    delete (next.panels[1] as Record<string, unknown>).sql;

    const message = validateDashboardConfig(next, { baseline: base });

    expect(message?.split("\n")).toEqual([
      'panel "a" ("a title") width is 0; set width to an integer 1-6 (updatePanel patch {"width":1}).',
      'panel "b" ("b title") sql is missing; set sql to a non-empty string.',
      'panel "b" ("b title") width is 9; set width to an integer 1-6 (updatePanel patch {"width":1}).',
    ]);
  });

  it("validates inserted panels and falls back to the index only without an id", () => {
    const next = clone(base);
    next.panels.push({ title: "No id", width: 1 } as never);
    next.panels.push(panel("fresh", { width: undefined }) as never);

    const message = validateDashboardConfig(next, { baseline: base });

    expect(message).toContain('panel[3] ("No id") id is missing');
    expect(message).toContain('panel "fresh" ("fresh title") width is missing');
    expect(message).not.toContain("viral-by-app");
  });

  it("does not trust a baseline that is the config itself", () => {
    const same = clone(base);

    expect(validateDashboardConfig(same, { baseline: same })).toContain(
      'panel "viral-by-app"',
    );
  });

  it("throws a typed failure with a stable error code and the issues", () => {
    let error: unknown;
    try {
      assertValidDashboardConfig(clone(base));
    } catch (err) {
      error = err;
    }

    expect(error).toMatchObject({
      name: "ActionContractError",
      errorCode: "dashboard_invalid_panel",
      statusCode: 400,
      details: {
        issues: [expect.objectContaining({ rule: "panel_width" })],
      },
    });

    let dashboardError: unknown;
    try {
      assertValidDashboardConfig({ panels: [] });
    } catch (err) {
      dashboardError = err;
    }
    expect(dashboardError).toMatchObject({
      errorCode: "dashboard_invalid_config",
    });
    expect(() =>
      assertValidDashboardConfig(clone(base), { baseline: base }),
    ).not.toThrow();
  });

  it("recognizes agent callers only", () => {
    expect(["tool", "mcp", "a2a"].every(isAgentCaller)).toBe(true);
    expect(isAgentCaller("http")).toBe(false);
    expect(isAgentCaller(undefined)).toBe(false);
  });
});

describe("validateDashboardConfig multi-select options", () => {
  const withOptions = (values: string[]) => ({
    name: "Plans",
    filters: [
      {
        id: "plan",
        label: "Plan",
        type: "multi-select",
        options: values.map((value) => ({ value, label: value })),
      },
    ],
    panels: [],
  });

  it("accepts plain option values", () => {
    expect(
      validateDashboardConfig(withOptions(["free", "self_serve"])),
    ).toBeNull();
  });

  it("rejects an option value containing a comma, which would split in the URL", () => {
    expect(validateDashboardConfig(withOptions(["north,west"]))).toContain(
      'cannot contain ","',
    );
  });

  it("rejects an empty option value, which the URL cannot represent", () => {
    expect(validateDashboardConfig(withOptions([""]))).toContain(
      "must be non-empty",
    );
  });

  it("rejects an option entry that is not an object with string value and label", () => {
    const malformed = [null, { value: 1, label: "One" }, { value: "a" }];
    for (const option of malformed) {
      const config = {
        name: "Plans",
        filters: [
          {
            id: "plan",
            label: "Plan",
            type: "multi-select",
            options: [option],
          },
        ],
        panels: [],
      };
      expect(validateDashboardConfig(config)).toContain(
        "must be an object with string value and label",
      );
    }
  });

  it("rejects a default token that is not one of the configured options", () => {
    const base = withOptions(["free"]);
    const config = {
      ...base,
      filters: [{ ...base.filters[0], default: "free,legacy" }],
    };
    expect(validateDashboardConfig(config)).toContain('"legacy"');
  });

  it("rejects a non-string default on every filter type, which the read path would refuse", () => {
    const base = withOptions(["free"]);
    for (const value of [1, ["free"], null]) {
      const config = {
        ...base,
        filters: [{ ...base.filters[0], default: value }],
      };
      expect(validateDashboardConfig(config)).toContain("must be a string");
    }
    const select = {
      name: "Plans",
      filters: [{ id: "plan", label: "Plan", type: "select", default: 1 }],
      panels: [],
    };
    expect(validateDashboardConfig(select)).toContain("must be a string");
  });

  it("rejects a malformed option on a select filter, which the read path would refuse", () => {
    const config = {
      name: "Plans",
      filters: [
        {
          id: "plan",
          label: "Plan",
          type: "select",
          options: [{ value: "free", label: 1 }],
        },
      ],
      panels: [],
    };
    expect(validateDashboardConfig(config)).toContain(
      "must be an object with string value and label",
    );
  });

  it("rejects a non-string label or an unknown type, which the read path would refuse", () => {
    const label = {
      name: "Plans",
      filters: [{ id: "plan", label: 1, type: "select" }],
      panels: [],
    };
    expect(validateDashboardConfig(label)).toContain("label must be a string");
    const type = {
      name: "Plans",
      filters: [{ id: "plan", label: "Plan", type: "dropdown" }],
      panels: [],
    };
    expect(validateDashboardConfig(type)).toContain("type must be one of");
  });

  it("rejects more than 100 options, which the read path would refuse", () => {
    const config = withOptions(
      Array.from({ length: 101 }, (_, i) => `option_${i}`),
    );
    expect(validateDashboardConfig(config)).toContain("at most 100 entries");
  });

  it("rejects a non-empty default when the filter has no options", () => {
    const config = {
      name: "Plans",
      filters: [
        { id: "plan", label: "Plan", type: "multi-select", default: "free" },
      ],
      panels: [],
    };
    expect(validateDashboardConfig(config)).toContain('"free"');
  });

  it("accepts a default made of configured options", () => {
    const base = withOptions(["free", "self_serve"]);
    const config = {
      ...base,
      filters: [{ ...base.filters[0], default: "free,self_serve" }],
    };
    expect(validateDashboardConfig(config)).toBeNull();
  });

  it("rejects a default that names no option value, such as the marker or a comma-only value", () => {
    const base = withOptions(["free"]);
    for (const value of ["__empty__", ","]) {
      const config = {
        ...base,
        filters: [{ ...base.filters[0], default: value }],
      };
      expect(validateDashboardConfig(config)).toContain(
        "must name at least one option value",
      );
    }
  });

  it("rejects the reserved empty marker as an option value", () => {
    expect(validateDashboardConfig(withOptions(["__empty__"]))).toContain(
      "__empty__",
    );
  });
});
