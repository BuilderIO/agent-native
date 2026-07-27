import fs from "node:fs";
import path from "node:path";

export const DEFAULT_PLAN_APP_URL = "https://plan.agent-native.com";

const PLAN_BLOCKS_HTTP_TIMEOUT_MS = 45_000;

export type PlanBlockFormat = "reference" | "schema";

export type FetchPlanBlockCatalogInput = {
  appUrl?: string;
  out?: string;
  format?: PlanBlockFormat;
  fetchFn?: typeof fetch;
};

export type FetchPlanBlockCatalogResult = {
  ok: true;
  out: string;
  count?: number;
  format: PlanBlockFormat;
};

export function planActionEndpoint(appUrl: string, action: string): string {
  return `${appUrl.replace(/\/$/, "")}/_agent-native/actions/${action}`;
}

export function normalizePlanBlockFormat(
  value: string | undefined,
): PlanBlockFormat {
  if (!value || value === "reference") return "reference";
  if (value === "schema") return "schema";
  throw new Error(`Invalid --format "${value}" (expected reference or schema)`);
}

export function defaultPlanBlocksOut(format: PlanBlockFormat): string {
  return format === "schema" ? "plan-blocks.schema.json" : "plan-blocks.md";
}

function sanitizeFetchDetail(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function shouldRetryPlanBlocks(status: number): boolean {
  return (
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<Response> {
  return await fetchFn(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PLAN_BLOCKS_HTTP_TIMEOUT_MS),
  });
}

function renderBlockCatalogOutput(
  json: { reference?: unknown; blocks?: unknown; count?: unknown },
  format: PlanBlockFormat,
): string {
  if (format === "schema") {
    if (!Array.isArray(json.blocks)) {
      throw new Error("get-plan-blocks returned no schema blocks.");
    }
    return `${JSON.stringify({ count: json.count, blocks: json.blocks }, null, 2)}\n`;
  }
  if (typeof json.reference !== "string" || json.reference.length === 0) {
    throw new Error("get-plan-blocks returned no reference text.");
  }
  return json.reference;
}

export async function fetchPlanBlockCatalog(
  input: FetchPlanBlockCatalogInput,
): Promise<FetchPlanBlockCatalogResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const appUrl = input.appUrl ?? DEFAULT_PLAN_APP_URL;
  const format = input.format ?? "reference";
  const out = input.out ?? defaultPlanBlocksOut(format);
  const endpoint = new URL(planActionEndpoint(appUrl, "get-plan-blocks"));
  endpoint.searchParams.set("format", format);

  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        endpoint.toString(),
        { method: "GET", headers: { accept: "application/json" } },
        fetchFn,
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        lastError = `get-plan-blocks failed ${response.status} ${
          response.statusText
        }: ${sanitizeFetchDetail(detail, 500)}`;
        if (attempt < 4 && shouldRetryPlanBlocks(response.status)) {
          await delay(attempt * 1500);
          continue;
        }
        throw new Error(lastError);
      }

      const json = (await response.json().catch(() => null)) as {
        reference?: unknown;
        blocks?: unknown;
        count?: unknown;
      } | null;
      if (!json) throw new Error("get-plan-blocks returned invalid JSON.");
      const text = renderBlockCatalogOutput(json, format);
      fs.writeFileSync(path.resolve(out), text, "utf-8");
      return {
        ok: true,
        out,
        count: typeof json.count === "number" ? json.count : undefined,
        format,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < 4) {
        await delay(attempt * 1500);
        continue;
      }
      throw new Error(lastError);
    }
  }

  throw new Error(lastError || "get-plan-blocks failed.");
}
