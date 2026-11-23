import { defineAction, fail } from "@agent-native/core/action";
import {
  stagedDatasetId,
  upsertStagedDataset,
} from "@agent-native/core/provider-api/staged-datasets-store";
import { z } from "zod";

import { requireOwnedProject } from "../server/lib/project-action-access.js";
import { readProjectFile } from "../server/model/project-files.js";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 200_000;
const MAX_COLUMNS = 256;

function decodeCsvText(data: Buffer) {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: false })
      .decode(data.subarray(2))
      .replace(/^\uFEFF/, "");
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder("utf-16be", { fatal: false })
      .decode(data.subarray(2))
      .replace(/^\uFEFF/, "");
  }
  if (
    data.length >= 3 &&
    data[0] === 0xef &&
    data[1] === 0xbb &&
    data[2] === 0xbf
  ) {
    return new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("windows-1252").decode(data);
  }
}

function detectCsvDelimiter(text: string): string {
  let inQuotes = false;
  let commas = 0;
  let tabs = 0;
  let semicolons = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      commas += 1;
    } else if (ch === "\t") {
      tabs += 1;
    } else if (ch === ";") {
      semicolons += 1;
    } else if (ch === "\n" || ch === "\r") {
      break;
    }
  }
  if (commas > 0) return ",";
  if (tabs > 0) return "\t";
  if (semicolons > 0) return ";";
  return ",";
}

function parseDelimitedMatrix(
  text: string,
  delimiter: string,
): Array<Array<string | null>> {
  const rows: Array<Array<string | null>> = [];
  let row: Array<string | null> = [];
  let field = "";
  let inQuotes = false;
  let wasQuoted = false;
  let fieldStart = true;

  const pushField = () => {
    row.push(wasQuoted || field.length > 0 ? field : null);
    field = "";
    wasQuoted = false;
    fieldStart = true;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (fieldStart && ch === '"') {
      inQuotes = true;
      wasQuoted = true;
      fieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushField();
      rows.push(row);
      row = [];
      continue;
    }
    field += ch;
    fieldStart = false;
  }

  if (inQuotes) {
    throw new Error("Unclosed quote in CSV");
  }
  if (row.length > 0 || wasQuoted || field.length > 0) {
    pushField();
    rows.push(row);
  }
  return rows;
}

export function parseProjectCsv(data: Buffer) {
  const text = decodeCsvText(data);
  let matrix: Array<Array<string | null>>;
  try {
    matrix = parseDelimitedMatrix(text, detectCsvDelimiter(text));
  } catch {
    return fail("Choose a valid CSV file.", {
      statusCode: 400,
      errorCode: "invalid_csv",
    });
  }
  if (!matrix.some((values) => values.some((value) => value !== null)))
    return fail("The CSV file has no header row.", {
      statusCode: 400,
      errorCode: "csv_header_missing",
    });
  let header = matrix[0]!;
  while (header.length && header[header.length - 1] == null)
    header = header.slice(0, -1);
  if (!header.length)
    return fail("CSV column names cannot be empty.", {
      statusCode: 400,
      errorCode: "csv_header_empty",
    });
  if (header.length > MAX_COLUMNS)
    return fail(`The CSV must have between 1 and ${MAX_COLUMNS} columns.`, {
      statusCode: 400,
      errorCode: "csv_column_limit",
    });
  const columns = header.map((value, index) => {
    if (value == null)
      return fail("CSV column names cannot be empty.", {
        statusCode: 400,
        errorCode: "csv_header_empty",
      });
    if (typeof value !== "string" && typeof value !== "number")
      return fail("CSV column names must be text.", {
        statusCode: 400,
        errorCode: "csv_header_invalid",
      });
    const name = String(value).trim();
    if (!name)
      return fail("CSV column names cannot be empty.", {
        statusCode: 400,
        errorCode: "csv_header_empty",
      });
    return name;
  });
  if (
    new Set(columns.map((column) => column.toLocaleLowerCase())).size !==
    columns.length
  )
    return fail("CSV column names must be unique.", {
      statusCode: 400,
      errorCode: "csv_header_duplicate",
    });

  const dataRows = matrix
    .slice(1)
    .filter((values) => values.some((value) => value !== null));
  if (dataRows.length > MAX_ROWS)
    return fail(`The CSV cannot exceed ${MAX_ROWS} rows.`, {
      statusCode: 413,
      errorCode: "csv_row_limit",
    });
  const rows = dataRows.map((values) => {
    if (values.slice(columns.length).some((value) => value !== null))
      return fail("A CSV row has more values than the header.", {
        statusCode: 400,
        errorCode: "csv_row_width_mismatch",
      });
    const row: Record<string, unknown> = {};
    for (let index = 0; index < columns.length; index += 1) {
      const value = values[index] ?? null;
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      )
        return fail("The CSV contains a value that cannot be staged.", {
          statusCode: 400,
          errorCode: "csv_value_invalid",
        });
      if (typeof value === "number" && !Number.isFinite(value))
        return fail("The CSV contains a non-finite number.", {
          statusCode: 400,
          errorCode: "csv_value_invalid",
        });
      row[columns[index]!] = value;
    }
    return row;
  });
  return { columns, rows };
}

