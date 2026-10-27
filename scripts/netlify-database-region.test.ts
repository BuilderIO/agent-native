import assert from "node:assert/strict";
import test from "node:test";

import { parseNeonDatabaseRegion } from "./netlify-database-region.ts";

test("reads the region from a pooler endpoint host", () => {
  assert.equal(
    parseNeonDatabaseRegion(
      "postgresql://neondb_owner:pw@ep-cool-shape-a1b2c3d4-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ),
    "us-east-1",
  );
});

test("reads the region from a direct endpoint host with a compute id segment", () => {
  assert.equal(
    parseNeonDatabaseRegion(
      "postgresql://neondb_owner:pw@ep-cool-shape-a1b2c3d4.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ),
    "us-east-1",
  );
});

test("accepts every documented Netlify Functions region", () => {
  const regions = [
    "us-east-1",
    "us-east-2",
    "us-west-2",
    "eu-central-1",
    "eu-west-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
    "sa-east-1",
    "ca-central-1",
    "ap-south-1",
  ];
  for (const region of regions) {
    assert.equal(
      parseNeonDatabaseRegion(
        `postgresql://u:p@ep-x-pooler.${region}.aws.neon.tech/db`,
      ),
      region,
    );
  }
});

test("returns null for a Neon region Netlify Functions does not run in", () => {
  assert.equal(
    parseNeonDatabaseRegion(
      "postgresql://u:p@ep-x-pooler.eu-west-1.aws.neon.tech/db",
    ),
    null,
  );
});

test("returns null for a non-Neon Postgres host", () => {
  assert.equal(
    parseNeonDatabaseRegion(
      "postgresql://u:p@db-pooler.example.supabase.co:5432/postgres",
    ),
    null,
  );
});

test("returns null for PGlite and other non-URL protocol values", () => {
  assert.equal(parseNeonDatabaseRegion("pglite:memory"), null);
  assert.equal(parseNeonDatabaseRegion("pglite://./data"), null);
});

test("returns null for garbage and empty input", () => {
  assert.equal(parseNeonDatabaseRegion("not a url"), null);
  assert.equal(parseNeonDatabaseRegion(""), null);
});

test("returns null for a bare Neon suffix host with no region segment", () => {
  assert.equal(
    parseNeonDatabaseRegion("postgresql://u:p@aws.neon.tech/db"),
    null,
  );
});
