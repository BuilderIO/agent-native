import { defineAction } from "@agent-native/core";
import fs from "fs";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

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
    const db = getDb();
    const form = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, formId))
      .get();
    if (!form) {
      throw new Error(`Form ${formId} not found`);
    }

    const responses = await db
      .select()
      .from(schema.responses)
      .where(eq(schema.responses.formId, formId))
      .orderBy(desc(schema.responses.submittedAt))
      .all();

    const fields = JSON.parse(form.fields);
    const fmt =
      args.format || (args.output?.endsWith(".json") ? "json" : "csv");
    const outputPath =
      args.output || `data/export-${formId}.${fmt === "json" ? "json" : "csv"}`;

    if (fmt === "json") {
      const data = responses.map((r) => ({
        id: r.id,
        submittedAt: r.submittedAt,
        ...JSON.parse(r.data),
      }));
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    } else {
      const headers = [
        "ID",
        "Submitted At",
        ...fields.map((f: any) => f.label),
      ];
      const rows = responses.map((r) => {
        const data = JSON.parse(r.data);
        return [
          r.id,
          r.submittedAt,
          ...fields.map((f: any) => {
            const val = data[f.id];
            if (Array.isArray(val)) return val.join("; ");
            return String(val ?? "");
          }),
        ];
      });

      const csv = [headers, ...rows]
        .map((row) =>
          row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");

      fs.writeFileSync(outputPath, csv);
    }

    return `Exported ${responses.length} responses to ${outputPath}`;
  },
});
