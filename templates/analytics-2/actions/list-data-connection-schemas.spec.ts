import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The add-connection grid shows whatever this action delivers, in that order.
 * The original delivers the preferred types first and never alphabetises them,
 * so the action must keep that order and must not present a template whose form
 * does not exist as if it could be created.
 */
const state = vi.hoisted(() => ({
  actor: { userEmail: "qa-owner@example.invalid", orgId: "qa-workspace" } as {
    userEmail: string;
    orgId: string;
  } | null,
  groups: [] as { id: string; name: string }[],
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestContext: () => state.actor,
  readOrgMemberRole: async () => "owner",
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  listWorkspaceUserGroups: async () => state.groups,
}));

import schemaAction from "./list-data-connection-schemas";

beforeEach(() => {
  state.actor = {
    userEmail: "qa-owner@example.invalid",
    orgId: "qa-workspace",
  };
  state.groups = [];
});

describe("list-data-connection-schemas template order", () => {
  it("delivers the original's 17 templates in the original order", async () => {
    const result = await schemaAction.run({}, {} as never);
    expect(result.schemas.map((schema) => schema.name)).toEqual([
      "Snowflake",
      "PostgreSQL",
      "Google BigQuery",
      "MySQL",
      "Amazon Redshift",
      "Amazon Athena",
      "Databricks",
      "ClickHouse",
      "AlloyDB",
      "Google Cloud SQL",
      "MariaDB",
      "MotherDuck",
      "Presto",
      "Amazon RDS",
      "SQL Server",
      "Starburst",
      "Trino",
    ]);
    // The grid order is the delivered order, so it is not alphabetical.
    const names = result.schemas.map((schema) => schema.name);
    expect([...names].sort()).not.toEqual(names);
  });

  it("gives every template with a form its real fields and leaves the rest as notices", async () => {
    const result = await schemaAction.run({}, {} as never);
    const withForms = [
      "postgres",
      "bigquery",
      "redshift",
      "athena",
      "clickhouse",
    ];
    expect(
      result.schemas
        .filter((schema) => schema.supported !== false)
        .map((schema) => schema.type),
    ).toEqual(["postgres", "bigquery"]);
    expect(
      result.schemas
        .filter((schema) => schema.sections.length > 0)
        .map((schema) => schema.type),
    ).toEqual(withForms);
    const fieldIds = (type: string) =>
      result.schemas
        .find((schema) => schema.type === type)
        ?.sections.flatMap((section) => section.fields.map(({ id }) => id));
    expect(fieldIds("bigquery")).toContain("serviceAccount");
    expect(fieldIds("postgres")).toEqual(
      expect.arrayContaining([
        "host",
        "port",
        "database",
        "username",
        "password",
      ]),
    );
    expect(fieldIds("redshift")).toEqual(
      expect.arrayContaining([
        "host",
        "port",
        "database",
        "username",
        "password",
      ]),
    );
    expect(fieldIds("clickhouse")).toEqual(
      expect.arrayContaining([
        "host",
        "port",
        "database",
        "username",
        "password",
      ]),
    );
    expect(fieldIds("athena")).toEqual(
      expect.arrayContaining([
        "region",
        "outputLocation",
        "accessKeyId",
        "secretAccessKey",
      ]),
    );
    for (const schema of result.schemas.filter(
      (candidate) => !withForms.includes(candidate.type),
    )) {
      expect(schema.supported).toBe(false);
      expect(schema.sections).toEqual([]);
    }
  });

  it("delivers section-toggle presentation and documentation to browser callers", async () => {
    const result = await schemaAction.run({}, {} as never);
    const fields = result.schemas
      .find((schema) => schema.type === "bigquery")
      ?.sections.flatMap((section) => section.fields);
    expect(
      fields?.find((field) => field.id === "customCodeFormatting")?.toggleFirst,
    ).toBe(true);
    expect(
      fields?.find((field) => field.id === "includeForAI")?.toggleFirst,
    ).toBe(true);
    const dbt = fields?.find((field) => field.id === "hasDbtMetadata");
    expect(dbt?.toggleFirst).toBe(true);
    expect(dbt?.icon).toBe("dbt");
    expect(dbt?.docsUrl).toBe(
      "https://docs.getdbt.com/docs/dbt-cloud-apis/discovery-api",
    );
    expect(
      fields?.find((field) => field.id === "driveAccess")?.toggleFirst,
    ).toBeUndefined();
  });

  it("offers dbt metadata configuration without warehouse Writeback or JDBC controls", async () => {
    const { schemas } = await schemaAction.run({}, {} as never);
    const fields = schemas
      .find(({ type }) => type === "bigquery")
      ?.sections.flatMap(({ fields }) => fields);
    const fieldIds = fields?.map(({ id }) => id);
    expect(fieldIds).toEqual(
      expect.arrayContaining([
        "projectId",
        "serviceAccount",
        "hasDbtMetadata",
        "dbtVersion",
        "dbtEnvironmentId",
        "dbtToken",
      ]),
    );
    expect(fieldIds).not.toContain("allowWriteback");
    expect(fieldIds).not.toContain("useDbtJdbcDriver");
    expect(fieldIds).not.toContain("dbtRequireCertificateVerification");
  });

  it("keeps the workspace access options on the BigQuery form and refuses anonymous callers", async () => {
    state.groups = [{ id: "finance", name: "Finance" }];
    const result = await schemaAction.run({}, {} as never);
    const bigQuery = result.schemas.find(
      (schema) => schema.type === "bigquery",
    );
    const access = bigQuery?.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "queryAccessGroupIds");
    expect(access?.options?.map((option) => option.value)).toEqual([
      "workspace",
      "finance",
    ]);
    state.actor = null;
    await expect(schemaAction.run({}, {} as never)).rejects.toThrow(
      "signed-in account",
    );
  });
});
