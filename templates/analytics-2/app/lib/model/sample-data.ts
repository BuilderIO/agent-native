/**
 * Sample data a new workspace can work with before anything is connected.
 *
 * Every value here is derived from a fixed seed, so the same dataset is
 * produced on every machine, on every load and in every test run. Nothing in
 * this module reads the clock or a random source.
 */

import { getCachedNumberFormat } from "../intl-cache";

export type SampleColumnType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "null";

export type SampleColumn = {
  name: string;
  type: SampleColumnType;
  description?: string;
};

export type SampleValue = string | number | boolean | null;

export type SampleTable = {
  name: string;
  columns: SampleColumn[];
  rows: SampleValue[][];
};

/** A deterministic 32-bit generator; the same seed always yields the same stream. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const index = Math.floor(random() * values.length);
  return values[Math.min(index, values.length - 1)]!;
}

function between(random: () => number, min: number, max: number): number {
  return Math.round(min + random() * (max - min));
}

/** The date the sample data is anchored to. */
export const SAMPLE_ANCHOR_DATE = "2026-01-01";

function isoDate(daysAfterAnchor: number): string {
  const anchor = Date.parse(`${SAMPLE_ANCHOR_DATE}T00:00:00.000Z`);
  const date = new Date(anchor + daysAfterAnchor * 86_400_000);
  return date.toISOString().slice(0, 10);
}

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Germany",
  "Japan",
] as const;
const SEGMENTS = ["consumer", "smb", "enterprise"] as const;
const CHANNELS = ["direct", "partner", "marketplace"] as const;
const CATEGORIES = ["hardware", "software", "services"] as const;
const PRODUCT_NAMES = [
  "Beacon",
  "Cobalt",
  "Drift",
  "Ember",
  "Fathom",
  "Glide",
  "Harbor",
  "Iris",
] as const;
const CUSTOMER_NAMES = [
  "Acme Supply",
  "Blue Harbor",
  "Cedar Works",
  "Delta Foods",
  "Everline",
  "Fairmount",
  "Granite Co",
  "Hollow Oak",
  "Ironwood",
  "Juniper Labs",
  "Keystone",
  "Larkspur",
] as const;

function customersTable(): SampleTable {
  const random = seededRandom(10_001);
  const rows: SampleValue[][] = [];
  for (let index = 0; index < 12; index += 1) {
    const id = `cus_${String(index + 1).padStart(3, "0")}`;
    rows.push([
      id,
      `${CUSTOMER_NAMES[index % CUSTOMER_NAMES.length]} ${index + 1}`,
      pick(random, COUNTRIES),
      pick(random, SEGMENTS),
      isoDate(-between(random, 30, 400)),
    ]);
  }
  return {
    name: "customers",
    columns: [
      {
        name: "customer_id",
        type: "string",
        description: "Unique identifier for the customer account.",
      },
      {
        name: "customer_name",
        type: "string",
        description: "Display name of the customer organization.",
      },
      {
        name: "country",
        type: "string",
        description: "Primary billing country for the customer.",
      },
      {
        name: "segment",
        type: "string",
        description: "Customer tier (consumer, smb, or enterprise).",
      },
      {
        name: "created_at",
        type: "date",
        description: "Date the customer account was created.",
      },
    ],
    rows,
  };
}

function productsTable(): SampleTable {
  const random = seededRandom(20_002);
  const rows: SampleValue[][] = [];
  for (let index = 0; index < 8; index += 1) {
    const id = `prd_${String(index + 1).padStart(3, "0")}`;
    rows.push([
      id,
      `${PRODUCT_NAMES[index % PRODUCT_NAMES.length]} ${between(random, 100, 999)}`,
      pick(random, CATEGORIES),
      between(random, 40, 900),
    ]);
  }
  return {
    name: "products",
    columns: [
      {
        name: "product_id",
        type: "string",
        description: "Unique identifier for the catalog product.",
      },
      {
        name: "product_name",
        type: "string",
        description: "Human-readable name of the product.",
      },
      {
        name: "category",
        type: "string",
        description: "Catalog line (hardware, software, or services).",
      },
      {
        name: "list_price",
        type: "number",
        description: "Standard unit list price in USD.",
      },
    ],
    rows,
  };
}

