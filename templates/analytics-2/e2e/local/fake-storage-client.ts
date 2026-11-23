import { Readable } from "node:stream";

import {
  Bool,
  DateDay,
  Field,
  Float64,
  Int64,
  Schema,
  Table,
  Utf8,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";
import { z } from "zod";

const fakeUrl = (
  globalThis as typeof globalThis & { __analyticsLocalFakeUrl?: string }
).__analyticsLocalFakeUrl;
if (!fakeUrl || new URL(fakeUrl).hostname !== "127.0.0.1")
  throw new Error("Storage fake requires the isolated local provider");

const resultSchema = z.object({
  fields: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export class BigQueryReadClient {
  private readonly projectId: string;

  constructor(options: { projectId: string }) {
    this.projectId = options.projectId;
  }

  readRows(request: { readStream: string; offset: string }) {
    const projectId = this.projectId;
    const match =
      /^projects\/([\w-]+)\/locations\/([\w-]+)\/jobs\/([\w-]+)\/streams\/_default$/.exec(
        request.readStream,
      );
    const jobId = match?.[3];
    if (
      !match ||
      !jobId ||
      match[1] !== projectId ||
      !/^\d+$/.test(request.offset)
    )
      throw new Error("Invalid local Storage read request");
    const url = new URL("/__control/storage", fakeUrl);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("jobId", jobId);
    url.searchParams.set("offset", request.offset);
    return Readable.from(
      (async function* () {
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(`Local Storage read failed: HTTP ${response.status}`);
        const result = resultSchema.parse(await response.json());
        const fields = result.fields.map(({ name, type }) => {
          switch (type.toUpperCase()) {
            case "INT64":
            case "INTEGER":
              return new Field(name, new Int64());
            case "FLOAT64":
            case "FLOAT":
              return new Field(name, new Float64());
            case "STRING":
              return new Field(name, new Utf8());
            case "DATE":
              return new Field(name, new DateDay());
            case "BOOL":
            case "BOOLEAN":
              return new Field(name, new Bool());
            default:
              throw new Error(`Unsupported local Storage type: ${type}`);
          }
        });
        const schema = new Schema(fields);
        const columns = Object.fromEntries(
          fields.map((field) => [
            field.name,
            vectorFromArray(
              result.rows.map((row) => {
                if (!Object.hasOwn(row, field.name))
                  throw new Error(`Missing local Storage field: ${field.name}`);
                const value = row[field.name];
                if (value === null) return null;
                if (field.type instanceof Int64) return BigInt(String(value));
                if (field.type instanceof DateDay)
                  return new Date(String(value));
                return value;
              }),
              field.type,
            ),
          ]),
        );
        const table = new Table(schema, columns);
        const schemaStream = tableToIPC(new Table(schema), "stream");
        const schemaBytes = schemaStream.subarray(0, schemaStream.length - 8);
        yield { arrowSchema: { serializedSchema: schemaBytes }, rowCount: 0 };
        if (result.rows.length) {
          const stream = tableToIPC(table, "stream");
          yield {
            arrowRecordBatch: {
              serializedRecordBatch: stream.subarray(
                schemaBytes.length,
                stream.length - 8,
              ),
              rowCount: result.rows.length,
            },
            rowCount: result.rows.length,
          };
        }
      })(),
    );
  }

  async close() {}
}
