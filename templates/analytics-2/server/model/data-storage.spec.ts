import {
  Binary,
  Bool,
  DateDay,
  Field,
  Float64,
  Int64,
  List,
  Schema,
  Struct,
  Table,
  TimeMicrosecond,
  TimestampMicrosecond,
  Vector,
  makeData,
  Uint64,
  Utf8,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";
import { describe, expect, it, vi } from "vitest";

import {
  decodeWarehouseStorageCursor,
  encodeWarehouseStorageCursor,
  readStoragePage,
  warehouseJobStreamName,
  WAREHOUSE_STORAGE_CLEANUP_TIMEOUT_MS,
  WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES,
  WAREHOUSE_STORAGE_READ_TIMEOUT_MS,
  warehouseSchemaFingerprint,
  type StorageReadRowsResponse,
  type WarehouseQueryColumn,
  type WarehouseStorageReader,
} from "./data-storage";

const EOS_BYTES = 8;

function schemaBytes(table: Table): Uint8Array {
  const stream = tableToIPC(new Table(table.schema), "stream");
  if (stream.length <= EOS_BYTES)
    throw new Error("The Arrow fixture did not serialize a schema message.");
  return stream.subarray(0, stream.length - EOS_BYTES);
}

function batchBytes(table: Table, size: number, start: number): Uint8Array {
  const schemaLength = schemaBytes(table).length;
  const stream = tableToIPC(table.slice(start, start + size), "stream");
  return stream.subarray(schemaLength, stream.length - EOS_BYTES);
}

function responseStream(
  responses: StorageReadRowsResponse[],
  onDestroy: () => void = () => {},
) {
  let index = 0;
  const iterator = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    async next(): Promise<IteratorResult<StorageReadRowsResponse>> {
      return index < responses.length
        ? { done: false as const, value: responses[index++]! }
        : { done: true as const, value: undefined };
    },
    destroy() {
      onDestroy();
    },
  };
  return iterator;
}

interface FakeReader extends WarehouseStorageReader {
  requests: { readStream: string; offset: string }[];
  destroyed: number;
  closed: number;
  consumed: number;
}

function fakeReader(
  table: Table,
  sizes: readonly number[],
  options: {
    schema?: Uint8Array;
    totalEstimatedRowCount?: bigint;
    offset?: number;
    destroyThrows?: boolean;
  } = {},
): FakeReader {
  const schema = options.schema ?? schemaBytes(table);
  const responses: StorageReadRowsResponse[] = [
    { arrowSchema: { serializedSchema: schema }, rowCount: 0 },
  ];
  let start = options.offset ?? 0;
  for (const size of sizes) {
    responses.push({
      arrowRecordBatch: {
        serializedRecordBatch: batchBytes(table, size, start),
        rowCount: size,
      },
      rowCount: size,
      ...(options.totalEstimatedRowCount === undefined
        ? {}
        : { totalEstimatedRowCount: options.totalEstimatedRowCount }),
    });
    start += size;
  }
  const reader: FakeReader = {
    requests: [],
    destroyed: 0,
    closed: 0,
    consumed: 0,
    readRows(request) {
      reader.requests.push(request);
      let index = 0;
      const iterator = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        async next(): Promise<IteratorResult<StorageReadRowsResponse>> {
          if (index >= responses.length)
            return { done: true as const, value: undefined };
          reader.consumed += 1;
          return { done: false as const, value: responses[index++]! };
        },
        destroy() {
          reader.destroyed += 1;
          if (options.destroyThrows)
            throw new Error("The test stream could not be destroyed.");
        },
      };
      return iterator;
    },
    async close() {
      reader.closed += 1;
    },
  };
  return reader;
}

