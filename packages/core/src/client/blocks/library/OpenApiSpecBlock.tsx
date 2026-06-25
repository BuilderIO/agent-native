import { IconChevronRight, IconLock } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";

import { cn } from "../../utils.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import { DevInput, DevLabel, DevTextarea } from "./dev-doc-ui.js";
import { CodeSurface } from "./HighlightedCode.js";
import type { OpenApiSpecData } from "./openapi-spec.config.js";

/**
 * Read + Edit renderers for an `openapi-spec` block — a Redoc / Swagger-UI-style
 * API reference rendered from a whole OpenAPI 3 / Swagger 2 document. The raw
 * `spec` TEXT (`data.spec`) is the source of truth; the Read renderer parses it
 * defensively and, on any parse error, falls back to the raw text plus the error
 * message (it never throws). Lives in core so any app can register the dev-doc
 * block (no shadcn import).
 *
 * Operations are grouped by tag; each operation is a collapsed-by-default row
 * (colored method pill + monospace path + summary) that expands to its
 * description, params table, request body, and per-status responses — the SAME
 * per-operation house style as the single-endpoint `api-endpoint` block. `$ref`
 * model references are resolved against `components.schemas` (OpenAPI 3) or
 * top-level `definitions` (Swagger 2), with a cycle guard.
 *
 * v1 parses JSON specs only (no `yaml` dependency is declared). `parseSpec` is
 * the single seam to extend when a YAML parser is added.
 *
 * DARK/LIGHT: the plan editor toggles a `.dark` class on <html>. Every color
 * token (method/status/location pills, chrome) uses Tailwind `dark:` variants or
 * the theme-aware plan CSS-var utilities, so the reference reads correctly in
 * BOTH modes (no hardcoded dark-only palette). SSR-safe: rendering derives only
 * from props (no window/document access at module or render time).
 */

/* ── Theme-aware color tokens (mirrors ApiEndpointBlock) ────────────────────── */

const METHOD_PILL: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  PATCH:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  HEAD: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  OPTIONS:
    "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  TRACE: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

const PARAM_IN_BADGE: Record<string, string> = {
  path: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  query: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  header:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  cookie:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  body: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

/** Status-pill palette keyed by the leading status digit (2xx/3xx/4xx/5xx). */
function statusPillClass(status: string): string {
  const lead = status.trim().charAt(0);
  if (lead === "2")
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (lead === "4")
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (lead === "5")
    return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  return "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300";
}

/* ── Defensive spec parsing + normalization ────────────────────────────────── */

type Json = unknown;
type JsonObject = Record<string, Json>;

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

interface NormalizedParam {
  name: string;
  in: string;
  type?: string;
  required?: boolean;
  description?: string;
}

interface NormalizedResponse {
  status: string;
  description?: string;
  /** Inline JSON example/schema preview, when derivable. */
  example?: string;
}

interface NormalizedOperation {
  id: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  secured?: boolean;
  tags: string[];
  params: NormalizedParam[];
  requestContentType?: string;
  requestExample?: string;
  responses: NormalizedResponse[];
}

interface NormalizedTagGroup {
  tag: string;
  description?: string;
  operations: NormalizedOperation[];
}

interface NormalizedSpec {
  title?: string;
  version?: string;
  description?: string;
  format: "OpenAPI 3" | "Swagger 2" | "Unknown";
  groups: NormalizedTagGroup[];
  operationCount: number;
}

interface ParseResult {
  ok: boolean;
  spec?: NormalizedSpec;
  error?: string;
}

function isObject(value: Json): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: Json): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse the raw spec text into a JSON object. v1 supports JSON only — a YAML
 * parser is not a declared dependency. This is the single seam to extend with
 * YAML once `yaml` is a real dependency.
 */
function parseSpec(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Empty spec — paste an OpenAPI 3 / Swagger 2 document.",
    };
  }
  let doc: Json;
  try {
    doc = JSON.parse(trimmed);
  } catch (error) {
    const hint =
      /^[A-Za-z][\w-]*\s*:/.test(trimmed) || trimmed.startsWith("---")
        ? " (YAML is not supported yet — paste JSON, or convert the spec to JSON.)"
        : "";
    return {
      ok: false,
      error: `${error instanceof Error ? error.message : "Invalid JSON"}${hint}`,
    };
  }
  if (!isObject(doc)) {
    return { ok: false, error: "Spec must be a JSON object." };
  }
  try {
    return { ok: true, spec: normalizeSpec(doc) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not interpret the spec document.",
    };
  }
}

