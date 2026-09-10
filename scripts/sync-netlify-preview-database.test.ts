import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mirrorProductionDatabaseVariables,
  productionDatabaseVariables,
} from "./sync-netlify-preview-database.ts";

describe("productionDatabaseVariables", () => {
  it("selects production values and ignores non-database variables", () => {
    assert.deepEqual(
      productionDatabaseVariables([
        {
          key: "DATABASE_URL",
          values: [
            { context: "all", value: "postgresql://all.example/db" },
            { context: "production", value: "postgresql://prod.example/db" },
          ],
        },
        {
          key: "DESIGN_DATABASE_URL_UNPOOLED",
          values: [{ context: "all", value: "postgres://design.example/db" }],
        },
        {
          key: "BETTER_AUTH_SECRET",
          values: [{ context: "production", value: "not-a-database" }],
        },
      ]),
      [
        { key: "DATABASE_URL", value: "postgresql://prod.example/db" },
        {
          key: "DESIGN_DATABASE_URL_UNPOOLED",
          value: "postgres://design.example/db",
        },
      ],
    );
  });

  it("rejects a malformed production database value", () => {
    assert.throws(
      () =>
        productionDatabaseVariables([
          {
            key: "DATABASE_URL",
            values: [{ context: "production", value: "not-a-database" }],
          },
        ]),
      /DATABASE_URL: production Netlify database value is missing or not PostgreSQL/,
    );
  });
});

describe("mirrorProductionDatabaseVariables", () => {
  it("copies selected production values to deploy-preview", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    const keys = await mirrorProductionDatabaseVariables({
      accountId: "builder-io",
      siteId: "site",
      token: "test-token",
      request: async (url, options) => {
        requests.push({ url, options });
        if (options?.method === "PATCH")
          return new Response(null, { status: 200 });
        return Response.json([
          {
            key: "DATABASE_URL",
            values: [
              { context: "production", value: "postgresql://prod.example/db" },
            ],
          },
          {
            key: "PLAN_DATABASE_URL_UNPOOLED",
            values: [{ context: "all", value: "postgres://plan.example/db" }],
          },
        ]);
      },
    });

    assert.deepEqual(keys, ["DATABASE_URL", "PLAN_DATABASE_URL_UNPOOLED"]);
    assert.equal(requests.length, 3);
    assert.match(requests[1].url, /\/env\/DATABASE_URL\?site_id=site$/);
    assert.equal(requests[1].options?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requests[1].options?.body)), {
      context: "deploy-preview",
      value: "postgresql://prod.example/db",
    });
    assert.equal(requests[2].options?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requests[2].options?.body)), {
      context: "deploy-preview",
      value: "postgres://plan.example/db",
    });
  });
});
