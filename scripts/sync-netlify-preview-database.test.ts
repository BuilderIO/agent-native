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
            {
              context: "branch-deploy",
              context_parameter: "named-branch",
              id: "named-branch-id",
              value: "masked",
            },
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
            {
              context: "branch-deploy",
              context_parameter: "named-branch",
              id: "named-branch-id",
            },
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
        if (options?.method === "DELETE") {
          const deleteCount = requests.filter(
            ({ options: requestOptions }) =>
              requestOptions?.method === "DELETE",
          ).length;
          return new Response(null, { status: deleteCount === 1 ? 404 : 204 });
        }
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
              {
                context: "branch-deploy",
                context_parameter: "named-branch",
                id: "database-named-branch",
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
    assert.equal(requests.length, 9);
    const deleteUrls = requests
      .filter(({ options }) => options?.method === "DELETE")
      .map(({ url }) => url)
      .sort();
    assert.deepEqual(deleteUrls, [
      "https://api.netlify.com/api/v1/accounts/builder-io/env/DATABASE_URL/value/database-preview?site_id=site",
      "https://api.netlify.com/api/v1/accounts/builder-io/env/NETLIFY_DATABASE_URL/value/netlify-preview?site_id=site",
      "https://api.netlify.com/api/v1/accounts/builder-io/env/OLD_DATABASE_URL/value/stale-preview?site_id=site",
    ]);

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
      context: "branch-deploy",
      value: "postgresql://preview.example/db",
    });
  });

  it("converges when another preview creates a missing key first", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    let firstCreate = true;
    await mirrorProductionDatabaseVariables({
      accountId: "builder-io",
      databaseUrl: "postgresql://preview.example/db",
      siteId: "site",
      sourceTemplate: "assets",
      token: "test-token",
      request: async (url, options) => {
        requests.push({ url, options });
        if (options?.method === "POST" && firstCreate) {
          firstCreate = false;
          return new Response(null, { status: 409 });
        }
        if (options?.method === "POST")
          return new Response(null, { status: 201 });
        if (options?.method === "PATCH")
          return new Response(null, { status: 200 });
        if (requests.length === 1) return Response.json([]);
        return Response.json([
          {
            key: "DATABASE_URL",
            values: [{ context: "production", id: "database-production" }],
          },
        ]);
      },
    });

    assert.equal(
      requests.filter(({ options }) => options?.method === "POST").length,
      4,
    );
    assert.equal(
      requests.filter(({ options }) => options?.method === "PATCH").length,
      1,
    );
    assert.equal(requests.filter(({ options }) => !options?.method).length, 2);
  });
});
