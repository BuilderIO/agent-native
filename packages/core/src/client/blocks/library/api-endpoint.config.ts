import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC `api-endpoint` block: its data
 * schema and MDX round-trip config. Shared by the server MDX adapter
 * (`plan-mdx.ts` via `plan-block-registry.ts`) and the client spec
 * (`planBlocks.tsx`). Keeping this React-free means importing it into a server
 * module never pulls React into the Nitro/SSR bundle.
 *
 * The block renders a Swagger / Stripe-style API reference row: a colored method
 * pill + monospace path + summary, collapsed by default, expanding to a params
 * table, a request body example, and per-status response examples.
 *
 * The schema MUST stay data-compatible with the `api-endpoint` branch of
 * `planBlockSchema` (`plan-content.ts`), and the MDX `tag` (`Endpoint`) +
 * attribute/children shape MUST match the inline planBlockSchema member so
 * stored `.mdx` round-trips. `description` is MDX *children* (prose body);
 * every other field is an attribute.
 */

export type ApiEndpointMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export const API_ENDPOINT_METHODS: ApiEndpointMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export type ApiParamLocation = "path" | "query" | "header" | "body";

export const API_PARAM_LOCATIONS: ApiParamLocation[] = [
  "path",
  "query",
  "header",
  "body",
];

/**
 * Diff state for a route / param / response, shared with the `file-tree` and
 * `data-model` blocks so a recap reads consistently across all three. Drives the
 * same change chips (Added / Modified / Removed / Renamed). Absent ⇒ no chip,
 * rendered exactly as before diff support existed.
 */
export type ApiEndpointChange = "added" | "modified" | "removed" | "renamed";

export const API_ENDPOINT_CHANGES: ApiEndpointChange[] = [
  "added",
  "modified",
  "removed",
  "renamed",
];

export interface ApiEndpointParam {
  name: string;
  in: ApiParamLocation;
  type?: string;
  required?: boolean;
  description?: string;
  /** Diff state for this parameter (drives the change chip). */
  change?: ApiEndpointChange;
  /**
   * Prior value when `change === "modified"` — e.g. the old type (`string`) or
   * the old required flag (`optional`). Shown struck-through before the current
   * value so a reviewer can see the before/after at a glance.
   */
  was?: string;
}

export interface ApiEndpointRequest {
  contentType?: string;
  example?: string;
}

export interface ApiEndpointResponse {
  status: string;
  description?: string;
  example?: string;
  /** Diff state for this response (e.g. a new `409` is "added"). */
  change?: ApiEndpointChange;
}

export interface ApiEndpointData {
  method: ApiEndpointMethod;
  path: string;
  summary?: string;
  /** Markdown prose body. Serialized as MDX children, not an attribute. */
  description?: string;
  auth?: string;
  deprecated?: boolean;
  /** Diff state for the whole route (added/removed/renamed endpoint). */
  change?: ApiEndpointChange;
  params?: ApiEndpointParam[];
  request?: ApiEndpointRequest;
  responses?: ApiEndpointResponse[];
}

const apiChangeSchema = z.enum(["added", "modified", "removed", "renamed"]);

const apiParamSchema = z.object({
  name: z.string().trim().min(1).max(160),
  in: z.enum(["path", "query", "header", "body"]),
  type: z.string().trim().max(120).optional(),
  required: z.boolean().optional(),
  description: z.string().trim().max(1_000).optional(),
  change: apiChangeSchema.optional(),
  was: z.string().trim().max(400).optional(),
}) as z.ZodType<ApiEndpointParam>;

const apiRequestSchema = z.object({
  contentType: z.string().trim().max(160).optional(),
  example: z.string().max(20_000).optional(),
}) as z.ZodType<ApiEndpointRequest>;

const apiResponseSchema = z.object({
  status: z.string().trim().min(1).max(40),
  description: z.string().trim().max(1_000).optional(),
  example: z.string().max(20_000).optional(),
  change: apiChangeSchema.optional(),
}) as z.ZodType<ApiEndpointResponse>;

/**
 * Data-compatible with the inline `api-endpoint` member of `planBlockSchema`
 * (`plan-content.ts`). `method` + `path` are required; everything else is
 * optional and defaults to omitted so a fresh endpoint validates from
 * `{ method: "GET", path: "/api/resource" }`.
 */
export const apiEndpointSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  path: z.string().trim().min(1).max(500),
  summary: z.string().trim().max(400).optional(),
  description: z.string().max(20_000).optional(),
  auth: z.string().trim().max(200).optional(),
  deprecated: z.boolean().optional(),
  change: apiChangeSchema.optional(),
  params: z.array(apiParamSchema).max(60).optional(),
  request: apiRequestSchema.optional(),
  responses: z.array(apiResponseSchema).max(40).optional(),
}) as unknown as z.ZodType<ApiEndpointData>;

/** Coerce a serialized `change` attribute back to the enum (drops garbage). */
function readChange(value: string | undefined): ApiEndpointChange | undefined {
  return value && API_ENDPOINT_CHANGES.includes(value as ApiEndpointChange)
    ? (value as ApiEndpointChange)
    : undefined;
}

/**
 * MDX config: `<Endpoint method path summary auth deprecated change params
 * request responses>\n\n{description}\n\n</Endpoint>`. `description` is the prose
 * body (`childrenField`), so it is excluded from the attribute bag and survives
 * as real inline-editable MDX prose. The remaining keys are emitted in a STABLE
 * order (method, path, summary, auth, deprecated, change, params, request,
 * responses); `undefined` values are dropped by the shared `prop()` encoder.
 *
 * The root `change` is a flat string attribute; the per-param `change` + `was`
 * and per-response `change` ride along inside the `params` / `responses` JSON
 * props (the whole arrays are serialized verbatim), so all three diff levels
 * round-trip without extra encoding.
 *
 * `fromAttrs` tolerates missing/partial attributes for backward-compat, mirrors
 * the schema defaults, and reads the prose `children` into `description`.
 */
export const apiEndpointMdx: BlockMdxConfig<ApiEndpointData> = {
  tag: "Endpoint",
  childrenField: "description",
  toAttrs: (data) => ({
    method: data.method,
    path: data.path,
    summary: data.summary,
    auth: data.auth,
    deprecated: data.deprecated,
    change: data.change,
    params: data.params,
    request: data.request as Record<string, unknown> | undefined,
    responses: data.responses,
  }),
  fromAttrs: (attrs, children) => {
    const method = (attrs.string("method") ?? "GET") as ApiEndpointMethod;
    const request = attrs.object<ApiEndpointRequest>("request");
    const description = children.trim();
    return {
      method: API_ENDPOINT_METHODS.includes(method) ? method : "GET",
      path: attrs.string("path") ?? "",
      summary: attrs.string("summary"),
      description: description.length > 0 ? description : undefined,
      auth: attrs.string("auth"),
      deprecated: attrs.bool("deprecated"),
      change: readChange(attrs.string("change")),
      params: attrs.array<ApiEndpointParam>("params"),
      request: request ?? undefined,
      responses: attrs.array<ApiEndpointResponse>("responses"),
    };
  },
};
