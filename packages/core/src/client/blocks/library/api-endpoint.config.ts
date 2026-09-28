import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

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
  change?: ApiEndpointChange;
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
  change?: ApiEndpointChange;
}

export interface ApiEndpointData {
  method: ApiEndpointMethod;
  path: string;
  summary?: string;
  description?: string;
  auth?: string;
  deprecated?: boolean;
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

function readChange(value: string | undefined): ApiEndpointChange | undefined {
  return value && API_ENDPOINT_CHANGES.includes(value as ApiEndpointChange)
    ? (value as ApiEndpointChange)
    : undefined;
}

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
