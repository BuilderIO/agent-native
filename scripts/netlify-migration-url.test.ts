import assert from "node:assert/strict";
import test from "node:test";

import { resolveNetlifyMigrationUrl } from "./netlify-migration-url.ts";

const POOLED =
  "postgresql://neondb_owner:pw@ep-round-heart-ap9wji9h-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
  "postgresql://neondb_owner:pw@ep-round-heart-ap9wji9h.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";

const envVar = (key: string, context: string, value: string) => [
  { key, values: [{ context, value }] },
];

test("returns the direct endpoint when Netlify only exposes a pooled URL", () => {
  assert.equal(
    resolveNetlifyMigrationUrl(
      envVar("NETLIFY_DATABASE_URL", "production", POOLED),
      "production",
    ),
    DIRECT,
  );
});

test("strips the pooler suffix from a site database connection string", () => {
  assert.equal(
    resolveNetlifyMigrationUrl({ connection_string: POOLED }, "production"),
    DIRECT,
  );
  assert.equal(
    resolveNetlifyMigrationUrl(
      { connection_strings: { owner: POOLED } },
      "production",
    ),
    DIRECT,
  );
});

test("leaves an already-direct Neon URL and non-Neon hosts unchanged", () => {
  assert.equal(
    resolveNetlifyMigrationUrl(
      envVar("NETLIFY_DATABASE_URL_UNPOOLED", "production", DIRECT),
      "production",
    ),
    DIRECT,
  );
  const supabase =
    "postgresql://u:p@db-pooler.example.supabase.co:5432/postgres";
  assert.equal(
    resolveNetlifyMigrationUrl(
      envVar("DATABASE_URL", "production", supabase),
      "production",
    ),
    supabase,
  );
});

test("still prefers the unpooled key and the requested context", () => {
  const variables = [
    {
      key: "NETLIFY_DATABASE_URL",
      values: [{ context: "production", value: POOLED }],
    },
    {
      key: "NETLIFY_DATABASE_URL_UNPOOLED",
      values: [{ context: "production", value: DIRECT }],
    },
  ];
  assert.equal(resolveNetlifyMigrationUrl(variables, "production"), DIRECT);
  assert.equal(
    resolveNetlifyMigrationUrl(
      envVar("NETLIFY_DATABASE_URL", "branch-deploy", POOLED),
      "production",
    ),
    undefined,
  );
});
