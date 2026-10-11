import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sourceIndexBundleSchema } from "../server/lib/source-index-schema";
import {
  compileSourceIndex,
  parseSourceIndexArgs,
  SourceIndexError,
  writeSourceIndex,
} from "./build-source-index";

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "analytics-source-index-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("parseSourceIndexArgs", () => {
  it("requires explicit dbt roots and an output path while allowing code roots", () => {
    expect(() => parseSourceIndexArgs([])).toThrow(SourceIndexError);
    expect(() => parseSourceIndexArgs(["--dbt-root", "/tmp/dbt"])).toThrow(
      /--out is required/,
    );
    expect(
      parseSourceIndexArgs([
        "--dbt-root=/tmp/dbt",
        "--code-root",
        "/tmp/app",
        "--sigma-reviewed-manifest",
        ".tmp/sigma-review.json",
        "--sigma-env-file",
        "/private/ai-services/.env",
        "--out",
        ".tmp/index.json",
      ]),
    ).toEqual({
      dbtRoots: ["/tmp/dbt"],
      codeRoots: ["/tmp/app"],
      sigmaReviewedManifest: ".tmp/sigma-review.json",
      sigmaEnvFile: "/private/ai-services/.env",
      out: ".tmp/index.json",
    });
  });

  it("requires the named ai-services env file only when a Sigma manifest is requested", () => {
    expect(() =>
      parseSourceIndexArgs([
        "--dbt-root",
        "/tmp/dbt",
        "--sigma-env-file",
        "/private/ai-services/.env",
        "--out",
        "/tmp/index.json",
      ]),
    ).toThrow(/requires --sigma-reviewed-manifest/);
  });
});

