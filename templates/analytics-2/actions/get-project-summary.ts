import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { requireReadableProject } from "../server/lib/project-action-access.js";
import { readAccessibleProjectOutputs } from "../server/model/project-output-access.js";
import { getReadableProjectDocument } from "../server/model/projects-store.js";
import { readSeededSampleCell } from "../server/model/seed.js";

const MAX_ROWS = 6;
const MAX_COLUMNS = 12;
const MAX_CELLS = 40;
const MAX_BYTES = 24_000;
const BATCH_SIZE = 10;
const SUMMARY_DEADLINE_MS = 8_000;

const summaryCellSchema = z.object({
  cellId: z.string(),
  kind: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  ranAt: z.string().nullable(),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.unknown())).optional(),
  totalRows: z.string().nullable().optional(),
  value: z.unknown().optional(),
  text: z.string().optional(),
  error: z.string().optional(),
});

export default defineAction({
  description:
    "Read a bounded summary of a project's saved results in one call: per cell its kind, title, status, when it last ran and a few saved rows or the headline value. It never runs a query, so it answers a question about an existing dashboard quickly. Prefer it over get-project when you only need the numbers.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: z.object({
    projectId: z.string(),
    title: z.string().nullable(),
    cells: z.array(summaryCellSchema),
    omittedCells: z.number().int().nonnegative(),
    partial: z.boolean(),
    note: z.string(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ projectId }, context) => {
    const { scope, project } = await requireReadableProject(projectId);
    const document = await getReadableProjectDocument(
      scope,
      project.id,
      undefined,
    );
    if (document === null) {
      fail("That project is not available.", {
        statusCode: 404,
        errorCode: "project_not_found",
      });
    }
    const deadline = Date.now() + SUMMARY_DEADLINE_MS;
    const seedScope = { ...scope, ownerEmail: document.ownerEmail };
    const cells: z.infer<typeof summaryCellSchema>[] = [];
    let bytes = 0;
    let omitted = 0;
    let partial = false;
    const allCells = document.cells;
    for (let i = 0; i < allCells.length; i += BATCH_SIZE) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        omitted += allCells.length - i;
        partial = true;
        break;
      }
      const batch = allCells.slice(i, i + BATCH_SIZE);
      const batchIds = new Set(batch.map((c) => c.id));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outputs = await Promise.race([
        readAccessibleProjectOutputs(
          scope,
          project.id,
          undefined,
          batchIds,
          context?.caller ?? "unknown",
        ),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remainingMs);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      if (outputs === null) {
        omitted += allCells.length - i;
        partial = true;
        break;
      }
      for (const cell of batch) {
        const seeded = readSeededSampleCell(seedScope, cell, outputs[cell.id]);
        const record = seeded.output ?? outputs[cell.id];
        const output = record?.output ?? null;
        if (!output && !record) continue;
        const contents = cell.contents as unknown as {
          kind: string;
          title?: string | null;
        };
        const entry: z.infer<typeof summaryCellSchema> = {
          cellId: cell.id,
          kind: contents.kind,
          title: contents.title ?? null,
          status: record?.status ?? "not_run",
          ranAt: record?.ranAt ?? null,
        };
        if (output?.type === "table") {
          entry.columns = output.columns
            .slice(0, MAX_COLUMNS)
            .map((c) => c.name);
          entry.rows = output.rows
            .slice(0, MAX_ROWS)
            .map((row) => row.slice(0, MAX_COLUMNS));
          entry.totalRows =
            output.totalRows ??
            (output.truncated ? null : String(output.rowCount));
          if (output.rows.length > MAX_ROWS || output.truncated) partial = true;
        } else if (output?.type === "metric") {
          entry.value = output.formatted || output.value;
        } else if (output?.type === "text") {
          entry.text = output.text.slice(0, 400);
        } else if (output?.type === "error") {
          entry.error = output.message.slice(0, 200);
        }
        const size = JSON.stringify(entry).length;
        if (cells.length >= MAX_CELLS || bytes + size > MAX_BYTES) {
          omitted += 1;
          partial = true;
          continue;
        }
        bytes += size;
        cells.push(entry);
      }
    }
    return {
      projectId,
      title: (document as unknown as { title?: string | null }).title ?? null,
      cells,
      omittedCells: omitted,
      partial,
      note: "Saved results only; no query was run. Say plainly if cells are errored, not run or partial, and report the figures that are present.",
    };
  },
});
