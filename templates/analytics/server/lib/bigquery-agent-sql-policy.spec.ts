import { describe, expect, it } from "vitest";

import {
  BIGQUERY_AGENT_DATASET_ALLOWLIST,
  BigQueryAgentSqlRefusal,
  checkBigQueryAgentSql,
  checkBigQueryAgentTableKind,
  crossCheckBigQueryAgentDryRun,
} from "./bigquery-agent-sql-policy";

const PROJECT = "builder-3b0a2";

function refusal(run: () => unknown): BigQueryAgentSqlRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof BigQueryAgentSqlRefusal) return error;
    throw error;
  }
  throw new Error("Expected the policy to refuse");
}

function refused(sql: string) {
  return refusal(() => checkBigQueryAgentSql(sql, PROJECT));
}

describe("BigQuery outside-agent SQL policy", () => {
  it("accepts one SELECT over fully qualified allowlisted tables and resolves @project", () => {
    const checked = checkBigQueryAgentSql(
      `WITH recent AS (
         SELECT user_id FROM \`builder-3b0a2.dbt_mart.users\` WHERE created_at > '2026-01-01'
       )
       SELECT r.user_id, SAFE_DIVIDE(1, 2) AS half, SAFE.LOG(10) AS l
       FROM recent AS r
       JOIN @project.hubspot.companies AS c ON c.id = r.user_id
       LIMIT 10`,
      PROJECT,
    );
    expect(checked.tables).toEqual([
      { projectId: PROJECT, datasetId: "dbt_mart", tableId: "users" },
      { projectId: PROJECT, datasetId: "hubspot", tableId: "companies" },
    ]);
    expect(checked.sql).toContain("`builder-3b0a2`.hubspot.companies");
  });

  it.each([
    [
      "INFORMATION_SCHEMA",
      "SELECT * FROM `builder-3b0a2.dbt_mart.INFORMATION_SCHEMA.TABLES`",
      /INFORMATION_SCHEMA/,
    ],
    [
      "regional INFORMATION_SCHEMA",
      "SELECT * FROM `builder-3b0a2`.`region-us`.INFORMATION_SCHEMA.JOBS",
      /INFORMATION_SCHEMA/,
    ],
    [
      "a wildcard table",
      "SELECT * FROM `builder-3b0a2.billing_export.gcp_billing_export_v1_*`",
      /Wildcard/,
    ],
    [
      "_TABLE_SUFFIX",
      "SELECT _TABLE_SUFFIX FROM `builder-3b0a2.amplitude.events`",
      /_TABLE_SUFFIX/,
    ],
    [
      "EXTERNAL_QUERY as a source",
      "SELECT * FROM EXTERNAL_QUERY('conn', 'SELECT 1')",
      /Table functions/,
    ],
    [
      "EXTERNAL_QUERY in an expression",
      "SELECT EXTERNAL_QUERY('conn', 'SELECT 1') AS x",
      /EXTERNAL_QUERY is not allowed/,
    ],
    [
      "a table function",
      "SELECT * FROM `builder-3b0a2.dbt_mart.tvf`(1)",
      /Table functions/,
    ],
    [
      "a remote function",
      "SELECT `builder-3b0a2.dbt_mart.remote_fn`(x) FROM `builder-3b0a2.dbt_mart.users`",
      /user-defined functions/,
    ],
    [
      "a persistent UDF",
      "SELECT dbt_mart.my_udf(x) FROM `builder-3b0a2.dbt_mart.users`",
      /user-defined functions/,
    ],
    [
      "ML.* as a source",
      "SELECT * FROM ML.PREDICT(MODEL `builder-3b0a2.dbt_mart.m`, TABLE `builder-3b0a2.dbt_mart.users`)",
      /Table functions/,
    ],
    [
      "ML.* in an expression",
      "SELECT ML.STANDARD_SCALER(x) OVER () FROM `builder-3b0a2.dbt_mart.users`",
      /ML\.\* functions/,
    ],
    [
      "AI.*",
      "SELECT AI.GENERATE('hi') FROM `builder-3b0a2.dbt_mart.users`",
      /AI\.\* functions/,
    ],
    [
      "APPENDS",
      "SELECT * FROM APPENDS(TABLE `builder-3b0a2.dbt_mart.users`, NULL, NULL)",
      /Table functions/,
    ],
    [
      "CHANGES",
      "SELECT * FROM CHANGES(TABLE `builder-3b0a2.dbt_mart.users`, NULL, NULL)",
      /Table functions/,
    ],
    [
      "CHANGES in an expression",
      "SELECT CHANGES(1) FROM `builder-3b0a2.dbt_mart.users`",
      /CHANGES is not allowed/,
    ],
    [
      "a query parameter",
      "SELECT * FROM `builder-3b0a2.dbt_mart.users` WHERE id = @id",
      /parameters/,
    ],
    ["a system variable", "SELECT @@project_id", /parameters/],
  ])("refuses %s", (_name, sql, reason) => {
    const error = refused(sql);
    expect(error.code).toBe("query_feature_not_allowed");
    expect(error.message).toMatch(reason);
  });

  it.each([
    ["INSERT", "INSERT INTO `builder-3b0a2.dbt_mart.users` (id) VALUES (1)"],
    ["DELETE", "DELETE FROM `builder-3b0a2.dbt_mart.users` WHERE TRUE"],
    ["CREATE", "CREATE TABLE `builder-3b0a2.dbt_mart.copy` AS SELECT 1"],
    ["EXPORT DATA", "EXPORT DATA OPTIONS(uri='gs://x/*') AS SELECT 1"],
    ["multiple statements", "SELECT 1; SELECT 2"],
    ["a script", "DECLARE x INT64 DEFAULT 1; SELECT x"],
    ["a temporary function", "CREATE TEMP FUNCTION f() AS (1); SELECT f()"],
    [
      "MERGE",
      "MERGE `builder-3b0a2.dbt_mart.users` T USING (SELECT 1 AS id) S ON T.id = S.id WHEN MATCHED THEN DELETE",
    ],
    [
      "a trailing second statement",
      "SELECT 1;\nDROP TABLE `builder-3b0a2.dbt_mart.users`",
    ],
    ["BEGIN", "BEGIN SELECT 1; END"],
  ])("refuses a non-SELECT or multi-statement query: %s", (_name, sql) => {
    expect(refused(sql).code).toBe("query_statement_not_allowed");
  });

  it("accepts one SELECT with a trailing semicolon and a parenthesized SELECT", () => {
    expect(
      checkBigQueryAgentSql(
        "SELECT id FROM `builder-3b0a2.dbt_mart.users`;",
        PROJECT,
      ).tables,
    ).toHaveLength(1);
    expect(
      checkBigQueryAgentSql(
        "(SELECT id FROM `builder-3b0a2.dbt_mart.users`)",
        PROJECT,
      ).tables,
    ).toHaveLength(1);
  });

  it("refuses a table outside the dataset allowlist and names the allowed datasets", () => {
    const error = refused("SELECT * FROM `builder-3b0a2.raw_pii.users`");
    expect(error.code).toBe("query_table_not_allowed");
    expect(error.message).toContain("dbt_mart");
  });

  it("refuses cloud billing data, which is left off the allowlist", () => {
    const error = refused(
      "SELECT cost FROM `builder-3b0a2.billing_export.gcp_billing_export_v1_0123`",
    );
    expect(error.code).toBe("query_table_not_allowed");
    expect(error.message).not.toContain("billing_export:");
  });

  it("refuses a table in a project with no allowlist", () => {
    expect(refused("SELECT * FROM `other-project-1.dbt_mart.users`").code).toBe(
      "query_table_not_allowed",
    );
  });

  it.each([
    ["dataset.table", "SELECT * FROM dbt_mart.users"],
    ["a bare table", "SELECT * FROM users"],
  ])("refuses an unqualified table: %s", (_name, sql) => {
    const error = refused(sql);
    expect(error.code).toBe("query_table_not_allowed");
    expect(error.message).toContain("project.dataset.table");
  });

  it("is deny-all on a connection whose project has no allowlist", () => {
    expect(
      refusal(() =>
        checkBigQueryAgentSql(
          "SELECT * FROM `builder-3b0a2.dbt_mart.users`",
          "someone-elses-project",
        ),
      ).code,
    ).toBe("query_table_not_allowed");
  });

  it("keeps the reviewed dataset list exactly as approved", () => {
    expect(BIGQUERY_AGENT_DATASET_ALLOWLIST).toEqual({
      "builder-3b0a2": [
        "amplitude",
        "dbt_analytics",
        "dbt_mart",
        "dbt_staging_bigquery",
        "dbt_staging_firestore",
        "finance",
        "hubspot",
        "metrics",
        "sigma_materialized",
      ],
    });
  });

  it("refuses unreviewed views and external tables, and accepts plain tables", () => {
    const ref = { projectId: PROJECT, datasetId: "dbt_mart", tableId: "v" };
    expect(
      refusal(() => checkBigQueryAgentTableKind(ref, { type: "VIEW" })).code,
    ).toBe("query_table_not_allowed");
    expect(
      refusal(() =>
        checkBigQueryAgentTableKind(ref, { type: "MATERIALIZED_VIEW" }),
      ).code,
    ).toBe("query_table_not_allowed");
    expect(
      refusal(() => checkBigQueryAgentTableKind(ref, { type: "EXTERNAL" }))
        .code,
    ).toBe("query_feature_not_allowed");
    expect(refusal(() => checkBigQueryAgentTableKind(ref, {})).code).toBe(
      "query_table_not_allowed",
    );
    expect(() =>
      checkBigQueryAgentTableKind(ref, { type: "TABLE" }),
    ).not.toThrow();
  });

  describe("table kinds read from the whole tables.get resource", () => {
    const ref = { projectId: PROJECT, datasetId: "dbt_mart", tableId: "t" };

    it.each([
      [
        "a managed BigLake (Iceberg) table typed TABLE",
        {
          type: "TABLE",
          biglakeConfiguration: {
            connectionId: "builder-3b0a2.us.lake",
            storageUri: "gs://lake/t",
            fileFormat: "PARQUET",
            tableFormat: "ICEBERG",
          },
        },
        /BigLake/,
      ],
      [
        "a table typed TABLE with an external data configuration",
        {
          type: "TABLE",
          externalDataConfiguration: { sourceUris: ["gs://x/*"] },
        },
        /external/,
      ],
      [
        "a table typed SNAPSHOT that reads external storage",
        {
          type: "SNAPSHOT",
          externalDataConfiguration: { sourceUris: ["gs://x/*"] },
        },
        /external/,
      ],
    ])("refuses %s", (_name, metadata, reason) => {
      const error = refusal(() => checkBigQueryAgentTableKind(ref, metadata));
      expect(error.code).toBe("query_feature_not_allowed");
      expect(error.message).toMatch(reason);
    });

    it("accepts a table snapshot, which is native and read-only", () => {
      expect(() =>
        checkBigQueryAgentTableKind(ref, {
          type: "SNAPSHOT",
          snapshotDefinition: {
            baseTableReference: {
              projectId: PROJECT,
              datasetId: "dbt_mart",
              tableId: "users",
            },
            snapshotTime: "2026-11-01T00:00:00Z",
          },
        }),
      ).not.toThrow();
    });

    it("accepts a table clone, which is native storage typed TABLE", () => {
      expect(() =>
        checkBigQueryAgentTableKind(ref, {
          type: "TABLE",
          cloneDefinition: {
            baseTableReference: {
              projectId: PROJECT,
              datasetId: "dbt_mart",
              tableId: "users",
            },
            cloneTime: "2026-11-01T00:00:00Z",
          },
        }),
      ).not.toThrow();
    });
  });

  it.each([
    ["EXECUTE IMMEDIATE", "EXECUTE IMMEDIATE 'SELECT 1'"],
    ["CALL", "CALL `builder-3b0a2.dbt_mart.refresh`()"],
    ["SET", "SET @@dataset_id = 'dbt_mart'"],
    [
      "LOAD DATA",
      "LOAD DATA INTO `builder-3b0a2.dbt_mart.users` FROM FILES (format = 'CSV', uris = ['gs://x/*'])",
    ],
    [
      "ASSERT",
      "ASSERT (SELECT COUNT(*) FROM `builder-3b0a2.dbt_mart.users`) > 0",
    ],
    [
      "a JavaScript UDF body",
      "CREATE TEMP FUNCTION f(x FLOAT64) RETURNS FLOAT64 LANGUAGE js AS r'''return x * 2;'''; SELECT f(id) FROM `builder-3b0a2.dbt_mart.users`",
    ],
  ])("refuses a script or non-query statement: %s", (_name, sql) => {
    expect(refused(sql).code).toBe("query_statement_not_allowed");
  });

  it.each([
    [
      "VECTOR_SEARCH",
      "SELECT * FROM VECTOR_SEARCH(TABLE `builder-3b0a2.dbt_mart.docs`, 'embedding', (SELECT [1.0] AS embedding))",
      /Table functions/,
    ],
    [
      "VECTOR_SEARCH in an expression",
      "SELECT VECTOR_SEARCH(1) FROM `builder-3b0a2.dbt_mart.users`",
      /VECTOR_SEARCH is not allowed/,
    ],
    [
      "OBJ.*",
      "SELECT OBJ.GET_ACCESS_URL(ref, 'r') FROM `builder-3b0a2.dbt_mart.users`",
      /OBJ\.\*, KEYS\.\* and AEAD\.\* functions are not allowed/,
    ],
    [
      "KEYS.*",
      "SELECT KEYS.KEYSET_CHAIN('gcp-kms://k', b'x') FROM `builder-3b0a2.dbt_mart.users`",
      /OBJ\.\*, KEYS\.\* and AEAD\.\* functions are not allowed/,
    ],
    [
      "AEAD.*",
      "SELECT AEAD.DECRYPT_STRING(keyset, secret, 'aad') FROM `builder-3b0a2.dbt_mart.users`",
      /OBJ\.\*, KEYS\.\* and AEAD\.\* functions are not allowed/,
    ],
  ])("refuses %s", (_name, sql, reason) => {
    const error = refused(sql);
    expect(error.code).toBe("query_feature_not_allowed");
    expect(error.message).toMatch(reason);
  });

  it("accepts a table named with all three parts quoted separately", () => {
    expect(
      checkBigQueryAgentSql(
        "SELECT id FROM `builder-3b0a2`.`dbt_mart`.`users`",
        PROJECT,
      ).tables,
    ).toEqual([
      { projectId: PROJECT, datasetId: "dbt_mart", tableId: "users" },
    ]);
  });

  it("refuses an implicit array path, which reads as an unqualified table", () => {
    const error = refused(
      "SELECT tag FROM `builder-3b0a2.dbt_mart.users` AS u, u.tags AS tag",
    );
    expect(error.code).toBe("query_table_not_allowed");
    expect(error.message).toContain("project.dataset.table");
  });

  it("accepts time travel on an allowlisted table", () => {
    expect(
      checkBigQueryAgentSql(
        "SELECT id FROM `builder-3b0a2.dbt_mart.users` FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)",
        PROJECT,
      ).tables,
    ).toEqual([
      { projectId: PROJECT, datasetId: "dbt_mart", tableId: "users" },
    ]);
  });

  it("refuses TABLESAMPLE SYSTEM even on an allowlisted table, since the lexer cannot bound its source", () => {
    const error = refused(
      "SELECT id FROM `builder-3b0a2.dbt_mart.users` TABLESAMPLE SYSTEM (10 PERCENT)",
    );
    expect(error.code).toBe("query_feature_not_allowed");
    expect(error.message).toContain("source boundary");
  });

  it("refuses a bare dashed project name, which needs backticks or @project", () => {
    expect(() =>
      checkBigQueryAgentSql(
        "SELECT id FROM builder-3b0a2.dbt_mart.users",
        PROJECT,
      ),
    ).toThrow(BigQueryAgentSqlRefusal);
  });

  describe("dry-run cross-check", () => {
    const checked = checkBigQueryAgentSql(
      "SELECT id FROM `builder-3b0a2.dbt_mart.users`",
      PROJECT,
    );
    const users = {
      projectId: PROJECT,
      datasetId: "dbt_mart",
      tableId: "users",
    };

    it("passes when the dry run reads exactly the named tables as one SELECT", () => {
      expect(() =>
        crossCheckBigQueryAgentDryRun(checked, {
          statementType: "SELECT",
          referencedTables: [users],
        }),
      ).not.toThrow();
    });

    it.each([
      ["a script", { statementType: "SCRIPT", referencedTables: [users] }],
      ["DML", { statementType: "INSERT", referencedTables: [users] }],
      [
        "DDL",
        { statementType: "CREATE_TABLE_AS_SELECT", referencedTables: [users] },
      ],
      ["no statement type", { referencedTables: [users] }],
    ])("refuses a dry run that reports %s", (_name, dryRun) => {
      expect(
        refusal(() => crossCheckBigQueryAgentDryRun(checked, dryRun)).code,
      ).toBe("query_statement_not_allowed");
    });

    it("refuses a dry run that reads a routine, and one whose routine list is unreadable", () => {
      expect(
        refusal(() =>
          crossCheckBigQueryAgentDryRun(checked, {
            statementType: "SELECT",
            referencedTables: [users],
            referencedRoutines: [
              { projectId: PROJECT, datasetId: "dbt_mart", routineId: "f" },
            ],
          }),
        ).code,
      ).toBe("query_feature_not_allowed");
      expect(
        refusal(() =>
          crossCheckBigQueryAgentDryRun(checked, {
            statementType: "SELECT",
            referencedTables: [users],
            referencedRoutines: "malformed",
          }),
        ).code,
      ).toBe("query_feature_not_allowed");
    });

    it("refuses a missing table list when the SQL names a table", () => {
      expect(
        refusal(() =>
          crossCheckBigQueryAgentDryRun(checked, { statementType: "SELECT" }),
        ).code,
      ).toBe("query_table_not_allowed");
    });

    it("refuses a dry-run table outside the allowlist even when the SQL names it", () => {
      const outside = checkBigQueryAgentSql(
        "SELECT id FROM `builder-3b0a2.dbt_mart.users`",
        PROJECT,
      );
      outside.tables.push({
        projectId: PROJECT,
        datasetId: "billing_export",
        tableId: "costs",
      });
      expect(
        refusal(() =>
          crossCheckBigQueryAgentDryRun(outside, {
            statementType: "SELECT",
            referencedTables: [
              users,
              {
                projectId: PROJECT,
                datasetId: "billing_export",
                tableId: "costs",
              },
            ],
          }),
        ).code,
      ).toBe("query_table_not_allowed");
    });

    it("refuses a table the SQL does not name, even inside the allowlist", () => {
      expect(
        refusal(() =>
          crossCheckBigQueryAgentDryRun(checked, {
            statementType: "SELECT",
            referencedTables: [
              users,
              { projectId: PROJECT, datasetId: "raw_pii", tableId: "people" },
            ],
          }),
        ).code,
      ).toBe("query_table_not_allowed");
    });

    it("refuses a named table the dry run does not read (a view) and an unreadable list", () => {
      expect(
        refusal(() =>
          crossCheckBigQueryAgentDryRun(checked, {
            statementType: "SELECT",
            referencedTables: [],
          }),
        ).code,
      ).toBe("query_table_not_allowed");
      expect(
        refusal(() =>
          crossCheckBigQueryAgentDryRun(checked, {
            statementType: "SELECT",
            referencedTables: "malformed",
          }),
        ).code,
      ).toBe("query_table_not_allowed");
    });
  });
});
