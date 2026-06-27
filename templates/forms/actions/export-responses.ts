import fs from "fs";

import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { publicSubmitterEmail } from "../shared/submitter-email.js";

export default defineAction({
  description: "Export form responses to CSV or JSON file.",
  schema: z.object({
    form: z.string().describe("Form ID (required)"),
    output: z.string().optional().describe("Output file path"),
    format: z.enum(["csv", "json"]).optional().describe("Export format"),
  }),
  http: false,
  run: async (args) => {
    const formId = args.form;
    const { resource: form } = await assertAccess("form", formId, "editor");
    const db = getDb();

    const responses = await db
      .select()
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId))
      .orderBy(desc(schema.responses.submittedAt));

    const fields = JSON.parse(form.fields);
    const fmt =
      args.format || (args.output?.endsWith(".json") ? "json" : "csv");
    const outputPath =
      args.output || `data/export-${formId}.${fmt === "json" ? "json" : "csv"}`;

    if (fmt === "json") {
      const data = responses.map((r) => ({
        id: r.id,
        submittedAt: r.submittedAt,
        submitterEmail: publicSubmitterEmail(r.submitterEmail),
        pageUrl: r.pageUrl ?? null,
        clientSurface: r.clientSurface ?? null,
        ...JSON.parse(r.data),
      }));
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    } else {
      const headers = [
        "ID",
        "Submitted At",
        "Submitter Email",
        "Page URL",
        "Source",
        ...fields.map((f: any) => f.label),
      ];
      const rows = responses.map((r) => {
        const data = JSON.parse(r.data);
        return [
          r.id,
          r.submittedAt,
          publicSubmitterEmail(r.submitterEmail) ?? "",
          r.pageUrl ?? "",
          r.clientSurface ?? "",
          ...fields.map((f: any) => {
            const val = data[f.id];
            if (Array.isArray(val)) return val.join("; ");
            return String(val ?? "");
          }),
        ];
      });

      // Neutralize CSV/formula injection: a cell that begins with =,+,-,@,tab,
      // or CR is interpreted as a formula by Excel/LibreOffice/Sheets. Response
      // values come from anonymous public submitters, so prefix any such cell
      // with a single quote so spreadsheets treat it as literal text.
      const neutralize = (cell: string) =>
        /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
      const csv = [headers, ...rows]
        .map((row) =>
          row
            .map((cell: string) => `"${neutralize(cell).replace(/"/g, '""')}"`)
            .join(","),
        )
        .join("\n");

      fs.writeFileSync(outputPath, csv);
    }

    return `Exported ${responses.length} responses to ${outputPath}`;
  },
});
