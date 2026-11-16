import { z } from "zod";

export const exportWarningSchema = z.object({
  code: z.literal("images-dropped"),
  count: z.number().int().positive(),
  slides: z.array(z.number().int().positive()),
});

export type ExportWarning = z.infer<typeof exportWarningSchema>;

export const EXPORT_WARNINGS_HEADER = "x-slides-export-warnings";

export function readExportWarningsHeader(res: Response): ExportWarning[] {
  const encoded = res.headers.get(EXPORT_WARNINGS_HEADER);
  if (!encoded) return [];
  return z
    .array(exportWarningSchema)
    .parse(JSON.parse(decodeURIComponent(encoded)));
}
