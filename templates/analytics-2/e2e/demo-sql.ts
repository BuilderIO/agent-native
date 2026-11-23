import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { projectDocumentSchema } from "../app/lib/model/contracts.js";

export async function checkDemoMonthlySql(page: Page, base: string) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const post = async (name: string, data: unknown) => {
    const response = await page.request.post(
      `${base}/_agent-native/actions/${name}`,
      { headers, data },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const created = z.object({ id: z.string().min(1) }).parse(
    await post("create-project", {
      title: `QA demo monthly ${randomUUID()}`,
      sampleDataset: "orders",
    }),
  );
  const read = async () => {
    const response = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: created.id })}`,
      { headers },
    );
    expect(response.ok()).toBe(true);
    return z
      .object({
        project: projectDocumentSchema,
        outputs: z.record(
          z.string(),
          z.object({ status: z.string(), output: z.unknown() }),
        ),
      })
      .parse(await response.json());
  };
  let primary: unknown;
  try {
    const project = await read();
    const cell = project.project.cells.at(0);
    if (!cell || cell.contents.kind !== "sql")
      throw new Error("Sample SQL cell missing");
    await post("save-project-cell", {
      projectId: created.id,
      cellId: cell.id,
      contents: {
        ...cell.contents,
        source: `select date_trunc('month', order_date) as month, sum(order_total) as revenue from "PUBLIC"."orders" group by 1 order by 1`,
      },
    });
    const run = z
      .object({
        status: z.literal("complete"),
        output: z.object({
          type: z.literal("table"),
          columns: z.array(z.object({ name: z.string(), type: z.string() })),
          rows: z.array(z.array(z.unknown())),
        }),
      })
      .parse(
        await post("run-project-cell", {
          projectId: created.id,
          cellId: cell.id,
        }),
      );
    expect(run.output.columns).toEqual([
      { name: "month", type: "datetime" }, // oracle-change: date_trunc now reports datetime in the current sample model
      { name: "revenue", type: "number" },
    ]);
    expect(run.output.rows.length).toBeGreaterThan(1);
    expect(run.output.rows.every((row) => typeof row[1] === "number")).toBe(
      true,
    );
    await page.goto(
      `${base}/project/${encodeURIComponent(created.id)}/latest`,
      { waitUntil: "domcontentloaded" },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const saved = await read();
    expect(saved.outputs[cell.id]).toMatchObject({
      status: "complete",
      output: run.output,
    });
    const savedCell = saved.project.cells.find((item) => item.id === cell.id);
    if (!savedCell || savedCell.contents.kind !== "sql")
      throw new Error("Saved sample SQL cell missing");
    await post("save-project-cell", {
      projectId: created.id,
      cellId: cell.id,
      contents: {
        ...savedCell.contents,
        source:
          "SELECT 'Infinity'::float8 AS positive, '-Infinity'::float8 AS negative, 'NaN'::float8 AS not_a_number FROM orders LIMIT 1",
      },
    });
    const nonfinite = z
      .object({
        status: z.literal("complete"),
        output: z
          .object({
            type: z.literal("table"),
            rows: z.array(z.array(z.unknown())),
          })
          .passthrough(),
      })
      .parse(
        await post("run-project-cell", {
          projectId: created.id,
          cellId: cell.id,
        }),
      );
    expect(nonfinite.output.rows).toEqual([["Infinity", "-Infinity", "NaN"]]);
    const nonfiniteSaved = await read();
    expect(nonfiniteSaved.outputs[cell.id]).toMatchObject({
      status: "complete",
      output: nonfinite.output,
    });
  } catch (error) {
    primary = error;
  }
  const cleanupErrors: unknown[] = [];
  try {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  } catch (error) {
    cleanupErrors.push(error);
  }
  for (const action of ["trash-project", "delete-project"]) {
    try {
      await post(action, { projectId: created.id });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    const deleted = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: created.id })}`,
      { headers },
    );
    expect(deleted.status()).toBe(404);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (primary !== undefined || cleanupErrors.length) {
    throw new AggregateError(
      [...(primary === undefined ? [] : [primary]), ...cleanupErrors],
      "Demo monthly SQL regression or cleanup failed",
    );
  }
}