const schema = new Schema([
  new Field("i64", new Int64()),
  new Field("u64", new Uint64()),
  new Field("flag", new Bool()),
  new Field("ratio", new Float64()),
  new Field("label", new Utf8()),
  new Field("day", new DateDay()),
  new Field("stamp", new TimestampMicrosecond()),
  new Field("blob", new Binary()),
]);
const values = {
  i64: [1n, 9223372036854775807n, null, -9223372036854775808n] as (
    | bigint
    | null
  )[],
  u64: [0n, 18446744073709551615n, 42n, null] as (bigint | null)[],
  flag: [true, false, null, true] as (boolean | null)[],
  ratio: [1.5, -2.25, null, 0] as (number | null)[],
  label: ["alpha", null, "gamma", "delta"] as (string | null)[],
  day: [
    new Date(Date.UTC(2026, 10, 6)),
    new Date(Date.UTC(1970, 0, 1)),
    null,
    new Date(Date.UTC(1999, 11, 31)),
  ] as (Date | null)[],
  stamp: [
    new Date(Date.UTC(2026, 10, 6, 12, 34, 56, 789)),
    new Date(Date.UTC(1970, 0, 1)),
    null,
    new Date(Date.UTC(2026, 10, 6, 0, 0, 0, 0)),
  ] as (Date | null)[],
  blob: [
    new Uint8Array([1, 2, 3]),
    null,
    new Uint8Array([4]),
    new Uint8Array([5, 6]),
  ] as (Uint8Array | null)[],
};
const table = new Table(schema, {
  i64: vectorFromArray(values.i64, new Int64()),
  u64: vectorFromArray(values.u64, new Uint64()),
  flag: vectorFromArray(values.flag, new Bool()),
  ratio: vectorFromArray(values.ratio, new Float64()),
  label: vectorFromArray(values.label, new Utf8()),
  day: vectorFromArray(values.day, new DateDay()),
  stamp: vectorFromArray(values.stamp, new TimestampMicrosecond()),
  blob: vectorFromArray(values.blob, new Binary()),
});
const columns = [
  { name: "i64", type: "INT64" },
  { name: "u64", type: "INT64" },
  { name: "flag", type: "BOOL" },
  { name: "ratio", type: "FLOAT64" },
  { name: "label", type: "STRING" },
  { name: "day", type: "DATE" },
  { name: "stamp", type: "TIMESTAMP" },
  { name: "blob", type: "BYTES" },
];

function page(
  reader: WarehouseStorageReader,
  overrides: Partial<{
    offset: number;
    first: number;
    totalRows: bigint;
    columns: readonly WarehouseQueryColumn[];
  }> = {},
) {
  return readStoragePage(reader, {
    projectId: "qa-project",
    jobId: "qa-job",
    location: "US",
    offset: BigInt(overrides.offset ?? 0),
    first: overrides.first ?? 1000,
    totalRows: overrides.totalRows ?? 4n,
    columns: overrides.columns ?? columns,
  });
}