function ordersTable(): SampleTable {
  const random = seededRandom(30_003);
  const rows: SampleValue[][] = [];
  for (let index = 0; index < 240; index += 1) {
    const quantity = between(random, 1, 9);
    const unitPrice = between(random, 25, 950);
    rows.push([
      `ord_${String(index + 1).padStart(4, "0")}`,
      isoDate(-between(random, 0, 89)),
      `cus_${String(between(random, 1, 12)).padStart(3, "0")}`,
      `prd_${String(between(random, 1, 8)).padStart(3, "0")}`,
      quantity,
      unitPrice,
      quantity * unitPrice,
      pick(random, CHANNELS),
    ]);
  }
  return {
    name: "orders",
    columns: [
      {
        name: "order_id",
        type: "string",
        description: "Unique identifier for each placed order.",
      },
      {
        name: "order_date",
        type: "date",
        description: "Calendar date when the order was placed.",
      },
      {
        name: "customer_id",
        type: "string",
        description: "Foreign key referencing customers.customer_id.",
      },
      {
        name: "product_id",
        type: "string",
        description: "Foreign key referencing products.product_id.",
      },
      {
        name: "quantity",
        type: "number",
        description: "Number of units included in the order.",
      },
      {
        name: "unit_price",
        type: "number",
        description: "Price charged per unit in USD.",
      },
      {
        name: "order_total",
        type: "number",
        description: "Total order revenue (quantity multiplied by unit_price).",
      },
      {
        name: "channel",
        type: "string",
        description: "Sales channel (direct, partner, or marketplace).",
      },
    ],
    rows,
  };
}

function sessionsTable(): SampleTable {
  const random = seededRandom(40_004);
  const rows: SampleValue[][] = [];
  const stages = ["visit", "signup", "activation", "purchase"] as const;
  for (let day = 0; day < 30; day += 1) {
    for (const stage of stages) {
      const users = between(random, 40, 900);
      rows.push([
        isoDate(-day),
        stage,
        users,
        stage === "purchase" ? between(random, 5, Math.max(6, users - 20)) : 0,
      ]);
    }
  }
  return {
    name: "sessions",
    columns: [
      {
        name: "session_date",
        type: "date",
        description: "Date of the aggregated funnel session activity.",
      },
      {
        name: "stage",
        type: "string",
        description: "Funnel step (visit, signup, activation, or purchase).",
      },
      {
        name: "users",
        type: "number",
        description: "Distinct users reaching this funnel stage.",
      },
      {
        name: "conversions",
        type: "number",
        description: "Users completing a purchase conversion in the stage.",
      },
    ],
    rows,
  };
}

function supportTicketsTable(): SampleTable {
  return {
    name: "support_tickets",
    columns: [
      {
        name: "opened_on",
        type: "date",
        description: "Date when the support ticket was opened.",
      },
      {
        name: "priority",
        type: "string",
        description: "Ticket urgency level (low, normal, or high).",
      },
      {
        name: "minutes_open",
        type: "number",
        description: "Total resolution time in minutes.",
      },
    ],
    rows: [
      ["2026-10-27", "high", 320],
      ["2026-10-27", "normal", 96],
      ["2026-10-28", "low", 41],
      ["2026-10-29", "high", 288],
      ["2026-10-30", "normal", 132],
      ["2026-11-02", "normal", 88],
      ["2026-11-03", "high", 364],
      ["2026-11-04", "low", 22],
      ["2026-11-05", "normal", 110],
      ["2026-11-06", "high", 240],
    ],
  };
}

/** The sample tables every new workspace starts with, in a stable order. */
export function sampleTables(): SampleTable[] {
  return [
    ordersTable(),
    customersTable(),
    productsTable(),
    sessionsTable(),
    supportTicketsTable(),
  ];
}

export function sampleTable(name: string): SampleTable | null {
  return sampleTables().find((table) => table.name === name) ?? null;
}

export type SampleProjectSeed = {
  title: string;
  description: string;
  tables: string[];
};

/** The projects a new workspace opens with. */
export function sampleProjects(): SampleProjectSeed[] {
  return [
    {
      title: "Revenue overview",
      description:
        "Monthly revenue, order volume and the best selling categories.",
      tables: ["orders", "products"],
    },
    {
      title: "Customer segments",
      description: "Who our customers are and how each segment is growing.",
      tables: ["customers", "orders"],
    },
    {
      title: "Signup funnel",
      description: "How visitors move through signup, activation and purchase.",
      tables: ["sessions"],
    },
  ];
}

export type SampleAggregation =
  | "count"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "distinct_count";

export type AggregateOptions = {
  /** Column to sum, average or count. */
  measure?: string;
  /** Column to group rows by, in the order groups appear. */
  groupBy?: string;
  aggregation: SampleAggregation;
  /** Keep only the largest groups. */
  limit?: number;
};

function numberColumnIndex(table: SampleTable, measure: string): number {
  const index = table.columns.findIndex(
    (column) => column.name === measure && column.type === "number",
  );
  if (index < 0) {
    throw new Error(`"${measure}" is not a numeric column of ${table.name}`);
  }
  return index;
}

function groupColumnIndex(table: SampleTable, groupBy: string): number {
  const index = table.columns.findIndex((column) => column.name === groupBy);
  if (index < 0) {
    throw new Error(`"${groupBy}" is not a column of ${table.name}`);
  }
  return index;
}