/** Resolve a local `$ref` (e.g. `#/components/schemas/User`) against the root. */
function resolveRef(
  root: JsonObject,
  ref: string,
  seen: Set<string>,
): Json | undefined {
  if (!ref.startsWith("#/")) return undefined;
  if (seen.has(ref)) return undefined; // cycle guard
  seen.add(ref);
  const segments = ref
    .slice(2)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: Json = root;
  for (const segment of segments) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Follow a single `$ref` hop on a schema/param object if present. */
function deref(root: JsonObject, value: Json, seen: Set<string>): Json {
  let current = value;
  let guard = 0;
  while (isObject(current) && typeof current.$ref === "string" && guard < 20) {
    const resolved = resolveRef(root, current.$ref, seen);
    if (resolved === undefined) return current;
    current = resolved;
    guard += 1;
  }
  return current;
}

/** Short human type label for a (deref'd) schema object. */
function schemaTypeLabel(
  root: JsonObject,
  schema: Json,
  seen: Set<string>,
): string | undefined {
  const resolved = deref(root, schema, new Set(seen));
  if (!isObject(resolved)) return undefined;
  if (typeof resolved.type === "string") {
    if (resolved.type === "array" && resolved.items) {
      const inner = schemaTypeLabel(root, resolved.items, seen);
      return inner ? `${inner}[]` : "array";
    }
    return resolved.type;
  }
  if (resolved.$ref && typeof resolved.$ref === "string") {
    return resolved.$ref.split("/").pop();
  }
  if (resolved.enum) return "enum";
  if (resolved.properties) return "object";
  if (resolved.oneOf || resolved.anyOf || resolved.allOf) return "object";
  return undefined;
}

/**
 * Build a compact JSON skeleton from a (resolved) schema so the request/response
 * panels can show a Swagger-UI-style model preview. Bounded depth + a cycle
 * guard keep it safe on recursive models.
 */
function schemaExample(
  root: JsonObject,
  schema: Json,
  seen: Set<string>,
  depth: number,
): Json {
  if (depth > 6) return "…";
  const resolved = deref(root, schema, new Set(seen));
  if (!isObject(resolved)) return resolved ?? null;
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }

  const allOf = Array.isArray(resolved.allOf) ? resolved.allOf : null;
  if (allOf) {
    const merged: JsonObject = {};
    for (const part of allOf) {
      const value = schemaExample(root, part, seen, depth + 1);
      if (isObject(value)) Object.assign(merged, value);
    }
    if (Object.keys(merged).length > 0) return merged;
  }
  const oneOf =
    (Array.isArray(resolved.oneOf) && resolved.oneOf) ||
    (Array.isArray(resolved.anyOf) && resolved.anyOf) ||
    null;
  if (oneOf && oneOf.length > 0) {
    return schemaExample(root, oneOf[0], seen, depth + 1);
  }

  const type = resolved.type;
  if (type === "object" || resolved.properties) {
    const props = isObject(resolved.properties) ? resolved.properties : {};
    const out: JsonObject = {};
    for (const [key, propSchema] of Object.entries(props).slice(0, 30)) {
      out[key] = schemaExample(root, propSchema, seen, depth + 1);
    }
    return out;
  }
  if (type === "array") {
    return [schemaExample(root, resolved.items ?? {}, seen, depth + 1)];
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return true;
  if (type === "string") {
    if (resolved.format === "date-time") return "2020-01-01T00:00:00Z";
    if (resolved.format === "uuid")
      return "00000000-0000-0000-0000-000000000000";
    return "string";
  }
  return null;
}

/** Stringify a derived example, guarding against oversized payloads. */
function stringifyExample(value: Json): string | undefined {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text || text === "null" || text === "{}" || text === "[]")
      return undefined;
    return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…` : text;
  } catch {
    return undefined;
  }
}

function normalizeParam(
  root: JsonObject,
  raw: Json,
  seen: Set<string>,
): NormalizedParam | undefined {
  const param = deref(root, raw, new Set(seen));
  if (!isObject(param)) return undefined;
  const name = asString(param.name);
  const location = asString(param.in);
  if (!name || !location) return undefined;
  // OpenAPI 3 nests type under `schema`; Swagger 2 puts it on the param.
  const type =
    schemaTypeLabel(root, param.schema, seen) ?? asString(param.type);
  return {
    name,
    in: location,
    type,
    required: param.required === true,
    description: asString(param.description),
  };
}

function normalizeOperation(
  root: JsonObject,
  path: string,
  method: string,
  rawOp: Json,
  pathLevelParams: NormalizedParam[],
  seen: Set<string>,
): NormalizedOperation | undefined {
  if (!isObject(rawOp)) return undefined;

  const params: NormalizedParam[] = [...pathLevelParams];
  if (Array.isArray(rawOp.parameters)) {
    for (const rawParam of rawOp.parameters) {
      const normalized = normalizeParam(root, rawParam, seen);
      if (normalized) params.push(normalized);
    }
  }

  // Request body: OpenAPI 3 `requestBody.content[*].schema`; Swagger 2 `body` param.
  let requestContentType: string | undefined;
  let requestExample: string | undefined;
  const requestBody = deref(root, rawOp.requestBody, new Set(seen));
  if (isObject(requestBody) && isObject(requestBody.content)) {
    const [contentType, media] = Object.entries(requestBody.content)[0] ?? [];
    requestContentType = contentType;
    if (isObject(media)) {
      requestExample =
        stringifyExample(media.example) ??
        stringifyExample(schemaExample(root, media.schema, seen, 0));
    }
  } else {
    const bodyParam = params.find((p) => p.in === "body");
    if (bodyParam) {
      // Swagger 2 body param carries its schema on the raw parameter.
      const rawBody = Array.isArray(rawOp.parameters)
        ? rawOp.parameters.find(
            (p) =>
              isObject(deref(root, p, new Set(seen))) &&
              asString((deref(root, p, new Set(seen)) as JsonObject).in) ===
                "body",
          )
        : undefined;
      const resolvedBody = isObject(deref(root, rawBody, new Set(seen)))
        ? (deref(root, rawBody, new Set(seen)) as JsonObject)
        : undefined;
      requestContentType = "application/json";
      requestExample = stringifyExample(
        schemaExample(root, resolvedBody?.schema, seen, 0),
      );
    }
  }
  // Swagger 2 `body` params are represented via requestBody above; drop them
  // from the visible param table so they don't double-render.
  const visibleParams = params.filter((p) => p.in !== "body");

  const responses: NormalizedResponse[] = [];
  if (isObject(rawOp.responses)) {
    for (const [status, rawResponse] of Object.entries(rawOp.responses)) {
      const response = deref(root, rawResponse, new Set(seen));
      let example: string | undefined;
      if (isObject(response)) {
        // OpenAPI 3: response.content[*].schema; Swagger 2: response.schema.
        if (isObject(response.content)) {
          const media = Object.values(response.content)[0];
          if (isObject(media)) {
            example =
              stringifyExample(media.example) ??
              stringifyExample(schemaExample(root, media.schema, seen, 0));
          }
        } else if (response.schema) {
          example = stringifyExample(
            schemaExample(root, response.schema, seen, 0),
          );
        }
      }
      responses.push({
        status,
        description: isObject(response)
          ? asString(response.description)
          : undefined,
        example,
      });
    }
  }

  const tags =
    Array.isArray(rawOp.tags) && rawOp.tags.length > 0
      ? rawOp.tags.filter((t): t is string => typeof t === "string")
      : [];

  const secured =
    Array.isArray(rawOp.security) && rawOp.security.length > 0
      ? rawOp.security.some(
          (req) => isObject(req) && Object.keys(req).length > 0,
        )
      : undefined;

  return {
    id: `${method}-${path}`,
    method: method.toUpperCase(),
    path,
    summary: asString(rawOp.summary),
    description: asString(rawOp.description),
    deprecated: rawOp.deprecated === true,
    secured,
    tags: tags.length > 0 ? tags : ["default"],
    params: visibleParams,
    requestContentType,
    requestExample,
    responses: responses.sort((a, b) => a.status.localeCompare(b.status)),
  };
}

function normalizeSpec(doc: JsonObject): NormalizedSpec {
  const format: NormalizedSpec["format"] =
    typeof doc.openapi === "string"
      ? "OpenAPI 3"
      : typeof doc.swagger === "string"
        ? "Swagger 2"
        : "Unknown";

  const info = isObject(doc.info) ? doc.info : undefined;

  // Global security requirement → every operation without its own override is
  // secured. Operation-level `security: []` opts out; we treat presence here as
  // the default-secured signal.
  const globalSecured =
    Array.isArray(doc.security) &&
    doc.security.some((req) => isObject(req) && Object.keys(req).length > 0);

  // Tag order + descriptions from the document's top-level `tags`.
  const tagOrder: string[] = [];
  const tagDescriptions = new Map<string, string>();
  if (Array.isArray(doc.tags)) {
    for (const tag of doc.tags) {
      if (isObject(tag) && typeof tag.name === "string") {
        tagOrder.push(tag.name);
        if (typeof tag.description === "string") {
          tagDescriptions.set(tag.name, tag.description);
        }
      }
    }
  }

  const groups = new Map<string, NormalizedOperation[]>();
  let operationCount = 0;

  const paths = isObject(doc.paths) ? doc.paths : {};
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const seen = new Set<string>();
    const pathItem = deref(doc, rawPathItem, seen);
    if (!isObject(pathItem)) continue;

    const pathLevelParams: NormalizedParam[] = [];
    if (Array.isArray(pathItem.parameters)) {
      for (const rawParam of pathItem.parameters) {
        const normalized = normalizeParam(doc, rawParam, new Set());
        if (normalized) pathLevelParams.push(normalized);
      }
    }

    for (const method of HTTP_METHODS) {
      const rawOp = pathItem[method];
      if (!isObject(rawOp)) continue;
      const operation = normalizeOperation(
        doc,
        path,
        method,
        rawOp,
        pathLevelParams,
        new Set(),
      );
      if (!operation) continue;
      if (operation.secured === undefined && globalSecured) {
        operation.secured = true;
      }
      operationCount += 1;
      for (const tag of operation.tags) {
        const list = groups.get(tag) ?? [];
        list.push(operation);
        groups.set(tag, list);
      }
    }
  }

  // Order: documented tags first (in their declared order), then any remaining
  // tags alphabetically.
  const orderedTagNames = [
    ...tagOrder.filter((tag) => groups.has(tag)),
    ...[...groups.keys()]
      .filter((tag) => !tagOrder.includes(tag))
      .sort((a, b) => a.localeCompare(b)),
  ];

  const groupList: NormalizedTagGroup[] = orderedTagNames.map((tag) => ({
    tag,
    description: tagDescriptions.get(tag),
    operations: groups.get(tag) ?? [],
  }));

  return {
    title: info ? asString(info.title) : undefined,
    version: info ? asString(info.version) : undefined,
    description: info ? asString(info.description) : undefined,
    format,
    groups: groupList,
    operationCount,
  };
}

/* ── Operation row (collapsed-by-default, mirrors api-endpoint) ─────────────── */

function OperationRow({
  operation,
  renderMarkdown,
}: {
  operation: NormalizedOperation;
  renderMarkdown?: (markdown: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const hasBody =
    Boolean(operation.description?.trim()) ||
    operation.params.length > 0 ||
    Boolean(operation.requestExample || operation.requestContentType) ||
    operation.responses.length > 0;

  return (
    <div className="overflow-hidden border-t border-plan-line first:border-t-0">
      <button
        type="button"
        data-plan-interactive
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
          "hover:bg-accent/40",
        )}
      >
        <IconChevronRight
          className={cn(
            "size-4 shrink-0 text-plan-muted transition-transform",
            open && "rotate-90",
          )}
        />
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 font-mono text-xs font-bold uppercase tracking-wide",
            METHOD_PILL[operation.method] ??
              "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
          )}
        >
          {operation.method}
        </span>
        <span
          className={cn(
            "min-w-0 truncate font-mono text-sm font-semibold text-plan-text",
            operation.deprecated && "text-plan-muted line-through",
          )}
        >
          {operation.path}
        </span>
        {operation.summary && (
          <span className="ml-1 min-w-0 flex-1 truncate text-sm text-plan-muted">
            {operation.summary}
          </span>
        )}
        {operation.secured && (
          <IconLock
            className="size-3.5 shrink-0 text-plan-muted"
            aria-label="Requires authentication"
          />
        )}
      </button>

      {open && hasBody && (
        <div className="border-t border-plan-line bg-plan-block px-4 py-4">
          {operation.description?.trim() && (
            <div className="an-api-endpoint-desc">
              {renderMarkdown ? (
                renderMarkdown(operation.description)
              ) : (
                <p className="text-sm text-plan-muted">
                  {operation.description}
                </p>
              )}
            </div>
          )}

          {operation.params.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-plan-muted">
                Parameters
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-plan-line">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-accent/30 text-left text-xs uppercase tracking-wide text-plan-muted">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">In</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Required</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operation.params.map((param, index) => (
                      <tr
                        key={`${param.name}-${param.in}-${index}`}
                        className="border-t border-plan-line align-top"
                      >
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-plan-text">
                          {param.name}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                              PARAM_IN_BADGE[param.in] ??
                                "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
                            )}
                          >
                            {param.in}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-plan-muted">
                          {param.type || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {param.required ? (
                            <span className="font-medium text-red-600 dark:text-red-300">
                              required
                            </span>
                          ) : (
                            <span className="text-plan-muted">optional</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-plan-muted">
                          {param.description || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(operation.requestExample || operation.requestContentType) && (
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-plan-muted">
                  Request body
                </span>
                {operation.requestContentType && (
                  <span className="rounded bg-accent/40 px-1.5 py-0.5 font-mono text-[11px] text-plan-muted">
                    {operation.requestContentType}
                  </span>
                )}
              </div>
              {operation.requestExample && (
                <CodeSurface
                  code={operation.requestExample}
                  language="json"
                  className="mt-2"
                />
              )}
            </div>
          )}

          {operation.responses.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-plan-muted">
                Responses
              </div>
              <div className="mt-2 flex flex-col gap-3">
                {operation.responses.map((response, index) => (
                  <div
                    key={`${response.status}-${index}`}
                    className="rounded-lg border border-plan-line"
                  >
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 font-mono text-xs font-bold",
                          statusPillClass(response.status),
                        )}
                      >
                        {response.status}
                      </span>
                      {response.description && (
                        <span className="text-sm text-plan-muted">
                          {response.description}
                        </span>
                      )}
                    </div>
                    {response.example && (
                      <div className="border-t border-plan-line px-3 pb-3 pt-3">
                        <CodeSurface
                          code={response.example}
                          language="json"
                          className="mt-0"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Tag group (collapsed-by-default) ──────────────────────────────────────── */

function TagGroup({
  group,
  defaultOpen,
  renderMarkdown,
}: {
  group: NormalizedTagGroup;
  defaultOpen: boolean;
  renderMarkdown?: (markdown: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-plan-line bg-plan-block">
      <button
        type="button"
        data-plan-interactive
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <IconChevronRight
          className={cn(
            "size-4 shrink-0 text-plan-muted transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="font-semibold text-plan-text">{group.tag}</span>
        <span className="rounded-full bg-accent/40 px-2 py-0.5 text-[11px] font-medium text-plan-muted">
          {group.operations.length}
        </span>
        {group.description && (
          <span className="ml-1 min-w-0 flex-1 truncate text-sm text-plan-muted">
            {group.description}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-plan-line">
          {group.operations.map((operation) => (
            <OperationRow
              key={operation.id}
              operation={operation}
              renderMarkdown={renderMarkdown}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Read (Redoc / Swagger-UI-style reference) ─────────────────────────────── */

/**
 * Read-only renderer for an `openapi-spec` block. Parses `data.spec` defensively
 * and renders a Redoc / Swagger-UI-style reference: a header (title + version +
 * format badge), then operations grouped by tag, each a collapsed-by-default row
 * that expands to the full per-operation reference. On a parse error it shows the
 * error plus the raw payload (never throws).
 */
export function OpenApiSpecRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<OpenApiSpecData>) {
  const parsed = useMemo(() => parseSpec(data.spec), [data.spec]);
  const heading = data.title ?? title;
  const renderMarkdown = ctx.renderMarkdown;

  return (
    <section
      {...ltrCodeBlockProps}
      className="plan-block"
      data-block-id={blockId}
    >
      {heading && <div className="plan-block-label">{heading}</div>}

      {parsed.ok && parsed.spec ? (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-plan-line bg-plan-block px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-plan-text">
                {parsed.spec.title || "API reference"}
              </span>
              {parsed.spec.version && (
                <span className="rounded bg-accent/40 px-1.5 py-0.5 font-mono text-[11px] text-plan-muted">
                  v{parsed.spec.version}
                </span>
              )}
              <span className="rounded-full border border-plan-line px-2 py-0.5 text-[11px] font-medium text-plan-muted">
                {parsed.spec.format}
              </span>
              <span className="text-xs text-plan-muted">
                {parsed.spec.operationCount}{" "}
                {parsed.spec.operationCount === 1 ? "operation" : "operations"}
              </span>
            </div>
            {parsed.spec.description?.trim() && (
              <div className="mt-2 an-api-endpoint-desc">
                {renderMarkdown ? (
                  renderMarkdown(parsed.spec.description)
                ) : (
                  <p className="text-sm text-plan-muted">
                    {parsed.spec.description}
                  </p>
                )}
              </div>
            )}
          </div>

          {parsed.spec.groups.length === 0 ? (
            <div className="rounded-xl border border-plan-line bg-plan-block px-4 py-6 text-center text-sm text-plan-muted">
              No operations found in this spec.
            </div>
          ) : (
            parsed.spec.groups.map((group, index) => (
              <TagGroup
                key={group.tag}
                group={group}
                // Open the first group by default so the reference is not a wall
                // of collapsed accordions on first paint.
                defaultOpen={index === 0}
                renderMarkdown={renderMarkdown}
              />
            ))
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-plan-line bg-plan-block">
          <div className="border-b border-plan-line px-3 py-1.5">
            <span className="font-mono text-xs uppercase tracking-wide text-plan-muted">
              OpenAPI
            </span>
          </div>
          <div className="space-y-2 px-3 py-2.5">
            <p className="text-xs text-red-600 dark:text-red-300">
              Could not parse spec: {parsed.error}
            </p>
            <CodeSurface
              code={data.spec || "—"}
              language="json"
              className="mt-0"
            />
          </div>
        </div>
      )}

      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/* ── Edit (panel form) ─────────────────────────────────────────────────────── */

/**
 * Panel editor for an `openapi-spec` block: a `title` input plus a monospace
 * textarea bound to the raw `spec`, with a "Format" button that pretty-prints via
 * `JSON.parse` → `JSON.stringify(_, null, 2)` (guarded — shows an INLINE error,
 * never `window.alert`). Renders BARE content (no `<section>`); the registry's
 * panel surface supplies the popover chrome.
 */
export function OpenApiSpecEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<OpenApiSpecData>) {
  const titleId = useId();
  const specId = useId();
  const [formatError, setFormatError] = useState<string | null>(null);

  const handleFormat = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(data.spec), null, 2);
      setFormatError(null);
      onChange({ ...data, spec: formatted });
    } catch (error) {
      setFormatError(
        error instanceof Error ? error.message : "Invalid JSON — cannot format",
      );
    }
  };

  return (
    <div className="grid gap-3" data-plan-interactive>
      <div className="grid gap-1.5">
        <DevLabel htmlFor={titleId}>Title</DevLabel>
        <DevInput
          id={titleId}
          value={data.title ?? ""}
          readOnly={!editable}
          onChange={(event) =>
            onChange({ ...data, title: event.target.value || undefined })
          }
          placeholder="Optional heading"
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <DevLabel htmlFor={specId}>OpenAPI / Swagger spec</DevLabel>
          {editable && (
            <button
              type="button"
              data-plan-interactive
              onClick={handleFormat}
              className="inline-flex h-7 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-2 text-xs font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              Format
            </button>
          )}
        </div>
        <DevTextarea
          id={specId}
          value={data.spec}
          readOnly={!editable}
          spellCheck={false}
          onChange={(event) => {
            setFormatError(null);
            onChange({ ...data, spec: event.target.value });
          }}
          className="min-h-72 font-mono text-xs"
          placeholder={
            '{\n  "openapi": "3.0.0",\n  "info": { "title": "My API", "version": "1.0.0" },\n  "paths": {}\n}'
          }
        />
        {formatError && (
          <p className="text-xs text-red-600 dark:text-red-300">
            {formatError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Paste a complete OpenAPI 3 or Swagger 2 document. v1 supports JSON
          specs only — convert YAML to JSON first.
        </p>
      </div>
    </div>
  );
}