describe("Storage IPC query results", () => {
  it("decodes real Arrow record-batch bytes in column order with exact int64 text and nulls", async () => {
    const reader = fakeReader(table, [1, 1, 2]);
    const result = await page(reader);
    expect(result.rows).toHaveLength(4);
    const row = result.rows[1]!;
    expect(row).toEqual([
      "9223372036854775807",
      "18446744073709551615",
      false,
      -2.25,
      null,
      "1970-01-01",
      "1970-01-01T00:00:00Z",
      null,
    ]);
    expect(result.rows[0]![0]).toBe("1");
    expect(result.rows[2]![0]).toBeNull();
    expect(result.rows[3]![0]).toBe("-9223372036854775808");
    expect(result.rows[0]![7]).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(reader.requests[0]).toEqual({
      readStream:
        "projects/qa-project/locations/US/jobs/qa-job/streams/_default",
      offset: "0",
    });
  });

  it("closes the stream and client-facing reader when the first page is satisfied", async () => {
    const reader = fakeReader(table, [2, 1, 1]);
    const result = await page(reader, { first: 2 });
    expect(result.rows).toHaveLength(2);
    expect(reader.destroyed).toBe(1);
    expect(reader.consumed).toBe(2);
  });

  it("pages past 64 rows and returns the exact final row", async () => {
    const rows = Array.from({ length: 66 }, (_, index) => BigInt(index));
    const large = new Table(new Schema([new Field("n", new Int64())]), {
      n: vectorFromArray(rows, new Int64()),
    });
    const largeColumns = [{ name: "n", type: "INT64" }];
    const first = await page(fakeReader(large, [10, 10, 10, 10, 10, 10, 6]), {
      first: 64,
      totalRows: 66n,
      columns: largeColumns,
    });
    expect(first.rows).toHaveLength(64);
    expect(first.rows[0]).toEqual(["0"]);
    expect(first.rows[63]).toEqual(["63"]);
    const second = await page(fakeReader(large, [2], { offset: 64 }), {
      offset: 64,
      first: 1000,
      totalRows: 66n,
      columns: largeColumns,
    });
    expect(second.rows).toEqual([["64"], ["65"]]);
    expect(
      (
        await page(fakeReader(large, [1], { offset: 63 }), {
          offset: 63,
          first: 1,
          totalRows: 66n,
          columns: largeColumns,
        })
      ).rows,
    ).toEqual([["63"]]);
  });

  it("rejects a batch before the schema chunk", async () => {
    const reader = fakeReader(table, [1]);
    const schemaOnlyReader: WarehouseStorageReader = {
      readRows: () => {
        const responses = [
          {
            arrowRecordBatch: {
              serializedRecordBatch: batchBytes(table, 1, 0),
              rowCount: 1,
            },
            rowCount: 1,
          },
        ];
        return responseStream(responses);
      },
      async close() {
        reader.closed += 1;
      },
    };
    await expect(page(schemaOnlyReader)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
  });

  it("rejects a schema whose column order or count does not match the query schema", async () => {
    await expect(
      page(fakeReader(table, [1, 1, 2]), {
        columns: [...columns.slice(0, 7)],
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
    await expect(
      page(fakeReader(table, [1, 1, 2]), {
        columns: [columns[1]!, columns[0]!, ...columns.slice(2)],
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
  });

  it("rejects a response row count that disagrees with the decoded batch", async () => {
    const reader: WarehouseStorageReader = {
      readRows: () => {
        const responses: StorageReadRowsResponse[] = [
          {
            arrowSchema: { serializedSchema: schemaBytes(table) },
            rowCount: 0,
          },
          {
            arrowRecordBatch: {
              serializedRecordBatch: batchBytes(table, 2, 0),
              rowCount: 2,
            },
            rowCount: 3,
          },
        ];
        return responseStream(responses);
      },
      async close() {},
    };
    await expect(page(reader)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
  });

  it("rejects a truncated or short stream instead of returning a completed empty result", async () => {
    await expect(
      page(fakeReader(table, [1, 1]), { totalRows: 4n }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
    await expect(
      page(fakeReader(table, []), { totalRows: 1n }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
    await expect(
      page(fakeReader(table, [1, 1, 2]), { totalRows: 3n }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
  });

  it("rejects corrupt record-batch bytes without exposing provider text", async () => {
    const good = batchBytes(table, 1, 0);
    const reader: WarehouseStorageReader = {
      readRows: () => {
        const responses: StorageReadRowsResponse[] = [
          {
            arrowSchema: { serializedSchema: schemaBytes(table) },
            rowCount: 0,
          },
          {
            arrowRecordBatch: {
              serializedRecordBatch: good.subarray(0, good.length - 5),
              rowCount: 1,
            },
            rowCount: 1,
          },
        ];
        return responseStream(responses);
      },
      async close() {},
    };
    await expect(page(reader)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
  });

  it("rejects a storage row-count estimate that disagrees with the completed job", async () => {
    await expect(
      page(fakeReader(table, [1, 1, 2], { totalEstimatedRowCount: 99n })),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
    });
  });

  it("rejects offsets beyond the completed result and non-positive page sizes", async () => {
    await expect(
      page(fakeReader(table, []), { offset: 4, first: 1 }),
    ).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "warehouse_query_cursor_invalid",
    });
    await expect(
      page(fakeReader(table, []), { first: 0 }),
    ).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "warehouse_query_page_invalid",
    });
    await expect(
      page(fakeReader(table, []), { first: 1001 }),
    ).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "warehouse_query_page_invalid",
    });
  });

  it("cancels a stalled stream at the read deadline", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      let finish: (() => void) | undefined;
      const iterator = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        next() {
          return new Promise<IteratorResult<StorageReadRowsResponse>>(
            (resolve) => {
              finish = () => resolve({ done: true as const, value: undefined });
            },
          );
        },
        cancel() {
          calls.push("cancel");
        },
        destroy(error?: Error) {
          calls.push(error ? "destroy-timeout" : "destroy");
          finish?.();
        },
      };
      const reader: WarehouseStorageReader = {
        readRows: () => iterator,
        close: async () => {},
      };
      const failure = expect(
        page(reader, { totalRows: 1n }),
      ).rejects.toMatchObject({
        statusCode: 502,
        errorCode: "warehouse_query_result_invalid",
      });
      await vi.advanceTimersByTimeAsync(WAREHOUSE_STORAGE_READ_TIMEOUT_MS);
      await failure;
      expect(calls).toContain("cancel");
      expect(calls).toContain("destroy-timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds cleanup when iterator.return never settles and cancellation throws", async () => {
    vi.useFakeTimers();
    try {
      const iterator = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        next(): Promise<IteratorResult<StorageReadRowsResponse>> {
          return new Promise(() => {});
        },
        return(): Promise<IteratorResult<StorageReadRowsResponse>> {
          return new Promise(() => {});
        },
        cancel() {
          throw new Error("The test stream could not cancel.");
        },
        destroy() {
          throw new Error("The test stream could not be destroyed.");
        },
      };
      const reader: WarehouseStorageReader = {
        readRows: () => iterator,
        close: async () => {},
      };
      const failure = expect(
        page(reader, { totalRows: 1n }),
      ).rejects.toMatchObject({
        statusCode: 502,
        errorCode: "warehouse_query_timeout",
        details: { unreleasedStorageStream: true },
      });
      await vi.advanceTimersByTimeAsync(
        WAREHOUSE_STORAGE_READ_TIMEOUT_MS +
          WAREHOUSE_STORAGE_CLEANUP_TIMEOUT_MS +
          200,
      );
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds the job stream name only from validated job coordinates", () => {
    expect(
      warehouseJobStreamName({
        projectId: "example.com:qa-project",
        jobId: "qa_job-1",
        location: "us-central1",
      }),
    ).toBe(
      "projects/example.com:qa-project/locations/us-central1/jobs/qa_job-1/streams/_default",
    );
    expect(() =>
      warehouseJobStreamName({
        projectId: "qa-project",
        jobId: "job/other",
        location: "US",
      }),
    ).toThrow();
    expect(() =>
      warehouseJobStreamName({
        projectId: "qa-project",
        jobId: "qa-job",
        location: "",
      }),
    ).toThrow();
  });

  it("keeps microsecond timestamps exact and negative epochs correct", async () => {
    const timestampSchema = new Schema([
      new Field("ts", new TimestampMicrosecond()),
    ]);
    const timestampTable = new Table(timestampSchema, {
      ts: new Vector([
        makeData({
          type: new TimestampMicrosecond(),
          length: 2,
          nullCount: 0,
          data: new BigInt64Array([1793968496123456n, -123456n]),
        }),
      ]),
    });
    const timestamp = await page(
      fakeReader(timestampTable, [2], { offset: 0 }),
      {
        totalRows: 2n,
        columns: [{ name: "ts", type: "TIMESTAMP" }],
      },
    );
    expect(timestamp.rows).toEqual([
      ["2026-11-06T12:34:56.123456Z"],
      ["1969-12-31T23:59:59.876544Z"],
    ]);
    const datetime = await page(
      fakeReader(timestampTable, [2], { offset: 0 }),
      {
        totalRows: 2n,
        columns: [{ name: "ts", type: "DATETIME" }],
      },
    );
    expect(datetime.rows).toEqual([
      ["2026-11-06T12:34:56.123456"],
      ["1969-12-31T23:59:59.876544"],
    ]);
  });

  it("materializes only the requested rows from a very large binary batch", async () => {
    const total = 250_000;
    const large = new Table(new Schema([new Field("n", new Int64())]), {
      n: vectorFromArray(
        Array.from({ length: total }, (_, index) => BigInt(index)),
        new Int64(),
      ),
    });
    const reader = fakeReader(large, [total]);
    const result = await page(reader, {
      first: 1000,
      totalRows: BigInt(total),
      columns: [{ name: "n", type: "INTEGER" }],
    });
    expect(result.rows).toHaveLength(1000);
    expect(result.rows[0]).toEqual(["0"]);
    expect(result.rows[999]).toEqual(["999"]);
    expect(reader.destroyed).toBe(1);
  });

  it("rejects a cleanup failure after an otherwise valid page", async () => {
    const reader = fakeReader(table, [4], { destroyThrows: true });
    await expect(page(reader)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_cleanup_failed",
      details: { unreleasedStorageStream: true },
    });
  });

  it("preserves the primary typed failure when cleanup also fails", async () => {
    const reader = fakeReader(table, [1], { destroyThrows: true });
    await expect(page(reader, { totalRows: 4n })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      details: { unreleasedStorageStream: true },
    });
  });

  it("rejects an Arrow type that disagrees with the declared BigQuery type", async () => {
    const floatTable = new Table(
      new Schema([new Field("value", new Float64())]),
      { value: vectorFromArray([1.5], new Float64()) },
    );
    await expect(
      page(fakeReader(floatTable, [1]), {
        totalRows: 1n,
        columns: [{ name: "value", type: "INT64" }],
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("type does not match"),
    });
  });

  it("rejects a declared repeated column that does not arrive as an Arrow list", async () => {
    const single = new Table(new Schema([new Field("n", new Int64())]), {
      n: vectorFromArray([1n], new Int64()),
    });
    await expect(
      page(fakeReader(single, [1]), {
        totalRows: 1n,
        columns: [{ name: "n", type: "INT64", mode: "REPEATED" }],
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("type does not match"),
    });
  });

  it("rejects a single response payload over the byte budget before parsing it", async () => {
    const oversized = new Uint8Array(WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES + 1);
    const reader: WarehouseStorageReader = {
      readRows: () =>
        responseStream([
          {
            arrowSchema: { serializedSchema: schemaBytes(table) },
            rowCount: 0,
          },
          {
            arrowRecordBatch: {
              serializedRecordBatch: oversized,
              rowCount: 1,
            },
            rowCount: 1,
          },
        ]),
      close: async () => {},
    };
    await expect(page(reader, { totalRows: 1n })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("exceeds the supported size"),
    });
  });

  it("rejects cumulative page bytes over the byte budget", async () => {
    const documentedMaximum = new Uint8Array(
      WAREHOUSE_STORAGE_MAX_RESPONSE_BYTES,
    );
    const reader: WarehouseStorageReader = {
      readRows: () =>
        responseStream(
          [0, 1, 2].map(() => ({
            arrowSchema: { serializedSchema: documentedMaximum },
            rowCount: 0,
          })),
        ),
      close: async () => {},
    };
    await expect(page(reader, { totalRows: 1n })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("exceeds the supported size"),
    });
  });

  it("decodes nested date/time values exactly instead of returning raw ticks", async () => {
    const structType = new Struct([
      new Field("ts", new TimestampMicrosecond()),
    ]);
    const timestampChild = makeData({
      type: new TimestampMicrosecond(),
      length: 1,
      nullCount: 0,
      data: new BigInt64Array([1793968496123456n]),
    });
    const structData = makeData({
      type: structType,
      length: 1,
      nullCount: 0,
      children: [timestampChild],
    });
    const structTable = new Table(new Schema([new Field("s", structType)]), {
      s: new Vector([structData]),
    });
    const result = await page(fakeReader(structTable, [1]), {
      totalRows: 1n,
      columns: [
        {
          name: "s",
          type: "RECORD",
          fields: [{ name: "ts", type: "TIMESTAMP" }],
        },
      ],
    });
    expect(result.rows).toEqual([[{ ts: "2026-11-06T12:34:56.123456Z" }]]);
  });

  it("decodes nested temporals even when declared field metadata is absent", async () => {
    const nestedType = new Struct([
      new Field("stamp", new TimestampMicrosecond()),
      new Field("day", new DateDay()),
      new Field("at", new TimeMicrosecond()),
    ]);
    const nestedTable = new Table(
      new Schema([new Field("record", nestedType)]),
      {
        record: vectorFromArray(
          [
            {
              stamp: new Date("2026-11-06T12:34:56.123Z"),
              day: new Date("2026-11-06T00:00:00Z"),
              at: 45296123456n,
            },
          ],
          nestedType,
        ),
      },
    );
    const result = await page(fakeReader(nestedTable, [1]), {
      totalRows: 1n,
      columns: [{ name: "record", type: "RECORD" }],
    });
    expect(result.rows).toEqual([
      [
        {
          stamp: "2026-11-06T12:34:56.123",
          day: "2026-11-06",
          at: "12:34:56.123456",
        },
      ],
    ]);
  });

  it("keeps null temporal values null at the top level", async () => {
    const nullableSchema = new Schema([
      new Field("day", new DateDay()),
      new Field("stamp", new TimestampMicrosecond()),
      new Field("at", new TimeMicrosecond()),
    ]);
    const nullableTable = new Table(nullableSchema, {
      day: vectorFromArray(
        [null, new Date("1970-01-02T00:00:00Z")],
        new DateDay(),
      ),
      stamp: vectorFromArray(
        [null, new Date("1970-01-01T00:00:01.123Z")],
        new TimestampMicrosecond(),
      ),
      at: vectorFromArray([null, 1n], new TimeMicrosecond()),
    });
    const result = await page(fakeReader(nullableTable, [2]), {
      totalRows: 2n,
      columns: [
        { name: "day", type: "DATE" },
        { name: "stamp", type: "TIMESTAMP" },
        { name: "at", type: "TIME" },
      ],
    });
    expect(result.rows).toEqual([
      [null, null, null],
      ["1970-01-02", "1970-01-01T00:00:01.123Z", "00:00:00.000001"],
    ]);
  });

  it("keeps null values inside a mixed nested struct", async () => {
    const nestedType = new Struct([
      new Field("stamp", new TimestampMicrosecond()),
      new Field("day", new DateDay()),
      new Field("at", new TimeMicrosecond()),
    ]);
    const nestedTable = new Table(
      new Schema([new Field("record", nestedType)]),
      {
        record: vectorFromArray(
          [
            {
              stamp: new Date("2026-11-06T12:34:56.123Z"),
              day: null,
              at: null,
            },
            {
              stamp: null,
              day: new Date("2026-11-06T00:00:00Z"),
              at: 45296123456n,
            },
          ],
          nestedType,
        ),
      },
    );
    const result = await page(fakeReader(nestedTable, [2]), {
      totalRows: 2n,
      columns: [
        {
          name: "record",
          type: "RECORD",
          fields: [
            { name: "stamp", type: "TIMESTAMP" },
            { name: "day", type: "DATE" },
            { name: "at", type: "TIME" },
          ],
        },
      ],
    });
    expect(result.rows).toEqual([
      [
        {
          stamp: "2026-11-06T12:34:56.123Z",
          day: null,
          at: null,
        },
      ],
      [
        {
          stamp: null,
          day: "2026-11-06",
          at: "12:34:56.123456",
        },
      ],
    ]);
  });

  it("decodes an ARRAY of TIME values exactly", async () => {
    const listType = new List(new Field("item", new TimeMicrosecond()));
    const listTable = new Table(new Schema([new Field("times", listType)]), {
      times: vectorFromArray([[45296123456n, 0n]], listType),
    });
    const result = await page(fakeReader(listTable, [1]), {
      totalRows: 1n,
      columns: [{ name: "times", type: "TIME", mode: "REPEATED" }],
    });
    expect(result.rows).toEqual([[["12:34:56.123456", "00:00:00"]]]);
  });

  it("keeps TIME list rows correct with different lengths and chunking", async () => {
    const listType = new List(new Field("item", new TimeMicrosecond(), true));
    const listTable = new Table(
      new Schema([new Field("values", listType, true)]),
      {
        values: vectorFromArray([[1n], [2n, null], [3n, 4n, 5n]], listType),
      },
    );
    const columns = [{ name: "values", type: "TIME", mode: "REPEATED" }];
    const single = await page(fakeReader(listTable, [3]), {
      totalRows: 3n,
      first: 3,
      columns,
    });
    const chunked = await page(fakeReader(listTable, [1, 1, 1]), {
      totalRows: 3n,
      first: 3,
      columns,
    });
    expect(single.rows).toEqual([
      [["00:00:00.000001"]],
      [["00:00:00.000002", null]],
      [["00:00:00.000003", "00:00:00.000004", "00:00:00.000005"]],
    ]);
    expect(chunked.rows).toEqual(single.rows);
  });

  it("keeps null and empty TIME list rows without offset bleed", async () => {
    const listType = new List(new Field("item", new TimeMicrosecond(), true));
    const listTable = new Table(
      new Schema([new Field("values", listType, true)]),
      {
        values: vectorFromArray([null, [], [1n, null, 3n], [2n, 4n]], listType),
      },
    );
    const result = await page(fakeReader(listTable, [1, 1, 1, 1]), {
      totalRows: 4n,
      first: 4,
      columns: [{ name: "values", type: "TIME", mode: "REPEATED" }],
    });
    expect(result.rows).toEqual([
      [null],
      [[]],
      [["00:00:00.000001", null, "00:00:00.000003"]],
      [["00:00:00.000002", "00:00:00.000004"]],
    ]);
  });

  it("rejects a negative TIME value inside a list", async () => {
    const listType = new List(new Field("item", new TimeMicrosecond(), true));
    const listTable = new Table(
      new Schema([new Field("values", listType, true)]),
      { values: vectorFromArray([[1n], [-1n, null]], listType) },
    );
    await expect(
      page(fakeReader(listTable, [1, 1]), {
        totalRows: 2n,
        first: 2,
        columns: [{ name: "values", type: "TIME", mode: "REPEATED" }],
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("invalid time"),
    });
  });

  it("keeps negative TIMESTAMP values exact inside lists", async () => {
    const listType = new List(
      new Field("item", new TimestampMicrosecond(), true),
    );
    const listTable = new Table(
      new Schema([new Field("values", listType, true)]),
      {
        values: vectorFromArray(
          [[new Date(-1)], [new Date(-2), null]],
          listType,
        ),
      },
    );
    const result = await page(fakeReader(listTable, [1, 1]), {
      totalRows: 2n,
      first: 2,
      columns: [{ name: "values", type: "TIMESTAMP", mode: "REPEATED" }],
    });
    expect(result.rows).toEqual([
      [["1969-12-31T23:59:59.999Z"]],
      [["1969-12-31T23:59:59.998Z", null]],
    ]);
  });

  it("keeps ARRAY<STRUCT<TIME>> rows correct across chunking", async () => {
    const structType = new Struct([
      new Field("at", new TimeMicrosecond(), true),
    ]);
    const listType = new List(new Field("item", structType, true));
    const listTable = new Table(
      new Schema([new Field("values", listType, true)]),
      {
        values: vectorFromArray([[{ at: 1n }], [{ at: 2n }, null]], listType),
      },
    );
    const columns = [
      {
        name: "values",
        type: "RECORD",
        mode: "REPEATED",
        fields: [{ name: "at", type: "TIME" }],
      },
    ];
    const single = await page(fakeReader(listTable, [2]), {
      totalRows: 2n,
      first: 2,
      columns,
    });
    const chunked = await page(fakeReader(listTable, [1, 1]), {
      totalRows: 2n,
      first: 2,
      columns,
    });
    expect(single.rows).toEqual([
      [[{ at: "00:00:00.000001" }]],
      [[{ at: "00:00:00.000002" }, null]],
    ]);
    expect(chunked.rows).toEqual(single.rows);
  });

  it("accepts a valid first row above the old 16 MiB draft cap", async () => {
    const payload = "x".repeat(17 * 1024 * 1024);
    const wideTable = new Table(new Schema([new Field("wide", new Utf8())]), {
      wide: vectorFromArray([payload], new Utf8()),
    });
    const result = await page(fakeReader(wideTable, [1]), {
      totalRows: 1n,
      columns: [{ name: "wide", type: "STRING" }],
    });
    expect(result.rows[0]?.[0]).toHaveLength(payload.length);
  });

  it("validates declared types inside a nested struct", async () => {
    const structType = new Struct([new Field("v", new Float64())]);
    const child = makeData({
      type: new Float64(),
      length: 1,
      nullCount: 0,
      data: new Float64Array([1.5]),
    });
    const structData = makeData({
      type: structType,
      length: 1,
      nullCount: 0,
      children: [child],
    });
    const structTable = new Table(new Schema([new Field("s", structType)]), {
      s: new Vector([structData]),
    });
    await expect(
      page(fakeReader(structTable, [1]), {
        totalRows: 1n,
        columns: [
          {
            name: "s",
            type: "RECORD",
            fields: [{ name: "v", type: "INT64" }],
          },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("type does not match"),
    });
  });

  it("returns an empty page for a zero-row result without opening the stream", async () => {
    const reader: WarehouseStorageReader = {
      readRows: () => {
        throw new Error("A zero-row page must not open a Storage stream.");
      },
      close: async () => {},
    };
    await expect(
      readStoragePage(reader, {
        projectId: "qa-project",
        jobId: "qa-job",
        location: "US",
        offset: 0n,
        first: 1000,
        totalRows: 0n,
        columns,
      }),
    ).resolves.toEqual({ rows: [] });
  });

  it("rejects nested collection expansion over the budget", async () => {
    const listType = new List(new Field("item", new Int64()));
    const listTable = new Table(new Schema([new Field("l", listType)]), {
      l: vectorFromArray([new BigInt64Array(1_000_001)], listType),
    });
    await expect(
      page(fakeReader(listTable, [1]), {
        totalRows: 1n,
        columns: [{ name: "l", type: "INT64", mode: "REPEATED" }],
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("nested values exceed"),
    });
  });

  it("rejects a batch larger than the job remaining even on an early page", async () => {
    await expect(
      page(fakeReader(table, [4]), { totalRows: 3n, first: 1 }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_result_invalid",
      message: expect.stringContaining("more rows than the job"),
    });
  });

  it("does not hang when the watchdog cancellation itself throws", async () => {
    vi.useFakeTimers();
    try {
      const iterator = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        next(): Promise<IteratorResult<StorageReadRowsResponse>> {
          return new Promise(() => {});
        },
        cancel() {
          throw new Error("The test stream could not cancel.");
        },
        destroy() {
          throw new Error("The test stream could not be destroyed.");
        },
      };
      const reader: WarehouseStorageReader = {
        readRows: () => iterator,
        close: async () => {},
      };
      const failure = expect(
        page(reader, { totalRows: 1n }),
      ).rejects.toMatchObject({
        statusCode: 502,
        errorCode: "warehouse_query_timeout",
        message: expect.stringContaining("timed out"),
        details: { unreleasedStorageStream: true },
      });
      await vi.advanceTimersByTimeAsync(WAREHOUSE_STORAGE_READ_TIMEOUT_MS);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Storage paging cursor", () => {
  const fingerprint = warehouseSchemaFingerprint(columns);
  const cursor = {
    projectId: "qa-project",
    jobId: "qa-job",
    location: "US",
    offset: 64n,
    schemaFingerprint: fingerprint,
  };

  it("roundtrips a cursor bound to the job, project, location and column schema", () => {
    const token = encodeWarehouseStorageCursor(cursor);
    expect(
      decodeWarehouseStorageCursor(token, {
        projectId: "qa-project",
        jobId: "qa-job",
        location: "US",
        schemaFingerprint: fingerprint,
      }),
    ).toEqual({ version: 1, ...cursor });
  });

  it("refuses a cursor from another job, project, location or schema", () => {
    const token = encodeWarehouseStorageCursor(cursor);
    for (const expected of [
      {
        projectId: "other-project",
        jobId: "qa-job",
        location: "US",
        schemaFingerprint: fingerprint,
      },
      {
        projectId: "qa-project",
        jobId: "other-job",
        location: "US",
        schemaFingerprint: fingerprint,
      },
      {
        projectId: "qa-project",
        jobId: "qa-job",
        location: "EU",
        schemaFingerprint: fingerprint,
      },
    ]) {
      expect(() => decodeWarehouseStorageCursor(token, expected)).toThrow(
        expect.objectContaining({
          statusCode: 403,
          errorCode: "warehouse_query_job_denied",
        }),
      );
    }
    expect(() =>
      decodeWarehouseStorageCursor(token, {
        projectId: "qa-project",
        jobId: "qa-job",
        location: "US",
        schemaFingerprint: warehouseSchemaFingerprint([columns[0]!]),
      }),
    ).toThrow(
      expect.objectContaining({
        statusCode: 409,
        errorCode: "warehouse_query_cursor_stale",
      }),
    );
  });

  it("roundtrips an offset beyond Number.MAX_SAFE_INTEGER without rounding", () => {
    const offset = 9_007_199_254_740_993n;
    const token = encodeWarehouseStorageCursor({ ...cursor, offset });
    expect(
      decodeWarehouseStorageCursor(token, {
        projectId: "qa-project",
        jobId: "qa-job",
        location: "US",
        schemaFingerprint: fingerprint,
      }).offset,
    ).toBe(offset);
  });

  it("refuses malformed, negative or out-of-bounds cursors", () => {
    expect(() =>
      decodeWarehouseStorageCursor("not-a-cursor", {
        projectId: "qa-project",
        jobId: "qa-job",
        location: "US",
        schemaFingerprint: fingerprint,
      }),
    ).toThrow(
      expect.objectContaining({
        statusCode: 422,
        errorCode: "warehouse_query_cursor_invalid",
      }),
    );
    for (const offset of [-1, 1.5]) {
      const token = Buffer.from(
        JSON.stringify({ version: 1, ...cursor, offset: String(offset) }),
      ).toString("base64url");
      expect(() =>
        decodeWarehouseStorageCursor(token, {
          projectId: "qa-project",
          jobId: "qa-job",
          location: "US",
          schemaFingerprint: fingerprint,
        }),
      ).toThrow(
        expect.objectContaining({
          statusCode: 422,
          errorCode: "warehouse_query_cursor_invalid",
        }),
      );
    }
  });
});
