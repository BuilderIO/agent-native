import { defineAction } from "@agent-native/core";
import { extractItemsArray } from "@agent-native/core/provider-api/staging";
import { z } from "zod";

import { getAnalyticsProviderApiRuntime } from "../server/lib/provider-api";

const secretKey = /pass(word)?|secret|token|api[-_]?key|authorization/i;
const Input = z.object({
  provider: z.string().min(1),
  path: z.string().min(1),
  query: z.record(z.string(), z.unknown()).optional(),
  itemsPath: z.string().min(1).optional(),
});

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      secretKey.test(key) ? "[redacted]" : redact(entry),
    ]),
  );
}

export default defineAction({
  description:
    "Test an Analytics custom API connection with a bounded authenticated GET and return a safe row preview.",
  schema: Input,
  agentTool: false,
  http: { method: "POST" },
  readOnly: true,
  run: async ({ provider, path, query, itemsPath }) => {
    try {
      const result = (await getAnalyticsProviderApiRuntime().executeRequest({
        provider,
        method: "GET",
        path,
        ...(query ? { query } : {}),
        auth: "default",
        maxBytes: 1_000_000,
        timeoutMs: 10_000,
      })) as {
        response?: {
          ok?: boolean;
          status?: number;
          statusText?: string;
          json?: unknown;
          truncated?: boolean;
        };
      };
      const response = result.response;
      const status = response?.status ?? 0;
      const statusText = response?.statusText ?? "";
      if (!response?.ok) {
        return {
          ok: false,
          status,
          statusText,
          rowCount: 0,
          columns: [],
          sampleRows: [],
          itemsPath: itemsPath ?? null,
          truncated: false,
          error: `Custom API request failed with HTTP ${status}${statusText ? ` ${statusText}` : ""}.`,
        };
      }
      const rows = extractItemsArray(response.json, itemsPath ?? "auto");
      const sampleRows = rows.slice(0, 5).map((row) => redact(row));
      const columns = Array.from(
        new Set(
          rows.flatMap((row) =>
            row && typeof row === "object" && !Array.isArray(row)
              ? Object.keys(row)
              : [],
          ),
        ),
      );
      return {
        ok: true,
        status,
        statusText,
        rowCount: rows.length,
        columns,
        sampleRows,
        itemsPath: itemsPath ?? "auto",
        truncated: Boolean(response.truncated),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: "",
        rowCount: 0,
        columns: [],
        sampleRows: [],
        itemsPath: itemsPath ?? null,
        truncated: false,
        error:
          error instanceof Error
            ? `Custom API connection failed: ${error.message}`
            : "Custom API connection failed.",
      };
    }
  },
});