describe("compileSourceIndex", () => {
  it("indexes dbt semantic models and metrics with declared grain and group owner", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "semantic.yml"),
      [
        "version: 2",
        "groups:",
        "  - name: product_analytics",
        "    owner:",
        "      name: Product Analytics",
        "      email: private@example.com",
        "semantic_models:",
        "  - name: workspaces",
        "    model: ref('dim_workspaces')",
        "    description: Workspace entity model.",
        "    group: product_analytics",
        "    defaults:",
        "      agg_time_dimension: created_at",
        "    primary_entity: workspace",
        "    entities:",
        "      - name: workspace",
        "        type: primary",
        "        expr: workspace_id",
        "    measures:",
        "      - name: workspace_count",
        "        agg: count",
        "metrics:",
        "  - name: active_workspaces",
        "    label: Active workspaces",
        "    description: Number of active workspaces.",
        "    type: simple",
        "    type_params:",
        "      measure: workspace_count",
      ].join("\n"),
    );
    await writeFile(
      path.join(dbtRoot, "models", "dim_workspaces.sql"),
      "{{ config(materialized='incremental', unique_key='workspace_id') }}\nselect 1 as workspace_id",
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    const semanticModel = bundle.entries.find(
      (entry) => entry.entryType === "semantic_model",
    );
    const metric = bundle.entries.find((entry) => entry.entryType === "metric");

    expect(semanticModel).toMatchObject({
      metric: "semantic_model:workspaces",
      owner: "Product Analytics",
      grain: "Unique key: workspace_id",
      primaryEntity: "workspace",
      timeDimension: "created_at",
      table: "dim_workspaces",
    });
    expect(semanticModel?.definition).toContain(
      "Primary entity expression: workspace_id",
    );
    expect(metric).toMatchObject({
      metric: "metric:active_workspaces",
      owner: "Product Analytics",
      grain: "Unique key: workspace_id",
      primaryEntity: "workspace",
      timeDimension: "created_at",
      semanticModel: "workspaces",
    });
    expect(JSON.stringify([semanticModel, metric])).not.toContain(
      "private@example.com",
    );
  });

  it("resolves dbt doc references and fingerprints their source text", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await mkdir(path.join(dbtRoot, "docs", "models"), { recursive: true });
    const docPath = path.join(dbtRoot, "docs", "models", "membership.md");
    const docText = `Membership counts use the month cutoff. ${"This declared rule distinguishes membership from activity. ".repeat(18)}The final caveat remains available to search.`;
    await writeFile(
      docPath,
      `{% docs membership_counts %}\n${docText}\n{% enddocs %}\n`,
    );
    await writeFile(
      path.join(dbtRoot, "models", "schema.yml"),
      [
        "version: 2",
        "models:",
        "  - name: aggregate_monthly_users_per_org",
        "    description: \"{{ doc('membership_counts') }}\"",
      ].join("\n"),
    );
    await writeFile(
      path.join(dbtRoot, "models", "aggregate_monthly_users_per_org.sql"),
      "{{ config(unique_key = ['date_month', 'org_id']) }}\nselect 1",
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-10T00:00:00.000Z",
    });
    const entry = bundle.entries.find(
      (candidate) =>
        candidate.metric === "model:aggregate_monthly_users_per_org",
    );
    const originalFingerprint = bundle.sources[0]?.contentFingerprint;

    expect(entry?.definition).toContain(
      "Membership counts use the month cutoff",
    );
    expect(entry?.definition).toContain(
      "The final caveat remains available to search.",
    );
    expect(entry?.definition).not.toContain("{{ doc(");

    await writeFile(
      docPath,
      `{% docs membership_counts %}\n${docText} Updated definition.\n{% enddocs %}\n`,
    );
    const updatedBundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-10T00:00:00.000Z",
    });

    expect(updatedBundle.sources[0]?.contentFingerprint).not.toBe(
      originalFingerprint,
    );
  });

  it("uses the primary entity name when primary_entity is omitted", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "semantic.yml"),
      [
        "version: 2",
        "semantic_models:",
        "  - name: workspaces",
        "    model: ref('dim_workspaces')",
        "    entities:",
        "      - name: workspace",
        "        type: primary",
        "        expr: workspace_id",
      ].join("\n"),
    );
    await writeFile(
      path.join(dbtRoot, "models", "dim_workspaces.sql"),
      "select 1 as workspace_id",
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    const semanticModel = bundle.entries.find(
      (entry) => entry.entryType === "semantic_model",
    );

    expect(semanticModel).toMatchObject({
      primaryEntity: "workspace",
      grain: "Primary entity: workspace_id",
    });
    expect(semanticModel?.definition).toContain("Primary entity: workspace");
    expect(semanticModel?.definition).toContain(
      "Primary entity expression: workspace_id",
    );
  });

  it("indexes a top-level primary entity without inferring row grain from it", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "semantic.yml"),
      [
        "version: 2",
        "semantic_models:",
        "  - name: activity",
        "    model: ref('fact_activity')",
        "    description: One row per event_date, user_id, org_id, event_type.",
        "    primary_entity: builder_activity",
        "    entities:",
        "      - name: user",
        "        type: foreign",
        "        expr: user_id",
      ].join("\n"),
    );
    await writeFile(
      path.join(dbtRoot, "models", "fact_activity.sql"),
      "select 1 as event_date, 2 as user_id, 3 as org_id, 4 as event_type",
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    const semanticModel = bundle.entries.find(
      (entry) => entry.entryType === "semantic_model",
    );

    expect(semanticModel).toMatchObject({
      metric: "semantic_model:activity",
      primaryEntity: "builder_activity",
    });
    expect(semanticModel?.grain).toBeUndefined();
    expect(semanticModel?.definition).toContain(
      "One row per event_date, user_id, org_id, event_type.",
    );
  });

  it("indexes model-embedded semantic metadata, simple metrics, and inherited group owners", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "fct_orders.yml"),
      [
        "version: 2",
        "groups:",
        "  - name: revenue_analytics",
        "    owner:",
        "      name: Revenue Analytics",
        "models:",
        "  - name: fct_orders",
        "    description: Order facts for business reporting.",
        "    config:",
        "      group: revenue_analytics",
        "    semantic_model:",
        "      enabled: true",
        "      name: orders",
        "    agg_time_dimension: ordered_at",
        "    columns:",
        "      - name: order_id",
        "        entity:",
        "          type: primary",
        "          name: order",
        "      - name: customer_id",
        "        entity:",
        "          type: foreign",
        "          name: customer",
        "      - name: ordered_at",
        "        granularity: day",
        "        dimension:",
        "          type: time",
        "      - name: order_status",
        "        dimension:",
        "          type: categorical",
        "    metrics:",
        "      - name: order_total",
        "        description: Total order amount.",
        "        type: simple",
        "        agg: sum",
        "        expr: amount",
      ].join("\n"),
    );
    await writeFile(
      path.join(dbtRoot, "models", "fct_orders.sql"),
      "select 1 as order_id, 2 as customer_id, current_date as ordered_at, 'paid' as order_status, 10 as amount",
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    const semanticModel = bundle.entries.find(
      (entry) => entry.metric === "semantic_model:orders",
    );
    const metric = bundle.entries.find(
      (entry) => entry.metric === "metric:order_total",
    );
    const model = bundle.entries.find(
      (entry) => entry.metric === "model:fct_orders",
    );

    expect(semanticModel).toMatchObject({
      owner: "Revenue Analytics",
      grain: "Primary entity: order",
      primaryEntity: "order",
      timeDimension: "ordered_at",
      table: "fct_orders",
    });
    expect(semanticModel?.definition).toContain(
      "Entity columns: order_id (primary order); customer_id (foreign customer)",
    );
    expect(semanticModel?.definition).toContain(
      "Dimensions: ordered_at (time, day); order_status (categorical)",
    );
    expect(metric).toMatchObject({
      metric: "metric:order_total",
      owner: "Revenue Analytics",
      grain: "Primary entity: order",
      primaryEntity: "order",
      timeDimension: "ordered_at",
      semanticModel: "orders",
      table: "fct_orders",
    });
    expect(metric?.definition).toContain("Aggregation: sum");
    expect(metric?.definition).toContain("Expression: amount");
    expect(model?.definition).toContain("Order facts for business reporting.");
    expect(model?.definition).not.toContain("order_id (primary)");
  });

  it("preserves multiline descriptions and reports omitted or truncated metadata", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "schema.yml"),
      [
        "version: 2",
        "models:",
        "  - name: valid_model",
        "    description: |",
        "      Business note #3 explains the model grain.",
        "      The next line contains additional business context.",
        "  - name: invalid/model",
        "    description: Unsafe model names are reported.",
        "  - name: long_model",
        "    description: >",
        `      ${"Business context ".repeat(200)}`,
      ].join("\n"),
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    const validModel = bundle.entries.find(
      (entry) => entry.metric === "model:valid_model",
    );
    const longModel = bundle.entries.find(
      (entry) => entry.metric === "model:long_model",
    );

    expect(validModel?.status).toBe("active");
    expect(validModel?.definition).toContain(
      "Business note #3 explains the model grain.",
    );
    expect(validModel?.definition).toContain(
      "The next line contains additional business context.",
    );
    expect(longModel?.definition).toContain(
      "definition excerpt truncated; inspect source",
    );
    expect(bundle.scanSummary).toMatchObject({
      unsafeEntriesOmitted: 1,
      truncatedFields: 1,
    });
    expect(sourceIndexBundleSchema.parse(bundle).scanSummary).toEqual(
      bundle.scanSummary,
    );
  });

  it("fails loudly on a malformed quoted dbt YAML scalar", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "schema.yml"),
      [
        "version: 2",
        "models:",
        "  - name: synthetic_model",
        '    description: "bad\\q escape"',
      ].join("\n"),
    );

    await expect(
      compileSourceIndex({
        dbtRoots: [dbtRoot],
        generatedAt: "2026-10-09T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "invalid_yaml_scalar" });
  });

  it("reads Sigma credentials only from ai-services/.env and excludes them from the generated bundle", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    const aiServicesRoot = path.join(root, "ai-services");
    const manifestPath = path.join(root, "review.json");
    const envPath = path.join(aiServicesRoot, ".env");
    await mkdir(dbtRoot, { recursive: true });
    await mkdir(aiServicesRoot, { recursive: true });
    await writeFile(
      envPath,
      [
        "SIGMA_BASE_URL=https://aws-api.sigmacomputing.com",
        "SIGMA_CLIENT_ID=fake-sigma-client-id",
        "SIGMA_CLIENT_SECRET=fake-sigma-client-secret",
      ].join("\n"),
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        items: [{ workbookId: "workbook-1", elementIds: ["element-1"] }],
      }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/v2/auth/token") {
          return new Response(JSON.stringify({ access_token: "fake-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/v2/workbooks") {
          return new Response(
            JSON.stringify({
              entries: [{ workbookId: "workbook-1", name: "Reviewed metrics" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname.endsWith("/elements")) {
          return new Response(
            JSON.stringify({
              entries: [
                {
                  elementId: "element-1",
                  name: "Events by channel",
                  type: "table",
                  columns: ["event_name"],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname.endsWith("/queries")) {
          return new Response(JSON.stringify({ entries: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("unexpected route", { status: 404 });
      },
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      sigmaReviewedManifest: manifestPath,
      sigmaEnvFile: envPath,
      generatedAt: "2026-10-09T00:00:00.000Z",
    });
    const serialized = JSON.stringify(bundle);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0]).toMatchObject({ sourceKind: "sigma" });
    expect(serialized).not.toContain("fake-sigma-client-id");
    expect(serialized).not.toContain("fake-sigma-client-secret");
    expect(serialized).not.toContain("fake-token");
  });

  it("builds a versioned metadata-only bundle from dbt docs, SQL structure, and static tracking calls", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    const codeRoot = path.join(root, "product-app");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await mkdir(path.join(dbtRoot, "tests"), { recursive: true });
    await mkdir(path.join(codeRoot, "src"), { recursive: true });
    await mkdir(path.join(codeRoot, ".tmp"), { recursive: true });
    await mkdir(path.join(codeRoot, ".yarn"), { recursive: true });
    await writeFile(
      path.join(codeRoot, ".env"),
      "SIGMA_CLIENT_SECRET=fake-secret-that-must-not-be-read-or-hashed",
    );
    await writeFile(
      path.join(dbtRoot, "models", "orders.sql"),
      [
        '{{ config(unique_key = ["order_id", "organization_id"]) }}',
        "SELECT order_id, organization_id, 'do-not-export-row-value' AS sample_value",
        "FROM {{ ref('stg_orders') }}",
        "JOIN {{ source('app', 'organizations') }} AS organizations USING (organization_id)",
        "-- FROM {{ ref('commented_out_model') }}",
        "/* {{ source('private', 'commented_out_table') }} */",
      ].join("\n"),
    );
    await writeFile(
      path.join(dbtRoot, "models", "schema.yml"),
      [
        "version: 2",
        "models:",
        "  - name: orders",
        "    description: Order facts for product analysis.",
        "    tests:",
        "      - dbt_utils.unique_combination_of_columns:",
        "          arguments:",
        "            combination_of_columns:",
        "              - order_id",
        "              - organization_id",
        "    columns:",
        "      - name: order_id",
        "        description: Stable order identifier.",
        "        data_type: STRING",
        "        tests: [unique, not_null]",
        "      - name: owner_email",
        '        description: "Synthetic contact user@example.test"',
        "  - name: dim_agent_native_users",
        "    description: Agent-Native user dimension.",
        "  - name: active_users",
        "    description: Active product users by day.",
      ].join("\n"),
    );
    await writeFile(
      path.join(dbtRoot, "models", "dim_agent_native_users.sql"),
      "SELECT user_id FROM source_users",
    );
    await writeFile(
      path.join(dbtRoot, "models", "active_users.sql"),
      "SELECT user_id FROM daily_activity",
    );
    await writeFile(
      path.join(dbtRoot, "tests", "order_count.sql"),
      "SELECT * FROM {{ ref('orders') }} WHERE count_value = 'test-only-value'",
    );
    await writeFile(
      path.join(codeRoot, "src", "track.ts"),
      [
        'const CREATED_EVENT = "user_created";',
        'const userProps = { user_id: "synthetic-row-value", email: "user@example.test" };',
        "track(CREATED_EVENT, userProps);",
        'track({ event: "organization_role_changed", properties: { organization_id: "org-synthetic", role: "admin" } });',
        'track("event_with_comments" /* ignored ), { fake: true } */, { stable_property: true /* ignored, other_property: true */ });',
        'track(dynamicEvent, { should_not_be_indexed: "dynamic-value" });',
        'track({ event: runtimeEvent, properties: { should_not_be_indexed: "dynamic-object-value" } });',
        "function track(eventName: string, properties?: Record<string, unknown>) {}",
        "const client = { track(eventName: string) {} };",
        "const track = (eventName) => eventName;",
        '// track("commented_event", { ignored: true });',
        'const documentation = `track("string_event", { ignored: true })`;',
      ].join("\n"),
    );
    await writeFile(
      path.join(codeRoot, ".tmp", "scratch.ts"),
      'track("scratch_event", { scratch: true });',
    );
    await writeFile(
      path.join(codeRoot, ".yarn", "vendor.cjs"),
      'track("vendor_event", { vendor: true });',
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      codeRoots: [codeRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    const serialized = JSON.stringify(bundle);
    expect(sourceIndexBundleSchema.parse(bundle)).toEqual(bundle);
    const model = bundle.entries.find(
      (entry) => entry.metric === "model:orders",
    );
    const agentNativeUsers = bundle.entries.find(
      (entry) => entry.metric === "model:dim_agent_native_users",
    );
    const activeUsers = bundle.entries.find(
      (entry) => entry.metric === "model:active_users",
    );
    const event = bundle.entries.find(
      (entry) => entry.metric === "event:user_created",
    );
    const orgEvent = bundle.entries.find(
      (entry) => entry.metric === "event:organization_role_changed",
    );
    const commentedEvent = bundle.entries.find(
      (entry) => entry.metric === "event:event_with_comments",
    );

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-10-09T12:00:00.000Z",
      scanSummary: { unresolvedTrackingCallSites: 2 },
      sources: [
        {
          id: "dbt",
          contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        {
          id: "product-app",
          contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    });
    expect(model).toMatchObject({
      table: "orders",
      sourceKind: "dbt",
      semanticScope: "unknown",
      dependencies: "ref:stg_orders; source:app.organizations",
      joinPattern: "Unique grain: order_id, organization_id",
      sourcePath: "models/orders.sql",
    });
    expect(model?.definition).toContain("Order facts for product analysis.");
    expect(model?.definition).toContain(
      "order_id (STRING): Stable order identifier.",
    );
    expect(model?.columnsUsed).toBe("order_id, owner_email");
    expect(agentNativeUsers?.semanticScope).toBe("analytics_user");
    expect(activeUsers?.semanticScope).toBe("product_activity");
    expect(model?.knownGotchas).toContain("order_id: not_null");
    expect(model?.knownGotchas).toContain("order_id: unique");
    expect(event).toMatchObject({
      columnsUsed: "email, user_id",
      sourceKind: "code",
      semanticScope: "person",
      sourcePath: "src/track.ts",
    });
    expect(orgEvent).toMatchObject({
      columnsUsed: "organization_id, role",
      semanticScope: "organization",
    });
    expect(commentedEvent?.columnsUsed).toBe("stable_property");
    expect(
      bundle.entries.every((entry) =>
        /^[a-z0-9][a-z0-9_-]{0,119}$/.test(entry.id),
      ),
    ).toBe(true);
    expect(
      bundle.entries.some((entry) => entry.metric.includes("dynamic")),
    ).toBe(false);
    expect(
      bundle.entries.some((entry) => entry.metric.includes("commented")),
    ).toBe(false);
    expect(
      bundle.entries.some((entry) => entry.metric.includes("string_event")),
    ).toBe(false);
    expect(
      bundle.entries.some((entry) => /scratch|vendor/.test(entry.metric)),
    ).toBe(false);
    expect(serialized).not.toContain("do-not-export-row-value");
    expect(serialized).not.toContain("synthetic-row-value");
    expect(serialized).not.toContain("org-synthetic");
    expect(serialized).not.toContain("user@example.test");
    expect(serialized).not.toContain("dynamic-value");
    expect(serialized).not.toContain("dynamic-object-value");
    expect(serialized).not.toContain("commented_out_model");
    expect(serialized).not.toContain("private.comment");
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain(
      "fake-secret-that-must-not-be-read-or-hashed",
    );

    const unsafeBundle = structuredClone(bundle);
    unsafeBundle.entries[0]!.definition = "Owner email: person@example.test";
    expect(sourceIndexBundleSchema.safeParse(unsafeBundle).success).toBe(false);
    expect(
      sourceIndexBundleSchema.safeParse({
        ...bundle,
        generatedAt: "2026-10-09T12:00:00-07:00",
      }).success,
    ).toBe(false);

    const originalFingerprint = bundle.sources.find(
      (source) => source.id === "product-app",
    )?.contentFingerprint;
    await writeFile(
      path.join(codeRoot, ".env"),
      "SIGMA_CLIENT_SECRET=another-fake-secret-value",
    );
    const envChangedBundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      codeRoots: [codeRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    expect(
      envChangedBundle.sources.find((source) => source.id === "product-app")
        ?.contentFingerprint,
    ).toBe(originalFingerprint);
    await writeFile(
      path.join(codeRoot, "src", "track.ts"),
      `${await readFile(path.join(codeRoot, "src", "track.ts"), "utf8")}\n// synthetic working-tree change\n`,
    );
    const changedBundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      codeRoots: [codeRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    expect(
      changedBundle.sources.find((source) => source.id === "product-app")
        ?.contentFingerprint,
    ).not.toBe(originalFingerprint);
  });

  it("stamps a Git source revision and fingerprint without exporting source content", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "accounts.sql"),
      "SELECT account_id FROM source_accounts",
    );
    execFileSync("git", ["init", "-q"], { cwd: dbtRoot });
    execFileSync("git", ["config", "user.name", "Source Index Test"], {
      cwd: dbtRoot,
    });
    execFileSync("git", ["config", "user.email", "source-index@example.test"], {
      cwd: dbtRoot,
    });
    execFileSync("git", ["add", "models/accounts.sql"], { cwd: dbtRoot });
    execFileSync("git", ["commit", "-q", "-m", "Add synthetic model"], {
      cwd: dbtRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2024-02-03T04:05:06Z",
        GIT_COMMITTER_DATE: "2024-02-03T04:05:06Z",
      },
    });

    const revision = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: dbtRoot,
      encoding: "utf8",
    }).trim();
    const bundle = await compileSourceIndex({ dbtRoots: [dbtRoot] });
    const regenerated = await compileSourceIndex({ dbtRoots: [dbtRoot] });

    expect(bundle.generatedAt).toBe("2024-02-03T04:05:06.000Z");
    expect(regenerated).toEqual(bundle);
    expect(bundle.sources).toEqual([
      {
        id: "dbt",
        revision,
        contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    expect(JSON.stringify(bundle)).not.toContain("SELECT account_id");
    expect(
      sourceIndexBundleSchema.safeParse({
        ...bundle,
        sources: [{ id: "dbt" }],
      }).success,
    ).toBe(false);

    await writeFile(
      path.join(dbtRoot, "models", "accounts.sql"),
      "SELECT account_id FROM source_accounts\n-- synthetic working-tree edit",
    );
    const edited = await compileSourceIndex({ dbtRoots: [dbtRoot] });
    expect(edited.generatedAt).toBe(bundle.generatedAt);
    expect(edited.sources[0]?.revision).toBe(bundle.sources[0]?.revision);
    expect(edited.sources[0]?.contentFingerprint).not.toBe(
      bundle.sources[0]?.contentFingerprint,
    );
  });

  it("requires dbt commit metadata instead of using a wall-clock timestamp", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(path.join(dbtRoot, "models", "example.sql"), "SELECT 1");

    await expect(
      compileSourceIndex({ dbtRoots: [dbtRoot] }),
    ).rejects.toMatchObject({
      code: "dbt_commit_metadata_required",
    });
  });

  it("does not turn a malformed model name into a nested column model", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(
      path.join(dbtRoot, "models", "schema.yml"),
      [
        "version: 2",
        "models:",
        '  - name: "bad model name"',
        "    columns:",
        "      - name: id",
        "  - name: valid_model",
        "    columns:",
        "      - name: created_at",
      ].join("\n"),
    );

    const bundle = await compileSourceIndex({
      dbtRoots: [dbtRoot],
      generatedAt: "2026-10-09T12:00:00.000Z",
    });
    expect(bundle.entries.map((entry) => entry.table)).toEqual(["valid_model"]);
  });

  it("atomically replaces the output file and reports explicit source errors", async () => {
    const root = await temporaryDirectory();
    const dbtRoot = path.join(root, "dbt");
    const out = path.join(root, ".tmp", "source-index.json");
    await mkdir(path.join(dbtRoot, "models"), { recursive: true });
    await writeFile(path.join(dbtRoot, "models", "example.sql"), "SELECT 1");
    execFileSync("git", ["init", "-q"], { cwd: dbtRoot });
    execFileSync("git", ["config", "user.name", "Source Index Test"], {
      cwd: dbtRoot,
    });
    execFileSync("git", ["config", "user.email", "source-index@example.test"], {
      cwd: dbtRoot,
    });
    execFileSync("git", ["add", "models/example.sql"], { cwd: dbtRoot });
    execFileSync("git", ["commit", "-q", "-m", "Add synthetic model"], {
      cwd: dbtRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2024-02-03T04:05:06Z",
        GIT_COMMITTER_DATE: "2024-02-03T04:05:06Z",
      },
    });

    const first = await writeSourceIndex({ dbtRoots: [dbtRoot], out });
    const written = JSON.parse(await readFile(out, "utf8"));
    expect(written.schemaVersion).toBe(1);
    const second = await writeSourceIndex({ dbtRoots: [dbtRoot], out });
    expect(second.generatedAt).toBeDefined();
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual(second);
    expect(second.sources[0]?.contentFingerprint).toBe(
      first.sources[0]?.contentFingerprint,
    );
    await expect(
      compileSourceIndex({ dbtRoots: [path.join(root, "missing")] }),
    ).rejects.toMatchObject({
      code: "root_unreadable",
    });
  });
});
