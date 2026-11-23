import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanupLocalStagedDataset } from "./cleanup-staged.js";

const loopback = "127.0.0.1";

await test("staged cleanup refuses every database or account outside the isolated QA fixture", async () => {
  const fixture = {
    datasetId: "qa-owned-dataset",
    databaseUrl: `postgresql://qa_analytics2@${loopback}:1/qa_analytics2`,
    email: "qa-fleet@builder.io",
    workspaceId: "qa-owned-workspace",
  };
  const passwordDatabase = new URL(fixture.databaseUrl);
  passwordDatabase.password = "fixture";
  for (const databaseUrl of [
    undefined,
    "postgresql://qa_analytics2@warehouse.example.invalid:1/qa_analytics2",
    `postgresql://other@${loopback}:1/qa_analytics2`,
    passwordDatabase.href,
    `postgresql://qa_analytics2@${loopback}:1/other`,
    `${fixture.databaseUrl}?sslmode=require`,
    `${fixture.databaseUrl}#other`,
  ])
    await assert.rejects(
      cleanupLocalStagedDataset({ ...fixture, databaseUrl }),
      /requires the isolated QA database and account/,
    );
  await assert.rejects(
    cleanupLocalStagedDataset({ ...fixture, email: "other@example.test" }),
    /requires the isolated QA database and account/,
  );
  await assert.rejects(
    cleanupLocalStagedDataset({ ...fixture, workspaceId: "" }),
    /requires the isolated QA database and account/,
  );
  for (const datasetId of ["", "--approved", "qa dataset", "qa;dataset"])
    await assert.rejects(
      cleanupLocalStagedDataset({ ...fixture, datasetId }),
      /requires the isolated QA database and account/,
    );
});
