import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getFirstPartyDrilldown: vi.fn() }));
vi.mock("../server/lib/first-party-metric-catalog", () => ({
  getFirstPartyDrilldown: mocks.getFirstPartyDrilldown,
}));
const { default: getPanelDrilldown } = await import("./get-panel-drilldown");
const panel = {
  panelId: "custom",
  panelSource: "bigquery",
  panelSql: "SELECT day, COUNT(*) FROM events GROUP BY day",
};

describe("get-panel-drilldown", () => {
  beforeEach(() => mocks.getFirstPartyDrilldown.mockReset());

  it("uses a declared BigQuery record template without catalog SQL matching", async () => {
    const drilldown = {
      sql: "SELECT visitor FROM events WHERE day = '{{drillX}}' LIMIT 500",
    };
    await expect(
      getPanelDrilldown.run({ ...panel, drilldown }),
    ).resolves.toEqual({ drilldown });
    expect(mocks.getFirstPartyDrilldown).not.toHaveBeenCalled();
  });

  it.each([
    "SELECT r'{{drillX}}'",
    'SELECT R"{{drillSeries}}"',
    "SELECT br'''{{appFilter}}'''",
    'SELECT rB"""{{apps:list}}"""',
    "SELECT r'\\{{drillX}}'",
    "SELECT # '\nr'{{drillX}}' # '",
  ])(
    "rejects a raw-literal template variable before querying: %s",
    async (sql) => {
      await expect(
        getPanelDrilldown.run({ ...panel, drilldown: { sql } }),
      ).rejects.toThrow(/require ordinary quoted strings/);
      expect(mocks.getFirstPartyDrilldown).not.toHaveBeenCalled();
    },
  );

  it.each([
    "SELECT '{{drillX}}'",
    "SELECT r'\\d+' WHERE app = '{{drillSeries}}'",
    "SELECT 'r\"{{drillX}}\"'",
    "SELECT '{{drillX}}' WHERE app IN ({{apps:list}})",
    "SELECT '\\\\{{drillX}}'",
    "SELECT '''{{drillX}}''' WHERE b = '''a {{drillX}} b'''",
    "SELECT '{{drillX}}{{drillSeries}}'",
  ])(
    "preserves ordinary placeholders and static raw literals: %s",
    async (sql) => {
      await expect(
        getPanelDrilldown.run({ ...panel, drilldown: { sql } }),
      ).resolves.toEqual({ drilldown: { sql } });
    },
  );

  it.each([
    "SELECT r{{drillSeries}}'{{drillX}}'",
    "SELECT r{{apps:list}}",
    "SELECT {{apps:list}}'suffix'",
    "SELECT `{{drillX}}`",
    "SELECT '{{apps:list}}'",
    "SELECT 1 # r'{{unused}}'",
    "SELECT '{{drillX}}' /* {{unused}} */",
    "SELECT '\\{{drillX}}' AND owner = 'expected'",
    'SELECT "\\{{drillSeries}}"',
    "SELECT '''\\{{drillX}}'''",
    "SELECT 'a\\\\\\{{drillX}}'",
    "SELECT '''x'{{drillX}}'' AND owner = 'expected' OR TRUE --'''",
    'SELECT """x"{{drillX}}"" OR TRUE --"""',
    "SELECT '''x'{{drillX}}{{drillSeries}}'' OR TRUE --'''",
    "SELECT '''{{drillX}}'a'''",
  ])(
    "rejects variables outside supported template positions: %s",
    async (sql) => {
      await expect(
        getPanelDrilldown.run({ ...panel, drilldown: { sql } }),
      ).rejects.toThrow(/template variables/);
    },
  );

  it.each([
    "SELECT 'a''{{drillX}}'",
    "SELECT '{{drillX}}''b'",
    "SELECT 'a''''' b ''' {{drillX}} ''' c ' d '''",
    'SELECT "a""" b """ {{drillX}} """ c " d """',
  ])(
    "rejects doubled quotes that GoogleSQL reads as adjacent literals: %s",
    async (sql) => {
      await expect(
        getPanelDrilldown.run({ ...panel, drilldown: { sql } }),
      ).rejects.toThrow(/must not use doubled quotes/);
    },
  );

  it.each([
    "SELECT r'{{drill{{?appFilter}}{{/appFilter}}X}}'",
    "SELECT r{{?appFilter}}{{/appFilter}}'{{drillX}}'",
  ])(
    "rejects conditional preprocessing in BigQuery record templates: %s",
    async (sql) => {
      await expect(
        getPanelDrilldown.run({ ...panel, drilldown: { sql } }),
      ).rejects.toThrow(/must not use conditional blocks/);
    },
  );

  it.each([
    "SELECT visitor FROM events WHERE page = '{{drillX}}' AND app IN ({{appFilter:list}}) LIMIT 500",
    "SELECT visitor FROM events WHERE note = 'o''brien {{drillX}}' AND day >= DATE '2026-10-01'",
    "SELECT visitor FROM events WHERE path = '\\{{drillX}}' -- {{ not a slot\n LIMIT 500",
    "SELECT visitor FROM events WHERE page = '{{drillX}}{{drillSeries}}' /* note */",
  ])("accepts quoted first-party record template slots: %s", async (sql) => {
    await expect(
      getPanelDrilldown.run({
        ...panel,
        panelSource: "first-party",
        drilldown: { sql },
      }),
    ).resolves.toEqual({ drilldown: { sql } });
  });

  it.each([
    [
      "SELECT visitor FROM events WHERE page = {{drillX}}",
      /require ordinary quoted strings/,
    ],
    ['SELECT "{{drillX}}" FROM events', /require ordinary quoted strings/],
    [
      "SELECT visitor FROM events WHERE page = E'{{drillX}}'",
      /plain quoted strings/,
    ],
    [
      "SELECT visitor FROM events WHERE page = E'\\'' AND x' = '{{drillX}}'",
      /plain quoted strings/,
    ],
    [
      "SELECT visitor FROM events WHERE page = U&'{{drillX}}'",
      /plain quoted strings/,
    ],
    [
      "SELECT visitor FROM events WHERE day = DATE'{{drillX}}'",
      /plain quoted strings/,
    ],
    [
      "SELECT visitor FROM events WHERE page = $ '$ = '{{drillX}}'",
      /must not use \$/,
    ],
    [
      "SELECT visitor FROM events WHERE page = $q$x$q$ AND a = '{{drillX}}'",
      /must not use \$/,
    ],
    ["SELECT visitor FROM events WHERE `'` = '{{drillX}}'", /must not use \$/],
    [
      "SELECT visitor FROM events WHERE 1 # '{{drillX}}' = 1",
      /must not use \$/,
    ],
    [
      "SELECT visitor FROM events /* /* */ WHERE page = '{{drillX}}' */",
      /must not nest comments/,
    ],
    [
      "SELECT visitor FROM events -- '{{drillX}}'",
      /must not occur in comments/,
    ],
    [
      "SELECT visitor FROM events WHERE {{?appFilter}}app = '{{appFilter}}'{{/appFilter}}",
      /must not use conditional blocks/,
    ],
  ])(
    "rejects first-party record template slots that could reach code: %s",
    async (sql, error) => {
      await expect(
        getPanelDrilldown.run({
          ...panel,
          panelSource: "first-party",
          drilldown: { sql },
        }),
      ).rejects.toThrow(error);
    },
  );

  it("retains catalog lookup and an explicit aggregate-only result", async () => {
    const drilldown = { sql: "SELECT visitor FROM events LIMIT 500" };
    mocks.getFirstPartyDrilldown
      .mockReturnValueOnce(drilldown)
      .mockReturnValueOnce(null);
    await expect(
      getPanelDrilldown.run({ ...panel, panelSource: "first-party" }),
    ).resolves.toEqual({ drilldown });
    await expect(getPanelDrilldown.run(panel)).resolves.toEqual({
      drilldown: null,
    });
    expect(mocks.getFirstPartyDrilldown).toHaveBeenNthCalledWith(
      1,
      panel.panelId,
      "first-party",
      panel.panelSql,
    );
  });

  it("treats a null declaration as absent for catalog lookup and aggregate fallback", async () => {
    mocks.getFirstPartyDrilldown.mockReturnValue(null);
    const args = getPanelDrilldown.schema.parse({ ...panel, drilldown: null });
    await expect(getPanelDrilldown.run(args)).resolves.toEqual({
      drilldown: null,
    });
    expect(mocks.getFirstPartyDrilldown).toHaveBeenCalledWith(
      panel.panelId,
      panel.panelSource,
      panel.panelSql,
    );
  });

  it.each([
    {},
    { sql: " " },
    { sql: "x".repeat(50_001) },
    { sql: "SELECT 1", extra: true },
  ])("rejects malformed declarations: %j", (drilldown) => {
    expect(
      getPanelDrilldown.schema.safeParse({ ...panel, drilldown }).success,
    ).toBe(false);
  });

  it("does not treat a declaration for a non-SQL source as aggregate-only", async () => {
    await expect(
      getPanelDrilldown.run({
        ...panel,
        panelSource: "prometheus",
        drilldown: { sql: "SELECT 1" },
      }),
    ).rejects.toThrow("requires a BigQuery or first-party panel");
  });
});
