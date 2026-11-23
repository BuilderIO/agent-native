import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { startFakeProviders } from "./fake-providers";

const jobSchema = z.object({
  projectId: z.string().min(1),
  jobId: z.string().min(1),
  location: z.string().min(1),
});
const querySchema = z.object({
  jobReference: jobSchema,
  totalRows: z.string(),
});
if (process.argv[2] === "child") {
  const { createWarehouseStorageClient, readStoragePage } =
    await import("../../server/model/data-storage");
  const [job, orders] = z
    .tuple([jobSchema, jobSchema])
    .parse(JSON.parse(process.argv[3] ?? ""));
  const reader = await createWarehouseStorageClient(
    {
      client_email: "local@example.invalid",
      private_key: "unused",
      project_id: job.projectId,
    },
    ["https://www.googleapis.com/auth/bigquery"],
  );
  try {
    const columns = [{ name: "id", type: "INTEGER" }];
    const first = await readStoragePage(reader, {
      ...job,
      offset: 0n,
      first: 1,
      totalRows: 1n,
      columns,
    });
    assert.deepEqual(first.rows, [["1"]]);
    await assert.rejects(
      readStoragePage(reader, {
        ...job,
        offset: 0n,
        first: 2,
        totalRows: 2n,
        columns,
      }),
      /result|stream|row/i,
    );
    const orderColumns = [
      { name: "order_id", type: "INTEGER" },
      { name: "region", type: "STRING" },
      { name: "amount", type: "FLOAT" },
      { name: "status", type: "STRING" },
      { name: "ordered_at", type: "DATE" },
    ];
    const next = await readStoragePage(reader, {
      ...orders,
      offset: 2n,
      first: 2,
      totalRows: 24n,
      columns: orderColumns,
    });
    assert.deepEqual(next.rows, [
      ["1003", "East", 174, "pending", "2026-03-12"],
      ["1004", "West", 211, "paid", "2026-04-13"],
    ]);
    console.log(
      "PASS A2-LOCAL-BQ-STORAGE-FIXTURE: nonempty Arrow pages, offset and mismatched count",
    );
  } finally {
    await reader.close();
  }
} else {
  const fake = await startFakeProviders();
  await mkdir(resolve(".tmp"), { recursive: true });
  const dir = await mkdtemp(resolve(".tmp/analytics-storage-check-"));
  try {
    const query = async (sql: string) => {
      const response = await fetch(
        `${fake.url}projects/local-fake-project/queries`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fake-host": "bigquery.googleapis.com",
          },
          body: JSON.stringify({ query: sql }),
        },
      );
      assert.equal(response.status, 200);
      return querySchema.parse(await response.json());
    };
    const first = await query("SELECT * FROM single_table.only_table");
    const orders = await query("SELECT * FROM daily_sales.orders");
    assert.equal(first.totalRows, "1");
    assert.equal(orders.totalRows, "24");
    const metadata = await fetch(
      `${fake.url}projects/local-fake-project/queries/${orders.jobReference.jobId}`,
      { headers: { "x-fake-host": "bigquery.googleapis.com" } },
    );
    assert.equal(metadata.status, 200);
    const readback = querySchema.parse(await metadata.json());
    assert.equal(readback.totalRows, "24");
    assert.equal(readback.jobReference.jobId, orders.jobReference.jobId);
    const pidFile = resolve(dir, "pids");
    await writeFile(pidFile, "");
    const preload = new URL("./preload.ts", import.meta.url);
    preload.searchParams.set("fakeUrl", fake.url);
    preload.searchParams.set("pidFile", pidFile);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        preload.href,
        import.meta.filename,
        "child",
        JSON.stringify([first.jobReference, orders.jobReference]),
      ],
      { stdio: "inherit" },
    );
    const status = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => done(code ?? 1));
    });
    assert.equal(status, 0, "Storage fixture child failed");
  } finally {
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  }
}
