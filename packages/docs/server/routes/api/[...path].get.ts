import { defineEventHandler } from "h3";

import { publicApiError } from "../../../lib/public-api-errors";

export default defineEventHandler((event) =>
  publicApiError(event, 404, {
    code: "api_route_not_found",
    message: "API route not found.",
    resolution: "Review the published OpenAPI specification at /openapi.json.",
  }),
);
