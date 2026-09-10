import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mirrorProductionDatabaseVariables,
  parseNetlifyDatabaseVariables,
  previewDatabaseVariables,
} from "./sync-netlify-preview-database.ts";

describe("previewDatabaseVariables", () => {
  it("derives the direct URL and preserves an existing app-scoped key", () => {
    assert.deepEqual(
      previewDatabaseVariables({
        databaseUrl:
          "postgresql://user:password@ep-example-pooler.us-east-1.neon.tech/app?sslmode=require",
        existingKeys: ["PLAN_DATABASE_URL", "OTHER"],
        sourceTemplate: "plan",
      }),
      [
        {
          key: "DATABASE_URL",
          value:
            "postgresql://user:password@ep-example-pooler.us-east-1.neon.tech/app?sslmode=require",
        },
        {
          key: "DATABASE_URL_UNPOOLED",
          value:
            "postgresql://user:password@ep-example.us-east-1.neon.tech/app?sslmode=require",
        },
        {
          key: "NETLIFY_DATABASE_URL",
          value:
            "postgresql://user:password@ep-example-pooler.us-east-1.neon.tech/app?sslmode=require",
        },
        {
          key: "NETLIFY_DATABASE_URL_UNPOOLED",
          value:
            "postgresql://user:password@ep-example.us-east-1.neon.tech/app?sslmode=require",
        },
        {
          key: "PLAN_DATABASE_URL",
          value:
            "postgresql://user:password@ep-example-pooler.us-east-1.neon.tech/app?sslmode=require",
        },
      ],
    );
  });

  it("rejects non-PostgreSQL sources", () => {
    assert.throws(
      () =>
        previewDatabaseVariables({
          databaseUrl: "pglite:./data/pglite",
          sourceTemplate: "assets",
        }),
      /Preview database URL must be a PostgreSQL URL/,
    );
  });
});

describe("parseNetlifyDatabaseVariables", () => {
  it("reads metadata without depending on secret values", () => {
    assert.deepEqual(
      parseNetlifyDatabaseVariables([
        {
          key: "DATABASE_URL",
          is_secret: true,
          values: [
            { context: "production", id: "production-id", value: "masked" },
            { context: "deploy-preview", id: "preview-id", value: "masked" },
          ],
        },
        { key: "BETTER_AUTH_SECRET", values: [] },
      ]),
      [
        {
          key: "DATABASE_URL",
          values: [
            { context: "production", id: "production-id" },
            { context: "deploy-preview", id: "preview-id" },
          ],
        },
      ],
    );
  });
});

describe("mirrorProductionDatabaseVariables", () => {
  it("updates the preview context and removes stale database overrides", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    const keys = await mirrorProductionDatabaseVariables({
      accountId: "builder-io",
      databaseUrl: "postgresql://preview.example/db",
      siteId: "site",
      sourceTemplate: "plan",
      token: "test-token",
      request: async (url, options) => {
        requests.push({ url, options });
        if (options?.method === "DELETE")
          return new Response(null, { status: 204 });
        if (options?.method === "POST")
          return new Response(null, { status: 201 });
        if (options?.method === "PATCH")
          return new Response(null, { status: 200 });
        return Response.json([
          {
            key: "DATABASE_URL",
            values: [
              {
                context: "production",
                id: "database-production",
                value: "masked",
              },
              {
                context: "deploy-preview",
                id: "database-preview",
                value: "masked",
              },
            ],
          },
          {
            key: "NETLIFY_DATABASE_URL",
            values: [
              {
                context: "deploy-preview",
                id: "netlify-preview",
                value: "masked",
              },
            ],
          },
          {
            key: "PLAN_DATABASE_URL",
            values: [
              { context: "production", id: "plan-production", value: "masked" },
            ],
          },
          {
            key: "OLD_DATABASE_URL",
            values: [
              {
                context: "deploy-preview",
                id: "stale-preview",
                value: "masked",
              },
            ],
          },
        ]);
      },
    });

    assert.deepEqual(keys, {
      mirroredKeys: [
        "DATABASE_URL",
        "DATABASE_URL_UNPOOLED",
        "NETLIFY_DATABASE_URL",
        "NETLIFY_DATABASE_URL_UNPOOLED",
        "PLAN_DATABASE_URL",
      ],
      removedKeys: ["OLD_DATABASE_URL"],
    });
    assert.equal(requests.length, 7);
    assert.equal(requests[1].options?.method, "DELETE");
    assert.match(
      requests[1].url,
      /\/env\/OLD_DATABASE_URL\/value\/stale-preview/,
    );

    const createKeys = requests
      .filter(({ options }) => options?.method === "POST")
      .map(({ options }) => JSON.parse(String(options?.body))[0].key)
      .sort();
    assert.deepEqual(createKeys, [
      "DATABASE_URL_UNPOOLED",
      "NETLIFY_DATABASE_URL_UNPOOLED",
    ]);

    const databaseUpdate = requests.find(
      ({ url, options }) =>
        url.endsWith("/env/DATABASE_URL?site_id=site") &&
        options?.method === "PATCH",
    );
    assert(databaseUpdate);
    assert.deepEqual(JSON.parse(String(databaseUpdate.options?.body)), {
      context: "deploy-preview",
      value: "postgresql://preview.example/db",
    });
  });
});