export default defineAction({
  description:
    "Import a CSV into the signed-in user's staged datasets so the agent can query its rows. Pass fileId for a CSV already attached to the project or conversation, or filename with dataBase64 for raw bytes. The project must be editable; the returned dataset id is used with query-staged-dataset.",
  schema: z
    .object({
      projectId: z.string().min(1),
      fileId: z.string().uuid().optional(),
      filename: z.string().trim().min(1).max(255).optional(),
      dataBase64: z.string().min(1).max(2_800_000).optional(),
    })
    .strict()
    .refine(
      (input) =>
        input.fileId !== undefined
          ? input.filename === undefined && input.dataBase64 === undefined
          : input.filename !== undefined && input.dataBase64 !== undefined,
      "Pass either fileId, or filename with dataBase64.",
    ),
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: z.object({
    dataset: z.object({
      id: z.string(),
      name: z.string(),
      rowCount: z.number().int().nonnegative(),
      columns: z.array(z.string()),
      sourceComplete: z.literal(true),
    }),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) => {
    const { scope, project } = await requireOwnedProject(input.projectId);
    const stored =
      input.fileId === undefined
        ? null
        : await readProjectFile(input.projectId, input.fileId);
    const filename = stored?.file.filename ?? input.filename ?? "";
    const dataBase64 = stored?.dataBase64 ?? input.dataBase64 ?? "";
    const safeName = filename.replace(/.*[\\/]/, "").trim();
    if (
      !safeName.toLowerCase().endsWith(".csv") ||
      !safeName.replace(/\.csv$/i, "").trim()
    )
      fail("Choose a CSV file.", {
        statusCode: 400,
        errorCode: "csv_extension_required",
      });
    const bytes = Buffer.from(dataBase64, "base64");
    if (
      !bytes.length ||
      bytes.length > MAX_UPLOAD_BYTES ||
      bytes.toString("base64").replace(/=+$/, "") !==
        dataBase64.replace(/=+$/, "")
    )
      fail("Choose a valid CSV no larger than 2 MB.", {
        statusCode: 413,
        errorCode: "csv_size_or_encoding",
      });
    const { columns, rows } = parseProjectCsv(bytes);
    const name = safeName.replace(/\.csv$/i, "");
    const dataset = await upsertStagedDataset({
      id: stagedDatasetId({
        appId: "analytics-2",
        ownerEmail: scope.ownerEmail,
        name: `${project.id}/${name}`,
      }),
      appId: "analytics-2",
      ownerEmail: scope.ownerEmail,
      name,
      columns,
      rows,
      sourceComplete: true,
    });
    return {
      dataset: {
        id: dataset.id,
        name: dataset.name,
        rowCount: dataset.rowCount,
        columns: dataset.columns,
        sourceComplete: true as const,
      },
    };
  },
});