function aggregateGroup(
  values: readonly SampleValue[],
  measureValues: readonly number[],
  aggregation: SampleAggregation,
): number {
  switch (aggregation) {
    case "count":
      return values.length;
    case "distinct_count":
      return new Set(values.map((value) => String(value))).size;
    case "sum":
      return round(measureValues.reduce((total, value) => total + value, 0));
    case "average":
      return measureValues.length === 0
        ? 0
        : round(
            measureValues.reduce((total, value) => total + value, 0) /
              measureValues.length,
          );
    case "min":
      return measureValues.length === 0 ? 0 : Math.min(...measureValues);
    case "max":
      return measureValues.length === 0 ? 0 : Math.max(...measureValues);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Groups a sample table and aggregates one measure. Rows keep the order the
 * groups first appear in, so a chart's categories never shuffle between runs.
 */
export function aggregateSampleTable(
  table: SampleTable,
  options: AggregateOptions,
): SampleTable {
  const measureIndex =
    options.measure === undefined
      ? -1
      : numberColumnIndex(table, options.measure);
  const groupIndex =
    options.groupBy === undefined
      ? -1
      : groupColumnIndex(table, options.groupBy);

  if (groupIndex < 0) {
    const values = table.rows.map((row) => row[measureIndex] ?? null);
    const numbers = values.filter(
      (value): value is number => typeof value === "number",
    );
    return {
      name: table.name,
      columns: [
        {
          name: options.measure ?? "rows",
          type: options.aggregation === "count" ? "number" : "number",
        },
      ],
      rows: [[aggregateGroup(values, numbers, options.aggregation)]],
    };
  }

  const groups = new Map<
    string,
    { values: SampleValue[]; measure: number[] }
  >();
  for (const row of table.rows) {
    const key = String(row[groupIndex] ?? "");
    const bucket = groups.get(key) ?? { values: [], measure: [] };
    bucket.values.push(row[groupIndex] ?? null);
    if (measureIndex >= 0) {
      const value = row[measureIndex];
      if (typeof value === "number") bucket.measure.push(value);
    }
    groups.set(key, bucket);
  }

  let entries = [...groups.entries()];
  if (options.limit !== undefined) entries = entries.slice(0, options.limit);

  return {
    name: table.name,
    columns: [
      {
        name: table.columns[groupIndex]!.name,
        type: table.columns[groupIndex]!.type,
      },
      {
        name:
          options.aggregation === "count"
            ? "count"
            : `${options.aggregation}_${options.measure ?? "rows"}`,
        type: "number",
      },
    ],
    rows: entries.map(([key, bucket]) => [
      key,
      aggregateGroup(bucket.values, bucket.measure, options.aggregation),
    ]),
  };
}

/**
 * Adds a `YYYY-MM` month column derived from a date column, so a chart can
 * group by month without the caller writing SQL.
 */
export function withMonthColumn(
  table: SampleTable,
  dateColumn: string,
  monthColumn = `${dateColumn}_month`,
): SampleTable {
  const index = table.columns.findIndex(
    (column) => column.name === dateColumn && column.type === "date",
  );
  if (index < 0) {
    throw new Error(`"${dateColumn}" is not a date column of ${table.name}`);
  }
  return {
    ...table,
    columns: [
      ...table.columns.slice(0, index + 1),
      { name: monthColumn, type: "date" },
      ...table.columns.slice(index + 1),
    ],
    rows: table.rows.map((row) => {
      const value = row[index];
      const month =
        typeof value === "string" && value.length >= 7
          ? value.slice(0, 7)
          : null;
      return [...row.slice(0, index + 1), month, ...row.slice(index + 1)];
    }),
  };
}

export type PreviewOptions = { limit?: number; offset?: number };

/** The rows a table preview shows, in their stored order. */
export function previewSampleTable(
  table: SampleTable,
  options: PreviewOptions = {},
): { columns: SampleColumn[]; rows: SampleValue[][]; rowCount: number } {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(0, options.limit ?? 100);
  return {
    columns: table.columns,
    rows: table.rows.slice(offset, offset + limit),
    rowCount: table.rows.length,
  };
}

/**
 * The server seed stores this text on the metric row, before any reader exists, so it is written in
 * the catalog's default language rather than a reader's locale.
 */
const SEED_TEXT_LOCALE = "en-US";

/** Formats a number for display the way the metric tiles show it. */
export function formatMetricValue(
  value: number,
  format: "number" | "percent" | "currency" | "compact_number" | "text",
): string {
  switch (format) {
    case "percent":
      return `${round(value * 100)}%`;
    case "currency":
      return `$${value.toLocaleString(SEED_TEXT_LOCALE, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`;
    case "compact_number":
      return getCachedNumberFormat(SEED_TEXT_LOCALE, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    case "text":
      return String(value);
    case "number":
      return value.toLocaleString(SEED_TEXT_LOCALE, {
        maximumFractionDigits: 2,
      });
  }
}

/** The deterministic dataset id a project's sample cells point at. */
export function sampleTableVariableName(name: string): string {
  return name;
}

export const SAMPLE_ANCHOR_NOTE =
  "Sample data is seeded and anchored to a fixed date.";
